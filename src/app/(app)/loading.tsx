export default function AppLoading() {
  return (
    <div className="app-layer mx-auto max-w-6xl px-4 md:px-8 py-10 animate-lumen-in">
      <div className="h-8 w-48 rounded-[var(--radius)] bg-surface mb-8" />
      <div className="space-y-3">
        <div className="h-14 rounded-[var(--radius-panel)] bg-surface/80" />
        <div className="h-14 rounded-[var(--radius-panel)] bg-surface/60" />
        <div className="h-14 rounded-[var(--radius-panel)] bg-surface/40" />
      </div>
    </div>
  );
}
