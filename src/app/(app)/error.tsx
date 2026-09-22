"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui";
import { logger } from "@/lib/logger";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logger.error("[app/(app)/error]", error);
  }, [error]);

  return (
    <main className="mx-auto max-w-lg px-4 md:px-8 py-20 text-center animate-lumen-in">
      <h1 className="font-display text-3xl text-ink tracking-tight mb-2">Váratlan hiba történt</h1>
      <p className="text-muted text-sm mb-6">
        Hiba történt az oldal betöltésekor. Próbáld újra, vagy térj vissza a projektekhez.
      </p>
      <div className="flex justify-center gap-3">
        <Button onClick={() => reset()}>Újrapróbálás</Button>
        <Link href="/">
          <Button variant="secondary">Vissza a projektekhez</Button>
        </Link>
      </div>
    </main>
  );
}
