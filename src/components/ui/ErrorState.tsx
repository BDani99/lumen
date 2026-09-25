import { cn } from "@/lib/cn";
import type { ReactNode } from "react";
import { RefreshButton } from "./RefreshButton";

/**
 * Page/section-level "this failed to load" panel. Use it INSTEAD of an
 * EmptyState when a query errors — an empty list and a failed load look
 * identical to the user but mean opposite things.
 */
export function ErrorState({
  title = "Nem sikerült betölteni",
  description,
  reference,
  action,
  retry = true,
  className,
}: {
  title?: string;
  description: string;
  /** Support code shown to the user (matches the server log). */
  reference?: string;
  /** Replaces the default retry button. */
  action?: ReactNode;
  /** Show the built-in "Újrapróbálás" (router refresh) button. */
  retry?: boolean;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-start gap-3 rounded-[var(--radius-panel)] border border-danger/30 bg-danger-muted px-6 py-8 animate-lumen-in",
        className
      )}
    >
      <h2 className="font-display text-xl text-ink tracking-tight">{title}</h2>
      <p className="max-w-lg text-sm text-muted leading-relaxed">{description}</p>
      {reference && <p className="font-mono text-xs text-muted">Hibakód: {reference}</p>}
      {(action || retry) && <div className="mt-1">{action ?? <RefreshButton />}</div>}
    </div>
  );
}
