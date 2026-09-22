import { NextResponse } from "next/server";
import { AI33Client, ai33UserMessage, clampTtsSpeed, type AI33VoiceProvider } from "@/lib/ai33";
import { requireUserApi } from "@/lib/auth";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const maxDuration = 120;

const MAX_CHARS = 500;
/** Slower polling avoids AI33 `server_busy` on /v1/task */
const POLL_INTERVAL_MS = 2500;
const INITIAL_WAIT_MS = 2000;
const MAX_POLLS = 48; // ~2 min with 2.5s interval (+ initial wait)
const KNOWN_PREFIXES = [
  "elevenlabs_",
  "minimax_",
  "fishaudio_",
  "clone_",
  "edge_",
  "kokoro_",
  "vbee_",
];

function resolveProvider(provider?: string): AI33VoiceProvider | undefined {
  if (!provider) return undefined;
  if (provider === "fish" || provider === "fishaudio") return "fishaudio";
  if (provider === "minimax") return "minimax";
  if (provider === "elevenlabs") return "elevenlabs";
  return undefined;
}

function resolveVoiceId(voiceId: string, provider?: string): string {
  const trimmed = voiceId.trim();
  if (!trimmed) return "";
  if (KNOWN_PREFIXES.some((p) => trimmed.startsWith(p))) return trimmed;
  const p = provider === "fish" ? "fishaudio" : provider || "elevenlabs";
  return `${p}_${trimmed}`;
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

/** Generate a short TTS sample with the selected voice (playground). */
export async function POST(req: Request) {
  try {
    const auth = await requireUserApi();
    if (auth.error) return auth.error;

    if (!process.env.AI33_API_KEY) {
      return NextResponse.json({ error: "AI33_API_KEY is not configured" }, { status: 500 });
    }

    const rateLimit = await checkRateLimit({
      userId: auth.user.id,
      routeKey: "voices:preview",
      limit: 30,
      windowSeconds: 3600,
    });
    if (!rateLimit.allowed) return rateLimitResponse(rateLimit.retryAfterSeconds);

    const body = await req.json();
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const voiceIdRaw = typeof body.voiceId === "string" ? body.voiceId : "";
    const provider = typeof body.provider === "string" ? body.provider : undefined;
    const modelId =
      typeof body.modelId === "string" && body.modelId.trim()
        ? body.modelId.trim()
        : undefined;
    const language =
      typeof body.language === "string" && body.language.trim()
        ? body.language.trim()
        : undefined;
    const pronunciationDictionaryId =
      typeof body.pronunciationDictionaryId === "string" && body.pronunciationDictionaryId.trim()
        ? body.pronunciationDictionaryId.trim()
        : undefined;
    const speed = clampTtsSpeed(Number(body.speed) || 1);

    if (!text) {
      return NextResponse.json({ error: "Adj meg egy rövid szöveget." }, { status: 400 });
    }
    if (text.length > MAX_CHARS) {
      return NextResponse.json(
        { error: `A szöveg max. ${MAX_CHARS} karakter lehet.` },
        { status: 400 }
      );
    }

    const voiceId = resolveVoiceId(voiceIdRaw, provider);
    if (!voiceId) {
      return NextResponse.json({ error: "Válassz vagy adj meg egy Voice ID-t." }, { status: 400 });
    }

    const ai33 = new AI33Client();
    const started = await ai33.generateTTSv3(text, voiceId, speed, {
      modelId,
      language,
      provider: resolveProvider(provider),
      pronunciationDictionaryId,
    });
    const taskId = started.task_id || started.id;
    if (!taskId) {
      return NextResponse.json({ error: "Nem indult el a hanggenerálás." }, { status: 502 });
    }

    // Give the task a moment before first status check (avoids immediate busy)
    await sleep(INITIAL_WAIT_MS);

    let status = await ai33.getTaskStatus(taskId);
    let polls = 0;
    while (status.status !== "done" && status.status !== "failed" && polls < MAX_POLLS) {
      await sleep(POLL_INTERVAL_MS);
      status = await ai33.getTaskStatus(taskId);
      polls++;
    }

    if (status.status === "failed") {
      return NextResponse.json(
        { error: status.error_message || "Hanggenerálás sikertelen." },
        { status: 502 }
      );
    }
    if (status.status !== "done") {
      return NextResponse.json(
        { error: "Időtúllépés — próbáld újra rövidebb szöveggel." },
        { status: 504 }
      );
    }

    const audioUrl = status.metadata?.audio_url as string | undefined;
    if (!audioUrl) {
      return NextResponse.json({ error: "Nincs audio URL a válaszban." }, { status: 502 });
    }

    return NextResponse.json({
      success: true,
      audioUrl,
      voiceId,
      durationHintMs: INITIAL_WAIT_MS + polls * POLL_INTERVAL_MS,
    });
  } catch (error: any) {
    console.error("[api/voices/preview]", error);
    const msg = error?.message || "Hiba";
    const friendly = /server_busy|temporarily busy/i.test(msg)
      ? "Az AI33 átmenetileg foglalt a státuszlekérdezésnél. Várj pár másodpercet, majd próbáld újra."
      : ai33UserMessage(error);
    return NextResponse.json({ error: friendly }, { status: 502 });
  }
}
