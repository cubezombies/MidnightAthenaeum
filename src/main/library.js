'use strict';

const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');

const { COVER_CACHE } = require('./paths');
const { readMp4Info } = require('./mp4-chapters');
const { groupIntoBooks, naturalCompare } = require('./group');

const AUDIO_EXTENSIONS = new Set(['.m4b', '.m4a', '.mp3', '.aac', '.ogg', '.opus', '.flac', '.wav']);
const IMAGE_NAMES = ['cover', 'folder', 'front', 'album', 'artwork'];
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png'];
const SKIP_DIRS = new Set(['node_modules', '$RECYCLE.BIN', 'System Volume Information']);
// Scanning is I/O bound on the library drive, so overlapping reads matters far
// more than CPU. BOOK_CONCURRENCY parallelises across books (which is what makes
// a library of single-file m4bs fast); TRACK_CONCURRENCY parallelises the tracks
// within one multi-file book. The product is the real ceiling on open handles.
const BOOK_CONCURRENCY = 4;
const TRACK_CONCURRENCY = 8;

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

async function buildSingleFileBook(unit, stats, id) {
  const filePath = stats[0].filePath;
  const ext = path.extname(filePath).toLowerCase();

  const [tags, mp4] = await Promise.all([
    readTags(filePath, true),
    ext === '.m4b' || ext === '.m4a' ? readMp4Info(filePath) : Promise.resolve({ chapters: [], duration: 0 }),
  ]);

  const duration = tags.format.duration || mp4.duration || 0;
  const chapters = mp4.chapters.map((ch, i, all) => ({
    index: i,
    title: ch.title,
    start: ch.start,
    end: all[i + 1] ? all[i + 1].start : duration || null,
  }));

  let cover = await cacheCoverFromPicture(id, tags.common.picture?.[0]);
  if (!cover) cover = await findFolderImage(unit.dir);

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
    cover,
    chapters,
    tracks: [{ filePath, duration, title: chapters.length ? null : titleFromFileName(unit.name) }],
    signature: unitSignature(stats),
  };
}

async function buildMultiTrackBook(unit, stats, id) {
  const parsed = await mapLimit(stats, TRACK_CONCURRENCY, async (s, index) =>
    ({ ...s, tags: await readTags(s.filePath, index === 0) }));

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

  let cover = await cacheCoverFromPicture(id, first?.tags.common.picture?.[0]);
  if (!cover) cover = await findFolderImage(unit.dir);

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
    cover,
    chapters,
    tracks,
    signature: unitSignature(stats),
  };
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
        return (await readMp4Info(u.files[0])).duration || 0;
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
  return books;
}

module.exports = { scanLibrary, AUDIO_EXTENSIONS };
