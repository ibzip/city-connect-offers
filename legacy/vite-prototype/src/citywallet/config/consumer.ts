import type { ConsumerAgentPosition, ConsumerContext, UserDeclaredContext } from "../types";

export const defaultDeclaredContext: UserDeclaredContext = {
  intent: "warm_city_break",
  attentionState: "interruptible_if_high_relevance",
  privacyMode: "high",
  walkingToleranceMeters: 250,
  maxBundleStops: 2,
  rewardPreference: "cashback",
  availableMinutes: 30,
  maxOffersPerHour: 1,
  source: "declared_context",
};

export const defaultConsumerContext: ConsumerContext = {
  user: { id: "mia", displayName: "Mia" },
  location: {
    zoneId: "stuttgart_old_town",
    zoneLabel: "Stuttgart Old Town",
    source: "demo_geofence",
  },
  weather: {
    temperatureC: 11,
    conditions: "overcast",
    source: "mock_open_meteo",
  },
  time: {
    isoTime: new Date().toISOString(),
    label: "lunch break",
    source: "device_clock",
  },
  declared: defaultDeclaredContext,
};

export function buildConsumerAgentPosition(
  declared: UserDeclaredContext,
): ConsumerAgentPosition {
  return {
    longTermGoals: [
      "receive useful local offers without spam",
      "protect privacy",
      "discover nearby places",
      "avoid irrelevant interruptions",
    ],
    canOffer: [
      "attention for one high-relevance offer",
      "abstract intent signal",
      "proximity",
      `willingness to complete up to ${declared.maxBundleStops} stops`,
    ],
    wantsFromOffer: [
      "high context relevance",
      declared.rewardPreference === "cashback" ? "cashback" : "convenience",
      "short walk",
      "privacy-preserving experience",
    ],
    constraints: {
      maxWalkingMeters: declared.walkingToleranceMeters,
      maxBundleStops: declared.maxBundleStops,
      maxOffersPerHour: declared.maxOffersPerHour,
      rawPersonalDataShared: false,
    },
  };
}