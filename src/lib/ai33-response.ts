import { ai33UserMessage } from "@/lib/ai33";
import { apiError, routeError } from "@/lib/api-response";

/**
 * Route-handler glue for the TTS aggregator (AI33): a missing API key is an
 * operator problem, and provider failures get an accurate HTTP status plus the
 * already-Hungarian `ai33UserMessage` text — never the raw provider body.
 */

function shortRef() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

/** Missing server-side API key: log for the operator, tell the user to contact them (no env var names). */
export function ai33NotConfigured(tag: string) {
  console.error(`[${tag}] AI33_API_KEY is not configured`);
  return apiError("A hangszolgáltatás nincs megfelelően beállítva. Értesítsd az üzemeltetőt.", 503, { code: "config" });
}

/**
 * Use as the body of a `catch` in AI33 routes. AI33Client failures map to
 * auth/credit problem → 503, rate limit → 429, timeout → 504, anything else
 * upstream → 502. Everything that is not an AI33Client failure (Supabase errors,
 * network errors, bugs) goes through `routeError`.
 */
export function ai33RouteError(err: unknown, tag: string, opts: { fallback?: string } = {}) {
  const msg = err instanceof Error ? err.message : "";
  const apiMatch = msg.match(/AI33 API error \((\d{3})\)/);
  const isTimeout = /AI33 request timed out/i.test(msg);
  const isEnriched = /\(AI33\)\. Próbáld újra pár perc múlva\./.test(msg);

  if (!apiMatch && !isTimeout && !isEnriched) {
    return routeError(err, tag, opts);
  }

  const ref = shortRef();
  console.error(`[${tag}] ref=${ref}`, err);
  const message = ai33UserMessage(err);

  if (isTimeout) return apiError(message, 504, { code: "timeout", ref });
  if (apiMatch) {
    const upstream = Number(apiMatch[1]);
    if (upstream === 401 || upstream === 402 || upstream === 403) {
      return apiError(message, 503, { code: "upstream_auth", ref });
    }
    if (upstream === 429) return apiError(message, 429, { code: "rate_limited" });
  }
  return apiError(message, 502, { code: "upstream_error", ref });
}
