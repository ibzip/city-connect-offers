export const bundlePolicy = {
  maxMerchantsPerBundle: 2,
  maxWalkingMeters: 300,
  maxValidityMinutes: 45,
  requireSameZone: true,
  requireMerchantConsent: true,
  requireAtLeastOneQuietMerchant: true,
  validBundlePrinciples: [
    "plausible real-world journey",
    "low walking friction",
    "complementary merchant categories",
    "context relevance",
    "not a random coupon pack",
  ],
  exampleStrongPairings: [
    ["cafe", "bookshop"],
    ["cafe", "bakery"],
    ["restaurant", "cinema"],
    ["restaurant", "flower_shop"],
    ["museum", "gift_shop"],
  ],
  exampleWeakPairings: [
    ["pharmacy", "bar"],
    ["electronics_store", "bakery"],
    ["hardware_store", "flower_shop"],
  ],
} as const;
