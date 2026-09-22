-- Detailed stock-media configuration per channel: which providers are used
-- for video vs image, in what priority order, and how strict the relevance
-- check must be. `use_stock_video` stays the master on/off switch (already
-- wired in the UI), so no data migration is needed — an empty object simply
-- normalizes to sensible defaults in code.
ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS stock_settings jsonb NOT NULL DEFAULT '{}'::jsonb;
