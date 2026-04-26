import { MobilitySignalPayloadSchema } from "@city-wallet/contracts";
import { makeId, nowIso } from "@city-wallet/utils";

import type { RawContextProvider } from "../types.js";

export const mobilityProvider: RawContextProvider = {
  source: "mobility",
  async read({ profile }) {
    const enabled = profile?.enabledSources?.mobility !== false && Boolean(profile?.signalPayloads?.mobility);
    if (!enabled) return null;
    const parsed = MobilitySignalPayloadSchema.safeParse(profile!.signalPayloads.mobility);
    if (!parsed.success) return null;
    return {
      signalId: makeId("sig_mobility"),
      source: "mobility",
      sourceType: "simulated",
      observedAt: nowIso(),
      confidence: 0.75,
      payload: parsed.data as Record<string, unknown>,
    };
  },
};
