import type {
  PrivacyFilteredBundle,
  PrivacyMetadata,
  RawContextSignal,
} from "@city-wallet/contracts";

const ALLOWED_FIELDS_PER_SOURCE: Record<string, Set<string>> = {
  calendar: new Set([
    "freeWindowMinutes",
    "nextEventInMinutes",
    "nextEventType",
    "dayLoad",
    "hasHardStop",
    "locationHint",
  ]),
  fitness: new Set([
    "sleepQuality",
    "energyLevel",
    "recentWorkout",
    "recoveryNeed",
    "activityLoadToday",
  ]),
  mobility: new Set([
    "movementState",
    "dwellPattern",
    "familiarity",
    "distanceFromHomeKm",
    "distanceFromWorkKm",
  ]),
  mood: new Set(["moodState", "confidence", "basis"]),
  payment_preference: new Set([
    "rewardPreference",
    "priceSensitivity",
    "categoryAffinities",
    "recentCategoryAvoidance",
  ]),
  social: new Set(["socialMode", "groupSize", "nextSocialCommitmentInMinutes"]),
  transit: new Set(["transitState", "departureInMinutes", "delayMinutes"]),
  dietary: new Set(["dietaryHints", "avoidFoodCategories", "preferredFoodStyle"]),
  device_attention: new Set([
    "screenActive",
    "focusMode",
    "batteryLevel",
    "headphonesConnected",
    "notificationTolerance",
  ]),
  local_events: new Set(["nearbyEventType", "eventWindow", "crowdLevel"]),
  location: new Set(["accuracyMeters", "locationMode", "privacyZoneCenter"]),
  active_zone: new Set(["zoneId", "zoneName", "geofenceMatched"]),
  weather: new Set(["weatherMood", "weatherDescription", "temperatureC"]),
  time: new Set(["hour", "daypart", "weekday", "isoTimestamp"]),
  merchant_density: new Set(["nearbyZoneCount", "primaryZoneId"]),
};

const SENSITIVE_KEYS = new Set([
  "title",
  "summary",
  "subject",
  "description",
  "attendeeEmails",
  "attendees",
  "location",
  "name",
  "rawHeartRateBpm",
  "rawSleepDurationMinutes",
  "rawStepsToday",
  "deviceMac",
  "ipAddress",
  "phoneNumber",
  "email",
  "raw",
  "notes",
  "latitude",
  "longitude",
]);

const PRIVACY_SAFE_LATLNG_KEYS = new Set(["privacyZoneCenter"]);

function withheldNote(source: string, key: string): string {
  if (key === "title" || key === "summary" || key === "description") {
    return `${source}: dropped raw text fields`;
  }
  if (key === "latitude" || key === "longitude") {
    return `${source}: dropped exact GPS coordinates`;
  }
  if (key.startsWith("raw")) {
    return `${source}: dropped raw biometric numbers`;
  }
  if (key === "attendees" || key === "attendeeEmails" || key === "phoneNumber" || key === "email") {
    return `${source}: dropped contact-identifying fields`;
  }
  return `${source}: dropped unsupported field ${key}`;
}

export function filterForLLM(signals: RawContextSignal[]): PrivacyFilteredBundle {
  const usedSources = new Set<string>();
  const withheldSensitiveSources = new Set<string>();
  const privacyNotes: string[] = [];

  const filteredSignals = signals.map((signal) => {
    const allowed = ALLOWED_FIELDS_PER_SOURCE[signal.source] ?? new Set<string>();
    const cleanPayload: Record<string, unknown> = {};
    let withheldAnyForThisSource = false;
    for (const [key, value] of Object.entries(signal.payload ?? {})) {
      if (PRIVACY_SAFE_LATLNG_KEYS.has(key) && allowed.has(key)) {
        cleanPayload[key] = value;
        continue;
      }
      if (SENSITIVE_KEYS.has(key) && !allowed.has(key)) {
        withheldAnyForThisSource = true;
        privacyNotes.push(withheldNote(signal.source, key));
        continue;
      }
      if (!allowed.has(key)) {
        privacyNotes.push(withheldNote(signal.source, key));
        continue;
      }
      cleanPayload[key] = value;
    }
    usedSources.add(signal.source);
    if (withheldAnyForThisSource) {
      withheldSensitiveSources.add(signal.source);
    }
    return { ...signal, payload: cleanPayload };
  });

  const metadata: PrivacyMetadata = {
    usedSources: Array.from(usedSources).sort(),
    withheldSensitiveSources: Array.from(withheldSensitiveSources).sort(),
    privacyNotes: Array.from(new Set(privacyNotes)).sort(),
  };

  return { signals: filteredSignals, metadata };
}

export function summarizePrivacy(metadata: PrivacyMetadata): string {
  const used = metadata.usedSources.length ? metadata.usedSources.join(", ") : "no sources";
  const dropped = metadata.withheldSensitiveSources.length
    ? `; sensitive fields dropped from: ${metadata.withheldSensitiveSources.join(", ")}`
    : "";
  return `Used ${used}${dropped}.`;
}
