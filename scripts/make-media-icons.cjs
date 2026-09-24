'use strict';

/**
 * Generate the taskbar thumbbar button icons (prev chapter / play / pause /
 * next chapter) as small multi-size .ico files under build/media-icons/.
 *
 * Drawn as flat white glyphs on transparent background (Windows' default
 * taskbar/flyout theme is dark, so white reads clearly there) at a large
 * canvas and downsized with bicubic resampling for free anti-aliasing —
 * same trick as make-icons.cjs.
 */

const fs = require('node:fs');
const path = require('node:path');
const { Jimp, ResizeStrategy } = require('jimp');
const pngToIco = require('png-to-ico').default;

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'build', 'media-icons');
const CANVAS = 128;
const ICO_SIZES = [16, 20, 24, 32, 48];
const WHITE = 0xffffffff;
const MARGIN = 28; // px, at the 128 canvas

/** True if (px,py) sits inside a triangle with a vertical base (x0..x0, y0..y1) and an apex at (apexX, midY). */
function inTriangle(px, py, x0, y0, y1, apexX) {
  if (apexX >= x0 ? (px < x0 || px > apexX) : (px > x0 || px < apexX)) return false;
  const mid = (y0 + y1) / 2;
  const halfH = ((y1 - y0) / 2) * Math.abs(apexX - px) / Math.abs(apexX - x0);
  return Math.abs(py - mid) <= halfH;
}

function inRect(px, py, x0, y0, x1, y1) {
  return px >= x0 && px <= x1 && py >= y0 && py <= y1;
}

async function renderIcon(name, predicate) {
  const img = new Jimp({ width: CANVAS, height: CANVAS, color: 0x00000000 });
  img.scan(0, 0, CANVAS, CANVAS, (x, y, idx) => {
    if (predicate(x + 0.5, y + 0.5)) img.bitmap.data.writeUInt32BE(WHITE, idx);
  });

  const pngBuffers = [];
  for (const size of ICO_SIZES) {
    const buf = await img.clone().resize({ w: size, h: size, mode: ResizeStrategy.BICUBIC }).getBuffer('image/png');
    pngBuffers.push(buf);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const dest = path.join(OUT_DIR, `${name}.ico`);
  fs.writeFileSync(dest, await pngToIco(pngBuffers));
  console.log(`wrote ${dest}`);

  // For eyeballing the shape — same convention as make-icons.cjs's icon-preview.png.
  await img.write(path.join(OUT_DIR, `${name}-preview.png`));
}

async function main() {
  const lo = MARGIN;
  const hi = CANVAS - MARGIN;

  // Play: right-pointing triangle.
  await renderIcon('play', (x, y) => inTriangle(x, y, lo, lo, hi, hi));

  // Pause: two vertical bars.
  const barW = 22;
  const gap = 18;
  const midX = CANVAS / 2;
  await renderIcon('pause', (x, y) => (
    inRect(x, y, midX - gap / 2 - barW, lo, midX - gap / 2, hi)
    || inRect(x, y, midX + gap / 2, lo, midX + gap / 2 + barW, hi)
  ));

  // Previous chapter: a bar on the left, then a left-pointing triangle (mirrors ⏮).
  const stemW = 12;
  await renderIcon('prev', (x, y) => (
    inRect(x, y, lo, lo, lo + stemW, hi)
    || inTriangle(x, y, hi, lo, hi, lo + stemW)
  ));

  // Next chapter: a right-pointing triangle, then a bar on the right (mirrors ⏭).
  await renderIcon('next', (x, y) => (
    inTriangle(x, y, lo, lo, hi, hi - stemW)
    || inRect(x, y, hi - stemW, lo, hi, hi)
  ));
}

main().catch((err) => { console.error(err); process.exit(1); });
