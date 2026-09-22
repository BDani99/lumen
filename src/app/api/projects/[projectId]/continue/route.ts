import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { inngest } from "@/lib/inngest/client";
import { appendGenerationLog } from "@/lib/generation-log";
import {
  assertProjectOwned,
  forbidden,
  requireUserApi,
} from "@/lib/auth";

const MAX_SCRIPT_CHARS = 200_000;

/** Save optional edited script and continue TTS/images from Script_Review. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const auth = await requireUserApi();
    if (auth.error) return auth.error;

    const { projectId } = await params;
    if (!(await assertProjectOwned(projectId, auth.user.id))) {
      return forbidden("Project not found or not owned");
    }

    const body = await req.json().catch(() => ({}));
    const script =
      typeof body.script === "string" ? body.script.trim() : undefined;

    const { data: project, error } = await supabaseAdmin
      .from("video_projects")
      .select("id, status, generated_script")
      .eq("id", projectId)
      .single();

    if (error || !project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    if (project.status !== "Script_Review" && project.status !== "Script_Ready") {
      return NextResponse.json(
        { error: `Cannot continue from status ${project.status}` },
        { status: 400 }
      );
    }

    if (script !== undefined) {
      if (script.length > MAX_SCRIPT_CHARS) {
        return NextResponse.json(
          { error: `Script too long (max ${MAX_SCRIPT_CHARS})` },
          { status: 400 }
        );
      }
      if (!script) {
        return NextResponse.json({ error: "Script cannot be empty" }, { status: 400 });
      }
      await supabaseAdmin
        .from("video_projects")
        .update({ generated_script: script })
        .eq("id", projectId);
    } else if (!project.generated_script?.trim()) {
      return NextResponse.json({ error: "No script on project" }, { status: 400 });
    }

    await appendGenerationLog(projectId, {
      level: "info",
      stage: "Script_Review",
      message: script
        ? "Szerkesztett forgatókönyv mentve — hanggenerálás indítása…"
        : "Forgatókönyv jóváhagyva — hanggenerálás indítása…",
    });

    await inngest.send({
      name: "video/continue",
      data: { projectId },
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
