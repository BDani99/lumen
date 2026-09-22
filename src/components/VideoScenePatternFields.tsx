import { Input, Label, Select } from "@/components/ui";
import type { VideoPattern } from "@/lib/video-mode";

/**
 * "Which scenes become video" controls — pattern selector, its one relevant
 * follow-up field, and an always-visible scene cap. Shared by the New Video
 * modal and the editor's "Média újragenerálása" modal so there's a single
 * place that owns this interaction instead of hand-copied forks.
 */
export function VideoScenePatternFields({
  idPrefix,
  videoPattern,
  setVideoPattern,
  videoEveryN,
  setVideoEveryN,
  videoFirstSeconds,
  setVideoFirstSeconds,
  introVideoCount,
  setIntroVideoCount,
  maxVideoScenes,
  setMaxVideoScenes,
  disabled,
}: {
  idPrefix: string;
  videoPattern: VideoPattern;
  setVideoPattern: (v: VideoPattern) => void;
  videoEveryN: number;
  setVideoEveryN: (v: number) => void;
  videoFirstSeconds: number;
  setVideoFirstSeconds: (v: number) => void;
  introVideoCount: number;
  setIntroVideoCount: (v: number) => void;
  maxVideoScenes: number;
  setMaxVideoScenes: (v: number) => void;
  disabled?: boolean;
}) {
  const isIntro = videoPattern === "intro";

  return (
    <div className="space-y-3 rounded-[var(--radius)] border border-border p-3">
      <div>
        <Label htmlFor={`${idPrefix}-vpat`}>Melyik jelenetek legyenek videók</Label>
        <Select
          id={`${idPrefix}-vpat`}
          value={videoPattern}
          disabled={disabled}
          onChange={(e) => setVideoPattern(e.target.value as VideoPattern)}
        >
          <option value="intro">Bevezető (első bekezdés, N klip)</option>
          <option value="all">Összes jelenet</option>
          <option value="first_last">Csak első és utolsó</option>
          <option value="every_n">Minden N. jelenet (+ utolsó)</option>
          <option value="first_seconds">Első N másodperc</option>
        </Select>
      </div>

      {isIntro && (
        <div>
          <Label htmlFor={`${idPrefix}-intro`}>Hány videóklip az első bekezdéshez</Label>
          <Input
            id={`${idPrefix}-intro`}
            type="number"
            min={1}
            max={50}
            disabled={disabled}
            value={introVideoCount}
            onChange={(e) => {
              const n = Number(e.target.value) || 2;
              setIntroVideoCount(n);
              if (maxVideoScenes < n) setMaxVideoScenes(n);
            }}
          />
          <p className="mt-1 text-xs text-muted">
            A klipek a script első bekezdésének narrációját követik. Ha a bekezdés
            rövidebb, több klip is rákerülhet ugyanarra a nyitó jelenetre.
          </p>
        </div>
      )}

      {videoPattern === "every_n" && (
        <div>
          <Label htmlFor={`${idPrefix}-every`}>N (minden ennyiedik)</Label>
          <Input
            id={`${idPrefix}-every`}
            type="number"
            min={1}
            max={50}
            disabled={disabled}
            value={videoEveryN}
            onChange={(e) => setVideoEveryN(Number(e.target.value) || 3)}
          />
        </div>
      )}

      {videoPattern === "first_seconds" && (
        <div>
          <Label htmlFor={`${idPrefix}-firstsec`}>Első N másodperc (narráció)</Label>
          <Input
            id={`${idPrefix}-firstsec`}
            type="number"
            min={5}
            max={600}
            disabled={disabled}
            value={videoFirstSeconds}
            onChange={(e) => setVideoFirstSeconds(Number(e.target.value) || 30)}
          />
          <p className="mt-1 text-xs text-muted">
            Jelenetek, amelyeknek a kezdete ebbe az ablakba esik.
          </p>
        </div>
      )}

      <div>
        <Label htmlFor={`${idPrefix}-vmax`}>
          {isIntro
            ? "Max. videóklip a nyitó jelenetre (költségkontroll)"
            : "Max. videós jelenetek (költségkontroll)"}
        </Label>
        <Input
          id={`${idPrefix}-vmax`}
          type="number"
          min={0}
          max={200}
          disabled={disabled}
          value={maxVideoScenes}
          onChange={(e) => setMaxVideoScenes(Number(e.target.value) || 0)}
        />
        <p className="mt-1 text-xs text-muted">
          {isIntro
            ? "Ha ez kisebb, mint a fenti klipszám, a klipszám lesz a tényleges korlát."
            : "A minta ennyi jelenetet jelöl ki videónak; a többi kép marad."}
        </p>
      </div>
    </div>
  );
}
