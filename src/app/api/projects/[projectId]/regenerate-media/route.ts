import { NextResponse } from "next/server";
import { apiError, routeError } from "@/lib/api-response";
import { supabaseAdmin } from "@/lib/supabase";
import { inngest } from "@/lib/inngest/client";
import { appendGenerationLog } from "@/lib/generation-log";
import {
  assertProjectOwned,
  forbidden,
  requireUserApi,
} from "@/lib/auth";
import { normalizeVideoOptions } from "@/lib/video-mode";
import { parseRegenerateMediaBody } from "@/lib/inngest/regenerate-media";

/** Start Inngest job to regenerate missing/expired scene media. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const auth = await requireUserApi();
    if (auth.error) return auth.error;

    const { projectId } = await params;
    if (!(await assertProjectOwned(projectId, auth.user.id))) {
      return forbidden("A projekt nem található, vagy nincs hozzáférésed.");
    }

    const { data: project, error } = await supabaseAdmin
      .from("video_projects")
      .select("id, status, timeline_data, channel_id, channels(image_model, video_generation_defaults)")
      .eq("id", projectId)
      .single();

    if (error && error.code !== "PGRST116") {
      return routeError(error, "api/projects/[projectId]/regenerate-media POST", {
        fallback: "Nem sikerült betölteni a projektet.",
      });
    }
    if (!project) {
      return apiError("A projekt nem található.", 404);
    }

    if (project.status === "Image_Generation" || project.status === "Audio_Generation") {
      return apiError("A generálás már folyamatban van.", 409);
    }

    if (project.status !== "Completed" && project.status !== "Failed") {
      return apiError(
        "A projekt jelenlegi állapotában nem indítható újragenerálás. Frissítsd az oldalt.",
        409
      );
    }

    const channel = Array.isArray(project.channels)
      ? project.channels[0]
      : (project as any).channels;
    const opts = normalizeVideoOptions(
      (project.timeline_data as any)?.generationOptions,
      channel?.video_generation_defaults
    );
    const body = await req.json().catch(() => ({}));
    const parsed = parseRegenerateMediaBody(body, {
      ...opts,
      imageModel: channel?.image_model || "gpt-image-2 low",
    });

    const prev = (project.timeline_data || {}) as Record<string, unknown>;
    const { error: updateError } = await supabaseAdmin
      .from("video_projects")
      .update({
        status: "Image_Generation",
        timeline_data: {
          ...prev,
          generationOptions: {
            ...((prev.generationOptions as object) || {}),
            mediaMode: parsed.mediaMode,
            videoStrategy: parsed.videoStrategy,
            videoModel: parsed.videoModel,
            videoDurationSec: parsed.videoDurationSec,
            videoResolution: parsed.videoResolution,
            videoPattern: parsed.videoPattern,
            videoEveryN: parsed.videoEveryN,
            videoFirstSeconds: parsed.videoFirstSeconds,
            introVideoCount: parsed.introVideoCount,
            maxVideoScenes: parsed.maxVideoScenes,
          },
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", projectId);
    if (updateError) throw updateError;

    await appendGenerationLog(projectId, {
      level: "info",
      stage: "Image_Generation",
      message: "Média újragenerálás indítva az editorból…",
      meta: parsed,
    });

    await inngest.send({
      name: "video/regenerate-media",
      data: { projectId, ...parsed },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    return routeError(err, "api/projects/[projectId]/regenerate-media POST", {
      fallback: "Nem sikerült elindítani a média újragenerálását.",
    });
  }
}
