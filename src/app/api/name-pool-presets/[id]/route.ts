import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { assertNamePoolPresetOwned, forbidden, requireUserApi } from "@/lib/auth";
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
      return forbidden("Preset not found or not owned");
    }

    const body = await req.json().catch(() => ({}));
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (typeof body.name === "string") {
      const name = body.name.trim();
      if (!name) {
        return NextResponse.json({ error: "A név nem lehet üres." }, { status: 400 });
      }
      update.name = name;
    }
    if (body.categories !== undefined) {
      const categories = normalizeCategories(body.categories);
      if (categories.length === 0) {
        return NextResponse.json({ error: "Legalább egy kategória szükséges." }, { status: 400 });
      }
      if (categories.some((c) => !c.label.trim())) {
        return NextResponse.json({ error: "Minden kategóriának kell egy név (label)." }, { status: 400 });
      }
      update.categories = categories;
    }
    if (body.minNamesPerCategory !== undefined) {
      const n = Number(body.minNamesPerCategory);
      if (!Number.isFinite(n) || n <= 0) {
        return NextResponse.json({ error: "Érvénytelen minimum név/kategória érték." }, { status: 400 });
      }
      update.min_names_per_category = Math.round(n);
    }

    const { data, error } = await supabaseAdmin
      .from("name_pool_presets")
      .update(update)
      .eq("id", id)
      .select("*")
      .single();

    if (error || !data) {
      return NextResponse.json({ error: error?.message || "Mentés sikertelen" }, { status: 500 });
    }

    return NextResponse.json({ preset: normalizePreset(data) });
  } catch (error: any) {
    console.error("[api/name-pool-presets/[id] PATCH]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
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
      return forbidden("Preset not found or not owned");
    }

    // Channels pointing at this preset fall back to no preset selected
    // (name_pool_preset_id -> null via FK on delete set null) rather than
    // failing the delete or silently keeping a dangling reference.
    const { error } = await supabaseAdmin.from("name_pool_presets").delete().eq("id", id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[api/name-pool-presets/[id] DELETE]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
