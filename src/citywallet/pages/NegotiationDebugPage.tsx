import { useAppStore } from "../store/AppStore";
import { SectionCard } from "../components/SectionCard";
import { JsonBlock } from "../components/JsonBlock";
import { StatusBadge } from "../components/StatusBadge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, XCircle } from "lucide-react";

export function NegotiationDebugPage() {
  const { state } = useAppStore();
  const r = state.lastOrchestration;
  const navigate = useNavigate();

  if (!r) {
    return (
      <SectionCard title="Negotiation Debug" layer="negotiation" description="Run the demo to populate explainability.">
        <Button onClick={() => navigate("/")}>Go to Demo Overview</Button>
      </SectionCard>
    );
  }

  return (
    <div className="space-y-6">
      <SectionCard title="Trigger event received" layer="config">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone="info">{r.triggerEvent}</StatusBadge>
          <span className="text-sm text-muted-foreground">Evaluated against {r.triggerMatches.length} configured triggers.</span>
        </div>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {r.triggerMatches.map(({ trigger, matched }) => (
            <li key={trigger.id} className="flex items-start gap-2 rounded-lg border border-border p-3 text-sm">
              {matched ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" /> : <XCircle className="mt-0.5 h-4 w-4 text-muted-foreground" />}
              <div>
                <div className="font-medium">{trigger.eventType} <span className="ml-1 text-xs text-muted-foreground">{trigger.enabled ? "" : "(disabled)"}</span></div>
                <div className="text-xs text-muted-foreground">{trigger.condition}</div>
              </div>
            </li>
          ))}
        </ul>
      </SectionCard>

      <Accordion type="multiple" defaultValue={["agent", "candidates", "bundles", "decision", "validation"]} className="space-y-3">
        <AccordionItem value="agent" className="overflow-hidden rounded-2xl border border-border bg-card">
          <AccordionTrigger className="px-5 py-4 text-left text-base font-semibold">Consumer Agent position</AccordionTrigger>
          <AccordionContent className="px-5 pb-5">
            <JsonBlock data={r.consumerAgent} />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="candidates" className="overflow-hidden rounded-2xl border border-border bg-card">
          <AccordionTrigger className="px-5 py-4 text-left text-base font-semibold">Candidate merchants</AccordionTrigger>
          <AccordionContent className="px-5 pb-5">
            <ul className="space-y-2">
              {r.candidates.map((c) => (
                <li key={c.merchantId} className="flex items-start justify-between rounded-lg border border-border p-3">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {c.merchantId}
                      {c.considered ? <StatusBadge tone="success">considered</StatusBadge> : <StatusBadge tone="danger">rejected</StatusBadge>}
                    </div>
                    <div className="text-xs text-muted-foreground">{c.reason}{c.rejectedReason ? ` · ${c.rejectedReason}` : ""}</div>
                  </div>
                  <div className="text-sm font-mono">{c.fitScore}</div>
                </li>
              ))}
            </ul>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="bundles" className="overflow-hidden rounded-2xl border border-border bg-card">
          <AccordionTrigger className="px-5 py-4 text-left text-base font-semibold">Candidate bundles</AccordionTrigger>
          <AccordionContent className="px-5 pb-5">
            <ul className="space-y-2">
              {r.candidateBundles.map((b) => (
                <li key={b.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between text-sm">
                    <div className="font-medium">{b.merchantIds.join(" + ")}</div>
                    <div className="flex items-center gap-2">
                      {b.rejectedReason ? <StatusBadge tone="danger">rejected</StatusBadge> : <StatusBadge tone="success">eligible</StatusBadge>}
                      <span className="font-mono text-sm">{b.preliminaryScore}</span>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">{b.rationale}{b.rejectedReason ? ` · ${b.rejectedReason}` : ""}</div>
                </li>
              ))}
            </ul>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="brief" className="overflow-hidden rounded-2xl border border-border bg-card">
          <AccordionTrigger className="px-5 py-4 text-left text-base font-semibold">Negotiation brief (input to agent)</AccordionTrigger>
          <AccordionContent className="px-5 pb-5">
            <JsonBlock data={{
              context: r.brief.context,
              insights: r.brief.insights,
              candidates: r.brief.candidates,
              candidateBundles: r.brief.candidateBundles,
              bundlePolicy: r.brief.bundlePolicy,
              offerPolicy: r.brief.offerPolicy,
              platformGoals: r.brief.platformGoals,
            }} />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="decision" className="overflow-hidden rounded-2xl border border-border bg-card">
          <AccordionTrigger className="px-5 py-4 text-left text-base font-semibold">LLM-style negotiation decision</AccordionTrigger>
          <AccordionContent className="px-5 pb-5 space-y-3">
            <div className="flex flex-wrap gap-2">
              <StatusBadge tone="info">{r.decision.decision}</StatusBadge>
              <StatusBadge tone="neutral">confidence {r.decision.confidence}</StatusBadge>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <UtilityCard label="Consumer" value={r.decision.utilityAssessment.consumerUtility} />
              <UtilityCard label="Merchant" value={r.decision.utilityAssessment.merchantUtility} />
              <UtilityCard label="Platform" value={r.decision.utilityAssessment.platformUtility} />
            </div>
            <div>
              <div className="mb-1 text-sm font-medium">Reasoning</div>
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {r.decision.reasoning.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
            <JsonBlock data={r.decision} />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="validation" className="overflow-hidden rounded-2xl border border-border bg-card">
          <AccordionTrigger className="px-5 py-4 text-left text-base font-semibold">Validator results</AccordionTrigger>
          <AccordionContent className="px-5 pb-5">
            <div className="mb-3">
              {r.validation.passed
                ? <StatusBadge tone="success">all validators passed</StatusBadge>
                : <StatusBadge tone="danger">validation failed</StatusBadge>}
            </div>
            <ul className="space-y-1">
              {r.validation.results.map((v) => (
                <li key={v.validator} className="flex items-start gap-2 rounded-md border border-border px-3 py-2 text-sm">
                  {v.passed ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" /> : <XCircle className="mt-0.5 h-4 w-4 text-destructive" />}
                  <div>
                    <div className="font-medium">{v.validator}</div>
                    <div className="text-xs text-muted-foreground">{v.detail}</div>
                  </div>
                </li>
              ))}
            </ul>
          </AccordionContent>
        </AccordionItem>

        {r.offer && (
          <AccordionItem value="offer" className="overflow-hidden rounded-2xl border border-border bg-card">
            <AccordionTrigger className="px-5 py-4 text-left text-base font-semibold">Final offer</AccordionTrigger>
            <AccordionContent className="px-5 pb-5">
              <JsonBlock data={r.offer} />
            </AccordionContent>
          </AccordionItem>
        )}
      </Accordion>
    </div>
  );
}

function UtilityCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-secondary/40 p-3 text-center">
      <div className="text-xs text-muted-foreground">{label} utility</div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  );
}