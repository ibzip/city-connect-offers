import { DeviceAttentionSignalPayloadSchema } from "@city-wallet/contracts";
import { makeId, nowIso } from "@city-wallet/utils";

import type { RawContextProvider } from "../types.js";

export const deviceAttentionProvider: RawContextProvider = {
  source: "device_attention",
  async read({ profile }) {
    const enabled =
      profile?.enabledSources?.device_attention !== false &&
      Boolean(profile?.signalPayloads?.device_attention);
    if (!enabled) return null;
    const parsed = DeviceAttentionSignalPayloadSchema.safeParse(profile!.signalPayloads.device_attention);
    if (!parsed.success) return null;
    return {
      signalId: makeId("sig_device_attention"),
      source: "device_attention",
      sourceType: "simulated",
      observedAt: nowIso(),
      confidence: 0.7,
      payload: parsed.data as Record<string, unknown>,
    };
  },
};
