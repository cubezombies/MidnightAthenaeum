'use strict';

/**
 * Seeds a single real, playable 2-track book (two short generated mp3s) into
 * a throwaway data root, for manually/automatically verifying gapless
 * track-boundary playback against real audio instead of the fake-path demo
 * library (whose tracks don't exist on disk and can't actually play).
 *
 * Usage: node scripts/seed-gapless-test.cjs <dataRoot> <trackAPath> <trackBPath>
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { LibraryDb } = require('../src/main/db');

const [, , dataRoot, trackA, trackB] = process.argv;
if (!dataRoot || !trackA || !trackB) {
  console.error('Usage: node scripts/seed-gapless-test.cjs <dataRoot> <trackAPath> <trackBPath>');
  process.exit(1);
}

const LIBRARY_DB_FILE = path.join(dataRoot, 'library.db');

async function main() {
  fs.mkdirSync(dataRoot, { recursive: true });
  fs.rmSync(LIBRARY_DB_FILE, { force: true });

  const db = new LibraryDb(LIBRARY_DB_FILE);
  await db.load(null);

  const id = crypto.randomUUID();
  const tracks = [
    { filePath: path.resolve(trackA), duration: 6, title: 'Track A' },
    { filePath: path.resolve(trackB), duration: 6, title: 'Track B' },
  ];
  const chapters = [
    { index: 0, title: 'Track A', start: 0, end: 6 },
    { index: 1, title: 'Track B', start: 6, end: 12 },
  ];

  const book = {
    id,
    kind: 'multi',
    sourceDir: path.dirname(path.resolve(trackA)),
    title: 'Gapless Boundary Test',
    author: 'Test Fixture',
    narrator: null,
    year: null,
    description: 'Two short generated tones, used to verify the track-boundary handoff.',
    duration: 12,
    cover: null,
    coverThumb: null,
    tracks,
    chapters,
    signature: crypto.randomUUID(),
    dirSig: null,
    detailPending: false,
    detailFailed: false,
    tagsFailed: false,
  };

  db.set({ folders: [path.dirname(path.resolve(trackA))], books: [book] });
  await db.close();

  console.log(`Seeded gapless test book (id=${id}) into ${LIBRARY_DB_FILE}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
