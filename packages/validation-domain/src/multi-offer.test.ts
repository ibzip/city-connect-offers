import assert from "node:assert/strict";
import test from "node:test";
import type { ConsumerContextSnapshot, Merchant, NegotiationDecision } from "@city-wallet/contracts";
import { validateMultiOfferDecision } from "./index";

function merchant(id: string, opts: Partial<Merchant> = {}): Merchant {
  return {
    id,
    name: id,
    category: "cafe",
    zoneId: "zone",
    distanceMeters: 50,
    latitude: 48.775,
    longitude: 9.177,
    participationStatus: "partner",
    source: "tavily",
    syntheticFields: [],
    products: [{ id: `${id}_prod`, merchantId: id, name: "Local item", priceEuro: 4, category: "local" }],
    goals: [],
    rule: {
      merchantId: id,
      maxDiscountPercent: 20,
      dailyBudgetEuro: 50,
      dailyBudgetRemainingEuro: 50,
      eligibleProducts: ["Local item"],
      allowsBundles: true,
      preferredBundleCategories: ["cafe"],
      offerTypesAllowed: ["cashback", "discount"],
      brandTone: "friendly",
    },
    ...opts,
  };
}

const baseContext: ConsumerContextSnapshot = {
  snapshotId: "ctx_test",
  userId: "user_mia",
  zoneId: "zone",
  zoneName: "Zone",
  matchedZones: [],
  userLocation: { latitude: 48.775, longitude: 9.177, source: "browser" },
  locationMode: "real_browser_location",
  geofenceMatched: true,
  weatherMood: "warm",
  weatherDescription: "20C and sunny",
  weatherSource: "live_weather",
  weatherTemperatureC: 20,
  timeContext: "lunch_break",
  declaredIntent: "lunch_break_with_visitor",
  availableMinutes: 60,
  rewardPreference: "either",
  privacyMode: "high",
  walkingToleranceMeters: 1000,
  maxBundleStops: 2,
  maxOffersPerHour: 2,
  normalizedSignals: [],
  providerFallbacks: [],
  createdAt: new Date().toISOString(),
};

function buildMultiOfferDecision(): NegotiationDecision {
  return {
    decision: "multi_offer",
    selectedMerchants: [
      {
        merchantId: "lunch_spot",
        product: "Local item",
        incentive: { type: "cashback", percent: 5, valueText: "5% cashback" },
        intentLabel: "lunch_break",
      },
      {
        merchantId: "gift_spot",
        product: "Local item",
        incentive: { type: "discount", percent: 10, valueText: "10% off" },
        intentLabel: "gift_for_visitor",
      },
    ],
    validityMinutes: 30,
    consumerIncentivesOffered: [],
    merchantIncentivesOffered: [],
    utilityAssessment: {
      consumer: { score: 70, whyPositive: [], risks: [] },
      merchants: [
        { merchantId: "lunch_spot", score: 70, whyPositive: [], risks: [] },
        { merchantId: "gift_spot", score: 70, whyPositive: [], risks: [] },
      ],
      platform: { score: 70, whyPositive: [], risks: [] },
    },
    longTermGoalFit: { consumer: [], merchants: [], platform: [] },
    reasoning: [],
    rejectedCandidates: [],
    consumerHeadline: "Two offers",
    consumerSubheadline: "Lunch + gift",
    cta: "Claim both",
    confidence: 0.8,
  };
}

test("validateMultiOfferDecision keeps both selections when each is valid on its own", () => {
  const decision = buildMultiOfferDecision();
  const result = validateMultiOfferDecision({
    decision,
    merchants: [merchant("lunch_spot"), merchant("gift_spot")],
    context: baseContext,
  });

  assert.equal(result.overall.valid, true);
  assert.equal(result.entries.length, 2);
  assert.equal(result.validSelections.length, 2);
  assert.deepEqual(
    result.validSelections.map((m) => m.merchantId).sort(),
    ["gift_spot", "lunch_spot"],
  );
});

test("validateMultiOfferDecision drops invalid offers but keeps the valid ones", () => {
  const decision = buildMultiOfferDecision();
  // gift_spot is missing coordinates -> coordinate_required validator should
  // fail for it specifically while lunch_spot stays valid.
  const merchants = [
    merchant("lunch_spot"),
    merchant("gift_spot", { latitude: undefined, longitude: undefined }),
  ];
  const result = validateMultiOfferDecision({
    decision,
    merchants,
    context: baseContext,
  });

  assert.equal(result.overall.valid, true, "overall must remain valid because at least one offer survived");
  assert.equal(result.entries.length, 2);
  assert.equal(result.validSelections.length, 1);
  assert.equal(result.validSelections[0]!.merchantId, "lunch_spot");
  assert.ok(
    result.overall.errors.some((err) => err.includes("gift_spot")),
    `expected error referencing gift_spot, got: ${JSON.stringify(result.overall.errors)}`,
  );
});

test("validateMultiOfferDecision wraps single_offer decisions in a one-entry result", () => {
  const decision: NegotiationDecision = {
    ...buildMultiOfferDecision(),
    decision: "single_offer",
    selectedMerchants: [
      {
        merchantId: "lunch_spot",
        product: "Local item",
        incentive: { type: "cashback", percent: 5, valueText: "5% cashback" },
      },
    ],
  };
  const result = validateMultiOfferDecision({
    decision,
    merchants: [merchant("lunch_spot")],
    context: baseContext,
  });

  assert.equal(result.overall.valid, true);
  assert.equal(result.entries.length, 1);
  assert.equal(result.validSelections.length, 1);
});

test("validateMultiOfferDecision flags overall invalid when every per-merchant offer fails", () => {
  const decision = buildMultiOfferDecision();
  const merchants = [
    merchant("lunch_spot", { latitude: undefined, longitude: undefined }),
    merchant("gift_spot", { latitude: undefined, longitude: undefined }),
  ];
  const result = validateMultiOfferDecision({
    decision,
    merchants,
    context: baseContext,
  });
  assert.equal(result.overall.valid, false);
  assert.equal(result.validSelections.length, 0);
});
