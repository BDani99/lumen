import Link from "next/link";
import { AUTH_LINK_CLASS, AuthShell } from "@/components/auth/AuthShell";
import { RegisterForm } from "@/components/auth/RegisterForm";

export default function RegisterPage() {
  return (
    <AuthShell
      title="Fiók létrehozása"
      subtitle="Saját csatornák és videók egy helyen"
      footer={
        <>
          Van már fiókod?{" "}
          <Link href="/login" className={AUTH_LINK_CLASS}>
            Bejelentkezés
          </Link>
        </>
      }
    >
      <RegisterForm />
    </AuthShell>
  );
}
