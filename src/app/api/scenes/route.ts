import { NextResponse } from "next/server";
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
  const { data: scene } = await supabaseAdmin
    .from("video_scenes")
    .select("*")
    .eq("id", sceneId)
    .maybeSingle();
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

    const { sceneId, prompt } = await req.json();

    if (!sceneId || !prompt) {
      return NextResponse.json({ error: "Missing sceneId or prompt" }, { status: 400 });
    }

    const scene = await requireSceneOwned(sceneId, auth.user.id);
    if (!scene) {
      return forbidden("Scene not found or not owned");
    }

    let rawModel = "gpt-image-2 low";
    if (scene.project_id) {
      const { data: project } = await supabaseAdmin
        .from("video_projects")
        .select("channel_id")
        .eq("id", scene.project_id)
        .single();

      if (project?.channel_id) {
        const { data: channel } = await supabaseAdmin
          .from("channels")
          .select("image_model")
          .eq("id", project.channel_id)
          .single();

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

      if (generatedUrl || b64Json) {
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
          throw new Error("R2 is not configured — scene images require R2_* env");
        }
        const order = Number(scene.scene_order) || 0;
        imageUrl = await uploadImageToR2({
          key: sceneImageKey(scene.project_id, order),
          body: buffer,
        });
      }
    } catch (e: any) {
      console.error("Image gen error:", e);
      return NextResponse.json(
        { error: "Failed to generate image: " + (e.message || JSON.stringify(e)) },
        { status: 500 }
      );
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
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, scene: updatedScene });
  } catch (err: any) {
    console.error("[api/scenes POST]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const auth = await requireUserApi();
    if (auth.error) return auth.error;

    const { sceneId, update } = await req.json();

    if (!sceneId || !update) {
      return NextResponse.json({ error: "Missing sceneId or update data" }, { status: 400 });
    }

    const scene = await requireSceneOwned(sceneId, auth.user.id);
    if (!scene) {
      return forbidden("Scene not found or not owned");
    }

    const safeUpdate = pickAllowedSceneUpdate(update);
    if (Object.keys(safeUpdate).length === 0) {
      return NextResponse.json({ error: "No updatable fields in update data" }, { status: 400 });
    }

    const { data: updatedScene, error } = await supabaseAdmin
      .from("video_scenes")
      .update(safeUpdate)
      .eq("id", sceneId)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: "Update failed: " + error.message }, { status: 500 });
    }

    return NextResponse.json(updatedScene);
  } catch (err: any) {
    console.error("[api/scenes PATCH]", err);
    return NextResponse.json({ error: err?.message || "Internal server error" }, { status: 500 });
  }
}
