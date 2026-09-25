"use client";

import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** Thin bar under the header while the browser reports no network. */
export default function ConnectionStatus() {
  const online = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true
  );
  if (online) return null;

  return (
    <div
      role="status"
      className="border-b border-warning/30 bg-warning-muted px-4 py-2 text-center text-xs text-ink animate-lumen-in"
    >
      Nincs internetkapcsolat — a módosításaid most nem mentődnek. A kapcsolat visszatértével újra működik minden.
    </div>
  );
}
