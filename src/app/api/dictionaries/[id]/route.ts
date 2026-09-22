import { NextResponse } from "next/server";
import { AI33Client, ai33UserMessage } from "@/lib/ai33";
import { assertDictionaryOwned, forbidden, requireUserApi } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireUserApi();
    if (auth.error) return auth.error;

    if (!process.env.AI33_API_KEY) {
      return NextResponse.json({ error: "AI33_API_KEY is not configured" }, { status: 500 });
    }

    const { id } = await params;
    const dictionaryId = Number(id);
    if (!Number.isFinite(dictionaryId)) {
      return NextResponse.json({ error: "Érvénytelen szótár-azonosító." }, { status: 400 });
    }
    if (!(await assertDictionaryOwned(dictionaryId, auth.user.id))) {
      return forbidden("Dictionary not found or not owned");
    }

    const body = await req.json().catch(() => ({}));
    const input: { name?: string; rules?: unknown } = {};
    if (typeof body.name === "string" && body.name.trim()) input.name = body.name.trim();
    if (Array.isArray(body.rules)) input.rules = body.rules;

    const ai33 = new AI33Client();
    const dictionary = await ai33.updateDictionary(dictionaryId, input as any);
    return NextResponse.json({ dictionary });
  } catch (error: any) {
    console.error("[api/dictionaries/[id] PUT]", error);
    return NextResponse.json({ error: ai33UserMessage(error) }, { status: 502 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireUserApi();
    if (auth.error) return auth.error;

    if (!process.env.AI33_API_KEY) {
      return NextResponse.json({ error: "AI33_API_KEY is not configured" }, { status: 500 });
    }

    const { id } = await params;
    const dictionaryId = Number(id);
    if (!Number.isFinite(dictionaryId)) {
      return NextResponse.json({ error: "Érvénytelen szótár-azonosító." }, { status: 400 });
    }
    if (!(await assertDictionaryOwned(dictionaryId, auth.user.id))) {
      return forbidden("Dictionary not found or not owned");
    }

    const ai33 = new AI33Client();
    await ai33.deleteDictionary(dictionaryId);
    await supabaseAdmin.from("dictionary_owners").delete().eq("dictionary_id", dictionaryId);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[api/dictionaries/[id] DELETE]", error);
    return NextResponse.json({ error: ai33UserMessage(error) }, { status: 502 });
  }
}
