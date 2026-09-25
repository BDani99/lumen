import { NextResponse } from "next/server";
import { apiError, routeError } from "@/lib/api-response";
import { supabaseAdmin } from "@/lib/supabase";
import { assertNamePoolPresetOwned, requireUserApi } from "@/lib/auth";
import { normalizeVideoOptions } from "@/lib/video-mode";
import { normalizeStockSettings } from "@/lib/stock/types";
import { isKnownTextModel } from "@/lib/cost-estimate";
import { buildChannelInsertData, validateChannelBody } from "./validate";

/** List / create channels — mirrors the ownership + manual-validation pattern
 * used by /api/dictionaries and /api/name-pool-presets. */
export async function GET() {
  try {
    const auth = await requireUserApi();
    if (auth.error) return auth.error;

    const { data, error } = await supabaseAdmin
      .from("channels")
      .select("*")
      .eq("user_id", auth.user.id)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return NextResponse.json({ channels: data || [] });
  } catch (err) {
    return routeError(err, "api/channels GET", { fallback: "Nem sikerült betölteni a csatornákat." });
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
    const validation = validateChannelBody(body);
    if (!validation.ok) {
      return apiError(validation.error, 400);
    }

    if (validation.value.name_pool_preset_id) {
      const owned = await assertNamePoolPresetOwned(
        validation.value.name_pool_preset_id,
        auth.user.id
      );
      if (!owned) {
        return apiError("A kiválasztott névkészlet nem található vagy nem a tiéd.", 403, { code: "forbidden" });
      }
    }

    const insertData = buildChannelInsertData(validation.value, {
      normalizeVideoOptions,
      normalizeStockSettings,
      isKnownTextModel,
    });

    const { data, error } = await supabaseAdmin
      .from("channels")
      .insert({ ...insertData, user_id: auth.user.id })
      .select("*")
      .single();

    if (error || !data) throw error ?? new Error("channel insert returned no row");
    return NextResponse.json({ channel: data });
  } catch (err) {
    return routeError(err, "api/channels POST", { fallback: "A csatornát nem sikerült létrehozni." });
  }
}
