'use strict';

const path = require('node:path');
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');

const { USER_DATA, LIBRARY_FILE, PROGRESS_FILE, DATA_ROOT } = require('./paths');

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

let mainWindow = null;
let scanning = false;

function getAllowedRoots() {
  return libraryStore.get().folders ?? [];
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
    fileName: path.basename(book.tracks[0]?.filePath ?? ''),
    trackCount: book.tracks.length,
  };
}

function currentState() {
  const { folders, books } = libraryStore.get();
  return {
    folders,
    books: books.map(toClientBook),
    progress: progressStore.get(),
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
    title: 'Audiobook Player',
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
    const books = state.books.filter((b) => folders.some((f) => b.sourceDir.startsWith(f)));
    libraryStore.set({ folders, books });
    return currentState();
  });

  ipcMain.handle('library:rescan', () => { runScan(); return currentState(); });

  ipcMain.handle('progress:save', (_event, { bookId, position, duration }) => {
    if (typeof bookId !== 'string' || typeof position !== 'number') return;
    const progress = { ...progressStore.get() };
    progress[bookId] = {
      position,
      duration: duration ?? progress[bookId]?.duration ?? 0,
      finished: duration ? position >= duration - 30 : false,
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

  ipcMain.handle('app:revealDataFolder', () => shell.openPath(DATA_ROOT));
}

app.whenReady().then(async () => {
  await Promise.all([libraryStore.load(), progressStore.load()]);
  registerMediaProtocol(getAllowedRoots);
  registerIpc();
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
});
