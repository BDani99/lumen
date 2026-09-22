import { NextResponse } from "next/server";
import { AI33Client, ai33UserMessage } from "@/lib/ai33";
import { requireUserApi } from "@/lib/auth";

/** Preview a rule set against sample text without saving anything. */
export async function POST(req: Request) {
  try {
    const auth = await requireUserApi();
    if (auth.error) return auth.error;

    if (!process.env.AI33_API_KEY) {
      return NextResponse.json({ error: "AI33_API_KEY is not configured" }, { status: 500 });
    }

    const body = await req.json().catch(() => ({}));
    const text = typeof body.text === "string" ? body.text : "";
    const rules = Array.isArray(body.rules) ? body.rules : [];
    if (!text.trim()) {
      return NextResponse.json({ error: "Adj meg egy mintaszöveget." }, { status: 400 });
    }

    const ai33 = new AI33Client();
    const result = await ai33.previewDictionary({ text, rules });
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[api/dictionaries/preview]", error);
    return NextResponse.json({ error: ai33UserMessage(error) }, { status: 502 });
  }
}
