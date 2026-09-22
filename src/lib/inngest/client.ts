import { Inngest } from "inngest";

/**
 * Local: INNGEST_DEV=1 in .env.local (or auto when `next dev` and no signing key).
 * Vercel: set INNGEST_SIGNING_KEY + INNGEST_EVENT_KEY (Inngest integration does this).
 * Never set INNGEST_DEV=1 on Vercel.
 */
const explicitDev =
  process.env.INNGEST_DEV === "1" ||
  process.env.INNGEST_DEV === "true" ||
  process.env.INNGEST_DEV?.startsWith("http");

const explicitCloud = process.env.INNGEST_DEV === "0" || process.env.INNGEST_DEV === "false";

const isDev = explicitCloud
  ? false
  : explicitDev ||
    (process.env.NODE_ENV === "development" && !process.env.INNGEST_SIGNING_KEY);

export const inngest = new Inngest({
  id: "youtube-video-generator",
  isDev,
  // Checkpointing (v4 default): keep under Vercel function maxDuration (see /api/inngest).
  checkpointing: {
    maxRuntime: "200s",
  },
});
