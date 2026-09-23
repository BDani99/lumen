import { cn } from "@/lib/cn";
import type { ReactNode } from "react";

/**
 * One consistent "labeled section of a form" treatment — title, optional
 * description, a top divider, children. Used by ChannelForm's sections so
 * a long settings page reads as distinct chunks instead of one wall of
 * differently-styled boxes.
 */
export function FormSection({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  /** An inline control (e.g. an enable/disable Toggle) next to the title. */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-4 border-t border-border pt-6", className)}>
      <div className={cn(Boolean(action) && "flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3")}>
        <div>
          <h3 className="font-display text-lg tracking-tight text-ink">{title}</h3>
          {description && <p className="mt-1 text-xs text-muted">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/** A lighter sub-grouping inside a FormSection — for e.g. "stock media" vs
 * "location shots" vs "zoom" clusters that live inside one bigger section
 * but still need their own scannable label. */
export function FormSubsection({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-3", className)}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{title}</p>
      {children}
    </div>
  );
}
