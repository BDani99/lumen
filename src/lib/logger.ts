const isProd = process.env.NODE_ENV === "production";

/**
 * Thin console wrapper — `debug` is silenced in production (progress/retry
 * chatter that's only useful while developing), while `info`/`warn`/`error`
 * always log so real issues still reach Vercel/Inngest Cloud logs.
 */
export const logger = {
  debug: (...args: unknown[]) => {
    if (!isProd) console.log(...args);
  },
  info: (...args: unknown[]) => console.log(...args),
  warn: (...args: unknown[]) => console.warn(...args),
  error: (...args: unknown[]) => console.error(...args),
};
