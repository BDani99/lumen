-- Reusable name-pool presets: a preset is a named, owned entity with
-- arbitrary categories (label + optional promptHint + names), selectable
-- from any channel via name_pool_preset_id. Replaces the old inline
-- channels.name_pools as the ACTIVE source (columns are kept, not dropped,
-- for safety) — existing configured pools are migrated into the first
-- preset so nothing changes behaviorally for channels already using them.

CREATE TABLE IF NOT EXISTS name_pool_presets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  name text not null,
  -- [{ key, label, promptHint?, names: string[] }]
  categories jsonb not null default '[]'::jsonb,
  min_names_per_category integer not null default 20,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS name_pool_presets_user_id_idx ON name_pool_presets (user_id);

DROP TRIGGER IF EXISTS name_pool_presets_set_user_id ON name_pool_presets;
CREATE TRIGGER name_pool_presets_set_user_id
  BEFORE INSERT ON name_pool_presets
  FOR EACH ROW
  EXECUTE FUNCTION public.set_user_id_from_auth();

ALTER TABLE name_pool_presets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS name_pool_presets_select_own ON name_pool_presets;
DROP POLICY IF EXISTS name_pool_presets_insert_own ON name_pool_presets;
DROP POLICY IF EXISTS name_pool_presets_update_own ON name_pool_presets;
DROP POLICY IF EXISTS name_pool_presets_delete_own ON name_pool_presets;

CREATE POLICY name_pool_presets_select_own ON name_pool_presets
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY name_pool_presets_insert_own ON name_pool_presets
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY name_pool_presets_update_own ON name_pool_presets
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY name_pool_presets_delete_own ON name_pool_presets
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS name_pool_preset_id uuid references name_pool_presets(id) on delete set null;

-- Migrate any already-configured inline pool into a preset, preserving
-- behavior exactly (same 4 categories, same rank-building instruction on
-- the 4th, same 20-name minimum).
DO $$
DECLARE
  ch RECORD;
  new_preset_id uuid;
BEGIN
  FOR ch IN
    SELECT id, user_id, name, name_pools
    FROM channels
    WHERE use_name_pools = true
      AND name_pools IS NOT NULL
      AND name_pools <> '{}'::jsonb
  LOOP
    INSERT INTO name_pool_presets (user_id, name, categories, min_names_per_category)
    VALUES (
      ch.user_id,
      ch.name || ' névkészlete',
      jsonb_build_array(
        jsonb_build_object(
          'key', 'maleFirstNames',
          'label', 'Férfi keresztnevek',
          'names', COALESCE(ch.name_pools->'maleFirstNames', '[]'::jsonb)
        ),
        jsonb_build_object(
          'key', 'femaleFirstNames',
          'label', 'Női keresztnevek',
          'names', COALESCE(ch.name_pools->'femaleFirstNames', '[]'::jsonb)
        ),
        jsonb_build_object(
          'key', 'surnames',
          'label', 'Vezetéknevek',
          'names', COALESCE(ch.name_pools->'surnames', '[]'::jsonb)
        ),
        jsonb_build_object(
          'key', 'titles',
          'label', 'Helyek / birtokok',
          'promptHint', 'Build ranks from these places + an appropriate rank word for the story/language (e.g. Buckingham -> Buckingham hercege / Duke of Buckingham). Do not treat list entries as finished titles. Courtesy styles like Lady/Lord + surname (if the story needs them) come from first names + surnames -- NOT from this place list.',
          'names', COALESCE(ch.name_pools->'titles', '[]'::jsonb)
        )
      ),
      20
    )
    RETURNING id INTO new_preset_id;

    UPDATE channels SET name_pool_preset_id = new_preset_id WHERE id = ch.id;
  END LOOP;
END $$;
