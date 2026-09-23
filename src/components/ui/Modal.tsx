"use client";

import { cn } from "@/lib/cn";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FOCUS_RING } from "@/lib/ui-tokens";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  const [mounted, setMounted] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Move focus into the dialog on open, restore it to the trigger on close —
  // otherwise keyboard/screen-reader focus stays "behind" the modal.
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const first = dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (first ?? dialogRef.current)?.focus();
    return () => {
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      role="presentation"
    >
      <button
        type="button"
        aria-label="Bezárás"
        className="absolute inset-0 cursor-pointer bg-black/70 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={cn(
          "relative z-10 w-full max-w-lg max-h-[min(90vh,880px)] overflow-y-auto",
          "rounded-[var(--radius-panel)] border border-border bg-bg-elevated p-5 sm:p-6",
          "shadow-2xl shadow-black/50 animate-lumen-in",
          "focus:outline-none",
          className
        )}
      >
        {title && (
          <h2 className="font-display text-xl tracking-tight text-ink leading-normal pb-0.5 mb-4 pr-8">
            {title}
          </h2>
        )}
        <button
          type="button"
          onClick={onClose}
          className={cn(
            "absolute right-3 top-3 cursor-pointer rounded-[var(--radius)] p-2 text-muted transition-colors hover:text-ink hover:bg-surface",
            FOCUS_RING
          )}
          aria-label="Bezárás"
        >
          ×
        </button>
        {children}
      </div>
    </div>,
    document.body
  );
}
