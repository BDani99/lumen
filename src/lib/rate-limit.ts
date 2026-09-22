import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export type RateLimitCheck = {
  userId: string;
  /** Short stable key identifying the route/bucket, e.g. "videos:create". */
  routeKey: string;
  /** Max requests allowed within the window. */
  limit: number;
  windowSeconds: number;
};

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

/**
 * Fixed-window per-user rate limit backed by the rate_limit_hits table
 * (see migration 20260922010000_add_rate_limits.sql). Counts hits within the
 * window, then records this one. Rows older than 24h are swept by the
 * rate-limit-cleanup Inngest cron (src/lib/inngest/rate-limit-cleanup.ts).
 */
export async function checkRateLimit(opts: RateLimitCheck): Promise<RateLimitResult> {
  const since = new Date(Date.now() - opts.windowSeconds * 1000).toISOString();

  const { count, error: countError } = await supabaseAdmin
    .from("rate_limit_hits")
    .select("id", { count: "exact", head: true })
    .eq("user_id", opts.userId)
    .eq("route_key", opts.routeKey)
    .gte("created_at", since);

  if (countError) {
    // Fail open — a rate-limit outage shouldn't take down the whole app.
    console.error("[rate-limit] count failed, allowing request:", countError);
    return { allowed: true };
  }

  if ((count ?? 0) >= opts.limit) {
    return { allowed: false, retryAfterSeconds: opts.windowSeconds };
  }

  const { error: insertError } = await supabaseAdmin
    .from("rate_limit_hits")
    .insert({ user_id: opts.userId, route_key: opts.routeKey });
  if (insertError) {
    console.error("[rate-limit] insert failed (non-fatal):", insertError);
  }

  return { allowed: true };
}

export function rateLimitResponse(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: "Túl sok kérés — próbáld újra később." },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
  );
}
