import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/server";
import { getSupabaseConfig } from "@/utils/supabase/config";
import { safeNext } from "@/lib/safe-next";
import { noticeForAuthFailure, noticeUrl, type NoticeCode } from "@/lib/notices";

const OTP_TYPES: readonly EmailOtpType[] = ["signup", "recovery", "email", "invite", "magiclink", "email_change"];

/**
 * Landing point for the links in Supabase emails (signup confirmation,
 * password reset). The email template links here with a `token_hash`, and the
 * token is verified on the server — unlike the `?code=` flow in
 * /auth/callback it needs no PKCE verifier cookie, so the link works when it
 * is opened in another browser, another device or an email app's built-in
 * viewer.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNext(searchParams.get("next"), "/");

  const toLogin = (notice: NoticeCode) => NextResponse.redirect(new URL(noticeUrl(notice), request.url));

  if (!tokenHash || !type || !OTP_TYPES.includes(type)) return toLogin("link_invalid");
  if (!getSupabaseConfig().configured) return toLogin("config");

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error) {
      console.error("[auth/confirm] verifyOtp failed:", error);
      return toLogin(noticeForAuthFailure(error));
    }
  } catch (err) {
    console.error("[auth/confirm] verifyOtp threw:", err);
    return toLogin(noticeForAuthFailure(err));
  }

  // A confirmed signup / valid recovery link both leave the user signed in.
  const target = type === "recovery" ? "/reset-password" : next;
  return NextResponse.redirect(new URL(target, request.url));
}
