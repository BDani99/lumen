import type { ReactNode } from "react";

/** Shared frame for the signed-out pages: brand, heading, the form card, and a footer line. */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="app-layer relative min-h-screen flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md animate-lumen-in">
        <div className="mb-10 text-center">
          <p className="font-display text-4xl md:text-5xl tracking-tight text-ink mb-3">Lumen</p>
          <h1 className="text-lg text-ink font-medium">{title}</h1>
          <p className="mt-1.5 text-sm text-muted">{subtitle}</p>
        </div>

        <div className="rounded-[var(--radius-panel)] border border-border bg-bg-elevated/80 p-6 md:p-8">
          {children}
        </div>

        {footer && <p className="mt-6 text-center text-sm text-muted">{footer}</p>}
      </div>
    </main>
  );
}

export const AUTH_LINK_CLASS =
  "rounded-[var(--radius)] text-accent hover:text-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg";
