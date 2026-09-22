import { NextResponse } from "next/server";
import { AI33Client, ai33UserMessage } from "@/lib/ai33";
import { requireUserApi } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * List / create AI33 pronunciation dictionaries. AI33 stores these
 * account-wide (one shared API key, no user field), so ownership — who in
 * Lumen may see/edit/delete which dictionary — is tracked locally in
 * dictionary_owners and enforced here.
 */
export async function GET() {
  try {
    const auth = await requireUserApi();
    if (auth.error) return auth.error;

    if (!process.env.AI33_API_KEY) {
      return NextResponse.json({ error: "AI33_API_KEY is not configured" }, { status: 500 });
    }

    const { data: owned, error: ownedError } = await supabaseAdmin
      .from("dictionary_owners")
      .select("dictionary_id")
      .eq("user_id", auth.user.id);
    if (ownedError) {
      return NextResponse.json({ error: ownedError.message }, { status: 500 });
    }
    const ownedIds = new Set((owned || []).map((row) => row.dictionary_id));
    if (ownedIds.size === 0) {
      return NextResponse.json({ dictionaries: [] });
    }

    const ai33 = new AI33Client();
    const dictionaries = await ai33.listDictionaries();
    return NextResponse.json({
      dictionaries: dictionaries.filter((d) => ownedIds.has(d.id)),
    });
  } catch (error: any) {
    console.error("[api/dictionaries GET]", error);
    return NextResponse.json({ error: ai33UserMessage(error) }, { status: 502 });
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireUserApi();
    if (auth.error) return auth.error;

    if (!process.env.AI33_API_KEY) {
      return NextResponse.json({ error: "AI33_API_KEY is not configured" }, { status: 500 });
    }

    const body = await req.json().catch(() => ({}));
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const rules = Array.isArray(body.rules) ? body.rules : [];
    if (!name) {
      return NextResponse.json({ error: "Adj meg egy nevet a szótárnak." }, { status: 400 });
    }
    if (rules.length === 0) {
      return NextResponse.json({ error: "Legalább egy szabály szükséges." }, { status: 400 });
    }

    const ai33 = new AI33Client();
    const dictionary = await ai33.createDictionary({ name, rules });

    const { error: ownerError } = await supabaseAdmin
      .from("dictionary_owners")
      .insert({ dictionary_id: dictionary.id, user_id: auth.user.id });
    if (ownerError) {
      // Don't leave an AI33-side dictionary that nobody in Lumen can manage.
      await ai33.deleteDictionary(dictionary.id).catch(() => {});
      console.error("[api/dictionaries POST] owner insert failed, rolled back", ownerError);
      return NextResponse.json({ error: "Létrehozás sikertelen (tulajdonos-hozzárendelés)." }, { status: 500 });
    }

    return NextResponse.json({ dictionary });
  } catch (error: any) {
    console.error("[api/dictionaries POST]", error);
    return NextResponse.json({ error: ai33UserMessage(error) }, { status: 502 });
  }
}
