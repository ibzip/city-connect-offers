import { SocialSignalPayloadSchema } from "@city-wallet/contracts";
import { makeId, nowIso } from "@city-wallet/utils";

import type { RawContextProvider } from "../types.js";

export const socialProvider: RawContextProvider = {
  source: "social",
  async read({ profile }) {
    const enabled = profile?.enabledSources?.social !== false && Boolean(profile?.signalPayloads?.social);
    if (!enabled) return null;
    const parsed = SocialSignalPayloadSchema.safeParse(profile!.signalPayloads.social);
    if (!parsed.success) return null;
    return {
      signalId: makeId("sig_social"),
      source: "social",
      sourceType: "simulated",
      observedAt: nowIso(),
      confidence: 0.7,
      payload: parsed.data as Record<string, unknown>,
    };
  },
};
