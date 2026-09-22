/**
 * Pure helper for detecting a silently-dead generation run — e.g. the local
 * dev server got closed mid-generation. No side effects, safe to import from
 * both a client component (for the UI banner) and an API route (for the
 * actual, authoritative check before resuming).
 */

/** Generous on purpose: rate-limit backoffs and AI33 progress-jump gaps can
 *  legitimately span several minutes without a new log line. */
export const STALL_THRESHOLD_MIN = 8;

/** Statuses a generation can plausibly be silently stuck in. */
export const RESUMABLE_STATUSES = ["Script_Generation", "Audio_Generation", "Image_Generation"] as const;

export type ResumableStatus = (typeof RESUMABLE_STATUSES)[number];

export function isResumableStatus(status: string): status is ResumableStatus {
  return (RESUMABLE_STATUSES as readonly string[]).includes(status);
}

export function minutesSince(timestamp: string | Date): number {
  return (Date.now() - new Date(timestamp).getTime()) / 60000;
}

/**
 * True when `status` is a working stage AND nothing has happened for at
 * least `STALL_THRESHOLD_MIN` minutes. `lastActivityAt` should be the most
 * recent `generation_logs.created_at` for the project (null/undefined = no
 * activity recorded at all, e.g. a fresh Draft — never considered stalled).
 */
export function isStalled(status: string, lastActivityAt: string | Date | null | undefined): boolean {
  if (!isResumableStatus(status) || !lastActivityAt) return false;
  return minutesSince(lastActivityAt) >= STALL_THRESHOLD_MIN;
}
