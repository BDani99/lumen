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

/** Regenerate AI script and stop again at Script_Review. */
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
      return routeError(error, "api/projects/[projectId]/script/regenerate POST", {
        fallback: "Nem sikerült betölteni a projektet.",
      });
    }
    if (!project) {
      return apiError("A projekt nem található.", 404);
    }

    if (project.status !== "Script_Review" && project.status !== "Failed") {
      return apiError(
        "A forgatókönyv a projekt jelenlegi állapotában nem generálható újra. Frissítsd az oldalt.",
        409
      );
    }

    const qualityCheck = Boolean(project.timeline_data?.generationOptions?.qualityCheck);
    const logicCheck = Boolean(project.timeline_data?.generationOptions?.logicCheck);
    const finalPolish = Boolean(project.timeline_data?.generationOptions?.finalPolish);

    await appendGenerationLog(projectId, {
      level: "info",
      stage: "Script_Generation",
      message: "Forgatókönyv újragenerálás kérve…",
    });

    await inngest.send({
      name: "video/regenerate-script",
      data: { projectId, qualityCheck, logicCheck, finalPolish },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    return routeError(err, "api/projects/[projectId]/script/regenerate POST", {
      fallback: "Nem sikerült újraindítani a forgatókönyv generálását.",
    });
  }
}
