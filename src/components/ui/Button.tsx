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

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex cursor-pointer items-center justify-center gap-2 rounded-[var(--radius)] transition-[color,background-color,border-color,transform] duration-100",
        "active:scale-[0.97]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        "disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100",
        sizes[size],
        variants[variant],
        className
      )}
      {...props}
    />
  );
}
