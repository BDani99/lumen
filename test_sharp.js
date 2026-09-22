const sharp = require('sharp');
const fs = require('fs');

async function run() {
  const buffer = await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
  const metadata = await sharp(buffer).metadata();
  console.log('Original:', metadata.width, metadata.height);

  const targetRatio = 16 / 9;
  const currentRatio = metadata.width / metadata.height;

  let extractParams = { left: 0, top: 0, width: metadata.width, height: metadata.height };

  if (Math.abs(currentRatio - targetRatio) > 0.01) {
    if (currentRatio > targetRatio) {
      const newWidth = Math.round(metadata.height * targetRatio);
      extractParams.left = Math.round((metadata.width - newWidth) / 2);
      extractParams.width = newWidth;
    } else {
      const newHeight = Math.round(metadata.width / targetRatio);
      extractParams.top = Math.round((metadata.height - newHeight) / 2);
      extractParams.height = newHeight;
    }

    const outBuffer = await sharp(buffer).extract(extractParams).toBuffer();
    const outMeta = await sharp(outBuffer).metadata();
    console.log('Extracted:', outMeta.width, outMeta.height, outMeta.format);
  }
}

run().catch(console.error);
