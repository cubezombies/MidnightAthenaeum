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

  // Mask to a circular badge at high resolution: everything outside the
  // inscribed circle goes transparent, with a 1px anti-aliased edge. Doing this
  // once at 1024 and then downscaling gives every icon size a smooth circle.
  const master = emblem.clone().resize(1024, 1024, Jimp.RESIZE_BICUBIC);
  circularMask(master);

  await master.clone().writeAsync(ICON_PNG);
  console.log(`wrote ${ICON_PNG} (circular)`);

  const pngBuffers = [];
  for (const size of ICO_SIZES) {
    const buf = await master.clone().resize(size, size, Jimp.RESIZE_BICUBIC).getBufferAsync(Jimp.MIME_PNG);
    pngBuffers.push(buf);
  }
  fs.mkdirSync(path.dirname(ICO), { recursive: true });
  fs.writeFileSync(ICO, await pngToIco(pngBuffers));
  console.log(`wrote ${ICO} (${ICO_SIZES.join(', ')})`);
}

/** Make everything outside the inscribed circle transparent (anti-aliased). */
function circularMask(img) {
  const { width: w, height: h, data } = img.bitmap;
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) / 2 - 1; // tiny inset so the edge doesn't touch the bounds
  img.scan(0, 0, w, h, (x, y, idx) => {
    const dx = x + 0.5 - cx;
    const dy = y + 0.5 - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    // coverage: 1 inside, 0 outside, ramp across the 1px boundary
    const coverage = Math.max(0, Math.min(1, r - dist + 0.5));
    if (coverage < 1) data[idx + 3] = Math.round(data[idx + 3] * coverage);
  });
  return img;
}

main().catch((err) => { console.error(err); process.exit(1); });
