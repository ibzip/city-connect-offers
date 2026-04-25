import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import { LayerBadge } from "./LayerBadge";
import type { LayerKey } from "../types";

interface Props {
  title: string;
  description?: string;
  layer?: LayerKey;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function SectionCard({ title, description, layer, actions, children, className }: Props) {
  return (
    <section
      className={cn(
        "rounded-2xl border border-border bg-card shadow-soft transition-shadow hover:shadow-elevated",
        className,
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 px-5 py-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold tracking-tight">{title}</h2>
            {layer && <LayerBadge layer={layer} />}
          </div>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </header>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}