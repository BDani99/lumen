import {
  buildSearchIntent,
  queriesFromIntent,
  verifyCandidates,
  type StockChat,
} from "./relevance";
import { searchStockChain, type ChainDiagnostics } from "./search";
import { effectiveMinConfidence } from "./types";
import type {
  StockKind,
  StockProviderId,
  StockQuotaState,
  StockResult,
  StockSettings,
} from "./types";

/**
 * Full per-scene resolution: build an intent, run the ordered provider
 * chain, then let the strict gate accept exactly one candidate or nothing.
 *
 * Video is attempted before image when both chains are enabled, because a
 * moving shot is worth more than a still — but a rejected video does not
 * block the image chain from trying.
 */

export type StockResolution =
  | {
      accepted: true;
      result: StockResult;
      confidence: number;
      reason: string;
      diagnostics: ChainDiagnostics[];
    }
  | {
      accepted: false;
      reason: string;
      diagnostics: ChainDiagnostics[];
      candidatesSeen: number;
    };

export async function resolveStockForScene(params: {
  chat: StockChat;
  title: string;
  narration: string;
  imagePrompt?: string;
  settings: StockSettings;
  /** Restrict to these kinds — e.g. only "image" for the fill-still slot. */
  kinds?: StockKind[];
  usedUrls?: Set<string>;
  /** Shared across the whole run so a throttled provider is retired once, not per scene. */
  deadProviders?: Set<StockProviderId>;
  /** Run-wide tally driving the soft minimum-stock quota. */
  quota?: StockQuotaState;
}): Promise<StockResolution> {
  const { chat, title, narration, imagePrompt, settings, usedUrls, deadProviders, quota } = params;
  const kinds = params.kinds ?? ["video", "image"];
  const requiredConfidence = effectiveMinConfidence(settings, quota, kinds);

  const intent = await buildSearchIntent({ chat, title, narration, imagePrompt });
  const queries = queriesFromIntent(intent, settings);
  const allDiagnostics: ChainDiagnostics[] = [];
  let candidatesSeen = 0;
  let lastReason = "nincs találat egyik providernél sem";

  if (queries.length === 0) {
    return {
      accepted: false,
      reason: "nem sikerült keresőkifejezést előállítani",
      diagnostics: [],
      candidatesSeen: 0,
    };
  }

  for (const kind of kinds) {
    const chain = kind === "video" ? settings.video : settings.image;
    if (!chain.enabled || chain.providers.length === 0) continue;

    const { results, diagnostics } = await searchStockChain({
      kind,
      queries,
      settings,
      usedUrls,
      deadProviders,
    });
    allDiagnostics.push(...diagnostics);
    candidatesSeen += results.length;
    if (results.length === 0) continue;

    const verdict = await verifyCandidates({
      chat,
      narration,
      intent,
      candidates: results,
      settings,
    });

    if (verdict.index !== null && verdict.confidence >= requiredConfidence) {
      return {
        accepted: true,
        result: results[verdict.index],
        confidence: verdict.confidence,
        reason: verdict.reason,
        diagnostics: allDiagnostics,
      };
    }
    lastReason =
      verdict.index === null
        ? verdict.reason || "az ellenőrző egyik jelöltet sem fogadta el"
        : `bizalom ${verdict.confidence} < ${requiredConfidence}${
            requiredConfidence !== settings.minConfidence ? " (kvóta miatt enyhítve)" : ""
          } (${verdict.reason})`;
  }

  return { accepted: false, reason: lastReason, diagnostics: allDiagnostics, candidatesSeen };
}
