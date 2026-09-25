import { NextResponse } from "next/server";
import { AI33Client } from "@/lib/ai33";
import { ai33NotConfigured, ai33RouteError } from "@/lib/ai33-response";
import { apiError } from "@/lib/api-response";
import { assertDictionaryOwned, forbidden, requireUserApi } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireUserApi();
    if (auth.error) return auth.error;

    if (!process.env.AI33_API_KEY) return ai33NotConfigured("api/dictionaries/[id] PUT");

    const { id } = await params;
    const dictionaryId = Number(id);
    if (!Number.isFinite(dictionaryId)) {
      return apiError("Érvénytelen szótár-azonosító.", 400);
    }
    if (!(await assertDictionaryOwned(dictionaryId, auth.user.id))) {
      return forbidden("A szótár nem található, vagy nincs hozzáférésed.");
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return apiError("Érvénytelen kérés.", 400);
    }
    const input: { name?: string; rules?: unknown } = {};
    if (typeof body.name === "string" && body.name.trim()) input.name = body.name.trim();
    if (Array.isArray(body.rules)) input.rules = body.rules;

    const ai33 = new AI33Client();
    const dictionary = await ai33.updateDictionary(dictionaryId, input as any);
    return NextResponse.json({ dictionary });
  } catch (err) {
    return ai33RouteError(err, "api/dictionaries/[id] PUT", {
      fallback: "Nem sikerült menteni a szótárat.",
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

    if (!process.env.AI33_API_KEY) return ai33NotConfigured("api/dictionaries/[id] DELETE");

    const { id } = await params;
    const dictionaryId = Number(id);
    if (!Number.isFinite(dictionaryId)) {
      return apiError("Érvénytelen szótár-azonosító.", 400);
    }
    if (!(await assertDictionaryOwned(dictionaryId, auth.user.id))) {
      return forbidden("A szótár nem található, vagy nincs hozzáférésed.");
    }

    const ai33 = new AI33Client();
    await ai33.deleteDictionary(dictionaryId);
    const { error: ownerError } = await supabaseAdmin
      .from("dictionary_owners")
      .delete()
      .eq("dictionary_id", dictionaryId);
    if (ownerError) {
      // The dictionary itself is already gone; a stale ownership row is harmless
      // (listing filters by AI33's list) and a retry would fail on AI33, so log
      // it for the operator and still report success.
      console.error("[api/dictionaries/[id] DELETE] owner row cleanup failed", ownerError);
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    return ai33RouteError(err, "api/dictionaries/[id] DELETE", {
      fallback: "Nem sikerült törölni a szótárat.",
    });
  }
}
