'use strict';

/**
 * Chapter extraction for MP4/M4B files.
 *
 * music-metadata's `includeChapters` does not surface QuickTime text chapter
 * tracks, which is how essentially every m4b in the wild stores its chapters
 * (a second `trak` with handler `text`, linked from the audio track by a
 * `tref`/`chap` reference). This module reads that track directly, and falls
 * back to Nero-style `chpl` atoms when present.
 *
 * Boxes are located with targeted reads rather than slurping `moov`, because
 * the audio track's sample tables can run to tens of megabytes and we only
 * need the chapter track's much smaller ones.
 */

const { open } = require('node:fs/promises');

const CONTAINER_BOXES = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'udta', 'edts', 'tref']);
const MAX_TABLE_BYTES = 8 * 1024 * 1024;

class BoxReader {
  constructor(fh, fileSize) {
    this.fh = fh;
    this.fileSize = fileSize;
  }

  /** List the boxes directly inside [start, end). */
  async children(start, end) {
    const boxes = [];
    let pos = start;
    while (pos + 8 <= end) {
      const header = Buffer.alloc(16);
      const { bytesRead } = await this.fh.read(header, 0, Math.min(16, end - pos), pos);
      if (bytesRead < 8) break;

      let size = header.readUInt32BE(0);
      const type = header.toString('latin1', 4, 8);
      let headerSize = 8;

      if (size === 1) {
        if (bytesRead < 16) break;
        size = Number(header.readBigUInt64BE(8));
        headerSize = 16;
      } else if (size === 0) {
        size = end - pos;
      }

      if (size < headerSize || pos + size > end) break;
      boxes.push({ type, start: pos, contentStart: pos + headerSize, contentEnd: pos + size });
      pos += size;
    }
    return boxes;
  }

  async content(box, limit = MAX_TABLE_BYTES) {
    const length = Math.min(box.contentEnd - box.contentStart, limit);
    if (length <= 0) return Buffer.alloc(0);
    const buf = Buffer.alloc(length);
    await this.fh.read(buf, 0, length, box.contentStart);
    return buf;
  }

  /** Walk a path like ['mdia','minf','stbl'] from a parent box. */
  async descend(box, path) {
    let current = box;
    for (const want of path) {
      const kids = await this.children(current.contentStart, current.contentEnd);
      const next = kids.find((k) => k.type === want);
      if (!next) return null;
      current = next;
    }
    return current;
  }

  async find(box, type) {
    const kids = await this.children(box.contentStart, box.contentEnd);
    return kids.find((k) => k.type === type) ?? null;
  }
}

function readVersionedPair(buf, v0Offset, v1Offset, version) {
  return version === 1 ? Number(buf.readBigUInt64BE(v1Offset)) : buf.readUInt32BE(v0Offset);
}

async function readTrackInfo(reader, trak) {
  const info = { trackId: null, handler: null, timescale: null, chapRefs: [], trak };

  const tkhd = await reader.find(trak, 'tkhd');
  if (tkhd) {
    const buf = await reader.content(tkhd, 128);
    const version = buf[0];
    // version+flags(4) + creation + modification, then trackID
    info.trackId = version === 1 ? buf.readUInt32BE(20) : buf.readUInt32BE(12);
  }

  const mdia = await reader.find(trak, 'mdia');
  if (mdia) {
    const hdlr = await reader.find(mdia, 'hdlr');
    if (hdlr) {
      const buf = await reader.content(hdlr, 64);
      info.handler = buf.toString('latin1', 8, 12);
    }
    const mdhd = await reader.find(mdia, 'mdhd');
    if (mdhd) {
      const buf = await reader.content(mdhd, 64);
      const version = buf[0];
      info.timescale = readVersionedPair(buf, 12, 20, version);
    }
  }

  const tref = await reader.find(trak, 'tref');
  if (tref) {
    const chap = await reader.find(tref, 'chap');
    if (chap) {
      const buf = await reader.content(chap, 256);
      for (let i = 0; i + 4 <= buf.length; i += 4) info.chapRefs.push(buf.readUInt32BE(i));
    }
  }

  return info;
}

function parseStts(buf) {
  const count = buf.readUInt32BE(4);
  const deltas = [];
  let offset = 8;
  for (let i = 0; i < count && offset + 8 <= buf.length; i += 1, offset += 8) {
    const sampleCount = buf.readUInt32BE(offset);
    const sampleDelta = buf.readUInt32BE(offset + 4);
    for (let s = 0; s < sampleCount; s += 1) deltas.push(sampleDelta);
  }
  return deltas;
}

function parseStsz(buf) {
  const uniformSize = buf.readUInt32BE(4);
  const count = buf.readUInt32BE(8);
  if (uniformSize !== 0) return new Array(count).fill(uniformSize);
  const sizes = [];
  let offset = 12;
  for (let i = 0; i < count && offset + 4 <= buf.length; i += 1, offset += 4) {
    sizes.push(buf.readUInt32BE(offset));
  }
  return sizes;
}

function parseStsc(buf) {
  const count = buf.readUInt32BE(4);
  const entries = [];
  let offset = 8;
  for (let i = 0; i < count && offset + 12 <= buf.length; i += 1, offset += 12) {
    entries.push({
      firstChunk: buf.readUInt32BE(offset),
      samplesPerChunk: buf.readUInt32BE(offset + 4),
    });
  }
  return entries;
}

function parseChunkOffsets(buf, is64) {
  const count = buf.readUInt32BE(4);
  const offsets = [];
  let offset = 8;
  const step = is64 ? 8 : 4;
  for (let i = 0; i < count && offset + step <= buf.length; i += 1, offset += step) {
    offsets.push(is64 ? Number(buf.readBigUInt64BE(offset)) : buf.readUInt32BE(offset));
  }
  return offsets;
}

/** Map sample index -> absolute file offset using the stsc/stco chunk layout. */
function buildSampleOffsets(sizes, stsc, chunkOffsets) {
  const offsets = new Array(sizes.length);
  let sampleIndex = 0;

  for (let entry = 0; entry < stsc.length && sampleIndex < sizes.length; entry += 1) {
    const { firstChunk, samplesPerChunk } = stsc[entry];
    const lastChunk = entry + 1 < stsc.length ? stsc[entry + 1].firstChunk - 1 : chunkOffsets.length;

    for (let chunk = firstChunk; chunk <= lastChunk && sampleIndex < sizes.length; chunk += 1) {
      let cursor = chunkOffsets[chunk - 1];
      if (cursor === undefined) return offsets;
      for (let s = 0; s < samplesPerChunk && sampleIndex < sizes.length; s += 1) {
        offsets[sampleIndex] = cursor;
        cursor += sizes[sampleIndex];
        sampleIndex += 1;
      }
    }
  }
  return offsets;
}

function decodeChapterTitle(buf) {
  if (buf.length < 2) return '';
  const textLength = buf.readUInt16BE(0);
  const body = buf.subarray(2, Math.min(2 + textLength, buf.length));

  if (body.length >= 2 && body[0] === 0xfe && body[1] === 0xff) {
    return body.subarray(2).swap16().toString('utf16le').replace(/\0+$/, '').trim();
  }
  return body.toString('utf8').replace(/\0+$/, '').trim();
}

async function readTextTrackChapters(reader, chapterTrack) {
  const stbl = await reader.descend(chapterTrack.trak, ['mdia', 'minf', 'stbl']);
  if (!stbl) return [];

  const boxes = await reader.children(stbl.contentStart, stbl.contentEnd);
  const byType = Object.fromEntries(boxes.map((b) => [b.type, b]));
  if (!byType.stts || !byType.stsz || !byType.stsc) return [];

  const offsetBox = byType.stco ?? byType.co64;
  if (!offsetBox) return [];

  const [sttsBuf, stszBuf, stscBuf, offsetBuf] = await Promise.all([
    reader.content(byType.stts),
    reader.content(byType.stsz),
    reader.content(byType.stsc),
    reader.content(offsetBox),
  ]);

  const deltas = parseStts(sttsBuf);
  const sizes = parseStsz(stszBuf);
  const stsc = parseStsc(stscBuf);
  const chunkOffsets = parseChunkOffsets(offsetBuf, Boolean(byType.co64));
  const sampleOffsets = buildSampleOffsets(sizes, stsc, chunkOffsets);

  const timescale = chapterTrack.timescale || 1000;
  const chapters = [];
  let elapsed = 0;

  for (let i = 0; i < sizes.length; i += 1) {
    const offset = sampleOffsets[i];
    const size = sizes[i];
    const start = elapsed / timescale;
    elapsed += deltas[i] ?? 0;

    if (offset === undefined || !size) continue;
    const buf = Buffer.alloc(Math.min(size, 1024));
    await reader.fh.read(buf, 0, buf.length, offset);

    const title = decodeChapterTitle(buf);
    chapters.push({ title: title || `Chapter ${chapters.length + 1}`, start });
  }

  return chapters;
}

/** Nero-style chapter list, used by some taggers. */
async function readNeroChapters(reader, moov) {
  const udta = await reader.find(moov, 'udta');
  if (!udta) return [];
  const chpl = await reader.find(udta, 'chpl');
  if (!chpl) return [];

  const buf = await reader.content(chpl);
  // version/flags(4) + reserved(1) + uint32 count
  let offset = 5;
  if (offset + 4 > buf.length) return [];
  const count = buf.readUInt32BE(offset);
  offset += 4;

  const chapters = [];
  for (let i = 0; i < count && offset + 9 <= buf.length; i += 1) {
    const timestamp = Number(buf.readBigUInt64BE(offset)); // 100-nanosecond units
    offset += 8;
    const titleLength = buf[offset];
    offset += 1;
    const title = buf.toString('utf8', offset, offset + titleLength).trim();
    offset += titleLength;
    chapters.push({ title: title || `Chapter ${i + 1}`, start: timestamp / 10_000_000 });
  }
  return chapters;
}

/** Overall duration in seconds, straight from the movie header. */
async function readMovieDuration(reader, moov) {
  const mvhd = await reader.find(moov, 'mvhd');
  if (!mvhd) return 0;
  const buf = await reader.content(mvhd, 128);
  const version = buf[0];
  const timescale = readVersionedPair(buf, 12, 20, version);
  const duration = version === 1 ? Number(buf.readBigUInt64BE(28)) : buf.readUInt32BE(16);
  return timescale > 0 ? duration / timescale : 0;
}

/**
 * Opens `filePath`, locates the top-level `moov` box, and hands both to `fn`
 * — the one piece of work every reader below needs regardless of how much
 * of the file it goes on to touch. Locating `moov` is a cheap box-header
 * walk (small fixed reads) even on a huge file; what happens after varies
 * wildly in cost, which is exactly why duration and chapters are split into
 * separate entry points rather than one `readMp4Info` that always pays for
 * both.
 */
async function withMoov(filePath, fn) {
  let fh;
  try {
    fh = await open(filePath, 'r');
    const { size } = await fh.stat();
    const reader = new BoxReader(fh, size);
    const top = await reader.children(0, size);
    const moov = top.find((b) => b.type === 'moov');
    return moov ? await fn(reader, moov) : null;
  } catch (err) {
    console.warn(`[chapters] ${filePath}: ${err.message}`);
    return null;
  } finally {
    await fh?.close();
  }
}

/**
 * Just the duration, from `mvhd` — one small fixed-size read once `moov` is
 * found. Deliberately doesn't touch track/chapter boxes at all: those are
 * what make the full chapter walk expensive (one extra disk read per
 * chapter), and a scan only needs a book's length up front, not its chapter
 * list yet.
 */
async function readMp4Duration(filePath) {
  return (await withMoov(filePath, (reader, moov) => readMovieDuration(reader, moov))) ?? 0;
}

/**
 * The expensive part: walks every track, finds the chapter track, and reads
 * its full sample table plus one disk read per chapter title. `knownDuration`
 * lets a caller that already has a trusted duration (e.g. from phase 1) skip
 * re-reading `mvhd`; omit it to have this read duration itself too.
 *
 * @returns {Promise<{chapters: Array<{title:string,start:number}>, duration: number}>}
 */
async function readMp4Chapters(filePath, knownDuration) {
  const result = await withMoov(filePath, async (reader, moov) => {
    const duration = knownDuration ?? await readMovieDuration(reader, moov);

    const moovKids = await reader.children(moov.contentStart, moov.contentEnd);
    const traks = moovKids.filter((b) => b.type === 'trak');
    const tracks = [];
    for (const trak of traks) tracks.push(await readTrackInfo(reader, trak));

    const audio = tracks.find((t) => t.handler === 'soun');
    const refs = audio?.chapRefs ?? [];
    let chapterTrack = tracks.find((t) => refs.includes(t.trackId) && t.handler === 'text');

    // Some files omit the tref but still ship a lone text track.
    if (!chapterTrack) chapterTrack = tracks.find((t) => t.handler === 'text');

    let chapters = chapterTrack ? await readTextTrackChapters(reader, chapterTrack) : [];
    if (!chapters.length) chapters = await readNeroChapters(reader, moov);

    // Drop chapters that fall outside the running time; a few taggers leave junk.
    if (duration > 0) chapters = chapters.filter((c) => c.start <= duration + 1);

    return { chapters, duration };
  });
  return result ?? { chapters: [], duration: knownDuration ?? 0 };
}

/** Back-compat wrapper for callers that want both in one call (e.g. extractMp4Chapters below). */
async function readMp4Info(filePath) {
  return readMp4Chapters(filePath);
}

async function extractMp4Chapters(filePath) {
  return (await readMp4Info(filePath)).chapters;
}

module.exports = {
  extractMp4Chapters, readMp4Info, readMp4Duration, readMp4Chapters,
};
