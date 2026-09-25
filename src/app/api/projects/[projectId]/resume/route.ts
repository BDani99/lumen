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
import { isStalled, minutesSince } from "@/lib/stall-detection";
import { segmentSrtIntoScenes } from "@/lib/services/scene-segmentation";

/**
 * Continues a generation run that has gone silent — never re-does work
 * that already finished. Separate from /regenerate-media on purpose: that
 * route explicitly rejects while a run is genuinely still active (409), and
 * this route's whole point is to act while status is still
 * Script/Audio/Image_Generation, gated on server-verified staleness instead.
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

    const { data: project, error } = await supabaseAdmin
      .from("video_projects")
      .select("id, status, title, generated_script, timeline_data, channel_id, channels(*)")
      .eq("id", projectId)
      .single();
    if (error && error.code !== "PGRST116") {
      return routeError(error, "api/projects/[projectId]/resume POST", {
        fallback: "Nem sikerült betölteni a projektet.",
      });
    }
    if (!project) {
      return apiError("A projekt nem található.", 404);
    }

    const { data: lastLog, error: lastLogError } = await supabaseAdmin
      .from("generation_logs")
      .select("created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastLogError) throw lastLogError;

    // Authoritative check — the client's own staleness judgment is only a
    // hint for showing the button, never trusted for authorization.
    if (!isStalled(project.status, lastLog?.created_at)) {
      return apiError("A generálás nem tűnik elakadtnak — folytatás nem indítható.", 409);
    }

    const idleMinutes = lastLog?.created_at ? Math.round(minutesSince(lastLog.created_at)) : null;

    // Belt-and-suspenders: cancel any run that might still somehow be alive
    // for this project before starting a new one. Harmless no-op otherwise —
    // every relevant workflow already matches this event via cancelOn.
    await inngest.send({ name: "video/cancel", data: { projectId } });

    const channel = Array.isArray(project.channels) ? project.channels[0] : project.channels;
    const opts = (project.timeline_data as any)?.generationOptions || {};

    if (project.status === "Script_Generation") {
      await inngest.send({
        name: "video/regenerate-script",
        data: {
          projectId,
          qualityCheck: opts.qualityCheck ?? true,
          logicCheck: opts.logicCheck ?? false,
          finalPolish: opts.finalPolish ?? false,
        },
      });
    } else if (project.status === "Audio_Generation") {
      if (!project.generated_script?.trim()) {
        return apiError(
          "Nincs elmentett forgatókönyv — a szöveg fázist kell újraindítani.",
          400
        );
      }
      await inngest.send({ name: "video/continue", data: { projectId } });
    } else if (project.status === "Image_Generation") {
      if (!channel) {
        return apiError("A csatorna nem található.", 404);
      }

      // Backfill any scene row that never got created — covers projects
      // generated before scene rows were seeded upfront.
      if (project.generated_script) {
        // srt_data may be large; fetch it only for this branch.
        const { data: srtRow, error: srtError } = await supabaseAdmin
          .from("video_projects")
          .select("srt_data")
          .eq("id", projectId)
          .single();
        if (srtError) throw srtError;
        const srtData = srtRow?.srt_data as unknown as string;
        if (srtData) {
          const sentencesPerImage = channel.sentences_per_image || 2;
          const scenes = segmentSrtIntoScenes(srtData, sentencesPerImage);
          const { data: existingRows, error: existingError } = await supabaseAdmin
            .from("video_scenes")
            .select("scene_order")
            .eq("project_id", projectId);
          if (existingError) throw existingError;
          const existingOrders = new Set((existingRows || []).map((r) => r.scene_order));
          const missingRows = scenes
            .map((scene, i) => ({ scene, i }))
            .filter(({ i }) => !existingOrders.has(i))
            .map(({ scene, i }) => ({
              project_id: projectId,
              scene_order: i,
              text_segment: scene.text,
              start_time: scene.start_time,
              end_time: scene.end_time,
              image_prompt: null,
              image_url: null,
              video_url: null,
            }));
          for (let i = 0; i < missingRows.length; i += 200) {
            const { error: insertError } = await supabaseAdmin
              .from("video_scenes")
              .insert(missingRows.slice(i, i + 200));
            if (insertError) throw insertError;
          }
        }
      }

      const videoOpts = normalizeVideoOptions(opts, channel.video_generation_defaults);
      const { error: statusError } = await supabaseAdmin
        .from("video_projects")
        .update({ status: "Image_Generation", updated_at: new Date().toISOString() })
        .eq("id", projectId);
      if (statusError) throw statusError;
      await inngest.send({
        name: "video/regenerate-media",
        data: {
          projectId,
          mediaMode: videoOpts.mediaMode,
          videoStrategy: videoOpts.videoStrategy,
          videoModel: videoOpts.videoModel,
          videoDurationSec: videoOpts.videoDurationSec,
          videoResolution: videoOpts.videoResolution,
          videoPattern: videoOpts.videoPattern,
          videoEveryN: videoOpts.videoEveryN,
          videoFirstSeconds: videoOpts.videoFirstSeconds,
          introVideoCount: videoOpts.introVideoCount,
          maxVideoScenes: videoOpts.maxVideoScenes,
          imageModel: channel.image_model || "gpt-image-2 low",
        },
      });
    } else {
      return apiError(
        "A projekt jelenlegi állapotából nem lehet folytatni a generálást. Frissítsd az oldalt.",
        409
      );
    }

    await appendGenerationLog(projectId, {
      level: "info",
      stage: project.status,
      message: `Generálás folytatva a felhasználó által${
        idleMinutes != null ? ` (${idleMinutes} perc inaktivitás után)` : ""
      }…`,
      meta: { resumedFromStatus: project.status, idleMinutes },
    });

    return NextResponse.json({ success: true, resumedFromStatus: project.status });
  } catch (err) {
    return routeError(err, "api/projects/[projectId]/resume POST", {
      fallback: "Nem sikerült folytatni a generálást.",
    });
  }
}
