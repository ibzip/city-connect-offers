"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import type { AnalyticsEvent, ConsumerContextSnapshot, Offer, OrchestrationResult, RedemptionToken, UserProfile } from "@city-wallet/contracts";
import { Badge, Button, ExplainabilityPanel, JsonPanel, OfferCard, PhoneFrame, ProviderBadge, Section, TrustNote, ValidityPill } from "@city-wallet/ui";
import { apiGet, claimOffer, orchestrate } from "./api";

type ConsumerState = {
  profile: UserProfile | null;
  context: ConsumerContextSnapshot | null;
  offers: Offer[];
  tokens: RedemptionToken[];
  events: AnalyticsEvent[];
  lastRun: OrchestrationResult | null;
};

export function WalletApp() {
  const [state, setState] = useState<ConsumerState | null>(null);
  const [lastRun, setLastRun] = useState<OrchestrationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [declaredIntent, setDeclaredIntent] = useState("warm_city_break");
  const [availableMinutes, setAvailableMinutes] = useState(30);
  const [rewardPreference, setRewardPreference] = useState<"cashback" | "discount" | "either">("cashback");

  async function load() {
    const next = await apiGet<ConsumerState>("/api/consumer/state?userId=user_mia");
    setState(next);
    setLastRun(next.lastRun);
    if (next.context) {
      setDeclaredIntent(next.context.declaredIntent);
      setAvailableMinutes(next.context.availableMinutes);
      setRewardPreference(next.context.rewardPreference);
    }
  }

  useEffect(() => {
    load().catch(console.error);
  }, []);

  async function findOffer() {
    setBusy(true);
    try {
      const result = await orchestrate({
        userId: "user_mia",
        eventType: "UserDeclaredContextChanged",
        declaredContext: { intent: declaredIntent, availableMinutes, rewardPreference },
      });
      setLastRun(result);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function claim(offerId: string) {
    setBusy(true);
    try {
      await claimOffer(offerId);
      await load();
    } finally {
      setBusy(false);
    }
  }

  const offer = useMemo(() => lastRun?.offer ?? state?.offers[0] ?? null, [lastRun, state]);
  const profile = state?.profile;
  const context = lastRun?.consumerContext ?? state?.context;
  const reasoning = lastRun?.negotiationDecision?.reasoning ?? offer?.why ?? [];

  return (
    <Section>
      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[380px_1fr]">
        <PhoneFrame>
          <div className="px-7 pb-5 pt-9">
            <div className="mb-7 flex items-center justify-between">
              <div className="flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-paper font-serif italic text-teal">
                {profile?.displayName?.[0] ?? "M"}
              </div>
              <ProviderBadge label={context?.zoneId ?? "loading"} tone="green" />
            </div>
            <p className="mb-1 text-sm font-medium text-ink-muted">Hello, {profile?.displayName ?? "Mia"}</p>
            <h1 className="font-serif text-3xl font-medium tracking-tight">€1,482.90</h1>
            <p className="mt-2 font-mono text-xs text-ink-muted">{context?.weatherDescription ?? "loading context"} · {context?.timeContext ?? "time"}</p>
          </div>

          <div className="surface-paper flex flex-1 flex-col gap-5 overflow-y-auto rounded-t-[2rem] px-5 py-7">
            <div className="flex items-center justify-between px-2">
              <h2 className="label-tag font-semibold text-ink-muted">Live Local Offer</h2>
              {busy ? <Badge tone="orange">thinking...</Badge> : offer ? <ValidityPill minutes={offer.validityMinutes} /> : <Badge>ready</Badge>}
            </div>

            {!offer && !busy ? (
              <div className="surface-card rounded-2xl p-6 text-center">
                <Sparkles className="mx-auto mb-3 text-teal" size={20} />
                <p className="mb-2 font-serif text-lg">Find a relevant local offer</p>
                <p className="mb-4 text-sm text-ink-muted">The wallet sends a user-side event to the API Gateway. Services decide whether an offer is useful enough to show.</p>
                <Button onClick={findOffer}>Find relevant offer</Button>
              </div>
            ) : null}

            {busy ? (
              <div className="surface-card flex items-center gap-3 rounded-2xl p-6">
                <Loader2 className="animate-spin text-teal" size={18} />
                <div className="text-sm text-ink-muted">City Wallet is negotiating a bounded local offer...</div>
              </div>
            ) : null}

            {offer ? <OfferCard offer={offer} disabled={busy} onClaim={() => claim(offer.offerId)} /> : null}
            <TrustNote />
          </div>
        </PhoneFrame>

        <div className="surface-acrylic flex min-h-[760px] flex-col gap-6 rounded-[2rem] p-6 lg:p-8">
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-black/5 pb-5">
            <div>
              <div className="mb-2 flex items-center gap-3">
                <div className={busy ? "h-2 w-2 animate-pulse rounded-full bg-amber-500" : "h-2 w-2 rounded-full bg-teal"} />
                <span className="label-tag text-teal">{busy ? "negotiating" : "consumer wallet"}</span>
              </div>
              <h2 className="font-serif text-2xl font-medium">Context Event</h2>
            </div>
            <Button onClick={findOffer} disabled={busy}>{busy ? "Finding..." : "Find relevant offer"}</Button>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <label className="surface-card rounded-2xl p-4 text-sm">
              <span className="mb-2 block text-xs uppercase tracking-wider text-ink-muted">Intent</span>
              <select className="w-full rounded-lg border bg-paper px-3 py-2" value={declaredIntent} onChange={(event) => setDeclaredIntent(event.target.value)}>
                <option value="warm_city_break">warm_city_break</option>
                <option value="quick_lunch">quick_lunch</option>
                <option value="gift_moment">gift_moment</option>
              </select>
            </label>
            <label className="surface-card rounded-2xl p-4 text-sm">
              <span className="mb-2 block text-xs uppercase tracking-wider text-ink-muted">Minutes</span>
              <input className="w-full rounded-lg border bg-paper px-3 py-2" type="number" min={10} max={90} value={availableMinutes} onChange={(event) => setAvailableMinutes(Number(event.target.value))} />
            </label>
            <label className="surface-card rounded-2xl p-4 text-sm">
              <span className="mb-2 block text-xs uppercase tracking-wider text-ink-muted">Reward</span>
              <select className="w-full rounded-lg border bg-paper px-3 py-2" value={rewardPreference} onChange={(event) => setRewardPreference(event.target.value as "cashback" | "discount" | "either")}>
                <option value="cashback">cashback</option>
                <option value="discount">discount</option>
                <option value="either">either</option>
              </select>
            </label>
          </div>

          <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
            <div className="space-y-4">
              <div className="surface-card rounded-2xl p-5">
                <Badge tone="green">context</Badge>
                <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
                  <div><dt className="text-ink-muted">Weather</dt><dd>{context?.weatherDescription ?? "-"}</dd></div>
                  <div><dt className="text-ink-muted">Time</dt><dd>{context?.timeContext ?? "-"}</dd></div>
                  <div><dt className="text-ink-muted">Walk</dt><dd>{context?.walkingToleranceMeters ?? "-"}m</dd></div>
                  <div><dt className="text-ink-muted">Offers/hour</dt><dd>{context?.maxOffersPerHour ?? "-"}</dd></div>
                </dl>
              </div>

              {offer ? (
                <ExplainabilityPanel title="Why this offer?">
                  <div className="space-y-4">
                    <ol className="space-y-2">
                      {reasoning.map((line, index) => <li key={line} className="flex gap-3"><span className="font-mono text-xs text-ink-muted">{String(index + 1).padStart(2, "0")}</span><span>{line}</span></li>)}
                    </ol>
                    <div className="grid gap-3 lg:grid-cols-2">
                      <MiniJson title="Trigger" data={lastRun?.matchedTriggers ?? []} />
                      <MiniJson title="Context" data={context} />
                      <MiniJson title="Brief" data={lastRun?.negotiationBrief ?? null} />
                      <MiniJson title="Decision" data={lastRun?.negotiationDecision ?? null} />
                      <MiniJson title="Validation" data={lastRun?.validationResult ?? null} />
                      <MiniJson title="Offer" data={offer} />
                      <MiniJson title="Events" data={lastRun?.analyticsEvents ?? state?.events ?? []} />
                    </div>
                  </div>
                </ExplainabilityPanel>
              ) : null}

              {lastRun ? <JsonPanel title="Validation" data={lastRun.validationResult} /> : null}
            </div>
            <div className="space-y-3">
              <Badge>Candidate Matrix</Badge>
              {(lastRun?.candidateMerchants ?? []).map((candidate) => (
                <div key={candidate.merchantId} className={candidate.considered ? "rounded-lg border border-teal/30 bg-teal/5 p-3" : "rounded-lg border border-black/10 bg-black/5 p-3 opacity-70"}>
                  <div className="mb-1 flex items-start justify-between gap-3">
                    <span className="text-xs font-bold">{candidate.merchantName}</span>
                    <span className="font-mono text-[10px] tabular-nums">{candidate.fitScore}</span>
                  </div>
                  <p className="text-[11px] leading-snug text-ink-muted">{candidate.considered ? candidate.reason : candidate.rejectedReason}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}

function MiniJson({ title, data }: { title: string; data: unknown }) {
  return (
    <div className="rounded-xl border border-black/10 bg-paper p-3">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-ink-muted">{title}</div>
      <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-ink/80">
        {data ? JSON.stringify(data, null, 2) : "-"}
      </pre>
    </div>
  );
}
