import { cn } from "@/lib/cn";
import { FOCUS_RING } from "@/lib/ui-tokens";

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
        "relative h-6 w-12 shrink-0 rounded-full transition-[background-color,transform] duration-100 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100",
        FOCUS_RING,
        checked ? "bg-accent" : "bg-border-strong",
        className
      )}
    >
      <span
        className={cn(
          "absolute top-1 left-1 h-4 w-4 rounded-full bg-ink transition-transform duration-150",
          checked ? "translate-x-6" : ""
        )}
      />
    </button>
  );
}
