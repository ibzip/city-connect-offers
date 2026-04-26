import { CalendarSignalPayloadSchema } from "@city-wallet/contracts";
import { makeId, nowIso } from "@city-wallet/utils";

import type { RawContextProvider } from "../types.js";

export const calendarProvider: RawContextProvider = {
  source: "calendar",
  async read({ profile }) {
    const enabled = profile?.enabledSources?.calendar !== false && Boolean(profile?.signalPayloads?.calendar);
    if (!enabled) return null;
    const parsed = CalendarSignalPayloadSchema.safeParse(profile!.signalPayloads.calendar);
    if (!parsed.success) return null;
    return {
      signalId: makeId("sig_calendar"),
      source: "calendar",
      sourceType: "simulated",
      observedAt: nowIso(),
      confidence: 0.85,
      payload: parsed.data as Record<string, unknown>,
    };
  },
};
