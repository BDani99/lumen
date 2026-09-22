import Link from "next/link";
import { Button } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-lg px-4 md:px-8 py-20 text-center animate-lumen-in">
      <h1 className="font-display text-3xl text-ink tracking-tight mb-2">Nem található</h1>
      <p className="text-muted text-sm mb-6">Ez az oldal vagy projekt nem létezik, vagy nincs hozzáférésed.</p>
      <Link href="/">
        <Button>Vissza a projektekhez</Button>
      </Link>
    </main>
  );
}
