import { FitnessSignalPayloadSchema } from "@city-wallet/contracts";
import { makeId, nowIso } from "@city-wallet/utils";

import type { RawContextProvider } from "../types.js";

export const fitnessProvider: RawContextProvider = {
  source: "fitness",
  async read({ profile }) {
    const enabled = profile?.enabledSources?.fitness !== false && Boolean(profile?.signalPayloads?.fitness);
    if (!enabled) return null;
    const parsed = FitnessSignalPayloadSchema.safeParse(profile!.signalPayloads.fitness);
    if (!parsed.success) return null;
    return {
      signalId: makeId("sig_fitness"),
      source: "fitness",
      sourceType: "simulated",
      observedAt: nowIso(),
      confidence: 0.8,
      payload: parsed.data as Record<string, unknown>,
    };
  },
};
