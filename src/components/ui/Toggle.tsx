import { cn } from "@/lib/cn";

export function Toggle({
  checked,
  onChange,
  disabled,
  className,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  className?: string;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-6 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50",
        checked ? "bg-accent" : "bg-border-strong",
        className
      )}
    >
      <span
        className={cn(
          "absolute top-1 left-1 h-4 w-4 rounded-full bg-ink transition-transform",
          checked ? "translate-x-6" : ""
        )}
      />
    </button>
  );
}
