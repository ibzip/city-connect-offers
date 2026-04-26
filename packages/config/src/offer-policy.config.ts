export const offerPolicy = {
  maxDiscountPercent: 20,
  preferSmallestSufficientIncentive: true,
  allowedOfferTypes: ["cashback", "discount", "priority_pickup", "bundle_unlock"],
} as const;
