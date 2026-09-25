import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { assertNamePoolPresetOwned, forbidden, requireUserApi } from "@/lib/auth";
import { apiError, routeError } from "@/lib/api-response";
import { NOT_FOUND_MESSAGE } from "@/lib/errors";
import { normalizeCategories, normalizePreset } from "@/lib/name-pools";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireUserApi();
    if (auth.error) return auth.error;

    const { id } = await params;
    if (!(await assertNamePoolPresetOwned(id, auth.user.id))) {
      return forbidden("A névkészlet nem található, vagy nincs hozzáférésed.");
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return apiError("Érvénytelen kérés.", 400);
    }
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (typeof body.name === "string") {
      const name = body.name.trim();
      if (!name) {
        return apiError("A név nem lehet üres.", 400);
      }
      update.name = name;
    }
    if (body.categories !== undefined) {
      const categories = normalizeCategories(body.categories);
      if (categories.length === 0) {
        return apiError("Legalább egy kategória szükséges.", 400);
      }
      if (categories.some((c) => !c.label.trim())) {
        return apiError("Minden kategóriának kell egy név (label).", 400);
      }
      update.categories = categories;
    }
    if (body.minNamesPerCategory !== undefined) {
      const n = Number(body.minNamesPerCategory);
      if (!Number.isFinite(n) || n <= 0) {
        return apiError("Érvénytelen minimum név/kategória érték.", 400);
      }
      update.min_names_per_category = Math.round(n);
    }

    const { data, error } = await supabaseAdmin
      .from("name_pool_presets")
      .update(update)
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw error;
    if (!data) return apiError(NOT_FOUND_MESSAGE, 404, { code: "not_found" });

    return NextResponse.json({ preset: normalizePreset(data) });
  } catch (err) {
    return routeError(err, "api/name-pool-presets/[id] PATCH", {
      fallback: "Nem sikerült menteni a névkészletet.",
    });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireUserApi();
    if (auth.error) return auth.error;

    const { id } = await params;
    if (!(await assertNamePoolPresetOwned(id, auth.user.id))) {
      return forbidden("A névkészlet nem található, vagy nincs hozzáférésed.");
    }

    // Channels pointing at this preset fall back to no preset selected
    // (name_pool_preset_id -> null via FK on delete set null) rather than
    // failing the delete or silently keeping a dangling reference.
    const { error } = await supabaseAdmin.from("name_pool_presets").delete().eq("id", id);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err) {
    return routeError(err, "api/name-pool-presets/[id] DELETE", {
      fallback: "Nem sikerült törölni a névkészletet.",
    });
  }
}
