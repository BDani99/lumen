/**
 * One-off companion to purge-r2-storage.ts: after wiping every R2 object,
 * the DB still has video_scenes.image_url/video_url and
 * video_projects.thumbnail_url pointing at now-dead R2 URLs. This flips
 * any R2-hosted URL to R2_DELETED_MARKER so the app's existing
 * "média lejárt / újragenerálás" UI kicks in instead of showing broken
 * images/videos everywhere.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/flag-deleted-refs-after-purge.ts
 */
import { createClient } from "@supabase/supabase-js";
import { R2_DELETED_MARKER } from "../src/lib/r2";

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

function isR2Url(url: string | null | undefined, base: string): boolean {
  const u = String(url || "");
  return Boolean(u) && u !== R2_DELETED_MARKER && u.startsWith(base);
}

async function main() {
  const base = process.env.R2_PUBLIC_BASE_URL?.trim().replace(/\/$/, "");
  if (!base) throw new Error("R2_PUBLIC_BASE_URL missing");

  const sb = supabaseAdmin();

  const { data: scenes, error: scenesErr } = await sb
    .from("video_scenes")
    .select("id, image_url, video_url");
  if (scenesErr) throw scenesErr;

  let scenesFlagged = 0;
  for (const s of scenes || []) {
    const patch: { image_url?: string; video_url?: string } = {};
    if (isR2Url(s.image_url, base)) patch.image_url = R2_DELETED_MARKER;
    if (isR2Url(s.video_url, base)) patch.video_url = R2_DELETED_MARKER;
    if (Object.keys(patch).length) {
      await sb.from("video_scenes").update(patch).eq("id", s.id);
      scenesFlagged += 1;
    }
  }

  const { data: projects, error: projErr } = await sb
    .from("video_projects")
    .select("id, thumbnail_url");
  if (projErr) throw projErr;

  let projectsFlagged = 0;
  for (const p of projects || []) {
    if (isR2Url(p.thumbnail_url, base)) {
      await sb
        .from("video_projects")
        .update({ thumbnail_url: R2_DELETED_MARKER })
        .eq("id", p.id);
      projectsFlagged += 1;
    }
  }

  console.log(`Flagged ${scenesFlagged} scene rows, ${projectsFlagged} project thumbnails.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
