import { NextResponse } from "next/server";
import { apiError, routeError } from "@/lib/api-response";
import { supabaseAdmin } from "@/lib/supabase";
import { inngest } from "@/lib/inngest/client";
import { appendGenerationLog } from "@/lib/generation-log";
import { assertChannelOwned, forbidden, requireUserApi } from "@/lib/auth";
import { normalizeProSettings } from "@/lib/pro/presets";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

const MAX_SCRIPT_CHARS = 200_000;

/**
 * Creates a Pro-pipeline project. Deliberately a separate route from
 * /api/videos so the classic create path is not touched at all.
 */
export async function POST(req: Request) {
  try {
    const auth = await requireUserApi();
    if (auth.error) return auth.error;

    // Same bucket as the classic /api/videos — both start a full paid
    // generation pipeline, so the two pipelines share one hourly cap.
    const rateLimit = await checkRateLimit({
      userId: auth.user.id,
      routeKey: "videos:create",
      limit: 10,
      windowSeconds: 3600,
    });
    if (!rateLimit.allowed) return rateLimitResponse(rateLimit.retryAfterSeconds);

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return apiError("Érvénytelen kérés.", 400);
    }
    const { title, channelId, durationMinutes, customScript, proSettings } = body;

    if (typeof title !== "string" || !title || typeof channelId !== "string" || !channelId) {
      return apiError("Add meg a videó címét és válassz csatornát.", 400);
    }
    if (!(await assertChannelOwned(channelId, auth.user.id))) {
      return forbidden("A csatorna nem található, vagy nincs hozzáférésed.");
    }

    const trimmedScript = typeof customScript === "string" ? customScript.trim() : "";
    if (trimmedScript.length > MAX_SCRIPT_CHARS) {
      return apiError(
        `A forgatókönyv túl hosszú (legfeljebb ${MAX_SCRIPT_CHARS.toLocaleString("hu-HU")} karakter lehet).`,
        400
      );
    }

    const settings = normalizeProSettings(proSettings);
    const minutes = Math.max(1, Math.min(120, Number(durationMinutes) || 5));

    const insertPayload: Record<string, unknown> = {
      title,
      channel_id: channelId,
      user_id: auth.user.id,
      status: "Draft",
      pipeline: "pro",
      pro_settings: settings,
      timeline_data: { durationMinutes: minutes },
    };
    if (trimmedScript) insertPayload.generated_script = trimmedScript;

    const { data: project, error } = await supabaseAdmin
      .from("video_projects")
      .insert(insertPayload)
      .select()
      .single();

    if (error) {
      return routeError(error, "api/pro/videos POST", {
        fallback: "Nem sikerült létrehozni a Pro projektet.",
      });
    }

    await appendGenerationLog(project.id, {
      level: "info",
      stage: "Draft",
      message: trimmedScript
        ? "Pro projekt létrehozva saját forgatókönyvvel. Várólista…"
        : "Pro projekt létrehozva. Generálás várólistára került…",
      meta: { presetId: settings.presetId, budgetUsd: settings.budgetUsd },
    });

    await inngest.send({
      name: "video/generate-pro",
      data: { projectId: project.id },
    });

    return NextResponse.json({ success: true, project });
  } catch (err) {
    return routeError(err, "api/pro/videos POST", {
      fallback: "Nem sikerült elindítani a Pro videó generálását.",
    });
  }
}
