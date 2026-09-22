import { requireUser } from "@/lib/auth";
import NamePoolPresetsManager from "./NamePoolPresetsManager";

export const revalidate = 0;

export default async function NamePoolsPage() {
  await requireUser();

  return (
    <main className="mx-auto max-w-4xl px-4 md:px-8 py-8 md:py-10 animate-lumen-in">
      <div className="mb-8">
        <h1 className="font-display text-3xl md:text-4xl tracking-tight text-ink">Névkészletek</h1>
        <p className="mt-1.5 text-sm text-muted">
          Újrafelhasználható névlisták tetszőleges kategóriákkal (pl. férfi/női keresztnevek,
          vezetéknevek, egyedi kategóriák) — bármelyik csatornán kiválasztható. Egy kategória csak
          akkor aktiválódik generáláskor, ha eléri a beállított minimum név/kategória számot.
        </p>
      </div>
      <NamePoolPresetsManager />
    </main>
  );
}
