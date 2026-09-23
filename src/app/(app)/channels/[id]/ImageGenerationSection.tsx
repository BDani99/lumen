"use client";

import { FormSection, FormSubsection, Input, Label, Select, Textarea, Toggle } from "@/components/ui";
import { CostMiniTable } from "@/components/CostMiniTable";
import { StockSettingsPanel } from "@/components/StockSettingsPanel";
import { IMAGE_COST_USD, formatUsdPerUnit } from "@/lib/cost-estimate";
import type { StockSettings } from "@/lib/stock/types";

export function ImageGenerationSection({
  imageModel,
  setImageModel,
  sentencesPerImage,
  setSentencesPerImage,
  useStockVideo,
  setUseStockVideo,
  stockSettings,
  setStockSettings,
  useLocationShots,
  setUseLocationShots,
  locationShotSec,
  setLocationShotSec,
  autoZoomEffect,
  setAutoZoomEffect,
  autoZoomLevel,
  setAutoZoomLevel,
  audioVolume,
  setAudioVolume,
  imageStyle,
  setImageStyle,
  imagePromptBase,
  setImagePromptBase,
  thumbnailPrompt,
  setThumbnailPrompt,
  autoGenerateThumbnail,
  setAutoGenerateThumbnail,
  useCharacterGlossaryForThumbnails,
  setUseCharacterGlossaryForThumbnails,
}: {
  imageModel: string;
  setImageModel: (value: string) => void;
  sentencesPerImage: number;
  setSentencesPerImage: (value: number) => void;
  useStockVideo: boolean;
  setUseStockVideo: (value: boolean) => void;
  stockSettings: StockSettings;
  setStockSettings: (value: StockSettings) => void;
  useLocationShots: boolean;
  setUseLocationShots: (value: boolean) => void;
  locationShotSec: number;
  setLocationShotSec: (value: number) => void;
  autoZoomEffect: boolean;
  setAutoZoomEffect: (value: boolean) => void;
  autoZoomLevel: number;
  setAutoZoomLevel: (value: number) => void;
  audioVolume: number;
  setAudioVolume: (value: number) => void;
  imageStyle: string;
  setImageStyle: (value: string) => void;
  imagePromptBase: string;
  setImagePromptBase: (value: string) => void;
  thumbnailPrompt: string;
  setThumbnailPrompt: (value: string) => void;
  autoGenerateThumbnail: boolean;
  setAutoGenerateThumbnail: (value: boolean) => void;
  useCharacterGlossaryForThumbnails: boolean;
  setUseCharacterGlossaryForThumbnails: (value: boolean) => void;
}) {
  return (
    <>
      <FormSection title="Képgenerálás" description="A jelenetképek modellje, gyakorisága és stílusa.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <Label>Kép modell</Label>
            <Select value={imageModel} onChange={(e) => setImageModel(e.target.value)}>
              <option value="gpt-image-2 low">GPT Image 2 (Low)</option>
              <option value="gpt-image-2 standard">GPT Image 2 (Standard)</option>
            </Select>
            <CostMiniTable
              title="Ár / kép"
              rows={[
                {
                  label: "Low",
                  value: formatUsdPerUnit(IMAGE_COST_USD.low),
                  active: imageModel === "gpt-image-2 low",
                },
                {
                  label: "Standard",
                  value: formatUsdPerUnit(IMAGE_COST_USD.standard),
                  active: imageModel === "gpt-image-2 standard",
                },
              ]}
            />
          </div>
          <div>
            <Label>Gyakoriság (mondat / kép)</Label>
            <Input
              type="number"
              min="1"
              max="50"
              value={sentencesPerImage}
              onChange={(e) => setSentencesPerImage(parseInt(e.target.value) || 2)}
              placeholder="Pl. 2 (Minden 2. mondatnál új kép)"
            />
          </div>
        </div>
        <div>
          <Label>Képstílus</Label>
          <Input
            type="text"
            value={imageStyle}
            onChange={(e) => setImageStyle(e.target.value)}
            placeholder="Pl. ultrarealisztikus, filmes világítás, stickman, anime..."
          />
        </div>
      </FormSection>

      <FormSection title="Média-források és effektek" description="Honnan jöjjön a vizuál, és hogyan mozogjon/hangozzon.">
        <FormSubsection title="Ingyenes stock tartalom">
          <div className="flex items-center gap-3">
            <Toggle
              checked={useStockVideo}
              onChange={setUseStockVideo}
              label="Ingyenes stock tartalom használata AI generálás helyett"
            />
            <span className="text-sm text-ink">Használat AI generálás helyett, ha talál megfelelőt</span>
          </div>
          <p className="text-xs text-muted">
            Több provideren végigmenő keresés, szigorú AI egyezés-ellenőrzéssel: csak akkor
            használunk stock anyagot, ha tényleg illik a jelenethez — különben AI kép készül.
          </p>
          {useStockVideo && <StockSettingsPanel value={stockSettings} onChange={setStockSettings} />}
        </FormSubsection>

        <FormSubsection title="Helyszín-bevezető képek">
          <div className="flex items-center gap-3">
            <Toggle checked={useLocationShots} onChange={setUseLocationShots} label="Helyszín-bevezető képek" />
            <span className="text-sm text-ink">Külön bevezető kép egy jelenet új helyszínéhez</span>
          </div>
          <p className="text-xs text-muted">
            Ha egy jelenet új helyszínre visz, előbb egy rövid kép jelenik meg magáról a helyszínről,
            és csak utána a jelenethez tartozó vizuál. Ugyanaz a helyszín csak az első alkalommal kap
            bevezetőt — visszatéréskor nem ismétlődik.
          </p>
          {useLocationShots && (
            <div className="max-w-[16rem]">
              <Label htmlFor="locationShotSec">Bevezető hossza (mp)</Label>
              <Input
                id="locationShotSec"
                type="number"
                min={0.5}
                max={15}
                step={0.5}
                value={locationShotSec}
                onChange={(e) => setLocationShotSec(Math.max(0.5, Number(e.target.value) || 3))}
              />
            </div>
          )}
        </FormSubsection>

        <FormSubsection title="Zoom és hangerő">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Toggle checked={autoZoomEffect} onChange={setAutoZoomEffect} label="Automatikus zoom effektek" />
              <span className="text-sm text-ink">Automatikus zoom (véletlenszerű In / Out)</span>
            </div>
            {autoZoomEffect && (
              <div className="flex items-center gap-2">
                <label className="text-sm text-muted" htmlFor="autoZoomLevel">
                  Mértéke (%):
                </label>
                <Input
                  id="autoZoomLevel"
                  type="number"
                  min="100"
                  max="200"
                  value={autoZoomLevel}
                  onChange={(e) => setAutoZoomLevel(Number(e.target.value))}
                  className="w-20 text-center"
                />
              </div>
            )}
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex flex-col">
              <label htmlFor="audioVolume" className="text-sm text-ink">
                Videó hangerő (alapértelmezett: 100%)
              </label>
              <span className="text-xs text-muted mt-0.5">
                Növeld vagy csökkentsd a generált hangerejét a videószerkesztőben.
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                id="audioVolume"
                min="0"
                max="500"
                value={audioVolume}
                onChange={(e) => setAudioVolume(Number(e.target.value))}
                className="w-20 text-center"
              />
              <span className="text-muted text-sm">%</span>
            </div>
          </div>
        </FormSubsection>
      </FormSection>

      <FormSection title="Promptok" description="A képgenerálás alap-szabályai és a borítókép stílusa.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label>Képgeneráló alap prompt (kritikus szabályok)</Label>
            <Textarea
              value={imagePromptBase}
              onChange={(e) => setImagePromptBase(e.target.value)}
              className="h-32 font-mono text-sm"
              placeholder="Pl. Do not include any text, letters, or words in the image..."
            />
          </div>
          <div className="space-y-2">
            <Label>Thumbnail prompt (bélyegkép stílusa)</Label>
            <Textarea
              value={thumbnailPrompt}
              onChange={(e) => setThumbnailPrompt(e.target.value)}
              className="h-32 font-mono text-sm"
              placeholder="Pl. High contrast YouTube thumbnail, expressive faces, glowing background..."
            />
            <div className="flex flex-col gap-3 pt-1">
              <div className="flex items-center gap-3">
                <Toggle
                  checked={autoGenerateThumbnail}
                  onChange={setAutoGenerateThumbnail}
                  label="Borítókép automatikus generálása a videóval együtt"
                />
                <span className="text-sm text-muted">
                  Borítókép automatikus generálása a videóval együtt
                </span>
              </div>
              <div className="flex items-center gap-3">
                <Toggle
                  checked={useCharacterGlossaryForThumbnails}
                  onChange={setUseCharacterGlossaryForThumbnails}
                  label="Karakterleírások elküldése az AI-nak a borítókép generáláshoz"
                />
                <span className="text-sm text-muted">
                  Karakterleírások elküldése az AI-nak a borítókép generáláshoz
                </span>
              </div>
            </div>
          </div>
        </div>
      </FormSection>
    </>
  );
}
