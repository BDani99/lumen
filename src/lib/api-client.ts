import {
  GENERIC_ERROR_MESSAGE,
  NETWORK_ERROR_MESSAGE,
  RATE_LIMIT_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
  TIMEOUT_ERROR_MESSAGE,
  UserFacingError,
  friendlyErrorMessage,
  isAbortError,
  messageForStatus,
} from "@/lib/errors";

/**
 * Browser-side fetch wrapper. Every failure — offline, DNS/connection error,
 * timeout, expired session, rate limit, HTML error page from the platform,
 * malformed JSON — comes out as ONE `ApiError` carrying a Hungarian message
 * that is safe to show as-is:
 *
 *   try {
 *     const data = await apiFetch<{ project: Project }>("/api/videos", { method: "POST", json: body });
 *   } catch (e) {
 *     setError(getErrorMessage(e, "A videó indítása nem sikerült."));
 *   }
 */
export class ApiError extends UserFacingError {
  readonly kind: "network" | "timeout" | "http" | "invalid_response";
  readonly retryAfterSeconds?: number;
  /** Support reference from the server log (5xx only). */
  readonly ref?: string;

  constructor(
    message: string,
    options: {
      kind: ApiError["kind"];
      status?: number;
      code?: string;
      retryAfterSeconds?: number;
      ref?: string;
    }
  ) {
    super(message, { status: options.status, code: options.code });
    this.name = "ApiError";
    this.kind = options.kind;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.ref = options.ref;
  }
}

export type ApiFetchOptions = Omit<RequestInit, "body"> & {
  /** JSON-serialised as the body (sets Content-Type). */
  json?: unknown;
  body?: BodyInit | null;
  /** Abort and fail with a timeout message after this many ms (default: none). */
  timeoutMs?: number;
  /** On a 401, send the user to /login (default true). */
  redirectOn401?: boolean;
};

let redirectingToLogin = false;

function redirectToLogin() {
  if (typeof window === "undefined" || redirectingToLogin) return;
  const { pathname, search } = window.location;
  if (pathname.startsWith("/login") || pathname.startsWith("/register")) return;
  redirectingToLogin = true;
  const next = encodeURIComponent(`${pathname}${search}`);
  window.location.assign(`/login?notice=session_expired&next=${next}`);
}

async function readErrorBody(res: Response): Promise<{ message?: string; code?: string; ref?: string }> {
  try {
    const text = await res.text();
    const body = JSON.parse(text) as { error?: unknown; message?: unknown; code?: unknown; ref?: unknown };
    const raw = typeof body.error === "string" ? body.error : typeof body.message === "string" ? body.message : "";
    return {
      message: raw.trim() && raw.length <= 500 ? raw.trim() : undefined,
      code: typeof body.code === "string" ? body.code : undefined,
      ref: typeof body.ref === "string" ? body.ref : undefined,
    };
  } catch {
    // Not JSON (e.g. an HTML gateway-timeout page from the platform) — status text decides.
    return {};
  }
}

/** Like fetch(), but throws `ApiError` for network failures and non-2xx responses. */
export async function apiFetchResponse(input: string, options: ApiFetchOptions = {}): Promise<Response> {
  const { json, timeoutMs, redirectOn401 = true, headers, signal, ...rest } = options;

  const init: RequestInit = { ...rest, signal };
  const merged = new Headers(headers);
  if (json !== undefined) {
    init.body = JSON.stringify(json);
    if (!merged.has("Content-Type")) merged.set("Content-Type", "application/json");
  }
  init.headers = merged;

  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (timeoutMs && timeoutMs > 0) {
    const controller = new AbortController();
    if (signal) {
      if (signal.aborted) controller.abort(signal.reason);
      else signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
    }
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    init.signal = controller.signal;
  }

  let res: Response;
  try {
    res = await fetch(input, init);
  } catch (err) {
    if (timedOut) {
      throw new ApiError(TIMEOUT_ERROR_MESSAGE, { kind: "timeout", status: 408 });
    }
    // Caller cancelled on purpose (unmount, newer request) — let them see the AbortError.
    if (isAbortError(err)) throw err;
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    throw new ApiError(
      offline ? "Nincs internetkapcsolat. Ellenőrizd a hálózatot, majd próbáld újra." : NETWORK_ERROR_MESSAGE,
      { kind: "network" }
    );
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (res.ok) return res;

  const body = await readErrorBody(res);
  const retryAfter = Number(res.headers.get("Retry-After"));
  const retryAfterSeconds = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : undefined;

  if (res.status === 401 && redirectOn401) redirectToLogin();

  let message: string;
  if (res.status === 401) {
    message = SESSION_EXPIRED_MESSAGE;
  } else if (res.status === 429) {
    message = retryAfterSeconds
      ? `${RATE_LIMIT_MESSAGE.replace(/\.$/, "")} (kb. ${formatWait(retryAfterSeconds)} múlva).`
      : body.message ?? RATE_LIMIT_MESSAGE;
  } else {
    message = body.message ?? messageForStatus(res.status);
  }
  if (res.status >= 500 && body.ref) message = `${message} (Hibakód: ${body.ref})`;

  throw new ApiError(message, {
    kind: "http",
    status: res.status,
    code: body.code,
    retryAfterSeconds,
    ref: body.ref,
  });
}

function formatWait(seconds: number): string {
  if (seconds < 90) return `${seconds} mp`;
  return `${Math.ceil(seconds / 60)} perc`;
}

/** JSON convenience wrapper around `apiFetchResponse`. Empty bodies resolve to `undefined`. */
export async function apiFetch<T = unknown>(input: string, options: ApiFetchOptions = {}): Promise<T> {
  const res = await apiFetchResponse(input, options);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError("A szerver váratlan választ adott. Próbáld újra.", {
      kind: "invalid_response",
      status: res.status,
    });
  }
}

/** Caught value → text for the UI. Use this instead of `e.message`. */
export function getErrorMessage(err: unknown, fallback: string = GENERIC_ERROR_MESSAGE): string {
  return friendlyErrorMessage(err, fallback);
}

export { isAbortError };
