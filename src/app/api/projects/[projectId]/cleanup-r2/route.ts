import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import {
  assertProjectOwned,
  forbidden,
  requireUserApi,
} from "@/lib/auth";

/**
 * Marks a project as exported. Does NOT delete anything — the nightly
 * retention cron (`cleanupOldR2Videos`, src/lib/inngest/r2-cleanup.ts`)
 * is what actually sweeps R2 media, and only once `exported_at` is at
 * least 7 days old. Exporting is meant to protect media, not trigger an
 * immediate deletion.
 */
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

    await supabaseAdmin
      .from("video_projects")
      .update({ exported_at: new Date().toISOString() })
      .eq("id", projectId);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[api/projects/cleanup-r2]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
