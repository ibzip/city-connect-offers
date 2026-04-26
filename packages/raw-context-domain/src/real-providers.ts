import type { RawContextSignal } from "@city-wallet/contracts";
import { makeId, nowIso } from "@city-wallet/utils";

import type { RawContextProvider } from "./types.js";

export const locationProvider: RawContextProvider = {
  source: "location",
  async read({ snapshot }) {
    if (!snapshot?.userLocation) return null;
    const { latitude, longitude, accuracyMeters, source } = snapshot.userLocation;
    const isReal = source === "browser";
    return {
      signalId: makeId("sig_location"),
      source: "location",
      sourceType: isReal ? "real" : "fallback",
      observedAt: nowIso(),
      confidence: isReal ? 0.9 : 0.4,
      payload: {
        latitude,
        longitude,
        accuracyMeters,
        locationMode: snapshot.locationMode,
        privacyZoneCenter: snapshot.matchedZones?.[0]
          ? {
              latitude: snapshot.matchedZones[0].centerLat,
              longitude: snapshot.matchedZones[0].centerLng,
              radiusMeters: snapshot.matchedZones[0].radiusMeters,
            }
          : undefined,
      },
    };
  },
};

export const activeZoneProvider: RawContextProvider = {
  source: "active_zone",
  async read({ snapshot }) {
    if (!snapshot) return null;
    return {
      signalId: makeId("sig_active_zone"),
      source: "active_zone",
      sourceType: "real",
      observedAt: nowIso(),
      confidence: snapshot.geofenceMatched ? 0.95 : 0.5,
      payload: {
        zoneId: snapshot.zoneId,
        zoneName: snapshot.zoneName,
        geofenceMatched: snapshot.geofenceMatched,
      },
    };
  },
};

export const weatherProvider: RawContextProvider = {
  source: "weather",
  async read({ snapshot }) {
    if (!snapshot) return null;
    const isReal = snapshot.weatherSource === "live_weather";
    return {
      signalId: makeId("sig_weather"),
      source: "weather",
      sourceType: isReal ? "real" : "fallback",
      observedAt: nowIso(),
      confidence: isReal ? 0.85 : 0.4,
      payload: {
        weatherMood: snapshot.weatherMood,
        weatherDescription: snapshot.weatherDescription,
        temperatureC: snapshot.weatherTemperatureC,
      },
    };
  },
};

export const timeProvider: RawContextProvider = {
  source: "time",
  async read() {
    const now = new Date();
    const hour = now.getHours();
    let daypart: "early_morning" | "morning" | "midday" | "afternoon" | "evening" | "late_evening" | "night";
    if (hour < 6) daypart = "night";
    else if (hour < 9) daypart = "early_morning";
    else if (hour < 12) daypart = "morning";
    else if (hour < 14) daypart = "midday";
    else if (hour < 17) daypart = "afternoon";
    else if (hour < 21) daypart = "evening";
    else daypart = "late_evening";
    const result: RawContextSignal = {
      signalId: makeId("sig_time"),
      source: "time",
      sourceType: "real",
      observedAt: nowIso(),
      confidence: 1,
      payload: {
        hour,
        daypart,
        weekday: ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][now.getDay()] ?? "unknown",
        isoTimestamp: now.toISOString(),
      },
    };
    return result;
  },
};

export const merchantDensityProvider: RawContextProvider = {
  source: "merchant_density",
  async read({ snapshot }) {
    const count = snapshot?.matchedZones?.length ?? 0;
    return {
      signalId: makeId("sig_merchant_density"),
      source: "merchant_density",
      sourceType: "real",
      observedAt: nowIso(),
      confidence: 0.6,
      payload: {
        nearbyZoneCount: count,
        primaryZoneId: snapshot?.zoneId,
      },
    };
  },
};

export const realProviders = [
  locationProvider,
  activeZoneProvider,
  weatherProvider,
  timeProvider,
  merchantDensityProvider,
];
