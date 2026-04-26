"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, MapPin, RefreshCw, Sliders, Sparkles, X } from "lucide-react";
import type {
  AnalyticsEvent,
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
  OfferCard,
  PhoneFrame,
  ProviderBadge,
  Section,
  TrustNote,
  ValidityPill,
} from "@city-wallet/ui";
import {
  apiGet,
  claimOffer,
  fetchConnectedSources,
  fetchContextProfileVersion,
  fetchContextSummary,
  orchestrate,
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
  events: AnalyticsEvent[];
  lastRun: OrchestrationResult | null;
  activeMockProfile: ActiveMockProfileSummary | null;
};

const FOREGROUND_THROTTLE_MS = 30_000;
const REFRESH_DEBOUNCE_MS = 1_500;
const LOCATION_CHANGE_THRESHOLD_METERS = 50;

export function WalletApp() {
  const [state, setState] = useState<ConsumerState | null>(null);
  const [lastRun, setLastRun] = useState<OrchestrationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [connectedSources, setConnectedSources] = useState<ConnectedSourceChip[]>([]);
  const [contextSummary, setContextSummary] = useState<Awaited<ReturnType<typeof fetchContextSummary>> | null>(null);
  const [debugMode, setDebugMode] = useState(false);
  const [locationGranted, setLocationGranted] = useState(false);
  const [locationCoords, setLocationCoords] = useState<{ latitude: number; longitude: number; accuracyMeters?: number } | null>(null);
  const [whyOpen, setWhyOpen] = useState(false);
  const [profileVersion, setProfileVersion] = useState<number>(0);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const lastForegroundAt = useRef(0);
  const lastRefreshAt = useRef(0);
  const autoStarted = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setDebugMode(new URLSearchParams(window.location.search).get("debug") === "true");
  }, []);

  const userId = "user_mia";

  const load = useCallback(async () => {
    const [next, sources, summary] = await Promise.all([
      apiGet<ConsumerState>(`/api/consumer/state?userId=${userId}`),
      fetchConnectedSources(userId).catch(() => [] as ConnectedSourceChip[]),
      fetchContextSummary(userId).catch(() => null),
    ]);
    setState(next);
    setLastRun(next.lastRun);
    setConnectedSources(sources);
    setContextSummary(summary);
  }, []);

  const runContextPipeline = useCallback(async (
    eventType:
      | "WalletOpened"
      | "UserDeclaredContextChanged"
      | "UserEnteredZone"
      | "AppReturnedToForeground"
      | "ManualRefreshRequested",
    options?: { coords?: { latitude: number; longitude: number; accuracyMeters?: number } | null },
  ) => {
    setBusy(true);
    setApiError(null);
    try {
      const coords = options?.coords ?? locationCoords;
      const result = await orchestrate({
        userId,
        eventType,
        location: coords ? { ...coords, source: "browser" } : undefined,
      });
      setLastRun(result);
      lastRefreshAt.current = Date.now();
      await load();
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Could not reach City Wallet API.");
      console.error(error);
    } finally {
      setBusy(false);
    }
  }, [load, locationCoords]);

  const requestLocation = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return null;
    return new Promise<{ latitude: number; longitude: number; accuracyMeters?: number } | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracyMeters: position.coords.accuracy }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 5_000, maximumAge: 60_000 },
      );
    });
  }, []);

  async function handleEnableLocation() {
    const coords = await requestLocation();
    if (coords) {
      setLocationCoords(coords);
      setLocationGranted(true);
      await runContextPipeline("UserEnteredZone", { coords });
    }
  }

  const refresh = useCallback(async () => {
    if (Date.now() - lastRefreshAt.current < REFRESH_DEBOUNCE_MS) return;
    lastRefreshAt.current = Date.now();
    await runContextPipeline("ManualRefreshRequested");
  }, [runContextPipeline]);

  const bootstrap = useCallback(async () => {
    await load();
    await runContextPipeline("WalletOpened");
    fetchContextProfileVersion(userId).then((v) => setProfileVersion(v.version)).catch(() => {});
  }, [load, runContextPipeline, userId]);

  useEffect(() => {
    if (autoStarted.current) return;
    autoStarted.current = true;
    bootstrap().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastForegroundAt.current < FOREGROUND_THROTTLE_MS) return;
      lastForegroundAt.current = now;
      fetchContextProfileVersion(userId)
        .then((v) => {
          if (v.version !== profileVersion) {
            setProfileVersion(v.version);
            void runContextPipeline("AppReturnedToForeground");
          } else {
            void runContextPipeline("AppReturnedToForeground");
          }
        })
        .catch(() => {
          void runContextPipeline("AppReturnedToForeground");
        });
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [profileVersion, runContextPipeline]);

  useEffect(() => {
    if (!locationGranted || typeof navigator === "undefined" || !navigator.geolocation) return;
    const watcher = navigator.geolocation.watchPosition(
      (position) => {
        const next = { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracyMeters: position.coords.accuracy };
        setLocationCoords((prev) => {
          if (!prev) return next;
          const meters = haversine(prev.latitude, prev.longitude, next.latitude, next.longitude);
          if (meters > LOCATION_CHANGE_THRESHOLD_METERS) {
            void runContextPipeline("UserEnteredZone", { coords: next });
            return next;
          }
          return prev;
        });
      },
      undefined,
      { enableHighAccuracy: true, maximumAge: 60_000, timeout: 10_000 },
    );
    return () => navigator.geolocation.clearWatch(watcher);
  }, [locationGranted, runContextPipeline]);

  async function claim(offerId: string) {
    setBusy(true);
    try {
      await claimOffer(offerId);
      await load();
    } finally {
      setBusy(false);
    }
  }

  function dismissOffer() {
    setLastRun(null);
  }

  const handleSavePreferences = useCallback(async (update: UserProfileUpdate) => {
    const saved = await updateUserProfile(userId, update);
    setState((prev) => prev ? { ...prev, profile: saved } : prev);
    setPrefsOpen(false);
    await runContextPipeline("ManualRefreshRequested");
  }, [runContextPipeline, userId]);

  const offer: Offer | null = useMemo(() => lastRun?.offer ?? state?.offers[0] ?? null, [lastRun, state]);
  const profile = state?.profile;
  const context = lastRun?.consumerContext ?? state?.context;
  const reasoning = lastRun?.negotiationDecision?.reasoning ?? offer?.why ?? [];
  const azureRequired = !contextSummary?.assembledUserContext && lastRun;
  const noOfferReason = lastRun?.noOfferReason ?? null;
  const headlineStatus = busy
    ? "thinking"
    : offer
      ? "offer_ready"
      : noOfferReason
        ? "no_offer"
        : "ready";

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
                <ProviderBadge label={context?.zoneName ?? context?.zoneId ?? "loading"} tone="green" />
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
            <p className="mt-2 font-mono text-xs text-ink-muted">
              {context?.weatherDescription ?? "checking weather"} · {context?.timeContext ?? "time"}
            </p>
            {!locationGranted ? (
              <div className="mt-4">
                <Button variant="secondary" onClick={handleEnableLocation}>
                  <MapPin size={16} /> Enable location
                </Button>
              </div>
            ) : null}
            {connectedSources.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {connectedSources
                  .filter((chip) => chip.status !== "not_connected")
                  .slice(0, 8)
                  .map((chip) => (
                    <Badge
                      key={chip.source}
                      tone={chip.status === "connected" ? "green" : chip.status === "simulated_for_demo" ? "blue" : "neutral"}
                    >
                      {chip.label}
                    </Badge>
                  ))}
              </div>
            ) : null}
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
            <div className="flex items-center justify-between px-2">
              <h2 className="label-tag font-semibold text-ink-muted">Live Local Offer</h2>
              {busy ? (
                <Badge tone="orange">thinking…</Badge>
              ) : offer ? (
                <ValidityPill minutes={offer.validityMinutes} />
              ) : (
                <Badge>{headlineStatus}</Badge>
              )}
            </div>

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

            {!offer && !busy && !apiError ? (
              <div className="surface-card rounded-2xl p-6 text-center">
                <Sparkles className="mx-auto mb-3 text-teal" size={20} />
                <p className="mb-2 font-serif text-lg">{noOfferReason ? "No good local offer right now." : "Check for a relevant local offer."}</p>
                <p className="mb-4 text-sm text-ink-muted">
                  {noOfferReason
                    ? "We'd rather show nothing than a noisy offer."
                    : "City Wallet quietly checks the local context for a useful nearby moment."}
                </p>
                <div className="flex justify-center gap-2">
                  <Button onClick={refresh}>
                    <RefreshCw size={16} /> Refresh
                  </Button>
                </div>
              </div>
            ) : null}

            {busy && !offer ? (
              <div className="surface-card flex items-center gap-3 rounded-2xl p-6">
                <Loader2 className="animate-spin text-teal" size={18} />
                <div className="text-sm text-ink-muted">Checking for a useful local offer…</div>
              </div>
            ) : null}

            {offer ? (
              <>
                <OfferCard offer={offer} disabled={busy} onClaim={() => claim(offer.offerId)} />
                <div className="flex justify-end">
                  <Button variant="ghost" onClick={dismissOffer}>Dismiss</Button>
                </div>
              </>
            ) : null}

            {offer || lastRun ? (
              <div className="surface-card rounded-2xl p-4">
                <button
                  type="button"
                  onClick={() => setWhyOpen((prev) => !prev)}
                  className="flex w-full items-center justify-between text-sm font-medium"
                >
                  <span>Why this?</span>
                  <span className="font-mono text-xs text-ink-muted">{whyOpen ? "hide" : "show"}</span>
                </button>
                {whyOpen ? (
                  <div className="mt-3 space-y-2 text-sm">
                    {reasoning.length > 0 ? (
                      <ol className="space-y-1.5">
                        {reasoning.map((line, index) => (
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

            <TrustNote />
          </div>
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
                City Wallet listens to your context and only surfaces a moment when one is genuinely useful nearby.
                It never shows raw data, scores, or developer logs in this view.
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
                  <Button variant="secondary" onClick={() => runContextPipeline("UserEnteredZone")}>
                    <MapPin size={16} /> Re-run
                  </Button>
                  <Button onClick={refresh} disabled={busy}>
                    <RefreshCw size={16} /> Manual refresh
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <JsonPanel title="Context summary" data={contextSummary} />
                <JsonPanel title="Connected sources" data={connectedSources} />
              </div>

              <ExplainabilityPanel title="Pipeline traces">
                <div className="grid gap-4 lg:grid-cols-2">
                  <JsonPanel title="Assembled user context" data={lastRun?.assembledUserContext ?? null} />
                  <JsonPanel title="User negotiation position" data={lastRun?.userNegotiationPosition ?? null} />
                  <JsonPanel title="Agent trace" data={lastRun?.agentTrace ?? null} />
                  <JsonPanel title="Negotiation decision" data={lastRun?.negotiationDecision ?? null} />
                  <JsonPanel title="Validation" data={lastRun?.validationResult ?? null} />
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

function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6_371_000;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dPhi = ((lat2 - lat1) * Math.PI) / 180;
  const dLambda = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dPhi / 2) * Math.sin(dPhi / 2) + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) * Math.sin(dLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
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
