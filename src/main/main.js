'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');

const {
  USER_DATA, LIBRARY_FILE, LIBRARY_DB_FILE, PROGRESS_FILE, BOOKMARKS_FILE, NORMALIZATION_FILE,
  METADATA_FILE, DATA_ROOT, OS_DEFAULT_ROOT, COVER_CACHE, ONLINE_COVER_CACHE, BACKUP_DIR,
  REORG_ID_MAP_FILE, EBOOK_PAIRING_FILE, ACTIVITY_FILE, setDataLocation, clearDataLocation,
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

/**
 * Crash/diagnostic log at DATA_ROOT/diagnostic.log.
 *
 * A desktop app that dies mid-scan gives the user nothing to report but "it
 * closed itself" -- and when the *renderer* is what died, the main process
 * often survives long enough that no console output exists at all, which is
 * exactly the dead end this app hit in testing. Electron does know why a
 * process went away (render-process-gone / child-process-gone carry a
 * reason and exit code), and app.getAppMetrics() attributes CPU and memory
 * per Electron process, so this records both to disk. Append-only, tiny,
 * best-effort: diagnostics must never themselves break a launch.
 */
const DIAG_FILE = path.join(DATA_ROOT, 'diagnostic.log');
function diag(message) {
  try {
    fs.appendFileSync(DIAG_FILE, `${new Date().toISOString()} ${message}\n`);
  } catch {
    // Never let logging failures affect the app.
  }
}

/**
 * Breakdown of *this* process's memory. Which bucket grows is the whole
 * question: JS heap growth means retained JS objects, while external /
 * arrayBuffers growth means native Buffers (file reads, image data) that a
 * heap profile would not even show. Reproductions so far (worker disabled,
 * no window, window + IPC) all stayed flat, so the app itself has to report
 * this.
 */
function memLine() {
  const m = process.memoryUsage();
  const mb = (b) => Math.round(b / 1024 / 1024);
  return `rss=${mb(m.rss)}MB heap=${mb(m.heapUsed)}/${mb(m.heapTotal)}MB ext=${mb(m.external)}MB ab=${mb(m.arrayBuffers)}MB`;
}

/** Per-Electron-process CPU/memory, so a spike can be attributed to a specific process rather than guessed at. */
function diagMetrics(tag) {
  try {
    const rows = app.getAppMetrics().map((m) => {
      const cpu = m.cpu?.percentCPUUsage ?? 0;
      const ws = Math.round((m.memory?.workingSetSize ?? 0) / 1024);
      return `${m.type}${m.serviceName ? `(${m.serviceName})` : ''} pid=${m.pid} cpu=${cpu.toFixed(0)}% ws=${ws}MB`;
    });
    diag(`${tag} [${memLine()}] media=${mediaRequestCount}req/${Math.round(mediaBytesServed / 1024 / 1024)}MB | ${rows.join(' | ')}`);
  } catch (err) {
    diag(`${tag} [${memLine()}] | metrics unavailable: ${err.message}`);
  }
}

// Dense, always-on memory timeline. The crash is a runaway allocation that
// none of the isolated reproductions trigger, so the shape and onset of the
// growth -- and whether it continues once the scan is over -- has to be
// observed in the real app. One tiny line per second, unref'd so it never
// holds the process open.
let mediaBytesServed = 0;
let mediaRequestCount = 0;

// Verbose tracing (per-second memory ticks, per-book scan detail, media
// request volume). Off by default -- it was what identified the scan hang,
// and is kept behind a flag so the same investigation is repeatable without
// shipping the noise. Enable with MIDNIGHT_ATHENAEUM_DEBUG=1.
const DIAG_VERBOSE = process.env.MIDNIGHT_ATHENAEUM_DEBUG === '1';
if (DIAG_VERBOSE) {
  setInterval(() => diag(`tick [${memLine()}] mediaServed=${Math.round(mediaBytesServed / 1024 / 1024)}MB/${mediaRequestCount}req`), 1000).unref?.();
}

app.on('render-process-gone', (_event, _webContents, details) => {
  diag(`!!! RENDER-PROCESS-GONE reason=${details.reason} exitCode=${details.exitCode}`);
  diagMetrics('at-render-gone');
});
app.on('child-process-gone', (_event, details) => {
  diag(`!!! CHILD-PROCESS-GONE type=${details.type} reason=${details.reason} exitCode=${details.exitCode} name=${details.name ?? ''}`);
  diagMetrics('at-child-gone');
});
process.on('uncaughtException', (err) => {
  diag(`!!! UNCAUGHT EXCEPTION ${err && err.stack ? err.stack : err}`);
});

// Last-resort guard. Node terminates the process on an unhandled rejection,
// which for a desktop app means the window simply vanishes mid-use with no
// explanation -- a real user hit exactly that when a background fill pass
// started rejecting (see runThumbnailFill / library.generateCoverThumb).
// Those individual paths are fixed at the source, but a background
// best-effort pass should never be able to take the whole app down, so this
// converts any stray rejection into a logged warning instead of an exit.
// Deliberately not swallowing 'uncaughtException' the same way: a genuine
// synchronous crash leaves state unknown, where continuing is riskier than
// stopping.
process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandled promise rejection (continuing):', reason);
  diag(`!!! UNHANDLED REJECTION ${reason && reason.stack ? reason.stack : reason}`);
});

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
const { LibraryDb } = require('./db');
const library = require('./library');
const { scanLibrary, hashId } = library;
const { registerScheme, registerMediaProtocol, mediaUrl } = require('./media-protocol');
const { searchOpenLibrary, fetchWorkDescription, downloadCover } = require('./metadata-lookup');
const updater = require('./updater');
const taskbar = require('./taskbar');
const discord = require('./discord-presence');
const transcriber = require('./transcribe');
const duplicates = require('./duplicates');
const reorganizer = require('./reorganize');
const epub = require('./epub');
const ebookPairing = require('./ebook-pairing');

registerScheme();

const libraryStore = new LibraryDb(LIBRARY_DB_FILE);
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
// { [bookId]: { epubPath, source: 'auto'|'manual' } } -- read-along ebook
// pairings. 'manual' entries (and explicit "no ebook" picks) are never
// overwritten by a later automatic guess.
const pairingStore = new JsonStore(EBOOK_PAIRING_FILE, {});
// { [dateString: 'YYYY-MM-DD']: secondsListened } -- local-date keyed, not
// book-keyed, so it's deliberately excluded from remapIdKeyedStores() below
// and the backup-restore/reorganize flushSync clusters (nothing there could
// ever need to remap a date key).
const activityStore = new JsonStore(ACTIVITY_FILE, {});

let mainWindow = null;
let scanning = false;

// The plan most recently previewed via reorganize:plan, held here (not
// trusted from the renderer) so reorganize:execute always runs exactly what
// was shown to the user, even if the library changed underneath in between.
let pendingReorgPlan = null;

/**
 * A book's id is a hash of its file path (see library.js hashId) — moving it
 * during a reorganize always mints a new id. Mirrors that exact formula so
 * the freshly-moved book's id matches what the next rescan would assign it,
 * rather than drifting apart and forcing an unnecessary re-tag.
 */
function newBookId(book, newSourceDir, newTrackPaths) {
  return hashId(book.kind === 'single' ? newTrackPaths[0] : `${newSourceDir}::${newTrackPaths.length}`);
}

/**
 * Carries progress, bookmarks, normalization gain, metadata overrides,
 * ebook pairing, and a transcript over from one book id to another — needed
 * whenever a reorganize (or its undo) changes a book's id out from under
 * data that was keyed by the old one.
 */
function remapIdKeyedStores(oldId, newId) {
  if (oldId === newId) return;
  for (const store of [progressStore, bookmarksStore, normalizationStore, metadataStore, pairingStore]) {
    const data = store.get();
    if (Object.prototype.hasOwnProperty.call(data, oldId)) {
      const next = { ...data };
      next[newId] = next[oldId];
      delete next[oldId];
      store.set(next);
    }
  }
  transcriber.renameTranscript(oldId, newId);
}

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

/**
 * Local-calendar-date key for activityStore, e.g. "2026-07-24". Deliberately
 * not `toISOString()` (UTC -- misbuckets listening near local midnight in
 * non-UTC timezones) and not `toLocaleDateString()` (locale-dependent
 * format, not lexically sortable -- breaks both the streak backward-walk
 * and week aggregation, which both need YYYY-MM-DD strings that sort
 * correctly as plain strings).
 */
function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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
  // Online-metadata-override covers don't have a generated thumbnail (a
  // separate, smaller cache/flow via ONLINE_COVER_CACHE) -- the grid falls
  // back to the full-size coverUrl for those few books, same as before this
  // field existed.
  const coverThumb = override?.hasCover ? null : book.coverThumb;

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
    coverThumbUrl: coverThumb ? mediaUrl(coverThumb) : null,
    mtimeMs: bookMtime(book),
    fileName: path.basename(book.tracks[0]?.filePath ?? ''),
    trackCount: book.tracks.length,
    metadataSource: override?.source ?? null,
    metadataFetchedAt: override?.fetchedAt ?? null,
    // True for a book phase 1 built but hasn't had its cover/chapters filled
    // in yet (see library.js's fillBookDetails) — undefined on any book from
    // before this field existed, which is already the correct "fully
    // detailed" reading for a pre-existing library.
    detailPending: Boolean(book.detailPending),
    // Powers the "Has ebook" library filter/card badge — see runPairingFill()
    // and ebook-pairing.js. Undefined (falsy) until the background pairing
    // fill or an on-demand Read Along check has actually looked.
    hasEbook: pairingStore.get()[book.id]?.status === 'matched',
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

/**
 * shell.openExternal hands a URL straight to the OS (ShellExecute on
 * Windows) — restricting it to http/https before calling is cheap
 * defense-in-depth against a window.open() call ever reaching it with a
 * `file:`/custom-protocol URL (nothing in this app currently constructs one,
 * but every use of this goes through a window-open handler that fires for
 * any renderer-initiated navigation attempt, not just the trusted static
 * links that use it today).
 */
function openExternalSafely(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (parsed.protocol === 'https:' || parsed.protocol === 'http:') shell.openExternal(url);
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
    openExternalSafely(url);
    return { action: 'deny' };
  });

  // This is a single-page app with no legitimate reason to ever navigate its
  // main frame away from the file it loaded once at startup -- blocking it
  // outright (rather than allowlisting) is extra defense-in-depth alongside
  // CSP/setWindowOpenHandler against a hypothetical renderer compromise
  // trying to load a different origin into the window.
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());

  // Electron ships no edit context menu by default — right-clicking a text
  // field does nothing unless the app builds one itself. Scoped to editable
  // fields only (search boxes, metadata query, etc.), not general page text.
  mainWindow.webContents.on('context-menu', (_event, params) => {
    if (!params.isEditable) return;
    Menu.buildFromTemplate([
      { role: 'undo', enabled: params.editFlags.canUndo },
      { role: 'redo', enabled: params.editFlags.canRedo },
      { type: 'separator' },
      { role: 'cut', enabled: params.editFlags.canCut },
      { role: 'copy', enabled: params.editFlags.canCopy },
      { role: 'paste', enabled: params.editFlags.canPaste },
      { role: 'selectAll', enabled: params.editFlags.canSelectAll },
    ]).popup();
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
    openExternalSafely(url);
    return { action: 'deny' };
  });
  aboutWindow.webContents.on('will-navigate', (event) => event.preventDefault());
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
  // EBOOK_PAIRING_FILE was missing here before -- a second real pre-existing
  // gap found while adding ACTIVITY_FILE: a data-location move would have
  // silently stranded ebook-pairings.json at the old location.
  return [
    LIBRARY_DB_FILE, LIBRARY_FILE, PROGRESS_FILE, BOOKMARKS_FILE, NORMALIZATION_FILE,
    METADATA_FILE, EBOOK_PAIRING_FILE, ACTIVITY_FILE, COVER_CACHE, ONLINE_COVER_CACHE,
  ].filter((p) => fs.existsSync(p));
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

  const hasExistingData = fs.existsSync(path.join(target, 'library.db')) || fs.existsSync(path.join(target, 'library.json'));

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
    progressStore.flushSync();
    bookmarksStore.flushSync();
    normalizationStore.flushSync();
    metadataStore.flushSync();
    try {
      await fsp.mkdir(target, { recursive: true });
      // The sqlite db moves last, and only once every other entry has
      // already moved successfully -- closing it (required so its file
      // handle doesn't block the move on Windows) is the one step here that
      // can't just be retried in place if something earlier in the loop
      // fails, so nothing should reach it until the rest has succeeded.
      for (const src of ownDataEntries()) {
        if (src === LIBRARY_DB_FILE) continue;
        await moveEntry(src, path.join(target, path.basename(src)));
      }
      if (fs.existsSync(LIBRARY_DB_FILE)) {
        await libraryStore.close();
        try {
          await moveEntry(LIBRARY_DB_FILE, path.join(target, path.basename(LIBRARY_DB_FILE)));
        } catch (err) {
          // Reopen at the old location so the app isn't left with a closed,
          // unusable library store if the move itself is what failed.
          await libraryStore.load(LIBRARY_FILE).catch((reopenErr) => {
            console.error('[db] failed to reopen after a failed move:', reopenErr.message);
          });
          throw err;
        }
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
        { label: 'Find duplicate books…', click: () => mainWindow?.webContents.send('duplicates:open') },
        { label: 'Reorganize library by author…', click: () => mainWindow?.webContents.send('reorganize:open') },
        { label: 'Undo last reorganization…', click: () => mainWindow?.webContents.send('reorganize:undo-requested') },
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

/**
 * Only writes an updated (cover/chapters-filled) book back if it's still
 * there under the same id *and* its signature hasn't moved on since. Covers
 * two real races: the book was removed (duplicates:remove) or given a new
 * id (reorganize) while its detail fill was in flight — id lookup fails,
 * dropped; or a concurrent rescan rebuilt the same id differently —
 * signature mismatch, dropped. Either way this is a silent no-op, never an
 * error: the book just stays (or goes back to) detailPending and gets
 * picked up again later.
 */
function writeDetailUpdate(updated) {
  // O(1) via getBook/updateBook rather than get()/findIndex/map/set(), which
  // was O(total books) *per book* -- fine when phase 2 was slow enough to
  // hide it, a measurable main-thread CPU burn (5.5s across a 6,000-book
  // library) once worker threads made detail fill fast enough to run this
  // loop back-to-back.
  const current = libraryStore.getBook(updated.id);
  if (!current) return false;
  if (current.signature !== updated.signature) return false;
  libraryStore.updateBook(updated);
  return true;
}

// Progress channels are per-item: scan fires once per book, and the three
// background fills fire once per book each. Measured against the real
// ~5,800-book library, phase 1's cache-hit path alone runs at ~800
// books/second, so that was ~800 IPC messages/second at the renderer, each
// one running renderScanStatus() plus class/style writes -- sustained
// layout thrash that pegged the renderer and could take it (and so the
// window) down entirely. Nothing about the *content* of these events needs
// per-item fidelity: they only move a progress bar, so coalescing to ~20/s
// is visually identical and costs the renderer ~40x less.
//
// This was always latent; it only became harmful once parsing moved to a
// worker thread and stopped pacing the loop -- the same way the O(n)
// writeDetailUpdate did. Terminal events (start, finish, and the
// active:false/scanning:false transitions) are always forced through, so
// the UI can never be left stuck showing a stale "still scanning" state.
const PROGRESS_MIN_INTERVAL_MS = 50;
const lastProgressSend = new Map();
function sendProgress(channel, payload, { force = false } = {}) {
  const now = Date.now();
  if (!force && now - (lastProgressSend.get(channel) ?? 0) < PROGRESS_MIN_INTERVAL_MS) return;
  lastProgressSend.set(channel, now);
  mainWindow?.webContents.send(channel, payload);
}

let detailFillRunning = false;
let detailFillPromise = Promise.resolve();
let detailFillCancelToken = { cancelled: false };

/** Stops the background detail fill and waits for its current book to finish, so a fresh rescan never races its cache snapshot against phase 2 still writing to the store. */
async function stopDetailFill() {
  detailFillCancelToken.cancelled = true;
  await detailFillPromise;
}

/**
 * Background phase 2: fills in cover/chapters for whatever's still
 * detailPending, batching updates into occasional library:booksUpdated
 * broadcasts (unlike phase 1's single end-of-scan broadcast, this is
 * long-running against a fixed-length array, so incremental beats one big
 * payload here). Fire-and-forget from the caller's perspective.
 */
function runDetailFill() {
  if (detailFillRunning) return detailFillPromise;
  const state = libraryStore.get();
  const pendingCount = state.books.filter((b) => b.detailPending).length;
  if (!pendingCount) return Promise.resolve();

  detailFillRunning = true;
  detailFillCancelToken = { cancelled: false };
  const token = detailFillCancelToken;
  let done = 0;
  let batch = [];
  let lastFlush = Date.now();

  const flush = () => {
    if (!batch.length) return;
    mainWindow?.webContents.send('library:booksUpdated', batch.map(toClientBook));
    batch = [];
    lastFlush = Date.now();
  };

  sendProgress('library:detailProgress', { done, total: pendingCount, active: true }, { force: true });

  detailFillPromise = library.fillBookDetails(state.books, {
    isCancelled: () => token.cancelled,
    onBookDone: (updated) => {
      if (!writeDetailUpdate(updated)) return;
      done += 1;
      batch.push(updated);
      if (batch.length >= 25 || Date.now() - lastFlush > 1000) flush();
      sendProgress('library:detailProgress', { done, total: pendingCount, active: true });
    },
  }).finally(() => {
    flush();
    detailFillRunning = false;
    sendProgress('library:detailProgress', { done, total: pendingCount, active: false }, { force: true });
  });

  return detailFillPromise;
}

function getPairingEntry(bookId) {
  return pairingStore.get()[bookId] ?? null;
}

/** Persists a pairing (or no-match) result for one book, unless it was removed/reorganized to a new id while the check was in flight. */
function writePairingResult(bookId, result) {
  if (!libraryStore.get().books.some((b) => b.id === bookId)) return false;
  pairingStore.set({
    ...pairingStore.get(),
    [bookId]: { status: result.status, epubPath: result.epubPath, source: result.status === 'matched' ? 'auto' : null },
  });
  return true;
}

let pairingFillRunning = false;
let pairingFillPromise = Promise.resolve();
let pairingFillCancelToken = { cancelled: false };

async function stopPairingFill() {
  pairingFillCancelToken.cancelled = true;
  await pairingFillPromise;
}

/**
 * Background pass powering the "Has ebook" library filter/card badge:
 * computes and persists an ebook-pairing result (matched, ambiguous, or
 * none — see ebook-pairing.js) for every book that hasn't been checked yet.
 * Deliberately chained to run only *after* runDetailFill() finishes, not
 * concurrently with it — both are gentle, low-priority disk work on the
 * same drive (see BOOK_CONCURRENCY's comment in library.js on why that
 * matters here), and fully sequential (one book at a time) for the same
 * reason, since this can touch every book in the library rather than just
 * the ones a user happens to open.
 */
function runPairingFill() {
  if (pairingFillRunning) return pairingFillPromise;
  const books = libraryStore.get().books;
  const pairings = pairingStore.get();
  const unchecked = books.filter((b) => !(b.id in pairings));
  if (!unchecked.length) return Promise.resolve();

  pairingFillRunning = true;
  pairingFillCancelToken = { cancelled: false };
  const token = pairingFillCancelToken;
  let done = 0;
  let batch = [];
  let lastFlush = Date.now();

  const flush = () => {
    if (!batch.length) return;
    const fresh = libraryStore.get().books;
    const updated = batch.map((id) => fresh.find((b) => b.id === id)).filter(Boolean).map(toClientBook);
    if (updated.length) mainWindow?.webContents.send('library:booksUpdated', updated);
    batch = [];
    lastFlush = Date.now();
  };

  sendProgress('library:pairingProgress', { done, total: unchecked.length, active: true }, { force: true });

  pairingFillPromise = (async () => {
    for (const book of unchecked) {
      if (token.cancelled) break;
      // eslint-disable-next-line no-await-in-loop
      const result = await ebookPairing.findPairing(book);
      if (!writePairingResult(book.id, result)) continue;
      done += 1;
      batch.push(book.id);
      if (batch.length >= 25 || Date.now() - lastFlush > 1000) flush();
      sendProgress('library:pairingProgress', { done, total: unchecked.length, active: true });
    }
  })().finally(() => {
    flush();
    pairingFillRunning = false;
    sendProgress('library:pairingProgress', { done, total: unchecked.length, active: false }, { force: true });
  });

  return pairingFillPromise;
}

let thumbnailFillRunning = false;
let thumbnailFillPromise = Promise.resolve();
let thumbnailFillCancelToken = { cancelled: false };

async function stopThumbnailFill() {
  thumbnailFillCancelToken.cancelled = true;
  await thumbnailFillPromise;
}

/**
 * Backfill-only pass: generates cover thumbnails (see library.js's
 * generateCoverThumb) for books that already have a full cover but no
 * thumbnail yet — i.e. books that were fully detailed (detailPending:
 * false) before thumbnails existed, so fillOneBookDetail's inline
 * generation will never reach them again on its own. A freshly scanned or
 * freshly detail-filled book already gets its thumbnail as part of that
 * same pass; this only mops up the pre-existing backlog. Same
 * gentle-sequential-after-pairing-fill precedent as runPairingFill.
 */
function runThumbnailFill() {
  if (thumbnailFillRunning) return thumbnailFillPromise;
  const books = libraryStore.get().books;
  const pending = books.filter((b) => b.cover && !b.coverThumb);
  if (!pending.length) return Promise.resolve();

  thumbnailFillRunning = true;
  thumbnailFillCancelToken = { cancelled: false };
  const token = thumbnailFillCancelToken;
  let done = 0;
  let batch = [];
  let lastFlush = Date.now();

  const flush = () => {
    if (!batch.length) return;
    const fresh = libraryStore.get().books;
    const updated = batch.map((id) => fresh.find((b) => b.id === id)).filter(Boolean).map(toClientBook);
    if (updated.length) mainWindow?.webContents.send('library:booksUpdated', updated);
    batch = [];
    lastFlush = Date.now();
  };

  sendProgress('library:thumbnailProgress', { done, total: pending.length, active: true }, { force: true });

  thumbnailFillPromise = (async () => {
    for (const book of pending) {
      if (token.cancelled) break;
      // eslint-disable-next-line no-await-in-loop
      const coverThumb = await library.generateCoverThumb(book.id, book.cover);
      if (!coverThumb || !writeDetailUpdate({ ...book, coverThumb })) continue;
      done += 1;
      batch.push(book.id);
      if (batch.length >= 25 || Date.now() - lastFlush > 1000) flush();
      sendProgress('library:thumbnailProgress', { done, total: pending.length, active: true });
    }
  })().finally(() => {
    flush();
    thumbnailFillRunning = false;
    sendProgress('library:thumbnailProgress', { done, total: pending.length, active: false }, { force: true });
  });

  return thumbnailFillPromise;
}

/**
 * `deep` forces the full per-file check instead of the directory-mtime fast
 * path (see scanLibrary). Automatic scans -- launch, folder added -- use the
 * fast path; an explicit "Rescan library" is the escape hatch for the one
 * case the fast path can miss, a file rewritten in place under the same name.
 */
/** True when `child` is inside `parent` (or is it). Used to tell which books belong to an unreadable folder. */
function isInsideFolder(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Which of the library folders can't be read right now.
 *
 * A scan that cannot see a folder finds no files in it, which is
 * indistinguishable from "the user deleted everything" unless we check
 * separately — and acting on that guess deletes real data (see runScan).
 * This library lives on its own drive and scans run at launch, so a folder
 * being briefly unavailable (drive asleep, unplugged, letter moved, network
 * path down) is ordinary, not exotic.
 */
async function unreadableFolders(folders) {
  const results = await Promise.all(folders.map(async (folder) => {
    try {
      await fsp.readdir(folder);
      return null;
    } catch {
      return folder;
    }
  }));
  return results.filter(Boolean);
}

async function runScan({ deep = false } = {}) {
  if (scanning) return;
  await stopDetailFill(); // phase 2 must fully quiesce before we read the cache snapshot below
  await stopPairingFill();
  await stopThumbnailFill();
  const state = libraryStore.get();
  if (!state.folders.length) {
    libraryStore.set({ ...state, books: [] });
    mainWindow?.webContents.send('library:changed', currentState());
    return;
  }

  // Never let an unreadable folder look like an emptied one. Folders that
  // can't be read are dropped from this scan, and the books already known
  // under them are carried through untouched rather than being scanned for
  // (and therefore not found, and therefore deleted).
  const badFolders = await unreadableFolders(state.folders);
  if (badFolders.length) {
    diag(`scan: ${badFolders.length} unreadable folder(s): ${badFolders.join(' | ')}`);
  }
  if (badFolders.length === state.folders.length) {
    // Nothing readable at all: this is a failed scan, not an empty library.
    diag('scan: aborted, no library folder is readable — keeping existing books');
    console.error('[scan] no library folder is readable; keeping the existing library');
    dialog.showErrorBox(
      'Could not read your library',
      `${badFolders.length === 1 ? 'This folder' : 'None of these folders'} could be read:\n\n${badFolders.join('\n')}\n\n`
      + 'If the drive is disconnected or still starting up, reconnect it and rescan. '
      + 'Your library has been left as it is.',
    );
    mainWindow?.webContents.send('library:changed', currentState());
    return;
  }

  const scanFolders = state.folders.filter((f) => !badFolders.includes(f));
  const preservedBooks = badFolders.length
    ? state.books.filter((b) => badFolders.some((f) => isInsideFolder(f, b.sourceDir)))
    : [];

  scanning = true;
  sendProgress('library:scan-progress', { done: 0, total: 0, scanning: true }, { force: true });

  diag(`scan: starting, ${state.books.length} cached books`);
  diagMetrics('scan-start');
  let lastDiag = 0;

  try {
    let lastRssMB = 0;
    const books = await scanLibrary(scanFolders, state.books, (done, total, info) => {
      // Throttled: the cache-hit path reaches ~800 books/second on a large
      // library, and an unthrottled send here was the single biggest source
      // of renderer load during a launch scan.
      sendProgress('library:scan-progress', { done, total, scanning: true }, { force: done === total });

      // Name any book that is individually expensive, or that coincides with
      // a jump in memory. The app died mid-scan with the main process at
      // 5.2GB and climbing, so the question is specifically *which* books
      // allocate that -- a per-500 summary can't answer it.
      const rssMB = Math.round(process.memoryUsage().rss / 1024 / 1024);
      const grew = rssMB - lastRssMB;
      if (DIAG_VERBOSE && info && (info.ms > 400 || grew > 100)) {
        diag(`heavy book #${done} ${info.ms}ms [${memLine()}] (+${grew}MB) files=${info.files} kind=${info.kind} cacheHit=${info.cacheHit} :: ${info.dir}`);
      }
      if (grew > 100 || rssMB < lastRssMB - 200) lastRssMB = rssMB;

      // One line per 500 books: cheap, and it is what makes a future
      // "it froze part-way through scanning" report diagnosable at all.
      if (done - lastDiag >= 500 || done === total) {
        lastDiag = done;
        diagMetrics(`scan ${done}/${total}`);
      }
    }, { deep });

    // Last line of defence. Every folder read fine, yet nothing came back
    // while the library previously had books -- that is not a library
    // someone emptied one file at a time, it is a read that failed in a way
    // the per-folder check above didn't catch (permissions, a mount that
    // answers readdir with an empty listing, a folder replaced by a stub).
    // Refuse rather than persist the deletion of every row.
    if (!books.length && state.books.length) {
      diag(`scan: refused to persist an empty result over ${state.books.length} existing books`);
      console.error('[scan] scan returned no books but the library is not empty; keeping existing library');
      dialog.showErrorBox(
        'Library scan found nothing',
        `The scan finished without finding any books, but your library has ${state.books.length}.\n\n`
        + 'This usually means the library folder could not really be read. '
        + 'Your library has been left as it is — no books were removed.',
      );
      return;
    }

    const merged = preservedBooks.length ? [...books, ...preservedBooks] : books;
    if (preservedBooks.length) {
      diag(`scan: kept ${preservedBooks.length} book(s) belonging to unreadable folder(s)`);
    }
    diag(`scan: built ${books.length} books (+${preservedBooks.length} preserved), persisting`);
    libraryStore.set({ ...libraryStore.get(), books: merged });
    diag('scan: persisted');
  } catch (err) {
    console.error('[scan] failed:', err);
    diag(`scan: FAILED ${err && err.stack ? err.stack : err}`);
    dialog.showErrorBox('Scan failed', err.message);
  } finally {
    scanning = false;
    diagMetrics('scan-end');
    sendProgress('library:scan-progress', { done: 0, total: 0, scanning: false }, { force: true });
    // Full library payload to the renderer -- on a large library this is the
    // single biggest IPC message the app ever sends, so it's worth knowing
    // whether the app died immediately before, during, or after it.
    diag('scan: sending library:changed (full payload)');
    mainWindow?.webContents.send('library:changed', currentState());
    diag('scan: library:changed sent');
    refreshJumpList(); // a removed/renamed book could be sitting in the list
    // Background phase 2, then ebook-pairing fill, then thumbnail backfill --
    // all fire-and-forget from here. The .catch() is not optional: this
    // chain is never awaited, so without it any rejection inside these
    // passes becomes an unhandled rejection, which terminates the main
    // process on Electron's Node. These are all best-effort background
    // passes -- a failure means some books stay unfilled until the next
    // scan, which must never take the app down with it.
    runDetailFill()
      .then(() => runPairingFill())
      .then(() => runThumbnailFill())
      .catch((err) => console.error('[scan] background fill failed:', err));
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

  // An explicit rescan is the user saying "I changed something, look properly"
  // -- so it does the full per-file check rather than the fast path.
  ipcMain.handle('library:rescan', () => { runScan({ deep: true }); return currentState(); });

  /**
   * Fast-tracks one book's phase-2 detail fill (cover/chapters) for when the
   * user opens it before the background pass (runDetailFill) reaches it —
   * library.ensureDetail de-dupes this against that same background pass, so
   * the same book is never filled twice concurrently either way.
   */
  ipcMain.handle('library:ensureBookDetail', async (_event, bookId) => {
    if (typeof bookId !== 'string') return { book: null };
    const raw = libraryStore.get().books.find((b) => b.id === bookId);
    if (!raw) return { book: null };
    if (!raw.detailPending) return { book: toClientBook(raw) };

    const updated = await library.ensureDetail(raw);
    writeDetailUpdate(updated); // no-op if the book was removed/reorganized/rescanned meanwhile
    const fresh = libraryStore.get().books.find((b) => b.id === updated.id) ?? raw;
    return { book: toClientBook(fresh) };
  });

  ipcMain.on('media:error', (_event, info) => {
    const i = info || {};
    diag(`!!! PLAYBACK ERROR code=${i.code} (${i.codeName}) src=${i.src ?? '?'} :: ${i.title ?? ''} ${i.message ? `| ${i.message}` : ''}`);
  });

  ipcMain.handle('progress:save', (_event, { bookId, position, duration, speed, elapsedSeconds }) => {
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

    // Real wall-clock listening time, sent only when the renderer confirmed
    // audio was actually playing (see flushProgress's wasPlaying gate) --
    // clamped again here since this is a renderer-supplied number crossing
    // the IPC boundary, not because the renderer is untrusted so much as
    // defense against a stale/bogus value ever inflating a day's total.
    if (typeof elapsedSeconds === 'number' && elapsedSeconds > 0) {
      const clamped = Math.min(elapsedSeconds, 10);
      const key = localDateKey();
      const activity = { ...activityStore.get() };
      activity[key] = (activity[key] ?? 0) + clamped;
      activityStore.set(activity);
    }
  });

  ipcMain.handle('progress:clear', (_event, bookId) => {
    const progress = { ...progressStore.get() };
    delete progress[bookId];
    progressStore.set(progress);
    refreshJumpList();
    return progress;
  });

  /**
   * Lazy-fetched (not bundled into library:getState) since it's only needed
   * when the Stats view is actually open. "Books finished"/"top authors and
   * narrators" need no data from here -- they're computed renderer-side from
   * the book list + progress already sent on every launch.
   */
  ipcMain.handle('stats:get', () => {
    const activity = activityStore.get();

    // A streak is still "alive" if today just hasn't happened yet -- only a
    // full day with zero activity actually breaks it, so today's own (lack
    // of) activity doesn't get counted against yesterday's real streak.
    let streak = 0;
    const cursor = new Date();
    if (!activity[localDateKey(cursor)]) cursor.setDate(cursor.getDate() - 1);
    while (activity[localDateKey(cursor)] > 0) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }

    return { activity, streak };
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

  /**
   * Local, offline transcription (opt-in, per book — see transcribe.js).
   * transcribe:start returns immediately once the job is accepted; progress
   * and completion are pushed separately via transcribe:progress, the same
   * fire-and-forget-plus-events shape as the library scan.
   */
  ipcMain.handle('transcribe:start', (_event, bookId) => {
    if (typeof bookId !== 'string') return { ok: false, error: 'Invalid book.' };
    if (!transcriber.isAvailable()) return { ok: false, error: 'Transcription is not available in this build.' };
    if (transcriber.anyTranscribing()) {
      return { ok: false, error: 'Already transcribing another book — wait for it to finish first.' };
    }
    const raw = libraryStore.get().books.find((b) => b.id === bookId);
    if (!raw) return { ok: false, error: 'Book not found.' };

    transcriber.transcribeBook(raw, (info) => {
      mainWindow?.webContents.send('transcribe:progress', { bookId, ...info });
    }).then((result) => {
      mainWindow?.webContents.send('transcribe:progress', {
        bookId,
        phase: result ? 'complete' : 'cancelled',
        percent: result ? 100 : 0,
      });
    }).catch((err) => {
      console.error('[transcribe] failed:', err);
      mainWindow?.webContents.send('transcribe:progress', { bookId, phase: 'error', percent: 0, error: err.message });
    });

    return { ok: true };
  });

  ipcMain.handle('transcribe:cancel', (_event, bookId) => {
    if (typeof bookId === 'string') transcriber.cancelTranscription(bookId);
  });

  ipcMain.handle('transcribe:getStatus', (_event, bookId) => ({
    available: transcriber.isAvailable(),
    hasTranscript: typeof bookId === 'string' && transcriber.hasTranscript(bookId),
    isTranscribing: typeof bookId === 'string' && transcriber.isTranscribing(bookId),
    anyTranscribing: transcriber.anyTranscribing(),
  }));

  ipcMain.handle('transcript:get', (_event, bookId) => {
    if (typeof bookId !== 'string') return null;
    return transcriber.loadTranscript(bookId);
  });

  ipcMain.handle('transcript:delete', (_event, bookId) => {
    if (typeof bookId === 'string') transcriber.deleteTranscript(bookId);
  });

  /**
   * Returns the book's current ebook-pairing check if one exists (whether
   * matched, ambiguous, or none — any of those means it's already been
   * checked); otherwise computes and persists a fresh one. Unlike
   * reorganize:plan (a preview of a destructive action needing explicit
   * confirm), a pairing guess is harmless and fully reversible via a manual
   * re-pick at any time, so the result is always persisted immediately
   * rather than needing a separate commit step — this is also what lets the
   * background runPairingFill() pass (main.js) know which books it's
   * already covered.
   */
  ipcMain.handle('ebook:findPairing', async (_event, bookId) => {
    if (typeof bookId !== 'string') return { status: 'none', epubPath: null, candidates: [] };
    const existing = getPairingEntry(bookId);
    if (existing) return { status: existing.status, epubPath: existing.epubPath, source: existing.source, candidates: [] };

    const book = libraryStore.get().books.find((b) => b.id === bookId);
    if (!book) return { status: 'none', epubPath: null, candidates: [] };

    const result = await ebookPairing.findPairing(book);
    writePairingResult(bookId, result);
    mainWindow?.webContents.send('library:booksUpdated', [toClientBook(book)]); // hasEbook may have just changed
    return result;
  });

  /**
   * The user's explicit pick (or explicit "no ebook" clear) — always wins
   * over future auto-guesses. epubPath is only ever trusted if it's a real,
   * existing .epub file (same filter ebook:pickFile's dialog already
   * applies) — this is later read as a ZIP by epub.js on the main process's
   * own filesystem access, so an unvalidated arbitrary path here would be a
   * real (if renderer-compromise-gated) arbitrary-file-read primitive.
   */
  ipcMain.handle('ebook:setPairing', (_event, { bookId, epubPath } = {}) => {
    if (typeof bookId !== 'string') return { ok: false };
    let matched = typeof epubPath === 'string' && epubPath && path.extname(epubPath).toLowerCase() === '.epub';
    if (matched) {
      try {
        matched = fs.statSync(epubPath).isFile();
      } catch {
        matched = false;
      }
    }
    const entry = { status: matched ? 'matched' : 'none', epubPath: matched ? epubPath : null, source: 'manual' };
    pairingStore.set({ ...pairingStore.get(), [bookId]: entry });

    const book = libraryStore.get().books.find((b) => b.id === bookId);
    if (book) mainWindow?.webContents.send('library:booksUpdated', [toClientBook(book)]);
    return { ok: true, pairing: entry };
  });

  ipcMain.handle('ebook:pickFile', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose the matching ebook',
      properties: ['openFile'],
      filters: [{ name: 'EPUB', extensions: ['epub'] }],
    });
    if (result.canceled || !result.filePaths.length) return { canceled: true };
    return { canceled: false, epubPath: result.filePaths[0] };
  });

  ipcMain.handle('ebook:getToc', async (_event, bookId) => {
    if (typeof bookId !== 'string') return { error: 'Invalid book.' };
    const entry = getPairingEntry(bookId);
    if (entry?.status !== 'matched') return { error: 'No ebook paired with this book yet.' };
    try {
      return { toc: await epub.readEpubToc(entry.epubPath) };
    } catch (err) {
      return { error: `Couldn't read this ebook — ${err.message}` };
    }
  });

  ipcMain.handle('ebook:getSpineHtml', async (_event, { bookId, spineHref } = {}) => {
    if (typeof bookId !== 'string' || typeof spineHref !== 'string') return { error: 'Invalid request.' };
    const entry = getPairingEntry(bookId);
    if (entry?.status !== 'matched') return { error: 'No ebook paired with this book yet.' };
    try {
      return { html: await epub.readEpubSpineHtml(entry.epubPath, spineHref) };
    } catch (err) {
      return { error: `Couldn't read this ebook — ${err.message}` };
    }
  });

  /** Lightweight book shape for the duplicates view — not the full toClientBook (no chapters needed). */
  function toDupeSummary(book) {
    return {
      id: book.id,
      title: book.title,
      author: book.author,
      sourceDir: book.sourceDir,
      duration: book.duration,
      trackCount: book.tracks.length,
      coverUrl: book.cover ? mediaUrl(book.cover) : null,
      coverThumbUrl: book.coverThumb ? mediaUrl(book.coverThumb) : null,
    };
  }

  ipcMain.handle('duplicates:find', () => {
    const reports = duplicates.findDuplicateGroups(libraryStore.get().books);
    return reports.map((r) => ({
      title: r.title,
      author: r.author,
      recordings: r.recordings.map((rec) => ({
        trackCount: rec.trackCount,
        duration: rec.duration,
        books: rec.books.map(toDupeSummary),
      })),
    }));
  });

  /**
   * Moves one duplicate copy's own files to the Recycle Bin (never the
   * containing folder — confirmed in this library that a folder can hold
   * several unrelated single-file books side by side) and drops it from the
   * library immediately, without needing a full rescan.
   */
  ipcMain.handle('duplicates:remove', async (_event, bookId) => {
    if (typeof bookId !== 'string') return { ok: false, error: 'Invalid book.' };
    const state = libraryStore.get();
    const book = state.books.find((b) => b.id === bookId);
    if (!book) return { ok: false, error: 'Book not found.' };

    const results = await duplicates.trashBookFiles(book);
    const failed = results.filter((r) => !r.ok);
    if (failed.length === results.length) {
      return { ok: false, error: `Could not move to the Recycle Bin: ${failed[0]?.error || 'unknown error'}` };
    }

    libraryStore.set({ ...state, books: state.books.filter((b) => b.id !== bookId) });
    mainWindow?.webContents.send('library:changed', currentState());
    refreshJumpList();
    return { ok: true, partial: failed.length > 0 };
  });

  /**
   * Computes (but does not perform) a move for every book into
   * <library folder>/<Author>/<Title>/. Cached as pendingReorgPlan so the
   * confirm step in reorganize:execute always acts on exactly what was
   * previewed, never on a plan the renderer could have altered or a stale
   * one from before the library changed.
   */
  ipcMain.handle('reorganize:plan', () => {
    const state = libraryStore.get();
    const plan = reorganizer.computePlan(state.books, state.folders);
    pendingReorgPlan = plan;
    return {
      moves: plan.moves.map((m) => ({
        bookId: m.bookId, title: m.title, author: m.author, mode: m.mode,
        fromDir: m.fromDir, toDir: m.toDir, trackCount: m.fromFiles.length,
      })),
      skipped: plan.skipped,
      alreadyCorrectCount: plan.alreadyCorrectCount,
    };
  });

  ipcMain.handle('reorganize:cancel', () => {
    reorganizer.cancel();
    return { ok: true };
  });

  ipcMain.handle('reorganize:hasUndo', () => reorganizer.hasJournal());

  /**
   * Executes the previously previewed plan, then patches the moved books'
   * id/sourceDir/tracks in place (no rescan needed) and carries their
   * progress/bookmarks/normalization/metadata/transcripts over to their new,
   * path-derived ids — see newBookId/remapIdKeyedStores above.
   */
  ipcMain.handle('reorganize:execute', async () => {
    if (!pendingReorgPlan) return { ok: false, error: 'No plan to execute — preview first.' };
    if (reorganizer.isRunning()) return { ok: false, error: 'A reorganization is already running.' };

    const plan = pendingReorgPlan;
    const result = await reorganizer.executePlan(
      plan,
      (p) => mainWindow?.webContents.send('reorganize:progress', p),
    );

    const state = libraryStore.get();
    const books = [...state.books];
    const idMap = {};
    for (const move of plan.moves) {
      const update = result.pathUpdates[move.bookId];
      if (!update) continue; // failed or never reached (cancelled)
      const idx = books.findIndex((b) => b.id === move.bookId);
      if (idx === -1) continue;

      const oldBook = books[idx];
      const newId = newBookId(oldBook, update.sourceDir, update.trackPaths);
      const tracks = oldBook.tracks.map((t, i) => ({ ...t, filePath: update.trackPaths[i] }));
      books[idx] = { ...oldBook, id: newId, sourceDir: update.sourceDir, tracks };

      remapIdKeyedStores(oldBook.id, newId);
      if (newId !== oldBook.id) idMap[newId] = oldBook.id;
    }
    libraryStore.set({ ...state, books });
    progressStore.flushSync();
    bookmarksStore.flushSync();
    normalizationStore.flushSync();
    metadataStore.flushSync();

    if (Object.keys(idMap).length) {
      fs.mkdirSync(path.dirname(REORG_ID_MAP_FILE), { recursive: true });
      fs.writeFileSync(REORG_ID_MAP_FILE, JSON.stringify(idMap), 'utf8');
    } else {
      fs.rmSync(REORG_ID_MAP_FILE, { force: true });
    }

    pendingReorgPlan = null;
    mainWindow?.webContents.send('library:changed', currentState());
    refreshJumpList();
    return {
      ok: true,
      moved: result.moved.length,
      failed: result.failed,
      cancelledEarly: result.cancelledEarly,
    };
  });

  /**
   * Reverses the last reorganize's file moves, then carries id-keyed data
   * back to each book's pre-move id, then a full rescan — simpler and just
   * as correct as hand-reconstructing original sourceDir/tracks, since undo
   * is a rare, explicit action where a one-time re-tag is an acceptable cost.
   */
  ipcMain.handle('reorganize:undo', async () => {
    if (reorganizer.isRunning()) return { ok: false, error: 'A reorganization is currently running.' };

    const result = await reorganizer.undoLastReorganization(
      (p) => mainWindow?.webContents.send('reorganize:progress', p),
    );

    let idMap = {};
    try {
      idMap = JSON.parse(fs.readFileSync(REORG_ID_MAP_FILE, 'utf8'));
    } catch {
      idMap = {};
    }
    for (const [newId, oldId] of Object.entries(idMap)) remapIdKeyedStores(newId, oldId);
    fs.rmSync(REORG_ID_MAP_FILE, { force: true });
    progressStore.flushSync();
    bookmarksStore.flushSync();
    normalizationStore.flushSync();
    metadataStore.flushSync();

    await runScan();
    return { ok: result.ok, errors: result.errors };
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

  // Discord Rich Presence — opt-in (see the topbar toggle), and a no-op if
  // Discord isn't running or no client ID is configured (see discord-presence.js).
  ipcMain.handle('discord:setEnabled', (_event, value) => discord.setEnabled(value));
  ipcMain.handle('discord:updateActivity', (_event, info) => discord.setActivity(info ?? {}));
}

/**
 * Extracted covers (and their thumbnails) live in COVER_CACHE, but the
 * library stores their absolute paths. If the data root moves (e.g. a
 * rename), those paths point at the old location and every cover 404s.
 * Repoints any cover/thumbnail that sits in a `covers` folder other than the
 * current cache, so a move self-heals. Returns a new books array (rather
 * than mutating the objects `libraryState.books` handed in) so the caller
 * can route the result through `libraryStore.set()` — LibraryDb's diffing
 * keys off object *reference* changes, so mutating book.cover in place on
 * objects already sitting in its cache would never actually get queued for
 * a write, even though it looks fixed for the rest of this session.
 */
function normalizeCoverPaths(libraryState) {
  let changed = 0;
  const repoint = (p) => {
    if (!p) return p;
    const dir = path.dirname(p);
    if (path.basename(dir).toLowerCase() === 'covers' && dir !== COVER_CACHE) {
      const moved = path.join(COVER_CACHE, path.basename(p));
      if (fs.existsSync(moved)) return moved;
    }
    return p;
  };
  const books = (libraryState.books ?? []).map((book) => {
    const cover = repoint(book.cover);
    const coverThumb = repoint(book.coverThumb);
    if (cover === book.cover && coverThumb === book.coverThumb) return book;
    changed += 1;
    return { ...book, cover, coverThumb };
  });
  if (changed) console.log(`[library] repointed ${changed} cover path(s) to ${COVER_CACHE}`);
  return { books, changed: changed > 0 };
}

app.whenReady().then(async () => {
  try {
    await libraryStore.load(LIBRARY_FILE);
  } catch (err) {
    // A corrupt/unreadable library.db shouldn't take the whole app down --
    // fall back to an empty library, same as a fresh install. Nothing here
    // is destroyed: the file on disk is left exactly as it was.
    console.error('[db] failed to open library database, starting with an empty library:', err);
  }
  await Promise.all([
    progressStore.load(), bookmarksStore.load(),
    normalizationStore.load(), metadataStore.load(),
    // pairingStore was never loaded here before -- a real pre-existing bug,
    // not something new this store introduces: without this, pairingStore.get()
    // always returned its constructor fallback ({}) for the whole session,
    // so runPairingFill() saw every book as unchecked on every single launch
    // (re-scanning the whole library every time) and the first write of the
    // session would silently overwrite ebook-pairings.json's prior contents,
    // including any manual picks, with data computed from that empty view.
    pairingStore.load(), activityStore.load(),
  ]);
  {
    const state = libraryStore.get();
    const { books, changed } = normalizeCoverPaths(state);
    if (changed) {
      libraryStore.set({ folders: state.folders, books });
      libraryStore.flush();
    }
  }
  // Logged so a memory/disk spike can be correlated against what the
  // renderer actually asked for -- serving a large audio file was invisible
  // in every earlier diagnostic despite being the thing saturating the drive.
  registerMediaProtocol(getAllowedRoots, ({ filePath, size, start, end, ranged, error, roots, detail, url }) => {
    // A media request the app refuses or cannot find surfaces in the UI only
    // as "unsupported or corrupted file" (the renderer sees
    // MEDIA_ERR_SRC_NOT_SUPPORTED and cannot tell why). Always log these --
    // they are rare, and without them a playback failure is undiagnosable.
    if (error) {
      diag(`!!! MEDIA ${error} :: ${filePath ?? url ?? '?'}${detail ? ` (${detail})` : ''}${roots ? ` | allowed roots: ${roots.join(' | ')}` : ''}`);
      return;
    }
    // Counted for *every* request, covers included. An earlier version of
    // this only counted files over 5MB, which made thousands of cover reads
    // invisible -- and the cover cache lives on the data drive, which was
    // observed pegged at 91% while the library drive sat idle.
    const bytes = ranged ? (end - start + 1) : size;
    mediaBytesServed += bytes;
    mediaRequestCount += 1;
    if (!DIAG_VERBOSE || size < 5 * 1024 * 1024) return;
    const span = ranged ? `${start}-${end}` : 'FULL FILE';
    diag(`media request #${mediaRequestCount}: ${span} = ${Math.round(bytes / 1024 / 1024)}MB of ${Math.round(size / 1024 / 1024)}MB file | cumulative served=${Math.round(mediaBytesServed / 1024 / 1024)}MB :: ${path.basename(filePath)}`);
  });
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

// Unlike the other stores, the sqlite-backed library store has no true
// synchronous flush — closing it is a real async operation. Deferring quit
// with preventDefault()/app.quit() (rather than just firing the close and
// not waiting) is what makes that safe: without it, Electron would tear the
// process down while a write could still be in flight.
let readyToQuit = false;
app.on('before-quit', (event) => {
  if (readyToQuit) return;
  event.preventDefault();
  libraryStore.close().catch((err) => {
    console.error('[db] close on quit failed:', err.message);
  }).finally(() => {
    readyToQuit = true;
    app.quit();
  });
  progressStore.flushSync();
  bookmarksStore.flushSync();
  normalizationStore.flushSync();
  metadataStore.flushSync();
  pairingStore.flushSync();
  activityStore.flushSync();
  // Best-effort, not awaited — the RPC pipe closing when this process exits
  // cleans up on Discord's side regardless, so this isn't worth delaying quit for.
  discord.shutdown();
});
