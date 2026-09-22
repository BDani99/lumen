import { cn } from "@/lib/cn";

export function SegmentedTabs<T extends string>({
  options,
  value,
  onChange,
  disabled,
  className,
}: {
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex gap-1 rounded-[var(--radius)] border border-border bg-bg-elevated p-1",
        className
      )}
    >
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          disabled={disabled}
          onClick={() => onChange(opt.id)}
          className={cn(
            "flex-1 cursor-pointer rounded-[calc(var(--radius)-2px)] px-3 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50",
            value === opt.id ? "bg-accent-muted text-ink font-medium" : "text-muted hover:text-ink"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
