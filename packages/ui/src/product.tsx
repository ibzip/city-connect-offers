import type { DashboardMetrics, MerchantInsightSnapshot, Offer, RedemptionToken } from "@city-wallet/contracts";
import { Badge, Button, Card, StatCard, ValidityPill } from "./primitives";

export function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="surface-card mx-auto flex h-[760px] w-full max-w-[380px] flex-col overflow-hidden rounded-[2rem]">
      {children}
    </div>
  );
}

export function OfferCard({
  offer,
  onClaim,
  disabled,
}: {
  offer: Offer;
  onClaim?: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="surface-card animate-fade-in flex flex-col gap-4 rounded-2xl p-4">
      <div className="relative overflow-hidden rounded-xl bg-teal p-5">
        <div className="absolute inset-0 bg-gradient-to-t from-black/35 to-transparent" />
        <div className="relative z-10">
          {offer.isSimulatedDemoOffer ? <Badge tone="orange">Simulated demo offer</Badge> : null}
          <h3 className="text-balance font-serif text-xl font-medium leading-tight text-white">{offer.headline}</h3>
          <p className="mt-1 text-sm text-white/80">{offer.subheadline}</p>
          {offer.disclosure ? <p className="mt-2 text-xs text-white/75">{offer.disclosure}</p> : null}
        </div>
      </div>
      <BundleOfferCard offer={offer} />
      <div className="flex items-center justify-between rounded-xl bg-paper p-4">
        <div className="text-xs text-ink-muted">{offer.items.length} stops · ~{offer.items.reduce((sum, item) => sum + item.distanceMeters, 0)}m</div>
        <Button onClick={onClaim} disabled={disabled || offer.status !== "shown"}>{offer.status === "shown" ? offer.cta : "Claimed"}</Button>
      </div>
    </div>
  );
}

export function BundleOfferCard({ offer }: { offer: Offer }) {
  return (
    <div className="flex flex-col gap-3 px-2">
      {offer.items.map((item, index) => (
        <div key={item.offerItemId}>
          {index > 0 ? <div className="mb-3 h-px w-full bg-black/5" /> : null}
          <div className="flex items-center justify-between gap-3 text-sm">
            <div className="flex min-w-0 items-center gap-2">
              <div className="h-2 w-2 shrink-0 rounded-full bg-teal" />
            <span className="truncate font-medium">{item.merchantName}</span>
            {item.isSimulatedDemoOffer ? <Badge tone="orange">demo</Badge> : null}
          </div>
            <span className="shrink-0 text-xs text-ink-muted">
              {item.product} · {item.incentivePercent}% cashback · {item.distanceMeters}m
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function MerchantPulseCard({
  metric,
}: {
  metric: DashboardMetrics["merchants"][number];
}) {
  const insight = metric.insight;
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-serif text-xl">{metric.merchant.name}</h3>
          <p className="font-mono text-xs uppercase tracking-wider text-ink-muted">{metric.merchant.category}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge tone={metric.merchant.participationStatus === "demo_partner" ? "orange" : metric.merchant.participationStatus?.startsWith("discovered") ? "blue" : "green"}>
              {metric.merchant.participationStatus === "demo_partner" && metric.merchant.source === "google_places"
                ? "Demo-onboarded from Google Places discovery"
                : metric.merchant.participationStatus === "demo_partner" && metric.merchant.source === "osm_overpass"
                ? "Demo-onboarded from OSM discovery"
                : metric.merchant.participationStatus === "demo_partner" ? "Demo-onboarded from discovery" : metric.merchant.participationStatus ?? "partner"}
            </Badge>
            {metric.merchant.source ? <Badge>{metric.merchant.source}</Badge> : null}
          </div>
        </div>
        {insight ? <BusinessStateBadge insight={insight} /> : <Badge>No insight</Badge>}
      </div>
      {insight ? <p className="text-sm leading-snug text-ink-muted">{insight.insightSummary}</p> : null}
      <div className="grid grid-cols-2 gap-3 text-xs font-mono">
        <StatCard label="Baseline" value={metric.baselineTransactions !== undefined ? `${metric.baselineTransactions} -> ${metric.currentTransactions}` : "-"} />
        <StatCard label="Drop %" value={insight?.transactionDropPercent ?? 0} />
        <StatCard label="Urgency" value={insight?.urgencyScore ?? 0} />
        <StatCard label="Readiness" value={insight?.bundleReadinessScore ?? 0} />
        <StatCard label="Redeemed" value={metric.tokensRedeemed} />
        <StatCard label="Cashback" value={`€${metric.cashbackIssuedEuro.toFixed(2)}`} />
      </div>
      {metric.notSelectedReason ? <p className="rounded-lg bg-paper p-3 text-xs text-ink-muted">{metric.notSelectedReason}</p> : null}
    </Card>
  );
}

export function TokenCard({
  token,
  onRedeem,
}: {
  token: RedemptionToken;
  onRedeem?: () => void;
}) {
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-serif text-xl">{token.merchantName}</h3>
          <p className="text-xs text-ink-muted">{token.product} · €{token.cashbackEuro.toFixed(2)} cashback</p>
        </div>
        <Badge tone={token.status === "redeemed" ? "green" : "blue"}>{token.status}</Badge>
      </div>
      <div className="rounded-lg bg-paper p-4 text-center font-mono text-lg tracking-widest">{token.code}</div>
      <Button onClick={onRedeem} disabled={token.status !== "active"}>{token.status === "active" ? "Redeem at counter" : "Redeemed"}</Button>
    </Card>
  );
}

function BusinessStateBadge({ insight }: { insight: MerchantInsightSnapshot }) {
  const tone = insight.businessState === "very_quiet" ? "orange" : insight.businessState === "quiet" ? "blue" : insight.businessState === "busy" ? "red" : "green";
  return <Badge tone={tone}>{insight.businessState.replace("_", " ")}</Badge>;
}
