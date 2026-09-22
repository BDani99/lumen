/**
 * One-off: re-mux already-stored R2 clips so their `moov` atom sits at the
 * FRONT of the file (`-movflags +faststart`).
 *
 * Clips generated before that flag was added have `moov` at the very end,
 * which means a browser must download essentially the whole file before it
 * can paint a single frame — blank thumbnails and black previews in the
 * editor. This is a stream copy (`-c copy`): no re-encode, no quality loss,
 * and it re-uploads to the SAME key so every existing DB URL keeps working.
 *
 * Idempotent — anything already laid out `ftyp → moov` is skipped.
 *
 * Usage (from repo root):
 *   npx tsx --env-file=.env.local scripts/remux-r2-faststart.ts            (dry run)
 *   npx tsx --env-file=.env.local scripts/remux-r2-faststart.ts --confirm  (rewrite)
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";
import {
  downloadUrlToBuffer,
  isR2Configured,
  listR2Objects,
  publicUrlForKey,
  uploadMp4ToR2,
} from "../src/lib/r2";

const run = promisify(execFile);
const CONFIRM = process.argv.includes("--confirm");

/** Top-level MP4 box types in order — faststart means `moov` comes before `mdat`. */
function topLevelBoxes(buf: Buffer): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < buf.length - 8 && out.length < 12) {
    const len = buf.readUInt32BE(i);
    out.push(buf.toString("ascii", i + 4, i + 8));
    if (len <= 0) break;
    i += len;
  }
  return out;
}

function isFaststart(buf: Buffer): boolean {
  const boxes = topLevelBoxes(buf);
  const moov = boxes.indexOf("moov");
  const mdat = boxes.indexOf("mdat");
  if (moov === -1) return false;
  return mdat === -1 || moov < mdat;
}

async function remux(buf: Buffer): Promise<Buffer> {
  if (!ffmpegPath) throw new Error("ffmpeg-static binary not found");
  const dir = await mkdtemp(join(tmpdir(), "remux-"));
  const inPath = join(dir, "in.mp4");
  const outPath = join(dir, "out.mp4");
  try {
    await writeFile(inPath, buf);
    await run(
      ffmpegPath,
      ["-y", "-i", inPath, "-c", "copy", "-an", "-movflags", "+faststart", outPath],
      { maxBuffer: 1024 * 1024 * 64 }
    );
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function main() {
  if (!isR2Configured()) {
    throw new Error("R2_* env missing");
  }

  const objects = await listR2Objects("projects/");
  const mp4Keys = objects.map((o) => o.key).filter((k) => k.toLowerCase().endsWith(".mp4"));
  console.log(`Found ${mp4Keys.length} .mp4 objects under "projects/".`);

  let alreadyOk = 0;
  let fixed = 0;
  let failed = 0;

  for (const key of mp4Keys) {
    try {
      const buf = await downloadUrlToBuffer(publicUrlForKey(key));
      if (isFaststart(buf)) {
        alreadyOk += 1;
        continue;
      }
      if (!CONFIRM) {
        console.log(`  would fix: ${key}  [${topLevelBoxes(buf).join(" → ")}]`);
        fixed += 1;
        continue;
      }
      const out = await remux(buf);
      if (!isFaststart(out)) {
        throw new Error("remux did not produce a faststart layout");
      }
      await uploadMp4ToR2({ key, body: out });
      fixed += 1;
      console.log(`  fixed: ${key} (${buf.length} → ${out.length} bytes)`);
    } catch (e: any) {
      failed += 1;
      console.error(`  FAILED: ${key}: ${e?.message || e}`);
    }
  }

  console.log(
    `\n${CONFIRM ? "Done" : "Dry run"} — already faststart: ${alreadyOk}, ${
      CONFIRM ? "fixed" : "would fix"
    }: ${fixed}, failed: ${failed}`
  );
  if (!CONFIRM && fixed > 0) {
    console.log("Pass --confirm to actually rewrite these objects.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
