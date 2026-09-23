"use client";

import { useState } from "react";
import { Button, FormSection, Textarea } from "@/components/ui";

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
    <FormSection
      title="Mester szkript prompt"
      description="A vágólapra másolt promptot illeszd be a ChatGPT-be és add meg a témádat."
      action={
        <Button type="button" variant="secondary" size="sm" onClick={handleCopyNormalizerPrompt}>
          {copied ? "Másolva!" : "Normalizáló prompt másolása"}
        </Button>
      }
    >
      <Textarea
        value={masterPrompt}
        onChange={(e) => setMasterPrompt(e.target.value)}
        className="h-40 font-mono text-sm"
        placeholder="Írd le részletesen, hogy milyen stílusban generáljon scriptet a modell..."
      />
    </FormSection>
  );
}
