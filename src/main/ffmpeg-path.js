'use strict';

/**
 * Resolves the bundled ffmpeg-static binary's real path, shared by every
 * module that spawns it directly (transcribe.js, audible.js, clip.js).
 * require()/dlopen() reads transparently through the virtual app.asar path,
 * but child_process.spawn() does not — it needs a real path and fails with
 * ENOENT on the virtual one once packaged. The rewrite below is a no-op in
 * dev (no "app.asar" segment to replace).
 */

const path = require('node:path');

let ffmpegPath = null;
try {
  ffmpegPath = require('ffmpeg-static');
  if (ffmpegPath) {
    ffmpegPath = ffmpegPath.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
  }
} catch (err) {
  console.warn('[ffmpeg-path] ffmpeg-static not available:', err.message);
}

module.exports = { ffmpegPath };
