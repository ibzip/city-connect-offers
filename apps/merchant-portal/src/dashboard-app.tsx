"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import type {
  ActivateCommerceZoneResult,
  CitySuggestion,
  DashboardMetrics,
  Merchant,
  MerchantImportRun,
  MerchantParticipationStatus,
  MerchantProduct,
  MerchantRule,
  MerchantRuleCompilePreviewResult,
  OfferType,
  SupportedMerchantCategory,
} from "@city-wallet/contracts";
import { Badge, Button, EventLog, ExplainabilityPanel, JsonPanel, MerchantPulseCard, Section } from "@city-wallet/ui";
import { apiGet, apiPost } from "./api";

const categoryOptions: SupportedMerchantCategory[] = [
  "cafe",
  "bakery",
  "restaurant",
  "bookshop",
  "flower_shop",
  "museum",
  "gallery",
  "gift_shop",
  "local_retail",
  "stationery",
  "clothing",
  "grocery",
];
const participationStatusOptions: MerchantParticipationStatus[] = ["partner", "demo_partner", "discovered_only", "discovered_only_without_coordinates"];
const offerTypeOptions: OfferType[] = ["cashback", "discount", "priority_pickup", "bundle_unlock"];
const sourceOptions = ["seeded", "google_places", "osm_overpass", "overpass", "tavily", "manual", "db"] as const;
const defaultCategoryCaps: Record<SupportedMerchantCategory, string> = {
  cafe: "180",
  bakery: "130",
  restaurant: "180",
  bookshop: "90",
  flower_shop: "80",
  museum: "80",
  gallery: "70",
  gift_shop: "90",
  local_retail: "120",
  stationery: "70",
  clothing: "120",
  grocery: "110",
};

function importRunStat(run: MerchantImportRun, key: string) {
  return run.providerStatsJson?.[key];
}

function importStopReason(run: MerchantImportRun) {
  const reason = importRunStat(run, "stopReason");
  return typeof reason === "string" ? reason : null;
}

function importStopMessage(run: MerchantImportRun) {
  const reason = importStopReason(run);
  if (reason === "target_reached") return "Target reached.";
  if (reason === "google_request_cap_reached") return "Stopped at the Google Places request cap. Raise the cap and continue if you want more merchants.";
  if (reason === "all_jobs_exhausted") return "All available import chunks were searched.";
  if (reason === "runtime_budget_reached") return "Paused at the runtime safety budget. Continue import to keep going.";
  if (reason === "provider_errors") return "Stopped after repeated provider errors.";
  if (reason === "city_merchant_cache_reused") return "Reused stored city merchants; provider search was skipped.";
  return run.status === "paused" ? "Paused before the merchant target was reached." : null;
}

function canContinueImport(run: MerchantImportRun) {
  return run.status === "paused" || (run.status === "partial_failed" && importStopReason(run) === "provider_errors");
}

function formatCountMap(value?: Record<string, number>) {
  const entries = Object.entries(value ?? {}).sort((left, right) => right[1] - left[1]).slice(0, 6);
  return entries.length ? entries.map(([key, count]) => `${key}: ${count}`).join(" · ") : "No merchants";
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}

export function DashboardApp() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [busy, setBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [merchantSaveBusy, setMerchantSaveBusy] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ActivateCommerceZoneResult | null>(null);
  const [selectedMerchantId, setSelectedMerchantId] = useState("");
  const [merchantDraft, setMerchantDraft] = useState<Merchant | null>(null);
  const [merchantSaved, setMerchantSaved] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [ruleCompileBusy, setRuleCompileBusy] = useState(false);
  const [ruleCompileResult, setRuleCompileResult] = useState<MerchantRuleCompilePreviewResult | null>(null);
  const [citySuggestions, setCitySuggestions] = useState<CitySuggestion[]>([]);
  const [citySuggesting, setCitySuggesting] = useState(false);
  const [zoneMode, setZoneMode] = useState<"city" | "center_radius" | "coordinate_box">("city");
  const [zoneForm, setZoneForm] = useState({
    city: "Munich",
    country: "DE",
    centerLat: "",
    centerLng: "",
    radiusMeters: "20000",
    maxImportedMerchants: "1000",
    maxTilesPerRun: "25",
    north: "",
    south: "",
    east: "",
    west: "",
    forceRefresh: false,
  });
  const [selectedCategories, setSelectedCategories] = useState<SupportedMerchantCategory[]>(categoryOptions);
  const [categoryCaps, setCategoryCaps] = useState<Record<SupportedMerchantCategory, string>>(defaultCategoryCaps);
  const [merchantOffset, setMerchantOffset] = useState(0);
  const [merchantFilters, setMerchantFilters] = useState({
    zoneId: "",
    category: "",
    participationStatus: "",
    source: "",
    query: "",
  });

  const load = useCallback(async () => {
    const params = new URLSearchParams({
      merchantLimit: "50",
      merchantOffset: String(merchantOffset),
    });
    for (const [key, value] of Object.entries(merchantFilters)) {
      if (value) params.set(key, value);
    }
    setMetrics(await apiGet<DashboardMetrics>(`/api/merchant/dashboard?${params.toString()}`));
  }, [merchantFilters, merchantOffset]);

  const refresh = useCallback(async () => {
    setBusy(true);
    setApiError(null);
    try {
      await apiPost("/api/merchant-insights/refresh");
      await load();
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Could not reach City Wallet API.");
      console.error(error);
    } finally {
      setBusy(false);
    }
  }, [load]);

  const selectedMetric = metrics?.merchants.find((metric) => metric.merchant.id === selectedMerchantId) ?? null;

  useEffect(() => {
    load().catch(console.error);
  }, [load]);

  useEffect(() => {
    const open = () => setImportDialogOpen(true);
    window.addEventListener("city-wallet-open-import-modal", open);
    if (new URLSearchParams(window.location.search).get("import") === "1") {
      setImportDialogOpen(true);
      window.history.replaceState(null, "", window.location.pathname);
    }
    return () => window.removeEventListener("city-wallet-open-import-modal", open);
  }, []);

  useEffect(() => {
    if (zoneMode !== "city" || zoneForm.city.trim().length < 2 || (zoneForm.centerLat && zoneForm.centerLng)) {
      setCitySuggestions([]);
      setCitySuggesting(false);
      return;
    }

    let cancelled = false;
    setCitySuggesting(true);
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({
        query: zoneForm.city.trim(),
        country: (zoneForm.country || "DE").trim(),
      });
      apiGet<CitySuggestion[]>(`/api/commerce-zones/city-suggestions?${params.toString()}`)
        .then((suggestions) => {
          if (!cancelled) setCitySuggestions(suggestions);
        })
        .catch((error) => {
          if (!cancelled) setCitySuggestions([]);
          console.error(error);
        })
        .finally(() => {
          if (!cancelled) setCitySuggesting(false);
        });
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [zoneForm.centerLat, zoneForm.centerLng, zoneForm.city, zoneForm.country, zoneMode]);

  async function activateCity(previewOnly: boolean) {
    setImportBusy(true);
    setApiError(null);
    try {
      const body = {
        mode: zoneMode,
        city: zoneForm.city || undefined,
        country: zoneForm.country || "DE",
        centerLat: zoneForm.centerLat ? Number(zoneForm.centerLat) : undefined,
        centerLng: zoneForm.centerLng ? Number(zoneForm.centerLng) : undefined,
        radiusMeters: Number(zoneForm.radiusMeters || 20000),
        maxImportedMerchants: Number(zoneForm.maxImportedMerchants || 1000),
        maxTilesPerRun: Number(zoneForm.maxTilesPerRun || 25),
        categories: selectedCategories,
        categoryCaps: Object.fromEntries(selectedCategories.map((category) => [category, Number(categoryCaps[category] || defaultCategoryCaps[category])])),
        autoDemoOnboard: true,
        forceRefresh: zoneForm.forceRefresh,
        previewOnly,
        coordinateBox: zoneMode === "coordinate_box"
          ? {
              north: Number(zoneForm.north),
              south: Number(zoneForm.south),
              east: Number(zoneForm.east),
              west: Number(zoneForm.west),
            }
          : undefined,
      };
      const result = await apiPost<ActivateCommerceZoneResult>("/api/commerce-zones/activate", body);
      setImportResult(result);
      await load();
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Could not reach City Wallet API.");
      console.error(error);
    } finally {
      setImportBusy(false);
    }
  }

  async function continueImport(runId: string) {
    setImportBusy(true);
    setApiError(null);
    try {
      await apiPost(`/api/merchant-import-runs/${runId}/continue`, { runId });
      await load();
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Could not reach City Wallet API.");
      console.error(error);
    } finally {
      setImportBusy(false);
    }
  }

  function useLatestWalletLocation() {
    const location = metrics?.currentContext?.userLocation;
    if (!location) return;
    setZoneMode("center_radius");
    setZoneForm((current) => ({
      ...current,
      centerLat: String(location.latitude),
      centerLng: String(location.longitude),
      city: metrics?.currentContext?.zoneName && !metrics.currentContext.zoneName.includes("Outside")
        ? metrics.currentContext.zoneName
        : current.city,
    }));
  }

  function toggleCategory(category: SupportedMerchantCategory) {
    setSelectedCategories((current) =>
      current.includes(category)
        ? current.filter((item) => item !== category)
        : [...current, category],
    );
  }

  function updateMerchantFilter(key: keyof typeof merchantFilters, value: string) {
    setMerchantOffset(0);
    setMerchantFilters((current) => ({ ...current, [key]: value }));
  }

  function selectCitySuggestion(suggestion: CitySuggestion) {
    setZoneMode("city");
    setZoneForm((current) => ({
      ...current,
      city: suggestion.city,
      country: suggestion.country,
      centerLat: String(suggestion.centerLat),
      centerLng: String(suggestion.centerLng),
      north: suggestion.boundingBox ? String(suggestion.boundingBox.north) : current.north,
      south: suggestion.boundingBox ? String(suggestion.boundingBox.south) : current.south,
      east: suggestion.boundingBox ? String(suggestion.boundingBox.east) : current.east,
      west: suggestion.boundingBox ? String(suggestion.boundingBox.west) : current.west,
    }));
    setCitySuggestions([]);
  }

  function selectMerchant(merchant: Merchant) {
    setSelectedMerchantId(merchant.id);
    setMerchantDraft(cloneMerchant(merchant));
    setMerchantSaved(false);
    setRuleCompileResult(null);
  }

  function updateMerchantDraft(patch: Partial<Merchant>) {
    setMerchantDraft((current) => current ? { ...current, ...patch } : current);
  }

  function updateRuleDraft(patch: Partial<MerchantRule>) {
    setMerchantDraft((current) => {
      if (!current) return current;
      const rule = current.rule ?? defaultMerchantRule(current);
      return { ...current, rule: { ...rule, ...patch } };
    });
  }

  async function saveMerchantDraft() {
    if (!merchantDraft) return;
    setMerchantSaveBusy(true);
    setApiError(null);
    try {
      const result = await apiPost<{ merchant: Merchant }>(`/api/merchants/${merchantDraft.id}`, merchantDraft);
      setMerchantDraft(cloneMerchant(result.merchant));
      setSelectedMerchantId(result.merchant.id);
      setMerchantSaved(true);
      setRuleCompileResult(null);
      await load();
      window.setTimeout(() => setMerchantSaved(false), 1500);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Could not save merchant.");
      console.error(error);
    } finally {
      setMerchantSaveBusy(false);
    }
  }

  async function compileRulePreview() {
    if (!merchantDraft) return;
    setRuleCompileBusy(true);
    setRuleCompileResult(null);
    setApiError(null);
    try {
      const result = await apiPost<MerchantRuleCompilePreviewResult>("/api/merchant/rules/compile-preview", {
        merchant: merchantDraft,
        freeformRulesText: merchantDraft.rule?.freeformRulesText ?? "",
      });
      setRuleCompileResult(result);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Could not compile free-form rules.");
      console.error(error);
    } finally {
      setRuleCompileBusy(false);
    }
  }

  return (
    <Section>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2"><Badge tone="orange">execution dashboard</Badge></div>
          <h1 className="font-serif text-3xl">Merchant Dashboard</h1>
          <p className="mt-1 text-sm text-ink-muted">Business-state snapshots, offer impact, redemption log, and explainability from the real product flow.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => setImportDialogOpen(true)}>Import merchants</Button>
          <Button onClick={refresh} disabled={busy}>{busy ? "Refreshing..." : "Refresh insights"}</Button>
        </div>
      </div>

      {apiError ? (
        <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <div className="mb-1 font-semibold">API connection failed</div>
          <p>{apiError}</p>
        </div>
      ) : null}

      <div className="mb-6 rounded-2xl border border-black/10 bg-paper p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="mb-2"><Badge tone="blue">activated zones / city import</Badge></div>
            <h2 className="font-serif text-2xl">Stored city supply</h2>
            <p className="mt-1 text-sm text-ink-muted">City imports are managed from the top-banner workflow. The dashboard stays focused on stored merchants, insights, and analytics.</p>
          </div>
          <Button onClick={() => setImportDialogOpen(true)}>Import merchants</Button>
        </div>
        <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
          <div className="rounded-xl border border-black/10 bg-white/70 p-3">
            <div className="font-mono text-[10px] uppercase tracking-wider text-ink-muted">Activated zones</div>
            <p className="mt-1 text-2xl font-semibold">{metrics?.zones.length ?? 0}</p>
          </div>
          <div className="rounded-xl border border-black/10 bg-white/70 p-3">
            <div className="font-mono text-[10px] uppercase tracking-wider text-ink-muted">Stored merchants</div>
            <p className="mt-1 text-2xl font-semibold">{metrics?.merchantSummary.total ?? 0}</p>
          </div>
          <div className="rounded-xl border border-black/10 bg-white/70 p-3">
            <div className="font-mono text-[10px] uppercase tracking-wider text-ink-muted">Latest import run</div>
            <p className="mt-1 text-sm text-ink-muted">{metrics?.importRuns[0]?.status ?? "No import yet"}</p>
          </div>
        </div>
      </div>

      {importDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6 backdrop-blur-sm">
          <div className="max-h-[90vh] w-[min(1120px,100%)] overflow-y-auto rounded-2xl border border-black/10 bg-paper p-5 shadow-2xl">
            <div className="mb-4 flex justify-end">
              <Button variant="secondary" onClick={() => setImportDialogOpen(false)}>Close</Button>
            </div>
            <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="mb-2"><Badge tone="blue">activated zones / city import</Badge></div>
            <h2 className="font-serif text-2xl">One-time merchant import</h2>
            <p className="mt-1 text-sm text-ink-muted">Activate a city or area, import merchants once, then match wallet users against stored DB merchants.</p>
          </div>
          <Button variant="secondary" onClick={useLatestWalletLocation} disabled={!metrics?.currentContext?.userLocation || importBusy}>Use latest wallet location</Button>
        </div>

        <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
          <div className="space-y-2 text-sm">
            {(["city", "center_radius", "coordinate_box"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setZoneMode(mode)}
                className={zoneMode === mode ? "w-full rounded-lg border border-teal bg-teal/10 px-3 py-2 text-left font-semibold text-teal" : "w-full rounded-lg border border-black/10 bg-white/60 px-3 py-2 text-left text-ink-muted"}
              >
                {mode === "city" ? "City + country" : mode === "center_radius" ? "Center + radius" : "Coordinate box"}
              </button>
            ))}
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="text-xs uppercase tracking-wider text-ink-muted">City
              <input className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm normal-case tracking-normal text-ink" value={zoneForm.city} onChange={(event) => setZoneForm({ ...zoneForm, city: event.target.value, centerLat: "", centerLng: "" })} />
              {citySuggesting ? <p className="mt-1 text-[11px] normal-case tracking-normal text-ink-muted">Looking up city options...</p> : null}
              {citySuggestions.length > 0 ? (
                <div className="mt-2 space-y-2 normal-case tracking-normal">
                  {citySuggestions.map((suggestion) => (
                    <button
                      key={`${suggestion.city}-${suggestion.country}-${suggestion.centerLat}-${suggestion.centerLng}`}
                      type="button"
                      onClick={() => selectCitySuggestion(suggestion)}
                      className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-left text-sm text-ink shadow-sm hover:border-teal hover:bg-teal/5"
                    >
                      <span className="block font-semibold">{suggestion.city}, {suggestion.country}</span>
                      <span className="block text-xs text-ink-muted">{suggestion.label}</span>
                      <span className="block text-[11px] text-ink-muted">{suggestion.centerLat.toFixed(4)}, {suggestion.centerLng.toFixed(4)} · Nominatim</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <label className="text-xs uppercase tracking-wider text-ink-muted">Country
              <input className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm normal-case tracking-normal text-ink" value={zoneForm.country} onChange={(event) => setZoneForm({ ...zoneForm, country: event.target.value, centerLat: "", centerLng: "" })} />
            </label>
            <label className="text-xs uppercase tracking-wider text-ink-muted">Radius meters
              <input className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm normal-case tracking-normal text-ink" type="number" value={zoneForm.radiusMeters} onChange={(event) => setZoneForm({ ...zoneForm, radiusMeters: event.target.value })} />
              <span className="mt-1 block text-[11px] normal-case tracking-normal text-ink-muted">Area around the city or center point to import from. Requests above the hard cap are clamped.</span>
            </label>
            <label className="text-xs uppercase tracking-wider text-ink-muted">Center latitude
              <input className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm normal-case tracking-normal text-ink" type="number" value={zoneForm.centerLat} onChange={(event) => setZoneForm({ ...zoneForm, centerLat: event.target.value })} />
            </label>
            <label className="text-xs uppercase tracking-wider text-ink-muted">Center longitude
              <input className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm normal-case tracking-normal text-ink" type="number" value={zoneForm.centerLng} onChange={(event) => setZoneForm({ ...zoneForm, centerLng: event.target.value })} />
            </label>
            <label className="text-xs uppercase tracking-wider text-ink-muted">Max merchants
              <input className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm normal-case tracking-normal text-ink" type="number" value={zoneForm.maxImportedMerchants} onChange={(event) => setZoneForm({ ...zoneForm, maxImportedMerchants: event.target.value })} />
              <span className="mt-1 block text-[11px] normal-case tracking-normal text-ink-muted">Target total stored merchants for this zone. Raising it imports more while skipping already stored merchants.</span>
            </label>
            <label className="text-xs uppercase tracking-wider text-ink-muted">Checkpoint chunks
              <input className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm normal-case tracking-normal text-ink" type="number" value={zoneForm.maxTilesPerRun} onChange={(event) => setZoneForm({ ...zoneForm, maxTilesPerRun: event.target.value })} />
              <span className="mt-1 block text-[11px] normal-case tracking-normal text-ink-muted">Provider work batch size before progress is saved. It is not the merchant target.</span>
            </label>
            {zoneMode === "coordinate_box" ? (
              <>
                {(["north", "south", "east", "west"] as const).map((field) => (
                  <label key={field} className="text-xs uppercase tracking-wider text-ink-muted">{field}
                    <input className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm normal-case tracking-normal text-ink" type="number" value={zoneForm[field]} onChange={(event) => setZoneForm({ ...zoneForm, [field]: event.target.value })} />
                  </label>
                ))}
              </>
            ) : null}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {categoryOptions.map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => toggleCategory(category)}
              className={selectedCategories.includes(category) ? "rounded-full border border-teal bg-teal/10 px-3 py-1 text-xs font-semibold text-teal" : "rounded-full border border-black/10 bg-white px-3 py-1 text-xs text-ink-muted"}
            >
              {category}
            </button>
          ))}
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4 lg:grid-cols-6">
          {selectedCategories.map((category) => (
            <label key={category} className="text-xs uppercase tracking-wider text-ink-muted">{category} cap
              <input
                className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm normal-case tracking-normal text-ink"
                type="number"
                value={categoryCaps[category]}
                onChange={(event) => setCategoryCaps({ ...categoryCaps, [category]: event.target.value })}
              />
              <span className="mt-1 block text-[11px] normal-case tracking-normal text-ink-muted">Maximum stored merchants for this category.</span>
            </label>
          ))}
        </div>

        <label className="mt-4 flex max-w-2xl items-start gap-3 rounded-xl border border-black/10 bg-white/70 p-3 text-sm text-ink">
          <input
            className="mt-1"
            type="checkbox"
            checked={zoneForm.forceRefresh}
            onChange={(event) => setZoneForm({ ...zoneForm, forceRefresh: event.target.checked })}
          />
          <span>
            <span className="block font-semibold">Force new import run</span>
            <span className="block text-xs text-ink-muted">
              Off reuses stored city merchants or resumes a paused import. On starts a new run; fresh provider response caches may still be used for cost control.
            </span>
          </span>
        </label>

        <div className="mt-4 flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => activateCity(true)} disabled={importBusy}>{importBusy ? "Working..." : "Preview import"}</Button>
          <Button onClick={() => activateCity(false)} disabled={importBusy}>{importBusy ? "Importing..." : "Activate + import"}</Button>
        </div>

        {importResult ? (
          <div className="mt-4 grid gap-3 text-sm lg:grid-cols-2">
            <div className="rounded-xl border border-black/10 bg-white/70 p-4">
              <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-ink-muted">Import preview</div>
              <p>{importResult.zone.name} · {importResult.preview.provider} · {importResult.preview.radiusMeters}m</p>
              <p className="mt-1 font-semibold text-teal">Planned action: {importResult.preview.plannedImportAction.replace(/_/g, " ")}</p>
              <p className="mt-1 text-ink-muted">{importResult.preview.estimatedTiles} estimated tile(s) · {importResult.preview.estimatedRequestCount} estimated provider request(s)</p>
              <p className="mt-1 text-ink-muted">{importResult.preview.maxImportedMerchants} target merchants · {importResult.preview.maxTilesPerRun} checkpoint chunks</p>
              <p className="mt-1 text-ink-muted">{importResult.preview.existingStoredMerchantCount} stored merchant(s) already in this city zone</p>
              {importResult.preview.settingsChangeSummary.map((line, index) => <p key={`${line}-${index}`} className="mt-1 text-ink-muted">{line}</p>)}
              {importResult.preview.cacheReuseAvailable ? <p className="mt-1 font-semibold text-teal">Stored city merchant cache available</p> : null}
              {importResult.preview.maxProviderRequests ? <p className="mt-1 text-ink-muted">{importResult.preview.maxProviderRequests} max provider request(s) per import</p> : null}
              {importResult.preview.fieldMask ? <p className="mt-1 break-words font-mono text-[11px] text-ink-muted">Field mask: {importResult.preview.fieldMask}</p> : null}
              <p className="mt-1 text-ink-muted">Place Details: {importResult.preview.placeDetailsDisabled ? "disabled for cost control" : "enabled"}</p>
              <p className="mt-1 text-ink-muted">Demo onboarding: {importResult.preview.demoAutoOnboardingEnabled ? "enabled" : "off or env-disabled"}</p>
              {uniqueStrings([...importResult.preview.providerWarnings, ...importResult.warnings]).map((warning) => <p key={warning} className="mt-1 text-amber-700">{warning}</p>)}
            </div>
            <JsonPanel title="Import API Result" data={importResult} />
          </div>
        ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <div className="mb-6 grid gap-5 lg:grid-cols-2">
        <div className="rounded-2xl border border-black/10 bg-paper p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-serif text-xl">Activated zones</h2>
            <Badge tone="blue">{metrics?.zones.length ?? 0}</Badge>
          </div>
          <div className="space-y-3 text-sm">
            {(metrics?.zones ?? []).map((zone) => (
              <div key={zone.id} className="rounded-xl border border-black/10 bg-white/70 p-3">
                <div className="font-semibold">{zone.name}</div>
                <div className="text-ink-muted">{zone.city}, {zone.country} · {zone.radiusMeters}m · {zone.zoneType}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-black/10 bg-paper p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-serif text-xl">Import runs</h2>
            <Badge tone="orange">{metrics?.importRuns.length ?? 0}</Badge>
          </div>
          <div className="space-y-3 text-sm">
            {(metrics?.importRuns ?? []).map((run) => (
              <div key={run.id} className="rounded-xl border border-black/10 bg-white/70 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold">{run.id}</div>
                  <Badge tone={run.status === "completed" ? "green" : run.status === "paused" ? "orange" : run.status.includes("failed") ? "red" : "blue"}>{run.status}</Badge>
                </div>
                <p className="text-ink-muted">{run.importedCount} / {run.maxImportedMerchants} imported · {run.demoPartnerCount} demo partners · {run.failedCount} failed chunks</p>
                {importStopMessage(run) ? <p className="mt-1 text-ink-muted">Stop reason: {importStopMessage(run)}</p> : null}
                {typeof importRunStat(run, "googlePlacesRequests") === "number" ? <p className="mt-1 text-ink-muted">{String(importRunStat(run, "googlePlacesRequests"))} Google Places request(s) used</p> : null}
                {typeof importRunStat(run, "remainingJobs") === "number" ? <p className="mt-1 text-ink-muted">{String(importRunStat(run, "remainingJobs"))} import chunk(s) remaining</p> : null}
                {uniqueStrings(run.warnings).map((warning) => <p key={warning} className="mt-1 text-amber-700">{warning}</p>)}
                {canContinueImport(run) ? <Button className="mt-3" variant="secondary" onClick={() => continueImport(run.id)} disabled={importBusy}>Continue import</Button> : null}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mb-6 rounded-2xl border border-black/10 bg-paper p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-serif text-xl">Imported merchants</h2>
            <p className="mt-1 text-sm text-ink-muted">
              Showing {(metrics?.merchants.length ?? 0)} of {metrics?.merchantPage.total ?? 0} matching merchant(s).
            </p>
          </div>
          <Badge tone="purple">{metrics?.merchantSummary.total ?? 0} total in view</Badge>
        </div>
        <div className="mb-4 grid gap-3 md:grid-cols-2 lg:grid-cols-5">
          <label className="text-xs uppercase tracking-wider text-ink-muted">Search
            <input
              className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm normal-case tracking-normal text-ink"
              value={merchantFilters.query}
              onChange={(event) => updateMerchantFilter("query", event.target.value)}
              placeholder="Name, category, source"
            />
          </label>
          <label className="text-xs uppercase tracking-wider text-ink-muted">Zone
            <select className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm normal-case tracking-normal text-ink" value={merchantFilters.zoneId} onChange={(event) => updateMerchantFilter("zoneId", event.target.value)}>
              <option value="">All zones</option>
              {(metrics?.zones ?? []).map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}
            </select>
          </label>
          <label className="text-xs uppercase tracking-wider text-ink-muted">Category
            <select className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm normal-case tracking-normal text-ink" value={merchantFilters.category} onChange={(event) => updateMerchantFilter("category", event.target.value)}>
              <option value="">All categories</option>
              {categoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
          </label>
          <label className="text-xs uppercase tracking-wider text-ink-muted">Status
            <select className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm normal-case tracking-normal text-ink" value={merchantFilters.participationStatus} onChange={(event) => updateMerchantFilter("participationStatus", event.target.value)}>
              <option value="">All statuses</option>
              {participationStatusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </label>
          <label className="text-xs uppercase tracking-wider text-ink-muted">Source
            <select className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm normal-case tracking-normal text-ink" value={merchantFilters.source} onChange={(event) => updateMerchantFilter("source", event.target.value)}>
              <option value="">All sources</option>
              {sourceOptions.map((source) => <option key={source} value={source}>{source}</option>)}
            </select>
          </label>
        </div>
        <div className="mb-4 grid gap-3 text-xs md:grid-cols-3">
          <div className="rounded-xl border border-black/10 bg-white/70 p-3">
            <div className="font-mono uppercase tracking-wider text-ink-muted">By source</div>
            <p className="mt-1 text-ink-muted">{formatCountMap(metrics?.merchantSummary.bySource)}</p>
          </div>
          <div className="rounded-xl border border-black/10 bg-white/70 p-3">
            <div className="font-mono uppercase tracking-wider text-ink-muted">By status</div>
            <p className="mt-1 text-ink-muted">{formatCountMap(metrics?.merchantSummary.byParticipationStatus)}</p>
          </div>
          <div className="rounded-xl border border-black/10 bg-white/70 p-3">
            <div className="font-mono uppercase tracking-wider text-ink-muted">By category</div>
            <p className="mt-1 text-ink-muted">{formatCountMap(metrics?.merchantSummary.byCategory)}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="secondary" disabled={merchantOffset === 0} onClick={() => setMerchantOffset(Math.max(0, merchantOffset - 50))}>Previous</Button>
          <span className="text-sm text-ink-muted">
            Page {Math.floor((metrics?.merchantPage.offset ?? 0) / (metrics?.merchantPage.limit ?? 50)) + 1}
            {metrics?.merchantPage.total ? ` · ${metrics.merchantPage.offset + 1}-${Math.min(metrics.merchantPage.offset + metrics.merchants.length, metrics.merchantPage.total)} of ${metrics.merchantPage.total}` : ""}
          </span>
          <Button variant="secondary" disabled={!metrics?.merchantPage.hasMore} onClick={() => setMerchantOffset(merchantOffset + 50)}>Next</Button>
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {(metrics?.merchants ?? []).map((metric) => (
          <button
            key={metric.merchant.id}
            type="button"
            onClick={() => selectMerchant(metric.merchant)}
            className={selectedMerchantId === metric.merchant.id
              ? "rounded-2xl text-left outline outline-2 outline-teal outline-offset-2"
              : "rounded-2xl text-left transition-transform hover:-translate-y-0.5 focus:outline focus:outline-2 focus:outline-teal focus:outline-offset-2"}
          >
            <MerchantPulseCard metric={metric} />
          </button>
        ))}
      </div>

      {merchantDraft ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6 backdrop-blur-sm">
          <div className="max-h-[90vh] w-[min(1120px,100%)] overflow-y-auto rounded-2xl border border-black/10 bg-paper p-5 shadow-2xl">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="mb-2"><Badge tone="blue">merchant profile / rules</Badge></div>
              <h2 className="font-serif text-2xl">{merchantDraft.name}</h2>
              <p className="mt-1 text-sm text-ink-muted">Edit merchant-facing configuration directly from the selected merchant card.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {selectedMetric?.insight ? <Badge tone="purple">urgency {selectedMetric.insight.urgencyScore}</Badge> : null}
              <Badge tone={merchantDraft.participationStatus === "demo_partner" ? "orange" : "green"}>{merchantDraft.participationStatus}</Badge>
              {merchantDraft.source ? <Badge>{merchantDraft.source}</Badge> : null}
              <Button variant="secondary" onClick={() => { setMerchantDraft(null); setSelectedMerchantId(""); setRuleCompileResult(null); }}>Close</Button>
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-xs uppercase tracking-wider text-ink-muted">Merchant name
                  <input className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm normal-case tracking-normal text-ink" value={merchantDraft.name} onChange={(event) => updateMerchantDraft({ name: event.target.value })} />
                </label>
                <label className="text-xs uppercase tracking-wider text-ink-muted">Category
                  <input className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm normal-case tracking-normal text-ink" value={merchantDraft.category} onChange={(event) => updateMerchantDraft({ category: event.target.value })} />
                </label>
                <label className="text-xs uppercase tracking-wider text-ink-muted">Participation status
                  <select className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm normal-case tracking-normal text-ink" value={merchantDraft.participationStatus} onChange={(event) => updateMerchantDraft({ participationStatus: event.target.value as MerchantParticipationStatus })}>
                    {participationStatusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
                  </select>
                </label>
                <label className="text-xs uppercase tracking-wider text-ink-muted">Address
                  <input className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm normal-case tracking-normal text-ink" value={merchantDraft.address ?? ""} onChange={(event) => updateMerchantDraft({ address: event.target.value || undefined })} />
                </label>
                <label className="text-xs uppercase tracking-wider text-ink-muted">Latitude
                  <input className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm normal-case tracking-normal text-ink" type="number" value={merchantDraft.latitude ?? ""} onChange={(event) => updateMerchantDraft({ latitude: event.target.value === "" ? undefined : Number(event.target.value) })} />
                </label>
                <label className="text-xs uppercase tracking-wider text-ink-muted">Longitude
                  <input className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm normal-case tracking-normal text-ink" type="number" value={merchantDraft.longitude ?? ""} onChange={(event) => updateMerchantDraft({ longitude: event.target.value === "" ? undefined : Number(event.target.value) })} />
                </label>
              </div>

              <TextList
                label="Merchant goals"
                value={merchantDraft.goals.map((goal) => goal.goal)}
                onChange={(goals) => updateMerchantDraft({ goals: goals.map((goal, index) => ({ id: `goal_${merchantDraft.id}_${index}`, merchantId: merchantDraft.id, goal })) })}
              />
              <label className="text-xs uppercase tracking-wider text-ink-muted">Products
                <textarea
                  className="mt-1 min-h-32 w-full rounded-lg border bg-white px-3 py-2 text-sm normal-case tracking-normal text-ink"
                  value={formatProducts(merchantDraft.products)}
                  onChange={(event) => updateMerchantDraft({ products: parseProducts(event.target.value, merchantDraft.id) })}
                />
                <span className="mt-1 block text-[11px] normal-case tracking-normal text-ink-muted">One per line: name | price | category | margin</span>
              </label>
            </div>

            <div className="space-y-4 rounded-xl border border-black/10 bg-white/70 p-4">
              <div className="font-serif text-xl">Rules</div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-xs uppercase tracking-wider text-ink-muted">Max discount %
                  <input className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm normal-case tracking-normal text-ink" type="number" min={0} max={100} value={(merchantDraft.rule ?? defaultMerchantRule(merchantDraft)).maxDiscountPercent} onChange={(event) => updateRuleDraft({ maxDiscountPercent: Number(event.target.value) })} />
                  <RuleHint>Upper bound for incentive percent. Validators reject offers above this cap.</RuleHint>
                </label>
                <label className="text-xs uppercase tracking-wider text-ink-muted">Daily budget €
                  <input className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm normal-case tracking-normal text-ink" type="number" min={0} value={(merchantDraft.rule ?? defaultMerchantRule(merchantDraft)).dailyBudgetEuro} onChange={(event) => updateRuleDraft({ dailyBudgetEuro: Number(event.target.value) })} />
                  <RuleHint>Total simulated daily incentive budget for this merchant.</RuleHint>
                </label>
                <label className="text-xs uppercase tracking-wider text-ink-muted">Budget remaining €
                  <input className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm normal-case tracking-normal text-ink" type="number" min={0} value={(merchantDraft.rule ?? defaultMerchantRule(merchantDraft)).dailyBudgetRemainingEuro} onChange={(event) => updateRuleDraft({ dailyBudgetRemainingEuro: Number(event.target.value) })} />
                  <RuleHint>Current available incentive budget. Validators reject offers that overspend it.</RuleHint>
                </label>
                <label className="text-xs uppercase tracking-wider text-ink-muted">Brand tone
                  <input className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm normal-case tracking-normal text-ink" value={(merchantDraft.rule ?? defaultMerchantRule(merchantDraft)).brandTone} onChange={(event) => updateRuleDraft({ brandTone: event.target.value })} />
                  <RuleHint>Copy and tone hint for generated offer language.</RuleHint>
                </label>
              </div>
              <label className="flex items-center gap-3 text-sm text-ink">
                <input type="checkbox" checked={(merchantDraft.rule ?? defaultMerchantRule(merchantDraft)).allowsBundles} onChange={(event) => updateRuleDraft({ allowsBundles: event.target.checked })} />
                <span>
                  <span className="block">Allows cooperative bundles</span>
                  <span className="block text-xs text-ink-muted">Merchant consent for bundle offers with other categories.</span>
                </span>
              </label>
              <TextList label="Eligible products" value={(merchantDraft.rule ?? defaultMerchantRule(merchantDraft)).eligibleProducts} onChange={(eligibleProducts) => updateRuleDraft({ eligibleProducts })} />
              <RuleHint>Products that may appear in offers.</RuleHint>
              <TextList label="Preferred bundle categories" value={(merchantDraft.rule ?? defaultMerchantRule(merchantDraft)).preferredBundleCategories} onChange={(preferredBundleCategories) => updateRuleDraft({ preferredBundleCategories })} />
              <RuleHint>Partner categories this merchant prefers in cooperative bundles.</RuleHint>
              <div>
                <div className="mb-2 text-xs uppercase tracking-wider text-ink-muted">Offer types allowed</div>
                <RuleHint>Incentive mechanisms this merchant allows.</RuleHint>
                <div className="flex flex-wrap gap-2">
                  {offerTypeOptions.map((offerType) => {
                    const current = merchantDraft.rule ?? defaultMerchantRule(merchantDraft);
                    const checked = current.offerTypesAllowed.includes(offerType);
                    return (
                      <label key={offerType} className={checked ? "rounded-full border border-teal bg-teal/10 px-3 py-1 text-xs font-semibold text-teal" : "rounded-full border border-black/10 bg-white px-3 py-1 text-xs text-ink-muted"}>
                        <input
                          className="sr-only"
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => updateRuleDraft({
                            offerTypesAllowed: event.target.checked
                              ? Array.from(new Set([...current.offerTypesAllowed, offerType]))
                              : current.offerTypesAllowed.filter((item) => item !== offerType),
                          })}
                        />
                        {offerType}
                      </label>
                    );
                  })}
                </div>
              </div>
              <label className="text-xs uppercase tracking-wider text-ink-muted">Free-form rules
                <textarea
                  className="mt-1 min-h-24 w-full rounded-lg border bg-white px-3 py-2 text-sm normal-case tracking-normal text-ink"
                  value={(merchantDraft.rule ?? defaultMerchantRule(merchantDraft)).freeformRulesText ?? ""}
                  onChange={(event) => {
                    updateRuleDraft({ freeformRulesText: event.target.value, freeformRulesStatus: event.target.value.trim() ? "failed" : "empty" });
                    setRuleCompileResult(null);
                  }}
                  placeholder="Example: Max discount 8%. Cashback only. No bundles. Eligible products: cappuccino, latte."
                />
                <RuleHint>Natural language is enforceable only after the backend compiles it into static rule fields.</RuleHint>
              </label>
              <div className="flex flex-wrap gap-3">
                <Button variant="secondary" onClick={compileRulePreview} disabled={ruleCompileBusy || merchantSaveBusy}>
                  {ruleCompileBusy ? "Compiling..." : "Compile preview"}
                </Button>
                {(merchantDraft.rule ?? defaultMerchantRule(merchantDraft)).freeformRulesStatus ? (
                  <Badge tone={(merchantDraft.rule ?? defaultMerchantRule(merchantDraft)).freeformRulesStatus === "compiled" ? "green" : (merchantDraft.rule ?? defaultMerchantRule(merchantDraft)).freeformRulesStatus === "failed" ? "red" : "blue"}>
                    free-form {(merchantDraft.rule ?? defaultMerchantRule(merchantDraft)).freeformRulesStatus}
                  </Badge>
                ) : null}
              </div>
              {ruleCompileResult ? (
                <div className={ruleCompileResult.ok ? "rounded-xl border border-teal/30 bg-teal/5 p-3 text-sm" : "rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900"}>
                  <div className="font-semibold">{ruleCompileResult.ok ? "Compilable rule preview" : "Cannot enforce this text yet"}</div>
                  {ruleCompileResult.compiledRule ? <p className="mt-1 text-ink-muted">{ruleCompileResult.compiledRule.summary}</p> : null}
                  {ruleCompileResult.error ? <p className="mt-1">{ruleCompileResult.error}</p> : null}
                  {ruleCompileResult.compiledRule?.unsupportedRules.length ? <p className="mt-1 text-amber-700">Unsupported: {ruleCompileResult.compiledRule.unsupportedRules.join(", ")}</p> : null}
                  <JsonPanel title="Compiled Static Patch" data={ruleCompileResult.compiledRule?.staticRulePatch ?? ruleCompileResult} />
                </div>
              ) : null}
            </div>
          </div>

          {merchantDraft.demoDisclosure ? <p className="mt-4 rounded-xl bg-orange-50 p-3 text-xs text-orange-900">{merchantDraft.demoDisclosure}</p> : null}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button onClick={saveMerchantDraft} disabled={merchantSaveBusy}>{merchantSaveBusy ? "Saving..." : "Save merchant"}</Button>
            <Button variant="secondary" onClick={() => selectedMetric && selectMerchant(selectedMetric.merchant)} disabled={!selectedMetric || merchantSaveBusy}>Reset draft</Button>
            {merchantSaved ? <span className="text-sm text-success">Saved and insight refreshed</span> : null}
          </div>
          </div>
        </div>
      ) : (
        <div className="mt-6 rounded-2xl border border-dashed border-black/15 bg-paper p-5 text-sm text-ink-muted">
          Select a merchant card to edit its profile, products, goals, and rules.
        </div>
      )}

      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_420px]">
        <ExplainabilityPanel title="Merchant explainability">
          <div className="space-y-4">
            <p>
              Merchant-side code refreshes insight snapshots from merchant-side signals. It does not run a live negotiating agent.
              Offer decisions are triggered by user-side wallet events and validated after the negotiation decision.
            </p>
            {(metrics?.merchants ?? []).map((metric) => (
              <div key={metric.merchant.id} className="rounded-xl border border-black/10 bg-paper p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="font-serif text-lg text-ink">{metric.merchant.name}</div>
                  <Badge tone={metric.insight?.businessState === "normal" ? "green" : "purple"}>{metric.insight?.businessState ?? "no insight"}</Badge>
                </div>
                <div className="mb-3 flex flex-wrap gap-2">
                  <Badge tone={metric.merchant.participationStatus === "demo_partner" ? "orange" : metric.merchant.participationStatus?.startsWith("discovered") ? "blue" : "green"}>
                    {metric.merchant.participationStatus === "demo_partner" && metric.merchant.source === "google_places"
                      ? "Demo-onboarded from Google Places discovery"
                      : metric.merchant.participationStatus === "demo_partner" && metric.merchant.source === "osm_overpass"
                      ? "Demo-onboarded from OSM discovery"
                      : metric.merchant.participationStatus === "demo_partner" ? "Demo-onboarded from discovery" : metric.merchant.participationStatus ?? "partner"}
                  </Badge>
                  {metric.merchant.source ? <Badge>{metric.merchant.source}</Badge> : null}
                  {metric.calculatedDistanceMeters !== undefined ? <Badge tone="green">{metric.calculatedDistanceMeters}m from current context</Badge> : null}
                </div>
                <div className="grid gap-3 text-xs md:grid-cols-3">
                  <div>
                    <div className="font-mono uppercase tracking-wider text-ink-muted">Insight calculation</div>
                    <p className="mt-1">
                      {metric.baselineTransactions ?? "-"} baseline vs {metric.currentTransactions ?? "-"} current transactions,
                      drop {metric.insight?.transactionDropPercent ?? "-"}%, urgency {metric.insight?.urgencyScore ?? "-"},
                      readiness {metric.insight?.bundleReadinessScore ?? "-"}.
                    </p>
                  </div>
                  <div>
                    <div className="font-mono uppercase tracking-wider text-ink-muted">Rules</div>
                    <p className="mt-1">
                      Max {metric.merchant.rule?.maxDiscountPercent ?? "-"}%,
                      budget €{metric.merchant.rule?.dailyBudgetRemainingEuro ?? "-"},
                      bundles {metric.merchant.rule?.allowsBundles ? "allowed" : "off"}.
                    </p>
                    <p className="mt-1 text-ink-muted">{metric.merchant.rule?.eligibleProducts.join(", ") ?? "No eligible products"}</p>
                    {metric.merchant.rule?.compiledFreeformRules ? (
                      <p className="mt-1 text-ink-muted">Compiled free-form rules: {metric.merchant.rule.compiledFreeformRules.summary}</p>
                    ) : null}
                    {(metric.merchant.syntheticFields ?? []).length > 0 ? (
                      <p className="mt-1 text-ink-muted">Synthetic/demo fields: {(metric.merchant.syntheticFields ?? []).join(", ")}.</p>
                    ) : null}
                  </div>
                  <div>
                    <div className="font-mono uppercase tracking-wider text-ink-muted">Selection and analytics</div>
                    <p className="mt-1">{metric.notSelectedReason ?? `${metric.offersShown} offer(s), ${metric.tokensRedeemed} redemption(s), €${metric.cashbackIssuedEuro.toFixed(2)} cashback issued.`}</p>
                    <p className="mt-1 text-ink-muted">
                      Coordinates: {metric.merchant.latitude !== undefined && metric.merchant.longitude !== undefined
                        ? `${metric.merchant.latitude.toFixed(5)}, ${metric.merchant.longitude.toFixed(5)}`
                        : "missing; excluded from offers"}
                    </p>
                    {metric.merchant.demoDisclosure ? <p className="mt-1 text-ink-muted">{metric.merchant.demoDisclosure}</p> : null}
                  </div>
                </div>
              </div>
            ))}
            <p className="text-xs">Analytics events shown in the log: {metrics?.events.length ?? 0}.</p>
          </div>
        </ExplainabilityPanel>
        <EventLog events={metrics?.events ?? []} />
      </div>

      <div className="mt-5">
        <JsonPanel title="Dashboard Metrics" data={metrics ? {
          ...metrics,
          merchants: metrics.merchants,
          debugNote: "Merchant metrics are paginated; filters and merchantPage describe this page.",
        } : null} />
      </div>
    </Section>
  );
}

function cloneMerchant(merchant: Merchant): Merchant {
  return JSON.parse(JSON.stringify(merchant)) as Merchant;
}

function defaultMerchantRule(merchant: Merchant): MerchantRule {
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

function RuleHint({ children }: { children: ReactNode }) {
  return <span className="mt-1 block text-[11px] normal-case tracking-normal text-ink-muted">{children}</span>;
}

function TextList({ label, value, onChange }: { label: string; value: string[]; onChange: (next: string[]) => void }) {
  return (
    <label className="text-xs uppercase tracking-wider text-ink-muted">{label}
      <textarea
        className="mt-1 min-h-20 w-full rounded-lg border bg-white px-3 py-2 text-sm normal-case tracking-normal text-ink"
        value={value.join(", ")}
        onChange={(event) => onChange(event.target.value.split(",").map((part) => part.trim()).filter(Boolean))}
      />
    </label>
  );
}

function formatProducts(products: MerchantProduct[]) {
  return products.map((product) => [
    product.name,
    product.priceEuro.toFixed(2),
    product.category,
    product.margin ?? "",
  ].join(" | ").replace(/\s+\|\s+$/, "")).join("\n");
}

function parseProducts(value: string, merchantId: string): MerchantProduct[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [name = "", price = "0", category = "item", margin] = line.split("|").map((part) => part.trim());
      const parsedMargin = margin === "low" || margin === "medium" || margin === "high" ? margin : undefined;
      return {
        id: `product_${merchantId}_${index}`,
        merchantId,
        name,
        priceEuro: Math.max(0, Number(price) || 0),
        category: category || "item",
        margin: parsedMargin,
      };
    });
}
