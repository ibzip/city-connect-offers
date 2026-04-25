import type { NegotiationBrief, NegotiationDecision } from "../types";
import { supabase } from "@/integrations/supabase/client";

export type NegotiationSource = "live" | "fallback";

export interface NegotiationResult {
  decision: NegotiationDecision;
  source: NegotiationSource;
  model?: string;
  reason?: string;
  latencyMs: number;
}

/**
 * Calls the `negotiate` edge function which forwards to gpt-5.2 via the
 * Lovable AI Gateway. The edge function always returns a valid decision
 * (live or cached fallback). If even the edge function is unreachable,
 * we fall back further client-side so the demo never breaks.
 */
export async function negotiate(brief: NegotiationBrief): Promise<NegotiationResult> {
  const t0 = performance.now();
  try {
    const { data, error } = await supabase.functions.invoke("negotiate", {
      body: { brief },
    });
    const latencyMs = Math.round(performance.now() - t0);
    if (error) {
      console.error("negotiate invoke error", error);
      return {
        decision: localFallback(brief),
        source: "fallback",
        reason: "invoke_error",
        latencyMs,
      };
    }
    if (!data?.decision) {
      return {
        decision: localFallback(brief),
        source: "fallback",
        reason: "empty_response",
        latencyMs,
      };
    }
    return {
      decision: data.decision as NegotiationDecision,
      source: (data.source ?? "fallback") as NegotiationSource,
      model: data.model,
      reason: data.reason,
      latencyMs,
    };
  } catch (e) {
    console.error("negotiate threw", e);
    return {
      decision: localFallback(brief),
      source: "fallback",
      reason: "exception",
      latencyMs: Math.round(performance.now() - t0),
    };
  }
}

function localFallback(brief: NegotiationBrief): NegotiationDecision {
  const haveCafe = brief.candidates.some((c) => c.merchantId === "cafe_muller" && c.considered);
  const haveBook = brief.candidates.some((c) => c.merchantId === "buchhandlung_anna" && c.considered);
  if (!haveCafe || !haveBook) {
    return {
      decision: "no_offer",
      selectedMerchantIds: [],
      items: [],
      consumerIncentivesOffered: [],
      merchantIncentivesOffered: [],
      utilityAssessment: { consumerUtility: 0, merchantUtility: 0, platformUtility: 30 },
      longTermGoalFit: ["protect consumer attention"],
      reasoning: ["Local fallback engaged; no candidate cafe+bookshop pairing available."],
      consumerHeadline: "",
      consumerSubheadline: "",
      cta: "",
      confidence: 0.5,
    };
  }
  return {
    decision: "bundle_offer",
    selectedMerchantIds: ["cafe_muller", "buchhandlung_anna"],
    items: [
      {
        merchantId: "cafe_muller",
        merchantName: "Café Müller",
        productId: "p_capp",
        productName: "Cappuccino",
        productPriceEUR: 3.6,
        incentiveType: "cashback",
        percent: 15,
        distanceMeters: 80,
      },
      {
        merchantId: "buchhandlung_anna",
        merchantName: "Buchhandlung Anna",
        productId: "p_paperback",
        productName: "Paperback (any)",
        productPriceEUR: 12,
        incentiveType: "cashback",
        percent: 12,
        distanceMeters: 120,
      },
    ],
    consumerIncentivesOffered: [
      "15% cashback on a Cappuccino at Café Müller",
      "12% cashback on any paperback at Buchhandlung Anna",
    ],
    merchantIncentivesOffered: [
      "Qualified visit (80m walk) — refills a quiet afternoon seat",
      "Curious foot-traffic conversion (120m walk)",
    ],
    utilityAssessment: { consumerUtility: 82, merchantUtility: 78, platformUtility: 88 },
    longTermGoalFit: [
      "increases sustainable merchant footfall",
      "supports local merchant cooperation",
    ],
    reasoning: [
      "Local fallback (edge function unreachable).",
      "Cold lunch break + 'warm city break' intent → indoor calm bundle.",
      "Café Müller is very quiet — bundling refills demand.",
      "Smallest sufficient cashback per merchant.",
    ],
    consumerHeadline: "Cold outside? Make it a warm city break.",
    consumerSubheadline: "Cappuccino nearby, then a paperback around the corner.",
    cta: "Claim bundle",
    confidence: 0.7,
  };
}