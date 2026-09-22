/** Retired / superseded OpenRouter model slugs → current replacements. */
const RETIRED_MODEL_IDS: Record<string, string> = {
  "anthropic/claude-3.5-sonnet": "anthropic/claude-sonnet-5",
  "anthropic/claude-sonnet-4.6": "anthropic/claude-sonnet-5",
};

export function resolveOpenRouterModelId(model: string | null | undefined): string {
  const id = (model || "").trim();
  if (!id) return id;
  return RETIRED_MODEL_IDS[id] || id;
}
