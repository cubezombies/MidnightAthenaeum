// Dump MP4/M4B box structure to find how (or whether) chapters are stored.
import { open } from 'node:fs/promises';

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'udta', 'meta', 'edts', 'tref']);

async function walk(fh, start, end, depth, out) {
  let pos = start;
  while (pos < end - 8) {
    const header = Buffer.alloc(16);
    const { bytesRead } = await fh.read(header, 0, 16, pos);
    if (bytesRead < 8) return;

    let size = header.readUInt32BE(0);
    const type = header.toString('latin1', 4, 8);
    let headerSize = 8;

    if (size === 1) {
      size = Number(header.readBigUInt64BE(8));
      headerSize = 16;
    } else if (size === 0) {
      size = end - pos;
    }
    if (size < headerSize || pos + size > end) return;

    out.push(`${'  '.repeat(depth)}${type} (${size} bytes)`);

    if (CONTAINERS.has(type)) {
      // 'meta' is a full box: 4 extra bytes of version/flags before children.
      const skip = type === 'meta' ? 4 : 0;
      await walk(fh, pos + headerSize + skip, pos + size, depth + 1, out);
    }
    if (type === 'hdlr') {
      const buf = Buffer.alloc(Math.min(32, size - headerSize));
      await fh.read(buf, 0, buf.length, pos + headerSize);
      out.push(`${'  '.repeat(depth + 1)}handler=${buf.toString('latin1', 8, 12)}`);
    }
    if (type === 'chpl') {
      const buf = Buffer.alloc(Math.min(64, size - headerSize));
      await fh.read(buf, 0, buf.length, pos + headerSize);
      out.push(`${'  '.repeat(depth + 1)}*** NERO CHAPTERS, count byte=${buf[8]}`);
    }
    if (type === 'tref') {
      out.push(`${'  '.repeat(depth + 1)}*** track reference present`);
    }

    pos += size;
  }
}

const file = process.argv[2];
const fh = await open(file, 'r');
const { size } = await fh.stat();
const out = [];
await walk(fh, 0, size, 0, out);
await fh.close();
console.log(out.join('\n'));
