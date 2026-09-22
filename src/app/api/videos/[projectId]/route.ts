import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import {
  assertProjectOwned,
  forbidden,
  requireUserApi,
} from "@/lib/auth";
import { deleteR2Prefix, isR2Configured } from "@/lib/r2";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const auth = await requireUserApi();
    if (auth.error) return auth.error;

    const { projectId } = await params;
    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    if (!(await assertProjectOwned(projectId, auth.user.id))) {
      return forbidden("Project not found or not owned");
    }

    // Prefer R2 (images + videos). Legacy Supabase storage cleanup if anything left.
    if (isR2Configured()) {
      try {
        await deleteR2Prefix(`projects/${projectId}/`);
      } catch (e) {
        console.error("R2 cleanup on project delete:", e);
      }
    }

    try {
      const { data: files } = await supabaseAdmin.storage
        .from("video_images")
        .list(projectId);
      if (files && files.length > 0) {
        await supabaseAdmin.storage
          .from("video_images")
          .remove(files.map((x) => `${projectId}/${x.name}`));
      }
    } catch (e) {
      console.error("Supabase storage cleanup on project delete:", e);
    }

    await supabaseAdmin.from("video_scenes").delete().eq("project_id", projectId);

    const { error: deleteError } = await supabaseAdmin
      .from("video_projects")
      .delete()
      .eq("id", projectId);

    if (deleteError) {
      throw deleteError;
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Delete project error:", error);
    return NextResponse.json(
      { error: error.message || "Hiba történt a törlés során" },
      { status: 500 }
    );
  }
}
