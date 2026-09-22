import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { inngest } from "@/lib/inngest/client";
import { appendGenerationLog } from "@/lib/generation-log";
import { assertChannelOwned, forbidden, requireUserApi } from "@/lib/auth";
import { normalizeProSettings } from "@/lib/pro/presets";

const MAX_SCRIPT_CHARS = 200_000;

/**
 * Creates a Pro-pipeline project. Deliberately a separate route from
 * /api/videos so the classic create path is not touched at all.
 */
export async function POST(req: Request) {
  try {
    const auth = await requireUserApi();
    if (auth.error) return auth.error;

    const body = await req.json();
    const { title, channelId, durationMinutes, customScript, proSettings } = body;

    if (!title || !channelId) {
      return NextResponse.json({ error: "Missing title or channelId" }, { status: 400 });
    }
    if (!(await assertChannelOwned(channelId, auth.user.id))) {
      return forbidden("Channel not found or not owned");
    }

    const trimmedScript = typeof customScript === "string" ? customScript.trim() : "";
    if (trimmedScript.length > MAX_SCRIPT_CHARS) {
      return NextResponse.json(
        { error: `Script too long (max ${MAX_SCRIPT_CHARS} characters)` },
        { status: 400 }
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
      return NextResponse.json({ error: error.message }, { status: 500 });
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
  } catch (err: any) {
    console.error("[api/pro/videos]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
