'use strict';

const $ = (id) => document.getElementById(id);

const el = {
  main: $('main'),
  grid: $('grid'), emptyState: $('emptyState'), search: $('search'), libraryLoading: $('libraryLoading'),
  continueSection: $('continueSection'), continueRow: $('continueRow'),
  libraryToolbar: $('libraryToolbar'), filterTabs: $('filterTabs'), filterCount: $('filterCount'),
  groupToggle: $('groupToggle'), sortSelect: $('sortSelect'),
  seriesView: $('seriesView'), seriesTitle: $('seriesTitle'), seriesSub: $('seriesSub'), seriesGrid: $('seriesGrid'),
  libraryView: $('libraryView'), bookView: $('bookView'),
  viewTitle: $('viewTitle'), backBtn: $('backBtn'), scanStatus: $('scanStatus'), themeBtn: $('themeBtn'), themeIcon: $('themeIcon'),
  scanProgressBar: $('scanProgressBar'), scanProgressFill: $('scanProgressFill'),
  addFolderBtn: $('addFolderBtn'), emptyAddBtn: $('emptyAddBtn'), rescanBtn: $('rescanBtn'),
  folders: document.querySelector('.folders'), foldersBtn: $('foldersBtn'), foldersMenu: $('foldersMenu'),
  foldersList: $('foldersList'),
  bookCover: $('bookCover'), bookTitle: $('bookTitle'), bookAuthor: $('bookAuthor'),
  bookSub: $('bookSub'), bookDesc: $('bookDesc'), chapterList: $('chapterList'),
  chapterCount: $('chapterCount'), chapterSearch: $('chapterSearch'),
  resetProgressBtn: $('resetProgressBtn'),
  finishedToggleBtn: $('finishedToggleBtn'),
  metadataBadge: $('metadataBadge'), metadataLookupBtn: $('metadataLookupBtn'),
  metadataRevertBtn: $('metadataRevertBtn'),
  metadataModal: $('metadataModal'), metadataModalClose: $('metadataModalClose'),
  metadataOptIn: $('metadataOptIn'), metadataOptInEnable: $('metadataOptInEnable'),
  metadataOptInCancel: $('metadataOptInCancel'),
  metadataSearchUI: $('metadataSearchUI'), metadataSearchForm: $('metadataSearchForm'),
  metadataQuery: $('metadataQuery'), metadataStatus: $('metadataStatus'),
  metadataResults: $('metadataResults'), metadataPreview: $('metadataPreview'),
  metadataPreviewCover: $('metadataPreviewCover'), metadataPreviewTitle: $('metadataPreviewTitle'),
  metadataPreviewAuthor: $('metadataPreviewAuthor'), metadataPreviewDesc: $('metadataPreviewDesc'),
  metadataApplyBtn: $('metadataApplyBtn'), metadataBackBtn: $('metadataBackBtn'),
  transcribeBtn: $('transcribeBtn'), cancelTranscribeBtn: $('cancelTranscribeBtn'),
  searchTranscriptBtn: $('searchTranscriptBtn'), captionsBtn: $('captionsBtn'),
  deleteTranscriptBtn: $('deleteTranscriptBtn'), transcribeStatus: $('transcribeStatus'),
  captionsBar: $('captionsBar'),
  transcriptModal: $('transcriptModal'), transcriptModalClose: $('transcriptModalClose'),
  transcriptSearchForm: $('transcriptSearchForm'), transcriptQuery: $('transcriptQuery'),
  transcriptStatus: $('transcriptStatus'), transcriptResults: $('transcriptResults'),
  updatesBtn: $('updatesBtn'), updatesDot: $('updatesDot'), discordBtn: $('discordBtn'),
  updatesModal: $('updatesModal'), updatesModalClose: $('updatesModalClose'),
  updatesCurrentVersion: $('updatesCurrentVersion'), updatesStatus: $('updatesStatus'),
  updatesProgressTrack: $('updatesProgressTrack'), updatesProgressFill: $('updatesProgressFill'),
  updatesNotes: $('updatesNotes'), updatesNotesTitle: $('updatesNotesTitle'), updatesNotesBody: $('updatesNotesBody'),
  updatesCheckBtn: $('updatesCheckBtn'), updatesInstallBtn: $('updatesInstallBtn'), updatesLaterBtn: $('updatesLaterBtn'),
  toast: $('toast'), toastMsg: $('toastMsg'), toastUndo: $('toastUndo'),
  dropOverlay: $('dropOverlay'),
  bookmarkBtn: $('bookmarkBtn'), bookmarkHereBtn: $('bookmarkHereBtn'),
  bookmarkList: $('bookmarkList'), bookmarkCount: $('bookmarkCount'),
  player: $('player'), audio: $('audio'), playBtn: $('playBtn'), playIcon: $('playIcon'), seek: $('seek'),
  timeCurrent: $('timeCurrent'), timeTotal: $('timeTotal'),
  prevChapterBtn: $('prevChapterBtn'), nextChapterBtn: $('nextChapterBtn'),
  back30Btn: $('back30Btn'), fwd30Btn: $('fwd30Btn'), skipAmountSelect: $('skipAmount'),
  back30Amount: $('back30Amount'), fwd30Amount: $('fwd30Amount'),
  speed: $('speed'), volume: $('volume'),
  miniCover: $('miniCover'), nowTitle: $('nowTitle'), nowChapter: $('nowChapter'),
  sleep: $('sleep') || document.querySelector('.sleep'),
  sleepBtn: $('sleepBtn'), sleepLabel: $('sleepLabel'), sleepMenu: $('sleepMenu'),
  sleepSnooze: document.querySelector('.sleep-extend'),
  skipSilenceBtn: $('skipSilenceBtn'), normalizeBtn: $('normalizeBtn'),
};

const SKIP_AMOUNTS = new Set([10, 15, 30, 45, 60]);

/**
 * Threshold for the "NEW" badge: books added since the last time the app was
 * opened, Spotify/Netflix-style. Read the timestamp from the *previous*
 * session, then immediately overwrite it with "now" so this session's newly
 * scanned books stay marked new for the whole session but age out next time
 * (rather than the threshold sliding forward on every scan/render, which
 * would make badges disappear as soon as they appeared).
 *
 * First-ever launch has no stored value; default to "now" so a brand new
 * library doesn't show 6,000+ books as NEW.
 */
const LIBRARY_SEEN_AT_KEY = 'libraryLastOpenedAt';
const LIBRARY_SEEN_AT = Number(localStorage.getItem(LIBRARY_SEEN_AT_KEY)) || Date.now();
localStorage.setItem(LIBRARY_SEEN_AT_KEY, String(Date.now()));

/** Distinct from bookStatus()'s 'new' (= not started listening) — this is "recently added to the library". */
function isRecentlyAdded(book) {
  return typeof book?.mtimeMs === 'number' && book.mtimeMs > LIBRARY_SEEN_AT;
}

const state = {
  books: [],
  progress: {},
  bookmarks: {},       // { [bookId]: Bookmark[] }
  folders: [],
  folderCounts: {},    // { [folder]: number of scanned books under it }
  current: null,       // book being viewed
  playing: null,       // book loaded in the player
  trackIndex: -1,      // which file of a multi-track book is loaded
  pendingSeek: null,   // position to apply once the loading track reports metadata
  activeChapter: -1,
  playingChapterIndex: -1, // like activeChapter, but for the OS media-session subtitle — tracks the playing book even when it's not the one currently open in the book view
  seeking: false,
  filter: 'all',       // library filter: all | progress | finished | new
  sort: localStorage.getItem('sort') || 'author',
  skipAmount: SKIP_AMOUNTS.has(Number(localStorage.getItem('skipAmount')))
    ? Number(localStorage.getItem('skipAmount')) : 30,
  skipSilence: localStorage.getItem('skipSilence') === '1',
  baseSpeed: 1,        // the user's chosen speed; skip-silence boosts above it
  silenceBoosting: false,
  normalize: localStorage.getItem('normalize') !== '0', // on by default
  normalization: {},   // { [bookId]: measured gain }
  norm: null,          // in-progress loudness measurement for the current book
  groupSeries: localStorage.getItem('groupSeries') === '1',
  onlineMetadataEnabled: localStorage.getItem('onlineMetadataEnabled') === '1',
  // Off by default — reports what you're listening to externally, so it's
  // opt-in like the online metadata lookup, not a launch-time default.
  discordPresence: localStorage.getItem('discordPresence') === '1',
  metadataResults: [],   // last Open Library search results for the modal
  metadataPicked: null,  // the candidate currently shown in the preview pane
  appVersion: null,      // this build's version, fetched once from the main process
  update: { state: 'idle' }, // last status pushed from updater.js: { state, version, releaseNotes, percent, error }
  viewingSeries: null, // the series group currently shown in the series view
  bookReturnsToSeries: null, // where the book view's back button should return
  pausedAt: 0,         // timestamp of the last pause, for resume auto-rewind
  displayItems: [],    // grid items (book cards and series tiles) after filtering
  seriesByKey: new Map(), // group.key -> group, for the grid's delegated click handler
  filtered: [],        // books matching the current search
  gridShown: 0,        // how many cards are currently in the DOM
  userVolume: 1,       // volume the user set; audio volume = this * sleep fade
  sleep: {
    mode: 'off',       // 'off' | 'duration' | 'chapter' | 'book'
    remainingMs: 0,    // duration mode: playback time left before firing
    fadeGain: 1,       // 1 normally, ramps to 0 over the closing fade
    firedPaused: false,// true when the timer paused us (so resume rewinds)
  },
  // Transcription (local Whisper) — transcribeState tracks the book currently
  // shown in the book view; transcriptCache holds loaded transcripts keyed by
  // bookId so re-opening the search modal or toggling captions doesn't
  // re-fetch over IPC every time. Captions are a simple global toggle, same
  // pattern as skip-silence/normalize.
  transcribeState: { bookId: null, phase: null, percent: 0 },
  transcriptCache: new Map(), // bookId -> { segments: [...] } | null (null = fetched, has none)
  captionsOn: localStorage.getItem('captionsOn') === '1',
  captionIndex: -1, // index into the current transcript's segments last shown as a caption
};

let gridObserver = null;
const SLEEP_FADE_SEC = 20;   // gentle fade over the final stretch
const SLEEP_REWIND_SEC = 30; // rewind on resume after the timer stops you

/* ---------------- series detection ----------------
 * Series name + volume number are derived from the book title (and author),
 * which we already have — no re-scan or main-process work needed. Grouping is
 * conservative: a series tile only forms when 2+ books share a series name AND
 * author, which keeps multi-author franchises (e.g. "Star Wars") from
 * collapsing into one meaningless pile.
 */
const SERIES_SEP = '[:\\-\\u2013\\u2014]';
const SERIES_BOOKWORD = '(?:Book|Vol\\.?|Volume|Part|Episode)';
const SERIES_PATTERNS = [
  // "Warmage: Spellmonger, Book 2" | "The Way of Kings - The Stormlight Archive, Book 1"
  [new RegExp(`^(.*?)\\s*${SERIES_SEP}\\s*(.+?),?\\s+${SERIES_BOOKWORD}\\s*(\\d+)`, 'i'), 2, 3],
  // "(The Other Realm #7)" | "(Cradle, Book 3)"
  [new RegExp(`\\((?:The\\s+)?(.+?)[,\\s]+(?:${SERIES_BOOKWORD}\\s*)?#?\\s*(\\d+)\\)`, 'i'), 1, 2],
  // "The Other Realm 07 - Glimmer of the Other" (number in the middle)
  [new RegExp(`^(?:.*?\\s${SERIES_SEP}\\s)?(?:The\\s+)?(.+?)\\s+(\\d{1,3})\\s*${SERIES_SEP}\\s`, 'i'), 1, 2],
  // "... Series, Book 4"
  [new RegExp(`^.*?,?\\s*(?:The\\s+)?(.+?)\\s+Series,?\\s+${SERIES_BOOKWORD}\\s*(\\d+)`, 'i'), 1, 2],
  // trailing "... Book 3" / "... #3"
  [new RegExp(`^(.+?)\\s+(?:${SERIES_BOOKWORD}|#)\\s*(\\d+)\\s*$`, 'i'), 1, 2],
];
const SERIES_BLOCKLIST = new Set([
  'star wars', 'complete', 'unabridged', 'the', 'a', 'novel', 'box set',
  'collection', 'book', 'dead', 'audiobook', 'series',
]);

function cleanSeriesName(s) {
  return s
    .replace(/\s*\(unabridged\)\s*/i, '')
    .replace(/^the\s+/i, '')
    .replace(/\s+series\s*$/i, '')
    .replace(/[\s,:–-]+(?:Book|Vol\.?|Volume|Part|Episode)\s*$/i, '')
    .replace(/[\s,:–-]+$/, '')
    .trim();
}

/** @returns {{series: string, index: number} | null} */
function parseSeries(title) {
  for (const [re, sg, ig] of SERIES_PATTERNS) {
    const m = re.exec(title);
    if (!m) continue;
    const series = cleanSeriesName(m[sg]);
    const index = Number(m[ig]);
    if (series && series.length >= 3 && index > 0 && index < 200
        && !SERIES_BLOCKLIST.has(series.toLowerCase())) {
      return { series, index };
    }
  }
  return null;
}

const seriesNorm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const seriesKeyFor = (series, author) => `${seriesNorm(series)}::${seriesNorm(author)}`;

/**
 * Turn a flat book list into display items: a series with 2+ present volumes
 * becomes one `series` tile (emitted at the position of its first volume);
 * everything else stays an individual `book` card. Order is otherwise preserved.
 */
function buildDisplayItems(books) {
  // parseSeries runs regex matching against every title; computed once per
  // book here and reused below, instead of parsing the same title twice.
  const parsed = books.map((b) => ({ book: b, p: parseSeries(b.title) }));

  const groups = new Map();
  for (const { book: b, p } of parsed) {
    if (!p) continue;
    const key = seriesKeyFor(p.series, b.author);
    if (!groups.has(key)) groups.set(key, { key, name: p.series, author: b.author, volumes: [] });
    groups.get(key).volumes.push({ book: b, index: p.index });
  }
  const realSeries = new Set([...groups.values()].filter((g) => g.volumes.length >= 2).map((g) => g.key));

  const items = [];
  const emitted = new Set();
  for (const { book: b, p } of parsed) {
    const key = p ? seriesKeyFor(p.series, b.author) : null;
    if (key && realSeries.has(key)) {
      if (!emitted.has(key)) {
        emitted.add(key);
        const g = groups.get(key);
        g.volumes.sort((x, y) => x.index - y.index);
        items.push({ type: 'series', series: g });
      }
    } else {
      items.push({ type: 'book', book: b });
    }
  }
  return items;
}

/* ---------------- undo toast ---------------- */

const TOAST_MS = 6000;
let toastTimer = null;
let toastUndoFn = null;

/**
 * Show a brief "<message> [Undo]" toast. The action has already happened by the
 * time this is called — `undoFn` reverses it if the user clicks Undo before the
 * toast times out. Showing a new toast silently drops any pending one's undo
 * window, matching the usual behavior of undo-toasts elsewhere (e.g. Gmail).
 */
function showToast(message, undoFn) {
  clearTimeout(toastTimer);
  toastUndoFn = undoFn;
  el.toastMsg.textContent = message;
  // Info-only messages (no undoFn, e.g. "that wasn't a folder") skip the Undo
  // button entirely rather than showing one that would do nothing.
  el.toastUndo.classList.toggle('hidden', !undoFn);
  el.toast.classList.remove('hidden');
  toastTimer = setTimeout(hideToast, TOAST_MS);
}

function hideToast() {
  clearTimeout(toastTimer);
  toastTimer = null;
  toastUndoFn = null;
  el.toast.classList.add('hidden');
}

el.toastUndo.addEventListener('click', async () => {
  const fn = toastUndoFn;
  hideToast();
  if (fn) await fn();
});

/* ---------------- helpers ---------------- */

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function formatDurationLong(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'Unknown length';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

/* ---------------- library grid ---------------- */

const GRID_PAGE = 120;

function buildCard(book, { badge, delegate } = {}) {
  const saved = state.progress[book.id];
  // A finished book always reads as a full bar, even if it was marked finished
  // manually (e.g. "finished elsewhere") with little or no listening position
  // actually recorded here — showing a near-empty bar for a "Finished" book
  // would look like a bug.
  const pct = isFinished(saved)
    ? 100
    : (saved && book.duration ? Math.min(100, (saved.position / book.duration) * 100) : 0);

  const card = document.createElement('div');
  card.className = 'card';
  card.tabIndex = 0;
  card.setAttribute('role', 'button');

  const art = document.createElement('div');
  art.className = 'card-art';
  if (book.coverUrl) {
    const img = document.createElement('img');
    img.src = book.coverUrl;
    img.alt = `${book.title} cover`;
    img.loading = 'lazy';
    art.append(img);
  } else {
    const ph = document.createElement('div');
    ph.className = 'placeholder';
    ph.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#icon-headphones"></use></svg>';
    art.append(ph);
  }
  if (badge) {
    const b = document.createElement('div');
    b.className = 'card-badge';
    b.textContent = badge;
    art.append(b);
  }
  if (isRecentlyAdded(book)) {
    const n = document.createElement('div');
    n.className = 'new-badge';
    n.textContent = 'NEW';
    art.append(n);
  }
  if (pct > 0) {
    const bar = document.createElement('div');
    bar.className = 'card-bar';
    const fill = document.createElement('span');
    fill.style.width = `${pct}%`;
    bar.append(fill);
    art.append(bar);
  }

  const title = document.createElement('div');
  title.className = 'card-title';
  title.textContent = book.title;

  const author = document.createElement('div');
  author.className = 'card-author';
  author.textContent = book.author;

  card.append(art, title, author);
  // Titles/authors are clamped to 2 lines and often longer than that in a
  // real library (box sets, subtitles) — a native tooltip is the only way to
  // read the rest without opening the book.
  card.title = `${book.title} — ${book.author}`;
  card.dataset.bookId = book.id;
  // The main grid can hold thousands of these; it wires one delegated pair of
  // listeners instead (see the el.grid listeners below `appendGridPage`) and
  // opts out here via `delegate`. The continue-listening shelf and series view
  // stay small (bounded to 15 / one series), so per-card listeners there are
  // fine as-is.
  if (!delegate) {
    card.addEventListener('click', () => openBook(book.id));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openBook(book.id); }
    });
  }
  return card;
}

/** Where a book sits in its lifecycle, from saved progress. */
/** True/false auto-computed from listening position, unless manually overridden. */
function isFinished(p) {
  return (p?.finishedOverride ?? p?.finished) || false;
}

function bookStatus(bookId) {
  const p = state.progress[bookId];
  if (!p) return 'new';
  if (isFinished(p)) return 'finished';
  if (p.position > 30) return 'progress';
  return 'new';
}

function matchesFilter(book) {
  switch (state.filter) {
    case 'progress': return bookStatus(book.id) === 'progress';
    case 'finished': return bookStatus(book.id) === 'finished';
    case 'new': return bookStatus(book.id) === 'new';
    default: return true;
  }
}

const byAuthor = (a, b) => a.author.localeCompare(b.author) || a.title.localeCompare(b.title);

/** Sort a copy of `books` by the current sort mode. */
function sortBooks(books) {
  const list = [...books];
  switch (state.sort) {
    case 'title':
      return list.sort((a, b) => a.title.localeCompare(b.title));
    case 'added':
      return list.sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0) || byAuthor(a, b));
    case 'played':
      return list.sort((a, b) =>
        (state.progress[b.id]?.updatedAt ?? 0) - (state.progress[a.id]?.updatedAt ?? 0) || byAuthor(a, b));
    case 'longest':
      return list.sort((a, b) => (b.duration || 0) - (a.duration || 0));
    case 'shortest':
      return list.sort((a, b) => (a.duration || 0) - (b.duration || 0));
    default: // author
      return list.sort(byAuthor);
  }
}

/** Render the whole library view: Continue-listening shelf, toolbar, grid. */
function renderLibrary() {
  renderContinueShelf();
  renderGrid();
}

/* ---------------- library folders ---------------- */

/** Trim a long path to its tail so the popover shows the meaningful part. */
function shortenPath(p, max = 46) {
  if (p.length <= max) return p;
  return `…${p.slice(-(max - 1))}`;
}

function renderFoldersMenu() {
  el.foldersList.replaceChildren();

  if (!state.folders.length) {
    const li = document.createElement('li');
    li.className = 'folders-empty';
    li.textContent = 'No folders added yet.';
    el.foldersList.append(li);
    return;
  }

  for (const folder of state.folders) {
    const li = document.createElement('li');
    li.className = 'folder-row';

    const info = document.createElement('div');
    info.className = 'folder-info';
    const pathEl = document.createElement('div');
    pathEl.className = 'folder-path';
    pathEl.textContent = shortenPath(folder);
    pathEl.title = folder;
    const count = document.createElement('div');
    count.className = 'folder-count';
    const n = state.folderCounts[folder] ?? 0;
    count.textContent = `${n.toLocaleString()} book${n === 1 ? '' : 's'}`;
    info.append(pathEl, count);

    const remove = document.createElement('button');
    remove.className = 'folder-remove';
    remove.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#icon-x"></use></svg>';
    remove.title = 'Remove this folder from the library';
    remove.setAttribute('aria-label', `Remove ${folder}`);
    remove.addEventListener('click', () => removeFolder(folder, n));

    li.append(info, remove);
    el.foldersList.append(li);
  }
}

async function removeFolder(folder, bookCount) {
  // Removing a folder can silently drop hundreds of books in one click, unlike
  // most other actions in the app — worth a native confirm even before the
  // general confirm-before-destructive-action treatment lands.
  const msg = bookCount
    ? `Remove this folder from your library?\n\n${folder}\n\nThis removes ${bookCount.toLocaleString()} book${bookCount === 1 ? '' : 's'} from Midnight Athenaeum. The files on disk are not touched.`
    : `Remove this folder from your library?\n\n${folder}`;
  if (!window.confirm(msg)) return;

  try {
    const next = await window.api.removeFolder(folder);
    applyState(next);
    renderFoldersMenu();
  } catch (err) {
    reportFolderError('remove that folder', err);
  }
}

function openFoldersMenu(open) {
  el.foldersMenu.classList.toggle('hidden', !open);
  el.foldersBtn.setAttribute('aria-expanded', String(open));
  if (open) renderFoldersMenu();
}

el.foldersBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  openFoldersMenu(el.foldersMenu.classList.contains('hidden'));
});
document.addEventListener('click', (e) => {
  if (!el.folders?.contains(e.target)) openFoldersMenu(false);
});

/** Books you're partway through, most-recently-played first. */
function renderContinueShelf() {
  const query = el.search.value.trim().toLowerCase();
  // The shelf is a shortcut to "what I'm on"; hide it while searching/filtering.
  const show = !query && state.filter === 'all';

  const inProgress = show
    ? state.books
        .filter((b) => bookStatus(b.id) === 'progress')
        .sort((a, b) => (state.progress[b.id]?.updatedAt ?? 0) - (state.progress[a.id]?.updatedAt ?? 0))
        .slice(0, 15)
    : [];

  el.continueSection.classList.toggle('hidden', inProgress.length === 0);
  el.continueRow.replaceChildren();
  for (const book of inProgress) el.continueRow.append(buildCard(book));
}

/** A tile standing in for a whole series; opens the series view on click. */
function buildSeriesTile(group, { delegate } = {}) {
  const first = group.volumes.find((v) => v.book.coverUrl) ?? group.volumes[0];

  const card = document.createElement('div');
  card.className = 'card series-card';
  card.tabIndex = 0;
  card.setAttribute('role', 'button');

  const art = document.createElement('div');
  art.className = 'series-art';
  if (first.book.coverUrl) {
    const img = document.createElement('img');
    img.className = 'series-cover';
    img.src = first.book.coverUrl;
    img.alt = `${group.name} series`;
    img.loading = 'lazy';
    art.append(img);
  } else {
    const ph = document.createElement('div');
    ph.className = 'series-cover placeholder';
    ph.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#icon-book-open"></use></svg>';
    art.append(ph);
  }
  const badge = document.createElement('div');
  badge.className = 'series-badge';
  badge.textContent = `${group.volumes.length}`;
  art.append(badge);

  // A NEW volume added to a series you already own is exactly the kind of
  // library growth this badge exists for — without this, grouping series
  // (which hides individual volumes behind the tile) would make the badge
  // invisible for most of a library that uses that view.
  if (group.volumes.some((v) => isRecentlyAdded(v.book))) {
    const n = document.createElement('div');
    n.className = 'new-badge new-badge-series';
    n.textContent = 'NEW';
    art.append(n);
  }

  const title = document.createElement('div');
  title.className = 'card-title';
  title.textContent = group.name;

  const author = document.createElement('div');
  author.className = 'card-author';
  author.textContent = group.author;

  card.append(art, title, author);
  card.title = `${group.name} — ${group.author} (${group.volumes.length} books)`;
  card.dataset.seriesKey = group.key;
  if (!delegate) {
    card.addEventListener('click', () => openSeries(group));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSeries(group); }
    });
  }
  return card;
}

/**
 * A 10k-book library is far too many cards to put in the DOM at once (it costs
 * ~2 GB). Render in pages and append the next one when a sentinel near the
 * bottom scrolls into view, so the node count tracks how far the user has
 * actually scrolled rather than the library size.
 */
function renderGrid() {
  const query = el.search.value.trim().toLowerCase();
  const matched = state.books.filter((b) => {
    if (!matchesFilter(b)) return false;
    if (!query) return true;
    return b.title.toLowerCase().includes(query) || b.author.toLowerCase().includes(query);
  });
  state.filtered = sortBooks(matched);

  state.displayItems = state.groupSeries
    ? buildDisplayItems(state.filtered)
    : state.filtered.map((book) => ({ type: 'book', book }));

  // Looked up by the grid's delegated click/keydown handler (below), since
  // series cards there carry only a data-series-key, not the group object.
  state.seriesByKey = new Map(
    state.displayItems.filter((i) => i.type === 'series').map((i) => [i.series.key, i.series]),
  );

  const seriesCount = state.displayItems.filter((i) => i.type === 'series').length;

  el.emptyState.classList.toggle('hidden', state.books.length > 0);
  el.libraryToolbar.classList.toggle('hidden', state.books.length === 0);
  el.filterCount.textContent = seriesCount
    ? `${state.filtered.length.toLocaleString()} books · ${seriesCount} series`
    : `${state.filtered.length.toLocaleString()} book${state.filtered.length === 1 ? '' : 's'}`;

  gridObserver?.disconnect();
  el.grid.replaceChildren();
  state.gridShown = 0;
  appendGridPage();
}

function appendGridPage() {
  const items = state.displayItems;
  const end = Math.min(state.gridShown + GRID_PAGE, items.length);
  const frag = document.createDocumentFragment();
  for (let i = state.gridShown; i < end; i += 1) {
    const item = items[i];
    frag.append(item.type === 'series'
      ? buildSeriesTile(item.series, { delegate: true })
      : buildCard(item.book, { delegate: true }));
  }
  el.grid.append(frag);
  state.gridShown = end;

  if (end < items.length) {
    const sentinel = document.createElement('div');
    sentinel.className = 'grid-sentinel';
    el.grid.append(sentinel);
    gridObserver = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        gridObserver.disconnect();
        sentinel.remove();
        appendGridPage();
      }
    }, { root: el.main, rootMargin: '600px' });
    gridObserver.observe(sentinel);
  }
}

/**
 * One delegated click/keydown pair for the whole main grid, instead of a
 * listener per card — el.grid's own children get replaced on every
 * renderGrid(), but the container itself (and these listeners) persist for
 * the app's lifetime, so listener count stays flat no matter how many
 * thousands of cards have scrolled through.
 */
function activateGridCard(card) {
  if (card.dataset.seriesKey) {
    const group = state.seriesByKey.get(card.dataset.seriesKey);
    if (group) openSeries(group);
    return;
  }
  if (card.dataset.bookId) openBook(card.dataset.bookId);
}
el.grid.addEventListener('click', (e) => {
  const card = e.target.closest('.card');
  if (card && el.grid.contains(card)) activateGridCard(card);
});
el.grid.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const card = e.target.closest('.card');
  if (!card || !el.grid.contains(card)) return;
  e.preventDefault();
  activateGridCard(card);
});

/* ---------------- series view ---------------- */

function openSeries(group) {
  state.viewingSeries = group;
  el.libraryView.classList.add('hidden');
  el.bookView.classList.add('hidden');
  el.seriesView.classList.remove('hidden');
  el.backBtn.classList.remove('hidden');
  el.viewTitle.textContent = group.name;
  el.main.scrollTop = 0;

  const hours = group.volumes.reduce((sum, v) => sum + (v.book.duration || 0), 0) / 3600;
  el.seriesTitle.textContent = group.name;
  el.seriesSub.textContent = `${group.author} · ${group.volumes.length} books · ${Math.round(hours)} hrs`;

  el.seriesGrid.replaceChildren();
  for (const v of group.volumes) {
    const card = buildCard(v.book, { badge: `#${v.index}` });
    // Runs after the card's own openBook() (which clears the flag), so opening a
    // volume returns here rather than to the library.
    card.addEventListener('click', () => { state.bookReturnsToSeries = group; });
    el.seriesGrid.append(card);
  }
}

/* ---------------- book view ---------------- */

function showLibrary() {
  state.current = null;
  state.viewingSeries = null;
  state.bookReturnsToSeries = null;
  el.libraryView.classList.remove('hidden');
  el.bookView.classList.add('hidden');
  el.seriesView.classList.add('hidden');
  el.backBtn.classList.add('hidden');
  el.viewTitle.textContent = 'Library';
  renderLibrary();
}

/** Back button: return to the series view if we came from one, else the library. */
function goBack() {
  if (!el.bookView.classList.contains('hidden') && state.bookReturnsToSeries) {
    openSeries(state.bookReturnsToSeries);
  } else {
    showLibrary();
  }
}

/** The header block (cover/title/author/sub/description) — split out of openBook() so applyState() can refresh it in place after a metadata edit, without touching playback or the chapter search. */
function renderBookHeader(book) {
  el.viewTitle.textContent = book.title;
  el.bookCover.src = book.coverUrl || '';
  el.bookCover.alt = book.coverUrl ? `${book.title} cover` : '';
  el.bookTitle.textContent = book.title;
  el.bookAuthor.textContent = book.author;

  const bits = [formatDurationLong(book.duration)];
  if (book.narrator) bits.push(`Narrated by ${book.narrator}`);
  if (book.year) bits.push(String(book.year));
  bits.push(book.kind === 'multi' ? `${book.trackCount} files` : book.fileName);
  el.bookSub.textContent = bits.join(' · ');

  el.bookDesc.textContent = book.description || '';
  el.bookDesc.classList.toggle('hidden', !book.description);
}

function openBook(bookId) {
  const book = state.books.find((b) => b.id === bookId);
  if (!book) return;

  state.current = book;
  state.bookReturnsToSeries = null; // series volumes re-set this after this runs
  el.chapterSearch.value = ''; // start each book's chapter list unfiltered
  el.libraryView.classList.add('hidden');
  el.seriesView.classList.add('hidden');
  el.bookView.classList.remove('hidden');
  el.backBtn.classList.remove('hidden');

  renderBookHeader(book);
  renderChapters(book);
  renderBookmarks(book);
  updateFinishedButton(book);
  updateMetadataUI(book);
  updateTranscribeUI(book);
  loadIntoPlayer(book);
}

/** Reflect the book's effective finished status on the toggle button's label. */
function updateFinishedButton(book) {
  const finished = isFinished(state.progress[book.id]);
  el.finishedToggleBtn.textContent = finished ? 'Mark as not finished' : 'Mark as finished';
  el.finishedToggleBtn.setAttribute('aria-pressed', String(finished));
}

/** Show/hide the "via Open Library" provenance badge and the revert action. */
function updateMetadataUI(book) {
  const hasOverride = Boolean(book.metadataSource);
  el.metadataBadge.classList.toggle('hidden', !hasOverride);
  el.metadataBadge.textContent = hasOverride ? `via ${sourceLabel(book.metadataSource)}` : '';
  el.metadataRevertBtn.classList.toggle('hidden', !hasOverride);
}

function sourceLabel(source) {
  return source === 'openlibrary' ? 'Open Library' : source;
}

/** Manually force (or clear) a book's finished status; wins over the auto-computed one. */
async function setBookFinished(book, finished) {
  state.progress = await window.api.setFinished({ bookId: book.id, finished });
  updateFinishedButton(book);
  renderLibrary();
}

/**
 * Long chapter lists (Wind and Truth alone has 212) are unusable by scrolling
 * alone, so #chapterSearch filters this list the same way the library search
 * filters the grid. Rows keep their original array index in dataset.index even
 * when filtered, so highlightChapter() (which matches on that) and click-to-seek
 * keep working unchanged.
 */
function renderChapters(book) {
  el.chapterList.replaceChildren();

  const total = book.chapters.length;
  const query = el.chapterSearch.value.trim().toLowerCase();
  el.chapterSearch.classList.toggle('hidden', total === 0);

  if (!total) {
    el.chapterCount.textContent = '';
    const li = document.createElement('li');
    li.className = 'no-chapters';
    li.textContent = 'This file has no embedded chapters — use the 30-second skip buttons to navigate.';
    el.chapterList.append(li);
    return;
  }

  const matches = query
    ? book.chapters
        .map((ch, i) => ({ ch, i }))
        .filter(({ ch, i }) => ch.title.toLowerCase().includes(query) || String(i + 1) === query)
    : book.chapters.map((ch, i) => ({ ch, i }));

  el.chapterCount.textContent = query ? `(${matches.length} of ${total})` : `(${total})`;

  if (!matches.length) {
    const li = document.createElement('li');
    li.className = 'no-chapters';
    li.textContent = `No chapters match "${el.chapterSearch.value.trim()}".`;
    el.chapterList.append(li);
    return;
  }

  for (const { ch, i } of matches) {
    const li = document.createElement('li');
    li.className = 'chapter';
    li.dataset.index = String(i);

    const num = document.createElement('span');
    num.className = 'chapter-num';
    num.textContent = String(i + 1);

    const title = document.createElement('span');
    title.className = 'chapter-title';
    title.textContent = ch.title;

    const time = document.createElement('span');
    time.className = 'chapter-time';
    time.textContent = formatTime(ch.start);

    li.append(num, title, time);
    li.addEventListener('click', () => {
      if (state.playing?.id !== book.id) loadIntoPlayer(book);
      seekTo(ch.start, { autoplay: true });
    });
    el.chapterList.append(li);
  }

  // The active-chapter highlight is set by index, so re-apply it after a
  // re-render (e.g. from typing) rather than waiting for the next tick.
  const activeNode = el.chapterList.querySelector(`.chapter[data-index="${state.activeChapter}"]`);
  if (activeNode) activeNode.classList.add('active');
}

/* ---------------- bookmarks ---------------- */

function bookmarksFor(bookId) {
  return [...(state.bookmarks[bookId] ?? [])].sort((a, b) => a.position - b.position);
}

function renderBookmarks(book) {
  const list = bookmarksFor(book.id);
  el.bookmarkList.replaceChildren();
  el.bookmarkCount.textContent = list.length ? `(${list.length})` : '';

  if (!list.length) {
    const li = document.createElement('li');
    li.className = 'no-bookmarks';
    li.textContent = 'No bookmarks yet — press B or the bookmark button while listening to mark a spot.';
    el.bookmarkList.append(li);
    return;
  }

  for (const bm of list) {
    const row = buildBookmarkRow(book, bm);
    el.bookmarkList.append(row);
    autoGrow(row.querySelector('.bookmark-note')); // needs to be in the DOM for scrollHeight
  }
}

function buildBookmarkRow(book, bm) {
  const li = document.createElement('li');
  li.className = `bookmark${bm.auto ? ' auto' : ''}`;
  li.dataset.id = bm.id;

  const jump = document.createElement('button');
  jump.className = 'bookmark-jump';
  jump.textContent = formatTime(bm.position);
  jump.title = 'Jump to this spot';
  jump.addEventListener('click', () => {
    if (state.playing?.id !== book.id) loadIntoPlayer(book);
    seekTo(bm.position, { autoplay: true });
  });

  const body = document.createElement('div');
  body.className = 'bookmark-body';

  const label = document.createElement('input');
  label.className = 'bookmark-label';
  label.value = bm.label || '';
  label.placeholder = 'Bookmark';
  label.setAttribute('aria-label', 'Bookmark label');
  commitOnEdit(label, () => saveBookmark(book.id, bm.id, { label: label.value }));

  const note = document.createElement('textarea');
  note.className = 'bookmark-note';
  note.rows = 1;
  note.value = bm.note || '';
  note.placeholder = 'Add a note…';
  note.classList.toggle('empty', !bm.note);
  note.addEventListener('input', () => { autoGrow(note); note.classList.toggle('empty', !note.value); });
  commitOnEdit(note, () => saveBookmark(book.id, bm.id, { note: note.value }), { allowNewline: true });

  body.append(label, note);

  const actions = document.createElement('div');
  actions.className = 'bookmark-actions';
  const del = document.createElement('button');
  del.className = 'bookmark-del';
  del.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#icon-trash"></use></svg>';
  del.title = 'Delete bookmark';
  del.addEventListener('click', async () => {
    state.bookmarks = await window.api.removeBookmark({ bookId: book.id, id: bm.id });
    refreshBookmarksView();
    showToast('Bookmark deleted.', () => restoreBookmark(book.id, bm));
  });
  actions.append(del);

  li.append(jump, body, actions);
  return li;
}

/** Save on Enter (Shift+Enter allowed for notes) or blur, if the value changed. */
function commitOnEdit(input, save, { allowNewline = false } = {}) {
  let original = input.value;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !(allowNewline && e.shiftKey)) { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = original; input.blur(); }
    e.stopPropagation(); // don't trigger global player shortcuts while typing
  });
  input.addEventListener('blur', () => {
    if (input.value !== original) { original = input.value; save(); }
  });
}

function autoGrow(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${textarea.scrollHeight}px`;
}

async function saveBookmark(bookId, id, fields) {
  state.bookmarks = await window.api.updateBookmark({ bookId, id, ...fields });
  // Editing promotes an auto bookmark to permanent; reflect that styling.
  refreshBookmarksView();
}

/** Re-render the bookmarks list if its book is the one on screen. */
function refreshBookmarksView() {
  if (state.current) renderBookmarks(state.current);
}

/**
 * Undo side of a bookmark delete: puts the exact same object back (same id,
 * label, note, createdAt) rather than minting a new bookmark via addBookmark.
 */
async function restoreBookmark(bookId, bookmark) {
  state.bookmarks = await window.api.restoreBookmark({ bookId, bookmark });
  refreshBookmarksView();
}

/**
 * Add a bookmark at the current position. Manual bookmarks default their label
 * to the current chapter; the auto "last stop" marker is dropped on manual pause.
 */
async function addBookmark({ auto = false } = {}) {
  const book = state.playing || state.current;
  if (!book) return;
  const position = state.playing?.id === book.id ? globalTime() : (state.progress[book.id]?.position ?? 0);

  let label = '';
  if (auto) {
    label = 'Last stop';
  } else if (book.chapters.length) {
    label = book.chapters[chapterAt(book, position)]?.title ?? '';
  }

  state.bookmarks = await window.api.addBookmark({ bookId: book.id, position, label, note: '', auto });
  refreshBookmarksView();
  if (!auto) flashBookmarkButton();
}

function flashBookmarkButton() {
  el.bookmarkBtn.classList.remove('flash');
  void el.bookmarkBtn.offsetWidth; // restart the animation
  el.bookmarkBtn.classList.add('flash');
}

function highlightChapter(index) {
  if (index === state.activeChapter) return;
  state.activeChapter = index;
  for (const node of el.chapterList.querySelectorAll('.chapter')) {
    node.classList.toggle('active', Number(node.dataset.index) === index);
  }
}

/* ---------------- player ---------------- */

function chapterAt(book, time) {
  if (!book?.chapters.length) return -1;
  for (let i = book.chapters.length - 1; i >= 0; i -= 1) {
    if (time >= book.chapters[i].start - 0.25) return i;
  }
  return 0;
}

/**
 * Multi-track books play as one continuous timeline: a single <audio> element
 * swaps its source as playback crosses file boundaries, while every position we
 * expose (seek bar, chapters, saved progress) is in whole-book seconds.
 */
function trackIndexAt(book, globalTime) {
  const { tracks } = book;
  for (let i = tracks.length - 1; i >= 0; i -= 1) {
    if (globalTime >= tracks[i].offset) return i;
  }
  return 0;
}

function globalTime() {
  const book = state.playing;
  if (!book) return 0;
  const track = book.tracks[state.trackIndex];
  // While a seek is still pending (the track's metadata hasn't loaded yet),
  // el.audio.currentTime reads 0 — report the intended target instead so
  // bookmarks and progress captured during load reflect where we're going.
  const local = state.pendingSeek != null
    ? state.pendingSeek
    : (Number.isFinite(el.audio.currentTime) ? el.audio.currentTime : 0);
  return (track?.offset ?? 0) + local;
}

/**
 * Whole-book length. A handful of files have unreadable headers so the scan
 * stored duration 0; for a single-track book the <audio> element knows the real
 * length once loaded, so fall back to that rather than showing a dead seek bar.
 */
function effectiveDuration(book) {
  if (book?.duration) return book.duration;
  if (book && book.tracks.length === 1 && Number.isFinite(el.audio.duration)) {
    return el.audio.duration;
  }
  return 0;
}

/**
 * Surfaces the book to Windows' media flyout / lock screen (System Media
 * Transport Controls) via the standard mediaSession web API — Chromium wires
 * this up to the OS on its own, no native module needed. `album` starts
 * empty and gets the current chapter name from updateTimeUI once playback
 * reports a position, since that's more useful there than a static field.
 */
function setMediaSessionMetadata(book) {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: book.title,
    artist: book.author || '',
    artwork: book.coverUrl ? [{ src: book.coverUrl, sizes: '512x512', type: 'image/jpeg' }] : [],
  });
  state.playingChapterIndex = -1; // force updateTimeUI to (re)set the chapter subtitle
}

function loadIntoPlayer(book) {
  if (state.playing?.id === book.id) return;

  flushProgress();
  state.playing = book;
  state.activeChapter = -1;
  state.trackIndex = -1;
  state.captionIndex = -1;
  el.captionsBar.classList.add('hidden');

  el.player.classList.remove('hidden');
  document.body.classList.add('playing');

  el.miniCover.src = book.coverUrl || '';
  el.nowTitle.textContent = book.title;
  el.nowChapter.textContent = book.author;
  el.timeTotal.textContent = formatTime(book.duration);
  setMediaSessionMetadata(book);

  const saved = state.progress[book.id];
  applySpeed(saved?.speed ?? 1);
  state.pausedAt = 0; // don't auto-rewind on the first play of a freshly opened book
  startNormalization(book);

  const resumeAt = saved && !saved.finished ? saved.position : 0;
  seekTo(resumeAt, { autoplay: false });
}

/**
 * Set the playback speed and remember it. `defaultPlaybackRate` is set too so it
 * survives loading the next track of a multi-file book (loading resets
 * playbackRate to the default).
 */
function applySpeed(rate) {
  const r = Number(rate) || 1;
  state.baseSpeed = r;
  el.speed.value = String(r);
  el.audio.defaultPlaybackRate = r;
  // While skip-silence is actively boosting, leave the momentary rate alone;
  // the controller restores it to baseSpeed when speech resumes.
  if (!state.silenceBoosting) el.audio.playbackRate = r;
}

/**
 * Set the back/forward skip amount (seconds) used by the rewind/forward
 * buttons and the plain arrow-key shortcuts, and update the buttons' number
 * labels to match — so a 15s setting actually shows "15", not a stale "30".
 * Persisted; Shift+arrow's 5-minute jump is a separate, fixed "big skip" and
 * isn't affected.
 */
function applySkipAmount(seconds) {
  const s = SKIP_AMOUNTS.has(Number(seconds)) ? Number(seconds) : 30;
  state.skipAmount = s;
  localStorage.setItem('skipAmount', String(s));
  el.skipAmountSelect.value = String(s);
  el.back30Amount.textContent = s;
  el.back30Btn.title = `Back ${s} seconds`;
  el.back30Btn.setAttribute('aria-label', `Back ${s} seconds`);
  el.fwd30Amount.textContent = s;
  el.fwd30Btn.title = `Forward ${s} seconds`;
  el.fwd30Btn.setAttribute('aria-label', `Forward ${s} seconds`);
}

/* ---------------- skip silence ----------------
 * Route the <audio> through a Web Audio AnalyserNode and, when it detects a
 * sustained quiet gap, briefly raise playbackRate so the gap plays through fast
 * instead of being heard — reclaiming the dead air in a book without a hard cut.
 * The ab-media:// responses carry Access-Control-Allow-Origin and the element is
 * crossOrigin='anonymous', so the analyser isn't tainted (would read zeros).
 */
const SILENCE_RMS = 0.01;     // below this = quiet (speech sits well above, ~0.03+)
const SILENCE_ENTER_MS = 200; // sustained quiet before boosting (skip pauses, not word gaps)
const SILENCE_BOOST = 3;      // multiply base speed while skipping
const SILENCE_MAX_RATE = 4;   // keep playback intelligible

// Volume normalization. Measure each book's gated loudness and apply a gain so
// books sit at a common level (measured ~7 dB spread across the real library).
const NORM_TARGET_DBFS = -19;  // roughly the library median gated RMS
const NORM_GATE_RMS = 0.02;    // ignore pauses when measuring loudness
const NORM_WARMUP = 200;       // gated samples before a first running estimate (~5s)
const NORM_UPDATE_EVERY = 120; // re-estimate cadence while converging (~3s)
const NORM_LOCK_SAMPLES = 1200; // gated samples to finalise + store (~30s of speech)

let audioGraph = null;
let audioGraphFailed = false;

/**
 * Build the audio graph once (a media element can only be sourced once):
 *   source -> analyser -> normGain -> destination
 * The analyser taps before the gain so loudness is measured raw; the user's
 * volume is applied on el.audio (before the source tap) and compensated for when
 * reading levels, so both skip-silence and normalization are volume-independent.
 */
function ensureAudioGraph() {
  if (audioGraph || audioGraphFailed) return audioGraph;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const source = ctx.createMediaElementSource(el.audio);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    const normGain = ctx.createGain();
    const volumeGain = ctx.createGain();
    source.connect(analyser);
    analyser.connect(normGain);
    normGain.connect(volumeGain);
    volumeGain.connect(ctx.destination);
    audioGraph = { ctx, analyser, normGain, volumeGain, buf: new Float32Array(analyser.fftSize) };
    // Volume now lives in the graph (after the analyser), so the analyser always
    // sees the raw full-scale signal — measurement and silence detection are
    // volume-independent. The element's own volume is pinned to 1.
    volumeGain.gain.value = Math.max(0, Math.min(1, state.userVolume * state.sleep.fadeGain));
    el.audio.volume = 1;
  } catch (err) {
    console.error('[audio] graph init failed:', err);
    audioGraphFailed = true;
  }
  return audioGraph;
}

/** Raw source-level RMS and peak (the analyser taps before any gain). */
function currentLevel() {
  const buf = audioGraph.buf;
  audioGraph.analyser.getFloatTimeDomainData(buf);
  let sum = 0;
  let peak = 0;
  for (const v of buf) { sum += v * v; const a = Math.abs(v); if (a > peak) peak = a; }
  return { rms: Math.sqrt(sum / buf.length), peak };
}

function setSilenceBoost(on) {
  if (on === state.silenceBoosting) return;
  state.silenceBoosting = on;
  el.audio.playbackRate = on
    ? Math.min(state.baseSpeed * SILENCE_BOOST, SILENCE_MAX_RATE)
    : state.baseSpeed;
  el.skipSilenceBtn.classList.toggle('skipping', on);
}

/** Smoothly move the normalization gain to `gain` over `ramp` seconds. */
function setNormGain(gain, ramp = 0.4) {
  if (!audioGraph) return;
  const p = audioGraph.normGain.gain;
  const t = audioGraph.ctx.currentTime;
  p.cancelScheduledValues(t);
  p.setValueAtTime(p.value, t);
  p.linearRampToValueAtTime(gain, t + ramp);
}

function computeNormGain(m) {
  const rms = Math.sqrt(m.sumMS / m.count);
  const dbfs = 20 * Math.log10(rms || 1e-9);
  const gainDb = Math.max(-12, Math.min(12, NORM_TARGET_DBFS - dbfs));
  let gain = 10 ** (gainDb / 20);
  const clipLimit = m.peak > 0.01 ? 0.98 / m.peak : 4; // never push peaks into clipping
  return Math.max(0.25, Math.min(4, Math.min(gain, clipLimit)));
}

/** Prepare normalization for a freshly loaded book: apply a stored gain, or measure. */
function startNormalization(book) {
  if (!state.normalize) { setNormGain(1, 0.2); state.norm = null; return; }
  ensureAudioGraph();
  const stored = state.normalization[book.id];
  if (typeof stored === 'number') {
    setNormGain(stored, 0.3);
    state.norm = { bookId: book.id, locked: true };
  } else {
    setNormGain(1, 0.1);
    state.norm = { bookId: book.id, sumMS: 0, count: 0, peak: 0, locked: false };
  }
}

let silenceSince = 0;
// A short interval (not requestAnimationFrame): rAF is paused while the window
// is hidden, but a background audiobook must keep skipping silence / measuring.
// Timers are not throttled while the page is playing audio.
function audioTick() {
  if (!audioGraph || el.audio.paused) {
    if (state.silenceBoosting) setSilenceBoost(false);
    silenceSince = 0;
    return;
  }

  // Nothing needs a fresh sample: skip-silence is off (and not mid-boost, so
  // no snap-back to apply), and normalization is either off or already locked
  // onto a gain. Skip the analyser read + RMS/peak loop entirely rather than
  // doing it unconditionally on every 25ms tick.
  const m = state.norm;
  const measuring = state.normalize && m && !m.locked;
  if (!state.skipSilence && !state.silenceBoosting && !measuring) return;

  const { rms, peak } = currentLevel();

  // --- skip silence ---
  if (state.skipSilence) {
    const now = performance.now();
    if (rms < SILENCE_RMS) {
      if (!silenceSince) silenceSince = now;
      setSilenceBoost(now - silenceSince >= SILENCE_ENTER_MS);
    } else {
      silenceSince = 0;
      setSilenceBoost(false); // snap back the instant speech returns
    }
  } else if (state.silenceBoosting) {
    setSilenceBoost(false);
  }

  // --- loudness measurement ---
  if (measuring && rms > NORM_GATE_RMS) {
    m.sumMS += rms * rms;
    m.count += 1;
    if (peak > m.peak) m.peak = peak;

    if (m.count >= NORM_LOCK_SAMPLES) {
      const gain = computeNormGain(m);
      setNormGain(gain, 1.5);
      m.locked = true;
      state.normalization[m.bookId] = gain;
      window.api.saveNormalization({ bookId: m.bookId, gain });
    } else if (m.count >= NORM_WARMUP && m.count % NORM_UPDATE_EVERY === 0) {
      setNormGain(computeNormGain(m), 1.5); // gently converge during the first listen
    }
  }
}
setInterval(audioTick, 25);

/** Turn skip-silence on/off; builds and resumes the audio graph on demand. */
function setSkipSilence(on) {
  state.skipSilence = on;
  localStorage.setItem('skipSilence', on ? '1' : '0');
  el.skipSilenceBtn.setAttribute('aria-pressed', String(on));
  if (on) {
    const g = ensureAudioGraph();
    if (g && g.ctx.state === 'suspended') g.ctx.resume();
  } else {
    setSilenceBoost(false);
  }
}

/** Turn volume normalization on/off. */
function setNormalize(on) {
  state.normalize = on;
  localStorage.setItem('normalize', on ? '1' : '0');
  el.normalizeBtn.setAttribute('aria-pressed', String(on));
  if (on) {
    const g = ensureAudioGraph();
    if (g && g.ctx.state === 'suspended') g.ctx.resume();
    if (state.playing) startNormalization(state.playing);
  } else {
    setNormGain(1, 0.3);
    state.norm = null;
  }
}

/** Sends the current playback snapshot to Discord Rich Presence, if enabled. */
function pushDiscordActivity() {
  if (!state.discordPresence || !state.playing) return;
  window.api.updateDiscordActivity({
    title: state.playing.title,
    chapterLabel: el.nowChapter.textContent || '',
    isPlaying: !el.audio.paused,
  });
}

/** Turn Discord Rich Presence on/off. Off by default — see the state.discordPresence comment. */
function setDiscordPresence(on) {
  state.discordPresence = on;
  localStorage.setItem('discordPresence', on ? '1' : '0');
  el.discordBtn.setAttribute('aria-pressed', String(on));
  window.api.setDiscordPresenceEnabled(on);
  if (on) pushDiscordActivity();
}

/** How far to rewind on resume, based on how long playback was paused. */
function resumeRewindSeconds(pausedMs) {
  const minutes = pausedMs / 60000;
  if (minutes < 0.5) return 0; // barely paused — don't move
  if (minutes < 5) return 3;
  if (minutes < 60) return 10;
  return 20; // came back much later
}

/**
 * Seek to a whole-book position, switching track if needed.
 * `autoplay` keeps playback going when the jump crosses a file boundary.
 */
function seekTo(globalSeconds, { autoplay = null } = {}) {
  const book = state.playing;
  if (!book) return;

  const total = effectiveDuration(book);
  const target = Math.max(0, total ? Math.min(globalSeconds, total - 0.5) : globalSeconds);
  const index = trackIndexAt(book, target);
  const track = book.tracks[index];
  const local = Math.max(0, target - track.offset);
  const shouldPlay = autoplay ?? !el.audio.paused;

  const applyLocal = (seconds) => {
    if (!Number.isFinite(el.audio.duration)) return false;
    el.audio.currentTime = Math.min(seconds, Math.max(0, el.audio.duration - 0.25));
    return true;
  };

  if (index !== state.trackIndex) {
    state.trackIndex = index;
    // Read at fire time, so a second seek landing on the same loading track wins.
    state.pendingSeek = local;
    el.audio.src = track.url;
    el.audio.load();
    el.audio.addEventListener('loadedmetadata', () => {
      applyLocal(state.pendingSeek ?? 0);
      state.pendingSeek = null;
      if (shouldPlay) el.audio.play().catch(() => {});
      updateTimeUI();
    }, { once: true });
  } else if (!applyLocal(local)) {
    // Track still loading; let the pending handler place us.
    state.pendingSeek = local;
  }

  updateTimeUI();
}

function updateTimeUI() {
  const book = state.playing;
  const total = effectiveDuration(book);
  const position = globalTime();

  el.timeCurrent.textContent = formatTime(position);
  el.timeTotal.textContent = formatTime(total);
  if (!state.seeking && total > 0) {
    el.seek.value = String(Math.round((position / total) * 1000));
  }

  if (book?.chapters.length) {
    const idx = chapterAt(book, position);
    if (idx >= 0) {
      const ch = book.chapters[idx];
      const prefix = book.kind === 'multi' ? `${idx + 1}/${book.chapters.length}` : `${idx + 1}`;
      el.nowChapter.textContent = `${prefix}. ${ch.title}`;
      if (state.current?.id === book.id) highlightChapter(idx);
      if (idx !== state.playingChapterIndex) {
        state.playingChapterIndex = idx;
        if (navigator.mediaSession?.metadata) navigator.mediaSession.metadata.album = `${prefix}. ${ch.title}`;
        pushDiscordActivity();
      }
    }
  }

  if ('mediaSession' in navigator && Number.isFinite(total) && total > 0 && position <= total) {
    try {
      navigator.mediaSession.setPositionState({ duration: total, position, playbackRate: el.audio.playbackRate || 1 });
    } catch {
      // Chromium throws if duration/position momentarily disagree mid-seek — harmless, next tick corrects it.
    }
  }

  updateCaption();
}

function jumpChapter(delta) {
  const book = state.playing;
  const position = globalTime();
  if (!book?.chapters.length) { seekTo(position + delta * 30); return; }

  const idx = chapterAt(book, position);
  // A "previous" press early in a chapter goes back one; later, it restarts the current one.
  if (delta < 0 && position - book.chapters[idx].start > 3) {
    seekTo(book.chapters[idx].start);
    return;
  }
  const target = Math.max(0, Math.min(book.chapters.length - 1, idx + delta));
  seekTo(book.chapters[target].start);
}

function flushProgress() {
  const book = state.playing;
  if (!book) return;
  const position = globalTime();
  if (!Number.isFinite(position)) return;

  const duration = effectiveDuration(book);
  const speed = Number(el.speed.value) || 1;
  state.progress[book.id] = {
    ...state.progress[book.id],
    position,
    duration,
    finished: window.api.isFinishedByPosition(position, duration),
    speed,
    updatedAt: Date.now(),
  };
  window.api.saveProgress({ bookId: book.id, position, duration, speed });
}

/* ---------------- sleep timer ---------------- */

/** Actual audio volume is the user's setting scaled by the sleep fade. */
function applyVolume() {
  const v = Math.max(0, Math.min(1, state.userVolume * state.sleep.fadeGain));
  if (audioGraph) {
    // Volume is a graph node once routed; keep the element at unity.
    audioGraph.volumeGain.gain.setTargetAtTime(v, audioGraph.ctx.currentTime, 0.015);
    el.audio.volume = 1;
  } else {
    el.audio.volume = v;
  }
}

/**
 * Real-world seconds until the timer should fire, or Infinity when off.
 * Chapter/book modes are measured in book-time and divided by the playback rate
 * so the fade and countdown track wall-clock time, not audio time.
 */
function sleepRemaining() {
  const s = state.sleep;
  if (s.mode === 'off') return Infinity;
  if (s.mode === 'duration') return s.remainingMs / 1000;

  const book = state.playing;
  if (!book) return Infinity;
  const rate = el.audio.playbackRate || 1;
  const position = globalTime();

  if (s.mode === 'book') return (effectiveDuration(book) - position) / rate;

  // End of chapter (falls back to end of book when the book has no chapters).
  if (!book.chapters.length) return (effectiveDuration(book) - position) / rate;
  const idx = chapterAt(book, position);
  const end = book.chapters[idx]?.end ?? effectiveDuration(book);
  return (end - position) / rate;
}

let sleepLastTick = performance.now();

function sleepTick() {
  const now = performance.now();
  const dt = now - sleepLastTick;
  sleepLastTick = now;

  const s = state.sleep;
  if (s.mode === 'off') return;

  // The duration budget only burns down while audio is actually playing.
  if (s.mode === 'duration' && !el.audio.paused) {
    s.remainingMs = Math.max(0, s.remainingMs - dt);
  }

  const remaining = sleepRemaining();

  // The fade only advances while playing, so pausing near the end doesn't
  // silently dim the audio and leave it quiet on resume.
  if (!el.audio.paused) {
    const gain = remaining >= SLEEP_FADE_SEC ? 1 : Math.max(0, remaining / SLEEP_FADE_SEC);
    if (gain !== s.fadeGain) { s.fadeGain = gain; applyVolume(); }
  }

  el.sleep?.classList.toggle('fading', !el.audio.paused && remaining < SLEEP_FADE_SEC);
  updateSleepLabel(remaining);

  if (remaining <= 0.1 && !el.audio.paused) fireSleep();
}

function fireSleep() {
  el.audio.pause();
  state.sleep.firedPaused = true;
  // Restore the fade for next time; audio is paused so nothing jumps.
  state.sleep.fadeGain = 1;
  applyVolume();
  setSleepMode('off', undefined, { keepExtend: true });
}

function updateSleepLabel(remaining) {
  const s = state.sleep;
  if (s.mode === 'off') { el.sleepLabel.textContent = 'Sleep'; return; }
  if (s.mode === 'duration' || Number.isFinite(remaining)) {
    el.sleepLabel.textContent = formatTime(Math.max(0, remaining));
  } else {
    el.sleepLabel.textContent = s.mode === 'chapter' ? 'Chapter' : 'Book';
  }
}

/**
 * @param {'off'|'duration'|'chapter'|'book'} mode
 * @param {number} [seconds] duration in seconds (duration mode only)
 * @param {{keepExtend?: boolean}} [opts]
 */
function setSleepMode(mode, seconds, opts = {}) {
  const s = state.sleep;
  s.mode = mode;
  if (mode === 'duration') s.remainingMs = (seconds || 0) * 1000;
  if (mode === 'off') {
    s.fadeGain = 1;
    applyVolume();
  }
  sleepLastTick = performance.now();

  const active = mode !== 'off';
  el.sleep?.classList.toggle('active', active);
  el.sleep?.classList.remove('fading');
  // Offer "+5 minutes" while a timer runs, or right after one fired.
  el.sleepSnooze?.classList.toggle('hidden', !active && !opts.keepExtend);

  for (const opt of el.sleepMenu.querySelectorAll('.sleep-opt')) {
    const val = opt.dataset.sleep;
    const selected = (mode === 'chapter' && val === 'chapter')
      || (mode === 'book' && val === 'book')
      || (mode === 'duration' && Number(val) * 1000 === s.remainingMs);
    opt.classList.toggle('selected', selected);
  }
  updateSleepLabel(sleepRemaining());
}

function openSleepMenu(open) {
  el.sleepMenu.classList.toggle('hidden', !open);
  el.sleepBtn.setAttribute('aria-expanded', String(open));
}

el.sleepBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  openSleepMenu(el.sleepMenu.classList.contains('hidden'));
});

el.sleepMenu.addEventListener('click', (e) => {
  const opt = e.target.closest('.sleep-opt');
  if (!opt) return;
  const val = opt.dataset.sleep;

  if (val === 'off') setSleepMode('off');
  else if (val === 'chapter') setSleepMode('chapter');
  else if (val === 'book') setSleepMode('book');
  else if (val === 'snooze') {
    // Extend by five minutes; if the timer already fired, pick playback back up.
    setSleepMode('duration', 300);
    if (el.audio.paused && state.playing) el.audio.play().catch(() => {});
  } else {
    setSleepMode('duration', Number(val));
  }
  openSleepMenu(false);
});

// Close the menu when clicking elsewhere.
document.addEventListener('click', (e) => {
  if (!el.sleep?.contains(e.target)) openSleepMenu(false);
});

setInterval(sleepTick, 200);

/* ---------------- events ---------------- */

// Shared by the play button, the OS media keys (mediaSession), and the
// taskbar thumbbar button, so "pause" always behaves the same way everywhere.
function pauseWithBookmark() {
  addBookmark({ auto: true });
  el.audio.pause();
}

function togglePlayPause() {
  if (el.audio.paused) {
    el.audio.play().catch((err) => console.error('playback failed:', err));
  } else {
    pauseWithBookmark();
  }
}

el.playBtn.addEventListener('click', togglePlayPause);

el.audio.addEventListener('play', () => {
  el.playIcon.setAttribute('href', '#icon-pause');
  el.playBtn.setAttribute('aria-label', 'Pause');
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
  window.api.setPlayingState(true);
  pushDiscordActivity();

  // A Web Audio graph can only be built during/after a user gesture; first play
  // is our chance. Resume it too — the context suspends when idle.
  if (state.skipSilence || state.normalize) {
    const g = ensureAudioGraph();
    if (g && g.ctx.state === 'suspended') g.ctx.resume();
  }

  if (state.sleep.firedPaused) {
    // Resuming after the sleep timer stopped us: rewind a fixed amount so you
    // don't wake up having missed the last thing you heard.
    state.sleep.firedPaused = false;
    seekTo(globalTime() - SLEEP_REWIND_SEC);
  } else if (state.pausedAt) {
    // Rewind a little on resume, scaled to how long you were away.
    const rewind = resumeRewindSeconds(Date.now() - state.pausedAt);
    if (rewind > 0) seekTo(globalTime() - rewind);
  }
  state.pausedAt = 0;
});

el.audio.addEventListener('pause', () => {
  el.playIcon.setAttribute('href', '#icon-play');
  el.playBtn.setAttribute('aria-label', 'Play');
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
  window.api.setPlayingState(false);
  pushDiscordActivity();
  state.pausedAt = Date.now();
  flushProgress();
});
el.audio.addEventListener('timeupdate', updateTimeUI);

// A track ending mid-book just means the next file starts; only the last one
// is really "the end".
el.audio.addEventListener('ended', () => {
  const book = state.playing;
  if (book && state.trackIndex < book.tracks.length - 1) {
    const next = book.tracks[state.trackIndex + 1];
    seekTo(next.offset, { autoplay: true });
    return;
  }
  flushProgress();
  renderLibrary();
});
el.audio.addEventListener('error', () => {
  const err = el.audio.error;
  if (err) console.error(`audio error (code ${err.code}):`, err.message);
});

// Persist every 5s while playing so a hard crash loses very little.
setInterval(() => { if (!el.audio.paused) flushProgress(); }, 5000);
window.addEventListener('beforeunload', flushProgress);

el.seek.addEventListener('input', () => { state.seeking = true; });
el.seek.addEventListener('change', () => {
  const total = effectiveDuration(state.playing);
  state.seeking = false;
  if (total > 0) { seekTo((Number(el.seek.value) / 1000) * total); flushProgress(); }
});

el.back30Btn.addEventListener('click', () => seekTo(globalTime() - state.skipAmount));
el.fwd30Btn.addEventListener('click', () => seekTo(globalTime() + state.skipAmount));
el.skipAmountSelect.addEventListener('change', () => applySkipAmount(el.skipAmountSelect.value));
el.prevChapterBtn.addEventListener('click', () => jumpChapter(-1));
el.nextChapterBtn.addEventListener('click', () => jumpChapter(1));

el.speed.addEventListener('change', () => { applySpeed(Number(el.speed.value)); flushProgress(); });
el.volume.addEventListener('input', () => { state.userVolume = Number(el.volume.value); applyVolume(); });

el.backBtn.addEventListener('click', goBack);
// Debounced: renderLibrary re-filters/sorts/groups the whole library, which
// on a large one is too expensive to re-run synchronously on every keystroke.
let searchDebounceTimer = null;
el.search.addEventListener('input', () => {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(renderLibrary, 150);
});

el.chapterSearch.addEventListener('input', () => { if (state.current) renderChapters(state.current); });
el.chapterSearch.addEventListener('keydown', (e) => {
  e.stopPropagation(); // don't let typed letters/space trigger player shortcuts, and
                        // (since the global handler already skips input targets
                        // anyway) keep Escape here from also triggering goBack
  if (e.key === 'Escape') {
    if (el.chapterSearch.value) {
      el.chapterSearch.value = '';
      if (state.current) renderChapters(state.current);
    } else {
      el.chapterSearch.blur();
    }
  }
});

el.groupToggle.addEventListener('click', () => {
  state.groupSeries = !state.groupSeries;
  localStorage.setItem('groupSeries', state.groupSeries ? '1' : '0');
  el.groupToggle.setAttribute('aria-pressed', String(state.groupSeries));
  el.main.scrollTop = 0;
  renderGrid();
});

el.sortSelect.addEventListener('change', () => {
  state.sort = el.sortSelect.value;
  localStorage.setItem('sort', state.sort);
  el.main.scrollTop = 0;
  renderGrid();
});

el.skipSilenceBtn.addEventListener('click', () => setSkipSilence(!state.skipSilence));
el.normalizeBtn.addEventListener('click', () => setNormalize(!state.normalize));
el.discordBtn.addEventListener('click', () => setDiscordPresence(!state.discordPresence));

el.filterTabs.addEventListener('click', (e) => {
  const tab = e.target.closest('.filter-tab');
  if (!tab) return;
  state.filter = tab.dataset.filter;
  for (const t of el.filterTabs.querySelectorAll('.filter-tab')) {
    t.classList.toggle('active', t === tab);
  }
  el.main.scrollTop = 0;
  renderLibrary();
});

function reportFolderError(action, err) {
  console.error(`[folders] ${action} failed:`, err);
  showToast(`Could not ${action} — try again.`);
}

el.addFolderBtn.addEventListener('click', () => window.api.addFolder()
  .then((next) => { applyState(next); renderFoldersMenu(); })
  .catch((err) => reportFolderError('add that folder', err)));
el.emptyAddBtn.addEventListener('click', () => window.api.addFolder()
  .then(applyState)
  .catch((err) => reportFolderError('add that folder', err)));
el.rescanBtn.addEventListener('click', () => window.api.rescan()
  .then(applyState)
  .catch((err) => reportFolderError('rescan the library', err)));

/** Undo side of "Reset progress": puts the exact prior position/speed back. */
async function restoreProgress(book, previous) {
  state.progress[book.id] = previous;
  await window.api.saveProgress({
    bookId: book.id,
    position: previous.position,
    duration: previous.duration,
    speed: previous.speed,
  });
  // saveProgress only knows position/duration/speed; a manual finished mark
  // needs its own round trip or it'd be lost (the record was just deleted, so
  // there's nothing server-side for saveProgress to carry it forward from).
  if (previous.finishedOverride != null) {
    state.progress = await window.api.setFinished({ bookId: book.id, finished: previous.finishedOverride });
  }
  if (state.playing?.id === book.id) {
    applySpeed(previous.speed ?? 1);
    seekTo(previous.position, { autoplay: false });
  }
  renderLibrary();
  if (state.current?.id === book.id) updateFinishedButton(state.current);
}

el.resetProgressBtn.addEventListener('click', async () => {
  if (!state.current) return;
  const book = state.current;
  const previous = state.progress[book.id];
  if (!previous) return; // nothing was recorded — nothing to reset or undo

  state.progress = await window.api.clearProgress(book.id);
  if (state.playing?.id === book.id) seekTo(0, { autoplay: false });
  renderLibrary();
  updateFinishedButton(book); // clearing progress also clears any manual finished mark

  showToast('Progress reset.', () => restoreProgress(book, previous));
});

el.finishedToggleBtn.addEventListener('click', () => {
  if (!state.current) return;
  const book = state.current;
  const currentlyFinished = isFinished(state.progress[book.id]);
  setBookFinished(book, !currentlyFinished);
});

el.bookmarkBtn.addEventListener('click', () => addBookmark());
el.bookmarkHereBtn.addEventListener('click', () => addBookmark());

/* ----------------
 * Online metadata lookup (Open Library) — opt-in, user-initiated only.
 * Nothing here runs automatically; every network call traces back to a click
 * in this modal. Series-splitting (part of the original roadmap ask) isn't
 * attempted: Open Library's series data is too sparse/inconsistent across
 * this library's real books to build a reliable feature on, so this stays
 * scoped to title/author/description/cover correction.
 * ---------------- */

function closeMetadataModal() {
  el.metadataModal.classList.add('hidden');
  state.metadataResults = [];
  state.metadataPicked = null;
}

function showMetadataResultsPane() {
  el.metadataOptIn.classList.add('hidden');
  el.metadataSearchUI.classList.remove('hidden');
  el.metadataPreview.classList.add('hidden');
  el.metadataResults.classList.remove('hidden');
}

function openMetadataModal() {
  if (!state.current) return;
  el.metadataModal.classList.remove('hidden');
  el.metadataStatus.textContent = '';
  el.metadataResults.replaceChildren();
  state.metadataResults = [];
  state.metadataPicked = null;
  el.metadataPreview.classList.add('hidden');

  if (!state.onlineMetadataEnabled) {
    el.metadataOptIn.classList.remove('hidden');
    el.metadataSearchUI.classList.add('hidden');
    return;
  }

  showMetadataResultsPane();
  el.metadataQuery.value = [state.current.title, state.current.author].filter(Boolean).join(' ');
  el.metadataQuery.focus();
  el.metadataQuery.select();
}

el.metadataLookupBtn.addEventListener('click', openMetadataModal);
el.metadataModalClose.addEventListener('click', closeMetadataModal);
el.metadataOptInCancel.addEventListener('click', closeMetadataModal);
el.metadataModal.addEventListener('click', (e) => {
  if (e.target === el.metadataModal) closeMetadataModal();
});
el.metadataModal.addEventListener('keydown', (e) => {
  // Stop this from also reaching the document-level Escape handler, which
  // would otherwise interpret it as "close the book view" once this modal
  // closes (e.g. when focus is on a button rather than the search input).
  if (e.key === 'Escape') { e.stopPropagation(); closeMetadataModal(); }
});

el.metadataOptInEnable.addEventListener('click', () => {
  state.onlineMetadataEnabled = true;
  localStorage.setItem('onlineMetadataEnabled', '1');
  showMetadataResultsPane();
  el.metadataQuery.value = [state.current.title, state.current.author].filter(Boolean).join(' ');
  el.metadataQuery.focus();
  el.metadataQuery.select();
});

function renderMetadataResults(results) {
  state.metadataResults = results;
  el.metadataResults.replaceChildren();
  for (const [index, r] of results.entries()) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'metadata-result';
    btn.dataset.index = String(index);

    const img = document.createElement('img');
    img.className = 'metadata-result-thumb';
    img.alt = '';
    if (r.coverThumbUrl) img.src = r.coverThumbUrl;

    const info = document.createElement('div');
    info.className = 'metadata-result-info';
    const title = document.createElement('div');
    title.className = 'metadata-result-title';
    title.textContent = r.title;
    const sub = document.createElement('div');
    sub.className = 'metadata-result-sub';
    sub.textContent = [r.authors.join(', '), r.year].filter(Boolean).join(' · ') || 'Unknown author';
    info.append(title, sub);

    btn.append(img, info);
    li.append(btn);
    el.metadataResults.append(li);
  }
}

el.metadataSearchForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = el.metadataQuery.value.trim();
  el.metadataPreview.classList.add('hidden');
  if (!query) return;

  el.metadataStatus.textContent = 'Searching…';
  el.metadataResults.replaceChildren();
  const result = await window.api.searchMetadata(query);

  if (!result.ok) {
    el.metadataStatus.textContent = result.error;
    return;
  }
  if (!result.results.length) {
    el.metadataStatus.textContent = 'No matches found.';
    renderMetadataResults([]);
    return;
  }
  el.metadataStatus.textContent = `${result.results.length} result${result.results.length === 1 ? '' : 's'}`;
  renderMetadataResults(result.results);
});

el.metadataResults.addEventListener('click', async (e) => {
  const btn = e.target.closest('.metadata-result');
  if (!btn) return;
  const candidate = state.metadataResults[Number(btn.dataset.index)];
  if (!candidate) return;

  state.metadataPicked = candidate;
  el.metadataResults.classList.add('hidden');
  el.metadataPreview.classList.remove('hidden');
  el.metadataPreviewCover.src = candidate.coverThumbUrl || '';
  el.metadataPreviewTitle.textContent = candidate.title;
  el.metadataPreviewAuthor.textContent = candidate.authors.join(', ') || 'Unknown author';
  el.metadataPreviewDesc.textContent = 'Loading description…';
  el.metadataApplyBtn.disabled = true;

  const desc = await window.api.previewMetadata(candidate.key);
  // The user may have picked a different candidate (or navigated away) while
  // this was in flight — only apply the result if it's still the active pick.
  if (state.metadataPicked !== candidate) return;
  candidate.description = desc.ok ? desc.description : '';
  el.metadataPreviewDesc.textContent = candidate.description
    || 'No description available from Open Library for this edition.';
  el.metadataApplyBtn.disabled = false;
});

el.metadataBackBtn.addEventListener('click', () => {
  el.metadataPreview.classList.add('hidden');
  el.metadataResults.classList.remove('hidden');
  state.metadataPicked = null;
});

el.metadataApplyBtn.addEventListener('click', async () => {
  const candidate = state.metadataPicked;
  const book = state.current;
  if (!candidate || !book) return;

  el.metadataApplyBtn.disabled = true;
  el.metadataApplyBtn.textContent = 'Applying…';
  try {
    const next = await window.api.applyMetadata({
      bookId: book.id,
      title: candidate.title,
      author: candidate.authors.join(', '),
      description: candidate.description || '',
      coverId: candidate.coverId,
      source: 'openlibrary',
      sourceKey: candidate.key,
    });
    patchBook(next.book);
    closeMetadataModal();
    showToast(`Applied "${candidate.title}" from Open Library.`);
  } finally {
    el.metadataApplyBtn.disabled = false;
    el.metadataApplyBtn.textContent = 'Apply to this book';
  }
});

el.metadataRevertBtn.addEventListener('click', async () => {
  if (!state.current) return;
  const next = await window.api.clearMetadata(state.current.id);
  patchBook(next.book);
  showToast('Reverted to the file\'s own tags.');
});

/* ----------------
 * Transcription (local Whisper) — opt-in, per book. transcribe:start returns
 * immediately once accepted; transcribe:progress events carry live updates,
 * and updateTranscribeUI() re-syncs the button states from the main process
 * (rather than trusting only the last progress event) whenever a book is
 * opened, since transcription keeps running in the background regardless of
 * which book is currently shown.
 * ---------------- */

function transcribeStatusText(info) {
  const label = {
    model: 'Downloading speech model…',
    convert: 'Preparing audio…',
    transcribe: 'Transcribing…',
  }[info.phase] || 'Working…';
  return `${label} ${Math.round(info.percent)}%`;
}

async function updateTranscribeUI(book) {
  const status = await window.api.getTranscribeStatus(book.id);
  // The user may have navigated to a different book while this was in flight.
  if (state.current?.id !== book.id) return;

  const mine = status.isTranscribing;
  el.transcribeBtn.classList.toggle('hidden', !status.available || mine || status.hasTranscript);
  el.transcribeBtn.disabled = status.anyTranscribing && !mine;
  el.transcribeBtn.textContent = el.transcribeBtn.disabled ? 'Transcribing another book…' : 'Transcribe this book';
  el.cancelTranscribeBtn.classList.toggle('hidden', !mine);
  el.searchTranscriptBtn.classList.toggle('hidden', !status.hasTranscript);
  el.captionsBtn.classList.toggle('hidden', !status.hasTranscript);
  el.deleteTranscriptBtn.classList.toggle('hidden', !status.hasTranscript);

  el.transcribeStatus.classList.toggle('hidden', !mine);
  if (mine && state.transcribeState.bookId === book.id) {
    el.transcribeStatus.textContent = transcribeStatusText(state.transcribeState);
  } else if (!mine) {
    el.transcribeStatus.textContent = '';
  }
}

el.transcribeBtn.addEventListener('click', async () => {
  if (!state.current) return;
  const book = state.current;
  const result = await window.api.startTranscription(book.id);
  if (!result.ok) {
    showToast(result.error || 'Could not start transcription.');
    return;
  }
  state.transcribeState = { bookId: book.id, phase: 'model', percent: 0 };
  updateTranscribeUI(book);
});

el.cancelTranscribeBtn.addEventListener('click', () => {
  if (state.current) window.api.cancelTranscription(state.current.id);
});

el.deleteTranscriptBtn.addEventListener('click', async () => {
  if (!state.current) return;
  if (!window.confirm("Delete this book's transcript? You can transcribe it again later.")) return;
  const book = state.current;
  await window.api.deleteTranscript(book.id);
  state.transcriptCache.delete(book.id);
  updateTranscribeUI(book);
});

window.api.onTranscribeProgress((info) => {
  state.transcribeState = info;
  if (state.current?.id !== info.bookId) return;

  if (info.phase === 'error') showToast(`Transcription failed: ${info.error || 'unknown error'}`);
  if (info.phase === 'complete') {
    state.transcriptCache.delete(info.bookId); // stale "no transcript" cache entry, if any
    showToast('Transcript ready — search it from the book view.');
  }
  updateTranscribeUI(state.current);
});

/**
 * Loads (and caches) a book's transcript; null means "fetched, has none."
 * De-dupes concurrent callers for the same book — updateCaption() calls this
 * on every timeupdate tick (several times a second) until the cache is
 * populated, which without this would fire that many redundant IPC round
 * trips before the first one even resolves.
 */
const transcriptFetchesInFlight = new Map(); // bookId -> Promise
function ensureTranscriptLoaded(bookId) {
  if (state.transcriptCache.has(bookId)) return Promise.resolve(state.transcriptCache.get(bookId));
  if (transcriptFetchesInFlight.has(bookId)) return transcriptFetchesInFlight.get(bookId);

  const promise = window.api.getTranscript(bookId).then((data) => {
    state.transcriptCache.set(bookId, data);
    transcriptFetchesInFlight.delete(bookId);
    return data;
  });
  transcriptFetchesInFlight.set(bookId, promise);
  return promise;
}

function closeTranscriptModal() {
  el.transcriptModal.classList.add('hidden');
}

el.searchTranscriptBtn.addEventListener('click', async () => {
  if (!state.current) return;
  el.transcriptModal.classList.remove('hidden');
  el.transcriptQuery.value = '';
  el.transcriptResults.replaceChildren();
  el.transcriptStatus.textContent = 'Loading transcript…';
  el.transcriptQuery.focus();

  const data = await ensureTranscriptLoaded(state.current.id);
  el.transcriptStatus.textContent = data
    ? `${data.segments.length.toLocaleString()} lines — type to search.`
    : 'No transcript available.';
});
el.transcriptModalClose.addEventListener('click', closeTranscriptModal);
el.transcriptModal.addEventListener('click', (e) => {
  if (e.target === el.transcriptModal) closeTranscriptModal();
});
el.transcriptModal.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.stopPropagation(); closeTranscriptModal(); }
});

function escapeHtml(s) {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

el.transcriptSearchForm.addEventListener('submit', (e) => e.preventDefault());
el.transcriptQuery.addEventListener('input', () => {
  const book = state.current;
  const data = book && state.transcriptCache.get(book.id);
  if (!data) return;

  const q = el.transcriptQuery.value.trim().toLowerCase();
  el.transcriptResults.replaceChildren();
  if (!q) {
    el.transcriptStatus.textContent = `${data.segments.length.toLocaleString()} lines — type to search.`;
    return;
  }

  const matches = data.segments.filter((s) => s.text.toLowerCase().includes(q));
  el.transcriptStatus.textContent = matches.length
    ? `${matches.length.toLocaleString()} match${matches.length === 1 ? '' : 'es'}`
    : 'No matches found.';

  const highlightRe = new RegExp(`(${escapeRegExp(q)})`, 'ig');
  const frag = document.createDocumentFragment();
  // A very common word could match thousands of lines in a long audiobook —
  // cap the render rather than building an enormous result list.
  for (const seg of matches.slice(0, 300)) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.className = 'transcript-result';

    const time = document.createElement('span');
    time.className = 'transcript-result-time';
    time.textContent = formatTime(seg.start);

    const text = document.createElement('span');
    text.className = 'transcript-result-text';
    text.innerHTML = escapeHtml(seg.text).replace(highlightRe, '<mark>$1</mark>');

    btn.append(time, text);
    btn.addEventListener('click', () => {
      closeTranscriptModal();
      if (state.playing?.id !== book.id) loadIntoPlayer(book);
      seekTo(seg.start, { autoplay: true });
    });
    li.append(btn);
    frag.append(li);
  }
  el.transcriptResults.append(frag);
});

/** Turn live captions on/off. Off by default; only meaningful for a book that has a transcript. */
function setCaptions(on) {
  state.captionsOn = on;
  localStorage.setItem('captionsOn', on ? '1' : '0');
  el.captionsBtn.setAttribute('aria-pressed', String(on));
  state.captionIndex = -1;
  if (!on) el.captionsBar.classList.add('hidden');
}
el.captionsBtn.addEventListener('click', () => setCaptions(!state.captionsOn));
el.captionsBtn.setAttribute('aria-pressed', String(state.captionsOn));

/**
 * Updates the live caption line for whatever's playing, if captions are on
 * and that book has a (already-loaded) transcript. Called from updateTimeUI
 * alongside the existing chapter-tracking — same "only touch the DOM when
 * the segment actually changes" shape.
 */
function updateCaption() {
  if (!state.captionsOn || !state.playing) return;
  const data = state.transcriptCache.get(state.playing.id);
  if (!data) {
    // Fetch once in the background; nothing to show until it resolves.
    if (data === undefined) ensureTranscriptLoaded(state.playing.id).then(() => updateCaption());
    return;
  }
  const position = globalTime();
  const idx = data.segments.findIndex((s) => position >= s.start && position < s.end);
  if (idx === state.captionIndex) return;
  state.captionIndex = idx;

  const onBookView = state.current?.id === state.playing.id && !el.bookView.classList.contains('hidden');
  if (idx === -1 || !onBookView) {
    el.captionsBar.classList.add('hidden');
    return;
  }
  el.captionsBar.textContent = data.segments[idx].text;
  el.captionsBar.classList.remove('hidden');
}

/* ----------------
 * Updates — every check is user-initiated (the topbar button or the Help
 * menu), never automatic. electron-updater auto-downloads once it finds a
 * newer version (see src/main/updater.js) and reports progress through
 * update:status events; this just reflects that state into the modal and a
 * small topbar dot so an update sitting ready-to-install isn't easy to miss
 * even if the modal itself has been closed.
 * ---------------- */

function closeUpdatesModal() {
  el.updatesModal.classList.add('hidden');
}

function openUpdatesModal() {
  el.updatesModal.classList.remove('hidden');
  renderUpdateStatus(state.update);
  // Re-check on open unless one's already in flight, or an update is already
  // downloaded and just waiting on Install/Later — nothing to re-check there.
  const s = state.update.state;
  if (s !== 'checking' && s !== 'downloading' && s !== 'downloaded') window.api.checkForUpdates();
}

/** Whether an update is sitting available/downloading/ready — worth a topbar dot even with the modal closed. */
function updateIsPending(status) {
  return status.state === 'available' || status.state === 'downloading' || status.state === 'downloaded';
}

function renderUpdateStatus(status) {
  el.updatesDot.classList.toggle('hidden', !updateIsPending(status));

  // status is always state.update (merged from every event so far) — a
  // 'downloading' progress tick carries no releaseNotes/version of its own,
  // so the fields from the earlier 'available' event stay put on the object.
  const { releaseNotes: notes, version } = status;
  if (notes) {
    el.updatesNotes.classList.remove('hidden');
    el.updatesNotesTitle.textContent = version ? `What's new in ${version}` : "What's new";
    // electron-updater's releaseNotes is GitHub's HTML rendering of our own
    // CHANGELOG.md section (headings/lists), not arbitrary user input — safe
    // to inject, and the page's CSP (script-src 'self', no unsafe-inline)
    // would block any injected script/inline-handler from running regardless.
    el.updatesNotesBody.innerHTML = notes;
  } else {
    el.updatesNotes.classList.add('hidden');
  }

  el.updatesProgressTrack.classList.toggle('hidden', status.state !== 'downloading');
  el.updatesProgressFill.style.width = `${status.state === 'downloading' ? status.percent ?? 0 : 0}%`;

  const showInstall = status.state === 'downloaded';
  el.updatesInstallBtn.classList.toggle('hidden', !showInstall);
  el.updatesLaterBtn.classList.toggle('hidden', !showInstall);
  el.updatesCheckBtn.classList.toggle('hidden', showInstall);
  el.updatesCheckBtn.disabled = status.state === 'checking' || status.state === 'downloading';

  switch (status.state) {
    case 'checking': el.updatesStatus.textContent = 'Checking for updates…'; break;
    case 'available': el.updatesStatus.textContent = `Update ${status.version} found — downloading…`; break;
    case 'downloading': el.updatesStatus.textContent = `Downloading update… ${status.percent ?? 0}%`; break;
    case 'downloaded': el.updatesStatus.textContent = `Update ${status.version} is ready to install.`; break;
    case 'not-available': el.updatesStatus.textContent = `You're up to date (${state.appVersion ?? 'current version'}).`; break;
    case 'error': el.updatesStatus.textContent = status.error; break;
    default: el.updatesStatus.textContent = '';
  }
}

el.updatesBtn.addEventListener('click', openUpdatesModal);
el.updatesModalClose.addEventListener('click', closeUpdatesModal);
el.updatesLaterBtn.addEventListener('click', closeUpdatesModal);
el.updatesModal.addEventListener('click', (e) => {
  if (e.target === el.updatesModal) closeUpdatesModal();
});
el.updatesModal.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.stopPropagation(); closeUpdatesModal(); }
});
el.updatesCheckBtn.addEventListener('click', () => window.api.checkForUpdates());
el.updatesInstallBtn.addEventListener('click', () => window.api.installUpdate());

window.api.onUpdateStatus((status) => {
  // A later 'downloading' progress tick has no releaseNotes/version of its
  // own — carry the ones from the 'available' event forward so the notes
  // panel doesn't blank out mid-download.
  state.update = { ...state.update, ...status };
  renderUpdateStatus(state.update);
});
window.api.onOpenUpdates(() => openUpdatesModal());
window.api.getAppVersion().then((v) => {
  state.appVersion = v;
  el.updatesCurrentVersion.textContent = v;
});

/* ---------------- drag-and-drop a folder onto the window ---------------- */

// dragenter/dragleave fire for every nested element the pointer crosses while
// dragging, not just window boundaries -- a counter (rather than a boolean)
// avoids the overlay flickering as the drag moves over child elements.
let dragDepth = 0;
const isFileDrag = (e) => e.dataTransfer?.types.includes('Files');

window.addEventListener('dragenter', (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  dragDepth += 1;
  el.dropOverlay.classList.remove('hidden');
});

window.addEventListener('dragover', (e) => {
  // Electron/Chromium's default action for an un-prevented drop is to
  // navigate the window to the dropped file, which would break the app.
  if (isFileDrag(e)) e.preventDefault();
});

window.addEventListener('dragleave', (e) => {
  if (!isFileDrag(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) el.dropOverlay.classList.add('hidden');
});

window.addEventListener('drop', async (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  dragDepth = 0;
  el.dropOverlay.classList.add('hidden');

  // File.path was removed from the renderer for security; getPathForFile
  // (exposed from preload via webUtils) is the current replacement. Dropped
  // folders arrive here as File-like entries too, not just individual files.
  const paths = [...e.dataTransfer.files]
    .map((f) => window.api.getPathForFile(f))
    .filter(Boolean);
  if (!paths.length) return;

  const result = await window.api.addFolderPaths(paths);
  applyState(result.state);
  if (!el.foldersMenu.classList.contains('hidden')) renderFoldersMenu();

  if (result.added === 0) {
    showToast("That doesn't look like a folder — drop a folder, not individual files.");
  }
});

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea')) return;
  switch (e.key) {
    case ' ':        e.preventDefault(); el.playBtn.click(); break;
    case 'ArrowLeft':  seekTo(globalTime() - (e.shiftKey ? 300 : state.skipAmount)); break;
    case 'ArrowRight': seekTo(globalTime() + (e.shiftKey ? 300 : state.skipAmount)); break;
    case 'b': case 'B':
      if (state.playing || state.current) addBookmark();
      break;
    case 's': case 'S':
      if (!el.player.classList.contains('hidden')) setSkipSilence(!state.skipSilence);
      break;
    case 'n': case 'N':
      if (!el.player.classList.contains('hidden')) setNormalize(!state.normalize);
      break;
    case 't': case 'T':
      if (!el.player.classList.contains('hidden')) {
        openSleepMenu(el.sleepMenu.classList.contains('hidden'));
      }
      break;
    case 'Escape':
      if (!el.sleepMenu.classList.contains('hidden')) openSleepMenu(false);
      else if (!el.foldersMenu.classList.contains('hidden')) openFoldersMenu(false);
      else if (!el.toast.classList.contains('hidden')) hideToast();
      else if (el.libraryView.classList.contains('hidden')) goBack();
      break;
    default: break;
  }
});

/* ---------------- bootstrap ---------------- */

function applyState(next) {
  el.libraryLoading.classList.add('hidden');
  state.books = next.books;
  state.progress = next.progress;
  state.folders = next.folders;
  if (next.folderCounts) state.folderCounts = next.folderCounts;
  if (next.bookmarks) state.bookmarks = next.bookmarks;
  if (next.normalization) state.normalization = next.normalization;

  // Keep the open book in sync with rescanned data.
  if (state.current) {
    const refreshed = state.books.find((b) => b.id === state.current.id);
    if (refreshed) {
      state.current = refreshed;
      renderBookHeader(refreshed);
      renderChapters(refreshed);
      renderBookmarks(refreshed);
      updateFinishedButton(refreshed);
      updateMetadataUI(refreshed);
    } else {
      showLibrary();
    }
  }
  renderLibrary();
}

/**
 * Patch a single book in place (metadata:apply / metadata:clear only ever
 * change one book's title/author/description/cover) instead of going through
 * applyState's full-library replace — those two IPC calls now return just
 * `{ book }` rather than the whole currentState(), so there's no full array
 * to diff against here either.
 */
function patchBook(book) {
  if (!book) return;
  const idx = state.books.findIndex((b) => b.id === book.id);
  if (idx === -1) return;
  state.books[idx] = book;

  if (state.current?.id === book.id) {
    state.current = book;
    renderBookHeader(book);
    renderChapters(book);
    renderBookmarks(book);
    updateFinishedButton(book);
    updateMetadataUI(book);
  }
  renderLibrary();
}

window.api.onLibraryChanged(applyState);
window.api.onScanProgress(({ done, total, scanning }) => {
  el.scanStatus.textContent = scanning
    ? (total ? `Scanning ${done}/${total}…` : 'Scanning…')
    : '';
  el.rescanBtn.disabled = scanning;

  el.scanProgressBar.classList.toggle('hidden', !scanning);
  el.scanProgressBar.classList.toggle('indeterminate', scanning && !total);
  el.scanProgressFill.style.width = total ? `${Math.min(100, (done / total) * 100)}%` : '0%';
});

el.groupToggle.setAttribute('aria-pressed', String(state.groupSeries));
el.sortSelect.value = state.sort;
applySkipAmount(state.skipAmount);

/* ---------------- theme ---------------- */

const lightMedia = window.matchMedia('(prefers-color-scheme: light)');

/** The theme currently in effect: an explicit override, else the OS preference. */
function effectiveTheme() {
  return document.documentElement.getAttribute('data-theme')
    || (lightMedia.matches ? 'light' : 'dark');
}

function updateThemeButton() {
  // Show the sun in dark mode (click for light) and the moon in light mode.
  el.themeIcon.setAttribute('href', effectiveTheme() === 'dark' ? '#icon-sun' : '#icon-moon');
}

function toggleTheme() {
  const next = effectiveTheme() === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  updateThemeButton();
}

el.themeBtn.addEventListener('click', toggleTheme);
// Follow OS changes when the user hasn't chosen an explicit override.
lightMedia.addEventListener('change', () => {
  if (!localStorage.getItem('theme')) updateThemeButton();
});
updateThemeButton();

// Needed before the first src assignment so the Web Audio analyser (skip
// silence) can read the ab-media:// stream instead of a tainted, all-zero one.
el.audio.crossOrigin = 'anonymous';
el.audio.preservesPitch = true;
el.skipSilenceBtn.setAttribute('aria-pressed', String(state.skipSilence));
el.normalizeBtn.setAttribute('aria-pressed', String(state.normalize));
el.discordBtn.setAttribute('aria-pressed', String(state.discordPresence));
// The main process's enabled flag starts false regardless of what was
// persisted last session — sync it once at startup rather than waiting for
// the user to click the button again.
window.api.setDiscordPresenceEnabled(state.discordPresence);

/* ---------------- OS media integration ----------------
 * mediaSession action handlers are set once here rather than per-book — they
 * close over live state (state.playing, state.skipAmount) so they stay
 * correct as playback moves between books. This is what makes the Windows
 * media flyout, lock screen, and hardware/keyboard media keys work; the
 * taskbar thumbbar buttons (main process, src/main/taskbar.js) are a
 * separate native Shell feature and route through media:control instead,
 * since only this renderer knows how to actually drive playback.
 * ---------------- */

if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', () => { el.audio.play().catch(() => {}); });
  navigator.mediaSession.setActionHandler('pause', () => pauseWithBookmark());
  navigator.mediaSession.setActionHandler('previoustrack', () => jumpChapter(-1));
  navigator.mediaSession.setActionHandler('nexttrack', () => jumpChapter(1));
  navigator.mediaSession.setActionHandler('seekbackward', () => seekTo(globalTime() - state.skipAmount));
  navigator.mediaSession.setActionHandler('seekforward', () => seekTo(globalTime() + state.skipAmount));
}

window.api.onMediaControl((action) => {
  if (action === 'prev') jumpChapter(-1);
  else if (action === 'next') jumpChapter(1);
  else if (action === 'playpause') togglePlayPause();
});

/** Opens a book by id if it's actually in the loaded library — used for both a jump-list launch and a jump-list click while already running. */
function openBookIfExists(bookId) {
  if (bookId && state.books.some((b) => b.id === bookId)) openBook(bookId);
}
window.api.onOpenBook(openBookIfExists);

window.api.getState().then((s) => {
  applyState(s);
  // One-shot: only set when this launch came from a taskbar jump-list click.
  window.api.getInitialOpenBook().then(openBookIfExists);
});
