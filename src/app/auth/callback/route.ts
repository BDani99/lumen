import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getSupabaseConfig } from "@/utils/supabase/config";
import { safeNext } from "@/lib/safe-next";
import { noticeForAuthFailure, noticeUrl, type NoticeCode } from "@/lib/notices";

/**
 * Landing point for the links in Supabase emails (signup confirmation,
 * password reset). Exchanges the one-time `code` for a session, then sends
 * the user on — or back to /login with a readable reason. It never shows a
 * raw provider error.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const next = safeNext(searchParams.get("next"), "/");

  const toLogin = (notice: NoticeCode) => NextResponse.redirect(new URL(noticeUrl(notice), request.url));

  // Supabase reports link problems (expired, already used) as query params.
  const providerError = searchParams.get("error_code") ?? searchParams.get("error");
  if (providerError) return toLogin("link_invalid");

  const code = searchParams.get("code");
  if (!code) return toLogin("link_invalid");

  if (!getSupabaseConfig().configured) return toLogin("config");

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error("[auth/callback] code exchange failed:", error);
      return toLogin(noticeForAuthFailure(error));
    }
  } catch (err) {
    console.error("[auth/callback] code exchange threw:", err);
    return toLogin(noticeForAuthFailure(err));
  }

  return NextResponse.redirect(new URL(next, request.url));
}
