import type { MerchantConfig, PaymentDensity } from "../types";

export const merchants: MerchantConfig[] = [
  {
    id: "cafe_muller",
    name: "Café Müller",
    category: "cafe",
    zoneId: "stuttgart_old_town",
    distanceMeters: 80,
    products: [
      { id: "p_capp", name: "Cappuccino", basePriceEUR: 3.6 },
      { id: "p_croissant", name: "Butter Croissant", basePriceEUR: 2.4 },
    ],
    goals: {
      primary: "Refill empty afternoon seats with low-friction visits",
      secondary: "Build repeat local customers",
    },
    rules: {
      maxDiscountPercent: 20,
      dailyBudgetEUR: 40,
      eligibleProductIds: ["p_capp", "p_croissant"],
    },
    brandTone: "Warm, neighborly, understated",
    bundlePermissions: {
      allowsBundles: true,
      preferredPartnerCategories: ["bookshop", "bakery", "florist"],
    },
    allowedOfferTypes: ["cashback", "discount", "bundle_unlock"],
  },
  {
    id: "buchhandlung_anna",
    name: "Buchhandlung Anna",
    category: "bookshop",
    zoneId: "stuttgart_old_town",
    distanceMeters: 120,
    products: [
      { id: "p_paperback", name: "Paperback (any)", basePriceEUR: 12 },
      { id: "p_card", name: "Greeting Card", basePriceEUR: 3.5 },
    ],
    goals: {
      primary: "Convert curious foot traffic into a single-book purchase",
    },
    rules: {
      maxDiscountPercent: 15,
      dailyBudgetEUR: 30,
      eligibleProductIds: ["p_paperback"],
    },
    brandTone: "Curated, calm, literary",
    bundlePermissions: {
      allowsBundles: true,
      preferredPartnerCategories: ["cafe", "florist"],
    },
    allowedOfferTypes: ["cashback", "bundle_unlock"],
  },
  {
    id: "blumen_klein",
    name: "Blumen Klein",
    category: "florist",
    zoneId: "stuttgart_old_town",
    distanceMeters: 180,
    products: [
      { id: "p_bouquet", name: "Seasonal Bouquet", basePriceEUR: 14 },
    ],
    goals: {
      primary: "Maintain steady footfall, avoid waste of cut flowers",
    },
    rules: {
      maxDiscountPercent: 10,
      dailyBudgetEUR: 20,
      eligibleProductIds: ["p_bouquet"],
    },
    brandTone: "Cheerful, fresh, gift-oriented",
    bundlePermissions: {
      allowsBundles: true,
      preferredPartnerCategories: ["cafe", "restaurant", "bookshop"],
    },
    allowedOfferTypes: ["cashback", "discount"],
  },
];

export const merchantPaymentDensity: PaymentDensity[] = [
  {
    merchantId: "cafe_muller",
    baselineTransactions: 19,
    currentTransactions: 8,
    baselineRevenueEUR: 78.5,
    currentRevenueEUR: 32.4,
  },
  {
    merchantId: "buchhandlung_anna",
    baselineTransactions: 10,
    currentTransactions: 7,
    baselineRevenueEUR: 95,
    currentRevenueEUR: 62,
  },
  {
    merchantId: "blumen_klein",
    baselineTransactions: 9,
    currentTransactions: 9,
    baselineRevenueEUR: 110,
    currentRevenueEUR: 108,
  },
];

export function getMerchant(id: string): MerchantConfig | undefined {
  return merchants.find((m) => m.id === id);
}