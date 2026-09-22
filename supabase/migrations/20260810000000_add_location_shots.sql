-- Location establishing shots: when a scene introduces a location for the
-- FIRST time, a short shot of that place plays before the scene's own visual
-- (classic film establishing shot). Purely additive and off by default, so
-- existing channels are unaffected.

ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS use_location_shots boolean NOT NULL DEFAULT false;

ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS location_shot_sec double precision NOT NULL DEFAULT 3;

-- Per-scene establishing shot. `location_name` is the normalized key used to
-- decide whether this location has already been shown earlier in the video.
ALTER TABLE video_scenes
  ADD COLUMN IF NOT EXISTS location_name text;

ALTER TABLE video_scenes
  ADD COLUMN IF NOT EXISTS location_image_url text;
