import type { NegotiationDecision, Offer, RedemptionToken } from "../types";

const TOKEN_PREFIX: Record<string, string> = {
  cafe_muller: "CW-CAFE-91K",
  buchhandlung_anna: "CW-BOOK-72Q",
  blumen_klein: "CW-FLOR-44A",
};

export function buildOfferFromDecision(decision: NegotiationDecision): Offer | null {
  if (decision.decision === "no_offer") return null;
  const why = decision.reasoning;
  const expiresAt = Date.now() + 45 * 60 * 1000;
  return {
    id: `offer_${Date.now()}`,
    type: decision.decision,
    status: "active",
    headline: decision.consumerHeadline,
    subheadline: decision.consumerSubheadline,
    cta: decision.cta,
    expiresAt,
    items: decision.items,
    why,
  };
}

export function issueTokens(offer: Offer): RedemptionToken[] {
  return offer.items.map((it) => ({
    id: TOKEN_PREFIX[it.merchantId] ?? `CW-${it.merchantId.toUpperCase()}-${Math.floor(Math.random() * 999)}`,
    offerId: offer.id,
    merchantId: it.merchantId,
    merchantName: it.merchantName,
    productName: it.productName,
    percent: it.percent,
    productPriceEUR: it.productPriceEUR,
    status: "active",
  }));
}

export function calculateCashback(token: RedemptionToken): number {
  return Math.round(token.productPriceEUR * (token.percent / 100) * 100) / 100;
}