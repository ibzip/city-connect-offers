import assert from "node:assert/strict";
import test from "node:test";
import type { RawContextSignal } from "@city-wallet/contracts";
import { filterForLLM } from "./privacy.js";

const sensitiveCalendarSignal: RawContextSignal = {
  signalId: "sig_calendar_test",
  source: "calendar",
  sourceType: "simulated",
  observedAt: new Date().toISOString(),
  confidence: 0.9,
  payload: {
    title: "Therapy session with Dr. Smith",
    summary: "Personal therapy",
    description: "Confidential personal note",
    attendees: ["dr.smith@example.com"],
    attendeeEmails: ["dr.smith@example.com"],
    notes: "Private",
    freeWindowMinutes: 30,
    nextEventInMinutes: 90,
    nextEventType: "personal",
    dayLoad: "moderate",
    hasHardStop: true,
  },
};

const sensitiveLocationSignal: RawContextSignal = {
  signalId: "sig_location_test",
  source: "location",
  sourceType: "real",
  observedAt: new Date().toISOString(),
  confidence: 0.95,
  payload: {
    latitude: 48.13743,
    longitude: 11.57549,
    accuracyMeters: 25,
    locationMode: "real_browser_location",
    privacyZoneCenter: { latitude: 48.137, longitude: 11.575 },
  },
};

const sensitiveFitnessSignal: RawContextSignal = {
  signalId: "sig_fitness_test",
  source: "fitness",
  sourceType: "simulated",
  observedAt: new Date().toISOString(),
  confidence: 0.7,
  payload: {
    rawHeartRateBpm: 142,
    rawSleepDurationMinutes: 380,
    rawStepsToday: 4200,
    deviceMac: "AA:BB:CC:DD:EE:FF",
    sleepQuality: "poor",
    energyLevel: "low",
    recentWorkout: false,
    recoveryNeed: "rest",
    activityLoadToday: "light",
  },
};

test("privacy filter drops raw text fields like calendar title/summary/attendees", () => {
  const { signals, metadata } = filterForLLM([sensitiveCalendarSignal]);
  const calendar = signals.find((s) => s.source === "calendar");
  assert.ok(calendar);
  const payload = calendar.payload as Record<string, unknown>;
  assert.equal(payload.title, undefined);
  assert.equal(payload.summary, undefined);
  assert.equal(payload.description, undefined);
  assert.equal(payload.attendees, undefined);
  assert.equal(payload.attendeeEmails, undefined);
  assert.equal(payload.notes, undefined);
  assert.equal(payload.freeWindowMinutes, 30);
  assert.equal(payload.nextEventType, "personal");
  assert.ok(metadata.withheldSensitiveSources.includes("calendar"));
  assert.ok(metadata.usedSources.includes("calendar"));
  assert.ok(metadata.privacyNotes.some((note) => note.includes("calendar")));
});

test("privacy filter drops exact GPS coordinates but preserves locationMode and privacyZoneCenter", () => {
  const { signals, metadata } = filterForLLM([sensitiveLocationSignal]);
  const location = signals.find((s) => s.source === "location");
  assert.ok(location);
  const payload = location.payload as Record<string, unknown>;
  assert.equal(payload.latitude, undefined);
  assert.equal(payload.longitude, undefined);
  assert.equal(payload.locationMode, "real_browser_location");
  assert.equal(payload.accuracyMeters, 25);
  assert.deepEqual(payload.privacyZoneCenter, { latitude: 48.137, longitude: 11.575 });
  assert.ok(metadata.withheldSensitiveSources.includes("location"));
});

test("privacy filter drops raw biometric numbers but keeps abstracted fitness fields", () => {
  const { signals, metadata } = filterForLLM([sensitiveFitnessSignal]);
  const fitness = signals.find((s) => s.source === "fitness");
  assert.ok(fitness);
  const payload = fitness.payload as Record<string, unknown>;
  assert.equal(payload.rawHeartRateBpm, undefined);
  assert.equal(payload.rawSleepDurationMinutes, undefined);
  assert.equal(payload.rawStepsToday, undefined);
  assert.equal(payload.deviceMac, undefined);
  assert.equal(payload.sleepQuality, "poor");
  assert.equal(payload.energyLevel, "low");
  assert.ok(metadata.withheldSensitiveSources.includes("fitness"));
});

test("privacy filter handles multiple signals and aggregates metadata sorted", () => {
  const { metadata } = filterForLLM([sensitiveCalendarSignal, sensitiveFitnessSignal, sensitiveLocationSignal]);
  assert.deepEqual([...metadata.usedSources].sort(), ["calendar", "fitness", "location"]);
  assert.deepEqual([...metadata.withheldSensitiveSources].sort(), ["calendar", "fitness", "location"]);
  for (let i = 1; i < metadata.privacyNotes.length; i += 1) {
    assert.ok(metadata.privacyNotes[i - 1] <= metadata.privacyNotes[i], "privacy notes should be sorted");
  }
});
