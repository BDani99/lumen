"use client";

import { startTransition, useActionState, useState } from "react";
import type { FormEvent } from "react";
import { updatePassword } from "@/app/auth/actions";
import { initialAuthState } from "@/app/auth/form-state";
import type { AuthFieldName } from "@/app/auth/form-state";
import { Banner, Button, FieldError, Label, PasswordInput } from "@/components/ui";
import { validatePassword } from "@/lib/password";
import { PasswordStrength } from "./PasswordStrength";
import { useFormErrors } from "./useFormErrors";

/** Set a new password — used on /account and after following a reset link. */
export function ChangePasswordForm({
  email,
  redirectTo,
  submitLabel = "Jelszó frissítése",
}: {
  email?: string;
  /** Where to go after a successful change (server-validated); omit to stay and show a success banner. */
  redirectTo?: string;
  submitLabel?: string;
}) {
  const [state, dispatch, pending] = useActionState(updatePassword, initialAuthState);
  const { errorFor, markEdited, setClient } = useFormErrors(state);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  // A successful change should not leave the new password sitting in the fields.
  const [seenState, setSeenState] = useState(state);
  if (seenState !== state) {
    setSeenState(state);
    if (state.status === "success") {
      setPassword("");
      setConfirm("");
    }
  }

  const passwordError = errorFor("password");
  const confirmError = errorFor("confirm");
  const confirmTouched = confirm.length > 0;
  const passwordsMatch = confirmTouched && confirm === password;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors: Partial<Record<AuthFieldName, string>> = {};
    if (!password) errors.password = "Adj meg egy új jelszót.";
    else {
      const problems = validatePassword(password, { email });
      if (problems.length > 0) errors.password = problems.join(" ");
    }
    if (!confirm) errors.confirm = "Erősítsd meg az új jelszót.";
    else if (confirm !== password) errors.confirm = "A két jelszó nem egyezik.";

    setClient(errors);
    if (Object.keys(errors).length > 0) return;

    startTransition(() => dispatch(new FormData(event.currentTarget)));
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      {redirectTo && <input type="hidden" name="redirectTo" value={redirectTo} />}

      <div>
        <Label htmlFor="password">Új jelszó</Label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          required
          value={password}
          aria-invalid={passwordError ? true : undefined}
          aria-describedby={passwordError ? "password-error" : undefined}
          onChange={(e) => {
            setPassword(e.target.value);
            markEdited("password");
          }}
        />
        <FieldError id="password-error">{passwordError}</FieldError>
        <PasswordStrength password={password} email={email} />
      </div>

      <div>
        <Label htmlFor="confirm">Új jelszó megerősítése</Label>
        <PasswordInput
          id="confirm"
          name="confirm"
          autoComplete="new-password"
          required
          value={confirm}
          aria-invalid={confirmError ? true : undefined}
          aria-describedby={confirmError ? "confirm-error" : undefined}
          onChange={(e) => {
            setConfirm(e.target.value);
            markEdited("confirm");
          }}
        />
        <FieldError id="confirm-error">{confirmError}</FieldError>
        {!confirmError && confirmTouched && password && (
          <p
            aria-live="polite"
            className={`mt-1.5 text-xs ${passwordsMatch ? "text-success" : "text-muted"}`}
          >
            {passwordsMatch ? "A két jelszó egyezik." : "A két jelszó még nem egyezik."}
          </p>
        )}
      </div>

      <Button type="submit" className={redirectTo ? "w-full" : undefined} loading={pending}>
        {pending ? "Mentés…" : submitLabel}
      </Button>

      {state.status === "error" && state.message && <Banner tone="error">{state.message}</Banner>}
      {state.status === "success" && state.message && <Banner tone="success">{state.message}</Banner>}
    </form>
  );
}
