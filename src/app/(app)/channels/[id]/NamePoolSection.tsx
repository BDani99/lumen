"use client";

import Link from "next/link";
import { Label, Select } from "@/components/ui";
import type { NamePoolPreset } from "@/lib/name-pools";

export function NamePoolSection({
  useNamePools,
  setUseNamePools,
  namePoolPresetId,
  setNamePoolPresetId,
  namePoolPresets,
  selectedNamePoolPreset,
}: {
  useNamePools: boolean;
  setUseNamePools: (value: boolean) => void;
  namePoolPresetId: string;
  setNamePoolPresetId: (value: string) => void;
  namePoolPresets: NamePoolPreset[];
  selectedNamePoolPreset: NamePoolPreset | null;
}) {
  return (
    <div className="space-y-3 border-t border-border pt-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-ink">Névkészlet</p>
          <p className="mt-1 text-xs text-muted">
            Kapcsoló bekapcsolva + a kiválasztott névkészlet minden kategóriájában elég név
            esetén: az AI ezekből választ, a glossaryba kerülő neveket mentjük (név + utolsó
            használat), és a gyakori/nemrég használt neveket ritkábbakra cseréljük.
          </p>
        </div>
        <label className="inline-flex items-center gap-2 shrink-0 cursor-pointer text-sm text-ink">
          <input
            type="checkbox"
            checked={useNamePools}
            onChange={(e) => setUseNamePools(e.target.checked)}
            className="w-5 h-5 accent-[var(--accent)] cursor-pointer"
          />
          Névkészlet funkció
        </label>
      </div>
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
      </div>
      {useNamePools &&
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
    </div>
  );
}
