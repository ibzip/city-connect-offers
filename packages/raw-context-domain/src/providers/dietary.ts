import { DietarySignalPayloadSchema } from "@city-wallet/contracts";
import { makeId, nowIso } from "@city-wallet/utils";

import type { RawContextProvider } from "../types.js";

export const dietaryProvider: RawContextProvider = {
  source: "dietary",
  async read({ profile }) {
    const enabled = profile?.enabledSources?.dietary !== false && Boolean(profile?.signalPayloads?.dietary);
    if (!enabled) return null;
    const parsed = DietarySignalPayloadSchema.safeParse(profile!.signalPayloads.dietary);
    if (!parsed.success) return null;
    return {
      signalId: makeId("sig_dietary"),
      source: "dietary",
      sourceType: "simulated",
      observedAt: nowIso(),
      confidence: 0.85,
      payload: parsed.data as Record<string, unknown>,
    };
  },
};
