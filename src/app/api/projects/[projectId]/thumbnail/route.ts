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
import { isR2Configured, thumbnailImageKey, uploadImageToR2 } from "@/lib/r2";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const auth = await requireUserApi();
    if (auth.error) return auth.error;

    const resolvedParams = await params;
    const projectId = resolvedParams.projectId;

    if (!(await assertProjectOwned(projectId, auth.user.id))) {
      return forbidden("A projekt nem található, vagy nincs hozzáférésed.");
    }

    const rateLimit = await checkRateLimit({
      userId: auth.user.id,
      routeKey: "thumbnail:create",
      limit: 20,
      windowSeconds: 3600,
    });
    if (!rateLimit.allowed) return rateLimitResponse(rateLimit.retryAfterSeconds);

    // 1. Fetch project and channel settings
    const { data: project, error: projectError } = await supabaseAdmin
      .from("video_projects")
      .select("*, channels(*)")
      .eq("id", projectId)
      .single();

    if (projectError && projectError.code !== "PGRST116") {
      return routeError(projectError, "api/projects/[projectId]/thumbnail POST", {
        fallback: "Nem sikerült betölteni a projektet.",
      });
    }
    if (!project) {
      return apiError("A projekt nem található.", 404);
    }

    const channel = project.channels;
    if (!channel?.thumbnail_prompt) {
      return apiError("A csatornához nincs borítókép-prompt beállítva.", 400);
    }

    // 2. Generate Image
    const rawModel = channel.image_model || "gpt-image-2 low";
    const [modelName, qualityParam] = rawModel.split(" ");
    const imageQuality = (qualityParam === "low" || qualityParam === "standard" || qualityParam === "hd") ? qualityParam : undefined;

    const characterGlossary = project.timeline_data?.characterGlossary || {};
    const useGlossary = channel.use_character_glossary_for_thumbnails ?? true;
    const glossaryContext = (useGlossary && Object.keys(characterGlossary).length > 0) ? ` Character details: ${JSON.stringify(characterGlossary)}.` : "";
    const thumbnailPrompt = `Create a YouTube thumbnail. Topic: ${project.title}.${glossaryContext} Style/Instructions: ${channel.thumbnail_prompt}`;
    
    const client = modelName.includes('/') ? openrouter : openai;
    const imageApiPayload = {
      model: modelName,
      prompt: thumbnailPrompt,
      n: 1,
      size: "1792x1024" as any,
      ...(imageQuality ? { quality: imageQuality as any } : {})
    };
    
    let imgRes: any;
    let retryCount = 0;
    while (retryCount < 3) {
      try {
        imgRes = await client.images.generate(imageApiPayload as any);
        break;
      } catch (err: any) {
        retryCount++;
        console.warn(`[API] Thumbnail generation failed on attempt ${retryCount}:`, err.message);
        if (retryCount >= 3) throw err;
        
        let waitTime = 15000;
        if (err.message && err.message.includes('Please try again in')) {
          const match = err.message.match(/in (\d+)s/);
          if (match) waitTime = (parseInt(match[1]) + 2) * 1000;
        }
        logger.debug(`[API] Waiting ${waitTime/1000}s before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    let generatedUrl = imgRes.data?.[0]?.url || "";
    let b64Json = (imgRes.data?.[0] as any)?.b64_json || "";
    
    if (!generatedUrl && !b64Json) {
      console.error("[api/projects/[projectId]/thumbnail POST] provider returned no image", imgRes);
      return apiError("Az AI szolgáltatás nem adott vissza képet. Próbáld újra.", 502, {
        code: "upstream_empty",
      });
    }

    // 3. Process and Upload to Supabase
    let buffer: Buffer;
    if (b64Json) {
      buffer = Buffer.from(b64Json, 'base64');
    } else {
      const fetchRes = await fetch(generatedUrl);
      const arrayBuffer = await fetchRes.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    }

    buffer = await cropTo16x9(buffer);

    if (!isR2Configured()) {
      console.error("[api/projects/[projectId]/thumbnail POST] R2 is not configured (R2_* env missing)");
      return apiError(
        "A médiatárhely nincs beállítva, ezért a borítókép nem menthető. Jelezd az üzemeltetőnek.",
        503,
        { code: "config" }
      );
    }

    let newThumbnailUrl: string;
    try {
      newThumbnailUrl = await uploadImageToR2({
        key: thumbnailImageKey(projectId),
        body: buffer,
      });
    } catch (uploadError) {
      return routeError(uploadError, "api/projects/[projectId]/thumbnail POST (R2 upload)", {
        fallback: "Nem sikerült feltölteni a borítóképet.",
      });
    }

    // 4. Update Database (keep history in timeline_data)
    const existingTimelineData = project.timeline_data || {};
    const existingThumbnails = existingTimelineData.thumbnails || [];
    
    // Add the CURRENT thumbnail_url to history if it exists and isn't already in history
    if (project.thumbnail_url && !existingThumbnails.includes(project.thumbnail_url)) {
      existingThumbnails.push(project.thumbnail_url);
    }

    const updatedTimelineData = {
      ...existingTimelineData,
      thumbnails: existingThumbnails
    };

    const { error: updateError } = await supabaseAdmin
      .from("video_projects")
      .update({
        thumbnail_url: newThumbnailUrl,
        timeline_data: updatedTimelineData
      })
      .eq("id", projectId);

    if (updateError) {
      return routeError(updateError, "api/projects/[projectId]/thumbnail POST (db update)", {
        fallback: "A borítókép elkészült, de nem sikerült elmenteni.",
      });
    }

    return NextResponse.json({ success: true, thumbnail_url: newThumbnailUrl, timeline_data: updatedTimelineData });

  } catch (error) {
    // Never echo the provider's message — map the known cases, log the rest.
    if (isOpenRouterCreditsError(error)) {
      console.error("[api/projects/[projectId]/thumbnail POST] OpenRouter credits exhausted", error);
      return apiError("Az AI szolgáltatás egyenlege elfogyott. Jelezd az üzemeltetőnek.", 503, {
        code: "ai_credits",
      });
    }
    if (isRateLimitError(error)) {
      console.error("[api/projects/[projectId]/thumbnail POST] provider rate limit", error);
      return apiError(
        "Az AI szolgáltatás jelenleg túlterhelt. Próbáld újra egy perc múlva.",
        429,
        { code: "rate_limited" }
      );
    }
    return routeError(error, "api/projects/[projectId]/thumbnail POST", {
      fallback: "Nem sikerült elkészíteni a borítóképet.",
    });
  }
}
