import { NextResponse } from "next/server";
import { AI33Client } from "@/lib/ai33";
import { ai33NotConfigured, ai33RouteError } from "@/lib/ai33-response";
import { apiError, routeError } from "@/lib/api-response";
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

    if (!process.env.AI33_API_KEY) return ai33NotConfigured("api/dictionaries GET");

    const { data: owned, error: ownedError } = await supabaseAdmin
      .from("dictionary_owners")
      .select("dictionary_id")
      .eq("user_id", auth.user.id);
    if (ownedError) throw ownedError;
    const ownedIds = new Set((owned || []).map((row) => row.dictionary_id));
    if (ownedIds.size === 0) {
      return NextResponse.json({ dictionaries: [] });
    }

    const ai33 = new AI33Client();
    const dictionaries = await ai33.listDictionaries();
    return NextResponse.json({
      dictionaries: dictionaries.filter((d) => ownedIds.has(d.id)),
    });
  } catch (err) {
    return ai33RouteError(err, "api/dictionaries GET", {
      fallback: "Nem sikerült betölteni a szótárakat.",
    });
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireUserApi();
    if (auth.error) return auth.error;

    if (!process.env.AI33_API_KEY) return ai33NotConfigured("api/dictionaries POST");

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return apiError("Érvénytelen kérés.", 400);
    }
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const rules = Array.isArray(body.rules) ? body.rules : [];
    if (!name) {
      return apiError("Adj meg egy nevet a szótárnak.", 400);
    }
    if (rules.length === 0) {
      return apiError("Legalább egy szabály szükséges.", 400);
    }

    const ai33 = new AI33Client();
    const dictionary = await ai33.createDictionary({ name, rules });

    const { error: ownerError } = await supabaseAdmin
      .from("dictionary_owners")
      .insert({ dictionary_id: dictionary.id, user_id: auth.user.id });
    if (ownerError) {
      // Don't leave an AI33-side dictionary that nobody in Lumen can manage.
      await ai33.deleteDictionary(dictionary.id).catch(() => {});
      return routeError(ownerError, "api/dictionaries POST (owner insert, rolled back)", {
        fallback: "Nem sikerült létrehozni a szótárat. Próbáld újra.",
      });
    }

    return NextResponse.json({ dictionary });
  } catch (err) {
    return ai33RouteError(err, "api/dictionaries POST", {
      fallback: "Nem sikerült létrehozni a szótárat.",
    });
  }
}
