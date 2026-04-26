import type { SupportedMerchantCategory } from "@city-wallet/contracts";

export const discoveryConfig = {
  defaultCityImportRadiusMeters: 20_000,
  absoluteMaxRadiusMeters: 25_000,
  defaultMaxImportedMerchants: 1_000,
  absoluteMaxImportedMerchants: 1_500,
  defaultMaxTilesPerRun: 25,
  absoluteMaxTilesPerRun: 50,
  googlePlacesDefaultMaxRequestsPerImport: 1_000,
  googlePlacesAbsoluteMaxRequestsPerImport: 1_500,
  localImportRuntimeBudgetMs: 180_000,
  lambdaImportRuntimeBudgetMs: 15_000,
  largeAreaTileThresholdMeters: 3_000,
  tileSizeMeters: 2_500,
  overpassTimeoutMs: 4_000,
  perTileCategoryResultLimit: 50,
  walletExpansionRadiiMeters: [250, 500, 1_000, 2_000],
  defaultCategories: [
    "cafe",
    "bakery",
    "restaurant",
    "bookshop",
    "flower_shop",
    "museum",
    "gallery",
    "gift_shop",
    "local_retail",
    "stationery",
    "clothing",
    "grocery",
  ] satisfies SupportedMerchantCategory[],
  defaultCategoryCaps: {
    cafe: 180,
    bakery: 130,
    restaurant: 180,
    bookshop: 90,
    flower_shop: 80,
    museum: 80,
    gallery: 70,
    gift_shop: 90,
    local_retail: 120,
    stationery: 70,
    clothing: 120,
    grocery: 110,
  } satisfies Record<SupportedMerchantCategory, number>,
  osmTagQueries: {
    cafe: [{ key: "amenity", value: "cafe" }],
    bakery: [{ key: "shop", value: "bakery" }],
    restaurant: [
      { key: "amenity", value: "restaurant" },
      { key: "amenity", value: "fast_food" },
    ],
    bookshop: [{ key: "shop", value: "books" }],
    flower_shop: [{ key: "shop", value: "florist" }],
    museum: [{ key: "tourism", value: "museum" }],
    gallery: [{ key: "tourism", value: "gallery" }],
    gift_shop: [{ key: "shop", value: "gift" }],
    local_retail: [{ key: "shop", value: "yes" }],
    stationery: [{ key: "shop", value: "stationery" }],
    clothing: [{ key: "shop", value: "clothes" }],
    grocery: [{ key: "shop", value: "convenience" }],
  } satisfies Record<SupportedMerchantCategory, Array<{ key: string; value: string }>>,
} as const;

export type CityImportPoiProvider = "overpass" | "google_places";

export const googlePlacesImportFieldMask = [
  "places.id",
  "places.displayName",
  "places.location",
  "places.primaryType",
  "places.types",
  "places.formattedAddress",
].join(",");

export function isWalletLiveDiscoveryFallbackEnabled() {
  return process.env.ENABLE_WALLET_LIVE_DISCOVERY_FALLBACK === "true";
}

export function getCityImportPoiProvider(): CityImportPoiProvider {
  if (process.env.CITY_IMPORT_POI_PROVIDER === "overpass") return "overpass";
  if (process.env.GOOGLE_PLACES_API_KEY) return "google_places";
  return "overpass";
}

export function getCityImportProviderWarnings() {
  if (getCityImportPoiProvider() === "google_places") {
    return [
      "Using Google Places API as the primary coordinate-bearing merchant import provider.",
      "Place Details calls are disabled for cost control.",
      `Google Places field mask: ${googlePlacesImportFieldMask}`,
    ];
  }
  const warnings = [
    "Overpass is a public, rate-limited OSM service. Large imports may pause and require continuation.",
    "Nominatim is used only for city center geocoding and cached lookups.",
  ];
  if (process.env.CITY_IMPORT_POI_PROVIDER === "google_places" && !process.env.GOOGLE_PLACES_API_KEY) {
    warnings.unshift("CITY_IMPORT_POI_PROVIDER=google_places was requested, but GOOGLE_PLACES_API_KEY is missing. Falling back to Overpass.");
  }
  return warnings;
}

export function getDefaultCityImportRadiusMeters() {
  return clampPositiveInteger(
    Number(process.env.GOOGLE_PLACES_DEFAULT_RADIUS_METERS ?? discoveryConfig.defaultCityImportRadiusMeters),
    discoveryConfig.defaultCityImportRadiusMeters,
    discoveryConfig.absoluteMaxRadiusMeters,
  );
}

export function getGooglePlacesMaxRequestsPerImport() {
  return clampPositiveInteger(
    Number(process.env.GOOGLE_PLACES_MAX_REQUESTS_PER_IMPORT ?? discoveryConfig.googlePlacesDefaultMaxRequestsPerImport),
    discoveryConfig.googlePlacesDefaultMaxRequestsPerImport,
    discoveryConfig.googlePlacesAbsoluteMaxRequestsPerImport,
  );
}

export function getGooglePlacesMaxImportedMerchants() {
  return clampPositiveInteger(
    Number(process.env.GOOGLE_PLACES_MAX_IMPORTED_MERCHANTS ?? discoveryConfig.defaultMaxImportedMerchants),
    discoveryConfig.defaultMaxImportedMerchants,
    discoveryConfig.absoluteMaxImportedMerchants,
  );
}

export function isOverpassImportFallbackEnabled() {
  return process.env.ENABLE_OVERPASS_IMPORT_FALLBACK !== "false";
}

export function getCityImportRuntimeBudgetMs() {
  const fallback = process.env.AWS_LAMBDA_FUNCTION_NAME
    ? discoveryConfig.lambdaImportRuntimeBudgetMs
    : discoveryConfig.localImportRuntimeBudgetMs;
  return clampPositiveInteger(Number(process.env.CITY_IMPORT_RUNTIME_BUDGET_MS ?? fallback), fallback, 15 * 60_000);
}

function clampPositiveInteger(value: number, fallback: number, maximum: number) {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), maximum);
}
