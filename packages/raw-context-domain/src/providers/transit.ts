import { TransitSignalPayloadSchema } from "@city-wallet/contracts";
import { makeId, nowIso } from "@city-wallet/utils";

import type { RawContextProvider } from "../types.js";

export const transitProvider: RawContextProvider = {
  source: "transit",
  async read({ profile }) {
    const enabled = profile?.enabledSources?.transit !== false && Boolean(profile?.signalPayloads?.transit);
    if (!enabled) return null;
    const parsed = TransitSignalPayloadSchema.safeParse(profile!.signalPayloads.transit);
    if (!parsed.success) return null;
    return {
      signalId: makeId("sig_transit"),
      source: "transit",
      sourceType: "simulated",
      observedAt: nowIso(),
      confidence: 0.8,
      payload: parsed.data as Record<string, unknown>,
    };
  },
};
