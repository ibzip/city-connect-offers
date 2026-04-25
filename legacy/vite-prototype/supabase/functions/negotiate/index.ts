// City Wallet — gpt-5.2 negotiation agent.
// Receives a NegotiationBrief, asks the model to pick a bundle,
// returns a strict JSON NegotiationDecision shape.
// On any upstream failure (429/402/network/parse), returns a cached fallback
// so the live demo never breaks.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MODEL = "openai/gpt-5.2";

const decisionSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "decision",
    "selectedMerchantIds",
    "items",
    "consumerIncentivesOffered",
    "merchantIncentivesOffered",
    "utilityAssessment",
    "longTermGoalFit",
    "reasoning",
    "consumerHeadline",
    "consumerSubheadline",
    "cta",
    "confidence",
  ],
  properties: {
    decision: {
      type: "string",
      enum: ["no_offer", "single_offer", "bundle_offer"],
    },
    selectedMerchantIds: { type: "array", items: { type: "string" } },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "merchantId",
          "merchantName",
          "productId",
          "productName",
          "productPriceEUR",
          "incentiveType",
          "percent",
          "distanceMeters",
        ],
        properties: {
          merchantId: { type: "string" },
          merchantName: { type: "string" },
          productId: { type: "string" },
          productName: { type: "string" },
          productPriceEUR: { type: "number" },
          incentiveType: {
            type: "string",
            enum: ["cashback", "discount", "priority_pickup", "bundle_unlock"],
          },
          percent: { type: "number" },
          distanceMeters: { type: "number" },
        },
      },
    },
    consumerIncentivesOffered: { type: "array", items: { type: "string" } },
    merchantIncentivesOffered: { type: "array", items: { type: "string" } },
    utilityAssessment: {
      type: "object",
      additionalProperties: false,
      required: ["consumerUtility", "merchantUtility", "platformUtility"],
      properties: {
        consumerUtility: { type: "number" },
        merchantUtility: { type: "number" },
        platformUtility: { type: "number" },
      },
    },
    longTermGoalFit: { type: "array", items: { type: "string" } },
    reasoning: { type: "array", items: { type: "string" } },
    consumerHeadline: { type: "string" },
    consumerSubheadline: { type: "string" },
    cta: { type: "string" },
    confidence: { type: "number" },
  },
};

const SYSTEM_PROMPT = `You are the negotiation agent inside "City Wallet", an AI-powered local-commerce wallet.

You sit between ONE consumer (with a declared context, walking tolerance, privacy mode, reward preference) and several local merchants (each with goals, daily budget, max discount, allowed offer types, and a real-time business state derived from payment data).

You will receive a NegotiationBrief as JSON. You must decide whether to:
  - emit a "bundle_offer" combining 2 merchants into a coherent local journey,
  - emit a "single_offer" for one merchant,
  - or emit "no_offer" (staying silent is a valid, and often correct, decision).

HARD CONSTRAINTS — your response will be programmatically validated and rejected if violated:
  1. Only reference merchants that appear in brief.candidates. NEVER invent a merchant.
  2. Only reference products that exist in that merchant's products list (use the exact id, name, and basePriceEUR).
  3. percent must be <= that merchant's rules.maxDiscountPercent AND <= brief.offerPolicy.maxDiscountPercent.
  4. cashback (productPriceEUR * percent / 100) must be <= that merchant's rules.dailyBudgetEUR.
  5. incentiveType must be in BOTH that merchant's allowedOfferTypes AND brief.offerPolicy.allowedOfferTypes.
  6. For "bundle_offer": at most brief.bundlePolicy.maxMerchantsPerBundle merchants, both must allowsBundles, sum of distanceMeters <= max(bundlePolicy.maxWalkingMeters, declared.walkingToleranceMeters).
  7. Never include emails, phone numbers, or street addresses anywhere in your output.

SOFT GUIDANCE (you have judgement here):
  - Prefer the smallest sufficient incentive — long-term trust beats deep discounts.
  - Prefer bundles only when at least one merchant is "quiet" or "very_quiet" AND the category pairing is plausible (cafe+bookshop, cafe+bakery, restaurant+florist, etc.).
  - Match the consumer's declared intent and the weather/time context. A cold overcast lunch break with intent "warm_city_break" should produce a warm, indoor, calm bundle.
  - The headline + subheadline are written for the consumer. Warm, neighborly, never pushy. No emojis. No exclamation marks. Under 70 chars each.
  - reasoning is an array of 3–6 short sentences explaining WHY this is the right call — these are shown in the live "AI negotiation" panel during the demo.

You MUST respond by calling the submit_decision tool exactly once.`;

function buildFallback(brief: any) {
  // Hardcoded "Warm City Break" — used only when the live LLM call fails.
  const cafe = brief?.candidates?.find?.((c: any) => c.merchantId === "cafe_muller");
  const book = brief?.candidates?.find?.((c: any) => c.merchantId === "buchhandlung_anna");
  const havePair = cafe && book;

  if (!havePair) {
    return {
      decision: "no_offer",
      selectedMerchantIds: [],
      items: [],
      consumerIncentivesOffered: [],
      merchantIncentivesOffered: [],
      utilityAssessment: { consumerUtility: 0, merchantUtility: 0, platformUtility: 30 },
      longTermGoalFit: ["protect consumer attention"],
      reasoning: ["Fallback engaged. No suitable cafe+bookshop pairing in the candidate set."],
      consumerHeadline: "",
      consumerSubheadline: "",
      cta: "",
      confidence: 0.5,
      _fallback: true,
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
      "Qualified high-intent visit (80m walk) — refills a quiet afternoon seat",
      "Curious foot-traffic conversion on a single-book purchase (120m walk)",
    ],
    utilityAssessment: { consumerUtility: 82, merchantUtility: 78, platformUtility: 88 },
    longTermGoalFit: [
      "increases sustainable merchant footfall",
      "supports local merchant cooperation",
      "respects consumer attention with one high-relevance offer",
    ],
    reasoning: [
      "Cold overcast lunch break aligns with the user's declared 'warm city break' intent.",
      "Café Müller is very quiet right now — bundling refills demand without deep discounting.",
      "Buchhandlung Anna is a calm, indoor follow-on a short walk away — a coherent local journey, not a coupon dump.",
      "Both merchants opted into bundles and both can absorb a small cashback within their daily budget.",
      "Smallest sufficient incentive used per merchant — long-term trust over a one-time deep discount.",
    ],
    consumerHeadline: "Cold outside? Make it a warm city break.",
    consumerSubheadline: "Cappuccino nearby, then a paperback around the corner.",
    cta: "Claim bundle",
    confidence: 0.86,
    _fallback: true,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let brief: any = null;
  try {
    const body = await req.json();
    brief = body?.brief;
    if (!brief || typeof brief !== "object") {
      return new Response(JSON.stringify({ error: "Missing 'brief' in request body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (_e) {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    console.error("LOVABLE_API_KEY missing — returning fallback");
    return new Response(
      JSON.stringify({
        decision: buildFallback(brief),
        source: "fallback",
        reason: "LOVABLE_API_KEY not configured",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const userMsg = `Here is the NegotiationBrief. Decide what to do and call submit_decision.\n\n${JSON.stringify(brief, null, 2)}`;

    const upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMsg },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "submit_decision",
              description:
                "Submit the negotiation decision for City Wallet. This is the ONLY way to respond.",
              parameters: decisionSchema,
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "submit_decision" } },
      }),
    });

    if (upstream.status === 429) {
      console.warn("Gateway 429 — returning fallback");
      return new Response(
        JSON.stringify({
          decision: buildFallback(brief),
          source: "fallback",
          reason: "rate_limited",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (upstream.status === 402) {
      console.warn("Gateway 402 — returning fallback");
      return new Response(
        JSON.stringify({
          decision: buildFallback(brief),
          source: "fallback",
          reason: "credits_exhausted",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!upstream.ok) {
      const txt = await upstream.text();
      console.error("Gateway error", upstream.status, txt);
      return new Response(
        JSON.stringify({
          decision: buildFallback(brief),
          source: "fallback",
          reason: `upstream_${upstream.status}`,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const data = await upstream.json();
    const toolCall = data?.choices?.[0]?.message?.tool_calls?.[0];
    const argsStr = toolCall?.function?.arguments;
    if (!argsStr) {
      console.error("No tool_call in response", JSON.stringify(data).slice(0, 500));
      return new Response(
        JSON.stringify({
          decision: buildFallback(brief),
          source: "fallback",
          reason: "no_tool_call",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let parsed: any;
    try {
      parsed = JSON.parse(argsStr);
    } catch (e) {
      console.error("Failed to parse tool args", e);
      return new Response(
        JSON.stringify({
          decision: buildFallback(brief),
          source: "fallback",
          reason: "parse_error",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        decision: parsed,
        source: "live",
        model: MODEL,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("negotiate error:", e);
    return new Response(
      JSON.stringify({
        decision: buildFallback(brief),
        source: "fallback",
        reason: "exception",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});