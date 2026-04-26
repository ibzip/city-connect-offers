import type { ReactNode } from "react";
import { CheckCircle2, ChevronDown, Clock, ShieldCheck } from "lucide-react";
import type { AnalyticsEvent } from "@city-wallet/contracts";
import { cn } from "./lib";

export function Button({
  children,
  className,
  variant = "primary",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
        variant === "primary" && "bg-teal text-primary-foreground hover:opacity-90",
        variant === "secondary" && "bg-muted text-ink hover:bg-muted/70",
        variant === "ghost" && "text-ink-muted hover:bg-black/5 hover:text-ink",
        variant === "danger" && "bg-destructive text-destructive-foreground hover:opacity-90",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("surface-card rounded-2xl p-5", className)}>{children}</div>;
}

export function Section({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("max-w-[1400px] mx-auto px-5 sm:px-6 py-6", className)}>{children}</section>;
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "blue" | "green" | "purple" | "red" | "orange";
}) {
  const tones = {
    neutral: "bg-black/5 text-ink-muted",
    blue: "bg-blue-100 text-blue-800",
    green: "bg-green-100 text-green-800",
    purple: "bg-purple-100 text-purple-800",
    red: "bg-red-100 text-red-800",
    orange: "bg-orange-100 text-orange-800",
  };
  return <span className={cn("label-tag inline-flex items-center", tones[tone])}>{children}</span>;
}

export function StatCard({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) {
  return (
    <div className="bg-paper rounded-lg p-3">
      <div className="text-[10px] uppercase tracking-wider text-ink-muted">{label}</div>
      <div className="text-base text-ink mt-1 tabular-nums">{value}</div>
      {detail ? <div className="text-[11px] text-ink-muted mt-1">{detail}</div> : null}
    </div>
  );
}

export function Timeline({ events }: { events: AnalyticsEvent[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-ink-muted">No events recorded yet.</p>;
  }
  return (
    <div className="space-y-3">
      {events.map((event) => (
        <div key={event.eventId} className="flex gap-3 text-sm">
          <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-teal" />
          <div>
            <div className="font-medium">{event.message}</div>
            <div className="font-mono text-[11px] text-ink-muted">{event.type} · {new Date(event.createdAt).toLocaleTimeString()}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function JsonPanel({ title, data }: { title: string; data: unknown }) {
  return (
    <Card>
      <Badge>{title}</Badge>
      <pre className="mt-3 max-h-[360px] overflow-auto rounded-lg bg-paper p-3 font-mono text-[11px] leading-relaxed text-ink/80">
        {data ? JSON.stringify(data, null, 2) : "-"}
      </pre>
    </Card>
  );
}

export function ExplainabilityPanel({ children, title = "Why this offer?" }: { children: ReactNode; title?: string }) {
  return (
    <details className="surface-card rounded-2xl p-4">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium">
        <span>{title}</span>
        <ChevronDown size={16} className="text-ink-muted" />
      </summary>
      <div className="mt-3 text-sm text-ink-muted">{children}</div>
    </details>
  );
}

export function ProviderBadge({ label, tone = "green" }: { label: string; tone?: "green" | "blue" | "purple" }) {
  return <Badge tone={tone}>{label}</Badge>;
}

export function EventLog({ events }: { events: AnalyticsEvent[] }) {
  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-serif text-xl">Event Log</h3>
        <Badge tone="orange">{events.length} events</Badge>
      </div>
      <Timeline events={events} />
    </Card>
  );
}

export function TrustNote() {
  return (
    <div className="flex gap-2 rounded-xl bg-green-50 p-3 text-xs text-green-900">
      <ShieldCheck size={16} className="mt-0.5 shrink-0" />
      <span>Raw personal data stays private. The system uses only abstract intent and local context.</span>
    </div>
  );
}

export function SuccessLine({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-sm text-success">
      <CheckCircle2 size={16} />
      {children}
    </div>
  );
}

export function ValidityPill({ minutes }: { minutes: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-black/5 px-2.5 py-1 text-xs text-ink-muted">
      <Clock size={13} /> Valid {minutes} min
    </span>
  );
}
