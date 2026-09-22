-- AI33 pronunciation dictionaries live entirely on the AI33 side (one shared
-- account, no user field) — this table is the ownership mapping so that
-- listing/editing/deleting a dictionary can be scoped per Lumen user instead
-- of leaking every user's dictionaries to every other user.

CREATE TABLE IF NOT EXISTS dictionary_owners (
  dictionary_id integer PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS dictionary_owners_user_id_idx ON dictionary_owners (user_id);

ALTER TABLE dictionary_owners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dictionary_owners_select_own ON dictionary_owners;
DROP POLICY IF EXISTS dictionary_owners_all_own ON dictionary_owners;

-- RLS as defense-in-depth; API routes use the service-role client with an
-- explicit user_id check as the primary authorization boundary today.
CREATE POLICY dictionary_owners_all_own ON dictionary_owners
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
