'use strict';

/**
 * Best-effort automatic pairing of an audiobook with its matching EPUB, for
 * the read-along feature. Deliberately on-demand (called once per book, the
 * first time its read-along panel is opened) rather than folded into the
 * library scan — this library lives on a spinning HDD where cross-directory
 * seeks are the real cost (see library.js's BOOK_CONCURRENCY comment); an
 * extra 1-3 `readdir` calls per book on every scan of ~6,300 books would
 * fight that directly, for a feature most sessions will only touch a
 * handful of books through.
 */

const fsp = require('node:fs/promises');
const path = require('node:path');

const EBOOK_EXTENSIONS = new Set(['.epub']);
// 'epub' (bare, lowercase) turned out to be the dominant real-world name in
// this library, not 'E-Books' — confirmed via a real-data dry run (only
// 102/354 real epub files fell inside the original E-Books-only radius).
// Keep the E-Books variants too since both conventions plausibly exist
// across a library assembled over years from different sources.
const EBOOK_DIR_NAMES = new Set(['e-books', 'ebooks', 'ebook', 'epub', 'epubs']);

// Confidence floor for a scored (multi-candidate) match, as a fraction of
// the audiobook title's words found in the candidate filename — below this,
// leave unpaired for manual pick rather than guess wrong. An omnibus/box-set
// epub sitting next to per-volume audiobooks is a real case where a wrong
// guess is worse than no guess. Known limitation: no stopword list, so very
// short/generic titles are more prone to a spuriously high score — accepted
// given the manual-override path always exists.
const MATCH_CONFIDENCE_FLOOR = 0.5;

function normalize(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function tokens(s) {
  const n = normalize(s);
  return n ? n.split(' ') : [];
}

/** Fraction of `text`'s tokens that also appear in `candidate`'s tokens. */
function tokenOverlap(text, candidate) {
  const wanted = tokens(text);
  const have = new Set(tokens(candidate));
  if (!wanted.length) return 0;
  return wanted.filter((t) => have.has(t)).length / wanted.length;
}

async function listEpubFiles(dir) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && EBOOK_EXTENSIONS.has(path.extname(e.name).toLowerCase()))
    .map((e) => path.join(dir, e.name));
}

async function findEbookSubfolder(dir) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const match = entries.find((e) => e.isDirectory() && EBOOK_DIR_NAMES.has(e.name.toLowerCase()));
  return match ? path.join(dir, match.name) : null;
}

/**
 * All .epub files within a book's search radius: its own folder, an
 * "E-Books"-style subfolder inside it, and the same subfolder name as a
 * sibling of the book's own folder (one directory up) — the one concrete
 * real-world layout this library is known to use (Calibre `.opf` files were
 * found sitting in `E-Books/` subfolders during the sidecar-metadata
 * investigation in ROADMAP.md). Verified against the real library in a
 * dry-run before this was trusted — see that script for the radius-coverage
 * numbers this design is based on.
 */
async function findCandidates(sourceDir) {
  const dirs = [sourceDir];

  const ownSub = await findEbookSubfolder(sourceDir);
  if (ownSub) dirs.push(ownSub);

  const parent = path.dirname(sourceDir);
  if (parent && parent !== sourceDir) {
    const siblingSub = await findEbookSubfolder(parent);
    if (siblingSub) dirs.push(siblingSub);
  }

  const found = [];
  for (const dir of dirs) {
    // eslint-disable-next-line no-await-in-loop
    for (const file of await listEpubFiles(dir)) found.push(file);
  }
  return [...new Set(found)];
}

/**
 * Best-effort automatic pairing for one book. Read-only — never persists
 * anything; the caller (main.js) decides whether/how to store the result,
 * same read-only-preview-then-explicit-commit split as reorganize:plan /
 * reorganize:execute.
 *
 * Disambiguation among multiple candidates (e.g. a shared "E-Books/" folder
 * holding a whole series) is title-only, deliberately: candidates that share
 * a folder with one audiobook very often share its author too, so author
 * text rarely helps tell them apart — title is what actually differs.
 *
 * @param {{ sourceDir: string, title: string }} book
 * @returns {Promise<{ status: 'matched'|'ambiguous'|'none', epubPath: string|null, candidates: string[] }>}
 */
async function findPairing(book) {
  const candidates = await findCandidates(book.sourceDir);
  if (!candidates.length) return { status: 'none', epubPath: null, candidates: [] };
  if (candidates.length === 1) return { status: 'matched', epubPath: candidates[0], candidates };

  let best = null;
  let bestScore = 0;
  for (const file of candidates) {
    const score = tokenOverlap(book.title, path.parse(file).name);
    if (score > bestScore) { bestScore = score; best = file; }
  }
  if (best && bestScore >= MATCH_CONFIDENCE_FLOOR) {
    return { status: 'matched', epubPath: best, candidates };
  }
  return { status: 'ambiguous', epubPath: null, candidates };
}

module.exports = { findPairing, findCandidates };
