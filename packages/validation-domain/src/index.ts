import { bundlePolicy, offerPolicy } from "@city-wallet/config";
import {
  NegotiationDecisionSchema,
  type ConsumerContextSnapshot,
  type Merchant,
  type NegotiationDecision,
  type SelectedMerchant,
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

function selectedMerchantsOf(decision: NegotiationDecision): NegotiationDecision["selectedMerchants"] {
  // Defensive: a malformed decision (e.g. from a misbehaving LLM that bypassed
  // schema validation) may not have `selectedMerchants` set. Treat as empty so
  // validators report `passed: false` instead of crashing the whole pipeline.
  return Array.isArray(decision?.selectedMerchants) ? decision.selectedMerchants : [];
}

export function merchantExistsValidator(decision: NegotiationDecision, merchants: Merchant[]): ValidationCheck {
  const ids = new Set(merchants.map((merchant) => merchant.id));
  const selections = selectedMerchantsOf(decision);
  const passed = selections.length > 0 && selections.every((selection) => ids.has(selection.merchantId));
  return {
    validator: "merchant_exists",
    passed,
    detail: passed
      ? "All selected merchants exist."
      : selections.length === 0
        ? "Decision is missing selectedMerchants."
        : "Decision references an unknown merchant.",
  };
}

export function discountCapValidator(decision: NegotiationDecision, merchants: Merchant[]): ValidationCheck {
  const selections = selectedMerchantsOf(decision);
  const passed = selections.every((selection) => {
    const merchant = merchants.find((candidate) => candidate.id === selection.merchantId);
    const percent = selection.incentive?.percent ?? 0;
    return percent <= (merchant?.rule?.maxDiscountPercent ?? 0) && percent <= offerPolicy.maxDiscountPercent;
  });
  return {
    validator: "discount_cap",
    passed,
    detail: passed ? "All incentives are within merchant and platform caps." : "An incentive exceeds a configured cap.",
  };
}

export function merchantBudgetValidator(decision: NegotiationDecision, merchants: Merchant[]): ValidationCheck {
  const selections = selectedMerchantsOf(decision);
  const passed = selections.every((selection) => {
    const merchant = merchants.find((candidate) => candidate.id === selection.merchantId);
    const product = merchant?.products.find((candidate) => candidate.name === selection.product);
    const cashback = (product?.priceEuro ?? 0) * ((selection.incentive?.percent ?? 0) / 100);
    return cashback <= (merchant?.rule?.dailyBudgetRemainingEuro ?? 0);
  });
  return {
    validator: "merchant_budget",
    passed,
    detail: passed ? "Estimated cashback fits remaining budgets." : "Estimated cashback exceeds a remaining budget.",
  };
}

export function bundleSizeValidator(decision: NegotiationDecision): ValidationCheck {
  const selections = selectedMerchantsOf(decision);
  const passed = decision.decision !== "bundle_offer" || selections.length <= bundlePolicy.maxMerchantsPerBundle;
  return {
    validator: "bundle_size",
    passed,
    detail: `Bundle contains ${selections.length} merchants; max is ${bundlePolicy.maxMerchantsPerBundle}.`,
  };
}

export function walkingDistanceValidator(
  decision: NegotiationDecision,
  merchants: Merchant[],
  context: ConsumerContextSnapshot,
): ValidationCheck {
  const selections = selectedMerchantsOf(decision);
  const totalDistance = selections.reduce((sum, selection) => {
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
  const selections = selectedMerchantsOf(decision);
  const failed = selections.find((selection) => {
    const merchant = merchants.find((candidate) => candidate.id === selection.merchantId);
    const status = merchant?.participationStatus ?? "partner";
    return status !== "partner";
  });
  return {
    validator: "participation_status",
    passed: !failed,
    detail: failed
      ? `Selected merchant has ineligible participation status ${failed.merchantId}.`
      : "Selected merchants are partners.",
  };
}

export function coordinateRequiredValidator(decision: NegotiationDecision, merchants: Merchant[]): ValidationCheck {
  const selections = selectedMerchantsOf(decision);
  const passed = selections.length > 0 && selections.every((selection) => {
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
  const selections = selectedMerchantsOf(decision);
  const passed = decision.decision !== "bundle_offer" || selections.every((selection) => {
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
  const selections = selectedMerchantsOf(decision);
  const passed = selections.length > 0 && selections.every((selection) => {
    const merchant = merchants.find((candidate) => candidate.id === selection.merchantId);
    const offerType = selection.incentive?.type;
    return Boolean(
      offerType &&
      merchant?.rule?.offerTypesAllowed.includes(offerType) &&
      offerPolicy.allowedOfferTypes.includes(offerType),
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
  // If the decision payload is missing or fails the shared contract, short-circuit
  // with just the schema check. The downstream validators assume a well-shaped
  // decision and would otherwise throw on undefined fields.
  const schemaCheck = schemaValidator(input.decision);
  if (!schemaCheck.passed) {
    return {
      valid: false,
      errors: [`${schemaCheck.validator}: ${schemaCheck.detail}`],
      warnings: ["Schema validation failed; merchant-specific validators skipped."],
      checks: [schemaCheck],
    };
  }

  if (input.decision.decision === "no_offer") {
    return {
      valid: true,
      errors: [],
      warnings: ["No offer decision; validators skipped offer-specific checks."],
      checks: [schemaCheck],
    };
  }

  const checks = [
    schemaCheck,
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

export type MultiOfferValidationEntry = {
  merchant: SelectedMerchant;
  result: ValidationResult;
  valid: boolean;
};

/**
 * Validates a multi_offer decision per merchant: each selectedMerchant is
 * treated as its own independent single_offer for validation purposes. We
 * keep the valid ones, drop the invalid ones, and return everything so the
 * orchestrator can persist N independent Offer rows + emit clear analytics.
 *
 * For single_offer / bundle_offer decisions this just returns the regular
 * validation result wrapped in a one-element array so callers can use the
 * same code path.
 */
export function validateMultiOfferDecision(input: {
  decision: NegotiationDecision;
  merchants: Merchant[];
  context: ConsumerContextSnapshot;
}): {
  overall: ValidationResult;
  entries: MultiOfferValidationEntry[];
  validSelections: SelectedMerchant[];
} {
  const schemaCheck = schemaValidator(input.decision);
  if (!schemaCheck.passed) {
    const overall: ValidationResult = {
      valid: false,
      errors: [`${schemaCheck.validator}: ${schemaCheck.detail}`],
      warnings: ["Schema validation failed; per-offer validators skipped."],
      checks: [schemaCheck],
    };
    return { overall, entries: [], validSelections: [] };
  }

  if (input.decision.decision !== "multi_offer") {
    const overall = validateNegotiationDecision(input);
    const entries: MultiOfferValidationEntry[] = input.decision.selectedMerchants.map((merchant) => ({
      merchant,
      result: overall,
      valid: overall.valid,
    }));
    return {
      overall,
      entries,
      validSelections: overall.valid ? input.decision.selectedMerchants : [],
    };
  }

  const entries: MultiOfferValidationEntry[] = input.decision.selectedMerchants.map((merchant) => {
    const perOfferDecision: NegotiationDecision = {
      ...input.decision,
      decision: "single_offer",
      selectedMerchants: [merchant],
    };
    const result = validateNegotiationDecision({
      decision: perOfferDecision,
      merchants: input.merchants,
      context: input.context,
    });
    return { merchant, result, valid: result.valid };
  });

  const valid = entries.filter((entry) => entry.valid);
  const errors = entries
    .filter((entry) => !entry.valid)
    .map((entry) => `merchant ${entry.merchant.merchantId}: ${entry.result.errors.join("; ")}`);
  const overall: ValidationResult = {
    valid: valid.length > 0,
    errors,
    warnings: valid.length === entries.length
      ? ["All multi_offer entries validated."]
      : [`Validated ${valid.length}/${entries.length} multi_offer entries; rest dropped.`],
    checks: [schemaCheck],
  };
  return {
    overall,
    entries,
    validSelections: valid.map((entry) => entry.merchant),
  };
}
