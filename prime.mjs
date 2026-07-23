// Run a full library scan outside Electron and write the cache the app reads
// on startup, so the first launch isn't a 10-minute wait.
import { createRequire } from 'node:module';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { scanLibrary, fillBookDetails } = require('./src/main/library.js');
const { LIBRARY_FILE, DATA_ROOT } = require('./src/main/paths.js');

const folders = process.argv.slice(2);
if (!folders.length) {
  console.error('usage: node prime.mjs <folder> [folder…]');
  process.exit(1);
}

let cached = [];
try {
  cached = JSON.parse(await readFile(LIBRARY_FILE, 'utf8')).books ?? [];
  console.log(`reusing ${cached.length} cached books`);
} catch { /* first run */ }

const t0 = Date.now();
let lastLog = 0;
console.log('phase 1: tags + duration…');
const books = await scanLibrary(folders, cached, (done, total) => {
  const now = Date.now();
  if (now - lastLog > 2000 || done === total) {
    lastLog = now;
    const elapsed = (now - t0) / 1000;
    const rate = done / elapsed;
    const eta = rate > 0 ? (total - done) / rate : 0;
    console.log(`  ${done}/${total} books  ${elapsed.toFixed(0)}s elapsed  ETA ${eta.toFixed(0)}s`);
  }
});

// Priming exists to move ALL the slow work off the interactive app-launch
// path, so unlike the app's own background fill (deliberately gentle, low
// concurrency, so it doesn't compete with foreground use), this runs phase 2
// to completion too, right here, before the app ever launches.
const pendingCount = books.filter((b) => b.detailPending).length;
if (pendingCount) {
  console.log(`phase 2: covers + chapters for ${pendingCount} book(s)…`);
  const t1 = Date.now();
  let filled = 0;
  // fillBookDetails doesn't mutate `books` -- it hands each updated book to
  // onBookDone and leaves merging to the caller (main.js does the same via
  // writeDetailUpdate).
  const detailed = new Map();
  await fillBookDetails(books, {
    concurrency: 2,
    onBookDone: (updated) => {
      detailed.set(updated.id, updated);
      filled += 1;
      const now = Date.now();
      if (now - lastLog > 2000 || filled === pendingCount) {
        lastLog = now;
        console.log(`  ${filled}/${pendingCount} detailed  ${((now - t1) / 1000).toFixed(0)}s elapsed`);
      }
    },
  });
  for (let i = 0; i < books.length; i += 1) {
    if (detailed.has(books[i].id)) books[i] = detailed.get(books[i].id);
  }
}

await mkdir(DATA_ROOT, { recursive: true });
await writeFile(LIBRARY_FILE, JSON.stringify({ folders, books }, null, 2), 'utf8');

const totalHours = books.reduce((sum, b) => sum + (b.duration || 0), 0) / 3600;
console.log(`\ndone: ${books.length} books, ${totalHours.toFixed(0)} listening hours, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
console.log(`  with chapters: ${books.filter(b => b.chapters.length).length}`);
console.log(`  with cover:    ${books.filter(b => b.cover).length}`);
console.log(`  zero duration: ${books.filter(b => !b.duration).length}`);
console.log(`written -> ${LIBRARY_FILE}`);
