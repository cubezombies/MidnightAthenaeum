'use strict';

/**
 * Duplicate detection over the already-scanned library — no new file access
 * needed, just grouping data already in library.json. Books are bucketed by
 * normalized title+author, then split into distinct "recordings" within
 * that bucket by (track count, duration) — matching duration/track count is
 * a strong signal of "the same underlying audio", since duration comes from
 * the actual decoded stream, not a tag that could coincidentally match.
 *
 * This distinction matters: a title+author can legitimately have several
 * different recordings (different narrators someone deliberately collected)
 * that are NOT duplicates of each other and must never be offered for
 * removal — only a recording with 2+ copies (the same audio, filed under
 * more than one folder) is an actual duplicate. Confirmed against a real
 * library: "Illegal Alien" by Robert J. Sawyer has three genuinely
 * different narrators (41-42 tracks each, all different durations) sitting
 * right next to cases that really were the same file copied twice.
 */

const fsp = require('node:fs/promises');
const path = require('node:path');
const { shell } = require('electron');

// Mirrors media-protocol.js's isInside — kept local rather than shared since
// it's a pure 3-line check with no state, and the two modules are otherwise
// unrelated.
function isInside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function normalize(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Small tolerance for encoding jitter between two copies of "the same" audio.
const DURATION_TOLERANCE_SEC = 5;

/**
 * @param {Array} books raw library books (as stored in library.json)
 * @returns {Array<{ title, author, recordings: Array<{ trackCount, duration, books }> }>}
 *   Only title+author buckets containing at least one recording with 2+
 *   copies are included — a title with three different single-copy
 *   narrations and no actual duplicate is not reported at all.
 */
function findDuplicateGroups(books) {
  const byKey = new Map();
  for (const book of books) {
    const t = normalize(book.title);
    if (!t) continue;
    const key = `${t}::${normalize(book.author)}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(book);
  }

  const reports = [];
  for (const entries of byKey.values()) {
    if (entries.length < 2) continue;

    const recordings = [];
    for (const book of entries) {
      const trackCount = book.tracks.length;
      let rec = recordings.find((r) =>
        r.trackCount === trackCount && Math.abs(r.duration - book.duration) <= DURATION_TOLERANCE_SEC);
      if (!rec) {
        rec = { trackCount, duration: book.duration, books: [] };
        recordings.push(rec);
      }
      rec.books.push(book);
    }

    if (!recordings.some((r) => r.books.length >= 2)) continue; // nothing actually duplicated
    reports.push({ title: entries[0].title, author: entries[0].author, recordings });
  }

  // Most-duplicated first, so the biggest wins are at the top of the list.
  reports.sort((a, b) => {
    const maxCopies = (r) => Math.max(...r.recordings.map((rec) => rec.books.length));
    return maxCopies(b) - maxCopies(a);
  });
  return reports;
}

/**
 * Moves this book's files to the Recycle Bin — how much gets trashed depends
 * on `exclusiveDir` (the caller determines this from the full library: does
 * any *other* book share this book's sourceDir?):
 *
 * - `exclusiveDir: true` — this book owns its folder outright, so the whole
 *   folder is trashed in one shot. This sweeps up anything else sitting in
 *   there too (cover art, an NFO file, show notes) that per-file trashing
 *   would otherwise leave behind and treat as "something else is still
 *   here" — since nothing else in the library points at this folder, there
 *   is nothing else to protect.
 * - `exclusiveDir: false` (or omitted) — the folder is shared with sibling
 *   books (confirmed in a real library: a "Radio and Podcast Production"
 *   folder holds four separate single-file books side by side), so only
 *   this book's own track files are touched, never the folder wholesale.
 *   If the folder happens to end up completely empty afterward — checked
 *   with a real readdir, never assumed from the track list — it's trashed
 *   too, so a delete doesn't leave a bare, empty directory behind.
 *
 * `epubPath` is this book's paired read-along ebook, if any (see
 * ebook-pairing.js / the ebook:setPairing handler in main.js). If it lives
 * inside this book's own folder, it's handled as part of whichever mode
 * above applies (swept up by the whole-folder trash, or trashed alongside
 * the tracks). An ebook picked from elsewhere on disk (pickEbookFile can
 * point anywhere) is never trashed, in either mode — it's a file the user
 * manages separately, not something a pairing record alone justifies
 * deleting; only its pairing record is dropped, by the caller.
 *
 * Recoverable via the Recycle Bin in every case here, never a permanent
 * delete.
 */
async function trashBookFiles(book, { epubPath, exclusiveDir } = {}) {
  const epubIsCoLocated = epubPath ? isInside(book.sourceDir, epubPath) : false;
  let results;

  if (exclusiveDir) {
    try {
      await shell.trashItem(book.sourceDir);
      results = [{ filePath: book.sourceDir, ok: true }];
    } catch (err) {
      results = [{ filePath: book.sourceDir, ok: false, error: err.message }];
    }
  } else {
    results = [];
    for (const track of book.tracks) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await shell.trashItem(track.filePath);
        results.push({ filePath: track.filePath, ok: true });
      } catch (err) {
        results.push({ filePath: track.filePath, ok: false, error: err.message });
      }
    }

    if (epubIsCoLocated) {
      try {
        await shell.trashItem(epubPath);
      } catch {
        // Best effort — the audio files are already handled above either way.
      }
    }

    try {
      const remaining = await fsp.readdir(book.sourceDir);
      if (remaining.length === 0) await shell.trashItem(book.sourceDir);
    } catch {
      // Best effort — the book's own files are already handled above either
      // way; a directory that can't be read or removed just gets left behind.
    }
  }

  return results;
}

module.exports = { findDuplicateGroups, trashBookFiles };
