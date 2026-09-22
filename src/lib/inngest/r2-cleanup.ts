import { inngest } from "./client";
import { supabaseAdmin } from "../supabase";
import { appendGenerationLog } from "../generation-log";
import {
  isR2Configured,
  listR2Objects,
  deleteR2Object,
  R2_DELETED_MARKER,
} from "../r2";

const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;
const MEDIA_EXT = /\.(mp4|png|jpe?g|webp)$/i;

function isImageKey(key: string): boolean {
  return IMAGE_EXT.test(key);
}

function isMediaKey(key: string): boolean {
  return MEDIA_EXT.test(key);
}

/** R2 object keys are `projects/{projectId}/...`. */
function extractProjectId(key: string): string | null {
  const m = key.match(/^projects\/([^/]+)\//);
  return m ? m[1] : null;
}

const EXPORTED_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
/** Never-exported projects are still eventually swept so storage isn't held forever. */
const ABANDONED_MS = 60 * 24 * 60 * 60 * 1000;

/** Clear DB refs that point at deleted R2 object keys. */
async function clearDbRefsForDeletedKeys(deletedKeys: string[]) {
  const imageKeys = deletedKeys.filter(isImageKey);
  const videoKeys = deletedKeys.filter((k) => k.endsWith(".mp4"));

  if (videoKeys.length) {
    const { data: scenes } = await supabaseAdmin
      .from("video_scenes")
      .select("id, video_url")
      .not("video_url", "is", null);

    for (const s of scenes || []) {
      const url = String(s.video_url || "");
      if (!url || url === R2_DELETED_MARKER) continue;
      if (videoKeys.some((k) => url.includes(k))) {
        await supabaseAdmin
          .from("video_scenes")
          .update({ video_url: R2_DELETED_MARKER })
          .eq("id", s.id);
      }
    }
  }

  if (imageKeys.length) {
    const { data: scenes } = await supabaseAdmin
      .from("video_scenes")
      .select("id, image_url")
      .not("image_url", "is", null);

    for (const s of scenes || []) {
      const url = String(s.image_url || "");
      if (!url || url === R2_DELETED_MARKER || !/^https?:\/\//i.test(url)) continue;
      if (imageKeys.some((k) => url.includes(k))) {
        await supabaseAdmin
          .from("video_scenes")
          .update({ image_url: R2_DELETED_MARKER })
          .eq("id", s.id);
      }
    }

    const { data: projects } = await supabaseAdmin
      .from("video_projects")
      .select("id, thumbnail_url")
      .not("thumbnail_url", "is", null);

    for (const p of projects || []) {
      const url = String(p.thumbnail_url || "");
      if (!url || url === R2_DELETED_MARKER || !/^https?:\/\//i.test(url)) continue;
      if (imageKeys.some((k) => url.includes(k))) {
        await supabaseAdmin
          .from("video_projects")
          .update({ thumbnail_url: R2_DELETED_MARKER })
          .eq("id", p.id);
      }
    }
  }
}

/**
 * Daily: delete R2 media, but only when it's safe to lose —
 * already-exported projects (7-day grace period) or projects that were
 * never exported at all but have sat abandoned for 60+ days. A project the
 * user hasn't exported yet is never swept just because it's a week old.
 */
export const cleanupOldR2Videos = inngest.createFunction(
  {
    id: "cleanup-old-r2-videos",
    retries: 1,
    triggers: [{ cron: "0 3 * * *" }],
  },
  async ({ step }) => {
    if (!isR2Configured()) {
      return { skipped: true, reason: "R2 not configured" };
    }

    const result = await step.run("delete-stale-r2-objects", async () => {
      const now = Date.now();
      const objects = await listR2Objects("projects/");
      const mediaObjects = objects.filter((o) => isMediaKey(o.key));

      const projectIds = [
        ...new Set(mediaObjects.map((o) => extractProjectId(o.key)).filter((id): id is string => Boolean(id))),
      ];
      const retention = new Map<string, { exportedAt: string | null; createdAt: string }>();
      if (projectIds.length > 0) {
        const { data } = await supabaseAdmin
          .from("video_projects")
          .select("id, exported_at, created_at")
          .in("id", projectIds);
        for (const row of data || []) {
          retention.set(row.id, { exportedAt: row.exported_at, createdAt: row.created_at });
        }
      }

      const keys: string[] = [];
      const perProjectDeleted = new Map<string, number>();
      for (const o of mediaObjects) {
        const projectId = extractProjectId(o.key);
        const info = projectId ? retention.get(projectId) : undefined;
        const age = now - o.lastModified.getTime();

        // Orphaned object (project row no longer exists) — safe to sweep after the same grace period as exported projects.
        const eligible = info?.exportedAt
          ? age > EXPORTED_GRACE_MS
          : info
            ? now - new Date(info.createdAt).getTime() > ABANDONED_MS
            : age > EXPORTED_GRACE_MS;
        if (!eligible) continue;

        await deleteR2Object(o.key);
        keys.push(o.key);
        if (projectId) perProjectDeleted.set(projectId, (perProjectDeleted.get(projectId) || 0) + 1);
      }
      return { keys, perProjectDeleted: Object.fromEntries(perProjectDeleted) };
    });

    if (result.keys.length === 0) {
      return { deleted: 0 };
    }

    await step.run("clear-db-refs-for-deleted-keys", async () => {
      await clearDbRefsForDeletedKeys(result.keys);
      return {
        videos: result.keys.filter((k) => k.endsWith(".mp4")).length,
        images: result.keys.filter(isImageKey).length,
      };
    });

    await step.run("log-per-project", async () => {
      for (const [projectId, count] of Object.entries(result.perProjectDeleted)) {
        await appendGenerationLog(projectId, {
          level: "warn",
          stage: "Completed",
          message: `Automatikus R2 takarítás: ${count} régi médiafájl törölve (7+ nap az exportálás óta / 60+ nap exportálás nélkül). Az editorban újragenerálható.`,
          meta: { deletedCount: count, source: "cleanup-old-r2-videos" },
        });
      }
    });

    return { deleted: result.keys.length };
  }
);
