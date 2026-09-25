"use client";

import { useId, useState } from "react";
import type { InputHTMLAttributes, KeyboardEvent } from "react";
import { cn } from "@/lib/cn";
import { FOCUS_RING } from "@/lib/ui-tokens";
import { Input } from "./Input";

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg
      className="h-[18px] w-[18px]"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
      {off && <path d="M4 4l16 16" />}
    </svg>
  );
}

/**
 * Password field with a show/hide toggle and a Caps Lock hint. Drop-in for
 * `<Input type="password">` — works controlled or uncontrolled.
 */
export function PasswordInput({
  id,
  className,
  capsLockHint = true,
  onKeyDown,
  onKeyUp,
  onBlur,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> & {
  capsLockHint?: boolean;
}) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  const trackCapsLock = (e: KeyboardEvent<HTMLInputElement>) => {
    if (typeof e.getModifierState === "function") setCapsLock(e.getModifierState("CapsLock"));
  };

  return (
    <div>
      <div className="relative">
        <Input
          {...props}
          id={inputId}
          type={visible ? "text" : "password"}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className={cn("pr-11", className)}
          onKeyDown={(e) => {
            trackCapsLock(e);
            onKeyDown?.(e);
          }}
          onKeyUp={(e) => {
            trackCapsLock(e);
            onKeyUp?.(e);
          }}
          onBlur={(e) => {
            setCapsLock(false);
            onBlur?.(e);
          }}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Jelszó elrejtése" : "Jelszó megjelenítése"}
          aria-pressed={visible}
          aria-controls={inputId}
          className={cn(
            "absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-[var(--radius)] text-muted transition-colors hover:text-ink",
            FOCUS_RING
          )}
        >
          <EyeIcon off={visible} />
        </button>
      </div>
      {capsLockHint && capsLock && (
        <p role="status" className="mt-1.5 text-xs text-warning animate-lumen-in">
          A Caps Lock be van kapcsolva.
        </p>
      )}
    </div>
  );
}
