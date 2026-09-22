import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { inngest } from "@/lib/inngest/client";
import { appendGenerationLog } from "@/lib/generation-log";
import {
  assertProjectOwned,
  forbidden,
  requireUserApi,
} from "@/lib/auth";

const TERMINAL = new Set(["Completed", "Failed", "Cancelled"]);

/** Stop all running Inngest workflows for this project and mark it cancelled. */
export async function POST(
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
      .select("id, status, timeline_data")
      .eq("id", projectId)
      .single();

    if (error || !project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    if (TERMINAL.has(project.status)) {
      return NextResponse.json(
        { error: `Cannot cancel from status ${project.status}`, alreadyTerminal: true },
        { status: 400 }
      );
    }

    const prevTimeline =
      project.timeline_data && typeof project.timeline_data === "object"
        ? (project.timeline_data as Record<string, unknown>)
        : {};

    await supabaseAdmin
      .from("video_projects")
      .update({
        status: "Cancelled",
        updated_at: new Date().toISOString(),
        timeline_data: {
          ...prevTimeline,
          cancelRequested: true,
          cancelledAt: new Date().toISOString(),
        },
      })
      .eq("id", projectId);

    await appendGenerationLog(projectId, {
      level: "warn",
      stage: "Cancelled",
      message: "Generálás leállítva a felhasználó által.",
    });

    // Cancels generate / continue / regenerate-script runs matching this projectId
    await inngest.send({
      name: "video/cancel",
      data: { projectId },
    });

    return NextResponse.json({ success: true, status: "Cancelled" });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
