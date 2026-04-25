import { useEffect } from "react";
import { useAppStore } from "../store/AppStore";
import { StatusBadge } from "../components/StatusBadge";

export function MerchantPage() {
  const { state, refreshMerchantInsights } = useAppStore();
  useEffect(() => { refreshMerchantInsights(); }, [refreshMerchantInsights]);
  const { merchants, insights, analytics } = state;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-serif text-3xl">Merchant Dashboard</h1>
          <p className="text-ink-muted text-sm mt-1">Live business state and AI-driven offer impact.</p>
        </div>
        <button onClick={refreshMerchantInsights} className="bg-teal text-primary-foreground px-4 py-2 rounded-full text-sm">
          Refresh insights
        </button>
      </div>
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
        {merchants.map((m) => {
          const ins = insights.find((i) => i.merchantId === m.id);
          const an = analytics[m.id];
          return (
            <div key={m.id} className="surface-card rounded-2xl p-5 flex flex-col gap-3">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-serif text-xl">{m.name}</h3>
                  <p className="text-xs text-ink-muted font-mono uppercase tracking-wider">{m.category}</p>
                </div>
                {ins && (
                  <StatusBadge variant={ins.businessState === "very_quiet" ? "warning" : ins.businessState === "quiet" ? "neutral" : "success"}>
                    {ins.businessState.replace("_", " ")}
                  </StatusBadge>
                )}
              </div>
              {ins && (
                <p className="text-sm text-ink-muted leading-snug">{ins.insightSummary}</p>
              )}
              <div className="grid grid-cols-2 gap-3 mt-2 text-xs font-mono">
                <Stat label="Urgency" value={ins?.urgencyScore ?? 0} />
                <Stat label="Drop %" value={ins?.transactionDropPercent ?? 0} />
                <Stat label="Offers" value={an?.offersGenerated ?? 0} />
                <Stat label="Cashback" value={`€${(an?.cashbackIssuedEUR ?? 0).toFixed(2)}`} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-paper rounded-lg p-3">
      <div className="text-[10px] uppercase tracking-wider text-ink-muted">{label}</div>
      <div className="text-base text-ink mt-1 tabular-nums">{value}</div>
    </div>
  );
}