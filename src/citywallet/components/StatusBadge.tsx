import { cn } from "@/lib/utils";

type Variant = "neutral" | "teal" | "success" | "warning" | "danger";

const styles: Record<Variant, string> = {
  neutral: "bg-black/5 text-ink-muted",
  teal: "bg-teal/10 text-teal",
  success: "bg-success-bg text-success",
  warning: "bg-amber-100 text-amber-900",
  danger: "bg-red-100 text-red-900",
};

export function StatusBadge({
  children,
  variant = "neutral",
  className,
}: {
  children: React.ReactNode;
  variant?: Variant;
  className?: string;
}) {
  return (
    <span className={cn("label-tag font-medium", styles[variant], className)}>
      {children}
    </span>
  );
}