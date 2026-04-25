import { useAppStore } from "../store/AppStore";
import { StatusBadge } from "../components/StatusBadge";

export function RedemptionPage() {
  const { state, redeemToken } = useAppStore();
  const { tokens } = state;

  if (tokens.length === 0) {
    return (
      <div className="surface-card rounded-2xl p-10 text-center text-ink-muted">
        <p className="font-serif text-xl text-ink mb-2">No active tokens yet</p>
        <p className="text-sm">Trigger a negotiation and claim the bundle on the Demo Stage to issue tokens.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl">Redemption</h1>
        <p className="text-ink-muted text-sm mt-1">In-store redemption of bundle tokens.</p>
      </div>
      <div className="grid md:grid-cols-2 gap-5">
        {tokens.map((t) => (
          <div key={t.id} className="surface-card rounded-2xl p-5 flex flex-col gap-3">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-serif text-xl">{t.merchantName}</h3>
                <p className="text-xs text-ink-muted">{t.productName} · {t.percent}% cashback</p>
              </div>
              <StatusBadge variant={t.status === "redeemed" ? "success" : "teal"}>{t.status}</StatusBadge>
            </div>
            <div className="bg-paper rounded-lg p-4 font-mono text-center text-lg tracking-widest">
              {t.id}
            </div>
            {t.status === "redeemed" && (
              <p className="text-sm text-success">€{t.cashbackIssuedEUR?.toFixed(2)} cashback issued</p>
            )}
            <button
              onClick={() => redeemToken(t.id)}
              disabled={t.status !== "active"}
              className="bg-teal text-primary-foreground px-4 py-2 rounded-full text-sm self-start disabled:opacity-50"
            >
              {t.status === "active" ? "Redeem at counter" : "Redeemed"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}