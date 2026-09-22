import Link from "next/link";
import { login } from "@/app/auth/actions";
import { Banner, Button, Input, Label } from "@/components/ui";
import { safeNext } from "@/lib/safe-next";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string; next?: string }>;
}) {
  const { message, next } = await searchParams;
  const nextPath = safeNext(next);
  const isSuccess =
    message?.toLowerCase().includes("sikeres") ||
    message?.toLowerCase().includes("erősítsd");

  return (
    <main className="app-layer relative min-h-screen flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md animate-lumen-in">
        <div className="mb-10 text-center">
          <p className="font-display text-4xl md:text-5xl tracking-tight text-ink mb-3">Lumen</p>
          <h1 className="text-lg text-ink font-medium">Jelentkezz be</h1>
          <p className="mt-1.5 text-sm text-muted">Folytasd a videóid generálását</p>
        </div>

        <form className="space-y-4 rounded-[var(--radius-panel)] border border-border bg-bg-elevated/80 p-6 md:p-8">
          <input type="hidden" name="next" value={nextPath} />
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <div>
            <Label htmlFor="password">Jelszó</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>
          <Button formAction={login} type="submit" className="w-full">
            Bejelentkezés
          </Button>
          {message && (
            <Banner tone={isSuccess ? "success" : "error"}>{message}</Banner>
          )}
        </form>

        <p className="mt-6 text-center text-sm text-muted">
          Nincs fiókod?{" "}
          <Link href="/register" className="text-accent hover:text-accent-hover">
            Regisztráció
          </Link>
        </p>
      </div>
    </main>
  );
}
