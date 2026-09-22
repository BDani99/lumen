/** Ordered pipeline stages for progress UI */
export const PIPELINE_STAGES = [
  { id: "Draft", label: "Indítás", description: "Projekt létrehozva" },
  { id: "Script_Generation", label: "Szöveg", description: "Forgatókönyv írása" },
  { id: "Script_Ready", label: "Szöveg kész", description: "Forgatókönyv elkészült" },
  { id: "Script_Review", label: "Átnézés", description: "Forgatókönyv jóváhagyásra vár" },
  { id: "Audio_Generation", label: "Hang", description: "TTS és felirat generálása" },
  { id: "Audio_Ready", label: "Hang kész", description: "Hang és SRT mentve" },
  { id: "Image_Generation", label: "Képek", description: "Jelenetek és bélyegkép" },
  { id: "Completed", label: "Kész", description: "Generálás befejezve" },
] as const;

export const STATUS_LABELS: Record<string, string> = {
  Draft: "Vázlat",
  Script_Generation: "Szövegírás",
  Script_Ready: "Szöveg kész",
  Script_Review: "Szöveg átnézése",
  Audio_Generation: "Hanggenerálás",
  Audio_Ready: "Hang kész",
  Image_Generation: "Képgenerálás",
  Completed: "Kész",
  Failed: "Sikertelen",
  Cancelled: "Leállítva",
};

export const STATUS_COLORS: Record<string, string> = {
  Draft: "bg-muted/10 text-muted border-border",
  Script_Generation: "bg-accent-muted text-accent border-accent/25",
  Script_Ready: "bg-accent-muted text-accent border-accent/30",
  Script_Review: "bg-accent-muted text-ink border-accent/40",
  Audio_Generation: "bg-surface text-ink border-border-strong",
  Audio_Ready: "bg-surface text-ink border-border-strong",
  Image_Generation: "bg-accent-muted text-accent border-accent/25",
  Completed: "bg-success-muted text-success border-success/30",
  Failed: "bg-danger-muted text-danger border-danger/30",
  Cancelled: "bg-danger-muted text-danger border-danger/30",
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] || status;
}

export function statusColorClass(status: string): string {
  return STATUS_COLORS[status] || "bg-surface text-muted border-border";
}

/** Index of current stage in PIPELINE_STAGES */
export function pipelineStageIndex(status: string): number {
  if (status === "Failed" || status === "Cancelled") return -1;
  const idx = PIPELINE_STAGES.findIndex((s) => s.id === status);
  return idx >= 0 ? idx : 0;
}

export function isTerminalStatus(status: string): boolean {
  return status === "Completed" || status === "Failed" || status === "Cancelled";
}
