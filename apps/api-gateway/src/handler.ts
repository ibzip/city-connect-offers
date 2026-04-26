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
  MerchantImportContinueRequestSchema,
  MerchantDashboardQuerySchema,
  MerchantRuleCompilePreviewRequestSchema,
  MerchantUpdateSchema,
  MerchantRuleUpdateSchema,
  OrchestrateRequestSchema,
  RedeemTokenRequestSchema,
  UserEventSchema,
  type AnalyticsEvent,
  type ConsumerContextSnapshot,
  type Merchant,
  type MerchantInsightSnapshot,
  type NearbyMerchantSearchMetadata,
  type OrchestrateRequest,
  type OrchestrationResult,
  type TriggerConfig,
  type UserEvent,
} from "@city-wallet/contracts";
import { buildConsumerAgentPosition } from "@city-wallet/consumer-agent-domain";
import { getRepository } from "@city-wallet/db";
import {
  compileAndApplyMerchantRules,
  compileMerchantFreeformRules,
  FreeformRuleCompilationError,
} from "@city-wallet/merchant-intelligence-domain";
import {
  AnalyticsServiceClient,
  ContextServiceClient,
  MerchantIntelligenceServiceClient,
  NegotiationServiceClient,
  OfferServiceClient,
  RedemptionServiceClient,
  ValidationServiceClient,
} from "@city-wallet/service-clients";
import { calculateDistanceMeters, makeId, nowIso, roundCoordinate, timeBucketKey } from "@city-wallet/utils";

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
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
        message: `Merchant import ${result.importRun.status}: ${result.importRun.importedCount} merchant(s), ${result.importRun.demoPartnerCount} demo partner(s).`,
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
      const [profile, context, offers, tokens, events, lastRun] = await Promise.all([
        repository.getUserProfile(userId),
        repository.getCurrentContext(userId),
        repository.listOffers(userId),
        repository.listRedemptionTokens(),
        repository.listAnalyticsEvents(80),
        repository.getLastDebugRun(),
      ]);
      return json(200, { profile, context, offers, tokens, events, lastRun });
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
  const idempotencyKey = input.idempotencyKey ?? createIdempotencyKey(input);
  const existingRun = await repository.getOrchestrationRun(idempotencyKey);
  if (existingRun?.status === "completed" && existingRun.resultJson) {
    return existingRun.resultJson as OrchestrationResult;
  }
  if (existingRun?.status === "running") {
    const stale = Date.now() - new Date(existingRun.updatedAt).getTime() > 2 * 60 * 1000;
    if (!stale) {
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
    await repository.updateOrchestrationRun(idempotencyKey, {
      status: "failed",
      errorJson: { reason: "stale_orchestration_run", message: "A retry must use a new idempotency key from a new context/time bucket." },
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
  if (existingRun?.status === "failed") {
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

  await repository.createOrchestrationRun({
    idempotencyKey,
    userId: input.userId,
    eventType: input.eventType,
    status: "running",
    resultJson: null,
    errorJson: null,
  });

  try {
    const providerBudget = defaultProviderBudget();
    const consumerContext = await clients.context.buildContext({
      userId: input.userId,
      location: input.location,
      declaredContext: input.declaredContext,
      providerBudget,
    });
    await repository.updateOrchestrationRun(idempotencyKey, { contextSnapshotId: consumerContext.snapshotId });

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

    const profile = await repository.getUserProfile(input.userId);
    if (!profile) throw new Error(`Unknown user ${input.userId}`);
    if (discoveredMerchants.length > 0) {
      storedSupply = await loadStoredMerchantsForWallet(repository, consumerContext);
    }

    const negotiationContext: ConsumerContextSnapshot = storedSupply.metadata.radiusUsedMeters
      ? { ...consumerContext, walkingToleranceMeters: Math.max(consumerContext.walkingToleranceMeters, storedSupply.metadata.radiusUsedMeters) }
      : consumerContext;
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

    const negotiation = await clients.negotiation.negotiate({
      userEvent,
      consumerContext: negotiationContext,
      consumerAgentPosition,
      merchants,
      merchantInsights,
    });
    await repository.saveNegotiationBrief(negotiation.negotiationBrief);
    const decisionId = makeId("decision");
    await repository.saveNegotiationDecision(decisionId, negotiation.negotiationBrief.briefId, negotiation.negotiationDecision);
    analyticsEvents.push(await clients.analytics.record({
      type: "negotiation_decision_created",
      layer: "negotiation",
      message: `Decision created: ${negotiation.negotiationDecision.decision}.`,
      payload: negotiation.negotiationDecision,
    }));

    const validationResult = await clients.validation.validate({
      decision: negotiation.negotiationDecision,
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

    const offer = validationResult.valid
      ? await clients.offer.create({
          decision: negotiation.negotiationDecision,
          merchants,
          context: negotiationContext,
        })
      : null;

    if (offer) {
      analyticsEvents.push(await clients.analytics.record({
        type: "offer_shown",
        layer: "offer",
        offerId: offer.offerId,
        message: offer.isSimulatedDemoOffer ? `Simulated demo offer shown: ${offer.headline}` : `Offer shown: ${offer.headline}`,
        payload: offer,
      }));
    }

    return completeRun({
      repository,
      idempotencyKey,
      result: {
        triggered: true,
        idempotencyKey,
        orchestrationStatus: "completed",
        matchedTriggers,
        consumerContext,
        consumerAgentPosition,
        merchantInsights,
        candidateMerchants: negotiation.candidateMerchants,
        bundleCandidates: negotiation.bundleCandidates,
        negotiationBrief: negotiation.negotiationBrief,
        negotiationDecision: negotiation.negotiationDecision,
        validationResult,
        offer,
        analyticsEvents,
        providerBudget,
        discoveredMerchants,
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

function createIdempotencyKey(input: OrchestrateRequest) {
  const locationKey = input.location
    ? `${roundCoordinate(input.location.latitude, 3)}:${roundCoordinate(input.location.longitude, 3)}`
    : "demo";
  const declaredKey = input.declaredContext?.intent ?? "default";
  return [
    input.userId,
    input.eventType,
    declaredKey,
    locationKey,
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
  const zoneIds = matchedZones.length > 0
    ? matchedZones.map((zone) => zone.id)
    : context.locationMode === "demo_geofence_fallback" ? [context.zoneId] : [];
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
  const demoAllowed = process.env.DEMO_MODE === "true" && process.env.ALLOW_DEMO_PARTNER_OFFERS === "true";
  if (status !== "partner" && !(status === "demo_partner" && demoAllowed)) return false;
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
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
  };
}
