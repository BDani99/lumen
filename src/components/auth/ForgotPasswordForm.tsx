"use client";

import { startTransition, useActionState } from "react";
import type { FormEvent } from "react";
import { requestPasswordReset } from "@/app/auth/actions";
import { initialAuthState } from "@/app/auth/form-state";
import { Banner, Button, FieldError, Input, Label } from "@/components/ui";
import { emailFieldError } from "@/lib/validation";
import { useFormErrors } from "./useFormErrors";
import { useState } from "react";

export function ForgotPasswordForm() {
  const [state, dispatch, pending] = useActionState(requestPasswordReset, initialAuthState);
  const { errorFor, markEdited, setClient } = useFormErrors(state);
  const [email, setEmail] = useState("");

  const emailError = errorFor("email");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = emailFieldError(email.trim());
    setClient(problem ? { email: problem } : {});
    if (problem) return;
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

      <Button type="submit" className="w-full" loading={pending}>
        {pending ? "Küldés…" : "Visszaállító link küldése"}
      </Button>

      {state.status === "error" && state.message && <Banner tone="error">{state.message}</Banner>}
      {state.status === "success" && state.message && <Banner tone="success">{state.message}</Banner>}
    </form>
  );
}
