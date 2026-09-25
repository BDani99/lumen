import { headers } from "next/headers";

/**
 * Public origin of this deployment, used for links inside emails
 * (confirmation / password reset). Preference order:
 *   1. NEXT_PUBLIC_SITE_URL          — explicit, always wins
 *   2. VERCEL_PROJECT_PRODUCTION_URL — set by Vercel in production
 *   3. the request's own host        — fine for local development
 * The request host is deliberately last: a forged Host header must never be
 * able to steer a password-reset link to another domain in production.
 */
export async function getSiteUrl(): Promise<string> {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  const vercelProd = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercelProd && process.env.NODE_ENV === "production") {
    return `https://${vercelProd.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  }

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return "";
  const proto = h.get("x-forwarded-proto") ?? (/^(localhost|127\.)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}
