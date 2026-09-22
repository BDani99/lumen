import { NextResponse } from "next/server";
import { AI33Client, ai33UserMessage } from "@/lib/ai33";
import { requireUserApi } from "@/lib/auth";

/** Real-time AI33 account credit balance + per-provider health status. */
export async function GET() {
  try {
    const auth = await requireUserApi();
    if (auth.error) return auth.error;

    if (!process.env.AI33_API_KEY) {
      return NextResponse.json({ error: "AI33_API_KEY is not configured" }, { status: 500 });
    }

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

    return NextResponse.json({ credits, health });
  } catch (error: any) {
    console.error("[api/ai33/status]", error);
    return NextResponse.json({ error: ai33UserMessage(error) }, { status: 502 });
  }
}
