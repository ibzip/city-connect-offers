import type {
  ConsumerContextSnapshot,
  MockContextProfile,
  RawContextSignal,
  RawContextSource,
} from "@city-wallet/contracts";

export type RawContextProviderInput = {
  userId: string;
  profile: MockContextProfile | null;
  snapshot: ConsumerContextSnapshot | null;
};

export interface RawContextProvider {
  source: RawContextSource;
  read(input: RawContextProviderInput): Promise<RawContextSignal | null>;
}

export type CollectRawSignalsInput = {
  userId: string;
  profile: MockContextProfile | null;
  snapshot: ConsumerContextSnapshot | null;
  /** Override the default provider list. Useful for tests. */
  providers?: RawContextProvider[];
};

export type CollectRawSignalsResult = {
  signals: RawContextSignal[];
  enabledSources: string[];
  disabledSources: string[];
};

export type SignalsHashInput = {
  signals: RawContextSignal[];
  profileId?: string | null;
  profileVersion?: number | null;
};
