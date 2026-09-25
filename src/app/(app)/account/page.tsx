import { ChangePasswordForm } from "@/components/auth/ChangePasswordForm";
import { Banner } from "@/components/ui";
import { requireUser } from "@/lib/auth";

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ updated?: string }>;
}) {
  const user = await requireUser();
  const { updated } = await searchParams;

  return (
    <main className="mx-auto max-w-lg px-4 md:px-8 py-8 md:py-10 animate-lumen-in">
      <h1 className="font-display text-3xl tracking-tight text-ink mb-8">Fiók</h1>

      {updated === "1" && (
        <div className="mb-6">
          <Banner tone="success">A jelszavad sikeresen frissítve.</Banner>
        </div>
      )}

      <section className="mb-8">
        <p className="text-sm text-muted mb-1">Email</p>
        <p className="text-ink">{user.email}</p>
      </section>

      <section className="border-t border-border pt-8">
        <h2 className="font-display text-xl text-ink mb-4">Jelszó csere</h2>
        <ChangePasswordForm email={user.email ?? undefined} />
      </section>
    </main>
  );
}
