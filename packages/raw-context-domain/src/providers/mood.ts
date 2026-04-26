import { MoodSignalPayloadSchema } from "@city-wallet/contracts";
import { makeId, nowIso } from "@city-wallet/utils";

import type { RawContextProvider } from "../types.js";

export const moodProvider: RawContextProvider = {
  source: "mood",
  async read({ profile }) {
    const enabled = profile?.enabledSources?.mood !== false && Boolean(profile?.signalPayloads?.mood);
    if (!enabled) return null;
    const parsed = MoodSignalPayloadSchema.safeParse(profile!.signalPayloads.mood);
    if (!parsed.success) return null;
    return {
      signalId: makeId("sig_mood"),
      source: "mood",
      sourceType: "simulated",
      observedAt: nowIso(),
      confidence: parsed.data.confidence ?? 0.6,
      payload: parsed.data as Record<string, unknown>,
    };
  },
};
