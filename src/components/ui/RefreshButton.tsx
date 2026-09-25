"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "./Button";

/** Re-runs the current route's server data fetching — the "Újrapróbálás" for server-rendered error states. */
export function RefreshButton({ label = "Újrapróbálás" }: { label?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button loading={pending} onClick={() => startTransition(() => router.refresh())}>
      {label}
    </Button>
  );
}
