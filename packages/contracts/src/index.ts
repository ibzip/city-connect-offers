import { z } from "zod";

export const SignalSourceTypeSchema = z.enum(["real", "simulated", "hybrid"]);
export type SignalSourceType = z.infer<typeof SignalSourceTypeSchema>;

export const NormalizedSignalSchema = <TPayload extends z.ZodTypeAny>(payloadSchema: TPayload) =>
  z.object({
    signalId: z.string(),
    source: z.string(),
    sourceType: SignalSourceTypeSchema,
    observedAt: z.string(),
    confidence: z.number().min(0).max(1),
    payload: payloadSchema,
  });

export type NormalizedSignal<TPayload> = {
  signalId: string;
  source: string;
  sourceType: SignalSourceType;
  observedAt: string;
  confidence: number;
  payload: TPayload;
};

export const UserEventTypeSchema = z.enum([
  "WalletOpened",
  "UserEnteredDemoZone",
  "UserEnteredZone",
  "UserDeclaredContextChanged",
  "TimeContextChanged",
  "WeatherContextChanged",
]);
export type UserEventType = z.infer<typeof UserEventTypeSchema>;

export const GeoPointSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
});
export type GeoPoint = z.infer<typeof GeoPointSchema>;

export const GeoBoxSchema = z.object({
  north: z.number(),
  south: z.number(),
  east: z.number(),
  west: z.number(),
});
export type GeoBox = z.infer<typeof GeoBoxSchema>;

export const CommerceZoneSchema = z.object({
  id: z.string(),
  name: z.string(),
  city: z.string(),
  country: z.string(),
  zoneType: z.enum(["demo_zone", "city_zone"]).default("demo_zone"),
  centerLat: z.number(),
  centerLng: z.number(),
  radiusMeters: z.number().int().positive(),
  polygonGeoJson: z.record(z.unknown()).nullable().optional(),
  importSettings: z.record(z.unknown()).optional(),
  isActive: z.boolean(),
  triggerPolicyIds: z.array(z.string()).default([]),
});
export type CommerceZone = z.infer<typeof CommerceZoneSchema>;

export const SupportedMerchantCategorySchema = z.enum([
  "cafe",
  "bakery",
  "restaurant",
  "bookshop",
  "flower_shop",
  "museum",
  "gallery",
  "gift_shop",
  "local_retail",
  "stationery",
  "clothing",
  "grocery",
]);
export type SupportedMerchantCategory = z.infer<typeof SupportedMerchantCategorySchema>;

export const ImportPreviewSchema = z.object({
  provider: z.enum(["google_places", "overpass"]).default("overpass"),
  radiusMeters: z.number().int().positive(),
  estimatedTiles: z.number().int().positive(),
  estimatedRequestCount: z.number().int().nonnegative().default(0),
  selectedCategories: z.array(SupportedMerchantCategorySchema),
  categoryCaps: z.record(z.number().int().positive()),
  maxImportedMerchants: z.number().int().positive(),
  maxTilesPerRun: z.number().int().positive(),
  maxProviderRequests: z.number().int().positive().optional(),
  fieldMask: z.string().optional(),
  placeDetailsDisabled: z.boolean().default(true),
  providerWarnings: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
  existingStoredMerchantCount: z.number().int().nonnegative().default(0),
  cacheReuseAvailable: z.boolean().default(false),
  plannedImportAction: z.enum([
    "new_import",
    "resume_paused_import",
    "reuse_stored_merchants",
    "incremental_import",
    "settings_decreased_no_delete",
  ]).default("new_import"),
  settingsChangeSummary: z.array(z.string()).default([]),
  liveWalletDiscoveryFallbackEnabled: z.boolean().default(false),
});
export type ImportPreview = z.infer<typeof ImportPreviewSchema>;

export const CitySuggestionSchema = z.object({
  label: z.string(),
  city: z.string(),
  country: z.string(),
  centerLat: z.number(),
  centerLng: z.number(),
  boundingBox: GeoBoxSchema.optional(),
  provider: z.literal("nominatim"),
  confidence: z.number().min(0).max(1),
});
export type CitySuggestion = z.infer<typeof CitySuggestionSchema>;

export const ActivateCommerceZoneRequestSchema = z.object({
  mode: z.enum(["city", "center_radius", "coordinate_box", "polygon"]),
  zoneId: z.string().optional(),
  name: z.string().optional(),
  city: z.string().optional(),
  country: z.string().default("DE"),
  centerLat: z.number().optional(),
  centerLng: z.number().optional(),
  coordinateBox: GeoBoxSchema.optional(),
  polygonGeoJson: z.record(z.unknown()).optional(),
  radiusMeters: z.number().int().positive().optional(),
  maxImportedMerchants: z.number().int().positive().optional(),
  maxTilesPerRun: z.number().int().positive().optional(),
  categories: z.array(SupportedMerchantCategorySchema).optional(),
  categoryCaps: z.record(z.number().int().positive()).optional(),
  forceRefresh: z.boolean().default(false),
  previewOnly: z.boolean().default(false),
});
export type ActivateCommerceZoneRequest = z.infer<typeof ActivateCommerceZoneRequestSchema>;

export const MerchantImportRunStatusSchema = z.enum(["pending", "running", "paused", "completed", "partial_failed", "failed"]);
export type MerchantImportRunStatus = z.infer<typeof MerchantImportRunStatusSchema>;

export const MerchantImportRunSchema = z.object({
  id: z.string(),
  zoneId: z.string(),
  status: MerchantImportRunStatusSchema,
  requestedRadiusMeters: z.number().int().positive(),
  radiusMeters: z.number().int().positive(),
  categories: z.array(SupportedMerchantCategorySchema),
  categoryCaps: z.record(z.number().int().positive()),
  maxImportedMerchants: z.number().int().positive(),
  maxTilesPerRun: z.number().int().positive(),
  importedCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  continuationCursor: z.string().nullable().optional(),
  warnings: z.array(z.string()).default([]),
  errorJson: z.record(z.unknown()).nullable().optional(),
  providerStatsJson: z.record(z.unknown()).default({}),
  startedAt: z.string(),
  completedAt: z.string().nullable().optional(),
  updatedAt: z.string(),
});
export type MerchantImportRun = z.infer<typeof MerchantImportRunSchema>;

export const ActivateCommerceZoneResultSchema = z.object({
  zone: CommerceZoneSchema,
  preview: ImportPreviewSchema,
  importRun: MerchantImportRunSchema.nullable().optional(),
  importedMerchants: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
});
export type ActivateCommerceZoneResult = z.infer<typeof ActivateCommerceZoneResultSchema>;

export const MerchantImportContinueRequestSchema = z.object({
  runId: z.string(),
});
export type MerchantImportContinueRequest = z.infer<typeof MerchantImportContinueRequestSchema>;

export const ProviderFallbackSchema = z.object({
  provider: z.string(),
  reason: z.string(),
  fallbackUsed: z.boolean(),
  occurredAt: z.string(),
});
export type ProviderFallback = z.infer<typeof ProviderFallbackSchema>;

export const ProviderBudgetSchema = z.object({
  openMeteoRequestsRemaining: z.number().int().min(0),
  overpassRequestsRemaining: z.number().int().min(0),
  nominatimAttemptsRemaining: z.number().int().min(0),
  tavilyRequestsRemaining: z.number().int().min(0),
  fallbackEvents: z.array(ProviderFallbackSchema).default([]),
});
export type ProviderBudget = z.infer<typeof ProviderBudgetSchema>;

export const defaultProviderBudget = (): ProviderBudget => ({
  openMeteoRequestsRemaining: 1,
  overpassRequestsRemaining: 1,
  nominatimAttemptsRemaining: 3,
  tavilyRequestsRemaining: 1,
  fallbackEvents: [],
});

export const TriggerActionSchema = z.enum(["request_negotiation"]);
export const TriggerConfigSchema = z.object({
  id: z.string(),
  enabled: z.boolean(),
  eventType: UserEventTypeSchema,
  condition: z.record(z.unknown()),
  action: TriggerActionSchema,
});
export type TriggerConfig = z.infer<typeof TriggerConfigSchema>;

export const UserProfileSchema = z.object({
  userId: z.string(),
  displayName: z.string(),
  privacyMode: z.enum(["low", "medium", "high"]),
  rewardPreference: z.enum(["cashback", "discount", "either"]),
  walkingToleranceMeters: z.number().int().nonnegative(),
  maxBundleStops: z.number().int().positive(),
  maxOffersPerHour: z.number().int().positive(),
});
export type UserProfile = z.infer<typeof UserProfileSchema>;

export const UserEventSchema = z.object({
  eventId: z.string(),
  userId: z.string(),
  eventType: UserEventTypeSchema,
  observedAt: z.string(),
  payload: z.record(z.unknown()).default({}),
});
export type UserEvent = z.infer<typeof UserEventSchema>;

export const OfferTypeSchema = z.enum(["cashback", "discount", "priority_pickup", "bundle_unlock"]);
export type OfferType = z.infer<typeof OfferTypeSchema>;

export const MerchantCategorySchema = z.string();
export const MerchantParticipationStatusSchema = z.enum(["partner"]);
export type MerchantParticipationStatus = z.infer<typeof MerchantParticipationStatusSchema>;

export const MerchantSyntheticFieldSchema = z.enum(["products", "goals", "rules", "transactions", "redemption"]);
export type MerchantSyntheticField = z.infer<typeof MerchantSyntheticFieldSchema>;

export const MerchantProductSchema = z.object({
  id: z.string(),
  merchantId: z.string(),
  name: z.string(),
  priceEuro: z.number().nonnegative(),
  category: z.string(),
  margin: z.enum(["low", "medium", "high"]).optional(),
});
export type MerchantProduct = z.infer<typeof MerchantProductSchema>;

export const MerchantGoalSchema = z.object({
  id: z.string(),
  merchantId: z.string(),
  goal: z.string(),
});
export type MerchantGoal = z.infer<typeof MerchantGoalSchema>;

export const MerchantRuleStaticPatchSchema = z.object({
  maxDiscountPercent: z.number().min(0).max(100),
  dailyBudgetEuro: z.number().nonnegative(),
  dailyBudgetRemainingEuro: z.number().nonnegative(),
  eligibleProducts: z.array(z.string()),
  allowsBundles: z.boolean(),
  preferredBundleCategories: z.array(z.string()),
  offerTypesAllowed: z.array(OfferTypeSchema),
  brandTone: z.string(),
}).partial();
export type MerchantRuleStaticPatch = z.infer<typeof MerchantRuleStaticPatchSchema>;

export const CompiledFreeformRuleSchema = z.object({
  summary: z.string(),
  staticRulePatch: MerchantRuleStaticPatchSchema,
  unsupportedRules: z.array(z.string()).default([]),
  compiledAt: z.string(),
  compiler: z.enum(["azure_openai", "mock_llm"]),
});
export type CompiledFreeformRule = z.infer<typeof CompiledFreeformRuleSchema>;

export const MerchantRuleSchema = z.object({
  merchantId: z.string(),
  maxDiscountPercent: z.number().min(0).max(100),
  dailyBudgetEuro: z.number().nonnegative(),
  dailyBudgetRemainingEuro: z.number().nonnegative(),
  eligibleProducts: z.array(z.string()),
  allowsBundles: z.boolean(),
  preferredBundleCategories: z.array(z.string()),
  offerTypesAllowed: z.array(OfferTypeSchema),
  brandTone: z.string(),
  freeformRulesText: z.string().optional(),
  compiledFreeformRules: CompiledFreeformRuleSchema.optional(),
  freeformRulesStatus: z.enum(["empty", "compiled", "failed"]).optional(),
});
export type MerchantRule = z.infer<typeof MerchantRuleSchema>;

export const MerchantSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: MerchantCategorySchema,
  zoneId: z.string(),
  distanceMeters: z.number().int().nonnegative(),
  address: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  participationStatus: MerchantParticipationStatusSchema.default("partner"),
  source: z.enum(["seeded", "db", "tavily", "overpass", "osm", "osm_overpass", "google_places", "manual"]).default("seeded"),
  externalId: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  sourceUrl: z.string().optional(),
  sourceMetadata: z.record(z.unknown()).optional(),
  syntheticFields: z.array(MerchantSyntheticFieldSchema).default([]),
  products: z.array(MerchantProductSchema).default([]),
  goals: z.array(MerchantGoalSchema).default([]),
  rule: MerchantRuleSchema.optional(),
});
export type Merchant = z.infer<typeof MerchantSchema>;

export const PaymentDensitySignalSchema = z.object({
  merchantId: z.string(),
  baselineTransactions: z.number().int().nonnegative(),
  currentTransactions: z.number().int().nonnegative(),
  baselineRevenue: z.number().nonnegative(),
  currentRevenue: z.number().nonnegative(),
});
export type PaymentDensitySignal = z.infer<typeof PaymentDensitySignalSchema>;

export const BusinessStateSchema = z.enum(["very_quiet", "quiet", "normal", "busy"]);
export type BusinessState = z.infer<typeof BusinessStateSchema>;

export const MerchantInsightSnapshotSchema = z.object({
  insightId: z.string(),
  merchantId: z.string(),
  businessState: BusinessStateSchema,
  transactionDropPercent: z.number(),
  revenueDropPercent: z.number(),
  urgencyScore: z.number().min(0).max(100),
  bundleReadinessScore: z.number().min(0).max(100),
  journeyFitTags: z.array(z.string()),
  insightSummary: z.string(),
  refreshedAt: z.string(),
});
export type MerchantInsightSnapshot = z.infer<typeof MerchantInsightSnapshotSchema>;

export const ConsumerContextSnapshotSchema = z.object({
  snapshotId: z.string(),
  userId: z.string(),
  zoneId: z.string(),
  zoneName: z.string().optional(),
  matchedZones: z.array(CommerceZoneSchema).default([]),
  userLocation: GeoPointSchema.extend({
    accuracyMeters: z.number().nonnegative().optional(),
    source: z.enum(["browser", "demo_geofence"]).default("demo_geofence"),
  }).optional(),
  locationMode: z.enum(["real_browser_location", "demo_geofence_fallback"]).default("demo_geofence_fallback"),
  geofenceMatched: z.boolean().default(false),
  weatherMood: z.string(),
  weatherDescription: z.string(),
  weatherSource: z.enum(["live_weather", "mock_weather_fallback"]).default("mock_weather_fallback"),
  weatherTemperatureC: z.number().optional(),
  timeContext: z.string(),
  declaredIntent: z.string(),
  availableMinutes: z.number().int().positive(),
  rewardPreference: z.enum(["cashback", "discount", "either"]),
  privacyMode: z.enum(["low", "medium", "high"]),
  walkingToleranceMeters: z.number().int().nonnegative(),
  maxBundleStops: z.number().int().positive(),
  maxOffersPerHour: z.number().int().positive(),
  normalizedSignals: z.array(z.record(z.unknown())).default([]),
  providerBudget: ProviderBudgetSchema.optional(),
  providerFallbacks: z.array(ProviderFallbackSchema).default([]),
  createdAt: z.string(),
});
export type ConsumerContextSnapshot = z.infer<typeof ConsumerContextSnapshotSchema>;

export const ConsumerAgentPositionSchema = z.object({
  userId: z.string(),
  longTermGoals: z.array(z.string()),
  canOffer: z.array(z.string()),
  wantsFromOffer: z.array(z.string()),
  constraints: z.object({
    maxOffersPerHour: z.number().int().positive(),
    maxWalkingMeters: z.number().int().nonnegative(),
    maxBundleStops: z.number().int().positive(),
    rawPersonalDataShared: z.boolean(),
  }),
  minimumUtilityThreshold: z.number().min(0).max(100),
});
export type ConsumerAgentPosition = z.infer<typeof ConsumerAgentPositionSchema>;

export const CandidateMerchantSchema = z.object({
  merchantId: z.string(),
  merchantName: z.string(),
  category: z.string(),
  distanceMeters: z.number().int().nonnegative(),
  source: z.string().optional(),
  participationStatus: MerchantParticipationStatusSchema.optional(),
  calculatedFromCoordinates: z.boolean().default(false),
  coordinateEligible: z.boolean().default(true),
  businessState: BusinessStateSchema,
  fitScore: z.number().min(0).max(100),
  considered: z.boolean(),
  reason: z.string(),
  rejectedReason: z.string().optional(),
});
export type CandidateMerchant = z.infer<typeof CandidateMerchantSchema>;

export const NearbyMerchantSearchMetadataSchema = z.object({
  activeZoneId: z.string().optional(),
  activeZoneName: z.string().optional(),
  source: z.enum(["stored_db", "stored_db_with_live_fallback"]).default("stored_db"),
  searchRadiiTried: z.array(z.number().int().positive()).default([]),
  radiusUsedMeters: z.number().int().positive().optional(),
  expanded: z.boolean().default(false),
  eligibleMerchantCount: z.number().int().nonnegative().default(0),
  liveDiscoveryFallbackUsed: z.boolean().default(false),
});
export type NearbyMerchantSearchMetadata = z.infer<typeof NearbyMerchantSearchMetadataSchema>;

export const BundleCandidateSchema = z.object({
  bundleCandidateId: z.string(),
  merchantIds: z.array(z.string()),
  categories: z.array(z.string()),
  combinedDistanceMeters: z.number().int().nonnegative(),
  preliminaryScore: z.number().min(0).max(100),
  whyCandidateExists: z.string(),
  weaknesses: z.array(z.string()).optional(),
});
export type BundleCandidate = z.infer<typeof BundleCandidateSchema>;

export const IncentiveSchema = z.object({
  type: OfferTypeSchema,
  percent: z.number().min(0).max(100).optional(),
  valueText: z.string(),
});
export type Incentive = z.infer<typeof IncentiveSchema>;

export const SelectedMerchantSchema = z.object({
  merchantId: z.string(),
  product: z.string(),
  incentive: IncentiveSchema,
  roleInJourney: z.string().optional(),
});
export type SelectedMerchant = z.infer<typeof SelectedMerchantSchema>;

export const NegotiationBriefSchema = z.object({
  briefId: z.string(),
  userEvent: UserEventSchema,
  consumerContext: ConsumerContextSnapshotSchema,
  consumerAgentPosition: ConsumerAgentPositionSchema,
  merchantInsights: z.array(MerchantInsightSnapshotSchema),
  candidateMerchants: z.array(CandidateMerchantSchema),
  bundleCandidates: z.array(BundleCandidateSchema),
  bundlePolicy: z.record(z.unknown()),
  offerPolicy: z.record(z.unknown()),
  platformGoalModel: z.record(z.unknown()),
  createdAt: z.string(),
});
export type NegotiationBrief = z.infer<typeof NegotiationBriefSchema>;

export const NegotiationDecisionSchema = z.object({
  decision: z.enum(["no_offer", "single_offer", "bundle_offer"]),
  selectedMerchants: z.array(SelectedMerchantSchema),
  validityMinutes: z.number().int().positive(),
  consumerIncentivesOffered: z.array(z.string()),
  merchantIncentivesOffered: z.array(z.string()),
  utilityAssessment: z.object({
    consumer: z.object({
      score: z.number().min(0).max(100),
      whyPositive: z.array(z.string()),
      risks: z.array(z.string()),
    }),
    merchants: z.array(z.object({
      merchantId: z.string(),
      score: z.number().min(0).max(100),
      whyPositive: z.array(z.string()),
      risks: z.array(z.string()),
    })),
    platform: z.object({
      score: z.number().min(0).max(100),
      whyPositive: z.array(z.string()),
      risks: z.array(z.string()),
    }),
  }),
  longTermGoalFit: z.object({
    consumer: z.array(z.string()),
    merchants: z.array(z.string()),
    platform: z.array(z.string()),
  }),
  reasoning: z.array(z.string()),
  rejectedCandidates: z.array(z.object({
    id: z.string(),
    reason: z.string(),
  })),
  consumerHeadline: z.string(),
  consumerSubheadline: z.string(),
  cta: z.string(),
  confidence: z.number().min(0).max(1),
});
export type NegotiationDecision = z.infer<typeof NegotiationDecisionSchema>;

export const ValidationCheckSchema = z.object({
  validator: z.string(),
  passed: z.boolean(),
  detail: z.string(),
});
export type ValidationCheck = z.infer<typeof ValidationCheckSchema>;

export const ValidationResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
  checks: z.array(ValidationCheckSchema).default([]),
});
export type ValidationResult = z.infer<typeof ValidationResultSchema>;

export const OfferStatusSchema = z.enum(["created", "shown", "accepted", "redeemed", "expired", "dismissed"]);
export type OfferStatus = z.infer<typeof OfferStatusSchema>;

export const OfferItemSchema = z.object({
  offerItemId: z.string(),
  offerId: z.string(),
  merchantId: z.string(),
  merchantName: z.string(),
  product: z.string(),
  incentiveType: OfferTypeSchema,
  incentivePercent: z.number().min(0).max(100).optional(),
  priceEuro: z.number().nonnegative(),
  estimatedCashbackEuro: z.number().nonnegative().optional(),
  distanceMeters: z.number().int().nonnegative(),
  merchantParticipationStatus: MerchantParticipationStatusSchema.default("partner"),
  merchantSource: z.string().optional(),
});
export type OfferItem = z.infer<typeof OfferItemSchema>;

export const OfferSchema = z.object({
  offerId: z.string(),
  consumerId: z.string(),
  type: z.enum(["single_offer", "bundle_offer"]),
  status: OfferStatusSchema,
  headline: z.string(),
  subheadline: z.string(),
  cta: z.string(),
  validityMinutes: z.number().int().positive(),
  expiresAt: z.string(),
  createdAt: z.string().optional(),
  items: z.array(OfferItemSchema),
  why: z.array(z.string()).default([]),
});
export type Offer = z.infer<typeof OfferSchema>;

export const RedemptionTokenSchema = z.object({
  tokenId: z.string(),
  offerId: z.string(),
  offerItemId: z.string(),
  merchantId: z.string(),
  merchantName: z.string(),
  product: z.string(),
  status: z.enum(["active", "redeemed", "expired"]),
  code: z.string(),
  cashbackEuro: z.number().nonnegative(),
  createdAt: z.string(),
  redeemedAt: z.string().optional(),
});
export type RedemptionToken = z.infer<typeof RedemptionTokenSchema>;

export const RedemptionResultSchema = z.object({
  success: z.boolean(),
  token: RedemptionTokenSchema.optional(),
  cashbackIssuedEuro: z.number().nonnegative().default(0),
  message: z.string(),
});
export type RedemptionResult = z.infer<typeof RedemptionResultSchema>;

export const AnalyticsEventTypeSchema = z.enum([
  "context_refreshed",
  "trigger_matched",
  "merchant_profile_updated",
  "merchant_insight_updated",
  "merchant_insight_refresh_completed",
  "merchant_discovered",
  "merchant_import_started",
  "merchant_import_completed",
  "orchestration_blocked",
  "provider_fallback_used",
  "negotiation_requested",
  "negotiation_decision_created",
  "offer_validated",
  "offer_shown",
  "offer_accepted",
  "redemption_token_issued",
  "token_redeemed",
  "cashback_issued",
  "offer_dismissed",
  "offer_expired",
]);
export type AnalyticsEventType = z.infer<typeof AnalyticsEventTypeSchema>;

export const AnalyticsEventSchema = z.object({
  eventId: z.string(),
  type: AnalyticsEventTypeSchema,
  layer: z.enum(["config", "providers", "context", "consumer_agent", "merchant_intelligence", "negotiation", "validation", "offer", "redemption", "analytics"]),
  message: z.string(),
  merchantId: z.string().optional(),
  offerId: z.string().optional(),
  payload: z.record(z.unknown()).default({}),
  createdAt: z.string(),
});
export type AnalyticsEvent = z.infer<typeof AnalyticsEventSchema>;

export const MerchantDashboardQuerySchema = z.object({
  merchantLimit: z.coerce.number().int().positive().max(200).default(50),
  merchantOffset: z.coerce.number().int().nonnegative().default(0),
  zoneId: z.string().optional(),
  category: z.string().optional(),
  participationStatus: MerchantParticipationStatusSchema.optional(),
  source: MerchantSchema.shape.source.optional(),
  query: z.string().optional(),
});
export type MerchantDashboardQuery = z.infer<typeof MerchantDashboardQuerySchema>;

export const MerchantPageSchema = z.object({
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});
export type MerchantPage = z.infer<typeof MerchantPageSchema>;

export const DashboardMetricsSchema = z.object({
  merchants: z.array(z.object({
    merchant: MerchantSchema,
    insight: MerchantInsightSnapshotSchema.optional(),
    baselineTransactions: z.number().int().nonnegative().optional(),
    currentTransactions: z.number().int().nonnegative().optional(),
    baselineRevenue: z.number().nonnegative().optional(),
    currentRevenue: z.number().nonnegative().optional(),
    offersShown: z.number().int().nonnegative(),
    offersAccepted: z.number().int().nonnegative(),
    tokensRedeemed: z.number().int().nonnegative(),
    cashbackIssuedEuro: z.number().nonnegative(),
    revenueInfluencedEuro: z.number().nonnegative(),
    notSelectedReason: z.string().optional(),
    calculatedDistanceMeters: z.number().int().nonnegative().optional(),
  })),
  merchantPage: MerchantPageSchema,
  merchantSummary: z.object({
    total: z.number().int().nonnegative(),
    bySource: z.record(z.number().int().nonnegative()).default({}),
    byCategory: z.record(z.number().int().nonnegative()).default({}),
    byParticipationStatus: z.record(z.number().int().nonnegative()).default({}),
  }),
  zones: z.array(CommerceZoneSchema).default([]),
  importRuns: z.array(MerchantImportRunSchema).default([]),
  currentContext: ConsumerContextSnapshotSchema.nullable().optional(),
  events: z.array(AnalyticsEventSchema),
});
export type DashboardMetrics = z.infer<typeof DashboardMetricsSchema>;

export const OrchestrateRequestSchema = z.object({
  eventType: z.enum(["WalletOpened", "UserDeclaredContextChanged", "UserEnteredDemoZone", "UserEnteredZone"]),
  userId: z.string(),
  idempotencyKey: z.string().optional(),
  location: z.object({
    latitude: z.number(),
    longitude: z.number(),
    accuracyMeters: z.number().nonnegative().optional(),
    source: z.enum(["browser", "demo_geofence"]).default("browser"),
  }).optional(),
  declaredContext: z.object({
    intent: z.string().optional(),
    availableMinutes: z.number().int().positive().optional(),
    rewardPreference: z.enum(["cashback", "discount", "either"]).optional(),
  }).optional(),
});
export type OrchestrateRequest = z.infer<typeof OrchestrateRequestSchema>;

export const ClaimOfferRequestSchema = z.object({
  offerId: z.string(),
});
export type ClaimOfferRequest = z.infer<typeof ClaimOfferRequestSchema>;

export const RedeemTokenRequestSchema = z.object({
  code: z.string(),
  merchantId: z.string(),
});
export type RedeemTokenRequest = z.infer<typeof RedeemTokenRequestSchema>;

export const MerchantRuleUpdateSchema = MerchantRuleSchema;
export type MerchantRuleUpdate = z.infer<typeof MerchantRuleUpdateSchema>;

export const MerchantUpdateSchema = MerchantSchema;
export type MerchantUpdate = z.infer<typeof MerchantUpdateSchema>;

export const MerchantRuleCompilePreviewRequestSchema = z.object({
  merchant: MerchantSchema,
  freeformRulesText: z.string(),
});
export type MerchantRuleCompilePreviewRequest = z.infer<typeof MerchantRuleCompilePreviewRequestSchema>;

export const MerchantRuleCompilePreviewResultSchema = z.object({
  ok: z.boolean(),
  compiledRule: CompiledFreeformRuleSchema.nullable(),
  appliedRule: MerchantRuleSchema.nullable(),
  error: z.string().optional(),
});
export type MerchantRuleCompilePreviewResult = z.infer<typeof MerchantRuleCompilePreviewResultSchema>;

export const OrchestrationRunStatusSchema = z.enum(["running", "completed", "failed"]);
export type OrchestrationRunStatus = z.infer<typeof OrchestrationRunStatusSchema>;

export const OrchestrationBlockReasonSchema = z.enum([
  "no_trigger_matched",
  "cooldown_active",
  "active_offer_exists",
  "orchestration_already_running",
  "stale_orchestration_run",
  "orchestration_failed",
]);
export type OrchestrationBlockReason = z.infer<typeof OrchestrationBlockReasonSchema>;

export const OrchestrationRunSchema = z.object({
  idempotencyKey: z.string(),
  userId: z.string(),
  eventType: UserEventTypeSchema,
  contextSnapshotId: z.string().optional(),
  status: OrchestrationRunStatusSchema,
  resultJson: z.record(z.unknown()).nullable().optional(),
  errorJson: z.record(z.unknown()).nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type OrchestrationRun = z.infer<typeof OrchestrationRunSchema>;

export const OrchestrationResultSchema = z.object({
  triggered: z.boolean(),
  reason: OrchestrationBlockReasonSchema.optional(),
  idempotencyKey: z.string().optional(),
  orchestrationStatus: OrchestrationRunStatusSchema.optional(),
  retryAfterMs: z.number().int().positive().optional(),
  matchedTriggers: z.array(TriggerConfigSchema),
  consumerContext: ConsumerContextSnapshotSchema.optional(),
  consumerAgentPosition: ConsumerAgentPositionSchema.optional(),
  merchantInsights: z.array(MerchantInsightSnapshotSchema).default([]),
  candidateMerchants: z.array(CandidateMerchantSchema).default([]),
  bundleCandidates: z.array(BundleCandidateSchema).default([]),
  negotiationBrief: NegotiationBriefSchema.optional(),
  negotiationDecision: NegotiationDecisionSchema.optional(),
  validationResult: ValidationResultSchema.optional(),
  offer: OfferSchema.nullable().optional(),
  analyticsEvents: z.array(AnalyticsEventSchema).default([]),
  providerBudget: ProviderBudgetSchema.optional(),
  discoveredMerchants: z.array(MerchantSchema).default([]),
  nearbyMerchantSearch: NearbyMerchantSearchMetadataSchema.optional(),
});
export type OrchestrationResult = z.infer<typeof OrchestrationResultSchema>;
