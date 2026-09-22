import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import {
  generateVideoWorkflow,
  continueVideoWorkflow,
  regenerateScriptWorkflow,
} from "@/lib/inngest/functions";
import { cleanupOldR2Videos } from "@/lib/inngest/r2-cleanup";
import { regenerateMediaWorkflow } from "@/lib/inngest/regenerate-media";
import { proGenerateWorkflow } from "@/lib/inngest/pro/generate";
import { cleanupRateLimitHits } from "@/lib/inngest/rate-limit-cleanup";

/** Vercel serverless limit (seconds). Keep checkpointing.maxRuntime below this. */
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    generateVideoWorkflow,
    continueVideoWorkflow,
    regenerateScriptWorkflow,
    cleanupOldR2Videos,
    regenerateMediaWorkflow,
    proGenerateWorkflow,
    cleanupRateLimitHits,
  ],
});
