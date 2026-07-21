'use strict';

/**
 * CUE-sheet chapter extraction.
 *
 * Many single-file audiobooks (a lone .mp3, or an .m4b with no embedded
 * chapters) ship a sibling `.cue` that lists chapter titles and offsets:
 *
 *   FILE "book.mp3" MP3
 *     TRACK 01 AUDIO
 *       TITLE "Chapter 1"
 *       INDEX 01 00:00:00
 *     TRACK 02 AUDIO
 *       TITLE "Chapter 2"
 *       INDEX 01 12:17:18   (MM:SS:FF — minutes:seconds:frames, 75 fps)
 *
 * We use this only as a *fallback* — when a book has no embedded chapters — so
 * good in-file chapters are never overridden. Frames are sub-second and ignored
 * for navigation; only MM:SS matter.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

/** Parse CUE text into { file, chapters: [{title, start}] } (start in seconds). */
function parseCueText(text) {
  const lines = text.split(/\r?\n/);
  let file = null;
  const chapters = [];
  let current = null;

  for (const raw of lines) {
    const line = raw.trim();
    let m;
    if ((m = /^FILE\s+"([^"]+)"/i.exec(line)) || (m = /^FILE\s+(\S+)/i.exec(line))) {
      if (!file) file = m[1];
    } else if (/^TRACK\s+\d+\s+AUDIO/i.test(line)) {
      current = { title: '', start: null };
      chapters.push(current);
    } else if (current && (m = /^TITLE\s+"([^"]*)"/i.exec(line) || /^TITLE\s+(.+)$/i.exec(line))) {
      current.title = (m[1] ?? '').trim();
    } else if (current && (m = /^INDEX\s+0*1\s+(\d+):(\d+):(\d+)/i.exec(line))) {
      const min = Number(m[1]);
      const sec = Number(m[2]);
      const frames = Number(m[3]);
      current.start = min * 60 + sec + Math.min(frames, 74) / 75;
    }
  }

  // Keep only tracks that actually got a timestamp, in order.
  const valid = chapters.filter((c) => typeof c.start === 'number' && Number.isFinite(c.start));
  return { file, chapters: valid };
}

/**
 * Find a `.cue` in the audio file's folder that describes it, and return its
 * chapters as {index, title, start, end}. Returns [] if none applies.
 *
 * @param {string} audioPath absolute path to the single audio file
 * @param {number} duration  book duration in seconds (to bound/trim chapters)
 */
async function chaptersFromCue(audioPath, duration) {
  const dir = path.dirname(audioPath);
  const audioBase = path.basename(audioPath);
  const audioStem = audioBase.replace(/\.[^.]+$/, '').toLowerCase();

  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const cues = entries
    .filter((e) => e.isFile() && path.extname(e.name).toLowerCase() === '.cue')
    .map((e) => path.join(dir, e.name));
  if (!cues.length) return [];

  // Read+parse each candidate; prefer the one whose FILE names this audio, then
  // one sharing the audio's basename, then a lone cue in the folder.
  const parsed = [];
  for (const cuePath of cues) {
    let text;
    try {
      text = await fsp.readFile(cuePath, 'latin1');
    } catch {
      continue;
    }
    parsed.push({ cuePath, ...parseCueText(text) });
  }

  const referencesAudio = (p) => p.file && p.file.toLowerCase() === audioBase.toLowerCase();
  const shareStem = (p) => path.basename(p.cuePath).replace(/\.cue$/i, '').toLowerCase() === audioStem;

  let chosen = parsed.find(referencesAudio)
    || parsed.find(shareStem)
    || (parsed.length === 1 ? parsed[0] : null);

  // A cue that names a *different* file isn't ours.
  if (chosen && chosen.file && !referencesAudio(chosen) && !shareStem(chosen)) chosen = null;
  if (!chosen || chosen.chapters.length < 2) return [];

  const sorted = [...chosen.chapters].sort((a, b) => a.start - b.start);
  const bounded = duration > 0 ? sorted.filter((c) => c.start <= duration + 1) : sorted;
  if (bounded.length < 2) return [];

  return bounded.map((c, i, all) => ({
    index: i,
    title: c.title || `Chapter ${i + 1}`,
    start: Math.max(0, c.start),
    end: all[i + 1] ? all[i + 1].start : (duration || null),
  }));
}

/** Sync existence check for a sibling cue (cheap pre-filter). */
function hasSiblingCue(audioPath) {
  const dir = path.dirname(audioPath);
  try {
    return fs.readdirSync(dir).some((n) => n.toLowerCase().endsWith('.cue'));
  } catch {
    return false;
  }
}

module.exports = { parseCueText, chaptersFromCue, hasSiblingCue };
