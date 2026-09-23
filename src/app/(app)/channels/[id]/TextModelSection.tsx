"use client";

import { FormSection, Label, Select } from "@/components/ui";
import { CostMiniTable } from "@/components/CostMiniTable";
import {
  TEXT_MODEL_OPTIONS,
  estimateScriptGenerationCost,
  estimatePolishCost,
  formatUsd,
  formatUsdPerUnit,
  textModelPrice,
  wordsToTokens,
} from "@/lib/cost-estimate";

export function TextModelSection({
  textModel,
  setTextModel,
  polishModel,
  setPolishModel,
}: {
  textModel: string;
  setTextModel: (value: string) => void;
  polishModel: string;
  setPolishModel: (value: string) => void;
}) {
  return (
    <FormSection title="Szövegmodellek" description="A forgatókönyvírás és a záró simítás modellje.">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div>
        <Label>Szöveg Modell</Label>
        <Select value={textModel} onChange={(e) => setTextModel(e.target.value)}>
          {TEXT_MODEL_OPTIONS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </Select>
        <p className="mt-1.5 text-xs text-muted">Forgatókönyv írásához (outline + chunkok).</p>
        <CostMiniTable
          title="Ár / 1M token"
          rows={[
            { label: "Bemenet", value: formatUsdPerUnit(textModelPrice(textModel).input) },
            { label: "Kimenet", value: formatUsdPerUnit(textModelPrice(textModel).output) },
            {
              label: "Becsült ár (5 perces script)",
              value: formatUsd(estimateScriptGenerationCost(textModel, wordsToTokens(750))),
              active: true,
            },
          ]}
        />
      </div>
      <div>
        <Label>Javító Modell</Label>
        <Select value={polishModel} onChange={(e) => setPolishModel(e.target.value)}>
          {TEXT_MODEL_OPTIONS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </Select>
        <p className="mt-1.5 text-xs text-muted">Minőségi újraírás és végső LLM-simítás.</p>
        <CostMiniTable
          title="Ár / 1M token"
          rows={[
            { label: "Bemenet", value: formatUsdPerUnit(textModelPrice(polishModel).input) },
            { label: "Kimenet", value: formatUsdPerUnit(textModelPrice(polishModel).output) },
            {
              label: "Logikai bíró (1x ellenőrzés)",
              value: formatUsd(
                estimatePolishCost({
                  polishModel,
                  scriptTokens: wordsToTokens(750),
                  logicCheck: true,
                  finalPolish: false,
                })
              ),
            },
            {
              label: "Végső simítás (5 perces script)",
              value: formatUsd(
                estimatePolishCost({
                  polishModel,
                  scriptTokens: wordsToTokens(750),
                  logicCheck: false,
                  finalPolish: true,
                })
              ),
              active: true,
            },
          ]}
        />
      </div>
      </div>
    </FormSection>
  );
}
