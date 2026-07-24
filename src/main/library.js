'use strict';

const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');
const Jimp = require('jimp');

const { COVER_CACHE } = require('./paths');
const { readMp4Duration, readMp4Chapters } = require('./mp4-chapters');
const { chaptersFromCue, hasSiblingCue } = require('./cue');
const { groupIntoBooks, naturalCompare } = require('./group');

const AUDIO_EXTENSIONS = new Set(['.m4b', '.m4a', '.mp3', '.aac', '.ogg', '.opus', '.flac', '.wav']);
const IMAGE_NAMES = ['cover', 'folder', 'front', 'album', 'artwork'];
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png'];
const SKIP_DIRS = new Set(['node_modules', '$RECYCLE.BIN', 'System Volume Information']);
// Scanning is I/O bound on the library drive, so overlapping reads matters far
// more than CPU — but *how* they overlap matters differently depending on the
// drive. BOOK_CONCURRENCY parallelises across books, i.e. across *different*
// directories; TRACK_CONCURRENCY parallelises the tracks within one multi-file
// book, i.e. within the *same* directory. On an SSD/NVMe both are cheap (no
// seek cost, so more overlap is close to free). On a spinning HDD — confirmed
// via Get-PhysicalDisk on this dev machine's library drive — BOOK_CONCURRENCY
// is the expensive one: 4 books in flight means the head is jumping between 4
// unrelated directories, which can cost more in seeks than the overlap saves.
// TRACK_CONCURRENCY stays higher since those files share one directory and are
// usually laid out close together, so the seeks between them are cheap either way.
const BOOK_CONCURRENCY = 2;
const TRACK_CONCURRENCY = 8;
// Phase 2 (background cover/chapter fill, see fillBookDetails) runs even
// gentler than BOOK_CONCURRENCY — it has to coexist with whatever the user
// is actively doing (playback, browsing), not just other books' scanning.
const DETAIL_CONCURRENCY = 1;

// A folder of several self-contained files is ambiguous: it could be one book
// split into short numbered parts (merge them) or a series folder of separate
// full-length books that merely share a series-name album tag (keep them apart).
// Per-file duration is what actually distinguishes the two — parts run minutes,
// books run hours — so we merge only when the median file is short.
const SELF_CONTAINED_EXT = new Set(['.m4b', '.m4a']);
const PART_MEDIAN_MAX_SEC = 80 * 60;

// music-metadata is ESM-only; this main process is CommonJS.
let mmPromise = null;
function loadMusicMetadata() {
  if (!mmPromise) mmPromise = import('music-metadata');
  return mmPromise;
}

function hashId(value) {
  return crypto.createHash('sha1').update(value.toLowerCase()).digest('hex').slice(0, 16);
}

async function* walk(dir, depth = 0) {
  if (depth > 8) return;
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (err) {
    console.warn(`[library] cannot read ${dir}: ${err.message}`);
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      yield* walk(full, depth + 1);
    } else if (entry.isFile() && AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      yield full;
    }
  }
}

/** Run an async mapper over items with a bounded number in flight. */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function readTags(filePath, wantCover) {
  try {
    const { parseFile } = await loadMusicMetadata();
    const md = await parseFile(filePath, { duration: true, skipCovers: !wantCover });
    return { common: md.common ?? {}, format: md.format ?? {} };
  } catch (err) {
    // Some files have malformed tables music-metadata refuses; we still want them.
    console.warn(`[library] tag read failed for ${path.basename(filePath)}: ${err.message}`);
    return { common: {}, format: {}, failed: true };
  }
}

async function cacheCoverFromPicture(id, picture) {
  if (!picture) return null;
  const ext = picture.format?.includes('png') ? '.png' : '.jpg';
  const target = path.join(COVER_CACHE, `${id}${ext}`);
  try {
    await fsp.mkdir(COVER_CACHE, { recursive: true });
    await fsp.writeFile(target, Buffer.from(picture.data));
    return target;
  } catch (err) {
    console.warn(`[library] could not cache cover ${id}: ${err.message}`);
    return null;
  }
}

/**
 * A small (~200px wide) JPEG copy of a book's cover, always written to
 * COVER_CACHE regardless of where `sourcePath` actually lives -- it can be
 * an external folder image sitting in the user's library folder
 * (findFolderImage returns that path in place, never copies it), and this
 * must never write into a folder the app doesn't own. Best-effort, same
 * precedent as cacheCoverFromPicture/tagsFailed elsewhere in this file: a
 * corrupt or unsupported source image just means no thumbnail, not a
 * failed scan -- the grid falls back to the full-size cover for that book.
 */
async function generateCoverThumb(id, sourcePath) {
  if (!sourcePath) return null;
  const target = path.join(COVER_CACHE, `${id}-thumb.jpg`);
  try {
    const img = await Jimp.read(sourcePath);
    await fsp.mkdir(COVER_CACHE, { recursive: true });
    await img.resize(200, Jimp.AUTO, Jimp.RESIZE_BICUBIC).quality(82).writeAsync(target);
    return target;
  } catch (err) {
    console.warn(`[library] could not generate cover thumbnail for ${id}: ${err.message}`);
    return null;
  }
}

/** Fall back to a cover image sitting next to the audio. */
async function findFolderImage(dir) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const images = entries
    .filter((e) => e.isFile() && IMAGE_EXTENSIONS.includes(path.extname(e.name).toLowerCase()))
    .map((e) => e.name);
  if (!images.length) return null;

  const preferred = images.find((name) =>
    IMAGE_NAMES.includes(path.parse(name).name.toLowerCase()));
  return path.join(dir, preferred ?? images.sort(naturalCompare)[0]);
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function titleFromFileName(name) {
  return name.replace(/[_.]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// A file-level `title` tag that reads like a chapter marker ("Opening Credits",
// "Chapter 1", "03 - …") is the first chapter leaking through, not the book name.
const CHAPTER_LIKE = /(opening|end) credits|\bchapters?\b|\btrack\s*\d|\bprologue\b|\bepilogue\b|^\s*\d+\s*[-.]/i;

/**
 * Best display title for a self-contained book. Prefer the specific `title`
 * (distinguishes volumes that share a series-name `album`), but fall back to
 * `album` when `title` looks like a chapter and `album` doesn't.
 */
function pickBookTitle(common, fallbackName) {
  const title = cleanText(common.title);
  const album = cleanText(common.album);
  if (title && !CHAPTER_LIKE.test(title)) return title;
  if (album && !CHAPTER_LIKE.test(album)) return album;
  return title || album || titleFromFileName(fallbackName);
}

/** Build a signature so an unchanged book can be reused from cache. */
function unitSignature(stats) {
  return stats.map((s) => `${s.filePath}:${s.mtimeMs}:${s.size}`).join('|');
}

async function statFiles(files) {
  const stats = [];
  for (const filePath of files) {
    try {
      const s = await fsp.stat(filePath);
      stats.push({ filePath, mtimeMs: s.mtimeMs, size: s.size });
    } catch {
      // File vanished between walk and stat; skip it.
    }
  }
  return stats;
}

/**
 * Phase 1 build for a single-file (.m4b/.m4a/lone .mp3) book: tags + duration
 * only. Cover art and chapters are deliberately deferred to fillOneBookDetail
 * (phase 2, see below) — the cover picture is real bytes music-metadata would
 * otherwise decode for every book on every scan, and chapter extraction is
 * the expensive part of readMp4Chapters (one extra disk read per chapter).
 * `readMp4Duration` gets the fallback duration for files music-metadata can't
 * read without paying for any of that.
 */
async function buildSingleFileBook(unit, stats, id) {
  const filePath = stats[0].filePath;
  const ext = path.extname(filePath).toLowerCase();

  const [tags, mp4Duration] = await Promise.all([
    readTags(filePath, false),
    ext === '.m4b' || ext === '.m4a' ? readMp4Duration(filePath) : Promise.resolve(0),
  ]);

  const duration = tags.format.duration || mp4Duration || 0;

  return {
    id,
    kind: 'single',
    sourceDir: unit.dir,
    title: pickBookTitle(tags.common, unit.name),
    author: cleanText(tags.common.albumartist) || cleanText(tags.common.artist) || 'Unknown author',
    narrator: cleanText(tags.common.composer?.[0]) || null,
    year: tags.common.year ?? null,
    description: cleanText(tags.common.comment?.[0]?.text) || null,
    duration,
    cover: null,
    chapters: [],
    tracks: [{ filePath, duration, title: titleFromFileName(unit.name) }],
    signature: unitSignature(stats),
    detailPending: true,
    // Surfaces readTags()'s failure flag at the book level (previously computed
    // and then discarded) so a scan can report how many books it couldn't
    // actually read tags for, instead of that only being visible per-file in
    // the console warning.
    tagsFailed: Boolean(tags.failed),
  };
}

/**
 * Phase 1 build for a multi-track (mp3-folder) book. Unlike the single-file
 * case, chapters fall out for free here — one per track, from the same tag
 * reads duration already needs — so only cover art is deferred to phase 2.
 */
async function buildMultiTrackBook(unit, stats, id) {
  const parsed = await mapLimit(stats, TRACK_CONCURRENCY, async (s) =>
    ({ ...s, tags: await readTags(s.filePath, false) }));

  const first = parsed[0];
  const tracks = [];
  const chapters = [];
  let elapsed = 0;

  for (const entry of parsed) {
    const duration = entry.tags.format.duration || 0;
    const title = cleanText(entry.tags.common.title)
      || titleFromFileName(path.parse(entry.filePath).name);

    tracks.push({ filePath: entry.filePath, duration, title });
    chapters.push({
      index: chapters.length,
      title,
      start: elapsed,
      end: elapsed + duration,
    });
    elapsed += duration;
  }

  let chapterList = chapters;
  // A lone audio file (e.g. one big .mp3) is just one "chapter"; if it ships a
  // sibling .cue, use that to give it real chapters.
  if (tracks.length === 1 && await hasSiblingCue(tracks[0].filePath)) {
    const cueChapters = await chaptersFromCue(tracks[0].filePath, elapsed);
    if (cueChapters.length > 1) chapterList = cueChapters;
  }

  return {
    id,
    kind: 'multi',
    sourceDir: unit.dir,
    title: cleanText(first?.tags.common.album) || titleFromFileName(unit.name),
    author: cleanText(first?.tags.common.albumartist)
      || cleanText(first?.tags.common.artist)
      || 'Unknown author',
    narrator: cleanText(first?.tags.common.composer?.[0]) || null,
    year: first?.tags.common.year ?? null,
    description: cleanText(first?.tags.common.comment?.[0]?.text) || null,
    duration: elapsed,
    cover: null,
    chapters: chapterList,
    tracks,
    signature: unitSignature(stats),
    detailPending: true,
    tagsFailed: parsed.some((p) => p.tags.failed),
  };
}

/**
 * Phase 2: fill in what phase 1 deferred for one book — cover art always,
 * plus real chapters for a single-file book (multi-track books already got
 * theirs for free in phase 1). Re-reads the file(s), so this is real extra
 * I/O — deliberately not paid at scan time, only here, lazily.
 */
async function fillOneBookDetail(book) {
  const filePath = book.tracks[0].filePath;

  if (book.kind === 'single') {
    const ext = path.extname(filePath).toLowerCase();
    const [tags, mp4] = await Promise.all([
      readTags(filePath, true),
      ext === '.m4b' || ext === '.m4a'
        ? readMp4Chapters(filePath, book.duration)
        : Promise.resolve({ chapters: [], duration: book.duration }),
    ]);

    let chapters = mp4.chapters.map((ch, i, all) => ({
      index: i,
      title: ch.title,
      start: ch.start,
      end: all[i + 1] ? all[i + 1].start : book.duration || null,
    }));

    if (chapters.length <= 1 && await hasSiblingCue(filePath)) {
      const cueChapters = await chaptersFromCue(filePath, book.duration);
      if (cueChapters.length > 1) chapters = cueChapters;
    }

    let cover = await cacheCoverFromPicture(book.id, tags.common.picture?.[0]);
    if (!cover) cover = await findFolderImage(book.sourceDir);
    const coverThumb = await generateCoverThumb(book.id, cover);

    return {
      ...book,
      cover,
      coverThumb,
      chapters,
      tracks: [{ ...book.tracks[0], title: chapters.length ? null : book.tracks[0].title }],
      detailPending: false,
    };
  }

  // multi: chapters are already final from phase 1, only cover was deferred.
  const tags = await readTags(filePath, true);
  let cover = await cacheCoverFromPicture(book.id, tags.common.picture?.[0]);
  if (!cover) cover = await findFolderImage(book.sourceDir);
  const coverThumb = await generateCoverThumb(book.id, cover);
  return { ...book, cover, coverThumb, detailPending: false };
}

// bookId -> Promise<book>, shared between the background fill loop and any
// on-demand request (a book opened before the background loop reaches it) so
// the same book is never detail-filled twice concurrently.
const detailInFlight = new Map();

/** Fills in one book's detail if it isn't already, de-duped against concurrent callers. */
function ensureDetail(book) {
  if (!book.detailPending) return Promise.resolve(book);
  let p = detailInFlight.get(book.id);
  if (!p) {
    p = fillOneBookDetail(book)
      .catch((err) => {
        console.warn(`[library] detail fill failed for ${book.sourceDir}: ${err.message}`);
        // Best-effort, same precedent as tagsFailed above: don't retry forever
        // on every launch. A real rescan (changed signature) will try again.
        return { ...book, detailPending: false, detailFailed: true };
      })
      .finally(() => detailInFlight.delete(book.id));
    detailInFlight.set(book.id, p);
  }
  return p;
}

/**
 * Background pass: fills in every still-pending book's detail, at a
 * deliberately gentle concurrency (see DETAIL_CONCURRENCY). Reports each
 * completed book via onBookDone so the caller can persist + broadcast
 * incrementally rather than waiting for the whole backlog.
 */
async function fillBookDetails(books, { concurrency = DETAIL_CONCURRENCY, onBookDone, isCancelled } = {}) {
  const pending = books.filter((b) => b.detailPending);
  await mapLimit(pending, concurrency, async (book) => {
    if (isCancelled?.()) return;
    const updated = await ensureDetail(book);
    if (!isCancelled?.()) onBookDone?.(updated);
  });
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Some publishers ship one audiobook as a folder of short, numbered .m4b files
 * (`001 - Title.m4b`, `002 - Title.m4b`, …), which groupIntoBooks would treat as
 * dozens of separate books. Others put several full-length books directly in one
 * series folder — those must stay separate even though they share the folder.
 *
 * We tell them apart by probing durations (a fast header-only read): when a
 * folder's self-contained files are mostly short, they are parts of one book and
 * get merged into a single multi-track unit ordered naturally by filename.
 */
async function consolidateSelfContainedParts(units) {
  const byDir = new Map();
  for (const unit of units) {
    if (unit.kind !== 'single') continue;
    if (!SELF_CONTAINED_EXT.has(path.extname(unit.files[0]).toLowerCase())) continue;
    if (!byDir.has(unit.dir)) byDir.set(unit.dir, []);
    byDir.get(unit.dir).push(unit);
  }

  const mergedFiles = new Set();
  const newUnits = [];

  for (const [dir, dirUnits] of byDir) {
    if (dirUnits.length < 2) continue;

    const durations = await mapLimit(dirUnits, TRACK_CONCURRENCY, async (u) => {
      try {
        return await readMp4Duration(u.files[0]);
      } catch {
        return 0;
      }
    });

    const known = durations.filter((d) => d > 0);
    // Without any duration signal, leave the folder as separate books.
    if (!known.length || median(known) >= PART_MEDIAN_MAX_SEC) continue;

    const files = dirUnits.map((u) => u.files[0]).sort(naturalCompare);
    for (const file of files) mergedFiles.add(file);
    newUnits.push({ kind: 'multi', dir, name: path.basename(dir), files });
  }

  if (!newUnits.length) return units;

  const kept = units.filter((u) => !(u.kind === 'single' && mergedFiles.has(u.files[0])));
  return [...kept, ...newUnits];
}

/**
 * Scan folders and return one entry per book.
 *
 * Books whose file set is byte-for-byte unchanged are reused from `cachedBooks`,
 * so rescanning a large library costs a directory walk rather than a full reparse.
 */
async function scanLibrary(folders, cachedBooks = [], onProgress) {
  const files = [];
  for (const folder of folders) {
    for await (const file of walk(folder)) files.push(file);
  }

  const units = await consolidateSelfContainedParts(groupIntoBooks(files));
  const cacheById = new Map(cachedBooks.map((b) => [b.id, b]));
  let done = 0;

  const built = await mapLimit(units, BOOK_CONCURRENCY, async (unit) => {
    const id = hashId(unit.kind === 'single' ? unit.files[0] : `${unit.dir}::${unit.files.length}`);
    const stats = await statFiles(unit.files);
    let book = null;

    if (stats.length) {
      const cached = cacheById.get(id);
      if (cached && cached.signature === unitSignature(stats)) {
        book = cached;
      } else {
        try {
          book = unit.kind === 'single'
            ? await buildSingleFileBook(unit, stats, id)
            : await buildMultiTrackBook(unit, stats, id);
        } catch (err) {
          console.error(`[library] failed to build book at ${unit.dir}: ${err.message}`);
        }
      }
    }

    done += 1;
    onProgress?.(done, units.length);
    return book;
  });

  const books = built.filter(Boolean);
  books.sort((a, b) => a.author.localeCompare(b.author) || a.title.localeCompare(b.title));

  const failedCount = books.reduce((n, b) => n + (b.tagsFailed ? 1 : 0), 0);
  if (failedCount) {
    console.warn(`[library] ${failedCount} book(s) had tag-parse failures — see warnings above for which files.`);
  }

  return books;
}

module.exports = {
  scanLibrary, fillBookDetails, ensureDetail, AUDIO_EXTENSIONS, hashId, generateCoverThumb,
};
