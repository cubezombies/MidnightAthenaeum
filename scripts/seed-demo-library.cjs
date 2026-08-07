'use strict';

/**
 * Builds a small, entirely-fictional demo library (books + generated cover
 * art + a bit of progress state) in a throwaway data root, for taking
 * marketing/store-listing screenshots without exposing the real ~6,300-book
 * personal library. Does not touch the real MIDNIGHT_ATHENAEUM_DATA_ROOT.
 *
 * Usage: node scripts/seed-demo-library.cjs [dataRoot]
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Jimp = require('jimp');
const { LibraryDb } = require('../src/main/db');

const DATA_ROOT = process.argv[2] || path.join(__dirname, '..', 'demo-data');
const COVER_DIR = path.join(DATA_ROOT, 'covers');
const LIBRARY_DB_FILE = path.join(DATA_ROOT, 'library.db');
const PROGRESS_FILE = path.join(DATA_ROOT, 'progress.json');

const BOOKS = [
  {
    title: 'The Glass Meridian', author: 'Naomi Achterberg', narrator: 'Colin Reyes',
    year: 2019, genre: 'SCIENCE FICTION', kind: 'single', hours: 14.53,
    description: 'A cartographer discovers a border on no map — and someone very interested in keeping it that way.',
  },
  {
    title: 'Ashes of the Coral Court', author: 'Desmond Okafor', narrator: 'Priya Vantage',
    year: 2021, genre: 'FANTASY', kind: 'multi', hours: 21.08,
    description: 'The last free reef-city elects a new archon, and the sea itself objects.',
  },
  {
    title: 'Six Days in Halloway', author: 'Marguerite Costin', narrator: null,
    year: 2016, genre: 'MYSTERY', kind: 'single', hours: 9.8,
    description: 'A retired detective is pulled back for one case: her own disappearance, twenty years ago.',
  },
  {
    title: 'The Quiet Algorithm', author: 'Felix Marrow', narrator: 'Dana Iwu',
    year: 2023, genre: 'TECHNOLOGY', kind: 'single', hours: 7.2,
    description: 'How a small team of engineers accidentally built something that noticed it was being watched.',
  },
  {
    title: 'Windbroken', author: 'R. J. Sandoval', narrator: 'Colin Reyes',
    year: 2018, genre: 'FANTASY', kind: 'multi', hours: 18.33,
    description: 'Book One of the Skytide Cycle. The wind-riders of Kesh have gone silent, all at once.',
  },
  {
    title: '192 Nocturne Ave', author: 'Beatrix Solheim', narrator: 'Priya Vantage',
    year: 2022, genre: 'HORROR', kind: 'single', hours: 6.92,
    description: 'The new tenant only asked one thing of the landlord: never open the third door.',
  },
  {
    title: 'Debts of the Hollow King', author: 'Yusuf Ekwueme', narrator: 'Dana Iwu',
    year: 2020, genre: 'FANTASY', kind: 'multi', hours: 24.67,
    description: 'A kingdom of ledgers and oaths, and one heir who intends to default on all of it.',
  },
  {
    title: 'Paper Moths', author: 'Junko Amari', narrator: null,
    year: 2017, genre: 'LITERARY FICTION', kind: 'single', hours: 8.08,
    description: 'Three sisters, one inherited print shop, and the letters nobody was supposed to keep.',
  },
  {
    title: 'The Second Furnace', author: 'Otto Vance', narrator: 'Priya Vantage',
    year: 2024, genre: 'SCIENCE FICTION', kind: 'single', hours: 11.83,
    description: 'The colony ship\'s reactor has a twin nobody logged — and it just came online.',
  },
  {
    title: 'Recipes for a Small Apocalypse', author: 'Ines Calloway', narrator: 'Dana Iwu',
    year: 2021, genre: 'HUMOR', kind: 'single', hours: 5.58,
    description: 'A field guide to feeding your neighbors through the end of the world, with substitutions.',
  },
  {
    title: 'The Wren and the Wire', author: 'Soraya Delacroix', narrator: 'Colin Reyes',
    year: 2015, genre: 'YOUNG ADULT', kind: 'multi', hours: 10.25,
    description: 'A city runs on captive songbirds. One girl learns to hear what they\'re actually saying.',
  },
  {
    title: 'Ledger of Ash', author: 'Otto Vance', narrator: 'Priya Vantage',
    year: 2025, genre: 'FANTASY', kind: 'single', hours: 19.03,
    description: 'Sequel to The Second Furnace. Every debt the furnace forgot is coming due at once.',
  },
  {
    title: 'Static Hymn', author: 'Malachi Osei', narrator: null,
    year: 2019, genre: 'HORROR', kind: 'single', hours: 8.67,
    description: 'The radio station off Route 9 stopped broadcasting in 1994. It started again last week.',
  },
  {
    title: 'The Understory', author: 'Wren Halvorsen', narrator: 'Dana Iwu',
    year: 2022, genre: 'LITERARY FICTION', kind: 'multi', hours: 12.47,
    description: 'A forester\'s last season, told in the years it takes a canopy to close over a clearing.',
  },
  {
    title: 'Blueprints for Leaving', author: 'Adaeze Nwosu', narrator: 'Colin Reyes',
    year: 2023, genre: 'MEMOIR', kind: 'single', hours: 9.03,
    description: 'A structural engineer\'s memoir of the seven houses she built and the one she couldn\'t leave.',
  },
  {
    title: "The Cormorant's Ledger", author: 'Desmond Okafor', narrator: 'Priya Vantage',
    year: 2023, genre: 'MYSTERY', kind: 'single', hours: 13.73,
    description: 'A companion novel to Ashes of the Coral Court: the harbourmaster\'s own account, finally told.',
  },
];

// A handful of books get progress state, so the grid doesn't read as an
// untouched fresh install — finished, mid-listen, and never-started all
// represented.
const FINISHED_TITLES = new Set(['The Glass Meridian', 'Paper Moths']);
const IN_PROGRESS = new Map([
  ['Ashes of the Coral Court', 0.34],
  ['Debts of the Hollow King', 0.61],
  ['The Second Furnace', 0.12],
]);

// Returns a 0xRRGGBBAA integer -- Jimp's color APIs want a number, not a hex string.
function hslToColor(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const ch = (n) => Math.round(255 * f(n));
  return ((ch(0) << 24) | (ch(8) << 16) | (ch(4) << 8) | 0xff) >>> 0;
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

async function makeCover(book, hue, outFull, outThumb) {
  const W = 480; const H = 720;
  const bg = hslToColor(hue, 42, 22);
  const img = new Jimp(W, H, bg);

  // Bottom gradient so title/author text stays legible over any hue.
  img.scan(0, 0, W, H, (x, y, idx) => {
    if (y < H * 0.45) return;
    const t = (y - H * 0.45) / (H * 0.55);
    const alpha = Math.min(0.65, t * 0.75);
    img.bitmap.data[idx] = img.bitmap.data[idx] * (1 - alpha);
    img.bitmap.data[idx + 1] = img.bitmap.data[idx + 1] * (1 - alpha);
    img.bitmap.data[idx + 2] = img.bitmap.data[idx + 2] * (1 - alpha);
  });

  // Thin frame, a cheap way to make a flat color read as a "cover" rather than a swatch.
  const borderColor = hslToColor(hue, 35, 55);
  for (let x = 20; x < W - 20; x++) {
    img.setPixelColor(borderColor, x, 20);
    img.setPixelColor(borderColor, x, H - 20);
  }
  for (let y = 20; y < H - 20; y++) {
    img.setPixelColor(borderColor, 20, y);
    img.setPixelColor(borderColor, W - 20, y);
  }

  const genreFont = await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE);
  const titleFont = await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE);
  const authorFont = await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE);

  img.print(genreFont, 0, 48, { text: book.genre, alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER }, W);
  img.print(
    titleFont, 40, 280,
    { text: book.title, alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER, alignmentY: Jimp.VERTICAL_ALIGN_MIDDLE },
    W - 80, 220,
  );
  img.print(authorFont, 0, H - 90, { text: book.author.toUpperCase(), alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER }, W);

  await img.writeAsync(outFull);
  await img.clone().resize(240, 360).writeAsync(outThumb);
}

async function main() {
  fs.mkdirSync(COVER_DIR, { recursive: true });
  // Fresh run each time: drop any previous demo DB/covers rather than merging.
  fs.rmSync(LIBRARY_DB_FILE, { force: true });

  const db = new LibraryDb(LIBRARY_DB_FILE);
  await db.load(null);

  const books = [];
  const progress = {};
  const hueStep = 360 / BOOKS.length;

  for (let i = 0; i < BOOKS.length; i++) {
    const b = BOOKS[i];
    const id = crypto.randomUUID();
    const duration = Math.round(b.hours * 3600);
    const slug = slugify(b.title);
    const sourceDir = `D:\\Demo Library\\${b.author}\\${b.title}`;

    const coverFull = path.join(COVER_DIR, `${slug}.png`);
    const coverThumb = path.join(COVER_DIR, `${slug}-thumb.png`);
    // eslint-disable-next-line no-await-in-loop
    await makeCover(b, Math.round(i * hueStep), coverFull, coverThumb);

    const chapterCount = Math.max(1, Math.round(duration / 1800)); // ~30 min/chapter
    const chapters = [];
    const tracks = [];
    if (b.kind === 'multi') {
      const per = duration / chapterCount;
      for (let c = 0; c < chapterCount; c++) {
        const start = Math.round(c * per);
        const end = c === chapterCount - 1 ? duration : Math.round((c + 1) * per);
        const title = `Chapter ${c + 1}`;
        chapters.push({ index: c, title, start, end });
        tracks.push({
          filePath: `${sourceDir}\\${String(c + 1).padStart(2, '0')} - ${title}.mp3`,
          duration: end - start,
          title,
        });
      }
    } else {
      const per = duration / chapterCount;
      for (let c = 0; c < chapterCount; c++) {
        const start = Math.round(c * per);
        const end = c === chapterCount - 1 ? duration : Math.round((c + 1) * per);
        chapters.push({ index: c, title: `Chapter ${c + 1}`, start, end });
      }
      tracks.push({ filePath: `${sourceDir}\\${b.title}.m4b`, duration, title: null });
    }

    books.push({
      id,
      kind: b.kind,
      sourceDir,
      title: b.title,
      author: b.author,
      narrator: b.narrator,
      year: b.year,
      description: b.description,
      duration,
      cover: coverFull,
      coverThumb,
      tracks,
      chapters,
      signature: crypto.randomUUID(),
      dirSig: null,
      detailPending: false,
      detailFailed: false,
      tagsFailed: false,
    });

    if (FINISHED_TITLES.has(b.title)) {
      progress[id] = { position: duration - 10, duration, finished: true, finishedOverride: null, speed: 1, updatedAt: Date.now() };
    } else if (IN_PROGRESS.has(b.title)) {
      const position = Math.round(duration * IN_PROGRESS.get(b.title));
      progress[id] = { position, duration, finished: false, finishedOverride: null, speed: 1, updatedAt: Date.now() };
    }
  }

  db.set({ folders: [], books });
  await db.close();

  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2), 'utf8');

  console.log(`Seeded ${books.length} fake books into ${LIBRARY_DB_FILE}`);
  console.log(`Covers written to ${COVER_DIR}`);
  console.log(`Progress state for ${Object.keys(progress).length} book(s) written to ${PROGRESS_FILE}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
