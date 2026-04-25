import { providerLabels } from "../config/providers";
import { cn } from "@/lib/utils";

export function ProviderTag({ providerId, className }: { providerId: string; className?: string }) {
  const meta = providerLabels[providerId] ?? { label: providerId, real: false };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide",
        meta.real
          ? "border-success/40 bg-success/10 text-success"
          : "border-layer-config/30 bg-layer-config/10 text-layer-config",
        className,
      )}
      title={meta.real ? "Real / configurable source" : "Simulated source (pluggable)"}
    >
      <span className={cn("h-1 w-1 rounded-full", meta.real ? "bg-success" : "bg-layer-config")} />
      {meta.real ? "REAL" : "SIM"} · {meta.label}
    </span>
  );
}