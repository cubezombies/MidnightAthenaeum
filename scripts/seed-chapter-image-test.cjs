'use strict';

/**
 * Seeds a single real, playable single-file book whose first chapter has a
 * real cached image file, simulating the post-parse state that
 * mp4-chapters.js's readChapterImages + parse-core.js's cacheChapterImage
 * would produce -- for verifying the toClientBook -> renderer half of
 * per-chapter artwork (thumbnail in the chapter list, mini-player/
 * mediaSession swap) without needing a real enhanced-audiobook fixture.
 *
 * Usage: node scripts/seed-chapter-image-test.cjs <dataRoot> <audioFile> <chapter1ImageFile>
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { LibraryDb } = require('../src/main/db');

const [, , dataRoot, audioFile, imageFile] = process.argv;
if (!dataRoot || !audioFile || !imageFile) {
  console.error('Usage: node scripts/seed-chapter-image-test.cjs <dataRoot> <audioFile> <chapter1ImageFile>');
  process.exit(1);
}

const LIBRARY_DB_FILE = path.join(dataRoot, 'library.db');
const COVER_DIR = path.join(dataRoot, 'covers');

async function main() {
  fs.mkdirSync(COVER_DIR, { recursive: true });
  fs.rmSync(LIBRARY_DB_FILE, { force: true });

  const db = new LibraryDb(LIBRARY_DB_FILE);
  await db.load(null);

  const id = crypto.randomUUID();
  // Copy into the cache dir under the naming convention cacheChapterImage
  // uses, so this looks exactly like what the real pipeline would produce.
  const cachedImagePath = path.join(COVER_DIR, `${id}-ch0.jpg`);
  fs.copyFileSync(path.resolve(imageFile), cachedImagePath);

  const book = {
    id,
    kind: 'single',
    sourceDir: path.dirname(path.resolve(audioFile)),
    title: 'Chapter Image Test',
    author: 'Test Fixture',
    narrator: null,
    year: null,
    description: 'One chapter with artwork, one without, for verifying per-chapter image display.',
    duration: 8,
    cover: null,
    coverThumb: null,
    tracks: [{ filePath: path.resolve(audioFile), duration: 8, title: null }],
    chapters: [
      { index: 0, title: 'Intro (has art)', start: 0, end: 3, image: cachedImagePath },
      { index: 1, title: 'Main Event (no art)', start: 3, end: 8 },
    ],
    signature: crypto.randomUUID(),
    dirSig: null,
    detailPending: false,
    detailFailed: false,
    tagsFailed: false,
  };

  // Deliberately NOT registering the audio file's folder: this app runs an
  // automatic library rescan of every registered folder on launch
  // (main.js's `if (libraryStore.get().folders.length) runScan()`), which
  // would re-parse this file from disk and discard the hand-seeded
  // chapters/image below. Leaving it unregistered keeps this book exactly
  // as seeded -- the chapter image itself is still servable regardless
  // (COVER_CACHE is always an allowed root), just not the audio track.
  db.set({ folders: [], books: [book] });
  await db.close();

  console.log(`Seeded chapter-image test book (id=${id}) into ${LIBRARY_DB_FILE}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
