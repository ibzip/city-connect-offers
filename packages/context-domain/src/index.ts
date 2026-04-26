import type { ConsumerContextSnapshot, NormalizedSignal, ProviderBudget } from "@city-wallet/contracts";
import { defaultProviderBudget } from "@city-wallet/contracts";
import type { CityWalletRepository } from "@city-wallet/db";
import { createDefaultProviders } from "@city-wallet/providers";
import type {
  GeocodingProvider,
  LocalEventPayload,
  LocationPayload,
  PaymentDensityProvider,
  UserContextPayload,
  WeatherPayload,
  WeatherProvider,
  LocationProvider,
  UserContextProvider,
  LocalEventsProvider,
  ReverseGeocodeResult,
} from "@city-wallet/providers";
import { makeId, nowIso } from "@city-wallet/utils";

export interface ContextProviders {
  weather: WeatherProvider;
  location: LocationProvider;
  paymentDensity?: PaymentDensityProvider;
  userContext: UserContextProvider;
  localEvents: LocalEventsProvider;
  geocoding?: GeocodingProvider;
}

export interface BuildContextInput {
  userId: string;
  location?: {
    latitude: number;
    longitude: number;
    accuracyMeters?: number;
    source?: "browser" | "demo_geofence";
  };
  providerBudget?: ProviderBudget;
  declaredContext?: {
    intent?: string;
    availableMinutes?: number;
    rewardPreference?: "cashback" | "discount" | "either";
  };
}

export async function collectConfiguredSignals(
  repository: CityWalletRepository,
  input: BuildContextInput,
  providers: ContextProviders = createDefaultProviders(),
) {
  const location = await providers.location.getLocation(input.userId, input.location);
  const lat = location.payload.latitude;
  const lng = location.payload.longitude;
  const matchedZones = lat !== undefined && lng !== undefined && location.payload.mode !== "no_location"
    ? await repository.findZonesContainingPoint(lat, lng)
    : [];
  const fallbackZone = location.payload.mode === "demo_geofence_fallback"
    ? await repository.getZoneById(location.payload.zoneId)
    : null;
  const zone = matchedZones[0] ?? fallbackZone;
  const zoneId = location.payload.mode === "no_location"
    ? "no_location"
    : zone?.id ?? (location.payload.mode === "real_browser_location" ? "outside_activated_city_wallet_area" : location.payload.zoneId);

  // When the user has not granted location yet, skip weather + local-events
  // network calls (they have nothing meaningful to compute on) and surface a
  // declared user context only.
  const noLocation = location.payload.mode === "no_location";
  const [weather, userContext, localEvents] = noLocation
    ? [null, await providers.userContext.getUserContext(input.userId), null] as const
    : await Promise.all([
        providers.weather.getWeather({ latitude: lat, longitude: lng, zoneId, budget: input.providerBudget }),
        providers.userContext.getUserContext(input.userId),
        providers.localEvents.getLocalEvents(zoneId),
      ]);

  let reverseGeocode: ReverseGeocodeResult | null = null;
  if (!noLocation && lat !== undefined && lng !== undefined && providers.geocoding?.reverseGeocode && input.providerBudget) {
    try {
      reverseGeocode = await providers.geocoding.reverseGeocode(
        { latitude: lat, longitude: lng },
        { budget: input.providerBudget, cache: undefined },
      );
    } catch {
      reverseGeocode = null;
    }
  }

  return {
    weather,
    location,
    userContext,
    localEvents,
    matchedZones,
    reverseGeocode,
  };
}

export async function buildConsumerContextSnapshot(
  repository: CityWalletRepository,
  input: BuildContextInput,
  providers: ContextProviders = createDefaultProviders(),
) {
  const budget = input.providerBudget ?? defaultProviderBudget();
  const [profile, previousContext, signals] = await Promise.all([
    repository.getUserProfile(input.userId),
    repository.getCurrentContext(input.userId),
    collectConfiguredSignals(repository, { ...input, providerBudget: budget }, providers),
  ]);

  if (!profile) {
    throw new Error(`Unknown user ${input.userId}`);
  }

  const contextPayload = signals.userContext.payload;
  const firstZone = signals.matchedZones[0];
  const noLocation = signals.location.payload.mode === "no_location";
  const outsideActivatedArea = signals.location.payload.mode === "real_browser_location" && !firstZone;
  const location = signals.location.payload.latitude !== undefined && signals.location.payload.longitude !== undefined
    ? {
        latitude: signals.location.payload.latitude,
        longitude: signals.location.payload.longitude,
        accuracyMeters: signals.location.payload.accuracyMeters,
        source: signals.location.payload.mode === "real_browser_location" ? "browser" as const : "demo_geofence" as const,
      }
    : undefined;

  const reverseGeocode = signals.reverseGeocode;
  const userCityName = reverseGeocode?.city
    ? (reverseGeocode.countryCode ? `${reverseGeocode.city}, ${reverseGeocode.countryCode}` : reverseGeocode.city)
    : null;

  const snapshot: ConsumerContextSnapshot = {
    snapshotId: makeId("ctx"),
    userId: input.userId,
    zoneId: noLocation
      ? "no_location"
      : firstZone?.id ?? (outsideActivatedArea ? "outside_activated_city_wallet_area" : signals.location.payload.zoneId),
    zoneName: noLocation
      ? "Location not granted yet"
      : firstZone?.name ?? (outsideActivatedArea ? "Outside activated City Wallet area" : previousContext?.zoneName),
    userCityName,
    userCountryCode: reverseGeocode?.countryCode ?? null,
    matchedZones: signals.matchedZones,
    userLocation: location,
    locationMode: signals.location.payload.mode,
    geofenceMatched: signals.matchedZones.length > 0,
    weatherMood: signals.weather?.payload.mood ?? "unknown",
    weatherDescription: signals.weather?.payload.description ?? "Awaiting location",
    weatherSource: signals.weather?.payload.provider ?? "mock_weather_fallback",
    weatherTemperatureC: signals.weather?.payload.temperatureC,
    timeContext: deriveTimeContext(new Date()),
    declaredIntent: input.declaredContext?.intent ?? contextPayload.declaredIntent,
    availableMinutes: input.declaredContext?.availableMinutes ?? contextPayload.availableMinutes,
    rewardPreference: input.declaredContext?.rewardPreference ?? contextPayload.rewardPreference,
    privacyMode: profile.privacyMode,
    walkingToleranceMeters: profile.walkingToleranceMeters,
    maxBundleStops: profile.maxBundleStops,
    maxOffersPerHour: profile.maxOffersPerHour,
    normalizedSignals: normalizeSignalsForStorage(signals),
    providerBudget: budget,
    providerFallbacks: budget.fallbackEvents,
    createdAt: nowIso(),
  };

  const normalized = normalizeContextForPrivacy(snapshot);
  await repository.saveConsumerContext(normalized);
  return normalized;
}

export function normalizeContextForPrivacy(snapshot: ConsumerContextSnapshot): ConsumerContextSnapshot {
  return {
    ...snapshot,
    normalizedSignals: snapshot.normalizedSignals.map((signal) => ({
      signalId: signal.signalId,
      source: signal.source,
      sourceType: signal.sourceType,
      observedAt: signal.observedAt,
      confidence: signal.confidence,
      payload: signal.payload,
    })),
  };
}

function normalizeSignalsForStorage(signals: {
  weather: NormalizedSignal<WeatherPayload> | null;
  location: NormalizedSignal<LocationPayload>;
  userContext: NormalizedSignal<UserContextPayload>;
  localEvents: NormalizedSignal<LocalEventPayload[]> | null;
  matchedZones: unknown[];
}) {
  return [
    signals.location,
    ...(signals.weather ? [signals.weather] : []),
    signals.userContext,
    ...(signals.localEvents ? [signals.localEvents] : []),
    {
      signalId: makeId("sig_geofence"),
      source: "commerce_zone_repository",
      sourceType: "hybrid",
      observedAt: nowIso(),
      confidence: signals.matchedZones.length > 0 ? 0.95 : 0.5,
      payload: {
        matchedZones: signals.matchedZones,
      },
    },
  ] as unknown as Record<string, unknown>[];
}

function deriveTimeContext(date: Date) {
  const hour = date.getHours();
  if (hour >= 11 && hour <= 14) return "lunch_break";
  if (hour >= 17 && hour <= 21) return "evening";
  if (hour >= 7 && hour <= 10) return "morning";
  return "city_time";
}
