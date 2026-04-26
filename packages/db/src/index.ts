import { PrismaClient } from "@prisma/client";
import type {
  AnalyticsEvent,
  CommerceZone,
  ConsumerContextSnapshot,
  GeoPoint,
  Merchant,
  MerchantImportRun,
  MerchantInsightSnapshot,
  MerchantRule,
  MockContextProfile,
  NegotiationBrief,
  NegotiationDecision,
  Offer,
  OrchestrationRun,
  OrchestrationResult,
  PaymentDensitySignal,
  RedemptionResult,
  RedemptionToken,
  TriggerConfig,
  UserContextAgentRun,
  UserEvent,
  UserProfile,
  ValidationResult,
} from "@city-wallet/contracts";
import {
  seededCommerceZones,
  seededConsumerContext,
  seededMerchantGoals,
  seededMerchantProducts,
  seededMerchantRules,
  seededMerchants,
  seededPaymentDensitySignals,
  seededUserProfile,
} from "@city-wallet/data-seed";
import { isPointInsideZone, makeId, nowIso } from "@city-wallet/utils";

/**
 * Thrown when a concurrent orchestrate() call has already inserted an
 * OrchestrationRun row with the same idempotencyKey. The caller should
 * re-read the existing row and dispatch on its status.
 */
export class OrchestrationRunConflictError extends Error {
  readonly idempotencyKey: string;
  constructor(idempotencyKey: string) {
    super(`OrchestrationRun already exists for idempotencyKey=${idempotencyKey}`);
    this.name = "OrchestrationRunConflictError";
    this.idempotencyKey = idempotencyKey;
  }
}

function isPrismaUniqueConstraintError(error: unknown, field?: string): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; meta?: { target?: unknown } };
  if (e.code !== "P2002") return false;
  if (!field) return true;
  const target = e.meta?.target;
  if (Array.isArray(target)) return target.includes(field);
  if (typeof target === "string") return target === field || target.includes(field);
  return false;
}

export interface CityWalletRepository {
  resetToSeed(): Promise<void>;
  getUserProfile(userId: string): Promise<UserProfile | null>;
  saveUserProfile(profile: UserProfile): Promise<UserProfile>;
  getCurrentContext(userId: string): Promise<ConsumerContextSnapshot | null>;
  getLatestContext(): Promise<ConsumerContextSnapshot | null>;
  saveConsumerContext(context: ConsumerContextSnapshot): Promise<ConsumerContextSnapshot>;
  listActiveZones(): Promise<CommerceZone[]>;
  listCommerceZones(): Promise<CommerceZone[]>;
  saveCommerceZone(zone: CommerceZone): Promise<CommerceZone>;
  getZoneById(zoneId: string): Promise<CommerceZone | null>;
  findZonesContainingPoint(lat: number, lng: number): Promise<CommerceZone[]>;
  listMerchants(filter?: MerchantListFilter): Promise<Merchant[]>;
  countMerchants(filter?: MerchantListFilter): Promise<number>;
  listMerchantsByZone(zoneId: string): Promise<Merchant[]>;
  getMerchant(merchantId: string): Promise<Merchant | null>;
  saveMerchant(merchant: Merchant): Promise<Merchant>;
  listMerchantRules(): Promise<MerchantRule[]>;
  saveMerchantRule(rule: MerchantRule): Promise<MerchantRule>;
  listPaymentDensitySignals(): Promise<PaymentDensitySignal[]>;
  savePaymentDensitySignal(signal: PaymentDensitySignal): Promise<PaymentDensitySignal>;
  saveMerchantInsight(insight: MerchantInsightSnapshot): Promise<MerchantInsightSnapshot>;
  listMerchantInsights(): Promise<MerchantInsightSnapshot[]>;
  saveUserEvent(event: UserEvent): Promise<UserEvent>;
  saveTriggerMatch(match: { id: string; userEventId: string; triggerId: string; matchedAt: string }): Promise<void>;
  saveNegotiationBrief(brief: NegotiationBrief): Promise<NegotiationBrief>;
  saveNegotiationDecision(decisionId: string, briefId: string, decision: NegotiationDecision): Promise<NegotiationDecision>;
  saveValidationResult(resultId: string, decisionId: string, result: ValidationResult): Promise<ValidationResult>;
  saveOffer(offer: Offer): Promise<Offer>;
  listOffers(userId?: string): Promise<Offer[]>;
  getOffer(offerId: string): Promise<Offer | null>;
  updateOfferStatus(offerId: string, status: Offer["status"]): Promise<Offer | null>;
  saveRedemptionTokens(tokens: RedemptionToken[]): Promise<RedemptionToken[]>;
  listRedemptionTokens(offerId?: string): Promise<RedemptionToken[]>;
  getRedemptionTokenByCode(code: string): Promise<RedemptionToken | null>;
  updateRedemptionToken(token: RedemptionToken): Promise<RedemptionToken>;
  saveRedemption(result: RedemptionResult & { merchantId: string; offerId: string; tokenId: string; createdAt: string }): Promise<void>;
  saveCashbackLedgerEntry(entry: { id: string; userId: string; offerId: string; merchantId: string; amountEuro: number; createdAt: string }): Promise<void>;
  recordAnalyticsEvent(event: AnalyticsEvent): Promise<AnalyticsEvent>;
  listAnalyticsEvents(limit?: number): Promise<AnalyticsEvent[]>;
  getGeocodingCache(provider: string, query: string): Promise<{ provider: string; query: string; result: GeoPoint | null; status: string; updatedAt: string } | null>;
  setGeocodingCache(input: { provider: string; query: string; result: GeoPoint | null; status: string }): Promise<void>;
  getPoiCache(provider: string, cacheKey: string): Promise<{ provider: string; cacheKey: string; result: unknown; expiresAt: string } | null>;
  setPoiCache(input: { provider: string; cacheKey: string; result: unknown; expiresAt: string }): Promise<void>;
  saveMerchantImportRun(run: MerchantImportRun): Promise<MerchantImportRun>;
  getMerchantImportRun(runId: string): Promise<MerchantImportRun | null>;
  listMerchantImportRuns(zoneId?: string): Promise<MerchantImportRun[]>;
  updateMerchantImportRun(runId: string, patch: Partial<MerchantImportRun>): Promise<MerchantImportRun | null>;
  getOrchestrationRun(idempotencyKey: string): Promise<OrchestrationRun | null>;
  createOrchestrationRun(run: Omit<OrchestrationRun, "createdAt" | "updatedAt">): Promise<OrchestrationRun>;
  updateOrchestrationRun(idempotencyKey: string, patch: Partial<Pick<OrchestrationRun, "status" | "contextSnapshotId" | "resultJson" | "errorJson">>): Promise<OrchestrationRun | null>;
  saveDebugRun(run: OrchestrationResult): Promise<OrchestrationResult>;
  getLastDebugRun(): Promise<OrchestrationResult | null>;
  listMockContextProfiles(userId: string): Promise<MockContextProfile[]>;
  getMockContextProfile(profileId: string): Promise<MockContextProfile | null>;
  getActiveMockContextProfile(userId: string): Promise<MockContextProfile | null>;
  saveMockContextProfile(profile: MockContextProfile): Promise<MockContextProfile>;
  setActiveMockContextProfile(userId: string, profileId: string): Promise<MockContextProfile | null>;
  deleteMockContextProfile(profileId: string): Promise<void>;
  saveUserContextAgentRun(run: UserContextAgentRun): Promise<UserContextAgentRun>;
  listUserContextAgentRuns(input: { userId: string; limit?: number }): Promise<UserContextAgentRun[]>;
  /**
   * Wipe per-session, per-user transient state so the wallet starts a fresh
   * session on every load. Removes offers, redemption tokens, redemptions,
   * cashback ledger entries, orchestration runs, validation/decision/brief
   * rows, user events, and analytics events for that user.
   *
   * Preserves: merchants, zones, merchant rules/insights, mock context
   * profiles (so the seeded "active" mock profile keeps steering the LLM),
   * user profile, and merchants imported by the merchant portal.
   */
  clearUserTransientState(userId: string): Promise<{ clearedCounts: Record<string, number> }>;
}

export type MerchantListFilter = {
  ids?: string[];
  zoneId?: string;
  category?: string;
  participationStatus?: Merchant["participationStatus"];
  source?: Merchant["source"];
  query?: string;
  limit?: number;
  offset?: number;
};

type Tables = {
  users: UserProfile[];
  contexts: ConsumerContextSnapshot[];
  zones: CommerceZone[];
  merchants: Merchant[];
  rules: MerchantRule[];
  densities: PaymentDensitySignal[];
  insights: MerchantInsightSnapshot[];
  userEvents: UserEvent[];
  negotiationBriefs: NegotiationBrief[];
  negotiationDecisions: { decisionId: string; briefId: string; decision: NegotiationDecision }[];
  validationResults: { resultId: string; decisionId: string; result: ValidationResult }[];
  offers: Offer[];
  tokens: RedemptionToken[];
  redemptions: Array<RedemptionResult & { merchantId: string; offerId: string; tokenId: string; createdAt: string }>;
  cashbackLedger: { id: string; userId: string; offerId: string; merchantId: string; amountEuro: number; createdAt: string }[];
  analyticsEvents: AnalyticsEvent[];
  triggerMatches: { id: string; userEventId: string; triggerId: string; matchedAt: string }[];
  geocodingCache: { provider: string; query: string; result: GeoPoint | null; status: string; updatedAt: string }[];
  poiCache: { provider: string; cacheKey: string; result: unknown; expiresAt: string }[];
  importRuns: MerchantImportRun[];
  orchestrationRuns: OrchestrationRun[];
  debugRuns: OrchestrationResult[];
  mockContextProfiles: MockContextProfile[];
  userContextAgentRuns: UserContextAgentRun[];
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createSeedTables(): Tables {
  return {
    users: [clone(seededUserProfile)],
    contexts: [clone(seededConsumerContext)],
    zones: clone(seededCommerceZones),
    merchants: clone(seededMerchants),
    rules: clone(seededMerchantRules),
    densities: clone(seededPaymentDensitySignals),
    insights: [],
    userEvents: [],
    negotiationBriefs: [],
    negotiationDecisions: [],
    validationResults: [],
    offers: [],
    tokens: [],
    redemptions: [],
    cashbackLedger: [],
    analyticsEvents: [],
    triggerMatches: [],
    geocodingCache: [],
    poiCache: [],
    importRuns: [],
    orchestrationRuns: [],
    debugRuns: [],
    mockContextProfiles: [],
    userContextAgentRuns: [],
  };
}

function filterMerchants(merchants: Merchant[], filter: MerchantListFilter) {
  const query = filter.query?.trim().toLowerCase();
  const ids = filter.ids ? new Set(filter.ids) : null;
  const offset = Math.max(0, filter.offset ?? 0);
  const limit = filter.limit && filter.limit > 0 ? filter.limit : undefined;
  const filtered = merchants.filter((merchant) => {
    if (ids && !ids.has(merchant.id)) return false;
    if (filter.zoneId && merchant.zoneId !== filter.zoneId) return false;
    if (filter.category && merchant.category !== filter.category) return false;
    if (filter.participationStatus && merchant.participationStatus !== filter.participationStatus) return false;
    if (filter.source && merchant.source !== filter.source) return false;
    if (query) {
      const haystack = [merchant.name, merchant.address, merchant.category, merchant.source, merchant.participationStatus]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
  return limit === undefined ? filtered.slice(offset) : filtered.slice(offset, offset + limit);
}

export class SeededRepository implements CityWalletRepository {
  private tables = createSeedTables();

  async resetToSeed() {
    this.tables = createSeedTables();
  }

  async getUserProfile(userId: string) {
    return clone(this.tables.users.find((user) => user.userId === userId) ?? null);
  }

  async saveUserProfile(profile: UserProfile) {
    const existingIndex = this.tables.users.findIndex((user) => user.userId === profile.userId);
    if (existingIndex >= 0) {
      this.tables.users[existingIndex] = clone(profile);
    } else {
      this.tables.users.push(clone(profile));
    }
    return clone(profile);
  }

  async getCurrentContext(userId: string) {
    const contexts = this.tables.contexts.filter((context) => context.userId === userId);
    return clone(contexts.at(-1) ?? null);
  }

  async getLatestContext() {
    return clone(this.tables.contexts.at(-1) ?? null);
  }

  async saveConsumerContext(context: ConsumerContextSnapshot) {
    this.tables.contexts.push(clone(context));
    return clone(context);
  }

  async listActiveZones(): Promise<CommerceZone[]> {
    return clone(this.tables.zones.filter((zone) => zone.isActive));
  }

  async listCommerceZones(): Promise<CommerceZone[]> {
    return clone(this.tables.zones);
  }

  async saveCommerceZone(zone: CommerceZone): Promise<CommerceZone> {
    this.tables.zones = this.tables.zones.filter((existing) => existing.id !== zone.id);
    this.tables.zones.push(clone(zone));
    return clone(zone);
  }

  async getZoneById(zoneId: string) {
    return clone(this.tables.zones.find((zone) => zone.id === zoneId) ?? null);
  }

  async findZonesContainingPoint(lat: number, lng: number): Promise<CommerceZone[]> {
    return clone(this.tables.zones.filter((zone) => zone.isActive && isPointInsideZone(lat, lng, zone)));
  }

  async listMerchants(filter: MerchantListFilter = {}): Promise<Merchant[]> {
    return clone(filterMerchants(this.tables.merchants, filter));
  }

  async countMerchants(filter: MerchantListFilter = {}): Promise<number> {
    return filterMerchants(this.tables.merchants, { ...filter, limit: undefined, offset: undefined }).length;
  }

  async listMerchantsByZone(zoneId: string): Promise<Merchant[]> {
    return this.listMerchants({ zoneId });
  }

  async getMerchant(merchantId: string) {
    return clone(this.tables.merchants.find((merchant) => merchant.id === merchantId) ?? null);
  }

  async saveMerchant(merchant: Merchant) {
    this.tables.merchants = this.tables.merchants.filter((existing) => existing.id !== merchant.id);
    this.tables.merchants.push(clone(merchant));
    if (merchant.rule) {
      await this.saveMerchantRule(merchant.rule);
    }
    return clone(merchant);
  }

  async listMerchantRules() {
    return clone(this.tables.rules);
  }

  async saveMerchantRule(rule: MerchantRule) {
    this.tables.rules = this.tables.rules.filter((existing) => existing.merchantId !== rule.merchantId);
    this.tables.rules.push(clone(rule));
    this.tables.merchants = this.tables.merchants.map((merchant) =>
      merchant.id === rule.merchantId ? { ...merchant, rule: clone(rule) } : merchant,
    );
    return clone(rule);
  }

  async listPaymentDensitySignals() {
    return clone(this.tables.densities);
  }

  async savePaymentDensitySignal(signal: PaymentDensitySignal) {
    this.tables.densities = this.tables.densities.filter((existing) => existing.merchantId !== signal.merchantId);
    this.tables.densities.push(clone(signal));
    return clone(signal);
  }

  async saveMerchantInsight(insight: MerchantInsightSnapshot) {
    this.tables.insights = this.tables.insights.filter((existing) => existing.merchantId !== insight.merchantId);
    this.tables.insights.push(clone(insight));
    return clone(insight);
  }

  async listMerchantInsights() {
    return clone(this.tables.insights);
  }

  async saveUserEvent(event: UserEvent) {
    this.tables.userEvents.push(clone(event));
    return clone(event);
  }

  async saveTriggerMatch(match: { id: string; userEventId: string; triggerId: string; matchedAt: string }) {
    this.tables.triggerMatches.push(clone(match));
  }

  async saveNegotiationBrief(brief: NegotiationBrief) {
    this.tables.negotiationBriefs.push(clone(brief));
    return clone(brief);
  }

  async saveNegotiationDecision(decisionId: string, briefId: string, decision: NegotiationDecision) {
    this.tables.negotiationDecisions.push({ decisionId, briefId, decision: clone(decision) });
    return clone(decision);
  }

  async saveValidationResult(resultId: string, decisionId: string, result: ValidationResult) {
    this.tables.validationResults.push({ resultId, decisionId, result: clone(result) });
    return clone(result);
  }

  async saveOffer(offer: Offer) {
    this.tables.offers = this.tables.offers.filter((existing) => existing.offerId !== offer.offerId);
    this.tables.offers.push(clone(offer));
    return clone(offer);
  }

  async listOffers(userId?: string) {
    const offers = userId ? this.tables.offers.filter((offer) => offer.consumerId === userId) : this.tables.offers;
    return clone(offers);
  }

  async getOffer(offerId: string) {
    return clone(this.tables.offers.find((offer) => offer.offerId === offerId) ?? null);
  }

  async updateOfferStatus(offerId: string, status: Offer["status"]) {
    const offer = this.tables.offers.find((existing) => existing.offerId === offerId);
    if (!offer) return null;
    offer.status = status;
    return clone(offer);
  }

  async saveRedemptionTokens(tokens: RedemptionToken[]) {
    for (const token of tokens) {
      this.tables.tokens = this.tables.tokens.filter((existing) => existing.tokenId !== token.tokenId);
      this.tables.tokens.push(clone(token));
    }
    return clone(tokens);
  }

  async listRedemptionTokens(offerId?: string) {
    const tokens = offerId ? this.tables.tokens.filter((token) => token.offerId === offerId) : this.tables.tokens;
    return clone(tokens);
  }

  async getRedemptionTokenByCode(code: string) {
    return clone(this.tables.tokens.find((token) => token.code === code) ?? null);
  }

  async updateRedemptionToken(token: RedemptionToken) {
    this.tables.tokens = this.tables.tokens.filter((existing) => existing.tokenId !== token.tokenId);
    this.tables.tokens.push(clone(token));
    return clone(token);
  }

  async saveRedemption(result: RedemptionResult & { merchantId: string; offerId: string; tokenId: string; createdAt: string }) {
    this.tables.redemptions.push(clone(result));
  }

  async saveCashbackLedgerEntry(entry: { id: string; userId: string; offerId: string; merchantId: string; amountEuro: number; createdAt: string }) {
    this.tables.cashbackLedger.push(clone(entry));
  }

  async recordAnalyticsEvent(event: AnalyticsEvent) {
    this.tables.analyticsEvents.push(clone(event));
    return clone(event);
  }

  async listAnalyticsEvents(limit = 100) {
    return clone([...this.tables.analyticsEvents].reverse().slice(0, limit));
  }

  async getGeocodingCache(provider: string, query: string) {
    return clone(this.tables.geocodingCache.find((entry) => entry.provider === provider && entry.query === query) ?? null);
  }

  async setGeocodingCache(input: { provider: string; query: string; result: GeoPoint | null; status: string }) {
    this.tables.geocodingCache = this.tables.geocodingCache.filter((entry) => entry.provider !== input.provider || entry.query !== input.query);
    this.tables.geocodingCache.push({ ...clone(input), updatedAt: nowIso() });
  }

  async getPoiCache(provider: string, cacheKey: string) {
    const entry = this.tables.poiCache.find((candidate) => candidate.provider === provider && candidate.cacheKey === cacheKey);
    if (!entry || new Date(entry.expiresAt).getTime() <= Date.now()) return null;
    return clone(entry);
  }

  async setPoiCache(input: { provider: string; cacheKey: string; result: unknown; expiresAt: string }) {
    this.tables.poiCache = this.tables.poiCache.filter((entry) => entry.provider !== input.provider || entry.cacheKey !== input.cacheKey);
    this.tables.poiCache.push(clone(input));
  }

  async saveMerchantImportRun(run: MerchantImportRun) {
    this.tables.importRuns = this.tables.importRuns.filter((existing) => existing.id !== run.id);
    this.tables.importRuns.push(clone(run));
    return clone(run);
  }

  async getMerchantImportRun(runId: string) {
    return clone(this.tables.importRuns.find((run) => run.id === runId) ?? null);
  }

  async listMerchantImportRuns(zoneId?: string) {
    const runs = zoneId ? this.tables.importRuns.filter((run) => run.zoneId === zoneId) : this.tables.importRuns;
    return clone([...runs].sort((left, right) => right.startedAt.localeCompare(left.startedAt)));
  }

  async updateMerchantImportRun(runId: string, patch: Partial<MerchantImportRun>) {
    const run = this.tables.importRuns.find((candidate) => candidate.id === runId);
    if (!run) return null;
    Object.assign(run, clone(patch), { updatedAt: nowIso() });
    return clone(run);
  }

  async getOrchestrationRun(idempotencyKey: string) {
    return clone(this.tables.orchestrationRuns.find((run) => run.idempotencyKey === idempotencyKey) ?? null);
  }

  async createOrchestrationRun(run: Omit<OrchestrationRun, "createdAt" | "updatedAt">) {
    const now = nowIso();
    const next: OrchestrationRun = { ...clone(run), createdAt: now, updatedAt: now };
    this.tables.orchestrationRuns.push(next);
    return clone(next);
  }

  async updateOrchestrationRun(
    idempotencyKey: string,
    patch: Partial<Pick<OrchestrationRun, "status" | "contextSnapshotId" | "resultJson" | "errorJson">>,
  ) {
    const run = this.tables.orchestrationRuns.find((candidate) => candidate.idempotencyKey === idempotencyKey);
    if (!run) return null;
    Object.assign(run, clone(patch), { updatedAt: nowIso() });
    return clone(run);
  }

  async saveDebugRun(run: OrchestrationResult) {
    this.tables.debugRuns.push(clone(run));
    return clone(run);
  }

  async getLastDebugRun() {
    return clone(this.tables.debugRuns.at(-1) ?? null);
  }

  async listMockContextProfiles(userId: string) {
    return clone(
      this.tables.mockContextProfiles
        .filter((profile) => profile.userId === userId)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    );
  }

  async getMockContextProfile(profileId: string) {
    return clone(this.tables.mockContextProfiles.find((profile) => profile.id === profileId) ?? null);
  }

  async getActiveMockContextProfile(userId: string) {
    const active = this.tables.mockContextProfiles.find(
      (profile) => profile.userId === userId && profile.isActive,
    );
    return clone(active ?? null);
  }

  async saveMockContextProfile(profile: MockContextProfile) {
    const existing = this.tables.mockContextProfiles.find((row) => row.id === profile.id);
    const next: MockContextProfile = {
      ...profile,
      // Trust the version the handler already computed; only fall back to
      // existing+1 when no version was supplied.
      version: profile.version > 0 ? profile.version : (existing?.version ?? 0) + 1,
      updatedAt: nowIso(),
    };
    this.tables.mockContextProfiles = this.tables.mockContextProfiles.filter((row) => row.id !== profile.id);
    this.tables.mockContextProfiles.push(clone(next));
    return clone(next);
  }

  async setActiveMockContextProfile(userId: string, profileId: string) {
    const target = this.tables.mockContextProfiles.find(
      (profile) => profile.id === profileId && profile.userId === userId,
    );
    if (!target) return null;
    this.tables.mockContextProfiles = this.tables.mockContextProfiles.map((profile) => {
      if (profile.userId !== userId) return profile;
      const isActive = profile.id === profileId;
      if (profile.isActive === isActive) return profile;
      return { ...profile, isActive, version: profile.version + 1, updatedAt: nowIso() };
    });
    return clone(this.tables.mockContextProfiles.find((profile) => profile.id === profileId) ?? null);
  }

  async deleteMockContextProfile(profileId: string) {
    this.tables.mockContextProfiles = this.tables.mockContextProfiles.filter(
      (profile) => profile.id !== profileId,
    );
  }

  async saveUserContextAgentRun(run: UserContextAgentRun) {
    this.tables.userContextAgentRuns = this.tables.userContextAgentRuns.filter((existing) => existing.id !== run.id);
    this.tables.userContextAgentRuns.push(clone(run));
    return clone(run);
  }

  async listUserContextAgentRuns(input: { userId: string; limit?: number }) {
    const runs = this.tables.userContextAgentRuns
      .filter((run) => run.userId === input.userId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const limit = input.limit && input.limit > 0 ? input.limit : runs.length;
    return clone(runs.slice(0, limit));
  }

  async clearUserTransientState(userId: string) {
    const offerIdsForUser = new Set(this.tables.offers.filter((offer) => offer.consumerId === userId).map((offer) => offer.offerId));
    const counts: Record<string, number> = {
      offers: 0,
      tokens: 0,
      redemptions: 0,
      cashbackLedger: 0,
      orchestrationRuns: 0,
      validationResults: 0,
      negotiationDecisions: 0,
      negotiationBriefs: 0,
      userEvents: 0,
      analyticsEvents: 0,
      userContextAgentRuns: 0,
      contexts: 0,
    };
    const before = {
      offers: this.tables.offers.length,
      tokens: this.tables.tokens.length,
      redemptions: this.tables.redemptions.length,
      cashbackLedger: this.tables.cashbackLedger.length,
      orchestrationRuns: this.tables.orchestrationRuns.length,
      validationResults: this.tables.validationResults.length,
      negotiationDecisions: this.tables.negotiationDecisions.length,
      negotiationBriefs: this.tables.negotiationBriefs.length,
      userEvents: this.tables.userEvents.length,
      analyticsEvents: this.tables.analyticsEvents.length,
      userContextAgentRuns: this.tables.userContextAgentRuns.length,
      contexts: this.tables.contexts.length,
    };
    this.tables.offers = this.tables.offers.filter((offer) => offer.consumerId !== userId);
    this.tables.tokens = this.tables.tokens.filter((token) => !offerIdsForUser.has(token.offerId));
    this.tables.redemptions = this.tables.redemptions.filter((entry) => !offerIdsForUser.has(entry.offerId));
    this.tables.cashbackLedger = this.tables.cashbackLedger.filter((entry) => entry.userId !== userId);
    this.tables.orchestrationRuns = this.tables.orchestrationRuns.filter((run) => run.userId !== userId);
    this.tables.userEvents = this.tables.userEvents.filter((event) => event.userId !== userId);
    this.tables.userContextAgentRuns = this.tables.userContextAgentRuns.filter((run) => run.userId !== userId);
    this.tables.contexts = this.tables.contexts.filter((ctx) => ctx.userId !== userId);
    // Best-effort cleanup of decision/brief/validation rows that referenced
    // briefs created for this user. Briefs aren't tagged with userId in the
    // in-memory shape, so we conservatively keep them.
    this.tables.analyticsEvents = this.tables.analyticsEvents.filter((event) => {
      if (event.offerId && offerIdsForUser.has(event.offerId)) return false;
      return true;
    });
    counts.offers = before.offers - this.tables.offers.length;
    counts.tokens = before.tokens - this.tables.tokens.length;
    counts.redemptions = before.redemptions - this.tables.redemptions.length;
    counts.cashbackLedger = before.cashbackLedger - this.tables.cashbackLedger.length;
    counts.orchestrationRuns = before.orchestrationRuns - this.tables.orchestrationRuns.length;
    counts.validationResults = before.validationResults - this.tables.validationResults.length;
    counts.negotiationDecisions = before.negotiationDecisions - this.tables.negotiationDecisions.length;
    counts.negotiationBriefs = before.negotiationBriefs - this.tables.negotiationBriefs.length;
    counts.userEvents = before.userEvents - this.tables.userEvents.length;
    counts.analyticsEvents = before.analyticsEvents - this.tables.analyticsEvents.length;
    counts.userContextAgentRuns = before.userContextAgentRuns - this.tables.userContextAgentRuns.length;
    counts.contexts = before.contexts - this.tables.contexts.length;
    return { clearedCounts: counts };
  }
}

export class PrismaRepository implements CityWalletRepository {
  constructor(private readonly prisma: PrismaClient = new PrismaClient()) {}

  async resetToSeed() {
    const db = this.prisma as any;
    await db.$transaction([
      db.userContextAgentRun.deleteMany(),
      db.mockContextProfile.deleteMany(),
      db.orchestrationRun.deleteMany(),
      db.merchantImportRun.deleteMany(),
      db.poiDiscoveryCache.deleteMany(),
      db.geocodingCache.deleteMany(),
      db.debugRun.deleteMany(),
      db.analyticsEvent.deleteMany(),
      db.cashbackLedgerEntry.deleteMany(),
      db.redemption.deleteMany(),
      db.redemptionToken.deleteMany(),
      db.offerItem.deleteMany(),
      db.offer.deleteMany(),
      db.validationResult.deleteMany(),
      db.negotiationDecision.deleteMany(),
      db.negotiationBrief.deleteMany(),
      db.triggerMatch.deleteMany(),
      db.userEvent.deleteMany(),
      db.merchantInsightSnapshot.deleteMany(),
      db.merchantTransactionSnapshot.deleteMany(),
      db.merchantTransactionBaseline.deleteMany(),
      db.merchantRule.deleteMany(),
      db.merchantGoal.deleteMany(),
      db.merchantProduct.deleteMany(),
      db.merchant.deleteMany(),
      db.commerceZone.deleteMany(),
      db.userContextSnapshot.deleteMany(),
      db.userProfile.deleteMany(),
      db.user.deleteMany(),
    ]);
    for (const zone of seededCommerceZones) {
      await db.commerceZone.create({
        data: {
          id: zone.id,
          name: zone.name,
          city: zone.city,
          country: zone.country,
          centerLat: zone.centerLat,
          centerLng: zone.centerLng,
          radiusMeters: zone.radiusMeters,
          isActive: zone.isActive,
          data: toJson(zone),
        },
      });
    }
    await db.user.create({ data: { id: seededUserProfile.userId } });
    await db.userProfile.create({
      data: {
        userId: seededUserProfile.userId,
        data: toJson(seededUserProfile),
      },
    });
    await db.userContextSnapshot.create({
      data: {
        id: seededConsumerContext.snapshotId,
        userId: seededConsumerContext.userId,
        data: toJson(seededConsumerContext),
        createdAt: new Date(seededConsumerContext.createdAt),
      },
    });

    for (const merchant of seededMerchants) {
      await db.merchant.create({
        data: {
          id: merchant.id,
          data: toJson(merchant),
        },
      });
    }

    for (const product of seededMerchantProducts) {
      await db.merchantProduct.create({
        data: {
          id: product.id,
          merchantId: product.merchantId,
          data: toJson(product),
        },
      });
    }

    for (const goal of seededMerchantGoals) {
      await db.merchantGoal.create({
        data: {
          id: goal.id,
          merchantId: goal.merchantId,
          data: toJson(goal),
        },
      });
    }

    for (const rule of seededMerchantRules) {
      await db.merchantRule.create({
        data: {
          merchantId: rule.merchantId,
          data: toJson(rule),
        },
      });
    }

    for (const signal of seededPaymentDensitySignals) {
      await db.merchantTransactionBaseline.create({
        data: {
          merchantId: signal.merchantId,
          data: toJson({
            merchantId: signal.merchantId,
            baselineTransactions: signal.baselineTransactions,
            baselineRevenue: signal.baselineRevenue,
          }),
        },
      });
      await db.merchantTransactionSnapshot.create({
        data: {
          merchantId: signal.merchantId,
          data: toJson(signal),
        },
      });
    }
  }

  async getUserProfile(userId: string) {
    const row = await (this.prisma as any).userProfile.findUnique({ where: { userId } });
    return row ? fromJson<UserProfile>(row.data) : null;
  }

  async saveUserProfile(profile: UserProfile) {
    const db = this.prisma as any;
    // The UserProfile FK requires a User row; ensure one exists for fresh users.
    await db.user.upsert({
      where: { id: profile.userId },
      create: { id: profile.userId },
      update: {},
    });
    await db.userProfile.upsert({
      where: { userId: profile.userId },
      create: { userId: profile.userId, data: toJson(profile) },
      update: { data: toJson(profile) },
    });
    return profile;
  }

  async getCurrentContext(userId: string) {
    const row = await (this.prisma as any).userContextSnapshot.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    return row ? fromJson<ConsumerContextSnapshot>(row.data) : null;
  }

  async getLatestContext() {
    const row = await (this.prisma as any).userContextSnapshot.findFirst({
      orderBy: { createdAt: "desc" },
    });
    return row ? fromJson<ConsumerContextSnapshot>(row.data) : null;
  }

  async saveConsumerContext(context: ConsumerContextSnapshot) {
    await (this.prisma as any).userContextSnapshot.create({
      data: { id: context.snapshotId, userId: context.userId, data: toJson(context), createdAt: new Date(context.createdAt) },
    });
    return context;
  }

  async listActiveZones(): Promise<CommerceZone[]> {
    const rows = await (this.prisma as any).commerceZone.findMany({ where: { isActive: true }, orderBy: { id: "asc" } });
    return rows.map((row: any) => fromJson<CommerceZone>(row.data));
  }

  async listCommerceZones(): Promise<CommerceZone[]> {
    const rows = await (this.prisma as any).commerceZone.findMany({ orderBy: { id: "asc" } });
    return rows.map((row: any) => fromJson<CommerceZone>(row.data));
  }

  async saveCommerceZone(zone: CommerceZone): Promise<CommerceZone> {
    await (this.prisma as any).commerceZone.upsert({
      where: { id: zone.id },
      create: {
        id: zone.id,
        name: zone.name,
        city: zone.city,
        country: zone.country,
        centerLat: zone.centerLat,
        centerLng: zone.centerLng,
        radiusMeters: zone.radiusMeters,
        isActive: zone.isActive,
        data: toJson(zone),
      },
      update: {
        name: zone.name,
        city: zone.city,
        country: zone.country,
        centerLat: zone.centerLat,
        centerLng: zone.centerLng,
        radiusMeters: zone.radiusMeters,
        isActive: zone.isActive,
        data: toJson(zone),
      },
    });
    return zone;
  }

  async getZoneById(zoneId: string) {
    const row = await (this.prisma as any).commerceZone.findUnique({ where: { id: zoneId } });
    return row ? fromJson<CommerceZone>(row.data) : null;
  }

  async findZonesContainingPoint(lat: number, lng: number): Promise<CommerceZone[]> {
    const zones = await this.listActiveZones();
    return zones.filter((zone) => isPointInsideZone(lat, lng, zone));
  }

  async listMerchants(filter: MerchantListFilter = {}): Promise<Merchant[]> {
    const rows = await (this.prisma as any).merchant.findMany({
      where: merchantWhere(filter),
      orderBy: { id: "asc" },
      skip: filter.offset,
      take: filter.limit,
    });
    return rows.map((row: any) => fromJson<Merchant>(row.data));
  }

  async countMerchants(filter: MerchantListFilter = {}) {
    return (this.prisma as any).merchant.count({ where: merchantWhere(filter) });
  }

  async listMerchantsByZone(zoneId: string): Promise<Merchant[]> {
    return this.listMerchants({ zoneId });
  }

  async getMerchant(merchantId: string) {
    const row = await (this.prisma as any).merchant.findUnique({ where: { id: merchantId } });
    return row ? fromJson<Merchant>(row.data) : null;
  }

  async saveMerchant(merchant: Merchant) {
    const db = this.prisma as any;
    await db.merchant.upsert({
      where: { id: merchant.id },
      create: merchantToDbData(merchant),
      update: merchantToDbData(merchant),
    });
    await db.merchantProduct.deleteMany({ where: { merchantId: merchant.id } });
    for (const product of merchant.products ?? []) {
      await db.merchantProduct.create({
        data: { id: product.id, merchantId: merchant.id, data: toJson(product) },
      });
    }
    await db.merchantGoal.deleteMany({ where: { merchantId: merchant.id } });
    for (const goal of merchant.goals ?? []) {
      await db.merchantGoal.create({
        data: { id: goal.id, merchantId: merchant.id, data: toJson(goal) },
      });
    }
    if (merchant.rule) {
      await this.saveMerchantRule(merchant.rule);
    }
    return merchant;
  }

  async listMerchantRules() {
    const rows = await (this.prisma as any).merchantRule.findMany();
    return rows.map((row: any) => fromJson<MerchantRule>(row.data));
  }

  async saveMerchantRule(rule: MerchantRule) {
    await (this.prisma as any).merchantRule.upsert({
      where: { merchantId: rule.merchantId },
      create: { merchantId: rule.merchantId, data: toJson(rule) },
      update: { data: toJson(rule) },
    });
    const merchant = await this.getMerchant(rule.merchantId);
    if (merchant) {
      await (this.prisma as any).merchant.update({
        where: { id: rule.merchantId },
        data: { data: toJson({ ...merchant, rule }) },
      });
    }
    return rule;
  }

  async listPaymentDensitySignals() {
    const rows = await (this.prisma as any).merchantTransactionSnapshot.findMany();
    return rows.map((row: any) => fromJson<PaymentDensitySignal>(row.data));
  }

  async savePaymentDensitySignal(signal: PaymentDensitySignal) {
    await (this.prisma as any).merchantTransactionSnapshot.create({
      data: {
        merchantId: signal.merchantId,
        data: toJson(signal),
      },
    });
    return signal;
  }

  async saveMerchantInsight(insight: MerchantInsightSnapshot) {
    await (this.prisma as any).merchantInsightSnapshot.upsert({
      where: { merchantId: insight.merchantId },
      create: { id: insight.insightId, merchantId: insight.merchantId, data: toJson(insight), refreshedAt: new Date(insight.refreshedAt) },
      update: { data: toJson(insight), refreshedAt: new Date(insight.refreshedAt) },
    });
    return insight;
  }

  async listMerchantInsights() {
    const rows = await (this.prisma as any).merchantInsightSnapshot.findMany();
    return rows.map((row: any) => fromJson<MerchantInsightSnapshot>(row.data));
  }

  async saveUserEvent(event: UserEvent) {
    await (this.prisma as any).userEvent.create({
      data: { id: event.eventId, userId: event.userId, eventType: event.eventType, data: toJson(event), observedAt: new Date(event.observedAt) },
    });
    return event;
  }

  async saveTriggerMatch(match: { id: string; userEventId: string; triggerId: string; matchedAt: string }) {
    await (this.prisma as any).triggerMatch.create({ data: { ...match, matchedAt: new Date(match.matchedAt) } });
  }

  async saveNegotiationBrief(brief: NegotiationBrief) {
    await (this.prisma as any).negotiationBrief.create({
      data: { id: brief.briefId, userId: brief.userEvent.userId, data: toJson(brief), createdAt: new Date(brief.createdAt) },
    });
    return brief;
  }

  async saveNegotiationDecision(decisionId: string, briefId: string, decision: NegotiationDecision) {
    await (this.prisma as any).negotiationDecision.create({
      data: { id: decisionId, briefId, decisionType: decision.decision, data: toJson(decision) },
    });
    return decision;
  }

  async saveValidationResult(resultId: string, decisionId: string, result: ValidationResult) {
    await (this.prisma as any).validationResult.create({
      data: { id: resultId, decisionId, valid: result.valid, data: toJson(result) },
    });
    return result;
  }

  async saveOffer(offer: Offer) {
    const db = this.prisma as any;
    await db.offer.upsert({
      where: { id: offer.offerId },
      create: {
        id: offer.offerId,
        consumerId: offer.consumerId,
        type: offer.type,
        status: offer.status,
        data: toJson(offer),
        expiresAt: new Date(offer.expiresAt),
      },
      update: { status: offer.status, data: toJson(offer) },
    });
    await db.offerItem.deleteMany({ where: { offerId: offer.offerId } });
    for (const item of offer.items) {
      await db.offerItem.create({
        data: {
          id: item.offerItemId,
          offerId: offer.offerId,
          merchantId: item.merchantId,
          data: toJson(item),
        },
      });
    }
    return offer;
  }

  async listOffers(userId?: string) {
    const rows = await (this.prisma as any).offer.findMany({
      where: userId ? { consumerId: userId } : undefined,
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row: any) => fromJson<Offer>(row.data));
  }

  async getOffer(offerId: string) {
    const row = await (this.prisma as any).offer.findUnique({ where: { id: offerId } });
    return row ? fromJson<Offer>(row.data) : null;
  }

  async updateOfferStatus(offerId: string, status: Offer["status"]) {
    const offer = await this.getOffer(offerId);
    if (!offer) return null;
    const next = { ...offer, status };
    await this.saveOffer(next);
    return next;
  }

  async saveRedemptionTokens(tokens: RedemptionToken[]) {
    for (const token of tokens) {
      await (this.prisma as any).redemptionToken.upsert({
        where: { id: token.tokenId },
        create: { id: token.tokenId, offerId: token.offerId, merchantId: token.merchantId, code: token.code, status: token.status, data: toJson(token) },
        update: { status: token.status, data: toJson(token) },
      });
    }
    return tokens;
  }

  async listRedemptionTokens(offerId?: string) {
    const rows = await (this.prisma as any).redemptionToken.findMany({ where: offerId ? { offerId } : undefined });
    return rows.map((row: any) => fromJson<RedemptionToken>(row.data));
  }

  async getRedemptionTokenByCode(code: string) {
    const row = await (this.prisma as any).redemptionToken.findUnique({ where: { code } });
    return row ? fromJson<RedemptionToken>(row.data) : null;
  }

  async updateRedemptionToken(token: RedemptionToken) {
    await this.saveRedemptionTokens([token]);
    return token;
  }

  async saveRedemption(result: RedemptionResult & { merchantId: string; offerId: string; tokenId: string; createdAt: string }) {
    await (this.prisma as any).redemption.create({
      data: {
        id: `${result.tokenId}_${Date.now()}`,
        offerId: result.offerId,
        merchantId: result.merchantId,
        tokenId: result.tokenId,
        cashbackIssuedEuro: result.cashbackIssuedEuro,
        data: toJson(result),
      },
    });
  }

  async saveCashbackLedgerEntry(entry: { id: string; userId: string; offerId: string; merchantId: string; amountEuro: number; createdAt: string }) {
    await (this.prisma as any).cashbackLedgerEntry.create({
      data: {
        id: entry.id,
        userId: entry.userId,
        offerId: entry.offerId,
        merchantId: entry.merchantId,
        amountEuro: entry.amountEuro,
        data: toJson(entry),
      },
    });
  }

  async recordAnalyticsEvent(event: AnalyticsEvent) {
    await (this.prisma as any).analyticsEvent.create({
      data: { id: event.eventId, type: event.type, merchantId: event.merchantId, offerId: event.offerId, data: toJson(event), createdAt: new Date(event.createdAt) },
    });
    return event;
  }

  async listAnalyticsEvents(limit = 100) {
    const rows = await (this.prisma as any).analyticsEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.map((row: any) => fromJson<AnalyticsEvent>(row.data));
  }

  async getGeocodingCache(provider: string, query: string) {
    const row = await (this.prisma as any).geocodingCache.findUnique({
      where: { provider_query: { provider, query } },
    });
    if (!row) return null;
    return {
      provider: row.provider,
      query: row.query,
      result: row.resultJson ? fromJson<GeoPoint>(row.resultJson) : null,
      status: row.status,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async setGeocodingCache(input: { provider: string; query: string; result: GeoPoint | null; status: string }) {
    await (this.prisma as any).geocodingCache.upsert({
      where: { provider_query: { provider: input.provider, query: input.query } },
      create: {
        id: makeId("geo_cache"),
        provider: input.provider,
        query: input.query,
        resultJson: input.result ? toJson(input.result) : null,
        status: input.status,
      },
      update: {
        resultJson: input.result ? toJson(input.result) : null,
        status: input.status,
      },
    });
  }

  async getPoiCache(provider: string, cacheKey: string) {
    const row = await (this.prisma as any).poiDiscoveryCache.findUnique({
      where: { provider_cacheKey: { provider, cacheKey } },
    });
    if (!row || row.expiresAt.getTime() <= Date.now()) return null;
    return {
      provider: row.provider,
      cacheKey: row.cacheKey,
      result: fromJson<unknown>(row.resultJson),
      expiresAt: row.expiresAt.toISOString(),
    };
  }

  async setPoiCache(input: { provider: string; cacheKey: string; result: unknown; expiresAt: string }) {
    await (this.prisma as any).poiDiscoveryCache.upsert({
      where: { provider_cacheKey: { provider: input.provider, cacheKey: input.cacheKey } },
      create: {
        id: makeId("poi_cache"),
        provider: input.provider,
        cacheKey: input.cacheKey,
        resultJson: toJson(input.result),
        expiresAt: new Date(input.expiresAt),
      },
      update: {
        resultJson: toJson(input.result),
        expiresAt: new Date(input.expiresAt),
      },
    });
  }

  async saveMerchantImportRun(run: MerchantImportRun) {
    const row = merchantImportRunToRow(run);
    const { id, startedAt, ...update } = row;
    await (this.prisma as any).merchantImportRun.upsert({
      where: { id: run.id },
      create: row,
      update: {
        ...update,
        startedAt,
      },
    });
    return run;
  }

  async getMerchantImportRun(runId: string) {
    const row = await (this.prisma as any).merchantImportRun.findUnique({ where: { id: runId } });
    return row ? merchantImportRunFromRow(row) : null;
  }

  async listMerchantImportRuns(zoneId?: string) {
    const rows = await (this.prisma as any).merchantImportRun.findMany({
      where: zoneId ? { zoneId } : undefined,
      orderBy: { startedAt: "desc" },
    });
    return rows.map((row: any) => merchantImportRunFromRow(row));
  }

  async updateMerchantImportRun(runId: string, patch: Partial<MerchantImportRun>) {
    const existing = await this.getMerchantImportRun(runId);
    if (!existing) return null;
    const next = { ...existing, ...patch, updatedAt: nowIso() };
    await this.saveMerchantImportRun(next);
    return next;
  }

  async getOrchestrationRun(idempotencyKey: string) {
    const row = await (this.prisma as any).orchestrationRun.findUnique({ where: { idempotencyKey } });
    return row ? orchestrationRunFromRow(row) : null;
  }

  async createOrchestrationRun(run: Omit<OrchestrationRun, "createdAt" | "updatedAt">) {
    try {
      const row = await (this.prisma as any).orchestrationRun.create({
        data: {
          idempotencyKey: run.idempotencyKey,
          userId: run.userId,
          eventType: run.eventType,
          contextSnapshotId: run.contextSnapshotId,
          status: run.status,
          resultJson: run.resultJson ? toJson(run.resultJson) : null,
          errorJson: run.errorJson ? toJson(run.errorJson) : null,
        },
      });
      return orchestrationRunFromRow(row);
    } catch (error) {
      // Prisma raises P2002 when a unique constraint is violated. For
      // OrchestrationRun this means another concurrent orchestrate() call
      // already inserted a row with the same idempotencyKey. Surface this as a
      // typed error so the orchestration layer can decide whether to return
      // the existing run instead of crashing.
      if (isPrismaUniqueConstraintError(error, "idempotencyKey")) {
        throw new OrchestrationRunConflictError(run.idempotencyKey);
      }
      throw error;
    }
  }

  async updateOrchestrationRun(
    idempotencyKey: string,
    patch: Partial<Pick<OrchestrationRun, "status" | "contextSnapshotId" | "resultJson" | "errorJson">>,
  ) {
    const data: Record<string, unknown> = {};
    if (patch.status !== undefined) data.status = patch.status;
    if (patch.contextSnapshotId !== undefined) data.contextSnapshotId = patch.contextSnapshotId;
    if (patch.resultJson !== undefined) data.resultJson = patch.resultJson ? toJson(patch.resultJson) : null;
    if (patch.errorJson !== undefined) data.errorJson = patch.errorJson ? toJson(patch.errorJson) : null;
    const row = await (this.prisma as any).orchestrationRun.update({
      where: { idempotencyKey },
      data,
    }).catch(() => null);
    return row ? orchestrationRunFromRow(row) : null;
  }

  async saveDebugRun(run: OrchestrationResult) {
    await (this.prisma as any).debugRun.create({
      data: {
        id: `debug_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        data: toJson(run),
        createdAt: new Date(),
      },
    });
    return run;
  }

  async getLastDebugRun() {
    const row = await (this.prisma as any).debugRun.findFirst({
      orderBy: { createdAt: "desc" },
    });
    return row ? fromJson<OrchestrationResult>(row.data) : null;
  }

  async listMockContextProfiles(userId: string) {
    const rows = await (this.prisma as any).mockContextProfile.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
    });
    return rows.map((row: any) => mockContextProfileFromRow(row));
  }

  async getMockContextProfile(profileId: string) {
    const row = await (this.prisma as any).mockContextProfile.findUnique({
      where: { id: profileId },
    });
    return row ? mockContextProfileFromRow(row) : null;
  }

  async getActiveMockContextProfile(userId: string) {
    const row = await (this.prisma as any).mockContextProfile.findFirst({
      where: { userId, isActive: true },
      orderBy: { updatedAt: "desc" },
    });
    return row ? mockContextProfileFromRow(row) : null;
  }

  async saveMockContextProfile(profile: MockContextProfile) {
    const db = this.prisma as any;
    const existing = await db.mockContextProfile.findUnique({ where: { id: profile.id } });
    // The handler already incremented `profile.version` from the prior version;
    // trust it instead of double-incrementing here.
    const nextVersion = profile.version > 0 ? profile.version : (existing?.version ?? 0) + 1;
    const data = {
      userId: profile.userId,
      name: profile.name,
      enabledSourcesJson: toJson(profile.enabledSources ?? {}),
      signalPayloadsJson: toJson(profile.signalPayloads ?? {}),
      profileOverridesJson: profile.profileOverrides ? toJson(profile.profileOverrides) : null,
      activeScenario: profile.activeScenario ?? null,
      isActive: profile.isActive ?? false,
      version: nextVersion,
    };
    const row = await db.mockContextProfile.upsert({
      where: { id: profile.id },
      create: { id: profile.id, ...data },
      update: data,
    });
    return mockContextProfileFromRow(row);
  }

  async setActiveMockContextProfile(userId: string, profileId: string) {
    const db = this.prisma as any;
    const target = await db.mockContextProfile.findUnique({ where: { id: profileId } });
    if (!target || target.userId !== userId) return null;
    await db.$transaction([
      db.mockContextProfile.updateMany({
        where: { userId, NOT: { id: profileId } },
        data: { isActive: false },
      }),
      db.mockContextProfile.update({
        where: { id: profileId },
        data: { isActive: true, version: { increment: 1 } },
      }),
    ]);
    const row = await db.mockContextProfile.findUnique({ where: { id: profileId } });
    return row ? mockContextProfileFromRow(row) : null;
  }

  async deleteMockContextProfile(profileId: string) {
    await (this.prisma as any).mockContextProfile.delete({ where: { id: profileId } }).catch(() => null);
  }

  async saveUserContextAgentRun(run: UserContextAgentRun) {
    const db = this.prisma as any;
    const data = {
      userId: run.userId,
      contextSnapshotId: run.contextSnapshotId,
      stage: run.stage,
      provider: run.provider,
      model: run.model ?? null,
      latencyMs: run.latencyMs ?? null,
      validationStatus: run.validationStatus,
      errorType: run.errorType ?? null,
      outputJson: run.outputJson,
      createdAt: new Date(run.createdAt),
    };
    const row = await db.userContextAgentRun.upsert({
      where: { id: run.id },
      create: { id: run.id, ...data },
      update: data,
    });
    return userContextAgentRunFromRow(row);
  }

  async listUserContextAgentRuns(input: { userId: string; limit?: number }) {
    const rows = await (this.prisma as any).userContextAgentRun.findMany({
      where: { userId: input.userId },
      orderBy: { createdAt: "desc" },
      take: input.limit && input.limit > 0 ? input.limit : 100,
    });
    return rows.map((row: any) => userContextAgentRunFromRow(row));
  }

  async clearUserTransientState(userId: string) {
    const db = this.prisma as any;
    const offers = await db.offer.findMany({ where: { consumerId: userId }, select: { id: true } });
    const offerIds = offers.map((row: { id: string }) => row.id);
    const counts: Record<string, number> = {};
    if (offerIds.length > 0) {
      const tokens = await db.redemptionToken.deleteMany({ where: { offerId: { in: offerIds } } });
      counts.tokens = tokens.count ?? 0;
      const redemptions = await db.redemption.deleteMany({ where: { offerId: { in: offerIds } } });
      counts.redemptions = redemptions.count ?? 0;
      const offerItems = await db.offerItem.deleteMany({ where: { offerId: { in: offerIds } } });
      counts.offerItems = offerItems.count ?? 0;
      const analytics = await db.analyticsEvent.deleteMany({ where: { offerId: { in: offerIds } } });
      counts.analyticsEvents = analytics.count ?? 0;
      const offersDeleted = await db.offer.deleteMany({ where: { id: { in: offerIds } } });
      counts.offers = offersDeleted.count ?? 0;
    } else {
      counts.tokens = 0;
      counts.redemptions = 0;
      counts.offerItems = 0;
      counts.analyticsEvents = 0;
      counts.offers = 0;
    }
    const cashback = await db.cashbackLedgerEntry.deleteMany({ where: { userId } });
    counts.cashbackLedger = cashback.count ?? 0;
    const orchestrationRuns = await db.orchestrationRun.deleteMany({ where: { userId } });
    counts.orchestrationRuns = orchestrationRuns.count ?? 0;
    const userEvents = await db.userEvent.deleteMany({ where: { userId } });
    counts.userEvents = userEvents.count ?? 0;
    const agentRuns = await db.userContextAgentRun.deleteMany({ where: { userId } });
    counts.userContextAgentRuns = agentRuns.count ?? 0;
    const ctx = await db.userContextSnapshot.deleteMany({ where: { userId } });
    counts.contexts = ctx.count ?? 0;
    return { clearedCounts: counts };
  }
}

function mockContextProfileFromRow(row: any): MockContextProfile {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    enabledSources: row.enabledSourcesJson ? fromJson<Record<string, boolean>>(row.enabledSourcesJson) : {},
    signalPayloads: row.signalPayloadsJson ? fromJson<MockContextProfile["signalPayloads"]>(row.signalPayloadsJson) : {},
    profileOverrides: row.profileOverridesJson
      ? fromJson<MockContextProfile["profileOverrides"]>(row.profileOverridesJson)
      : undefined,
    activeScenario: (row.activeScenario ?? null) as MockContextProfile["activeScenario"],
    isActive: !!row.isActive,
    version: row.version ?? 0,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
  };
}

function userContextAgentRunFromRow(row: any): UserContextAgentRun {
  return {
    id: row.id,
    userId: row.userId,
    contextSnapshotId: row.contextSnapshotId,
    stage: row.stage,
    provider: row.provider,
    model: row.model ?? null,
    latencyMs: row.latencyMs ?? null,
    validationStatus: row.validationStatus,
    errorType: row.errorType ?? null,
    outputJson: row.outputJson ?? null,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
  };
}

function merchantToDbData(merchant: Merchant) {
  return {
    id: merchant.id,
    name: merchant.name,
    zoneId: merchant.zoneId,
    category: merchant.category,
    participationStatus: merchant.participationStatus ?? "partner",
    source: merchant.source ?? "seeded",
    latitude: merchant.latitude ?? null,
    longitude: merchant.longitude ?? null,
    data: toJson(merchant),
  };
}

function merchantWhere(filter: MerchantListFilter) {
  const where: Record<string, unknown> = {};
  if (filter.ids?.length) where.id = { in: filter.ids };
  if (filter.zoneId) where.zoneId = filter.zoneId;
  if (filter.category) where.category = filter.category;
  if (filter.participationStatus) where.participationStatus = filter.participationStatus;
  if (filter.source) where.source = filter.source;
  if (filter.query?.trim()) {
    const query = filter.query.trim();
    where.OR = [
      { name: { contains: query } },
      { category: { contains: query } },
      { source: { contains: query } },
      { participationStatus: { contains: query } },
    ];
  }
  return where;
}

function toJson(value: unknown) {
  return JSON.stringify(value);
}

function fromJson<T>(value: unknown): T {
  if (typeof value === "string") {
    return JSON.parse(value) as T;
  }
  return clone(value) as T;
}

function merchantImportRunToRow(run: MerchantImportRun) {
  return {
    id: run.id,
    zoneId: run.zoneId,
    status: run.status,
    requestedRadiusMeters: run.requestedRadiusMeters,
    radiusMeters: run.radiusMeters,
    categoriesJson: toJson(run.categories),
    categoryCapsJson: toJson(run.categoryCaps),
    maxImportedMerchants: run.maxImportedMerchants,
    maxTilesPerRun: run.maxTilesPerRun,
    importedCount: run.importedCount,
    failedCount: run.failedCount,
    continuationCursor: run.continuationCursor ?? null,
    warningsJson: toJson(run.warnings ?? []),
    errorJson: run.errorJson ? toJson(run.errorJson) : null,
    providerStatsJson: toJson(run.providerStatsJson ?? {}),
    startedAt: new Date(run.startedAt),
    completedAt: run.completedAt ? new Date(run.completedAt) : null,
    updatedAt: new Date(run.updatedAt),
  };
}

function merchantImportRunFromRow(row: any): MerchantImportRun {
  return {
    id: row.id,
    zoneId: row.zoneId,
    status: row.status,
    requestedRadiusMeters: row.requestedRadiusMeters,
    radiusMeters: row.radiusMeters,
    categories: fromJson<MerchantImportRun["categories"]>(row.categoriesJson),
    categoryCaps: fromJson<MerchantImportRun["categoryCaps"]>(row.categoryCapsJson),
    maxImportedMerchants: row.maxImportedMerchants,
    maxTilesPerRun: row.maxTilesPerRun,
    importedCount: row.importedCount,
    failedCount: row.failedCount,
    continuationCursor: row.continuationCursor ?? null,
    warnings: row.warningsJson ? fromJson<string[]>(row.warningsJson) : [],
    errorJson: row.errorJson ? fromJson<Record<string, unknown>>(row.errorJson) : null,
    providerStatsJson: row.providerStatsJson ? fromJson<Record<string, unknown>>(row.providerStatsJson) : {},
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function orchestrationRunFromRow(row: any): OrchestrationRun {
  return {
    idempotencyKey: row.idempotencyKey,
    userId: row.userId,
    eventType: row.eventType,
    contextSnapshotId: row.contextSnapshotId ?? undefined,
    status: row.status,
    resultJson: row.resultJson ? fromJson<Record<string, unknown>>(row.resultJson) : null,
    errorJson: row.errorJson ? fromJson<Record<string, unknown>>(row.errorJson) : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

let singletonRepository: CityWalletRepository | undefined;

export function createRepository(): CityWalletRepository {
  if (process.env.CITY_WALLET_REPOSITORY === "prisma") {
    return new PrismaRepository();
  }
  return new SeededRepository();
}

export function getRepository(): CityWalletRepository {
  if (!singletonRepository) {
    singletonRepository = createRepository();
  }
  return singletonRepository;
}

export function setRepositoryForTests(repository: CityWalletRepository | undefined) {
  singletonRepository = repository;
}
