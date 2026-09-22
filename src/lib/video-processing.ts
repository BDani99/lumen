import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";

const run = promisify(execFile);

export type VideoPostProcessOptions = {
  /** Horizontal zoom-in percentage (e.g. 2 for 2%) to crop out side letterboxing; omit/0 for no crop. */
  zoomCropPercent?: number;
};

/**
 * Strips any audio track from a generated video clip and, optionally,
 * applies a horizontal-only zoom-crop (Seedance renders thin black bars on
 * the left/right — cropping ~1% off each side and scaling back removes
 * them without touching vertical framing). Always falls back to the
 * original, untouched buffer if ffmpeg is unavailable or processing fails
 * for any reason — never blocks scene generation over a cosmetic fix.
 */
export async function postProcessVideoBuffer(
  buffer: Buffer,
  opts: VideoPostProcessOptions = {}
): Promise<Buffer> {
  if (!ffmpegPath) return buffer;

  const dir = await mkdtemp(join(tmpdir(), "vidproc-"));
  const inPath = join(dir, "in.mp4");
  const outPath = join(dir, "out.mp4");

  try {
    await writeFile(inPath, buffer);

    const zoomPercent = Number(opts.zoomCropPercent) || 0;
    const args = ["-y", "-i", inPath];

    if (zoomPercent > 0) {
      // Fraction of width kept after cropping both sides equally.
      const keep = Math.min(0.99, Math.max(0.5, 1 - zoomPercent / 100));
      const sideFrac = (1 - keep) / 2;
      const filter =
        `crop=floor(iw*${keep}/2)*2:ih:floor(iw*${sideFrac}/2)*2:0,` +
        `scale=trunc(iw/${keep}/2)*2:ih`;
      args.push(
        "-vf",
        filter,
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart"
      );
    } else {
      args.push("-c:v", "copy", "-an", "-movflags", "+faststart");
    }

    args.push(outPath);

    await run(ffmpegPath, args, { maxBuffer: 1024 * 1024 * 64 });
    return await readFile(outPath);
  } catch (err) {
    console.error("[video-processing] ffmpeg failed, using original buffer:", err);
    return buffer;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
