import { cn } from "@/lib/cn";
import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const variants: Record<Variant, string> = {
  primary:
    "bg-accent text-[#0a1211] hover:bg-accent-hover font-semibold shadow-sm shadow-black/20",
  secondary:
    "bg-accent-muted text-ink border border-accent/25 hover:bg-accent/25 hover:border-accent/40",
  ghost: "bg-transparent text-muted hover:text-ink hover:bg-surface",
  danger: "bg-danger-muted text-danger border border-danger/30 hover:bg-danger/20",
};

export function Button({
  variant = "primary",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex cursor-pointer items-center justify-center gap-2 rounded-[var(--radius)] px-4 py-2.5 text-sm transition-[color,background-color,border-color,transform] duration-100",
        "active:scale-[0.97]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        "disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100",
        variants[variant],
        className
      )}
      {...props}
    />
  );
}
