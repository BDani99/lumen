import { NextResponse } from "next/server";
import { apiError, routeError } from "@/lib/api-response";
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
      return forbidden("A projekt nem található, vagy nincs hozzáférésed.");
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return apiError("Érvénytelen kérés.", 400);
    }
    const { script } = body;
    const trimmed = typeof script === "string" ? script.trim() : "";

    if (!trimmed) {
      return apiError("A forgatókönyv nem lehet üres.", 400);
    }
    if (trimmed.length > MAX_SCRIPT_CHARS) {
      return apiError(
        `A forgatókönyv túl hosszú (legfeljebb ${MAX_SCRIPT_CHARS.toLocaleString("hu-HU")} karakter lehet).`,
        400
      );
    }

    const { data: project, error } = await supabaseAdmin
      .from("video_projects")
      .select("id, status")
      .eq("id", projectId)
      .single();

    if (error && error.code !== "PGRST116") {
      return routeError(error, "api/projects/[projectId]/script PATCH", {
        fallback: "Nem sikerült betölteni a projektet.",
      });
    }
    if (!project) {
      return apiError("A projekt nem található.", 404);
    }

    if (project.status !== "Script_Review") {
      return apiError(
        "A forgatókönyv csak a jóváhagyási lépésben szerkeszthető. Frissítsd az oldalt.",
        409
      );
    }

    const { error: updateError } = await supabaseAdmin
      .from("video_projects")
      .update({ generated_script: trimmed, updated_at: new Date().toISOString() })
      .eq("id", projectId);
    if (updateError) throw updateError;

    return NextResponse.json({ success: true });
  } catch (err) {
    return routeError(err, "api/projects/[projectId]/script PATCH", {
      fallback: "Nem sikerült menteni a forgatókönyvet.",
    });
  }
}
