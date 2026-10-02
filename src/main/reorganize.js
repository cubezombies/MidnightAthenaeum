'use strict';

/**
 * Reorganize the library on disk into <library folder>/<Author>/<Title>/…
 * The single riskiest feature in this app: unlike everything else, a bug
 * here doesn't corrupt app data, it scatters real audiobook files. Built
 * accordingly —
 *
 *   1. computePlan() is pure and read-only: given the current library, it
 *      returns exactly what WOULD move, touching no files. This is what the
 *      preview UI shows before anything happens.
 *   2. executePlan() only moves what computePlan() decided, one book at a
 *      time, journaling every individual move as it happens (not batched at
 *      the end) so an interruption leaves an accurate record of what's
 *      actually done.
 *   3. undoLastReorganization() replays that journal backwards.
 *
 * A book's sourceDir is only renamed wholesale when this book exclusively
 * owns it. Confirmed in a real library that a folder can hold several
 * unrelated single-file books side by side (four different Alien audio
 * dramas in one "Radio and Podcast Production" folder) — renaming a shared
 * folder would silently relocate books that were never part of the plan, so
 * a shared folder always moves only this book's own files instead. "Owns"
 * also means no other book lives in a subfolder beneath it (see group.js's
 * ownsFolderExclusively) — a folder holding loose audio plus other books'
 * subfolders is just as shared.
 *
 * No move ever overwrites an existing file (see moveOne), and a book whose
 * move fails part-way is rolled back, so each book ends either fully moved
 * or not moved at all — never split across two folders.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { REORG_JOURNAL_FILE } = require('./paths');
const { buildFolderOwnershipIndex, ownsFolderExclusively } = require('./group');

const ILLEGAL_WIN_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;

function sanitizeName(name) {
  const cleaned = (name || '')
    .replace(ILLEGAL_WIN_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, ''); // Windows disallows a trailing dot/space
  return cleaned || 'Unknown';
}

/** Which of the user's configured library folders (if any) contains this book. */
function findRoot(sourceDir, folders) {
  const lower = path.resolve(sourceDir).toLowerCase();
  return folders.find((f) => {
    const fl = path.resolve(f).toLowerCase();
    return lower === fl || lower.startsWith(fl.endsWith(path.sep) ? fl : fl + path.sep);
  }) || null;
}

/**
 * @param {Array} books raw library books
 * @param {string[]} folders the user's configured library root folders
 * @returns {{ moves: Array, skipped: Array, alreadyCorrectCount: number }}
 */
function computePlan(books, folders) {
  const plan = { moves: [], skipped: [], alreadyCorrectCount: 0 };

  const ownership = buildFolderOwnershipIndex(books);

  const claimedTargets = new Set();

  for (const book of books) {
    const root = findRoot(book.sourceDir, folders);
    if (!root) {
      plan.skipped.push({ id: book.id, title: book.title, author: book.author, reason: 'Not under a recognized library folder.' });
      continue;
    }

    const author = sanitizeName(book.author);
    const title = sanitizeName(book.title);
    let targetDir = path.join(root, author, title);
    let suffix = 2;
    while (
      claimedTargets.has(targetDir.toLowerCase())
      || (fs.existsSync(targetDir) && path.resolve(targetDir) !== path.resolve(book.sourceDir))
    ) {
      targetDir = path.join(root, author, `${title} (${suffix})`);
      suffix += 1;
    }
    claimedTargets.add(targetDir.toLowerCase());

    const ownsSourceDir = ownsFolderExclusively(ownership, book.sourceDir);
    if (ownsSourceDir && path.resolve(book.sourceDir) === path.resolve(targetDir)) {
      plan.alreadyCorrectCount += 1;
      continue;
    }

    const fromFiles = book.tracks.map((t) => t.filePath);
    // A folder can't be renamed into its own subfolder (e.g. a book that
    // owns `root\Author` and belongs at `root\Author\Title`), so that case
    // moves its files instead.
    const mode = ownsSourceDir && !isInside(book.sourceDir, targetDir) ? 'folder' : 'files';

    // 'files' mode keeps each track's path relative to the book's folder
    // (`CD1\01.mp3` stays `CD1\01.mp3`), so a disc- or part-merged book's
    // same-named tracks in different subfolders can't land on the same
    // destination; a track outside the folder (shouldn't happen) falls back
    // to its bare name. Anything that would still collide is skipped rather
    // than risked — Windows renames silently replace an existing file.
    let toFiles = null;
    if (mode === 'files') {
      toFiles = fromFiles.map((f) => {
        const rel = path.relative(book.sourceDir, f);
        const safeRel = rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : path.basename(f);
        return path.join(targetDir, safeRel);
      });
      const seen = new Set();
      const collides = toFiles.some((t) => {
        const key = t.toLowerCase();
        if (seen.has(key)) return true;
        seen.add(key);
        return false;
      });
      if (collides) {
        plan.skipped.push({ id: book.id, title: book.title, author: book.author, reason: 'Two of its files would end up with the same name.' });
        continue;
      }
    }

    plan.moves.push({
      bookId: book.id,
      title: book.title,
      author: book.author,
      mode,
      fromDir: book.sourceDir,
      fromFiles,
      toFiles,
      toDir: targetDir,
    });
  }

  return plan;
}

/** True when `child` is strictly inside `parent` (case-insensitive, as on Windows). */
function isInside(parent, child) {
  const rel = path.relative(path.resolve(parent).toLowerCase(), path.resolve(child).toLowerCase());
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Moves a file or folder, refusing to overwrite. `fs.rename` on Windows
 * silently replaces an existing destination file, so a planning mistake (or
 * something appearing at the destination between plan and execute) would
 * otherwise destroy a real audio file with no Recycle Bin copy.
 */
async function moveOne(from, to) {
  if (fs.existsSync(to)) {
    const err = new Error(`Destination already exists: ${to}`);
    err.code = 'EEXIST';
    throw err;
  }
  try {
    await fsp.rename(from, to);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    // Shouldn't happen (reorganizing within the same library root, same
    // drive) but handled defensively rather than assumed away.
    await fsp.cp(from, to, { recursive: true, errorOnExist: true, force: false });
    await fsp.rm(from, { recursive: true, force: true });
  }
}

/**
 * Executes one book's move. 'folder' mode renames the whole (exclusively
 * owned) source folder in one step, bringing along cover art / nfo files
 * automatically. 'files' mode moves only this book's own track files into a
 * freshly created folder, leaving everything else in the shared source
 * folder untouched.
 *
 * Every individual move is journaled the moment it succeeds (tagged with the
 * book's id, which undo uses to tell which books actually came back), so a
 * crash mid-book still leaves an accurate record. If a later file fails, the
 * files already moved are moved back and their journal entries removed, and
 * the error is rethrown — the book ends up exactly where it started.
 */
async function executeMove(move) {
  const entries = [];
  const record = (entry) => {
    const tagged = { ...entry, bookId: move.bookId };
    appendJournal([tagged]);
    entries.push(tagged);
  };
  try {
    if (move.mode === 'folder') {
      await fsp.mkdir(path.dirname(move.toDir), { recursive: true });
      await moveOne(move.fromDir, move.toDir);
      record({ type: 'folder', from: move.fromDir, to: move.toDir });
    } else {
      await fsp.mkdir(move.toDir, { recursive: true });
      for (let i = 0; i < move.fromFiles.length; i++) {
        const from = move.fromFiles[i];
        const to = move.toFiles[i];
        // eslint-disable-next-line no-await-in-loop
        await fsp.mkdir(path.dirname(to), { recursive: true });
        // eslint-disable-next-line no-await-in-loop
        await moveOne(from, to);
        record({ type: 'file', from, to });
      }
    }
  } catch (err) {
    const notRestored = [];
    for (const entry of [...entries].reverse()) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await moveOne(entry.to, entry.from);
      } catch {
        notRestored.push(entry);
      }
    }
    // Only entries that really moved back leave the journal; anything that
    // couldn't is kept, so File > Undo last reorganization can still try.
    removeJournalEntries(entries.filter((e) => !notRestored.includes(e)));
    if (notRestored.length) err.message += ` (and ${notRestored.length} already-moved file(s) could not be moved back; Undo will retry them)`;
    throw err;
  }
  return entries;
}

/** New filePath for each of a book's tracks after a successful move. */
function remapTrackPaths(move) {
  if (move.mode === 'folder') {
    return move.fromFiles.map((f) => path.join(move.toDir, path.relative(move.fromDir, f)));
  }
  return move.toFiles;
}

function readJournal() {
  try {
    return JSON.parse(fs.readFileSync(REORG_JOURNAL_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function appendJournal(entries) {
  const existing = readJournal() || [];
  existing.push(...entries);
  fs.mkdirSync(path.dirname(REORG_JOURNAL_FILE), { recursive: true });
  fs.writeFileSync(REORG_JOURNAL_FILE, JSON.stringify(existing), 'utf8');
}

/** Drops specific entries (by from/to/type identity) — used when a failed book's moves are rolled back. */
function removeJournalEntries(entries) {
  if (!entries.length) return;
  const drop = new Set(entries.map((e) => `${e.type}\u0000${e.from}\u0000${e.to}`));
  const kept = (readJournal() || []).filter((e) => !drop.has(`${e.type}\u0000${e.from}\u0000${e.to}`));
  fs.writeFileSync(REORG_JOURNAL_FILE, JSON.stringify(kept), 'utf8');
}

function startJournal() {
  fs.mkdirSync(path.dirname(REORG_JOURNAL_FILE), { recursive: true });
  fs.writeFileSync(REORG_JOURNAL_FILE, '[]', 'utf8');
}

function hasJournal() {
  const j = readJournal();
  return Array.isArray(j) && j.length > 0;
}

function clearJournal() {
  try {
    fs.rmSync(REORG_JOURNAL_FILE, { force: true });
  } catch {
    // Best effort.
  }
}

let cancelled = false;
let running = false;

function isRunning() {
  return running;
}

function cancel() {
  cancelled = true;
}

/**
 * Executes every move in a plan, one book at a time, journaling as it goes.
 * onProgress gets { done, total, bookTitle }. Returns { moved, failed,
 * cancelledEarly, pathUpdates } where pathUpdates is a bookId -> { sourceDir,
 * tracks } map the caller uses to patch the in-memory library immediately,
 * without needing a full rescan.
 */
async function executePlan(plan, onProgress) {
  if (running) throw new Error('A reorganization is already running.');
  running = true;
  cancelled = false;
  startJournal();

  const moved = [];
  const failed = [];
  const pathUpdates = {};
  let done = 0;

  try {
    for (const move of plan.moves) {
      if (cancelled) break;
      try {
        // eslint-disable-next-line no-await-in-loop
        await executeMove(move); // journals as it goes; rolls itself back on failure
        const newPaths = remapTrackPaths(move);
        pathUpdates[move.bookId] = { sourceDir: move.toDir, trackPaths: newPaths };
        moved.push(move.bookId);
      } catch (err) {
        failed.push({ bookId: move.bookId, title: move.title, error: err.message });
      }
      done += 1;
      onProgress?.({ done, total: plan.moves.length, bookTitle: move.title });
    }
  } finally {
    running = false;
  }

  return { moved, failed, cancelledEarly: cancelled, pathUpdates };
}

/**
 * Reverses every move in the last journal, most recent first. Entries that
 * fail to move back stay in the journal (so Undo can be retried once, say, a
 * file is no longer in use) instead of being forgotten. `failedBookIds` names
 * the books that did not fully come back, so the caller doesn't carry their
 * progress/bookmarks back to an id they no longer have; it is null for a
 * journal written before entries carried a bookId, where that can't be told.
 */
async function undoLastReorganization(onProgress) {
  const journal = readJournal();
  if (!journal || !journal.length) return { ok: true, errors: [], restored: [], failedBookIds: [] };

  const errors = [];
  const restored = [];
  const reversed = [...journal].reverse();
  let done = 0;
  for (const entry of reversed) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await moveOne(entry.to, entry.from);
      restored.push(entry);
    } catch (err) {
      errors.push({ entry, error: err.message });
    }
    done += 1;
    onProgress?.({ done, total: reversed.length });
  }

  if (errors.length) {
    const failedEntries = new Set(errors.map((e) => e.entry));
    fs.writeFileSync(REORG_JOURNAL_FILE, JSON.stringify(journal.filter((e) => failedEntries.has(e))), 'utf8');
  } else {
    clearJournal();
  }

  const failedBookIds = errors.every((e) => e.entry.bookId)
    ? [...new Set(errors.map((e) => e.entry.bookId))]
    : null;
  return { ok: errors.length === 0, errors, restored, failedBookIds };
}

module.exports = {
  sanitizeName,
  computePlan,
  executePlan,
  undoLastReorganization,
  hasJournal,
  isRunning,
  cancel,
};
