'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');
const { protocol } = require('electron');

const { COVER_CACHE } = require('./paths');

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

function mediaUrl(filePath) {
  return `${SCHEME}://f/${encodePath(filePath)}`;
}

/** Register the scheme as privileged. Must run before `app.ready`. */
function registerScheme() {
  protocol.registerSchemesAsPrivileged([{
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false },
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
function registerMediaProtocol(getAllowedRoots) {
  protocol.handle(SCHEME, async (request) => {
    let filePath;
    try {
      const url = new URL(request.url);
      const encoded = url.pathname.replace(/^\/+/, '');
      filePath = Buffer.from(encoded, 'base64url').toString('utf8');
    } catch {
      return new Response('Bad request', { status: 400 });
    }

    const roots = [...getAllowedRoots(), COVER_CACHE];
    if (!roots.some((root) => isInside(root, filePath))) {
      console.warn(`[media] blocked out-of-library request: ${filePath}`);
      return new Response('Forbidden', { status: 403 });
    }

    let stat;
    try {
      stat = await fsp.stat(filePath);
      if (!stat.isFile()) throw new Error('not a file');
    } catch {
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

        const stream = fs.createReadStream(filePath, { start, end });
        return new Response(Readable.toWeb(stream), {
          status: 206,
          headers: {
            'Content-Type': contentType,
            'Content-Length': String(end - start + 1),
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Accept-Ranges': 'bytes',
          },
        });
      }
    }

    return new Response(Readable.toWeb(fs.createReadStream(filePath)), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(stat.size),
        'Accept-Ranges': 'bytes',
      },
    });
  });
}

module.exports = { registerScheme, registerMediaProtocol, mediaUrl, SCHEME };
