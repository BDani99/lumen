-- Per-user rate limiting for AI-cost-incurring routes, backed by Supabase
-- (no new external service). One row per request; checkRateLimit()
-- (src/lib/rate-limit.ts) counts rows in a sliding window per (user, route).

CREATE TABLE IF NOT EXISTS rate_limit_hits (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  route_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS rate_limit_hits_user_route_time_idx
  ON rate_limit_hits (user_id, route_key, created_at DESC);

ALTER TABLE rate_limit_hits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rate_limit_hits_select_own ON rate_limit_hits;

-- No client ever reads/writes this table directly (only the service-role
-- client, from checkRateLimit) — RLS here is defense-in-depth only.
CREATE POLICY rate_limit_hits_select_own ON rate_limit_hits
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
