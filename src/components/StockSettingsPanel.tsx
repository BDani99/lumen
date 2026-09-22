"use client";

import { useEffect, useState } from "react";
import { Input, Label, Toggle } from "@/components/ui";
import {
  MIN_CONFIDENCE_FLOOR,
  STOCK_PROVIDER_ENV,
  STOCK_PROVIDER_LABELS,
  providersForKind,
  type StockKind,
  type StockProviderId,
  type StockSettings,
} from "@/lib/stock/types";

/**
 * Per-channel stock configuration: which providers are used for video vs
 * image, in what priority order, and how strict the relevance gate is.
 * The chain tries providers top-down and stops at the first accepted match,
 * so order genuinely matters.
 */
export function StockSettingsPanel({
  value,
  onChange,
  disabled,
}: {
  value: StockSettings;
  onChange: (next: StockSettings) => void;
  disabled?: boolean;
}) {
  const [configured, setConfigured] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/stock/status");
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) setConfigured(data.configured || {});
      } catch {
        /* status is a nicety — the panel still works without it */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const renderChain = (kind: StockKind) => {
    const chain = kind === "video" ? value.video : value.image;
    const capable = providersForKind(kind);
    // Enabled ones in their configured order, then the rest as "off".
    const ordered = [...chain.providers, ...capable.filter((p) => !chain.providers.includes(p))];

    const setChain = (providers: StockProviderId[], enabled = chain.enabled) => {
      onChange(
        kind === "video"
          ? { ...value, video: { enabled, providers } }
          : { ...value, image: { enabled, providers } }
      );
    };

    const toggleProvider = (id: StockProviderId, on: boolean) => {
      setChain(on ? [...chain.providers, id] : chain.providers.filter((p) => p !== id));
    };

    const move = (id: StockProviderId, dir: -1 | 1) => {
      const idx = chain.providers.indexOf(id);
      if (idx < 0) return;
      const next = [...chain.providers];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return;
      [next[idx], next[target]] = [next[target], next[idx]];
      setChain(next);
    };

    return (
      <div className="space-y-2 rounded-[var(--radius)] border border-border p-3">
        <Toggle
          checked={chain.enabled}
          disabled={disabled}
          onChange={(v) => setChain(chain.providers, v)}
          label={kind === "video" ? "Stock videó keresése" : "Stock kép keresése"}
        />
        <p className="text-xs text-muted">
          A lánc fentről lefelé próbálkozik, és az első elfogadott találatnál megáll.
        </p>
        {ordered.map((id) => {
          const on = chain.providers.includes(id);
          const pos = chain.providers.indexOf(id);
          const needsKey = STOCK_PROVIDER_ENV[id];
          const missing = needsKey && configured[id] === false;
          return (
            <div key={id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={on}
                disabled={disabled || !chain.enabled}
                onChange={(e) => toggleProvider(id, e.target.checked)}
                className="w-4 h-4 accent-[var(--accent)] cursor-pointer"
              />
              <span className={`flex-1 text-xs ${on ? "text-ink" : "text-muted"}`}>
                {on && <span className="font-mono text-muted">{pos + 1}. </span>}
                {STOCK_PROVIDER_LABELS[id]}
                {missing && <span className="ml-2 text-danger">kulcs hiányzik ({needsKey})</span>}
                {!needsKey && <span className="ml-2 text-success">kulcs nem kell</span>}
              </span>
              <button
                type="button"
                disabled={disabled || !on || pos <= 0}
                onClick={() => move(id, -1)}
                className="px-1.5 text-muted hover:text-ink disabled:opacity-30"
                title="Előrébb"
              >
                ▲
              </button>
              <button
                type="button"
                disabled={disabled || !on || pos < 0 || pos >= chain.providers.length - 1}
                onClick={() => move(id, 1)}
                className="px-1.5 text-muted hover:text-ink disabled:opacity-30"
                title="Hátrébb"
              >
                ▼
              </button>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className={`space-y-3 ${disabled ? "opacity-60" : ""}`}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {renderChain("video")}
        {renderChain("image")}
      </div>

      <div className="space-y-3 rounded-[var(--radius)] border border-border p-3">
        <div>
          <Label htmlFor="stock-conf">Minimum egyezés-bizalom ({value.minConfidence})</Label>
          <Input
            id="stock-conf"
            type="number"
            min={0}
            max={100}
            disabled={disabled}
            value={value.minConfidence}
            onChange={(e) =>
              onChange({
                ...value,
                minConfidence: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
              })
            }
          />
          <p className="mt-1 text-xs text-muted">
            Egy AI ellenőrzi, hogy a találat tényleg a jelenethez illik-e (korszak, helyszín,
            szereplők). Csak ennél magasabb bizalomnál fogadjuk el. Magasabb érték = szigorúbb,
            több jelenet kap AI képet.
          </p>
        </div>
        <Toggle
          checked={value.allowAtmospheric}
          disabled={disabled}
          onChange={(v) => onChange({ ...value, allowAtmospheric: v })}
          label="Hangulati B-roll elfogadása (gyertya, köd, eső — nem szó szerinti jelenet)"
        />
        <p className="text-xs text-muted">
          Korhű drámánál ez a különbség aközött, hogy néha van használható stock, vagy szinte soha.
        </p>
        <Toggle
          checked={value.aiFallback}
          disabled={disabled}
          onChange={(v) => onChange({ ...value, aiFallback: v })}
          label="AI kép, ha nincs megfelelő stock találat"
        />
      </div>

      <div className="space-y-3 rounded-[var(--radius)] border border-border p-3">
        <div className="text-sm font-medium text-ink">Minimum stock mennyiség</div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="stock-minvid">Min. stock videó</Label>
            <Input
              id="stock-minvid"
              type="number"
              min={0}
              disabled={disabled}
              value={value.minStockVideos}
              onChange={(e) =>
                onChange({ ...value, minStockVideos: Math.max(0, Number(e.target.value) || 0) })
              }
            />
          </div>
          <div>
            <Label htmlFor="stock-minimg">Min. stock kép</Label>
            <Input
              id="stock-minimg"
              type="number"
              min={0}
              disabled={disabled}
              value={value.minStockImages}
              onChange={(e) =>
                onChange({ ...value, minStockImages: Math.max(0, Number(e.target.value) || 0) })
              }
            />
          </div>
        </div>
        <p className="text-xs text-muted">
          Nem kötelező minimum, hanem cél: ha elmaradnánk tőle, a bizalmi küszöböt fokozatosan
          enyhítjük (max. {MIN_CONFIDENCE_FLOOR}-ig), hogy közelítsük. Amit így sem sikerül
          stockból kitölteni, azt AI tartalom pótolja. 0 = nincs cél.
        </p>
      </div>
    </div>
  );
}
