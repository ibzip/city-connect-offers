import type {
  NegotiationBrief,
  NegotiationDecision,
  OfferItem,
} from "../types";
import { getMerchant } from "../config/merchants";

export interface NegotiationAgent {
  decide(brief: NegotiationBrief): NegotiationDecision;
  name: string;
}

/**
 * Deterministic LLM-style negotiation agent.
 * Future: swap with a real LLM-backed implementation that conforms to the same interface.
 */
export const mockLLMNegotiationAgent: NegotiationAgent = {
  name: "mock_llm_v1",
  decide(brief: NegotiationBrief): NegotiationDecision {
    const eligibleBundles = brief.candidateBundles.filter((b) => !b.rejectedReason);
    const topBundle = eligibleBundles[0];

    // Prefer bundle if a strong one exists with enough utility.
    if (topBundle && topBundle.preliminaryScore >= 60) {
      const items: OfferItem[] = topBundle.merchantIds.map((mid) => {
        const m = getMerchant(mid)!;
        const insight = brief.insights.find((i) => i.merchantId === mid)!;
        // Smallest sufficient incentive: scale with urgency.
        const basePct = insight.urgencyScore >= 75
          ? 15
          : insight.urgencyScore >= 50
            ? 12
            : 10;
        const pct = Math.min(basePct, m.rules.maxDiscountPercent);
        const product = m.products.find((p) => m.rules.eligibleProductIds.includes(p.id))!;
        return {
          merchantId: m.id,
          merchantName: m.name,
          productId: product.id,
          productName: product.name,
          productPriceEUR: product.basePriceEUR,
          incentiveType: "cashback",
          percent: pct,
          distanceMeters: m.distanceMeters,
        };
      });

      const reasoning = [
        `Cold weather (${brief.context.weather.temperatureC}°C, ${brief.context.weather.conditions}) supports a warm-indoor journey.`,
        `User declared intent: "${brief.context.declared.intent.replace(/_/g, " ")}" during ${brief.context.time.label}.`,
        ...items.map((it) => {
          const ins = brief.insights.find((x) => x.merchantId === it.merchantId)!;
          return `${it.merchantName} is ${ins.businessState.replace("_", " ")} (urgency ${ins.urgencyScore}) — bundling helps refill demand.`;
        }),
        `Total walk fits within ${brief.context.declared.walkingToleranceMeters}m tolerance.`,
        "Chose the smallest sufficient cashback per merchant (long-term value over deep discount).",
      ];

      return {
        decision: "bundle_offer",
        selectedMerchantIds: items.map((i) => i.merchantId),
        items,
        consumerIncentivesOffered: items.map(
          (i) => `${i.percent}% cashback on ${i.productName} at ${i.merchantName}`,
        ),
        merchantIncentivesOffered: items.map(
          (i) => `Qualified high-intent visit from ${brief.context.user.displayName} (${i.distanceMeters}m)`,
        ),
        utilityAssessment: {
          consumerUtility: 82,
          merchantUtility: 78,
          platformUtility: 88,
        },
        longTermGoalFit: [
          "increases sustainable merchant footfall",
          "supports merchant cooperation",
          "respects consumer attention with one high-relevance offer",
        ],
        reasoning,
        consumerHeadline: "Cold outside? Make it a warm city break.",
        consumerSubheadline:
          "Start with a cappuccino nearby, then get cashback on a paperback around the corner.",
        cta: "Claim bundle",
        confidence: 0.86,
      };
    }

    // Fallback: single offer for the most urgent considered merchant.
    const consideredCandidates = brief.candidates.filter((c) => c.considered);
    const top = [...consideredCandidates].sort((a, b) => b.fitScore - a.fitScore)[0];
    if (top) {
      const m = getMerchant(top.merchantId)!;
      const product = m.products[0];
      const item: OfferItem = {
        merchantId: m.id,
        merchantName: m.name,
        productId: product.id,
        productName: product.name,
        productPriceEUR: product.basePriceEUR,
        incentiveType: "cashback",
        percent: Math.min(10, m.rules.maxDiscountPercent),
        distanceMeters: m.distanceMeters,
      };
      return {
        decision: "single_offer",
        selectedMerchantIds: [m.id],
        items: [item],
        consumerIncentivesOffered: [`${item.percent}% cashback on ${item.productName}`],
        merchantIncentivesOffered: ["Qualified visit from nearby user"],
        utilityAssessment: { consumerUtility: 60, merchantUtility: 65, platformUtility: 70 },
        longTermGoalFit: ["protect consumer attention", "support local merchant"],
        reasoning: [`Single offer chosen — no strong bundle available.`],
        consumerHeadline: `A small reward nearby`,
        consumerSubheadline: `${item.percent}% cashback at ${item.merchantName}`,
        cta: "Claim offer",
        confidence: 0.6,
      };
    }

    return {
      decision: "no_offer",
      selectedMerchantIds: [],
      items: [],
      consumerIncentivesOffered: [],
      merchantIncentivesOffered: [],
      utilityAssessment: { consumerUtility: 0, merchantUtility: 0, platformUtility: 30 },
      longTermGoalFit: ["protect consumer attention"],
      reasoning: ["No relevant merchants/bundles match current context — staying silent is the best action."],
      consumerHeadline: "",
      consumerSubheadline: "",
      cta: "",
      confidence: 0.7,
    };
  },
};