"use client";

import { useEffect } from "react";
import "./globals.css";

/**
 * Last-resort boundary: replaces the root layout when that itself fails, so it
 * brings its own <html>/<body> and uses plain elements (no app providers).
 */
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[app/global-error]", error);
  }, [error]);

  return (
    <html lang="hu">
      <body className="app-layer min-h-screen flex flex-col items-center justify-center px-4 text-center font-sans">
        <p className="font-display text-4xl text-ink mb-4">Lumen</p>
        <h1 className="text-2xl text-ink mb-2">Váratlan hiba történt</h1>
        <p className="text-sm text-muted mb-2 max-w-sm">
          Az alkalmazás nem tudott betöltődni. Próbáld újra, és ha a hiba marad, jelezd az üzemeltetőnek.
        </p>
        {error.digest && <p className="font-mono text-xs text-muted mb-6">Hibakód: {error.digest}</p>}
        <button
          type="button"
          onClick={() => unstable_retry()}
          className="mt-4 cursor-pointer rounded-[var(--radius)] bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-accent-hover"
        >
          Újrapróbálás
        </button>
      </body>
    </html>
  );
}
