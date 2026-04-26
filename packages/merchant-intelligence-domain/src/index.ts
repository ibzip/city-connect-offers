import type {
  ActivateCommerceZoneRequest,
  ActivateCommerceZoneResult,
  BusinessState,
  CitySuggestion,
  CompiledFreeformRule,
  CommerceZone,
  ConsumerContextSnapshot,
  GeoBox,
  Merchant,
  MerchantImportRun,
  MerchantInsightSnapshot,
  MerchantGoal,
  MerchantProduct,
  MerchantRule,
  MerchantRuleCompilePreviewResult,
  MerchantRuleStaticPatch,
  PaymentDensitySignal,
  ProviderBudget,
  SupportedMerchantCategory,
} from "@city-wallet/contracts";
import { defaultProviderBudget, MerchantRuleStaticPatchSchema } from "@city-wallet/contracts";
import {
  discoveryConfig,
  getCityImportRuntimeBudgetMs,
  getCityImportPoiProvider,
  getCityImportProviderWarnings,
  getDefaultCityImportRadiusMeters,
  getGooglePlacesMaxImportedMerchants,
  getGooglePlacesMaxRequestsPerImport,
  googlePlacesImportFieldMask,
  isOverpassImportFallbackEnabled,
  isWalletLiveDiscoveryFallbackEnabled,
} from "@city-wallet/config";
import type { CityWalletRepository } from "@city-wallet/db";
import { createDefaultProviders, type GeocodingCache, type PoiBusiness, type PoiCache } from "@city-wallet/providers";
import { calculateDistanceMeters, clamp, isPointInsideZone, makeId, nowIso, rectanglePolygonGeoJson, roundCoordinate, slugify, stableHash, withTimeout } from "@city-wallet/utils";

const IMPORTER_VERSION = "center_out_auto_target_v2";
const PROVIDER_ERROR_STOP_THRESHOLD = 25;

type ImportStopReason =
  | "target_reached"
  | "google_request_cap_reached"
  | "all_jobs_exhausted"
  | "runtime_budget_reached"
  | "provider_errors"
  | "city_merchant_cache_reused";

export function calculateTransactionDropPercent(signal: PaymentDensitySignal): number {
  if (signal.baselineTransactions <= 0) return 0;
  return Math.round(((signal.baselineTransactions - signal.currentTransactions) / signal.baselineTransactions) * 100);
}

export function calculateRevenueDropPercent(signal: PaymentDensitySignal): number {
  if (signal.baselineRevenue <= 0) return 0;
  return Math.round(((signal.baselineRevenue - signal.currentRevenue) / signal.baselineRevenue) * 100);
}

export function calculateBusinessState(dropPercent: number): BusinessState {
  if (dropPercent >= 50) return "very_quiet";
  if (dropPercent >= 25) return "quiet";
  if (dropPercent <= -25) return "busy";
  return "normal";
}

export function calculateUrgencyScore(signal: PaymentDensitySignal): number {
  const transactionDrop = calculateTransactionDropPercent(signal);
  const revenueDrop = calculateRevenueDropPercent(signal);
  const state = calculateBusinessState(transactionDrop);
  const stateBonus = state === "very_quiet" ? 20 : state === "quiet" ? 25 : state === "busy" ? -15 : 0;
  return Math.round(clamp(transactionDrop * 0.8 + revenueDrop * 0.35 + stateBonus, 0, 100));
}

export function assignJourneyFitTags(merchant: Merchant): string[] {
  if (merchant.category === "cafe") {
    return ["warm_break", "lunch_stop", "browsing_break"];
  }
  if (merchant.category === "bookshop") {
    return ["slow_discovery", "rainy_day_discovery", "browsing_break"];
  }
  if (merchant.category === "flower_shop") {
    return ["gift_moment", "date_night", "celebration"];
  }
  return ["local_discovery"];
}

export function calculateBundleReadinessScore(
  merchant: Merchant,
  insight: Pick<MerchantInsightSnapshot, "businessState" | "urgencyScore" | "journeyFitTags">,
): number {
  const rule = merchant.rule;
  const budgetRatio = rule && rule.dailyBudgetEuro > 0
    ? clamp(rule.dailyBudgetRemainingEuro / rule.dailyBudgetEuro, 0, 1)
    : 0;
  const proximity = merchant.distanceMeters <= 100 ? 12 : merchant.distanceMeters <= 150 ? 8 : merchant.distanceMeters <= 250 ? 6 : 0;
  const journeyFit = ["cafe", "bookshop"].includes(merchant.category) ? 8 : merchant.category === "flower_shop" ? 0 : 4;
  const normalDemandPenalty = insight.businessState === "normal" ? -8 : insight.businessState === "busy" ? -18 : 0;
  const veryQuietLift = insight.businessState === "very_quiet" ? 2 : 0;

  return Math.round(clamp(
    18 +
      (rule?.allowsBundles ? 18 : 0) +
      insight.urgencyScore * 0.3 +
      proximity +
      journeyFit +
      budgetRatio * 10 +
      normalDemandPenalty +
      veryQuietLift,
    0,
    100,
  ));
}

export function buildMerchantInsightSnapshot(
  merchant: Merchant,
  signal: PaymentDensitySignal,
): MerchantInsightSnapshot {
  const transactionDropPercent = calculateTransactionDropPercent(signal);
  const revenueDropPercent = calculateRevenueDropPercent(signal);
  const businessState = calculateBusinessState(transactionDropPercent);
  const urgencyScore = calculateUrgencyScore(signal);
  const journeyFitTags = assignJourneyFitTags(merchant);
  const bundleReadinessScore = calculateBundleReadinessScore(merchant, {
    businessState,
    urgencyScore,
    journeyFitTags,
  });

  return {
    insightId: `insight_${merchant.id}`,
    merchantId: merchant.id,
    businessState,
    transactionDropPercent,
    revenueDropPercent,
    urgencyScore,
    bundleReadinessScore,
    journeyFitTags,
    insightSummary: buildInsightSummary(merchant, businessState, transactionDropPercent, urgencyScore, bundleReadinessScore),
    refreshedAt: nowIso(),
  };
}

export async function refreshMerchantInsights(repository: CityWalletRepository, merchantIds?: string[]) {
  const [merchants, signals] = await Promise.all([
    repository.listMerchants(merchantIds?.length ? { ids: merchantIds } : undefined),
    repository.listPaymentDensitySignals(),
  ]);

  const insights: MerchantInsightSnapshot[] = [];
  for (const merchant of merchants) {
    const signal = signals.find((candidate) => candidate.merchantId === merchant.id);
    if (!signal) continue;
    const insight = buildMerchantInsightSnapshot(merchant, signal);
    await repository.saveMerchantInsight(insight);
    insights.push(insight);
  }
  return insights;
}

export class FreeformRuleCompilationError extends Error {
  constructor(message: string, readonly preview?: MerchantRuleCompilePreviewResult) {
    super(message);
    this.name = "FreeformRuleCompilationError";
  }
}

export async function compileMerchantFreeformRules(input: {
  merchant: Merchant;
  freeformRulesText: string;
}): Promise<MerchantRuleCompilePreviewResult> {
  const baseRule = input.merchant.rule ?? buildDefaultMerchantRule(input.merchant);
  const freeformRulesText = input.freeformRulesText.trim();
  if (!freeformRulesText) {
    return {
      ok: true,
      compiledRule: null,
      appliedRule: {
        ...baseRule,
        freeformRulesText: "",
        compiledFreeformRules: undefined,
        freeformRulesStatus: "empty",
      },
    };
  }

  const compiled = await compileFreeformRuleText(input.merchant, baseRule, freeformRulesText);
  if (!compiled) {
    return {
      ok: false,
      compiledRule: null,
      appliedRule: null,
      error: "Free-form rules could not be compiled into supported static constraints. Use explicit limits such as max discount, budget, bundles, eligible products, preferred categories, offer types, or brand tone.",
    };
  }

  const appliedRule = applyCompiledRulePatch(baseRule, compiled, freeformRulesText);
  return {
    ok: true,
    compiledRule: compiled,
    appliedRule,
  };
}

export async function compileAndApplyMerchantRules(merchant: Merchant) {
  const freeformRulesText = merchant.rule?.freeformRulesText ?? "";
  const preview = await compileMerchantFreeformRules({ merchant, freeformRulesText });
  if (!preview.ok || !preview.appliedRule) {
    throw new FreeformRuleCompilationError(preview.error ?? "Could not compile free-form merchant rules.", preview);
  }
  return {
    merchant: {
      ...merchant,
      rule: preview.appliedRule,
    },
    preview,
  };
}

export async function runOptionalMerchantDiscovery(input: {
  repository: CityWalletRepository;
  context: ConsumerContextSnapshot;
  budget: ProviderBudget;
}) {
  const location = input.context.userLocation;
  if (!location) return [];

  const providers = createDefaultProviders();
  const geocodeCache: GeocodingCache = {
    get: (provider, query) => input.repository.getGeocodingCache(provider, query),
    set: (provider, query, result, status) => input.repository.setGeocodingCache({ provider, query, result, status }),
  };
  const poiCache: PoiCache = {
    get: (provider, cacheKey) => input.repository.getPoiCache(provider, cacheKey),
    set: (provider, cacheKey, result, expiresAt) => input.repository.setPoiCache({ provider, cacheKey, result, expiresAt }),
  };

  const categories = contextCategories(input.context);
  const activeZone = input.context.matchedZones[0];
  const radiusMeters = Math.min(activeZone?.radiusMeters ?? 350, 500);
  const [poiResults, tavilyResults] = await Promise.all([
    providers.poi.findNearbyBusinesses({
      latitude: location.latitude,
      longitude: location.longitude,
      radiusMeters,
      categories,
      budget: input.budget,
      cache: poiCache,
    }),
    providers.merchantDiscovery.enrichNearbyBusinesses({
      latitude: location.latitude,
      longitude: location.longitude,
      query: categories.join(" OR "),
      budget: input.budget,
    }),
  ]);

  const discovered: Merchant[] = [];
  const merged = dedupeBusinesses([...poiResults, ...tavilyResults]).slice(0, 12);
  for (const business of merged) {
    let coordinates = business.latitude !== undefined && business.longitude !== undefined
      ? { latitude: business.latitude, longitude: business.longitude }
      : null;
    if (!coordinates) {
      const query = [business.address, business.name, activeZone?.city].filter(Boolean).join(", ");
      coordinates = await providers.geocoding.geocode(query, { budget: input.budget, cache: geocodeCache });
    }
    if (!coordinates) continue;

    const baseMerchant = discoveredBusinessToMerchant({
      business,
      context: input.context,
      coordinates,
    });
    const merchant = enrichImportedMerchantWithSyntheticData(baseMerchant);
    await input.repository.saveMerchant(merchant);
    await input.repository.savePaymentDensitySignal(generateSyntheticPaymentDensity(merchant));
    discovered.push(merchant);
  }

  return discovered;
}

export async function activateCommerceZoneAndImport(input: {
  repository: CityWalletRepository;
  request: ActivateCommerceZoneRequest;
}): Promise<ActivateCommerceZoneResult> {
  const forceRefresh = input.request.forceRefresh === true;
  const providers = createDefaultProviders();
  const geocodeCache: GeocodingCache = {
    get: (provider, query) => input.repository.getGeocodingCache(provider, query),
    set: (provider, query, result, status) => input.repository.setGeocodingCache({ provider, query, result, status }),
  };
  const existingZoneForRequest = forceRefresh ? null : await findExistingActivationZone(input.repository, input.request);
  const resolved = existingZoneForRequest
    ? resolvedDraftFromExistingZone(existingZoneForRequest, input.request)
    : await resolveZoneDraft(input.request, geocodeCache, providers.geocoding);
  const basePreview = buildImportPreview({ ...input.request, radiusMeters: resolved.radiusMeters }, resolved.warnings);
  const zone: CommerceZone = {
    id: input.request.zoneId ?? existingZoneForRequest?.id ?? `zone_${slugify(`${resolved.city}_${resolved.name}`) || makeId("city_zone")}`,
    name: resolved.name,
    city: resolved.city,
    country: resolved.country,
    zoneType: "city_zone",
    centerLat: resolved.centerLat,
    centerLng: resolved.centerLng,
    radiusMeters: basePreview.radiusMeters,
    polygonGeoJson: resolved.polygonGeoJson,
    importSettings: {
      radiusMeters: basePreview.radiusMeters,
      maxImportedMerchants: basePreview.maxImportedMerchants,
      maxTilesPerRun: basePreview.maxTilesPerRun,
      categories: basePreview.selectedCategories,
      categoryCaps: basePreview.categoryCaps,
    },
    isActive: true,
    triggerPolicyIds: ["trg_wallet_opened", "trg_user_entered_zone", "trg_declared_context_changed"],
  };
  await input.repository.saveCommerceZone(zone);

  const existingMerchants = await input.repository.listMerchants({ zoneId: zone.id });
  const existingRuns = await input.repository.listMerchantImportRuns(zone.id);
  const pausedRun = existingRuns.find((run) => run.status === "paused");
  const settingsAnalysis = analyzeImportSettings({
    preview: basePreview,
    existingZone: existingZoneForRequest,
    existingMerchants,
    pausedRun,
    forceRefresh,
  });
  const reuseWarning = `Reused ${existingMerchants.length} stored merchant(s) for ${zone.name}. Enable force refresh to start a new import run; fresh provider response caches may still be reused for cost control.`;
  const resumeWarning = pausedRun
    ? `Existing paused import ${pausedRun.id} will be resumed instead of starting over. Enable force refresh to start a new import run; fresh provider response caches may still be reused for cost control.`
    : null;
  const cacheReuseAvailable = !forceRefresh && (existingMerchants.length > 0 || Boolean(pausedRun));
  const preview = {
    ...basePreview,
    existingStoredMerchantCount: existingMerchants.length,
    cacheReuseAvailable,
    plannedImportAction: settingsAnalysis.action,
    settingsChangeSummary: settingsAnalysis.summary,
    warnings: [
      ...basePreview.warnings,
      ...settingsAnalysis.warnings,
      ...(!forceRefresh && settingsAnalysis.action === "resume_paused_import" && pausedRun && resumeWarning ? [resumeWarning] : []),
      ...(!forceRefresh && ["reuse_stored_merchants", "settings_decreased_no_delete"].includes(settingsAnalysis.action) && existingMerchants.length > 0 ? [reuseWarning] : []),
    ],
  };

  if (input.request.previewOnly) {
    return { zone, preview, importRun: null, importedMerchants: [], warnings: preview.warnings };
  }

  if (!forceRefresh && pausedRun && settingsAnalysis.action === "resume_paused_import") {
    const continuedRun = await continueMerchantImportRun({ repository: input.repository, runId: pausedRun.id });
    return {
      zone,
      preview,
      importRun: continuedRun.importRun,
      importedMerchants: continuedRun.importedMerchants,
      warnings: [
        ...preview.warnings,
        ...continuedRun.importRun.warnings,
      ],
    };
  }

  if (!forceRefresh && existingMerchants.length > 0 && settingsAnalysis.action !== "incremental_import") {
    const now = nowIso();
    const cachedRun: MerchantImportRun = {
      id: makeId("merchant_import"),
      zoneId: zone.id,
      status: "completed",
      requestedRadiusMeters: input.request.radiusMeters ?? resolved.requestedRadiusMeters,
      radiusMeters: preview.radiusMeters,
      categories: preview.selectedCategories,
      categoryCaps: preview.categoryCaps,
      maxImportedMerchants: preview.maxImportedMerchants,
      maxTilesPerRun: preview.maxTilesPerRun,
      importedCount: existingMerchants.length,
      failedCount: 0,
      continuationCursor: null,
      warnings: preview.warnings,
      errorJson: null,
      providerStatsJson: {
        provider: getCityImportPoiProvider(),
        importerVersion: IMPORTER_VERSION,
        stopReason: "city_merchant_cache_reused",
        plannedImportAction: settingsAnalysis.action,
        settingsChangeSummary: settingsAnalysis.summary,
        cacheReuse: true,
        existingStoredMerchantCount: existingMerchants.length,
        googlePlacesRequests: 0,
        tileQueries: 0,
        categoryQueries: 0,
        remainingJobs: 0,
      },
      startedAt: now,
      completedAt: now,
      updatedAt: now,
    };
    await input.repository.saveMerchantImportRun(cachedRun);
    return {
      zone,
      preview,
      importRun: cachedRun,
      importedMerchants: existingMerchants.map((merchant) => merchant.id),
      warnings: preview.warnings,
    };
  }

  const now = nowIso();
  const run: MerchantImportRun = {
    id: makeId("merchant_import"),
    zoneId: zone.id,
    status: "pending",
    requestedRadiusMeters: input.request.radiusMeters ?? resolved.requestedRadiusMeters,
    radiusMeters: preview.radiusMeters,
    categories: preview.selectedCategories,
    categoryCaps: preview.categoryCaps,
    maxImportedMerchants: preview.maxImportedMerchants,
    maxTilesPerRun: preview.maxTilesPerRun,
    importedCount: settingsAnalysis.startingImportedCount,
    failedCount: 0,
    continuationCursor: "0",
    warnings: preview.warnings,
    errorJson: null,
    providerStatsJson: {
      provider: getCityImportPoiProvider(),
      importerVersion: IMPORTER_VERSION,
      plannedImportAction: settingsAnalysis.action,
      settingsChangeSummary: settingsAnalysis.summary,
      existingStoredMerchantCount: existingMerchants.length,
      tileQueries: 0,
      categoryQueries: 0,
    },
    startedAt: now,
    completedAt: null,
    updatedAt: now,
  };
  await input.repository.saveMerchantImportRun(run);
  const completedRun = await continueMerchantImportRun({ repository: input.repository, runId: run.id });
  return {
    zone,
    preview,
    importRun: completedRun.importRun,
    importedMerchants: completedRun.importedMerchants,
    warnings: [...preview.warnings, ...completedRun.importRun.warnings],
  };
}

type ImportPreviewShape = ReturnType<typeof buildImportPreview>;

function analyzeImportSettings(input: {
  preview: ImportPreviewShape;
  existingZone: CommerceZone | null;
  existingMerchants: Merchant[];
  pausedRun?: MerchantImportRun | null;
  forceRefresh: boolean;
}) {
  if (input.forceRefresh || input.existingMerchants.length === 0) {
    return {
      action: "new_import" as const,
      summary: input.forceRefresh ? ["Force fresh provider search requested; stored merchants are still skipped by dedupe."] : [],
      warnings: [] as string[],
      startingImportedCount: 0,
    };
  }

  const previous = importSettingsFromZone(input.existingZone);
  const previousCategories = new Set(previous.categories ?? []);
  const requestedCategories = new Set<string>(input.preview.selectedCategories);
  const summary: string[] = [];
  const warnings: string[] = [];
  let increased = false;
  let decreased = false;

  if (input.existingMerchants.length < input.preview.maxImportedMerchants) {
    increased = true;
    summary.push(`Stored merchants ${input.existingMerchants.length} are below requested target ${input.preview.maxImportedMerchants}; importing only missing supply.`);
  }
  if (previous.maxImportedMerchants !== undefined) {
    if (input.preview.maxImportedMerchants > previous.maxImportedMerchants) {
      increased = true;
      summary.push(`Max merchants increased from ${previous.maxImportedMerchants} to ${input.preview.maxImportedMerchants}.`);
    } else if (input.preview.maxImportedMerchants < previous.maxImportedMerchants) {
      decreased = true;
      summary.push(`Max merchants decreased from ${previous.maxImportedMerchants} to ${input.preview.maxImportedMerchants}; existing merchants will not be deleted.`);
    }
  }
  if (previous.radiusMeters !== undefined) {
    if (input.preview.radiusMeters > previous.radiusMeters) {
      increased = true;
      summary.push(`Import radius increased from ${previous.radiusMeters}m to ${input.preview.radiusMeters}m.`);
    } else if (input.preview.radiusMeters < previous.radiusMeters) {
      decreased = true;
      summary.push(`Import radius decreased from ${previous.radiusMeters}m to ${input.preview.radiusMeters}m; existing merchants outside the new radius remain stored.`);
    }
  }

  for (const category of input.preview.selectedCategories) {
    if (previousCategories.size > 0 && !previousCategories.has(category)) {
      increased = true;
      summary.push(`Category added: ${category}.`);
    }
    const previousCap = previous.categoryCaps?.[category];
    const nextCap = input.preview.categoryCaps[category];
    if (previousCap !== undefined && nextCap !== undefined) {
      if (nextCap > previousCap) {
        increased = true;
        summary.push(`${category} cap increased from ${previousCap} to ${nextCap}.`);
      } else if (nextCap < previousCap) {
        decreased = true;
        summary.push(`${category} cap decreased from ${previousCap} to ${nextCap}; existing merchants are retained.`);
      }
    }
  }
  if (previousCategories.size > 0) {
    for (const category of previousCategories) {
      if (!requestedCategories.has(category)) {
        decreased = true;
        summary.push(`Category removed from future imports: ${category}; existing merchants are retained.`);
      }
    }
  }

  if (increased) {
    return {
      action: "incremental_import" as const,
      summary,
      warnings,
      startingImportedCount: Math.min(input.existingMerchants.length, input.preview.maxImportedMerchants),
    };
  }
  if (input.pausedRun) {
    return {
      action: "resume_paused_import" as const,
      summary: summary.length ? summary : ["A paused import exists and will be resumed."],
      warnings,
      startingImportedCount: input.existingMerchants.length,
    };
  }
  if (decreased) {
    warnings.push("Requested import settings are lower than a previous run. Existing merchants are kept in the DB; future imports use the lower settings.");
    return {
      action: "settings_decreased_no_delete" as const,
      summary,
      warnings,
      startingImportedCount: input.existingMerchants.length,
    };
  }
  return {
    action: "reuse_stored_merchants" as const,
    summary: summary.length ? summary : ["Stored merchants already satisfy the requested import settings; provider search will be skipped."],
    warnings,
    startingImportedCount: input.existingMerchants.length,
  };
}

function importSettingsFromZone(zone: CommerceZone | null) {
  const settings = zone?.importSettings as {
    radiusMeters?: unknown;
    maxImportedMerchants?: unknown;
    maxTilesPerRun?: unknown;
    categories?: unknown;
    categoryCaps?: unknown;
  } | undefined;
  const categoryCaps = settings?.categoryCaps && typeof settings.categoryCaps === "object"
    ? Object.fromEntries(Object.entries(settings.categoryCaps as Record<string, unknown>)
        .filter((entry): entry is [string, number] => typeof entry[1] === "number"))
    : undefined;
  return {
    radiusMeters: typeof settings?.radiusMeters === "number" ? settings.radiusMeters : undefined,
    maxImportedMerchants: typeof settings?.maxImportedMerchants === "number" ? settings.maxImportedMerchants : undefined,
    maxTilesPerRun: typeof settings?.maxTilesPerRun === "number" ? settings.maxTilesPerRun : undefined,
    categories: Array.isArray(settings?.categories) ? settings.categories.filter((item): item is string => typeof item === "string") : undefined,
    categoryCaps,
  };
}

export async function suggestCommerceCities(input: {
  repository: CityWalletRepository;
  query: string;
  country?: string;
}): Promise<CitySuggestion[]> {
  const query = input.query.trim();
  if (query.length < 2) return [];
  const country = input.country?.trim() || "";
  const cacheKey = `city:${query.toLowerCase()}:${country.toLowerCase()}`;
  const cached = await input.repository.getPoiCache("nominatim_city_suggestions", cacheKey);
  if (cached) return cached.result as CitySuggestion[];

  try {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", [query, countryNames[country.toUpperCase()] ?? country].filter(Boolean).join(", "));
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "8");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("accept-language", "en");
    if (country) url.searchParams.set("countrycodes", country.toLowerCase());
    const response = await withTimeout(fetch(url, {
      headers: {
        "user-agent": process.env.NOMINATIM_USER_AGENT || "CityWalletHackathonMVP/0.1 local-dev",
        "accept": "application/json",
      },
    }), 3_000, "Nominatim city suggestions");
    if (!response.ok) throw new Error(`Nominatim ${response.status}`);
    const rows = await response.json() as Array<{
      lat?: string;
      lon?: string;
      name?: string;
      display_name?: string;
      category?: string;
      type?: string;
      addresstype?: string;
      importance?: number;
      boundingbox?: [string, string, string, string];
      address?: Record<string, string>;
    }>;
    const suggestions = dedupeCitySuggestions(rows
      .filter(isCitySuggestionRow)
      .map((row): CitySuggestion | null => {
        if (!row.lat || !row.lon) return null;
        const city = row.address?.city ?? row.address?.town ?? row.address?.municipality ?? row.address?.village ?? row.name ?? query;
        const suggestionCountry = (row.address?.country_code ?? country).toUpperCase();
        if (!city) return null;
        return {
          label: row.display_name ?? `${city}, ${suggestionCountry}`,
          city,
          country: suggestionCountry,
          centerLat: Number(row.lat),
          centerLng: Number(row.lon),
          boundingBox: row.boundingbox ? {
            south: Number(row.boundingbox[0]),
            north: Number(row.boundingbox[1]),
            west: Number(row.boundingbox[2]),
            east: Number(row.boundingbox[3]),
          } : undefined,
          provider: "nominatim",
          confidence: Math.min(0.95, Math.max(0.4, row.importance ?? 0.6)),
        };
      })
      .filter((item): item is CitySuggestion => Boolean(item))
      .filter((item) => !country || item.country === country.toUpperCase())
      .slice(0, 6));
    await input.repository.setPoiCache({
      provider: "nominatim_city_suggestions",
      cacheKey,
      result: suggestions,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
    return suggestions;
  } catch {
    return [];
  }
}

function isCitySuggestionRow(row: { category?: string; type?: string; addresstype?: string }) {
  const addressTypes = new Set(["city", "town", "municipality", "village"]);
  if (row.addresstype && addressTypes.has(row.addresstype)) return true;
  if (row.category === "boundary" && row.type === "administrative") return true;
  if (row.category === "place" && row.type && addressTypes.has(row.type)) return true;
  return false;
}

export async function continueMerchantImportRun(input: {
  repository: CityWalletRepository;
  runId: string;
}): Promise<{ importRun: MerchantImportRun; importedMerchants: string[] }> {
  const run = await input.repository.getMerchantImportRun(input.runId);
  if (!run) throw new Error(`Unknown merchant import run ${input.runId}`);
  const zone = await input.repository.getZoneById(run.zoneId);
  if (!zone) throw new Error(`Unknown commerce zone ${run.zoneId}`);

  const poiCache: PoiCache = {
    get: (provider, cacheKey) => input.repository.getPoiCache(provider, cacheKey),
    set: (provider, cacheKey, result, expiresAt) => input.repository.setPoiCache({ provider, cacheKey, result, expiresAt }),
  };

  const started = await input.repository.updateMerchantImportRun(run.id, { status: "running", updatedAt: nowIso() }) ?? run;
  const tiles = buildImportTiles(zone, run.radiusMeters);
  const jobs = buildImportJobs(tiles, run.categories);
  const currentProvider = getCityImportPoiProvider();
  const previousErrors = Array.isArray(started.errorJson?.errors) ? [...started.errorJson.errors as Array<Record<string, unknown>>] : [];
  const retryProviderHeaderFailures = shouldRetryImportFromStart(started, previousErrors);
  const previousStats = started.providerStatsJson ?? {};
  const oldImporterVersion = previousStats.importerVersion !== IMPORTER_VERSION;
  const providerChanged = Boolean(previousStats.provider && previousStats.provider !== currentProvider);
  const restartFromStart = retryProviderHeaderFailures || oldImporterVersion || providerChanged;
  const startIndex = restartFromStart ? 0 : Number(started.continuationCursor ?? "0") || 0;
  const existingMerchants = await input.repository.listMerchantsByZone(zone.id);
  const seenKeys = new Set(existingMerchants.flatMap(merchantDedupeKeys));
  const categoryCounts = countByCategory(existingMerchants);
  const importedMerchants: string[] = [];
  const errors: Array<Record<string, unknown>> = retryProviderHeaderFailures ? [] : previousErrors;
  let failedCount = retryProviderHeaderFailures ? 0 : started.failedCount;
  let importedCount = retryProviderHeaderFailures ? 0 : started.importedCount;
  let checkpointProcessed = 0;
  let consecutiveErrors = 0;
  let index = startIndex;
  let stopReason: ImportStopReason | null = null;
  const runtimeStartedAt = Date.now();
  const runtimeBudgetMs = getCityImportRuntimeBudgetMs();
  const providerStats: Record<string, unknown> = {
    ...previousStats,
    provider: currentProvider,
    importerVersion: IMPORTER_VERSION,
    checkpointChunkSize: run.maxTilesPerRun,
    runtimeBudgetMs,
    restartedForImporterVersion: oldImporterVersion || undefined,
    restartedForProviderChange: providerChanged || undefined,
    retriedAfterProviderHeaderFix: retryProviderHeaderFailures || undefined,
  };

  const persistCheckpoint = async (cursor: number, status: MerchantImportRun["status"] = "running") => {
    await input.repository.updateMerchantImportRun(run.id, {
      status,
      importedCount,
      failedCount,
      continuationCursor: cursor < jobs.length ? String(cursor) : null,
      errorJson: errors.length > 0 ? { errors } : null,
      providerStatsJson: {
        ...providerStats,
        totalTiles: tiles.length,
        totalJobs: jobs.length,
        processedJobs: Math.min(cursor, jobs.length),
        remainingJobs: Math.max(0, jobs.length - Math.min(cursor, jobs.length)),
        maxTilesPerRun: run.maxTilesPerRun,
      },
    });
  };

  for (; index < jobs.length; index += 1) {
    if (importedCount >= run.maxImportedMerchants) {
      stopReason = "target_reached";
      break;
    }
    if (Date.now() - runtimeStartedAt >= runtimeBudgetMs) {
      stopReason = "runtime_budget_reached";
      break;
    }
    const job = jobs[index];
    providerStats.tileQueries = Number(providerStats.tileQueries ?? 0) + 1;
    providerStats.categoryQueries = Number(providerStats.categoryQueries ?? 0) + 1;
    const result = await queryImportTile({
      zone,
      tile: job.tile,
      category: job.category,
      limit: discoveryConfig.perTileCategoryResultLimit,
      cache: poiCache,
      googlePlacesRequestsRemaining: Math.max(0, getGooglePlacesMaxRequestsPerImport() - Number(providerStats.googlePlacesRequests ?? 0)),
    });
    providerStats.cacheHits = Number(providerStats.cacheHits ?? 0) + (result.cacheHit ? 1 : 0);
    providerStats.googlePlacesRequests = Number(providerStats.googlePlacesRequests ?? 0) + (result.googlePlacesRequestMade ? 1 : 0);
    providerStats.fallbackQueries = Number(providerStats.fallbackQueries ?? 0) + (result.fallbackUsed ? 1 : 0);
    providerStats.googlePlacesRequestCapReached = Boolean(providerStats.googlePlacesRequestCapReached) || Boolean(result.googlePlacesRequestCapReached);
    checkpointProcessed += 1;
    if (result.error) {
      failedCount += 1;
      consecutiveErrors += 1;
      errors.push({ tileIndex: job.tileIndex, category: job.category, error: result.error });
      if (result.googlePlacesRequestCapReached) {
        stopReason = "google_request_cap_reached";
        break;
      }
      if (consecutiveErrors >= Math.max(PROVIDER_ERROR_STOP_THRESHOLD, run.categories.length * 2)) {
        stopReason = "provider_errors";
        break;
      }
      if (checkpointProcessed >= run.maxTilesPerRun) {
        await persistCheckpoint(index + 1);
        checkpointProcessed = 0;
      }
      continue;
    }
    consecutiveErrors = 0;

    for (const business of result.businesses) {
      if (importedCount >= run.maxImportedMerchants) break;
      if ((categoryCounts[business.category as SupportedMerchantCategory] ?? 0) >= (run.categoryCaps[business.category] ?? 0)) continue;
      if (business.latitude === undefined || business.longitude === undefined) continue;
      if (!isPointInsideZone(business.latitude, business.longitude, zone)) continue;
      const keys = businessDedupeKeys(business);
      if (keys.some((key) => seenKeys.has(key))) continue;
      const baseMerchant = discoveredBusinessToMerchant({
        business,
        context: contextFromZone(zone, business),
        coordinates: { latitude: business.latitude, longitude: business.longitude },
      });
      const merchant = enrichImportedMerchantWithSyntheticData(baseMerchant);
      const saved = await input.repository.saveMerchant(merchant);
      await input.repository.savePaymentDensitySignal(generateSyntheticPaymentDensity(saved));
      for (const key of keys) seenKeys.add(key);
      importedCount += 1;
      categoryCounts[saved.category as SupportedMerchantCategory] = (categoryCounts[saved.category as SupportedMerchantCategory] ?? 0) + 1;
      importedMerchants.push(saved.id);
    }
    if (importedCount >= run.maxImportedMerchants) {
      stopReason = "target_reached";
      index += 1;
      break;
    }
    if (checkpointProcessed >= run.maxTilesPerRun) {
      await persistCheckpoint(index + 1);
      checkpointProcessed = 0;
    }
  }

  if (importedMerchants.length > 0) {
    await refreshMerchantInsights(input.repository, importedMerchants);
  }

  if (!stopReason) {
    stopReason = importedCount >= run.maxImportedMerchants ? "target_reached" : "all_jobs_exhausted";
  }
  const hasRemaining = index < jobs.length && importedCount < run.maxImportedMerchants;
  const status: MerchantImportRun["status"] = stopReason === "target_reached"
    ? "completed"
    : stopReason === "all_jobs_exhausted"
      ? failedCount > 0 ? "partial_failed" : "completed"
      : stopReason === "provider_errors"
        ? importedCount > 0 ? "partial_failed" : "failed"
        : "paused";
  const completedAt = status === "paused" ? null : nowIso();
  const nextRun = await input.repository.updateMerchantImportRun(run.id, {
    status,
    importedCount,
    failedCount,
    continuationCursor: hasRemaining ? String(index) : null,
    errorJson: errors.length > 0 ? { errors } : null,
    providerStatsJson: {
      ...providerStats,
      stopReason,
      runtimeBudgetReached: stopReason === "runtime_budget_reached",
      totalTiles: tiles.length,
      totalJobs: jobs.length,
      processedJobs: Math.min(index, jobs.length),
      remainingJobs: Math.max(0, jobs.length - Math.min(index, jobs.length)),
      maxTilesPerRun: run.maxTilesPerRun,
    },
    completedAt,
  });
  return { importRun: nextRun ?? run, importedMerchants };
}

export function buildImportPreview(request: ActivateCommerceZoneRequest, additionalWarnings: string[] = []) {
  const warnings = [...additionalWarnings];
  const provider = getCityImportPoiProvider();
  const requestedRadius = request.radiusMeters ?? getDefaultCityImportRadiusMeters();
  const radiusMeters = Math.min(requestedRadius, discoveryConfig.absoluteMaxRadiusMeters);
  if (requestedRadius > radiusMeters) warnings.push(`Radius clamped to ${radiusMeters}m hard cap.`);
  const requestedMax = request.maxImportedMerchants ?? discoveryConfig.defaultMaxImportedMerchants;
  const providerMaxImportedMerchants = provider === "google_places"
    ? Math.min(discoveryConfig.absoluteMaxImportedMerchants, getGooglePlacesMaxImportedMerchants())
    : discoveryConfig.absoluteMaxImportedMerchants;
  const maxImportedMerchants = Math.min(requestedMax, providerMaxImportedMerchants);
  if (requestedMax > maxImportedMerchants) warnings.push(`Max imported merchants clamped to ${maxImportedMerchants}.`);
  const requestedTiles = request.maxTilesPerRun ?? discoveryConfig.defaultMaxTilesPerRun;
  const maxTilesPerRun = Math.min(requestedTiles, discoveryConfig.absoluteMaxTilesPerRun);
  if (requestedTiles > maxTilesPerRun) warnings.push(`Import checkpoint chunk size clamped to ${maxTilesPerRun}.`);
  const selectedCategories = request.categories?.length ? request.categories : [...discoveryConfig.defaultCategories];
  const estimatedTiles = estimateTileCount(radiusMeters);
  const maxProviderRequests = provider === "google_places" ? getGooglePlacesMaxRequestsPerImport() : undefined;
  const estimatedRequestCount = Math.min(estimatedTiles * selectedCategories.length, maxProviderRequests ?? estimatedTiles * selectedCategories.length);
  const categoryCaps: Record<string, number> = Object.fromEntries(selectedCategories.map((category) => [
    category,
    Math.min(request.categoryCaps?.[category] ?? discoveryConfig.defaultCategoryCaps[category], maxImportedMerchants),
  ]));
  if (selectedCategories.length > 0) {
    const sumCaps = selectedCategories.reduce((sum, category) => sum + (categoryCaps[category] ?? 0), 0);
    if (sumCaps < maxImportedMerchants) {
      const headroom = maxImportedMerchants - sumCaps;
      const bonus = Math.ceil(headroom / selectedCategories.length);
      for (const category of selectedCategories) {
        categoryCaps[category] = Math.min((categoryCaps[category] ?? 0) + bonus, maxImportedMerchants);
      }
      warnings.push(
        `Total target ${maxImportedMerchants} exceeds the sum of category caps ${sumCaps}; distributing ~${bonus} extra slot(s) per category so the total wins.`,
      );
    }
  }
  return {
    provider,
    radiusMeters,
    estimatedTiles,
    estimatedRequestCount,
    selectedCategories,
    categoryCaps,
    maxImportedMerchants,
    maxTilesPerRun,
    maxProviderRequests,
    fieldMask: provider === "google_places" ? googlePlacesImportFieldMask : undefined,
    placeDetailsDisabled: true,
    providerWarnings: getCityImportProviderWarnings(),
    warnings,
    existingStoredMerchantCount: 0,
    cacheReuseAvailable: false,
    plannedImportAction: "new_import" as const,
    settingsChangeSummary: [],
    liveWalletDiscoveryFallbackEnabled: isWalletLiveDiscoveryFallbackEnabled(),
  };
}

export function enrichImportedMerchantWithSyntheticData(merchant: Merchant): Merchant {
  const products = generateProducts(merchant);
  const goals = generateGoals(merchant);
  const rule = generateRules(merchant, products);
  return {
    ...merchant,
    participationStatus: "partner",
    products,
    goals,
    rule,
    syntheticFields: ["products", "goals", "rules", "transactions", "redemption"],
  };
}

type ImportTile = {
  id: string;
  north: number;
  south: number;
  east: number;
  west: number;
};

type ImportTileQueryResult = {
  businesses: PoiBusiness[];
  error?: string;
  provider: "google_places" | "overpass";
  cacheHit?: boolean;
  googlePlacesRequestMade?: boolean;
  googlePlacesRequestCapReached?: boolean;
  fallbackUsed?: boolean;
  primaryError?: string;
};

const googlePlaceTypes: Record<SupportedMerchantCategory, string[]> = {
  cafe: ["cafe", "coffee_shop"],
  bakery: ["bakery"],
  restaurant: ["restaurant"],
  bookshop: ["book_store"],
  flower_shop: ["florist"],
  museum: ["museum"],
  gallery: ["art_gallery"],
  gift_shop: ["gift_shop"],
  local_retail: ["store"],
  stationery: ["store"],
  clothing: ["clothing_store"],
  grocery: ["grocery_store", "supermarket", "convenience_store", "food_store"],
};

async function findExistingActivationZone(
  repository: CityWalletRepository,
  request: ActivateCommerceZoneRequest,
) {
  if (request.zoneId) return repository.getZoneById(request.zoneId);
  if (!request.city) return null;
  const city = request.city.trim();
  if (!city) return null;
  const zoneName = request.name?.trim() || `${city} City Wallet zone`;
  return repository.getZoneById(`zone_${slugify(`${city}_${zoneName}`)}`);
}

function resolvedDraftFromExistingZone(zone: CommerceZone, request: ActivateCommerceZoneRequest) {
  const importSettings = zone.importSettings as { radiusMeters?: unknown } | undefined;
  const storedRadius = typeof importSettings?.radiusMeters === "number" ? importSettings.radiusMeters : zone.radiusMeters;
  const radiusMeters = request.radiusMeters ?? storedRadius;
  return {
    name: zone.name,
    city: zone.city,
    country: zone.country,
    centerLat: zone.centerLat,
    centerLng: zone.centerLng,
    requestedRadiusMeters: radiusMeters,
    radiusMeters,
    polygonGeoJson: zone.polygonGeoJson ?? null,
    warnings: [`Existing activated city zone ${zone.name} was found in the DB; using stored zone geometry.`],
  };
}

async function resolveZoneDraft(
  request: ActivateCommerceZoneRequest,
  cache: GeocodingCache,
  geocoding: ReturnType<typeof createDefaultProviders>["geocoding"],
) {
  const warnings: string[] = [];
  if (request.mode === "polygon") {
    if (!request.polygonGeoJson) throw new Error("polygonGeoJson is required for polygon activation.");
    const box = boundingBoxFromPolygon(request.polygonGeoJson);
    const centerLat = (box.north + box.south) / 2;
    const centerLng = (box.east + box.west) / 2;
    const derivedRadius = Math.max(
      calculateDistanceMeters(centerLat, centerLng, box.north, box.east),
      calculateDistanceMeters(centerLat, centerLng, box.south, box.west),
    );
    return {
      name: request.name ?? `${request.city ?? "Activated polygon"} City Wallet zone`,
      city: request.city ?? request.name ?? "Activated polygon",
      country: request.country,
      centerLat,
      centerLng,
      requestedRadiusMeters: derivedRadius,
      radiusMeters: request.radiusMeters ?? derivedRadius,
      polygonGeoJson: request.polygonGeoJson,
      warnings,
    };
  }

  if (request.mode === "coordinate_box") {
    const box = request.coordinateBox;
    if (!box) throw new Error("coordinateBox is required for coordinate_box activation.");
    const centerLat = (box.north + box.south) / 2;
    const centerLng = (box.east + box.west) / 2;
    const derivedRadius = Math.max(
      calculateDistanceMeters(centerLat, centerLng, box.north, box.east),
      calculateDistanceMeters(centerLat, centerLng, box.south, box.west),
    );
    return {
      name: request.name ?? `${request.city ?? "Activated area"} City Wallet zone`,
      city: request.city ?? request.name ?? "Activated area",
      country: request.country,
      centerLat,
      centerLng,
      requestedRadiusMeters: derivedRadius,
      radiusMeters: request.radiusMeters ?? derivedRadius,
      polygonGeoJson: rectanglePolygonGeoJson(box),
      warnings,
    };
  }

  if (request.mode === "center_radius") {
    if (request.centerLat === undefined || request.centerLng === undefined) {
      throw new Error("centerLat and centerLng are required for center_radius activation.");
    }
    return {
      name: request.name ?? `${request.city ?? "Activated city"} City Wallet zone`,
      city: request.city ?? request.name ?? "Activated city",
      country: request.country,
      centerLat: request.centerLat,
      centerLng: request.centerLng,
      requestedRadiusMeters: request.radiusMeters ?? getDefaultCityImportRadiusMeters(),
      radiusMeters: request.radiusMeters ?? getDefaultCityImportRadiusMeters(),
      polygonGeoJson: null,
      warnings,
    };
  }

  if (!request.city) throw new Error("city is required for city activation.");
  if (request.centerLat !== undefined && request.centerLng !== undefined) {
    return {
      name: request.name ?? `${request.city} City Wallet zone`,
      city: request.city,
      country: request.country,
      centerLat: request.centerLat,
      centerLng: request.centerLng,
      requestedRadiusMeters: request.radiusMeters ?? getDefaultCityImportRadiusMeters(),
      radiusMeters: request.radiusMeters ?? getDefaultCityImportRadiusMeters(),
      polygonGeoJson: null,
      warnings,
    };
  }
  const budget = defaultProviderBudget();
  const queries = cityGeocodeQueries(request.city, request.country);
  let point = null;
  for (const query of queries) {
    point = await geocoding.geocode(query, { budget, cache });
    if (point) break;
  }
  warnings.push(...budget.fallbackEvents.map((event) => `${event.provider}: ${event.reason}`));
  if (!point) throw new Error(`Could not geocode city "${request.city}, ${request.country}". Try center coordinates or a coordinate box.`);
  return {
    name: request.name ?? `${request.city} City Wallet zone`,
    city: request.city,
    country: request.country,
    centerLat: point.latitude,
    centerLng: point.longitude,
    requestedRadiusMeters: request.radiusMeters ?? getDefaultCityImportRadiusMeters(),
    radiusMeters: request.radiusMeters ?? getDefaultCityImportRadiusMeters(),
    polygonGeoJson: null,
    warnings,
  };
}

function cityGeocodeQueries(city: string, country: string) {
  const countryName = countryNames[country.toUpperCase()];
  return [
    `${city}, ${country}`,
    countryName ? `${city}, ${countryName}` : "",
    `${city} ${country}`,
  ].filter((query, index, queries): query is string => Boolean(query) && queries.indexOf(query) === index);
}

const countryNames: Record<string, string> = {
  DE: "Germany",
  AT: "Austria",
  CH: "Switzerland",
  FR: "France",
  IT: "Italy",
  ES: "Spain",
  NL: "Netherlands",
  BE: "Belgium",
  GB: "United Kingdom",
  UK: "United Kingdom",
  US: "United States",
};

function dedupeCitySuggestions(suggestions: CitySuggestion[]) {
  const seen = new Set<string>();
  return suggestions.filter((suggestion) => {
    const key = `${suggestion.city.toLowerCase()}:${suggestion.country}:${roundCoordinate(suggestion.centerLat, 3)}:${roundCoordinate(suggestion.centerLng, 3)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function shouldRetryImportFromStart(run: MerchantImportRun, errors: Array<Record<string, unknown>>) {
  return run.importedCount === 0 &&
    run.failedCount > 0 &&
    errors.length > 0 &&
    errors.every((error) => typeof error.error === "string" && error.error.includes("Overpass 406"));
}

function buildDefaultMerchantRule(merchant: Merchant): MerchantRule {
  return {
    merchantId: merchant.id,
    maxDiscountPercent: 10,
    dailyBudgetEuro: 50,
    dailyBudgetRemainingEuro: 50,
    eligibleProducts: merchant.products.map((product) => product.name),
    allowsBundles: true,
    preferredBundleCategories: ["cafe", "bookshop", "bakery"],
    offerTypesAllowed: ["cashback", "bundle_unlock"],
    brandTone: "local",
    freeformRulesStatus: "empty",
  };
}

async function compileFreeformRuleText(
  merchant: Merchant,
  baseRule: MerchantRule,
  text: string,
): Promise<CompiledFreeformRule | null> {
  if (isAzureRuleCompilerConfigured()) {
    try {
      return await compileWithAzureOpenAI(merchant, baseRule, text);
    } catch {
      return compileWithMockRules(merchant, text);
    }
  }
  return compileWithMockRules(merchant, text);
}

function isAzureRuleCompilerConfigured() {
  return Boolean(
    process.env.AZURE_OPENAI_API_KEY &&
      process.env.AZURE_OPENAI_ENDPOINT &&
      process.env.AZURE_OPENAI_DEPLOYMENT &&
      process.env.AZURE_OPENAI_API_VERSION,
  );
}

async function compileWithAzureOpenAI(
  merchant: Merchant,
  baseRule: MerchantRule,
  text: string,
): Promise<CompiledFreeformRule | null> {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION;
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  if (!endpoint || !deployment || !apiVersion || !apiKey) return null;

  const url = `${endpoint.replace(/\/$/, "")}/openai/deployments/${deployment}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;
  const compileBody: Record<string, unknown> = {
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          "Compile merchant free-form rules into supported City Wallet merchant rule patches.",
          "Return strict JSON with keys summary, staticRulePatch, unsupportedRules.",
          "staticRulePatch may only include maxDiscountPercent, dailyBudgetEuro, dailyBudgetRemainingEuro, eligibleProducts, allowsBundles, preferredBundleCategories, offerTypesAllowed, brandTone.",
          "Do not invent values that are not present or strongly implied. Put unsupported instructions in unsupportedRules.",
        ].join(" "),
      },
      {
        role: "user",
        content: JSON.stringify({
          merchant: {
            id: merchant.id,
            name: merchant.name,
            category: merchant.category,
            products: merchant.products.map((product) => product.name),
          },
          currentRule: baseRule,
          freeformRulesText: text,
        }),
      },
    ],
  };
  // Only forward `temperature` when explicitly opted in. Reasoning-class
  // Azure deployments (o1/o3/gpt-5) reject any non-default temperature.
  const tempRaw = process.env.AZURE_OPENAI_TEMPERATURE;
  if (tempRaw !== undefined && tempRaw !== "") {
    const parsed = Number(tempRaw);
    if (Number.isFinite(parsed)) compileBody.temperature = parsed;
  }
  const response = await withTimeout(fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify(compileBody),
  }), Number(process.env.AZURE_OPENAI_TIMEOUT_MS ?? 15_000), "Azure OpenAI rule compiler");
  if (!response.ok) throw new Error(`Azure OpenAI ${response.status}: ${await response.text()}`);
  const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = body.choices?.[0]?.message?.content;
  if (!content) return null;
  const parsed = JSON.parse(content) as { summary?: unknown; staticRulePatch?: unknown; unsupportedRules?: unknown };
  const patch = MerchantRuleStaticPatchSchema.parse(parsed.staticRulePatch ?? {});
  if (Object.keys(patch).length === 0) return null;
  return {
    summary: typeof parsed.summary === "string" ? parsed.summary : summarizePatch(patch),
    staticRulePatch: patch,
    unsupportedRules: Array.isArray(parsed.unsupportedRules) ? parsed.unsupportedRules.filter((item): item is string => typeof item === "string") : [],
    compiledAt: nowIso(),
    compiler: "azure_openai",
  };
}

function compileWithMockRules(merchant: Merchant, text: string): CompiledFreeformRule | null {
  const patch: MerchantRuleStaticPatch = {};
  const unsupportedRules: string[] = [];
  const lower = text.toLowerCase();

  const discount = firstNumber([
    /max(?:imum)?\s+(?:discount|cashback|incentive)[^\d]*(\d+(?:\.\d+)?)\s*%/i,
    /(?:discount|cashback|incentive)[^\d]*(?:under|below|up to|no more than|at most|<=|max(?:imum)?)[^\d]*(\d+(?:\.\d+)?)\s*%/i,
  ], text);
  if (discount !== null) patch.maxDiscountPercent = Math.max(0, Math.min(100, discount));

  const dailyBudget = firstNumber([
    /daily\s+budget[^\d]*(\d+(?:\.\d+)?)/i,
    /budget\s+per\s+day[^\d]*(\d+(?:\.\d+)?)/i,
  ], text);
  if (dailyBudget !== null) patch.dailyBudgetEuro = Math.max(0, dailyBudget);

  const remainingBudget = firstNumber([
    /remaining\s+budget[^\d]*(\d+(?:\.\d+)?)/i,
    /budget\s+remaining[^\d]*(\d+(?:\.\d+)?)/i,
  ], text);
  if (remainingBudget !== null) patch.dailyBudgetRemainingEuro = Math.max(0, remainingBudget);

  if (/(no|disable|do not|don't|never)\s+(?:cooperative\s+)?bundles?/.test(lower)) patch.allowsBundles = false;
  else if (/(allow|enable|opt in to|support)\s+(?:cooperative\s+)?bundles?/.test(lower)) patch.allowsBundles = true;

  const eligibleProducts = listAfterLabel(text, ["eligible products", "only products", "offer products"]);
  if (eligibleProducts.length > 0) {
    const knownProducts = new Set(merchant.products.map((product) => product.name.toLowerCase()));
    patch.eligibleProducts = eligibleProducts.filter((product) => knownProducts.size === 0 || knownProducts.has(product.toLowerCase()));
    const unknown = eligibleProducts.filter((product) => knownProducts.size > 0 && !knownProducts.has(product.toLowerCase()));
    if (unknown.length > 0) unsupportedRules.push(`Unknown products ignored: ${unknown.join(", ")}`);
  }

  const preferredCategories = listAfterLabel(text, ["preferred categories", "preferred bundle categories", "bundle with"]);
  if (preferredCategories.length > 0) patch.preferredBundleCategories = preferredCategories.map((item) => item.toLowerCase().replace(/\s+/g, "_"));

  if (/cashback\s+only/.test(lower)) patch.offerTypesAllowed = ["cashback"];
  else {
    const offerTypes: Array<"cashback" | "discount" | "priority_pickup" | "bundle_unlock"> = [];
    if (lower.includes("cashback")) offerTypes.push("cashback");
    if (lower.includes("discount")) offerTypes.push("discount");
    if (lower.includes("priority pickup") || lower.includes("priority_pickup")) offerTypes.push("priority_pickup");
    if (lower.includes("bundle unlock") || lower.includes("bundle_unlock")) offerTypes.push("bundle_unlock");
    if (offerTypes.length > 0) patch.offerTypesAllowed = Array.from(new Set(offerTypes));
  }

  const brandTone = text.match(/brand\s+tone[^\w]+([a-z0-9_\-\s]+?)(?:[.;\n]|$)/i)?.[1]?.trim();
  if (brandTone) patch.brandTone = brandTone.toLowerCase().replace(/\s+/g, "_");

  if (Object.keys(patch).length === 0) return null;
  return {
    summary: summarizePatch(patch),
    staticRulePatch: patch,
    unsupportedRules,
    compiledAt: nowIso(),
    compiler: "mock_llm",
  };
}

function applyCompiledRulePatch(
  baseRule: MerchantRule,
  compiled: CompiledFreeformRule,
  freeformRulesText: string,
): MerchantRule {
  const next = {
    ...baseRule,
    ...compiled.staticRulePatch,
    merchantId: baseRule.merchantId,
    freeformRulesText,
    compiledFreeformRules: compiled,
    freeformRulesStatus: "compiled" as const,
  };
  if (next.dailyBudgetRemainingEuro > next.dailyBudgetEuro) {
    next.dailyBudgetRemainingEuro = next.dailyBudgetEuro;
  }
  return next;
}

function firstNumber(patterns: RegExp[], text: string) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return Number(match[1]);
  }
  return null;
}

function listAfterLabel(text: string, labels: string[]) {
  for (const label of labels) {
    const match = text.match(new RegExp(`${label}\\s*[:=]\\s*([^.;\\n]+)`, "i"));
    if (match?.[1]) {
      return match[1].split(/,|\band\b/i).map((item) => item.trim()).filter(Boolean);
    }
  }
  return [];
}

function summarizePatch(patch: MerchantRuleStaticPatch) {
  const parts: string[] = [];
  if (patch.maxDiscountPercent !== undefined) parts.push(`max discount ${patch.maxDiscountPercent}%`);
  if (patch.dailyBudgetEuro !== undefined) parts.push(`daily budget €${patch.dailyBudgetEuro}`);
  if (patch.dailyBudgetRemainingEuro !== undefined) parts.push(`remaining budget €${patch.dailyBudgetRemainingEuro}`);
  if (patch.allowsBundles !== undefined) parts.push(patch.allowsBundles ? "bundles allowed" : "bundles disabled");
  if (patch.eligibleProducts?.length) parts.push(`eligible products: ${patch.eligibleProducts.join(", ")}`);
  if (patch.preferredBundleCategories?.length) parts.push(`preferred categories: ${patch.preferredBundleCategories.join(", ")}`);
  if (patch.offerTypesAllowed?.length) parts.push(`offer types: ${patch.offerTypesAllowed.join(", ")}`);
  if (patch.brandTone) parts.push(`brand tone ${patch.brandTone}`);
  return parts.join("; ");
}

function boundingBoxFromPolygon(polygonGeoJson: Record<string, unknown>): GeoBox {
  const coordinates = polygonCoordinates(polygonGeoJson);
  if (coordinates.length === 0) throw new Error("polygonGeoJson must contain Polygon coordinates.");
  const lngs = coordinates.map((point) => point[0]);
  const lats = coordinates.map((point) => point[1]);
  return {
    north: Math.max(...lats),
    south: Math.min(...lats),
    east: Math.max(...lngs),
    west: Math.min(...lngs),
  };
}

function polygonCoordinates(value: unknown): number[][] {
  if (!value || typeof value !== "object") return [];
  const candidate = value as { type?: string; coordinates?: unknown; geometry?: unknown };
  if (candidate.type === "Feature") return polygonCoordinates(candidate.geometry);
  if (candidate.type !== "Polygon" || !Array.isArray(candidate.coordinates)) return [];
  const ring = candidate.coordinates[0];
  return Array.isArray(ring) ? ring.filter((point): point is number[] => Array.isArray(point) && point.length >= 2) : [];
}

function estimateTileCount(radiusMeters: number) {
  if (radiusMeters <= discoveryConfig.largeAreaTileThresholdMeters) return 1;
  const diameter = radiusMeters * 2;
  return Math.max(1, Math.ceil(diameter / discoveryConfig.tileSizeMeters) ** 2);
}

function buildImportTiles(zone: CommerceZone, radiusMeters: number): ImportTile[] {
  if (radiusMeters <= discoveryConfig.largeAreaTileThresholdMeters) {
    const box = boxAroundPoint(zone.centerLat, zone.centerLng, radiusMeters);
    return [{ id: "tile_0", ...box }];
  }

  const box = boxAroundPoint(zone.centerLat, zone.centerLng, radiusMeters);
  const latStep = metersToLatitudeDegrees(discoveryConfig.tileSizeMeters);
  const lngStep = metersToLongitudeDegrees(discoveryConfig.tileSizeMeters, zone.centerLat);
  const tiles: ImportTile[] = [];
  let tileIndex = 0;
  for (let south = box.south; south < box.north; south += latStep) {
    for (let west = box.west; west < box.east; west += lngStep) {
      const north = Math.min(box.north, south + latStep);
      const east = Math.min(box.east, west + lngStep);
      const centerLat = (south + north) / 2;
      const centerLng = (west + east) / 2;
      if (!isPointInsideZone(centerLat, centerLng, zone) && calculateDistanceMeters(centerLat, centerLng, zone.centerLat, zone.centerLng) > radiusMeters + 2_000) {
        continue;
      }
      tiles.push({ id: `tile_${tileIndex}`, south, west, north, east });
      tileIndex += 1;
    }
  }
  const centerSortedTiles = tiles.sort((left, right) =>
    distanceFromZoneCenter(zone, left) - distanceFromZoneCenter(zone, right),
  );
  return centerSortedTiles.length > 0 ? centerSortedTiles : [{ id: "tile_0", ...box }];
}

function buildImportJobs(tiles: ImportTile[], categories: SupportedMerchantCategory[]) {
  return tiles.flatMap((tile, tileIndex) => categories.map((category) => ({ tile, tileIndex, category })));
}

export function buildImportJobsForTest(zone: CommerceZone, radiusMeters: number, categories: SupportedMerchantCategory[]) {
  return buildImportJobs(buildImportTiles(zone, radiusMeters), categories);
}

function distanceFromZoneCenter(zone: CommerceZone, tile: ImportTile) {
  const center = tileCenterPoint(tile);
  return calculateDistanceMeters(zone.centerLat, zone.centerLng, center.latitude, center.longitude);
}

function boxAroundPoint(latitude: number, longitude: number, radiusMeters: number): GeoBox {
  const latDelta = metersToLatitudeDegrees(radiusMeters);
  const lngDelta = metersToLongitudeDegrees(radiusMeters, latitude);
  return {
    north: latitude + latDelta,
    south: latitude - latDelta,
    east: longitude + lngDelta,
    west: longitude - lngDelta,
  };
}

function metersToLatitudeDegrees(meters: number) {
  return meters / 111_320;
}

function metersToLongitudeDegrees(meters: number, latitude: number) {
  return meters / (111_320 * Math.max(0.2, Math.cos((latitude * Math.PI) / 180)));
}

function tileCenterPoint(tile: ImportTile) {
  return {
    latitude: (tile.north + tile.south) / 2,
    longitude: (tile.east + tile.west) / 2,
  };
}

function tileRadiusMeters(tile: ImportTile) {
  const center = tileCenterPoint(tile);
  return Math.max(
    calculateDistanceMeters(center.latitude, center.longitude, tile.north, tile.east),
    calculateDistanceMeters(center.latitude, center.longitude, tile.south, tile.west),
  );
}

async function queryImportTile(input: {
  zone: CommerceZone;
  tile: ImportTile;
  category: SupportedMerchantCategory;
  limit: number;
  cache: PoiCache;
  googlePlacesRequestsRemaining: number;
}): Promise<ImportTileQueryResult> {
  if (getCityImportPoiProvider() === "google_places") {
    const googleResult = await queryGooglePlacesImportTile(input);
    if (!googleResult.error) return googleResult;
    if (isOverpassImportFallbackEnabled()) {
      const fallbackResult = await queryOverpassImportTile(input);
      return {
        ...fallbackResult,
        fallbackUsed: true,
        primaryError: googleResult.error,
        googlePlacesRequestMade: googleResult.googlePlacesRequestMade,
        googlePlacesRequestCapReached: googleResult.googlePlacesRequestCapReached,
      };
    }
    return googleResult;
  }
  return queryOverpassImportTile(input);
}

async function queryOverpassImportTile(input: {
  zone: CommerceZone;
  tile: ImportTile;
  category: SupportedMerchantCategory;
  limit: number;
  cache: PoiCache;
}): Promise<ImportTileQueryResult> {
  const cacheKey = [
    input.zone.id,
    input.category,
    roundCoordinate(input.tile.south, 4),
    roundCoordinate(input.tile.west, 4),
    roundCoordinate(input.tile.north, 4),
    roundCoordinate(input.tile.east, 4),
    Math.floor(Date.now() / (24 * 60 * 60 * 1000)),
  ].join(":");
  const cached = await input.cache.get("overpass_import", cacheKey);
  if (cached) return { businesses: cached.result as PoiBusiness[], provider: "overpass", cacheHit: true };

  try {
    const filters = discoveryConfig.osmTagQueries[input.category].flatMap((tag) => [
      `node["${tag.key}"="${tag.value}"](${input.tile.south},${input.tile.west},${input.tile.north},${input.tile.east});`,
      `way["${tag.key}"="${tag.value}"](${input.tile.south},${input.tile.west},${input.tile.north},${input.tile.east});`,
      `relation["${tag.key}"="${tag.value}"](${input.tile.south},${input.tile.west},${input.tile.north},${input.tile.east});`,
    ]).join("");
    const query = `[out:json][timeout:4];(${filters});out center ${input.limit};`;
    const response = await withTimeout(fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "accept": "application/json",
        "user-agent": process.env.OVERPASS_USER_AGENT || process.env.NOMINATIM_USER_AGENT || "CityWalletHackathonMVP/0.1 local-dev",
      },
      body: new URLSearchParams({ data: query }),
    }), discoveryConfig.overpassTimeoutMs, "Overpass import request");
    if (!response.ok) throw new Error(`Overpass ${response.status}`);
    const body = await response.json() as { elements?: Array<{ id: number; type?: string; lat?: number; lon?: number; center?: { lat?: number; lon?: number }; tags?: Record<string, string> }> };
    const businesses = (body.elements ?? []).slice(0, input.limit).map((element): PoiBusiness | null => {
      const name = element.tags?.name;
      const latitude = element.lat ?? element.center?.lat;
      const longitude = element.lon ?? element.center?.lon;
      if (!name || latitude === undefined || longitude === undefined) return null;
      return {
        externalId: `osm_${element.type ?? "node"}_${element.id}`,
        name,
        category: input.category,
        address: formatAddress(element.tags ?? {}),
        latitude,
        longitude,
        source: "osm_overpass",
        sourceUrl: osmSourceUrl(element.type ?? "node", element.id),
        confidence: 0.82,
      };
    }).filter((business): business is PoiBusiness => Boolean(business));
    await input.cache.set("overpass_import", cacheKey, businesses, new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString());
    return { businesses, provider: "overpass" };
  } catch (error) {
    return { businesses: [], provider: "overpass", error: error instanceof Error ? error.message : "overpass_import_failed" };
  }
}

async function queryGooglePlacesImportTile(input: {
  zone: CommerceZone;
  tile: ImportTile;
  category: SupportedMerchantCategory;
  limit: number;
  cache: PoiCache;
  googlePlacesRequestsRemaining: number;
}): Promise<ImportTileQueryResult> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return { businesses: [], provider: "google_places", error: "google_places_api_key_missing" };
  const tileCenter = tileCenterPoint(input.tile);
  const radiusMeters = Math.min(50_000, Math.max(100, Math.ceil(tileRadiusMeters(input.tile))));
  const cacheKey = [
    input.zone.id,
    input.category,
    "google_places",
    roundCoordinate(tileCenter.latitude, 4),
    roundCoordinate(tileCenter.longitude, 4),
    radiusMeters,
    Math.floor(Date.now() / (24 * 60 * 60 * 1000)),
  ].join(":");
  const cached = await input.cache.get("google_places_import", cacheKey);
  if (cached) return { businesses: cached.result as PoiBusiness[], provider: "google_places", cacheHit: true };
  if (input.googlePlacesRequestsRemaining <= 0) {
    return {
      businesses: [],
      provider: "google_places",
      error: "google_places_request_cap_reached",
      googlePlacesRequestCapReached: true,
    };
  }

  try {
    const response = await withTimeout(fetch("https://places.googleapis.com/v1/places:searchNearby", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "accept": "application/json",
        "x-goog-api-key": apiKey,
        "x-goog-fieldmask": googlePlacesImportFieldMask,
      },
      body: JSON.stringify({
        includedTypes: googlePlaceTypes[input.category],
        maxResultCount: Math.min(20, input.limit),
        rankPreference: "POPULARITY",
        locationRestriction: {
          circle: {
            center: {
              latitude: tileCenter.latitude,
              longitude: tileCenter.longitude,
            },
            radius: radiusMeters,
          },
        },
      }),
    }), Number(process.env.GOOGLE_PLACES_TIMEOUT_MS ?? 6_000), "Google Places import request");
    if (!response.ok) throw new Error(`Google Places ${response.status}: ${await response.text()}`);
    const body = await response.json() as {
      places?: Array<{
        id?: string;
        displayName?: { text?: string };
        formattedAddress?: string;
        location?: { latitude?: number; longitude?: number };
        primaryType?: string;
        types?: string[];
      }>;
    };
    const businesses = (body.places ?? []).map((place): PoiBusiness | null => {
      const latitude = place.location?.latitude;
      const longitude = place.location?.longitude;
      const name = place.displayName?.text;
      if (!place.id || !name || latitude === undefined || longitude === undefined) return null;
      return {
        externalId: place.id,
        name,
        category: normalizeGooglePlaceCategory(place, input.category),
        address: place.formattedAddress,
        latitude,
        longitude,
        source: "google_places",
        sourceUrl: `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}&query_place_id=${encodeURIComponent(place.id)}`,
        confidence: 0.9,
      };
    }).filter((business): business is PoiBusiness => Boolean(business));
    await input.cache.set("google_places_import", cacheKey, businesses, new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString());
    return { businesses, provider: "google_places", googlePlacesRequestMade: true };
  } catch (error) {
    return {
      businesses: [],
      provider: "google_places",
      googlePlacesRequestMade: true,
      error: error instanceof Error ? error.message : "google_places_import_failed",
    };
  }
}

function normalizeGooglePlaceCategory(
  place: { primaryType?: string; types?: string[] },
  fallbackCategory: SupportedMerchantCategory,
): SupportedMerchantCategory {
  const types = [place.primaryType, ...(place.types ?? [])].filter((type): type is string => Boolean(type));
  if (types.some((type) => ["cafe", "coffee_shop"].includes(type))) return "cafe";
  if (types.includes("bakery")) return "bakery";
  if (types.some((type) => type.includes("restaurant") || ["food", "meal_takeaway", "meal_delivery"].includes(type))) return "restaurant";
  if (types.includes("book_store")) return "bookshop";
  if (types.includes("florist")) return "flower_shop";
  if (types.includes("museum")) return "museum";
  if (types.includes("art_gallery")) return "gallery";
  if (types.includes("gift_shop")) return "gift_shop";
  if (types.some((type) => ["clothing_store", "shoe_store", "sportswear_store", "womens_clothing_store"].includes(type))) return "clothing";
  if (types.some((type) => ["grocery_store", "supermarket", "convenience_store", "food_store"].includes(type))) return "grocery";
  return fallbackCategory;
}

function contextFromZone(zone: CommerceZone, business: PoiBusiness): ConsumerContextSnapshot {
  return {
    snapshotId: "ctx_import",
    userId: "system_import",
    zoneId: zone.id,
    zoneName: zone.name,
    matchedZones: [zone],
    userLocation: business.latitude !== undefined && business.longitude !== undefined
      ? { latitude: business.latitude, longitude: business.longitude, source: "demo_geofence" }
      : undefined,
    locationMode: "demo_geofence_fallback",
    geofenceMatched: true,
    weatherMood: "mild",
    weatherDescription: "Import context",
    weatherSource: "mock_weather_fallback",
    timeContext: "city_time",
    declaredIntent: "local_discovery",
    availableMinutes: 30,
    rewardPreference: "cashback",
    privacyMode: "high",
    walkingToleranceMeters: 2_000,
    maxBundleStops: 2,
    maxOffersPerHour: 1,
    normalizedSignals: [],
    providerFallbacks: [],
    createdAt: nowIso(),
  };
}

function merchantDedupeKeys(merchant: Merchant) {
  return [
    merchant.externalId ? `${merchant.source}:${merchant.externalId}` : "",
    normalizedPlaceKey(merchant.name, merchant.latitude, merchant.longitude),
  ].filter(Boolean);
}

function businessDedupeKeys(business: PoiBusiness) {
  return [
    `${business.source}:${business.externalId}`,
    normalizedPlaceKey(business.name, business.latitude, business.longitude),
  ].filter(Boolean);
}

function normalizedPlaceKey(name: string, latitude?: number, longitude?: number) {
  return `${name.toLowerCase().replace(/\s+/g, " ").trim()}:${roundCoordinate(latitude ?? 0, 4)}:${roundCoordinate(longitude ?? 0, 4)}`;
}

function countByCategory(merchants: Merchant[]) {
  return merchants.reduce<Record<string, number>>((counts, merchant) => {
    counts[merchant.category] = (counts[merchant.category] ?? 0) + 1;
    return counts;
  }, {});
}

function formatAddress(tags: Record<string, string>) {
  return [
    [tags["addr:street"], tags["addr:housenumber"]].filter(Boolean).join(" "),
    tags["addr:postcode"],
    tags["addr:city"],
  ].filter(Boolean).join(", ") || undefined;
}

function osmSourceUrl(type: string, id: number) {
  const normalizedType = type === "relation" ? "relation" : type === "way" ? "way" : "node";
  return `https://www.openstreetmap.org/${normalizedType}/${id}`;
}

function discoveredBusinessToMerchant(input: {
  business: PoiBusiness;
  context: ConsumerContextSnapshot;
  coordinates: { latitude: number; longitude: number } | null;
}): Merchant {
  const coordinates = input.coordinates;
  const distanceMeters = coordinates && input.context.userLocation
    ? calculateDistanceMeters(input.context.userLocation.latitude, input.context.userLocation.longitude, coordinates.latitude, coordinates.longitude)
    : 9_999;
  return {
    id: `disc_${stableHash(`${input.business.source}:${input.business.externalId}:${input.business.name}`).toLowerCase()}`,
    externalId: input.business.externalId,
    name: input.business.name,
    category: normalizeCategory(input.business.category),
    zoneId: input.context.zoneId,
    distanceMeters,
    address: input.business.address,
    latitude: coordinates?.latitude,
    longitude: coordinates?.longitude,
    participationStatus: "partner",
    source: input.business.source === "overpass" ? "overpass" : input.business.source,
    sourceUrl: input.business.sourceUrl,
    confidence: input.business.confidence,
    products: [],
    goals: [],
    syntheticFields: [],
  };
}

function contextCategories(context: ConsumerContextSnapshot) {
  const categories = new Set(["cafe", "bookshop", "bakery", "restaurant"]);
  if (context.declaredIntent.includes("gift")) categories.add("flower_shop");
  if (context.weatherMood === "cold") categories.add("cafe");
  return [...categories];
}

function dedupeBusinesses(businesses: PoiBusiness[]) {
  const seen = new Set<string>();
  return businesses.filter((business) => {
    const key = `${business.name.toLowerCase()}:${business.latitude?.toFixed(4) ?? ""}:${business.longitude?.toFixed(4) ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeCategory(category: string) {
  if (category === "florist") return "flower_shop";
  if (category === "books") return "bookshop";
  if (category === "gallery") return "museum";
  return category;
}

function generateProducts(merchant: Merchant): MerchantProduct[] {
  const catalog: Record<string, Array<{ name: string; priceEuro: number; category: string; margin?: "low" | "medium" | "high" }>> = {
    cafe: [
      { name: "Cappuccino", priceEuro: 3.8, category: "warm_drink", margin: "high" },
      { name: "Latte", priceEuro: 4.2, category: "warm_drink" },
      { name: "Pastry", priceEuro: 3.4, category: "bakery" },
    ],
    bookshop: [
      { name: "Paperback", priceEuro: 12, category: "book" },
      { name: "Notebook", priceEuro: 6, category: "stationery" },
      { name: "Tote bag", priceEuro: 9, category: "accessory" },
    ],
    bakery: [
      { name: "Croissant", priceEuro: 2.8, category: "bakery" },
      { name: "Coffee", priceEuro: 3.2, category: "warm_drink" },
      { name: "Sandwich", priceEuro: 5.5, category: "light_lunch" },
    ],
    restaurant: [
      { name: "Lunch bowl", priceEuro: 11.5, category: "lunch" },
      { name: "Drink", priceEuro: 3.5, category: "drink" },
      { name: "Dessert", priceEuro: 4.5, category: "dessert" },
    ],
    flower_shop: [
      { name: "Small bouquet", priceEuro: 18, category: "flowers" },
      { name: "Greeting card", priceEuro: 4, category: "gift" },
    ],
    museum: [
      { name: "Ticket", priceEuro: 10, category: "ticket" },
      { name: "Postcard", priceEuro: 2, category: "gift" },
      { name: "Gift shop item", priceEuro: 8, category: "gift" },
    ],
    gallery: [
      { name: "Ticket", priceEuro: 9, category: "ticket" },
      { name: "Postcard", priceEuro: 2, category: "gift" },
      { name: "Gift shop item", priceEuro: 8, category: "gift" },
    ],
    gift_shop: [
      { name: "Local souvenir", priceEuro: 8, category: "gift" },
      { name: "Greeting card", priceEuro: 4, category: "gift" },
      { name: "Small gift", priceEuro: 12, category: "gift" },
    ],
    local_retail: [
      { name: "Local item", priceEuro: 8, category: "local" },
      { name: "Gift card", priceEuro: 10, category: "gift" },
      { name: "Small accessory", priceEuro: 12, category: "accessory" },
    ],
    stationery: [
      { name: "Notebook", priceEuro: 6, category: "stationery" },
      { name: "Pen", priceEuro: 3, category: "stationery" },
      { name: "Folder", priceEuro: 4, category: "stationery" },
    ],
    clothing: [
      { name: "Accessory", priceEuro: 14, category: "fashion" },
      { name: "Scarf", priceEuro: 22, category: "fashion" },
      { name: "Tote bag", priceEuro: 12, category: "accessory" },
    ],
    grocery: [
      { name: "Snack", priceEuro: 3.5, category: "food" },
      { name: "Drink", priceEuro: 2.8, category: "drink" },
      { name: "Local product", priceEuro: 7.5, category: "specialty_food" },
    ],
  };
  const items = catalog[merchant.category] ?? [{ name: "Local item", priceEuro: 8, category: "local" }];
  return items.map((item, index) => ({
    id: `prod_${merchant.id}_${index}`,
    merchantId: merchant.id,
    ...item,
  }));
}

function generateGoals(merchant: Merchant): MerchantGoal[] {
  const goals = merchant.category === "cafe"
    ? ["sustainable_quiet_hour_lift", "repeat_customer_discovery", "margin_protection"]
    : merchant.category === "bookshop"
      ? ["increase_browsing_visits", "local_discovery", "margin_protection"]
      : ["local_discovery", "sustainable_demand", "margin_protection"];
  return goals.map((goal, index) => ({ id: `goal_${merchant.id}_${index}`, merchantId: merchant.id, goal }));
}

function generateRules(merchant: Merchant, products: MerchantProduct[]): MerchantRule {
  const seed = deterministicMerchantSeed(merchant);
  const capRanges: Record<string, [number, number]> = {
    cafe: [10, 20],
    bakery: [10, 20],
    restaurant: [8, 15],
    bookshop: [5, 12],
    stationery: [5, 12],
    flower_shop: [5, 10],
    gift_shop: [5, 10],
    museum: [5, 15],
    gallery: [5, 15],
  };
  const [minCap, maxCap] = capRanges[merchant.category] ?? [6, 14];
  const cap = minCap + (seed % (maxCap - minCap + 1));
  const budget = categoryBaseBudget(merchant.category) + (seed % 35);
  const remainingRatio = 0.45 + ((seed % 40) / 100);
  return {
    merchantId: merchant.id,
    maxDiscountPercent: cap,
    dailyBudgetEuro: budget,
    dailyBudgetRemainingEuro: Math.round(budget * remainingRatio),
    eligibleProducts: products.map((product) => product.name),
    allowsBundles: true,
    preferredBundleCategories: preferredPairings(merchant.category),
    offerTypesAllowed: ["cashback", "bundle_unlock"],
    brandTone: "demo_local",
  };
}

function preferredPairings(category: string) {
  const pairings: Record<string, string[]> = {
    cafe: ["bookshop", "bakery", "museum"],
    bookshop: ["cafe", "stationery", "museum"],
    bakery: ["cafe", "bookshop"],
    restaurant: ["flower_shop", "cinema", "cafe"],
    flower_shop: ["restaurant", "cafe"],
    museum: ["cafe", "gift_shop", "bookshop"],
    gallery: ["cafe", "gift_shop", "bookshop"],
    gift_shop: ["museum", "cafe", "restaurant"],
    stationery: ["bookshop", "cafe", "museum"],
    clothing: ["cafe", "gift_shop"],
    grocery: ["cafe", "bakery"],
    local_retail: ["cafe", "gift_shop", "bookshop"],
  };
  return pairings[category] ?? ["cafe", "bookshop"];
}

function generateSyntheticPaymentDensity(merchant: Merchant): PaymentDensitySignal {
  const seed = deterministicMerchantSeed(merchant);
  const baselineTransactions = categoryBaselineTransactions(merchant.category) + (seed % 18);
  const stateBucket = seed % 10;
  const drop = stateBucket <= 1 ? -0.3 : stateBucket <= 4 ? 0.1 : stateBucket <= 7 ? 0.35 : 0.58;
  const currentTransactions = Math.max(1, Math.round(baselineTransactions * (1 - drop)));
  const baselineRevenue = baselineTransactions * (merchant.products[0]?.priceEuro ?? 8);
  const currentRevenue = currentTransactions * (merchant.products[0]?.priceEuro ?? 8);
  return {
    merchantId: merchant.id,
    baselineTransactions,
    currentTransactions,
    baselineRevenue,
    currentRevenue,
  };
}

function deterministicMerchantSeed(merchant: Merchant) {
  const seedInput = `${merchant.externalId ?? merchant.id}:${merchant.category}:${demoTimeBucket()}`;
  return Number.parseInt(stableHash(seedInput).slice(0, 6), 36);
}

function demoTimeBucket() {
  return new Date().toISOString().slice(0, 13);
}

function categoryBaseBudget(category: string) {
  if (["restaurant", "clothing"].includes(category)) return 60;
  if (["cafe", "bakery", "museum", "gallery"].includes(category)) return 40;
  if (["bookshop", "stationery", "gift_shop"].includes(category)) return 32;
  return 28;
}

function categoryBaselineTransactions(category: string) {
  if (["restaurant", "grocery", "cafe", "bakery"].includes(category)) return 18;
  if (["museum", "gallery", "clothing"].includes(category)) return 12;
  return 9;
}

function buildInsightSummary(
  merchant: Merchant,
  businessState: BusinessState,
  transactionDropPercent: number,
  urgencyScore: number,
  bundleReadinessScore: number,
) {
  if (businessState === "very_quiet") {
    return `${merchant.name} is very quiet with a ${transactionDropPercent}% transaction drop. Urgency ${urgencyScore}; bundle readiness ${bundleReadinessScore}.`;
  }
  if (businessState === "quiet") {
    return `${merchant.name} is quiet with a ${transactionDropPercent}% transaction drop. Urgency ${urgencyScore}; bundle readiness ${bundleReadinessScore}.`;
  }
  if (businessState === "busy") {
    return `${merchant.name} is busier than baseline. Suppress activation unless user demand is explicit.`;
  }
  return `${merchant.name} is at normal demand. Keep visible as a considered merchant, but rank below quiet merchants.`;
}
