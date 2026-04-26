import type { AnalyticsEvent, AnalyticsEventType, DashboardMetrics, Merchant, MerchantDashboardQuery } from "@city-wallet/contracts";
import type { CityWalletRepository } from "@city-wallet/db";
import { calculateDistanceMeters, makeId, nowIso } from "@city-wallet/utils";

export async function recordAnalyticsEvent(
  repository: CityWalletRepository,
  input: {
    type: AnalyticsEventType;
    layer: AnalyticsEvent["layer"];
    message: string;
    merchantId?: string;
    offerId?: string;
    payload?: Record<string, unknown>;
  },
) {
  const event: AnalyticsEvent = {
    eventId: makeId("evt"),
    type: input.type,
    layer: input.layer,
    message: input.message,
    merchantId: input.merchantId,
    offerId: input.offerId,
    payload: input.payload ?? {},
    createdAt: nowIso(),
  };
  return repository.recordAnalyticsEvent(event);
}

export async function buildMerchantDashboardMetrics(
  repository: CityWalletRepository,
  query: MerchantDashboardQuery = { merchantLimit: 50, merchantOffset: 0 },
): Promise<DashboardMetrics> {
  const merchantFilter = {
    zoneId: query.zoneId,
    category: query.category,
    participationStatus: query.participationStatus,
    source: query.source,
    query: query.query,
  };
  const limit = Math.min(Math.max(query.merchantLimit ?? 50, 1), 200);
  const offset = Math.max(query.merchantOffset ?? 0, 0);
  const [merchants, merchantTotal, summaryMerchants, insights, densitySignals, offers, tokens, events, currentContext, zones, importRuns, lastDebugRun] = await Promise.all([
    repository.listMerchants({ ...merchantFilter, limit, offset }),
    repository.countMerchants(merchantFilter),
    repository.listMerchants(merchantFilter),
    repository.listMerchantInsights(),
    repository.listPaymentDensitySignals(),
    repository.listOffers(),
    repository.listRedemptionTokens(),
    repository.listAnalyticsEvents(200),
    repository.getLatestContext(),
    repository.listCommerceZones(),
    repository.listMerchantImportRuns(),
    repository.getLastDebugRun().catch(() => null),
  ]);

  return {
    merchants: merchants.map((merchant) => {
      const merchantOffers = offers.filter((offer) => offer.items.some((item) => item.merchantId === merchant.id));
      const merchantTokens = tokens.filter((token) => token.merchantId === merchant.id);
      const redeemedTokens = merchantTokens.filter((token) => token.status === "redeemed");
      const density = densitySignals.find((signal) => signal.merchantId === merchant.id);
      const influencedRevenue = redeemedTokens.reduce((sum, token) => {
        const offer = offers.find((candidate) => candidate.offerId === token.offerId);
        const item = offer?.items.find((candidate) => candidate.offerItemId === token.offerItemId);
        return sum + (item?.priceEuro ?? 0);
      }, 0);
      const insight = insights.find((candidate) => candidate.merchantId === merchant.id);
      const calculatedDistanceMeters = currentContext?.userLocation && merchant.latitude !== undefined && merchant.longitude !== undefined
        ? calculateDistanceMeters(currentContext.userLocation.latitude, currentContext.userLocation.longitude, merchant.latitude, merchant.longitude)
        : undefined;
      return {
        merchant,
        insight,
        baselineTransactions: density?.baselineTransactions,
        currentTransactions: density?.currentTransactions,
        baselineRevenue: density?.baselineRevenue,
        currentRevenue: density?.currentRevenue,
        offersShown: merchantOffers.length,
        offersAccepted: merchantOffers.filter((offer) => ["accepted", "redeemed"].includes(offer.status)).length,
        tokensRedeemed: redeemedTokens.length,
        cashbackIssuedEuro: redeemedTokens.reduce((sum, token) => sum + token.cashbackEuro, 0),
        revenueInfluencedEuro: influencedRevenue,
        calculatedDistanceMeters,
        notSelectedReason: insight?.businessState === "normal"
          ? "Not selected for the current context because demand is normal and the journey fit is weaker than the selected bundle."
          : undefined,
      };
    }),
    merchantPage: {
      total: merchantTotal,
      limit,
      offset,
      hasMore: offset + merchants.length < merchantTotal,
    },
    merchantSummary: buildMerchantSummary(summaryMerchants),
    zones,
    importRuns,
    currentContext,
    latestAssembledUserContext: lastDebugRun?.assembledUserContext ?? null,
    latestUserNegotiationPosition: lastDebugRun?.userNegotiationPosition ?? null,
    latestAgentTrace: lastDebugRun?.agentTrace,
    latestNegotiationReasoning: lastDebugRun?.negotiationDecision?.reasoning ?? [],
    latestNoOfferReason: lastDebugRun?.noOfferReason ?? null,
    events,
  };
}

export async function buildConsumerActivityTimeline(repository: CityWalletRepository, limit = 50) {
  return repository.listAnalyticsEvents(limit);
}

function buildMerchantSummary(merchants: Merchant[]) {
  return {
    total: merchants.length,
    bySource: countField(merchants, (merchant) => merchant.source ?? "seeded"),
    byCategory: countField(merchants, (merchant) => merchant.category),
    byParticipationStatus: countField(merchants, (merchant) => merchant.participationStatus ?? "partner"),
  };
}

function countField<T>(items: T[], getKey: (item: T) => string) {
  return items.reduce<Record<string, number>>((counts, item) => {
    const key = getKey(item);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}
