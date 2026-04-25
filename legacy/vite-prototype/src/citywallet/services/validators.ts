import type {
  MerchantConfig,
  NegotiationDecision,
  ValidationReport,
  ValidatorResult,
} from "../types";
import { bundlePolicy, offerPolicy } from "../config/policies";

export function validateDecision(
  decision: NegotiationDecision,
  merchants: MerchantConfig[],
  consumerWalkMeters: number,
): ValidationReport {
  const results: ValidatorResult[] = [];

  results.push({
    validator: "schema",
    passed: !!decision.decision && Array.isArray(decision.items),
    detail: "Decision has required schema fields",
  });

  if (decision.decision === "no_offer") {
    return { passed: true, results: [...results, { validator: "no_offer_passthrough", passed: true, detail: "No offer to validate" }] };
  }

  // Merchant exists
  const allExist = decision.items.every((it) => merchants.some((m) => m.id === it.merchantId));
  results.push({ validator: "merchant_exists", passed: allExist, detail: allExist ? "All referenced merchants exist" : "Unknown merchant in decision" });

  // Discount cap
  const discountOk = decision.items.every((it) => {
    const m = merchants.find((x) => x.id === it.merchantId)!;
    return it.percent <= m.rules.maxDiscountPercent && it.percent <= offerPolicy.maxDiscountPercent;
  });
  results.push({ validator: "discount_cap", passed: discountOk, detail: discountOk ? "All discounts within merchant + platform caps" : "Discount exceeds cap" });

  // Budget (cashback estimate <= dailyBudget)
  const budgetOk = decision.items.every((it) => {
    const m = merchants.find((x) => x.id === it.merchantId)!;
    const cashback = it.productPriceEUR * (it.percent / 100);
    return cashback <= m.rules.dailyBudgetEUR;
  });
  results.push({ validator: "budget", passed: budgetOk, detail: budgetOk ? "Cashback within daily budget" : "Exceeds daily budget" });

  // Bundle size
  const sizeOk = decision.decision !== "bundle_offer" || decision.items.length <= bundlePolicy.maxMerchantsPerBundle;
  results.push({ validator: "bundle_size", passed: sizeOk, detail: `<= ${bundlePolicy.maxMerchantsPerBundle} merchants` });

  // Walking distance
  const totalWalk = decision.items.reduce((s, it) => s + it.distanceMeters, 0);
  const walkOk = totalWalk <= Math.max(bundlePolicy.maxWalkingMeters, consumerWalkMeters);
  results.push({ validator: "walking_distance", passed: walkOk, detail: `Total ~${totalWalk}m within limit` });

  // Merchant consent
  const consentOk = decision.items.every((it) => {
    const m = merchants.find((x) => x.id === it.merchantId)!;
    return decision.decision === "single_offer" || m.bundlePermissions.allowsBundles;
  });
  results.push({ validator: "merchant_consent", passed: consentOk, detail: "All merchants opted into the action" });

  // Privacy: no raw PII in items
  const privacyOk = !JSON.stringify(decision).match(/email|phone|address/i);
  results.push({ validator: "privacy", passed: privacyOk, detail: "No raw personal data exposed" });

  // Offer type allowed
  const typeOk = decision.items.every((it) => {
    const m = merchants.find((x) => x.id === it.merchantId)!;
    return m.allowedOfferTypes.includes(it.incentiveType) && offerPolicy.allowedOfferTypes.includes(it.incentiveType);
  });
  results.push({ validator: "offer_type", passed: typeOk, detail: "Offer types allowed by merchant + platform" });

  return {
    passed: results.every((r) => r.passed),
    results,
  };
}