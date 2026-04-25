import { Button } from "@/components/ui/button";
import { useAppStore } from "../store/AppStore";
import { ProviderTag } from "../components/ProviderTag";
import { SectionCard } from "../components/SectionCard";
import { StatusBadge } from "../components/StatusBadge";
import { Cloud, Clock, MapPin, Sparkles, Wallet, X, Footprints, Lock, ArrowRight, ShoppingBag } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

export function WalletPage() {
  const { state, updateConsumerContext, triggerEvent, claimOffer, dismissOffer } = useAppStore();
  const ctx = state.consumer;
  const offer = state.offer;
  const navigate = useNavigate();
  const { toast } = useToast();

  const [intent, setIntent] = useState(ctx.declared.intent);
  const [walking, setWalking] = useState(ctx.declared.walkingToleranceMeters);
  const [reward, setReward] = useState(ctx.declared.rewardPreference);

  const onUpdateContext = () => {
    updateConsumerContext({
      ...ctx,
      declared: {
        ...ctx.declared,
        intent,
        walkingToleranceMeters: walking,
        rewardPreference: reward,
      },
    });
    toast({ title: "Context updated", description: "Mia's declared context refreshed." });
  };

  const onFindOffer = () => {
    triggerEvent("UserDeclaredContextChanged");
    toast({ title: "Looking for relevant offers", description: "Negotiation agent invoked." });
  };

  const minutesLeft = offer ? Math.max(0, Math.round((offer.expiresAt - Date.now()) / 60000)) : 0;

  return (
    <div className="grid gap-8 lg:grid-cols-[420px_1fr]">
      {/* Phone frame */}
      <div className="mx-auto w-full max-w-[420px]">
        <div className="rounded-[2.5rem] border-[10px] border-foreground/90 bg-foreground/90 p-2 shadow-elevated">
          <div className="overflow-hidden rounded-[2rem] bg-gradient-wallet text-primary-foreground">
            <div className="flex items-center justify-between px-5 pt-4 text-[11px] uppercase tracking-wider opacity-80">
              <span>9:41</span>
              <span>City Wallet</span>
              <span>5G</span>
            </div>
            <div className="flex items-center gap-3 px-5 pt-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15">
                <Wallet className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm opacity-80">Hi Mia</div>
                <div className="text-base font-semibold">Stuttgart Old Town</div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2 px-5 text-[11px]">
              <div className="rounded-xl bg-white/10 p-3">
                <Cloud className="mb-1 h-3.5 w-3.5 opacity-80" />
                <div className="font-medium">{ctx.weather.temperatureC}°C</div>
                <div className="opacity-70 capitalize">{ctx.weather.conditions}</div>
              </div>
              <div className="rounded-xl bg-white/10 p-3">
                <Clock className="mb-1 h-3.5 w-3.5 opacity-80" />
                <div className="font-medium">Lunch</div>
                <div className="opacity-70">break</div>
              </div>
              <div className="rounded-xl bg-white/10 p-3">
                <Footprints className="mb-1 h-3.5 w-3.5 opacity-80" />
                <div className="font-medium">{ctx.declared.walkingToleranceMeters}m</div>
                <div className="opacity-70">walk ok</div>
              </div>
            </div>

            <div className="px-5 py-4">
              {!offer && (
                <div className="rounded-2xl bg-white/10 p-4 text-center text-sm">
                  <Sparkles className="mx-auto mb-2 h-5 w-5 opacity-80" />
                  <p className="opacity-90">No active offer.</p>
                  <p className="text-xs opacity-70">Tap "Find relevant offer" to ask the agent.</p>
                </div>
              )}

              {offer && offer.status !== "claimed" && offer.status !== "redeemed" && offer.status !== "dismissed" && (
                <div className="rounded-2xl bg-gradient-bundle p-4 text-foreground shadow-glow animate-fade-in">
                  <div className="mb-2 flex items-center justify-between">
                    <StatusBadge tone="warning" className="bg-foreground/15 text-foreground">
                      {offer.type === "bundle_offer" ? "Bundle" : "Offer"} · {minutesLeft}m left
                    </StatusBadge>
                    <button
                      onClick={dismissOffer}
                      className="rounded-full p-1 text-foreground/70 hover:bg-foreground/10"
                      aria-label="Dismiss"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <h3 className="text-lg font-semibold leading-tight">{offer.headline}</h3>
                  <p className="mt-1 text-sm text-foreground/80">{offer.subheadline}</p>
                  <ul className="mt-3 space-y-2">
                    {offer.items.map((it) => (
                      <li key={it.merchantId} className="flex items-center justify-between rounded-xl bg-foreground/10 px-3 py-2 text-sm">
                        <div>
                          <div className="font-medium">{it.merchantName}</div>
                          <div className="text-xs text-foreground/70">{it.productName} · {it.distanceMeters}m</div>
                        </div>
                        <div className="text-right">
                          <div className="font-semibold">{it.percent}%</div>
                          <div className="text-[10px] uppercase text-foreground/70">cashback</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <Button
                    className="mt-4 w-full bg-foreground text-background hover:bg-foreground/90"
                    onClick={() => { claimOffer(); navigate("/redemption"); }}
                  >
                    {offer.cta} <ArrowRight className="ml-1 h-4 w-4" />
                  </Button>
                  <details className="mt-3 text-xs">
                    <summary className="cursor-pointer text-foreground/80">Why this offer?</summary>
                    <ul className="mt-2 list-disc space-y-1 pl-4 text-foreground/80">
                      {offer.why.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  </details>
                </div>
              )}

              {offer && offer.status === "dismissed" && (
                <div className="rounded-2xl bg-white/10 p-4 text-center text-sm opacity-80">
                  Offer dismissed. We'll stay quiet for the next hour.
                </div>
              )}

              {offer && (offer.status === "claimed" || offer.status === "redeemed") && (
                <div className="rounded-2xl bg-white/10 p-4 text-center text-sm">
                  <ShoppingBag className="mx-auto mb-2 h-5 w-5" />
                  <div className="font-medium">Bundle claimed</div>
                  <div className="text-xs opacity-80">Open Redemption to use your tokens.</div>
                  <Button size="sm" variant="secondary" className="mt-3" onClick={() => navigate("/redemption")}>
                    Open redemption
                  </Button>
                </div>
              )}
            </div>

            <div className="flex gap-2 px-5 pb-5">
              <Button variant="secondary" className="flex-1 bg-white/15 text-primary-foreground hover:bg-white/25" onClick={onUpdateContext}>Update context</Button>
              <Button className="flex-1 bg-accent text-accent-foreground hover:bg-accent/90" onClick={onFindOffer}>Find offer</Button>
            </div>
          </div>
        </div>
      </div>

      {/* Context controls */}
      <div className="space-y-6">
        <SectionCard title="Context panel" layer="consumer" description="Signals and their sources are visible here. Privacy is preserved — raw PII is never sent.">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm font-medium"><MapPin className="h-4 w-4 text-layer-consumer" /> Location</div>
              <div className="text-sm">{ctx.location.zoneLabel}</div>
              <ProviderTag providerId={ctx.location.source} />
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm font-medium"><Cloud className="h-4 w-4 text-layer-consumer" /> Weather</div>
              <div className="text-sm">{ctx.weather.temperatureC}°C, {ctx.weather.conditions}</div>
              <ProviderTag providerId={ctx.weather.source} />
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm font-medium"><Clock className="h-4 w-4 text-layer-consumer" /> Time</div>
              <div className="text-sm capitalize">{ctx.time.label}</div>
              <ProviderTag providerId="declared_context" />
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm font-medium"><Lock className="h-4 w-4 text-layer-consumer" /> Privacy</div>
              <div className="text-sm capitalize">{ctx.declared.privacyMode}</div>
              <ProviderTag providerId="declared_context" />
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Update my context" layer="consumer" description="Editable user-declared signals — drives the trigger.">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Declared intent</Label>
              <Input value={intent} onChange={(e) => setIntent(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Reward preference</Label>
              <Select value={reward} onValueChange={(v) => setReward(v as typeof reward)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cashback">Cashback</SelectItem>
                  <SelectItem value="discount">Discount</SelectItem>
                  <SelectItem value="either">Either</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <div className="flex items-center justify-between">
                <Label>Walking tolerance</Label>
                <span className="text-sm tabular-nums text-muted-foreground">{walking}m</span>
              </div>
              <Slider min={50} max={600} step={10} value={[walking]} onValueChange={(v) => setWalking(v[0])} />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={onUpdateContext}>Save context</Button>
            <Button variant="secondary" onClick={onFindOffer}>Find relevant offer</Button>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}