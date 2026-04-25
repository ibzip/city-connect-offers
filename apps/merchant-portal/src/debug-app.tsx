"use client";

import { useEffect, useState } from "react";
import type { OrchestrationResult } from "@city-wallet/contracts";
import { JsonPanel, Section } from "@city-wallet/ui";
import { apiGet } from "./api";

export function DebugApp() {
  const [lastRun, setLastRun] = useState<OrchestrationResult | null>(null);

  useEffect(() => {
    apiGet<OrchestrationResult | null>("/api/debug/last-run").then(setLastRun).catch(console.error);
  }, []);

  return (
    <Section>
      <div className="mb-6">
        <h1 className="font-serif text-3xl">Debug</h1>
        <p className="mt-1 text-sm text-ink-muted">Merchant-side view of the latest negotiation brief, decision, validation, and lifecycle events.</p>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <JsonPanel title="Merchant Insights" data={lastRun?.merchantInsights} />
        <JsonPanel title="Bundle Candidates" data={lastRun?.bundleCandidates} />
        <JsonPanel title="Decision" data={lastRun?.negotiationDecision} />
        <JsonPanel title="Events" data={lastRun?.analyticsEvents} />
      </div>
    </Section>
  );
}
