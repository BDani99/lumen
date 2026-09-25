"use client";

import { startTransition, useActionState, useState } from "react";
import type { FormEvent } from "react";
import { signup } from "@/app/auth/actions";
import { initialAuthState } from "@/app/auth/form-state";
import type { AuthFieldName } from "@/app/auth/form-state";
import { Banner, Button, FieldError, Input, Label, PasswordInput } from "@/components/ui";
import { validatePassword } from "@/lib/password";
import { emailFieldError } from "@/lib/validation";
import { PasswordStrength } from "./PasswordStrength";
import { useFormErrors } from "./useFormErrors";

export function RegisterForm() {
  const [state, dispatch, pending] = useActionState(signup, initialAuthState);
  const { errorFor, markEdited, setClient } = useFormErrors(state);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const emailError = errorFor("email");
  const passwordError = errorFor("password");
  const confirmError = errorFor("confirm");

  const confirmTouched = confirm.length > 0;
  const passwordsMatch = confirmTouched && confirm === password;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // Not via <form action>: React would clear the fields after a failed
    // attempt, and a rejected password should stay editable.
    event.preventDefault();
    const cleanEmail = email.trim();

    const errors: Partial<Record<AuthFieldName, string>> = {};
    const emailProblem = emailFieldError(cleanEmail);
    if (emailProblem) errors.email = emailProblem;
    if (!password) errors.password = "Adj meg egy jelszót.";
    else {
      const problems = validatePassword(password, { email: cleanEmail });
      if (problems.length > 0) errors.password = problems.join(" ");
    }
    if (!confirm) errors.confirm = "Erősítsd meg a jelszót.";
    else if (confirm !== password) errors.confirm = "A két jelszó nem egyezik.";

    setClient(errors);
    if (Object.keys(errors).length > 0) return;

    startTransition(() => dispatch(new FormData(event.currentTarget)));
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <div>
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoFocus
          required
          value={email}
          aria-invalid={emailError ? true : undefined}
          aria-describedby={emailError ? "email-error" : undefined}
          onChange={(e) => {
            setEmail(e.target.value);
            markEdited("email");
          }}
        />
        <FieldError id="email-error">{emailError}</FieldError>
      </div>

      <div>
        <Label htmlFor="password">Jelszó</Label>
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
        <PasswordStrength password={password} email={email.trim()} />
      </div>

      <div>
        <Label htmlFor="confirm">Jelszó megerősítése</Label>
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

      <Button type="submit" className="w-full" loading={pending}>
        {pending ? "Fiók létrehozása…" : "Regisztráció"}
      </Button>

      {state.status === "error" && state.message && <Banner tone="error">{state.message}</Banner>}
    </form>
  );
}
