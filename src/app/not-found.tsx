import Link from "next/link";
import { Button } from "@/components/ui";

export default function RootNotFound() {
  return (
    <main className="app-layer min-h-screen flex flex-col items-center justify-center px-4">
      <p className="font-display text-4xl text-ink mb-2">Lumen</p>
      <h1 className="text-lg text-ink mb-2">Nem található</h1>
      <p className="text-sm text-muted mb-6 text-center max-w-sm">
        Ez az oldal nem létezik, vagy nincs hozzáférésed.
      </p>
      <Link href="/">
        <Button>Kezdőlap</Button>
      </Link>
    </main>
  );
}
