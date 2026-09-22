-- Multi-tenant: ownership columns + RLS
-- Existing rows are assigned to the oldest auth user (if any).
-- Manual reassign example:
--   UPDATE channels SET user_id = '<uuid>' WHERE user_id IS NULL;
--   UPDATE video_projects SET user_id = '<uuid>' WHERE user_id IS NULL;

ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE video_projects
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS channels_user_id_idx ON channels (user_id);
CREATE INDEX IF NOT EXISTS video_projects_user_id_idx ON video_projects (user_id);
CREATE INDEX IF NOT EXISTS video_projects_user_id_created_at_idx
  ON video_projects (user_id, created_at DESC);

DO $$
DECLARE
  first_user UUID;
BEGIN
  SELECT id INTO first_user FROM auth.users ORDER BY created_at ASC LIMIT 1;
  IF first_user IS NOT NULL THEN
    UPDATE channels SET user_id = first_user WHERE user_id IS NULL;
    UPDATE video_projects SET user_id = first_user WHERE user_id IS NULL;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.set_user_id_from_auth()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.user_id IS NULL THEN
    NEW.user_id := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS channels_set_user_id ON channels;
CREATE TRIGGER channels_set_user_id
  BEFORE INSERT ON channels
  FOR EACH ROW
  EXECUTE FUNCTION public.set_user_id_from_auth();

DROP TRIGGER IF EXISTS video_projects_set_user_id ON video_projects;
CREATE TRIGGER video_projects_set_user_id
  BEFORE INSERT ON video_projects
  FOR EACH ROW
  EXECUTE FUNCTION public.set_user_id_from_auth();

-- channels RLS
ALTER TABLE channels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS channels_select_own ON channels;
DROP POLICY IF EXISTS channels_insert_own ON channels;
DROP POLICY IF EXISTS channels_update_own ON channels;
DROP POLICY IF EXISTS channels_delete_own ON channels;

CREATE POLICY channels_select_own ON channels
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY channels_insert_own ON channels
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY channels_update_own ON channels
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY channels_delete_own ON channels
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- video_projects RLS
ALTER TABLE video_projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS video_projects_select_own ON video_projects;
DROP POLICY IF EXISTS video_projects_insert_own ON video_projects;
DROP POLICY IF EXISTS video_projects_update_own ON video_projects;
DROP POLICY IF EXISTS video_projects_delete_own ON video_projects;

CREATE POLICY video_projects_select_own ON video_projects
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY video_projects_insert_own ON video_projects
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY video_projects_update_own ON video_projects
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY video_projects_delete_own ON video_projects
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- video_scenes via parent project
ALTER TABLE video_scenes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS video_scenes_select_own ON video_scenes;
DROP POLICY IF EXISTS video_scenes_insert_own ON video_scenes;
DROP POLICY IF EXISTS video_scenes_update_own ON video_scenes;
DROP POLICY IF EXISTS video_scenes_delete_own ON video_scenes;

CREATE POLICY video_scenes_select_own ON video_scenes
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM video_projects p
      WHERE p.id = video_scenes.project_id AND p.user_id = auth.uid()
    )
  );

CREATE POLICY video_scenes_insert_own ON video_scenes
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM video_projects p
      WHERE p.id = video_scenes.project_id AND p.user_id = auth.uid()
    )
  );

CREATE POLICY video_scenes_update_own ON video_scenes
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM video_projects p
      WHERE p.id = video_scenes.project_id AND p.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM video_projects p
      WHERE p.id = video_scenes.project_id AND p.user_id = auth.uid()
    )
  );

CREATE POLICY video_scenes_delete_own ON video_scenes
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM video_projects p
      WHERE p.id = video_scenes.project_id AND p.user_id = auth.uid()
    )
  );

-- generation_logs via parent project
ALTER TABLE generation_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS generation_logs_select_own ON generation_logs;
DROP POLICY IF EXISTS generation_logs_insert_own ON generation_logs;
DROP POLICY IF EXISTS generation_logs_update_own ON generation_logs;
DROP POLICY IF EXISTS generation_logs_delete_own ON generation_logs;

CREATE POLICY generation_logs_select_own ON generation_logs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM video_projects p
      WHERE p.id = generation_logs.project_id AND p.user_id = auth.uid()
    )
  );

CREATE POLICY generation_logs_insert_own ON generation_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM video_projects p
      WHERE p.id = generation_logs.project_id AND p.user_id = auth.uid()
    )
  );

CREATE POLICY generation_logs_update_own ON generation_logs
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM video_projects p
      WHERE p.id = generation_logs.project_id AND p.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM video_projects p
      WHERE p.id = generation_logs.project_id AND p.user_id = auth.uid()
    )
  );

CREATE POLICY generation_logs_delete_own ON generation_logs
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM video_projects p
      WHERE p.id = generation_logs.project_id AND p.user_id = auth.uid()
    )
  );

-- global_settings: service role only (no authenticated policies)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'global_settings'
  ) THEN
    EXECUTE 'ALTER TABLE global_settings ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;
