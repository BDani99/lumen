"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getSupabaseConfig, warnIfSupabaseMisconfigured } from "@/utils/supabase/config";
import { getSession } from "@/lib/auth";
import { getSiteUrl } from "@/lib/site-url";
import { safeNext } from "@/lib/safe-next";
import { isValidEmail } from "@/lib/validation";
import { validatePassword } from "@/lib/password";
import { CONFIG_ERROR_MESSAGE, authErrorMessage, isAuthServiceError } from "@/lib/errors";
import { noticeUrl } from "@/lib/notices";
import type { AuthFormState } from "./form-state";

// NOTE: `redirect()` works by throwing. It must never be called inside a
// try/catch that could swallow it — every try block below only wraps the
// Supabase call, and redirect happens afterwards.

function formString(formData: FormData, name: string, opts: { trim?: boolean } = {}): string {
  const raw = formData.get(name);
  const value = typeof raw === "string" ? raw : "";
  return opts.trim ? value.trim() : value;
}

function fail(message: string, email?: string): AuthFormState {
  return { status: "error", message, email };
}

function misconfigured(scope: string, email?: string): AuthFormState | null {
  if (getSupabaseConfig().configured) return null;
  warnIfSupabaseMisconfigured(scope);
  return fail(CONFIG_ERROR_MESSAGE, email);
}

/** Runs a Supabase auth call, folding both `{ error }` results and thrown network errors into one value. */
async function attempt<T extends { error: unknown }>(scope: string, call: () => Promise<T>): Promise<{ result?: T; failure?: unknown }> {
  try {
    const result = await call();
    if (result.error) {
      // Wrong password etc. is routine; only the backend being down is worth a server log.
      if (isAuthServiceError(result.error)) console.error(`[${scope}] auth service error:`, result.error);
      return { failure: result.error };
    }
    return { result };
  } catch (err) {
    console.error(`[${scope}] auth call threw:`, err);
    return { failure: err };
  }
}

export async function login(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = formString(formData, "email", { trim: true });
  const password = formString(formData, "password");
  const next = safeNext(formString(formData, "next") || "/");

  const fieldErrors: NonNullable<AuthFormState["fieldErrors"]> = {};
  if (!email) fieldErrors.email = "Add meg az email címed.";
  else if (!isValidEmail(email)) fieldErrors.email = "Ez nem tűnik érvényes email címnek.";
  if (!password) fieldErrors.password = "Add meg a jelszavad.";
  if (Object.keys(fieldErrors).length > 0) return { status: "error", fieldErrors, email };

  const config = misconfigured("auth/login", email);
  if (config) return config;

  const supabase = await createClient();
  const { failure } = await attempt("auth/login", () => supabase.auth.signInWithPassword({ email, password }));
  if (failure) return fail(authErrorMessage(failure), email);

  revalidatePath("/", "layout");
  redirect(next);
}

export async function signup(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = formString(formData, "email", { trim: true });
  const password = formString(formData, "password");
  const confirm = formString(formData, "confirm");

  const fieldErrors: NonNullable<AuthFormState["fieldErrors"]> = {};
  if (!email) fieldErrors.email = "Add meg az email címed.";
  else if (!isValidEmail(email)) fieldErrors.email = "Ez nem tűnik érvényes email címnek.";

  if (!password) {
    fieldErrors.password = "Adj meg egy jelszót.";
  } else {
    const problems = validatePassword(password, { email });
    if (problems.length > 0) fieldErrors.password = problems.join(" ");
  }

  if (!confirm) fieldErrors.confirm = "Erősítsd meg a jelszót.";
  else if (password && confirm !== password) fieldErrors.confirm = "A két jelszó nem egyezik.";

  if (Object.keys(fieldErrors).length > 0) return { status: "error", fieldErrors, email };

  const config = misconfigured("auth/signup", email);
  if (config) return config;

  const supabase = await createClient();
  const siteUrl = await getSiteUrl();
  const { result, failure } = await attempt("auth/signup", () =>
    supabase.auth.signUp({
      email,
      password,
      options: siteUrl ? { emailRedirectTo: `${siteUrl}/auth/callback?next=/` } : undefined,
    })
  );
  if (failure) {
    const message = authErrorMessage(failure);
    const code = (failure as { code?: string }).code;
    // Field-level when the problem clearly belongs to one field.
    if (code === "user_already_exists" || code === "email_exists") {
      return { status: "error", fieldErrors: { email: message }, email };
    }
    if (code === "weak_password") {
      return { status: "error", fieldErrors: { password: message }, email };
    }
    return fail(message, email);
  }

  // With email confirmation on, Supabase answers an already-registered address
  // with a fake user that has no identities instead of an error.
  if (result?.data.user && result.data.user.identities?.length === 0) {
    return {
      status: "error",
      fieldErrors: { email: "Ez az email cím már regisztrálva van. Próbálj meg bejelentkezni." },
      email,
    };
  }

  // Email confirmation enabled → no session yet
  if (!result?.data.session) {
    redirect(noticeUrl("registered"));
  }

  revalidatePath("/", "layout");
  redirect("/");
}

export async function requestPasswordReset(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = formString(formData, "email", { trim: true });

  if (!email) return { status: "error", fieldErrors: { email: "Add meg az email címed." }, email };
  if (!isValidEmail(email)) {
    return { status: "error", fieldErrors: { email: "Ez nem tűnik érvényes email címnek." }, email };
  }

  const config = misconfigured("auth/reset-request", email);
  if (config) return config;

  const supabase = await createClient();
  const siteUrl = await getSiteUrl();
  const { failure } = await attempt("auth/reset-request", () =>
    supabase.auth.resetPasswordForEmail(email, {
      redirectTo: siteUrl ? `${siteUrl}/auth/callback?next=/reset-password` : undefined,
    })
  );
  if (failure) return fail(authErrorMessage(failure), email);

  // Same answer whether or not the address has an account (no user enumeration).
  return {
    status: "success",
    message:
      "Ha ehhez az email címhez tartozik fiók, elküldtük a jelszó-visszaállító linket. Nézd meg a postaládád (a spam mappát is).",
    email,
  };
}

export async function logout() {
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  } catch (err) {
    // Logging out must work even while the auth backend is unreachable —
    // otherwise the "Kilépés" button would appear broken. Drop the local
    // session cookies ourselves.
    console.error("[auth/logout] signOut failed, clearing session cookies locally:", err);
    const cookieStore = await cookies();
    for (const c of cookieStore.getAll()) {
      if (c.name.startsWith("sb-")) cookieStore.delete(c.name);
    }
  }
  revalidatePath("/", "layout");
  redirect("/login");
}

export async function updatePassword(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const password = formString(formData, "password");
  const confirm = formString(formData, "confirm");
  const redirectTo = formString(formData, "redirectTo");

  const session = await getSession();
  if (session.status === "anonymous") {
    redirect(noticeUrl("session_expired"));
  }
  if (session.status === "unavailable") return fail(session.message);
  const user = session.user;

  const fieldErrors: NonNullable<AuthFormState["fieldErrors"]> = {};
  if (!password) {
    fieldErrors.password = "Adj meg egy új jelszót.";
  } else {
    const problems = validatePassword(password, { email: user.email ?? undefined });
    if (problems.length > 0) fieldErrors.password = problems.join(" ");
  }
  if (!confirm) fieldErrors.confirm = "Erősítsd meg az új jelszót.";
  else if (password && confirm !== password) fieldErrors.confirm = "A két jelszó nem egyezik.";
  if (Object.keys(fieldErrors).length > 0) return { status: "error", fieldErrors };

  const supabase = await createClient();
  const { failure } = await attempt("auth/update-password", () => supabase.auth.updateUser({ password }));
  if (failure) {
    const message = authErrorMessage(failure);
    const code = (failure as { code?: string }).code;
    if (code === "same_password" || code === "weak_password") {
      return { status: "error", fieldErrors: { password: message } };
    }
    return fail(message);
  }

  revalidatePath("/", "layout");
  if (redirectTo) redirect(safeNext(redirectTo));
  return { status: "success", message: "A jelszavad sikeresen frissítve." };
}
