import {
  UserNegotiationPositionSchema,
  type AssembledUserContext,
  type ConsumerContextSnapshot,
  type UserNegotiationPosition,
  type UserProfile,
} from "@city-wallet/contracts";

import type { JsonAgentClient } from "./llm.js";

const SYSTEM_PROMPT = `You are the User Negotiator Agent for City Wallet.

Goal:
Given the AssembledUserContext, the user's profile constants, and the merchant density of the area, produce a UserNegotiationPosition that defines the user's negotiation stance for any subsequent backend offer negotiation.

Hard rules:
- Output a single JSON object exactly matching the UserNegotiationPosition schema. No prose, no markdown, no code fences, no extra fields.
- Every required field listed in the example below MUST be present.
- "userId" and "contextSnapshotId" MUST be copied verbatim from the user payload.
- "acceptanceThreshold" MUST be a number between 0 and 100 (integer or decimal). "confidence" MUST be a number between 0 and 1.
- Hard constraints (maxWalkingMeters, maxStops, maxOffersPerHour) MUST come from the user's profile constants. You may set them lower if the user is rushed/low-attention but never higher. They must be positive integers (maxWalkingMeters may be 0 only if walking is forbidden).
- "rawPersonalDataShared" and "allowSensitiveInference" are booleans (default both to false unless explicitly justified).
- All enum-valued fields MUST use one of the allowed values exactly — lowercase, underscores, no spaces or hyphens.
- Set "shouldNegotiate" to false if attentionState is "do_not_interrupt", or if there is no clear intent and no actionable signal.
- "preferNoOfferIfWeakFit" should be true when the user is rushed, focused, or has low attention.
- "acceptanceThreshold" should rise when attention is low or when the user prefers no offer.
- "minimumRelevanceReason" must be a one-sentence rule the backend negotiator must satisfy to send any offer at all.
- "evidence" entries must be short, abstract phrases (e.g. "assembledContext.attentionState=do_not_interrupt"). No raw text from sensitive sources.

Allowed enum values:
- userUtilityGoal: useful_local_offer_without_spam | save_money | discover_local_places | minimize_walking | comfort_break | healthy_choice | time_efficient_errand | no_offer_preferred
- softPreferences.rewardType: cashback | discount | convenience | discovery | premium
- softPreferences.tone: factual | gentle_situational | playful | premium | minimal
- softPreferences.bundlePreference: single_stop | coherent_short_journey | multi_stop_ok | no_bundle

Return JSON exactly in this shape (replace placeholder values, keep all keys):
{
  "userId": "<copy from input>",
  "contextSnapshotId": "<copy from input>",
  "shouldNegotiate": true,
  "userUtilityGoal": "useful_local_offer_without_spam",
  "acceptanceThreshold": 65,
  "hardConstraints": {
    "maxWalkingMeters": 250,
    "maxStops": 2,
    "maxOffersPerHour": 1,
    "rawPersonalDataShared": false,
    "allowSensitiveInference": false
  },
  "softPreferences": {
    "rewardType": "cashback",
    "tone": "gentle_situational",
    "preferredCategories": ["cafe", "bakery"],
    "avoidCategories": [],
    "bundlePreference": "single_stop"
  },
  "negotiationStance": {
    "allowSingleOffer": true,
    "allowBundle": false,
    "preferNoOfferIfWeakFit": true,
    "minimumRelevanceReason": "Offer must match a clear interest signal and be within walking tolerance."
  },
  "evidence": ["assembledContext.attentionState=interruptible_if_high_relevance"],
  "confidence": 0.7
}

Return only the JSON object, no other text.`;

export type RunUserNegotiatorInput = {
  userId: string;
  contextSnapshotId: string;
  assembledContext: AssembledUserContext;
  consumerSnapshot: ConsumerContextSnapshot;
  userProfile: UserProfile;
  nearbyMerchantCount: number;
  client: JsonAgentClient;
  timeoutMs?: number;
};

export type RunUserNegotiatorSuccess = {
  position: UserNegotiationPosition;
  validationStatus: "ok" | "repaired";
  provider: "azure_openai";
  model?: string;
  latencyMs: number;
};

export async function runUserNegotiator(
  input: RunUserNegotiatorInput,
): Promise<RunUserNegotiatorSuccess> {
  const userPayload = {
    userId: input.userId,
    contextSnapshotId: input.contextSnapshotId,
    profileConstants: {
      walkingToleranceMeters: input.userProfile.walkingToleranceMeters,
      maxBundleStops: input.userProfile.maxBundleStops,
      maxOffersPerHour: input.userProfile.maxOffersPerHour,
      rewardPreference: input.userProfile.rewardPreference,
      privacyMode: input.userProfile.privacyMode,
    },
    assembledContext: input.assembledContext,
    consumerSnapshot: {
      zoneName: input.consumerSnapshot.zoneName,
      timeContext: input.consumerSnapshot.timeContext,
      weatherMood: input.consumerSnapshot.weatherMood,
      weatherDescription: input.consumerSnapshot.weatherDescription,
      availableMinutes: input.consumerSnapshot.availableMinutes,
    },
    nearbyMerchantCount: input.nearbyMerchantCount,
  };

  const result = await input.client.invoke({
    stage: "user_negotiator",
    schema: UserNegotiationPositionSchema,
    systemPrompt: SYSTEM_PROMPT,
    userPayload,
    timeoutMs: input.timeoutMs,
  });

  return {
    position: result.output,
    validationStatus: result.validationStatus,
    provider: result.provider,
    model: result.model,
    latencyMs: result.latencyMs,
  };
}
