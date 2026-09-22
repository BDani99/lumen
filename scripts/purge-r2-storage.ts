/**
 * One-time full wipe of every project's R2 media (images + videos +
 * thumbnails) — for starting fresh after a round of dev work. Does NOT
 * touch the nightly retention cron (`cleanupOldR2Videos`,
 * src/lib/inngest/r2-cleanup.ts) or any DB rows — this only empties the
 * `projects/` prefix in the R2 bucket.
 *
 * Usage (from repo root, with .env.local loaded):
 *   npx tsx --env-file=.env.local scripts/purge-r2-storage.ts            (dry run — lists only)
 *   npx tsx --env-file=.env.local scripts/purge-r2-storage.ts --confirm  (actually deletes)
 */
import { isR2Configured, listR2Objects, deleteR2Prefix } from "../src/lib/r2";

const CONFIRM = process.argv.includes("--confirm");

async function main() {
  if (!isR2Configured()) {
    throw new Error("R2_* env missing — configure R2 before running this script");
  }

  const objects = await listR2Objects("projects/");
  const totalBytes = objects.length; // size not returned by listR2Objects; count only
  console.log(`Found ${objects.length} objects under "projects/".`);

  if (!CONFIRM) {
    console.log("\nDry run only — pass --confirm to actually delete these objects.");
    for (const o of objects.slice(0, 20)) {
      console.log(`  ${o.key}`);
    }
    if (objects.length > 20) console.log(`  ...and ${objects.length - 20} more`);
    return;
  }

  console.log("\n--confirm passed — deleting now...");
  const deleted = await deleteR2Prefix("projects/");
  console.log(`Deleted ${deleted.length} objects.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
