import { NextResponse } from "next/server";
import { AI33Client } from "@/lib/ai33";
import { ai33NotConfigured, ai33RouteError } from "@/lib/ai33-response";
import { requireUserApi } from "@/lib/auth";

/**
 * AI33 availability + per-provider health status. AI33 is a single shared
 * operator account (one API key for the whole app) — the numeric credit
 * balance is the operator's private billing info, not something every
 * authenticated user should see, so only a boolean "available" is exposed.
 */
export async function GET() {
  try {
    const auth = await requireUserApi();
    if (auth.error) return auth.error;

    if (!process.env.AI33_API_KEY) return ai33NotConfigured("api/ai33/status GET");

    const ai33 = new AI33Client();
    const [credits, health] = await Promise.all([
      ai33.getCredits().catch((err) => {
        console.warn("[api/ai33/status] getCredits failed:", err);
        return null;
      }),
      ai33.healthCheck().catch((err) => {
        console.warn("[api/ai33/status] healthCheck failed:", err);
        return {};
      }),
    ]);

    return NextResponse.json({ available: typeof credits === "number" && credits > 0, health });
  } catch (err) {
    return ai33RouteError(err, "api/ai33/status GET", {
      fallback: "Nem sikerült lekérdezni a hangszolgáltatás állapotát.",
    });
  }
}
