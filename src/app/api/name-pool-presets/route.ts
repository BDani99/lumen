import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireUserApi } from "@/lib/auth";
import { apiError, routeError } from "@/lib/api-response";
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

    if (error) throw error;

    return NextResponse.json({ presets: (data || []).map(normalizePreset).filter(Boolean) });
  } catch (err) {
    return routeError(err, "api/name-pool-presets GET", {
      fallback: "Nem sikerült betölteni a névkészleteket.",
    });
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireUserApi();
    if (auth.error) return auth.error;

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return apiError("Érvénytelen kérés.", 400);
    }
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return apiError("Adj meg egy nevet a névkészletnek.", 400);
    }

    const categories = normalizeCategories(body.categories);
    if (categories.length === 0) {
      return apiError("Legalább egy kategória szükséges.", 400);
    }
    if (categories.some((c) => !c.label.trim())) {
      return apiError("Minden kategóriának kell egy név (label).", 400);
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

    if (error) throw error;
    if (!data) throw new Error("name_pool_presets insert returned no row");

    return NextResponse.json({ preset: normalizePreset(data) });
  } catch (err) {
    return routeError(err, "api/name-pool-presets POST", {
      fallback: "Nem sikerült létrehozni a névkészletet.",
    });
  }
}
