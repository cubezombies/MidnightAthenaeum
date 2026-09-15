'use strict';

/**
 * Creates a fresh, empty library.db with one real folder registered, so the
 * app's own automatic startup scan (main.js: `if (folders.length) runScan()`)
 * populates it for real from actual files on disk -- for end-to-end testing
 * against the real scan/detail-fill pipeline rather than hand-seeded rows,
 * which get discarded by that same automatic rescan anyway (see the
 * gapless/chapter-image test sessions' notes on this).
 *
 * Usage: node scripts/seed-real-folder.cjs <dataRoot> <folderToScan>
 */

const fs = require('node:fs');
const path = require('node:path');
const { LibraryDb } = require('../src/main/db');

const [, , dataRoot, folder] = process.argv;
if (!dataRoot || !folder) {
  console.error('Usage: node scripts/seed-real-folder.cjs <dataRoot> <folderToScan>');
  process.exit(1);
}

const LIBRARY_DB_FILE = path.join(dataRoot, 'library.db');

async function main() {
  fs.mkdirSync(dataRoot, { recursive: true });
  fs.rmSync(LIBRARY_DB_FILE, { force: true });

  const db = new LibraryDb(LIBRARY_DB_FILE);
  await db.load(null);
  db.set({ folders: [path.resolve(folder)], books: [] });
  await db.close();

  console.log(`Registered ${path.resolve(folder)} in a fresh library.db at ${LIBRARY_DB_FILE}`);
  console.log('The app will scan it for real on next launch.');
}

main().catch((err) => { console.error(err); process.exit(1); });
