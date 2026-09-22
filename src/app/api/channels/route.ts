import { NextResponse } from "next/server";
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

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ channels: data || [] });
  } catch (error: any) {
    console.error("[api/channels GET]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireUserApi();
    if (auth.error) return auth.error;

    const body = await req.json().catch(() => ({}));
    const validation = validateChannelBody(body);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    if (validation.value.name_pool_preset_id) {
      const owned = await assertNamePoolPresetOwned(
        validation.value.name_pool_preset_id,
        auth.user.id
      );
      if (!owned) {
        return NextResponse.json(
          { error: "A kiválasztott névkészlet nem található vagy nem a tiéd." },
          { status: 403 }
        );
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

    if (error || !data) {
      return NextResponse.json({ error: error?.message || "Létrehozás sikertelen" }, { status: 500 });
    }
    return NextResponse.json({ channel: data });
  } catch (error: any) {
    console.error("[api/channels POST]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
