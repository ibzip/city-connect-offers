import type {
  BusinessState,
  MerchantConfig,
  MerchantInsightSnapshot,
  PaymentDensity,
} from "../types";

export function calculateTransactionDropPercent(d: PaymentDensity): number {
  if (d.baselineTransactions === 0) return 0;
  return Math.round(
    ((d.baselineTransactions - d.currentTransactions) / d.baselineTransactions) * 100,
  );
}

export function calculateBusinessState(dropPct: number): BusinessState {
  if (dropPct >= 50) return "very_quiet";
  if (dropPct >= 25) return "quiet";
  if (dropPct <= -25) return "busy";
  return "normal";
}

export function calculateUrgencyScore(
  dropPct: number,
  d: PaymentDensity,
): number {
  const dropPart = Math.max(0, Math.min(60, dropPct)); // up to 60
  const revRatio = d.baselineRevenueEUR > 0
    ? 1 - d.currentRevenueEUR / d.baselineRevenueEUR
    : 0;
  const revPart = Math.round(Math.max(0, revRatio) * 40); // up to 40
  return Math.max(0, Math.min(100, Math.round(dropPart + revPart)));
}

export function calculateBundleReadinessScore(
  m: MerchantConfig,
  state: BusinessState,
): number {
  let score = 50;
  if (m.bundlePermissions.allowsBundles) score += 25;
  if (state === "very_quiet") score += 17;
  else if (state === "quiet") score += 12;
  else if (state === "normal") score += 0;
  if (m.bundlePermissions.preferredPartnerCategories.length > 0) score += 5;
  return Math.max(0, Math.min(100, score));
}

export function assignConsumerJourneyFitTags(
  m: MerchantConfig,
  weatherC: number,
  timeLabel: string,
): string[] {
  const tags: string[] = [];
  if (weatherC <= 14 && m.category === "cafe") tags.push("warm_indoor");
  if (m.category === "bookshop") tags.push("calm_browse");
  if (timeLabel.includes("lunch") && (m.category === "cafe" || m.category === "bookshop"))
    tags.push("lunch_break_friendly");
  if (m.category === "florist") tags.push("gift_moment");
  return tags;
}

export function buildMerchantInsightSnapshot(
  m: MerchantConfig,
  d: PaymentDensity,
  weatherC: number,
  timeLabel: string,
): MerchantInsightSnapshot {
  const dropPct = calculateTransactionDropPercent(d);
  const state = calculateBusinessState(dropPct);
  const urgency = calculateUrgencyScore(dropPct, d);
  const readiness = calculateBundleReadinessScore(m, state);
  const tags = assignConsumerJourneyFitTags(m, weatherC, timeLabel);
  const summary = buildSummary(m, state, dropPct, urgency);
  return {
    merchantId: m.id,
    businessState: state,
    transactionDropPercent: dropPct,
    urgencyScore: urgency,
    bundleReadinessScore: readiness,
    consumerJourneyFitTags: tags,
    insightSummary: summary,
    updatedAt: Date.now(),
  };
}

function buildSummary(
  m: MerchantConfig,
  state: BusinessState,
  dropPct: number,
  urgency: number,
): string {
  if (state === "very_quiet") {
    return `${m.name} is very quiet right now (${dropPct}% transactions vs baseline). High urgency (${urgency}) — strong candidate for activation.`;
  }
  if (state === "quiet") {
    return `${m.name} is quieter than usual (${dropPct}% drop). Moderate urgency (${urgency}).`;
  }
  if (state === "busy") {
    return `${m.name} is busier than baseline. No activation needed.`;
  }
  return `${m.name} is performing at normal demand. Low urgency (${urgency}).`;
}