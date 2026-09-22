import { requireUser } from "@/lib/auth";
import DictionariesManager from "./DictionariesManager";

export const revalidate = 0;

export default async function DictionariesPage() {
  await requireUser();

  return (
    <main className="mx-auto max-w-4xl px-4 md:px-8 py-8 md:py-10 animate-lumen-in">
      <div className="mb-8">
        <h1 className="font-display text-3xl md:text-4xl tracking-tight text-ink">
          Kiejtési szótárak
        </h1>
        <p className="mt-1.5 text-sm text-muted">
          AI33 kiejtési szabályok (pl. márkanevek, idegen szavak helyes kimondása) — csak a hangot
          módosítják, a leírt szöveg változatlan marad. Bármelyik csatorna hangbeállításánál
          kiválasztható.
        </p>
      </div>
      <DictionariesManager />
    </main>
  );
}
