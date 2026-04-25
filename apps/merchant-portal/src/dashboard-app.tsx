"use client";

import { useCallback, useEffect, useState } from "react";
import type { DashboardMetrics } from "@city-wallet/contracts";
import { Badge, Button, EventLog, ExplainabilityPanel, JsonPanel, MerchantPulseCard, Section } from "@city-wallet/ui";
import { apiGet, apiPost } from "./api";

export function DashboardApp() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setMetrics(await apiGet<DashboardMetrics>("/api/merchant/dashboard"));
  }, []);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      await apiPost("/api/merchant-insights/refresh");
      await load();
    } finally {
      setBusy(false);
    }
  }, [load]);

  useEffect(() => {
    refresh().catch(console.error);
  }, [refresh]);

  return (
    <Section>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2"><Badge tone="orange">execution dashboard</Badge></div>
          <h1 className="font-serif text-3xl">Merchant Dashboard</h1>
          <p className="mt-1 text-sm text-ink-muted">Business-state snapshots, offer impact, redemption log, and explainability from the real product flow.</p>
        </div>
        <Button onClick={refresh} disabled={busy}>{busy ? "Refreshing..." : "Refresh insights"}</Button>
      </div>

      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {(metrics?.merchants ?? []).map((metric) => <MerchantPulseCard key={metric.merchant.id} metric={metric} />)}
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_420px]">
        <ExplainabilityPanel title="Merchant explainability">
          <div className="space-y-4">
            <p>
              Merchant-side code refreshes insight snapshots from merchant-side signals. It does not run a live negotiating agent.
              Offer decisions are triggered by user-side wallet events and validated after the negotiation decision.
            </p>
            {(metrics?.merchants ?? []).map((metric) => (
              <div key={metric.merchant.id} className="rounded-xl border border-black/10 bg-paper p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="font-serif text-lg text-ink">{metric.merchant.name}</div>
                  <Badge tone={metric.insight?.businessState === "normal" ? "green" : "purple"}>{metric.insight?.businessState ?? "no insight"}</Badge>
                </div>
                <div className="grid gap-3 text-xs md:grid-cols-3">
                  <div>
                    <div className="font-mono uppercase tracking-wider text-ink-muted">Insight calculation</div>
                    <p className="mt-1">
                      {metric.baselineTransactions ?? "-"} baseline vs {metric.currentTransactions ?? "-"} current transactions,
                      drop {metric.insight?.transactionDropPercent ?? "-"}%, urgency {metric.insight?.urgencyScore ?? "-"},
                      readiness {metric.insight?.bundleReadinessScore ?? "-"}.
                    </p>
                  </div>
                  <div>
                    <div className="font-mono uppercase tracking-wider text-ink-muted">Rules</div>
                    <p className="mt-1">
                      Max {metric.merchant.rule?.maxDiscountPercent ?? "-"}%,
                      budget €{metric.merchant.rule?.dailyBudgetRemainingEuro ?? "-"},
                      bundles {metric.merchant.rule?.allowsBundles ? "allowed" : "off"}.
                    </p>
                    <p className="mt-1 text-ink-muted">{metric.merchant.rule?.eligibleProducts.join(", ") ?? "No eligible products"}</p>
                  </div>
                  <div>
                    <div className="font-mono uppercase tracking-wider text-ink-muted">Selection and analytics</div>
                    <p className="mt-1">{metric.notSelectedReason ?? `${metric.offersShown} offer(s), ${metric.tokensRedeemed} redemption(s), €${metric.cashbackIssuedEuro.toFixed(2)} cashback issued.`}</p>
                  </div>
                </div>
              </div>
            ))}
            <p className="text-xs">Analytics events shown in the log: {metrics?.events.length ?? 0}.</p>
          </div>
        </ExplainabilityPanel>
        <EventLog events={metrics?.events ?? []} />
      </div>

      <div className="mt-5">
        <JsonPanel title="Dashboard Metrics" data={metrics} />
      </div>
    </Section>
  );
}
