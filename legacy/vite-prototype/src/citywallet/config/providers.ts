import type { ActiveProviders } from "../types";

export const activeProviders: ActiveProviders = {
  weather: "mock_open_meteo",
  location: "demo_geofence",
  paymentDensity: "simulated_payone",
  userContext: "declared_context",
  localEvents: "mock_events",
};

export const providerLabels: Record<string, { label: string; real: boolean }> = {
  mock_open_meteo: { label: "Open-Meteo (mock)", real: false },
  live_open_meteo: { label: "Open-Meteo (live)", real: true },
  demo_geofence: { label: "Demo geofence", real: false },
  browser_geolocation: { label: "Browser geolocation", real: true },
  simulated_payone: { label: "Payone (simulated)", real: false },
  live_payone: { label: "Payone (live)", real: true },
  declared_context: { label: "User declared", real: true },
  mock_events: { label: "Local events (mock)", real: false },
};