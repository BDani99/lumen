import { cn } from "@/lib/cn";
import type { ReactNode } from "react";

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-3 rounded-[var(--radius-panel)] border border-dashed border-border bg-bg-elevated/50 px-6 py-10 animate-lumen-in",
        className
      )}
    >
      <h3 className="font-display text-xl text-ink tracking-tight">{title}</h3>
      {description && <p className="max-w-md text-sm text-muted leading-relaxed">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
