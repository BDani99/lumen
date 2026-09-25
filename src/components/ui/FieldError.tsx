import { cn } from "@/lib/cn";

/**
 * Inline validation message under a field. Pair it with `aria-invalid` and
 * `aria-describedby={id}` on the input so screen readers announce it.
 */
export function FieldError({
  id,
  children,
  className,
}: {
  id?: string;
  children?: string | null;
  className?: string;
}) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className={cn("mt-1.5 text-xs text-danger animate-lumen-in", className)}>
      {children}
    </p>
  );
}
