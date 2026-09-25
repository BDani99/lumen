import { cn } from "@/lib/cn";
import type { ReactNode } from "react";

type Tone = "info" | "success" | "error" | "warning";

const tones: Record<Tone, string> = {
  info: "border-border bg-surface text-ink",
  success: "border-success/30 bg-success-muted text-ink",
  error: "border-danger/30 bg-danger-muted text-ink",
  warning: "border-warning/30 bg-warning-muted text-ink",
};

export function Banner({
  tone = "info",
  children,
  className,
  title,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-[var(--radius-panel)] border px-4 py-3 text-sm animate-lumen-in",
        tones[tone],
        className
      )}
    >
      {title && <p className="font-medium text-ink mb-0.5">{title}</p>}
      <div className="text-muted [&_strong]:text-ink">{children}</div>
    </div>
  );
}
