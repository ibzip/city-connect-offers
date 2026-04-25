import type {
  CandidateBundle,
  CandidateMerchant,
  ConsumerContext,
  MerchantConfig,
  MerchantInsightSnapshot,
} from "../types";
import { bundlePolicy } from "../config/policies";

export function selectCandidateMerchants(
  merchants: MerchantConfig[],
  insights: MerchantInsightSnapshot[],
  ctx: ConsumerContext,
): CandidateMerchant[] {
  return merchants.map((m) => {
    const insight = insights.find((i) => i.merchantId === m.id);
    const inZone = m.zoneId === ctx.location.zoneId;
    const inWalk = m.distanceMeters <= ctx.declared.walkingToleranceMeters;
    const hasBudget = m.rules.dailyBudgetEUR > 0;
    const allowsOffer = m.allowedOfferTypes.length > 0;
    const state = insight?.businessState ?? "normal";
    let fitScore = 0;
    fitScore += inZone ? 20 : 0;
    fitScore += inWalk ? 20 : 0;
    fitScore += hasBudget ? 10 : 0;
    fitScore += allowsOffer ? 10 : 0;
    fitScore += state === "very_quiet" ? 30 : state === "quiet" ? 20 : state === "normal" ? 5 : 0;
    fitScore += (insight?.consumerJourneyFitTags.length ?? 0) * 3;
    fitScore = Math.min(100, fitScore);

    let considered = inZone && inWalk && hasBudget && allowsOffer;
    let rejectedReason: string | undefined;
    let reason = `In zone, ${m.distanceMeters}m away, ${state} demand`;
    if (!inZone) { considered = false; rejectedReason = "outside zone"; }
    else if (!inWalk) { considered = false; rejectedReason = "beyond walking tolerance"; }
    else if (state === "busy") { considered = false; rejectedReason = "merchant is busy — no need to push offers"; }

    if (considered && state === "normal") {
      reason += " — weaker context fit (normal demand)";
    }

    return {
      merchantId: m.id,
      reason,
      fitScore,
      considered,
      rejectedReason,
    };
  });
}

export function buildCandidateBundles(
  merchants: MerchantConfig[],
  candidates: CandidateMerchant[],
  insights: MerchantInsightSnapshot[],
  ctx: ConsumerContext,
): CandidateBundle[] {
  const eligible = candidates.filter((c) => c.considered);
  const bundles: CandidateBundle[] = [];
  for (let i = 0; i < eligible.length; i++) {
    for (let j = i + 1; j < eligible.length; j++) {
      const aId = eligible[i].merchantId;
      const bId = eligible[j].merchantId;
      const a = merchants.find((m) => m.id === aId)!;
      const b = merchants.find((m) => m.id === bId)!;
      const ai = insights.find((x) => x.merchantId === aId)!;
      const bi = insights.find((x) => x.merchantId === bId)!;

      const totalWalk = a.distanceMeters + b.distanceMeters;
      const sameZone = a.zoneId === b.zoneId;
      const consent = a.bundlePermissions.allowsBundles && b.bundlePermissions.allowsBundles;
      const oneQuiet = [ai.businessState, bi.businessState].some((s) => s === "quiet" || s === "very_quiet");
      const pair: [string, string] = [a.category, b.category];
      const isStrong = bundlePolicy.strongPairings.some(
        (p) => (p[0] === pair[0] && p[1] === pair[1]) || (p[0] === pair[1] && p[1] === pair[0]),
      );

      let score = 0;
      score += sameZone ? 15 : 0;
      score += totalWalk <= ctx.declared.walkingToleranceMeters * 1.2 ? 20 : 5;
      score += Math.round((ai.urgencyScore + bi.urgencyScore) / 4); // up to 50
      score += isStrong ? 20 : 0;
      score += oneQuiet ? 10 : 0;
      score += Math.round((ai.bundleReadinessScore + bi.bundleReadinessScore) / 20); // up to 10
      score = Math.min(100, score);

      let rejectedReason: string | undefined;
      if (!consent) rejectedReason = "missing merchant consent";
      else if (!sameZone) rejectedReason = "different zones";
      else if (totalWalk > bundlePolicy.maxWalkingMeters) rejectedReason = "exceeds bundle walking limit";
      else if (!oneQuiet) rejectedReason = "no quiet merchant — no urgency";

      const rationale = [
        `${a.name} (${a.category}) + ${b.name} (${b.category})`,
        isStrong ? "strong category pairing" : "weak/neutral category pairing",
        oneQuiet ? "at least one quiet merchant" : "neither merchant is quiet",
        `total walk ~${totalWalk}m`,
      ].join(" · ");

      bundles.push({
        id: `bundle_${aId}__${bId}`,
        merchantIds: [aId, bId],
        preliminaryScore: score,
        rationale,
        rejectedReason,
      });
    }
  }
  bundles.sort((x, y) => y.preliminaryScore - x.preliminaryScore);
  return bundles;
}