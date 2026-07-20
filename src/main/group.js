'use strict';

const path = require('node:path');

/**
 * Turns a flat list of audio files into book-sized units.
 *
 * Real libraries mix two conventions:
 *   - one self-contained `.m4b` / `.m4a` per book (chapters live inside)
 *   - a folder of `.mp3` tracks per book, sometimes split across `Disc N` subfolders
 *
 * Treating every file as a book would explode a 50k-track library into 50k
 * entries, and treating every folder as a book would collapse a series folder
 * of separate m4b files into one. So we split on file type.
 */

const SELF_CONTAINED = new Set(['.m4b', '.m4a']);

// "Disc 2", "CD03", "Part 4", "Disk 1 Disk 1" …
const DISC_DIR = /^(disc|disk|cd|part|pt)[\s._-]*\d+/i;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function naturalCompare(a, b) {
  return collator.compare(a, b);
}

/** Strip a trailing "- Disc 2" / "(CD 3)" so sibling discs share a title. */
function stripDiscSuffix(name) {
  return name
    .replace(/[\s._-]*[([]?\b(disc|disk|cd|part|pt)[\s._-]*\d+\b[)\]]?/gi, '')
    .replace(/[\s._-]+$/, '')
    .trim();
}

function looksLikeDisc(dirName) {
  return DISC_DIR.test(dirName) || /\b(disc|disk|cd)[\s._-]*\d+\b/i.test(dirName);
}

/**
 * @param {string[]} files absolute paths to audio files
 * @returns {Array<{kind:'single'|'multi', dir:string, name:string, files:string[]}>}
 */
function groupIntoBooks(files) {
  const units = [];

  /** @type {Map<string, string[]>} dir -> multi-track files */
  const trackDirs = new Map();

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (SELF_CONTAINED.has(ext)) {
      units.push({ kind: 'single', dir: path.dirname(file), name: path.parse(file).name, files: [file] });
    } else {
      const dir = path.dirname(file);
      if (!trackDirs.has(dir)) trackDirs.set(dir, []);
      trackDirs.get(dir).push(file);
    }
  }

  // Decide which track-folders are discs of a larger book. A parent qualifies
  // only if it has several audio child folders and at least one is disc-named,
  // which keeps series folders (each child a distinct book) from collapsing.
  const childrenByParent = new Map();
  for (const dir of trackDirs.keys()) {
    const parent = path.dirname(dir);
    if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
    childrenByParent.get(parent).push(dir);
  }

  const mergedParents = new Set();
  for (const [parent, dirs] of childrenByParent) {
    if (dirs.length < 2) continue;
    if (dirs.some((d) => looksLikeDisc(path.basename(d)))) mergedParents.add(parent);
  }

  const consumed = new Set();
  for (const parent of mergedParents) {
    const dirs = childrenByParent.get(parent).sort(naturalCompare);
    const files = [];
    for (const dir of dirs) {
      consumed.add(dir);
      files.push(...trackDirs.get(dir).sort(naturalCompare));
    }
    // Files inside the parent itself belong to the same book.
    if (trackDirs.has(parent)) {
      consumed.add(parent);
      files.unshift(...trackDirs.get(parent).sort(naturalCompare));
    }
    units.push({
      kind: 'multi',
      dir: parent,
      name: stripDiscSuffix(path.basename(parent)) || path.basename(parent),
      files,
    });
  }

  for (const [dir, dirFiles] of trackDirs) {
    if (consumed.has(dir)) continue;
    units.push({
      kind: 'multi',
      dir,
      name: stripDiscSuffix(path.basename(dir)) || path.basename(dir),
      files: dirFiles.sort(naturalCompare),
    });
  }

  return units;
}

module.exports = { groupIntoBooks, naturalCompare, stripDiscSuffix, looksLikeDisc };
