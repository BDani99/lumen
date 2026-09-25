"use client";

import Link from "next/link";
import { FormSection, Label, Select, Toggle } from "@/components/ui";
import type { NamePoolPreset } from "@/lib/name-pools";

export function NamePoolSection({
  useNamePools,
  setUseNamePools,
  namePoolPresetId,
  setNamePoolPresetId,
  namePoolPresets,
  selectedNamePoolPreset,
  presetsError,
  onRetryPresets,
}: {
  useNamePools: boolean;
  setUseNamePools: (value: boolean) => void;
  namePoolPresetId: string;
  setNamePoolPresetId: (value: string) => void;
  namePoolPresets: NamePoolPreset[];
  selectedNamePoolPreset: NamePoolPreset | null;
  /** Set when the preset list failed to load (an empty select is then NOT "no presets"). */
  presetsError?: string | null;
  onRetryPresets?: () => void;
}) {
  return (
    <FormSection
      title="Névkészlet"
      description="Kapcsoló bekapcsolva + a kiválasztott névkészlet minden kategóriájában elég név esetén: az AI ezekből választ, a glossaryba kerülő neveket mentjük (név + utolsó használat), és a gyakori/nemrég használt neveket ritkábbakra cseréljük."
      action={
        <div className="inline-flex items-center gap-2 text-sm text-ink">
          <Toggle checked={useNamePools} onChange={setUseNamePools} label="Névkészlet funkció" />
          <span>Névkészlet funkció</span>
        </div>
      }
    >
      <div>
        <div className="flex items-center justify-between">
          <Label className="mb-0">Névkészlet</Label>
          <Link href="/name-pools" className="text-xs text-accent hover:text-accent-hover">
            Kezelés
          </Link>
        </div>
        <Select value={namePoolPresetId} onChange={(e) => setNamePoolPresetId(e.target.value)}>
          <option value="">Nincs</option>
          {namePoolPresets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        {presetsError && (
          <p className="mt-1.5 text-xs text-danger">
            {presetsError}
            {onRetryPresets && (
              <>
                {" "}
                <button type="button" onClick={onRetryPresets} className="cursor-pointer underline">
                  Újrapróbálás
                </button>
              </>
            )}
          </p>
        )}
      </div>
      {useNamePools &&
        !presetsError &&
        (selectedNamePoolPreset ? (
          <p
            className={`text-xs ${
              selectedNamePoolPreset.categories.every(
                (c) => c.names.length >= selectedNamePoolPreset.minNamesPerCategory
              )
                ? "text-success"
                : "text-danger"
            }`}
          >
            {selectedNamePoolPreset.categories.every(
              (c) => c.names.length >= selectedNamePoolPreset.minNamesPerCategory
            )
              ? `Kész: minden kategória ≥ ${selectedNamePoolPreset.minNamesPerCategory} név — a rotáció aktív lesz generáláskor.`
              : `Még kell: ${selectedNamePoolPreset.categories
                  .map((c) => `${c.label} ${c.names.length}/${selectedNamePoolPreset.minNamesPerCategory}`)
                  .join(", ")}. Addig a funkció nem fut.`}
          </p>
        ) : (
          <p className="text-xs text-danger">Válassz egy névkészletet, különben a funkció nem fut.</p>
        ))}
    </FormSection>
  );
}
