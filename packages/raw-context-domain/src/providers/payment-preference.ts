import { PaymentPreferenceSignalPayloadSchema } from "@city-wallet/contracts";
import { makeId, nowIso } from "@city-wallet/utils";

import type { RawContextProvider } from "../types.js";

export const paymentPreferenceProvider: RawContextProvider = {
  source: "payment_preference",
  async read({ profile }) {
    const enabled =
      profile?.enabledSources?.payment_preference !== false &&
      Boolean(profile?.signalPayloads?.payment_preference);
    if (!enabled) return null;
    const parsed = PaymentPreferenceSignalPayloadSchema.safeParse(profile!.signalPayloads.payment_preference);
    if (!parsed.success) return null;
    return {
      signalId: makeId("sig_payment_pref"),
      source: "payment_preference",
      sourceType: "simulated",
      observedAt: nowIso(),
      confidence: 0.85,
      payload: parsed.data as Record<string, unknown>,
    };
  },
};
