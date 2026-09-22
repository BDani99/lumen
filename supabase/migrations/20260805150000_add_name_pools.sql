-- Optional per-channel name pools for AI cast selection
ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS name_pools JSONB DEFAULT '{}'::jsonb;
