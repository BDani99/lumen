import Link from "next/link";
import { AUTH_LINK_CLASS, AuthShell } from "@/components/auth/AuthShell";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Elfelejtett jelszó"
      subtitle="Küldünk egy linket, amivel új jelszót állíthatsz be"
      footer={
        <Link href="/login" className={AUTH_LINK_CLASS}>
          &larr; Vissza a bejelentkezéshez
        </Link>
      }
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
