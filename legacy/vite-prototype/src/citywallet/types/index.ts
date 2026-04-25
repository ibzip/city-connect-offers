// Core domain types for City Wallet MVP.

export type LayerKey =
  | "config"
  | "merchant"
  | "consumer"
  | "negotiation"
  | "validation"
  | "redemption";

export type ProviderId =
  | "mock_open_meteo"
  | "live_open_meteo"
  | "demo_geofence"
  | "browser_geolocation"
  | "simulated_payone"
  | "live_payone"
  | "declared_context"
  | "mock_events";

export interface ActiveProviders {
  weather: ProviderId;
  location: ProviderId;
  paymentDensity: ProviderId;
  userContext: ProviderId;
  localEvents: ProviderId;
}

export type TriggerEvent =
  | "WalletOpened"
  | "UserEnteredDemoZone"
  | "UserDeclaredContextChanged"
  | "TimeContextChanged"
  | "WeatherContextChanged";

export interface TriggerConfig {
  id: string;
  enabled: boolean;
  eventType: TriggerEvent;
  condition: string; // human-readable
  action: "request_negotiation";
}

export type OfferType =
  | "cashback"
  | "discount"
  | "priority_pickup"
  | "bundle_unlock";

export interface MerchantProduct {
  id: string;
  name: string;
  basePriceEUR: number;
}

export interface MerchantConfig {
  id: string;
  name: string;
  category: string;
  zoneId: string;
  distanceMeters: number;
  products: MerchantProduct[];
  goals: {
    primary: string;
    secondary?: string;
  };
  rules: {
    maxDiscountPercent: number;
    dailyBudgetEUR: number;
    eligibleProductIds: string[];
  };
  brandTone: string;
  bundlePermissions: {
    allowsBundles: boolean;
    preferredPartnerCategories: string[];
  };
  allowedOfferTypes: OfferType[];
}

export type BusinessState = "very_quiet" | "quiet" | "normal" | "busy";

export interface PaymentDensity {
  merchantId: string;
  baselineTransactions: number;
  currentTransactions: number;
  baselineRevenueEUR: number;
  currentRevenueEUR: number;
}

export interface MerchantInsightSnapshot {
  merchantId: string;
  businessState: BusinessState;
  transactionDropPercent: number;
  urgencyScore: number; // 0-100
  bundleReadinessScore: number; // 0-100
  consumerJourneyFitTags: string[];
  insightSummary: string;
  updatedAt: number;
}

export interface WeatherContext {
  temperatureC: number;
  conditions: string;
  source: string;
}

export interface TimeContext {
  isoTime: string;
  label: string; // "lunch break"
  source: string;
}

export interface LocationContext {
  zoneId: string;
  zoneLabel: string;
  source: string;
}

export interface UserDeclaredContext {
  intent: string;
  attentionState: string;
  privacyMode: "low" | "medium" | "high";
  walkingToleranceMeters: number;
  maxBundleStops: number;
  rewardPreference: "cashback" | "discount" | "either";
  availableMinutes: number;
  maxOffersPerHour: number;
  source: string;
}

export interface ConsumerContext {
  user: { id: string; displayName: string };
  location: LocationContext;
  weather: WeatherContext;
  time: TimeContext;
  declared: UserDeclaredContext;
}

export interface ConsumerAgentPosition {
  longTermGoals: string[];
  canOffer: string[];
  wantsFromOffer: string[];
  constraints: {
    maxWalkingMeters: number;
    maxBundleStops: number;
    maxOffersPerHour: number;
    rawPersonalDataShared: boolean;
  };
}

export interface CandidateMerchant {
  merchantId: string;
  reason: string;
  fitScore: number; // 0-100
  considered: boolean;
  rejectedReason?: string;
}

export interface CandidateBundle {
  id: string;
  merchantIds: string[];
  preliminaryScore: number;
  rationale: string;
  rejectedReason?: string;
}

export interface BundlePolicy {
  maxMerchantsPerBundle: number;
  maxWalkingMeters: number;
  requireSameZone: boolean;
  requireMerchantConsent: boolean;
  requireAtLeastOneQuietMerchant: boolean;
  maxValidityMinutes: number;
  validPrinciples: string[];
  strongPairings: [string, string][];
  weakPairings: [string, string][];
}

export interface OfferPolicy {
  maxDiscountPercent: number;
  preferSmallestSufficientIncentive: boolean;
  allowedOfferTypes: OfferType[];
}

export interface PlatformGoalModel {
  goals: string[];
}

export type NegotiationDecisionType =
  | "no_offer"
  | "single_offer"
  | "bundle_offer";

export interface OfferItem {
  merchantId: string;
  merchantName: string;
  productId: string;
  productName: string;
  productPriceEUR: number;
  incentiveType: OfferType;
  percent: number;
  distanceMeters: number;
}

export interface NegotiationDecision {
  decision: NegotiationDecisionType;
  selectedMerchantIds: string[];
  items: OfferItem[];
  consumerIncentivesOffered: string[];
  merchantIncentivesOffered: string[];
  utilityAssessment: {
    consumerUtility: number;
    merchantUtility: number;
    platformUtility: number;
  };
  longTermGoalFit: string[];
  reasoning: string[];
  consumerHeadline: string;
  consumerSubheadline: string;
  cta: string;
  confidence: number;
}

export interface ValidatorResult {
  validator: string;
  passed: boolean;
  detail: string;
}

export interface ValidationReport {
  passed: boolean;
  results: ValidatorResult[];
}

export type OfferStatus =
  | "active"
  | "claimed"
  | "redeemed"
  | "expired"
  | "dismissed";

export interface Offer {
  id: string;
  type: NegotiationDecisionType;
  status: OfferStatus;
  headline: string;
  subheadline: string;
  cta: string;
  expiresAt: number;
  items: OfferItem[];
  why: string[];
}

export type TokenStatus = "active" | "redeemed" | "expired";

export interface RedemptionToken {
  id: string; // CW-CAFE-91K
  offerId: string;
  merchantId: string;
  merchantName: string;
  productName: string;
  percent: number;
  productPriceEUR: number;
  status: TokenStatus;
  cashbackIssuedEUR?: number;
  redeemedAt?: number;
}

export interface MerchantAnalytics {
  merchantId: string;
  offersGenerated: number;
  offersAccepted: number;
  tokensRedeemed: number;
  cashbackIssuedEUR: number;
  revenueInfluencedEUR: number;
}

export type AnalyticsEventType =
  | "context_refreshed"
  | "merchant_insight_updated"
  | "trigger_matched"
  | "negotiation_requested"
  | "negotiation_decision_created"
  | "offer_validated"
  | "offer_shown"
  | "offer_accepted"
  | "offer_dismissed"
  | "redemption_token_issued"
  | "token_redeemed"
  | "cashback_issued";

export interface AnalyticsEvent {
  id: string;
  type: AnalyticsEventType;
  layer: LayerKey;
  ts: number;
  message: string;
  data?: Record<string, unknown>;
}

export interface NegotiationBrief {
  context: ConsumerContext;
  consumerAgentPosition: ConsumerAgentPosition;
  insights: MerchantInsightSnapshot[];
  candidates: CandidateMerchant[];
  candidateBundles: CandidateBundle[];
  bundlePolicy: BundlePolicy;
  offerPolicy: OfferPolicy;
  platformGoals: PlatformGoalModel;
}

export interface DemoTimelineStep {
  id: string;
  title: string;
  layer: LayerKey;
  ts: number;
  detail?: string;
}