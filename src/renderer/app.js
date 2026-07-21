'use strict';

const $ = (id) => document.getElementById(id);

const el = {
  main: $('main'),
  grid: $('grid'), emptyState: $('emptyState'), search: $('search'),
  continueSection: $('continueSection'), continueRow: $('continueRow'),
  libraryToolbar: $('libraryToolbar'), filterTabs: $('filterTabs'), filterCount: $('filterCount'),
  libraryView: $('libraryView'), bookView: $('bookView'),
  viewTitle: $('viewTitle'), backBtn: $('backBtn'), scanStatus: $('scanStatus'),
  addFolderBtn: $('addFolderBtn'), emptyAddBtn: $('emptyAddBtn'), rescanBtn: $('rescanBtn'),
  bookCover: $('bookCover'), bookTitle: $('bookTitle'), bookAuthor: $('bookAuthor'),
  bookSub: $('bookSub'), bookDesc: $('bookDesc'), chapterList: $('chapterList'),
  chapterCount: $('chapterCount'), resetProgressBtn: $('resetProgressBtn'),
  bookmarkBtn: $('bookmarkBtn'), bookmarkHereBtn: $('bookmarkHereBtn'),
  bookmarkList: $('bookmarkList'), bookmarkCount: $('bookmarkCount'),
  player: $('player'), audio: $('audio'), playBtn: $('playBtn'), seek: $('seek'),
  timeCurrent: $('timeCurrent'), timeTotal: $('timeTotal'),
  prevChapterBtn: $('prevChapterBtn'), nextChapterBtn: $('nextChapterBtn'),
  back30Btn: $('back30Btn'), fwd30Btn: $('fwd30Btn'),
  speed: $('speed'), volume: $('volume'),
  miniCover: $('miniCover'), nowTitle: $('nowTitle'), nowChapter: $('nowChapter'),
  sleep: $('sleep') || document.querySelector('.sleep'),
  sleepBtn: $('sleepBtn'), sleepLabel: $('sleepLabel'), sleepMenu: $('sleepMenu'),
  sleepSnooze: document.querySelector('.sleep-extend'),
};

const state = {
  books: [],
  progress: {},
  bookmarks: {},       // { [bookId]: Bookmark[] }
  folders: [],
  current: null,       // book being viewed
  playing: null,       // book loaded in the player
  trackIndex: -1,      // which file of a multi-track book is loaded
  pendingSeek: null,   // position to apply once the loading track reports metadata
  activeChapter: -1,
  seeking: false,
  filter: 'all',       // library filter: all | progress | finished | new
  pausedAt: 0,         // timestamp of the last pause, for resume auto-rewind
  filtered: [],        // books matching the current search
  gridShown: 0,        // how many cards are currently in the DOM
  userVolume: 1,       // volume the user set; audio volume = this * sleep fade
  sleep: {
    mode: 'off',       // 'off' | 'duration' | 'chapter' | 'book'
    remainingMs: 0,    // duration mode: playback time left before firing
    fadeGain: 1,       // 1 normally, ramps to 0 over the closing fade
    firedPaused: false,// true when the timer paused us (so resume rewinds)
  },
};

let gridObserver = null;
const SLEEP_FADE_SEC = 20;   // gentle fade over the final stretch
const SLEEP_REWIND_SEC = 30; // rewind on resume after the timer stops you

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

function buildCard(book) {
  const saved = state.progress[book.id];
  const pct = saved && book.duration
    ? Math.min(100, (saved.position / book.duration) * 100)
    : 0;

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
    ph.textContent = '🎧';
    art.append(ph);
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
  card.addEventListener('click', () => openBook(book.id));
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openBook(book.id); }
  });
  return card;
}

/** Where a book sits in its lifecycle, from saved progress. */
function bookStatus(bookId) {
  const p = state.progress[bookId];
  if (!p) return 'new';
  if (p.finished) return 'finished';
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

/** Render the whole library view: Continue-listening shelf, toolbar, grid. */
function renderLibrary() {
  renderContinueShelf();
  renderGrid();
}

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

/**
 * A 10k-book library is far too many cards to put in the DOM at once (it costs
 * ~2 GB). Render in pages and append the next one when a sentinel near the
 * bottom scrolls into view, so the node count tracks how far the user has
 * actually scrolled rather than the library size.
 */
function renderGrid() {
  const query = el.search.value.trim().toLowerCase();
  state.filtered = state.books.filter((b) => {
    if (!matchesFilter(b)) return false;
    if (!query) return true;
    return b.title.toLowerCase().includes(query) || b.author.toLowerCase().includes(query);
  });

  el.emptyState.classList.toggle('hidden', state.books.length > 0);
  el.libraryToolbar.classList.toggle('hidden', state.books.length === 0);
  el.filterCount.textContent = `${state.filtered.length.toLocaleString()} book${state.filtered.length === 1 ? '' : 's'}`;

  gridObserver?.disconnect();
  el.grid.replaceChildren();
  state.gridShown = 0;
  appendGridPage();
}

function appendGridPage() {
  const books = state.filtered;
  const end = Math.min(state.gridShown + GRID_PAGE, books.length);
  const frag = document.createDocumentFragment();
  for (let i = state.gridShown; i < end; i += 1) frag.append(buildCard(books[i]));
  el.grid.append(frag);
  state.gridShown = end;

  if (end < books.length) {
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

/* ---------------- book view ---------------- */

function showLibrary() {
  state.current = null;
  el.libraryView.classList.remove('hidden');
  el.bookView.classList.add('hidden');
  el.backBtn.classList.add('hidden');
  el.viewTitle.textContent = 'Library';
  renderLibrary();
}

function openBook(bookId) {
  const book = state.books.find((b) => b.id === bookId);
  if (!book) return;

  state.current = book;
  el.libraryView.classList.add('hidden');
  el.bookView.classList.remove('hidden');
  el.backBtn.classList.remove('hidden');
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

  renderChapters(book);
  renderBookmarks(book);
  loadIntoPlayer(book);
}

function renderChapters(book) {
  el.chapterList.replaceChildren();
  el.chapterCount.textContent = book.chapters.length ? `(${book.chapters.length})` : '';

  if (!book.chapters.length) {
    const li = document.createElement('li');
    li.className = 'no-chapters';
    li.textContent = 'This file has no embedded chapters — use the 30-second skip buttons to navigate.';
    el.chapterList.append(li);
    return;
  }

  book.chapters.forEach((ch, i) => {
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
  });
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
    li.textContent = 'No bookmarks yet — press B or the 🔖 button while listening to mark a spot.';
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
  del.textContent = '🗑';
  del.title = 'Delete bookmark';
  del.addEventListener('click', async () => {
    state.bookmarks = await window.api.removeBookmark({ bookId: book.id, id: bm.id });
    refreshBookmarksView();
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

function loadIntoPlayer(book) {
  if (state.playing?.id === book.id) return;

  flushProgress();
  state.playing = book;
  state.activeChapter = -1;
  state.trackIndex = -1;

  el.player.classList.remove('hidden');
  document.body.classList.add('playing');

  el.miniCover.src = book.coverUrl || '';
  el.nowTitle.textContent = book.title;
  el.nowChapter.textContent = book.author;
  el.timeTotal.textContent = formatTime(book.duration);

  const saved = state.progress[book.id];
  applySpeed(saved?.speed ?? 1);
  state.pausedAt = 0; // don't auto-rewind on the first play of a freshly opened book

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
  el.speed.value = String(r);
  el.audio.defaultPlaybackRate = r;
  el.audio.playbackRate = r;
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
    }
  }
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
    finished: duration ? position >= duration - 30 : false,
    speed,
    updatedAt: Date.now(),
  };
  window.api.saveProgress({ bookId: book.id, position, duration, speed });
}

/* ---------------- sleep timer ---------------- */

/** Actual audio volume is the user's setting scaled by the sleep fade. */
function applyVolume() {
  el.audio.volume = Math.max(0, Math.min(1, state.userVolume * state.sleep.fadeGain));
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

el.playBtn.addEventListener('click', () => {
  if (el.audio.paused) {
    el.audio.play().catch((err) => console.error('playback failed:', err));
  } else {
    // Manual pause (button or spacebar): remember where we stopped.
    addBookmark({ auto: true });
    el.audio.pause();
  }
});

el.audio.addEventListener('play', () => {
  el.playBtn.textContent = '❚❚';
  el.playBtn.setAttribute('aria-label', 'Pause');

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
  el.playBtn.textContent = '▶';
  el.playBtn.setAttribute('aria-label', 'Play');
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

el.back30Btn.addEventListener('click', () => seekTo(globalTime() - 30));
el.fwd30Btn.addEventListener('click', () => seekTo(globalTime() + 30));
el.prevChapterBtn.addEventListener('click', () => jumpChapter(-1));
el.nextChapterBtn.addEventListener('click', () => jumpChapter(1));

el.speed.addEventListener('change', () => { applySpeed(Number(el.speed.value)); flushProgress(); });
el.volume.addEventListener('input', () => { state.userVolume = Number(el.volume.value); applyVolume(); });

el.backBtn.addEventListener('click', showLibrary);
el.search.addEventListener('input', renderLibrary);

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

el.addFolderBtn.addEventListener('click', () => window.api.addFolder().then(applyState));
el.emptyAddBtn.addEventListener('click', () => window.api.addFolder().then(applyState));
el.rescanBtn.addEventListener('click', () => window.api.rescan().then(applyState));

el.resetProgressBtn.addEventListener('click', async () => {
  if (!state.current) return;
  state.progress = await window.api.clearProgress(state.current.id);
  if (state.playing?.id === state.current.id) seekTo(0, { autoplay: false });
  renderLibrary();
});

el.bookmarkBtn.addEventListener('click', () => addBookmark());
el.bookmarkHereBtn.addEventListener('click', () => addBookmark());

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea')) return;
  switch (e.key) {
    case ' ':        e.preventDefault(); el.playBtn.click(); break;
    case 'ArrowLeft':  seekTo(globalTime() - (e.shiftKey ? 300 : 30)); break;
    case 'ArrowRight': seekTo(globalTime() + (e.shiftKey ? 300 : 30)); break;
    case 'b': case 'B':
      if (state.playing || state.current) addBookmark();
      break;
    case 't': case 'T':
      if (!el.player.classList.contains('hidden')) {
        openSleepMenu(el.sleepMenu.classList.contains('hidden'));
      }
      break;
    case 'Escape':
      if (!el.sleepMenu.classList.contains('hidden')) openSleepMenu(false);
      else if (state.current) showLibrary();
      break;
    default: break;
  }
});

/* ---------------- bootstrap ---------------- */

function applyState(next) {
  state.books = next.books;
  state.progress = next.progress;
  state.folders = next.folders;
  if (next.bookmarks) state.bookmarks = next.bookmarks;

  // Keep the open book in sync with rescanned data.
  if (state.current) {
    const refreshed = state.books.find((b) => b.id === state.current.id);
    if (refreshed) {
      state.current = refreshed;
      renderChapters(refreshed);
      renderBookmarks(refreshed);
    } else {
      showLibrary();
    }
  }
  renderLibrary();
}

window.api.onLibraryChanged(applyState);
window.api.onScanProgress(({ done, total, scanning }) => {
  el.scanStatus.textContent = scanning
    ? (total ? `Scanning ${done}/${total}…` : 'Scanning…')
    : '';
  el.rescanBtn.disabled = scanning;
});

window.api.getState().then(applyState);
