import type { ConsumerAgentPosition, ConsumerContextSnapshot, UserProfile } from "@city-wallet/contracts";

export function buildConsumerAgentPosition(
  profile: UserProfile,
  context: ConsumerContextSnapshot,
): ConsumerAgentPosition {
  return {
    userId: profile.userId,
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
      `willingness to complete up to ${profile.maxBundleStops} stops`,
    ],
    wantsFromOffer: [
      "high context relevance",
      profile.rewardPreference === "cashback" ? "cashback or convenience" : "convenience",
      "short walk",
      "privacy-preserving experience",
    ],
    constraints: {
      maxOffersPerHour: profile.maxOffersPerHour,
      maxWalkingMeters: profile.walkingToleranceMeters,
      maxBundleStops: profile.maxBundleStops,
      rawPersonalDataShared: false,
    },
    minimumUtilityThreshold: context.availableMinutes >= 20 ? 60 : 70,
  };
}
