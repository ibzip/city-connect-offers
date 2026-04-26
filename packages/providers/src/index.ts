import type { GeoPoint, NormalizedSignal, PaymentDensitySignal, ProviderBudget } from "@city-wallet/contracts";
import { googlePlacesImportFieldMask } from "@city-wallet/config";
import { seededConsumerContext, seededPaymentDensitySignals } from "@city-wallet/data-seed";
import { calculateDistanceMeters, makeId, nowIso, roundCoordinate, stableHash, withTimeout } from "@city-wallet/utils";

export interface WeatherPayload {
  mood: string;
  description: string;
  temperatureC?: number;
  provider: "live_weather" | "mock_weather_fallback";
  fallbackUsed?: boolean;
}

export interface LocationPayload {
  zoneId: string;
  distanceMeters?: number;
  latitude?: number;
  longitude?: number;
  accuracyMeters?: number;
  mode: "real_browser_location" | "demo_geofence_fallback";
}

export interface UserContextPayload {
  declaredIntent: string;
  availableMinutes: number;
  rewardPreference: "cashback" | "discount" | "either";
}

export interface LocalEventPayload {
  eventType: string;
  label: string;
}

export interface PoiBusiness {
  externalId: string;
  name: string;
  category: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  source: "overpass" | "osm_overpass" | "google_places" | "tavily" | "osm";
  sourceUrl?: string;
  confidence: number;
}

export interface WeatherProvider {
  getWeather(input: { latitude?: number; longitude?: number; zoneId?: string; budget?: ProviderBudget }): Promise<NormalizedSignal<WeatherPayload>>;
}

export interface LocationProvider {
  getLocation(userId: string, input?: { latitude?: number; longitude?: number; accuracyMeters?: number; source?: "browser" | "demo_geofence" }): Promise<NormalizedSignal<LocationPayload>>;
}

export interface PaymentDensityProvider {
  getPaymentDensity(): Promise<NormalizedSignal<PaymentDensitySignal[]>>;
}

export interface UserContextProvider {
  getUserContext(userId: string): Promise<NormalizedSignal<UserContextPayload>>;
}

export interface LocalEventsProvider {
  getLocalEvents(zoneId: string): Promise<NormalizedSignal<LocalEventPayload[]>>;
}

export interface GeocodingCache {
  get(provider: string, query: string): Promise<{ result: GeoPoint | null; status: string; updatedAt?: string } | null>;
  set(provider: string, query: string, result: GeoPoint | null, status: string): Promise<void>;
}

export interface GeocodingProvider {
  geocode(query: string, options: { budget: ProviderBudget; cache?: GeocodingCache }): Promise<GeoPoint | null>;
}

export interface POIProvider {
  findNearbyBusinesses(input: { latitude: number; longitude: number; radiusMeters: number; categories: string[]; budget: ProviderBudget; cache?: PoiCache }): Promise<PoiBusiness[]>;
}

export interface PoiCache {
  get(provider: string, cacheKey: string): Promise<{ result: unknown; expiresAt: string } | null>;
  set(provider: string, cacheKey: string, result: unknown, expiresAt: string): Promise<void>;
}

export interface MerchantDiscoveryProvider {
  enrichNearbyBusinesses(input: { latitude: number; longitude: number; query: string; budget: ProviderBudget }): Promise<PoiBusiness[]>;
}

function signal<TPayload>(
  source: string,
  payload: TPayload,
  sourceType: "real" | "simulated" | "hybrid" = "simulated",
  confidence = 0.9,
): NormalizedSignal<TPayload> {
  return {
    signalId: makeId(`sig_${source}`),
    source,
    sourceType,
    observedAt: nowIso(),
    confidence,
    payload,
  };
}

function recordFallback(budget: ProviderBudget | undefined, provider: string, reason: string) {
  budget?.fallbackEvents.push({
    provider,
    reason,
    fallbackUsed: true,
    occurredAt: nowIso(),
  });
}

function consumeBudget(budget: ProviderBudget | undefined, key: keyof Pick<ProviderBudget, "openMeteoRequestsRemaining" | "overpassRequestsRemaining" | "nominatimAttemptsRemaining" | "tavilyRequestsRemaining">) {
  if (!budget) return true;
  if (budget[key] <= 0) return false;
  budget[key] -= 1;
  return true;
}

export class MockWeatherProvider implements WeatherProvider {
  async getWeather(_input?: { latitude?: number; longitude?: number; zoneId?: string; budget?: ProviderBudget }) {
    return signal("mock_weather", {
      mood: seededConsumerContext.weatherMood,
      description: seededConsumerContext.weatherDescription,
      temperatureC: seededConsumerContext.weatherTemperatureC,
      provider: "mock_weather_fallback" as const,
      fallbackUsed: true,
    });
  }
}

export class OpenMeteoWeatherProvider implements WeatherProvider {
  constructor(private readonly fallback = new MockWeatherProvider()) {}

  async getWeather(input: { latitude?: number; longitude?: number; zoneId?: string; budget?: ProviderBudget }) {
    if (input.latitude === undefined || input.longitude === undefined) {
      recordFallback(input.budget, "open_meteo", "missing_coordinates");
      return this.fallback.getWeather(input);
    }
    if (!consumeBudget(input.budget, "openMeteoRequestsRemaining")) {
      recordFallback(input.budget, "open_meteo", "provider_budget_exceeded");
      return this.fallback.getWeather(input);
    }

    try {
      const url = new URL("https://api.open-meteo.com/v1/forecast");
      url.searchParams.set("latitude", String(input.latitude));
      url.searchParams.set("longitude", String(input.longitude));
      url.searchParams.set("current", "temperature_2m,weather_code");
      url.searchParams.set("timezone", "auto");
      const response = await withTimeout(fetch(url), 3_000, "Open-Meteo request");
      if (!response.ok) throw new Error(`Open-Meteo ${response.status}`);
      const body = await response.json() as { current?: { temperature_2m?: number; weather_code?: number } };
      const temperature = body.current?.temperature_2m;
      const condition = weatherCodeToDescription(body.current?.weather_code);
      return signal("open_meteo", {
        mood: weatherToMood(temperature, condition),
        description: `${temperature !== undefined ? `${Math.round(temperature)}°C` : "Current"} and ${condition}`,
        temperatureC: temperature,
        provider: "live_weather" as const,
        fallbackUsed: false,
      }, "real", 0.92);
    } catch (error) {
      recordFallback(input.budget, "open_meteo", error instanceof Error ? error.message : "open_meteo_failed");
      return this.fallback.getWeather(input);
    }
  }
}

export class DemoGeofenceProvider implements LocationProvider {
  async getLocation(_userId?: string) {
    return signal("demo_geofence", {
      zoneId: seededConsumerContext.zoneId,
      distanceMeters: 0,
      latitude: seededConsumerContext.userLocation?.latitude,
      longitude: seededConsumerContext.userLocation?.longitude,
      mode: "demo_geofence_fallback" as const,
    });
  }
}

export class BrowserLocationInputProvider implements LocationProvider {
  constructor(private readonly fallback = new DemoGeofenceProvider()) {}

  async getLocation(userId: string, input?: { latitude?: number; longitude?: number; accuracyMeters?: number; source?: "browser" | "demo_geofence" }) {
    if (input?.latitude === undefined || input.longitude === undefined) {
      return this.fallback.getLocation(userId);
    }
    return signal("browser_location", {
      zoneId: "outside_activated_city_wallet_area",
      latitude: input.latitude,
      longitude: input.longitude,
      accuracyMeters: input.accuracyMeters,
      mode: "real_browser_location" as const,
    }, "real", 0.95);
  }
}

export class SimulatedPayoneProvider implements PaymentDensityProvider {
  async getPaymentDensity() {
    return signal("simulated_payone", seededPaymentDensitySignals);
  }
}

export class RealPayoneProvider implements PaymentDensityProvider {
  async getPaymentDensity() {
    return signal("real_payone_placeholder", [], "hybrid", 0.1);
  }
}

export class DeclaredUserContextProvider implements UserContextProvider {
  async getUserContext() {
    return signal("declared_context", {
      declaredIntent: seededConsumerContext.declaredIntent,
      availableMinutes: seededConsumerContext.availableMinutes,
      rewardPreference: seededConsumerContext.rewardPreference,
    });
  }
}

export class MockLocalEventsProvider implements LocalEventsProvider {
  async getLocalEvents(zoneId: string) {
    return signal("mock_events", [
      {
        eventType: "quiet_lunch_window",
        label: `Quiet local-commerce window in ${zoneId}`,
      },
    ]);
  }
}

export class OpenStreetMapNominatimGeocodingProvider implements GeocodingProvider {
  private lastCallAt = 0;

  async geocode(query: string, options: { budget: ProviderBudget; cache?: GeocodingCache }) {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return null;

    const cached = await options.cache?.get("nominatim", normalizedQuery);
    if (cached && shouldUseCachedGeocode(cached)) return cached.result;

    if (!consumeBudget(options.budget, "nominatimAttemptsRemaining")) {
      recordFallback(options.budget, "nominatim", "provider_budget_exceeded");
      await options.cache?.set("nominatim", normalizedQuery, null, "budget_exceeded");
      return null;
    }

    const minIntervalMs = 1_100;
    const waitMs = Math.max(0, this.lastCallAt + minIntervalMs - Date.now());
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    this.lastCallAt = Date.now();

    try {
      const url = new URL("https://nominatim.openstreetmap.org/search");
      url.searchParams.set("q", query);
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("limit", "1");
      const response = await withTimeout(fetch(url, {
        headers: {
          "user-agent": process.env.NOMINATIM_USER_AGENT || "CityWalletHackathonMVP/0.1 local-dev",
          "accept": "application/json",
        },
      }), 3_000, "Nominatim request");
      if (!response.ok) throw new Error(`Nominatim ${response.status}`);
      const rows = await response.json() as Array<{ lat?: string; lon?: string }>;
      const first = rows[0];
      const result = first?.lat && first.lon
        ? { latitude: Number(first.lat), longitude: Number(first.lon) }
        : null;
      await options.cache?.set("nominatim", normalizedQuery, result, result ? "hit" : "not_found");
      return result;
    } catch (error) {
      recordFallback(options.budget, "nominatim", error instanceof Error ? error.message : "nominatim_failed");
      await options.cache?.set("nominatim", normalizedQuery, null, "failed");
      return null;
    }
  }
}

function shouldUseCachedGeocode(cached: { result: GeoPoint | null; status: string; updatedAt?: string }) {
  if (cached.status === "hit" || cached.status === "not_found") return true;
  const updatedAt = cached.updatedAt ? Date.parse(cached.updatedAt) || Number(cached.updatedAt) : 0;
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return false;
  return Date.now() - updatedAt < 15 * 60 * 1000;
}

export class GoogleGeocodingProvider {
  async geocode() {
    return null;
  }
}

export class MapboxGeocodingProvider {
  async geocode() {
    return null;
  }
}

export class OpenStreetMapOverpassPOIProvider implements POIProvider {
  async findNearbyBusinesses(input: { latitude: number; longitude: number; radiusMeters: number; categories: string[]; budget: ProviderBudget; cache?: PoiCache }) {
    const radiusMeters = Math.min(350, Math.max(100, input.radiusMeters));
    const cacheKey = [
      roundCoordinate(input.latitude, 3),
      roundCoordinate(input.longitude, 3),
      radiusMeters,
      input.categories.slice().sort().join(","),
      Math.floor(Date.now() / (30 * 60 * 1000)),
    ].join(":");
    const cached = await input.cache?.get("overpass", cacheKey);
    if (cached) return cached.result as PoiBusiness[];

    if (!consumeBudget(input.budget, "overpassRequestsRemaining")) {
      recordFallback(input.budget, "overpass", "provider_budget_exceeded");
      return [];
    }

    try {
      const amenityFilters = ["cafe", "restaurant", "bar", "fast_food"].map((value) => `node["amenity"="${value}"](around:${radiusMeters},${input.latitude},${input.longitude});`).join("");
      const shopFilters = ["books", "florist", "bakery", "gift"].map((value) => `node["shop"="${value}"](around:${radiusMeters},${input.latitude},${input.longitude});`).join("");
      const query = `[out:json][timeout:4];(${amenityFilters}${shopFilters});out center ${20};`;
      const response = await withTimeout(fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "accept": "application/json",
          "user-agent": process.env.OVERPASS_USER_AGENT || process.env.NOMINATIM_USER_AGENT || "CityWalletHackathonMVP/0.1 local-dev",
        },
        body: new URLSearchParams({ data: query }),
      }), 4_000, "Overpass request");
      if (!response.ok) throw new Error(`Overpass ${response.status}`);
      const body = await response.json() as { elements?: Array<{ id: number; lat?: number; lon?: number; tags?: Record<string, string> }> };
      const pois = (body.elements ?? []).slice(0, 20).map((element): PoiBusiness | null => {
        const name = element.tags?.name;
        if (!name || element.lat === undefined || element.lon === undefined) return null;
        return {
          externalId: `overpass_${element.id}`,
          name,
          category: osmTagsToCategory(element.tags ?? {}),
          address: formatOsmAddress(element.tags ?? {}),
          latitude: element.lat,
          longitude: element.lon,
          source: "overpass",
          confidence: 0.74,
        };
      }).filter((poi): poi is PoiBusiness => Boolean(poi));
      await input.cache?.set("overpass", cacheKey, pois, new Date(Date.now() + 30 * 60 * 1000).toISOString());
      return pois;
    } catch (error) {
      recordFallback(input.budget, "overpass", error instanceof Error ? error.message : "overpass_failed");
      return [];
    }
  }
}

export class TavilyMerchantDiscoveryProvider implements MerchantDiscoveryProvider {
  async enrichNearbyBusinesses(input: { latitude: number; longitude: number; query: string; budget: ProviderBudget }) {
    if (!process.env.TAVILY_API_KEY) {
      recordFallback(input.budget, "tavily", "missing_api_key");
      return [];
    }
    if (!consumeBudget(input.budget, "tavilyRequestsRemaining")) {
      recordFallback(input.budget, "tavily", "provider_budget_exceeded");
      return [];
    }

    try {
      const response = await withTimeout(fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "authorization": `Bearer ${process.env.TAVILY_API_KEY}`,
        },
        body: JSON.stringify({
          api_key: process.env.TAVILY_API_KEY,
          query: `${input.query} nearby businesses ${input.latitude},${input.longitude}`,
          max_results: 5,
          search_depth: "basic",
        }),
      }), 4_000, "Tavily request");
      if (!response.ok) throw new Error(`Tavily ${response.status}`);
      const body = await response.json() as { results?: Array<{ title?: string; url?: string; content?: string }> };
      return (body.results ?? []).map((result): PoiBusiness | null => {
        const name = cleanBusinessName(result.title);
        if (!name) return null;
        return {
          externalId: `tavily_${stableHash(`${name}:${result.url ?? ""}`).slice(0, 12)}`,
          name,
          category: guessCategory(`${result.title ?? ""} ${result.content ?? ""}`),
          address: extractAddressText(result.content ?? ""),
          source: "tavily",
          sourceUrl: result.url,
          confidence: 0.55,
        };
      }).filter((item): item is PoiBusiness => Boolean(item));
    } catch (error) {
      recordFallback(input.budget, "tavily", error instanceof Error ? error.message : "tavily_failed");
      return [];
    }
  }
}

function googlePlaceTypesForCategories(categories: string[]) {
  const typeMap: Record<string, string[]> = {
    cafe: ["cafe", "coffee_shop"],
    bakery: ["bakery"],
    restaurant: ["restaurant"],
    bookshop: ["book_store"],
    flower_shop: ["florist"],
    museum: ["museum"],
    gallery: ["art_gallery"],
    gift_shop: ["gift_shop"],
    local_retail: ["store"],
    stationery: ["store"],
    clothing: ["clothing_store"],
    grocery: ["grocery_store", "supermarket", "convenience_store", "food_store"],
  };
  const types = categories.flatMap((category) => typeMap[category] ?? []);
  return [...new Set(types)].slice(0, 50);
}

function googleTypesToCategory(types: string[]) {
  if (types.some((type) => ["cafe", "coffee_shop"].includes(type))) return "cafe";
  if (types.includes("bakery")) return "bakery";
  if (types.some((type) => type.includes("restaurant") || ["food", "meal_takeaway", "meal_delivery"].includes(type))) return "restaurant";
  if (types.includes("book_store")) return "bookshop";
  if (types.includes("florist")) return "flower_shop";
  if (types.includes("museum")) return "museum";
  if (types.includes("art_gallery")) return "gallery";
  if (types.includes("gift_shop")) return "gift_shop";
  if (types.some((type) => ["clothing_store", "shoe_store", "sportswear_store", "womens_clothing_store"].includes(type))) return "clothing";
  if (types.some((type) => ["grocery_store", "supermarket", "convenience_store", "food_store"].includes(type))) return "grocery";
  return "local_retail";
}

export class GooglePlacesPOIProvider implements POIProvider {
  async findNearbyBusinesses(input: { latitude: number; longitude: number; radiusMeters: number; categories: string[]; budget: ProviderBudget; cache?: PoiCache }) {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      recordFallback(input.budget, "google_places", "google_places_api_key_missing");
      return [];
    }
    const radiusMeters = Math.min(2_000, Math.max(100, input.radiusMeters));
    const includedTypes = googlePlaceTypesForCategories(input.categories);
    const cacheKey = [
      roundCoordinate(input.latitude, 3),
      roundCoordinate(input.longitude, 3),
      radiusMeters,
      includedTypes.slice().sort().join(","),
      Math.floor(Date.now() / (30 * 60 * 1000)),
    ].join(":");
    const cached = await input.cache?.get("google_places", cacheKey);
    if (cached) return cached.result as PoiBusiness[];

    if (!consumeBudget(input.budget, "overpassRequestsRemaining")) {
      recordFallback(input.budget, "google_places", "provider_budget_exceeded");
      return [];
    }

    try {
      const response = await withTimeout(fetch("https://places.googleapis.com/v1/places:searchNearby", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "accept": "application/json",
          "x-goog-api-key": apiKey,
          "x-goog-fieldmask": googlePlacesImportFieldMask,
        },
        body: JSON.stringify({
          includedTypes,
          maxResultCount: 20,
          rankPreference: "DISTANCE",
          locationRestriction: {
            circle: {
              center: { latitude: input.latitude, longitude: input.longitude },
              radius: radiusMeters,
            },
          },
        }),
      }), Number(process.env.GOOGLE_PLACES_TIMEOUT_MS ?? 6_000), "Google Places request");
      if (!response.ok) throw new Error(`Google Places ${response.status}`);
      const body = await response.json() as {
        places?: Array<{
          id?: string;
          displayName?: { text?: string };
          formattedAddress?: string;
          location?: { latitude?: number; longitude?: number };
          primaryType?: string;
          types?: string[];
        }>;
      };
      const pois = (body.places ?? []).map((place): PoiBusiness | null => {
        const name = place.displayName?.text;
        const latitude = place.location?.latitude;
        const longitude = place.location?.longitude;
        if (!place.id || !name || latitude === undefined || longitude === undefined) return null;
        return {
          externalId: place.id,
          name,
          category: googleTypesToCategory([place.primaryType, ...(place.types ?? [])].filter((type): type is string => Boolean(type))),
          address: place.formattedAddress,
          latitude,
          longitude,
          source: "google_places",
          sourceUrl: `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}&query_place_id=${encodeURIComponent(place.id)}`,
          confidence: 0.9,
        };
      }).filter((poi): poi is PoiBusiness => Boolean(poi));
      await input.cache?.set("google_places", cacheKey, pois, new Date(Date.now() + 30 * 60 * 1000).toISOString());
      return pois;
    } catch (error) {
      recordFallback(input.budget, "google_places", error instanceof Error ? error.message : "google_places_failed");
      return [];
    }
  }
}

export function createDefaultProviders() {
  return {
    weather: new OpenMeteoWeatherProvider(),
    location: new BrowserLocationInputProvider(),
    paymentDensity: new SimulatedPayoneProvider(),
    userContext: new DeclaredUserContextProvider(),
    localEvents: new MockLocalEventsProvider(),
    geocoding: new OpenStreetMapNominatimGeocodingProvider(),
    poi: process.env.GOOGLE_PLACES_API_KEY ? new GooglePlacesPOIProvider() : new OpenStreetMapOverpassPOIProvider(),
    merchantDiscovery: new TavilyMerchantDiscoveryProvider(),
  };
}

function weatherCodeToDescription(code: number | undefined) {
  if (code === undefined) return "overcast";
  if ([0].includes(code)) return "clear";
  if ([1, 2, 3].includes(code)) return "overcast";
  if ([45, 48].includes(code)) return "foggy";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rainy";
  if (code >= 71 && code <= 77) return "snowy";
  if (code >= 95) return "stormy";
  return "overcast";
}

function weatherToMood(temperature: number | undefined, condition: string) {
  if (condition.includes("rain") || condition.includes("snow")) return "cold";
  if (temperature !== undefined && temperature <= 13) return "cold";
  if (temperature !== undefined && temperature >= 24) return "warm";
  return "mild";
}

function osmTagsToCategory(tags: Record<string, string>) {
  if (tags.amenity === "cafe") return "cafe";
  if (tags.amenity === "restaurant") return "restaurant";
  if (tags.shop === "books") return "bookshop";
  if (tags.shop === "florist") return "flower_shop";
  if (tags.shop === "bakery") return "bakery";
  if (tags.tourism === "museum") return "museum";
  return tags.shop ?? tags.amenity ?? "local_business";
}

function formatOsmAddress(tags: Record<string, string>) {
  const street = [tags["addr:street"], tags["addr:housenumber"]].filter(Boolean).join(" ");
  const city = tags["addr:city"];
  return [street, city].filter(Boolean).join(", ") || undefined;
}

function cleanBusinessName(title?: string) {
  return title?.replace(/\s+[-|].*$/, "").trim();
}

function guessCategory(text: string) {
  const lower = text.toLowerCase();
  if (lower.includes("cafe") || lower.includes("coffee")) return "cafe";
  if (lower.includes("book")) return "bookshop";
  if (lower.includes("bakery") || lower.includes("bread")) return "bakery";
  if (lower.includes("restaurant") || lower.includes("lunch")) return "restaurant";
  if (lower.includes("flower") || lower.includes("florist")) return "flower_shop";
  if (lower.includes("museum") || lower.includes("gallery")) return "museum";
  return "local_business";
}

function extractAddressText(content: string) {
  const match = content.match(/([A-ZÄÖÜ][^.,;]{3,80}\s(?:Straße|Str\.|Platz|Gasse|Allee|Road|Street)[^.,;]{0,80})/);
  return match?.[1]?.trim();
}

export function distanceFromUser(input: { user?: GeoPoint; merchant?: { latitude?: number; longitude?: number }; fallbackMeters: number }) {
  if (input.user && input.merchant?.latitude !== undefined && input.merchant.longitude !== undefined) {
    return {
      distanceMeters: calculateDistanceMeters(input.user.latitude, input.user.longitude, input.merchant.latitude, input.merchant.longitude),
      calculatedFromCoordinates: true,
    };
  }
  return { distanceMeters: input.fallbackMeters, calculatedFromCoordinates: false };
}
