"use client";

import { useMemo, useState } from "react";
import { Banner, Input, Label, Select, Toggle } from "@/components/ui";
import { CostMiniTable } from "@/components/CostMiniTable";
import { formatUsd, TEXT_MODEL_OPTIONS } from "@/lib/cost-estimate";
import { WAN_MODEL_OPTIONS } from "@/lib/video-mode";
import { estimateProCost } from "@/lib/pro/cost";
import {
  DEFAULT_PRO_PRESET,
  PRO_PRESET_HINTS,
  PRO_PRESET_LABELS,
  proSettingsForPreset,
} from "@/lib/pro/presets";
import {
  PRO_SOURCE_KINDS,
  PRO_SOURCE_LABELS,
  PRO_STOCK_PROVIDER_LABELS,
  type ProPresetId,
  type ProSettings,
  type ProSourceKind,
  type ProStockProvider,
} from "@/lib/pro/types";

/**
 * The Pro tab of the New Video modal. Every knob the Pro pipeline reads is
 * exposed here; picking a preset fills them all, and changing any single one
 * flips the preset to "Egyedi" without losing the other values.
 */
export function ProVideoForm({
  settings,
  setSettings,
  durationMinutes,
  scriptChars,
  scriptWords,
  hasCustomScript,
  channel,
}: {
  settings: ProSettings;
  setSettings: (s: ProSettings) => void;
  durationMinutes: number;
  scriptChars?: number;
  scriptWords?: number;
  hasCustomScript: boolean;
  channel: any;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  /** Any manual edit means the values no longer match a named preset. */
  const patch = (partial: Partial<ProSettings>) => {
    setSettings({ ...settings, ...partial, presetId: "custom" });
  };

  const applyPreset = (id: ProPresetId) => {
    if (id === "custom") {
      setSettings({ ...settings, presetId: "custom" });
      return;
    }
    setSettings(proSettingsForPreset(id));
  };

  const breakdown = useMemo(
    () =>
      estimateProCost({
        settings,
        durationMinutes,
        scriptChars,
        scriptWords,
        hasCustomScript,
        voiceProvider: channel?.ai33_voice_settings?.provider,
        voiceModelId: channel?.ai33_voice_settings?.modelId,
        textModel: settings.textModel || channel?.text_model,
      }),
    [settings, durationMinutes, scriptChars, scriptWords, hasCustomScript, channel]
  );

  const mixTotal = PRO_SOURCE_KINDS.reduce((sum, k) => sum + settings.sourceMix[k], 0) || 1;

  return (
    <div className="space-y-4">
      <Banner tone="info">
        A Pro mód a narráció valódi ritmusához igazítja a vágásokat, és vegyes
        forrásokból (AI kép, AI mozgóklip, ingyenes stock és közkincs archív)
        építi a képi világot. A kimenet többsávos DaVinci projekt.
      </Banner>

      {/* Preset */}
      <div>
        <Label htmlFor="pro-preset">Minőségi szint</Label>
        <Select
          id="pro-preset"
          value={settings.presetId}
          onChange={(e) => applyPreset(e.target.value as ProPresetId)}
        >
          {(["budget", "balanced", "premium", "custom"] as ProPresetId[]).map((id) => (
            <option key={id} value={id}>
              {PRO_PRESET_LABELS[id]}
            </option>
          ))}
        </Select>
        <p className="mt-1.5 text-xs text-muted">{PRO_PRESET_HINTS[settings.presetId]}</p>
      </div>

      {/* Budget */}
      <div>
        <Label htmlFor="pro-budget">Költségkeret (USD)</Label>
        <Input
          id="pro-budget"
          type="number"
          min={0}
          step={0.5}
          value={settings.budgetUsd}
          onChange={(e) => patch({ budgetUsd: Number(e.target.value) || 0 })}
        />
        <p className="mt-1.5 text-xs text-muted">
          Kemény plafon: ha a terv túllépné, a drágább AI klipek helyett ingyenes
          forrás vagy újrahasznosított kép kerül a helyükre — a videó sosem marad csonka.
        </p>
      </div>

      {/* Source mix */}
      <div className="space-y-3 rounded-[var(--radius)] border border-border p-3">
        <div className="text-sm font-medium text-ink">Forrásarányok</div>
        <p className="text-xs text-muted">
          Relatív súlyok — a tervező ezek arányában osztja szét a {breakdown.totalShots} shotot.
          A 0 kikapcsolja az adott forrást.
        </p>
        {PRO_SOURCE_KINDS.map((kind: ProSourceKind) => (
          <div key={kind} className="flex items-center gap-3">
            <span className="w-40 shrink-0 text-xs text-ink">{PRO_SOURCE_LABELS[kind]}</span>
            <input
              type="range"
              min={0}
              max={100}
              value={settings.sourceMix[kind]}
              onChange={(e) =>
                patch({
                  sourceMix: { ...settings.sourceMix, [kind]: Number(e.target.value) },
                })
              }
              className="flex-1 accent-[var(--accent)]"
            />
            <span className="w-24 shrink-0 text-right font-mono text-xs text-muted">
              {Math.round((settings.sourceMix[kind] / mixTotal) * 100)}% ·{" "}
              {breakdown.allocation[kind]} db
            </span>
          </div>
        ))}
      </div>

      {/* Free providers */}
      <div className="space-y-2 rounded-[var(--radius)] border border-border p-3">
        <div className="text-sm font-medium text-ink">Ingyenes források</div>
        {(Object.keys(PRO_STOCK_PROVIDER_LABELS) as ProStockProvider[]).map((p) => (
          <Toggle
            key={p}
            checked={settings.stockProviders[p]}
            onChange={(v) =>
              patch({ stockProviders: { ...settings.stockProviders, [p]: v } })
            }
            label={PRO_STOCK_PROVIDER_LABELS[p]}
          />
        ))}
        <p className="text-xs text-muted">
          Pexels/Pixabay: modern stock felvételek. Wikimedia/Internet Archive:
          közkincs archív — történelmi témáknál ez adja a hitelességet.
        </p>
      </div>

      {/* Cadence */}
      <div className="space-y-3 rounded-[var(--radius)] border border-border p-3">
        <div className="text-sm font-medium text-ink">Vágási ritmus</div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="pro-min">Legrövidebb shot (mp)</Label>
            <Input
              id="pro-min"
              type="number"
              min={1}
              max={20}
              step={0.5}
              value={settings.cadence.minShotSec}
              onChange={(e) =>
                patch({
                  cadence: { ...settings.cadence, minShotSec: Number(e.target.value) || 2 },
                })
              }
            />
          </div>
          <div>
            <Label htmlFor="pro-max">Leghosszabb shot (mp)</Label>
            <Input
              id="pro-max"
              type="number"
              min={1.5}
              max={30}
              step={0.5}
              value={settings.cadence.maxShotSec}
              onChange={(e) =>
                patch({
                  cadence: { ...settings.cadence, maxShotSec: Number(e.target.value) || 6 },
                })
              }
            />
          </div>
        </div>
        <div>
          <Label htmlFor="pro-energy">Tempó</Label>
          <Select
            id="pro-energy"
            value={settings.cadence.energy}
            onChange={(e) =>
              patch({
                cadence: { ...settings.cadence, energy: e.target.value as "slow" | "normal" | "fast" },
              })
            }
          >
            <option value="slow">Nyugodt</option>
            <option value="normal">Normál</option>
            <option value="fast">Pörgős</option>
          </Select>
        </div>
        <Toggle
          checked={settings.cadence.snapToSentences}
          onChange={(v) => patch({ cadence: { ...settings.cadence, snapToSentences: v } })}
          label="Vágás mondathatárokra igazítva"
        />
        <p className="text-xs text-muted">
          Becsült shotszám: <span className="font-mono text-ink">{breakdown.totalShots}</span>
        </p>
      </div>

      {/* Overlays */}
      <div className="space-y-3 rounded-[var(--radius)] border border-border p-3">
        <Toggle
          checked={settings.overlays.enabled}
          onChange={(v) => patch({ overlays: { ...settings.overlays, enabled: v } })}
          label="Képernyőn megjelenő szöveg (külön sávon)"
        />
        {settings.overlays.enabled && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="pro-kw">Kulcsszó / perc</Label>
                <Input
                  id="pro-kw"
                  type="number"
                  min={0}
                  max={20}
                  value={settings.overlays.keywordsPerMinute}
                  onChange={(e) =>
                    patch({
                      overlays: {
                        ...settings.overlays,
                        keywordsPerMinute: Number(e.target.value) || 0,
                      },
                    })
                  }
                />
              </div>
              <div>
                <Label htmlFor="pro-font">Betűtípus</Label>
                <Select
                  id="pro-font"
                  value={settings.overlays.fontFamily}
                  onChange={(e) =>
                    patch({
                      overlays: {
                        ...settings.overlays,
                        fontFamily: e.target.value as "Montserrat" | "Inter",
                      },
                    })
                  }
                >
                  <option value="Montserrat">Montserrat</option>
                  <option value="Inter">Inter</option>
                </Select>
              </div>
            </div>
            <Toggle
              checked={settings.overlays.lowerThirds}
              onChange={(v) => patch({ overlays: { ...settings.overlays, lowerThirds: v } })}
              label="Lower third (név / évszám / helyszín)"
            />
          </>
        )}
      </div>

      <button
        type="button"
        onClick={() => setShowAdvanced((v) => !v)}
        className="cursor-pointer text-xs text-accent hover:text-accent-hover"
      >
        {showAdvanced ? "▾ Haladó beállítások elrejtése" : "▸ Haladó beállítások"}
      </button>

      {showAdvanced && (
        <div className="space-y-4">
          <div className="space-y-3 rounded-[var(--radius)] border border-border p-3">
            <div className="text-sm font-medium text-ink">AI mozgóklip</div>
            <div>
              <Label htmlFor="pro-vmodel">Modell</Label>
              <Select
                id="pro-vmodel"
                value={settings.videoClip.model}
                onChange={(e) =>
                  patch({ videoClip: { ...settings.videoClip, model: e.target.value } })
                }
              >
                {WAN_MODEL_OPTIONS.map((m: any) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor="pro-vres">Felbontás</Label>
                <Select
                  id="pro-vres"
                  value={settings.videoClip.resolution}
                  onChange={(e) =>
                    patch({
                      videoClip: {
                        ...settings.videoClip,
                        resolution: e.target.value as "480p" | "720p" | "1080p",
                      },
                    })
                  }
                >
                  <option value="480p">480p</option>
                  <option value="720p">720p</option>
                  <option value="1080p">1080p</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="pro-vlen">Klip (mp)</Label>
                <Input
                  id="pro-vlen"
                  type="number"
                  min={3}
                  max={15}
                  value={settings.videoClip.clipSec}
                  onChange={(e) =>
                    patch({
                      videoClip: { ...settings.videoClip, clipSec: Number(e.target.value) || 5 },
                    })
                  }
                />
              </div>
              <div>
                <Label htmlFor="pro-vmax">Max. klip</Label>
                <Input
                  id="pro-vmax"
                  type="number"
                  min={0}
                  max={500}
                  value={settings.videoClip.maxClips}
                  onChange={(e) =>
                    patch({
                      videoClip: { ...settings.videoClip, maxClips: Number(e.target.value) || 0 },
                    })
                  }
                />
              </div>
            </div>
          </div>

          <div className="space-y-3 rounded-[var(--radius)] border border-border p-3">
            <div className="text-sm font-medium text-ink">AI kép</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="pro-imodel">Modell</Label>
                <Select
                  id="pro-imodel"
                  value={settings.image.model}
                  onChange={(e) => patch({ image: { ...settings.image, model: e.target.value } })}
                >
                  <option value="gpt-image-2 low">GPT Image 2 (Low)</option>
                  <option value="gpt-image-2 standard">GPT Image 2 (Standard)</option>
                  <option value="gpt-image-2 hd">GPT Image 2 (HD)</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="pro-reuse">Kép újrahasznosítás</Label>
                <Input
                  id="pro-reuse"
                  type="number"
                  min={1}
                  max={6}
                  value={settings.image.reuseFactor}
                  onChange={(e) =>
                    patch({
                      image: { ...settings.image, reuseFactor: Number(e.target.value) || 1 },
                    })
                  }
                />
              </div>
            </div>
            <p className="text-xs text-muted">
              Egy kép ennyi shotot szolgál ki eltérő Ken Burns kivágással — ez a
              legnagyobb megtakarítás. Generált képek: {breakdown.imagesGenerated} db.
            </p>
            <Toggle
              checked={settings.image.kenBurns}
              onChange={(v) => patch({ image: { ...settings.image, kenBurns: v } })}
              label="Ken Burns mozgás a képeken"
            />
          </div>

          <div className="space-y-3 rounded-[var(--radius)] border border-border p-3">
            <div className="text-sm font-medium text-ink">Egyéb</div>
            <Toggle
              checked={settings.wordAlignment}
              onChange={(v) => patch({ wordAlignment: v })}
              label="Szószintű időzítés (Whisper) — pontosabb feliratidőzítés"
            />
            <div>
              <Label htmlFor="pro-textmodel">Szövegíró modell</Label>
              <Select
                id="pro-textmodel"
                value={settings.textModel}
                onChange={(e) => patch({ textModel: e.target.value })}
              >
                <option value="">Csatorna alapértelmezése</option>
                {TEXT_MODEL_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </div>
      )}

      {/* Cost */}
      <CostMiniTable
        title="Becsült költség"
        rows={[
          { label: "Szöveg (script + rendező)", value: formatUsd(breakdown.scriptCost + breakdown.directorCost) },
          { label: "Hang", value: formatUsd(breakdown.voiceCost) },
          ...(breakdown.alignmentCost > 0
            ? [{ label: "Szószintű időzítés", value: formatUsd(breakdown.alignmentCost) }]
            : []),
          { label: `AI kép (${breakdown.imagesGenerated} db)`, value: formatUsd(breakdown.imageCost) },
          { label: `AI mozgóklip (${breakdown.allocation.ai_video} db)`, value: formatUsd(breakdown.videoCost) },
          {
            label: `Stock + archív (${breakdown.allocation.stock_video + breakdown.allocation.archive} db)`,
            value: "ingyenes",
          },
          { label: "Összesen", value: formatUsd(breakdown.total), active: true },
        ]}
      />

      {breakdown.budgetLimited && (
        <Banner tone="warning">
          A beállított arányok túllépnék a ${settings.budgetUsd} keretet, ezért a
          tervező kevesebb fizetős elemet használ. Emeld a keretet, vagy csökkentsd
          az AI mozgóklip arányát.
        </Banner>
      )}
    </div>
  );
}

export { DEFAULT_PRO_PRESET };
