-- Model used for script rewrite / final polish (falls back to text_model in app if null)
ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS polish_model TEXT;
