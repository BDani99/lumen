import { cn } from "@/lib/cn";
import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const variants: Record<Variant, string> = {
  primary:
    "bg-accent text-on-accent hover:bg-accent-hover font-semibold shadow-sm shadow-black/20",
  secondary:
    "bg-accent-muted text-ink border border-accent/25 hover:bg-accent/25 hover:border-accent/40",
  ghost: "bg-transparent text-muted hover:text-ink hover:bg-surface",
  danger: "bg-danger-muted text-danger border border-danger/30 hover:bg-danger/20",
};

/** `sm` is for dense rows/toolbars where a full 44px target isn't practical
 * (table actions, chip-style controls) — prefer `md` (the default) anywhere
 * the button is a primary way to trigger something. */
const sizes: Record<Size, string> = {
  md: "px-4 py-2.5 text-sm",
  sm: "px-3 py-1.5 text-xs",
};

function Spinner() {
  return (
    <svg
      className="h-4 w-4 shrink-0 motion-safe:animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className,
  type = "button",
  disabled,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  /** Shows a spinner and blocks clicks (prevents double submits) while an async action runs. */
  loading?: boolean;
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex cursor-pointer items-center justify-center gap-2 rounded-[var(--radius)] transition-[color,background-color,border-color,transform] duration-100",
        "active:scale-[0.97]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        "disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100",
        loading && "disabled:cursor-progress",
        sizes[size],
        variants[variant],
        className
      )}
      {...props}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}
