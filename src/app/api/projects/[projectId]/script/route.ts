import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import {
  assertProjectOwned,
  forbidden,
  requireUserApi,
} from "@/lib/auth";

const MAX_SCRIPT_CHARS = 200_000;

/** Save script edits during Script_Review without continuing. */
export async function PATCH(
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

    const { script } = await req.json();
    const trimmed = typeof script === "string" ? script.trim() : "";

    if (!trimmed) {
      return NextResponse.json({ error: "Script cannot be empty" }, { status: 400 });
    }
    if (trimmed.length > MAX_SCRIPT_CHARS) {
      return NextResponse.json(
        { error: `Script too long (max ${MAX_SCRIPT_CHARS})` },
        { status: 400 }
      );
    }

    const { data: project, error } = await supabaseAdmin
      .from("video_projects")
      .select("id, status")
      .eq("id", projectId)
      .single();

    if (error || !project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    if (project.status !== "Script_Review") {
      return NextResponse.json(
        { error: "Script only editable during Script_Review" },
        { status: 400 }
      );
    }

    await supabaseAdmin
      .from("video_projects")
      .update({ generated_script: trimmed, updated_at: new Date().toISOString() })
      .eq("id", projectId);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
