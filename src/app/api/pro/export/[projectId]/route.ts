import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { assertProjectOwned, forbidden, requireUserApi } from "@/lib/auth";
import { buildProTimeline } from "@/lib/pro/timeline";
import { buildProFcpxml } from "@/lib/pro/fcpxml";
import type { ProShot } from "@/lib/pro/types";

/**
 * Builds the Pro export package description: a multi-track FCPXML plus the
 * list of assets the browser should download and zip. Separate from the
 * classic /api/export route.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const auth = await requireUserApi();
    if (auth.error) return auth.error;

    const { projectId } = await params;
    if (!(await assertProjectOwned(projectId, auth.user.id))) {
      return forbidden("Project not found or not owned");
    }

    const { data: project, error } = await supabaseAdmin
      .from("video_projects")
      .select("*, pro_shots(*)")
      .eq("id", projectId)
      .single();

    if (error || !project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    if (project.pipeline !== "pro") {
      return NextResponse.json(
        { error: "Ez nem Pro projekt — használd a normál exportot." },
        { status: 400 }
      );
    }

    const rows: any[] = Array.isArray(project.pro_shots) ? project.pro_shots : [];
    const shots: ProShot[] = rows
      .map((r) => ({
        shotIndex: Number(r.shot_index) || 0,
        startSec: Number(r.start_sec) || 0,
        endSec: Number(r.end_sec) || 0,
        sourceKind: r.source_kind,
        assetUrl: r.asset_url,
        overlayUrl: r.overlay_url,
        keywords: Array.isArray(r.keywords) ? r.keywords : [],
        kenBurns: r.ken_burns || null,
        attribution: r.attribution || null,
        narrationText: r.narration_text || null,
        status: r.status,
      }))
      .sort((a, b) => a.shotIndex - b.shotIndex);

    const audioDurationSec = Number(project.pro_plan?.audioDurationSec) || 0;
    const timeline = buildProTimeline(shots, audioDurationSec);

    const audioUrl = project.timeline_data?.audio_url || null;
    const audioFilename = audioUrl ? "voiceover.mp3" : null;

    const fcpxml = buildProFcpxml({
      title: project.title || "Pro",
      timeline,
      audioFilename,
      audioDurationSec: Math.max(audioDurationSec, timeline.totalDurationSec),
    });

    // Credits for every non-AI asset used, so the channel can attribute properly.
    const credits = shots
      .filter((s) => s.attribution)
      .map((s) => `shot ${s.shotIndex + 1}: ${s.attribution}`)
      .join("\n");

    return NextResponse.json({
      fcpxml,
      audioUrl,
      audioFilename,
      assets: [
        ...timeline.broll.map((c) => ({ name: c.filename, url: c.url })),
        ...timeline.overlays.map((o) => ({ name: o.filename, url: o.url })),
      ],
      srtData: project.srt_data || "",
      credits,
      title: project.title || "",
      script: project.generated_script || "",
      missingShots: timeline.missingShots,
      totalDurationSec: timeline.totalDurationSec,
    });
  } catch (err: any) {
    console.error("[api/pro/export]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
