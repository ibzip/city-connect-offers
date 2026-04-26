import { LocalEventsSignalPayloadSchema } from "@city-wallet/contracts";
import { makeId, nowIso } from "@city-wallet/utils";

import type { RawContextProvider } from "../types.js";

export const localEventsProvider: RawContextProvider = {
  source: "local_events",
  async read({ profile }) {
    const enabled =
      profile?.enabledSources?.local_events !== false && Boolean(profile?.signalPayloads?.local_events);
    if (!enabled) return null;
    const parsed = LocalEventsSignalPayloadSchema.safeParse(profile!.signalPayloads.local_events);
    if (!parsed.success) return null;
    return {
      signalId: makeId("sig_local_events"),
      source: "local_events",
      sourceType: "simulated",
      observedAt: nowIso(),
      confidence: 0.7,
      payload: parsed.data as Record<string, unknown>,
    };
  },
};
