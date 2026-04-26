import { recordAnalyticsEvent, buildConsumerActivityTimeline, buildMerchantDashboardMetrics } from "@city-wallet/analytics-domain";
import { buildConsumerContextSnapshot } from "@city-wallet/context-domain";
import type {
  ActivateCommerceZoneRequest,
  ActivateCommerceZoneResult,
  AnalyticsEventType,
  CitySuggestion,
  ConsumerAgentPosition,
  ConsumerContextSnapshot,
  DashboardMetrics,
  MerchantDashboardQuery,
  Merchant,
  MerchantImportRun,
  MerchantInsightSnapshot,
  MerchantRule,
  MerchantRuleCompilePreviewResult,
  NegotiationBrief,
  NegotiationDecision,
  Offer,
  ProviderBudget,
  RedemptionResult,
  RedemptionToken,
  UserEvent,
  ValidationResult,
} from "@city-wallet/contracts";
import type { CityWalletRepository } from "@city-wallet/db";
import {
  activateCommerceZoneAndImport,
  compileAndApplyMerchantRules,
  compileMerchantFreeformRules,
  continueMerchantImportRun,
  refreshMerchantInsights,
  runOptionalMerchantDiscovery,
  suggestCommerceCities,
} from "@city-wallet/merchant-intelligence-domain";
import { buildBundleCandidates, buildNegotiationBrief, runNegotiation, selectCandidateMerchants } from "@city-wallet/negotiation-domain";
import { createOfferFromDecision, getOffer, listOffers } from "@city-wallet/offer-domain";
import { createRedemptionTokens, redeemToken } from "@city-wallet/redemption-domain";
import { validateNegotiationDecision } from "@city-wallet/validation-domain";

export type ServiceInvocationMode = "local" | "http";

export function getServiceInvocationMode(url?: string): ServiceInvocationMode {
  const requested = process.env.SERVICE_INVOCATION_MODE === "http" ? "http" : "local";
  return requested === "http" && url ? "http" : "local";
}

export class ContextServiceClient {
  constructor(private readonly repository: CityWalletRepository, private readonly baseUrl = process.env.CONTEXT_SERVICE_URL) {}

  async buildContext(input: {
    userId: string;
    location?: { latitude: number; longitude: number; accuracyMeters?: number; source?: "browser" | "demo_geofence" };
    providerBudget?: ProviderBudget;
    declaredContext?: { intent?: string; availableMinutes?: number; rewardPreference?: "cashback" | "discount" | "either" };
  }) {
    if (getServiceInvocationMode(this.baseUrl) === "http") {
      return postJson<ConsumerContextSnapshot>(`${this.baseUrl}/api/context/build`, input);
    }
    return buildConsumerContextSnapshot(this.repository, input);
  }
}

export class MerchantIntelligenceServiceClient {
  constructor(private readonly repository: CityWalletRepository, private readonly baseUrl = process.env.MERCHANT_INTELLIGENCE_SERVICE_URL) {}

  async refreshInsights(merchantIds?: string[]) {
    if (getServiceInvocationMode(this.baseUrl) === "http") {
      return postJson<MerchantInsightSnapshot[]>(`${this.baseUrl}/api/merchant-insights/refresh`, { merchantIds });
    }
    return refreshMerchantInsights(this.repository, merchantIds);
  }

  async discover(input: { context: ConsumerContextSnapshot; budget: ProviderBudget }) {
    if (getServiceInvocationMode(this.baseUrl) === "http") {
      return postJson<Merchant[]>(`${this.baseUrl}/api/merchant-discovery/refresh`, input);
    }
    return runOptionalMerchantDiscovery({ repository: this.repository, context: input.context, budget: input.budget });
  }

  async activateZone(input: ActivateCommerceZoneRequest) {
    if (getServiceInvocationMode(this.baseUrl) === "http") {
      return postJson<ActivateCommerceZoneResult>(`${this.baseUrl}/api/commerce-zones/activate`, input);
    }
    return activateCommerceZoneAndImport({ repository: this.repository, request: input });
  }

  async suggestCities(input: { query: string; country?: string }) {
    const suffix = `?query=${encodeURIComponent(input.query)}${input.country ? `&country=${encodeURIComponent(input.country)}` : ""}`;
    if (getServiceInvocationMode(this.baseUrl) === "http") {
      return getJson<CitySuggestion[]>(`${this.baseUrl}/api/commerce-zones/city-suggestions${suffix}`);
    }
    return suggestCommerceCities({ repository: this.repository, ...input });
  }

  async continueImport(runId: string) {
    if (getServiceInvocationMode(this.baseUrl) === "http") {
      return postJson<{ importRun: MerchantImportRun; importedMerchants: string[] }>(`${this.baseUrl}/api/merchant-import-runs/${runId}/continue`, { runId });
    }
    return continueMerchantImportRun({ repository: this.repository, runId });
  }

  async listInsights() {
    if (getServiceInvocationMode(this.baseUrl) === "http") {
      return getJson<MerchantInsightSnapshot[]>(`${this.baseUrl}/api/merchant-insights`);
    }
    return this.repository.listMerchantInsights();
  }

  async listRules() {
    if (getServiceInvocationMode(this.baseUrl) === "http") {
      return getJson<MerchantRule[]>(`${this.baseUrl}/api/merchant/rules`);
    }
    return this.repository.listMerchantRules();
  }

  async saveRule(rule: Parameters<CityWalletRepository["saveMerchantRule"]>[0]) {
    if (getServiceInvocationMode(this.baseUrl) === "http") {
      return postJson<MerchantRule>(`${this.baseUrl}/api/merchant/rules`, rule);
    }
    return this.repository.saveMerchantRule(rule);
  }

  async compileRulePreview(merchant: Merchant, freeformRulesText: string) {
    if (getServiceInvocationMode(this.baseUrl) === "http") {
      return postJson<MerchantRuleCompilePreviewResult>(`${this.baseUrl}/api/merchant/rules/compile-preview`, { merchant, freeformRulesText });
    }
    return compileMerchantFreeformRules({ merchant, freeformRulesText });
  }

  async saveMerchant(merchant: Merchant) {
    if (getServiceInvocationMode(this.baseUrl) === "http") {
      return postJson<{ merchant: Merchant; insights: MerchantInsightSnapshot[] }>(`${this.baseUrl}/api/merchants/${merchant.id}`, merchant);
    }
    const compiled = await compileAndApplyMerchantRules(merchant);
    const saved = await this.repository.saveMerchant(compiled.merchant);
    const insights = await refreshMerchantInsights(this.repository, [saved.id]);
    return { merchant: saved, insights };
  }
}

export class NegotiationServiceClient {
  constructor(private readonly baseUrl = process.env.NEGOTIATION_SERVICE_URL) {}

  async negotiate(input: {
    userEvent: UserEvent;
    consumerContext: ConsumerContextSnapshot;
    consumerAgentPosition: ConsumerAgentPosition;
    merchants: Merchant[];
    merchantInsights: Awaited<ReturnType<CityWalletRepository["listMerchantInsights"]>>;
  }) {
    if (getServiceInvocationMode(this.baseUrl) === "http") {
      return postJson<{
        candidateMerchants: ReturnType<typeof selectCandidateMerchants>;
        bundleCandidates: ReturnType<typeof buildBundleCandidates>;
        negotiationBrief: NegotiationBrief;
        negotiationDecision: NegotiationDecision;
      }>(`${this.baseUrl}/api/negotiate`, input);
    }
    const candidateMerchants = selectCandidateMerchants(input.merchants, input.merchantInsights, input.consumerContext);
    const bundleCandidates = buildBundleCandidates(input.merchants, candidateMerchants, input.merchantInsights, input.consumerContext);
    const negotiationBrief = buildNegotiationBrief({
      userEvent: input.userEvent,
      consumerContext: input.consumerContext,
      consumerAgentPosition: input.consumerAgentPosition,
      merchantInsights: input.merchantInsights,
      candidateMerchants,
      bundleCandidates,
    });
    const negotiationDecision = await runNegotiation({ brief: negotiationBrief, merchants: input.merchants });
    return { candidateMerchants, bundleCandidates, negotiationBrief, negotiationDecision };
  }
}

export class ValidationServiceClient {
  constructor(private readonly baseUrl = process.env.VALIDATION_SERVICE_URL) {}

  async validate(input: { decision: NegotiationDecision; merchants: Merchant[]; context: ConsumerContextSnapshot }) {
    if (getServiceInvocationMode(this.baseUrl) === "http") {
      return postJson<ValidationResult>(`${this.baseUrl}/api/validate`, input);
    }
    return validateNegotiationDecision(input);
  }
}

export class OfferServiceClient {
  constructor(private readonly repository: CityWalletRepository, private readonly baseUrl = process.env.OFFER_SERVICE_URL) {}

  async create(input: { decision: NegotiationDecision; merchants: Merchant[]; context: ConsumerContextSnapshot }) {
    if (getServiceInvocationMode(this.baseUrl) === "http") {
      return postJson<Offer | null>(`${this.baseUrl}/api/offers/create`, input);
    }
    return createOfferFromDecision({ repository: this.repository, ...input });
  }

  async list(userId?: string) {
    if (getServiceInvocationMode(this.baseUrl) === "http") {
      const suffix = userId ? `?userId=${encodeURIComponent(userId)}` : "";
      return getJson<Offer[]>(`${this.baseUrl}/api/offers${suffix}`);
    }
    return listOffers(this.repository, userId);
  }

  async get(offerId: string) {
    if (getServiceInvocationMode(this.baseUrl) === "http") {
      return getJson<Offer | null>(`${this.baseUrl}/api/offers/${offerId}`);
    }
    return getOffer(this.repository, offerId);
  }
}

export class RedemptionServiceClient {
  constructor(private readonly repository: CityWalletRepository, private readonly baseUrl = process.env.REDEMPTION_SERVICE_URL) {}

  async claim(offerId: string) {
    if (getServiceInvocationMode(this.baseUrl) === "http") {
      return postJson<RedemptionToken[]>(`${this.baseUrl}/api/offers/${offerId}/claim`, { offerId });
    }
    return createRedemptionTokens(this.repository, offerId);
  }

  async redeem(input: { code: string; merchantId: string }) {
    if (getServiceInvocationMode(this.baseUrl) === "http") {
      return postJson<RedemptionResult>(`${this.baseUrl}/api/redemption/redeem`, input);
    }
    return redeemToken(this.repository, input);
  }
}

export class AnalyticsServiceClient {
  constructor(private readonly repository: CityWalletRepository, private readonly baseUrl = process.env.ANALYTICS_SERVICE_URL) {}

  async record(input: {
    type: AnalyticsEventType;
    layer: Parameters<typeof recordAnalyticsEvent>[1]["layer"];
    message: string;
    merchantId?: string;
    offerId?: string;
    payload?: Record<string, unknown>;
  }) {
    if (getServiceInvocationMode(this.baseUrl) === "http") {
      return postJson<Awaited<ReturnType<typeof recordAnalyticsEvent>>>(`${this.baseUrl}/api/events`, input);
    }
    return recordAnalyticsEvent(this.repository, input);
  }

  async merchantDashboard(query: MerchantDashboardQuery = { merchantLimit: 50, merchantOffset: 0 }) {
    if (getServiceInvocationMode(this.baseUrl) === "http") {
      return getJson<DashboardMetrics>(`${this.baseUrl}/api/merchant-dashboard${dashboardQuerySuffix(query)}`);
    }
    return buildMerchantDashboardMetrics(this.repository, query);
  }

  async consumerTimeline() {
    if (getServiceInvocationMode(this.baseUrl) === "http") {
      return getJson<Awaited<ReturnType<typeof buildConsumerActivityTimeline>>>(`${this.baseUrl}/api/consumer-timeline`);
    }
    return buildConsumerActivityTimeline(this.repository);
  }
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`HTTP service call failed ${response.status}: ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP service call failed ${response.status}: ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}

function dashboardQuerySuffix(query: MerchantDashboardQuery) {
  const params = new URLSearchParams();
  params.set("merchantLimit", String(query.merchantLimit));
  params.set("merchantOffset", String(query.merchantOffset));
  if (query.zoneId) params.set("zoneId", query.zoneId);
  if (query.category) params.set("category", query.category);
  if (query.participationStatus) params.set("participationStatus", query.participationStatus);
  if (query.source) params.set("source", query.source);
  if (query.query) params.set("query", query.query);
  const value = params.toString();
  return value ? `?${value}` : "";
}
