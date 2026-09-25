"use client";

import { useEffect, useState } from "react";
import { Banner, Button, ConfirmDialog, ErrorState, Input, Label, Textarea } from "@/components/ui";
import { useConfirm } from "@/hooks/useConfirm";
import { apiFetch, getErrorMessage } from "@/lib/api-client";
import { formatNameListText, parseNameList, type NamePoolCategoryDef, type NamePoolPreset } from "@/lib/name-pools";

type CategoryForm = { key: string; label: string; promptHint: string; namesText: string };

const emptyCategory = (): CategoryForm => ({ key: "", label: "", promptHint: "", namesText: "" });

function presetToForm(preset: NamePoolPreset): CategoryForm[] {
  return preset.categories.map((c) => ({
    key: c.key,
    label: c.label,
    promptHint: c.promptHint || "",
    namesText: c.names.join("\n"),
  }));
}

export default function NamePoolPresetsManager() {
  const { confirm, dialogProps } = useConfirm();
  const [presets, setPresets] = useState<NamePoolPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [formName, setFormName] = useState("");
  const [formMin, setFormMin] = useState(20);
  const [formCategories, setFormCategories] = useState<CategoryForm[]>([emptyCategory()]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const fetchPresets = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await apiFetch<{ presets?: NamePoolPreset[] }>("/api/name-pool-presets");
      setPresets(Array.isArray(data?.presets) ? data.presets : []);
    } catch (e) {
      setLoadError(getErrorMessage(e, "Nem sikerült betölteni a névkészleteket."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPresets();
  }, []);

  const openNewForm = () => {
    setEditingId("new");
    setFormName("");
    setFormMin(20);
    setFormCategories([emptyCategory()]);
    setFormError(null);
  };

  const openEditForm = (preset: NamePoolPreset) => {
    setEditingId(preset.id);
    setFormName(preset.name);
    setFormMin(preset.minNamesPerCategory);
    setFormCategories(presetToForm(preset));
    setFormError(null);
  };

  const closeForm = () => setEditingId(null);

  const updateCategory = (index: number, patch: Partial<CategoryForm>) => {
    setFormCategories((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  };
  const addCategory = () => setFormCategories((prev) => [...prev, emptyCategory()]);
  const removeCategory = (index: number) =>
    setFormCategories((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));

  const handleSave = async () => {
    setFormError(null);
    const name = formName.trim();
    if (!name) {
      setFormError("Adj meg egy nevet a névkészletnek.");
      return;
    }
    const categories: (Omit<NamePoolCategoryDef, "key"> & { key?: string })[] = formCategories
      .filter((c) => c.label.trim())
      .map((c) => ({
        key: c.key || undefined,
        label: c.label.trim(),
        promptHint: c.promptHint.trim() || undefined,
        names: parseNameList(c.namesText),
      }));
    if (categories.length === 0) {
      setFormError("Legalább egy kategória szükséges (kitöltött névvel).");
      return;
    }

    setSaving(true);
    try {
      const isNew = editingId === "new";
      await apiFetch(isNew ? "/api/name-pool-presets" : `/api/name-pool-presets/${editingId}`, {
        method: isNew ? "POST" : "PATCH",
        json: { name, categories, minNamesPerCategory: formMin },
      });
      setEditingId(null);
      await fetchPresets();
    } catch (e) {
      setFormError(getErrorMessage(e, "A névkészletet nem sikerült menteni."));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title: "Biztosan törlöd ezt a névkészletet?",
      description: "A csatornák, amik ezt használják, ezután névkészlet nélkül maradnak.",
      tone: "danger",
      confirmLabel: "Törlés",
    });
    if (!ok) return;
    setError(null);
    try {
      await apiFetch(`/api/name-pool-presets/${id}`, { method: "DELETE" });
      if (editingId === id) setEditingId(null);
      await fetchPresets();
    } catch (e) {
      setError(getErrorMessage(e, "A névkészletet nem sikerült törölni."));
    }
  };

  return (
    <div className="space-y-6">
      {error && <Banner tone="error">{error}</Banner>}

      <div className="flex justify-end">
        <Button onClick={openNewForm} disabled={editingId !== null}>
          + Új névkészlet
        </Button>
      </div>

      {editingId !== null && (
        <div className="rounded-[var(--radius-panel)] border border-border bg-bg-elevated p-5 space-y-4">
          <p className="font-display text-lg text-ink">
            {editingId === "new" ? "Új névkészlet" : "Névkészlet szerkesztése"}
          </p>
          {formError && <Banner tone="error">{formError}</Banner>}

          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3">
            <div>
              <Label>Név</Label>
              <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Pl. Vadnyugat" />
            </div>
            <div>
              <Label>Min. név / kategória</Label>
              <Input
                type="number"
                min={1}
                value={formMin}
                onChange={(e) => setFormMin(Math.max(1, Number(e.target.value) || 1))}
                className="w-32"
              />
            </div>
          </div>
          <p className="text-xs text-muted -mt-2">
            A névkészlet csak akkor aktiválódik generáláskor, ha minden kategóriában legalább ennyi név van.
          </p>

          <div className="space-y-3">
            <Label>Kategóriák</Label>
            {formCategories.map((cat, i) => {
              const count = parseNameList(cat.namesText).length;
              const ready = count >= formMin;
              return (
                <div key={i} className="rounded-[var(--radius)] border border-border p-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <div className="flex-1">
                      <Input
                        value={cat.label}
                        onChange={(e) => updateCategory(i, { label: e.target.value })}
                        placeholder="Kategória neve (pl. Férfi keresztnevek)"
                      />
                    </div>
                    <span className={`mt-2.5 text-xs whitespace-nowrap ${ready ? "text-success" : "text-muted"}`}>
                      {count} / {formMin}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeCategory(i)}
                      disabled={formCategories.length <= 1}
                    >
                      Törlés
                    </Button>
                  </div>
                  <Textarea
                    value={cat.namesText}
                    onChange={(e) => updateCategory(i, { namesText: e.target.value })}
                    onBlur={() => updateCategory(i, { namesText: formatNameListText(cat.namesText) })}
                    placeholder="Egy név soronként, vagy vesszővel/pontosvesszővel elválasztva…"
                    rows={4}
                  />
                  <Input
                    value={cat.promptHint}
                    onChange={(e) => updateCategory(i, { promptHint: e.target.value })}
                    placeholder="Extra utasítás ehhez a kategóriához (opcionális)"
                  />
                </div>
              );
            })}
            <Button type="button" variant="secondary" size="sm" onClick={addCategory}>
              + Kategória hozzáadása
            </Button>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={closeForm} disabled={saving}>
              Mégsem
            </Button>
            <Button onClick={handleSave} loading={saving}>
              {saving ? "Mentés…" : "Mentés"}
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted">Betöltés…</p>
      ) : loadError ? (
        <ErrorState
          title="Nem sikerült betölteni a névkészleteket"
          description={loadError}
          action={<Button onClick={fetchPresets}>Újrapróbálás</Button>}
        />
      ) : presets.length === 0 ? (
        <p className="text-sm text-muted">Még nincs névkészlet.</p>
      ) : (
        <ul className="divide-y divide-border border-y border-border">
          {presets.map((preset) => {
            const totalNames = preset.categories.reduce((sum, c) => sum + c.names.length, 0);
            const ready = preset.categories.every((c) => c.names.length >= preset.minNamesPerCategory);
            return (
              <li key={preset.id} className="flex items-center justify-between gap-3 py-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink truncate">{preset.name}</p>
                  <p className="text-xs text-muted">
                    {preset.categories.length} kategória, {totalNames} név összesen —{" "}
                    <span className={ready ? "text-success" : "text-accent"}>
                      {ready ? "kész a használatra" : `min. ${preset.minNamesPerCategory}/kategória szükséges`}
                    </span>
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button variant="secondary" size="sm" onClick={() => openEditForm(preset)}>
                    Szerkesztés
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleDelete(preset.id)}>
                    Törlés
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
