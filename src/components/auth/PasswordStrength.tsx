"use client";

import { useMemo } from "react";
import { cn } from "@/lib/cn";
import { evaluatePassword, type PasswordScore } from "@/lib/password";

const BAR_COLOR: Record<PasswordScore, string> = {
  0: "bg-danger",
  1: "bg-danger",
  2: "bg-warning",
  3: "bg-accent",
  4: "bg-success",
};

const LABEL_COLOR: Record<PasswordScore, string> = {
  0: "text-danger",
  1: "text-danger",
  2: "text-warning",
  3: "text-accent",
  4: "text-success",
};

function CheckIcon({ ok }: { ok: boolean }) {
  return (
    <svg
      className={cn("h-3.5 w-3.5 shrink-0", ok ? "text-success" : "text-muted/60")}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ok ? <path d="M3 8.5 6.5 12 13 4.5" /> : <circle cx="8" cy="8" r="4.5" />}
    </svg>
  );
}

/**
 * Live password feedback: 4-segment strength bar, the required rules as a
 * checklist, and reasons the password is refused. Shares `evaluatePassword`
 * with the server-side validation, so what this shows is what the server
 * enforces.
 */
export function PasswordStrength({
  password,
  email,
  className,
}: {
  password: string;
  email?: string;
  className?: string;
}) {
  const evaluation = useMemo(() => evaluatePassword(password, { email }), [password, email]);
  const empty = password.length === 0;
  const { score } = evaluation;
  const filled = empty ? 0 : Math.max(1, score);

  return (
    <div className={cn("mt-2 space-y-2", className)}>
      <div
        role="progressbar"
        aria-label="Jelszó erőssége"
        aria-valuemin={0}
        aria-valuemax={4}
        aria-valuenow={empty ? 0 : score}
        aria-valuetext={empty ? "Még nincs jelszó" : evaluation.label}
        className="flex gap-1.5"
      >
        {[1, 2, 3, 4].map((segment) => (
          <span
            key={segment}
            className={cn(
              "h-1.5 flex-1 rounded-full transition-colors duration-200",
              segment <= filled ? BAR_COLOR[score] : "bg-border-strong"
            )}
          />
        ))}
      </div>

      <p aria-live="polite" className="text-xs text-muted">
        Jelszó erőssége:{" "}
        <strong className={cn("font-medium", empty ? "text-muted" : LABEL_COLOR[score])}>
          {empty ? "—" : evaluation.label}
        </strong>
      </p>

      <ul className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
        {evaluation.checks.map((check) => (
          <li
            key={check.id}
            className={cn("flex items-center gap-1.5", check.passed ? "text-ink" : "text-muted")}
          >
            <CheckIcon ok={check.passed} />
            {check.label}
          </li>
        ))}
      </ul>

      {!empty && evaluation.problems.length > 0 && (
        <ul className="space-y-1 text-xs text-danger" role="alert">
          {evaluation.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}

      {!empty && evaluation.tips.length > 0 && (
        <p className="text-xs text-muted">Erősebb jelszóhoz: {evaluation.tips.join(", ")}.</p>
      )}
    </div>
  );
}
