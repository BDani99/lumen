import { NextResponse } from "next/server";
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

    if (project.status !== "Script_Review" && project.status !== "Failed") {
      return NextResponse.json(
        { error: `Cannot regenerate script from status ${project.status}` },
        { status: 400 }
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
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
