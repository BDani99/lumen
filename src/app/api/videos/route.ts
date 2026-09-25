import { NextResponse } from "next/server";
import { apiError, routeError } from "@/lib/api-response";
import { supabaseAdmin } from "@/lib/supabase";
import { inngest } from "@/lib/inngest/client";
import { appendGenerationLog } from "@/lib/generation-log";
import {
  assertChannelOwned,
  forbidden,
  requireUserApi,
} from "@/lib/auth";
import { normalizeVideoOptions } from "@/lib/video-mode";
import { isKnownTextModel } from "@/lib/cost-estimate";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

const MAX_SCRIPT_CHARS = 200_000;

export async function POST(req: Request) {
  try {
    const auth = await requireUserApi();
    if (auth.error) return auth.error;
    const user = auth.user;

    const rateLimit = await checkRateLimit({
      userId: user.id,
      routeKey: "videos:create",
      limit: 10,
      windowSeconds: 3600,
    });
    if (!rateLimit.allowed) return rateLimitResponse(rateLimit.retryAfterSeconds);

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return apiError("Érvénytelen kérés.", 400);
    }
    const {
      title,
      channelId,
      durationMinutes,
      customScript,
      qualityCheck,
      logicCheck,
      finalPolish,
      pauseAfterScript,
      mediaMode,
      videoPattern,
      videoEveryN,
      videoFirstSeconds,
      introVideoCount,
      videoStrategy,
      maxVideoScenes,
      videoModel,
      videoDurationSec,
      videoResolution,
      textModel,
    } = body;

    const trimmedTitle = typeof title === "string" ? title.trim() : "";
    if (!trimmedTitle || typeof channelId !== "string" || !channelId) {
      return apiError("Add meg a videó címét és válassz csatornát.", 400);
    }

    if (!(await assertChannelOwned(channelId, user.id))) {
      return forbidden("A csatorna nem található, vagy nincs hozzáférésed.");
    }

    const { data: channelRow, error: channelError } = await supabaseAdmin
      .from("channels")
      .select("video_generation_defaults")
      .eq("id", channelId)
      .maybeSingle();
    if (channelError) throw channelError;

    const trimmedScript =
      typeof customScript === "string" ? customScript.trim() : "";

    if (trimmedScript.length > MAX_SCRIPT_CHARS) {
      return apiError(
        `A forgatókönyv túl hosszú (legfeljebb ${MAX_SCRIPT_CHARS.toLocaleString("hu-HU")} karakter lehet).`,
        400
      );
    }

    const videoOpts = normalizeVideoOptions(
      {
        mediaMode,
        videoPattern,
        videoEveryN,
        videoFirstSeconds,
        introVideoCount,
        videoStrategy,
        maxVideoScenes,
        videoModel,
        videoDurationSec,
        videoResolution,
      },
      channelRow?.video_generation_defaults
    );

    // Per-video script-model override; anything unrecognised falls back to the
    // channel's own text_model rather than being trusted through to the API.
    const overrideTextModel = isKnownTextModel(textModel) ? String(textModel).trim() : "";

    const opts = {
      qualityCheck: Boolean(qualityCheck),
      logicCheck: Boolean(logicCheck),
      finalPolish: Boolean(finalPolish),
      pauseAfterScript: Boolean(pauseAfterScript),
      durationMinutes: durationMinutes || 5,
      ...videoOpts,
      ...(overrideTextModel ? { textModel: overrideTextModel } : {}),
    };

    const insertPayload: Record<string, unknown> = {
      title: trimmedTitle,
      channel_id: channelId,
      user_id: user.id,
      status: "Draft",
      timeline_data: { generationOptions: opts, durationMinutes: opts.durationMinutes },
    };
    if (trimmedScript) {
      insertPayload.generated_script = trimmedScript;
    }

    const { data: project, error } = await supabaseAdmin
      .from("video_projects")
      .insert(insertPayload)
      .select()
      .single();

    if (error) {
      return routeError(error, "api/videos POST", {
        fallback: "Nem sikerült létrehozni a videó projektet.",
      });
    }

    await appendGenerationLog(project.id, {
      level: "info",
      stage: "Draft",
      message: trimmedScript
        ? "Projekt létrehozva saját forgatókönyvvel. Várólista…"
        : "Projekt létrehozva. Generálás várólistára került…",
      meta: opts,
    });

    await inngest.send({
      name: "video/generate",
      data: {
        projectId: project.id,
        title: project.title,
        channelId: project.channel_id,
        durationMinutes: opts.durationMinutes,
        qualityCheck: opts.qualityCheck,
        logicCheck: opts.logicCheck,
        finalPolish: opts.finalPolish,
        pauseAfterScript: opts.pauseAfterScript,
        mediaMode: opts.mediaMode,
        videoPattern: opts.videoPattern,
        videoEveryN: opts.videoEveryN,
        videoFirstSeconds: opts.videoFirstSeconds,
        introVideoCount: opts.introVideoCount,
        videoStrategy: opts.videoStrategy,
        maxVideoScenes: opts.maxVideoScenes,
        videoModel: opts.videoModel,
        videoDurationSec: opts.videoDurationSec,
        videoResolution: opts.videoResolution,
        ...(overrideTextModel ? { textModel: overrideTextModel } : {}),
        ...(trimmedScript ? { customScript: trimmedScript } : {}),
      },
    });

    return NextResponse.json({ success: true, project });
  } catch (err) {
    return routeError(err, "api/videos POST", {
      fallback: "Nem sikerült elindítani a videó generálását.",
    });
  }
}
