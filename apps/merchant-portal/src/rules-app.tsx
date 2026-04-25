"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DashboardMetrics, MerchantRule } from "@city-wallet/contracts";
import { Badge, Button, Card, Section } from "@city-wallet/ui";
import { apiGet, apiPost } from "./api";

export function RulesApp() {
  const [dashboard, setDashboard] = useState<DashboardMetrics | null>(null);
  const [rules, setRules] = useState<MerchantRule[]>([]);
  const [merchantId, setMerchantId] = useState("");
  const [draft, setDraft] = useState<MerchantRule | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    const [nextDashboard, nextRules] = await Promise.all([
      apiGet<DashboardMetrics>("/api/merchant/dashboard"),
      apiGet<MerchantRule[]>("/api/merchant/rules"),
    ]);
    setDashboard(nextDashboard);
    setRules(nextRules);
    const current = nextRules.find((rule) => rule.merchantId === merchantId) ?? nextRules[0] ?? null;
    if (current) {
      setMerchantId(current.merchantId);
      setDraft(current);
    }
  }, [merchantId]);

  useEffect(() => {
    load().catch(console.error);
  }, [load]);

  useEffect(() => {
    const current = rules.find((rule) => rule.merchantId === merchantId);
    if (current) setDraft(current);
  }, [merchantId, rules]);

  const merchant = useMemo(() => dashboard?.merchants.find((metric) => metric.merchant.id === merchantId)?.merchant, [dashboard, merchantId]);

  async function save() {
    if (!draft) return;
    const savedRule = await apiPost<MerchantRule>("/api/merchant/rules", draft);
    setRules((current) => current.map((rule) => rule.merchantId === savedRule.merchantId ? savedRule : rule));
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <Section>
      <div className="mb-6">
        <div className="mb-2"><Badge tone="blue">configuration</Badge></div>
        <h1 className="font-serif text-3xl">Merchant Rules</h1>
        <p className="mt-1 text-sm text-ink-muted">Inspect and edit seeded merchants through the real merchant-facing product surface.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <Card className="h-fit">
          <label className="text-sm">
            <span className="mb-2 block text-xs uppercase tracking-wider text-ink-muted">Merchant</span>
            <select className="w-full rounded-lg border bg-paper px-3 py-2" value={merchantId} onChange={(event) => setMerchantId(event.target.value)}>
              {(dashboard?.merchants ?? []).map((metric) => <option key={metric.merchant.id} value={metric.merchant.id}>{metric.merchant.name}</option>)}
            </select>
          </label>
          {merchant ? (
            <div className="mt-4 rounded-xl bg-paper p-4 text-sm">
              <div className="font-serif text-xl">{merchant.name}</div>
              <div className="mt-1 font-mono text-xs uppercase tracking-wider text-ink-muted">{merchant.category} · {merchant.distanceMeters}m</div>
              <div className="mt-3 text-xs text-ink-muted">{merchant.goals.map((goal) => goal.goal).join(", ")}</div>
            </div>
          ) : null}
        </Card>

        {draft ? (
          <Card className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="text-sm">
                <span className="mb-2 block text-xs uppercase tracking-wider text-ink-muted">Max discount %</span>
                <input className="w-full rounded-lg border bg-paper px-3 py-2" type="number" min={0} max={100} value={draft.maxDiscountPercent} onChange={(event) => setDraft({ ...draft, maxDiscountPercent: Number(event.target.value) })} />
              </label>
              <label className="text-sm">
                <span className="mb-2 block text-xs uppercase tracking-wider text-ink-muted">Daily budget remaining</span>
                <input className="w-full rounded-lg border bg-paper px-3 py-2" type="number" min={0} value={draft.dailyBudgetRemainingEuro} onChange={(event) => setDraft({ ...draft, dailyBudgetRemainingEuro: Number(event.target.value) })} />
              </label>
            </div>
            <label className="flex items-center gap-3 text-sm">
              <input type="checkbox" checked={draft.allowsBundles} onChange={(event) => setDraft({ ...draft, allowsBundles: event.target.checked })} />
              Allows cooperative bundles
            </label>
            <TextList label="Eligible products" value={draft.eligibleProducts} onChange={(eligibleProducts) => setDraft({ ...draft, eligibleProducts })} />
            <TextList label="Preferred partner categories" value={draft.preferredBundleCategories} onChange={(preferredBundleCategories) => setDraft({ ...draft, preferredBundleCategories })} />
            <TextList label="Offer types allowed" value={draft.offerTypesAllowed} onChange={(offerTypesAllowed) => setDraft({ ...draft, offerTypesAllowed: offerTypesAllowed as MerchantRule["offerTypesAllowed"] })} />
            <label className="text-sm">
              <span className="mb-2 block text-xs uppercase tracking-wider text-ink-muted">Brand tone</span>
              <input className="w-full rounded-lg border bg-paper px-3 py-2" value={draft.brandTone} onChange={(event) => setDraft({ ...draft, brandTone: event.target.value })} />
            </label>
            <div className="flex items-center gap-3">
              <Button onClick={save}>Save rules</Button>
              {saved ? <span className="text-sm text-success">Saved</span> : null}
            </div>
          </Card>
        ) : null}
      </div>
    </Section>
  );
}

function TextList({ label, value, onChange }: { label: string; value: string[]; onChange: (next: string[]) => void }) {
  return (
    <label className="text-sm">
      <span className="mb-2 block text-xs uppercase tracking-wider text-ink-muted">{label}</span>
      <textarea className="min-h-20 w-full rounded-lg border bg-paper px-3 py-2" value={value.join(", ")} onChange={(event) => onChange(event.target.value.split(",").map((part) => part.trim()).filter(Boolean))} />
    </label>
  );
}
