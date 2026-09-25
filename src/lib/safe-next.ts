/** Only allow same-origin relative paths for post-login redirects. */
export function safeNext(path: string | null | undefined, fallback = "/"): string {
  if (!path) return fallback;
  const trimmed = path.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return fallback;
  // Browsers treat "/\" like "//" — both would leave the site.
  if (trimmed.includes("\\") || trimmed.includes("://")) return fallback;
  return trimmed;
}
