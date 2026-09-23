"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import Link from "next/link";
import { createClient } from "@/utils/supabase/client";
import {
  PIPELINE_STAGES,
  isTerminalStatus,
  pipelineStageIndex,
  statusLabel,
} from "@/lib/generation-status";
import { Banner, Button, ConfirmDialog, StatusBadge } from "@/components/ui";
import { useConfirm } from "@/hooks/useConfirm";
import { cn } from "@/lib/cn";
import { isStalled, minutesSince } from "@/lib/stall-detection";

type LogRow = {
  id: string;
  created_at: string;
  level: "info" | "success" | "warn" | "error" | string;
  stage: string;
  message: string;
  meta?: Record<string, unknown> | null;
};

type ProjectInfo = {
  id: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
  generation_cost_usd?: number | null;
  channel_name: string;
};

const LEVEL_STYLES: Record<string, string> = {
  info: "border-border bg-surface/80 text-ink",
  success: "border-success/30 bg-success-muted text-ink",
  warn: "border-accent/30 bg-accent-muted text-ink",
  error: "border-danger/40 bg-danger-muted text-ink",
};

const LEVEL_DOT: Record<string, string> = {
  info: "bg-muted",
  success: "bg-success",
  warn: "bg-accent",
  error: "bg-danger",
};

export default function ProgressView({
  initialProject,
  initialLogs,
}: {
  initialProject: ProjectInfo;
  initialLogs: LogRow[];
}) {
  const { confirm, dialogProps } = useConfirm();
  const [project, setProject] = useState(initialProject);
  const [logs, setLogs] = useState<LogRow[]>(initialLogs);
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const supabase = useMemo(() => createClient(), []);
  const isTerminal = isTerminalStatus(project.status);
  const isScriptReview = project.status === "Script_Review";
  const lastActivityAt = logs.length > 0 ? logs[logs.length - 1].created_at : null;
  const stalled = isStalled(project.status, lastActivityAt);

  async function handleResume() {
    if (resuming) return;
    setResuming(true);
    setResumeError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/resume`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Folytatás sikertelen");
      }
    } catch (e: any) {
      setResumeError(e?.message || "Folytatás sikertelen");
    } finally {
      setResuming(false);
    }
  }

  async function handleStop() {
    if (stopping || isTerminal) return;
    const ok = await confirm({
      title: "Biztosan leállítod a generálást?",
      description: "A folyamat megszakad, és nem folytatódik automatikusan.",
      tone: "danger",
      confirmLabel: "Leállítás",
    });
    if (!ok) return;
    setStopping(true);
    setStopError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/cancel`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Leállítás sikertelen");
      }
      setProject((prev) => ({
        ...prev,
        status: "Cancelled",
        updated_at: new Date().toISOString(),
      }));
    } catch (e: any) {
      setStopError(e?.message || "Leállítás sikertelen");
    } finally {
      setStopping(false);
    }
  }

  useEffect(() => {
    const projectChannel = supabase
      .channel(`progress-project-${project.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "video_projects",
          filter: `id=eq.${project.id}`,
        },
        (payload) => {
          const row = payload.new as any;
          setProject((prev) => ({
            ...prev,
            status: row.status,
            updated_at: row.updated_at,
            generation_cost_usd: row.generation_cost_usd,
          }));
        }
      )
      .subscribe();

    const logsChannel = supabase
      .channel(`progress-logs-${project.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "generation_logs",
          filter: `project_id=eq.${project.id}`,
        },
        (payload) => {
          const row = payload.new as LogRow;
          setLogs((prev) => {
            if (prev.some((l) => l.id === row.id)) return prev;
            return [...prev, row];
          });
        }
      )
      .subscribe();

    const interval = setInterval(async () => {
      if (isTerminal) return;
      const [{ data: proj }, { data: freshLogs }] = await Promise.all([
        supabase
          .from("video_projects")
          .select("status, updated_at, generation_cost_usd")
          .eq("id", project.id)
          .single(),
        supabase
          .from("generation_logs")
          .select("*")
          .eq("project_id", project.id)
          .order("created_at", { ascending: true }),
      ]);
      if (proj) {
        setProject((prev) => ({
          ...prev,
          status: proj.status,
          updated_at: proj.updated_at,
          generation_cost_usd: proj.generation_cost_usd,
        }));
      }
      if (freshLogs) setLogs(freshLogs);
    }, 4000);

    return () => {
      clearInterval(interval);
      supabase.removeChannel(projectChannel);
      supabase.removeChannel(logsChannel);
    };
  }, [project.id, isTerminal, supabase]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [logs.length]);

  const currentIdx = pipelineStageIndex(project.status);
  const progressPct =
    project.status === "Failed" || project.status === "Cancelled"
      ? 0
      : project.status === "Completed"
        ? 100
        : Math.round(((currentIdx + 0.5) / PIPELINE_STAGES.length) * 100);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/"
          className="cursor-pointer text-sm text-muted hover:text-ink transition-colors"
        >
          ← Projektek
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={project.status} />
          {!isTerminal && !isScriptReview && (
            <span className="text-xs text-muted animate-lumen-pulse">Élő…</span>
          )}
          {project.generation_cost_usd != null && project.generation_cost_usd > 0 && (
            <span className="font-mono text-xs text-muted">
              ${Number(project.generation_cost_usd).toFixed(4)}
            </span>
          )}
          {!isTerminal && (
            <Button
              variant="danger"
              className="!py-1.5 !px-3 text-xs"
              disabled={stopping}
              onClick={handleStop}
            >
              {stopping ? "Leállítás…" : "Stop"}
            </Button>
          )}
          <Link href={`/projects/${project.id}/editor`} className="cursor-pointer">
            <Button variant="secondary" size="sm">
              Editor
            </Button>
          </Link>
        </div>
      </div>

      {stopError && (
        <Banner tone="error" title="Leállítás sikertelen">
          {stopError}
        </Banner>
      )}
      <div>
        <h1 className="font-display text-3xl md:text-4xl tracking-tight text-ink leading-normal pb-0.5">
          {project.title}
        </h1>
        <p className="mt-2 text-sm text-muted">
          {project.channel_name} · {new Date(project.created_at).toLocaleString("hu-HU")}
        </p>
      </div>

      {stalled && (
        <Banner tone="warning" title="Úgy tűnik elakadt a generálás">
          <p className="mb-3">
            {lastActivityAt &&
              `Nincs új esemény ${Math.round(minutesSince(lastActivityAt))} perce. Ha a helyi szerver vagy a böngésző időközben leállt, a folyamat valószínűleg megszakadt.`}{" "}
            A folytatás csak azt a részt generálja újra, ami még hiányzik — a már elkészült
            szöveg/hang/kép/videó nem vész el és nem készül el duplán.
          </p>
          {resumeError && <p className="mb-3 text-sm text-danger">{resumeError}</p>}
          <Button disabled={resuming} onClick={handleResume}>
            {resuming ? "Folytatás indítása…" : "Folytatás"}
          </Button>
        </Banner>
      )}

      {isScriptReview && (
        <Banner tone="warning" title="Forgatókönyv átnézése">
          <p className="mb-3">
            A szöveg elkészült. Nyisd meg az editort, ellenőrizd vagy javítsd, majd folytasd a
            hanggenerálást.
          </p>
          <Link href={`/projects/${project.id}/editor`}>
            <Button>Megnyitás az editorban</Button>
          </Link>
        </Banner>
      )}

      <section>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-display text-lg text-ink">Haladás</h2>
          <span className="font-mono text-xs text-muted">{progressPct}%</span>
        </div>
        <div className="mb-5 h-1.5 overflow-hidden rounded-full bg-surface">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-500",
              project.status === "Failed" || project.status === "Cancelled"
                ? "bg-danger"
                : "bg-accent"
            )}
            style={{
              width: `${Math.max(progressPct, project.status === "Draft" ? 8 : progressPct)}%`,
            }}
          />
        </div>
        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
          {PIPELINE_STAGES.map((stage, idx) => {
            const stopped =
              project.status === "Failed" || project.status === "Cancelled";
            const done =
              project.status === "Completed" || (currentIdx > idx && !stopped);
            const active = currentIdx === idx && !stopped;
            return (
              <li
                key={stage.id}
                className={cn(
                  "rounded-[var(--radius)] border px-2.5 py-2",
                  done && "border-success/30 bg-success-muted",
                  active && "border-accent/40 bg-accent-muted",
                  !done && !active && "border-border bg-bg-elevated/50"
                )}
              >
                <div
                  className={cn(
                    "text-[11px] font-medium",
                    done ? "text-success" : active ? "text-accent" : "text-muted"
                  )}
                >
                  {stage.label}
                </div>
                <div className="mt-0.5 text-[10px] text-muted leading-snug">
                  {stage.description}
                </div>
              </li>
            );
          })}
        </ol>
        {project.status === "Failed" && (
          <p className="mt-4 text-sm text-danger">
            A generálás megszakadt. A részletek a naplóban látszanak.
          </p>
        )}
        {project.status === "Cancelled" && (
          <p className="mt-4 text-sm text-danger">
            A generálást leállítottad. A folyamat nem folytatódik.
          </p>
        )}
      </section>

      <section className="border border-border rounded-[var(--radius-panel)] overflow-hidden">
        <div className="border-b border-border px-5 py-3 flex items-center justify-between bg-bg-elevated">
          <h2 className="text-sm font-medium text-ink">Napló</h2>
          <span className="text-xs text-muted">{logs.length} bejegyzés</span>
        </div>
        <div className="max-h-[32rem] overflow-y-auto px-5 py-4">
          {logs.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">
              Még nincs naplóbejegyzés. Ha a generálás fut, hamarosan megjelennek a lépések.
            </p>
          ) : (
            <ul className="space-y-3">
              {logs.map((log) => (
                <li
                  key={log.id}
                  className={cn(
                    "rounded-[var(--radius)] border px-3.5 py-3",
                    LEVEL_STYLES[log.level] || LEVEL_STYLES.info
                  )}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={cn(
                        "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                        LEVEL_DOT[log.level] || LEVEL_DOT.info
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-[11px] uppercase tracking-wide text-muted">
                          {statusLabel(log.stage) !== log.stage
                            ? statusLabel(log.stage)
                            : log.stage}
                        </span>
                        <time className="font-mono text-[11px] text-muted">
                          {new Date(log.created_at).toLocaleString("hu-HU")}
                        </time>
                      </div>
                      <p className="mt-1 text-sm leading-relaxed text-ink">{log.message}</p>
                    </div>
                  </div>
                </li>
              ))}
              <div ref={logEndRef} />
            </ul>
          )}
        </div>
      </section>
      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
