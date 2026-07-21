# Roadmap & Future Features

Forward-looking ideas for the player. Grounded in what is already built (see
`src/`) and in what a real ~6,300-book library on this machine actually contains,
so the suggestions are concrete rather than aspirational.

Each item is tagged with rough effort — **S** (hours), **M** (a day or two),
**L** (several days) — and a note when it also resolves a known limitation from
the README.

---

## Where the app stands today

Already shipped, so it is not repeated in the lists below:

- Library scan with book grouping (single `.m4b`, `.mp3` folders, disc merge,
  numbered-part merge by duration), size+mtime cache.
- Custom MP4 chapter parser for QuickTime text chapter tracks (`mp4-chapters.js`).
- Multi-track unified timeline, chapter navigation, 30s skip, 0.75–3× speed,
  volume, per-book resume, keyboard shortcuts.
- `ab-media://` protocol with byte-range seeking; cover extraction with folder
  fallback; paged grid rendering.
- **Sleep timer** — fixed duration / end-of-chapter / end-of-book, with a 20s
  volume fade, 30s rewind on resume, and a "+5 min" extend (Tier 1 #1, shipped).
- **Bookmarks** — named marks with notes, jump-to, list view in the book detail,
  and a rolling "last stop" auto-bookmark on manual pause (Tier 1 #2, shipped).
- **Continue-listening shelf + filters** — in-progress books surfaced at the top
  of the library, most-recent first, plus All / In progress / Finished / Not
  started tabs (Tier 1 #7–#8, shipped).
- **Per-book speed + auto-rewind** — each book remembers its playback speed;
  resuming rewinds a few seconds, scaled to how long you were paused
  (Tier 1 #5–#6, shipped).
- **Series grouping** — a toggle collapses a series' volumes into one tile with a
  drill-in series view; series name + index parsed from the title, author-guarded
  against franchise over-grouping; renderer-only, no re-scan (Tier 1 #7, shipped).

Known gaps carried forward as motivation: series volumes can share a display
title, box sets stay whole, and merged `.m4b` parts collapse to one chapter each.

---

## Tier 1 — Parity features users expect (and we lack)

These are table stakes across Smart AudioBook Player, BookPlayer, Listen, and
Prologue. Their absence is the most likely reason someone would keep another app
open alongside this one.

### 1. Sleep timer — **shipped** ✅
End-of-chapter, fixed duration, or "end of book"; a 20s volume fade rather than a
hard stop; 30s rewind on resume; "+5 min" extend. Renderer-only (`app.js` timer
driving `el.audio.volume`, control in the player bar, `T` to open the menu).
*Still possible:* a true system-wide hotkey and tray "+5 min" (needs main-process
`globalShortcut` / `Tray`), deferred to keep this renderer-only.

### 2. Bookmarks with notes — **shipped** ✅
Named bookmarks with an optional note, a list view in the book detail (rename,
note, jump-to, delete), and a single rolling "last stop" auto-bookmark dropped on
manual pause (editing it makes it permanent). Persisted in `bookmarks.json` via
the same `JsonStore`. Still the foundation for clip export (Tier 2).
*Possible next:* a bookmark count/indicator on library cards, and global
cross-book bookmark search once the data layer moves to SQLite.

### 3. Skip silence / "smart speed" — **M/L**
Real-time detection of silent gaps and long pauses, shortening them without an
audible cut. On a 40-hour book this reclaims hours. Two viable paths: the Web
Audio API with an `AnalyserNode` gating playbackRate, or an offline pass that
records silence spans per file for exact, glitch-free skipping.
*Note:* pairs naturally with auto-chapter generation (Tier 3, item 3) since both
rest on silence detection.

### 4. Volume normalization / loudness leveling — **M**
Libraries are ripped from many sources at wildly different levels; jumping
between books currently means grabbing the volume slider. Apply per-book gain
from a one-time loudness scan (EBU R128 / ReplayGain-style), stored in the
library entry, applied via a Web Audio `GainNode`.

### 5. Per-book & persisted playback speed — **shipped** ✅
Each book stores its last speed in `progress.json` and restores it on open
(`defaultPlaybackRate` is set so it survives multi-track boundaries).
*Possible next:* a per-narrator default once narrator metadata is reliable.

### 6. Auto-rewind after pause — **shipped** ✅
On resume, rewinds a few seconds scaled to how long you were paused (0 under 30s,
3s, 10s, up to 20s after an hour+). Kept separate from the sleep timer's fixed
30s resume-rewind.

### 7. Library organization: sort, filter, series & collections — **mostly shipped** ✅
Filter tabs and **series grouping** (collapse a series' volumes into one tile, with
a drill-in view) both ship — series parsed from the title, author-guarded. **Still
open:** sort options (author / title / recently added / duration), and better
series coverage. Title-parsing groups ~30% of books (~360 series); the misses are
un-numbered series (Dune's prequels, standalone novellas) and folder-numbered
books whose title omits the series — those want the sidecar/online metadata below.

### 8. "Continue listening" shelf + finished state — **shipped** ✅
In-progress books surface in a row at the top of the library, most-recently-played
first, hidden while searching or filtering. Finished state drives the filter tabs.

### 9. Light theme + theme toggle — **S**
Currently dark-only. The CSS already uses variables, so a light palette behind a
`prefers-color-scheme` default plus a manual toggle is small.

---

## Tier 2 — Differentiators (rare or absent in Windows players)

Where this app can be better than what exists, not just equal to it.

### 1. Local full-text search inside audiobooks (Whisper) — **L** ⭐
Transcribe books locally with `whisper.cpp` (offline, no cloud, GPU-optional),
store a timestamped transcript, and let the user search *the spoken words* —
"find where they first mention the sword" — and jump to that moment. Also enables
readable captions and per-chapter summaries. A handful of iOS apps ("Chapters")
do surrounding-text transcription; essentially **no Windows player does this**.
Transcription is a slow background job, which fits the existing task model.
*Foundation for:* semantic bookmarks, "quote this passage", accessibility.

### 2. Windows System Media Transport Controls (SMTC) — **M** ⭐
Wire up the Windows media flyout and hardware/keyboard media keys (play/pause,
next/prev chapter, cover + title on the volume overlay and lock screen). Most
Electron audiobook apps skip this and feel un-native as a result. Achievable via
`electron`'s media-session support or a small native module. Add taskbar
thumbnail-toolbar buttons and a jump list of recent books while in that layer.

### 3. Listening statistics & streaks — **M**
Total time listened, books finished, current streak, top authors/narrators, pace
over time. `progress.json` timestamps already capture most of the raw signal.
A stats page is a strong retention feature and easy to make visually appealing.

### 4. Bookmark clips: export & share cards — **M**
Turn a bookmark span into a short audio clip (via ffmpeg) or a shareable image
card with cover + quote + timestamp. Differentiating and delightful; depends on
bookmarks (Tier 1) and optionally transcripts (item 1) for auto-captioned quotes.

### 5. Auto-fix metadata from online sources — **M/L**
Look up Audible / Open Library / Google Books to correct titles, split series,
fetch high-res covers and real descriptions. This is the *clean* fix for the
series-title display collision and missing covers — replace guessed tags with
authoritative data. Must be opt-in and cache locally (stay offline-first).

### 6. Read-along / immersion reading (audio + ebook) — **L** ⭐
The library holds **354 `.epub`, 139 `.mobi`, 116 `.pdf`** sitting next to audio
files. Pair an ebook with its audiobook and highlight text as it's narrated
(à la Kindle "Immersion Reading" / Storyteller). Even without word-level sync,
showing the matching ebook chapter alongside audio is valuable and unique on
Windows. Word-level sync is the ambitious version (needs the Whisper transcript
to align text to audio).

### 7. Discord Rich Presence — **S**
"Listening to *The Way of Kings* — Ch. 12". Tiny, popular with the target
audience, one small dependency.

### 8. Voice-clarity EQ / voice boost — **M**
A speech-tuned EQ (cut low rumble, lift high-mids) that keeps dialogue crisp at
2.5–3× where deep-voiced narration turns muddy. A Web Audio `BiquadFilter` chain
plus a "Voice Boost" toggle. Genuinely useful for fast listeners.

---

## Tier 3 — Format & content depth (leveraging the real library)

Concrete because the numbers come from the actual `E:\Books` scan.

### 1. `.cue` sheet chapter markers — **shipped** ✅
Parses a sibling `.cue` (`src/main/cue.js`) as a **fallback** when a single-file
book has no embedded chapters, recovering titles + offsets (INDEX `MM:SS:FF`).
Real embedded chapters are never overridden. Turned out narrower than hoped —
most of the 656 `.cue` files pair with `.m4b` that already carry chapters — so it
helped ~47 books, but those were genuinely unnavigable single `.mp3`s (some
80–180 chapters). Applied to the existing library via a one-off backfill; future
scans do it inline.

### 2. Sidecar metadata: `.nfo`, `.opf`, `metadata.json` — **M** (investigated)
Coverage on the real library is thinner than hoped and does **not** meaningfully
help series detection, which is why series grouping (Tier 1 #7) shipped from title
parsing instead. What's actually there: **504 `.nfo`** — freeform text with Title
/ Author / "Read By" (narrator) but *no* series field; **51 `.opf`** — Calibre
metadata (has `calibre:series`) but sitting in `E-Books/` subfolders beside the
ebook, not the audio; and rare **`metadata.abs`** (Audiobookshelf) which *does*
carry a clean `series=`. The real win here is **narrator + description** from
`.nfo`, and picking up `series` from a co-located `.abs`/`.opf` to fill gaps the
title parser misses (Dune, folder-numbered books). Needs a re-scan to apply.

### 3. Auto-generate chapters for chapterless books — **M/L**
Many mp3-folder books have no real chapters. Detect long silences to synthesize
chapter breaks, or (better) reuse the Whisper transcript to place semantically
sensible marks. Shares the silence-detection engine with skip-silence.

### 4. Gapless multi-track playback — **S/M**
At file boundaries in a multi-track book there can be a tiny stall while the next
`ab-media://` source loads. Preload/prime the next track's element (double-buffer
two `<audio>` nodes and cross-hand at the boundary) for seamless rollover. Purely
a `seekTo`/`ended` refinement in `app.js`.

### 5. Per-chapter embedded artwork — **S**
Some `.m4b` chapters carry their own images (`IChapter.image`). Surface them in
the chapter list / now-playing view for books that have them.

### 6. Audible `.aax` / `.aaxc` support — **L**
Decrypt owned Audible files with the user's activation bytes (the Libation
approach) so an Audible library plays natively. Legally sensitive and heavier;
list it, gate it behind explicit user-supplied credentials, and treat as a later,
optional module.

---

## Performance & architecture optimizations

The current design loads a **57 MB `library.json` fully into memory and ships the
whole thing over IPC**, renders cards by appending pages, and serves full-size
covers. That works at 6,300 books but is the main scaling ceiling.

### 1. Move the library to SQLite — **M/L** ⭐
Replace the monolithic JSON with `better-sqlite3`. Query per view (a page, a
search, one book) instead of loading and IPC-transferring everything at startup.
Enables instant search, partial updates on rescan, bookmarks/stats tables, and
kills the big IPC payload. Highest-leverage architectural change.

### 2. Cover thumbnails — **M**
Generate and cache small (~200 px WebP) thumbnails at scan time; the grid loads
those instead of full covers. Cuts grid memory and decode time sharply — the
biggest contributor to the renderer's footprint on a large library.

### 3. True virtualized grid — **M**
The grid appends pages but never releases off-screen cards, so memory still grows
as you scroll a 6k-book library. A windowing/recycling list (render only the
visible range ± a buffer) bounds DOM and memory regardless of scroll depth.

### 4. Incremental scan via file watcher — **M**
A full rescan of `E:\Books` takes ~40 minutes. Watch library folders (`chokidar`)
and update only what changed, so new books appear without a manual full rescan.
The size+mtime cache already makes rescans cheap; this closes the loop to
near-real-time.

### 5. Two-phase / lazy scanning — **M**
Phase 1: walk paths + read durations only (fast; enough to build the grouping and
show the grid). Phase 2: extract covers and chapters lazily — on demand when a
book is opened, or as a low-priority background pass. Gets a usable library on
screen in seconds instead of minutes on first run.

### 6. Worker-thread parsing — **S/M**
Move metadata/chapter parsing into `worker_threads` so a first-run scan doesn't
contend with the main process and the UI stays responsive. The scan is I/O bound
today but CPU cost rises once loudness analysis and thumbnails are added.

### 7. Waveform / seek preview — **M**
Precompute a coarse waveform per book for a richer seek bar and instant scrub
previews. Cache next to the cover. Nice-to-have that also visualizes chapter
boundaries.

---

## Suggested sequencing

A pragmatic order that front-loads visible value and unblocks later work:

1. **Sleep timer, auto-rewind, persisted per-book speed** (Tier 1: 1, 5, 6) —
   small, high daily value, no architectural change.
2. **Bookmarks** (Tier 1: 2) — foundation for clips, stats, and Whisper anchors.
3. **SQLite migration + cover thumbnails** (Opt: 1, 2) — unblocks scale, search,
   and every table-backed feature that follows.
4. **`.cue` + sidecar metadata + series grouping** (Tier 3: 1–2, Tier 1: 7) —
   fixes the biggest known metadata/limitations for a large slice of the library.
5. **SMTC + statistics** (Tier 2: 2–3) — makes it feel native and sticky.
6. **Whisper transcription & search, read-along** (Tier 2: 1, 6) — the flagship
   differentiators, once the data layer can hold their output.

---

## Sources / prior art

Feature landscape informed by current audiobook players and reviews:

- [Voice Audiobook Player (open source)](https://f-droid.org/en/packages/de.ph1b.audiobook/)
- [Smart AudioBook Player](https://play.google.com/store/apps/details?id=ak.alizandro.smartaudiobookplayer)
- [Listen Audiobook Player](https://play.google.com/store/apps/details?id=com.acmeandroid.listen)
- [BookPlayer](https://apps.apple.com/us/app/bookplayer/id1138219998)
- [Chapters (transcription + bookmark search)](https://chapters.mobileappster.co.uk/)
- [Abookio (stats & streaks)](https://apps.apple.com/us/app/abookio-audiobook-player/id6754542041)
- [Best audiobook players for Windows](https://windowsreport.com/audiobook-players/)
