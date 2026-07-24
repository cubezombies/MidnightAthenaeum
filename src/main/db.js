'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const sqlite3 = require('@vscode/sqlite3');

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS books (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,
  sourceDir     TEXT NOT NULL,
  title         TEXT NOT NULL,
  author        TEXT NOT NULL,
  narrator      TEXT,
  year          INTEGER,
  description   TEXT,
  duration      REAL NOT NULL,
  cover         TEXT,
  tracksJson    TEXT NOT NULL,
  chaptersJson  TEXT NOT NULL,
  signature     TEXT NOT NULL,
  detailPending INTEGER NOT NULL DEFAULT 1,
  detailFailed  INTEGER NOT NULL DEFAULT 0,
  tagsFailed    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_books_sourceDir ON books(sourceDir);
CREATE TABLE IF NOT EXISTS folders (
  path TEXT PRIMARY KEY
);
`;

const UPSERT_SQL = `
INSERT INTO books (id, kind, sourceDir, title, author, narrator, year, description, duration, cover, tracksJson, chaptersJson, signature, detailPending, detailFailed, tagsFailed)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(id) DO UPDATE SET
  kind=excluded.kind, sourceDir=excluded.sourceDir, title=excluded.title, author=excluded.author,
  narrator=excluded.narrator, year=excluded.year, description=excluded.description, duration=excluded.duration,
  cover=excluded.cover, tracksJson=excluded.tracksJson, chaptersJson=excluded.chaptersJson,
  signature=excluded.signature, detailPending=excluded.detailPending, detailFailed=excluded.detailFailed,
  tagsFailed=excluded.tagsFailed
`;

// -- thin promise wrappers around @vscode/sqlite3's callback API --

function openDb(file) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(file, (err) => (err ? reject(err) : resolve(db)));
  });
}

function closeDb(db) {
  return new Promise((resolve, reject) => {
    db.close((err) => (err ? reject(err) : resolve()));
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => (err ? reject(err) : resolve()));
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

function exec(db, sql) {
  return new Promise((resolve, reject) => {
    db.exec(sql, (err) => (err ? reject(err) : resolve()));
  });
}

function rowToBook(row) {
  return {
    id: row.id,
    kind: row.kind,
    sourceDir: row.sourceDir,
    title: row.title,
    author: row.author,
    narrator: row.narrator,
    year: row.year,
    description: row.description,
    duration: row.duration,
    cover: row.cover,
    tracks: JSON.parse(row.tracksJson),
    chapters: JSON.parse(row.chaptersJson),
    signature: row.signature,
    detailPending: Boolean(row.detailPending),
    detailFailed: Boolean(row.detailFailed),
    tagsFailed: Boolean(row.tagsFailed),
  };
}

function bookToParams(book) {
  return [
    book.id, book.kind, book.sourceDir, book.title, book.author,
    book.narrator ?? null, book.year ?? null, book.description ?? null,
    book.duration, book.cover ?? null,
    JSON.stringify(book.tracks ?? []), JSON.stringify(book.chapters ?? []),
    book.signature, book.detailPending ? 1 : 0, book.detailFailed ? 1 : 0, book.tagsFailed ? 1 : 0,
  ];
}

async function runSchema(db) {
  await exec(db, SCHEMA_SQL);
  await run(db, 'PRAGMA journal_mode = DELETE');
  await run(db, 'PRAGMA synchronous = FULL');
  await run(db, 'PRAGMA user_version = 1');
}

/**
 * One-time import of a legacy library.json into a freshly created,
 * still-empty library.db. Verifies the migrated row count before renaming
 * the source file out of the way — never deletes it outright, mirroring
 * this app's established "never destroy data" precedent (reorganize's undo
 * journal, Recycle Bin instead of permanent delete for duplicates).
 */
async function migrateFromJson(db, jsonFile) {
  const raw = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
  const books = Array.isArray(raw.books) ? raw.books : [];
  const folders = Array.isArray(raw.folders) ? raw.folders : [];

  await run(db, 'BEGIN');
  try {
    for (const folder of folders) {
      // eslint-disable-next-line no-await-in-loop
      await run(db, 'INSERT OR IGNORE INTO folders (path) VALUES (?)', [folder]);
    }
    for (const book of books) {
      // eslint-disable-next-line no-await-in-loop
      await run(db, UPSERT_SQL, bookToParams(book));
    }
    await run(db, 'COMMIT');
  } catch (err) {
    await run(db, 'ROLLBACK').catch(() => {});
    throw err;
  }

  const countRow = await get(db, 'SELECT COUNT(*) as n FROM books');
  if (countRow.n !== books.length) {
    throw new Error(`migration row count mismatch: expected ${books.length}, got ${countRow.n}`);
  }

  fs.renameSync(jsonFile, `${jsonFile}.bak`);
  console.log(`[db] migrated ${books.length} book(s) and ${folders.length} folder(s) from ${path.basename(jsonFile)}`);
}

/**
 * SQLite-backed replacement for the old JsonStore(library.json). Keeps the
 * exact same synchronous get()/set() shape JsonStore had — `.get()` always
 * reads from an in-memory cache, `.set()` updates that cache immediately and
 * persists in the background — so every call site elsewhere in the app that
 * relied on synchronous, always-current reads keeps working unchanged. The
 * difference is entirely underneath: `.set()` diffs the incoming books/folders
 * against the cache by object reference (this codebase already hands back the
 * literal same book object when nothing about it changed — see library.js's
 * scan cache-hit path) and only writes the rows that actually changed, instead
 * of JsonStore's old behavior of re-serializing and rewriting every book on
 * every single change.
 */
class LibraryDb {
  #file;
  #db = null;
  #books = new Map();
  #folders = [];
  #writing = Promise.resolve();
  // Accumulates changes since the last successful persist, keyed by id so a
  // book that changes twice before either write lands only needs writing
  // once. Cleared only once a write actually commits -- if it throws, the
  // snapshot taken for that attempt is merged back in (without clobbering
  // anything newer that arrived in the meantime), so a failed write retries
  // on the next opportunity instead of silently vanishing. Without this, a
  // failed write would be invisible: the cache is updated synchronously in
  // set() before the write is even attempted (that's what keeps get()
  // synchronous), so a later set() with the same object would see no diff
  // and never retry it.
  #pendingBooks = new Map();
  #pendingBookDeletes = new Set();
  #pendingFolderAdds = new Set();
  #pendingFolderRemoves = new Set();

  constructor(file) {
    this.#file = file;
  }

  /** Opens (creating if needed) the database, migrating a legacy library.json first if present, then loads everything into the in-memory cache. */
  async load(legacyJsonFile) {
    await fsp.mkdir(path.dirname(this.#file), { recursive: true });

    const isFreshDb = !fs.existsSync(this.#file);
    this.#db = await openDb(this.#file);
    await runSchema(this.#db);

    if (isFreshDb && legacyJsonFile && fs.existsSync(legacyJsonFile)) {
      await migrateFromJson(this.#db, legacyJsonFile);
    }

    const bookRows = await all(this.#db, 'SELECT * FROM books');
    this.#books = new Map(bookRows.map((row) => [row.id, rowToBook(row)]));
    const folderRows = await all(this.#db, 'SELECT path FROM folders');
    this.#folders = folderRows.map((r) => r.path);

    return this.get();
  }

  get() {
    return { folders: this.#folders, books: [...this.#books.values()] };
  }

  /**
   * Diffs `folders`/`books` against the current cache by reference, updates
   * the cache synchronously (so the very next get() sees the change), and
   * queues the actual row writes to run in the background, chained after any
   * writes already in flight so they never interleave out of order.
   */
  set({ folders, books }) {
    if (folders) {
      const oldSet = new Set(this.#folders);
      const newSet = new Set(folders);
      for (const f of folders) {
        if (!oldSet.has(f)) { this.#pendingFolderAdds.add(f); this.#pendingFolderRemoves.delete(f); }
      }
      for (const f of this.#folders) {
        if (!newSet.has(f)) { this.#pendingFolderRemoves.add(f); this.#pendingFolderAdds.delete(f); }
      }
      this.#folders = folders;
    }

    if (books) {
      const nextIds = new Set();
      for (const book of books) {
        nextIds.add(book.id);
        if (this.#books.get(book.id) !== book) {
          this.#pendingBooks.set(book.id, book);
          this.#pendingBookDeletes.delete(book.id);
        }
      }
      for (const id of this.#books.keys()) {
        if (!nextIds.has(id)) {
          this.#pendingBookDeletes.add(id);
          this.#pendingBooks.delete(id);
        }
      }
      this.#books = new Map(books.map((b) => [b.id, b]));
    }

    if (this.#hasPending()) this.#queue(() => this.#drainPending());
  }

  #hasPending() {
    return this.#pendingBooks.size || this.#pendingBookDeletes.size
      || this.#pendingFolderAdds.size || this.#pendingFolderRemoves.size;
  }

  #queue(fn) {
    this.#writing = this.#writing.then(fn).catch((err) => {
      console.error(`[db] write failed for ${this.#file}:`, err.message);
    });
    return this.#writing;
  }

  /**
   * Snapshots and clears the pending sets, attempts to persist them, and on
   * failure merges the snapshot back in -- without overwriting anything
   * newer that arrived for the same id while this attempt was in flight --
   * so the change is retried on the next write instead of being lost.
   */
  async #drainPending() {
    const folderAdds = [...this.#pendingFolderAdds]; this.#pendingFolderAdds.clear();
    const folderRemoves = [...this.#pendingFolderRemoves]; this.#pendingFolderRemoves.clear();
    const bookChanges = [...this.#pendingBooks.values()]; this.#pendingBooks.clear();
    const bookDeletes = [...this.#pendingBookDeletes]; this.#pendingBookDeletes.clear();

    try {
      if (folderAdds.length || folderRemoves.length) await this.#persistFolders(folderAdds, folderRemoves);
      if (bookChanges.length || bookDeletes.length) await this.#persistBooks(bookChanges, bookDeletes);
    } catch (err) {
      for (const f of folderAdds) if (!this.#pendingFolderRemoves.has(f)) this.#pendingFolderAdds.add(f);
      for (const f of folderRemoves) if (!this.#pendingFolderAdds.has(f)) this.#pendingFolderRemoves.add(f);
      for (const b of bookChanges) if (!this.#pendingBooks.has(b.id) && !this.#pendingBookDeletes.has(b.id)) this.#pendingBooks.set(b.id, b);
      for (const id of bookDeletes) if (!this.#pendingBookDeletes.has(id) && !this.#pendingBooks.has(id)) this.#pendingBookDeletes.add(id);
      throw err;
    }
  }

  async #persistFolders(added, removed) {
    for (const folder of added) {
      // eslint-disable-next-line no-await-in-loop
      await run(this.#db, 'INSERT OR IGNORE INTO folders (path) VALUES (?)', [folder]);
    }
    for (const folder of removed) {
      // eslint-disable-next-line no-await-in-loop
      await run(this.#db, 'DELETE FROM folders WHERE path = ?', [folder]);
    }
  }

  async #persistBooks(changed, removed) {
    await run(this.#db, 'BEGIN');
    try {
      for (const book of changed) {
        // eslint-disable-next-line no-await-in-loop
        await run(this.#db, UPSERT_SQL, bookToParams(book));
      }
      for (const id of removed) {
        // eslint-disable-next-line no-await-in-loop
        await run(this.#db, 'DELETE FROM books WHERE id = ?', [id]);
      }
      await run(this.#db, 'COMMIT');
    } catch (err) {
      await run(this.#db, 'ROLLBACK').catch(() => {});
      throw err;
    }
  }

  /** Waits for every write queued so far to finish, first queuing one more attempt if a previous failure left anything pending. */
  flush() {
    if (this.#hasPending()) this.#queue(() => this.#drainPending());
    return this.#writing;
  }

  /** Waits for pending writes, then closes the file handle (needed before the file can be moved, e.g. File > Change library location). */
  async close() {
    await this.flush();
    if (this.#db) {
      await closeDb(this.#db);
      this.#db = null;
    }
  }
}

module.exports = { LibraryDb };
