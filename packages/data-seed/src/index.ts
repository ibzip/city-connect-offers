import type {
  CommerceZone,
  ConsumerContextSnapshot,
  Merchant,
  MerchantGoal,
  MerchantProduct,
  MerchantRule,
  PaymentDensitySignal,
  UserProfile,
} from "@city-wallet/contracts";

export const seededCommerceZones: CommerceZone[] = [
  {
    id: "stuttgart_old_town",
    name: "Stuttgart Old Town",
    city: "Stuttgart",
    country: "DE",
    zoneType: "demo_zone",
    centerLat: 48.775845,
    centerLng: 9.177544,
    radiusMeters: 500,
    polygonGeoJson: null,
    isActive: true,
    triggerPolicyIds: ["trg_wallet_opened", "trg_user_entered_zone", "trg_declared_context_changed"],
  },
];

export const seededUserProfile: UserProfile = {
  userId: "user_mia",
  displayName: "Mia",
  privacyMode: "high",
  rewardPreference: "cashback",
  // 600m is a comfortable few-minute walk and matches the radius of imported
  // city merchants out-of-the-box. Users can tighten or loosen this from the
  // wallet's Preferences sheet at any time.
  walkingToleranceMeters: 600,
  maxBundleStops: 2,
  maxOffersPerHour: 1,
};

export const seededConsumerContext: ConsumerContextSnapshot = {
  snapshotId: "ctx_user_mia_current",
  userId: "user_mia",
  zoneId: "stuttgart_old_town",
  zoneName: "Stuttgart Old Town",
  matchedZones: seededCommerceZones,
  userLocation: {
    latitude: 48.775845,
    longitude: 9.177544,
    source: "demo_geofence",
  },
  locationMode: "demo_geofence_fallback",
  geofenceMatched: true,
  weatherMood: "cold",
  weatherDescription: "11°C and overcast",
  weatherSource: "mock_weather_fallback",
  weatherTemperatureC: 11,
  timeContext: "lunch_break",
  declaredIntent: "warm_city_break",
  availableMinutes: 30,
  rewardPreference: "cashback",
  privacyMode: "high",
  walkingToleranceMeters: 600,
  maxBundleStops: 2,
  maxOffersPerHour: 1,
  normalizedSignals: [],
  providerFallbacks: [],
  createdAt: "2026-04-25T10:30:00.000Z",
};

export const seededMerchantProducts: MerchantProduct[] = [
  {
    id: "prod_cafe_cappuccino",
    merchantId: "cafe_mueller",
    name: "Cappuccino",
    priceEuro: 3.6,
    category: "warm_drink",
    margin: "high",
  },
  {
    id: "prod_cafe_latte",
    merchantId: "cafe_mueller",
    name: "Latte",
    priceEuro: 4.1,
    category: "warm_drink",
  },
  {
    id: "prod_cafe_soup",
    merchantId: "cafe_mueller",
    name: "Soup",
    priceEuro: 5.9,
    category: "light_lunch",
  },
  {
    id: "prod_books_paperback",
    merchantId: "buchhandlung_anna",
    name: "Paperback",
    priceEuro: 12,
    category: "book",
  },
  {
    id: "prod_books_notebook",
    merchantId: "buchhandlung_anna",
    name: "Notebook",
    priceEuro: 6,
    category: "stationery",
  },
  {
    id: "prod_flowers_small_bouquet",
    merchantId: "blumen_klein",
    name: "Small bouquet",
    priceEuro: 18,
    category: "flowers",
  },
];

export const seededMerchantGoals: MerchantGoal[] = [
  { id: "goal_cafe_quiet_hour", merchantId: "cafe_mueller", goal: "sustainable_quiet_hour_lift" },
  { id: "goal_cafe_margin", merchantId: "cafe_mueller", goal: "margin_protection" },
  { id: "goal_cafe_repeat", merchantId: "cafe_mueller", goal: "repeat_customer_discovery" },
  { id: "goal_books_browsing", merchantId: "buchhandlung_anna", goal: "increase_browsing_visits" },
  { id: "goal_books_discovery", merchantId: "buchhandlung_anna", goal: "local_discovery" },
  { id: "goal_books_margin", merchantId: "buchhandlung_anna", goal: "margin_protection" },
  { id: "goal_flowers_gift", merchantId: "blumen_klein", goal: "gift_moment_discovery" },
  { id: "goal_flowers_margin", merchantId: "blumen_klein", goal: "protect_margin" },
];

export const seededMerchantRules: MerchantRule[] = [
  {
    merchantId: "cafe_mueller",
    maxDiscountPercent: 20,
    dailyBudgetEuro: 50,
    dailyBudgetRemainingEuro: 42,
    eligibleProducts: ["Cappuccino", "Latte", "Soup"],
    allowsBundles: true,
    preferredBundleCategories: ["bookshop", "bakery", "museum"],
    offerTypesAllowed: ["cashback", "priority_pickup", "bundle_unlock"],
    brandTone: "warm_local",
  },
  {
    merchantId: "buchhandlung_anna",
    maxDiscountPercent: 10,
    dailyBudgetEuro: 40,
    dailyBudgetRemainingEuro: 30,
    eligibleProducts: ["Paperback", "Notebook"],
    allowsBundles: true,
    preferredBundleCategories: ["cafe", "stationery", "museum"],
    offerTypesAllowed: ["cashback", "bundle_unlock"],
    brandTone: "thoughtful_local",
  },
  {
    merchantId: "blumen_klein",
    maxDiscountPercent: 8,
    dailyBudgetEuro: 25,
    dailyBudgetRemainingEuro: 25,
    eligibleProducts: ["Small bouquet"],
    allowsBundles: true,
    preferredBundleCategories: ["restaurant", "cafe"],
    offerTypesAllowed: ["cashback", "bundle_unlock"],
    brandTone: "warm_gift",
  },
];

export const seededMerchants: Merchant[] = [
  {
    id: "cafe_mueller",
    name: "Café Müller",
    category: "cafe",
    zoneId: "stuttgart_old_town",
    distanceMeters: 80,
    address: "Marktstraße 8, 70173 Stuttgart, Germany",
    latitude: 48.7761,
    longitude: 9.17658,
    participationStatus: "partner",
    source: "seeded",
    syntheticFields: [],
    products: seededMerchantProducts.filter((product) => product.merchantId === "cafe_mueller"),
    goals: seededMerchantGoals.filter((goal) => goal.merchantId === "cafe_mueller"),
    rule: seededMerchantRules.find((rule) => rule.merchantId === "cafe_mueller"),
  },
  {
    id: "buchhandlung_anna",
    name: "Buchhandlung Anna",
    category: "bookshop",
    zoneId: "stuttgart_old_town",
    distanceMeters: 120,
    address: "Kirchstraße 12, 70173 Stuttgart, Germany",
    latitude: 48.77534,
    longitude: 9.1785,
    participationStatus: "partner",
    source: "seeded",
    syntheticFields: [],
    products: seededMerchantProducts.filter((product) => product.merchantId === "buchhandlung_anna"),
    goals: seededMerchantGoals.filter((goal) => goal.merchantId === "buchhandlung_anna"),
    rule: seededMerchantRules.find((rule) => rule.merchantId === "buchhandlung_anna"),
  },
  {
    id: "blumen_klein",
    name: "Blumen Klein",
    category: "flower_shop",
    zoneId: "stuttgart_old_town",
    distanceMeters: 180,
    address: "Nadlerstraße 5, 70173 Stuttgart, Germany",
    latitude: 48.77475,
    longitude: 9.17686,
    participationStatus: "partner",
    source: "seeded",
    syntheticFields: [],
    products: seededMerchantProducts.filter((product) => product.merchantId === "blumen_klein"),
    goals: seededMerchantGoals.filter((goal) => goal.merchantId === "blumen_klein"),
    rule: seededMerchantRules.find((rule) => rule.merchantId === "blumen_klein"),
  },
];

export const seededPaymentDensitySignals: PaymentDensitySignal[] = [
  {
    merchantId: "cafe_mueller",
    baselineTransactions: 19,
    currentTransactions: 8,
    baselineRevenue: 78.5,
    currentRevenue: 32.4,
  },
  {
    merchantId: "buchhandlung_anna",
    baselineTransactions: 10,
    currentTransactions: 7,
    baselineRevenue: 120,
    currentRevenue: 84,
  },
  {
    merchantId: "blumen_klein",
    baselineTransactions: 9,
    currentTransactions: 9,
    baselineRevenue: 180,
    currentRevenue: 180,
  },
];

export const seedScenario = {
  id: "warm_city_break",
  defaultUserId: seededUserProfile.userId,
  defaultEventType: "UserDeclaredContextChanged",
  deterministicTokenCodes: {
    cafe_mueller: "CW-CAFE-91K",
    buchhandlung_anna: "CW-BOOK-72Q",
  },
} as const;
