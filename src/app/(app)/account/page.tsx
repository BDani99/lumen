import { requireUser } from "@/lib/auth";
import { updatePassword } from "@/app/auth/actions";
import { Banner, Button, Input, Label } from "@/components/ui";

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string; type?: string }>;
}) {
  const user = await requireUser();
  const { message, type } = await searchParams;
  const ok = type === "success";

  return (
    <main className="mx-auto max-w-lg px-4 md:px-8 py-8 md:py-10 animate-lumen-in">
      <h1 className="font-display text-3xl tracking-tight text-ink mb-8">Fiók</h1>

      <section className="mb-8">
        <p className="text-sm text-muted mb-1">Email</p>
        <p className="text-ink">{user.email}</p>
      </section>

      <section className="border-t border-border pt-8">
        <h2 className="font-display text-xl text-ink mb-4">Jelszó csere</h2>
        <form className="space-y-4">
          <div>
            <Label htmlFor="password">Új jelszó</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
            />
          </div>
          <div>
            <Label htmlFor="confirm">Új jelszó megerősítése</Label>
            <Input
              id="confirm"
              name="confirm"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
            />
          </div>
          <Button formAction={updatePassword} type="submit">
            Jelszó frissítése
          </Button>
          {message && <Banner tone={ok ? "success" : "error"}>{message}</Banner>}
        </form>
      </section>
    </main>
  );
}
