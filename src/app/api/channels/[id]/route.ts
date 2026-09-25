import { NextResponse } from "next/server";
import { apiError, routeError } from "@/lib/api-response";
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
      return forbidden("A csatorna nem található vagy nem a tiéd.");
    }

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

    if (error || !data) throw error ?? new Error("channel update returned no row");
    return NextResponse.json({ channel: data });
  } catch (err) {
    return routeError(err, "api/channels/[id] PATCH", { fallback: "A csatornát nem sikerült menteni." });
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
      return forbidden("A csatorna nem található vagy nem a tiéd.");
    }

    const { error } = await supabaseAdmin.from("channels").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    return routeError(err, "api/channels/[id] DELETE", { fallback: "A csatornát nem sikerült törölni." });
  }
}
