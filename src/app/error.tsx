"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui";
import { logger } from "@/lib/logger";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logger.error("[app/error]", error);
  }, [error]);

  return (
    <main className="app-layer min-h-screen flex flex-col items-center justify-center px-4">
      <p className="font-display text-4xl text-ink mb-2">Lumen</p>
      <h1 className="text-lg text-ink mb-2">Váratlan hiba történt</h1>
      <p className="text-sm text-muted mb-6 text-center max-w-sm">
        Hiba történt az oldal betöltésekor. Próbáld újra, vagy térj vissza a kezdőlapra.
      </p>
      <div className="flex gap-3">
        <Button onClick={() => reset()}>Újrapróbálás</Button>
        <Link href="/">
          <Button variant="secondary">Kezdőlap</Button>
        </Link>
      </div>
    </main>
  );
}
