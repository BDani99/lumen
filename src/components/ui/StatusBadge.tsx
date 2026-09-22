import { cn } from "@/lib/cn";
import { statusColorClass, statusLabel } from "@/lib/generation-status";

export function StatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
        statusColorClass(status),
        className
      )}
    >
      {statusLabel(status)}
    </span>
  );
}
