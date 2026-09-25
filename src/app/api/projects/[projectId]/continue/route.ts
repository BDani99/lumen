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
      return forbidden("A projekt nem található, vagy nincs hozzáférésed.");
    }

    // The body is optional here (plain "approve" sends none), but when present it must be an object.
    const raw = await req.json().catch(() => ({}));
    const body: Record<string, unknown> =
      raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const script =
      typeof body.script === "string" ? body.script.trim() : undefined;

    const { data: project, error } = await supabaseAdmin
      .from("video_projects")
      .select("id, status, generated_script")
      .eq("id", projectId)
      .single();

    if (error && error.code !== "PGRST116") {
      return routeError(error, "api/projects/[projectId]/continue POST", {
        fallback: "Nem sikerült betölteni a projektet.",
      });
    }
    if (!project) {
      return apiError("A projekt nem található.", 404);
    }

    if (project.status !== "Script_Review" && project.status !== "Script_Ready") {
      return apiError(
        "A projekt jelenlegi állapotából nem lehet folytatni a generálást. Frissítsd az oldalt.",
        409
      );
    }

    if (script !== undefined) {
      if (script.length > MAX_SCRIPT_CHARS) {
        return apiError(
          `A forgatókönyv túl hosszú (legfeljebb ${MAX_SCRIPT_CHARS.toLocaleString("hu-HU")} karakter lehet).`,
          400
        );
      }
      if (!script) {
        return apiError("A forgatókönyv nem lehet üres.", 400);
      }
      const { error: updateError } = await supabaseAdmin
        .from("video_projects")
        .update({ generated_script: script })
        .eq("id", projectId);
      if (updateError) throw updateError;
    } else if (!project.generated_script?.trim()) {
      return apiError("A projekthez még nincs forgatókönyv.", 400);
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
  } catch (err) {
    return routeError(err, "api/projects/[projectId]/continue POST", {
      fallback: "Nem sikerült folytatni a videó generálását.",
    });
  }
}
