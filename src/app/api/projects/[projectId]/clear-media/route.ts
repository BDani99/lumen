import { NextResponse } from "next/server";
import { apiError, routeError } from "@/lib/api-response";
import { supabaseAdmin } from "@/lib/supabase";
import {
  assertProjectOwned,
  forbidden,
  requireUserApi,
} from "@/lib/auth";
import { deleteR2Prefix, isR2Configured, R2_DELETED_MARKER } from "@/lib/r2";
import { appendGenerationLog } from "@/lib/generation-log";

/**
 * Manual, user-triggered wipe of a single project's R2 media (images,
 * videos, thumbnail) — does NOT delete the project itself. Scenes fall
 * back to the existing "média lejárt / újragenerálás" UI, same as when
 * the nightly retention cron expires media.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const auth = await requireUserApi();
    if (auth.error) return auth.error;

    const { projectId } = await params;
    if (!(await assertProjectOwned(projectId, auth.user.id))) {
      return forbidden("A projekt nem található, vagy nincs hozzáférésed.");
    }

    if (!isR2Configured()) {
      return apiError(
        "A médiatárhely nincs beállítva, ezért nem üríthető. Jelezd az üzemeltetőnek.",
        503,
        { code: "config" }
      );
    }

    const deleted = await deleteR2Prefix(`projects/${projectId}/`);

    const { data: scenes, error: scenesError } = await supabaseAdmin
      .from("video_scenes")
      .select("id, video_url, image_url")
      .eq("project_id", projectId);
    if (scenesError) throw scenesError;

    let flaggedVideos = 0;
    let flaggedImages = 0;
    for (const s of scenes || []) {
      const patch: { video_url?: string; image_url?: string } = {};
      if (s.video_url && s.video_url !== R2_DELETED_MARKER) {
        patch.video_url = R2_DELETED_MARKER;
        flaggedVideos += 1;
      }
      if (s.image_url && s.image_url !== R2_DELETED_MARKER) {
        patch.image_url = R2_DELETED_MARKER;
        flaggedImages += 1;
      }
      if (Object.keys(patch).length) {
        const { error: patchError } = await supabaseAdmin
          .from("video_scenes")
          .update(patch)
          .eq("id", s.id);
        if (patchError) throw patchError;
      }
    }

    const { data: project, error: projectError } = await supabaseAdmin
      .from("video_projects")
      .select("id, thumbnail_url")
      .eq("id", projectId)
      .maybeSingle();
    if (projectError) throw projectError;

    let clearedThumb = false;
    if (project?.thumbnail_url && project.thumbnail_url !== R2_DELETED_MARKER) {
      const { error: thumbError } = await supabaseAdmin
        .from("video_projects")
        .update({ thumbnail_url: R2_DELETED_MARKER })
        .eq("id", projectId);
      if (thumbError) throw thumbError;
      clearedThumb = true;
    }

    await appendGenerationLog(projectId, {
      level: "info",
      stage: "Completed",
      message: `Storage kézzel ürítve (${deleted.length} fájl törölve, ${flaggedVideos} videó, ${flaggedImages} kép, borítókép: ${clearedThumb ? "igen" : "nem"}).`,
      meta: { deletedKeys: deleted.length, flaggedVideos, flaggedImages, clearedThumb },
    });

    return NextResponse.json({
      success: true,
      deleted: deleted.length,
      flaggedVideos,
      flaggedImages,
      clearedThumb,
    });
  } catch (err) {
    return routeError(err, "api/projects/[projectId]/clear-media POST", {
      fallback: "Nem sikerült üríteni a projekt médiafájljait.",
    });
  }
}
