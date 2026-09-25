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
      return forbidden("A projekt nem található, vagy nincs hozzáférésed.");
    }

    const { data: project, error } = await supabaseAdmin
      .from("video_projects")
      .select("id, status, timeline_data")
      .eq("id", projectId)
      .single();

    if (error && error.code !== "PGRST116") {
      return routeError(error, "api/projects/[projectId]/cancel POST", {
        fallback: "Nem sikerült betölteni a projektet.",
      });
    }
    if (!project) {
      return apiError("A projekt nem található.", 404);
    }

    if (TERMINAL.has(project.status)) {
      // Keep the `alreadyTerminal` flag of the original response shape.
      return NextResponse.json(
        { error: "A generálás már befejeződött vagy le lett állítva.", alreadyTerminal: true },
        { status: 409 }
      );
    }

    const prevTimeline =
      project.timeline_data && typeof project.timeline_data === "object"
        ? (project.timeline_data as Record<string, unknown>)
        : {};

    const { error: updateError } = await supabaseAdmin
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
    if (updateError) throw updateError;

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
  } catch (err) {
    return routeError(err, "api/projects/[projectId]/cancel POST", {
      fallback: "Nem sikerült leállítani a generálást.",
    });
  }
}
