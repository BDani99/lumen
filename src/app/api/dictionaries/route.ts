import { NextResponse } from "next/server";
import { AI33Client, ai33UserMessage } from "@/lib/ai33";
import { requireUserApi } from "@/lib/auth";

/** List / create AI33 pronunciation dictionaries (account-level, shared across channels). */
export async function GET() {
  try {
    const auth = await requireUserApi();
    if (auth.error) return auth.error;

    if (!process.env.AI33_API_KEY) {
      return NextResponse.json({ error: "AI33_API_KEY is not configured" }, { status: 500 });
    }

    const ai33 = new AI33Client();
    const dictionaries = await ai33.listDictionaries();
    return NextResponse.json({ dictionaries });
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
    return NextResponse.json({ dictionary });
  } catch (error: any) {
    console.error("[api/dictionaries POST]", error);
    return NextResponse.json({ error: ai33UserMessage(error) }, { status: 502 });
  }
}
