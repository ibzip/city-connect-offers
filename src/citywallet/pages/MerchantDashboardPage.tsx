import { useState } from "react";
import { useAppStore } from "../store/AppStore";
import { SectionCard } from "../components/SectionCard";
import { StatusBadge } from "../components/StatusBadge";
import { LayerBadge } from "../components/LayerBadge";
import { Progress } from "@/components/ui/progress";
import { merchantPaymentDensity } from "../config/merchants";
import { Button } from "@/components/ui/button";

function stateTone(state: string): "success" | "warning" | "danger" | "neutral" {
  if (state === "very_quiet") return "danger";
  if (state === "quiet") return "warning";
  if (state === "busy") return "success";
  return "neutral";
}

export function MerchantDashboardPage() {
  const { state, refreshMerchantInsights } = useAppStore();
  const [selectedId, setSelectedId] = useState(state.merchants[0].id);
  const merchant = state.merchants.find((m) => m.id === selectedId)!;
  const insight = state.insights.find((i) => i.merchantId === selectedId);
  const density = merchantPaymentDensity.find((d) => d.merchantId === selectedId)!;
  const analytics = state.analytics[selectedId];

  return (
    <div className="space-y-6">
      <SectionCard
        title="Merchant dashboard"
        layer="merchant"
        description="Insights are precomputed by merchant-side routines (no live agent)."
        actions={<Button size="sm" variant="outline" onClick={refreshMerchantInsights}>Refresh insights</Button>}
      >
        <div className="grid gap-3 md:grid-cols-3">
          {state.merchants.map((m) => {
            const ins = state.insights.find((i) => i.merchantId === m.id);
            return (
              <button
                key={m.id}
                onClick={() => setSelectedId(m.id)}
                className={`text-left rounded-2xl border p-4 transition-all hover:shadow-soft ${m.id === selectedId ? "border-primary shadow-soft" : "border-border"}`}
              >
                <div className="flex items-center justify-between">
                  <div className="font-semibold">{m.name}</div>
                  {ins ? <StatusBadge tone={stateTone(ins.businessState)}>{ins.businessState.replace("_", " ")}</StatusBadge> : <StatusBadge>no insight</StatusBadge>}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{m.category} · {m.distanceMeters}m</div>
                {ins && (
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <div className="text-muted-foreground">Drop</div>
                      <div className="font-medium">{ins.transactionDropPercent}%</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Urgency</div>
                      <div className="font-medium">{ins.urgencyScore}</div>
                    </div>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </SectionCard>

      {insight ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <SectionCard title="Business state" layer="merchant" className="lg:col-span-2">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={stateTone(insight.businessState)}>{insight.businessState.replace("_", " ")}</StatusBadge>
                {insight.consumerJourneyFitTags.map((t) => <StatusBadge key={t} tone="info">{t.replace(/_/g, " ")}</StatusBadge>)}
              </div>
              <p className="text-sm text-muted-foreground">{insight.insightSummary}</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Metric label="Baseline tx" value={String(density.baselineTransactions)} />
                <Metric label="Current tx" value={String(density.currentTransactions)} />
                <Metric label="Drop %" value={`${insight.transactionDropPercent}%`} tone={insight.transactionDropPercent >= 25 ? "danger" : "neutral"} />
                <Metric label="Urgency" value={String(insight.urgencyScore)} tone={insight.urgencyScore >= 75 ? "danger" : insight.urgencyScore >= 40 ? "warning" : "neutral"} />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs"><span>Bundle readiness</span><span className="font-medium">{insight.bundleReadinessScore}/100</span></div>
                <Progress value={insight.bundleReadinessScore} />
              </div>
              {merchant.id === "blumen_klein" && (
                <div className="rounded-lg border border-dashed border-border bg-secondary/40 p-3 text-sm">
                  <div className="font-medium">Why not selected for current context?</div>
                  <p className="text-muted-foreground">Normal demand and weaker journey fit (gift moment doesn't match Mia's "warm city break" intent during a cold lunch break).</p>
                </div>
              )}
            </div>
          </SectionCard>

          <SectionCard title="Performance" layer="merchant">
            <dl className="space-y-2 text-sm">
              <Row label="Offers generated" value={analytics.offersGenerated} />
              <Row label="Offers accepted" value={analytics.offersAccepted} />
              <Row label="Tokens redeemed" value={analytics.tokensRedeemed} />
              <Row label="Cashback issued" value={`€${analytics.cashbackIssuedEUR.toFixed(2)}`} />
              <Row label="Revenue influenced" value={`€${analytics.revenueInfluencedEUR.toFixed(2)}`} />
            </dl>
          </SectionCard>
        </div>
      ) : (
        <SectionCard title="No insights yet" layer="merchant">
          <p className="text-sm text-muted-foreground">Click "Refresh insights" to compute snapshots.</p>
        </SectionCard>
      )}

      <SectionCard title="Event log" description="All system events across layers.">
        {state.events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No events yet.</p>
        ) : (
          <ul className="space-y-2">
            {state.events.slice(0, 30).map((e) => (
              <li key={e.id} className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2">
                <div>
                  <div className="flex items-center gap-2 text-sm">
                    <LayerBadge layer={e.layer} />
                    <span className="font-medium">{e.type}</span>
                  </div>
                  <div className="mt-0.5 text-sm text-muted-foreground">{e.message}</div>
                </div>
                <div className="whitespace-nowrap text-xs text-muted-foreground">{new Date(e.ts).toLocaleTimeString()}</div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "danger" | "warning" | "neutral" }) {
  const color = tone === "danger" ? "text-destructive" : tone === "warning" ? "text-warning" : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-secondary/40 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex items-center justify-between border-b border-border/50 py-1.5 last:border-b-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}