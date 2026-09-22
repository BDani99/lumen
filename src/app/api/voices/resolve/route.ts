import { NextResponse } from "next/server";
import { AI33Client, ai33UserMessage, type AI33VoiceProvider } from "@/lib/ai33";
import { requireUserApi } from "@/lib/auth";

const ALLOWED = new Set<AI33VoiceProvider>(["elevenlabs", "minimax", "fishaudio"]);

/** Resolve human-readable voice name from a voice_id. */
export async function GET(req: Request) {
  try {
    const auth = await requireUserApi();
    if (auth.error) return auth.error;

    if (!process.env.AI33_API_KEY) {
      return NextResponse.json({ error: "AI33_API_KEY is not configured" }, { status: 500 });
    }

    const { searchParams } = new URL(req.url);
    const voiceId = searchParams.get("voiceId") || searchParams.get("voice_id") || "";
    const providerParam = searchParams.get("provider") as AI33VoiceProvider | null;
    const provider =
      providerParam && ALLOWED.has(providerParam) ? providerParam : undefined;

    if (!voiceId.trim()) {
      return NextResponse.json({ error: "Missing voiceId" }, { status: 400 });
    }

    const ai33 = new AI33Client();
    const voice = await ai33.resolveVoice(voiceId.trim(), provider);

    if (!voice) {
      return NextResponse.json({ voice: null });
    }

    return NextResponse.json({ voice });
  } catch (error: any) {
    console.error("[api/voices/resolve]", error);
    return NextResponse.json({ error: ai33UserMessage(error) }, { status: 502 });
  }
}
