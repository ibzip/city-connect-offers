import assert from "node:assert/strict";
import test from "node:test";
import type { MockContextProfile } from "@city-wallet/contracts";
import { collectRawSignals, mockProviders } from "./collect.js";

function makeProfile(overrides: Partial<MockContextProfile> = {}): MockContextProfile {
  const now = new Date().toISOString();
  return {
    id: "mock_test",
    userId: "user_test",
    name: "test",
    enabledSources: {
      calendar: true,
      fitness: true,
      mood: true,
      mobility: true,
      payment_preference: true,
      social: true,
      transit: true,
      dietary: true,
      device_attention: true,
      local_events: true,
    },
    signalPayloads: {
      calendar: {
        freeWindowMinutes: 30,
        nextEventInMinutes: 90,
        nextEventType: "personal",
        dayLoad: "medium",
        hasHardStop: false,
      },
      fitness: {
        sleepQuality: "good",
        energyLevel: "medium",
        recentWorkout: false,
        recoveryNeed: "low",
        activityLoadToday: "low",
      },
      mood: { moodState: "calm", confidence: 0.7, basis: ["weekend afternoon"] },
      payment_preference: {
        rewardPreference: "cashback",
        priceSensitivity: "medium",
        categoryAffinities: ["cafe"],
        recentCategoryAvoidance: [],
      },
      mobility: {
        movementState: "stationary",
        dwellPattern: "browsing",
        familiarity: "familiar_area",
      },
      social: {
        socialMode: "solo",
        groupSize: 1,
      },
      transit: { transitState: "none" },
      dietary: { dietaryHints: [], avoidFoodCategories: [], preferredFoodStyle: "light" },
      device_attention: { screenActive: true, focusMode: false, batteryLevel: "high", headphonesConnected: false, notificationTolerance: "medium" },
      local_events: { nearbyEventType: "none", eventWindow: "none", crowdLevel: "low" },
    },
    activeScenario: null,
    isActive: true,
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

test("collect produces signals only for explicitly enabled sources with payloads", async () => {
  const profile = makeProfile({
    enabledSources: { calendar: true, fitness: false, mood: true },
  });
  const result = await collectRawSignals({
    userId: "user_test",
    profile,
    snapshot: null,
    providers: mockProviders,
  });
  assert.ok(result.enabledSources.includes("calendar"));
  assert.ok(result.enabledSources.includes("mood"));
  assert.ok(result.disabledSources.includes("fitness"));
  assert.ok(!result.signals.some((s) => s.source === "fitness"));
});

test("collect treats missing profile as disabled mock sources", async () => {
  const result = await collectRawSignals({
    userId: "user_test",
    profile: null,
    snapshot: null,
    providers: mockProviders,
  });
  assert.equal(result.signals.length, 0);
  assert.equal(result.enabledSources.length, 0);
  assert.ok(result.disabledSources.length >= mockProviders.length, "all mock sources should be disabled when no profile is provided");
});

test("collect skips a source whose payload fails schema validation", async () => {
  const profile = makeProfile({
    enabledSources: { calendar: true, fitness: true },
    signalPayloads: {
      calendar: { freeWindowMinutes: -5 } as unknown as MockContextProfile["signalPayloads"]["calendar"],
      fitness: {
        sleepQuality: "good",
        energyLevel: "medium",
        recentWorkout: false,
        recoveryNeed: "low",
        activityLoadToday: "low",
      },
    },
  });
  const result = await collectRawSignals({
    userId: "user_test",
    profile,
    snapshot: null,
    providers: mockProviders,
  });
  assert.ok(!result.signals.some((s) => s.source === "calendar"));
  assert.ok(result.signals.some((s) => s.source === "fitness"));
});
