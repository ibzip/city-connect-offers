import { useAppStore } from "../store/AppStore";

export function DebugPage() {
  const { state } = useAppStore();
  const { lastOrchestration, events } = state;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl">Debug</h1>
        <p className="text-ink-muted text-sm mt-1">Full negotiation brief, raw gpt-5.2 decision, validators, and analytics events.</p>
      </div>
      <div className="grid lg:grid-cols-2 gap-5">
        <Block title="Negotiation Brief" data={lastOrchestration?.brief} />
        <Block title="LLM Decision" data={lastOrchestration?.decision} />
        <Block title="Validation Report" data={lastOrchestration?.validation} />
        <Block title="LLM Metadata" data={lastOrchestration?.llm} />
        <Block title="Recent Events" data={events.slice(0, 30)} />
      </div>
    </div>
  );
}

function Block({ title, data }: { title: string; data: unknown }) {
  return (
    <div className="surface-card rounded-2xl p-5">
      <div className="label-tag bg-black/5 text-ink-muted mb-3 inline-block">{title}</div>
      <pre className="text-[11px] font-mono text-ink/80 overflow-auto max-h-[360px] bg-paper p-3 rounded-lg">
        {data ? JSON.stringify(data, null, 2) : "—"}
      </pre>
    </div>
  );
}