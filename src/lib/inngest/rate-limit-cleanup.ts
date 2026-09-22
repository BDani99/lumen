import { inngest } from "./client";
import { supabaseAdmin } from "../supabase";

/** Widest rate-limit window in use (see call sites of checkRateLimit) plus slack. */
const RETENTION_MS = 24 * 60 * 60 * 1000;

/** Hourly: sweep rate_limit_hits rows older than the widest window in use, so
 * the table doesn't grow unbounded (no pg_cron needed — Inngest already runs). */
export const cleanupRateLimitHits = inngest.createFunction(
  {
    id: "cleanup-rate-limit-hits",
    retries: 1,
    triggers: [{ cron: "0 * * * *" }],
  },
  async ({ step }) => {
    const deleted = await step.run("delete-old-rate-limit-hits", async () => {
      const cutoff = new Date(Date.now() - RETENTION_MS).toISOString();
      const { error, count } = await supabaseAdmin
        .from("rate_limit_hits")
        .delete({ count: "exact" })
        .lt("created_at", cutoff);
      if (error) throw error;
      return count ?? 0;
    });
    return { deleted };
  }
);
