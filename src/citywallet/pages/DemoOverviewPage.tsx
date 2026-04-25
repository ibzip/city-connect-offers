import { Button } from "@/components/ui/button";
import { useAppStore } from "../store/AppStore";
import { SectionCard } from "../components/SectionCard";
import { Timeline } from "../components/Timeline";
import { LayerBadge } from "../components/LayerBadge";
import { ProviderTag } from "../components/ProviderTag";
import { activeProviders } from "../config/providers";
import { ArrowRight, Play, Zap } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { StatusBadge } from "../components/StatusBadge";

const FLOW: { layer: import("../types").LayerKey; label: string }[] = [
  { layer: "config", label: "Merchant signals" },
  { layer: "merchant", label: "Insight snapshots" },
  { layer: "consumer", label: "User context event" },
  { layer: "consumer", label: "Consumer Agent" },
  { layer: "negotiation", label: "Negotiation Agent" },
  { layer: "validation", label: "Validator" },
  { layer: "redemption", label: "Offer & Redemption" },
];

export function DemoOverviewPage() {
  const { state, refreshMerchantInsights, triggerEvent, resetDemo } = useAppStore();
  const navigate = useNavigate();

  const onRunDemo = () => {
    refreshMerchantInsights();
    setTimeout(() => {
      triggerEvent("UserDeclaredContextChanged");
      navigate("/wallet");
    }, 250);
  };

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-3xl bg-gradient-hero p-8 text-primary-foreground shadow-elevated">
        <div className="relative z-10 max-w-3xl space-y-4">
          <StatusBadge tone="info" className="bg-white/15 text-primary-foreground">
            <Zap className="h-3 w-3" /> Hackathon MVP
          </StatusBadge>
          <h1 className="text-3xl font-semibold leading-tight md:text-4xl">
            City Wallet — Agentic Local Commerce Demo
          </h1>
          <p className="text-base text-primary-foreground/85 md:text-lg">
            Not a coupon firehose. City Wallet listens for a real user-side context event,
            consults precomputed merchant insights, and lets a consumer agent and a negotiation
            agent decide whether to stay silent, send a single offer, or propose a cooperative
            multi-merchant bundle.
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            <Button size="lg" onClick={onRunDemo} className="gap-2 bg-accent text-accent-foreground hover:bg-accent/90">
              <Play className="h-4 w-4" /> Trigger Mia's context event
            </Button>
            <Button size="lg" variant="outline" onClick={resetDemo} className="border-white/30 bg-white/10 text-primary-foreground hover:bg-white/20 hover:text-primary-foreground">
              Reset demo
            </Button>
          </div>
        </div>
        <div className="pointer-events-none absolute -right-10 -top-10 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 right-32 h-72 w-72 rounded-full bg-accent/30 blur-3xl" />
      </section>

      <SectionCard
        title="System flow"
        description="Each layer is independently configurable and pluggable."
      >
        <div className="flex flex-wrap items-center gap-2">
          {FLOW.map((step, i) => (
            <div key={step.label} className="flex items-center gap-2">
              <div className="flex items-center gap-2 rounded-xl border border-border bg-secondary/40 px-3 py-2">
                <LayerBadge layer={step.layer} label={step.label} />
              </div>
              {i < FLOW.length - 1 && <ArrowRight className="h-4 w-4 text-muted-foreground" />}
            </div>
          ))}
        </div>
      </SectionCard>

      <div className="grid gap-6 md:grid-cols-2">
        <SectionCard title="Active providers" description="Real vs simulated sources, swap via config." layer="config">
          <ul className="grid gap-2 sm:grid-cols-2">
            <li className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">Weather</span><ProviderTag providerId={activeProviders.weather} /></li>
            <li className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">Location</span><ProviderTag providerId={activeProviders.location} /></li>
            <li className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">Payment density</span><ProviderTag providerId={activeProviders.paymentDensity} /></li>
            <li className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">User context</span><ProviderTag providerId={activeProviders.userContext} /></li>
            <li className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">Local events</span><ProviderTag providerId={activeProviders.localEvents} /></li>
          </ul>
        </SectionCard>

        <SectionCard
          title="Demo timeline"
          description="Live trace of what the system did."
          actions={
            <Button variant="ghost" size="sm" onClick={refreshMerchantInsights}>
              Refresh insights
            </Button>
          }
        >
          <Timeline steps={state.timeline} empty="Press Run Demo to populate." />
        </SectionCard>
      </div>

      <SectionCard title="Suggested demo path" description="Each step lives on its own page.">
        <ol className="grid gap-2 text-sm md:grid-cols-2">
          <li className="rounded-lg border border-border p-3"><strong>1.</strong> Refresh merchant insights (this page).</li>
          <li className="rounded-lg border border-border p-3"><strong>2.</strong> Trigger Mia's context event → see Wallet.</li>
          <li className="rounded-lg border border-border p-3"><strong>3.</strong> Inspect Negotiation Debug to see the full reasoning.</li>
          <li className="rounded-lg border border-border p-3"><strong>4.</strong> Claim bundle, redeem two tokens.</li>
          <li className="rounded-lg border border-border p-3"><strong>5.</strong> Watch Merchant Dashboard update in real time.</li>
          <li className="rounded-lg border border-border p-3"><strong>6.</strong> Edit Merchant Rules to see config-first design.</li>
        </ol>
      </SectionCard>
    </div>
  );
}