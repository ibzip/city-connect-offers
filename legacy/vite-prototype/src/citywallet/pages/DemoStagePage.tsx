import { useEffect } from "react";
import { useAppStore } from "../store/AppStore";
import { PhoneFrame } from "../components/PhoneFrame";
import { StatusBadge } from "../components/StatusBadge";
import { Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export function DemoStagePage() {
  const { state, refreshMerchantInsights, triggerEvent, claimOffer, resetDemo } = useAppStore();
  const { consumer, offer, lastOrchestration, negotiating, insights } = state;

  useEffect(() => {
    if (insights.length === 0) refreshMerchantInsights();
  }, [insights.length, refreshMerchantInsights]);

  const reasoning = lastOrchestration?.decision.reasoning ?? [];
  const candidates = lastOrchestration?.candidates ?? [];
  const validation = lastOrchestration?.validation;
  const llm = lastOrchestration?.llm;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-8 items-start">
      {/* Mobile wallet */}
      <div>
        <PhoneFrame>
          <div className="px-7 pt-9 pb-5">
            <div className="flex justify-between items-center mb-7">
              <div className="w-10 h-10 rounded-full bg-paper border border-black/10 flex items-center justify-center font-serif italic text-teal">
                {consumer.user.displayName[0]}
              </div>
              <StatusBadge variant="teal">{consumer.location.zoneLabel}</StatusBadge>
            </div>
            <p className="text-ink-muted text-sm font-medium mb-1">Hello, {consumer.user.displayName}</p>
            <h1 className="font-serif text-3xl tracking-tight font-medium">€1,482.90</h1>
            <p className="text-xs text-ink-muted mt-2 font-mono">
              {consumer.weather.temperatureC}°C · {consumer.weather.conditions} · {consumer.time.label}
            </p>
          </div>

          <div className="flex-1 surface-paper px-5 py-7 flex flex-col gap-5 rounded-t-[2rem] overflow-y-auto">
            <div className="flex items-center justify-between px-2">
              <h2 className="label-tag font-semibold text-ink-muted">Live Local Offer</h2>
              {negotiating && <StatusBadge variant="warning">thinking…</StatusBadge>}
            </div>

            {!offer && !negotiating && (
              <div className="surface-card rounded-2xl p-6 text-center">
                <Sparkles className="mx-auto mb-3 text-teal" size={20} />
                <p className="font-serif text-lg mb-2">Trigger Mia's context event</p>
                <p className="text-sm text-ink-muted mb-4">
                  gpt-5.2 will read the brief and decide whether to surface a bundle.
                </p>
                <button
                  onClick={() => triggerEvent("UserDeclaredContextChanged")}
                  className="bg-teal text-primary-foreground px-5 py-2.5 rounded-full text-sm font-medium hover:opacity-90"
                >
                  Trigger negotiation
                </button>
              </div>
            )}

            {negotiating && (
              <div className="surface-card rounded-2xl p-6 flex items-center gap-3">
                <Loader2 className="animate-spin text-teal" size={18} />
                <div className="text-sm text-ink-muted">gpt-5.2 is negotiating with merchants…</div>
              </div>
            )}

            {offer && (
              <div className="surface-card rounded-2xl p-4 flex flex-col gap-4 animate-fade-in">
                <div className="bg-[#EAE8E3] rounded-xl p-5 relative">
                  <h3 className="font-serif text-white text-xl font-medium leading-tight relative z-10 text-balance">
                    {offer.headline}
                  </h3>
                  <p className="text-white/80 text-sm mt-1 relative z-10">{offer.subheadline}</p>
                  <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-teal to-teal/60" />
                  <div className="absolute inset-0 rounded-xl bg-gradient-to-t from-black/40 to-transparent" />
                  <div className="relative z-10">
                    <h3 className="font-serif text-white text-xl font-medium leading-tight text-balance">{offer.headline}</h3>
                    <p className="text-white/80 text-sm mt-1">{offer.subheadline}</p>
                  </div>
                </div>

                <div className="flex flex-col gap-3 px-2">
                  {offer.items.map((it, i) => (
                    <div key={i}>
                      {i > 0 && <div className="h-[1px] w-full bg-black/5 mb-3" />}
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-2 h-2 rounded-full bg-teal shrink-0" />
                          <span className="font-medium truncate">{it.merchantName}</span>
                        </div>
                        <span className="text-ink-muted text-xs ml-2">{it.percent}% · {it.productName}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="bg-paper p-4 rounded-xl flex items-center justify-between">
                  <div className="text-xs text-ink-muted">{offer.items.length} stops · ~{offer.items.reduce((s, i) => s + i.distanceMeters, 0)}m</div>
                  <button
                    onClick={claimOffer}
                    disabled={offer.status !== "active"}
                    className="bg-teal text-primary-foreground px-5 py-2.5 rounded-full text-sm font-medium hover:opacity-90 disabled:opacity-50"
                  >
                    {offer.status === "active" ? offer.cta : "Claimed"}
                  </button>
                </div>
              </div>
            )}

            <button
              onClick={resetDemo}
              className="text-xs text-ink-muted hover:text-ink underline self-center mt-2"
            >
              Reset demo
            </button>
          </div>
        </PhoneFrame>
      </div>

      {/* Negotiation panel */}
      <div className="surface-acrylic rounded-[2rem] p-8 lg:p-10 min-h-[760px] flex flex-col gap-7">
        <div className="flex items-end justify-between border-b border-black/5 pb-5">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className={cn("w-2 h-2 rounded-full", negotiating ? "bg-amber-500 animate-pulse-soft" : "bg-teal")} />
              <span className="label-tag text-teal font-medium">
                {negotiating ? "gpt-5.2 negotiating…" : llm ? `gpt-5.2 · ${llm.source}${llm.latencyMs ? ` · ${llm.latencyMs}ms` : ""}` : "City Engine ready"}
              </span>
            </div>
            <h2 className="font-serif text-2xl font-medium">Local Commerce Resolver</h2>
          </div>
          {llm?.reason && (
            <StatusBadge variant={llm.source === "live" ? "teal" : "warning"}>{llm.reason}</StatusBadge>
          )}
        </div>

        {!lastOrchestration && (
          <div className="text-ink-muted text-sm">
            Trigger a context event on the wallet to start a live gpt-5.2 negotiation. Validators run client-side
            to reject any hallucinated merchants, over-budget discounts, or unrealistic walking distances.
          </div>
        )}

        {lastOrchestration && (
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_280px] gap-8 flex-1 min-h-0">
            {/* Reasoning */}
            <div className="flex flex-col gap-5 overflow-y-auto pr-2 font-mono text-[13px] leading-relaxed">
              <div className="label-tag bg-black/5 text-ink-muted self-start">Reasoning Stream</div>
              {reasoning.map((line, i) => (
                <div key={i} className="flex gap-3">
                  <span className="text-ink-muted shrink-0 tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                  <p className="text-ink/90 text-balance max-w-[60ch]">{line}</p>
                </div>
              ))}
              {validation && (
                <div className="mt-2">
                  <div className="label-tag bg-success-bg text-success self-start mb-3 inline-block">
                    {validation.passed ? "Validation passed" : "Validation failed"}
                  </div>
                  <div className="surface-card rounded-lg p-3 flex flex-col gap-1.5 text-xs">
                    {validation.results.map((r, i) => (
                      <div key={i} className="flex justify-between gap-3">
                        <span className="text-ink-muted">{r.validator}</span>
                        <span className={r.passed ? "text-success" : "text-red-700"}>{r.passed ? "ok" : "FAIL"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Candidate matrix */}
            <div className="flex flex-col gap-3 xl:border-l xl:border-black/5 xl:pl-8">
              <div className="label-tag bg-black/5 text-ink-muted self-start">Candidate Matrix</div>
              {candidates.map((c) => (
                <div
                  key={c.merchantId}
                  className={cn(
                    "rounded-lg p-3 border",
                    c.considered ? "border-teal/30 bg-teal/5" : "border-black/10 bg-black/5 opacity-60",
                  )}
                >
                  <div className="flex justify-between items-start mb-1">
                    <span className="text-xs font-bold">{c.merchantId}</span>
                    <span className="font-mono text-[10px] tabular-nums">{c.fitScore}</span>
                  </div>
                  <p className="text-[11px] text-ink-muted leading-snug">
                    {c.considered ? c.reason : c.rejectedReason}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}