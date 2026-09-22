import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { assertChannelOwned, assertNamePoolPresetOwned, forbidden, requireUserApi } from "@/lib/auth";
import { normalizeVideoOptions } from "@/lib/video-mode";
import { normalizeStockSettings } from "@/lib/stock/types";
import { isKnownTextModel } from "@/lib/cost-estimate";
import { buildChannelInsertData, validateChannelBody } from "../validate";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireUserApi();
    if (auth.error) return auth.error;

    const { id } = await params;
    if (!(await assertChannelOwned(id, auth.user.id))) {
      return forbidden("Channel not found or not owned");
    }

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

    const updateData = buildChannelInsertData(validation.value, {
      normalizeVideoOptions,
      normalizeStockSettings,
      isKnownTextModel,
    });

    const { data, error } = await supabaseAdmin
      .from("channels")
      .update(updateData)
      .eq("id", id)
      .select("*")
      .single();

    if (error || !data) {
      return NextResponse.json({ error: error?.message || "Mentés sikertelen" }, { status: 500 });
    }
    return NextResponse.json({ channel: data });
  } catch (error: any) {
    console.error("[api/channels/[id] PATCH]", error);
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
    if (!(await assertChannelOwned(id, auth.user.id))) {
      return forbidden("Channel not found or not owned");
    }

    const { error } = await supabaseAdmin.from("channels").delete().eq("id", id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[api/channels/[id] DELETE]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
