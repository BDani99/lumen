import type { ProStockProvider } from "../types";

/** One usable clip/still returned by any free provider. */
export type SourceResult = {
  provider: ProStockProvider;
  /** Direct media URL we can download. */
  url: string;
  kind: "video" | "image";
  width?: number;
  height?: number;
  durationSec?: number;
  /** Human-readable credit line, stored on the shot. */
  attribution: string;
  pageUrl?: string;
};

export type SourceSearch = (query: string, limit: number) => Promise<SourceResult[]>;

/** Shared fetch with a timeout so one slow provider can't stall a workflow step. */
export async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 12_000
): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Prefer landscape, then closest to the wanted duration, then largest. */
export function rankResults(results: SourceResult[], wantSec: number): SourceResult[] {
  return [...results].sort((a, b) => {
    const landscapeA = (a.width || 0) >= (a.height || 0) ? 0 : 1;
    const landscapeB = (b.width || 0) >= (b.height || 0) ? 0 : 1;
    if (landscapeA !== landscapeB) return landscapeA - landscapeB;
    if (a.kind === "video" && b.kind === "video") {
      const da = Math.abs((a.durationSec || 0) - wantSec);
      const db = Math.abs((b.durationSec || 0) - wantSec);
      if (Math.abs(da - db) > 0.5) return da - db;
    }
    return (b.width || 0) - (a.width || 0);
  });
}
