import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import { ErrorState } from "@/components/ui";
import { getSession } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (session.status === "anonymous") redirect("/login");

  // The auth backend being down is not "logged out": keep the user on the page
  // with an explanation and a retry instead of bouncing them to /login.
  if (session.status === "unavailable") {
    return (
      <AppShell email={null}>
        <main className="mx-auto max-w-2xl px-4 md:px-8 py-16">
          <ErrorState title="A szolgáltatás jelenleg nem érhető el" description={session.message} />
        </main>
      </AppShell>
    );
  }

  return <AppShell email={session.user.email}>{children}</AppShell>;
}
