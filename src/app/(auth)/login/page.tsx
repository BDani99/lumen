import Link from "next/link";
import { AUTH_LINK_CLASS, AuthShell } from "@/components/auth/AuthShell";
import { LoginForm } from "@/components/auth/LoginForm";
import { NOTICES, isNoticeCode } from "@/lib/notices";
import { safeNext } from "@/lib/safe-next";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; next?: string }>;
}) {
  const { notice, next } = await searchParams;
  // Only known codes are rendered — never free text from the URL.
  const noticeData = isNoticeCode(notice) ? NOTICES[notice] : undefined;

  return (
    <AuthShell
      title="Jelentkezz be"
      subtitle="Folytasd a videóid generálását"
      footer={
        <>
          Nincs fiókod?{" "}
          <Link href="/register" className={AUTH_LINK_CLASS}>
            Regisztráció
          </Link>
        </>
      }
    >
      <LoginForm next={safeNext(next)} notice={noticeData} />
    </AuthShell>
  );
}
