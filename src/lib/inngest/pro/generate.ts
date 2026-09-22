import { inngest } from "../client";
import { supabaseAdmin } from "../../supabase";
import { AI33Client } from "../../ai33";
import { appendGenerationLog } from "../../generation-log";
import { openai, openrouter } from "../../openai";
import { cropTo16x9 } from "../../image-processing";
import { postProcessVideoBuffer } from "../../video-processing";
import {
  downloadUrlToBuffer,
  isR2Configured,
  uploadImageToR2,
  uploadMp4ToR2,
  publicUrlForKey,
} from "../../r2";
import {
  downloadOpenRouterVideoBytes,
  generateOpenRouterVideo,
} from "../../wan/openrouter-client";
import {
  imageCostForModelOption,
  videoClipCost,
  voiceCostForChars,
} from "../../cost-estimate";
import { normalizeProSettings } from "../../pro/presets";
import { allocateShots } from "../../pro/cost";
import { parseSrtCues, planBeats, pickHeroBeats } from "../../pro/cadence";
import { assignSourceKinds, directBeats, kenBurnsFor } from "../../pro/director";
import { resolveFreeSource } from "../../pro/sources/resolve";
import type { ProShot, ProSourceKind } from "../../pro/types";

/**
 * The Pro generation workflow — entirely separate from `generateVideoWorkflow`
 * and `runAudioVisualPipeline`. It shares only stateless clients (AI33, R2,
 * OpenRouter) and pure helpers; no classic orchestration is called, so this
 * file can never change how the two classic modes behave.
 */

const ai33 = new AI33Client();
const getChatClient = (model: string) => (model.includes("/") ? openrouter : openai);

/** Keep each step comfortably under the 300s serverless ceiling. */
const DIRECTOR_BATCH = 25;
const ASSET_BATCH = 6;

function proAssetKey(projectId: string, shotIndex: number, ext: string): string {
  return `projects/${projectId}/pro/shot_${String(shotIndex + 1).padStart(4, "0")}.${ext}`;
}

function proImageKey(projectId: string, imageIndex: number): string {
  return `projects/${projectId}/pro/img_${String(imageIndex + 1).padStart(4, "0")}.png`;
}

async function generateProImage(params: {
  prompt: string;
  modelOption: string;
}): Promise<Buffer> {
  const [modelName, qualityParam] = params.modelOption.split(" ");
  const quality =
    qualityParam === "low" || qualityParam === "standard" || qualityParam === "hd"
      ? qualityParam
      : undefined;
  const client = modelName.includes("/") ? openrouter : openai;
  const res: any = await client.images.generate({
    model: modelName,
    prompt: params.prompt,
    n: 1,
    size: "1792x1024" as any,
    ...(quality ? { quality: quality as any } : {}),
  } as any);
  const b64 = res?.data?.[0]?.b64_json;
  const url = res?.data?.[0]?.url;
  if (b64) return Buffer.from(b64, "base64");
  if (url) return downloadUrlToBuffer(String(url));
  throw new Error("Image API returned neither b64_json nor url");
}

export const proGenerateWorkflow = inngest.createFunction(
  {
    id: "pro-generate-workflow",
    retries: 2,
    concurrency: [{ limit: 3 }],
    triggers: [{ event: "video/generate-pro" }],
    cancelOn: [{ event: "video/cancel", match: "data.projectId" }],
    onFailure: async ({ event }: any) => {
      const projectId = event?.data?.event?.data?.projectId;
      if (!projectId) return;
      await supabaseAdmin
        .from("video_projects")
        .update({ status: "Failed", updated_at: new Date().toISOString() })
        .eq("id", projectId)
        .neq("status", "Cancelled");
    },
  },
  async ({ event, step }) => {
    const { projectId } = event.data as { projectId: string };
    if (!projectId) return { skipped: true };

    // ---- 1. Load project + channel + settings -----------------------------
    const loaded = await step.run("pro-load-project", async () => {
      const { data: project, error } = await supabaseAdmin
        .from("video_projects")
        .select("*, channels(*)")
        .eq("id", projectId)
        .single();
      if (error || !project) throw new Error("Project not found");
      const channel = Array.isArray(project.channels) ? project.channels[0] : project.channels;
      if (!channel) throw new Error("Channel not found on project");
      if (!isR2Configured()) throw new Error("R2 is not configured — Pro mode requires R2_* env");

      const settings = normalizeProSettings(project.pro_settings);
      await appendGenerationLog(projectId, {
        level: "info",
        stage: "Draft",
        message: `Pro generálás indul (preset: ${settings.presetId}, keret: $${settings.budgetUsd}).`,
        meta: { presetId: settings.presetId, budgetUsd: settings.budgetUsd },
      });
      return {
        title: String(project.title || ""),
        channel,
        settings,
        script: String(project.generated_script || ""),
        durationMinutes: Number(project.timeline_data?.durationMinutes) || 5,
        glossary: (project.character_glossary || {}) as Record<string, string>,
      };
    });

    const settings = loaded.settings;

    // ---- 2. Script --------------------------------------------------------
    // Pro writes its own script when none was supplied. Deliberately its own
    // (simple, single-pass) orchestration rather than calling runScriptPhase.
    const script = await step.run("pro-script", async () => {
      if (loaded.script.trim()) return loaded.script.trim();

      const model =
        settings.textModel ||
        loaded.channel.text_model ||
        "qwen/qwen-2.5-72b-instruct";
      const words = Math.round(loaded.durationMinutes * 150);
      await supabaseAdmin
        .from("video_projects")
        .update({ status: "Script_Generation" })
        .eq("id", projectId);
      await appendGenerationLog(projectId, {
        level: "info",
        stage: "Script_Generation",
        message: `Pro forgatókönyv írása (${model}, cél ~${words} szó)…`,
      });

      const client = getChatClient(model);
      const res: any = await client.chat.completions.create({
        model,
        messages: [
          {
            role: "system",
            content:
              (loaded.channel.master_script_prompt ||
                "You are a professional scriptwriter.") +
              "\n\nWrite spoken narration only: no headings, no scene directions, no speaker labels, no stage notes.",
          },
          {
            role: "user",
            content: `Write a ${loaded.durationMinutes}-minute spoken narration (~${words} words) for a documentary-style YouTube video titled "${loaded.title}". Write in the same language as the title. Continuous prose, strong hook in the first two sentences.`,
          },
        ],
        max_tokens: Math.min(16000, Math.round(words * 3) + 1200),
        ...(model.includes("/") ? { reasoning: { enabled: false } } : {}),
      } as any);
      const text = String(res.choices?.[0]?.message?.content || "").trim();
      if (!text) throw new Error("Script generation returned empty text");
      await supabaseAdmin
        .from("video_projects")
        .update({ generated_script: text })
        .eq("id", projectId);
      return text;
    });

    // ---- 3. TTS -----------------------------------------------------------
    const audioTask = await step.run("pro-start-tts", async () => {
      await supabaseAdmin
        .from("video_projects")
        .update({ status: "Audio_Generation" })
        .eq("id", projectId);
      const vs = loaded.channel.ai33_voice_settings || {};
      let provider = vs.provider || "elevenlabs";
      if (provider === "fish") provider = "fishaudio";
      let voiceId = String(vs.voiceId || "").trim();
      if (!voiceId) throw new Error("Missing voiceId in channel.ai33_voice_settings");
      const knownPrefixes = ["elevenlabs_", "minimax_", "fishaudio_", "clone_", "edge_", "kokoro_", "vbee_"];
      if (!knownPrefixes.some((p) => voiceId.startsWith(p))) voiceId = `${provider}_${voiceId}`;

      await appendGenerationLog(projectId, {
        level: "info",
        stage: "Audio_Generation",
        message: `Pro hanggenerálás indítása (${voiceId})…`,
      });
      return ai33.generateTTSv3(script, voiceId, vs.speed ?? 1.0, {
        modelId: vs.modelId || undefined,
        language: vs.language || undefined,
        pronunciationDictionaryId: vs.pronunciationDictionaryId || undefined,
        provider:
          provider === "fishaudio" ? "fishaudio" : provider === "minimax" ? "minimax" : "elevenlabs",
      });
    });

    let taskStatus = await step.run("pro-poll-tts-0", () => ai33.getTaskStatus(audioTask.task_id));
    let poll = 0;
    while (taskStatus.status !== "done" && taskStatus.status !== "failed") {
      if (poll >= 300) throw new Error("Pro audio generation timed out");
      await step.sleep(`pro-wait-tts-${poll}`, poll < 24 ? "5s" : "10s");
      taskStatus = await step.run(`pro-poll-tts-${poll + 1}`, () =>
        ai33.getTaskStatus(audioTask.task_id)
      );
      poll += 1;
    }
    if (taskStatus.status === "failed") {
      throw new Error(`Pro audio generation failed: ${taskStatus.error_message || "unknown"}`);
    }

    const audio = await step.run("pro-save-audio", async () => {
      const audioUrl = String(taskStatus.metadata?.audio_url || "");
      const srtUrl = String(taskStatus.metadata?.srt_url || "");
      if (!srtUrl) throw new Error("AI33 finished without an srt_url — Pro needs timing");
      const srtRes = await fetch(srtUrl);
      if (!srtRes.ok) throw new Error(`SRT download failed: HTTP ${srtRes.status}`);
      const srt = await srtRes.text();

      const { data: existing } = await supabaseAdmin
        .from("video_projects")
        .select("timeline_data")
        .eq("id", projectId)
        .single();
      await supabaseAdmin
        .from("video_projects")
        .update({
          status: "Audio_Ready",
          srt_data: srt,
          timeline_data: { ...(existing?.timeline_data || {}), audio_url: audioUrl },
        })
        .eq("id", projectId);
      await appendGenerationLog(projectId, {
        level: "success",
        stage: "Audio_Ready",
        message: "Pro: hang és SRT kész.",
      });
      return { audioUrl, srt };
    });

    // ---- 4. Cadence -------------------------------------------------------
    const plan = await step.run("pro-plan-shots", async () => {
      const cues = parseSrtCues(audio.srt);
      const audioDurationSec = cues.length ? cues[cues.length - 1].endSec : 0;
      const beats = planBeats(cues, settings.cadence, audioDurationSec);

      const { allocation } = allocateShots(settings, beats.length);
      const heroes = pickHeroBeats(beats, allocation.ai_video);
      const kinds = assignSourceKinds({ beats, allocation, heroBeats: heroes });

      await supabaseAdmin
        .from("video_projects")
        .update({ status: "Image_Generation" })
        .eq("id", projectId);
      await appendGenerationLog(projectId, {
        level: "info",
        stage: "Image_Generation",
        message: `Pro vágásterv: ${beats.length} shot (${audioDurationSec.toFixed(0)}mp) — AI videó ${allocation.ai_video}, AI kép ${allocation.ai_image}, stock ${allocation.stock_video}, archív ${allocation.archive}.`,
        meta: { totalShots: beats.length, allocation, audioDurationSec },
      });
      return { beats, kinds, allocation, audioDurationSec };
    });

    // ---- 5. Director ------------------------------------------------------
    const directorModel =
      settings.textModel || loaded.channel.text_model || "qwen/qwen-2.5-72b-instruct";
    const directed: Record<number, { prompt: string; searchQuery: string; keywords: string[]; lowerThird?: string }> = {};

    for (let from = 0; from < plan.beats.length; from += DIRECTOR_BATCH) {
      const batch = plan.beats.slice(from, from + DIRECTOR_BATCH);
      const result = await step.run(`pro-direct-${from}`, async () => {
        const shots = await directBeats({
          beats: batch,
          title: loaded.title,
          model: directorModel,
          glossary: loaded.glossary,
          language: loaded.channel.language || "hu",
        });
        return shots;
      });
      for (const s of result) {
        directed[s.index] = {
          prompt: s.prompt,
          searchQuery: s.searchQuery,
          keywords: s.keywords || [],
          lowerThird: s.lowerThird,
        };
      }
    }

    // ---- 6. Acquire assets ------------------------------------------------
    const usedUrls = new Set<string>();
    const shots: ProShot[] = [];
    let spent = 0;
    let imageCounter = 0;
    // Image reuse: one generated image can back several consecutive image shots.
    let reuseUrl: string | null = null;
    let reuseLeft = 0;

    for (let from = 0; from < plan.beats.length; from += ASSET_BATCH) {
      const batch = plan.beats.slice(from, from + ASSET_BATCH);

      const produced = await step.run(`pro-assets-${from}`, async () => {
        const out: ProShot[] = [];
        for (const beat of batch) {
          const kind: ProSourceKind = plan.kinds[beat.index] || "ai_image";
          const dir = directed[beat.index] || {
            prompt: beat.text,
            searchQuery: beat.text,
            keywords: [],
          };
          const shot: ProShot = {
            shotIndex: beat.index,
            startSec: beat.startSec,
            endSec: beat.endSec,
            sourceKind: kind,
            narrationText: beat.text,
            prompt: dir.prompt,
            searchQuery: dir.searchQuery,
            keywords: dir.keywords,
            status: "ok",
            costUsd: 0,
          };

          try {
            if (kind === "stock_video" || kind === "archive") {
              const found = await resolveFreeSource({
                settings,
                kind,
                query: dir.searchQuery || dir.prompt,
                wantSec: beat.endSec - beat.startSec,
                usedUrls,
              });
              if (found) {
                const bytes = await downloadUrlToBuffer(found.url);
                if (found.kind === "video") {
                  const processed = await postProcessVideoBuffer(bytes, {});
                  const key = proAssetKey(projectId, beat.index, "mp4");
                  shot.assetUrl = await uploadMp4ToR2({ key, body: processed });
                } else {
                  const key = proAssetKey(projectId, beat.index, "png");
                  shot.assetUrl = await uploadImageToR2({
                    key,
                    body: await cropTo16x9(bytes),
                  });
                  shot.kenBurns = settings.image.kenBurns
                    ? kenBurnsFor(beat.index, beat.intensity)
                    : null;
                }
                shot.attribution = found.attribution;
              } else {
                // Nothing found — fall back to a generated image.
                shot.sourceKind = "ai_image";
              }
            }

            if (shot.sourceKind === "ai_video") {
              const clipSec = settings.videoClip.clipSec;
              const wan = await generateOpenRouterVideo({
                model: settings.videoClip.model,
                prompt: dir.prompt,
                strategy: "text_to_video",
                aspectRatio: loaded.channel.video_format || "16:9",
                resolution: settings.videoClip.resolution,
                duration: clipSec,
              });
              const raw = await downloadOpenRouterVideoBytes(wan.jobId, wan.videoUrl);
              const processed = await postProcessVideoBuffer(raw, {
                zoomCropPercent: settings.videoClip.model.includes("seedance") ? 2 : 0,
              });
              const key = proAssetKey(projectId, beat.index, "mp4");
              shot.assetUrl = await uploadMp4ToR2({ key, body: processed });
              shot.costUsd = videoClipCost(
                settings.videoClip.model,
                settings.videoClip.resolution,
                clipSec
              );
            } else if (shot.sourceKind === "ai_image" && !shot.assetUrl) {
              if (reuseUrl && reuseLeft > 0) {
                shot.assetUrl = reuseUrl;
                reuseLeft -= 1;
              } else {
                const buf = await generateProImage({
                  prompt: dir.prompt,
                  modelOption: settings.image.model,
                });
                const key = proImageKey(projectId, imageCounter);
                imageCounter += 1;
                shot.assetUrl = await uploadImageToR2({
                  key,
                  body: await cropTo16x9(buf),
                });
                shot.costUsd = imageCostForModelOption(settings.image.model);
                reuseUrl = shot.assetUrl;
                reuseLeft = Math.max(0, settings.image.reuseFactor - 1);
              }
              shot.kenBurns = settings.image.kenBurns
                ? kenBurnsFor(beat.index, beat.intensity)
                : null;
            }
          } catch (err) {
            console.error(`[pro] shot ${beat.index} failed:`, err);
            shot.status = "failed";
          }

          out.push(shot);
        }
        return out;
      });

      for (const s of produced) {
        shots.push(s);
        spent += s.costUsd || 0;
      }
    }

    // ---- 7. Persist -------------------------------------------------------
    await step.run("pro-persist-shots", async () => {
      await supabaseAdmin.from("pro_shots").delete().eq("project_id", projectId);
      const rows = shots.map((s) => ({
        project_id: projectId,
        shot_index: s.shotIndex,
        start_sec: s.startSec,
        end_sec: s.endSec,
        source_kind: s.sourceKind,
        asset_url: s.assetUrl || null,
        overlay_url: s.overlayUrl || null,
        prompt: s.prompt || null,
        search_query: s.searchQuery || null,
        narration_text: s.narrationText || null,
        keywords: s.keywords || [],
        ken_burns: s.kenBurns || null,
        attribution: s.attribution || null,
        status: s.status || "ok",
        cost_usd: s.costUsd || 0,
      }));
      for (let i = 0; i < rows.length; i += 200) {
        const { error } = await supabaseAdmin.from("pro_shots").insert(rows.slice(i, i + 200));
        if (error) throw error;
      }
    });

    // ---- 8. Finish --------------------------------------------------------
    await step.run("pro-finish", async () => {
      const voiceCost = voiceCostForChars(
        loaded.channel.ai33_voice_settings?.provider,
        loaded.channel.ai33_voice_settings?.modelId,
        script.length
      );
      const total = spent + voiceCost;
      const byKind = shots.reduce(
        (acc, s) => {
          acc[s.sourceKind] = (acc[s.sourceKind] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );
      const failed = shots.filter((s) => s.status === "failed").length;

      await supabaseAdmin
        .from("video_projects")
        .update({
          status: "Completed",
          generation_cost_usd: total,
          pro_plan: {
            totalShots: shots.length,
            byKind,
            actualCostUsd: total,
            audioDurationSec: plan.audioDurationSec,
            failedShots: failed,
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", projectId);

      await appendGenerationLog(projectId, {
        level: failed > 0 ? "warn" : "success",
        stage: "Completed",
        message: `Pro videó kész: ${shots.length} shot${failed ? ` (${failed} sikertelen)` : ""}. Becsült költség: $${total.toFixed(4)}`,
        meta: { byKind, total, failed },
      });
    });

    return { projectId, shots: shots.length, costUsd: spent };
  }
);

/** Exposed for the export route so it can name files identically. */
export { proAssetKey, proImageKey, publicUrlForKey };
