import type { BundlePolicy, OfferPolicy, PlatformGoalModel } from "../types";

export const bundlePolicy: BundlePolicy = {
  maxMerchantsPerBundle: 2,
  maxWalkingMeters: 300,
  requireSameZone: true,
  requireMerchantConsent: true,
  requireAtLeastOneQuietMerchant: true,
  maxValidityMinutes: 45,
  validPrinciples: [
    "plausible real-world journey",
    "low walking friction",
    "complementary categories",
    "context relevance",
    "not a random coupon pack",
  ],
  strongPairings: [
    ["cafe", "bookshop"],
    ["cafe", "bakery"],
    ["restaurant", "cinema"],
    ["restaurant", "florist"],
    ["museum", "gift_shop"],
  ],
  weakPairings: [
    ["pharmacy", "bar"],
    ["electronics_store", "bakery"],
    ["hardware_store", "florist"],
  ],
};

export const offerPolicy: OfferPolicy = {
  maxDiscountPercent: 20,
  preferSmallestSufficientIncentive: true,
  allowedOfferTypes: ["cashback", "discount", "bundle_unlock", "priority_pickup"],
};

export const platformGoalModel: PlatformGoalModel = {
  goals: [
    "trusted local commerce",
    "protect consumer attention",
    "protect privacy",
    "increase sustainable merchant footfall",
    "avoid coupon spam",
    "avoid over-discounting",
    "support local merchant cooperation",
  ],
};