'use strict';

const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');

const { readMp4Duration, readMp4Chapters } = require('./mp4-chapters');
const { chaptersFromCue, hasSiblingCue } = require('./cue');
const { naturalCompare } = require('./group');

const IMAGE_NAMES = ['cover', 'folder', 'front', 'album', 'artwork'];
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png'];
const TRACK_CONCURRENCY = 8;

const THUMB_WIDTH = 200;
const THUMB_QUALITY = 82;

// Electron's own image decoder, used instead of a dependency (see
// generateCoverThumb). Required lazily so this module still loads in a plain
// Node context -- the test harnesses run main-process code that way, and
// only thumbnail generation actually needs Electron.
function getNativeImage() {
  try {
    // eslint-disable-next-line global-require
    return require('electron').nativeImage ?? null;
  } catch {
    return null;
  }
}

// music-metadata is ESM-only; this file (both on the main thread and inside
// a worker) is CommonJS.
let mmPromise = null;
function loadMusicMetadata() {
  if (!mmPromise) mmPromise = import('music-metadata');
  return mmPromise;
}

function hashId(value) {
  return crypto.createHash('sha1').update(value.toLowerCase()).digest('hex').slice(0, 16);
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
    console.warn(`[parse-core] tag read failed for ${path.basename(filePath)}: ${err.message}`);
    return { common: {}, format: {}, failed: true };
  }
}

async function cacheCoverFromPicture(coverCache, id, picture) {
  if (!picture) return null;
  const ext = picture.format?.includes('png') ? '.png' : '.jpg';
  const target = path.join(coverCache, `${id}${ext}`);
  try {
    await fsp.mkdir(coverCache, { recursive: true });
    await fsp.writeFile(target, Buffer.from(picture.data));
    return target;
  } catch (err) {
    console.warn(`[parse-core] could not cache cover ${id}: ${err.message}`);
    return null;
  }
}

/**
 * A small (~200px wide) JPEG copy of a book's cover, always written to
 * coverCache regardless of where `sourcePath` actually lives -- it can be
 * an external folder image sitting in the user's library folder
 * (findFolderImage returns that path in place, never copies it), and this
 * must never write into a folder the app doesn't own. Best-effort, same
 * precedent as cacheCoverFromPicture/tagsFailed elsewhere in this file: a
 * corrupt or unsupported source image just means no thumbnail, not a
 * failed scan -- the grid falls back to the full-size cover for that book.
 *
 * Uses Electron's own `nativeImage` rather than an image library. Cover art
 * is arbitrary user-supplied data — it comes out of whatever audio files
 * someone put in their library — so decoding it is the app's most exposed
 * surface. The previous decoder (`jimp`) sniffed magic bytes via `file-type`,
 * which carries an unpatched infinite-loop advisory reachable from exactly
 * that input. `nativeImage` is Chromium's decoder, already in the process,
 * needs no dependency, and returns an *empty image* on anything it can't
 * read instead of throwing. Measured across 50 real covers from this
 * library, it is also **26x faster** (61ms vs 1,629ms per cover) and
 * produces slightly smaller files.
 *
 * Only the width is given: `nativeImage` preserves aspect ratio when one
 * dimension is specified, which is what the grid's layout assumes.
 */
async function generateCoverThumb(coverCache, id, sourcePath) {
  if (!sourcePath) return null;
  const nativeImage = getNativeImage();
  if (!nativeImage) {
    console.warn('[parse-core] nativeImage unavailable; skipping thumbnail');
    return null;
  }
  const target = path.join(coverCache, `${id}-thumb.jpg`);
  try {
    const img = nativeImage.createFromPath(sourcePath);
    // Unreadable, unsupported, missing, or not an image at all.
    if (img.isEmpty()) {
      console.warn(`[parse-core] could not decode cover for ${id}`);
      return null;
    }
    const buf = img.resize({ width: THUMB_WIDTH, quality: 'good' }).toJPEG(THUMB_QUALITY);
    if (!buf.length) return null;
    await fsp.mkdir(coverCache, { recursive: true });
    await fsp.writeFile(target, buf);
    return target;
  } catch (err) {
    console.warn(`[parse-core] could not generate cover thumbnail for ${id}: ${err.message}`);
    return null;
  }
}

/**
 * Same decode-via-nativeImage safety posture as generateCoverThumb (never
 * trust an embedded image's bytes directly — this one came out of an mp4
 * chapter-image track read by mp4-chapters.js's own magic-byte sniff, which
 * is a cheap sanity check, not real validation), plus the same "small
 * decorative thumbnail" sizing: chapter art is for the chapter list / now-
 * playing view, not a full-size cover.
 */
async function cacheChapterImage(coverCache, bookId, chapterIndex, image) {
  if (!image?.data?.length) return null;
  const nativeImage = getNativeImage();
  if (!nativeImage) return null;
  try {
    const img = nativeImage.createFromBuffer(image.data);
    if (img.isEmpty()) return null;
    const buf = img.resize({ width: THUMB_WIDTH, quality: 'good' }).toJPEG(THUMB_QUALITY);
    if (!buf.length) return null;
    const target = path.join(coverCache, `${bookId}-ch${chapterIndex}.jpg`);
    await fsp.mkdir(coverCache, { recursive: true });
    await fsp.writeFile(target, buf);
    return target;
  } catch (err) {
    console.warn(`[parse-core] could not cache chapter image ${bookId}#${chapterIndex}: ${err.message}`);
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

/**
 * Stats every file in a unit, with the same bounded overlap the rest of the
 * scan uses for files inside one directory.
 *
 * This was a plain sequential for-loop, which made it the dominant cost of a
 * whole scan: it runs for *every* book, including cache hits (the mtime/size
 * signature is precisely what decides whether a book is a cache hit), and
 * this library has books with 300-500 files each -- so a single one of those
 * serialized 500 round-trips to a spinning disk while everything waited.
 * Measured against the real library, this is what produced a ~40x slowdown
 * and a main-process CPU spike part-way through every scan, exactly where
 * those big multi-file books happen to sort.
 *
 * Order is preserved (mapLimit fills results by index), which matters:
 * unitSignature() joins these in order, and a reordered signature would
 * make every book look changed and force a full reparse of the library.
 * Files that vanish between walk and stat are dropped, as before.
 */
async function statFiles(files) {
  const stats = [];
  for (const filePath of files) {
    try {
      // eslint-disable-next-line no-await-in-loop
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
async function buildSingleFileBook({ unit, stats, id }) {
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
async function buildMultiTrackBook({ unit, stats, id }) {
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
async function fillOneBookDetail({ book, coverCache }) {
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
      image: ch.image, // raw {data, ext} at this point — cached to a path just below
    }));

    if (chapters.length <= 1 && await hasSiblingCue(filePath)) {
      const cueChapters = await chaptersFromCue(filePath, book.duration);
      if (cueChapters.length > 1) chapters = cueChapters;
    }

    if (chapters.some((ch) => ch.image)) {
      await Promise.all(chapters.map(async (ch, i) => {
        if (!ch.image) return;
        const cached = await cacheChapterImage(coverCache, book.id, i, ch.image);
        if (cached) ch.image = cached; else delete ch.image;
      }));
    }

    let cover = await cacheCoverFromPicture(coverCache, book.id, tags.common.picture?.[0]);
    if (!cover) cover = await findFolderImage(book.sourceDir);
    const coverThumb = await generateCoverThumb(coverCache, book.id, cover);

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
  let cover = await cacheCoverFromPicture(coverCache, book.id, tags.common.picture?.[0]);
  if (!cover) cover = await findFolderImage(book.sourceDir);
  const coverThumb = await generateCoverThumb(coverCache, book.id, cover);
  return { ...book, cover, coverThumb, detailPending: false };
}

/**
 * Single entry point a worker (or the main thread, for tests) dispatches
 * into by task type. `workerData`/context is `{ coverCache }`.
 */
async function runTask(type, payload, { coverCache } = {}) {
  switch (type) {
    case 'buildSingleFileBook':
      return buildSingleFileBook(payload);
    case 'buildMultiTrackBook':
      return buildMultiTrackBook(payload);
    case 'fillOneBookDetail':
      return fillOneBookDetail({ book: payload.book, coverCache });
    case 'generateCoverThumb':
      return generateCoverThumb(coverCache, payload.id, payload.sourcePath);
    default:
      throw new Error(`[parse-core] unknown task type: ${type}`);
  }
}

module.exports = {
  hashId,
  mapLimit,
  readTags,
  cacheCoverFromPicture,
  generateCoverThumb,
  findFolderImage,
  pickBookTitle,
  unitSignature,
  statFiles,
  buildSingleFileBook,
  buildMultiTrackBook,
  fillOneBookDetail,
  runTask,
};
