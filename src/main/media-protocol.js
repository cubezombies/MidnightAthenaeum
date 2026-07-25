'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { protocol } = require('electron');

const { COVER_CACHE, ONLINE_COVER_CACHE } = require('./paths');

const SCHEME = 'ab-media';

const MIME_TYPES = {
  '.m4b': 'audio/mp4',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

function encodePath(filePath) {
  return Buffer.from(filePath, 'utf8').toString('base64url');
}

// Bounded buffer between the file and the renderer. An audiobook file is
// routinely hundreds of MB and can exceed a gigabyte.
const STREAM_CHUNK = 256 * 1024;
const STREAM_HIGH_WATER = 2 * 1024 * 1024;

/**
 * A file as a web ReadableStream that actually honours backpressure.
 *
 * This replaces `Readable.toWeb(createReadStream(...))`. That adapter does
 * not reliably propagate the consumer's backpressure to the file handle, so
 * serving a large audio file could read it into native memory as fast as the
 * disk allowed, whether or not the renderer was consuming it. Diagnostics
 * from a real crash showed exactly that signature: resident memory climbing
 * ~250MB/s (roughly the drive's sequential read speed) to 7.3GB and the
 * process being killed, while the JS heap stayed flat at ~130MB the entire
 * time -- i.e. memory that no JS-level fix could ever have reached. It also
 * saturated the drive, which starved the concurrent library scan (cache-hit
 * books that normally take ~10ms were taking seconds).
 *
 * Here the source is paused as soon as the consumer's queue is full and only
 * resumed on pull(), so at most ~2MB is ever held in memory regardless of
 * file size.
 */
function fileWebStream(filePath, { start, end } = {}) {
  const nodeStream = fs.createReadStream(filePath, { start, end, highWaterMark: STREAM_CHUNK });
  let closed = false;

  return new ReadableStream({
    start(controller) {
      nodeStream.on('data', (chunk) => {
        if (closed) return;
        controller.enqueue(chunk);
        if (controller.desiredSize !== null && controller.desiredSize <= 0) nodeStream.pause();
      });
      nodeStream.on('end', () => {
        if (closed) return;
        closed = true;
        controller.close();
      });
      nodeStream.on('error', (err) => {
        if (closed) return;
        closed = true;
        controller.error(err);
      });
    },
    pull() {
      nodeStream.resume();
    },
    cancel() {
      // The renderer seeking or switching books aborts the request; without
      // destroying the handle the read would continue in the background.
      closed = true;
      nodeStream.destroy();
    },
  }, new ByteLengthQueuingStrategy({ highWaterMark: STREAM_HIGH_WATER }));
}

function mediaUrl(filePath) {
  return `${SCHEME}://f/${encodePath(filePath)}`;
}

/** Register the scheme as privileged. Must run before `app.ready`. */
function registerScheme() {
  protocol.registerSchemesAsPrivileged([{
    scheme: SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: false,
      // Required because the renderer sets `audio.crossOrigin = 'anonymous'`
      // (app.js — so Web Audio's analyser isn't tainted and skip-silence /
      // normalization can read the waveform). That makes every media fetch a
      // CORS request, and Chromium refuses CORS on a custom scheme that
      // hasn't opted in. Without this the request is rejected *before* the
      // protocol handler is ever invoked, and the media element reports
      // "MEDIA_ELEMENT_ERROR: Format error" — which reads like a broken file
      // rather than a blocked request. Electron 34 did not enforce this;
      // Electron 43 does, and it broke playback of every book.
      corsEnabled: true,
    },
  }]);
}

function isInside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Serve audio and cover files over a custom scheme with byte-range support.
 * Without ranges, seeking in a multi-hour m4b would re-download from zero.
 *
 * `getAllowedRoots` is consulted per request so this can never be used to read
 * files outside the folders the user actually added to their library.
 */
function registerMediaProtocol(getAllowedRoots, onRequest) {
  protocol.handle(SCHEME, async (request) => {
    let filePath;
    try {
      const url = new URL(request.url);
      const encoded = url.pathname.replace(/^\/+/, '');
      filePath = Buffer.from(encoded, 'base64url').toString('utf8');
    } catch {
      onRequest?.({ error: 'bad-request', url: request.url });
      return new Response('Bad request', { status: 400 });
    }

    const roots = [...getAllowedRoots(), COVER_CACHE, ONLINE_COVER_CACHE];
    if (!roots.some((root) => isInside(root, filePath))) {
      console.warn(`[media] blocked out-of-library request: ${filePath}`);
      onRequest?.({ error: 'forbidden', filePath, roots });
      return new Response('Forbidden', { status: 403 });
    }

    let stat;
    try {
      stat = await fsp.stat(filePath);
      if (!stat.isFile()) throw new Error('not a file');
    } catch (err) {
      onRequest?.({ error: 'not-found', filePath, detail: err.message });
      return new Response('Not found', { status: 404 });
    }

    const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    const range = request.headers.get('Range');

    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (match) {
        const hasStart = match[1] !== '';
        const hasEnd = match[2] !== '';
        let start;
        let end;

        if (hasStart) {
          start = Number(match[1]);
          end = hasEnd ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
        } else if (hasEnd) {
          // Suffix range: last N bytes.
          const suffix = Number(match[2]);
          start = Math.max(0, stat.size - suffix);
          end = stat.size - 1;
        }

        if (start === undefined || start > end || start >= stat.size) {
          return new Response('Range not satisfiable', {
            status: 416,
            headers: { 'Content-Range': `bytes */${stat.size}` },
          });
        }

        onRequest?.({ filePath, size: stat.size, start, end, ranged: true });
        return new Response(fileWebStream(filePath, { start, end }), {
          status: 206,
          headers: {
            'Content-Type': contentType,
            'Content-Length': String(end - start + 1),
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Accept-Ranges': 'bytes',
            // Untaint the media so the renderer's Web Audio AnalyserNode (used by
            // skip-silence) can read the waveform of an ab-media:// source.
            'Access-Control-Allow-Origin': '*',
          },
        });
      }
    }

    onRequest?.({ filePath, size: stat.size, ranged: false });
    return new Response(fileWebStream(filePath), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(stat.size),
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
      },
    });
  });
}

// fileWebStream is exported for testing: the backpressure behaviour it fixes
// is the difference between bounded memory and reading a whole audiobook into
// RAM, and that is worth being able to assert on directly.
module.exports = { registerScheme, registerMediaProtocol, mediaUrl, SCHEME, fileWebStream };
