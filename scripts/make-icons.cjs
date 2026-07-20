'use strict';

/**
 * Generate app icons from the full logo banner.
 *
 *   assets/logo.png  (full 16:9 hero art, committed)
 *      -> assets/icon.png   square emblem, 1024x1024 (text/background cropped away)
 *      -> assets/icon-preview.png  same, for eyeballing the crop
 *      -> build/icon.ico    multi-size Windows icon (16..256)
 *
 * The emblem sits in the upper-centre of the banner, above the wordmark. The
 * crop is expressed as fractions of the source so it survives a re-export at a
 * different resolution; tweak CROP if the framing is off and re-run.
 */

const fs = require('node:fs');
const path = require('node:path');
const Jimp = require('jimp');
const pngToIco = require('png-to-ico').default;

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'logo.png');
const ICON_PNG = path.join(ROOT, 'assets', 'icon.png');
const ICO = path.join(ROOT, 'build', 'icon.ico');

// Square crop around the emblem, as fractions of the source dimensions.
const CROP = {
  cx: 0.502,  // horizontal centre of the emblem
  cy: 0.350,  // vertical centre of the emblem (it sits above the wordmark)
  side: 0.62, // square side as a fraction of image height
};

const ICO_SIZES = [256, 128, 64, 48, 32, 24, 16];

async function main() {
  const img = await Jimp.read(SRC);
  const { width: W, height: H } = img.bitmap;
  console.log(`source: ${W}x${H}`);

  const side = Math.round(CROP.side * H);
  let x = Math.round(CROP.cx * W - side / 2);
  let y = Math.round(CROP.cy * H - side / 2);
  x = Math.max(0, Math.min(x, W - side));
  y = Math.max(0, Math.min(y, H - side));
  console.log(`crop: x=${x} y=${y} side=${side}`);

  const emblem = img.clone().crop(x, y, side, side);

  await emblem.clone().resize(1024, 1024, Jimp.RESIZE_BICUBIC).writeAsync(ICON_PNG);
  console.log(`wrote ${ICON_PNG}`);

  const pngBuffers = [];
  for (const size of ICO_SIZES) {
    const buf = await emblem.clone().resize(size, size, Jimp.RESIZE_BICUBIC).getBufferAsync(Jimp.MIME_PNG);
    pngBuffers.push(buf);
  }
  fs.mkdirSync(path.dirname(ICO), { recursive: true });
  fs.writeFileSync(ICO, await pngToIco(pngBuffers));
  console.log(`wrote ${ICO} (${ICO_SIZES.join(', ')})`);
}

main().catch((err) => { console.error(err); process.exit(1); });
