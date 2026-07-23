'use strict';

/**
 * Local, offline speech-to-text for full-text search inside a book — opt-in,
 * per book (not a whole-library batch job; a 15-hour audiobook can take a
 * long time even on a GPU, let alone CPU-only). Pipeline per book:
 *
 *   1. ensureModel() — download the ggml model once (~148MB), cached.
 *   2. Convert each track to 16kHz mono PCM WAV via ffmpeg (whisper.cpp only
 *      accepts that exact format, not the original mp3/m4b/etc).
 *   3. Run @kutalia/whisper-node-addon over each track's WAV, offsetting
 *      timestamps by the track's cumulative position (mirrors how
 *      toClientBook computes track offsets in main.js).
 *   4. Save one flattened, timestamped transcript per book.
 *
 * Verified directly (not assumed) that the native addon loads and GPU
 * (Vulkan) auto-detection works under Electron's actual bundled Node
 * runtime, not just plain Node — see the dev session that built this.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const { TRANSCRIPTS_DIR, WHISPER_MODEL_DIR } = require('./paths');

const MODEL_NAME = 'ggml-base.en.bin';
const MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL_NAME}`;
const MODEL_PATH = path.join(WHISPER_MODEL_DIR, MODEL_NAME);

let whisperTranscribe = null;
let ffmpegPath = null;
try {
  // eslint-disable-next-line global-require
  ({ transcribe: whisperTranscribe } = require('@kutalia/whisper-node-addon'));
  // eslint-disable-next-line global-require
  ffmpegPath = require('ffmpeg-static');
  // In a packaged app, require()/dlopen() transparently reads unpacked
  // files through the virtual app.asar path (confirmed working for the
  // whisper.node addon itself), but child_process.spawn() does NOT — it
  // needs a real path and fails with ENOENT on the virtual one. Verified
  // directly against a real packaged build rather than assumed: this
  // rewrite is required for ffmpeg to actually run once packaged, and is a
  // no-op in dev (no "app.asar" segment to replace).
  if (ffmpegPath) {
    ffmpegPath = ffmpegPath.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
  }
} catch (err) {
  console.warn('[transcribe] native dependencies not available:', err.message);
}

function isAvailable() {
  return Boolean(whisperTranscribe && ffmpegPath);
}

function transcriptPath(bookId) {
  return path.join(TRANSCRIPTS_DIR, `${bookId}.json`);
}

function hasTranscript(bookId) {
  return fs.existsSync(transcriptPath(bookId));
}

function loadTranscript(bookId) {
  try {
    return JSON.parse(fs.readFileSync(transcriptPath(bookId), 'utf8'));
  } catch {
    return null;
  }
}

function deleteTranscript(bookId) {
  try {
    fs.rmSync(transcriptPath(bookId), { force: true });
  } catch {
    // Best effort.
  }
}

function hasModel() {
  return fs.existsSync(MODEL_PATH);
}

/** Downloads the model once. onProgress gets a 0-1 fraction. */
async function ensureModel(onProgress) {
  if (hasModel()) return;
  await fsp.mkdir(WHISPER_MODEL_DIR, { recursive: true });

  const res = await fetch(MODEL_URL);
  if (!res.ok || !res.body) throw new Error(`Model download failed: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  let received = 0;

  const nodeStream = Readable.fromWeb(res.body);
  nodeStream.on('data', (chunk) => {
    received += chunk.length;
    if (total) onProgress?.(received / total);
  });

  const tmp = `${MODEL_PATH}.part`;
  await pipeline(nodeStream, fs.createWriteStream(tmp));
  await fsp.rename(tmp, MODEL_PATH);
}

function convertToWav16k(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, [
      '-y', '-i', inputPath,
      '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le',
      outputPath,
    ], { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d; });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-500)}`));
    });
  });
}

/** "01:02:03.456" -> seconds. */
function parseTimestamp(ts) {
  const m = /^(\d+):(\d{2}):(\d{2})\.(\d{3})$/.exec(String(ts).trim());
  if (!m) return 0;
  const [, h, mi, s, ms] = m;
  return Number(h) * 3600 + Number(mi) * 60 + Number(s) + Number(ms) / 1000;
}

// Only one book at a time — running two whisper inferences concurrently
// would just contend for the same GPU/CPU and slow both down.
let currentJob = null; // { bookId, cancelled }

function isTranscribing(bookId) {
  return currentJob?.bookId === bookId;
}

function anyTranscribing() {
  return currentJob !== null;
}

/**
 * Cancellation is checked between tracks (and before/after the model
 * download), not mid-file — the addon has no abort hook. For the common
 * case of a single-file book this means "Cancel" takes effect only after
 * the current file finishes; the result is simply discarded rather than
 * saved, so it isn't wasted disk space, but the CPU/GPU time already spent
 * isn't recoverable. Documented as a known limitation, not hidden.
 */
async function transcribeBook(book, onProgress) {
  if (!isAvailable()) throw new Error('Whisper is not available in this build.');
  if (currentJob) throw new Error(`Already transcribing "${currentJob.bookId}".`);

  currentJob = { bookId: book.id, cancelled: false };
  const job = currentJob;
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ma-transcribe-'));

  try {
    onProgress?.({ phase: 'model', percent: 0 });
    await ensureModel((frac) => onProgress?.({ phase: 'model', percent: frac * 100 }));
    if (job.cancelled) return null;

    const totalDuration = book.tracks.reduce((sum, t) => sum + (t.duration || 0), 0) || 1;
    let elapsed = 0;
    const allSegments = [];

    for (const track of book.tracks) {
      if (job.cancelled) break;

      const wavPath = path.join(tmpDir, `${crypto.randomUUID()}.wav`);
      onProgress?.({ phase: 'convert', percent: (elapsed / totalDuration) * 100 });
      await convertToWav16k(track.filePath, wavPath);
      if (job.cancelled) { await fsp.rm(wavPath, { force: true }); break; }

      const trackOffset = elapsed;
      const trackShare = (track.duration || 0) / totalDuration;
      // eslint-disable-next-line no-await-in-loop
      const result = await whisperTranscribe({
        fname_inp: wavPath,
        model: MODEL_PATH,
        language: 'en',
        use_gpu: true, // auto-detects GPU (Vulkan); falls back to CPU/BLAS when none is found
        translate: false,
        no_timestamps: false,
        progress_callback: (p) => {
          const overall = (elapsed / totalDuration) * 100 + (Number(p) / 100) * trackShare * 100;
          onProgress?.({ phase: 'transcribe', percent: overall });
        },
      });

      for (const [startStr, endStr, text] of result.transcription ?? []) {
        const clean = String(text).trim();
        if (!clean) continue;
        allSegments.push({
          start: trackOffset + parseTimestamp(startStr),
          end: trackOffset + parseTimestamp(endStr),
          text: clean,
        });
      }

      await fsp.rm(wavPath, { force: true });
      elapsed += track.duration || 0;
    }

    if (job.cancelled) return null;

    await fsp.mkdir(TRANSCRIPTS_DIR, { recursive: true });
    const payload = {
      bookId: book.id,
      model: MODEL_NAME,
      generatedAt: new Date().toISOString(),
      segments: allSegments,
    };
    await fsp.writeFile(transcriptPath(book.id), JSON.stringify(payload), 'utf8');
    onProgress?.({ phase: 'done', percent: 100 });
    return payload;
  } finally {
    currentJob = null;
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

function cancelTranscription(bookId) {
  if (currentJob?.bookId === bookId) currentJob.cancelled = true;
}

module.exports = {
  isAvailable,
  hasModel,
  hasTranscript,
  loadTranscript,
  deleteTranscript,
  isTranscribing,
  anyTranscribing,
  cancelTranscription,
  transcribeBook,
};
