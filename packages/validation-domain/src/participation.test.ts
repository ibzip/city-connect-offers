import assert from "node:assert/strict";
import test from "node:test";
import type { Merchant, NegotiationDecision } from "@city-wallet/contracts";
import { coordinateRequiredValidator, participationStatusValidator } from "./index";

const decision: NegotiationDecision = {
  decision: "single_offer",
  selectedMerchants: [{
    merchantId: "disc",
    product: "Local item",
    incentive: { type: "cashback", percent: 5, valueText: "5% cashback" },
  }],
  validityMinutes: 30,
  consumerIncentivesOffered: [],
  merchantIncentivesOffered: [],
  utilityAssessment: {
    consumer: { score: 70, whyPositive: [], risks: [] },
    merchants: [{ merchantId: "disc", score: 70, whyPositive: [], risks: [] }],
    platform: { score: 70, whyPositive: [], risks: [] },
  },
  longTermGoalFit: { consumer: [], merchants: [], platform: [] },
  reasoning: [],
  rejectedCandidates: [],
  consumerHeadline: "Test",
  consumerSubheadline: "Test",
  cta: "Claim",
  confidence: 0.8,
};

function merchant(status: Merchant["participationStatus"], withCoordinates = true): Merchant {
  return {
    id: "disc",
    name: "Discovered Shop",
    category: "cafe",
    zoneId: "zone",
    distanceMeters: 50,
    latitude: withCoordinates ? 48.775 : undefined,
    longitude: withCoordinates ? 9.177 : undefined,
    participationStatus: status,
    source: "tavily",
    syntheticFields: [],
    products: [{ id: "prod", merchantId: "disc", name: "Local item", priceEuro: 4, category: "local" }],
    goals: [],
    rule: {
      merchantId: "disc",
      maxDiscountPercent: 10,
      dailyBudgetEuro: 20,
      dailyBudgetRemainingEuro: 20,
      eligibleProducts: ["Local item"],
      allowsBundles: true,
      preferredBundleCategories: ["cafe"],
      offerTypesAllowed: ["cashback"],
      brandTone: "demo",
    },
  };
}

test("participationStatusValidator rejects discovered-only merchants", () => {
  assert.equal(participationStatusValidator(decision, [merchant("discovered_only")]).passed, false);
});

test("participationStatusValidator allows demo partners only in demo mode", () => {
  process.env.DEMO_MODE = "false";
  process.env.ALLOW_DEMO_PARTNER_OFFERS = "false";
  assert.equal(participationStatusValidator(decision, [merchant("demo_partner")]).passed, false);
  process.env.DEMO_MODE = "true";
  process.env.ALLOW_DEMO_PARTNER_OFFERS = "true";
  assert.equal(participationStatusValidator(decision, [merchant("demo_partner")]).passed, true);
});

test("coordinateRequiredValidator excludes coordinate-less merchants", () => {
  assert.equal(coordinateRequiredValidator(decision, [merchant("partner", false)]).passed, false);
  assert.equal(coordinateRequiredValidator(decision, [merchant("partner", true)]).passed, true);
});
