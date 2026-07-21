'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');

const { USER_DATA, LIBRARY_FILE, PROGRESS_FILE, BOOKMARKS_FILE, NORMALIZATION_FILE, DATA_ROOT, COVER_CACHE } = require('./paths');

app.setName('Tomelight');

// Must happen before anything touches app paths, otherwise Chromium creates
// its caches under %APPDATA% on C:.
app.setPath('userData', USER_DATA);
app.setPath('sessionData', USER_DATA);

const { JsonStore } = require('./store');
const { scanLibrary } = require('./library');
const { registerScheme, registerMediaProtocol, mediaUrl } = require('./media-protocol');

registerScheme();

const libraryStore = new JsonStore(LIBRARY_FILE, { folders: [], books: [] });
const progressStore = new JsonStore(PROGRESS_FILE, {});
// { [bookId]: Array<{ id, position, label, note, auto, createdAt }> }
const bookmarksStore = new JsonStore(BOOKMARKS_FILE, {});
// { [bookId]: gain } — measured per-book loudness gain (linear multiplier)
const normalizationStore = new JsonStore(NORMALIZATION_FILE, {});

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

  return {
    id: book.id,
    kind: book.kind,
    title: book.title,
    author: book.author,
    narrator: book.narrator,
    year: book.year,
    description: book.description,
    duration: book.duration,
    chapters: book.chapters,
    tracks,
    coverUrl: book.cover ? mediaUrl(book.cover) : null,
    mtimeMs: bookMtime(book),
    fileName: path.basename(book.tracks[0]?.filePath ?? ''),
    trackCount: book.tracks.length,
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
      submenu: [{ label: 'About Tomelight', click: () => openAbout() }],
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

function registerIpc() {
  ipcMain.handle('library:getState', () => currentState());

  ipcMain.handle('library:addFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose your audiobook folder',
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths.length) return currentState();

    const state = libraryStore.get();
    const folders = [...new Set([...state.folders, ...result.filePaths])];
    libraryStore.set({ ...state, folders });
    runScan();
    return currentState();
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

  ipcMain.handle('normalization:save', (_event, { bookId, gain }) => {
    if (typeof bookId !== 'string' || typeof gain !== 'number' || !Number.isFinite(gain)) return;
    const map = { ...normalizationStore.get() };
    map[bookId] = gain;
    normalizationStore.set(map);
  });

  ipcMain.handle('app:revealDataFolder', () => shell.openPath(DATA_ROOT));
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
  await Promise.all([libraryStore.load(), progressStore.load(), bookmarksStore.load(), normalizationStore.load()]);
  if (normalizeCoverPaths(libraryStore.get())) libraryStore.flush();
  registerMediaProtocol(getAllowedRoots);
  registerIpc();
  buildMenu();
  createWindow();

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
});
