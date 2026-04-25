import type { TriggerConfig, TriggerEvent } from "../types";

export interface TriggerMatch {
  trigger: TriggerConfig;
  matched: boolean;
}

export function evaluateTriggers(
  triggers: TriggerConfig[],
  event: TriggerEvent,
): TriggerMatch[] {
  return triggers.map((t) => ({
    trigger: t,
    matched: t.enabled && t.eventType === event,
  }));
}