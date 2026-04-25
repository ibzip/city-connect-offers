import { LayerBadge } from "./LayerBadge";
import type { DemoTimelineStep } from "../types";
import { cn } from "@/lib/utils";

export function Timeline({ steps, empty }: { steps: DemoTimelineStep[]; empty?: string }) {
  if (steps.length === 0) {
    return <p className="text-sm text-muted-foreground">{empty ?? "Nothing yet."}</p>;
  }
  return (
    <ol className="relative space-y-3 border-l border-border pl-5">
      {steps.map((s, idx) => (
        <li key={s.id} className="relative">
          <span className={cn("absolute -left-[27px] top-1.5 h-3 w-3 rounded-full ring-2 ring-background", `bg-layer-${s.layer}`)} />
          <div className="rounded-lg border border-border bg-card px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-mono text-muted-foreground">#{idx + 1}</span>
              <span className="text-sm font-medium">{s.title}</span>
              <LayerBadge layer={s.layer} />
            </div>
            {s.detail && <p className="mt-1 text-xs text-muted-foreground">{s.detail}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}