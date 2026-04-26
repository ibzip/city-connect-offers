import assert from "node:assert/strict";
import test from "node:test";
import type { ConsumerContextSnapshot, Merchant, MerchantInsightSnapshot } from "@city-wallet/contracts";
import { selectCandidateMerchants } from "./index";

const context: ConsumerContextSnapshot = {
  snapshotId: "ctx",
  userId: "user",
  zoneId: "zone",
  matchedZones: [],
  userLocation: { latitude: 48.775, longitude: 9.177, source: "browser" },
  locationMode: "real_browser_location",
  geofenceMatched: true,
  weatherMood: "cold",
  weatherDescription: "8°C and overcast",
  weatherSource: "mock_weather_fallback",
  timeContext: "lunch_break",
  declaredIntent: "warm_city_break",
  availableMinutes: 30,
  rewardPreference: "cashback",
  privacyMode: "high",
  walkingToleranceMeters: 250,
  maxBundleStops: 2,
  maxOffersPerHour: 1,
  normalizedSignals: [],
  providerFallbacks: [],
  createdAt: new Date().toISOString(),
};

function merchant(id: string, withCoordinates = true): Merchant {
  return {
    id,
    name: id,
    category: "cafe",
    zoneId: "zone",
    distanceMeters: 50,
    latitude: withCoordinates ? 48.7752 : undefined,
    longitude: withCoordinates ? 9.1772 : undefined,
    participationStatus: "partner",
    source: "seeded",
    syntheticFields: [],
    products: [{ id: "prod", merchantId: id, name: "Cappuccino", priceEuro: 4, category: "warm_drink" }],
    goals: [],
    rule: {
      merchantId: id,
      maxDiscountPercent: 15,
      dailyBudgetEuro: 20,
      dailyBudgetRemainingEuro: 20,
      eligibleProducts: ["Cappuccino"],
      allowsBundles: true,
      preferredBundleCategories: ["bookshop"],
      offerTypesAllowed: ["cashback"],
      brandTone: "local",
    },
  };
}

function insight(merchantId: string): MerchantInsightSnapshot {
  return {
    insightId: `insight_${merchantId}`,
    merchantId,
    businessState: "quiet",
    transactionDropPercent: 30,
    revenueDropPercent: 30,
    urgencyScore: 70,
    bundleReadinessScore: 70,
    journeyFitTags: ["warm_break"],
    insightSummary: "quiet",
    refreshedAt: new Date().toISOString(),
  };
}

test("candidate selection considers partners with coordinates and an insight", () => {
  const merchants = [merchant("with_coords"), merchant("no_coords", false)];
  const candidates = selectCandidateMerchants(merchants, merchants.map((item) => insight(item.id)), context);
  assert.equal(candidates.find((candidate) => candidate.merchantId === "with_coords")?.considered, true);
  assert.equal(candidates.find((candidate) => candidate.merchantId === "no_coords")?.considered, false);
});
