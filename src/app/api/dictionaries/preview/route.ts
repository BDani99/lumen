import { NextResponse } from "next/server";
import { AI33Client } from "@/lib/ai33";
import { ai33NotConfigured, ai33RouteError } from "@/lib/ai33-response";
import { apiError } from "@/lib/api-response";
import { requireUserApi } from "@/lib/auth";

/** Preview a rule set against sample text without saving anything. */
export async function POST(req: Request) {
  try {
    const auth = await requireUserApi();
    if (auth.error) return auth.error;

    if (!process.env.AI33_API_KEY) return ai33NotConfigured("api/dictionaries/preview POST");

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return apiError("Érvénytelen kérés.", 400);
    }
    const text = typeof body.text === "string" ? body.text : "";
    const rules = Array.isArray(body.rules) ? body.rules : [];
    if (!text.trim()) {
      return apiError("Adj meg egy mintaszöveget.", 400);
    }

    const ai33 = new AI33Client();
    const result = await ai33.previewDictionary({ text, rules });
    return NextResponse.json(result);
  } catch (err) {
    return ai33RouteError(err, "api/dictionaries/preview POST", {
      fallback: "Nem sikerült az előnézet.",
    });
  }
}
