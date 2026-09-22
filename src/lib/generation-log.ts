import { supabaseAdmin } from "./supabase";

export type GenerationLogLevel = "info" | "success" | "warn" | "error";

export async function appendGenerationLog(
  projectId: string,
  entry: {
    level?: GenerationLogLevel;
    stage: string;
    message: string;
    meta?: Record<string, unknown>;
  }
) {
  const { error } = await supabaseAdmin.from("generation_logs").insert({
    project_id: projectId,
    level: entry.level || "info",
    stage: entry.stage,
    message: entry.message,
    meta: entry.meta || {},
  });

  if (error) {
    console.error("[generation-log] Failed to append log:", error.message, entry);
  }
}

// Re-export status helpers for server convenience
export {
  PIPELINE_STAGES,
  STATUS_LABELS,
  STATUS_COLORS,
  statusLabel,
  statusColorClass,
  pipelineStageIndex,
} from "./generation-status";
