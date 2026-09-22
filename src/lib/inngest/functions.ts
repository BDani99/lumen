import { inngest } from "./client";
import { supabaseAdmin } from "../supabase";
import { openai, openrouter } from "../openai";
import { resolveOpenRouterModelId } from "../openrouter-models";
import { appendGenerationLog } from "../generation-log";
import {
  SCRIPT_QUALITY_SYSTEM_ADDON,
  OUTLINE_QUALITY_ADDON,
  detectScriptRepetition,
  checkOutlineQuality,
  buildExpandRewritePrompt,
  buildChunkPolishPrompt,
  buildLogicJudgePrompt,
  parseLogicJudgeResponse,
  collectStructuralPolishHints,
  isAcceptableRewrite,
  isAcceptablePolishChunk,
  polishMaxTokensForChunk,
  polishMaxTokensForScript,
  splitScriptForPolish,
  joinPolishedSegments,
  polishOverlapTail,
  polishLookahead,
  type RepetitionReport,
} from "../script-quality";
import { runAudioVisualPipeline } from "./post-script-pipeline";
import {
  buildNamePoolPromptBlock,
  isNamePoolsFeatureActive,
  normalizePreset,
  recordNameUsage,
  rebalanceGlossaryNames,
  sampleNamePoolsWithUsage,
  type NamePoolPreset,
  type SampledCategory,
} from "../name-pools";

/** The channel row's linked preset, resolved via the name_pool_presets(*) nested select. */
function channelNamePoolPreset(channel: any): NamePoolPreset | null {
  const raw = Array.isArray(channel.name_pool_presets)
    ? channel.name_pool_presets[0]
    : channel.name_pool_presets;
  return normalizePreset(raw);
}

const getChatClient = (model: string) => (model.includes("/") ? openrouter : openai);

function channelTextModel(channel: any): string {
  return resolveOpenRouterModelId(channel.text_model) || "gpt-4o-mini";
}

/**
 * A per-video script-model override (picked in the New Video modal, stored on
 * the project) wins over the channel's own `text_model`. Applied once at the
 * point the channel is loaded so every downstream `channelTextModel(channel)`
 * call site picks it up without further plumbing.
 */
function withTextModelOverride(channel: any, textModel?: string | null): any {
  const override = String(textModel || "").trim();
  return override ? { ...channel, text_model: override } : channel;
}

/** Model for rewrite / final polish; falls back to text_model. */
function polishModelForChannel(channel: any): string {
  return (
    resolveOpenRouterModelId(channel.polish_model) ||
    resolveOpenRouterModelId(channel.text_model) ||
    "gpt-4o-mini"
  );
}

function masterSystemPrompt(channel: any): string {
  const base = channel.master_script_prompt || "You are a professional scriptwriter.";
  return `${base}\n\n${SCRIPT_QUALITY_SYSTEM_ADDON}`;
}

function outlineSystemPrompt(channel: any): string {
  const base =
    channel.master_script_prompt ||
    "You are a professional scriptwriter. You must output strictly valid JSON.";
  return `${base}\n\n${OUTLINE_QUALITY_ADDON}\n\n${SCRIPT_QUALITY_SYSTEM_ADDON}`;
}

async function generateOutlineOnce(params: {
  title: string;
  durationMinutes: number;
  channel: any;
  projectId: string;
  sampledNamePools?: SampledCategory[];
}) {
  const { title, durationMinutes, channel, projectId, sampledNamePools } = params;
  const duration = durationMinutes || 5;
  const estimatedWords = duration * 150;
  const numChapters = Math.max(2, Math.ceil(estimatedWords / 200));
  const nameBlock = sampledNamePools ? buildNamePoolPromptBlock(sampledNamePools) : "";

  const prompt = `Create a ${numChapters}-chapter outline for a ${duration}-minute YouTube video titled "${title}". The total script will be around ${estimatedWords} words, so each chapter should represent roughly a 200-word segment. Also provide a character glossary for the main entities. Return as JSON with { "chapters": ["chapter 1 title..."], "character_glossary": { "Name": "Visual description" } }${nameBlock ? `\n\n${nameBlock}` : ""}`;

  const textModel = channelTextModel(channel);
  const chatClient = getChatClient(textModel);
  const response = await chatClient.chat.completions.create({
    model: textModel,
    messages: [
      { role: "system", content: outlineSystemPrompt(channel) },
      { role: "user", content: prompt },
    ],
    max_tokens: 8192,
    response_format: { type: "json_object" } as const,
  } as any);

  if ((response.choices?.[0]?.finish_reason as string) === "error" || (response.choices?.[0] as any)?.error) {
    throw new Error(
      `Text generation failed: ${JSON.stringify((response.choices[0] as any).error || response.choices[0].finish_reason)}`
    );
  }

  const stepCost = (response.usage as any)?.cost || 0;
  let rawContent = response.choices[0].message.content || "{}";
  rawContent = rawContent.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
  let content;
  try {
    content = JSON.parse(rawContent);
  } catch {
    throw new Error("Failed to parse outline JSON from AI. Retrying...");
  }

  await supabaseAdmin
    .from("video_projects")
    .update({
      character_glossary: content.character_glossary,
      status: "Script_Generation",
    })
    .eq("id", projectId);

  await appendGenerationLog(projectId, {
    level: "success",
    stage: "Script_Generation",
    message: `Vázlat kész: ${content.chapters?.length || 0} fejezet, ${Object.keys(content.character_glossary || {}).length} karakter a glossaryban.`,
    meta: { chapters: content.chapters?.length || 0 },
  });

  return {
    outline: content.chapters as string[],
    characterGlossary: (content.character_glossary || {}) as Record<string, string>,
    outlineCost: stepCost,
  };
}

/** Shared: outline → chunks → optional quality rewrite → Script_Ready / Script_Review */
async function runScriptPhase(params: {
  step: any;
  projectId: string;
  title: string;
  channel: any;
  durationMinutes: number;
  qualityCheck: boolean;
  logicCheck: boolean;
  finalPolish: boolean;
  pauseAfterScript: boolean;
  customScript?: string;
}) {
  const {
    step,
    projectId,
    title,
    channel,
    durationMinutes,
    qualityCheck,
    logicCheck,
    finalPolish,
    pauseAfterScript,
    customScript,
  } = params;

  const trimmedCustomScript = typeof customScript === "string" ? customScript.trim() : "";
  let fullScript = "";
  let characterGlossary: Record<string, string> = {};
  let outlineChapters: string[] = [];
  let outlineCost = 0;
  let chunksCost = 0;
  let rewriteCost = 0;

  if (trimmedCustomScript) {
    const result = await step.run("use-custom-script", async () => {
      await supabaseAdmin
        .from("video_projects")
        .update({
          generated_script: trimmedCustomScript,
          character_glossary: {},
          status: "Script_Ready",
        })
        .eq("id", projectId);
      await appendGenerationLog(projectId, {
        level: "success",
        stage: "Script_Ready",
        message: `Saját forgatókönyv használata (${trimmedCustomScript.length.toLocaleString("hu-HU")} karakter). Szöveggenerálás kihagyva.`,
      });
      return { fullScript: trimmedCustomScript, characterGlossary: {} as Record<string, string> };
    });
    fullScript = result.fullScript;
    characterGlossary = result.characterGlossary;
  } else {
    const namePoolPreset = channelNamePoolPreset(channel);
    const sampledNamePools: SampledCategory[] = await step.run("sample-name-pools", async () => {
      if (!isNamePoolsFeatureActive(channel, namePoolPreset)) {
        if (channel.use_name_pools) {
          await appendGenerationLog(projectId, {
            level: "warn",
            stage: "Script_Generation",
            message: namePoolPreset
              ? `Névkészlet kikapcsolva a futásban: minden kategóriában legalább ${namePoolPreset.minNamesPerCategory} név kell.`
              : "Névkészlet be van kapcsolva, de nincs kiválasztott névkészlet a csatornán.",
          });
        }
        return [] as SampledCategory[];
      }

      const sampled = sampleNamePoolsWithUsage(namePoolPreset, channel.name_usage);
      const counts = Object.fromEntries(sampled.map((c) => [c.key, c.names.length]));
      const total = sampled.reduce((sum, c) => sum + c.names.length, 0);
      await appendGenerationLog(projectId, {
        level: "info",
        stage: "Script_Generation",
        message: `Névkészlet sorsolva használat szerint (listánként ~25%): ${total} név/rang — ritka/régi nevek előnyben.`,
        meta: { sampled: counts, pools: sampled },
      });
      return sampled;
    });

    let outlineResult = await step.run("generate-outline", () =>
      generateOutlineOnce({
        title,
        durationMinutes,
        channel,
        projectId,
        sampledNamePools,
      })
    );

    // F: free outline quality check — one retry if fail
    const outlineCheck = checkOutlineQuality(outlineResult.outline || []);
    if (!outlineCheck.ok) {
      await step.run("log-outline-quality-fail", async () => {
        await appendGenerationLog(projectId, {
          level: "warn",
          stage: "Script_Generation",
          message: `Vázlat minőségi ellenőrzés: újragenerálás. ${outlineCheck.reasons.join(" ")}`,
          meta: { reasons: outlineCheck.reasons },
        });
      });
      outlineResult = await step.run("generate-outline-retry", () =>
        generateOutlineOnce({
          title,
          durationMinutes,
          channel,
          projectId,
          sampledNamePools,
        })
      );
      const retryCheck = checkOutlineQuality(outlineResult.outline || []);
      if (!retryCheck.ok) {
        await step.run("log-outline-quality-soft-pass", async () => {
          await appendGenerationLog(projectId, {
            level: "warn",
            stage: "Script_Generation",
            message: `Vázlat második próbálkozás után is gyenge — folytatás. ${retryCheck.reasons.join(" ")}`,
          });
        });
      } else {
        await step.run("log-outline-quality-ok", async () => {
          await appendGenerationLog(projectId, {
            level: "success",
            stage: "Script_Generation",
            message: "Vázlat minőségi ellenőrzés: OK (újragenerálás után).",
          });
        });
      }
    } else {
      await step.run("log-outline-quality-pass", async () => {
        await appendGenerationLog(projectId, {
          level: "info",
          stage: "Script_Generation",
          message: "Vázlat minőségi ellenőrzés: OK.",
        });
      });
    }

    const outline = outlineResult.outline;
    outlineChapters = Array.isArray(outline) ? outline : [];
    if (!Array.isArray(outline) || outline.length === 0) {
      await step.run("log-invalid-outline", async () => {
        await appendGenerationLog(projectId, {
          level: "error",
          stage: "Script_Generation",
          message: "Érvénytelen vázlat: üres vagy hiányzó chapters tömb.",
        });
      });
      throw new Error("Outline chapters missing or empty");
    }
    characterGlossary = outlineResult.characterGlossary || {};
    outlineCost = outlineResult.outlineCost;

    // Usage-aware swap: replace recent/frequent pool names in glossary, then persist usage
    if (isNamePoolsFeatureActive(channel, namePoolPreset) && Object.keys(characterGlossary).length > 0) {
      const rebalanced = await step.run("rebalance-glossary-names", async () => {
        const result = rebalanceGlossaryNames(
          characterGlossary,
          namePoolPreset,
          channel.name_usage
        );
        if (result.swaps.length > 0) {
          await supabaseAdmin
            .from("video_projects")
            .update({ character_glossary: result.glossary })
            .eq("id", projectId);
          await appendGenerationLog(projectId, {
            level: "info",
            stage: "Script_Generation",
            message: `Névrotáció: ${result.swaps.length} gyakori/nemrég használt név cserélve.`,
            meta: { swaps: result.swaps },
          });
        }
        const mergedUsage = recordNameUsage(channel.name_usage, result.usedByCategory);
        await supabaseAdmin
          .from("channels")
          .update({ name_usage: mergedUsage })
          .eq("id", channel.id);
        // Keep in-memory channel usage fresh for this run
        channel.name_usage = mergedUsage;
        return result.glossary;
      });
      characterGlossary = rebalanced;
    }

    let chunks: string[][] = [];
    if (durationMinutes >= 30) {
      const half = Math.ceil(outline.length / 2);
      chunks = [outline.slice(0, half), outline.slice(half)].filter((c) => c.length > 0);
    } else {
      chunks = [outline];
    }

    const messages: any[] = [{ role: "system", content: masterSystemPrompt(channel) }];

    for (let i = 0; i < chunks.length; i++) {
      const { chunkText, chunkCost } = await step.run(`generate-chunk-${i}`, async () => {
        await appendGenerationLog(projectId, {
          level: "info",
          stage: "Script_Generation",
          message: `Szöveg rész ${i + 1}/${chunks.length} írása…`,
        });

        const fullOutlineText = outline.map((o: string, idx: number) => `${idx + 1}. ${o}`).join("\n");
        const chunkChaptersText = chunks[i].map((o: string) => `- ${o}`).join("\n");
        const expectedChunkWords = Math.round(
          (chunks[i].length / outline.length) * ((durationMinutes || 5) * 150)
        );

        const glossaryLines = Object.entries(characterGlossary)
          .map(([n, d]) => `- ${n}: ${d}`)
          .join("\n");
        const nameBlock = buildNamePoolPromptBlock(sampledNamePools);

        const prompt = `We are writing a narrative script for a video titled "${title}".
Here is the FULL outline for the video:
${fullOutlineText}

Character glossary (keep these names consistent):
${glossaryLines || "(none)"}

Your task is to write the detailed spoken narrative for PART ${i + 1} of the video, covering the following chapters:
${chunkChaptersText}

CRITICAL INSTRUCTION: You MUST restrict the length of this specific part to approximately ${expectedChunkWords} words! Do not make it excessively long. Write ONLY the pure spoken narrative text. Do NOT include formatting like [Music], [Speaker], or chapter titles. ABSOLUTELY DO NOT write "(PART ${i + 1})", "Part ${i + 1}", or any other structural markers in your response! Start the story seamlessly without any title or label.

QUALITY: Do not repeat facts or emotional beats already covered earlier. Advance the story every few sentences; no circular refrains.${nameBlock ? `\n\nIf you must introduce an additional named character, use only these pools:\n${nameBlock}` : ""}`;

        const textModel = channelTextModel(channel);
        const chatClient = getChatClient(textModel);
        const currentMessages = [...messages, { role: "user", content: prompt }];
        const response = await chatClient.chat.completions.create({
          model: textModel,
          messages: currentMessages,
          max_tokens: 8192,
        } as any);

        if ((response.choices?.[0]?.finish_reason as string) === "error" || (response.choices?.[0] as any)?.error) {
          throw new Error(
            `Text generation failed: ${JSON.stringify((response.choices[0] as any).error || response.choices[0].finish_reason)}`
          );
        }

        return {
          chunkText: response.choices[0].message.content || "",
          chunkCost: (response.usage as any)?.cost || 0,
        };
      });

      chunksCost += chunkCost || 0;
      fullScript += chunkText + "\n\n";

      messages.push({
        role: "user",
        content: `Write the detailed spoken narrative for PART ${i + 1} covering chapters:\n${chunks[i].map((o: string) => `- ${o}`).join("\n")}`,
      });
      messages.push({ role: "assistant", content: chunkText });

      await step.run(`update-script-progress-chunk-${i}`, async () => {
        await supabaseAdmin.from("video_projects").update({ generated_script: fullScript }).eq("id", projectId);
        await appendGenerationLog(projectId, {
          level: "success",
          stage: "Script_Generation",
          message: `Szöveg rész ${i + 1}/${chunks.length} kész (${fullScript.length.toLocaleString("hu-HU")} karakter eddig).`,
        });
      });
    }
  }

  // B+C (+ optional LLM logic judge / final polish)
  if ((qualityCheck || logicCheck || finalPolish) && fullScript.trim()) {
    const rewriteResult = await step.run("quality-check-rewrite", async () => {
      let cost = 0;
      const report: RepetitionReport = qualityCheck
        ? detectScriptRepetition(fullScript)
        : {
            failed: false,
            score: 0,
            repeatedSentenceCount: 0,
            topRepeatedPhrases: [],
            reasons: [],
          };

      if (qualityCheck) {
        await appendGenerationLog(projectId, {
          level: report.failed ? "warn" : "info",
          stage: report.failed ? "Script_Generation" : "Script_Ready",
          message: report.failed
            ? `Ismétlés-detektor: FAIL (score ${report.score.toFixed(2)}). ${report.reasons.join(" ")}`
            : `Ismétlés-detektor: OK (score ${report.score.toFixed(2)}).`,
          meta: {
            score: report.score,
            reasons: report.reasons,
            phrases: report.topRepeatedPhrases.slice(0, 5),
          },
        });
      }

      let logicIssues: string[] = [];
      let logicFailed = false;
      if (logicCheck) {
        const textModel = channelTextModel(channel);
        const chatClient = getChatClient(textModel);
        const judgeRes = await chatClient.chat.completions.create({
          model: textModel,
          messages: [
            {
              role: "system",
              content:
                "You are a strict script logic QA. Output valid JSON only. Be cheap: short issues, no rewrite.",
            },
            { role: "user", content: buildLogicJudgePrompt(title, fullScript) },
          ],
          max_tokens: 600,
          response_format: { type: "json_object" } as const,
        } as any);
        cost += (judgeRes.usage as any)?.cost || 0;
        const judged = parseLogicJudgeResponse(
          judgeRes.choices[0].message.content || "{}"
        );
        logicFailed = !judged.ok;
        logicIssues = judged.issues;
        await appendGenerationLog(projectId, {
          level: logicFailed ? "warn" : "info",
          stage: logicFailed ? "Script_Generation" : "Script_Ready",
          message: logicFailed
            ? `LLM logikai bíró: FAIL — ${logicIssues.join("; ") || "logikai hibák"}`
            : "LLM logikai bíró: OK.",
          meta: { ok: judged.ok, issues: logicIssues },
        });
      }

      const structuralHints = collectStructuralPolishHints(fullScript);
      const hints = [...report.reasons, ...logicIssues, ...structuralHints];
      const shouldRewrite =
        finalPolish || report.failed || logicFailed || structuralHints.length > 0;
      if (!shouldRewrite) {
        return { script: fullScript, cost, rewritten: false };
      }

      const polishModel = polishModelForChannel(channel);

      const sourceScript = fullScript.trim();
      const polishChunks = splitScriptForPolish(sourceScript);
      if (finalPolish) {
        await appendGenerationLog(projectId, {
          level: "info",
          stage: "Script_Generation",
          message: `Végső LLM-simítás indul (chunkolt: ${polishChunks.length} rész, modell: ${polishModel})…`,
          meta: {
            repetitionFailed: report.failed,
            logicFailed,
            hints,
            polishModel,
            polishChunks: polishChunks.length,
          },
        });
      } else {
        await appendGenerationLog(projectId, {
          level: "warn",
          stage: "Script_Generation",
          message: `Minőségi hiba — AI-újraírás indul (chunkolt: ${polishChunks.length} rész, modell: ${polishModel})…`,
          meta: {
            repetitionFailed: report.failed,
            logicFailed,
            reasons: hints,
            polishModel,
            polishChunks: polishChunks.length,
          },
        });
      }

      const chatClient = getChatClient(polishModel);
      // Extended-thinking models (e.g. Claude Sonnet 5 via OpenRouter) burn an
      // unpredictable chunk of the SAME max_tokens budget on hidden reasoning
      // (observed 87–755+ tokens across identical calls), which is what was
      // causing intermittent "length" truncation of the visible rewrite even
      // with a generous character-based budget. Turn it off for polish calls
      // — this is a mechanical rewrite task, not something that needs
      // chain-of-thought, and OpenRouter ignores the flag for models that
      // don't support reasoning at all.
      const reasoningOff = chatClient === openrouter ? { reasoning: { enabled: false } } : {};
      const polishedParts: string[] = [];
      let lastFinishReason: string | undefined;
      const failedChunks: string[] = [];

      for (const chunk of polishChunks) {
        const previousTail =
          polishedParts.length > 0
            ? polishOverlapTail(polishedParts[polishedParts.length - 1])
            : "";
        const nextPeek =
          chunk.index < polishChunks.length - 1
            ? polishLookahead(sourceScript, chunk.end)
            : "";
        const maxTokens = polishMaxTokensForChunk(chunk.text);
        const userPrompt = buildChunkPolishPrompt({
          title,
          segment: chunk.text,
          chunkIndex: chunk.index,
          chunkTotal: chunk.total,
          previousTail,
          nextPeek,
          glossary: characterGlossary,
          outline: outlineChapters,
          hints,
          mode: finalPolish ? "final" : "rewrite",
          report,
          logicIssues,
        });

        await appendGenerationLog(projectId, {
          level: "info",
          stage: "Script_Generation",
          message: `Polish rész ${chunk.index + 1}/${chunk.total} (${chunk.text.length.toLocaleString("hu-HU")} karakter)…`,
        });

        const response = await chatClient.chat.completions.create({
          model: polishModel,
          messages: [
            { role: "system", content: masterSystemPrompt(channel) },
            { role: "user", content: userPrompt },
          ],
          max_tokens: maxTokens,
          ...reasoningOff,
        } as any);

        let part = (response.choices[0].message.content || "").trim();
        cost += (response.usage as any)?.cost || 0;
        lastFinishReason = response.choices?.[0]?.finish_reason as string | undefined;
        let chunkAccept = isAcceptablePolishChunk(chunk.text, part);

        // One local expansion if this chunk came back too short (not truncated)
        if (
          lastFinishReason !== "length" &&
          chunkAccept.reason?.startsWith("chunk túl rövid") &&
          part
        ) {
          const expandRes = await chatClient.chat.completions.create({
            model: polishModel,
            messages: [
              { role: "system", content: masterSystemPrompt(channel) },
              {
                role: "user",
                content: buildExpandRewritePrompt(
                  `${title} (part ${chunk.index + 1}/${chunk.total})`,
                  chunk.text,
                  part
                ),
              },
            ],
            max_tokens: maxTokens,
            ...reasoningOff,
          } as any);
          part = (expandRes.choices[0].message.content || "").trim();
          cost += (expandRes.usage as any)?.cost || 0;
          lastFinishReason = expandRes.choices?.[0]?.finish_reason as
            | string
            | undefined;
          chunkAccept = isAcceptablePolishChunk(chunk.text, part);
        }

        if (!chunkAccept.ok || lastFinishReason === "length") {
          const reason =
            lastFinishReason === "length"
              ? "token limit miatt levágva"
              : chunkAccept.reason || "minőség";
          await appendGenerationLog(projectId, {
            level: "warn",
            stage: "Script_Generation",
            message: `Polish rész ${chunk.index + 1}/${chunk.total} elutasítva (${reason}) — ezen a részen az eredeti szöveg marad, a többi rész folytatódik.`,
            meta: { chunkIndex: chunk.index, chunkTotal: chunk.total, reason, finishReason: lastFinishReason },
          });
          failedChunks.push(`${chunk.index + 1}/${chunk.total}: ${reason}`);
          // Fall back to the original text for just this chunk instead of
          // aborting the whole polish — the other chunks still get improved.
          polishedParts.push(chunk.text);
          continue;
        }

        polishedParts.push(part);
      }

      if (failedChunks.length > 0) {
        await appendGenerationLog(projectId, {
          level: "warn",
          stage: "Script_Generation",
          message: `${failedChunks.length}/${polishChunks.length} chunk elutasítva, azokon az eredeti szöveg maradt — a többi rész javítva.`,
          meta: { originalChars: sourceScript.length, failedChunks },
        });
      }

      if (failedChunks.length === polishChunks.length) {
        // Every chunk fell back to its original text — nothing was actually
        // improved, so report this as a no-op rather than a successful rewrite.
        await appendGenerationLog(projectId, {
          level: "warn",
          stage: "Script_Generation",
          message: `Újraírás elutasítva (minden chunk sikertelen) — az eredeti script marad.`,
          meta: { originalChars: sourceScript.length, polishChunks: polishChunks.length },
        });
        return { script: fullScript, cost, rewritten: false };
      }

      let rewritten = joinPolishedSegments(polishedParts);
      let accept = isAcceptableRewrite(sourceScript, rewritten);

      // Whole-script expand only when short enough to fit one call
      const tooShort =
        Boolean(accept.reason?.startsWith("túl rövid")) &&
        rewritten.length > 0 &&
        sourceScript.length <= 9000;
      if (tooShort) {
        await appendGenerationLog(projectId, {
          level: "info",
          stage: "Script_Generation",
          message: `Összefűzött újraírás túl rövid (${rewritten.length}/${sourceScript.length} karakter) — bővítő retry…`,
        });
        const expandRes = await chatClient.chat.completions.create({
          model: polishModel,
          messages: [
            { role: "system", content: masterSystemPrompt(channel) },
            {
              role: "user",
              content: buildExpandRewritePrompt(title, sourceScript, rewritten),
            },
          ],
          max_tokens: polishMaxTokensForScript(sourceScript),
          ...reasoningOff,
        } as any);
        rewritten = (expandRes.choices[0].message.content || "").trim();
        cost += (expandRes.usage as any)?.cost || 0;
        lastFinishReason = expandRes.choices?.[0]?.finish_reason as string | undefined;
        accept = isAcceptableRewrite(sourceScript, rewritten);
        if (!accept.ok || lastFinishReason === "length") {
          await appendGenerationLog(projectId, {
            level: "warn",
            stage: "Script_Generation",
            message: `Újraírás elutasítva (${
              lastFinishReason === "length"
                ? "token limit miatt levágva"
                : accept.reason || "minőség"
            }) — az eredeti script marad.`,
            meta: {
              originalChars: sourceScript.length,
              rewrittenChars: rewritten.length,
              finishReason: lastFinishReason,
              expandRetried: true,
            },
          });
          return { script: fullScript, cost, rewritten: false };
        }
      } else if (!accept.ok) {
        await appendGenerationLog(projectId, {
          level: "warn",
          stage: "Script_Generation",
          message: `Újraírás elutasítva (${accept.reason || "minőség"}) — az eredeti script marad.`,
          meta: {
            originalChars: sourceScript.length,
            rewrittenChars: rewritten.length,
            polishChunks: polishChunks.length,
          },
        });
        return { script: fullScript, cost, rewritten: false };
      }

      await supabaseAdmin
        .from("video_projects")
        .update({ generated_script: rewritten })
        .eq("id", projectId);
      await appendGenerationLog(projectId, {
        level: "success",
        stage: "Script_Ready",
        message: finalPolish
          ? `Végső LLM-simítás kész (${polishChunks.length} chunk → ${rewritten.length.toLocaleString("hu-HU")} karakter, eredeti ${sourceScript.length.toLocaleString("hu-HU")}).`
          : `Script újraírva minőségi hibák miatt (${polishChunks.length} chunk → ${rewritten.length.toLocaleString("hu-HU")} karakter).`,
      });
      return { script: rewritten, cost, rewritten: true };
    });

    fullScript = rewriteResult.script;
    rewriteCost = rewriteResult.cost || 0;
  }

  const finalStatus = pauseAfterScript ? "Script_Review" : "Script_Ready";
  await step.run("mark-script-phase-done", async () => {
    const { data: existing } = await supabaseAdmin
      .from("video_projects")
      .select("timeline_data, generation_cost_usd")
      .eq("id", projectId)
      .single();
    const prevTimeline = existing?.timeline_data || {};
    const scriptCost = (outlineCost || 0) + (chunksCost || 0) + (rewriteCost || 0);
    await supabaseAdmin
      .from("video_projects")
      .update({
        generated_script: fullScript,
        character_glossary: characterGlossary,
        status: finalStatus,
        generation_cost_usd: (existing?.generation_cost_usd || 0) + scriptCost,
        timeline_data: {
          ...prevTimeline,
          characterGlossary,
          generationOptions: {
            qualityCheck,
            logicCheck,
            finalPolish,
            pauseAfterScript,
          },
          scriptPhaseCostUsd: scriptCost,
        },
      })
      .eq("id", projectId);

    await appendGenerationLog(projectId, {
      level: "success",
      stage: finalStatus,
      message: pauseAfterScript
        ? `Forgatókönyv kész (${fullScript.length.toLocaleString("hu-HU")} karakter) — várakozás átnézésre. Az editorban folytathatod vagy újragenerálhatod.`
        : `Forgatókönyv kész (${fullScript.length.toLocaleString("hu-HU")} karakter).`,
    });
  });

  return {
    fullScript,
    characterGlossary,
    priorCostUsd: (outlineCost || 0) + (chunksCost || 0) + (rewriteCost || 0),
    paused: pauseAfterScript,
  };
}

function markFailedOnFailure() {
  return async ({ event, error }: { event: any; error: any }) => {
    const projectId =
      event.data?.event?.data?.projectId || event.data?.projectId;
    if (!projectId) return;
    const message = error?.message || "Ismeretlen hiba";
    await appendGenerationLog(projectId, {
      level: "error",
      stage: "Failed",
      message: `Generálás sikertelen: ${message}`,
      meta: { error: message },
    });
    const { data: row } = await supabaseAdmin
      .from("video_projects")
      .select("status")
      .eq("id", projectId)
      .maybeSingle();
    if (row?.status === "Cancelled") return;

    await supabaseAdmin
      .from("video_projects")
      .update({ status: "Failed", updated_at: new Date().toISOString() })
      .eq("id", projectId)
      .neq("status", "Cancelled");
  };
}

const cancelOnProject = [
  { event: "video/cancel", match: "data.projectId" },
] as const;

export const generateVideoWorkflow = inngest.createFunction(
  {
    id: "generate-video-workflow",
    retries: 3,
    concurrency: [{ limit: 6 }],
    triggers: [{ event: "video/generate" }],
    cancelOn: [...cancelOnProject],
    onFailure: markFailedOnFailure(),
  },
  async ({ event, step }) => {
    const {
      projectId,
      title,
      channelId,
      durationMinutes,
      customScript,
      qualityCheck = false,
      logicCheck = false,
      finalPolish = false,
      pauseAfterScript = false,
      mediaMode,
      videoPattern,
      videoEveryN,
      videoFirstSeconds,
      introVideoCount,
      videoStrategy,
      maxVideoScenes,
      videoModel,
      videoDurationSec,
      videoResolution,
      textModel: textModelOverride,
    } = event.data;

    await step.run("log-workflow-start", async () => {
      await appendGenerationLog(projectId, {
        level: "info",
        stage: "Draft",
        message: customScript?.trim()
          ? `Generálás elindult saját forgatókönyvvel („${title}”, ${durationMinutes || 5} perc cél)`
          : `Generálás elindult („${title}”, ${durationMinutes || 5} perc)`,
        meta: {
          title,
          durationMinutes,
          hasCustomScript: Boolean(customScript?.trim()),
          qualityCheck: Boolean(qualityCheck),
          logicCheck: Boolean(logicCheck),
          finalPolish: Boolean(finalPolish),
          pauseAfterScript: Boolean(pauseAfterScript),
          mediaMode,
          videoStrategy,
          videoModel,
          videoResolution,
        },
      });
    });

    const channelRow = await step.run("fetch-channel-settings", async () => {
      const { data, error } = await supabaseAdmin
        .from("channels")
        .select("*, name_pool_presets(*)")
        .eq("id", channelId)
        .single();
      if (error || !data) {
        await appendGenerationLog(projectId, {
          level: "error",
          stage: "Draft",
          message: `Csatorna nem található (ID: ${channelId})`,
        });
        throw new Error("Channel not found");
      }
      await appendGenerationLog(projectId, {
        level: "info",
        stage: "Draft",
        message: `Csatorna betöltve: ${data.name}${
          textModelOverride ? ` — szövegíró modell felülírva: ${textModelOverride}` : ""
        }`,
      });
      return data;
    });
    const channel = withTextModelOverride(channelRow, textModelOverride);

    const scriptPhase = await runScriptPhase({
      step,
      projectId,
      title,
      channel,
      durationMinutes: durationMinutes || 5,
      qualityCheck: Boolean(qualityCheck),
      logicCheck: Boolean(logicCheck),
      finalPolish: Boolean(finalPolish),
      pauseAfterScript: Boolean(pauseAfterScript),
      customScript,
    });

    if (scriptPhase.paused) {
      return { success: true, projectId, pausedAt: "Script_Review" };
    }

    return runAudioVisualPipeline({
      step,
      projectId,
      title,
      channel,
      fullScript: scriptPhase.fullScript,
      characterGlossary: scriptPhase.characterGlossary,
      priorCostUsd: scriptPhase.priorCostUsd,
      videoOptions: {
        mediaMode,
        videoPattern,
        videoEveryN,
        videoFirstSeconds,
        introVideoCount,
        videoStrategy,
        maxVideoScenes,
        videoModel,
        videoDurationSec,
        videoResolution,
      },
    });
  }
);

/** Continue after Script_Review (or manual script edit). */
export const continueVideoWorkflow = inngest.createFunction(
  {
    id: "continue-video-workflow",
    retries: 3,
    concurrency: [{ limit: 6 }],
    triggers: [{ event: "video/continue" }],
    cancelOn: [...cancelOnProject],
    onFailure: markFailedOnFailure(),
  },
  async ({ event, step }) => {
    const { projectId } = event.data;

    const loaded = await step.run("load-project-for-continue", async () => {
      const { data: project, error } = await supabaseAdmin
        .from("video_projects")
        .select("*, channels(*, name_pool_presets(*))")
        .eq("id", projectId)
        .single();
      if (error || !project) throw new Error("Project not found");
      if (!project.generated_script?.trim()) throw new Error("No script to continue from");
      const channel = Array.isArray(project.channels) ? project.channels[0] : project.channels;
      if (!channel) throw new Error("Channel not found on project");
      await appendGenerationLog(projectId, {
        level: "info",
        stage: "Script_Review",
        message: "Folytatás: hang- és képgenerálás indul a jóváhagyott forgatókönyvvel…",
      });
      return {
        title: project.title as string,
        channel: withTextModelOverride(
          channel,
          project.timeline_data?.generationOptions?.textModel
        ),
        fullScript: project.generated_script as string,
        characterGlossary:
          (project.character_glossary as Record<string, string>) ||
          project.timeline_data?.characterGlossary ||
          {},
        priorCostUsd: Number(project.generation_cost_usd || 0),
        videoOptions: project.timeline_data?.generationOptions || {},
      };
    });

    return runAudioVisualPipeline({
      step,
      projectId,
      title: loaded.title,
      channel: loaded.channel,
      fullScript: loaded.fullScript,
      characterGlossary: loaded.characterGlossary,
      priorCostUsd: loaded.priorCostUsd,
      videoOptions: loaded.videoOptions,
    });
  }
);

/** Regenerate script only, then pause at Script_Review. */
export const regenerateScriptWorkflow = inngest.createFunction(
  {
    id: "regenerate-script-workflow",
    retries: 3,
    concurrency: [{ limit: 6 }],
    triggers: [{ event: "video/regenerate-script" }],
    cancelOn: [...cancelOnProject],
    onFailure: markFailedOnFailure(),
  },
  async ({ event, step }) => {
    const {
      projectId,
      qualityCheck = true,
      logicCheck = false,
      finalPolish = false,
    } = event.data;

    const loaded = await step.run("load-project-for-regen", async () => {
      const { data: project, error } = await supabaseAdmin
        .from("video_projects")
        .select("*, channels(*, name_pool_presets(*))")
        .eq("id", projectId)
        .single();
      if (error || !project) throw new Error("Project not found");
      const channel = Array.isArray(project.channels) ? project.channels[0] : project.channels;
      if (!channel) throw new Error("Channel not found on project");
      const opts = project.timeline_data?.generationOptions || {};
      await supabaseAdmin
        .from("video_projects")
        .update({
          status: "Script_Generation",
          generated_script: null,
          generation_cost_usd: 0,
        })
        .eq("id", projectId);
      await appendGenerationLog(projectId, {
        level: "info",
        stage: "Script_Generation",
        message: "Forgatókönyv újragenerálása…",
      });
      return {
        title: project.title as string,
        channel: withTextModelOverride(channel, opts.textModel),
        durationMinutes: Number(project.timeline_data?.durationMinutes) || 5,
        qualityCheck: qualityCheck ?? opts.qualityCheck ?? true,
        logicCheck: logicCheck ?? opts.logicCheck ?? false,
        finalPolish: finalPolish ?? opts.finalPolish ?? false,
      };
    });

    await runScriptPhase({
      step,
      projectId,
      title: loaded.title,
      channel: loaded.channel,
      durationMinutes: loaded.durationMinutes,
      qualityCheck: Boolean(loaded.qualityCheck),
      logicCheck: Boolean(loaded.logicCheck),
      finalPolish: Boolean(loaded.finalPolish),
      pauseAfterScript: true,
    });

    return { success: true, projectId, pausedAt: "Script_Review" };
  }
);
