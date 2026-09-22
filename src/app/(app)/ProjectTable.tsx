"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { createClient } from "@/utils/supabase/client";
import { STATUS_LABELS } from "@/lib/generation-status";
import { Banner, Button, Input, Modal, Select, StatusBadge, Textarea } from "@/components/ui";
import { isPlayableImageUrl } from "@/lib/video-mode";
import { ProExportButton } from "@/components/pro/ProExportButton";

export default function ProjectTable({ initialProjects }: { initialProjects: any[] }) {
  const [projects, setProjects] = useState(initialProjects);
  const [selectedProject, setSelectedProject] = useState<any | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const supabase = useMemo(() => createClient(), []);

  const [filterTitle, setFilterTitle] = useState("");
  const [filterChannel, setFilterChannel] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [isRegeneratingThumbnail, setIsRegeneratingThumbnail] = useState(false);

  const channelOptions = useMemo(() => {
    const names = new Set<string>();
    for (const p of projects) {
      const n = p.channels?.name;
      if (n) names.add(n);
    }
    return [...names].sort((a, b) => a.localeCompare(b, "hu"));
  }, [projects]);

  const statusOptions = useMemo(() => {
    const ids = new Set<string>();
    for (const p of projects) {
      if (p.status) ids.add(p.status);
    }
    return [...ids].sort((a, b) =>
      (STATUS_LABELS[a] || a).localeCompare(STATUS_LABELS[b] || b, "hu")
    );
  }, [projects]);

  useEffect(() => {
    setProjects(initialProjects);
  }, [initialProjects]);

  useEffect(() => {
    const interval = setInterval(async () => {
      const { data } = await supabase
        .from("video_projects")
        .select("*, channels(name)")
        .order("created_at", { ascending: false });
      if (data) setProjects(data);
    }, 5000);
    return () => clearInterval(interval);
  }, [supabase]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const getDuration = (start: string, end: string, status: string) => {
    if (!start || !end || status !== "Completed") return null;
    const diffInSeconds = Math.round(
      (new Date(end).getTime() - new Date(start).getTime()) / 1000
    );
    if (diffInSeconds <= 0) return null;
    if (diffInSeconds < 60) return `${diffInSeconds} mp`;
    return `${Math.floor(diffInSeconds / 60)}p ${diffInSeconds % 60}mp`;
  };

  const filteredProjects = projects.filter((p) => {
    return (
      (filterTitle === "" || p.title.toLowerCase().includes(filterTitle.toLowerCase())) &&
      (filterChannel === "" || (p.channels?.name || "") === filterChannel) &&
      (filterStatus === "" || p.status === filterStatus)
    );
  });

  const toggleFlag = async (id: string, currentFlag: boolean) => {
    const newFlag = !currentFlag;
    setProjects(projects.map((p) => (p.id === id ? { ...p, is_flagged: newFlag } : p)));
    const { error: err } = await supabase
      .from("video_projects")
      .update({ is_flagged: newFlag })
      .eq("id", id);
    if (err) {
      setProjects(projects.map((p) => (p.id === id ? { ...p, is_flagged: currentFlag } : p)));
    }
  };

  const handleDelete = async (id: string) => {
    if (
      !window.confirm(
        "Biztosan törölni szeretnéd ezt a projektet? Ez a művelet visszafordíthatatlan."
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/videos/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Nem sikerült a törlés");
      setProjects(projects.filter((p) => p.id !== id));
      if (selectedProject?.id === id) setSelectedProject(null);
      setToast("Projekt törölve.");
    } catch {
      setError("Hiba történt a törlés során.");
    }
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setToast(`${label} vágólapra másolva.`);
    } catch {
      setError("Másolás sikertelen.");
    }
  };

  const handleRegenerateThumbnail = async (projectId: string) => {
    setIsRegeneratingThumbnail(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/thumbnail`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Hiba történt");
      setSelectedProject((prev: any) => ({
        ...prev,
        thumbnail_url: data.thumbnail_url,
        timeline_data: data.timeline_data,
      }));
      setProjects((prev) =>
        prev.map((p) =>
          p.id === projectId
            ? { ...p, thumbnail_url: data.thumbnail_url, timeline_data: data.timeline_data }
            : p
        )
      );
      setToast("Bélyegkép újragenerálva.");
    } catch (e: any) {
      setError(e.message || "Hiba");
    } finally {
      setIsRegeneratingThumbnail(false);
    }
  };

  const copyFirstParagraph = (script: string) => {
    if (!script) return;
    copyToClipboard(script.split(/\n\s*\n/)[0], "Első bekezdés");
  };

  return (
    <>
      {(toast || error) && (
        <div className="mb-4 space-y-2">
          {toast && <Banner tone="success">{toast}</Banner>}
          {error && (
            <Banner tone="error">
              {error}{" "}
              <button
                type="button"
                className="ml-2 cursor-pointer underline"
                onClick={() => setError(null)}
              >
                Bezár
              </button>
            </Banner>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-[var(--radius-panel)] border border-border">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-border bg-bg-elevated">
            <tr>
              <th className="p-3 font-medium text-muted w-10" />
              <th className="p-3 font-medium text-muted">
                Cím
                <Input
                  className="mt-1.5 !py-1.5 text-xs"
                  placeholder="Szűrés…"
                  value={filterTitle}
                  onChange={(e) => setFilterTitle(e.target.value)}
                />
              </th>
              <th className="p-3 font-medium text-muted min-w-[9rem]">
                Csatorna
                <Select
                  className="mt-1.5 !py-1.5 text-xs"
                  value={filterChannel}
                  onChange={(e) => setFilterChannel(e.target.value)}
                >
                  <option value="">Összes</option>
                  {channelOptions.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </Select>
              </th>
              <th className="p-3 font-medium text-muted min-w-[9rem]">
                Státusz
                <Select
                  className="mt-1.5 !py-1.5 text-xs"
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                >
                  <option value="">Összes</option>
                  {statusOptions.map((id) => (
                    <option key={id} value={id}>
                      {STATUS_LABELS[id] || id}
                    </option>
                  ))}
                </Select>
              </th>
              <th className="p-3 font-medium text-muted">Ár</th>
              <th className="p-3 font-medium text-muted whitespace-nowrap">Dátum</th>
              <th className="p-3 font-medium text-muted">Műveletek</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filteredProjects.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-muted">
                  Nincs találat a szűrésre.
                </td>
              </tr>
            ) : (
              filteredProjects.map((p: any) => (
                <tr key={p.id} className="hover:bg-surface/60 transition-colors">
                  <td className="p-3">
                    <button
                      type="button"
                      onClick={() => toggleFlag(p.id, p.is_flagged)}
                      className={`cursor-pointer text-lg transition-colors ${
                        p.is_flagged ? "text-accent" : "text-border-strong hover:text-muted"
                      }`}
                      title="Megjelölés"
                    >
                      ★
                    </button>
                  </td>
                  <td className="p-3">
                    <button
                      type="button"
                      onClick={() => setSelectedProject(p)}
                      className="cursor-pointer text-left font-medium text-ink hover:text-accent transition-colors"
                    >
                      {p.title}
                    </button>
                  </td>
                  <td className="p-3 text-muted">{p.channels?.name || "—"}</td>
                  <td className="p-3">
                    <Link
                      href={`/projects/${p.id}/progress`}
                      className="inline-flex cursor-pointer"
                      title="Haladás megnyitása"
                    >
                      <StatusBadge
                        status={p.status}
                        className="cursor-pointer hover:opacity-90 transition-opacity"
                      />
                    </Link>
                  </td>
                  <td className="p-3 font-mono text-xs text-muted">
                    {p.generation_cost_usd > 0
                      ? `$${Number(p.generation_cost_usd).toFixed(4)}`
                      : "—"}
                  </td>
                  <td className="p-3 text-muted text-xs whitespace-nowrap">
                    <div>{new Date(p.created_at).toLocaleDateString("hu-HU")}</div>
                    {getDuration(p.created_at, p.updated_at, p.status) && (
                      <div className="text-success mt-0.5">
                        {getDuration(p.created_at, p.updated_at, p.status)}
                      </div>
                    )}
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-3">
                      {p.pipeline === "pro" ? (
                        <ProExportButton projectId={p.id} title={p.title || "pro"} />
                      ) : (
                        <Link
                          href={`/projects/${p.id}/editor`}
                          className="cursor-pointer text-xs font-medium text-accent hover:text-accent-hover"
                        >
                          Editor
                        </Link>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDelete(p.id)}
                        className="cursor-pointer text-xs text-danger hover:opacity-80"
                      >
                        Törlés
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={Boolean(selectedProject)}
        onClose={() => setSelectedProject(null)}
        title={selectedProject?.title}
        className="sm:max-w-2xl"
      >
        {selectedProject && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={selectedProject.status} />
              <span className="text-sm text-muted">
                {selectedProject.channels?.name || "—"}
              </span>
              {selectedProject.generation_cost_usd > 0 && (
                <span className="font-mono text-xs text-muted">
                  ${Number(selectedProject.generation_cost_usd).toFixed(4)}
                </span>
              )}
              <span className="text-xs text-muted">
                {new Date(selectedProject.created_at).toLocaleString("hu-HU")}
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              <Link href={`/projects/${selectedProject.id}/editor`}>
                <Button>Editor</Button>
              </Link>
              <Link href={`/projects/${selectedProject.id}/progress`}>
                <Button variant="secondary">Haladás</Button>
              </Link>
            </div>

            <div className="space-y-3 border-t border-border pt-4">
              <div className="flex justify-between items-center gap-2">
                <h3 className="text-sm font-medium text-muted">Bélyegkép</h3>
                <Button
                  variant="secondary"
                  className="!py-1.5 !px-3 text-xs"
                  disabled={isRegeneratingThumbnail}
                  onClick={() => handleRegenerateThumbnail(selectedProject.id)}
                >
                  {isRegeneratingThumbnail ? "Generálás…" : "Újragenerálás"}
                </Button>
              </div>
              {isPlayableImageUrl(selectedProject.thumbnail_url) ? (
                <div className="space-y-2">
                  <img
                    src={selectedProject.thumbnail_url}
                    alt="Thumbnail"
                    className="w-full aspect-video object-cover rounded-[var(--radius)] border border-border"
                  />
                  <a
                    href={selectedProject.thumbnail_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block cursor-pointer"
                  >
                    <Button variant="secondary" className="!py-1.5 text-xs">
                      Letöltés
                    </Button>
                  </a>
                </div>
              ) : (
                <p className="text-sm text-muted italic">
                  {selectedProject.thumbnail_url === "r2:deleted"
                    ? "Bélyegkép lejárt / ürítve."
                    : "Még nincs bélyegkép."}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-medium text-muted">Cím</h3>
              <div className="flex gap-2">
                <Input readOnly value={selectedProject.title} />
                <Button
                  variant="secondary"
                  onClick={() => copyToClipboard(selectedProject.title, "Cím")}
                >
                  Másolás
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap justify-between gap-2">
                <h3 className="text-sm font-medium text-muted">Szkript</h3>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    className="!py-1.5 text-xs"
                    onClick={() => copyFirstParagraph(selectedProject.generated_script || "")}
                  >
                    Első bek.
                  </Button>
                  <Button
                    variant="secondary"
                    className="!py-1.5 text-xs"
                    onClick={() =>
                      copyToClipboard(selectedProject.generated_script || "", "Szkript")
                    }
                  >
                    Teljes
                  </Button>
                </div>
              </div>
              <Textarea
                readOnly
                value={selectedProject.generated_script || "Nincs még szkript."}
                className="h-40"
              />
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
