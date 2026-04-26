import { bundlePolicy, offerPolicy } from "@city-wallet/config";
import {
  NegotiationDecisionSchema,
  type ConsumerContextSnapshot,
  type Merchant,
  type NegotiationDecision,
  type ValidationCheck,
  type ValidationResult,
} from "@city-wallet/contracts";
import { calculateDistanceMeters } from "@city-wallet/utils";

export function schemaValidator(decision: NegotiationDecision): ValidationCheck {
  const parsed = NegotiationDecisionSchema.safeParse(decision);
  return {
    validator: "schema",
    passed: parsed.success,
    detail: parsed.success ? "Negotiation decision matches the shared contract." : parsed.error.message,
  };
}

export function merchantExistsValidator(decision: NegotiationDecision, merchants: Merchant[]): ValidationCheck {
  const ids = new Set(merchants.map((merchant) => merchant.id));
  const passed = decision.selectedMerchants.every((selection) => ids.has(selection.merchantId));
  return {
    validator: "merchant_exists",
    passed,
    detail: passed ? "All selected merchants exist." : "Decision references an unknown merchant.",
  };
}

export function discountCapValidator(decision: NegotiationDecision, merchants: Merchant[]): ValidationCheck {
  const passed = decision.selectedMerchants.every((selection) => {
    const merchant = merchants.find((candidate) => candidate.id === selection.merchantId);
    const percent = selection.incentive.percent ?? 0;
    return percent <= (merchant?.rule?.maxDiscountPercent ?? 0) && percent <= offerPolicy.maxDiscountPercent;
  });
  return {
    validator: "discount_cap",
    passed,
    detail: passed ? "All incentives are within merchant and platform caps." : "An incentive exceeds a configured cap.",
  };
}

export function merchantBudgetValidator(decision: NegotiationDecision, merchants: Merchant[]): ValidationCheck {
  const passed = decision.selectedMerchants.every((selection) => {
    const merchant = merchants.find((candidate) => candidate.id === selection.merchantId);
    const product = merchant?.products.find((candidate) => candidate.name === selection.product);
    const cashback = (product?.priceEuro ?? 0) * ((selection.incentive.percent ?? 0) / 100);
    return cashback <= (merchant?.rule?.dailyBudgetRemainingEuro ?? 0);
  });
  return {
    validator: "merchant_budget",
    passed,
    detail: passed ? "Estimated cashback fits remaining budgets." : "Estimated cashback exceeds a remaining budget.",
  };
}

export function bundleSizeValidator(decision: NegotiationDecision): ValidationCheck {
  const passed = decision.decision !== "bundle_offer" || decision.selectedMerchants.length <= bundlePolicy.maxMerchantsPerBundle;
  return {
    validator: "bundle_size",
    passed,
    detail: `Bundle contains ${decision.selectedMerchants.length} merchants; max is ${bundlePolicy.maxMerchantsPerBundle}.`,
  };
}

export function walkingDistanceValidator(
  decision: NegotiationDecision,
  merchants: Merchant[],
  context: ConsumerContextSnapshot,
): ValidationCheck {
  const totalDistance = decision.selectedMerchants.reduce((sum, selection) => {
    const merchant = merchants.find((candidate) => candidate.id === selection.merchantId);
    if (merchant && context.userLocation && merchant.latitude !== undefined && merchant.longitude !== undefined) {
      return sum + calculateDistanceMeters(context.userLocation.latitude, context.userLocation.longitude, merchant.latitude, merchant.longitude);
    }
    return sum + (merchant?.distanceMeters ?? 9999);
  }, 0);
  const passed = totalDistance <= Math.max(context.walkingToleranceMeters, bundlePolicy.maxWalkingMeters);
  return {
    validator: "walking_distance",
    passed,
    detail: `Total walk ${totalDistance}m against policy/user limit.`,
  };
}

export function participationStatusValidator(decision: NegotiationDecision, merchants: Merchant[]): ValidationCheck {
  const demoAllowed = process.env.DEMO_MODE === "true" && process.env.ALLOW_DEMO_PARTNER_OFFERS === "true";
  const failed = decision.selectedMerchants.find((selection) => {
    const merchant = merchants.find((candidate) => candidate.id === selection.merchantId);
    const status = merchant?.participationStatus ?? "partner";
    if (status === "partner") return false;
    if (status === "demo_partner" && demoAllowed) return false;
    return true;
  });
  return {
    validator: "participation_status",
    passed: !failed,
    detail: failed
      ? "Selected merchant is not eligible: discovered-only merchants cannot receive offers, and demo partners require demo flags."
      : "Selected merchants are either partners or demo partners allowed by demo flags.",
  };
}

export function coordinateRequiredValidator(decision: NegotiationDecision, merchants: Merchant[]): ValidationCheck {
  const passed = decision.selectedMerchants.every((selection) => {
    const merchant = merchants.find((candidate) => candidate.id === selection.merchantId);
    return merchant?.latitude !== undefined && merchant.longitude !== undefined;
  });
  return {
    validator: "coordinates_required",
    passed,
    detail: passed ? "Every selected merchant has coordinates for geofence and walking-distance validation." : "A selected merchant is missing coordinates.",
  };
}

export function merchantConsentValidator(decision: NegotiationDecision, merchants: Merchant[]): ValidationCheck {
  const passed = decision.decision !== "bundle_offer" || decision.selectedMerchants.every((selection) => {
    const merchant = merchants.find((candidate) => candidate.id === selection.merchantId);
    return Boolean(merchant?.rule?.allowsBundles);
  });
  return {
    validator: "merchant_consent",
    passed,
    detail: passed ? "All merchants opted into bundles." : "A selected merchant has not opted into bundles.",
  };
}

export function privacyValidator(decision: NegotiationDecision): ValidationCheck {
  const text = JSON.stringify(decision);
  const passed = !/(email|phone|street address|birthdate|precise gps)/i.test(text);
  return {
    validator: "privacy",
    passed,
    detail: passed ? "No raw personal data appears in the decision." : "Decision contains raw personal data.",
  };
}

export function offerTypeValidator(decision: NegotiationDecision, merchants: Merchant[]): ValidationCheck {
  const passed = decision.selectedMerchants.every((selection) => {
    const merchant = merchants.find((candidate) => candidate.id === selection.merchantId);
    return Boolean(
      merchant?.rule?.offerTypesAllowed.includes(selection.incentive.type) &&
      offerPolicy.allowedOfferTypes.includes(selection.incentive.type),
    );
  });
  return {
    validator: "offer_type",
    passed,
    detail: passed ? "Offer types are allowed by merchant and platform policy." : "An offer type is not allowed.",
  };
}

export function validateNegotiationDecision(input: {
  decision: NegotiationDecision;
  merchants: Merchant[];
  context: ConsumerContextSnapshot;
}): ValidationResult {
  if (input.decision.decision === "no_offer") {
    return {
      valid: true,
      errors: [],
      warnings: ["No offer decision; validators skipped offer-specific checks."],
      checks: [schemaValidator(input.decision)],
    };
  }

  const checks = [
    schemaValidator(input.decision),
    merchantExistsValidator(input.decision, input.merchants),
    discountCapValidator(input.decision, input.merchants),
    merchantBudgetValidator(input.decision, input.merchants),
    bundleSizeValidator(input.decision),
    walkingDistanceValidator(input.decision, input.merchants, input.context),
    participationStatusValidator(input.decision, input.merchants),
    coordinateRequiredValidator(input.decision, input.merchants),
    merchantConsentValidator(input.decision, input.merchants),
    privacyValidator(input.decision),
    offerTypeValidator(input.decision, input.merchants),
  ];
  const errors = checks.filter((check) => !check.passed).map((check) => `${check.validator}: ${check.detail}`);

  return {
    valid: errors.length === 0,
    errors,
    warnings: checks.some((check) => check.validator === "discount_cap" && check.passed)
      ? ["Validators accepted smallest-sufficient incentives under configured caps."]
      : [],
    checks,
  };
}
