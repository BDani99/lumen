import { NextResponse } from "next/server";
import { AI33Client, clampTtsSpeed, type AI33VoiceProvider } from "@/lib/ai33";
import { ai33NotConfigured, ai33RouteError } from "@/lib/ai33-response";
import { apiError } from "@/lib/api-response";
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

    if (!process.env.AI33_API_KEY) return ai33NotConfigured("api/voices/preview POST");

    const rateLimit = await checkRateLimit({
      userId: auth.user.id,
      routeKey: "voices:preview",
      limit: 30,
      windowSeconds: 3600,
    });
    if (!rateLimit.allowed) return rateLimitResponse(rateLimit.retryAfterSeconds);

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return apiError("Érvénytelen kérés.", 400);
    }
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
      return apiError("Adj meg egy rövid szöveget.", 400);
    }
    if (text.length > MAX_CHARS) {
      return apiError(`A szöveg max. ${MAX_CHARS} karakter lehet.`, 400);
    }

    const voiceId = resolveVoiceId(voiceIdRaw, provider);
    if (!voiceId) {
      return apiError("Válassz vagy adj meg egy Voice ID-t.", 400);
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
      return apiError("Nem indult el a hanggenerálás.", 502, { code: "upstream_error" });
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
      // error_message is raw provider text — log it, never send it to the browser.
      console.error("[api/voices/preview POST] task failed:", status.error_message);
      return apiError("A hanggenerálás sikertelen. Próbáld újra, vagy válassz másik hangot.", 502, {
        code: "upstream_error",
      });
    }
    if (status.status !== "done") {
      return apiError("Időtúllépés — próbáld újra rövidebb szöveggel.", 504, { code: "timeout" });
    }

    const audioUrl = status.metadata?.audio_url as string | undefined;
    if (!audioUrl) {
      return apiError("A hangszolgáltatás nem adott vissza hangfájlt. Próbáld újra.", 502, {
        code: "upstream_error",
      });
    }

    return NextResponse.json({
      success: true,
      audioUrl,
      voiceId,
      durationHintMs: INITIAL_WAIT_MS + polls * POLL_INTERVAL_MS,
    });
  } catch (err) {
    // ai33UserMessage already has Hungarian text for the "server_busy" case.
    return ai33RouteError(err, "api/voices/preview POST", {
      fallback: "Nem sikerült elkészíteni a hangmintát.",
    });
  }
}
