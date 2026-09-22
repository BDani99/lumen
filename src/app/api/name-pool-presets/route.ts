import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireUserApi } from "@/lib/auth";
import { normalizeCategories, normalizePreset, DEFAULT_MIN_NAMES_PER_CATEGORY } from "@/lib/name-pools";

/** List / create name-pool presets (account-level, shared across channels — same shape as /api/dictionaries). */
export async function GET() {
  try {
    const auth = await requireUserApi();
    if (auth.error) return auth.error;

    const { data, error } = await supabaseAdmin
      .from("name_pool_presets")
      .select("*")
      .eq("user_id", auth.user.id)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ presets: (data || []).map(normalizePreset).filter(Boolean) });
  } catch (error: any) {
    console.error("[api/name-pool-presets GET]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireUserApi();
    if (auth.error) return auth.error;

    const body = await req.json().catch(() => ({}));
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "Adj meg egy nevet a névkészletnek." }, { status: 400 });
    }

    const categories = normalizeCategories(body.categories);
    if (categories.length === 0) {
      return NextResponse.json({ error: "Legalább egy kategória szükséges." }, { status: 400 });
    }
    if (categories.some((c) => !c.label.trim())) {
      return NextResponse.json({ error: "Minden kategóriának kell egy név (label)." }, { status: 400 });
    }

    const minNamesPerCategory =
      Number.isFinite(Number(body.minNamesPerCategory)) && Number(body.minNamesPerCategory) > 0
        ? Math.round(Number(body.minNamesPerCategory))
        : DEFAULT_MIN_NAMES_PER_CATEGORY;

    const { data, error } = await supabaseAdmin
      .from("name_pool_presets")
      .insert({
        user_id: auth.user.id,
        name,
        categories,
        min_names_per_category: minNamesPerCategory,
      })
      .select("*")
      .single();

    if (error || !data) {
      return NextResponse.json({ error: error?.message || "Létrehozás sikertelen" }, { status: 500 });
    }

    return NextResponse.json({ preset: normalizePreset(data) });
  } catch (error: any) {
    console.error("[api/name-pool-presets POST]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
