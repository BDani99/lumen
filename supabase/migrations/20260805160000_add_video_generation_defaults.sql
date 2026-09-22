-- Per-channel defaults for Wan / video-scene generation (OpenRouter)
ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS video_generation_defaults JSONB DEFAULT '{}'::jsonb;
