"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, Loader2, MapPin, RefreshCw, Sliders, Sparkles, X } from "lucide-react";
import type {
  AgentRunMeta,
  AgentTrace,
  AssembledUserContext,
  ConnectedSourceChip,
  ConsumerContextSnapshot,
  Offer,
  OrchestrationResult,
  RedemptionToken,
  UserProfile,
  UserProfileUpdate,
} from "@city-wallet/contracts";
import {
  Badge,
  Button,
  ExplainabilityPanel,
  JsonPanel,
  PhoneFrame,
  ProviderBadge,
  Section,
  TokenCard,
  TrustNote,
  ValidityPill,
} from "@city-wallet/ui";
import {
  apiGet,
  claimOffer,
  fetchConnectedSources,
  fetchContextSummary,
  orchestrate,
  rejectOffer,
  resetUserState,
  reverseGeocode,
  updateUserProfile,
} from "./api";

type ActiveMockProfileSummary = {
  id: string;
  name: string;
  activeScenario: string | null;
  version: number;
  profileOverrides: {
    walkingToleranceMeters?: number;
    maxBundleStops?: number;
    maxOffersPerHour?: number;
    rewardPreference?: "cashback" | "discount" | "either";
    privacyMode?: "low" | "medium" | "high";
    declaredIntent?: string;
    availableMinutes?: number;
  } | null;
};

type ConsumerState = {
  profile: UserProfile | null;
  context: ConsumerContextSnapshot | null;
  offers: Offer[];
  tokens: RedemptionToken[];
  lastRun: OrchestrationResult | null;
  activeMockProfile: ActiveMockProfileSummary | null;
};

type WalletTab = "offers" | "redeem";

// Staged reveal of the lunch-break pipeline. The browser resolves location
// before we ever call the server, and the API returns context + offers in a
// single response — so to make the experience feel sequential we walk the UI
// through these stages one at a time:
//   idle           → notification overlay visible, nothing else interactive
//   locating       → asking the browser for geolocation
//   located        → coords in hand, server hasn't been called yet
//   assembling     → orchestrate() in flight; the LLM is reading context
//   context_ready  → orchestrate() returned; show the assimilated context
//   offers         → finally reveal offer cards
type RevealStage = "idle" | "locating" | "located" | "assembling" | "context_ready" | "offers";

export function WalletApp() {
  const [state, setState] = useState<ConsumerState | null>(null);
  const [lastRun, setLastRun] = useState<OrchestrationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [connectedSources, setConnectedSources] = useState<ConnectedSourceChip[]>([]);
  const [contextSummary, setContextSummary] = useState<Awaited<ReturnType<typeof fetchContextSummary>> | null>(null);
  const [debugMode, setDebugMode] = useState(false);
  const [locationCoords, setLocationCoords] = useState<{ latitude: number; longitude: number; accuracyMeters?: number } | null>(null);
  // Pre-fetched city label, populated in parallel with orchestrate() so the
  // header flips from "resolving…" to the resolved city the moment the
  // dedicated reverse-geocode endpoint answers (Google Geocoding ~150-300ms)
  // — instead of waiting for the full LLM-driven orchestrate pipeline.
  const [cityPreview, setCityPreview] = useState<{ city: string | null; countryCode: string | null } | null>(null);
  const [revealStage, setRevealStage] = useState<RevealStage>("idle");
  const [tab, setTab] = useState<WalletTab>("offers");
  const [rejectedOfferIds, setRejectedOfferIds] = useState<Set<string>>(new Set());
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);
  const bootstrapped = useRef(false);

  // hasTriggered = "we've moved past the notification overlay". Used by the
  // header/body to flip from awaiting-tap to active-pipeline rendering.
  const hasTriggered = revealStage !== "idle";

  useEffect(() => {
    if (typeof window === "undefined") return;
    setDebugMode(new URLSearchParams(window.location.search).get("debug") === "true");
  }, []);

  const userId = "user_mia";

  const loadState = useCallback(async () => {
    const [next, sources, summary] = await Promise.all([
      apiGet<ConsumerState>(`/api/consumer/state?userId=${userId}`),
      fetchConnectedSources(userId).catch(() => [] as ConnectedSourceChip[]),
      fetchContextSummary(userId).catch(() => null),
    ]);
    setState(next);
    setConnectedSources(sources);
    setContextSummary(summary);
    return next;
  }, []);

  // On every wallet load: wipe transient state (offers, tokens, runs, events)
  // and start with a fresh session. The "Time for your lunch break"
  // notification is what kicks off any context/orchestration work.
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    (async () => {
      try {
        await resetUserState(userId);
      } catch (error) {
        console.warn("Failed to reset user state:", error);
      }
      try {
        await loadState();
      } catch (error) {
        setApiError(error instanceof Error ? error.message : "Could not reach City Wallet.");
      }
    })();
  }, [loadState]);

  const requestLocation = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return null;
    return new Promise<{ latitude: number; longitude: number; accuracyMeters?: number } | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
        }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 8_000, maximumAge: 60_000 },
      );
    });
  }, []);

  const triggerLunchPipeline = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setApiError(null);
    setRevealStage("locating");
    try {
      const coords = await requestLocation();
      if (!coords) {
        setApiError("We need your live location to find lunch options nearby. Please allow location and try again.");
        setRevealStage("idle");
        return;
      }
      setLocationCoords(coords);
      setCityPreview(null);
      // Kick off a dedicated reverse-geocode in parallel with the orchestrate
      // call. We don't await it here — whichever finishes first (Google's
      // Geocoding API is typically ~150-300ms) updates the UI; orchestrate
      // takes seconds because it includes the LLM, negotiation, etc.
      void reverseGeocode(coords.latitude, coords.longitude)
        .then((res) => {
          if (res.city || res.countryCode) {
            setCityPreview({ city: res.city, countryCode: res.countryCode });
          }
        })
        .catch(() => {
          // Silent fallback: orchestrate's own reverse-geocode will populate
          // the city when the snapshot lands.
        });
      // Show "located" before we kick off the server work so the user sees
      // the location step land first.
      setRevealStage("located");
      await delay(450);
      setRevealStage("assembling");
      const result = await orchestrate({
        userId,
        eventType: "LunchBreakNotificationClicked",
        location: { ...coords, source: "browser" },
      });
      setLastRun(result);
      await loadState();
      // Reveal the assimilated user context first, then offers, so the user
      // sees what we picked up before the offer cards land.
      setRevealStage("context_ready");
      await delay(700);
      setRevealStage("offers");
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Could not reach City Wallet.");
    } finally {
      setBusy(false);
    }
  }, [busy, loadState, requestLocation]);

  const refresh = useCallback(async () => {
    if (!locationCoords) return triggerLunchPipeline();
    setBusy(true);
    setApiError(null);
    setRevealStage("assembling");
    void reverseGeocode(locationCoords.latitude, locationCoords.longitude)
      .then((res) => {
        if (res.city || res.countryCode) {
          setCityPreview({ city: res.city, countryCode: res.countryCode });
        }
      })
      .catch(() => {});
    try {
      const result = await orchestrate({
        userId,
        eventType: "ManualRefreshRequested",
        location: { ...locationCoords, source: "browser" },
      });
      setLastRun(result);
      await loadState();
      setRevealStage("context_ready");
      await delay(500);
      setRevealStage("offers");
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Could not reach City Wallet.");
    } finally {
      setBusy(false);
    }
  }, [loadState, locationCoords, triggerLunchPipeline]);

  async function handleAccept(offerId: string) {
    setBusy(true);
    try {
      await claimOffer(offerId);
      const next = await loadState();
      // Auto-jump to Redeem tab so the user sees the new token.
      if (next.tokens.length > 0) setTab("redeem");
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Could not accept offer.");
    } finally {
      setBusy(false);
    }
  }

  async function handleReject(offerId: string) {
    setBusy(true);
    setRejectedOfferIds((prev) => {
      const next = new Set(prev);
      next.add(offerId);
      return next;
    });
    try {
      await rejectOffer(offerId);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Could not reject offer.");
    } finally {
      setBusy(false);
    }
  }

  const handleSavePreferences = useCallback(async (update: UserProfileUpdate) => {
    const saved = await updateUserProfile(userId, update);
    setState((prev) => prev ? { ...prev, profile: saved } : prev);
    setPrefsOpen(false);
    if (locationCoords) {
      await refresh();
    }
  }, [locationCoords, refresh, userId]);

  // The DB-backed `state.offers` is authoritative for offer status (it
  // reflects accept/reject/redeem transitions). `lastRun.offers` is a
  // snapshot of the most recent orchestration and goes stale the moment we
  // claim or reject an offer. Merge with state-wins precedence so an
  // accepted offer is no longer marked "shown" and disappears from the list.
  const offers = useMemo<Offer[]>(() => {
    const fromRun = lastRun?.offers && lastRun.offers.length > 0
      ? lastRun.offers
      : lastRun?.offer
        ? [lastRun.offer]
        : [];
    const byId = new Map<string, Offer>();
    for (const offer of state?.offers ?? []) byId.set(offer.offerId, offer);
    for (const offer of fromRun) {
      if (offer && !byId.has(offer.offerId)) byId.set(offer.offerId, offer);
    }
    return Array.from(byId.values()).filter(
      (offer) => !rejectedOfferIds.has(offer.offerId) && offer.status !== "dismissed",
    );
  }, [lastRun, rejectedOfferIds, state]);

  const visibleOffers = useMemo(() => offers.filter((offer) => offer.status === "shown"), [offers]);
  const tokens = state?.tokens ?? [];
  const profile = state?.profile;
  const context = lastRun?.consumerContext ?? state?.context ?? null;
  const noOfferReason = lastRun?.noOfferReason ?? null;

  const azureRequired = !contextSummary?.assembledUserContext && lastRun;

  return (
    <Section>
      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[420px_1fr]">
        <PhoneFrame>
          <div className="px-7 pb-5 pt-9">
            <div className="mb-7 flex items-center justify-between">
              <div className="flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-paper font-serif italic text-teal">
                {profile?.displayName?.[0] ?? "M"}
              </div>
              <div className="flex items-center gap-2">
                <StageBadge
                  stage={revealStage}
                  cityName={
                    cityPreview?.city
                      ? (cityPreview.countryCode ? `${cityPreview.city}, ${cityPreview.countryCode}` : cityPreview.city)
                      : context?.userCityName ?? context?.zoneName ?? null
                  }
                />
                <button
                  type="button"
                  aria-label="Preferences"
                  onClick={() => setPrefsOpen(true)}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-black/10 bg-paper text-ink-muted transition-colors hover:bg-black/5 hover:text-ink"
                >
                  <Sliders size={14} />
                </button>
              </div>
            </div>
            <p className="mb-1 text-sm font-medium text-ink-muted">Hello, {profile?.displayName ?? "Mia"}</p>
            <h1 className="font-serif text-3xl font-medium tracking-tight">€1,482.90</h1>
            {revealStage === "idle" ? (
              <p className="mt-2 font-mono text-xs text-ink-muted">
                Waiting for your lunch reminder.
              </p>
            ) : (
              <LocationStrip
                stage={revealStage}
                coords={locationCoords}
                context={context}
                cityPreview={cityPreview}
              />
            )}
            {debugMode && state?.activeMockProfile ? (
              <div className="mt-3 rounded-md border border-black/10 bg-black/[0.03] px-3 py-2 font-mono text-[10px] uppercase tracking-wide text-ink-muted">
                <div className="font-semibold text-ink">scenario · {state.activeMockProfile.name}</div>
                {state.activeMockProfile.profileOverrides ? (
                  <div className="mt-0.5">
                    walk {state.activeMockProfile.profileOverrides.walkingToleranceMeters ?? "—"}m · stops {state.activeMockProfile.profileOverrides.maxBundleStops ?? "—"} · {state.activeMockProfile.profileOverrides.declaredIntent ?? "—"}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="surface-paper flex flex-1 flex-col gap-5 overflow-y-auto rounded-t-[2rem] px-5 py-7">
            {revealStage === "locating" || revealStage === "located" || revealStage === "assembling" ? (
              <PipelineStepCard
                icon={<MapPin size={16} />}
                title={revealStage === "locating" ? "Looking up your live location" : "Got your location"}
                subtitle={
                  revealStage === "locating"
                    ? "Sharing GPS just for this lunch break."
                    : locationCoords
                      ? `±${Math.round(locationCoords.accuracyMeters ?? 0)}m around ${locationCoords.latitude.toFixed(4)}, ${locationCoords.longitude.toFixed(4)}`
                      : "Coordinates ready."
                }
                state={revealStage === "locating" ? "active" : "done"}
              />
            ) : null}

            {revealStage === "assembling" ? (
              <PipelineStepCard
                icon={<Sparkles size={16} />}
                title="Reading your live context"
                subtitle="Turning signals into a useful picture of right now."
                state="active"
              />
            ) : null}

            {(revealStage === "context_ready" || revealStage === "offers") && lastRun ? (
              <AssembledContextPanel
                assembled={lastRun.assembledUserContext ?? null}
                fallbackContext={context}
              />
            ) : null}

            {revealStage === "offers" ? (
              <div className="flex items-center gap-1 rounded-full border border-black/10 bg-paper p-1 text-xs">
                <TabButton active={tab === "offers"} onClick={() => setTab("offers")}>
                  Offers {visibleOffers.length > 0 ? `· ${visibleOffers.length}` : ""}
                </TabButton>
                <TabButton active={tab === "redeem"} onClick={() => setTab("redeem")}>
                  Redeem {tokens.length > 0 ? `· ${tokens.length}` : ""}
                </TabButton>
              </div>
            ) : null}

            {apiError ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
                <div className="mb-1 font-semibold">Could not reach City Wallet</div>
                <p>{apiError}</p>
                <div className="mt-3">
                  <Button variant="secondary" onClick={refresh}>
                    <RefreshCw size={14} /> Try again
                  </Button>
                </div>
              </div>
            ) : null}

            {revealStage === "offers" && tab === "offers" ? (
              <>
                <div className="flex items-center justify-between px-2">
                  <h2 className="label-tag font-semibold text-ink-muted">Live local offers</h2>
                  {busy ? <Badge tone="orange">thinking…</Badge> : null}
                </div>

                {!busy && visibleOffers.length === 0 ? (
                  <div className="surface-card rounded-2xl p-6 text-center">
                    <Sparkles className="mx-auto mb-3 text-teal" size={20} />
                    <p className="mb-2 font-serif text-lg">{noOfferReason ? "No good local offer right now." : "Nothing matches your context yet."}</p>
                    <p className="mb-4 text-sm text-ink-muted">
                      {noOfferReason ? humanizeReason(noOfferReason) + "." : "We'd rather show nothing than a noisy offer."}
                    </p>
                    <div className="flex justify-center gap-2">
                      <Button onClick={refresh}>
                        <RefreshCw size={16} /> Refresh
                      </Button>
                    </div>
                  </div>
                ) : null}

                {visibleOffers.map((offer) => (
                  <OfferReviewCard
                    key={offer.offerId}
                    offer={offer}
                    busy={busy}
                    onAccept={() => handleAccept(offer.offerId)}
                    onReject={() => handleReject(offer.offerId)}
                  />
                ))}

                {(visibleOffers.length > 0 || lastRun) ? (
                  <div className="surface-card rounded-2xl p-4">
                    <button
                      type="button"
                      onClick={() => setWhyOpen((prev) => !prev)}
                      className="flex w-full items-center justify-between text-sm font-medium"
                    >
                      <span>Why these?</span>
                      <span className="font-mono text-xs text-ink-muted">{whyOpen ? "hide" : "show"}</span>
                    </button>
                    {whyOpen ? (
                      <div className="mt-3 space-y-2 text-sm">
                        {lastRun?.negotiationDecision?.reasoning?.length ? (
                          <ol className="space-y-1.5">
                            {lastRun.negotiationDecision.reasoning.map((line, index) => (
                              <li key={`${line}-${index}`} className="flex gap-2">
                                <span className="font-mono text-xs text-ink-muted">{String(index + 1).padStart(2, "0")}</span>
                                <span>{line}</span>
                              </li>
                            ))}
                          </ol>
                        ) : (
                          <p className="text-ink-muted">{noOfferReason ? `No offer: ${humanizeReason(noOfferReason)}.` : "Nothing to negotiate just yet."}</p>
                        )}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : null}

            {revealStage === "offers" && tab === "redeem" ? (
              <>
                <div className="flex items-center justify-between px-2">
                  <h2 className="label-tag font-semibold text-ink-muted">Ready to redeem</h2>
                  <Badge>{tokens.length} ready</Badge>
                </div>
                {tokens.length === 0 ? (
                  <div className="surface-card rounded-2xl p-6 text-center text-sm text-ink-muted">
                    Accepted offers show up here as redemption codes.
                  </div>
                ) : (
                  tokens.map((token) => <TokenCard key={token.tokenId} token={token} />)
                )}
              </>
            ) : null}

            <TrustNote />
          </div>
          {revealStage === "idle" ? (
            <LunchBreakNotification busy={busy} onActivate={triggerLunchPipeline} />
          ) : null}
          {prefsOpen && profile ? (
            <PreferencesSheet
              profile={profile}
              busy={busy}
              onSave={handleSavePreferences}
              onClose={() => setPrefsOpen(false)}
            />
          ) : null}
        </PhoneFrame>

        <div className="space-y-6">
          {!debugMode ? (
            <div className="surface-acrylic rounded-2xl p-6 text-sm text-ink-muted">
              <p className="font-serif text-lg text-ink">Quiet, on-the-side wallet</p>
              <p className="mt-2">
                City Wallet listens to your context only when you ask it to. The lunch reminder is the trigger;
                from there, your live location, weather, and calendar shape the offers we'll surface.
              </p>
              <p className="mt-3 text-xs">
                Builders: append <code>?debug=true</code> to this URL to see the full pipeline detail.
              </p>
            </div>
          ) : (
            <div className="surface-acrylic flex min-h-[760px] flex-col gap-6 rounded-[2rem] p-6 lg:p-8">
              {azureRequired && lastRun?.agentTrace?.assembler?.errorType === "azure_required" ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  Debug: User context agents require Azure OpenAI. Set <code>LLM_PROVIDER=azure_openai</code> and configure Azure secrets to run the assembler and user negotiator.
                </div>
              ) : null}
              <div className="flex flex-wrap items-end justify-between gap-4 border-b border-black/5 pb-5">
                <div>
                  <div className="mb-2 flex items-center gap-3">
                    <div className={busy ? "h-2 w-2 animate-pulse rounded-full bg-amber-500" : "h-2 w-2 rounded-full bg-teal"} />
                    <span className="label-tag text-teal">{busy ? "negotiating" : "consumer wallet (debug)"}</span>
                  </div>
                  <h2 className="font-serif text-2xl font-medium">Pipeline debug</h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={refresh} disabled={busy}>
                    <RefreshCw size={16} /> Manual refresh
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <JsonPanel title="Live coordinates" data={locationCoords} />
                <JsonPanel title="Consumer context" data={context} />
                <JsonPanel title="Context summary" data={contextSummary} />
                <JsonPanel title="Connected sources" data={connectedSources} />
              </div>

              <ExplainabilityPanel title="Pipeline traces">
                <div className="grid gap-4 lg:grid-cols-2">
                  <JsonPanel title="Assembled user context" data={lastRun?.assembledUserContext ?? null} />
                  <JsonPanel title="User negotiation position" data={lastRun?.userNegotiationPosition ?? null} />
                  <AgentTraceSummary trace={lastRun?.agentTrace ?? null} />
                  <JsonPanel title="Agent trace (raw)" data={lastRun?.agentTrace ?? null} />
                  <JsonPanel title="Negotiation decision" data={lastRun?.negotiationDecision ?? null} />
                  <JsonPanel title="Validation" data={lastRun?.validationResult ?? null} />
                  <JsonPanel title="Run offers" data={lastRun?.offers ?? []} />
                  <JsonPanel title="Candidate matrix" data={lastRun?.candidateMerchants ?? []} />
                </div>
              </ExplainabilityPanel>
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function AgentTraceSummary({ trace }: { trace: AgentTrace | null | undefined }) {
  return (
    <div className="surface-acrylic flex flex-col gap-3 rounded-2xl p-4 text-xs text-ink">
      <div className="font-serif text-sm font-medium text-ink">Agent stages</div>
      {trace ? (
        <div className="flex flex-col gap-2">
          <AgentStageRow label="Assembler" meta={trace.assembler} />
          <AgentStageRow label="User negotiator" meta={trace.userNegotiator} />
          <AgentStageRow label="Backend negotiator" meta={trace.backendNegotiator ?? null} />
        </div>
      ) : (
        <div className="text-ink-muted">No agent trace available yet.</div>
      )}
    </div>
  );
}

function AgentStageRow({ label, meta }: { label: string; meta: AgentRunMeta | null | undefined }) {
  if (!meta) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-black/5 bg-white/40 px-3 py-2">
        <span className="font-medium text-ink">{label}</span>
        <span className="text-ink-muted">— not run</span>
      </div>
    );
  }
  const status = meta.validationStatus;
  const tone =
    status === "ok"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : status === "repaired"
      ? "bg-amber-50 text-amber-800 border-amber-200"
      : status === "skipped"
      ? "bg-slate-50 text-slate-600 border-slate-200"
      : "bg-rose-50 text-rose-700 border-rose-200";
  return (
    <div className={`flex flex-col gap-1 rounded-xl border px-3 py-2 ${tone}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">{label}</span>
        <span className="font-mono text-[11px] uppercase tracking-wide">{status}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-ink-muted">
        {meta.provider ? <span>provider: {meta.provider}</span> : null}
        {meta.model ? <span>model: {meta.model}</span> : null}
        {typeof meta.latencyMs === "number" ? <span>latency: {meta.latencyMs}ms</span> : null}
        {meta.errorType ? <span className="text-rose-700">error: {meta.errorType}</span> : null}
      </div>
    </div>
  );
}

function StageBadge({
  stage,
  cityName,
}: {
  stage: RevealStage;
  cityName: string | null;
}) {
  if (stage === "idle") return <ProviderBadge label="awaiting tap" tone="blue" />;
  if (stage === "locating") return <ProviderBadge label="locating you…" tone="blue" />;
  // Once we have any resolved city label (from the parallel reverse-geocode
  // call), surface it immediately — even if the full orchestrate pipeline is
  // still running. Otherwise stay on the active step label.
  if (cityName) return <ProviderBadge label={cityName} tone="green" />;
  if (stage === "located") return <ProviderBadge label="located ✓" tone="green" />;
  if (stage === "assembling") return <ProviderBadge label="reading context…" tone="purple" />;
  return <ProviderBadge label="live" tone="green" />;
}

function LocationStrip({
  stage,
  coords,
  context,
  cityPreview,
}: {
  stage: RevealStage;
  coords: { latitude: number; longitude: number; accuracyMeters?: number } | null;
  context: ConsumerContextSnapshot | null;
  cityPreview: { city: string | null; countryCode: string | null } | null;
}) {
  // Prefer the dedicated reverse-geocode result (lands fast, parallel to
  // orchestrate). Fall back to whatever the orchestrate snapshot ultimately
  // provides.
  const previewCity = cityPreview?.city ?? null;
  const previewCountry = cityPreview?.countryCode ?? null;
  const cityLabel = previewCity ?? context?.userCityName ?? context?.zoneName ?? null;
  const countryCode = previewCountry ?? context?.userCountryCode ?? null;
  const weatherLabel = context?.weatherDescription ?? context?.weatherMood ?? null;
  const orchestrateDone = stage === "context_ready" || stage === "offers";
  const cityResolved = Boolean(cityLabel) || orchestrateDone;
  return (
    <div className="mt-3 space-y-1 font-mono text-[11px] text-ink-muted">
      {coords ? (
        <div>
          <span className="font-semibold text-ink">live</span> · {coords.latitude.toFixed(4)}, {coords.longitude.toFixed(4)}
          {coords.accuracyMeters ? ` (±${Math.round(coords.accuracyMeters)} m)` : ""}
        </div>
      ) : (
        <div>
          <span className="font-semibold text-ink">live</span> · resolving…
        </div>
      )}
      <div>
        <span className="font-semibold text-ink">city</span> · {cityResolved ? (cityLabel ?? "—") : "resolving…"}
        {cityResolved && countryCode ? ` (${countryCode.toUpperCase()})` : ""}
      </div>
      {orchestrateDone && weatherLabel ? (
        <div>
          <span className="font-semibold text-ink">weather</span> · {weatherLabel}
        </div>
      ) : null}
    </div>
  );
}

function LunchBreakNotification({
  busy,
  onActivate,
}: {
  busy: boolean;
  onActivate: () => void;
}) {
  return (
    <div className="absolute inset-0 z-30 flex flex-col">
      <button
        type="button"
        aria-label="Dismiss notification and load offers"
        onClick={onActivate}
        disabled={busy}
        className="absolute inset-0 cursor-pointer bg-black/20 backdrop-blur-md transition-colors hover:bg-black/30 disabled:cursor-wait"
      />
      <button
        type="button"
        onClick={onActivate}
        disabled={busy}
        className="surface-card animate-fade-in relative mx-3 mt-3 flex items-start gap-3 rounded-2xl border border-white/40 bg-white/95 p-3 text-left shadow-2xl transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:opacity-70"
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal text-white">
          <Bell size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-wider text-ink-muted">
            <span>City Wallet</span>
            <span>now</span>
          </div>
          <div className="mt-0.5 font-serif text-[15px] font-medium leading-snug">
            Time for your lunch break
          </div>
          <p className="mt-0.5 text-xs leading-snug text-ink-muted">
            Tap to share your live location and find a useful spot nearby.
          </p>
        </div>
        {busy ? (
          <Loader2 className="mt-1 animate-spin text-teal" size={14} />
        ) : (
          <MapPin className="mt-1 text-teal" size={14} />
        )}
      </button>
    </div>
  );
}

function PipelineStepCard({
  icon,
  title,
  subtitle,
  state,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  state: "active" | "done";
}) {
  return (
    <div className="surface-card animate-fade-in flex items-center gap-3 rounded-2xl p-4">
      <div className={
        state === "active"
          ? "flex h-9 w-9 items-center justify-center rounded-full bg-teal/10 text-teal"
          : "flex h-9 w-9 items-center justify-center rounded-full bg-green-100 text-green-700"
      }>
        {state === "active" ? <Loader2 className="animate-spin" size={16} /> : icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-ink">{title}</div>
        <p className="mt-0.5 text-xs text-ink-muted">{subtitle}</p>
      </div>
    </div>
  );
}

function AssembledContextPanel({
  assembled,
  fallbackContext,
}: {
  assembled: AssembledUserContext | null;
  fallbackContext: ConsumerContextSnapshot | null;
}) {
  const chips = useMemo(() => buildContextChips(assembled, fallbackContext), [assembled, fallbackContext]);
  const summary = assembled?.currentStateSummary
    ?? (fallbackContext ? buildFallbackSummary(fallbackContext) : null);
  const evidence = assembled?.evidence ?? [];
  const likelyGood = assembled?.likelyGoodCategories ?? [];

  if (!assembled && !fallbackContext) return null;

  return (
    <div className="surface-card animate-fade-in flex flex-col gap-3 rounded-2xl p-4">
      <div className="flex items-center justify-between">
        <h2 className="label-tag font-semibold text-ink-muted">What we picked up</h2>
        <Badge tone="purple">{assembled ? "from your live signals" : "from your context"}</Badge>
      </div>
      {summary ? (
        <p className="text-sm leading-relaxed text-ink">{summary}</p>
      ) : null}
      {chips.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <Badge key={chip.key} tone={chip.tone}>{chip.label}</Badge>
          ))}
        </div>
      ) : null}
      {likelyGood.length > 0 ? (
        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
            Categories that fit
          </div>
          <div className="flex flex-wrap gap-1.5">
            {likelyGood.slice(0, 6).map((category) => (
              <Badge key={category} tone="green">{humanizeToken(category)}</Badge>
            ))}
          </div>
        </div>
      ) : null}
      {evidence.length > 0 ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs font-medium text-ink-muted hover:text-ink">
            Why we think this · {evidence.length} signal{evidence.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-2 space-y-1 pl-1 text-xs text-ink-muted">
            {evidence.map((line, index) => (
              <li key={`${line}-${index}`} className="flex gap-2">
                <span className="font-mono text-[10px]">{String(index + 1).padStart(2, "0")}</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

type ContextChip = { key: string; label: string; tone: "neutral" | "blue" | "green" | "purple" | "orange" };

function buildContextChips(
  assembled: AssembledUserContext | null,
  fallback: ConsumerContextSnapshot | null,
): ContextChip[] {
  const chips: ContextChip[] = [];
  if (assembled) {
    if (assembled.inferredIntent) {
      chips.push({ key: "intent", label: humanizeToken(assembled.inferredIntent), tone: "purple" });
    }
    if (assembled.timeContext) {
      chips.push({ key: "time", label: humanizeToken(assembled.timeContext), tone: "neutral" });
    }
    if (assembled.hungerState !== "unknown") {
      chips.push({ key: "hunger", label: `hunger · ${humanizeToken(assembled.hungerState)}`, tone: "orange" });
    }
    if (assembled.moodState !== "unknown") {
      chips.push({ key: "mood", label: `mood · ${humanizeToken(assembled.moodState)}`, tone: "blue" });
    }
    if (assembled.energyState !== "unknown") {
      chips.push({ key: "energy", label: `energy · ${humanizeToken(assembled.energyState)}`, tone: "green" });
    }
    if (assembled.attentionState !== "low_attention") {
      // Show attention only when it's actionable (do-not-interrupt / interruptible / high).
      chips.push({ key: "attention", label: `attention · ${humanizeToken(assembled.attentionState)}`, tone: "neutral" });
    }
    if (typeof assembled.freeWindowMinutes === "number" && assembled.freeWindowMinutes > 0) {
      chips.push({ key: "free", label: `~${assembled.freeWindowMinutes} min free`, tone: "green" });
    }
    if (assembled.timeSensitivity !== "low") {
      chips.push({ key: "sensitivity", label: `time · ${humanizeToken(assembled.timeSensitivity)}`, tone: "orange" });
    }
    return chips;
  }
  // No LLM-derived context — fall back to the deterministic context snapshot
  // so the panel still shows something meaningful (instead of static demo
  // labels like "Calendar / Mobility / Mood").
  if (fallback) {
    if (fallback.timeContext) {
      chips.push({ key: "time", label: humanizeToken(fallback.timeContext), tone: "neutral" });
    }
    if (fallback.declaredIntent) {
      chips.push({ key: "intent", label: humanizeToken(fallback.declaredIntent), tone: "purple" });
    }
    if (typeof fallback.availableMinutes === "number") {
      chips.push({ key: "free", label: `~${fallback.availableMinutes} min free`, tone: "green" });
    }
    if (fallback.weatherMood) {
      chips.push({ key: "weather", label: humanizeToken(fallback.weatherMood), tone: "blue" });
    }
  }
  return chips;
}

function buildFallbackSummary(context: ConsumerContextSnapshot) {
  const parts: string[] = [];
  if (context.userCityName ?? context.zoneName) {
    parts.push(`In ${context.userCityName ?? context.zoneName}`);
  }
  if (context.timeContext) parts.push(humanizeToken(context.timeContext));
  if (context.declaredIntent) parts.push(`looking to ${humanizeToken(context.declaredIntent)}`);
  if (typeof context.availableMinutes === "number") parts.push(`~${context.availableMinutes} min free`);
  if (parts.length === 0) return null;
  return parts.join(" · ") + ".";
}

function humanizeToken(token: string) {
  return token.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "flex-1 rounded-full bg-teal px-3 py-1.5 text-center font-semibold text-white"
          : "flex-1 rounded-full px-3 py-1.5 text-center text-ink-muted hover:text-ink"
      }
    >
      {children}
    </button>
  );
}

function OfferReviewCard({
  offer,
  busy,
  onAccept,
  onReject,
}: {
  offer: Offer;
  busy: boolean;
  onAccept: () => void;
  onReject: () => void;
}) {
  const stops = offer.items.length;
  const totalDistance = offer.items.reduce((sum, item) => sum + item.distanceMeters, 0);
  return (
    <div className="surface-card animate-fade-in flex flex-col gap-4 rounded-2xl p-4">
      <div className="relative overflow-hidden rounded-xl bg-teal p-5">
        <div className="absolute inset-0 bg-gradient-to-t from-black/35 to-transparent" />
        <div className="relative z-10">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-balance font-serif text-xl font-medium leading-tight text-white">{offer.headline}</h3>
            <ValidityPill minutes={offer.validityMinutes} />
          </div>
          <p className="mt-1 text-sm text-white/80">{offer.subheadline}</p>
        </div>
      </div>
      <div className="flex flex-col gap-3 px-2">
        {offer.items.map((item, index) => (
          <div key={item.offerItemId}>
            {index > 0 ? <div className="mb-3 h-px w-full bg-black/5" /> : null}
            <div className="flex items-center justify-between gap-3 text-sm">
              <div className="flex min-w-0 items-center gap-2">
                <div className="h-2 w-2 shrink-0 rounded-full bg-teal" />
                <span className="truncate font-medium">{item.merchantName}</span>
              </div>
              <span className="shrink-0 text-xs text-ink-muted">
                {item.product} · {item.incentivePercent}% cashback · {item.distanceMeters}m
              </span>
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between rounded-xl bg-paper p-3">
        <div className="text-xs text-ink-muted">{stops} stops · ~{totalDistance}m</div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onReject} disabled={busy}>Reject</Button>
          <Button onClick={onAccept} disabled={busy || offer.status !== "shown"}>
            {offer.status === "shown" ? "Accept" : "Claimed"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function humanizeReason(reason: string) {
  return reason.replace(/_/g, " ");
}

const WALKING_PRESETS: Array<{ value: number; label: string }> = [
  { value: 250, label: "Tight (250 m)" },
  { value: 600, label: "Comfortable (600 m)" },
  { value: 1_000, label: "Roomy (1 km)" },
  { value: 2_000, label: "Whole zone (2 km)" },
];

function PreferencesSheet({
  profile,
  busy,
  onSave,
  onClose,
}: {
  profile: UserProfile;
  busy: boolean;
  onSave: (update: UserProfileUpdate) => Promise<void>;
  onClose: () => void;
}) {
  const [walking, setWalking] = useState<number>(profile.walkingToleranceMeters);
  const [stops, setStops] = useState<number>(profile.maxBundleStops);
  const [reward, setReward] = useState<UserProfile["rewardPreference"]>(profile.rewardPreference);
  const [privacy, setPrivacy] = useState<UserProfile["privacyMode"]>(profile.privacyMode);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setSaving(true);
    setError(null);
    try {
      await onSave({
        walkingToleranceMeters: walking,
        maxBundleStops: stops,
        rewardPreference: reward,
        privacyMode: privacy,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save preferences.");
      setSaving(false);
    }
  }

  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-paper">
      <div className="flex items-center justify-between border-b border-black/5 px-6 py-4">
        <h3 className="font-serif text-lg">Preferences</h3>
        <button
          type="button"
          aria-label="Close preferences"
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted hover:bg-black/5 hover:text-ink"
        >
          <X size={16} />
        </button>
      </div>
      <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5 text-sm">
        <section>
          <label className="label-tag mb-2 block font-semibold text-ink-muted">Max walking distance</label>
          <div className="grid grid-cols-2 gap-2">
            {WALKING_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                onClick={() => setWalking(preset.value)}
                className={
                  walking === preset.value
                    ? "rounded-xl border-2 border-teal bg-teal/5 px-3 py-2 text-left text-sm font-medium"
                    : "rounded-xl border border-black/10 bg-paper px-3 py-2 text-left text-sm text-ink-muted hover:border-black/20 hover:text-ink"
                }
              >
                {preset.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-muted">
            We won't suggest places further than this from you.
          </p>
        </section>

        <section>
          <label className="label-tag mb-2 block font-semibold text-ink-muted">Bundle stops</label>
          <div className="flex gap-2">
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setStops(n)}
                className={
                  stops === n
                    ? "flex-1 rounded-xl border-2 border-teal bg-teal/5 px-3 py-2 text-sm font-medium"
                    : "flex-1 rounded-xl border border-black/10 bg-paper px-3 py-2 text-sm text-ink-muted hover:border-black/20 hover:text-ink"
                }
              >
                {n} {n === 1 ? "stop" : "stops"}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-muted">
            How many merchants you're happy to combine in a single bundle.
          </p>
        </section>

        <section>
          <label className="label-tag mb-2 block font-semibold text-ink-muted">Reward preference</label>
          <div className="flex gap-2">
            {(["cashback", "discount", "either"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setReward(option)}
                className={
                  reward === option
                    ? "flex-1 rounded-xl border-2 border-teal bg-teal/5 px-3 py-2 text-sm font-medium capitalize"
                    : "flex-1 rounded-xl border border-black/10 bg-paper px-3 py-2 text-sm capitalize text-ink-muted hover:border-black/20 hover:text-ink"
                }
              >
                {option}
              </button>
            ))}
          </div>
        </section>

        <section>
          <label className="label-tag mb-2 block font-semibold text-ink-muted">Privacy mode</label>
          <div className="flex gap-2">
            {(["high", "medium", "low"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setPrivacy(option)}
                className={
                  privacy === option
                    ? "flex-1 rounded-xl border-2 border-teal bg-teal/5 px-3 py-2 text-sm font-medium capitalize"
                    : "flex-1 rounded-xl border border-black/10 bg-paper px-3 py-2 text-sm capitalize text-ink-muted hover:border-black/20 hover:text-ink"
                }
              >
                {option}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-muted">
            High keeps the most context off the network and prefers fully on-device inference.
          </p>
        </section>

        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-900">{error}</div>
        ) : null}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-black/5 px-6 py-4">
        <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={handleSubmit} disabled={saving || busy}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
