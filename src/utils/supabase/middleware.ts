import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseConfig, warnIfSupabaseMisconfigured } from "./config";
import {
  CONFIG_ERROR_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
  authErrorMessage,
  isAuthServiceError,
} from "@/lib/errors";
import { noticeForAuthFailure, noticeUrl, type NoticeCode } from "@/lib/notices";

/** Reachable without a session. Auth callback/reset-request pages must be here or the flows would loop. */
const PUBLIC_PREFIXES = ["/login", "/register", "/forgot-password", "/auth/callback", "/auth/confirm"];
/** Public, but a signed-in user has no business on them (bounced to "/"). */
const GUEST_ONLY_PREFIXES = ["/login", "/register", "/forgot-password"];

function matchesPrefix(pathname: string, prefixes: string[]) {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function isInngestPath(pathname: string) {
  return pathname === "/api/inngest" || pathname.startsWith("/api/inngest/");
}

function jsonError(message: string, status: number, code: string) {
  return NextResponse.json({ error: message, code }, { status });
}

function loginRedirect(request: NextRequest, notice: NoticeCode) {
  return NextResponse.redirect(new URL(noticeUrl(notice), request.url));
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const pathname = request.nextUrl.pathname;

  // Inngest serve endpoint — no session gate (signed / INNGEST_DEV)
  if (isInngestPath(pathname)) {
    return supabaseResponse;
  }

  const isPublic = matchesPrefix(pathname, PUBLIC_PREFIXES);
  const isApi = pathname.startsWith("/api/");

  const { url, key, configured } = getSupabaseConfig();

  // Without real credentials every auth call would go to placeholder.supabase.co
  // and fail as "fetch failed". Say what is actually wrong instead.
  if (!configured) {
    warnIfSupabaseMisconfigured("middleware");
    if (isPublic) return supabaseResponse;
    if (isApi) return jsonError(CONFIG_ERROR_MESSAGE, 503, "config");
    return loginRedirect(request, "config");
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        supabaseResponse = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  let user: { id: string } | null = null;
  let authFailure: unknown = null;
  try {
    const { data, error } = await supabase.auth.getUser();
    user = data.user;
    if (error && isAuthServiceError(error)) authFailure = error;
  } catch (err) {
    if (isAuthServiceError(err)) authFailure = err;
    else throw err;
  }

  // The auth backend itself is down/unreachable — this says nothing about the
  // user's session, so don't treat them as logged out or crash the request.
  if (authFailure) {
    console.error("[middleware] auth service unavailable:", authFailure);
    const message = authErrorMessage(authFailure);
    if (isApi) return jsonError(message, 503, "auth_unavailable");
    if (isPublic) return supabaseResponse;
    return loginRedirect(request, noticeForAuthFailure(authFailure));
  }

  // Logged-in users leave the guest-only auth pages
  if (user && matchesPrefix(pathname, GUEST_ONLY_PREFIXES)) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Unauthenticated: allow public pages only
  if (!user && !isPublic) {
    // APIs get 401 JSON instead of HTML redirect
    if (isApi) {
      return jsonError(SESSION_EXPIRED_MESSAGE, 401, "unauthorized");
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
