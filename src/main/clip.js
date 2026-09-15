'use strict';

/**
 * Exports a short audio clip around a bookmark span, via ffmpeg. A span that
 * straddles a track boundary (rare -- bookmarks land wherever the user was
 * listening, and clips default to well under a minute) is handled by
 * concatenating the overlapping tracks' trimmed segments in one ffmpeg
 * invocation, rather than silently cutting off at the boundary.
 */

const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { ffmpegPath } = require('./ffmpeg-path');

function isAvailable() {
  return Boolean(ffmpegPath);
}

// A single job at a time -- this is a one-off per-clip action, not a
// background pass, so there is no queue, only something to cancel.
let currentJob = null;

function isExporting() {
  return currentJob !== null;
}

/**
 * `tracks`: the book's real tracks, each { filePath, duration }, in the same
 * order toClientBook computes cumulative offsets from. Returns, for every
 * track the [start,end) whole-book-seconds span actually touches, that
 * track's file path plus the clip's local [start,end) sub-range within it.
 */
function overlappingSegments(tracks, start, end) {
  const segments = [];
  let offset = 0;
  for (const track of tracks) {
    const trackStart = offset;
    const trackDuration = track.duration || 0;
    const trackEnd = trackStart + trackDuration;
    offset = trackEnd;
    if (trackEnd <= start || trackStart >= end) continue;

    const localStart = Math.max(0, start - trackStart);
    const localEnd = Math.min(trackDuration, end - trackStart);
    if (localEnd - localStart <= 0.01) continue; // negligible sliver at a boundary
    segments.push({ filePath: track.filePath, localStart, duration: localEnd - localStart });
  }
  return segments;
}

/**
 * Exports the whole-book-seconds span [start,end) to `outputPath` as an mp3.
 * Always re-encodes rather than stream-copying: a multi-segment clip can
 * span tracks with different source codecs, and re-encoding is what lets
 * them concatenate cleanly into one output either way. `-ss`/`-t` land
 * before each `-i` (fast keyframe-ish seek) rather than after -- decoding an
 * audiobook from 0 up to a bookmark that might be hours in would make every
 * export slow for no benefit a short shareable clip needs frame-accuracy for.
 */
function exportAudioClip({ tracks, start, end, outputPath }) {
  if (!isAvailable()) return Promise.reject(new Error('ffmpeg is not available in this build.'));
  if (currentJob) return Promise.reject(new Error('Already exporting a clip — wait for it to finish first.'));

  const segments = overlappingSegments(tracks, start, end);
  if (!segments.length) return Promise.reject(new Error('That span has no audio to export.'));

  const args = ['-y'];
  for (const seg of segments) {
    args.push('-ss', String(seg.localStart), '-t', String(seg.duration), '-i', seg.filePath);
  }
  if (segments.length > 1) {
    const inputs = segments.map((_, i) => `[${i}:a]`).join('');
    args.push('-filter_complex', `${inputs}concat=n=${segments.length}:v=0:a=1[out]`, '-map', '[out]');
  } else {
    args.push('-map', '0:a');
  }
  args.push('-c:a', 'libmp3lame', '-b:a', '128k', outputPath);

  return new Promise((resolve, reject) => {
    const job = { proc: null, cancelled: false };
    currentJob = job;
    const proc = spawn(ffmpegPath, args, { windowsHide: true });
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
        try { fs.unlinkSync(outputPath); } catch { /* best-effort cleanup of a partial file */ }
        reject(new Error('Cancelled.'));
        return;
      }
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-500)}`));
    });
  });
}

function cancelExport() {
  if (!currentJob) return;
  currentJob.cancelled = true;
  currentJob.proc?.kill();
}

module.exports = {
  isAvailable, isExporting, exportAudioClip, cancelExport,
  // Exported for testing: the boundary-straddling math is the one part of
  // this module worth asserting on directly, without spawning real ffmpeg.
  overlappingSegments,
};
