"use client";

import { cn } from "@/lib/cn";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

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

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
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
        role="dialog"
        aria-modal="true"
        className={cn(
          "relative z-10 w-full max-w-lg max-h-[min(90vh,880px)] overflow-y-auto",
          "rounded-[var(--radius-panel)] border border-border bg-bg-elevated p-5 sm:p-6",
          "shadow-2xl shadow-black/50 animate-lumen-in",
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
          className="absolute right-3 top-3 cursor-pointer rounded-[var(--radius)] px-2 py-1 text-muted hover:text-ink hover:bg-surface"
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
