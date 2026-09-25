import { NextResponse } from "next/server";
import { AI33Client, type AI33VoiceProvider } from "@/lib/ai33";
import { ai33NotConfigured, ai33RouteError } from "@/lib/ai33-response";
import { apiError } from "@/lib/api-response";
import { requireUserApi } from "@/lib/auth";

const ALLOWED = new Set<AI33VoiceProvider>(["elevenlabs", "minimax", "fishaudio"]);

/** Resolve human-readable voice name from a voice_id. */
export async function GET(req: Request) {
  try {
    const auth = await requireUserApi();
    if (auth.error) return auth.error;

    if (!process.env.AI33_API_KEY) return ai33NotConfigured("api/voices/resolve GET");

    const { searchParams } = new URL(req.url);
    const voiceId = searchParams.get("voiceId") || searchParams.get("voice_id") || "";
    const providerParam = searchParams.get("provider") as AI33VoiceProvider | null;
    const provider =
      providerParam && ALLOWED.has(providerParam) ? providerParam : undefined;

    if (!voiceId.trim()) {
      return apiError("Hiányzik a hang azonosítója.", 400);
    }

    const ai33 = new AI33Client();
    const voice = await ai33.resolveVoice(voiceId.trim(), provider);

    if (!voice) {
      return NextResponse.json({ voice: null });
    }

    return NextResponse.json({ voice });
  } catch (err) {
    return ai33RouteError(err, "api/voices/resolve GET", {
      fallback: "Nem sikerült feloldani a hang nevét.",
    });
  }
}
