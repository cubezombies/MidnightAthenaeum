'use strict';

/**
 * Decrypts a user's own Audible .aax files via ffmpeg's built-in
 * `-activation_bytes` support -- a long-public, widely-documented ffmpeg
 * feature (not something this app implements or reverse-engineers itself).
 * The activation bytes themselves are supplied by the user (File > Set
 * Audible activation bytes…), obtained through their own means outside this
 * app; nothing here ever talks to Audible's servers or handles Audible
 * account credentials.
 */

const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { spawn } = require('node:child_process');

let ffmpegPath = null;
try {
  ffmpegPath = require('ffmpeg-static');
  // Same asar-unpack rewrite transcribe.js needs: require()/dlopen() reads
  // transparently through the virtual app.asar path, but child_process.spawn()
  // does not -- it needs a real path and fails with ENOENT on the virtual
  // one once packaged. A no-op in dev (no "app.asar" segment to replace).
  if (ffmpegPath) {
    ffmpegPath = ffmpegPath.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
  }
} catch (err) {
  console.warn('[audible] ffmpeg-static not available:', err.message);
}

function isAvailable() {
  return Boolean(ffmpegPath);
}

const ACTIVATION_BYTES_RE = /^[0-9a-fA-F]{8}$/;
function isValidActivationBytes(value) {
  return typeof value === 'string' && ACTIVATION_BYTES_RE.test(value);
}

// A single job at a time -- this is a one-off per-file utility action, not a
// background pass, so there is no queue to manage, only something to cancel.
let currentJob = null; // { inputPath, outputPath, proc, cancelled }

function isDecrypting() {
  return currentJob !== null;
}

function cancelDecrypt() {
  if (!currentJob) return;
  currentJob.cancelled = true;
  currentJob.proc?.kill();
}

/**
 * Decrypts one .aax into a plain .m4b. Stream-copies (`-c copy`) rather than
 * re-encoding -- only the encryption wrapper needs removing, not the
 * underlying audio -- so this runs at roughly disk speed, not encode speed.
 * The source .aax is never touched, moved, or deleted; the caller picks a
 * non-colliding output path.
 *
 * Wrong activation bytes don't fail loudly here -- ffmpeg still exits 0 but
 * writes an unplayable/garbage file, since it has no way to know the bytes
 * are wrong until playback. Left as a known limitation for the caller/UI to
 * be honest about, rather than papered over with a false confirmation.
 */
function decryptAax(inputPath, outputPath, activationBytes) {
  if (!isAvailable()) return Promise.reject(new Error('ffmpeg is not available in this build.'));
  if (!isValidActivationBytes(activationBytes)) {
    return Promise.reject(new Error('Activation bytes must be exactly 8 hex characters.'));
  }
  if (currentJob) return Promise.reject(new Error('Already decrypting a file — wait for it to finish first.'));

  return new Promise((resolve, reject) => {
    const job = { inputPath, outputPath, proc: null, cancelled: false };
    currentJob = job;

    const proc = spawn(ffmpegPath, [
      '-y',
      '-activation_bytes', activationBytes,
      '-i', inputPath,
      '-c', 'copy',
      outputPath,
    ], { windowsHide: true });
    job.proc = proc;

    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d; });
    proc.on('error', (err) => {
      currentJob = null;
      reject(err);
    });
    proc.on('close', (code) => {
      currentJob = null;
      if (job.cancelled) {
        try { fs.unlinkSync(outputPath); } catch { /* best effort cleanup of a partial file */ }
        reject(new Error('Cancelled.'));
        return;
      }
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-500)}`));
    });
  });
}

// Mirrors library.js's walk() (same depth guard, same skip-dirs) but looking
// for .aax instead of playable audio -- kept separate/simple rather than
// generalizing that walker, since this one has no book-grouping logic at all.
const SKIP_DIRS = new Set(['node_modules', '$RECYCLE.BIN', 'System Volume Information']);

async function* walkForAax(dir, depth = 0) {
  if (depth > 8) return;
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      yield* walkForAax(full, depth + 1);
    } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.aax') {
      yield full;
    }
  }
}

/**
 * Finds .aax files under the given directories that don't already have a
 * same-named .m4b sibling next to them -- i.e. haven't been decrypted yet.
 * Powers the "found N Audible files, decrypt them now?" prompt offered when
 * a folder is newly added to the library, without re-flagging files a
 * previous decrypt (or a previous "not now") already dealt with.
 */
async function findUndecryptedAaxFiles(dirs) {
  const found = [];
  for (const dir of dirs) {
    // eslint-disable-next-line no-await-in-loop
    for await (const aaxPath of walkForAax(dir)) {
      const m4bPath = path.join(path.dirname(aaxPath), `${path.basename(aaxPath, path.extname(aaxPath))}.m4b`);
      if (!fs.existsSync(m4bPath)) found.push(aaxPath);
    }
  }
  return found;
}

module.exports = {
  isAvailable, isValidActivationBytes, isDecrypting, cancelDecrypt, decryptAax, findUndecryptedAaxFiles,
};
