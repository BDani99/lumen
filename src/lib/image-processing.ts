import sharp from "sharp";

const TARGET_RATIO = 16 / 9;
const RATIO_TOLERANCE = 0.01;

/**
 * Center-crops an image buffer to 16:9 aspect ratio before storage.
 *
 * Always re-encodes to real PNG bytes, even when no crop is needed. Callers
 * (uploadImageToR2) unconditionally store the result as ".png" /
 * "image/png" — but sources like stock-provider photos are frequently
 * JPEG and often already close to 16:9, so an early "already the right
 * shape, return as-is" path would silently ship raw JPEG bytes under a
 * ".png" name. DaVinci Resolve refuses to import such a mismatched file
 * ("Media Offline") even though the bytes decode fine as a JPEG.
 */
export async function cropTo16x9(buffer: Buffer): Promise<Buffer> {
  const metadata = await sharp(buffer).metadata();

  if (!metadata.width || !metadata.height) {
    return sharp(buffer).png().toBuffer();
  }

  const currentRatio = metadata.width / metadata.height;

  if (Math.abs(currentRatio - TARGET_RATIO) <= RATIO_TOLERANCE) {
    return sharp(buffer).png().toBuffer();
  }

  let left = 0;
  let top = 0;
  let width = metadata.width;
  let height = metadata.height;

  if (currentRatio > TARGET_RATIO) {
    width = Math.round(metadata.height * TARGET_RATIO);
    left = Math.round((metadata.width - width) / 2);
  } else {
    height = Math.round(metadata.width / TARGET_RATIO);
    top = Math.round((metadata.height - height) / 2);
  }

  return sharp(buffer)
    .extract({ left, top, width, height })
    .png()
    .toBuffer();
}
