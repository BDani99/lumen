import type { User } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/server";
import { getSupabaseConfig, warnIfSupabaseMisconfigured } from "@/utils/supabase/config";
import { supabaseAdmin } from "@/lib/supabase";
import { apiError, unauthorizedResponse } from "@/lib/api-response";
import {
  CONFIG_ERROR_MESSAGE,
  FORBIDDEN_MESSAGE,
  UserFacingError,
  authErrorMessage,
  isAuthServiceError,
} from "@/lib/errors";

/**
 * Three-way session state. "No session" (send to /login) and "the auth
 * backend is down / misconfigured" (show an error, do NOT log the user out
 * of the UI) are very different situations and must not be conflated.
 */
export type SessionResult =
  | { status: "ok"; user: User }
  | { status: "anonymous" }
  | { status: "unavailable"; message: string; code: "config" | "auth_unavailable" };

export async function getSession(): Promise<SessionResult> {
  if (!getSupabaseConfig().configured) {
    warnIfSupabaseMisconfigured("auth");
    return { status: "unavailable", message: CONFIG_ERROR_MESSAGE, code: "config" };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    if (error && isAuthServiceError(error)) {
      console.error("[auth] getUser failed — auth service unavailable:", error);
      return { status: "unavailable", message: authErrorMessage(error), code: "auth_unavailable" };
    }
    return data.user ? { status: "ok", user: data.user } : { status: "anonymous" };
  } catch (err) {
    if (isAuthServiceError(err)) {
      console.error("[auth] getUser threw — auth service unavailable:", err);
      return { status: "unavailable", message: authErrorMessage(err), code: "auth_unavailable" };
    }
    throw err;
  }
}

/** The signed-in user, or null when anonymous. Throws when the auth service is unavailable. */
export async function getUser(): Promise<User | null> {
  const session = await getSession();
  if (session.status === "unavailable") {
    throw new UserFacingError(session.message, { status: 503, code: session.code });
  }
  return session.status === "ok" ? session.user : null;
}

/** Throws redirect via never — use in Server Components / actions. */
export async function requireUser(): Promise<User> {
  const session = await getSession();
  if (session.status === "anonymous") {
    const { redirect } = await import("next/navigation");
    redirect("/login");
  }
  if (session.status === "unavailable") {
    throw new UserFacingError(session.message, { status: 503, code: session.code });
  }
  return (session as { status: "ok"; user: User }).user;
}

/** For API routes — returns a JSON error response on failure, or the user. */
export async function requireUserApi(): Promise<
  { user: User; error?: undefined } | { user?: undefined; error: ReturnType<typeof apiError> }
> {
  const session = await getSession();
  if (session.status === "ok") return { user: session.user };
  if (session.status === "unavailable") {
    return { error: apiError(session.message, 503, { code: session.code }) };
  }
  return { error: unauthorizedResponse() };
}

// Ownership checks. A database failure must surface as an error (the route's
// catch → routeError turns it into a proper 5xx/4xx) — NOT be read as "not
// owned", which would tell the user "no permission" during a plain outage.

export async function assertChannelOwned(channelId: string, userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("channels")
    .select("id")
    .eq("id", channelId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function assertProjectOwned(projectId: string, userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("video_projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function assertNamePoolPresetOwned(presetId: string, userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("name_pool_presets")
    .select("id")
    .eq("id", presetId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

/** Pronunciation dictionaries have no user field of their own — ownership is tracked in dictionary_owners. */
export async function assertDictionaryOwned(dictionaryId: number, userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("dictionary_owners")
    .select("dictionary_id")
    .eq("dictionary_id", dictionaryId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export function forbidden(message: string = FORBIDDEN_MESSAGE) {
  return apiError(message, 403, { code: "forbidden" });
}
