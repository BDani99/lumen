import { cn } from "@/lib/cn";
import type { InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes } from "react";

type Size = "sm" | "md";

const sizeClass: Record<Size, string> = {
  md: "px-3 py-2.5 text-sm",
  sm: "px-2.5 py-1.5 text-xs",
};

/* Border already turns accent-colored on focus, so the ring sits flush
 * against it (no ring-offset) — an offset would leave a gap that reads as a
 * second, disconnected outline around the field. */
const fieldClass =
  "w-full rounded-[var(--radius)] border border-border bg-bg-elevated text-ink placeholder:text-muted/70 transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-50 aria-invalid:border-danger aria-invalid:focus:border-danger aria-invalid:focus:ring-danger/40";

export function Input({
  className,
  size = "md",
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & { size?: Size }) {
  return <input className={cn(fieldClass, sizeClass[size], className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(fieldClass, sizeClass.md, "resize-y min-h-[6rem]", className)} {...props} />;
}

export function Select({
  className,
  children,
  size = "md",
  ...props
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> & { size?: Size }) {
  return (
    <select className={cn(fieldClass, sizeClass[size], "cursor-pointer", className)} {...props}>
      {children}
    </select>
  );
}

export function Label({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("mb-1.5 block text-sm font-medium text-muted", className)}
      {...props}
    />
  );
}
