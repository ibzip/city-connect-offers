import type { TriggerConfig } from "@city-wallet/contracts";

export const triggerConfig: TriggerConfig[] = [
  {
    id: "trg_wallet_opened",
    enabled: true,
    eventType: "WalletOpened",
    condition: { zoneId: "any", source: "consumer_wallet" },
    action: "request_negotiation",
  },
  {
    id: "trg_user_entered_demo_zone",
    enabled: false,
    eventType: "UserEnteredDemoZone",
    condition: { zoneId: "configured_demo_zone" },
    action: "request_negotiation",
  },
  {
    id: "trg_user_entered_zone",
    enabled: true,
    eventType: "UserEnteredZone",
    condition: { zoneId: "any" },
    action: "request_negotiation",
  },
  {
    id: "trg_declared_context_changed",
    enabled: true,
    eventType: "UserDeclaredContextChanged",
    condition: { declaredIntent: "changed" },
    action: "request_negotiation",
  },
  {
    id: "trg_time_context_changed",
    enabled: true,
    eventType: "TimeContextChanged",
    condition: { timeContext: ["lunch_break", "evening", "morning", "afternoon"] },
    action: "request_negotiation",
  },
  {
    id: "trg_weather_context_changed",
    enabled: true,
    eventType: "WeatherContextChanged",
    condition: { weatherMood: ["cold", "rainy", "warm"] },
    action: "request_negotiation",
  },
  {
    id: "trg_signals_changed",
    enabled: true,
    eventType: "UserContextSignalsChanged",
    condition: { source: "raw_context_pipeline" },
    action: "request_negotiation",
  },
  {
    id: "trg_app_returned_to_foreground",
    enabled: true,
    eventType: "AppReturnedToForeground",
    condition: { source: "consumer_wallet" },
    action: "request_negotiation",
  },
  {
    id: "trg_manual_refresh",
    enabled: true,
    eventType: "ManualRefreshRequested",
    condition: { source: "consumer_wallet" },
    action: "request_negotiation",
  },
];
