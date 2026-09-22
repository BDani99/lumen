/**
 * Migrate scene/thumbnail images from Supabase Storage → Cloudflare R2,
 * update DB URLs, then empty the Supabase `video_images` bucket.
 *
 * Usage (from repo root, with .env.local loaded):
 *   npx tsx --env-file=.env.local scripts/migrate-images-to-r2.ts
 *   npx tsx --env-file=.env.local scripts/migrate-images-to-r2.ts --purge-only
 */
import { createClient } from "@supabase/supabase-js";
import {
  isR2Configured,
  sceneImageKey,
  thumbnailImageKey,
  uploadImageToR2,
} from "../src/lib/r2";

const PURGE_ONLY = process.argv.includes("--purge-only");
const BUCKET = "video_images";

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

function isSupabaseStorageUrl(url: string | null | undefined): boolean {
  const u = String(url || "");
  return (
    u.includes("/storage/v1/object/public/video_images/") ||
    u.includes("/storage/v1/object/sign/video_images/")
  );
}

async function downloadBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}: ${url.slice(0, 120)}`);
  return Buffer.from(await res.arrayBuffer());
}

async function migrateSceneImages(sb: ReturnType<typeof supabaseAdmin>) {
  const { data: scenes, error } = await sb
    .from("video_scenes")
    .select("id, project_id, scene_order, image_url");
  if (error) throw error;

  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of scenes || []) {
    if (!isSupabaseStorageUrl(row.image_url)) {
      skipped += 1;
      continue;
    }
    try {
      const buf = await downloadBuffer(row.image_url);
      const key = sceneImageKey(row.project_id, Number(row.scene_order) || 0);
      const newUrl = await uploadImageToR2({ key, body: buf });
      const { error: upErr } = await sb
        .from("video_scenes")
        .update({ image_url: newUrl })
        .eq("id", row.id);
      if (upErr) throw upErr;
      migrated += 1;
      console.log(`scene ${row.id} → ${key}`);
    } catch (e: any) {
      failed += 1;
      console.error(`scene ${row.id} FAILED:`, e?.message || e);
    }
  }

  return { migrated, skipped, failed };
}

async function migrateThumbnails(sb: ReturnType<typeof supabaseAdmin>) {
  const { data: projects, error } = await sb
    .from("video_projects")
    .select("id, thumbnail_url, timeline_data");
  if (error) throw error;

  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of projects || []) {
    const timeline = (row.timeline_data || {}) as Record<string, unknown>;
    const history = Array.isArray(timeline.thumbnails)
      ? (timeline.thumbnails as string[])
      : [];
    let changed = false;
    let thumbnailUrl = row.thumbnail_url as string | null;

    if (isSupabaseStorageUrl(thumbnailUrl)) {
      try {
        const buf = await downloadBuffer(thumbnailUrl!);
        const key = thumbnailImageKey(row.id);
        thumbnailUrl = await uploadImageToR2({ key, body: buf });
        changed = true;
        migrated += 1;
        console.log(`thumbnail ${row.id} → ${key}`);
      } catch (e: any) {
        failed += 1;
        console.error(`thumbnail ${row.id} FAILED:`, e?.message || e);
      }
    } else {
      skipped += 1;
    }

    const newHistory: string[] = [];
    for (const url of history) {
      if (!isSupabaseStorageUrl(url)) {
        newHistory.push(url);
        continue;
      }
      try {
        const buf = await downloadBuffer(url);
        const key = thumbnailImageKey(row.id);
        newHistory.push(await uploadImageToR2({ key, body: buf }));
        changed = true;
        migrated += 1;
      } catch (e: any) {
        failed += 1;
        console.error(`thumb history ${row.id} FAILED:`, e?.message || e);
        // drop broken supabase URL from history
      }
    }

    if (changed) {
      await sb
        .from("video_projects")
        .update({
          thumbnail_url: thumbnailUrl,
          timeline_data: { ...timeline, thumbnails: newHistory },
        })
        .eq("id", row.id);
    }
  }

  return { migrated, skipped, failed };
}

/** Recursively list and delete all objects in video_images. */
async function purgeSupabaseVideoImages(sb: ReturnType<typeof supabaseAdmin>) {
  let removed = 0;

  async function wipeFolder(prefix: string) {
    const { data: entries, error } = await sb.storage.from(BUCKET).list(prefix || undefined, {
      limit: 1000,
    });
    if (error) throw error;
    if (!entries?.length) return;

    const files: string[] = [];
    for (const entry of entries) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      // folders often have null id / metadata
      const looksLikeFolder =
        !entry.id ||
        (entry.metadata == null && !entry.name.includes("."));
      if (looksLikeFolder && !entry.name.match(/\.(png|jpe?g|webp|gif)$/i)) {
        await wipeFolder(path);
      } else {
        files.push(path);
      }
    }

    // Also treat every entry as removable file (Supabase list mixes folders)
    const batch = entries.map((e) => (prefix ? `${prefix}/${e.name}` : e.name));
    const unique = [...new Set([...files, ...batch])];
    for (let i = 0; i < unique.length; i += 100) {
      const chunk = unique.slice(i, i + 100);
      const { error: remErr } = await sb.storage.from(BUCKET).remove(chunk);
      if (remErr) {
        console.warn(`remove warn (${prefix}):`, remErr.message);
      } else {
        removed += chunk.length;
        console.log(`purged ${chunk.length} under "${prefix || "/"}"`);
      }
    }
  }

  // Top-level: list project folders
  const { data: root, error } = await sb.storage.from(BUCKET).list(undefined, { limit: 1000 });
  if (error) throw error;
  for (const entry of root || []) {
    await wipeFolder(entry.name);
  }
  // Second pass: remove any leftover root files
  if (root?.length) {
    await sb.storage.from(BUCKET).remove(root.map((e) => e.name));
  }

  return removed;
}

async function main() {
  console.log(PURGE_ONLY ? "=== PURGE ONLY ===" : "=== MIGRATE → R2, then PURGE ===");

  if (!PURGE_ONLY && !isR2Configured()) {
    throw new Error("R2_* env missing — configure R2 before migrate");
  }

  const sb = supabaseAdmin();

  if (!PURGE_ONLY) {
    console.log("\n--- Scene images ---");
    const scenes = await migrateSceneImages(sb);
    console.log(scenes);

    console.log("\n--- Thumbnails ---");
    const thumbs = await migrateThumbnails(sb);
    console.log(thumbs);
  }

  console.log("\n--- Purge Supabase video_images ---");
  const removed = await purgeSupabaseVideoImages(sb);
  console.log(`Done. Removed ~${removed} storage objects from ${BUCKET}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
