"use client";

import Link from "next/link";
import { useEffect } from "react";
import { GENERIC_ERROR_MESSAGE, NETWORK_ERROR_MESSAGE, isNetworkError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { Button } from "./Button";

/**
 * Body of the `error.tsx` boundaries. The error's own text is never shown:
 * Server Component errors arrive stripped in production anyway (only a
 * `digest`), and client-side ones can carry technical wording. The digest is
 * displayed as a support code that matches the server log.
 */
export function ErrorBoundaryView({
  error,
  onRetry,
  scope,
  homeLabel = "Kezdőlap",
  layout = "page",
}: {
  error: Error & { digest?: string };
  onRetry: () => void;
  scope: string;
  homeLabel?: string;
  layout?: "page" | "fullscreen";
}) {
  useEffect(() => {
    logger.error(`[${scope}]`, error);
  }, [error, scope]);

  const offline = isNetworkError(error) || (typeof navigator !== "undefined" && navigator.onLine === false);

  const content = (
    <>
      <h1 className="font-display text-3xl text-ink tracking-tight mb-2">
        {offline ? "Nincs kapcsolat" : "Váratlan hiba történt"}
      </h1>
      <p className="text-muted text-sm mb-2 max-w-sm mx-auto">
        {offline ? NETWORK_ERROR_MESSAGE : GENERIC_ERROR_MESSAGE}
      </p>
      {error.digest && <p className="font-mono text-xs text-muted mb-6">Hibakód: {error.digest}</p>}
      {!error.digest && <div className="mb-6" />}
      <div className="flex justify-center gap-3">
        <Button onClick={onRetry}>Újrapróbálás</Button>
        <Link href="/">
          <Button variant="secondary">{homeLabel}</Button>
        </Link>
      </div>
    </>
  );

  if (layout === "fullscreen") {
    return (
      <main className="app-layer min-h-screen flex flex-col items-center justify-center px-4 text-center">
        <p className="font-display text-4xl text-ink mb-4">Lumen</p>
        {content}
      </main>
    );
  }
  return (
    <main role="alert" className="mx-auto max-w-lg px-4 md:px-8 py-20 text-center animate-lumen-in">
      {content}
    </main>
  );
}
