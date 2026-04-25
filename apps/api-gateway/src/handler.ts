import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { triggerConfig } from "@city-wallet/config";
import {
  ClaimOfferRequestSchema,
  MerchantRuleUpdateSchema,
  OrchestrateRequestSchema,
  RedeemTokenRequestSchema,
  UserEventSchema,
  type AnalyticsEvent,
  type OrchestrationResult,
  type UserEvent,
} from "@city-wallet/contracts";
import { buildConsumerAgentPosition } from "@city-wallet/consumer-agent-domain";
import { getRepository } from "@city-wallet/db";
import {
  AnalyticsServiceClient,
  ContextServiceClient,
  MerchantIntelligenceServiceClient,
  NegotiationServiceClient,
  OfferServiceClient,
  RedemptionServiceClient,
  ValidationServiceClient,
} from "@city-wallet/service-clients";
import { makeId, nowIso } from "@city-wallet/utils";

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
      await Promise.all(insights.map((insight) => clients.analytics.record({
        type: "merchant_insight_updated",
        layer: "merchant_intelligence",
        merchantId: insight.merchantId,
        message: `Insight updated for ${insight.merchantId}: ${insight.businessState} urgency ${insight.urgencyScore}`,
        payload: insight,
      })));
      return json(200, insights);
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
      return json(200, await clients.analytics.merchantDashboard());
    }

    if (method === "POST" && path === "/api/seed/reset") {
      await getRepository().resetToSeed();
      return json(200, { ok: true });
    }

    if (method === "GET" && path === "/api/debug/last-run") {
      return json(200, await getRepository().getLastDebugRun());
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
  const userEvent: UserEvent = {
    eventId: makeId("user_event"),
    userId: input.userId,
    eventType: input.eventType,
    observedAt: nowIso(),
    payload: input.declaredContext ?? {},
  };
  await repository.saveUserEvent(userEvent);

  const matchedTriggers = triggerConfig.filter((trigger) => trigger.enabled && trigger.eventType === input.eventType);
  for (const trigger of matchedTriggers) {
    await repository.saveTriggerMatch({
      id: makeId("trigger_match"),
      userEventId: userEvent.eventId,
      triggerId: trigger.id,
      matchedAt: nowIso(),
    });
  }

  analyticsEvents.push(await clients.analytics.record({
    type: "trigger_matched",
    layer: "config",
    message: matchedTriggers.length > 0
      ? `${matchedTriggers.length} trigger(s) matched ${input.eventType}.`
      : `No trigger matched ${input.eventType}.`,
    payload: { eventType: input.eventType, matchedTriggers },
  }));

  if (matchedTriggers.length === 0) {
    const result = { triggered: false, matchedTriggers, merchantInsights: [], candidateMerchants: [], bundleCandidates: [], analyticsEvents };
    await repository.saveDebugRun(result);
    return result;
  }

  const consumerContext = await clients.context.buildContext({
    userId: input.userId,
    declaredContext: input.declaredContext,
  });
  analyticsEvents.push(await clients.analytics.record({
    type: "context_refreshed",
    layer: "context",
    message: `Consumer context refreshed for ${input.userId}.`,
    payload: consumerContext,
  }));

  const profile = await repository.getUserProfile(input.userId);
  if (!profile) throw new Error(`Unknown user ${input.userId}`);
  const consumerAgentPosition = buildConsumerAgentPosition(profile, consumerContext);
  const merchantInsights = await clients.merchantIntelligence.refreshInsights();
  analyticsEvents.push(...await Promise.all(merchantInsights.map((insight) => clients.analytics.record({
    type: "merchant_insight_updated",
    layer: "merchant_intelligence",
    merchantId: insight.merchantId,
    message: `Insight updated for ${insight.merchantId}: ${insight.businessState} urgency ${insight.urgencyScore}`,
    payload: insight,
  }))));

  const merchants = await repository.listMerchants();
  analyticsEvents.push(await clients.analytics.record({
    type: "negotiation_requested",
    layer: "negotiation",
    message: "Negotiation requested from user-side event.",
    payload: { userEvent, consumerAgentPosition },
  }));

  const negotiation = await clients.negotiation.negotiate({
    userEvent,
    consumerContext,
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
    context: consumerContext,
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
        context: consumerContext,
      })
    : null;

  if (offer) {
    analyticsEvents.push(await clients.analytics.record({
      type: "offer_shown",
      layer: "offer",
      offerId: offer.offerId,
      message: `Offer shown: ${offer.headline}`,
      payload: offer,
    }));
  }

  const result: OrchestrationResult = {
    triggered: true,
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
  };
  await repository.saveDebugRun(result);
  return result;
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
