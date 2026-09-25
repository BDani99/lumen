"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/app/auth/actions";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui";
import ConnectionStatus from "@/components/ConnectionStatus";
import { FOCUS_RING } from "@/lib/ui-tokens";

const NAV = [
  { href: "/", label: "Projektek" },
  { href: "/channels", label: "Csatornák" },
  { href: "/dictionaries", label: "Kiejtés" },
  { href: "/name-pools", label: "Névkészletek" },
];

export default function AppShell({
  email,
  children,
}: {
  email?: string | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const compact = /\/projects\/[^/]+\/editor/.test(pathname);

  return (
    <div className="app-layer min-h-screen flex flex-col">
      <header
        className={cn(
          "sticky top-0 z-40 border-b border-border/80 bg-bg/85 backdrop-blur-md animate-lumen-in",
          compact ? "px-3 py-2.5 md:px-4" : "px-4 py-3.5 md:px-8"
        )}
      >
        <div
          className={cn(
            "mx-auto flex items-center justify-between gap-4",
            compact ? "max-w-none" : "max-w-6xl"
          )}
        >
          <div className="flex items-center gap-6 min-w-0">
            <Link href="/" className="shrink-0 group cursor-pointer">
              <span className="font-display text-xl md:text-2xl tracking-tight text-ink group-hover:text-accent transition-colors">
                Lumen
              </span>
            </Link>
            {!compact && (
              <nav className="hidden sm:flex items-center gap-1">
                {NAV.map((item) => {
                  const active =
                    item.href === "/"
                      ? pathname === "/"
                      : pathname.startsWith(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "cursor-pointer rounded-[var(--radius)] px-3 py-1.5 text-sm transition-colors",
                        FOCUS_RING,
                        active
                          ? "bg-accent-muted text-ink"
                          : "text-muted hover:text-ink hover:bg-surface"
                      )}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {email && (
              <span
                className="hidden md:inline max-w-[12rem] truncate text-xs text-muted"
                title={email}
              >
                {email}
              </span>
            )}
            <Link
              href="/account"
              className={cn(
                "cursor-pointer rounded-[var(--radius)] px-3 py-1.5 text-sm transition-colors",
                pathname.startsWith("/account")
                  ? "bg-accent-muted text-ink"
                  : "text-muted hover:text-ink hover:bg-surface"
              )}
            >
              Fiók
            </Link>
            <form action={logout}>
              <Button type="submit" variant="ghost" size="sm">
                Kilépés
              </Button>
            </form>
          </div>
        </div>
      </header>
      <ConnectionStatus />
      <div className="flex-1">{children}</div>
    </div>
  );
}
