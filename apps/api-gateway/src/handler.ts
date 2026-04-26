import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import {
  discoveryConfig,
  getCityImportPoiProvider,
  getDefaultCityImportRadiusMeters,
  getGooglePlacesMaxImportedMerchants,
  getGooglePlacesMaxRequestsPerImport,
  googlePlacesImportFieldMask,
  isOverpassImportFallbackEnabled,
  isWalletLiveDiscoveryFallbackEnabled,
  triggerConfig,
} from "@city-wallet/config";
import {
  ActivateCommerceZoneRequestSchema,
  ClaimOfferRequestSchema,
  defaultProviderBudget,
  DevSimulatorPreviewRequestSchema,
  MerchantImportContinueRequestSchema,
  MerchantDashboardQuerySchema,
  MerchantRuleCompilePreviewRequestSchema,
  MerchantUpdateSchema,
  MerchantRuleUpdateSchema,
  MockContextProfileUpsertSchema,
  OrchestrateRequestSchema,
  RedeemTokenRequestSchema,
  UserEventSchema,
  UserProfileUpdateSchema,
  type AgentRunMeta,
  type AgentTrace,
  type AnalyticsEvent,
  type AssembledUserContext,
  type ConnectedSourceChip,
  type ConsumerContextSnapshot,
  type DevSimulatorPreviewResult,
  type Merchant,
  type MerchantInsightSnapshot,
  type MockContextProfile,
  type MockContextProfileOverrides,
  type NearbyMerchantSearchMetadata,
  type NoOfferReason,
  type OrchestrateRequest,
  type OrchestrationResult,
  type TriggerConfig,
  type UserEvent,
  type UserNegotiationPosition,
  type UserProfile,
} from "@city-wallet/contracts";
import { buildConsumerAgentPosition } from "@city-wallet/consumer-agent-domain";
import { OrchestrationRunConflictError, getRepository } from "@city-wallet/db";
import {
  compileAndApplyMerchantRules,
  compileMerchantFreeformRules,
  FreeformRuleCompilationError,
} from "@city-wallet/merchant-intelligence-domain";
import { BackendNegotiatorError } from "@city-wallet/negotiation-domain";
import { createDefaultProviders } from "@city-wallet/providers";
import {
  collectRawSignals,
  computeSignalsHash,
  defaultProviders,
  filterForLLM,
  scenarioPresets,
} from "@city-wallet/raw-context-domain";
import {
  AnalyticsServiceClient,
  ContextServiceClient,
  MerchantIntelligenceServiceClient,
  NegotiationServiceClient,
  OfferServiceClient,
  RedemptionServiceClient,
  ValidationServiceClient,
} from "@city-wallet/service-clients";
import {
  assembleUserContext,
  createDefaultJsonAgentClient,
  getMissingAzureLlmVars,
  isAzureLlmConfigured,
  isContextAgentMode,
  LLMAgentError,
  runUserNegotiator,
} from "@city-wallet/user-agent-domain";
import { calculateDistanceMeters, makeId, nowIso, roundCoordinate, timeBucketKey } from "@city-wallet/utils";

let azureMisconfigWarned = false;

function warnIfAzureMisconfigured() {
  if (azureMisconfigWarned) return;
  if (process.env.LLM_PROVIDER !== "azure_openai") return;
  if (isAzureLlmConfigured()) return;
  azureMisconfigWarned = true;
  const missing = getMissingAzureLlmVars();
  console.warn(
    `[city-wallet] LLM_PROVIDER=azure_openai but the following env vars are missing/empty: ${missing.join(", ")}. ` +
      "Strict mode is on: every orchestration will halt with noOfferReason=agent_failed (errorType=missing_config). " +
      "Set the missing vars or switch LLM_PROVIDER=mock_llm. (AZURE_OPENAI_API_VERSION is optional and defaults to 2024-10-21.)",
  );
}

warnIfAzureMisconfigured();

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  warnIfAzureMisconfigured();

  if (event.requestContext.http.method === "OPTIONS") {
    return json(204, null);
  }

  try {
    const method = event.requestContext.http.method;
    const path = event.rawPath;

    if (method === "POST" && path === "/api/orchestrate") {
      return json(200, await orchestrate(readJson(event)));
    }

    if (method === "POST" && path === "/api/user-events") {
      const parsed = UserEventSchema.parse(readJson(event));
      const saved = await getRepository().saveUserEvent(parsed);
      return json(200, saved);
    }

    if (method === "POST" && path === "/api/merchant-insights/refresh") {
      const clients = makeClients();
      const insights = await clients.merchantIntelligence.refreshInsights();
      await clients.analytics.record({
        type: "merchant_insight_refresh_completed",
        layer: "merchant_intelligence",
        message: `Merchant insight refresh completed for ${insights.length} merchant(s).`,
        payload: summarizeInsights(insights),
      });
      return json(200, insights);
    }

    if (method === "GET" && path === "/api/commerce-zones") {
      return json(200, await getRepository().listCommerceZones());
    }

    if (method === "GET" && path === "/api/commerce-zones/city-suggestions") {
      const clients = makeClients();
      return json(200, await clients.merchantIntelligence.suggestCities({
        query: event.queryStringParameters?.query ?? "",
        country: event.queryStringParameters?.country,
      }));
    }

    if (method === "POST" && path === "/api/commerce-zones/activate") {
      const request = ActivateCommerceZoneRequestSchema.parse(readJson(event));
      const clients = makeClients();
      const result = await clients.merchantIntelligence.activateZone(request);
      await clients.analytics.record({
        type: result.importRun ? "merchant_import_started" : "merchant_import_completed",
        layer: "merchant_intelligence",
        message: result.importRun
          ? `Merchant import ${result.importRun.status} for ${result.zone.name}: ${result.importRun.importedCount} merchant(s).`
          : `Commerce zone preview created for ${result.zone.name}.`,
        payload: result as unknown as Record<string, unknown>,
      });
      return json(200, result);
    }

    if (method === "GET" && path === "/api/merchant-import-runs") {
      return json(200, await getRepository().listMerchantImportRuns(event.queryStringParameters?.zoneId));
    }

    const continueImportMatch = path.match(/^\/api\/merchant-import-runs\/([^/]+)\/continue$/);
    if (method === "POST" && continueImportMatch) {
      const body = MerchantImportContinueRequestSchema.parse({ runId: continueImportMatch[1], ...(readJson(event) as Record<string, unknown>) });
      const clients = makeClients();
      const result = await clients.merchantIntelligence.continueImport(body.runId);
      await clients.analytics.record({
        type: "merchant_import_completed",
        layer: "merchant_intelligence",
        message: `Merchant import ${result.importRun.status}: ${result.importRun.importedCount} merchant(s) imported.`,
        payload: result as unknown as Record<string, unknown>,
      });
      return json(200, result);
    }

    if (method === "GET" && path === "/api/merchants") {
      const zoneId = event.queryStringParameters?.zoneId;
      return json(200, zoneId ? await getRepository().listMerchantsByZone(zoneId) : await getRepository().listMerchants());
    }

    const merchantUpdateMatch = path.match(/^\/api\/merchants\/([^/]+)$/);
    if ((method === "POST" || method === "PATCH") && merchantUpdateMatch) {
      const merchant = MerchantUpdateSchema.parse(readJson(event));
      if (merchant.id !== merchantUpdateMatch[1]) {
        return json(400, { error: "Merchant id in path and payload must match." });
      }
      const repository = getRepository();
      let compiled;
      try {
        compiled = await compileAndApplyMerchantRules(merchant);
      } catch (error) {
        if (error instanceof FreeformRuleCompilationError) {
          return json(400, error.preview ?? { ok: false, error: error.message });
        }
        throw error;
      }
      const saved = await repository.saveMerchant(compiled.merchant);
      const clients = makeClients();
      const insights = await clients.merchantIntelligence.refreshInsights([saved.id]);
      await clients.analytics.record({
        type: "merchant_profile_updated",
        layer: "merchant_intelligence",
        merchantId: saved.id,
        message: `Merchant profile and rules updated for ${saved.name}.`,
        payload: {
          merchantId: saved.id,
          updatedFields: ["profile", "products", "goals", "rules"],
          freeformRulesStatus: saved.rule?.freeformRulesStatus ?? "empty",
          compiledFreeformRules: compiled.preview.compiledRule,
          insightRefreshed: insights.length > 0,
        },
      });
      return json(200, { merchant: saved, insights });
    }

    if (method === "POST" && path === "/api/merchant/rules/compile-preview") {
      const input = MerchantRuleCompilePreviewRequestSchema.parse(readJson(event));
      return json(200, await compileMerchantFreeformRules(input));
    }

    if (method === "GET" && path === "/api/merchant-insights") {
      return json(200, await getRepository().listMerchantInsights());
    }

    if (method === "GET" && path === "/api/merchant/rules") {
      return json(200, await getRepository().listMerchantRules());
    }

    if (method === "POST" && path === "/api/merchant/rules") {
      const rule = MerchantRuleUpdateSchema.parse(readJson(event));
      return json(200, await getRepository().saveMerchantRule(rule));
    }

    if (method === "GET" && path === "/api/offers") {
      return json(200, await getRepository().listOffers(event.queryStringParameters?.userId));
    }

    const offerMatch = path.match(/^\/api\/offers\/([^/]+)$/);
    if (method === "GET" && offerMatch) {
      return json(200, await getRepository().getOffer(offerMatch[1]));
    }

    const claimMatch = path.match(/^\/api\/offers\/([^/]+)\/claim$/);
    if (method === "POST" && claimMatch) {
      const body = ClaimOfferRequestSchema.parse({ offerId: claimMatch[1], ...(readJson(event) as Record<string, unknown>) });
      const clients = makeClients();
      const tokens = await clients.redemption.claim(body.offerId);
      const analyticsEvents = await Promise.all(tokens.map((token) => clients.analytics.record({
        type: "redemption_token_issued",
        layer: "redemption",
        merchantId: token.merchantId,
        offerId: token.offerId,
        message: `Token ${token.code} issued for ${token.merchantName}`,
        payload: token,
      })));
      await clients.analytics.record({
        type: "offer_accepted",
        layer: "offer",
        offerId: body.offerId,
        message: `Offer ${body.offerId} accepted and tokens issued.`,
      });
      return json(200, { tokens, analyticsEvents });
    }

    const rejectMatch = path.match(/^\/api\/offers\/([^/]+)\/reject$/);
    if (method === "POST" && rejectMatch) {
      const offerId = rejectMatch[1]!;
      const repository = getRepository();
      const updated = await repository.updateOfferStatus(offerId, "dismissed");
      if (!updated) return json(404, { error: `No offer ${offerId}` });
      const clients = makeClients();
      await clients.analytics.record({
        type: "offer_rejected",
        layer: "offer",
        offerId,
        message: `Offer ${offerId} rejected by user.`,
        payload: { offerId },
      });
      return json(200, { ok: true, offer: updated });
    }

    if (method === "POST" && path === "/api/consumer/reset") {
      const body = (readJson(event) as { userId?: string }) ?? {};
      const userId = body.userId ?? event.queryStringParameters?.userId ?? "user_mia";
      const repository = getRepository();
      const cleared = await repository.clearUserTransientState(userId);
      const clients = makeClients();
      await clients.analytics.record({
        type: "user_state_cleared",
        layer: "config",
        message: `Transient state cleared for ${userId}.`,
        payload: cleared,
      });
      return json(200, { ok: true, userId, ...cleared });
    }

    if (method === "POST" && path === "/api/redemption/redeem") {
      const input = RedeemTokenRequestSchema.parse(readJson(event));
      const clients = makeClients();
      const result = await clients.redemption.redeem(input);
      if (result.success && result.token) {
        await clients.analytics.record({
          type: "token_redeemed",
          layer: "redemption",
          merchantId: result.token.merchantId,
          offerId: result.token.offerId,
          message: `Token ${result.token.code} redeemed at ${result.token.merchantName}`,
          payload: result as unknown as Record<string, unknown>,
        });
        await clients.analytics.record({
          type: "cashback_issued",
          layer: "redemption",
          merchantId: result.token.merchantId,
          offerId: result.token.offerId,
          message: `€${result.cashbackIssuedEuro.toFixed(2)} cashback issued for ${result.token.product}`,
          payload: result as unknown as Record<string, unknown>,
        });
      }
      return json(200, result);
    }

    if (method === "GET" && path === "/api/consumer/state") {
      const repository = getRepository();
      const userId = event.queryStringParameters?.userId ?? "user_mia";
      const [profile, context, offers, tokens, events, lastRun, activeMock] = await Promise.all([
        repository.getUserProfile(userId),
        repository.getCurrentContext(userId),
        repository.listOffers(userId),
        repository.listRedemptionTokens(),
        repository.listAnalyticsEvents(80),
        repository.getLastDebugRun(),
        repository.getActiveMockContextProfile(userId),
      ]);
      // Surface the active mock profile + its overrides so debug-mode wallet
      // UIs can show "tourist scenario active → walk 2000m" instead of users
      // wondering why their constraints look different.
      const activeMockProfile = activeMock
        ? {
            id: activeMock.id,
            name: activeMock.name,
            activeScenario: activeMock.activeScenario ?? null,
            version: activeMock.version,
            profileOverrides: activeMock.profileOverrides ?? null,
          }
        : null;
      return json(200, { profile, context, offers, tokens, events, lastRun, activeMockProfile });
    }

    if (method === "PATCH" && path === "/api/consumer/profile") {
      const repository = getRepository();
      const userId = event.queryStringParameters?.userId ?? "user_mia";
      const update = UserProfileUpdateSchema.parse(readJson(event));
      const existing = await repository.getUserProfile(userId);
      const merged: UserProfile = {
        userId,
        displayName: existing?.displayName ?? "User",
        privacyMode: update.privacyMode ?? existing?.privacyMode ?? "high",
        rewardPreference: update.rewardPreference ?? existing?.rewardPreference ?? "cashback",
        walkingToleranceMeters: update.walkingToleranceMeters ?? existing?.walkingToleranceMeters ?? 600,
        maxBundleStops: update.maxBundleStops ?? existing?.maxBundleStops ?? 2,
        maxOffersPerHour: update.maxOffersPerHour ?? existing?.maxOffersPerHour ?? 1,
      };
      const saved = await repository.saveUserProfile(merged);
      return json(200, saved);
    }

    if (method === "GET" && path === "/api/consumer/connected-sources") {
      const userId = event.queryStringParameters?.userId ?? "user_mia";
      return json(200, await buildConnectedSourceChips(userId));
    }

    if (method === "GET" && path === "/api/geocode/reverse") {
      const lat = Number(event.queryStringParameters?.lat);
      const lng = Number(event.queryStringParameters?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return json(400, { error: "lat and lng query params are required and must be numbers" });
      }
      return json(200, await reverseGeocodeForWallet(lat, lng));
    }

    if (method === "GET" && path === "/api/consumer/context-summary") {
      const userId = event.queryStringParameters?.userId ?? "user_mia";
      return json(200, await buildContextSummary(userId));
    }

    if (method === "GET" && path === "/api/consumer/context-profile-version") {
      const userId = event.queryStringParameters?.userId ?? "user_mia";
      const profile = await getRepository().getActiveMockContextProfile(userId);
      return json(200, {
        profileId: profile?.id ?? null,
        version: profile?.version ?? 0,
        updatedAt: profile?.updatedAt ?? null,
      });
    }

    if (path.startsWith("/api/dev/context-simulator")) {
      if (process.env.ENABLE_DEV_CONTEXT_SIMULATOR !== "true") {
        return json(404, { error: "Dev context simulator is disabled." });
      }
      return await handleDevSimulator(method, path, event);
    }

    if (method === "GET" && path === "/api/merchant/dashboard") {
      const clients = makeClients();
      const query = MerchantDashboardQuerySchema.parse(event.queryStringParameters ?? {});
      return json(200, await clients.analytics.merchantDashboard(query));
    }

    if (method === "POST" && (path === "/api/dev/reset-seed-data" || path === "/api/seed/reset")) {
      if (process.env.ENABLE_DEV_RESET !== "true") {
        return json(403, { error: "Dev seed reset is disabled. Use pnpm db:seed as the reset path." });
      }
      await getRepository().resetToSeed();
      return json(200, { ok: true });
    }

    if (method === "GET" && path === "/api/debug/last-run") {
      return json(200, await getRepository().getLastDebugRun());
    }

    if (method === "GET" && path === "/api/debug/config") {
      const googlePlacesApiKey = process.env.GOOGLE_PLACES_API_KEY ?? "";
      return json(200, {
        cityImportPoiProvider: getCityImportPoiProvider(),
        cityImportPoiProviderEnv: process.env.CITY_IMPORT_POI_PROVIDER ?? null,
        googlePlacesApiKeyPresent: googlePlacesApiKey.length > 0,
        googlePlacesApiKeyPreview: googlePlacesApiKey ? maskSecret(googlePlacesApiKey) : null,
        googlePlacesMaxRequestsPerImport: getGooglePlacesMaxRequestsPerImport(),
        googlePlacesMaxImportedMerchants: getGooglePlacesMaxImportedMerchants(),
        googlePlacesDefaultRadiusMeters: getDefaultCityImportRadiusMeters(),
        googlePlacesFieldMask: googlePlacesImportFieldMask,
        placeDetailsDisabled: true,
        overpassImportFallbackEnabled: isOverpassImportFallbackEnabled(),
      });
    }

    return json(404, { error: `No route for ${method} ${path}` });
  } catch (error) {
    console.error(error);
    return json(500, {
      error: error instanceof Error ? error.message : "Unknown API Gateway error",
    });
  }
}

export async function orchestrate(body: unknown): Promise<OrchestrationResult> {
  const input = OrchestrateRequestSchema.parse(body);
  const repository = getRepository();
  const clients = makeClients();
  const analyticsEvents: AnalyticsEvent[] = [];
  const activeMockProfile = await repository.getActiveMockContextProfile(input.userId);
  const idempotencyKey = input.idempotencyKey ?? createIdempotencyKey(input, activeMockProfile);

  const earlyReturn = await resolveExistingOrchestrationRun(repository, idempotencyKey);
  if (earlyReturn) return earlyReturn;

  try {
    await repository.createOrchestrationRun({
      idempotencyKey,
      userId: input.userId,
      eventType: input.eventType,
      status: "running",
      resultJson: null,
      errorJson: null,
    });
  } catch (error) {
    if (error instanceof OrchestrationRunConflictError) {
      // A concurrent orchestrate() call inserted the row first. Re-read and
      // dispatch the same way as if we'd seen it in the initial check.
      const concurrent = await resolveExistingOrchestrationRun(repository, idempotencyKey);
      if (concurrent) return concurrent;
      // The row was deleted between the conflict and our re-read. Surface as
      // "already running" so the client retries with backoff instead of
      // blowing up.
      return makeAlreadyRunningResult(idempotencyKey);
    }
    throw error;
  }

  try {
    const providerBudget = defaultProviderBudget();
    const consumerContext = await clients.context.buildContext({
      userId: input.userId,
      location: input.location,
      declaredContext: input.declaredContext,
      providerBudget,
    });
    await repository.updateOrchestrationRun(idempotencyKey, { contextSnapshotId: consumerContext.snapshotId });

    // The user has not granted live location yet. The wallet is responsible
    // for prompting (e.g. via the lunch-break notification CTA). Short-circuit
    // the pipeline with a clear `location_required` reason so the UI can
    // render the right state without surfacing offers built on stale fallback
    // data.
    if (consumerContext.locationMode === "no_location") {
      analyticsEvents.push(await clients.analytics.record({
        type: "no_offer_emitted",
        layer: "context",
        message: "Halting orchestration with no_offer (location_required).",
        payload: { reason: "location_required" },
      }));
      return completeRun({
        repository,
        idempotencyKey,
        result: {
          triggered: false,
          reason: "no_trigger_matched",
          idempotencyKey,
          orchestrationStatus: "completed",
          matchedTriggers: [],
          consumerContext,
          merchantInsights: [],
          candidateMerchants: [],
          bundleCandidates: [],
          analyticsEvents,
          providerBudget,
          discoveredMerchants: [],
          offers: [],
          noOfferReason: "location_required",
        },
      });
    }

    const eventPayload = {
      ...(input.declaredContext ?? {}),
      locationMode: consumerContext.locationMode,
      zoneId: consumerContext.zoneId,
      matchedZones: consumerContext.matchedZones.map((zone) => zone.id),
      geofenceMatched: consumerContext.geofenceMatched,
    };
    const userEvents = buildUserEvents(input, eventPayload, consumerContext);
    for (const event of userEvents) {
      await repository.saveUserEvent(event);
    }

    const matchedTriggers = evaluateTriggersOnce(userEvents, consumerContext);
    for (const trigger of matchedTriggers) {
      const matchedEvent = userEvents.find((event) => event.eventType === trigger.eventType) ?? userEvents[0];
      await repository.saveTriggerMatch({
        id: makeId("trigger_match"),
        userEventId: matchedEvent.eventId,
        triggerId: trigger.id,
        matchedAt: nowIso(),
      });
    }

    analyticsEvents.push(await clients.analytics.record({
      type: "context_refreshed",
      layer: "context",
      message: `Consumer context refreshed for ${input.userId}.`,
      payload: consumerContext,
    }));
    analyticsEvents.push(await clients.analytics.record({
      type: "trigger_matched",
      layer: "config",
      message: matchedTriggers.length > 0
        ? `${matchedTriggers.length} trigger(s) matched after context assembly.`
        : "No trigger matched after context assembly.",
      payload: { eventTypes: userEvents.map((event) => event.eventType), matchedTriggers },
    }));
    for (const fallback of providerBudget.fallbackEvents) {
      analyticsEvents.push(await clients.analytics.record({
        type: "provider_fallback_used",
        layer: "providers",
        message: `${fallback.provider} fallback used: ${fallback.reason}`,
        payload: fallback,
      }));
    }

    if (matchedTriggers.length === 0) {
      const result = await completeRun({
        repository,
        idempotencyKey,
        result: {
          triggered: false,
          reason: "no_trigger_matched",
          idempotencyKey,
          orchestrationStatus: "completed",
          matchedTriggers,
          consumerContext,
          merchantInsights: [],
          candidateMerchants: [],
          bundleCandidates: [],
          analyticsEvents,
          providerBudget,
          discoveredMerchants: [],
        },
      });
      return result;
    }

    const activeOffer = await findActiveUnexpiredOffer(repository, input.userId);
    if (activeOffer) {
      analyticsEvents.push(await clients.analytics.record({
        type: "orchestration_blocked",
        layer: "offer",
        offerId: activeOffer.offerId,
        message: "Negotiation blocked because an active unexpired offer already exists.",
        payload: { reason: "active_offer_exists" },
      }));
      return completeRun({
        repository,
        idempotencyKey,
        result: {
          triggered: false,
          reason: "active_offer_exists",
          idempotencyKey,
          orchestrationStatus: "completed",
          matchedTriggers,
          consumerContext,
          merchantInsights: [],
          candidateMerchants: [],
          bundleCandidates: [],
          offer: activeOffer,
          analyticsEvents,
          providerBudget,
          discoveredMerchants: [],
        },
      });
    }

    const cooldown = await evaluateCooldown(repository, input.userId, consumerContext.maxOffersPerHour);
    if (cooldown.blocked) {
      analyticsEvents.push(await clients.analytics.record({
        type: "orchestration_blocked",
        layer: "offer",
        message: "Negotiation blocked by offer cooldown.",
        payload: cooldown,
      }));
      return completeRun({
        repository,
        idempotencyKey,
        result: {
          triggered: false,
          reason: "cooldown_active",
          idempotencyKey,
          orchestrationStatus: "completed",
          retryAfterMs: cooldown.retryAfterMs,
          matchedTriggers,
          consumerContext,
          merchantInsights: [],
          candidateMerchants: [],
          bundleCandidates: [],
          analyticsEvents,
          providerBudget,
          discoveredMerchants: [],
        },
      });
    }

    let storedSupply = await loadStoredMerchantsForWallet(repository, consumerContext);
    let discoveredMerchants: Merchant[] = [];
    if (storedSupply.metadata.eligibleMerchantCount < 2 && isWalletLiveDiscoveryFallbackEnabled()) {
      discoveredMerchants = await clients.merchantIntelligence.discover({ context: consumerContext, budget: providerBudget });
      analyticsEvents.push(...await Promise.all(discoveredMerchants.map((merchant) => clients.analytics.record({
        type: "merchant_discovered",
        layer: "providers",
        merchantId: merchant.id,
        message: `${merchant.name} discovered via ${merchant.source}; status ${merchant.participationStatus}.`,
        payload: merchant,
      }))));
    }

    const persistedProfile = await repository.getUserProfile(input.userId);
    if (!persistedProfile) throw new Error(`Unknown user ${input.userId}`);
    if (discoveredMerchants.length > 0) {
      storedSupply = await loadStoredMerchantsForWallet(repository, consumerContext);
    }

    // Active mock profile overrides take precedence for this run only. The
    // user's persisted UserProfile is never mutated here.
    const overrides = activeMockProfile?.profileOverrides;
    const profile = applyOverridesToUserProfile(persistedProfile, overrides);
    const overriddenContext = applyOverridesToContext(consumerContext, overrides);

    const negotiationContext: ConsumerContextSnapshot = storedSupply.metadata.radiusUsedMeters
      ? { ...overriddenContext, walkingToleranceMeters: Math.max(overriddenContext.walkingToleranceMeters, storedSupply.metadata.radiusUsedMeters) }
      : overriddenContext;

    if (overrides) {
      analyticsEvents.push(await clients.analytics.record({
        type: "context_refreshed",
        layer: "config",
        message: `Active mock profile "${activeMockProfile!.name}" applied profile overrides.`,
        payload: {
          profileId: activeMockProfile!.id,
          profileVersion: activeMockProfile!.version,
          activeScenario: activeMockProfile!.activeScenario ?? null,
          overrides,
          effective: {
            walkingToleranceMeters: profile.walkingToleranceMeters,
            maxBundleStops: profile.maxBundleStops,
            maxOffersPerHour: profile.maxOffersPerHour,
            rewardPreference: profile.rewardPreference,
            privacyMode: profile.privacyMode,
            declaredIntent: negotiationContext.declaredIntent,
            availableMinutes: negotiationContext.availableMinutes,
          },
        },
      }));
    }

    const userContextPipeline = await runUserContextPipeline({
      userId: input.userId,
      mockProfile: activeMockProfile,
      consumerContext: negotiationContext,
      userProfile: profile,
      nearbyMerchantCount: storedSupply.merchants.length,
      analyticsClient: clients.analytics,
      repository,
    });
    analyticsEvents.push(...userContextPipeline.analyticsEvents);
    if (userContextPipeline.haltWithNoOffer) {
      analyticsEvents.push(await clients.analytics.record({
        type: "no_offer_emitted",
        layer: "user_agent",
        message: `Halting orchestration with no_offer (${userContextPipeline.noOfferReason}).`,
        payload: { reason: userContextPipeline.noOfferReason, agentTrace: userContextPipeline.agentTrace },
      }));
      return completeRun({
        repository,
        idempotencyKey,
        result: {
          triggered: true,
          reason: "no_trigger_matched",
          idempotencyKey,
          orchestrationStatus: "completed",
          matchedTriggers,
          consumerContext: negotiationContext,
          merchantInsights: [],
          candidateMerchants: [],
          bundleCandidates: [],
          analyticsEvents,
          providerBudget,
          discoveredMerchants,
          assembledUserContext: null,
          userNegotiationPosition: null,
          agentTrace: userContextPipeline.agentTrace,
          noOfferReason: userContextPipeline.noOfferReason,
        },
      });
    }

    const consumerAgentPosition = buildConsumerAgentPosition(profile, negotiationContext);
    const merchants = storedSupply.merchants;
    const merchantInsights = await clients.merchantIntelligence.refreshInsights(merchants.map((merchant) => merchant.id));
    analyticsEvents.push(await clients.analytics.record({
      type: "merchant_insight_refresh_completed",
      layer: "merchant_intelligence",
      message: `Merchant insight refresh completed for ${merchantInsights.length} nearby candidate merchant(s).`,
      payload: {
        ...summarizeInsights(merchantInsights),
        scope: "nearby_candidate_merchants",
        nearbyMerchantSearch: storedSupply.metadata,
      },
    }));

    const userEvent = userEvents.find((event) => event.eventType === input.eventType) ?? userEvents[0];
    analyticsEvents.push(await clients.analytics.record({
      type: "negotiation_requested",
      layer: "negotiation",
      message: "Negotiation requested from user-side event after context assembly.",
      payload: { userEvent, consumerAgentPosition, idempotencyKey },
    }));

    let negotiation: Awaited<ReturnType<typeof clients.negotiation.negotiate>>;
    const negotiationStart = Date.now();
    try {
      negotiation = await clients.negotiation.negotiate({
        userEvent,
        consumerContext: negotiationContext,
        consumerAgentPosition,
        merchants,
        merchantInsights,
        assembledUserContext: userContextPipeline.assembledUserContext,
        userNegotiationPosition: userContextPipeline.userNegotiationPosition,
      });
    } catch (error) {
      if (error instanceof BackendNegotiatorError) {
        console.warn(`[api-gateway] backend negotiator failed (${error.type}): ${error.message}`);
        const backendNegotiatorTrace: AgentRunMeta = {
          provider: "azure_openai",
          validationStatus: "failed",
          errorType: error.type,
          latencyMs: Date.now() - negotiationStart,
        };
        const agentTraceWithBackend: AgentTrace = {
          ...(userContextPipeline.agentTrace ?? { assembler: null, userNegotiator: null }),
          backendNegotiator: backendNegotiatorTrace,
        };
        analyticsEvents.push(await clients.analytics.record({
          type: "backend_negotiator_failed",
          layer: "negotiation",
          message: `Backend negotiator failed: ${error.type}.`,
          payload: { errorType: error.type, message: error.message },
        }));
        analyticsEvents.push(await clients.analytics.record({
          type: "no_offer_emitted",
          layer: "negotiation",
          message: "Halting orchestration with no_offer (agent_failed) due to backend negotiator failure.",
          payload: { reason: "agent_failed", source: "backend_negotiator", errorType: error.type },
        }));
        return completeRun({
          repository,
          idempotencyKey,
          result: {
            triggered: true,
            reason: "no_trigger_matched",
            idempotencyKey,
            orchestrationStatus: "completed",
            matchedTriggers,
            consumerContext: negotiationContext,
            consumerAgentPosition,
            merchantInsights,
            candidateMerchants: [],
            bundleCandidates: [],
            analyticsEvents,
            providerBudget,
            discoveredMerchants,
            assembledUserContext: userContextPipeline.assembledUserContext,
            userNegotiationPosition: userContextPipeline.userNegotiationPosition,
            agentTrace: agentTraceWithBackend,
            noOfferReason: "agent_failed",
          },
        });
      }
      throw error;
    }
    await repository.saveNegotiationBrief(negotiation.negotiationBrief);
    const decisionId = makeId("decision");
    // Re-validate the parsed decision shape before persisting so a malformed
    // payload (e.g. from a misbehaving non-Azure HTTP backend) surfaces a clean
    // no_offer instead of a Prisma "Argument decisionType is missing" crash.
    const decisionShapeOk =
      negotiation.negotiationDecision &&
      typeof (negotiation.negotiationDecision as { decision?: unknown }).decision === "string" &&
      Array.isArray((negotiation.negotiationDecision as { selectedMerchants?: unknown }).selectedMerchants);
    if (!decisionShapeOk) {
      console.warn("[api-gateway] backend negotiator returned a malformed NegotiationDecision; halting with no_offer.");
      const backendNegotiatorTrace: AgentRunMeta = {
        provider: "azure_openai",
        validationStatus: "failed",
        errorType: "schema_validation_failed",
        latencyMs: Date.now() - negotiationStart,
      };
      const agentTraceWithBackend: AgentTrace = {
        ...(userContextPipeline.agentTrace ?? { assembler: null, userNegotiator: null }),
        backendNegotiator: backendNegotiatorTrace,
      };
      analyticsEvents.push(await clients.analytics.record({
        type: "backend_negotiator_failed",
        layer: "negotiation",
        message: "Backend negotiator returned a malformed NegotiationDecision.",
        payload: { errorType: "schema_validation_failed" },
      }));
      analyticsEvents.push(await clients.analytics.record({
        type: "no_offer_emitted",
        layer: "negotiation",
        message: "Halting orchestration with no_offer (agent_failed) due to malformed negotiator output.",
        payload: { reason: "agent_failed", source: "backend_negotiator", errorType: "schema_validation_failed" },
      }));
      return completeRun({
        repository,
        idempotencyKey,
        result: {
          triggered: true,
          reason: "no_trigger_matched",
          idempotencyKey,
          orchestrationStatus: "completed",
          matchedTriggers,
          consumerContext: negotiationContext,
          consumerAgentPosition,
          merchantInsights,
          candidateMerchants: negotiation.candidateMerchants ?? [],
          bundleCandidates: negotiation.bundleCandidates ?? [],
          analyticsEvents,
          providerBudget,
          discoveredMerchants,
          assembledUserContext: userContextPipeline.assembledUserContext,
          userNegotiationPosition: userContextPipeline.userNegotiationPosition,
          agentTrace: agentTraceWithBackend,
          noOfferReason: "agent_failed",
        },
      });
    }
    await repository.saveNegotiationDecision(decisionId, negotiation.negotiationBrief.briefId, negotiation.negotiationDecision);
    const backendNegotiatorTrace: AgentRunMeta = {
      provider: "azure_openai",
      validationStatus: "ok",
      latencyMs: Date.now() - negotiationStart,
    };
    const agentTraceWithBackend: AgentTrace = {
      ...(userContextPipeline.agentTrace ?? { assembler: null, userNegotiator: null }),
      backendNegotiator: backendNegotiatorTrace,
    };
    analyticsEvents.push(await clients.analytics.record({
      type: "negotiation_decision_created",
      layer: "negotiation",
      message: `Decision created: ${negotiation.negotiationDecision.decision}.`,
      payload: negotiation.negotiationDecision,
    }));

    // Multi-offer fan-out: validate per-merchant and persist N independent
    // Offer rows. Single/bundle stays on the original code path so existing
    // wallets and tests continue to read `result.offer`.
    const decision = negotiation.negotiationDecision;
    let validationResult;
    let offer = null;
    let offers: import("@city-wallet/contracts").Offer[] = [];
    if (decision.decision === "multi_offer") {
      const { validateMultiOfferDecision } = await import("@city-wallet/validation-domain");
      const multi = validateMultiOfferDecision({
        decision,
        merchants,
        context: negotiationContext,
      });
      validationResult = multi.overall;
      await repository.saveValidationResult(makeId("validation"), decisionId, validationResult);
      analyticsEvents.push(await clients.analytics.record({
        type: "offer_validated",
        layer: "validation",
        message: validationResult.valid
          ? `Multi-offer validators accepted ${multi.validSelections.length}/${decision.selectedMerchants.length} entries.`
          : `Multi-offer validators rejected all entries: ${validationResult.errors.join(", ")}`,
        payload: validationResult,
      }));
      // Each valid selection becomes its own single_offer Offer row, sharing
      // the run's headline/subheadline only as a label fallback when the LLM
      // didn't supply per-intent copy.
      for (const selection of multi.validSelections) {
        const merchant = merchants.find((candidate) => candidate.id === selection.merchantId);
        const intentLabel = selection.intentLabel ?? "offer";
        const perOfferDecision: import("@city-wallet/contracts").NegotiationDecision = {
          ...decision,
          decision: "single_offer",
          selectedMerchants: [selection],
          consumerHeadline: humanizeIntent(intentLabel, merchant?.name),
          consumerSubheadline: merchant?.name
            ? `${merchant.name} - ${selection.product}`
            : selection.product,
        };
        const created = await clients.offer.create({
          decision: perOfferDecision,
          merchants,
          context: negotiationContext,
        });
        if (created) offers.push(created);
      }
      analyticsEvents.push(await clients.analytics.record({
        type: "multi_offer_emitted",
        layer: "offer",
        message: `Multi-offer run produced ${offers.length} offer(s).`,
        payload: {
          totalSelections: decision.selectedMerchants.length,
          validSelections: multi.validSelections.length,
          intents: offers.map((entry) => ({ offerId: entry.offerId, headline: entry.headline })),
        },
      }));
      for (const entry of offers) {
        analyticsEvents.push(await clients.analytics.record({
          type: "offer_shown",
          layer: "offer",
          offerId: entry.offerId,
          message: `Offer shown: ${entry.headline}`,
          payload: entry,
        }));
      }
    } else {
      validationResult = await clients.validation.validate({
        decision,
        merchants,
        context: negotiationContext,
      });
      await repository.saveValidationResult(makeId("validation"), decisionId, validationResult);
      analyticsEvents.push(await clients.analytics.record({
        type: "offer_validated",
        layer: "validation",
        message: validationResult.valid ? "Offer decision passed validators." : `Validation failed: ${validationResult.errors.join(", ")}`,
        payload: validationResult,
      }));
      offer = validationResult.valid
        ? await clients.offer.create({
            decision,
            merchants,
            context: negotiationContext,
          })
        : null;
      if (offer) {
        offers = [offer];
        analyticsEvents.push(await clients.analytics.record({
          type: "offer_shown",
          layer: "offer",
          offerId: offer.offerId,
          message: `Offer shown: ${offer.headline}`,
          payload: offer,
        }));
      }
    }

    let postNegotiationNoOfferReason: NoOfferReason | undefined;
    if (!validationResult.valid) {
      postNegotiationNoOfferReason = "validation_failed";
    } else if (decision.decision === "no_offer") {
      postNegotiationNoOfferReason = "negotiator_returned_no_offer";
    } else if (decision.decision === "multi_offer" && offers.length === 0) {
      postNegotiationNoOfferReason = "validation_failed";
    }

    return completeRun({
      repository,
      idempotencyKey,
      result: {
        triggered: true,
        idempotencyKey,
        orchestrationStatus: "completed",
        matchedTriggers,
        consumerContext: negotiationContext,
        consumerAgentPosition,
        merchantInsights,
        candidateMerchants: negotiation.candidateMerchants,
        bundleCandidates: negotiation.bundleCandidates,
        negotiationBrief: negotiation.negotiationBrief,
        negotiationDecision: decision,
        validationResult,
        offer,
        offers,
        analyticsEvents,
        providerBudget,
        discoveredMerchants,
        assembledUserContext: userContextPipeline.assembledUserContext,
        userNegotiationPosition: userContextPipeline.userNegotiationPosition,
        agentTrace: agentTraceWithBackend,
        noOfferReason: postNegotiationNoOfferReason,
        nearbyMerchantSearch: {
          ...storedSupply.metadata,
          liveDiscoveryFallbackUsed: discoveredMerchants.length > 0,
          source: discoveredMerchants.length > 0 ? "stored_db_with_live_fallback" : "stored_db",
        },
      },
    });
  } catch (error) {
    await repository.updateOrchestrationRun(idempotencyKey, {
      status: "failed",
      errorJson: {
        reason: "orchestration_failed",
        message: error instanceof Error ? error.message : "Unknown orchestration failure",
      },
    });
    throw error;
  }
}

type UserContextPipelineResult = {
  assembledUserContext: AssembledUserContext | null;
  userNegotiationPosition: UserNegotiationPosition | null;
  agentTrace?: AgentTrace;
  haltWithNoOffer: boolean;
  noOfferReason?: NoOfferReason;
  analyticsEvents: AnalyticsEvent[];
};

// Apply a mock profile's transient overrides on top of the user's persisted
// UserProfile. Used by the dev simulator and any test harness so that a
// "tourist" scenario actually widens the walking radius (etc.) for that run
// without overwriting the user's saved preferences.
function applyOverridesToUserProfile(
  profile: UserProfile,
  overrides: MockContextProfileOverrides | undefined,
): UserProfile {
  if (!overrides) return profile;
  return {
    ...profile,
    walkingToleranceMeters: overrides.walkingToleranceMeters ?? profile.walkingToleranceMeters,
    maxBundleStops: overrides.maxBundleStops ?? profile.maxBundleStops,
    maxOffersPerHour: overrides.maxOffersPerHour ?? profile.maxOffersPerHour,
    rewardPreference: overrides.rewardPreference ?? profile.rewardPreference,
    privacyMode: overrides.privacyMode ?? profile.privacyMode,
  };
}

// Mirror those overrides into the ConsumerContextSnapshot so candidate
// filtering, validators, and the legacy consumer agent all see the same
// effective constraints as the LLM agents.
function applyOverridesToContext(
  context: ConsumerContextSnapshot,
  overrides: MockContextProfileOverrides | undefined,
): ConsumerContextSnapshot {
  if (!overrides) return context;
  return {
    ...context,
    walkingToleranceMeters: overrides.walkingToleranceMeters ?? context.walkingToleranceMeters,
    maxBundleStops: overrides.maxBundleStops ?? context.maxBundleStops,
    maxOffersPerHour: overrides.maxOffersPerHour ?? context.maxOffersPerHour,
    rewardPreference: overrides.rewardPreference ?? context.rewardPreference,
    privacyMode: overrides.privacyMode ?? context.privacyMode,
    declaredIntent: overrides.declaredIntent ?? context.declaredIntent,
    availableMinutes: overrides.availableMinutes ?? context.availableMinutes,
  };
}

async function runUserContextPipeline(input: {
  userId: string;
  mockProfile: MockContextProfile | null;
  consumerContext: ConsumerContextSnapshot;
  userProfile: UserProfile;
  nearbyMerchantCount: number;
  analyticsClient: AnalyticsServiceClient;
  repository: ReturnType<typeof getRepository>;
}): Promise<UserContextPipelineResult> {
  const analyticsEvents: AnalyticsEvent[] = [];
  const azureMode = isContextAgentMode();
  const contextSnapshotId = input.consumerContext.snapshotId;

  if (azureMode !== "azure_openai") {
    analyticsEvents.push(await input.analyticsClient.record({
      type: "user_context_assembler_skipped",
      layer: "user_agent",
      message: "User context assembler skipped: LLM_PROVIDER is not azure_openai.",
      payload: { contextSnapshotId, reason: "azure_required" },
    }));
    analyticsEvents.push(await input.analyticsClient.record({
      type: "user_negotiator_skipped",
      layer: "user_agent",
      message: "User negotiator skipped: LLM_PROVIDER is not azure_openai.",
      payload: { contextSnapshotId, reason: "azure_required" },
    }));
    await input.repository.saveUserContextAgentRun({
      id: makeId("ucar"),
      userId: input.userId,
      contextSnapshotId,
      stage: "assembler",
      provider: "skipped",
      model: undefined,
      latencyMs: undefined,
      validationStatus: "skipped",
      errorType: "azure_required",
      outputJson: null,
      createdAt: nowIso(),
    });
    await input.repository.saveUserContextAgentRun({
      id: makeId("ucar"),
      userId: input.userId,
      contextSnapshotId,
      stage: "user_negotiator",
      provider: "skipped",
      model: undefined,
      latencyMs: undefined,
      validationStatus: "skipped",
      errorType: "azure_required",
      outputJson: null,
      createdAt: nowIso(),
    });
    return {
      assembledUserContext: null,
      userNegotiationPosition: null,
      agentTrace: {
        assembler: { provider: "skipped", validationStatus: "skipped", errorType: "azure_required" },
        userNegotiator: { provider: "skipped", validationStatus: "skipped", errorType: "azure_required" },
      },
      haltWithNoOffer: false,
      analyticsEvents,
    };
  }

  const client = createDefaultJsonAgentClient();
  if (!client) {
    analyticsEvents.push(await input.analyticsClient.record({
      type: "user_context_assembler_failed",
      layer: "user_agent",
      message: "User context assembler unavailable: Azure OpenAI client could not be created.",
      payload: { contextSnapshotId, reason: "missing_config" },
    }));
    return {
      assembledUserContext: null,
      userNegotiationPosition: null,
      agentTrace: {
        assembler: { provider: "azure_openai", validationStatus: "failed", errorType: "missing_config" },
        userNegotiator: null,
      },
      haltWithNoOffer: true,
      noOfferReason: "agent_failed",
      analyticsEvents,
    };
  }

  const collected = await collectRawSignals({
    userId: input.userId,
    profile: input.mockProfile,
    snapshot: input.consumerContext,
    providers: defaultProviders,
  });
  const filtered = filterForLLM(collected.signals);
  const signalsHash = computeSignalsHash({
    profileId: input.mockProfile?.id ?? null,
    profileVersion: input.mockProfile?.version ?? null,
    signals: filtered.signals,
  });

  analyticsEvents.push(await input.analyticsClient.record({
    type: "context_refreshed",
    layer: "raw_context",
    message: `Raw context signals collected (${collected.signals.length} sources, ${collected.disabledSources.length} disabled).`,
    payload: {
      contextSnapshotId,
      enabledSources: collected.enabledSources,
      disabledSources: collected.disabledSources,
      signalsHash,
      privacyMetadata: filtered.metadata,
    },
  }));

  const agentTrace: AgentTrace = { assembler: null, userNegotiator: null };
  let assembled: AssembledUserContext | null = null;
  const assemblerTimeoutMs = Number(process.env.USER_CONTEXT_AGENT_TIMEOUT_MS ?? 45000);
  try {
    const assembleResult = await assembleUserContext({
      userId: input.userId,
      contextSnapshotId,
      bundle: filtered,
      consumerSnapshot: input.consumerContext,
      userProfile: input.userProfile,
      client,
      timeoutMs: assemblerTimeoutMs,
    });
    assembled = assembleResult.context;
    agentTrace.assembler = {
      validationStatus: assembleResult.validationStatus,
      provider: assembleResult.provider,
      model: assembleResult.model,
      latencyMs: assembleResult.latencyMs,
    };
    await input.repository.saveUserContextAgentRun({
      id: makeId("ucar"),
      userId: input.userId,
      contextSnapshotId,
      stage: "assembler",
      provider: assembleResult.provider,
      model: assembleResult.model,
      latencyMs: assembleResult.latencyMs,
      validationStatus: assembleResult.validationStatus,
      errorType: undefined,
      outputJson: JSON.stringify(assembled),
      createdAt: nowIso(),
    });
    analyticsEvents.push(await input.analyticsClient.record({
      type: "user_context_assembled",
      layer: "user_agent",
      message: `User context assembled (status: ${assembleResult.validationStatus}, intent: ${assembled.inferredIntent}).`,
      payload: { contextSnapshotId, validationStatus: assembleResult.validationStatus, latencyMs: assembleResult.latencyMs },
    }));
  } catch (error) {
    const errorType = error instanceof LLMAgentError ? error.type : "unknown";
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn(
      `[city-wallet] User context assembler failed (${errorType}): ${errorMessage}`,
    );
    agentTrace.assembler = { provider: "azure_openai", validationStatus: "failed", errorType };
    await input.repository.saveUserContextAgentRun({
      id: makeId("ucar"),
      userId: input.userId,
      contextSnapshotId,
      stage: "assembler",
      provider: "azure_openai",
      model: undefined,
      latencyMs: undefined,
      validationStatus: "failed",
      errorType,
      outputJson: null,
      createdAt: nowIso(),
    });
    analyticsEvents.push(await input.analyticsClient.record({
      type: "user_context_assembler_failed",
      layer: "user_agent",
      message: `User context assembler failed: ${errorType}.`,
      payload: { contextSnapshotId, errorType },
    }));
    return {
      assembledUserContext: null,
      userNegotiationPosition: null,
      agentTrace,
      haltWithNoOffer: true,
      noOfferReason: "agent_failed",
      analyticsEvents,
    };
  }

  const negotiatorTimeoutMs = Number(process.env.USER_NEGOTIATOR_AGENT_TIMEOUT_MS ?? 45000);
  let userNegotiationPosition: UserNegotiationPosition | null = null;
  try {
    const negotiatorResult = await runUserNegotiator({
      userId: input.userId,
      contextSnapshotId,
      assembledContext: assembled,
      consumerSnapshot: input.consumerContext,
      userProfile: input.userProfile,
      nearbyMerchantCount: input.nearbyMerchantCount,
      client,
      timeoutMs: negotiatorTimeoutMs,
    });
    userNegotiationPosition = negotiatorResult.position;
    agentTrace.userNegotiator = {
      validationStatus: negotiatorResult.validationStatus,
      provider: negotiatorResult.provider,
      model: negotiatorResult.model,
      latencyMs: negotiatorResult.latencyMs,
    };
    await input.repository.saveUserContextAgentRun({
      id: makeId("ucar"),
      userId: input.userId,
      contextSnapshotId,
      stage: "user_negotiator",
      provider: negotiatorResult.provider,
      model: negotiatorResult.model,
      latencyMs: negotiatorResult.latencyMs,
      validationStatus: negotiatorResult.validationStatus,
      errorType: undefined,
      outputJson: JSON.stringify(userNegotiationPosition),
      createdAt: nowIso(),
    });
    analyticsEvents.push(await input.analyticsClient.record({
      type: "user_negotiator_position_built",
      layer: "user_agent",
      message: `User negotiator position built (status: ${negotiatorResult.validationStatus}, shouldNegotiate: ${userNegotiationPosition.shouldNegotiate}).`,
      payload: { contextSnapshotId, validationStatus: negotiatorResult.validationStatus, latencyMs: negotiatorResult.latencyMs },
    }));
  } catch (error) {
    const errorType = error instanceof LLMAgentError ? error.type : "unknown";
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn(
      `[city-wallet] User negotiator agent failed (${errorType}): ${errorMessage}`,
    );
    agentTrace.userNegotiator = { provider: "azure_openai", validationStatus: "failed", errorType };
    await input.repository.saveUserContextAgentRun({
      id: makeId("ucar"),
      userId: input.userId,
      contextSnapshotId,
      stage: "user_negotiator",
      provider: "azure_openai",
      model: undefined,
      latencyMs: undefined,
      validationStatus: "failed",
      errorType,
      outputJson: null,
      createdAt: nowIso(),
    });
    analyticsEvents.push(await input.analyticsClient.record({
      type: "user_negotiator_failed",
      layer: "user_agent",
      message: `User negotiator failed: ${errorType}.`,
      payload: { contextSnapshotId, errorType },
    }));
    return {
      assembledUserContext: assembled,
      userNegotiationPosition: null,
      agentTrace,
      haltWithNoOffer: true,
      noOfferReason: "agent_failed",
      analyticsEvents,
    };
  }

  if (!userNegotiationPosition.shouldNegotiate) {
    analyticsEvents.push(await input.analyticsClient.record({
      type: "user_negotiator_declined",
      layer: "user_agent",
      message: "User negotiator declined to negotiate; halting with no_offer.",
      payload: { contextSnapshotId, evidence: userNegotiationPosition.evidence },
    }));
    return {
      assembledUserContext: assembled,
      userNegotiationPosition,
      agentTrace,
      haltWithNoOffer: true,
      noOfferReason: "user_negotiator_declined",
      analyticsEvents,
    };
  }

  return {
    assembledUserContext: assembled,
    userNegotiationPosition,
    agentTrace,
    haltWithNoOffer: false,
    analyticsEvents,
  };
}

/**
 * Returns an early-return OrchestrationResult if a row for `idempotencyKey`
 * already exists and dictates one (cached completed result, "already running",
 * or previously failed). Returns `null` if the caller may proceed to insert a
 * new run.
 *
 * Also handles the stale-running edge case by marking the row failed and
 * returning a "stale_orchestration_run" result so the caller can retry with a
 * fresh idempotency key.
 */
async function resolveExistingOrchestrationRun(
  repository: ReturnType<typeof getRepository>,
  idempotencyKey: string,
): Promise<OrchestrationResult | null> {
  const existingRun = await repository.getOrchestrationRun(idempotencyKey);
  if (!existingRun) return null;

  if (existingRun.status === "completed" && existingRun.resultJson) {
    return existingRun.resultJson as OrchestrationResult;
  }

  if (existingRun.status === "running") {
    const stale = Date.now() - new Date(existingRun.updatedAt).getTime() > 2 * 60 * 1000;
    if (!stale) {
      return makeAlreadyRunningResult(idempotencyKey);
    }
    await repository.updateOrchestrationRun(idempotencyKey, {
      status: "failed",
      errorJson: {
        reason: "stale_orchestration_run",
        message: "A retry must use a new idempotency key from a new context/time bucket.",
      },
    });
    return {
      triggered: false,
      reason: "stale_orchestration_run",
      idempotencyKey,
      orchestrationStatus: "failed",
      retryAfterMs: 1_000,
      matchedTriggers: [],
      merchantInsights: [],
      candidateMerchants: [],
      bundleCandidates: [],
      analyticsEvents: [],
      discoveredMerchants: [],
    };
  }

  if (existingRun.status === "failed") {
    return {
      triggered: false,
      reason: "orchestration_failed",
      idempotencyKey,
      orchestrationStatus: "failed",
      matchedTriggers: [],
      merchantInsights: [],
      candidateMerchants: [],
      bundleCandidates: [],
      analyticsEvents: [],
      discoveredMerchants: [],
    };
  }

  return null;
}

function makeAlreadyRunningResult(idempotencyKey: string): OrchestrationResult {
  return {
    triggered: false,
    reason: "orchestration_already_running",
    idempotencyKey,
    orchestrationStatus: "running",
    retryAfterMs: 2_000,
    matchedTriggers: [],
    merchantInsights: [],
    candidateMerchants: [],
    bundleCandidates: [],
    analyticsEvents: [],
    discoveredMerchants: [],
  };
}

function createIdempotencyKey(input: OrchestrateRequest, activeMockProfile: MockContextProfile | null) {
  const locationKey = input.location
    ? `${roundCoordinate(input.location.latitude, 3)}:${roundCoordinate(input.location.longitude, 3)}`
    : "demo";
  const declaredKey = input.declaredContext?.intent ?? "default";
  const profileKey = activeMockProfile ? `${activeMockProfile.id}@${activeMockProfile.version}` : "no_profile";
  return [
    input.userId,
    input.eventType,
    declaredKey,
    locationKey,
    profileKey,
    timeBucketKey(new Date(), 5 * 60 * 1000),
  ].join(":");
}

function buildUserEvents(
  input: OrchestrateRequest,
  payload: Record<string, unknown>,
  consumerContext: NonNullable<OrchestrationResult["consumerContext"]>,
): UserEvent[] {
  const observedAt = nowIso();
  const events: UserEvent[] = [
    {
      eventId: makeId("user_event"),
      userId: input.userId,
      eventType: input.eventType,
      observedAt,
      payload,
    },
  ];
  if (consumerContext.geofenceMatched) {
    events.push({
      eventId: makeId("user_event"),
      userId: input.userId,
      eventType: "UserEnteredZone",
      observedAt,
      payload: {
        zoneId: consumerContext.zoneId,
        zoneName: consumerContext.zoneName,
        matchedZones: consumerContext.matchedZones.map((zone) => zone.id),
      },
    });
  }
  return events;
}

function evaluateTriggersOnce(events: UserEvent[], context: NonNullable<OrchestrationResult["consumerContext"]>) {
  const matched = new Map<string, TriggerConfig>();
  for (const event of events) {
    for (const trigger of triggerConfig) {
      if (!trigger.enabled || trigger.eventType !== event.eventType) continue;
      if (!triggerConditionMatches(trigger, event, context)) continue;
      matched.set(trigger.id, trigger);
    }
  }
  return [...matched.values()];
}

function triggerConditionMatches(
  trigger: TriggerConfig,
  event: UserEvent,
  context: NonNullable<OrchestrationResult["consumerContext"]>,
) {
  const condition = trigger.condition;
  const zoneCondition = condition.zoneId;
  if (typeof zoneCondition === "string" && zoneCondition !== "any") {
    if (zoneCondition === "configured_demo_zone") return context.geofenceMatched;
    if (zoneCondition !== context.zoneId && !context.matchedZones.some((zone) => zone.id === zoneCondition)) return false;
  }
  if (condition.declaredIntent === "changed" && event.eventType === "UserDeclaredContextChanged") return true;
  if (Array.isArray(condition.timeContext) && !condition.timeContext.includes(context.timeContext)) return false;
  if (Array.isArray(condition.weatherMood) && !condition.weatherMood.includes(context.weatherMood)) return false;
  return true;
}

async function findActiveUnexpiredOffer(repository: ReturnType<typeof getRepository>, userId: string) {
  const now = Date.now();
  const offers = await repository.listOffers(userId);
  return offers.find((offer) =>
    ["created", "shown", "accepted"].includes(offer.status) &&
    new Date(offer.expiresAt).getTime() > now,
  ) ?? null;
}

async function evaluateCooldown(repository: ReturnType<typeof getRepository>, userId: string, maxOffersPerHour: number) {
  const offers = await repository.listOffers(userId);
  const now = Date.now();
  const cooldownMs = 30 * 60 * 1000;
  const relevantOffers = offers.filter((offer) => !["dismissed", "expired"].includes(offer.status));
  const latest = relevantOffers
    .map((offer) => new Date(offer.createdAt ?? offer.expiresAt).getTime())
    .filter((time) => Number.isFinite(time))
    .sort((left, right) => right - left)[0];
  if (latest && now - latest < cooldownMs) {
    return { blocked: true, reason: "cooldown_active", retryAfterMs: cooldownMs - (now - latest) };
  }
  const lastHourCount = relevantOffers.filter((offer) => {
    const createdAt = new Date(offer.createdAt ?? offer.expiresAt).getTime();
    return now - createdAt < 60 * 60 * 1000;
  }).length;
  if (lastHourCount >= maxOffersPerHour) {
    return { blocked: true, reason: "cooldown_active", retryAfterMs: cooldownMs };
  }
  return { blocked: false, reason: null, retryAfterMs: undefined };
}

async function loadStoredMerchantsForWallet(
  repository: ReturnType<typeof getRepository>,
  context: ConsumerContextSnapshot,
): Promise<{ merchants: Merchant[]; metadata: NearbyMerchantSearchMetadata }> {
  const matchedZones = context.matchedZones ?? [];
  const zoneIds = matchedZones.map((zone) => zone.id);
  const zoneMerchants = (await Promise.all(zoneIds.map((zoneId) => repository.listMerchantsByZone(zoneId)))).flat();
  const sourcePool = zoneMerchants.length > 0 || context.locationMode === "real_browser_location"
    ? zoneMerchants
    : await repository.listMerchants();
  const eligiblePool = sourcePool.filter((merchant) => storedMerchantCanEnterSearch(merchant));

  if (!context.userLocation) {
    return {
      merchants: eligiblePool,
      metadata: {
        activeZoneId: matchedZones[0]?.id ?? context.zoneId,
        activeZoneName: matchedZones[0]?.name ?? context.zoneName,
        source: "stored_db",
        searchRadiiTried: [],
        expanded: false,
        eligibleMerchantCount: eligiblePool.length,
        liveDiscoveryFallbackUsed: false,
      },
    };
  }

  const radii = discoveryConfig.walletExpansionRadiiMeters;
  let selected = eligiblePool;
  let radiusUsed = radii.at(-1) ?? context.walkingToleranceMeters;
  const tried: number[] = [];
  for (const radius of radii) {
    tried.push(radius);
    const nearby = eligiblePool
      .map((merchant) => ({
        merchant,
        distanceMeters: calculateDistanceMeters(context.userLocation!.latitude, context.userLocation!.longitude, merchant.latitude!, merchant.longitude!),
      }))
      .filter((entry) => entry.distanceMeters <= radius)
      .sort((left, right) => left.distanceMeters - right.distanceMeters)
      .map((entry) => ({ ...entry.merchant, distanceMeters: entry.distanceMeters }));
    selected = nearby;
    radiusUsed = radius;
    if (nearby.length >= 2) break;
  }

  return {
    merchants: selected,
    metadata: {
      activeZoneId: matchedZones[0]?.id ?? (context.geofenceMatched ? context.zoneId : undefined),
      activeZoneName: matchedZones[0]?.name ?? context.zoneName,
      source: "stored_db",
      searchRadiiTried: tried,
      radiusUsedMeters: radiusUsed,
      expanded: tried.length > 1,
      eligibleMerchantCount: selected.length,
      liveDiscoveryFallbackUsed: false,
    },
  };
}

function storedMerchantCanEnterSearch(merchant: Merchant) {
  if (merchant.latitude === undefined || merchant.longitude === undefined) return false;
  const status = merchant.participationStatus ?? "partner";
  if (status !== "partner") return false;
  if ((merchant.rule?.dailyBudgetRemainingEuro ?? 0) <= 0) return false;
  if ((merchant.rule?.offerTypesAllowed.length ?? 0) === 0) return false;
  return true;
}

function summarizeInsights(insights: MerchantInsightSnapshot[]) {
  return {
    totalRefreshed: insights.length,
    byBusinessState: insights.reduce<Record<string, number>>((counts, insight) => {
      counts[insight.businessState] = (counts[insight.businessState] ?? 0) + 1;
      return counts;
    }, {}),
    sampledMerchantIds: insights.slice(0, 10).map((insight) => insight.merchantId),
  };
}

async function completeRun(input: {
  repository: ReturnType<typeof getRepository>;
  idempotencyKey: string;
  result: OrchestrationResult;
}) {
  await input.repository.updateOrchestrationRun(input.idempotencyKey, {
    status: "completed",
    resultJson: input.result as unknown as Record<string, unknown>,
  });
  await input.repository.saveDebugRun(input.result);
  return input.result;
}

function makeClients() {
  const repository = getRepository();
  return {
    context: new ContextServiceClient(repository),
    merchantIntelligence: new MerchantIntelligenceServiceClient(repository),
    negotiation: new NegotiationServiceClient(),
    validation: new ValidationServiceClient(),
    offer: new OfferServiceClient(repository),
    redemption: new RedemptionServiceClient(repository),
    analytics: new AnalyticsServiceClient(repository),
  };
}

function readJson(event: APIGatewayProxyEventV2): unknown {
  if (!event.body) return {};
  const body = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  return JSON.parse(body);
}

function humanizeIntent(intentLabel: string, merchantName?: string) {
  const label = intentLabel.replace(/_/g, " ");
  if (intentLabel === "lunch_break") return merchantName ? `Lunch at ${merchantName}` : "Quick lunch nearby";
  if (intentLabel === "gift_for_visitor") return merchantName ? `Gift from ${merchantName}` : "Small gift on the way";
  if (intentLabel === "warm_break") return merchantName ? `Warm break at ${merchantName}` : "Warm break nearby";
  if (merchantName) return `${label} at ${merchantName}`;
  return label.replace(/^./, (char) => char.toUpperCase());
}

function maskSecret(value: string) {
  if (value.length <= 8) return "set";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: corsHeaders(),
    body: body === null ? "" : JSON.stringify(body),
  };
}

function corsHeaders() {
  return {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
  };
}

const SIMULATOR_SOURCE_LABELS: Record<string, string> = {
  calendar: "Calendar",
  fitness: "Fitness",
  mobility: "Mobility",
  mood: "Mood",
  payment_preference: "Payment preference",
  social: "Social",
  transit: "Transit",
  dietary: "Dietary",
  device_attention: "Device attention",
  local_events: "Local events",
  location: "Location",
  active_zone: "Active zone",
  weather: "Weather",
  time: "Time of day",
  merchant_density: "Local merchant density",
};

// Lightweight reverse-geocoder used by the wallet to resolve a city label
// the moment we have coordinates, in parallel with the slower orchestrate()
// pipeline. Uses the same provider stack that `buildConsumerContextSnapshot`
// uses, so the city label here matches what eventually lands in the snapshot.
const sharedGeocodingProviders = createDefaultProviders();

async function reverseGeocodeForWallet(latitude: number, longitude: number) {
  const geocoder = sharedGeocodingProviders.geocoding;
  if (!geocoder?.reverseGeocode) {
    return { city: null, countryCode: null, displayName: null, provider: "none", durationMs: 0 } as const;
  }
  const startedAt = Date.now();
  try {
    const result = await geocoder.reverseGeocode(
      { latitude, longitude },
      { budget: defaultProviderBudget(), cache: undefined },
    );
    const provider = process.env.GOOGLE_GEOCODING_API_KEY || process.env.GOOGLE_PLACES_API_KEY
      ? "google_geocoding"
      : "nominatim";
    return {
      city: result?.city ?? null,
      countryCode: result?.countryCode ?? null,
      displayName: result?.displayName ?? null,
      provider,
      durationMs: Date.now() - startedAt,
    } as const;
  } catch (error) {
    return {
      city: null,
      countryCode: null,
      displayName: null,
      provider: "error",
      error: error instanceof Error ? error.message : "reverse_geocode_failed",
      durationMs: Date.now() - startedAt,
    } as const;
  }
}

async function buildConnectedSourceChips(userId: string): Promise<ConnectedSourceChip[]> {
  const repository = getRepository();
  const profile = await repository.getActiveMockContextProfile(userId);
  const enabled = profile?.enabledSources ?? {};
  const mockKeys: string[] = [
    "calendar",
    "fitness",
    "mobility",
    "mood",
    "payment_preference",
    "social",
    "transit",
    "dietary",
    "device_attention",
    "local_events",
  ];
  const chips: ConnectedSourceChip[] = mockKeys.map((source) => ({
    source,
    label: SIMULATOR_SOURCE_LABELS[source] ?? source,
    status: enabled[source] ? "simulated_for_demo" : "not_connected",
  }));
  for (const realSource of ["location", "active_zone", "weather", "time", "merchant_density"]) {
    chips.push({
      source: realSource,
      label: SIMULATOR_SOURCE_LABELS[realSource] ?? realSource,
      status: "connected",
    });
  }
  return chips;
}

async function buildContextSummary(userId: string) {
  const repository = getRepository();
  const [context, lastRun, profile] = await Promise.all([
    repository.getCurrentContext(userId),
    repository.getLastDebugRun(),
    repository.getActiveMockContextProfile(userId),
  ]);
  return {
    context,
    profileId: profile?.id ?? null,
    profileVersion: profile?.version ?? 0,
    assembledUserContext: lastRun?.assembledUserContext ?? null,
    userNegotiationPosition: lastRun?.userNegotiationPosition ?? null,
    noOfferReason: lastRun?.noOfferReason ?? null,
    agentTrace: lastRun?.agentTrace ?? null,
  };
}

async function handleDevSimulator(method: string, path: string, event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const repository = getRepository();

  if (method === "GET" && path === "/api/dev/context-simulator/scenarios") {
    return json(200, scenarioPresets.map((preset) => ({
      id: preset.id,
      label: preset.label,
      description: preset.description,
      enabledSources: preset.enabledSources,
      signalPayloads: preset.signalPayloads,
      profileOverrides: preset.profileOverrides ?? null,
    })));
  }

  if (method === "GET" && path === "/api/dev/context-simulator/profiles") {
    const userId = event.queryStringParameters?.userId ?? "user_mia";
    return json(200, await repository.listMockContextProfiles(userId));
  }

  const profileMatch = path.match(/^\/api\/dev\/context-simulator\/profiles\/([^/]+)$/);
  if (method === "GET" && profileMatch) {
    return json(200, await repository.getMockContextProfile(profileMatch[1]));
  }

  if (method === "DELETE" && profileMatch) {
    await repository.deleteMockContextProfile(profileMatch[1]);
    return json(200, { ok: true });
  }

  if (method === "POST" && path === "/api/dev/context-simulator/profiles") {
    const upsert = MockContextProfileUpsertSchema.parse(readJson(event));
    const now = nowIso();
    const id = upsert.id ?? makeId("mock_profile");
    const existing = upsert.id ? await repository.getMockContextProfile(upsert.id) : null;
    const saved = await repository.saveMockContextProfile({
      id,
      userId: upsert.userId,
      name: upsert.name,
      enabledSources: upsert.enabledSources,
      signalPayloads: upsert.signalPayloads,
      profileOverrides: upsert.profileOverrides,
      activeScenario: upsert.activeScenario ?? null,
      isActive: existing?.isActive ?? false,
      version: (existing?.version ?? 0) + 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    if (upsert.setActive) {
      const activated = await repository.setActiveMockContextProfile(upsert.userId, saved.id);
      return json(200, activated ?? saved);
    }
    return json(200, saved);
  }

  const activateMatch = path.match(/^\/api\/dev\/context-simulator\/profiles\/([^/]+)\/activate$/);
  if (method === "POST" && activateMatch) {
    const body = (readJson(event) as { userId?: string }) ?? {};
    const userId = body.userId ?? "user_mia";
    const activated = await repository.setActiveMockContextProfile(userId, activateMatch[1]);
    if (!activated) return json(404, { error: "Mock context profile not found." });
    return json(200, activated);
  }

  if (method === "POST" && path === "/api/dev/context-simulator/preview") {
    const request = DevSimulatorPreviewRequestSchema.parse(readJson(event));
    return json(200, await runSimulatorPreview(request));
  }

  if (method === "POST" && path === "/api/dev/context-simulator/run-context") {
    const body = (readJson(event) as { userId?: string }) ?? {};
    const userId = body.userId ?? "user_mia";
    const orchestrationResult = await orchestrate({
      eventType: "ManualRefreshRequested",
      userId,
    });
    return json(200, orchestrationResult);
  }

  return json(404, { error: `No dev simulator route for ${method} ${path}` });
}

async function runSimulatorPreview(request: { userId: string; profileId?: string; profileOverride?: unknown }): Promise<DevSimulatorPreviewResult> {
  const repository = getRepository();
  let profile: MockContextProfile | null = null;
  if (request.profileOverride) {
    const override = MockContextProfileUpsertSchema.parse(request.profileOverride);
    const now = nowIso();
    profile = {
      id: override.id ?? "preview_profile",
      userId: override.userId,
      name: override.name,
      enabledSources: override.enabledSources,
      signalPayloads: override.signalPayloads,
      profileOverrides: override.profileOverrides,
      activeScenario: override.activeScenario ?? null,
      isActive: false,
      version: 0,
      createdAt: now,
      updatedAt: now,
    };
  } else if (request.profileId) {
    profile = await repository.getMockContextProfile(request.profileId);
  } else {
    profile = await repository.getActiveMockContextProfile(request.userId);
  }

  const persistedUserProfile = await repository.getUserProfile(request.userId);
  if (!persistedUserProfile) {
    throw new Error(`Unknown user ${request.userId}`);
  }
  const baseContext = await repository.getCurrentContext(request.userId)
    ?? await new ContextServiceClient(repository).buildContext({ userId: request.userId });

  // Apply the (override or saved) profile's transient overrides so the
  // preview reflects the same effective constraints the real orchestration
  // would use under this profile.
  const overrides = profile?.profileOverrides;
  const userProfile = applyOverridesToUserProfile(persistedUserProfile, overrides);
  const consumerContext = applyOverridesToContext(baseContext, overrides);

  const collected = await collectRawSignals({
    userId: request.userId,
    profile,
    snapshot: consumerContext,
    providers: defaultProviders,
  });
  const filtered = filterForLLM(collected.signals);

  const agentTrace: AgentTrace = { assembler: null, userNegotiator: null };
  let assembledUserContext: AssembledUserContext | null = null;
  let userNegotiationPosition: UserNegotiationPosition | null = null;
  let errorMessage: string | undefined;

  const azureMode = isContextAgentMode();
  if (azureMode !== "azure_openai") {
    agentTrace.assembler = { provider: "skipped", validationStatus: "skipped", errorType: "azure_required" };
    agentTrace.userNegotiator = { provider: "skipped", validationStatus: "skipped", errorType: "azure_required" };
    errorMessage = "Azure OpenAI is required to run the user-context agents. Set LLM_PROVIDER=azure_openai and configure Azure secrets.";
  } else {
    const client = createDefaultJsonAgentClient();
    if (!client) {
      agentTrace.assembler = { provider: "azure_openai", validationStatus: "failed", errorType: "missing_config" };
      errorMessage = "Azure OpenAI client could not be created. Check AZURE_OPENAI_* env vars.";
    } else {
      try {
        const assembleResult = await assembleUserContext({
          userId: request.userId,
          contextSnapshotId: consumerContext.snapshotId,
          bundle: filtered,
          consumerSnapshot: consumerContext,
          userProfile,
          client,
          timeoutMs: Number(process.env.USER_CONTEXT_AGENT_TIMEOUT_MS ?? 45000),
        });
        assembledUserContext = assembleResult.context;
        agentTrace.assembler = {
          provider: assembleResult.provider,
          model: assembleResult.model,
          latencyMs: assembleResult.latencyMs,
          validationStatus: assembleResult.validationStatus,
        };
        const negotiatorResult = await runUserNegotiator({
          userId: request.userId,
          contextSnapshotId: consumerContext.snapshotId,
          assembledContext: assembledUserContext,
          consumerSnapshot: consumerContext,
          userProfile,
          nearbyMerchantCount: 0,
          client,
          timeoutMs: Number(process.env.USER_NEGOTIATOR_AGENT_TIMEOUT_MS ?? 45000),
        });
        userNegotiationPosition = negotiatorResult.position;
        agentTrace.userNegotiator = {
          provider: negotiatorResult.provider,
          model: negotiatorResult.model,
          latencyMs: negotiatorResult.latencyMs,
          validationStatus: negotiatorResult.validationStatus,
        };
      } catch (error) {
        const errorType = error instanceof LLMAgentError ? error.type : "unknown";
        const stage = error instanceof LLMAgentError ? error.stage : "unknown";
        const detail = error instanceof Error ? error.message : "Unknown agent failure during preview.";
        console.warn(
          `[city-wallet] dev simulator preview: ${stage} agent failed (${errorType}): ${detail}`,
        );
        if (!agentTrace.assembler) agentTrace.assembler = { provider: "azure_openai", validationStatus: "failed", errorType };
        else if (!agentTrace.userNegotiator) agentTrace.userNegotiator = { provider: "azure_openai", validationStatus: "failed", errorType };
        errorMessage = detail;
      }
    }
  }

  return {
    contextSnapshotId: consumerContext.snapshotId,
    enabledSources: collected.enabledSources,
    disabledSources: collected.disabledSources,
    privacyMetadata: filtered.metadata,
    filteredSignals: filtered.signals,
    assembledUserContext,
    userNegotiationPosition,
    agentTrace,
    errorMessage,
  };
}
