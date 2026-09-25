import {
  CONFIG_ERROR_MESSAGE,
  NETWORK_ERROR_MESSAGE,
  SERVICE_UNAVAILABLE_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
  isAuthServiceError,
  isNetworkError,
} from "@/lib/errors";

/**
 * Messages that travel to /login inside a redirect URL. They are referenced
 * by a fixed CODE (`/login?notice=session_expired`), never as free text: a
 * `?message=` that the page prints verbatim would let anyone craft a link
 * that shows arbitrary text ("your account is locked, call …") inside our UI.
 */
export const NOTICES = {
  session_expired: { tone: "error", message: SESSION_EXPIRED_MESSAGE },
  config: { tone: "error", message: CONFIG_ERROR_MESSAGE },
  network: { tone: "error", message: NETWORK_ERROR_MESSAGE },
  service_unavailable: { tone: "error", message: SERVICE_UNAVAILABLE_MESSAGE },
  link_invalid: {
    tone: "error",
    message:
      "A link már fel lett használva, vagy lejárt. Ha az email címedet már megerősítetted, egyszerűen jelentkezz be. Jelszó-visszaállításhoz kérj új linket.",
  },
  registered: {
    tone: "success",
    message:
      "Sikeres regisztráció! Küldtünk egy megerősítő emailt — kattints a benne lévő linkre, majd jelentkezz be.",
  },
} as const;

export type NoticeCode = keyof typeof NOTICES;

export function isNoticeCode(value: string | null | undefined): value is NoticeCode {
  return !!value && Object.prototype.hasOwnProperty.call(NOTICES, value);
}

export function noticeUrl(code: NoticeCode, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({ notice: code, ...extra });
  return `/login?${params.toString()}`;
}

/** Auth backend failure → the notice that describes it. */
export function noticeForAuthFailure(err: unknown): NoticeCode {
  if (isNetworkError(err)) return "network";
  if (isAuthServiceError(err)) return "service_unavailable";
  return "link_invalid";
}
