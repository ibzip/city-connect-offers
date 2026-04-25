import { cn } from "@/lib/utils";
import type { LayerKey } from "../types";

const LAYER_META: Record<LayerKey, { label: string; bg: string; text: string }> = {
  config: { label: "Config / Provider", bg: "bg-layer-config/15", text: "text-layer-config" },
  merchant: { label: "Merchant Insight", bg: "bg-layer-merchant/15", text: "text-layer-merchant" },
  consumer: { label: "Consumer Context", bg: "bg-layer-consumer/15", text: "text-layer-consumer" },
  negotiation: { label: "Negotiation", bg: "bg-layer-negotiation/15", text: "text-layer-negotiation" },
  validation: { label: "Validation", bg: "bg-layer-validation/15", text: "text-layer-validation" },
  redemption: { label: "Redemption", bg: "bg-layer-redemption/15", text: "text-layer-redemption" },
};

export function LayerBadge({ layer, className, label }: { layer: LayerKey; className?: string; label?: string }) {
  const meta = LAYER_META[layer];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        meta.bg,
        meta.text,
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", `bg-layer-${layer}`)} />
      {label ?? meta.label}
    </span>
  );
}

export function layerHex(layer: LayerKey): string {
  return `hsl(var(--layer-${layer}))`;
}