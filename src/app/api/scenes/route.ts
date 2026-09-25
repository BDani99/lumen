import { NextResponse } from "next/server";
import { apiError, routeError } from "@/lib/api-response";
import { isOpenRouterCreditsError, isRateLimitError } from "@/lib/inngest/generate-scene";
import { supabaseAdmin } from "@/lib/supabase";
import { openai, openrouter } from "@/lib/openai";
import { cropTo16x9 } from "@/lib/image-processing";
import {
  assertProjectOwned,
  forbidden,
  requireUserApi,
} from "@/lib/auth";
import { isR2Configured, sceneImageKey, uploadImageToR2 } from "@/lib/r2";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

/** Columns the client is allowed to write via PATCH /api/scenes — everything
 * else on video_scenes (project_id, scene_order, timestamps, ...) must not be
 * settable by a client-supplied `update` object. */
const UPDATABLE_SCENE_FIELDS = ["image_url", "video_url", "image_prompt", "effect"] as const;

function pickAllowedSceneUpdate(update: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of UPDATABLE_SCENE_FIELDS) {
    if (key in update) out[key] = update[key];
  }
  return out;
}

async function requireSceneOwned(sceneId: string, userId: string) {
  const { data: scene, error } = await supabaseAdmin
    .from("video_scenes")
    .select("*")
    .eq("id", sceneId)
    .maybeSingle();
  if (error) throw error;
  if (!scene?.project_id) return null;
  if (!(await assertProjectOwned(scene.project_id, userId))) return null;
  return scene;
}

export async function POST(req: Request) {
  try {
    const auth = await requireUserApi();
    if (auth.error) return auth.error;

    const rateLimit = await checkRateLimit({
      userId: auth.user.id,
      routeKey: "scenes:image",
      limit: 60,
      windowSeconds: 3600,
    });
    if (!rateLimit.allowed) return rateLimitResponse(rateLimit.retryAfterSeconds);

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return apiError("Érvénytelen kérés.", 400);
    }
    const { sceneId, prompt } = body;

    if (typeof sceneId !== "string" || !sceneId || typeof prompt !== "string" || !prompt.trim()) {
      return apiError("Hiányzik a jelenet vagy a képleírás (prompt).", 400);
    }

    const scene = await requireSceneOwned(sceneId, auth.user.id);
    if (!scene) {
      return forbidden("A jelenet nem található, vagy nincs hozzáférésed.");
    }

    let rawModel = "gpt-image-2 low";
    if (scene.project_id) {
      const { data: project, error: projectError } = await supabaseAdmin
        .from("video_projects")
        .select("channel_id")
        .eq("id", scene.project_id)
        .single();
      if (projectError) throw projectError;

      if (project?.channel_id) {
        const { data: channel, error: channelError } = await supabaseAdmin
          .from("channels")
          .select("image_model")
          .eq("id", project.channel_id)
          .single();
        if (channelError) throw channelError;

        if (channel?.image_model) {
          rawModel = channel.image_model;
        }
      }
    }

    const [modelName, qualityParam] = rawModel.split(" ");
    const imageQuality =
      qualityParam === "low" || qualityParam === "standard" || qualityParam === "hd"
        ? qualityParam
        : undefined;

    let imageUrl = "";
    try {
      const client = modelName.includes("/") ? openrouter : openai;
      const imageApiPayload = {
        model: modelName,
        prompt: prompt,
        n: 1,
        size: "1792x1024" as any,
        ...(imageQuality ? { quality: imageQuality as any } : {}),
      };

      let imgResponse: any;
      let retryCount = 0;
      while (retryCount < 3) {
        try {
          imgResponse = await client.images.generate(imageApiPayload as any);
          break;
        } catch (err: any) {
          retryCount++;
          if (retryCount >= 3) throw err;
          let waitTime = 15000;
          if (err.message && err.message.includes("Please try again in")) {
            const match = err.message.match(/in (\d+)s/);
            if (match) waitTime = (parseInt(match[1]) + 2) * 1000;
          }
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        }
      }

      const generatedUrl = imgResponse.data?.[0]?.url || "";
      const b64Json = (imgResponse.data?.[0] as any)?.b64_json || "";

      if (!generatedUrl && !b64Json) {
        console.error("[api/scenes POST] provider returned no image", imgResponse);
        return apiError("Az AI szolgáltatás nem adott vissza képet. Próbáld újra.", 502, {
          code: "upstream_empty",
        });
      }

      let buffer: Buffer;
      if (b64Json) {
        buffer = Buffer.from(b64Json, "base64");
      } else {
        const imgRes = await fetch(generatedUrl);
        const arrayBuffer = await imgRes.arrayBuffer();
        buffer = Buffer.from(arrayBuffer);
      }

      buffer = await cropTo16x9(buffer);

      if (!isR2Configured()) {
        console.error("[api/scenes POST] R2 is not configured (R2_* env missing)");
        return apiError(
          "A médiatárhely nincs beállítva, ezért a kép nem menthető. Jelezd az üzemeltetőnek.",
          503,
          { code: "config" }
        );
      }
      const order = Number(scene.scene_order) || 0;
      imageUrl = await uploadImageToR2({
        key: sceneImageKey(scene.project_id, order),
        body: buffer,
      });
    } catch (e) {
      // Never echo the provider's message — map the known cases, log the rest.
      if (isOpenRouterCreditsError(e)) {
        console.error("[api/scenes POST] OpenRouter credits exhausted", e);
        return apiError("Az AI szolgáltatás egyenlege elfogyott. Jelezd az üzemeltetőnek.", 503, {
          code: "ai_credits",
        });
      }
      if (isRateLimitError(e)) {
        console.error("[api/scenes POST] provider rate limit", e);
        return apiError(
          "Az AI szolgáltatás jelenleg túlterhelt. Próbáld újra egy perc múlva.",
          429,
          { code: "rate_limited" }
        );
      }
      return routeError(e, "api/scenes POST (image generation)", {
        fallback: "Nem sikerült képet generálni ehhez a jelenethez.",
      });
    }

    const { data: updatedScene, error: updateError } = await supabaseAdmin
      .from("video_scenes")
      .update({
        image_prompt: prompt,
        image_url: imageUrl,
      })
      .eq("id", sceneId)
      .select()
      .single();

    if (updateError) {
      return routeError(updateError, "api/scenes POST (db update)", {
        fallback: "A kép elkészült, de nem sikerült elmenteni a jelenethez.",
      });
    }

    return NextResponse.json({ success: true, scene: updatedScene });
  } catch (err) {
    return routeError(err, "api/scenes POST", {
      fallback: "Nem sikerült képet generálni ehhez a jelenethez.",
    });
  }
}

export async function PATCH(req: Request) {
  try {
    const auth = await requireUserApi();
    if (auth.error) return auth.error;

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return apiError("Érvénytelen kérés.", 400);
    }
    const { sceneId, update } = body;

    if (
      typeof sceneId !== "string" ||
      !sceneId ||
      !update ||
      typeof update !== "object" ||
      Array.isArray(update)
    ) {
      return apiError("Hiányzik a jelenet vagy a módosítandó adat.", 400);
    }

    const scene = await requireSceneOwned(sceneId, auth.user.id);
    if (!scene) {
      return forbidden("A jelenet nem található, vagy nincs hozzáférésed.");
    }

    const safeUpdate = pickAllowedSceneUpdate(update);
    if (Object.keys(safeUpdate).length === 0) {
      return apiError("A kérés nem tartalmaz módosítható mezőt.", 400);
    }

    const { data: updatedScene, error } = await supabaseAdmin
      .from("video_scenes")
      .update(safeUpdate)
      .eq("id", sceneId)
      .select()
      .single();

    if (error) {
      return routeError(error, "api/scenes PATCH", {
        fallback: "Nem sikerült menteni a jelenet módosítását.",
      });
    }

    return NextResponse.json(updatedScene);
  } catch (err) {
    return routeError(err, "api/scenes PATCH", {
      fallback: "Nem sikerült menteni a jelenet módosítását.",
    });
  }
}
