'use strict';

/**
 * A coarse, whole-book loudness waveform for a richer seek bar and instant
 * scrub previews. Chapter boundaries aren't stored here -- the renderer
 * already has the book's chapter list (start times in whole-book seconds,
 * same timeline this waveform covers) and draws tick marks from that
 * directly, so there's nothing to duplicate.
 *
 * Generated lazily, once per book, the first time it's opened (see
 * openBook()/waveform:ensure in main.js) -- not eagerly for the whole
 * library during a scan, which would mean fully decoding the audio of every
 * book up front. That class of work is exactly what docs/ROADMAP.md's
 * worker-thread section flags as "genuinely CPU-bound" and worth keeping
 * off the scan path; the transcription feature (transcribe.js) made the
 * same call for the same reason. Measured: ~6s per hour of audio on the dev
 * machine. Cached to disk (next to the cover, in its own directory) so it's
 * a one-time cost per book, not per launch.
 *
 * Pipeline per book: decode each track to raw mono PCM via the bundled
 * ffmpeg (same binary transcribe.js uses), then reduce it to a fixed
 * WAVEFORM_POINTS-length array of loudness bytes. For a multi-track book,
 * each track is placed at its proportional slice of the array based on
 * cumulative duration -- the same offset-by-elapsed-duration approach
 * toClientBook (main.js) and transcribeBook (transcribe.js) both already use
 * to give multi-track books one continuous timeline.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { WAVEFORM_CACHE } = require('./paths');
const { ffmpegPath } = require('./ffmpeg-path');

// Fixed regardless of book length, so cached files stay small (1000 bytes)
// and rendering cost never scales with how long a book is.
const WAVEFORM_POINTS = 1000;

// Part of the cache filename: bump it whenever what the bytes *mean* changes,
// so books cached by an older algorithm simply miss and regenerate instead of
// being drawn wrongly. v1 = RMS loudness on a dB scale (see levelByte).
const WAVEFORM_VERSION = 1;

// Not arbitrarily low, despite only needing a "coarse" result: resampling
// low-pass filters to the target rate's Nyquist frequency before handing back
// samples, so decoding straight to a very low rate silently discards most of
// the audio's energy before it can be measured. Verified directly: a 440Hz
// test tone decoded at 100Hz came back ~14x quieter than the same file at its
// native rate (peak sample 259 vs 3,703) -- and real speech carries plenty of
// energy far above a 50Hz Nyquist limit. 8kHz keeps the telephone-quality
// band that carries most speech energy while still cutting data volume ~5x
// versus a typical 44.1kHz source. The "coarse" reduction happens afterward,
// in decodeTrackLevels's bucketing.
const DECODE_RATE = 8000;

// dB window mapped onto 0-255. -60 dBFS is effectively silence for narrated
// audio; 0 dBFS is full scale.
const FLOOR_DB = -60;

/**
 * Why loudness (RMS) and not peak amplitude: each of the 1000 points covers
 * seconds to minutes of audio, and narrated audiobooks are heavily
 * compressed, so virtually every window contains at least one near-full-scale
 * syllable. A peak waveform of a real 2.5-hour book came out as a flat band
 * (every bar within ~25% of the others). RMS over the same windows actually
 * dips for pauses, quiet passages and chapter-break silences and rises for
 * music beds and loud scenes -- the structure a seek bar is useful for. The
 * dB scale gives quiet material real resolution instead of crushing it into
 * the bottom few byte values.
 */
function levelByte(sumSq, count) {
  if (!count) return 0;
  const rms = Math.sqrt(sumSq / count) / 32768;
  if (rms <= 0) return 0;
  const db = 20 * Math.log10(rms);
  return Math.max(0, Math.min(255, Math.round(((db - FLOOR_DB) / -FLOOR_DB) * 255)));
}

function isAvailable() {
  return Boolean(ffmpegPath);
}

function waveformPath(bookId) {
  return path.join(WAVEFORM_CACHE, `${bookId}.v${WAVEFORM_VERSION}.levels`);
}

function hasWaveform(bookId) {
  return fs.existsSync(waveformPath(bookId));
}

function deleteWaveform(bookId) {
  try {
    fs.rmSync(waveformPath(bookId), { force: true });
  } catch {
    // Best effort -- a leftover cache file isn't worth surfacing an error for.
  }
}

/** Carries a cached waveform over to a book's new id after a reorganize (book ids are path-derived — see library.js hashId). Same precedent as transcribe.js's renameTranscript. */
function renameWaveform(oldId, newId) {
  try {
    if (fs.existsSync(waveformPath(oldId))) fs.renameSync(waveformPath(oldId), waveformPath(newId));
  } catch {
    // Best effort.
  }
}

/**
 * Decodes one track to raw mono PCM at DECODE_RATE and reduces it to
 * `nBuckets` loudness bytes, accumulating each chunk into per-bucket sums *as
 * it streams in* rather than buffering the whole track first. At 8kHz a long
 * audiobook is still tens of megabytes of PCM -- buffering it whole (the way
 * transcribe.js's temporary WAV conversion can afford to) would undo the
 * point of keeping this cheap.
 *
 * Bucket boundaries come from the track's own known duration (already read
 * from tags, same value used elsewhere for the continuous multi-track
 * timeline) combined with the fixed decode rate, rather than from the
 * eventual total sample count -- which isn't known until the stream ends.
 */
function decodeTrackLevels(filePath, duration, nBuckets) {
  return new Promise((resolve, reject) => {
    if (nBuckets <= 0) { resolve(new Uint8Array(0)); return; }

    const expectedSamples = Math.max(1, Math.round((duration || 1) * DECODE_RATE));
    const sumSq = new Float64Array(nBuckets);
    const counts = new Uint32Array(nBuckets);
    let sampleIndex = 0;
    let leftover = null; // odd trailing byte when a chunk splits a 2-byte sample

    const proc = spawn(ffmpegPath, [
      '-i', filePath,
      '-ar', String(DECODE_RATE), '-ac', '1', '-f', 's16le', '-acodec', 'pcm_s16le',
      'pipe:1',
    ], { windowsHide: true });

    let stderr = '';
    proc.stdout.on('data', (chunk) => {
      const buf = leftover ? Buffer.concat([leftover, chunk]) : chunk;
      const usable = buf.length - (buf.length % 2);
      leftover = usable < buf.length ? buf.subarray(usable) : null;

      for (let i = 0; i < usable; i += 2) {
        const v = buf.readInt16LE(i);
        // Clamped: a tag duration slightly shorter than the real audio just
        // folds the overrun into the last bucket.
        const bucket = Math.min(nBuckets - 1, Math.floor((sampleIndex / expectedSamples) * nBuckets));
        sumSq[bucket] += v * v;
        counts[bucket] += 1;
        sampleIndex += 1;
      }
    });
    proc.stderr.on('data', (d) => { stderr += d; });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-500)}`));
        return;
      }
      const levels = new Uint8Array(nBuckets);
      for (let b = 0; b < nBuckets; b++) levels[b] = levelByte(sumSq[b], counts[b]);
      resolve(levels);
    });
  });
}

async function computeLevels(book) {
  const total = book.tracks.reduce((sum, t) => sum + (t.duration || 0), 0) || 1;
  const levels = new Uint8Array(WAVEFORM_POINTS);
  let elapsed = 0;

  for (let i = 0; i < book.tracks.length; i++) {
    const track = book.tracks[i];
    const isLast = i === book.tracks.length - 1;
    const startBucket = Math.min(WAVEFORM_POINTS - 1, Math.floor((elapsed / total) * WAVEFORM_POINTS));
    elapsed += track.duration || 0;
    // The last track always closes out exactly at WAVEFORM_POINTS regardless
    // of rounding, so a book's final bucket is never left unfilled by a
    // fraction-of-a-percent duration mismatch between tracks and total.
    const endBucket = isLast
      ? WAVEFORM_POINTS
      : Math.max(startBucket + 1, Math.min(WAVEFORM_POINTS, Math.round((elapsed / total) * WAVEFORM_POINTS)));

    // eslint-disable-next-line no-await-in-loop
    const sub = await decodeTrackLevels(track.filePath, track.duration, endBucket - startBucket);
    // Max, not overwrite: in a book of many very short tracks, the
    // at-least-one-bucket-per-track rule above can make neighbours share a
    // bucket, and the louder one is the more useful thing to show.
    for (let j = 0; j < sub.length; j++) {
      const idx = startBucket + j;
      if (sub[j] > levels[idx]) levels[idx] = sub[j];
    }
  }
  return levels;
}

// Only one book decodes at a time -- this is genuinely CPU/disk-bound work,
// and running several full decodes concurrently would just contend for the
// same resources for no benefit. Requests for other books queue (deduped by
// id) rather than being dropped, so a user browsing through several books in
// a row still gets a waveform for each eventually, in the order they were
// opened.
let currentJob = null; // { bookId }
const queue = []; // { book, onDone }, deduped by book id

function isGenerating(bookId) {
  return currentJob?.bookId === bookId;
}

function isQueued(bookId) {
  return queue.some((entry) => entry.book.id === bookId);
}

function processQueue() {
  if (currentJob || !queue.length) return;
  const { book, onDone } = queue.shift();
  currentJob = { bookId: book.id };

  computeLevels(book)
    .then(async (levels) => {
      await fsp.mkdir(WAVEFORM_CACHE, { recursive: true });
      await fsp.writeFile(waveformPath(book.id), Buffer.from(levels));
      onDone?.(book.id, true);
    })
    .catch((err) => {
      console.warn(`[waveform] generation failed for ${book.id}: ${err.message}`);
      onDone?.(book.id, false);
    })
    .finally(() => {
      currentJob = null;
      processQueue();
    });
}

/**
 * Queues a book for background waveform generation, unless it's already
 * cached, already running, or already queued. `onDone(bookId, ok)` fires
 * once this specific book's job finishes (or fails). Returns whether a new
 * job was actually queued.
 */
function requestWaveform(book, onDone) {
  if (!isAvailable() || hasWaveform(book.id) || isGenerating(book.id) || isQueued(book.id)) return false;
  queue.push({ book, onDone });
  processQueue();
  return true;
}

module.exports = {
  WAVEFORM_POINTS,
  isAvailable,
  waveformPath,
  hasWaveform,
  deleteWaveform,
  renameWaveform,
  requestWaveform,
  isGenerating,
};
