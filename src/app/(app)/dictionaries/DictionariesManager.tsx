"use client";

import { useEffect, useState } from "react";
import { Banner, Button, ConfirmDialog, ErrorState, Input, Label, Select } from "@/components/ui";
import { useConfirm } from "@/hooks/useConfirm";
import { apiFetch, getErrorMessage } from "@/lib/api-client";

interface DictionaryRule {
  from: string;
  to: string;
  matchType: "word" | "contains";
  caseSensitive: boolean;
}

interface Dictionary {
  id: number;
  name: string;
  rules: DictionaryRule[];
}

const emptyRule = (): DictionaryRule => ({ from: "", to: "", matchType: "word", caseSensitive: false });

export default function DictionariesManager() {
  const { confirm, dialogProps } = useConfirm();
  const [dictionaries, setDictionaries] = useState<Dictionary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<number | "new" | null>(null);
  const [formName, setFormName] = useState("");
  const [formRules, setFormRules] = useState<DictionaryRule[]>([emptyRule()]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [previewText, setPreviewText] = useState("");
  const [previewOutput, setPreviewOutput] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const fetchDictionaries = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await apiFetch<{ dictionaries?: Dictionary[] }>("/api/dictionaries");
      setDictionaries(Array.isArray(data?.dictionaries) ? data.dictionaries : []);
    } catch (e) {
      setLoadError(getErrorMessage(e, "Nem sikerült betölteni a szótárakat."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDictionaries();
  }, []);

  const openNewForm = () => {
    setEditingId("new");
    setFormName("");
    setFormRules([emptyRule()]);
    setFormError(null);
    setPreviewText("");
    setPreviewOutput(null);
    setPreviewError(null);
  };

  const openEditForm = (dict: Dictionary) => {
    setEditingId(dict.id);
    setFormName(dict.name);
    setFormRules(dict.rules.length > 0 ? dict.rules.map((r) => ({ ...emptyRule(), ...r })) : [emptyRule()]);
    setFormError(null);
    setPreviewText("");
    setPreviewOutput(null);
    setPreviewError(null);
  };

  const closeForm = () => {
    setEditingId(null);
  };

  const updateRule = (index: number, patch: Partial<DictionaryRule>) => {
    setFormRules((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const addRule = () => setFormRules((prev) => [...prev, emptyRule()]);
  const removeRule = (index: number) =>
    setFormRules((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));

  const handleSave = async () => {
    setFormError(null);
    const name = formName.trim();
    if (!name) {
      setFormError("Adj meg egy nevet.");
      return;
    }
    const rules = formRules
      .map((r) => ({ ...r, from: r.from.trim(), to: r.to.trim() }))
      .filter((r) => r.from && r.to);
    if (rules.length === 0) {
      setFormError("Legalább egy szabály szükséges (kitöltött 'Ettől' és 'Erre' mezővel).");
      return;
    }

    setSaving(true);
    try {
      const isNew = editingId === "new";
      await apiFetch(isNew ? "/api/dictionaries" : `/api/dictionaries/${editingId}`, {
        method: isNew ? "POST" : "PUT",
        json: { name, rules },
      });
      setEditingId(null);
      await fetchDictionaries();
    } catch (e) {
      setFormError(getErrorMessage(e, "A szótárat nem sikerült menteni."));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    const ok = await confirm({
      title: "Biztosan törlöd ezt a szótárat?",
      description: "A csatornák, amik használják, ezután szótár nélkül generálnak.",
      tone: "danger",
      confirmLabel: "Törlés",
    });
    if (!ok) return;
    setError(null);
    try {
      await apiFetch(`/api/dictionaries/${id}`, { method: "DELETE" });
      if (editingId === id) setEditingId(null);
      await fetchDictionaries();
    } catch (e) {
      setError(getErrorMessage(e, "A szótárat nem sikerült törölni."));
    }
  };

  const runPreview = async () => {
    setPreviewError(null);
    if (!previewText.trim()) {
      setPreviewError("Írj be egy mintaszöveget.");
      return;
    }
    const rules = formRules
      .map((r) => ({ ...r, from: r.from.trim(), to: r.to.trim() }))
      .filter((r) => r.from && r.to);
    setPreviewBusy(true);
    setPreviewOutput(null);
    try {
      const data = await apiFetch<{ output?: string }>("/api/dictionaries/preview", {
        method: "POST",
        json: { text: previewText, rules },
      });
      setPreviewOutput(data?.output ?? previewText);
    } catch (e) {
      setPreviewError(getErrorMessage(e, "Az előnézetet nem sikerült elkészíteni."));
    } finally {
      setPreviewBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {error && <Banner tone="error">{error}</Banner>}

      <div className="flex justify-end">
        <Button onClick={openNewForm} disabled={editingId !== null}>
          + Új szótár
        </Button>
      </div>

      {editingId !== null && (
        <div className="rounded-[var(--radius-panel)] border border-border bg-bg-elevated p-5 space-y-4">
          <p className="font-display text-lg text-ink">
            {editingId === "new" ? "Új szótár" : "Szótár szerkesztése"}
          </p>
          {formError && <Banner tone="error">{formError}</Banner>}

          <div>
            <Label>Név</Label>
            <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Pl. Márkanevek" />
          </div>

          <div className="space-y-2">
            <Label>Szabályok</Label>
            {formRules.map((rule, i) => (
              <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto_auto_auto] gap-2 items-center">
                <Input
                  value={rule.from}
                  onChange={(e) => updateRule(i, { from: e.target.value })}
                  placeholder="Ettől (pl. AI33)"
                />
                <Input
                  value={rule.to}
                  onChange={(e) => updateRule(i, { to: e.target.value })}
                  placeholder="Erre (pl. Ây Ai Harminchárom)"
                />
                <Select
                  value={rule.matchType}
                  onChange={(e) => updateRule(i, { matchType: e.target.value as "word" | "contains" })}
                  className="w-full sm:w-32"
                >
                  <option value="word">Egész szó</option>
                  <option value="contains">Részlet</option>
                </Select>
                <label className="flex items-center gap-1.5 text-xs text-muted whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={rule.caseSensitive}
                    onChange={(e) => updateRule(i, { caseSensitive: e.target.checked })}
                    className="accent-[var(--accent)]"
                  />
                  Kis/nagybetű
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  className="!px-2 !py-1.5 text-xs"
                  onClick={() => removeRule(i)}
                  disabled={formRules.length <= 1}
                >
                  Törlés
                </Button>
              </div>
            ))}
            <Button type="button" variant="secondary" size="sm" onClick={addRule}>
              + Szabály hozzáadása
            </Button>
          </div>

          <div className="rounded-[var(--radius)] border border-border bg-surface p-3 space-y-2">
            <Label className="mb-0">Előnézet</Label>
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                value={previewText}
                onChange={(e) => setPreviewText(e.target.value)}
                placeholder="Mintaszöveg a szabályokkal…"
                className="flex-1"
              />
              <Button type="button" variant="secondary" loading={previewBusy} onClick={runPreview}>
                {previewBusy ? "…" : "Előnézet"}
              </Button>
            </div>
            {previewError && <p className="text-sm text-danger">{previewError}</p>}
            {previewOutput != null && (
              <p className="text-sm text-ink">
                Eredmény: <span className="font-mono text-accent">{previewOutput}</span>
              </p>
            )}
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
          title="Nem sikerült betölteni a szótárakat"
          description={loadError}
          action={<Button onClick={fetchDictionaries}>Újrapróbálás</Button>}
        />
      ) : dictionaries.length === 0 ? (
        <p className="text-sm text-muted">Még nincs kiejtési szótár.</p>
      ) : (
        <ul className="divide-y divide-border border-y border-border">
          {dictionaries.map((dict) => (
            <li key={dict.id} className="flex items-center justify-between gap-3 py-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink truncate">{dict.name}</p>
                <p className="text-xs text-muted">{dict.rules.length} szabály</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button variant="secondary" size="sm" onClick={() => openEditForm(dict)}>
                  Szerkesztés
                </Button>
                <Button variant="ghost" size="sm" onClick={() => handleDelete(dict.id)}>
                  Törlés
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
