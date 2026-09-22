-- Channel-level name pool feature toggle + usage history (name + last used + count)
ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS use_name_pools boolean NOT NULL DEFAULT false;

ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS name_usage jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN channels.use_name_pools IS 'When true and each name pool category has >=20 entries, AI uses pools with usage-aware rotation';
COMMENT ON COLUMN channels.name_usage IS 'Per-category map of name -> { lastUsed ISO, count } for rotation';
