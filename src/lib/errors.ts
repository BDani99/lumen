/**
 * Central error → user-message layer, shared by server code (actions, route
 * handlers, server components) and client code. Pure functions only — no
 * server- or browser-only imports — so it is safe to import from anywhere.
 *
 * Rule of thumb: raw `Error.message` strings are NEVER shown to the user.
 * They are English, technical and can leak internals ("fetch failed",
 * Postgres constraint names, provider error bodies). Only messages carried by
 * a `UserFacingError` (or produced by the mappers below) are safe to display.
 */

export const GENERIC_ERROR_MESSAGE =
  "Váratlan hiba történt. Próbáld újra, és ha továbbra is fennáll, jelezd az üzemeltetőnek.";
export const NETWORK_ERROR_MESSAGE =
  "Nem sikerült kapcsolódni a szerverhez. Ellenőrizd az internetkapcsolatod, majd próbáld újra.";
export const TIMEOUT_ERROR_MESSAGE =
  "A szerver túl sokáig nem válaszolt. Próbáld újra egy kicsit később.";
export const SESSION_EXPIRED_MESSAGE = "A munkamenet lejárt. Jelentkezz be újra.";
export const SERVICE_UNAVAILABLE_MESSAGE =
  "A szolgáltatás átmenetileg nem érhető el. Próbáld újra néhány perc múlva.";
export const CONFIG_ERROR_MESSAGE =
  "A szolgáltatás nincs megfelelően beállítva. Értesítsd az üzemeltetőt.";
export const FORBIDDEN_MESSAGE = "Ehhez nincs jogosultságod.";
export const NOT_FOUND_MESSAGE = "A keresett elem nem található, vagy nincs hozzáférésed.";
export const RATE_LIMIT_MESSAGE = "Túl sok kérés — próbáld újra később.";

/** An error whose `message` is written for the end user (Hungarian, no internals). */
export class UserFacingError extends Error {
  readonly status?: number;
  readonly code?: string;

  constructor(message: string, options: { status?: number; code?: string } = {}) {
    super(message);
    this.name = "UserFacingError";
    this.status = options.status;
    this.code = options.code;
  }
}

/** Walks `message`, `name`, `code` and nested `cause`s into one searchable string. */
function errorText(err: unknown, depth = 0): string {
  if (err == null || depth > 3) return "";
  if (typeof err === "string") return err;
  if (typeof err !== "object") return String(err);
  const e = err as { message?: unknown; name?: unknown; code?: unknown; cause?: unknown };
  return [
    typeof e.name === "string" ? e.name : "",
    typeof e.message === "string" ? e.message : "",
    typeof e.code === "string" ? e.code : "",
    errorText(e.cause, depth + 1),
  ]
    .filter(Boolean)
    .join(" ");
}

const NETWORK_PATTERNS = [
  /fetch failed/i,
  /failed to fetch/i,
  /network ?error/i,
  /network request failed/i,
  /load failed/i, // Safari
  /AuthRetryableFetchError/i,
  /ECONNREFUSED/i,
  /ECONNRESET/i,
  /ENOTFOUND/i,
  /EAI_AGAIN/i,
  /ETIMEDOUT/i,
  /UND_ERR_CONNECT_TIMEOUT/i,
  /UND_ERR_SOCKET/i,
  /socket hang up/i,
  /getaddrinfo/i,
];

/** The request never got an answer: offline, DNS failure, refused/reset connection, … */
export function isNetworkError(err: unknown): boolean {
  const text = errorText(err);
  return NETWORK_PATTERNS.some((p) => p.test(text));
}

export function isTimeoutError(err: unknown): boolean {
  if (err && typeof err === "object" && (err as { name?: unknown }).name === "TimeoutError") {
    return true;
  }
  return /timed? ?out|timeout|gateway time-?out/i.test(errorText(err)) && !isNetworkError(err);
}

/** User cancelled / component unmounted — not an error worth showing. */
export function isAbortError(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    (err as { name?: unknown }).name === "AbortError"
  );
}

/** Best-effort HTTP status from the many shapes errors take. */
export function statusOf(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } };
  for (const v of [e.status, e.statusCode, e.response?.status]) {
    if (typeof v === "number" && v >= 100 && v < 600) return v;
  }
  return undefined;
}

export function messageForStatus(status: number): string {
  switch (status) {
    case 400:
    case 422:
      return "A megadott adatok érvénytelenek. Ellenőrizd őket, majd próbáld újra.";
    case 401:
      return SESSION_EXPIRED_MESSAGE;
    case 403:
      return FORBIDDEN_MESSAGE;
    case 404:
      return NOT_FOUND_MESSAGE;
    case 408:
    case 504:
      return TIMEOUT_ERROR_MESSAGE;
    case 409:
      return "Ez a művelet ütközik egy másikkal. Frissítsd az oldalt, majd próbáld újra.";
    case 413:
      return "A küldött adat túl nagy.";
    case 429:
      return RATE_LIMIT_MESSAGE;
    case 502:
    case 503:
      return SERVICE_UNAVAILABLE_MESSAGE;
    default:
      return status >= 500
        ? "Szerverhiba történt. Próbáld újra később, és ha továbbra is fennáll, jelezd az üzemeltetőnek."
        : GENERIC_ERROR_MESSAGE;
  }
}

/**
 * The one function UI code should call to turn a caught value into text.
 * `UserFacingError` messages pass through; everything else is classified
 * (network / timeout / status) or replaced by `fallback` — never echoed raw.
 */
export function friendlyErrorMessage(err: unknown, fallback = GENERIC_ERROR_MESSAGE): string {
  if (err instanceof UserFacingError) return err.message;
  if (isNetworkError(err)) return NETWORK_ERROR_MESSAGE;
  if (isTimeoutError(err)) return TIMEOUT_ERROR_MESSAGE;
  const status = statusOf(err);
  if (status && status >= 500) return messageForStatus(status);
  return fallback;
}

// ---------------------------------------------------------------------------
// Supabase Auth
// ---------------------------------------------------------------------------

type AuthErrorLike = { message?: string; code?: string; status?: number; name?: string };

/** The auth backend itself is unreachable/broken — as opposed to "wrong password". */
export function isAuthServiceError(err: unknown): boolean {
  if (!err) return false;
  if (isNetworkError(err)) return true;
  const status = statusOf(err);
  return status !== undefined && status >= 500;
}

/** Supabase Auth error → Hungarian message. Falls back to text heuristics for old error shapes. */
export function authErrorMessage(err: unknown): string {
  if (isAuthServiceError(err)) {
    return isNetworkError(err) ? NETWORK_ERROR_MESSAGE : SERVICE_UNAVAILABLE_MESSAGE;
  }

  const e = (err && typeof err === "object" ? err : {}) as AuthErrorLike;
  const code = e.code ?? "";
  const text = errorText(err).toLowerCase();

  switch (code) {
    case "invalid_credentials":
      return "Hibás email vagy jelszó.";
    case "email_not_confirmed":
      return "Az email címed még nincs megerősítve. Nézd meg a postaládád (a spam mappát is), és kattints a kapott linkre.";
    case "user_already_exists":
    case "email_exists":
      return "Ez az email cím már regisztrálva van.";
    case "weak_password":
      return "A jelszó túl gyenge. Használj hosszabb, összetettebb jelszót.";
    case "same_password":
      return "Az új jelszó nem egyezhet meg a jelenlegivel.";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
    case "over_sms_send_rate_limit":
      return "Túl sok próbálkozás. Várj néhány percet, majd próbáld újra.";
    case "signup_disabled":
    case "email_provider_disabled":
      return "A regisztráció jelenleg nem elérhető.";
    case "validation_failed":
    case "email_address_invalid":
      return "Érvénytelen email cím.";
    case "user_banned":
      return "Ez a fiók le van tiltva. Vedd fel a kapcsolatot az üzemeltetővel.";
    case "user_not_found":
      return "Nem található ilyen felhasználó.";
    case "session_expired":
    case "session_not_found":
    case "refresh_token_not_found":
    case "refresh_token_already_used":
    case "bad_jwt":
    case "no_authorization":
      return SESSION_EXPIRED_MESSAGE;
    case "reauthentication_needed":
      return "Biztonsági okból jelentkezz be újra, majd próbáld meg újra a műveletet.";
    case "otp_expired":
    case "flow_state_expired":
    case "flow_state_not_found":
    case "bad_code_verifier":
      return "A link érvénytelen vagy lejárt. Kérj egy újat.";
  }

  if (text.includes("invalid login") || text.includes("invalid credentials")) {
    return "Hibás email vagy jelszó.";
  }
  if (text.includes("email not confirmed")) {
    return "Az email címed még nincs megerősítve. Nézd meg a postaládád (a spam mappát is).";
  }
  if (text.includes("already registered") || text.includes("already been registered")) {
    return "Ez az email cím már regisztrálva van.";
  }
  if (text.includes("rate limit") || text.includes("too many")) {
    return "Túl sok próbálkozás. Várj néhány percet, majd próbáld újra.";
  }
  if (text.includes("password") && (text.includes("least") || text.includes("weak"))) {
    return "A jelszó túl gyenge. Használj hosszabb, összetettebb jelszót.";
  }
  if (text.includes("same password") || text.includes("different from the old")) {
    return "Az új jelszó nem egyezhet meg a jelenlegivel.";
  }
  if (text.includes("session") && (text.includes("missing") || text.includes("expired"))) {
    return SESSION_EXPIRED_MESSAGE;
  }
  if (text.includes("email") && text.includes("invalid")) {
    return "Érvénytelen email cím.";
  }
  return "Nem sikerült a művelet. Próbáld újra, és ha továbbra is fennáll, jelezd az üzemeltetőnek.";
}

// ---------------------------------------------------------------------------
// Postgres / PostgREST (Supabase data API)
// ---------------------------------------------------------------------------

/** Supabase data-API error → Hungarian message. Never returns the raw DB message. */
export function dbErrorMessage(err: unknown, fallback = GENERIC_ERROR_MESSAGE): string {
  if (isNetworkError(err)) return NETWORK_ERROR_MESSAGE;
  const e = (err && typeof err === "object" ? err : {}) as { code?: string; message?: string };
  switch (e.code) {
    case "42501": // insufficient_privilege (RLS)
      return FORBIDDEN_MESSAGE;
    case "PGRST116": // no rows for .single()
      return NOT_FOUND_MESSAGE;
    case "23505": // unique_violation
      return "Ilyen elem már létezik.";
    case "23503": // foreign_key_violation
      return "A művelet egy másik, hiányzó vagy még használatban lévő elemhez kapcsolódik.";
    case "23502": // not_null_violation
    case "23514": // check_violation
    case "22P02": // invalid_text_representation (e.g. malformed uuid)
    case "22001": // string_data_right_truncation
      return "A megadott adatok érvénytelenek. Ellenőrizd őket, majd próbáld újra.";
    case "PGRST301": // JWT expired
    case "PGRST303":
      return SESSION_EXPIRED_MESSAGE;
  }
  if (/jwt expired|jwt/i.test(e.message ?? "")) return SESSION_EXPIRED_MESSAGE;
  const status = statusOf(err);
  if (status && status >= 500) return SERVICE_UNAVAILABLE_MESSAGE;
  return fallback;
}
