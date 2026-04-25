import { useAppStore } from "../store/AppStore";
import { SectionCard } from "../components/SectionCard";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "../components/StatusBadge";
import { CheckCircle2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

function fakeQR(seed: string) {
  // Deterministic 8x8 grid based on seed string.
  const cells: boolean[] = [];
  for (let i = 0; i < 64; i++) {
    let h = 0;
    const s = `${seed}_${i}`;
    for (let k = 0; k < s.length; k++) h = (h * 31 + s.charCodeAt(k)) | 0;
    cells.push((h & 1) === 1);
  }
  return cells;
}

export function RedemptionPage() {
  const { state, redeemToken } = useAppStore();
  const navigate = useNavigate();

  if (state.tokens.length === 0) {
    return (
      <SectionCard title="No tokens yet" layer="redemption" description="Claim a bundle from the wallet to receive redemption tokens.">
        <Button onClick={() => navigate("/wallet")}>Open wallet</Button>
      </SectionCard>
    );
  }

  const totalCashback = state.tokens.reduce((s, t) => s + (t.cashbackIssuedEUR ?? 0), 0);

  return (
    <div className="space-y-6">
      <SectionCard title="Redemption tokens" layer="redemption" description="One token per merchant. Tap redeem at the counter to issue cashback.">
        <div className="grid gap-4 md:grid-cols-2">
          {state.tokens.map((t) => {
            const grid = fakeQR(t.id);
            const redeemed = t.status === "redeemed";
            return (
              <div key={t.id} className={`rounded-2xl border p-5 transition-shadow ${redeemed ? "border-success/40 bg-success/5" : "border-border bg-card shadow-soft"}`}>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-sm text-muted-foreground">{t.merchantName}</div>
                    <div className="text-lg font-semibold">{t.productName}</div>
                    <div className="text-xs text-muted-foreground">{t.percent}% cashback · €{t.productPriceEUR.toFixed(2)} base</div>
                  </div>
                  {redeemed
                    ? <StatusBadge tone="success"><CheckCircle2 className="h-3 w-3" /> redeemed</StatusBadge>
                    : <StatusBadge tone="info">active</StatusBadge>}
                </div>

                <div className="my-4 flex items-center gap-4">
                  <div className="grid grid-cols-8 gap-px rounded-lg bg-foreground p-1.5">
                    {grid.map((on, i) => (
                      <div
                        key={i}
                        className={`h-3 w-3 ${on ? "bg-background" : "bg-foreground"}`}
                      />
                    ))}
                  </div>
                  <div>
                    <div className="font-mono text-sm font-semibold">{t.id}</div>
                    <div className="text-xs text-muted-foreground">scan at counter</div>
                  </div>
                </div>

                {redeemed ? (
                  <div className="rounded-lg bg-success/10 p-3 text-sm text-success">
                    Cashback issued: €{t.cashbackIssuedEUR?.toFixed(2)}
                  </div>
                ) : (
                  <Button className="w-full" onClick={() => redeemToken(t.id)}>
                    Redeem {t.merchantName.split(" ")[0]} token
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard title="Redemption summary" layer="redemption">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-border p-4">
            <div className="text-xs text-muted-foreground">Tokens issued</div>
            <div className="text-2xl font-semibold">{state.tokens.length}</div>
          </div>
          <div className="rounded-lg border border-border p-4">
            <div className="text-xs text-muted-foreground">Tokens redeemed</div>
            <div className="text-2xl font-semibold">{state.tokens.filter((t) => t.status === "redeemed").length}</div>
          </div>
          <div className="rounded-lg border border-border p-4">
            <div className="text-xs text-muted-foreground">Total cashback</div>
            <div className="text-2xl font-semibold">€{totalCashback.toFixed(2)}</div>
          </div>
        </div>
        <div className="mt-4">
          <Button variant="outline" onClick={() => navigate("/merchant-dashboard")}>See merchant dashboard updates</Button>
        </div>
      </SectionCard>
    </div>
  );
}