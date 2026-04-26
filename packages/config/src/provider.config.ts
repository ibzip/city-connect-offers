export const activeProviders = {
  weather: "open_meteo_with_mock_fallback",
  location: "browser_location_with_demo_fallback",
  paymentDensity: "simulated_payone",
  userContext: "declared_context",
  localEvents: "mock_events",
  llm: "mock_llm",
  geocoding: "nominatim_with_cache",
  poiDiscovery: "google_places_primary_overpass_fallback",
  merchantDiscovery: "tavily_enrichment_only",
} as const;

export type ActiveProviders = typeof activeProviders;
