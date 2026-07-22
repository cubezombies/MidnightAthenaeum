'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');

const {
  USER_DATA, LIBRARY_FILE, PROGRESS_FILE, BOOKMARKS_FILE, NORMALIZATION_FILE,
  METADATA_FILE, DATA_ROOT, COVER_CACHE, ONLINE_COVER_CACHE, BACKUP_DIR,
} = require('./paths');

app.setName('Tomelight');

// Must happen before anything touches app paths, otherwise Chromium creates
// its caches under %APPDATA% on C:.
app.setPath('userData', USER_DATA);
app.setPath('sessionData', USER_DATA);

const { JsonStore } = require('./store');
const { scanLibrary } = require('./library');
const { registerScheme, registerMediaProtocol, mediaUrl } = require('./media-protocol');
const { searchOpenLibrary, fetchWorkDescription, downloadCover } = require('./metadata-lookup');
const updater = require('./updater');

registerScheme();

const libraryStore = new JsonStore(LIBRARY_FILE, { folders: [], books: [] });
const progressStore = new JsonStore(PROGRESS_FILE, {});
// { [bookId]: Array<{ id, position, label, note, auto, createdAt }> }
const bookmarksStore = new JsonStore(BOOKMARKS_FILE, {});
// { [bookId]: gain } — measured per-book loudness gain (linear multiplier)
const normalizationStore = new JsonStore(NORMALIZATION_FILE, {});
// { [bookId]: { title, author, description, hasCover, source, sourceKey, fetchedAt } }
// User-applied corrections from the online metadata lookup; merged on top of
// the scanned tags in toClientBook(). Never written by anything but the
// metadata:apply / metadata:clear handlers below — no automatic lookups.
const metadataStore = new JsonStore(METADATA_FILE, {});

let mainWindow = null;
let scanning = false;

function getAllowedRoots() {
  return libraryStore.get().folders ?? [];
}

/**
 * Path-boundary-safe "is this book under this library folder" check. A naive
 * `sourceDir.startsWith(folder)` would wrongly match "E:\Books\Fan" against a
 * book under "E:\Books\Fantasy" — require an exact match or a following
 * separator. Case-insensitive to match Windows path semantics.
 */
function isUnderFolder(sourceDir, folder) {
  const a = sourceDir.toLowerCase();
  const b = folder.toLowerCase();
  return a === b || a.startsWith(b.endsWith(path.sep) ? b : b + path.sep);
}

/** Newest file mtime for a book, pulled from its cache signature ("path:mtime:size|…"). */
function bookMtime(book) {
  if (!book.signature) return 0;
  let max = 0;
  for (const seg of book.signature.split('|')) {
    const parts = seg.split(':'); // paths contain colons; mtime/size are the last two
    const mtime = Number(parts[parts.length - 2]);
    if (mtime > max) max = mtime;
  }
  return max;
}

/** Books carry absolute paths; the renderer only ever sees ab-media:// URLs. */
function onlineCoverPath(bookId) {
  return path.join(ONLINE_COVER_CACHE, `${bookId}.jpg`);
}

function toClientBook(book) {
  let elapsed = 0;
  const tracks = book.tracks.map((track) => {
    const entry = {
      url: mediaUrl(track.filePath),
      title: track.title,
      duration: track.duration,
      offset: elapsed,
    };
    elapsed += track.duration;
    return entry;
  });

  // A user-applied online correction wins over the scanned tags for these
  // fields. chapters/duration/tracks always come from the real audio file —
  // an online source has no idea where this specific rip's chapters fall.
  const override = metadataStore.get()[book.id];
  const cover = override?.hasCover ? onlineCoverPath(book.id) : book.cover;

  return {
    id: book.id,
    kind: book.kind,
    title: override?.title || book.title,
    author: override?.author || book.author,
    narrator: book.narrator,
    year: book.year,
    description: override?.description || book.description,
    duration: book.duration,
    chapters: book.chapters,
    tracks,
    coverUrl: cover ? mediaUrl(cover) : null,
    mtimeMs: bookMtime(book),
    fileName: path.basename(book.tracks[0]?.filePath ?? ''),
    trackCount: book.tracks.length,
    metadataSource: override?.source ?? null,
    metadataFetchedAt: override?.fetchedAt ?? null,
  };
}

/** How many scanned books live under each library folder, for the folders UI. */
function folderBookCounts(folders, books) {
  const counts = {};
  for (const folder of folders) {
    counts[folder] = books.filter((b) => isUnderFolder(b.sourceDir, folder)).length;
  }
  return counts;
}

function currentState() {
  const { folders, books } = libraryStore.get();
  return {
    folders,
    folderCounts: folderBookCounts(folders, books),
    books: books.map(toClientBook),
    progress: progressStore.get(),
    bookmarks: bookmarksStore.get(),
    normalization: normalizationStore.get(),
    scanning,
  };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 940,
    minHeight: 600,
    backgroundColor: '#12121a',
    title: 'Tomelight',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.ico'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Keep external links out of the app window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

let aboutWindow = null;

/** A small window showing the logo, version and links. */
function openAbout() {
  if (aboutWindow) { aboutWindow.focus(); return; }

  aboutWindow = new BrowserWindow({
    width: 520,
    height: 520,
    resizable: false,
    minimizable: false,
    maximizable: false,
    parent: mainWindow ?? undefined,
    modal: Boolean(mainWindow),
    backgroundColor: '#12121a',
    title: 'About Tomelight',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  aboutWindow.setMenu(null);
  aboutWindow.loadFile(
    path.join(__dirname, '..', 'renderer', 'about.html'),
    { query: { v: app.getVersion() } },
  );
  aboutWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  aboutWindow.on('closed', () => { aboutWindow = null; });
}

/**
 * Bundle progress, bookmarks, normalization gains, and online-metadata
 * overrides into one JSON file and let the user choose where to save it —
 * insurance against the data folder being deleted or corrupted. A single JSON
 * envelope rather than a zip: these are small plain-object stores already
 * held in memory, so wrapping them in one object needs no archive library and
 * stays human-inspectable. Cached cover images themselves aren't included —
 * they're re-fetchable, and embedding binary data would turn this from a
 * readable JSON file into an opaque blob.
 */
async function createBackup() {
  if (!mainWindow) return;

  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  } catch {
    // Best effort — the save dialog still works even if this default doesn't exist.
  }

  const dateStr = new Date().toISOString().slice(0, 10);
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Backup Tomelight data',
    defaultPath: path.join(BACKUP_DIR, `tomelight-backup-${dateStr}.json`),
    filters: [{ name: 'Tomelight Backup', extensions: ['json'] }],
  });
  if (canceled || !filePath) return;

  const bundle = {
    app: 'Tomelight',
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    progress: progressStore.get(),
    bookmarks: bookmarksStore.get(),
    normalization: normalizationStore.get(),
    metadata: metadataStore.get(),
  };

  try {
    fs.writeFileSync(filePath, JSON.stringify(bundle, null, 2), 'utf8');
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      message: 'Backup saved',
      detail: `Progress, bookmarks, normalization, and online-metadata data were saved to:\n${filePath}`,
    });
  } catch (err) {
    dialog.showErrorBox('Backup failed', err.message);
  }
}

/**
 * Restore progress/bookmarks/normalization from a previously created backup.
 * Reads and validates the file first, then confirms via a native dialog before
 * overwriting anything — this replaces current data and cannot be undone, so it
 * gets the same confirm-before-destroy treatment as removing a library folder.
 */
async function restoreBackup() {
  if (!mainWindow) return;

  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Restore Tomelight data from backup',
    defaultPath: BACKUP_DIR,
    properties: ['openFile'],
    filters: [{ name: 'Tomelight Backup', extensions: ['json'] }],
  });
  if (canceled || !filePaths.length) return;

  let bundle;
  try {
    bundle = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
  } catch (err) {
    dialog.showErrorBox('Restore failed', `Could not read that file as a backup:\n${err.message}`);
    return;
  }

  const isValid = bundle && bundle.app === 'Tomelight'
    && bundle.progress && typeof bundle.progress === 'object'
    && bundle.bookmarks && typeof bundle.bookmarks === 'object'
    && bundle.normalization && typeof bundle.normalization === 'object';
  if (!isValid) {
    dialog.showErrorBox('Restore failed', 'That file does not look like a Tomelight backup.');
    return;
  }
  // Backups made before the online-metadata feature shipped won't have this
  // field — treat it as "no overrides" rather than rejecting the whole backup.
  const metadata = bundle.metadata && typeof bundle.metadata === 'object' ? bundle.metadata : {};

  const bookCount = Object.keys(bundle.progress).length;
  const bookmarkCount = Object.values(bundle.bookmarks)
    .reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0);
  const normCount = Object.keys(bundle.normalization).length;
  const metadataCount = Object.keys(metadata).length;
  const when = bundle.exportedAt ? new Date(bundle.exportedAt).toLocaleString() : 'an unknown time';

  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Cancel', 'Restore'],
    defaultId: 0,
    cancelId: 0,
    message: 'Restore from this backup?',
    detail:
      `This backup was made ${when} and contains progress for ${bookCount} book(s), `
      + `${bookmarkCount} bookmark(s), normalization data for ${normCount} book(s), and `
      + `${metadataCount} online-metadata override(s).\n\n`
      + 'Restoring will REPLACE your current progress, bookmarks, normalization, and '
      + 'online-metadata data. This cannot be undone. Cached cover images from online '
      + 'overrides are not part of the backup and will be re-downloaded on next lookup '
      + 'if missing.',
  });
  if (response !== 1) return;

  progressStore.set(bundle.progress);
  bookmarksStore.set(bundle.bookmarks);
  normalizationStore.set(bundle.normalization);
  metadataStore.set(metadata);
  progressStore.flushSync();
  bookmarksStore.flushSync();
  normalizationStore.flushSync();
  metadataStore.flushSync();

  mainWindow.webContents.send('library:changed', currentState());
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    message: 'Backup restored',
    detail: `Restored progress for ${bookCount} book(s), ${bookmarkCount} bookmark(s), `
      + `normalization data for ${normCount} book(s), and ${metadataCount} online-metadata `
      + 'override(s).',
  });
}

/**
 * Replace Electron's default menu (Reload, DevTools, Zoom, sample Help links…)
 * with a small app-focused one. Edit is kept so copy/paste works in the search
 * box and bookmark notes.
 */
function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'Open data folder', click: () => shell.openPath(DATA_ROOT) },
        { type: 'separator' },
        { label: 'Backup data…', click: () => createBackup() },
        { label: 'Restore from backup…', click: () => restoreBackup() },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [{ role: 'togglefullscreen' }],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Check for Updates…',
          click: () => mainWindow?.webContents.send('updates:open'),
        },
        { type: 'separator' },
        { label: 'About Tomelight', click: () => openAbout() },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function runScan() {
  if (scanning) return;
  const state = libraryStore.get();
  if (!state.folders.length) {
    libraryStore.set({ ...state, books: [] });
    mainWindow?.webContents.send('library:changed', currentState());
    return;
  }

  scanning = true;
  mainWindow?.webContents.send('library:scan-progress', { done: 0, total: 0, scanning: true });

  try {
    const books = await scanLibrary(state.folders, state.books, (done, total) => {
      mainWindow?.webContents.send('library:scan-progress', { done, total, scanning: true });
    });
    libraryStore.set({ ...libraryStore.get(), books });
  } catch (err) {
    console.error('[scan] failed:', err);
    dialog.showErrorBox('Scan failed', err.message);
  } finally {
    scanning = false;
    mainWindow?.webContents.send('library:scan-progress', { done: 0, total: 0, scanning: false });
    mainWindow?.webContents.send('library:changed', currentState());
  }
}

/**
 * Merge candidate paths into the library's folder list and rescan. Filters to
 * paths that are actually directories — the drag-and-drop path in particular
 * can hand this individual files rather than a folder, and validating here
 * (rather than trusting the renderer) matches how the rest of the app treats
 * anything from the renderer as untrusted input.
 *
 * @returns the number of new directories actually added
 */
function addFoldersToLibrary(paths) {
  const dirs = paths.filter((p) => {
    try {
      return fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  });
  if (!dirs.length) return 0;

  const state = libraryStore.get();
  const before = state.folders.length;
  const folders = [...new Set([...state.folders, ...dirs])];
  libraryStore.set({ ...state, folders });
  if (folders.length > before) runScan();
  return folders.length - before;
}

function registerIpc() {
  ipcMain.handle('library:getState', () => currentState());

  ipcMain.handle('library:addFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose your audiobook folder',
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths.length) return currentState();
    addFoldersToLibrary(result.filePaths);
    return currentState();
  });

  // Drag-and-drop a folder onto the window. The renderer resolves each
  // dropped item's real filesystem path via webUtils.getPathForFile in
  // preload (File.path was removed from the renderer for security), so this
  // just validates and adds them — no dialog needed, the drop already picked.
  ipcMain.handle('library:addFolderPaths', (_event, paths) => {
    const candidates = Array.isArray(paths) ? paths.filter((p) => typeof p === 'string' && p) : [];
    const added = addFoldersToLibrary(candidates);
    return { state: currentState(), attempted: candidates.length, added };
  });

  ipcMain.handle('library:removeFolder', (_event, folder) => {
    const state = libraryStore.get();
    const folders = state.folders.filter((f) => f !== folder);
    const books = state.books.filter((b) => folders.some((f) => isUnderFolder(b.sourceDir, f)));
    libraryStore.set({ folders, books });
    return currentState();
  });

  ipcMain.handle('library:rescan', () => { runScan(); return currentState(); });

  ipcMain.handle('progress:save', (_event, { bookId, position, duration, speed }) => {
    if (typeof bookId !== 'string' || typeof position !== 'number') return;
    const progress = { ...progressStore.get() };
    progress[bookId] = {
      position,
      duration: duration ?? progress[bookId]?.duration ?? 0,
      finished: duration ? position >= duration - 30 : false,
      // A manual finished/unfinished mark (below) must survive routine
      // playback saves, which happen every few seconds — carry it forward
      // rather than letting it get silently overwritten mid-listen.
      finishedOverride: progress[bookId]?.finishedOverride ?? null,
      speed: speed ?? progress[bookId]?.speed ?? 1,
      updatedAt: Date.now(),
    };
    progressStore.set(progress);
  });

  ipcMain.handle('progress:clear', (_event, bookId) => {
    const progress = { ...progressStore.get() };
    delete progress[bookId];
    progressStore.set(progress);
    return progress;
  });

  /**
   * Manually force (or clear) a book's finished status, independent of the
   * auto-computed value from position/duration -- covers "I finished this
   * elsewhere" (no listening progress here at all) and "I DNF'd this, get it
   * out of In Progress" alike. `finished` is true, false, or null to go back
   * to letting position/duration decide. Creates a progress record if the
   * book has none yet, since marking a never-opened book finished is a real
   * use case.
   */
  ipcMain.handle('progress:setFinished', (_event, { bookId, finished }) => {
    if (typeof bookId !== 'string') return progressStore.get();
    const progress = { ...progressStore.get() };
    const existing = progress[bookId];
    progress[bookId] = {
      position: existing?.position ?? 0,
      duration: existing?.duration ?? 0,
      finished: existing?.finished ?? false,
      finishedOverride: finished,
      speed: existing?.speed ?? 1,
      updatedAt: Date.now(),
    };
    progressStore.set(progress);
    return progress;
  });

  ipcMain.handle('bookmarks:add', (_event, { bookId, position, label, note, auto }) => {
    if (typeof bookId !== 'string' || typeof position !== 'number') return bookmarksStore.get();
    const map = { ...bookmarksStore.get() };
    const list = [...(map[bookId] ?? [])];

    const bookmark = {
      id: crypto.randomUUID(),
      position,
      label: (label ?? '').toString().slice(0, 200),
      note: (note ?? '').toString().slice(0, 2000),
      auto: Boolean(auto),
      createdAt: Date.now(),
    };

    if (auto) {
      // Keep a single rolling "last stop" marker rather than flooding the list.
      const kept = list.filter((b) => !b.auto);
      kept.push(bookmark);
      map[bookId] = kept;
    } else {
      list.push(bookmark);
      map[bookId] = list;
    }

    bookmarksStore.set(map);
    return map;
  });

  ipcMain.handle('bookmarks:update', (_event, { bookId, id, label, note }) => {
    const map = { ...bookmarksStore.get() };
    const list = map[bookId];
    if (!list) return map;
    map[bookId] = list.map((b) => {
      if (b.id !== id) return b;
      // Editing a bookmark makes it permanent (no longer the auto "last stop").
      return {
        ...b,
        label: label !== undefined ? label.toString().slice(0, 200) : b.label,
        note: note !== undefined ? note.toString().slice(0, 2000) : b.note,
        auto: false,
      };
    });
    bookmarksStore.set(map);
    return map;
  });

  ipcMain.handle('bookmarks:remove', (_event, { bookId, id }) => {
    const map = { ...bookmarksStore.get() };
    if (map[bookId]) {
      map[bookId] = map[bookId].filter((b) => b.id !== id);
      if (!map[bookId].length) delete map[bookId];
      bookmarksStore.set(map);
    }
    return map;
  });

  /**
   * Re-insert a specific, previously-existing bookmark object as-is (same id,
   * label, note, createdAt) — the "Undo" side of bookmarks:remove. Distinct
   * from bookmarks:add, which always mints a fresh id/createdAt for a new one.
   */
  ipcMain.handle('bookmarks:restore', (_event, { bookId, bookmark }) => {
    if (typeof bookId !== 'string' || !bookmark || typeof bookmark.id !== 'string') {
      return bookmarksStore.get();
    }
    const map = { ...bookmarksStore.get() };
    const list = map[bookId] ? [...map[bookId]] : [];
    if (!list.some((b) => b.id === bookmark.id)) list.push(bookmark);
    map[bookId] = list;
    bookmarksStore.set(map);
    return map;
  });

  ipcMain.handle('normalization:save', (_event, { bookId, gain }) => {
    if (typeof bookId !== 'string' || typeof gain !== 'number' || !Number.isFinite(gain)) return;
    const map = { ...normalizationStore.get() };
    map[bookId] = gain;
    normalizationStore.set(map);
  });

  ipcMain.handle('app:revealDataFolder', () => shell.openPath(DATA_ROOT));
  ipcMain.handle('app:getVersion', () => app.getVersion());

  ipcMain.handle('updates:check', () => updater.checkForUpdates());
  ipcMain.handle('updates:install', () => updater.quitAndInstall());

  ipcMain.handle('metadata:search', async (_event, query) => searchOpenLibrary(query));

  // Full description for one picked candidate — fetched only when the user
  // selects a search result, not for every row in the results list.
  ipcMain.handle('metadata:preview', async (_event, key) => fetchWorkDescription(key));

  /**
   * Apply a picked candidate as this book's override. The cover is downloaded
   * before the override record is written, so a book is never left pointing at
   * a cover file that doesn't exist yet.
   */
  ipcMain.handle('metadata:apply', async (_event, payload) => {
    const { bookId, title, author, description, coverId, source, sourceKey } = payload ?? {};
    if (typeof bookId !== 'string' || !bookId) return currentState();

    let hasCover = false;
    if (coverId) {
      const dl = await downloadCover(coverId, onlineCoverPath(bookId));
      hasCover = dl.ok && dl.downloaded;
    }

    const map = { ...metadataStore.get() };
    map[bookId] = {
      title: (title ?? '').toString().slice(0, 500),
      author: (author ?? '').toString().slice(0, 500),
      description: (description ?? '').toString().slice(0, 10_000),
      hasCover,
      source: source ?? 'openlibrary',
      sourceKey: sourceKey ?? null,
      fetchedAt: Date.now(),
    };
    metadataStore.set(map);
    return currentState();
  });

  /** Revert a book to its scanned file tags, dropping the online override. */
  ipcMain.handle('metadata:clear', (_event, bookId) => {
    if (typeof bookId !== 'string') return currentState();
    const map = { ...metadataStore.get() };
    if (map[bookId]) {
      delete map[bookId];
      metadataStore.set(map);
      try {
        const cached = onlineCoverPath(bookId);
        if (fs.existsSync(cached)) fs.unlinkSync(cached);
      } catch {
        // Best effort — a leftover cached cover file isn't worth surfacing an error for.
      }
    }
    return currentState();
  });
}

/**
 * Extracted covers live in COVER_CACHE, but the library file stores their
 * absolute paths. If the data root moves (e.g. a rename), those paths point at
 * the old location and every cover 404s. Repoint any cover that sits in a
 * `covers` folder other than the current cache, so a move self-heals.
 */
function normalizeCoverPaths(libraryState) {
  let changed = 0;
  for (const book of libraryState.books ?? []) {
    if (!book.cover) continue;
    const dir = path.dirname(book.cover);
    if (path.basename(dir).toLowerCase() === 'covers' && dir !== COVER_CACHE) {
      const moved = path.join(COVER_CACHE, path.basename(book.cover));
      if (fs.existsSync(moved)) { book.cover = moved; changed += 1; }
    }
  }
  if (changed) console.log(`[library] repointed ${changed} cover paths to ${COVER_CACHE}`);
  return changed > 0;
}

app.whenReady().then(async () => {
  await Promise.all([
    libraryStore.load(), progressStore.load(), bookmarksStore.load(),
    normalizationStore.load(), metadataStore.load(),
  ]);
  if (normalizeCoverPaths(libraryStore.get())) libraryStore.flush();
  registerMediaProtocol(getAllowedRoots);
  registerIpc();
  buildMenu();
  createWindow();
  updater.setStatusSink((status) => mainWindow?.webContents.send('update:status', status));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Pick up files added outside the app since last launch.
  if (libraryStore.get().folders.length) runScan();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  libraryStore.flushSync();
  progressStore.flushSync();
  bookmarksStore.flushSync();
  normalizationStore.flushSync();
  metadataStore.flushSync();
});
