"use client";

import { ErrorBoundaryView } from "@/components/ui/ErrorBoundaryView";

export default function AppError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <ErrorBoundaryView
      error={error}
      onRetry={unstable_retry}
      scope="app/(app)/error"
      homeLabel="Vissza a projektekhez"
    />
  );
}
