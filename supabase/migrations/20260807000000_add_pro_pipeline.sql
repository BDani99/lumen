-- Pro pipeline: a third, fully separate generation mode alongside the two
-- classic ones. Purely additive — no existing column or policy is altered,
-- and classic projects keep pipeline = 'classic'.

ALTER TABLE video_projects
  ADD COLUMN IF NOT EXISTS pipeline TEXT NOT NULL DEFAULT 'classic';

ALTER TABLE video_projects
  ADD COLUMN IF NOT EXISTS pro_settings JSONB;

ALTER TABLE video_projects
  ADD COLUMN IF NOT EXISTS pro_plan JSONB;

CREATE INDEX IF NOT EXISTS video_projects_pipeline_idx ON video_projects (pipeline);

-- Shots are the Pro equivalent of scenes, kept in their own table so the
-- classic video_scenes schema and its consumers stay untouched.
CREATE TABLE IF NOT EXISTS pro_shots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES video_projects(id) ON DELETE CASCADE,
  shot_index INTEGER NOT NULL,
  start_sec DOUBLE PRECISION NOT NULL DEFAULT 0,
  end_sec DOUBLE PRECISION NOT NULL DEFAULT 0,
  -- ai_video | ai_image | stock_video | archive
  source_kind TEXT NOT NULL DEFAULT 'ai_image',
  asset_url TEXT,
  overlay_url TEXT,
  prompt TEXT,
  search_query TEXT,
  narration_text TEXT,
  keywords JSONB DEFAULT '[]'::jsonb,
  ken_burns JSONB,
  attribution TEXT,
  status TEXT NOT NULL DEFAULT 'planned',
  cost_usd NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pro_shots_project_idx ON pro_shots (project_id, shot_index);

-- RLS mirrors video_scenes: ownership is derived from the parent project.
ALTER TABLE pro_shots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pro_shots_select_own ON pro_shots;
DROP POLICY IF EXISTS pro_shots_insert_own ON pro_shots;
DROP POLICY IF EXISTS pro_shots_update_own ON pro_shots;
DROP POLICY IF EXISTS pro_shots_delete_own ON pro_shots;

CREATE POLICY pro_shots_select_own ON pro_shots
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM video_projects p
      WHERE p.id = pro_shots.project_id AND p.user_id = auth.uid()
    )
  );

CREATE POLICY pro_shots_insert_own ON pro_shots
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM video_projects p
      WHERE p.id = pro_shots.project_id AND p.user_id = auth.uid()
    )
  );

CREATE POLICY pro_shots_update_own ON pro_shots
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM video_projects p
      WHERE p.id = pro_shots.project_id AND p.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM video_projects p
      WHERE p.id = pro_shots.project_id AND p.user_id = auth.uid()
    )
  );

CREATE POLICY pro_shots_delete_own ON pro_shots
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM video_projects p
      WHERE p.id = pro_shots.project_id AND p.user_id = auth.uid()
    )
  );
