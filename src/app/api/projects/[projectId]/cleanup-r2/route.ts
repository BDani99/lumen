import { NextResponse } from "next/server";
import { routeError } from "@/lib/api-response";
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
      return forbidden("A projekt nem található, vagy nincs hozzáférésed.");
    }

    const { error } = await supabaseAdmin
      .from("video_projects")
      .update({ exported_at: new Date().toISOString() })
      .eq("id", projectId);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err) {
    return routeError(err, "api/projects/[projectId]/cleanup-r2 POST", {
      fallback: "Nem sikerült exportáltnak jelölni a projektet.",
    });
  }
}
