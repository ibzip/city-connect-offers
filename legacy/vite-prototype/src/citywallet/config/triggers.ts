import type { TriggerConfig } from "../types";

export const triggers: TriggerConfig[] = [
  {
    id: "trg_wallet_opened",
    enabled: true,
    eventType: "WalletOpened",
    condition: "User opens wallet inside demo zone",
    action: "request_negotiation",
  },
  {
    id: "trg_zone_entered",
    enabled: true,
    eventType: "UserEnteredDemoZone",
    condition: "User crosses Stuttgart Old Town geofence",
    action: "request_negotiation",
  },
  {
    id: "trg_declared_context",
    enabled: true,
    eventType: "UserDeclaredContextChanged",
    condition: "User updates intent / preferences",
    action: "request_negotiation",
  },
  {
    id: "trg_time_changed",
    enabled: false,
    eventType: "TimeContextChanged",
    condition: "Time crosses lunch / evening boundary",
    action: "request_negotiation",
  },
  {
    id: "trg_weather_changed",
    enabled: false,
    eventType: "WeatherContextChanged",
    condition: "Temperature drops below 14°C or rain starts",
    action: "request_negotiation",
  },
];