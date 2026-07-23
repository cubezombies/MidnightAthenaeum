'use strict';

/**
 * Minimal EPUB reader: enough ZIP support for real-world EPUB files (STORED
 * and DEFLATE only, no Zip64/encryption) plus narrow regex/string extraction
 * of the handful of XML files EPUB actually needs (container.xml, the OPF,
 * and either an EPUB2 NCX or EPUB3 nav.xhtml table of contents) — not a
 * general-purpose zip or XML library. Mirrors mp4-chapters.js's approach:
 * hand-roll a well-scoped reader for a stable, well-documented format rather
 * than pull in a dependency for it.
 *
 * Deliberately does NOT turn chapter body content into plain text — arbitrary
 * real-world XHTML (occasionally malformed) is far more safely handled by
 * the renderer's real DOMParser than by main-process regex. This module only
 * goes as far as handing the renderer raw XHTML for the right spine file.
 */

const fs = require('node:fs/promises');
const zlib = require('node:zlib');
const path = require('node:path');

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

/** Scan backward for the End Of Central Directory record — it can trail a variable-length comment. */
function findEOCD(buf) {
  const maxCommentLen = 65535;
  const minPos = Math.max(0, buf.length - (22 + maxCommentLen));
  for (let i = buf.length - 22; i >= minPos; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

/**
 * Central Directory entries carry authoritative sizes (some zip writers
 * leave the Local File Header's size fields zero and rely on a trailing data
 * descriptor instead), so this reads sizes/offsets from there and only
 * touches each Local File Header later, just to locate where its data starts.
 */
function readCentralDirectory(buf) {
  const eocdPos = findEOCD(buf);
  if (eocdPos === -1) throw new Error('not a zip file (no End Of Central Directory record)');

  const cdOffset = buf.readUInt32LE(eocdPos + 16);
  const totalEntries = buf.readUInt16LE(eocdPos + 10);
  if (cdOffset === 0xffffffff || totalEntries === 0xffff) {
    throw new Error('Zip64 archives are not supported');
  }

  const entries = new Map(); // name -> { compressionMethod, compressedSize, localHeaderOffset }
  let pos = cdOffset;
  for (let i = 0; i < totalEntries; i += 1) {
    if (buf.readUInt32LE(pos) !== CENTRAL_SIG) throw new Error('malformed central directory');
    const compressionMethod = buf.readUInt16LE(pos + 10);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const uncompressedSize = buf.readUInt32LE(pos + 24);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localHeaderOffset = buf.readUInt32LE(pos + 42);
    const name = buf.toString('utf8', pos + 46, pos + 46 + nameLen);

    // Zip64 per-entry sizes (0xffffffff placeholder + a zip64 extra field)
    // aren't supported — skip rather than misread as a 4GB entry.
    if (compressedSize !== 0xffffffff && uncompressedSize !== 0xffffffff) {
      entries.set(name, { compressionMethod, compressedSize, localHeaderOffset });
    }
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function extractEntry(buf, entry) {
  const pos = entry.localHeaderOffset;
  if (buf.readUInt32LE(pos) !== LOCAL_SIG) throw new Error('malformed local file header');
  const nameLen = buf.readUInt16LE(pos + 26);
  const extraLen = buf.readUInt16LE(pos + 28);
  const dataStart = pos + 30 + nameLen + extraLen;
  const compressed = buf.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.compressionMethod === 0) return Buffer.from(compressed);
  if (entry.compressionMethod === 8) return zlib.inflateRawSync(compressed);
  throw new Error(`unsupported zip compression method ${entry.compressionMethod}`);
}

async function openEpub(filePath) {
  const buf = await fs.readFile(filePath);
  return { buf, entries: readCentralDirectory(buf) };
}

/** Exact match first, then a case-insensitive scan — some conversion tools produce inconsistent entry casing. */
function readEntryText(zip, name) {
  let entry = zip.entries.get(name);
  if (!entry) {
    const lower = name.toLowerCase();
    for (const [key, val] of zip.entries) {
      if (key.toLowerCase() === lower) { entry = val; break; }
    }
  }
  if (!entry) return null;
  try {
    return extractEntry(zip.buf, entry).toString('utf8');
  } catch {
    // Corrupt deflate stream, or a compression method we don't support --
    // most commonly seen in practice from a DRM-encrypted entry masquerading
    // as a normal zip member. Treated the same as "not found": the caller
    // surfaces a clean "couldn't read this ebook" rather than garbage text.
    return null;
  }
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return m ? m[1] : null;
}

function stripTags(s) {
  return s.replace(/<[^>]*>/g, ' ');
}

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function findOpfPath(containerXml) {
  const m = containerXml.match(/<rootfile\b[^>]*full-path\s*=\s*["']([^"']+)["']/i);
  return m ? decodeURIComponent(m[1]) : null;
}

function parseMetadata(opfXml) {
  const titleMatch = opfXml.match(/<dc:title\b[^>]*>([\s\S]*?)<\/dc:title>/i);
  const creatorMatch = opfXml.match(/<dc:creator\b[^>]*>([\s\S]*?)<\/dc:creator>/i);
  return {
    title: titleMatch ? decodeEntities(titleMatch[1]) : '',
    author: creatorMatch ? decodeEntities(creatorMatch[1]) : '',
  };
}

/** id -> { href, mediaType, properties }, hrefs still relative to the OPF's own directory at this point. */
function parseManifest(opfXml) {
  const manifest = new Map();
  const itemRe = /<item\b[^>]*>/gi;
  let m;
  while ((m = itemRe.exec(opfXml))) {
    const tag = m[0];
    const id = attr(tag, 'id');
    const href = attr(tag, 'href');
    if (!id || !href) continue;
    manifest.set(id, {
      href: decodeURIComponent(href),
      mediaType: attr(tag, 'media-type') || '',
      properties: attr(tag, 'properties') || '',
    });
  }
  return manifest;
}

/** Reading-order idrefs, plus the EPUB2 spine@toc attribute (manifest id of the NCX, if present). */
function parseSpine(opfXml) {
  const idrefs = [];
  const itemrefRe = /<itemref\b[^>]*>/gi;
  let m;
  while ((m = itemrefRe.exec(opfXml))) {
    const idref = attr(m[0], 'idref');
    if (idref) idrefs.push(idref);
  }
  const spineTag = opfXml.match(/<spine\b[^>]*>/i);
  return { idrefs, tocId: spineTag ? attr(spineTag[0], 'toc') : null };
}

/** "href#anchor" -> { href, anchor }, both zip-entry-relative-to-their-source-file at this point. */
function splitSrc(src) {
  if (!src) return { href: null, anchor: null };
  const decoded = decodeURIComponent(src);
  const hashIdx = decoded.indexOf('#');
  return hashIdx === -1
    ? { href: decoded, anchor: null }
    : { href: decoded.slice(0, hashIdx), anchor: decoded.slice(hashIdx + 1) };
}

/**
 * EPUB2 table of contents. navPoints nest arbitrarily (Part -> Chapter ->
 * Section) — a single flat regex can't track that, so this tokenizes
 * navPoint open/close tags plus their navLabel text and content src in
 * document order, walking a stack to know current nesting. Only leaf
 * navPoints (no children) become chapters; a parent's own children are what
 * actually represent its subdivisions.
 */
function parseNcx(ncxXml) {
  const tokenRe = /<navPoint\b[^>]*>|<\/navPoint>|<text>([\s\S]*?)<\/text>|<content\b[^>]*>/gi;
  const root = { label: null, src: null, children: [] };
  const stack = [root];
  let m;
  while ((m = tokenRe.exec(ncxXml))) {
    const token = m[0];
    if (token.startsWith('<navPoint')) {
      const node = { label: null, src: null, children: [] };
      stack[stack.length - 1].children.push(node);
      stack.push(node);
    } else if (token === '</navPoint>') {
      if (stack.length > 1) stack.pop();
    } else if (token.startsWith('<text>')) {
      const current = stack[stack.length - 1];
      if (current !== root && current.label === null) current.label = decodeEntities(m[1]);
    } else if (token.startsWith('<content')) {
      const current = stack[stack.length - 1];
      if (current !== root) current.src = attr(token, 'src');
    }
  }

  const leaves = [];
  (function walk(node) {
    if (node.children.length) {
      for (const child of node.children) walk(child);
    } else if (node !== root) {
      leaves.push(node);
    }
  }(root));
  return leaves;
}

/**
 * EPUB3 nav.xhtml table of contents (an <ol>/<li>/<a> tree inside
 * <nav epub:type="toc">). Same leaf-only rule as NCX, approximated without a
 * full nesting stack: in document order, an <a> immediately followed by its
 * own nested <ol> (before the next <a>) is a parent whose children follow it
 * — exclude it and keep only the ones with no nested <ol> after them.
 */
function parseNavXhtml(navXml) {
  const navMatch = navXml.match(/<nav\b[^>]*epub:type\s*=\s*["']toc["'][^>]*>([\s\S]*?)<\/nav>/i)
    || navXml.match(/<nav\b[^>]*>([\s\S]*?)<\/nav>/i);
  if (!navMatch) return [];
  const body = navMatch[1];

  const anchorRe = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const matches = [];
  let m;
  while ((m = anchorRe.exec(body))) {
    matches.push({
      href: decodeURIComponent(m[1]),
      label: decodeEntities(stripTags(m[2])),
      end: anchorRe.lastIndex,
    });
  }

  const leaves = [];
  for (let i = 0; i < matches.length; i += 1) {
    const nextStart = i + 1 < matches.length ? matches[i + 1].end : body.length;
    const between = body.slice(matches[i].end, nextStart);
    if (!/<ol\b/i.test(between)) leaves.push(matches[i]);
  }
  return leaves;
}

/**
 * @param {string} filePath
 * @returns {Promise<{ title: string, author: string, chapters: Array<{index:number,title:string,spineHref:string,anchorId:string|null}>, spineHrefs: string[] }>}
 */
async function readEpubToc(filePath) {
  const zip = await openEpub(filePath);

  const containerXml = readEntryText(zip, 'META-INF/container.xml');
  if (!containerXml) throw new Error('not a valid EPUB (missing META-INF/container.xml)');
  const opfPath = findOpfPath(containerXml);
  if (!opfPath) throw new Error('not a valid EPUB (container.xml has no rootfile)');
  const opfXml = readEntryText(zip, opfPath);
  if (!opfXml) throw new Error('not a valid EPUB (missing OPF file)');
  const opfDir = path.posix.dirname(opfPath);

  const meta = parseMetadata(opfXml);
  const manifest = parseManifest(opfXml);
  const { idrefs, tocId } = parseSpine(opfXml);

  // Manifest hrefs are relative to the OPF's own directory, not the zip root.
  const resolved = new Map();
  for (const [id, item] of manifest) {
    resolved.set(id, { ...item, href: path.posix.normalize(path.posix.join(opfDir, item.href)) });
  }

  const spineHrefs = idrefs.map((id) => resolved.get(id)?.href).filter(Boolean);

  const ncxItem = (tocId && resolved.get(tocId))
    || [...resolved.values()].find((it) => it.mediaType === 'application/x-dtbncx+xml');
  const navItem = [...resolved.values()].find((it) => /\bnav\b/.test(it.properties));

  let tocEntries = null;
  if (ncxItem) {
    const ncxXml = readEntryText(zip, ncxItem.href);
    if (ncxXml) {
      const ncxDir = path.posix.dirname(ncxItem.href);
      tocEntries = parseNcx(ncxXml)
        .map((leaf) => {
          const { href, anchor } = splitSrc(leaf.src);
          return { label: leaf.label || '', href: href ? path.posix.normalize(path.posix.join(ncxDir, href)) : null, anchor };
        })
        .filter((e) => e.href);
    }
  }
  if (!tocEntries?.length && navItem) {
    const navXml = readEntryText(zip, navItem.href);
    if (navXml) {
      const navDir = path.posix.dirname(navItem.href);
      tocEntries = parseNavXhtml(navXml)
        .map((leaf) => {
          const { href, anchor } = splitSrc(leaf.href);
          return { label: leaf.label || '', href: href ? path.posix.normalize(path.posix.join(navDir, href)) : null, anchor };
        })
        .filter((e) => e.href);
    }
  }

  const chapters = tocEntries?.length
    ? tocEntries.map((e, i) => ({ index: i, title: e.label || `Chapter ${i + 1}`, spineHref: e.href, anchorId: e.anchor }))
    : spineHrefs.map((href, i) => ({ index: i, title: `Chapter ${i + 1}`, spineHref: href, anchorId: null }));

  return {
    title: meta.title || path.basename(filePath, path.extname(filePath)),
    author: meta.author || '',
    chapters,
    spineHrefs,
  };
}

/** Raw XHTML for one spine document, keyed by the zip-root-relative href readEpubToc() already resolved. */
async function readEpubSpineHtml(filePath, spineHref) {
  const zip = await openEpub(filePath);
  const html = readEntryText(zip, spineHref);
  if (html === null) throw new Error(`could not read "${spineHref}" from this EPUB`);
  return html;
}

module.exports = { readEpubToc, readEpubSpineHtml };
