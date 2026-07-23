'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');

const {
  USER_DATA, LIBRARY_FILE, PROGRESS_FILE, BOOKMARKS_FILE, NORMALIZATION_FILE,
  METADATA_FILE, DATA_ROOT, OS_DEFAULT_ROOT, COVER_CACHE, ONLINE_COVER_CACHE, BACKUP_DIR,
  setDataLocation, clearDataLocation,
} = require('./paths');
const { isFinishedByPosition } = require('./finished');

app.setName('Midnight Athenaeum');
// Matches build.appId in package.json — keeps the taskbar jump list, thumbbar
// grouping, and shortcut identity consistent with what the installer registers.
app.setAppUserModelId('com.cubezombies.midnightathenaeum');

// A jump-list click launches a *second* process with --open-book=<id>; without
// this, that would open a confusing second window instead of focusing the
// running one. The doomed second instance exits immediately, before any of
// the setup below (store creation, window creation) runs.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// Chromium doesn't create this directory itself — it just writes into
// whatever setPath points at, and fails silently-ish (DevToolsActivePort
// write errors, likely worse elsewhere) if it doesn't exist yet. Only shows
// up on a genuinely fresh machine; the previous hardcoded dev path had
// existed on disk for years, masking this. Must happen before setPath below.
fs.mkdirSync(USER_DATA, { recursive: true });

// Redirect userData off the OS default so a rescan or config change isn't
// tied to wherever Electron would otherwise put it.
app.setPath('userData', USER_DATA);
app.setPath('sessionData', USER_DATA);

const { JsonStore } = require('./store');
const { scanLibrary } = require('./library');
const { registerScheme, registerMediaProtocol, mediaUrl } = require('./media-protocol');
const { searchOpenLibrary, fetchWorkDescription, downloadCover } = require('./metadata-lookup');
const updater = require('./updater');
const taskbar = require('./taskbar');

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

// Set when the app is launched (or re-launched, via second-instance) from a
// jump-list "Continue Listening" click; consumed once via app:getInitialOpenBook.
let initialOpenBookId = taskbar.bookIdFromArgv(process.argv);

function sendMediaControl(action) {
  mainWindow?.webContents.send('media:control', action);
}

/**
 * Minimal id/title/author list for the jump list — deliberately not
 * `currentState().books`, which runs every book through `toClientBook`
 * (per-track mapping, mediaUrl encoding, cover resolution) plus
 * `folderBookCounts` just to feed a list that only ever shows the 8 most
 * recently played books. This is called on every progress save (every few
 * seconds during playback), so it needs to stay cheap regardless of library
 * size — `taskbar.updateJumpList` itself already skips the actual Shell call
 * when the top-8 order hasn't changed.
 */
function jumpListBooks() {
  const overrides = metadataStore.get();
  return libraryStore.get().books.map((b) => {
    const o = overrides[b.id];
    return { id: b.id, title: o?.title || b.title, author: o?.author || b.author };
  });
}

function refreshJumpList() {
  taskbar.updateJumpList(jumpListBooks(), progressStore.get());
}

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
    title: 'Midnight Athenaeum',
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
    height: 580,
    resizable: false,
    minimizable: false,
    maximizable: false,
    parent: mainWindow ?? undefined,
    modal: Boolean(mainWindow),
    backgroundColor: '#12121a',
    title: 'About Midnight Athenaeum',
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
    title: 'Backup Midnight Athenaeum data',
    defaultPath: path.join(BACKUP_DIR, `midnight-athenaeum-backup-${dateStr}.json`),
    filters: [{ name: 'Midnight Athenaeum Backup', extensions: ['json'] }],
  });
  if (canceled || !filePath) return;

  const bundle = {
    app: 'Midnight Athenaeum',
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
    title: 'Restore Midnight Athenaeum data from backup',
    defaultPath: BACKUP_DIR,
    properties: ['openFile'],
    filters: [{ name: 'Midnight Athenaeum Backup', extensions: ['json'] }],
  });
  if (canceled || !filePaths.length) return;

  let bundle;
  try {
    bundle = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
  } catch (err) {
    dialog.showErrorBox('Restore failed', `Could not read that file as a backup:\n${err.message}`);
    return;
  }

  // 'Tomelight' is this app's old name (renamed pre-1.0) — still accepted so
  // a backup made before the rename isn't stranded.
  const isValid = bundle && (bundle.app === 'Midnight Athenaeum' || bundle.app === 'Tomelight')
    && bundle.progress && typeof bundle.progress === 'object'
    && bundle.bookmarks && typeof bundle.bookmarks === 'object'
    && bundle.normalization && typeof bundle.normalization === 'object';
  if (!isValid) {
    dialog.showErrorBox('Restore failed', 'That file does not look like a Midnight Athenaeum backup.');
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

/** Files/folders this app actually owns under DATA_ROOT — deliberately not `userData` (Chromium's own profile/cache), which stays behind and is safe to lose: it only holds renderer localStorage (theme, sort, etc.), not library data, and moving it while its own process still has it open is asking for trouble. */
function ownDataEntries() {
  return [LIBRARY_FILE, PROGRESS_FILE, BOOKMARKS_FILE, NORMALIZATION_FILE, METADATA_FILE, COVER_CACHE, ONLINE_COVER_CACHE]
    .filter((p) => fs.existsSync(p));
}

/** Move one entry, falling back to copy+delete across drives where rename() can't work atomically. */
async function moveEntry(src, dest) {
  try {
    await fsp.rename(src, dest);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    await fsp.cp(src, dest, { recursive: true });
    await fsp.rm(src, { recursive: true, force: true });
  }
}

/**
 * File > Change library location… Lets any user move off the default
 * %APPDATA% location (e.g. onto a drive with more room) without needing an
 * environment variable — this is also the supported way to point the app at
 * an existing data folder (e.g. one shared between machines or restored from
 * elsewhere), which is why the two cases below behave differently.
 */
async function changeDataLocation() {
  if (!mainWindow) return;
  if (scanning) {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      message: 'Wait for the current scan to finish first.',
    });
    return;
  }

  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a folder for your Midnight Athenaeum data',
    defaultPath: path.dirname(DATA_ROOT),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (canceled || !filePaths.length) return;

  const target = filePaths[0];
  if (path.resolve(target) === path.resolve(DATA_ROOT)) return;

  const hasExistingData = fs.existsSync(path.join(target, 'library.json'));

  const { response } = hasExistingData
    ? await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['Cancel', 'Use this folder'],
      defaultId: 1,
      cancelId: 0,
      message: 'Use the existing Midnight Athenaeum data found here?',
      detail: `${target}\n\nalready has a library. Midnight Athenaeum will switch to it and `
        + 'restart. Your current data stays exactly where it is, untouched — it just stops '
        + 'being the active one.',
    })
    : await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['Cancel', 'Move my data here'],
      defaultId: 1,
      cancelId: 0,
      message: 'Move your Midnight Athenaeum data to this folder?',
      detail: `Your library index, progress, bookmarks, and cached covers will move from:\n${DATA_ROOT}\n\n`
        + `to:\n${target}\n\nMidnight Athenaeum will restart once the move is done.`,
    });
  if (response !== 1) return;

  if (!hasExistingData) {
    libraryStore.flushSync();
    progressStore.flushSync();
    bookmarksStore.flushSync();
    normalizationStore.flushSync();
    metadataStore.flushSync();
    try {
      await fsp.mkdir(target, { recursive: true });
      for (const src of ownDataEntries()) {
        await moveEntry(src, path.join(target, path.basename(src)));
      }
    } catch (err) {
      dialog.showErrorBox('Move failed', `Could not move your data to the new location:\n${err.message}`);
      return;
    }
  }

  setDataLocation(target);
  app.relaunch();
  app.exit(0);
}

/** File > Reset library location to default — back to %APPDATA%, undoing changeDataLocation(). */
async function resetDataLocation() {
  if (!mainWindow) return;
  if (path.resolve(DATA_ROOT) === path.resolve(OS_DEFAULT_ROOT)) {
    dialog.showMessageBox(mainWindow, { type: 'info', message: 'Already using the default location.' });
    return;
  }
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['Cancel', 'Reset'],
    defaultId: 1,
    cancelId: 0,
    message: 'Reset library location to the default?',
    detail: `Midnight Athenaeum will restart and look for its data at the standard location `
      + `instead of:\n${DATA_ROOT}\n\nNothing at the current location is moved or deleted.`,
  });
  if (response !== 1) return;
  clearDataLocation();
  app.relaunch();
  app.exit(0);
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
        { label: 'Change library location…', click: () => changeDataLocation() },
        { label: 'Reset library location to default', click: () => resetDataLocation() },
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
      submenu: [
        { role: 'togglefullscreen' },
        { type: 'separator' },
        // Electron's default menu (which this replaces) is what normally wires
        // Ctrl+Shift+I/F12 to DevTools — without this role somewhere in the
        // custom menu, that shortcut is simply unregistered, not just hidden.
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Check for Updates…',
          click: () => mainWindow?.webContents.send('updates:open'),
        },
        { type: 'separator' },
        { label: 'About Midnight Athenaeum', click: () => openAbout() },
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
    refreshJumpList(); // a removed/renamed book could be sitting in the list
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
    if (typeof folder !== 'string' || !folder) return currentState();
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
      finished: isFinishedByPosition(position, duration),
      // A manual finished/unfinished mark (below) must survive routine
      // playback saves, which happen every few seconds — carry it forward
      // rather than letting it get silently overwritten mid-listen.
      finishedOverride: progress[bookId]?.finishedOverride ?? null,
      speed: speed ?? progress[bookId]?.speed ?? 1,
      updatedAt: Date.now(),
    };
    progressStore.set(progress);
    refreshJumpList();
  });

  ipcMain.handle('progress:clear', (_event, bookId) => {
    const progress = { ...progressStore.get() };
    delete progress[bookId];
    progressStore.set(progress);
    refreshJumpList();
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
    refreshJumpList();
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

  ipcMain.handle('bookmarks:update', (_event, { bookId, id, label, note } = {}) => {
    if (typeof bookId !== 'string' || typeof id !== 'string') return bookmarksStore.get();
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

  ipcMain.handle('bookmarks:remove', (_event, { bookId, id } = {}) => {
    if (typeof bookId !== 'string' || typeof id !== 'string') return bookmarksStore.get();
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

  ipcMain.handle('metadata:search', async (_event, query) => {
    if (typeof query !== 'string') return { ok: false, error: 'Invalid search query.' };
    return searchOpenLibrary(query);
  });

  // Full description for one picked candidate — fetched only when the user
  // selects a search result, not for every row in the results list.
  ipcMain.handle('metadata:preview', async (_event, key) => {
    if (typeof key !== 'string') return { ok: true, description: '' };
    return fetchWorkDescription(key);
  });

  /** The single client-shaped book, for handlers that only changed one. */
  function clientBookById(bookId) {
    const raw = libraryStore.get().books.find((b) => b.id === bookId);
    return raw ? toClientBook(raw) : null;
  }

  /**
   * Apply a picked candidate as this book's override. The cover is downloaded
   * before the override record is written, so a book is never left pointing at
   * a cover file that doesn't exist yet.
   *
   * Returns just the one changed book rather than `currentState()` — only its
   * title/author/description/cover could have changed, so there's no reason to
   * re-map and re-transmit the whole library over IPC for this.
   */
  ipcMain.handle('metadata:apply', async (_event, payload) => {
    const { bookId, title, author, description, coverId, source, sourceKey } = payload ?? {};
    if (typeof bookId !== 'string' || !bookId) return { book: null };

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
    refreshJumpList(); // title/author may have just changed
    return { book: clientBookById(bookId) };
  });

  /**
   * Revert a book to its scanned file tags, dropping the online override.
   * Same single-book-response reasoning as metadata:apply above.
   */
  ipcMain.handle('metadata:clear', (_event, bookId) => {
    if (typeof bookId !== 'string') return { book: null };
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
      refreshJumpList();
    }
    return { book: clientBookById(bookId) };
  });

  // One-shot: consumed by the renderer on bootstrap so a jump-list launch
  // (--open-book=<id>) opens straight to that book. Cleared after reading so
  // a later in-app rescan/reload doesn't keep reopening the same book.
  ipcMain.handle('app:getInitialOpenBook', () => {
    const id = initialOpenBookId;
    initialOpenBookId = null;
    return id;
  });

  // Renderer pushes play/pause changes here so the thumbbar icon (play vs.
  // pause) stays in sync — Windows has no way to ask the window for this.
  ipcMain.handle('player:setPlayingState', (_event, isPlaying) => {
    taskbar.setThumbar(mainWindow, Boolean(isPlaying), sendMediaControl);
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
  taskbar.setThumbar(mainWindow, false, sendMediaControl);
  refreshJumpList();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Pick up files added outside the app since last launch.
  if (libraryStore.get().folders.length) runScan();
});

// A jump-list click while the app is already running lands here instead of
// spawning a second window, since requestSingleInstanceLock() is held above.
app.on('second-instance', (_event, argv) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
  const bookId = taskbar.bookIdFromArgv(argv);
  if (bookId) mainWindow?.webContents.send('player:openBook', bookId);
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
