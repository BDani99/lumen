"use client";

import { Banner, Button, Textarea } from "@/components/ui";
import { cn } from "@/lib/cn";

/** Narration/script panel — draft editing while the project is in Script_Review. */
export function ScriptPanel({
  isScriptReview,
  scriptDraft,
  setScriptDraft,
  generatedScript,
  scriptBusy,
  onSave,
  onContinue,
  onRegenerate,
}: {
  isScriptReview: boolean;
  scriptDraft: string;
  setScriptDraft: (value: string) => void;
  generatedScript: string | null | undefined;
  scriptBusy: boolean;
  onSave: () => void;
  onContinue: () => void;
  onRegenerate: () => void;
}) {
  return (
    <section className="border-b lg:border-b-0 lg:border-r border-border p-3 md:p-4 overflow-y-auto order-3 lg:order-1">
      <h2 className="font-display text-base text-ink mb-2">Narráció</h2>
      {isScriptReview && (
        <Banner tone="warning" className="mb-3 !py-2 text-xs">
          Átnézésre vár. Szerkeszd, majd folytasd a hanggal — vagy kérj új AI-szöveget.
        </Banner>
      )}
      <Textarea
        className={cn(
          "w-full h-64 lg:h-[calc(100%-5rem)] min-h-[12rem] font-mono text-xs !resize-y",
          isScriptReview && "border-accent/40"
        )}
        value={isScriptReview ? scriptDraft : generatedScript || ""}
        onChange={isScriptReview ? (e) => setScriptDraft(e.target.value) : undefined}
        readOnly={!isScriptReview}
      />
      {isScriptReview && (
        <div className="mt-3 flex flex-col gap-2">
          <Button onClick={onContinue} disabled={scriptBusy}>
            {scriptBusy ? "…" : "Folytatás hanggal"}
          </Button>
          <Button variant="secondary" onClick={onSave} disabled={scriptBusy}>
            Mentés
          </Button>
          <Button variant="ghost" onClick={onRegenerate} disabled={scriptBusy}>
            Újragenerálás
          </Button>
        </div>
      )}
    </section>
  );
}
