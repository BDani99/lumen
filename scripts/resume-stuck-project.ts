/**
 * One-off manual recovery for a single project whose generation run died
 * mid-way (e.g. the local dev server was closed while Image_Generation was
 * still running). Diagnosed via generation_logs + video_scenes: everything
 * up to the last scene had already succeeded, only the final scene's row was
 * never created because the process was killed before that step's write.
 *
 * This does NOT touch already-completed scenes or re-run anything that
 * already succeeded (script, audio, scenes 0-23, scene 0's motion clips) —
 * it only generates the one missing scene and writes the bookkeeping
 * (motionClipsByScene, generationOptions, final cost, status) that the
 * pipeline's own "finish" steps never got to run.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/resume-stuck-project.ts            (dry run)
 *   npx tsx --env-file=.env.local scripts/resume-stuck-project.ts --confirm  (writes)
 */
import { createClient } from "@supabase/supabase-js";
import { generateOneScene } from "../src/lib/inngest/generate-scene";
import { segmentSrtIntoScenes } from "../src/lib/services/scene-segmentation";
import { imageCostForModelOption, videoClipCost, voiceCostForChars } from "../src/lib/cost-estimate";
import type { MotionClipsByScene } from "../src/lib/motion-clips";

const PROJECT_ID = "424f0538-65ae-4056-84c3-95f99730b0e3";
const CONFIRM = process.argv.includes("--confirm");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

async function main() {
  const { data: project, error } = await sb
    .from("video_projects")
    .select("*, channels(*)")
    .eq("id", PROJECT_ID)
    .single();
  if (error || !project) throw new Error("project not found: " + error?.message);
  const channel: any = Array.isArray(project.channels) ? project.channels[0] : project.channels;

  if (project.status !== "Image_Generation") {
    console.log(`Project status is "${project.status}", not "Image_Generation" — nothing to resume. Aborting.`);
    return;
  }

  const sentencesPerImage = channel.sentences_per_image || 2;
  const scenes = segmentSrtIntoScenes(project.srt_data as unknown as string, sentencesPerImage);

  const { data: existingRows } = await sb
    .from("video_scenes")
    .select("scene_order, start_time, end_time")
    .eq("project_id", PROJECT_ID)
    .order("scene_order");
  const existingOrders = new Set((existingRows || []).map((r) => r.scene_order));

  const missingIndices = scenes
    .map((_, i) => i)
    .filter((i) => !existingOrders.has(i));

  console.log(`Reconstructed ${scenes.length} scenes; ${existingRows?.length} already exist; missing: [${missingIndices.join(", ")}]`);
  if (missingIndices.length === 0) {
    console.log("No missing scenes — the run may just need its finish steps. Aborting to avoid guessing.");
    return;
  }

  // Known from generation_logs (the "Képgenerálás indul" meta.videoOpts entry)
  // rather than re-derived, since project.timeline_data.generationOptions was
  // never written this run (that only happens in the pipeline's final step,
  // which this run never reached).
  const videoOpts = {
    mediaMode: "video",
    videoModel: "bytedance/seedance-1-5-pro",
    videoEveryN: 3,
    videoPattern: "intro",
    videoStrategy: "text_to_video",
    maxVideoScenes: 2,
    introVideoCount: 2,
    videoResolution: "480p",
    videoDurationSec: 10,
    videoFirstSeconds: 30,
  };
  const scene0Clips = [
    { url: `https://pub-c09e03c9f94b4039a5b4274733920a74.r2.dev/projects/${PROJECT_ID}/scene_1.mp4`, durationSec: 10 },
    { url: `https://pub-c09e03c9f94b4039a5b4274733920a74.r2.dev/projects/${PROJECT_ID}/scene_1_c2.mp4`, durationSec: 10 },
  ];

  console.log("\nMissing scene(s) to generate:");
  for (const idx of missingIndices) {
    console.log(`  [${idx}] ${scenes[idx].start_time.toFixed(1)}s-${scenes[idx].end_time.toFixed(1)}s: ${scenes[idx].text.slice(0, 90)}...`);
  }

  if (!CONFIRM) {
    console.log("\nDry run only — pass --confirm to actually generate the missing scene(s) and finish the project.");
    return;
  }

  let newImageCost = 0;
  for (const idx of missingIndices) {
    const scene = scenes[idx];
    console.log(`\nGenerating scene ${idx}...`);
    const result = await generateOneScene({
      projectId: PROJECT_ID,
      title: project.title,
      channel,
      scene: { text: scene.text, start_time: scene.start_time, end_time: scene.end_time },
      sceneIndex: idx,
      totalScenes: scenes.length,
      characterGlossary: (project.character_glossary || {}) as Record<string, string>,
      // No wanVideo — the original plan only targeted scene 0 for motion clips.
    });
    if (result.softFailed) {
      throw new Error(`Scene ${idx} soft-failed — check generation_logs before retrying.`);
    }
    newImageCost += result.cost;
    console.log(`  done (cost $${result.cost.toFixed(4)})`);
  }

  // Restore what the pipeline's own persist/finish steps never got to write.
  const motionClipsByScene: MotionClipsByScene = { "0": scene0Clips };
  const prevTimeline = (project.timeline_data || {}) as Record<string, unknown>;

  const channelVoiceProvider =
    channel.ai33_voice_settings?.provider === "fish" ? "fishaudio" : channel.ai33_voice_settings?.provider || "elevenlabs";
  const audioCost = voiceCostForChars(
    channelVoiceProvider,
    channel.ai33_voice_settings?.modelId,
    String(project.generated_script || "").length
  );
  const priorImagesCost = 24 * imageCostForModelOption(channel.image_model || "gpt-image-2 low");
  const videoCost = 2 * videoClipCost(videoOpts.videoModel, videoOpts.videoResolution, videoOpts.videoDurationSec);
  const scriptPhaseCostUsd = Number(prevTimeline.scriptPhaseCostUsd) || Number(project.generation_cost_usd) || 0;
  const totalCostUsd = scriptPhaseCostUsd + priorImagesCost + newImageCost + videoCost + audioCost;

  console.log("\nFinal cost breakdown:");
  console.log(`  script phase: $${scriptPhaseCostUsd.toFixed(4)}`);
  console.log(`  24 existing images: $${priorImagesCost.toFixed(4)}`);
  console.log(`  new image(s): $${newImageCost.toFixed(4)}`);
  console.log(`  2 motion clips: $${videoCost.toFixed(4)}`);
  console.log(`  audio (TTS): $${audioCost.toFixed(4)}`);
  console.log(`  TOTAL: $${totalCostUsd.toFixed(4)}`);

  await sb
    .from("video_projects")
    .update({
      status: "Completed",
      generation_cost_usd: totalCostUsd,
      timeline_data: {
        ...prevTimeline,
        motionClipsByScene,
        generationOptions: { ...((prevTimeline.generationOptions as object) || {}), ...videoOpts },
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", PROJECT_ID);

  await sb.from("generation_logs").insert({
    project_id: PROJECT_ID,
    level: "success",
    stage: "Completed",
    message: `Generálás manuálisan folytatva és befejezve (a helyi szerver leállása miatt megszakadt futás) — ${missingIndices.length} hiányzó jelenet pótolva. Becsült összköltség: $${totalCostUsd.toFixed(4)}`,
    meta: { missingIndices, totalCostUsd, resumedManually: true },
  });

  console.log("\nProject marked Completed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
