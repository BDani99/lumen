/**
 * Wan (and other) video generation via OpenRouter — same billing/API key as Qwen.
 * Docs: POST https://openrouter.ai/api/v1/videos + poll polling_url
 * Download: unsigned_urls / content endpoint require Bearer when URL is openrouter.ai
 */

const OPENROUTER_VIDEOS = "https://openrouter.ai/api/v1/videos";

export type OpenRouterVideoResult = {
  videoUrl: string;
  jobId: string;
};

function apiKey(): string {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) throw new Error("OPENROUTER_API_KEY missing — required for Wan video");
  return key;
}

function headers(): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey()}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://lumen.vercel.app",
    "X-Title": "Lumen Studio",
  };
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

function needsOpenRouterAuth(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === "openrouter.ai" && u.pathname.startsWith("/api/");
  } catch {
    return url.includes("openrouter.ai/api/");
  }
}

/**
 * Download completed OpenRouter video bytes.
 * Content URLs require Authorization; third-party URLs do not.
 */
export async function downloadOpenRouterVideoBytes(
  jobId: string,
  unsignedUrl?: string | null
): Promise<Buffer> {
  const downloadUrl =
    (unsignedUrl && String(unsignedUrl).trim()) ||
    `${OPENROUTER_VIDEOS}/${jobId}/content?index=0`;

  const res = await fetch(downloadUrl, {
    headers: needsOpenRouterAuth(downloadUrl)
      ? { Authorization: `Bearer ${apiKey()}` }
      : undefined,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `OpenRouter video download failed (${res.status}): ${body.slice(0, 300) || res.statusText}`
    );
  }
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Generate a video with OpenRouter Wan (or other video model).
 * - text_to_video: prompt only
 * - image_to_video: prompt + first-frame image_url
 * Returns job id + URL; call downloadOpenRouterVideoBytes to get mp4 bytes.
 */
export async function generateOpenRouterVideo(params: {
  model: string;
  prompt: string;
  strategy: "text_to_video" | "image_to_video";
  imageUrl?: string;
  aspectRatio?: string;
  resolution?: string;
  duration?: number;
  pollIntervalMs?: number;
  maxPolls?: number;
}): Promise<OpenRouterVideoResult> {
  const body: Record<string, unknown> = {
    model: params.model,
    prompt: params.prompt,
    aspect_ratio: params.aspectRatio || "16:9",
    resolution: params.resolution || "720p",
  };
  if (params.duration) body.duration = params.duration;

  if (params.strategy === "image_to_video") {
    if (!params.imageUrl?.trim()) {
      throw new Error("image_to_video requires imageUrl");
    }
    body.frame_images = [
      {
        type: "image_url",
        image_url: { url: params.imageUrl },
        frame_type: "first_frame",
      },
    ];
  }

  const submit = await fetch(OPENROUTER_VIDEOS, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  const submitJson = await submit.json().catch(() => ({}));
  if (!submit.ok) {
    throw new Error(
      `OpenRouter video submit failed (${submit.status}): ${JSON.stringify(submitJson)}`
    );
  }

  const jobId = String(submitJson.id || "");
  const pollingUrl = String(submitJson.polling_url || "");
  if (!jobId && !pollingUrl) {
    throw new Error(`OpenRouter video: missing job id/polling_url: ${JSON.stringify(submitJson)}`);
  }

  const pollUrl = pollingUrl || `${OPENROUTER_VIDEOS}/${jobId}`;
  const interval = params.pollIntervalMs ?? 10_000;
  const maxPolls = params.maxPolls ?? 36; // ~6 min

  for (let i = 0; i < maxPolls; i++) {
    await sleep(interval);
    const poll = await fetch(pollUrl, { headers: headers() });
    const status = await poll.json().catch(() => ({}));
    if (!poll.ok) {
      throw new Error(
        `OpenRouter video poll failed (${poll.status}): ${JSON.stringify(status)}`
      );
    }
    const st = String(status.status || "");
    if (st === "completed") {
      const urls: string[] = Array.isArray(status.unsigned_urls)
        ? status.unsigned_urls.map(String)
        : [];
      const resolvedJobId = jobId || String(status.id || "");
      const videoUrl =
        urls[0] ||
        (resolvedJobId ? `${OPENROUTER_VIDEOS}/${resolvedJobId}/content?index=0` : "");
      if (!videoUrl) {
        throw new Error(
          `OpenRouter video completed but no unsigned_urls/job id: ${JSON.stringify(status)}`
        );
      }
      return { videoUrl, jobId: resolvedJobId };
    }
    if (st === "failed" || st === "cancelled" || st === "canceled") {
      throw new Error(
        `OpenRouter video ${st}: ${status.error || status.message || JSON.stringify(status)}`
      );
    }
  }

  throw new Error(`OpenRouter video timed out after ${maxPolls} polls (job ${jobId})`);
}
