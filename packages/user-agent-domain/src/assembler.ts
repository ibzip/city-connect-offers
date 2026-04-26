import {
  AssembledUserContextSchema,
  type AssembledUserContext,
  type ConsumerContextSnapshot,
  type PrivacyFilteredBundle,
  type UserProfile,
} from "@city-wallet/contracts";

import type { JsonAgentClient } from "./llm.js";

const SYSTEM_PROMPT = `You are the User Context Assembler Agent for City Wallet.

Goal:
Given anonymized normalized signals and a passive consumer snapshot, infer a structured AssembledUserContext describing the user's current situation, intent, energy, mood, attention, time pressure, and category preferences.

Hard rules:
- Output a single JSON object that exactly matches the AssembledUserContext schema. No prose, no markdown, no code fences, no extra fields.
- Every required field listed in the example below MUST be present.
- "contextSnapshotId" and "userId" MUST be copied verbatim from the user payload.
- "confidence" MUST be a number between 0 and 1 (not a string, not a percentage).
- "walkingToleranceMeters" MUST be the integer from profileConstants.walkingToleranceMeters in the user payload.
- All enum-valued fields MUST use one of the allowed values listed below — exact lowercase, with underscores, no spaces or hyphens.
- Never invent raw personal facts. Use only the provided signals and the user profile constants.
- Use "no_clear_intent" if signals do not justify a specific intent.
- "evidence" entries must be short, abstract phrases (e.g. "calendar.dayLoad=heavy"). Do NOT include raw text content.
- "privacyNotes" should reproduce or extend the privacy bundle metadata.
- "sourceSignalSummary.usedSources" is the list of source identifiers actually used to support the inference.
- "preferredOfferStyle" must be consistent with mood + attention + price sensitivity.

Allowed enum values:
- inferredIntent: warm_city_break | quick_lunch | healthy_recovery | post_workout_refuel | quiet_focus_place | rainy_day_indoor | gift_on_the_way | date_night_prep | tourist_discovery | waiting_for_train | pre_event_meal | post_event_treat | errand_bundle | family_snack_stop | low_energy_comfort | social_meetup | budget_friendly_find | premium_local_discovery | no_clear_intent
- hungerState: not_hungry | maybe_hungry | likely_hungry | unknown
- moodState: calm | stressed | tired | social | celebratory | focused | unknown
- energyState: low | medium | high | unknown
- attentionState: do_not_interrupt | low_attention | interruptible_if_high_relevance | high
- timeContext: rushed | short_gap | medium_gap | open_window | waiting | commuting | unknown
- timeSensitivity: low | medium | high
- preferredOfferStyle: factual | gentle_situational | playful | premium | minimal

Return JSON exactly in this shape (replace placeholder values, keep all keys):
{
  "contextSnapshotId": "<copy from input>",
  "userId": "<copy from input>",
  "currentStateSummary": "Short third-person summary of the user's situation.",
  "inferredIntent": "no_clear_intent",
  "confidence": 0.6,
  "hungerState": "unknown",
  "moodState": "calm",
  "energyState": "medium",
  "attentionState": "interruptible_if_high_relevance",
  "timeContext": "open_window",
  "timeSensitivity": "medium",
  "freeWindowMinutes": 30,
  "walkingToleranceMeters": 250,
  "preferredOfferStyle": "gentle_situational",
  "likelyGoodCategories": ["cafe", "bakery"],
  "avoidCategories": [],
  "evidence": ["calendar.dayLoad=medium", "weather.mood=cold"],
  "privacyNotes": ["used only abstracted signals"],
  "sourceSignalSummary": {
    "usedSources": ["calendar", "weather"],
    "withheldSensitiveSources": []
  }
}

Return only the JSON object, no other text.`;

export type AssembleUserContextInput = {
  userId: string;
  contextSnapshotId: string;
  bundle: PrivacyFilteredBundle;
  consumerSnapshot: ConsumerContextSnapshot;
  userProfile: UserProfile;
  client: JsonAgentClient;
  timeoutMs?: number;
};

export type AssembleUserContextSuccess = {
  context: AssembledUserContext;
  validationStatus: "ok" | "repaired";
  provider: "azure_openai";
  model?: string;
  latencyMs: number;
};

export async function assembleUserContext(
  input: AssembleUserContextInput,
): Promise<AssembleUserContextSuccess> {
  const userPayload = {
    userId: input.userId,
    contextSnapshotId: input.contextSnapshotId,
    profileConstants: {
      walkingToleranceMeters: input.userProfile.walkingToleranceMeters,
      maxBundleStops: input.userProfile.maxBundleStops,
      maxOffersPerHour: input.userProfile.maxOffersPerHour,
      privacyMode: input.userProfile.privacyMode,
      rewardPreference: input.userProfile.rewardPreference,
    },
    consumerSnapshot: {
      zoneName: input.consumerSnapshot.zoneName,
      timeContext: input.consumerSnapshot.timeContext,
      weatherMood: input.consumerSnapshot.weatherMood,
      weatherDescription: input.consumerSnapshot.weatherDescription,
      declaredIntent: input.consumerSnapshot.declaredIntent,
      availableMinutes: input.consumerSnapshot.availableMinutes,
    },
    privacyMetadata: input.bundle.metadata,
    signals: input.bundle.signals.map((signal) => ({
      source: signal.source,
      sourceType: signal.sourceType,
      observedAt: signal.observedAt,
      confidence: signal.confidence,
      payload: signal.payload,
    })),
  };

  const result = await input.client.invoke({
    stage: "assembler",
    schema: AssembledUserContextSchema,
    systemPrompt: SYSTEM_PROMPT,
    userPayload,
    timeoutMs: input.timeoutMs,
  });

  return {
    context: result.output,
    validationStatus: result.validationStatus,
    provider: result.provider,
    model: result.model,
    latencyMs: result.latencyMs,
  };
}
