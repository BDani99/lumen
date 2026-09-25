"use client";

import Link from "next/link";
import { startTransition, useActionState } from "react";
import type { FormEvent } from "react";
import { login } from "@/app/auth/actions";
import { initialAuthState } from "@/app/auth/form-state";
import type { AuthFieldName } from "@/app/auth/form-state";
import { Banner, Button, FieldError, Input, Label, PasswordInput } from "@/components/ui";
import { emailFieldError } from "@/lib/validation";
import { AUTH_LINK_CLASS } from "./AuthShell";
import { useFormErrors } from "./useFormErrors";

export function LoginForm({
  next,
  notice,
}: {
  next: string;
  /** A message that arrived with the redirect (session expired, registered, …). */
  notice?: { tone: "success" | "error" | "info"; message: string };
}) {
  const [state, dispatch, pending] = useActionState(login, initialAuthState);
  const { errorFor, markEdited, setClient } = useFormErrors(state);

  const emailError = errorFor("email");
  const passwordError = errorFor("password");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // Submitted via a transition (not the <form action>) so React doesn't
    // reset the fields after a failed attempt — the email must stay put.
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");

    const errors: Partial<Record<AuthFieldName, string>> = {};
    const emailProblem = emailFieldError(email);
    if (emailProblem) errors.email = emailProblem;
    if (!password) errors.password = "Add meg a jelszavad.";
    setClient(errors);
    if (Object.keys(errors).length > 0) return;

    startTransition(() => dispatch(formData));
  }

  const banner =
    state.status === "error" && state.message
      ? { tone: "error" as const, message: state.message }
      : state.status === "idle"
        ? notice
        : undefined;

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <input type="hidden" name="next" value={next} />

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
          aria-invalid={emailError ? true : undefined}
          aria-describedby={emailError ? "email-error" : undefined}
          onChange={() => markEdited("email")}
        />
        <FieldError id="email-error">{emailError}</FieldError>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Jelszó</Label>
          <Link href="/forgot-password" className={`mb-1.5 text-xs ${AUTH_LINK_CLASS}`}>
            Elfelejtetted?
          </Link>
        </div>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="current-password"
          required
          aria-invalid={passwordError ? true : undefined}
          aria-describedby={passwordError ? "password-error" : undefined}
          onChange={() => markEdited("password")}
        />
        <FieldError id="password-error">{passwordError}</FieldError>
      </div>

      <Button type="submit" className="w-full" loading={pending}>
        {pending ? "Bejelentkezés…" : "Bejelentkezés"}
      </Button>

      {banner && <Banner tone={banner.tone}>{banner.message}</Banner>}
    </form>
  );
}
