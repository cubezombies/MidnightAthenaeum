'use strict';

const $ = (id) => document.getElementById(id);

const el = {
  grid: $('grid'), emptyState: $('emptyState'), search: $('search'),
  libraryView: $('libraryView'), bookView: $('bookView'),
  viewTitle: $('viewTitle'), backBtn: $('backBtn'), scanStatus: $('scanStatus'),
  addFolderBtn: $('addFolderBtn'), emptyAddBtn: $('emptyAddBtn'), rescanBtn: $('rescanBtn'),
  bookCover: $('bookCover'), bookTitle: $('bookTitle'), bookAuthor: $('bookAuthor'),
  bookSub: $('bookSub'), bookDesc: $('bookDesc'), chapterList: $('chapterList'),
  chapterCount: $('chapterCount'), resetProgressBtn: $('resetProgressBtn'),
  player: $('player'), audio: $('audio'), playBtn: $('playBtn'), seek: $('seek'),
  timeCurrent: $('timeCurrent'), timeTotal: $('timeTotal'),
  prevChapterBtn: $('prevChapterBtn'), nextChapterBtn: $('nextChapterBtn'),
  back30Btn: $('back30Btn'), fwd30Btn: $('fwd30Btn'),
  speed: $('speed'), volume: $('volume'),
  miniCover: $('miniCover'), nowTitle: $('nowTitle'), nowChapter: $('nowChapter'),
};

const state = {
  books: [],
  progress: {},
  folders: [],
  current: null,       // book being viewed
  playing: null,       // book loaded in the player
  trackIndex: -1,      // which file of a multi-track book is loaded
  pendingSeek: null,   // position to apply once the loading track reports metadata
  activeChapter: -1,
  seeking: false,
};

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

function renderGrid() {
  const query = el.search.value.trim().toLowerCase();
  const books = query
    ? state.books.filter((b) =>
        b.title.toLowerCase().includes(query) || b.author.toLowerCase().includes(query))
    : state.books;

  el.emptyState.classList.toggle('hidden', state.books.length > 0);
  el.grid.replaceChildren();

  for (const book of books) {
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
    el.grid.append(card);
  }
}

/* ---------------- book view ---------------- */

function showLibrary() {
  state.current = null;
  el.libraryView.classList.remove('hidden');
  el.bookView.classList.add('hidden');
  el.backBtn.classList.add('hidden');
  el.viewTitle.textContent = 'Library';
  renderGrid();
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
  const local = Number.isFinite(el.audio.currentTime) ? el.audio.currentTime : 0;
  return (track?.offset ?? 0) + local;
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
  const resumeAt = saved && !saved.finished ? saved.position : 0;
  seekTo(resumeAt, { autoplay: false });
}

/**
 * Seek to a whole-book position, switching track if needed.
 * `autoplay` keeps playback going when the jump crosses a file boundary.
 */
function seekTo(globalSeconds, { autoplay = null } = {}) {
  const book = state.playing;
  if (!book) return;

  const total = book.duration || 0;
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
  const total = book?.duration || 0;
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

  const duration = book.duration || 0;
  state.progress[book.id] = {
    position,
    duration,
    finished: duration ? position >= duration - 30 : false,
    updatedAt: Date.now(),
  };
  window.api.saveProgress({ bookId: book.id, position, duration });
}

/* ---------------- events ---------------- */

el.playBtn.addEventListener('click', () => {
  if (el.audio.paused) el.audio.play().catch((err) => console.error('playback failed:', err));
  else el.audio.pause();
});

el.audio.addEventListener('play', () => { el.playBtn.textContent = '❚❚'; el.playBtn.setAttribute('aria-label', 'Pause'); });
el.audio.addEventListener('pause', () => { el.playBtn.textContent = '▶'; el.playBtn.setAttribute('aria-label', 'Play'); flushProgress(); });
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
  renderGrid();
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
  const total = state.playing?.duration || 0;
  state.seeking = false;
  if (total > 0) { seekTo((Number(el.seek.value) / 1000) * total); flushProgress(); }
});

el.back30Btn.addEventListener('click', () => seekTo(globalTime() - 30));
el.fwd30Btn.addEventListener('click', () => seekTo(globalTime() + 30));
el.prevChapterBtn.addEventListener('click', () => jumpChapter(-1));
el.nextChapterBtn.addEventListener('click', () => jumpChapter(1));

el.speed.addEventListener('change', () => { el.audio.playbackRate = Number(el.speed.value); });
el.volume.addEventListener('input', () => { el.audio.volume = Number(el.volume.value); });

el.backBtn.addEventListener('click', showLibrary);
el.search.addEventListener('input', renderGrid);

el.addFolderBtn.addEventListener('click', () => window.api.addFolder().then(applyState));
el.emptyAddBtn.addEventListener('click', () => window.api.addFolder().then(applyState));
el.rescanBtn.addEventListener('click', () => window.api.rescan().then(applyState));

el.resetProgressBtn.addEventListener('click', async () => {
  if (!state.current) return;
  state.progress = await window.api.clearProgress(state.current.id);
  if (state.playing?.id === state.current.id) seekTo(0, { autoplay: false });
  renderGrid();
});

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea')) return;
  switch (e.key) {
    case ' ':        e.preventDefault(); el.playBtn.click(); break;
    case 'ArrowLeft':  seekTo(globalTime() - (e.shiftKey ? 300 : 30)); break;
    case 'ArrowRight': seekTo(globalTime() + (e.shiftKey ? 300 : 30)); break;
    case 'Escape':   if (state.current) showLibrary(); break;
    default: break;
  }
});

/* ---------------- bootstrap ---------------- */

function applyState(next) {
  state.books = next.books;
  state.progress = next.progress;
  state.folders = next.folders;

  // Keep the open book in sync with rescanned data.
  if (state.current) {
    const refreshed = state.books.find((b) => b.id === state.current.id);
    if (refreshed) { state.current = refreshed; renderChapters(refreshed); }
    else showLibrary();
  }
  renderGrid();
}

window.api.onLibraryChanged(applyState);
window.api.onScanProgress(({ done, total, scanning }) => {
  el.scanStatus.textContent = scanning
    ? (total ? `Scanning ${done}/${total}…` : 'Scanning…')
    : '';
  el.rescanBtn.disabled = scanning;
});

window.api.getState().then(applyState);
