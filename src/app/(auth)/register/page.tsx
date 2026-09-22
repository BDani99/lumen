import Link from "next/link";
import { signup } from "@/app/auth/actions";
import { Banner, Button, Input, Label } from "@/components/ui";

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const { message } = await searchParams;

  return (
    <main className="app-layer relative min-h-screen flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md animate-lumen-in">
        <div className="mb-10 text-center">
          <p className="font-display text-4xl md:text-5xl tracking-tight text-ink mb-3">Lumen</p>
          <h1 className="text-lg text-ink font-medium">Fiók létrehozása</h1>
          <p className="mt-1.5 text-sm text-muted">Saját csatornák és videók egy helyen</p>
        </div>

        <form className="space-y-4 rounded-[var(--radius-panel)] border border-border bg-bg-elevated/80 p-6 md:p-8">
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
              autoComplete="new-password"
              required
              minLength={8}
            />
            <p className="mt-1 text-xs text-muted">Legalább 8 karakter</p>
          </div>
          <div>
            <Label htmlFor="confirm">Jelszó megerősítése</Label>
            <Input
              id="confirm"
              name="confirm"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
            />
          </div>
          <Button formAction={signup} type="submit" className="w-full">
            Regisztráció
          </Button>
          {message && <Banner tone="error">{message}</Banner>}
        </form>

        <p className="mt-6 text-center text-sm text-muted">
          Van már fiókod?{" "}
          <Link href="/login" className="text-accent hover:text-accent-hover">
            Bejelentkezés
          </Link>
        </p>
      </div>
    </main>
  );
}
