import Link from "next/link";
import { AUTH_LINK_CLASS, AuthShell } from "@/components/auth/AuthShell";
import { ChangePasswordForm } from "@/components/auth/ChangePasswordForm";
import { ErrorState } from "@/components/ui";
import { getSession } from "@/lib/auth";
import { noticeUrl } from "@/lib/notices";
import { redirect } from "next/navigation";

/**
 * Landing page of the password-reset email. /auth/callback has already turned
 * the link's code into a session, so a valid visitor is "signed in" here.
 */
export default async function ResetPasswordPage() {
  const session = await getSession();
  if (session.status === "anonymous") redirect(noticeUrl("link_invalid"));

  if (session.status === "unavailable") {
    return (
      <AuthShell title="Új jelszó beállítása" subtitle="Add meg az új jelszavad">
        <ErrorState title="A szolgáltatás nem érhető el" description={session.message} />
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Új jelszó beállítása"
      subtitle="Add meg az új jelszavad"
      footer={
        <Link href="/login" className={AUTH_LINK_CLASS}>
          &larr; Mégsem
        </Link>
      }
    >
      <ChangePasswordForm
        email={session.user.email ?? undefined}
        redirectTo="/account?updated=1"
        submitLabel="Új jelszó mentése"
      />
    </AuthShell>
  );
}
