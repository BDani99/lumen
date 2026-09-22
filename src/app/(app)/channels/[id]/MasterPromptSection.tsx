"use client";

import { useState } from "react";
import { Button, Label, Textarea } from "@/components/ui";

const NORMALIZER_PROMPT_TEMPLATE = `Te egy profi prompt mérnök vagy. A feladatod, hogy az általam megadott nyers csatorna-ötletből egy angol nyelvű 'Mester Prompt'-ot (System Prompt) generálj egy YouTube forgatókönyvíró AI számára.\n\nA Mester Promptnak az alábbi szabályokat kell követnie, hogy a videógeneráló szoftverünk ideálisan tudja használni:\n1. Szerepkör: "You are an expert YouTube scriptwriter..."\n2. Stílus: Részletezd a hangvételt, célközönséget, stílust.\n3. Tiltások (Kritikus!): "You must write ONLY the pure spoken narrative text. Do NOT include any stage directions, formatting, visual cues, sound effects, or character names in brackets (e.g., no [Music], [Scene 1], [Visual])."\n4. Mondatszerkezet: Kérd meg az AI-t, hogy tartsa a mondatokat viszonylag röviden a könnyebb szövegfelolvasás (TTS) és képgenerálás érdekében.\n\nÍrd meg a Mester Promptot az alábbi nyers ötlet alapján. Csak az angol nyelvű promptot add vissza:\n[ÍRD IDE AZ EREDETI NYERS ÖTLETEDET / PROMPTODAT]`;

export function MasterPromptSection({
  masterPrompt,
  setMasterPrompt,
}: {
  masterPrompt: string;
  setMasterPrompt: (value: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopyNormalizerPrompt = () => {
    navigator.clipboard.writeText(NORMALIZER_PROMPT_TEMPLATE);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="mb-0">Mester Szkript Prompt</Label>
        <Button
          type="button"
          variant="secondary"
          className="!px-2 !py-1 text-xs"
          onClick={handleCopyNormalizerPrompt}
        >
          {copied ? "Másolva!" : "Normalizáló Prompt Másolása"}
        </Button>
      </div>
      <p className="text-xs text-muted">
        A vágólapra másolt promptot illeszd be a ChatGPT-be és add meg a témádat.
      </p>
      <Textarea
        value={masterPrompt}
        onChange={(e) => setMasterPrompt(e.target.value)}
        className="h-40 font-mono text-sm"
        placeholder="Írd le részletesen, hogy milyen stílusban generáljon scriptet a modell..."
      />
    </div>
  );
}
