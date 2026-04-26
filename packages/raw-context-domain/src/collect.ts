import type { RawContextSignal } from "@city-wallet/contracts";
import { stableHash } from "@city-wallet/utils";

import { calendarProvider } from "./providers/calendar.js";
import { deviceAttentionProvider } from "./providers/device-attention.js";
import { dietaryProvider } from "./providers/dietary.js";
import { fitnessProvider } from "./providers/fitness.js";
import { localEventsProvider } from "./providers/local-events.js";
import { mobilityProvider } from "./providers/mobility.js";
import { moodProvider } from "./providers/mood.js";
import { paymentPreferenceProvider } from "./providers/payment-preference.js";
import { socialProvider } from "./providers/social.js";
import { transitProvider } from "./providers/transit.js";
import { realProviders } from "./real-providers.js";
import type {
  CollectRawSignalsInput,
  CollectRawSignalsResult,
  RawContextProvider,
  SignalsHashInput,
} from "./types.js";

export const mockProviders: RawContextProvider[] = [
  calendarProvider,
  fitnessProvider,
  mobilityProvider,
  moodProvider,
  paymentPreferenceProvider,
  socialProvider,
  transitProvider,
  dietaryProvider,
  deviceAttentionProvider,
  localEventsProvider,
];

export const defaultProviders: RawContextProvider[] = [...mockProviders, ...realProviders];

const MOCK_SOURCES = new Set(mockProviders.map((p) => p.source));

export async function collectRawSignals(input: CollectRawSignalsInput): Promise<CollectRawSignalsResult> {
  const providers = input.providers ?? defaultProviders;
  const signals: RawContextSignal[] = [];
  const enabledSources: string[] = [];
  const disabledSources: string[] = [];

  for (const provider of providers) {
    let signal: RawContextSignal | null = null;
    try {
      signal = await provider.read({
        userId: input.userId,
        profile: input.profile,
        snapshot: input.snapshot,
      });
    } catch {
      signal = null;
    }
    if (signal) {
      signals.push(signal);
      enabledSources.push(provider.source);
    } else if (MOCK_SOURCES.has(provider.source)) {
      const explicitlyDisabled = input.profile?.enabledSources?.[provider.source] === false;
      const noPayload = !input.profile?.signalPayloads?.[provider.source as keyof typeof input.profile.signalPayloads];
      if (explicitlyDisabled || noPayload) {
        disabledSources.push(provider.source);
      }
    }
  }

  return { signals, enabledSources, disabledSources };
}

export function computeSignalsHash(input: SignalsHashInput): string {
  const compactSignals = input.signals.map((signal) => ({
    source: signal.source,
    sourceType: signal.sourceType,
    payload: stableSerialize(signal.payload),
  }));
  const seed = JSON.stringify({
    profileId: input.profileId ?? null,
    profileVersion: input.profileVersion ?? null,
    signals: compactSignals,
  });
  return stableHash(seed);
}

function stableSerialize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableSerialize);
  }
  if (value && typeof value === "object") {
    const sortedKeys = Object.keys(value as Record<string, unknown>).sort();
    return sortedKeys.reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = stableSerialize((value as Record<string, unknown>)[key]);
      return acc;
    }, {});
  }
  return value;
}
