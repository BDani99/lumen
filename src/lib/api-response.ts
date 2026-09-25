import { NextResponse } from "next/server";
import {
  GENERIC_ERROR_MESSAGE,
  RATE_LIMIT_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
  TIMEOUT_ERROR_MESSAGE,
  UserFacingError,
  dbErrorMessage,
  isNetworkError,
  isTimeoutError,
  statusOf,
} from "@/lib/errors";

/**
 * Server-side error responses for route handlers. Every error the API sends
 * has the same JSON shape — `{ error: string, code?: string, ref?: string }` —
 * and `error` is ALWAYS a Hungarian, user-safe sentence. Raw exception text
 * (provider bodies, Postgres messages, stack fragments) only ever goes to the
 * server log, tagged with `ref` so a user-reported code can be found in it.
 */

/** Throw inside a route to abort with a specific, user-safe message + status. */
export class HttpError extends UserFacingError {
  constructor(status: number, message: string, code?: string) {
    super(message, { status, code });
    this.name = "HttpError";
  }
}

export function apiError(
  message: string,
  status = 400,
  extra: { code?: string; ref?: string; headers?: Record<string, string> } = {}
) {
  return NextResponse.json(
    { error: message, ...(extra.code ? { code: extra.code } : {}), ...(extra.ref ? { ref: extra.ref } : {}) },
    { status, headers: extra.headers }
  );
}

export function unauthorizedResponse() {
  return apiError(SESSION_EXPIRED_MESSAGE, 401, { code: "unauthorized" });
}

function shortRef() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

/** HTTP status for a Postgres / PostgREST error code (undefined = not a known DB error). */
function statusForDbCode(code: unknown): number | undefined {
  switch (code) {
    case "42501":
      return 403;
    case "PGRST116":
      return 404;
    case "23505":
      return 409;
    case "23502":
    case "23503":
    case "23514":
    case "22P02":
    case "22001":
      return 400;
    case "PGRST301":
    case "PGRST303":
      return 401;
    default:
      return undefined;
  }
}

/**
 * Turns anything a route handler catches into a safe JSON response and logs
 * the real error. Use it as the body of every `catch`:
 *
 *   } catch (err) {
 *     return routeError(err, "api/videos POST");
 *   }
 *
 * It also accepts Supabase `{ error }` objects (`routeError(error, "…")`).
 * Pass `fallback` for a more specific 500 message ("Nem sikerült a mentés.").
 */
export function routeError(err: unknown, tag: string, opts: { fallback?: string } = {}) {
  const ref = shortRef();
  console.error(`[${tag}] ref=${ref}`, err);

  if (err instanceof UserFacingError) {
    return apiError(err.message, err.status ?? 400, { code: err.code });
  }

  if (isNetworkError(err)) {
    return apiError(
      "Egy külső szolgáltatás jelenleg nem érhető el. Próbáld újra néhány perc múlva.",
      502,
      { code: "upstream_unreachable", ref }
    );
  }
  if (isTimeoutError(err)) {
    return apiError(TIMEOUT_ERROR_MESSAGE, 504, { code: "timeout", ref });
  }

  const status = statusOf(err);
  if (err && typeof err === "object" && (err as { code?: unknown }).code === "42501") {
    // Server code runs as service_role; a permission error almost always means the wrong key is configured.
    console.error(
      `[${tag}] ref=${ref} hint: permission denied for a server-side query — check that SUPABASE_SERVICE_ROLE_KEY holds the project's secret/service_role key, not the anon/publishable key`
    );
  }
  if (status === 429) {
    return apiError(RATE_LIMIT_MESSAGE, 429, { code: "rate_limited" });
  }

  const code = err && typeof err === "object" ? (err as { code?: unknown }).code : undefined;
  const dbStatus = statusForDbCode(code);
  if (dbStatus) {
    return apiError(dbErrorMessage(err, opts.fallback ?? GENERIC_ERROR_MESSAGE), dbStatus, {
      code: typeof code === "string" ? code : undefined,
      ref,
    });
  }

  return apiError(opts.fallback ?? GENERIC_ERROR_MESSAGE, 500, { code: "internal", ref });
}
