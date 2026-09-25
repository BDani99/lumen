const PLACEHOLDER_URL = "https://placeholder.supabase.co";
const PLACEHOLDER_KEY = "placeholder";

/**
 * Supabase connection settings with a build-time placeholder fallback (the
 * build must succeed without secrets). `configured` is false when the real
 * values are missing at runtime — in that case every request would hit
 * placeholder.supabase.co and die with a cryptic "fetch failed", so callers
 * check it first and show a proper configuration error instead.
 *
 * NB: the `process.env.NEXT_PUBLIC_*` reads must stay literal — Next.js only
 * inlines them into the browser bundle when written exactly like this.
 */
export function getSupabaseConfig() {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const rawKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  return {
    url: rawUrl || PLACEHOLDER_URL,
    key: rawKey || PLACEHOLDER_KEY,
    configured: Boolean(rawUrl && rawKey),
  };
}

let warned = false;

/** Logs (once per server instance) which variable is missing, for the Vercel/server log. */
export function warnIfSupabaseMisconfigured(scope: string) {
  if (warned) return;
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const rawKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (rawUrl && rawKey) return;
  warned = true;
  const missing = [!rawUrl && "NEXT_PUBLIC_SUPABASE_URL", !rawKey && "NEXT_PUBLIC_SUPABASE_ANON_KEY"]
    .filter(Boolean)
    .join(", ");
  console.error(`[${scope}] Supabase is not configured — missing env: ${missing}`);
}
