import { bundlePolicy, offerCopyConfig, offerPolicy, platformGoalModel, triggerConfig } from "@city-wallet/config";
import type {
  BundleCandidate,
  CandidateMerchant,
  ConsumerAgentPosition,
  ConsumerContextSnapshot,
  Merchant,
  MerchantInsightSnapshot,
  NegotiationBrief,
  NegotiationDecision,
  OfferType,
  TriggerConfig,
  UserEvent,
} from "@city-wallet/contracts";
import { calculateDistanceMeters, makeId, nowIso, withTimeout } from "@city-wallet/utils";

export function evaluateUserTriggers(
  event: UserEvent,
  triggers: TriggerConfig[] = triggerConfig,
) {
  return triggers.filter((trigger) => trigger.enabled && trigger.eventType === event.eventType);
}

export function selectCandidateMerchants(
  merchants: Merchant[],
  insights: MerchantInsightSnapshot[],
  context: ConsumerContextSnapshot,
): CandidateMerchant[] {
  const maxDistance = Math.max(context.walkingToleranceMeters, bundlePolicy.maxWalkingMeters);

  return merchants.map((merchant) => {
    const insight = insights.find((candidate) => candidate.merchantId === merchant.id);
    const rule = merchant.rule;
    const matchedZoneIds = new Set([context.zoneId, ...(context.matchedZones ?? []).map((zone) => zone.id)]);
    const coordinatesAvailable = merchant.latitude !== undefined && merchant.longitude !== undefined;
    const calculatedDistance = context.userLocation && coordinatesAvailable
      ? calculateDistanceMeters(context.userLocation.latitude, context.userLocation.longitude, merchant.latitude!, merchant.longitude!)
      : merchant.distanceMeters;
    const calculatedFromCoordinates = Boolean(context.userLocation && coordinatesAvailable);
    const inZone = matchedZoneIds.has(merchant.zoneId);
    const inWalkingRange = calculatedDistance <= maxDistance;
    const hasBudget = (rule?.dailyBudgetRemainingEuro ?? 0) > 0;
    const allowsOffer = (rule?.offerTypesAllowed.length ?? 0) > 0;
    const hasInsight = Boolean(insight);
    const coordinateEligible = coordinatesAvailable;
    const status = merchant.participationStatus ?? "partner";
    const demoAllowed = process.env.DEMO_MODE === "true" && process.env.ALLOW_DEMO_PARTNER_OFFERS === "true";
    const participationEligible = status === "partner" || (status === "demo_partner" && demoAllowed);
    const contextFit = calculateContextFit(merchant, insight, context);

    let fitScore = 0;
    fitScore += inZone ? 18 : 0;
    fitScore += inWalkingRange ? 18 : 0;
    fitScore += hasBudget ? 10 : 0;
    fitScore += allowsOffer ? 10 : 0;
    fitScore += participationEligible ? 8 : 0;
    fitScore += insight?.businessState === "very_quiet" ? 26 : insight?.businessState === "quiet" ? 18 : insight?.businessState === "normal" ? 6 : 0;
    fitScore += Math.round((insight?.bundleReadinessScore ?? 0) * 0.12);
    fitScore += contextFit;
    fitScore = Math.min(100, fitScore);

    let considered = inZone && inWalkingRange && hasBudget && allowsOffer && hasInsight && participationEligible && coordinateEligible;
    let rejectedReason: string | undefined;
    if (!inZone) rejectedReason = "outside the active zone";
    else if (!coordinateEligible) rejectedReason = "missing coordinates, excluded from distance-based eligibility";
    else if (!inWalkingRange) rejectedReason = "beyond walking tolerance";
    else if (!hasBudget) rejectedReason = "no remaining merchant budget";
    else if (!allowsOffer) rejectedReason = "no allowed offer types";
    else if (!hasInsight) rejectedReason = "missing merchant insight snapshot";
    else if (!participationEligible) rejectedReason = status === "demo_partner"
      ? "demo partner offers disabled"
      : `${status} merchants are not eligible for offers`;
    else if (insight?.businessState === "busy") {
      considered = false;
      rejectedReason = "merchant is busier than baseline";
    }

    return {
      merchantId: merchant.id,
      merchantName: merchant.name,
      category: merchant.category,
      distanceMeters: calculatedDistance,
      source: merchant.source,
      participationStatus: status,
      calculatedFromCoordinates,
      coordinateEligible,
      demoDisclosure: merchant.demoDisclosure,
      businessState: insight?.businessState ?? "normal",
      fitScore,
      considered,
      reason: considered
        ? `${merchant.category} in zone, ${calculatedDistance}m away, ${insight?.businessState ?? "normal"} demand, ${status} supply, context fit ${contextFit}`
        : rejectedReason ?? "not considered",
      rejectedReason,
    };
  }).sort((left, right) => right.fitScore - left.fitScore);
}

export function buildBundleCandidates(
  merchants: Merchant[],
  candidates: CandidateMerchant[],
  insights: MerchantInsightSnapshot[],
  context: ConsumerContextSnapshot,
): BundleCandidate[] {
  const considered = candidates.filter((candidate) => candidate.considered);
  const bundles: BundleCandidate[] = [];

  for (let leftIndex = 0; leftIndex < considered.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < considered.length; rightIndex += 1) {
      const left = merchants.find((merchant) => merchant.id === considered[leftIndex].merchantId);
      const right = merchants.find((merchant) => merchant.id === considered[rightIndex].merchantId);
      if (!left || !right) continue;

      const leftInsight = insights.find((insight) => insight.merchantId === left.id);
      const rightInsight = insights.find((insight) => insight.merchantId === right.id);
      if (!leftInsight || !rightInsight) continue;

      const combinedDistanceMeters = considered[leftIndex].distanceMeters + considered[rightIndex].distanceMeters;
      const sameZone = left.zoneId === right.zoneId;
      const consent = Boolean(left.rule?.allowsBundles && right.rule?.allowsBundles);
      const atLeastOneQuiet = [leftInsight.businessState, rightInsight.businessState].some((state) => state === "quiet" || state === "very_quiet");
      const pairingStrength = calculatePairingStrength(left.category, right.category);
      const contextFit = calculateContextFit(left, leftInsight, context) + calculateContextFit(right, rightInsight, context);
      const normalDemandPenalty = [leftInsight.businessState, rightInsight.businessState].some((state) => state === "normal") ? 30 : 0;
      const weaknesses: string[] = [];

      if (!sameZone) weaknesses.push("different zones");
      if (!consent) weaknesses.push("missing merchant consent");
      if (!atLeastOneQuiet) weaknesses.push("no quiet merchant");
      if (combinedDistanceMeters > bundlePolicy.maxWalkingMeters) weaknesses.push("walking distance above bundle policy");
      if (pairingStrength < 0) weaknesses.push("weak category pairing");

      let preliminaryScore = 0;
      preliminaryScore += sameZone ? 14 : 0;
      preliminaryScore += consent ? 12 : 0;
      preliminaryScore += combinedDistanceMeters <= context.walkingToleranceMeters ? 16 : 8;
      preliminaryScore += atLeastOneQuiet ? 12 : 0;
      preliminaryScore += pairingStrength;
      preliminaryScore += Math.round((leftInsight.urgencyScore + rightInsight.urgencyScore) * 0.18);
      preliminaryScore += Math.round((leftInsight.bundleReadinessScore + rightInsight.bundleReadinessScore) * 0.08);
      preliminaryScore += contextFit;
      preliminaryScore -= normalDemandPenalty;
      preliminaryScore = Math.max(0, Math.min(100, preliminaryScore));

      bundles.push({
        bundleCandidateId: `bundle_${left.id}__${right.id}`,
        merchantIds: [left.id, right.id],
        categories: [left.category, right.category],
        combinedDistanceMeters,
        preliminaryScore,
        whyCandidateExists: [
          `${left.category} + ${right.category}`,
          pairingStrength >= 18 ? "strong complementary pairing" : pairingStrength < 0 ? "weak pairing" : "neutral pairing",
          atLeastOneQuiet ? "has quiet demand to lift" : "normal demand",
          `${combinedDistanceMeters}m combined walk`,
        ].join(" · "),
        weaknesses: weaknesses.length > 0 ? weaknesses : undefined,
      });
    }
  }

  return bundles.sort((left, right) => right.preliminaryScore - left.preliminaryScore);
}

export function buildNegotiationBrief(input: {
  userEvent: UserEvent;
  consumerContext: ConsumerContextSnapshot;
  consumerAgentPosition: ConsumerAgentPosition;
  merchantInsights: MerchantInsightSnapshot[];
  candidateMerchants: CandidateMerchant[];
  bundleCandidates: BundleCandidate[];
}): NegotiationBrief {
  return {
    briefId: makeId("brief"),
    userEvent: input.userEvent,
    consumerContext: input.consumerContext,
    consumerAgentPosition: input.consumerAgentPosition,
    merchantInsights: input.merchantInsights,
    candidateMerchants: input.candidateMerchants,
    bundleCandidates: input.bundleCandidates,
    bundlePolicy,
    offerPolicy,
    platformGoalModel,
    createdAt: nowIso(),
  };
}

export interface LLMClient {
  generateNegotiationDecision(brief: NegotiationBrief, merchants?: Merchant[]): Promise<NegotiationDecision>;
}

export class MockLLMClient implements LLMClient {
  async generateNegotiationDecision(brief: NegotiationBrief, merchants: Merchant[] = []): Promise<NegotiationDecision> {
    const validBundles = brief.bundleCandidates.filter((candidate) => !candidate.weaknesses?.some((weakness) => weakness.includes("missing") || weakness.includes("above")));
    const bestBundle = validBundles[0];
    if (!bestBundle || bestBundle.preliminaryScore < brief.consumerAgentPosition.minimumUtilityThreshold) {
      return noOfferDecision(brief, "No candidate reached the minimum utility threshold.");
    }

    const selectedMerchants = bestBundle.merchantIds
      .map((merchantId) => merchants.find((merchant) => merchant.id === merchantId))
      .filter((merchant): merchant is Merchant => Boolean(merchant))
      .slice(0, bundlePolicy.maxMerchantsPerBundle)
      .map((merchant) => {
        const insight = brief.merchantInsights.find((candidate) => candidate.merchantId === merchant.id);
        const product = chooseProduct(merchant, brief.consumerContext);
        const incentivePercent = chooseIncentivePercent(merchant, insight);
        return {
          merchantId: merchant.id,
          product: product?.name ?? merchant.rule?.eligibleProducts[0] ?? "Eligible item",
          incentive: {
            type: chooseOfferType(merchant),
            percent: incentivePercent,
            valueText: `${incentivePercent}% cashback`,
          },
          roleInJourney: chooseRoleInJourney(merchant.category),
        };
      });

    if (selectedMerchants.length < 2) {
      return noOfferDecision(brief, "The highest-scoring bundle did not resolve to two merchant records.");
    }

    const rejectedCandidates = brief.candidateMerchants
      .filter((candidate) => !bestBundle.merchantIds.includes(candidate.merchantId))
      .map((candidate) => ({
        id: candidate.merchantId,
        reason: candidate.businessState === "normal"
          ? `${candidate.category} lower-ranked because demand is normal and context fit is weaker.`
          : candidate.rejectedReason ?? "lower-ranked than selected journey",
      }));

    return {
      decision: "bundle_offer",
      selectedMerchants,
      validityMinutes: bundlePolicy.maxValidityMinutes,
      consumerIncentivesOffered: selectedMerchants.map((merchant) => `${merchant.incentive.valueText} on ${merchant.product}`),
      merchantIncentivesOffered: selectedMerchants.map((merchant) => `Qualified nearby visit for ${merchant.merchantId}`),
      utilityAssessment: {
        consumer: {
          score: 86,
          whyPositive: ["high context relevance", "short walk", "one coherent local journey"],
          risks: ["consumer attention should remain capped"],
        },
        merchants: selectedMerchants.map((merchant) => ({
          merchantId: merchant.merchantId,
          score: merchant.incentive.percent && merchant.incentive.percent >= 15 ? 84 : 78,
          whyPositive: ["demand lift without maximum discounting", "nearby intent-qualified visit"],
          risks: ["budget must remain enforced by validators"],
        })),
        platform: {
          score: 88,
          whyPositive: ["supports trusted local commerce", "avoids random coupon packs"],
          risks: ["bundle should stay explainable"],
        },
      },
      longTermGoalFit: {
        consumer: ["privacy preserved", "useful local discovery without spam"],
        merchants: ["sustainable quiet-period demand", "smallest sufficient incentive"],
        platform: ["local ecosystem value", "long-term mutual utility"],
      },
      reasoning: buildReasoning(brief, bestBundle),
      rejectedCandidates,
      consumerHeadline: buildHeadline(brief.consumerContext),
      consumerSubheadline: buildSubheadline(selectedMerchants),
      cta: offerCopyConfig.defaultCta,
      confidence: 0.88,
    };
  }
}

export class OpenAILLMClient implements LLMClient {
  async generateNegotiationDecision(brief: NegotiationBrief): Promise<NegotiationDecision> {
    return noOfferDecision(brief, "OpenAI LLM provider placeholder; mock_llm is active by default.");
  }
}

export class AzureOpenAILLMClient implements LLMClient {
  constructor(private readonly fallback: LLMClient = new MockLLMClient()) {}

  async generateNegotiationDecision(brief: NegotiationBrief, merchants: Merchant[] = []): Promise<NegotiationDecision> {
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
    const apiKey = process.env.AZURE_OPENAI_API_KEY;
    const apiVersion = process.env.AZURE_OPENAI_API_VERSION;
    if (!endpoint || !deployment || !apiKey || !apiVersion) {
      return this.fallback.generateNegotiationDecision(brief, merchants);
    }

    try {
      const url = new URL(`/openai/deployments/${deployment}/chat/completions`, endpoint);
      url.searchParams.set("api-version", apiVersion);
      const response = await withTimeout(fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "api-key": apiKey,
        },
        body: JSON.stringify({
          temperature: 0.1,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: "Return only a JSON object matching the City Wallet NegotiationDecision contract. Respect all validation constraints and avoid unsupported merchant claims.",
            },
            {
              role: "user",
              content: JSON.stringify({ brief, merchants }),
            },
          ],
        }),
      }), Number(process.env.AZURE_OPENAI_TIMEOUT_MS ?? 15_000), "Azure OpenAI request");
      if (!response.ok) throw new Error(`Azure OpenAI ${response.status}: ${await response.text()}`);
      const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const content = body.choices?.[0]?.message?.content;
      if (!content) throw new Error("Azure OpenAI returned no content");
      const parsed = JSON.parse(content) as NegotiationDecision;
      return parsed;
    } catch {
      return this.fallback.generateNegotiationDecision(brief, merchants);
    }
  }
}

export async function runNegotiation(input: {
  brief: NegotiationBrief;
  merchants: Merchant[];
  llmClient?: LLMClient;
}) {
  const client = input.llmClient ?? (process.env.LLM_PROVIDER === "azure_openai" ? new AzureOpenAILLMClient() : new MockLLMClient());
  return client.generateNegotiationDecision(input.brief, input.merchants);
}

function calculateContextFit(
  merchant: Merchant,
  insight: MerchantInsightSnapshot | undefined,
  context: ConsumerContextSnapshot,
) {
  let score = 0;
  const tags = insight?.journeyFitTags ?? [];
  if (context.weatherMood === "cold" && tags.includes("warm_break")) score += 10;
  if (context.timeContext.includes("lunch") && tags.includes("lunch_stop")) score += 6;
  if (context.declaredIntent.includes("break") && tags.includes("browsing_break")) score += 6;
  if (context.declaredIntent.includes("break") && tags.includes("slow_discovery")) score += 5;
  if (context.declaredIntent.includes("gift") && tags.includes("gift_moment")) score += 8;
  if (merchant.category === "flower_shop" && context.declaredIntent.includes("break")) score -= 1;
  return score;
}

function calculatePairingStrength(leftCategory: string, rightCategory: string) {
  const pair = [leftCategory, rightCategory];
  const strong = bundlePolicy.exampleStrongPairings.some(([left, right]) =>
    (left === pair[0] && right === pair[1]) || (left === pair[1] && right === pair[0]),
  );
  const weak = bundlePolicy.exampleWeakPairings.some(([left, right]) =>
    (left === pair[0] && right === pair[1]) || (left === pair[1] && right === pair[0]),
  );
  if (strong) return 22;
  if (weak) return -10;
  return 6;
}

function chooseProduct(merchant: Merchant, context: ConsumerContextSnapshot) {
  const eligibleNames = new Set(merchant.rule?.eligibleProducts ?? []);
  const eligible = merchant.products.filter((product) => eligibleNames.size === 0 || eligibleNames.has(product.name));
  if (merchant.category === "cafe" && context.weatherMood === "cold") {
    return eligible.find((product) => product.category === "warm_drink") ?? eligible[0];
  }
  if (merchant.category === "bookshop") {
    return eligible.find((product) => product.category === "book") ?? eligible[0];
  }
  return eligible[0] ?? merchant.products[0];
}

function chooseOfferType(merchant: Merchant): OfferType {
  if (merchant.rule?.offerTypesAllowed.includes("cashback")) return "cashback";
  return merchant.rule?.offerTypesAllowed[0] ?? "cashback";
}

function chooseIncentivePercent(merchant: Merchant, insight?: MerchantInsightSnapshot) {
  const cap = merchant.rule?.maxDiscountPercent ?? offerPolicy.maxDiscountPercent;
  const base = insight?.businessState === "very_quiet" ? 15 : insight?.businessState === "quiet" ? 10 : 5;
  return Math.min(cap, offerPolicy.maxDiscountPercent, base);
}

function chooseRoleInJourney(category: string) {
  if (category === "cafe") return "warm starting point";
  if (category === "bookshop") return "slow discovery stop";
  if (category === "flower_shop") return "gift add-on";
  return "local stop";
}

function buildReasoning(brief: NegotiationBrief, bestBundle: BundleCandidate) {
  const states = bestBundle.merchantIds.map((merchantId) => {
    const insight = brief.merchantInsights.find((candidate) => candidate.merchantId === merchantId);
    return `${merchantId} ${insight?.businessState ?? "unknown"}`;
  });

  return [
    `${brief.consumerContext.weatherMood} weather (${brief.consumerContext.weatherDescription}) increases relevance for an indoor local stop.`,
    `${brief.consumerContext.timeContext} and ${brief.consumerContext.declaredIntent} indicate the user has limited but real intent.`,
    `${states[0]} and ${states[1]} are both nearby, so the offer can lift demand without long walking friction.`,
    "The bundle is a coherent local journey, not a random coupon pack.",
    "A flower_shop candidate was considered but lower-ranked because current demand is normal and context fit is weaker for this intent.",
    "Incentives use the smallest sufficient cashback under merchant caps, not the maximum available discount.",
    "Privacy is preserved: the brief uses abstract intent and local context, not raw personal data.",
  ];
}

function buildHeadline(context: ConsumerContextSnapshot) {
  const match = offerCopyConfig.contextualHeadlines.find((candidate) =>
    candidate.weatherMood === context.weatherMood && context.declaredIntent.includes(candidate.declaredIntentIncludes),
  );
  return match?.headline ?? offerCopyConfig.defaultHeadline;
}

function buildSubheadline(selectedMerchants: NegotiationDecision["selectedMerchants"]) {
  const first = selectedMerchants[0];
  const second = selectedMerchants[1];
  return offerCopyConfig.twoStopSubheadlineTemplate
    .replace("{firstProduct}", first.product.toLowerCase())
    .replace("{secondProduct}", second.product.toLowerCase());
}

function noOfferDecision(brief: NegotiationBrief, reason: string): NegotiationDecision {
  return {
    decision: "no_offer",
    selectedMerchants: [],
    validityMinutes: bundlePolicy.maxValidityMinutes,
    consumerIncentivesOffered: [],
    merchantIncentivesOffered: [],
    utilityAssessment: {
      consumer: { score: 0, whyPositive: [], risks: [reason] },
      merchants: [],
      platform: { score: 50, whyPositive: ["protects consumer attention"], risks: [] },
    },
    longTermGoalFit: {
      consumer: ["avoid irrelevant interruptions"],
      merchants: ["avoid wasteful discounts"],
      platform: ["protect trust"],
    },
    reasoning: [reason],
    rejectedCandidates: brief.candidateMerchants.map((candidate) => ({
      id: candidate.merchantId,
      reason: candidate.rejectedReason ?? "below utility threshold",
    })),
    consumerHeadline: "",
    consumerSubheadline: "",
    cta: "",
    confidence: 0.6,
  };
}
