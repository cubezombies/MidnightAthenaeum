'use strict';

const path = require('node:path');
const fsp = require('node:fs/promises');

const { COVER_CACHE } = require('./paths');
const { readMp4Duration } = require('./mp4-chapters');
const { groupIntoBooks, naturalCompare } = require('./group');
const { hashId, mapLimit, unitSignature, statFiles, runTask } = require('./parse-core');

const AUDIO_EXTENSIONS = new Set(['.m4b', '.m4a', '.mp3', '.aac', '.ogg', '.opus', '.flac', '.wav']);
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

/**
 * Runs one parse task (tag/chapter read, cover thumbnail) in-process.
 *
 * Parsing briefly lived in a `worker_threads` pool, on the theory that
 * scanning was CPU-bound. Measurement said otherwise: a rescan of this
 * developer's ~5,800-book library dispatched *zero* tasks to the pool --
 * every book was an unchanged cache hit -- so the pool did nothing on a
 * normal launch except exist. Worse, merely spawning it inside Electron's
 * main process reliably spiked CPU and hung the app part-way through a
 * scan; the same build with dispatch disabled ran clean, as did v0.13.0
 * before the pool existed. Since the measured benefit was nil and the cost
 * was a hang, the pool is gone. parse-core.js stays: the extraction is
 * worth keeping on its own, and it is where these functions live now.
 */
function runParse(type, payload) {
  return runTask(type, payload, { coverCache: COVER_CACHE });
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
async function scanLibrary(folders, cachedBooks = [], onProgress, { deep = false } = {}) {
  const files = [];
  for (const folder of folders) {
    for await (const file of walk(folder)) files.push(file);
  }

  const units = await consolidateSelfContainedParts(groupIntoBooks(files));
  const cacheById = new Map(cachedBooks.map((b) => [b.id, b]));
  let done = 0;

  const built = await mapLimit(units, BOOK_CONCURRENCY, async (unit) => {
    const startedAt = Date.now();
    const id = hashId(unit.kind === 'single' ? unit.files[0] : `${unit.dir}::${unit.files.length}`);
    const cached = cacheById.get(id);

    // Cheap first pass: one stat of the book's directory instead of one per
    // file. A directory's mtime changes whenever a file inside it is added,
    // removed or renamed, so combined with the file count it detects every
    // structural change -- and unchanged books (the overwhelming majority of
    // any rescan) never touch their files at all.
    //
    // This is what makes a rescan cheap. Statting every file of every book
    // meant ~80,000 stat calls concentrated in the multi-file books, which
    // saturated the library drive, spiked CPU, and left the app unresponsive
    // long enough for Windows to kill it. Single-file books were never the
    // problem (one stat each); books split into 200-500 files were.
    //
    // Deliberate trade-off: a file edited *in place*, keeping the same name
    // (a re-tag that rewrites the file), leaves the directory mtime alone and
    // so is not picked up until something else in the folder changes. That is
    // rare for an audiobook library, and File > Rescan library still does the
    // full per-file check (deep = true) for exactly that case.
    let dirSig = null;
    if (!deep) {
      try {
        const dirStat = await fsp.stat(unit.dir);
        dirSig = `${dirStat.mtimeMs}:${unit.files.length}`;
      } catch {
        dirSig = null; // Unreadable directory: fall through to the full check.
      }
    }

    if (dirSig && cached?.dirSig === dirSig && !cached.detailPending) {
      done += 1;
      onProgress?.(done, units.length, {
        dir: unit.dir, files: unit.files.length, kind: unit.kind, cacheHit: true, ms: Date.now() - startedAt,
      });
      if (done % 25 === 0) await new Promise((resolve) => { setImmediate(resolve); });
      return cached;
    }

    const stats = await statFiles(unit.files);
    let book = null;
    let cacheHit = false;

    if (stats.length) {
      if (cached && cached.signature === unitSignature(stats)) {
        // Unchanged, but either it had no cheap key yet or the directory
        // moved on without its files changing. Record the current key so the
        // next scan can take the fast path above; a new object (rather than
        // mutating) is what marks it dirty for the store's reference diff.
        book = dirSig && cached.dirSig !== dirSig ? { ...cached, dirSig } : cached;
        cacheHit = true;
      } else {
        try {
          const built = unit.kind === 'single'
            ? await runParse('buildSingleFileBook', { unit, stats, id })
            : await runParse('buildMultiTrackBook', { unit, stats, id });
          // dirSig is recorded on freshly built books too, so the very next
          // scan can skip re-statting their files.
          book = dirSig ? { ...built, dirSig } : built;
        } catch (err) {
          console.error(`[library] failed to build book at ${unit.dir}: ${err.message}`);
        }
      }
    }

    done += 1;
    // Third argument is per-book detail for diagnostics (see main.js's diag
    // logging). Optional and ignored by any caller that doesn't want it.
    onProgress?.(done, units.length, {
      dir: unit.dir,
      files: unit.files.length,
      kind: unit.kind,
      cacheHit,
      ms: Date.now() - startedAt,
    });

    // Hand control back to the macrotask queue regularly.
    //
    // Windows logged this app as an Application Hang (event 1002) during a
    // scan -- not a crash. Awaiting a promise that resolves immediately (a
    // cache-hit book, or an fs.stat the OS answers from cache) only yields
    // to the *microtask* queue, which this loop then immediately refills.
    // Chromium's window message pump runs on the macrotask queue, so at the
    // ~800 books/second this loop reaches on cached data it can starve the
    // pump for long enough that Windows declares the window unresponsive
    // and the app gets torn down. setImmediate is a macrotask, so this
    // guarantees the UI gets serviced no matter how fast the loop runs.
    // Every 25 books keeps the cost negligible (~230 yields for a
    // 5,800-book library) while bounding how long the window can go
    // unserviced.
    if (done % 25 === 0) await new Promise((resolve) => { setImmediate(resolve); });
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

// bookId -> Promise<book>, shared between the background fill loop and any
// on-demand request (a book opened before the background loop reaches it) so
// the same book is never detail-filled twice concurrently.
const detailInFlight = new Map();

/** Fills in one book's detail if it isn't already, de-duped against concurrent callers. */
function ensureDetail(book) {
  if (!book.detailPending) return Promise.resolve(book);
  let p = detailInFlight.get(book.id);
  if (!p) {
    p = runParse('fillOneBookDetail', { book })
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

/**
 * Cover thumbnail for main.js's runThumbnailFill() (the backfill pass for
 * books that got a cover before thumbnails shipped).
 *
 * MUST NOT REJECT. Its caller awaits it inside a fire-and-forget promise
 * chain, so a rejection here becomes an unhandled rejection, which on
 * Electron's Node terminates the whole main process — that regression
 * really did kill the app during testing, when this briefly dispatched to a
 * worker and so gained failure modes the signature never used to have.
 * Failures collapse to null, and callers treat that as "no thumbnail".
 */
function generateCoverThumb(id, sourcePath) {
  return runParse('generateCoverThumb', { id, sourcePath })
    .catch((err) => {
      console.warn(`[library] cover thumbnail failed for ${id}: ${err.message}`);
      return null;
    });
}

module.exports = {
  scanLibrary, fillBookDetails, ensureDetail, AUDIO_EXTENSIONS, hashId, generateCoverThumb,
};
