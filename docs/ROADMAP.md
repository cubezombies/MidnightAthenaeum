# Roadmap & Future Features

Forward-looking ideas for the player. Grounded in what is already built (see
`src/`) and in what a real ~6,300-book library on this machine actually contains,
so the suggestions are concrete rather than aspirational.

Each item is tagged with rough effort — **S** (hours), **M** (a day or two),
**L** (several days) — and a note when it also resolves a known limitation from
the README.

Book counts quoted below vary (~6,300 in older entries, 5,825 today) because
the library itself changed — duplicate detection alone found 468 removable
copies. Each figure is what was actually measured at the time, so they are
left as written rather than retro-fitted to today's number.

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
- **Skip silence** — a Web Audio analyser detects sustained quiet gaps and
  briefly boosts playbackRate through them (Tier 1 #3, shipped).
- **Volume normalization** — measures each book's loudness on first play and
  applies a gain toward a common target via a Web Audio graph, on by default
  (Tier 1 #4, shipped).
- **Continue-listening shelf + filters + sort** — in-progress books surfaced at
  the top of the library, most-recent first; All / In progress / Finished / Not
  started tabs; sort by author/title/added/played/duration (Tier 1 #5–#8,
  shipped).
- **Series grouping** — a toggle collapses a series' volumes into one tile with a
  drill-in series view; series name + index parsed from the title, author-guarded
  against franchise over-grouping; renderer-only, no re-scan (Tier 1 #7, shipped).
- **Light theme** — follows the OS by default; a top-bar toggle overrides it,
  applied before paint so there's no flash on launch (Tier 1 #9, shipped).
- **Library folder management, safety & polish (Tier 1 #10–17, all shipped)** —
  a Folders panel to view/remove library folders (plus drag-and-drop to add
  one); an Undo toast on Reset Progress and bookmark delete instead of a
  blocking confirm, since both are reversible; backup/restore of
  progress+bookmarks+normalization to a sibling folder so deleting the data
  folder can't take backups down with it; a customizable skip amount for the
  ↺/↻ buttons; a manual "mark as finished/not finished" override; a chapter
  list search box (validated against the real 212-chapter *Wind and Truth*);
  and a "NEW" badge on books/series added since you last opened the app.
- **Online metadata lookup** — an opt-in, Open Library–backed "Look up online"
  button in the book view corrects title/author/description and fetches a
  high-res cover, cached locally so the app stays offline-first after applying
  (Tier 2 #5, shipped). Series-splitting from the original ask was descoped —
  see the item for why.
- **Windows installer + in-app updates** — an NSIS installer/uninstaller
  (`electron-builder`, standard per-user default location) built and
  published to GitHub Releases by CI on every version tag. **Help → Check for
  Updates…** checks Releases manually (never automatic), auto-downloads a
  newer version in the background, and shows its change notes pulled from
  `CHANGELOG.md` (Tier 1 #18, shipped). Shipped 2026-07-22.
- **Windows SMTC + taskbar integration** — the media flyout, lock screen, and
  hardware/keyboard media keys via `navigator.mediaSession`; taskbar
  thumbnail-toolbar buttons (prev/play-pause/next chapter); a jump list of
  recently-played books, backed by a proper single-instance lock (Tier 2 #2,
  shipped). Shipped 2026-07-22.
- **Discord Rich Presence** — an opt-in topbar toggle shows "Listening to
  *\<title>* — Ch. N" on Discord, updating on chapter changes and
  play/pause; off by default since it reports externally. Wraps
  `@xhayper/discord-rpc` defensively — a stuck/failed connection (Discord not
  running is the common case) is bounded to a few seconds with a retry
  cooldown, since the library doesn't reliably fail fast on its own (Tier 2
  #7, shipped). Needs a Discord Application ID (`DISCORD_CLIENT_ID`) to
  actually activate; inert without one. Shipped 2026-07-22.
- **Local Whisper transcription + search** — opt-in, per book: "Transcribe
  this book" runs `ffmpeg-static` + `@kutalia/whisper-node-addon` fully
  offline (GPU via Vulkan auto-detected, CPU/BLAS fallback), then "Search
  transcript" jumps straight to any spoken line, and a captions toggle shows
  the current line live (Tier 2 #1, shipped). Native-binary packaging through
  asar was the real risk here, not transcription itself — verified against
  an actual packaged build before shipping. Per-chapter summaries descoped
  (needs its own model/approach). Shipped 2026-07-22.
- **Duplicate book detection** — **File → Find duplicate books…** groups the
  already-scanned library by title+author, splitting into distinct
  recordings by matching duration/track count so genuinely different
  narrations are never confused with real duplicates (Tier 2 #9, shipped).
  Removal goes to the Recycle Bin, one book's own files only. Validated
  against this library: 376 titles, 468 removable copies found. Shipped
  2026-07-22.
- **Reorganize library by author** — **File → Reorganize library by
  author…** previews a move of every book into `<library folder>/<Author>/
  <Title>/` before touching disk, moves only on explicit confirm, and
  journals every individual move so **File → Undo last reorganization…** can
  reverse the whole run. A shared folder (unrelated books filed side by
  side) only has its own book's files moved, never the whole folder. Since
  book ids are derived from file path, execute/undo both carry progress,
  bookmarks, normalization, metadata overrides, and transcripts to a moved
  book's new id rather than orphaning them (Tier 2 #10, shipped). Verified
  against synthetic fixtures before ever touching real files, then
  hands-on confirmed against the real library, including undo. Shipped
  2026-07-23.
- **Voice Boost EQ** — the 🎚 button (`V` toggles) runs a ~100Hz highpass plus
  a ~2.8kHz presence-peak `BiquadFilterNode` pair, spliced into the same Web
  Audio graph as skip-silence/normalization, to keep dialogue intelligible
  at 2.5–3× where deep-voiced narration turns muddy (Tier 2 #8, shipped).
  Off by default; ramps smoothly rather than snapping. Shipped 2026-07-23.
- **Two-phase library scanning** — a scan shows the grid much sooner by
  deferring cover art and (for single-file books) chapter extraction to a
  low-priority background pass, with an on-demand fast-track for whatever
  book you open first (Performance & architecture #5, shipped). Confirmed
  faster hands-on against the real ~6,300-book library. Shipped 2026-07-23.
- **Read along (EPUB)** — pairs an EPUB with its audiobook and shows the
  matching chapter's text in a book-view side panel, opened via a per-book
  **Read along** button (auto-pairs by folder proximity, or pick manually);
  a background pass checks the whole library over time, powering a **Has
  ebook** filter and card badge. Auto-advances chapters when confident and
  estimates paragraph position from time elapsed — real word-level sync
  needs the Whisper transcript aligned to text and is future work (Tier 2
  #6, shipped, EPUB only). Confirmed working hands-on, including the
  paragraph-position estimate. Shipped 2026-07-23.

- **SQLite library store** — `library.json` became `library.db`
  (`src/main/db.js`), migrated automatically on first launch, old file kept
  as `.bak`. Per-row writes replace whole-file rewrites (Performance #1,
  backend swap shipped). Shipped 2026-07-24.
- **Virtualized grid + cover thumbnails** — the grid renders only what's near
  view, and loads ~200px cached thumbnails instead of full-size covers.
  Shipped together deliberately: virtualizing alone made scrolling back into
  a visited section *slower* (Performance #2/#3, shipped). Shipped 2026-07-24.
- **Listening statistics & streaks** — a Stats view with total time listened,
  books finished, current day streak, top authors/narrators, and a 12-week
  pace chart, backed by a new day-keyed `activity.json` (Tier 2 #3, shipped).
  Streak/pace accumulate from install forward; there was no history to
  backfill. Shipped 2026-07-24.
- **Scan reliability & speed on large libraries** — a scan could spike CPU and
  hang until Windows killed the app. Fixed by O(1) per-book database updates
  (was O(total books)), coalescing progress IPC (5,825 renderer wakeups down
  to 93), a directory-mtime fast path that skips per-file checks for unchanged
  books (~80,000 file checks down to ~5,800), yielding to the event loop so a
  fast scan can't starve the UI, and guarding background failures so they
  can't terminate the app. Also added `diagnostic.log` for crash/hang
  forensics. Shipped 2026-07-25.

- **Delete / remove library entries** — two per-book actions, available both
  in the book detail view and via right-click on a library card: **Remove
  from library** (drops the book's data only, files untouched) and **Delete
  book (files too)** (also trashes its files). Both fully purge every
  per-book record tied to that id — progress, bookmarks, normalization,
  online-metadata override, ebook pairing, and transcript — so nothing
  orphaned lingers behind, unlike the existing duplicate-removal path (which
  deliberately leaves those alone, since a sibling copy under the same id
  namespace might still need them).

  File deletion always goes through the Recycle Bin, never a permanent
  delete. What gets trashed depends on whether this book exclusively owns
  its containing folder — checked against the whole library (`dirCounts`,
  the same check `reorganize.js` already uses), not assumed from the book
  alone: if so, the whole folder goes in one shot, sweeping up any leftover
  cover art or notes that a file-by-file approach would otherwise leave
  behind and treat as "something else is still here"; if the folder is
  shared with sibling books (confirmed real in this library: a "Radio and
  Podcast Production" folder holds four separate single-file books side by
  side), only this book's own track files are touched, and the folder is
  removed afterward only if it ends up completely empty. A paired
  read-along ebook living inside the book's own folder is trashed
  alongside it either way; one picked from elsewhere on disk (the ebook
  picker can point anywhere) is never trashed — only its pairing record is
  dropped.

  *Tested:* real, disk-touching verification rather than mocks throughout —
  a real audio fixture actually moved to the Recycle Bin and confirmed gone
  from its original path; all five per-book stores purged and reread from
  disk (not just memory) to confirm the target book's entries are gone
  while an unrelated book's survive untouched; the exclusive-vs-shared
  folder split confirmed against real directories (solo book → folder
  removed; shared folder → sibling's file and the folder itself survive;
  leftover unrelated file → folder survives); and the co-located-vs-external
  ebook split confirmed the same way, including that a book exclusively
  owning its folder still leaves an external ebook alone even though the
  whole audio folder gets trashed. The right-click context menu itself was
  verified end-to-end against a real rendered grid: opens positioned at the
  cursor, dismisses on outside-click/Escape, and sends the correct book id
  and files-or-not flag through the same deletion path. Shipped 2026-07-29.

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

### 3. Skip silence / "smart speed" — **shipped** ✅
Real-time: the `<audio>` is routed through a Web Audio `AnalyserNode`, and a
sustained quiet gap (RMS below ~0.01 for ≥0.7s) briefly boosts playbackRate
(base × 3, capped at 4) so the gap passes fast, snapping back on speech. Toggle
with the ⏩ button or `S`; stacks on per-book speed.
*Two things that made it work:* the `ab-media://` responses needed
`Access-Control-Allow-Origin` + `crossOrigin='anonymous'` or the analyser reads a
tainted all-zero stream; and the detection loop must be a `setInterval`, not
`requestAnimationFrame` — rAF is paused when the window is hidden, but a
backgrounded audiobook still needs to skip silence (timers aren't throttled while
audio plays).
*Tuned after real-world use:* the original 0.2s entry threshold was catching a
narrator's mid-sentence breathing pause (still talking, just inhaling) as dead
air, boosting speed for a moment in the middle of a sentence — audible as
choppiness. Raised to 0.7s, comfortably past a normal breath/phrase pause
while still catching genuine gaps (a beat between chapters, a rough edit).
*Still possible:* an offline silence-span pass for exact glitch-free jumps, and a
sensitivity/adaptive-threshold control; both pair with auto-chapter generation
(Tier 3 #3).

### 4. Volume normalization / loudness leveling — **shipped** ✅
Each book's gated RMS loudness is measured over ~30s on first play (the real
library spans ~7 dB), a gain toward a common target (−19 dBFS) is computed —
clamped ±12 dB and peak-limited so a boost can't clip — stored in
`normalization.json`, and applied instantly thereafter via a Web Audio gain node.
On by default; ⚖ / `N` toggles.
*Refactor it drove:* volume moved off `el.audio.volume` into a graph gain node
(`source → analyser → normGain → volumeGain → out`) so the analyser always sees
full-scale audio — which also made skip-silence volume-independent.
*Still possible:* true EBU R128 (K-weighting/gating) instead of gated RMS, and an
offline scan at import so the very first play is normalized too.

### 5. Per-book & persisted playback speed — **shipped** ✅
Each book stores its last speed in `progress.json` and restores it on open
(`defaultPlaybackRate` is set so it survives multi-track boundaries).
*Possible next:* a per-narrator default once narrator metadata is reliable.

### 6. Auto-rewind after pause — **shipped** ✅
On resume, rewinds a few seconds scaled to how long you were paused (0 under 30s,
3s, 10s, up to 20s after an hour+). Kept separate from the sleep timer's fixed
30s resume-rewind.

### 7. Library organization: sort, filter, series & collections — **shipped** ✅
Filter tabs, **sort** (author / title / recently added / recently played /
longest / shortest), and **series grouping** (collapse a series' volumes into one
tile, with a drill-in view) all ship. **Still open:** better series coverage —
title-parsing groups ~30% of books (~360 series); the misses are un-numbered
series (Dune's prequels, standalone novellas) and folder-numbered books whose
title omits the series — those want the sidecar/online metadata below.

### 8. "Continue listening" shelf + finished state — **shipped** ✅
In-progress books surface in a row at the top of the library, most-recently-played
first, hidden while searching or filtering. Finished state drives the filter tabs.

### 9. Light theme + theme toggle — **shipped** ✅
A light palette under `:root[data-theme="light"]`, mirrored in a
`prefers-color-scheme: light` media query for the system-default case. The eight
places that had hardcoded colors (button hovers, scrollbar, bookmark-delete,
etc.) were pulled into variables too, so the whole UI actually re-themes, not
just the parts that already used variables. The ☀/☾ button in the top bar
overrides the OS choice and persists it; a tiny CSP-safe `theme-init.js` applies
a saved override before the body paints, so there's no flash of the wrong theme.

### 10. Library folder management (view + remove) — **shipped** ✅
A **Folders** popover in the top bar (replacing the old standalone "Add folder"
button) lists every library folder with its live book count and a ✕ to remove
it — finally calling the `library:removeFolder` IPC that had been fully wired
end-to-end but dead (no UI caller) since the very first commit. Removing a
folder asks for confirmation via a native dialog first, since it can silently
drop thousands of books in one click — more destructive than a typical action,
so it didn't wait for the general confirm-before-destroy treatment (item 11).
*Bug fixed along the way:* the folder→book match on both the removal path and
the new book-count computation used a naive `startsWith`, which would wrongly
match a folder like `E:\Books\Fan` against books actually under
`E:\Books\Fantasy`. Replaced with a path-boundary-safe check
(`isUnderFolder` in `main.js`), unit-tested directly.

### 11. Confirm before destructive actions — **shipped** ✅
Went with the **Undo toast** option rather than a blocking `confirm()` dialog —
both actions are frequent and fully reversible (unlike removing a folder, which
can't be undone without a 40-minute rescan and got a native confirm instead), so
a dialog on every click would have been needless friction. "Reset progress" and
a bookmark's 🗑 now act immediately and show a 6s "Undo" toast; clicking it
restores the **exact** prior state — same position, speed, and (for bookmarks)
the same id/label/note/createdAt, via a new `bookmarks:restore` IPC rather than
re-adding as a fresh bookmark. A second toast silently replaces a pending one
(matching Gmail-style undo conventions); `Escape` dismisses it early.

### 12. Backup / export of app data — **shipped** ✅
**File → Backup data…** / **Restore from backup…**, next to the existing "Open
data folder". Bundles the three stores into one timestamped JSON envelope rather
than a real zip — no archive library needed, and it stays human-inspectable —
defaulting to `%APPDATA%\Midnight Athenaeum Backups`, a **sibling** of the data folder so
deleting/corrupting the live folder can't take the backup with it. Restore reads
and validates the file, shows what it contains (counts, backup date) in a native
confirm dialog, and only applies on confirmation — this replaces current data and
can't be undone, so it got the same treatment as folder removal rather than the
Undo-toast treatment (items 10/11), which only fits reversible actions.
*Tested:* the bundle/validate/restore logic directly against throwaway temp
files (16 checks — round-trip fidelity, rejection of a wrong app name, a missing
section, and an unrelated JSON file) rather than the real data folder, since the
native save/open dialogs this feature triggers can't be driven through the
CDP-based testing used elsewhere in this project.

### 13. Customizable skip amounts — **shipped** ✅
A **Skip** dropdown next to Speed (10/15/30/45/60s, 30 default) drives the ↺/↻
buttons and the plain arrow-key shortcuts; the buttons' own labels update to
match so they never show a stale amount. Persisted, with a safe fallback to 30
if the stored value is ever invalid. `Shift`+arrow's 5-minute jump is a
deliberately separate, fixed "big skip" — not part of this setting.
*Tested:* 18 checks including that a reload picks the persisted value back up
immediately (no stale button label before the first click) and that a corrupted
localStorage value falls back safely rather than breaking the buttons.

### 14. Manual "mark as finished / not finished" — **shipped** ✅
A toggle button in the book view, next to "Reset progress", covers both cases:
a book finished elsewhere (marks finished with zero listening position recorded
— the card still shows a full progress bar rather than a confusing empty one),
and a DNF'd book stuck near the end that you want out of "In progress" (marks it
explicitly not-finished, which beats the auto-computed value).

Stored as `finishedOverride: true | false | null` alongside the existing
`finished` (auto-computed) field — `null` means "let position/duration decide,"
which is what every book starts at. The tricky part was making sure the override
actually survives: the periodic auto-save that runs during normal playback
rewrites the whole progress record every few seconds, so it had to be explicitly
carried forward there or a manual mark would silently vanish mid-listen. The
"Reset progress" Undo (item 11) needed the same care — restoring only
position/duration/speed and not the override would have "un-undone" a finished
mark that was in effect right before the reset.
*Tested:* 27 checks — including the override surviving a routine position
auto-save, and Undo-after-Reset restoring the override together with position,
verified round-tripped through the backend rather than just in-memory state.

### 15. Chapter list search — **shipped** ✅
A search box above `#chapterList`, filtering by title text or by chapter number
(so typing `150` finds chapter 150 directly). Rows keep their original array
index (`dataset.index`) even while filtered, so the existing active-chapter
highlight and click-to-seek logic needed no changes — filtering only ever hides
rows, never renumbers them. `Esc` clears the query first, then un-focuses on a
second press, without leaving the book view.
*Tested against the real 212-chapter Wind and Truth*: number search, title-text
search (verified zero false positives — every rendered row actually contains the
query), the no-match state, clicking a filtered row still seeks to the right
spot, the active-chapter highlight surviving a re-filter, and the search
resetting when a different book is opened.

### 16. Drag-and-drop to add a folder — **shipped** ✅
Drop a folder on the window; a dashed-border overlay shows while dragging, and
it's added the same way the Folders panel's own "Add folder" would be. Rejects
non-folder drops (e.g. an individual file) with an info toast instead of
silently doing nothing.

Needed more than a bare `dragover`/`drop` handler: `File.path` was removed from
the renderer in recent Electron for security, so the dropped item's real
filesystem path has to come from `webUtils.getPathForFile()` — callable from
preload (even under `sandbox: true`, where it's explicitly still exposed) and
bridged to the renderer. `library:addFolder`'s "merge into the folder list and
rescan" logic was factored into a shared `addFoldersToLibrary()` so a new
`library:addFolderPaths` IPC could reuse it without the file-picker dialog,
validating server-side that each dropped path is actually a directory rather
than trusting the renderer.
*What I could verify vs. couldn't:* the overlay's show/hide (including that
nested dragenter/dragleave pairs from crossing child elements don't flicker it),
and the full `addFolderPaths` → validate → add → rescan-once-if-new path against
real directories on disk, including that re-dropping an already-added folder
adds nothing and doesn't trigger a redundant rescan. What's *not* verified by
an automated test: `webUtils.getPathForFile()` resolving a genuine OS drag's
path correctly, since that requires real native drag data no CDP-based
automation can produce — confirmed instead by checking the known Electron
regression here (electron/electron#44600) is macOS-specific and closed; this
app targets Windows.

### 17. "Recently added" indicator on cards — **shipped** ✅
A small accent "NEW" pill on a book's cover for anything added since the last
time you opened Midnight Athenaeum — top-right on a plain card, top-left on a series
tile (opposite corners from the existing volume-# and count badges, so nothing
collides). A series tile shows NEW if *any* volume inside it is new; without
that, a newly added volume of a series you already own would be invisible
behind the tile whenever Group Series is on — which would have undercut the
whole point for exactly the constant-growth libraries this was aimed at.

The threshold is "the last time the app was opened," read once at load and
immediately overwritten with the current moment for next time — so badges from
this session stay put for the whole session (they don't vanish the instant you
glance at a card) and clear on the *next* launch, not this one. A first-ever
install has no stored threshold and defaults to "now," so a fresh library
doesn't badge all 6,000+ books as new.
*Tested:* 13 checks — the first-launch default, a real book flipping from NEW
to not-NEW as the threshold crosses its actual file mtime (and back), the
series-tile aggregation, and confirmed live on screen (not just via computed
style, which returns empty strings for a detached element) that the volume-#
badge and the NEW badge render on opposite corners of the same card without
overlapping.

### 18. Installer + in-app updates — **shipped** ✅
An NSIS installer/uninstaller (`electron-builder`, standard per-user default
location, desktop + Start Menu shortcuts) built and published to GitHub
Releases by CI on every version tag. **Help → Check for Updates…** checks
Releases manually — never automatic, never on launch — auto-downloads a
newer version in the background, and shows its change notes pulled straight
from `CHANGELOG.md` (`scripts/extract-changelog.cjs`). Restarting to install
runs `quitAndInstall()` silently (no interactive wizard) and relaunches the
app automatically once done.
*Still possible:* an optional "check on launch" setting for users who'd
rather not remember to check manually, and a macOS `dmg` build once that
port exists (`electron-builder`'s config already separates `win`/`mac`
targets, so this is additive, not a rewrite).

---

## Tier 2 — Differentiators (rare or absent in Windows players)

Where this app can be better than what exists, not just equal to it.

### 1. Local full-text search inside audiobooks (Whisper) — **shipped** ✅
Per-book, opt-in "Transcribe this book" (book view) runs entirely offline:
`ffmpeg-static` converts each track to 16kHz mono PCM, `@kutalia/whisper-node-addon`
(prebuilt whisper.cpp bindings, GPU via Vulkan auto-detected with a CPU/BLAS
fallback) transcribes it, and multi-track books get per-track timestamp
offsets merged into one flat transcript. "Search transcript" finds matching
lines and jumps straight to that moment; a captions toggle shows the current
line live while that book plays. One book transcribes at a time; the ~148MB
English model downloads once, on first use, into the data folder.

Packaging native binaries through Electron's asar turned out to be the real
risk, not the transcription itself — `require()`-loading a native `.node`
addon from inside `app.asar` works transparently, but `child_process.spawn()`
does **not**: it needs a real path and fails silently (`ENOENT`) on the
virtual asar one. Fixed by rewriting the ffmpeg path to `app.asar.unpacked`
before spawning it, verified against an actual packaged build (not assumed)
before shipping. GPU acceleration, multi-track offset math, and the full
pipeline were also verified end-to-end against real generated speech audio
before any UI was built on top of them.

*Descoped from this pass:* per-chapter summaries (Whisper transcribes, it
doesn't summarize — a real feature, needs its own model/approach decision).
*Foundation for:* semantic bookmarks, "quote this passage", accessibility.

### 2. Windows System Media Transport Controls (SMTC) — **shipped** ✅
The Windows media flyout, lock screen, and hardware/keyboard media keys
(play/pause, next/prev chapter) now work via the standard `navigator.mediaSession`
web API — Chromium wires this to SMTC on its own, no native module needed.
Title/author/cover show as the metadata; the subtitle updates live to the
current chapter as playback moves through the book. `setPositionState` keeps
the flyout's own seek bar in sync.

Also added while in this layer, both native Windows Shell features with no
mediaSession involvement of their own: **taskbar thumbnail-toolbar buttons**
(prev/play-pause/next chapter, shown on the taskbar button's hover preview —
flat glyph icons generated procedurally in `scripts/make-media-icons.cjs`,
same draw-big-downsize-for-anti-aliasing trick as the app icon), and a
**jump list** of recently-played books (right-click / Start tile), which
required adding a proper single-instance lock so clicking a jump-list item
focuses the running window instead of opening a second one.

*Tested:* the mediaSession wiring end-to-end via CDP (metadata incl. real
cover artwork decoding, `playbackState` sync, live chapter-subtitle updates,
the actual code paths every action handler calls), confirmed identical
behavior in a real installed build, and confirmed the thumbbar registers
successfully with the OS (`setThumbarButtons` accepted, no rejection). The
jump list's `setJumpList` call was confirmed to *fail* with exactly the
expected `customCategoryAccessDeniedError` on this dev machine (Windows'
"show recently opened items" privacy setting is off here) and then, with that
setting temporarily flipped on and immediately reverted back, confirmed to
*succeed* — proving the code path itself is correct independent of the local
privacy setting. Also verified end-to-end: launching a second process with
`--open-book=<id>` (what a jump-list click does) is blocked by the new
single-instance lock and correctly focuses the running window on that exact
book instead of opening a duplicate one.

### 3. Listening statistics & streaks — **shipped** ✅
New Stats view (topbar bar-chart icon): total time listened, books finished,
current streak, top-5 authors/narrators, and a 12-week pace chart. The
premise that `progress.json`'s timestamps "already capture most of the raw
signal" didn't hold up on inspection — it's a per-book snapshot overwritten
on every save, no history — so this shipped with a new minimal `activity.json`
store (`{ [date]: secondsListened }`, nothing richer) and real wall-clock
listening-time tracking piggybacked onto the existing 5-second progress-save
cadence rather than a new timer. "Books finished" and "top authors/narrators"
needed no new tracking — both computable from data already sent to the
renderer. Streak/pace can only accumulate from this version forward; there's
no way to backfill history that was never recorded.

Two real bugs caught before shipping: an early design would have counted
phantom listening time if a pause/seek/speed-change fired while already
paused (fixed with a play-state gate checked before any state mutation), and
a genuinely pre-existing bug found along the way — `pairingStore` (ebook
read-along pairings) was never actually loaded from disk at startup, so
every launch silently re-scanned the whole library and could overwrite
manually-set pairings.

### 4. Bookmark clips: export & share cards — **M**
Turn a bookmark span into a short audio clip (via ffmpeg) or a shareable image
card with cover + quote + timestamp. Differentiating and delightful; depends on
bookmarks (Tier 1) and optionally transcripts (item 1) for auto-captioned quotes.

### 5. Auto-fix metadata from online sources — **shipped** ✅
A **Look up online** button in the book view searches Open Library by
free-text query (pre-filled with the scanned title/author, editable), shows a
picker with thumbnail/author/year for each match, and previews the full
description before you apply it. Applying downloads the large cover, caches it
locally, and stores a per-book override (title/author/description/cover) that
wins over the scanned tags everywhere the book is displayed — chapters,
duration, and tracks always stay from the real file, since an online source
has no idea how *this* rip is chaptered. **Revert to file tags** removes the
override and the cached cover in one click.

Opt-in, gated behind an explanation shown the first time you click the button
(what it sends, that it's manual-only, that results are cached locally); off
by default; nothing is looked up automatically at any other time. Overrides
persist in `metadata-overrides.json` / `covers-online\` and round-trip through
the existing backup/restore feature (cached cover *images* aren't included in
backups — they're re-fetchable — but the override records are).

Source is Open Library only, decided empirically rather than assumed: Google
Books' keyless API returned a 429 quota error on the very first test call,
before a single real query shipped, which would force every user to configure
their own API key just for an opt-in convenience — rejected. Audible has no
public API and scraping it is a ToS risk out of scope for this app. Open
Library's general free-text search (not the strict `title=`/`author=` field
search) was needed too — the strict form returned zero results against this
library's real, sometimes-garbage scanned author tags on books that a
free-text search found correctly, including surfacing the *actually correct*
author name ("T. L. Mancour") where the scanned tag was wrong ("Terry
Mancour"). Open Library's `description` field is also inconsistent — some
records hold physical-copy metadata ("746 pages ; 23 cm") instead of a real
blurb — filtered out so it's never shown as if it were a real description.

**Series-splitting is descoped.** The original ask included using this lookup
to split series/box-set titles apart. Open Library's series data proved too
sparse and inconsistent across this library's real books to build a reliable
splitting feature on top of — this stays a metadata-correction tool, not a
re-grouping one. The series-title display collision this was meant to help
with is still primarily addressed by the existing renderer-side
[series grouping](../README.md#series-grouping) from Tier 1, and remains a
documented [known limitation](../README.md#known-limitations) for books that
aren't (or can't be) corrected here.

*Tested:* the Open Library client (`metadata-lookup.js`) against real network
data — 14 checks covering empty-query rejection, a real search finding the
correct book and correcting its author, description-field junk-filtering vs. a
genuine 1,364-char description passing through, cover download (real JPEG,
not Open Library's tiny placeholder), and graceful handling of a
zero-result query and a missing work key. The full UI flow — opt-in gate,
search, pick, preview (including the description arriving after a stale pick
is correctly ignored), apply, revert — was driven end-to-end via CDP against
the real running app and its real 6,324-book library: applying "Warmage:
Spellmonger, Book 2" → "Warmage" by "T. L. Mancour" correctly updated the
book's title/author/description/cover everywhere (header, badge, library
grid) and downloaded a real cover to `covers-online\`; reverting correctly
restored the scanned tags and deleted the cached override and cover file, with
`metadata-overrides.json` confirmed empty on disk afterward. Also confirmed
live: the opt-in flag persists across the modal reopening, an empty query is
rejected without a network call, a nonsense query returns "No matches found"
rather than an error, and a real Open Library cover thumbnail loads in the
results list under the app's CSP (`img-src` allows `covers.openlibrary.org`
specifically, nothing broader).

### 6. Read-along / immersion reading (audio + ebook) — **shipped** ✅ (EPUB only)
Pairs an EPUB with its audiobook and shows the matching chapter's text in a
book-view side panel, opened via a per-book **Read along** button
(auto-pairs by folder proximity, falls back to a manual file picker), plus
a **Has ebook** library filter and card badge from a gentle background pass
that checks the whole library over time. Scoped to EPUB only — MOBI (139
files) is a proprietary format Amazon itself deprecated in 2021, and PDF
(116 files) has no reliable chapter structure; both would need much more
work for much less reliability. The panel auto-advances chapters when
confident (exact chapter-count match, or proportional position as a weaker
signal) and estimates paragraph position within a chapter from time elapsed
— real word-level sync is still the "ambitious version," needing the
Whisper transcript aligned to text, not attempted here.
`src/main/epub.js` hand-rolls a ZIP + narrow XML reader (no new dependency,
same spirit as `mp4-chapters.js`) — verified against a 32-check synthetic
harness (real generated EPUB2/EPUB3 fixtures covering nested/fragment-split
TOCs, percent-encoded paths, malformed markup, and a simulated DRM failure)
before ever touching real files. The pairing search radius was tuned twice
against a real read-only dry run of this ~6,300-book library: a first pass
assumed `E-Books/` subfolders (from the earlier sidecar-metadata
investigation) and only covered 29% of the library's real epub files; the
actual dominant convention turned out to be a bare `epub` subfolder, fixed
after inspecting the real folder structure directly rather than guessing
further. Remaining unmatched epubs were hand-checked and are consistently
epub-only acquisitions with no audiobook counterpart, not radius misses.

### 7. Discord Rich Presence — **shipped** ✅
A topbar toggle (off by default) shows "Listening to *\<title>* — Ch. N" on
Discord, pushed on chapter changes and play/pause (`pushDiscordActivity()` in
`app.js`, hooked into the same points that already update the OS media-session
metadata). `src/main/discord-presence.js` wraps `@xhayper/discord-rpc` on the
main-process side, entirely best-effort: no client ID configured, or Discord
not installed/running, and every call just no-ops. The library itself doesn't
reliably fail fast when Discord isn't running — observed hanging indefinitely
in testing rather than rejecting — so a 4s timeout plus a 30s retry cooldown
are enforced independently, rather than trusted to the library.
*Still needed:* a real Discord Application ID (`DISCORD_CLIENT_ID`) baked into
the shipped build; the feature is fully wired but inert until one is set.

### 8. Voice-clarity EQ / voice boost — **shipped** ✅
The 🎚 button (off by default; `V` toggles) runs two `BiquadFilterNode`s
spliced into the existing skip-silence/normalization Web Audio graph
(`source → analyser → normalize gain → voice boost EQ → volume gain →
output`): a ~100Hz highpass clears low rumble that eats headroom without
carrying intelligibility, and a peaking filter lifts the ~2.8kHz
consonant/sibilance range that separates words at speed. Both filters ramp
in/out over 0.3s rather than snapping (same `linearRampToValueAtTime`
approach as normalization's gain), and stay in the graph always-connected —
off just ramps the highpass down to 20Hz and the peak gain to 0dB, matching
how normGain/volumeGain are already handled elsewhere in the chain.

### 9. Library organization: duplicate detection — **shipped** ✅
**File → Find duplicate books…** groups the already-scanned library by
title+author, then splits into distinct *recordings* by matching duration
and track count — only a recording with 2+ copies is a real duplicate and
offered for removal (to the Recycle Bin, never permanent, and never the
containing folder, which can hold unrelated sibling books). Researched
first: no audiobook player on the market combines playback with duplicate
detection — even Audiobookshelf has "merge duplicates" as an open,
unshipped feature request. Validated against this library's real ~6,300
books: 376 titles with at least one real duplicate, 468 removable copies,
found alongside titles with 2-3 *genuinely different* narrators (never
flagged) — confirming the recording-matching split is doing real work, not
just title-matching.
### 10. Library organization: reorganize by author — **shipped** ✅
**File → Reorganize library by author…** computes (but does not perform) a
move of every book into `<library folder>/<Author>/<Title>/`, shows the full
plan in a preview modal, and only touches disk after an explicit confirm.
`src/main/reorganize.js` separates `computePlan()` (pure, read-only) from
`executePlan()` (moves one book at a time, journaling every individual move
as it happens) and `undoLastReorganization()` (replays the journal
backwards) — verified against synthetic fixtures covering an
exclusively-owned folder rename, a folder shared by unrelated books (moves
only that book's own files, confirmed real in this library: four different
Alien audio dramas side by side in one folder), an already-correctly-placed
book, author/title collisions, illegal-Windows-character sanitization, and a
nested-subfolder multi-track book, plus full undo. Since a book's id is
derived from its file path, a move mints it a new one; execute and undo both
carry progress, bookmarks, normalization gain, metadata overrides, and
transcripts over to the right id (`newBookId()`/`remapIdKeyedStores()` in
`main.js`) rather than silently orphaning them on the next scan — the id
formula was independently checked against the real `scanLibrary()`, not just
assumed to match. Confirmed working hands-on against the real library,
including undo.
*Still possible:* genre-from-folder reorganization, on the same
preview/journal/undo machinery.

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

### 4. Gapless multi-track playback — **shipped** ✅
A second `<audio>` element (`shadowEl` in `app.js`) preloads the next track ahead
of the boundary — buffered to `readyState` 4 well before the current one ends —
and a natural `ended` event hands playback straight to it instead of loading
fresh on the same element. That per-element demuxer/decoder pipeline startup,
not disk I/O, turned out to be what actually caused the stall: `ab-media://`
responses carry no `Cache-Control` header, so a same-element reload always paid
that cost regardless of OS-level file caching — only a second, already-warm
element avoids it. Falls back to the original cold-load path for anything that
isn't a primed natural boundary (chapter jump, seek-bar drag, scrubbing past the
primed track). Verified against real generated audio crossing a track boundary —
`currentTime` advances continuously with no freeze and no stall in the UI.

### 5. Per-chapter embedded artwork — **shipped** ✅
Some `.m4b`s (rare — Apple's chapter-artwork convention, mostly enhanced
audiobooks/podcasts) reference a second chapter track (handler `vide`)
carrying one image per chapter, in the same order as the text track's
titles. Note on the original premise: this item named `IChapter.image`, but
that field is populated only by music-metadata's ID3v2 CHAP+APIC parser
(MP3 podcast-style chapter tags) — never by its MP4 chapter-track parser,
so it was never going to surface anything for `.m4b` specifically. Shipped
the real m4b mechanism instead: `mp4-chapters.js`'s `readChapterImages`
reads the second track's sample bytes, only trusted when its sample count
exactly matches the already-parsed chapter count (so an unrelated second
video track never gets misattributed to the wrong chapter); `parse-core.js`
decodes/re-encodes each through `nativeImage` before ever writing or
serving it — same never-trust-embedded-bytes-directly posture as cover art
— and caches it to `${bookId}-ch${index}.jpg`. Surfaced as a small
thumbnail in the chapter list and swapped into the mini-player/OS media
flyout artwork while that chapter is playing, falling back to the book
cover otherwise.

### 6. Full-cast / graphic audio productions — **M**
GraphicAudio and similar "movie in your mind" productions are structurally
different from a narrated audiobook, and the library already has them:
`E:\Books\GraphicAudio` holds 28 titles, 16 of them split across parts named
`(1 of 2)` / `(2 of 2)`, and 4 tagged `[Dramatized Adaptation]`. Across the
whole library, 53 folders use an `x of y` part convention.

What breaks today:

- **Parts scan as separate books.** `(1 of 2)` and `(2 of 2)` are distinct
  folders with distinct tags, so a single production shows up as two
  unrelated entries with duplicated titles. `consolidateSelfContainedParts`
  merges numbered parts *within one folder*; this is the across-folders case,
  and the existing series parser reads `x of y` as a series index rather than
  as parts of one work.
- **"Narrator" is wrong for a full cast.** These have a cast, not a narrator,
  and the `composer` tag they land in is usually a studio credit. Showing it
  as "Narrated by" is misleading.
- **They are not duplicates.** Duplicate detection groups by title+author and
  splits by duration/track count — a dramatized adaptation and the straight
  narration of the same book are legitimately different recordings, and both
  are worth keeping. Worth an explicit check that this holds, since the
  titles often match exactly.

Scope: detect the `x of y` convention and merge parts into one book with a
continuous timeline (the multi-track machinery already does this — it just
needs to span folders); recognise `[Dramatized Adaptation]` / `GraphicAudio`
and label the production type on the card and in the book view; prefer "Cast"
over "Narrator" for those. A **Full cast** filter would be a natural follow-on
once the type is known, and pairs with the existing Has-ebook filter.

Worth doing before sidecar metadata (#2): both touch how a book's identity is
derived, and getting parts merged first means less to redo.

### 7. Audible `.aax` support — **shipped** ✅ (AAX only, not AAXC)
**File → Decrypt Audible file (.aax)…** picks one `.aax` via a native file
dialog and decrypts it into a `.m4b` alongside it, via ffmpeg's own
long-public `-activation_bytes` option — stream-copied (`-c copy`), so this
runs at disk speed, not encode speed. The source `.aax` is never touched,
moved, or deleted; the result gets added to the library the normal way
(**Folders → Add folder**, or picked up by the next scan if it already sits
under one) — no changes needed anywhere in the scanner, database, or
player. Activation bytes are entered once via **File → Set Audible
activation bytes…**, stored locally, and used only as that one ffmpeg
argument — this app never talks to Audible's servers or handles Audible
account credentials itself; the user supplies bytes obtained through their
own means. A book decrypted this way gets a small "AUDIBLE" card badge
(bottom-left corner, the one badge position left free), driven by a
tiny `audible-sources.json` store written at the moment decryption
finishes.

Deliberately scoped to **AAX only**, not AAXC (the current Audible app's
format) — the roadmap's own "activation bytes" framing is specifically the
AAX mechanism; AAXC uses a per-book key+IV pair from a companion voucher
file instead, a different enough mechanism to be its own future item rather
than silently folded into this one.

**Also offered automatically when a folder is newly added** (Folders → Add
folder, or drag-and-drop) — a real user report ("my test book doesn't show
up even in drag and drop") surfaced that dropping a folder containing only
`.aax` files did nothing, with zero explanation, since `.aax` is
deliberately not a recognized audio extension. Rather than either fully
automatic decryption during every scan (rejected: wrong activation bytes
fail *silently* — ffmpeg exits 0 but writes a corrupt file — so unattended
decryption of a whole library in one pass is exactly the wrong place to
remove the one confirmation step that catches that mistake early; it would
also turn scanning from a fast, mostly-read-only operation into one that
writes new files as a side effect) or leaving it fully manual, a folder that
is genuinely new to the library is checked for `.aax` files lacking an
already-decrypted `.m4b` sibling, and — only if any are found — a single
native confirm offers to decrypt all of them right then.

**First version of this had a real gap, caught by hands-on testing against a
real file**: it only ever checked *newly-added* folders, so a `.aax` dropped
into a folder that had been part of the library for a while (the actual
situation in the bug report, confirmed with a direct `library.db` query —
both `E:\Books` and `E:\Books\xtestx` already tracked) was never checked at
all. Fixed by also running the check on an explicit **File → Rescan
library** — deliberately *not* on routine/automatic scans (app launch,
background rescans), which stay exactly as fast as before — covering the
"dropped a new file into an existing folder" case a new-folder-only check
structurally can't. A small `audible-offered.json` store (`{ [aaxPath]:
true }`) records every file either check has ever asked about, regardless
of the answer, so a file is never offered twice no matter which of the two
entry points found it, and declining still doesn't turn into a nag on a
later rescan.

Explicit account login (the fuller "Libation approach" the original roadmap
wording gestured at) was considered and deliberately **not** built: it would
mean this app itself speaking Audible's private, undocumented
device-registration API and storing the user's actual Audible account
password rather than a small revocable derived value — a materially
different risk category from applying activation bytes obtained through the
user's own separate means, and out of scope here.

*Tested, with one real limitation stated plainly:* every other feature this
session was verified against a real fixture; this one couldn't be, fully —
there's no legitimately obtainable `.aax` file to test against, and AAX
encryption isn't something that can be synthesized the way this project's
`.m4b`/`.mp3` test fixtures have been all along. What *was* verified
directly: the ffmpeg spawn itself (binary resolution, argument
construction, exit-code handling, the concurrent-job guard) against a real
audio file stream-copied through the exact same invocation a real decrypt
would use; activation-bytes format validation (8 hex chars, case-insensitive,
rejects short/non-hex/empty); that ffmpeg does not echo the activation
bytes value back in its own stderr output (checked directly, not assumed,
before deciding no redaction was needed there); the newly-added-folder
`.aax` walker (finds an undecrypted file, skips one with an existing `.m4b`
sibling, recurses into subfolders, never descends into a skip-listed
directory like `$RECYCLE.BIN`, checks multiple directories correctly); and
— the one genuinely tricky correctness risk in this feature — that the book
id predicted from the output path at decrypt-time (so the badge can appear
correctly the very first time the file is scanned, without waiting on a
second scan) exactly matches the id `scanLibrary()` itself computes for
that same file, confirmed by actually running a real scan and comparing.
The activation-bytes modal (open, prefill masked by default with a
Show/Hide toggle that always re-masks on reopen, validation error, save,
Escape/backdrop dismiss) and the card
badge's rendering were both confirmed against a real running instance too.
The one thing that can only be proven by an actual user running it against
a real file with their real activation bytes is the decryption itself.

**A real gap in that testing, caught by the user, not found first:** every
check above ran against the dev Electron binary, where `app.asar` doesn't
exist and the `app.asar` → `app.asar.unpacked` ffmpeg-path rewrite this
feature depends on (same pattern the whisper/transcribe feature already
needed) is a silent no-op — so none of it had actually exercised that
rewrite at all. Once flagged, verified directly against the real packaged
build: required `audible.js` from inside the real `app.asar` and confirmed
it still resolves and successfully spawns the real unpacked `ffmpeg.exe`
from there. The user's own manual single-file decrypt against a real
Audible file, run after that, is what actually confirmed decryption itself
works end to end.

---

## Performance & architecture optimizations

The current design loads the **whole library fully into memory and ships it
over IPC** at startup (now backed by `library.db` on disk, not a monolithic
JSON file — see #1 below). The grid is now virtualized and covers are now
thumbnailed (see #2/#3) — the remaining ceiling is the full-library
IPC/in-memory load itself, not rendering or cover decode.

**Scanning is I/O-bound, not CPU-bound.** Measured on the real library: a
rescan parses *nothing* (every book is an unchanged cache hit), and its cost
was filesystem metadata checks — which is why #6 below failed and why the
directory-mtime fast path is what actually made rescans cheap. Treat any
future "make scanning faster" idea as an I/O problem until measurement says
otherwise.

### 1. Move the library to SQLite — **backend swap shipped** ✅, **query-per-view still open**
`library.json` is now `library.db` (`src/main/db.js`), migrated automatically
on first launch of this version (old file kept as `library.json.bak`, never
deleted). Real per-row writes replace whole-file rewrites — on the real
5,823-book/46.5 MB library, a no-op rescan went from a full JSON re-serialize
to ~2 ms, and a single detail-fill write from a full rewrite to ~9 ms; cold
load is ~225 ms. `better-sqlite3` segfaulted on this machine's Electron 34
build (native-module incompatibility, never resolved); shipped with
`@vscode/sqlite3` instead — same schema, but its callback-only API means
`db.js` is async under the hood, fronted by an in-memory cache so every
existing call site keeps its old synchronous `get()`/`set()` shape and the
renderer sees zero change.
Deliberately **not done**: the grid/search/sort/filter still load the full
book array over IPC at startup and filter in memory client-side — instant
server-side search and query-per-view (a page, a search, one book) are a
separable, larger change to the app's interaction model and remain a future
pass.

### 2. Cover thumbnails — **shipped** ✅
Small (~200 px) JPEG thumbnails (Electron's `nativeImage` — originally
`jimp`, replaced; see Security) generated at detail-fill time and cached in
`COVER_CACHE/{id}-thumb.jpg`; the grid, series-grouped view, and duplicates
finder all load these instead of the full-size cover. A backfill pass
(`runThumbnailFill`, chained after the ebook-pairing fill) catches
books that were already fully detailed before this shipped. Book detail
view still shows the full-size cover — thumbnails are grid-only.

### 3. True virtualized grid — **shipped** ✅
`#grid` now renders only the visible range ± a buffer, framed by two spacer
elements that reserve scroll space for the rest — DOM node count stays
bounded regardless of scroll depth or library size, instead of growing
monotonically as pages were appended. Verified via a headless-Chromium
harness (no real windowed Electron launch works in this dev sandbox) against
a synthetic 6,000-book library.

Shipping these two together mattered: virtualizing the grid alone made
scrolling-back-into-a-visited-section noticeably *slower* than before (cards
leaving the DOM meant their already-decoded full-size cover images had to
redecode from scratch on return) — cover thumbnails are what actually fixed
that regression, not just a nice-to-have on their own.

### 4. Incremental scan via file watcher — **M**
A *cold, first-ever* scan of `E:\Books` (parsing every book) takes ~40
minutes. A routine rescan is now ~3s, since unchanged books are detected from
their folder's mtime and never re-parsed. So the remaining gap is not speed
but *latency*: new books only appear when a scan is triggered. Watch library
folders (`chokidar`) and update only what changed, for near-real-time pickup.
Would also remove the main reason to run a manual rescan at all.

### 5. Two-phase / lazy scanning — **shipped** ✅
Phase 1 (`scanLibrary`) reads tags + duration only — no cover art, and for
single-file `.m4b`/`.m4a` books, no chapters either (multi-track mp3-folder
books get chapters for free from the same per-track tag reads duration
already needs, so only their cover is deferred). `readMp4Duration()` reads
just the `mvhd` atom instead of the full chapter-track walk that costs one
extra disk read per chapter. Phase 2 (`fillBookDetails`/`ensureDetail` in
`library.js`) fills in cover + chapters afterward: a low-priority background
pass that resumes automatically across restarts if interrupted, and a
same-book on-demand path that jumps the queue when you open a book before
the background pass reaches it (de-duplicated against each other via a
shared in-flight map, so neither redoes the other's work). Playback was
already never gated on chapters/cover, only tracks/duration, so a book is
fully playable the instant phase 1 finds it. Verified against a 37-check
synthetic harness (real `ffmpeg`-generated `.m4b`/`.mp3` fixtures with
actual chapter atoms and embedded art) before ever touching the real
library, then confirmed faster hands-on.

### 6. Worker-thread parsing — **attempted, reverted ❌**
Moving tag/chapter parsing and cover-thumbnail generation into
`worker_threads` was built, then removed. Recorded here because the premise
was wrong in a way worth remembering.

**The premise did not hold.** This item assumed scanning is CPU-bound. It
isn't. Instrumenting a real ~5,800-book library showed a rescan dispatches
**zero** tasks to the pool — every book is an unchanged cache hit, so nothing
is ever parsed. Scanning is I/O-bound: its cost was `fs.stat` on every file
of every book (~80,000 calls, concentrated in books split into 200-500
tracks). The pool did nothing on a normal launch except exist.

**It also broke the app.** Every build with the pool enabled spiked CPU and
hung part-way through a scan until Windows killed the app (logged as
Application Hang, event 1002). The same build with dispatch disabled ran
clean, as did v0.13.0 before the pool existed — bisected by building and
running both. Merely spawning the worker inside Electron's main process was
enough; a plausible but untested explanation is the cost of instantiating
`jimp`'s large dependency tree in a second V8 isolate inside that process.
It never reproduced headlessly, only in the full app. (`jimp` has since been
removed from the runtime entirely, so a future attempt would not carry that
particular weight — which makes the explanation cheaper to test, not proven.)

**What was kept.** `src/main/parse-core.js` survives — the parse functions
are cleaner extracted, and now run in-process. The real wins came from bugs
the investigation exposed, none of which needed worker threads: O(1) database
updates per book (was O(total books), 6.3s of CPU per scan on this library),
coalesced progress IPC (5,825 renderer wakeups down to 93), a directory-mtime
fast path that skips per-file checks for unchanged books, an event-loop yield
so a fast scan can't starve the UI, and guards so a background failure can no
longer terminate the app.

**If revisited**, the case would have to come from genuinely CPU-bound work
(loudness analysis, waveform precompute) rather than scanning, and would want
process-level isolation (`utilityProcess`) rather than a thread sharing the
main process.

### 7. Waveform / seek preview — **M**
Precompute a coarse waveform per book for a richer seek bar and instant scrub
previews. Cache next to the cover. Nice-to-have that also visualizes chapter
boundaries.

---

## Reliability & data safety

Found while reviewing this roadmap against the code (2026-07-25). None of
these are hypothetical — each is a path that exists in `main.js`/`library.js`
today.

### 1. A scan can wipe the library if the drive is unavailable — **fixed** ✅
`runScan()` guards only the "no folders configured" case. If folders *are*
configured but the scan finds nothing — the library drive offline, unplugged,
still spinning up, a drive letter that moved — `walk()` catches the read
error, warns to the console, and returns nothing. `scanLibrary` then returns
`[]`, and `runScan` unconditionally persists it:
`libraryStore.set({ ...libraryStore.get(), books })`. That deletes every book
row in `library.db`.

This library lives on `E:`, a separate SATA drive, and scans run
automatically at launch — so "drive not ready yet when the app starts" is a
realistic Tuesday, not a contrived edge case. Progress/bookmarks survive (they
are keyed by book id in separate stores) but would be orphaned, and recovery
means a ~40-minute cold rescan.

**Fixed** (unreleased): each configured folder is checked for readability
before the result is trusted. Unreadable folders are dropped from the scan
and the books already known under them are carried through untouched, so a
multi-folder library only rescans what it can actually see. If *no* folder is
readable the scan aborts and says so, leaving the library alone. A final
guard refuses to persist an empty result when the library previously had
books, covering read failures the per-folder check can't see (permissions, a
mount that answers with an empty listing). Verified against the real
`scanLibrary`, including that an *empty but readable* folder is correctly
distinguished from an unreadable one — the former is a genuine "you deleted
everything", the latter never is.

### 2. Books that fail to parse are invisible — **S**
`library.js` already records `tagsFailed` and `detailFailed` per book, and
logs a count to the console (`N book(s) had tag-parse failures`). Nothing
surfaces either flag: `toClientBook` doesn't send them and the renderer
never references them (verified — zero occurrences in `app.js`). So a book
that scanned with unreadable tags shows up as "Unknown author" with no
indication *why*, and a failed detail-fill is silently permanent until the
book's signature changes. Surface it: a filter, a card badge, or a line in
the Folders panel — plus a "retry failed books" action, since the current
best-effort design deliberately never retries on its own.

### 3. No way to cancel a running scan — **S**
There is cancellation *machinery* (`isCancelled` tokens for the detail,
pairing and thumbnail fills) but nothing for phase 1, and no UI for any of
it. A scan started by accident on a large library holds the Rescan button
disabled until it finishes. Wire a cancel affordance to the existing token
pattern.

### 4. The fast path can miss in-place edits — **S**
The directory-mtime fast path skips per-file checks for unchanged folders,
which is what made rescans cheap — but a file rewritten in place under the
same name (a re-tag) leaves the folder mtime untouched and goes unnoticed.
File > Rescan library forces the full per-file check, so the escape hatch
exists; it just requires knowing to use it. Consider an occasional automatic
deep scan (first launch of the week, say) so a library edited outside the app
converges without the user having to know the distinction.

### 5. Nothing surfaces an unexpected exit — **S**
`diagnostic.log` now records process-gone reasons, uncaught exceptions and
scan milestones, which is how the v0.14.0 scan hang was diagnosed. But it is
only useful to someone who knows to look for the file. On launch, notice that
the previous session ended without a clean shutdown and offer the log — the
difference between a bug report saying "it closed itself" and one with
evidence attached.

---

## Security & dependency maintenance

Findings from a security pass (2026-07-24): repo-level hardening (GitHub
secret scanning + push protection, a light-touch ruleset blocking
force-push/deletion on `main`) and the Electron sandbox/CSP/preload
configuration were already in good shape — `contextIsolation`/`sandbox`/
`nodeIntegration: false` on both windows, a strict CSP (`script-src 'self'`,
no `unsafe-inline`/`eval`) on every page, and `preload.js` exposing a
closed, explicitly-enumerated API rather than a generic IPC passthrough.
Three cheap renderer-hardening fixes and two deliberately-deferred dependency
upgrades came out of that pass:

### Resolved: Electron 34 → 43 ✅
Done. Electron 34.5.8 → **43.2.0**, clearing all **18** CVEs `npm audit`
listed against the 34.x line (ASAR integrity bypass, several use-after-frees,
IPC response spoofing, HTTP response-header injection in custom protocol
handlers, among others). Two of those were directly reachable here: the app
registers a custom protocol (`ab-media://`) and ships as an asar.
`npm audit --omit=dev` now reports **0 vulnerabilities**.

**The ABI fear that justified deferring this was wrong.** Both native modules
(`@vscode/sqlite3` and `@kutalia/whisper-node-addon`) build against
**Node-API**, not NAN — `node-addon-api`, with `NODE_API_SWALLOW_UNTHROWABLE_EXCEPTIONS`
in sqlite3's `binding.gyp` and no `nan` in the tree. Node-API is ABI-stable
by design, so both loaded unchanged under Electron 43's ABI 148 (up from
133), verified by requiring each directly. No rebuild, no native-module
gauntlet. The "would need its full verification gate re-run" framing was
inherited from the `better-sqlite3` segfault, which was a different problem.

**What actually needed fixing** was mundane and would have broken the release
build silently:
- Electron 42 removed the `postinstall` download — the npm package no longer
  fetches its binary. Added `"postinstall": "install-electron"`, without
  which `npm install` yields a package with no runnable Electron.
- Electron 43 requires **Node ≥ 22.12.0**; CI was pinned to Node 20. Bumped
  the workflow to 22 and declared `engines.node` so a too-old Node fails at
  install rather than confusingly at build time.

**Behaviour changes worth knowing** (from the 35→43 breaking-change notes,
checked against the APIs this app actually calls): Electron 43 makes file
dialogs default to the Downloads folder. Three of this app's five dialogs set
`defaultPath` explicitly and are unaffected; the library-folder picker and
the ebook picker don't, so they now open at Downloads. Cosmetic, but both
would be better with a sensible default — worth a follow-up. Nothing else in
35→43 touches the APIs in use (`protocol.handle`, `nativeImage`,
`setJumpList`, `setWindowOpenHandler`, `contextBridge`, `webUtils`,
`ipcMain.handle`, sandbox/contextIsolation settings all unchanged).

### Resolved: `jimp` removed from the shipped app ✅
`npm audit` flags a moderate DoS vulnerability (infinite loop on malformed
input) in `file-type`, a transitive dependency via `jimp` (used for cover
thumbnails — `generateCoverThumb` in `src/main/library.js` — and the
build-time icon scripts). **Corrected from an earlier pass**, which wrongly
assumed this doesn't apply since "this app only feeds it JPG/PNG": checked
`@jimp/core`'s actual source
(`node_modules/@jimp/core/dist/utils/image-bitmap.js`) — `parseBitmap` calls
`fileType.fromBuffer(buffer)`, which sniffs the **real byte content**,
completely independent of file extension or the tag-declared picture
format. A crafted audio file with malicious "cover art" bytes (ASF magic
bytes, regardless of what extension/format the surrounding tag claims) would
reach the vulnerable parser exactly the way the advisory describes — and
at the time this was written, that decode ran synchronously on the main
process's single thread — a genuine infinite loop there couldn't be escaped
with a timeout (JS timers can't preempt a blocked event loop on the same
thread), so it would have hung the entire app, not just failed one book's
thumbnail, until force-killed. Given this app already accepts arbitrary
user-supplied audio files as its core input (and users audiobook-shopping
outside official stores is a realistic path for a maliciously-crafted file
to arrive), this was real exposure, not a theoretical one.
**Resolved** by removing the dependency from the runtime rather than
upgrading it. `generateCoverThumb` now uses Electron's `nativeImage`, and
`jimp` is a devDependency used only by the build-time icon scripts (see
"Replace `jimp` outright" above). The vulnerable `file-type@16.5.4` is no
longer packaged — confirmed against a real build — and `npm audit --omit=dev`
reports 0 vulnerabilities. This closes the exposure at its source: the app no
longer runs *any* JS image decoder over user-supplied cover art.

Two earlier attempts at this are worth remembering, because neither worked:
first a claim that the app "only feeds it JPG/PNG" (false — `file-type`
sniffs bytes, not extensions), then containing the hang in a worker thread
(reverted; it broke the app). The fix that held was deleting the dependency
from the path where hostile data reaches it.

### Replace `jimp` outright — **shipped** ✅
Done, using Electron's own `nativeImage` rather than upgrading to `jimp` 1.x
or adding another image dependency.

`generateCoverThumb` (`src/main/parse-core.js`) now decodes with
`nativeImage.createFromPath`, resizes by width (aspect ratio is preserved
when one dimension is given) and encodes with `toJPEG`. Measured against 50
real covers from this library:

| | jimp | nativeImage |
|---|---|---|
| per cover | 1,629 ms | **61 ms** (26x faster) |
| average output | 20.5 KB | 15.1 KB |
| covers decoded | 50/50 | 50/50 |

The security result is the point, though: `jimp` moved to
`devDependencies` (the icon scripts still need it — see below), so the
vulnerable `file-type@16.5.4` it pulls in is **no longer shipped**. Verified
on a real packaged build: zero `jimp` entries in `app.asar`, the only
`file-type` present is `21.3.4` via `music-metadata` (a different, unaffected
line), and `npm audit --omit=dev` reports **0 vulnerabilities**. Hostile
input is handled structurally rather than by hoping: `nativeImage` returns an
*empty image* for anything it can't decode — garbage, truncated files,
directories, missing paths — so there is no exception to catch and nothing to
spin on.

**Not converted:** `scripts/make-icons.cjs` and `scripts/make-media-icons.cjs`
still use `jimp`, because they do per-pixel drawing (`img.scan`, direct
bitmap writes) that `nativeImage` cannot do — it resizes and re-encodes, it
does not draw. That is fine: both are build-time scripts, run by hand,
operating on a checked-in logo, and their outputs (`build/icon.ico`,
`build/media-icons/*`) are committed. They are not an attack surface and they
are not in the shipped app.

---

## Suggested sequencing

Everything in the original sequencing plan has shipped — all of Tier 1, and
Tier 2 apart from bookmark clips. What follows is what is actually left,
ordered by value against effort:

1. **Reliability #2–#5** (surface parse failures, cancel a scan, occasional
   deep scan, flag unexpected exits) — all small, all address things that are
   currently silent. Cheap trust wins.
2. **Incremental scan via file watcher** (Performance #4) — with rescans now
   ~3s, the remaining annoyance is having to trigger one at all.
3. **Sidecar metadata** (Tier 3 #2) — narrator + description from `.nfo`, and
   `series` from co-located `.abs`/`.opf`, fills the gaps title parsing
   can't reach. Best remaining metadata win for this library specifically.
4. **Full-cast / graphic audio productions** (Tier 3 #6) — 28 titles in this
   library scan as split, mislabelled entries today. Touches how a book's
   identity is derived, so worth doing before sidecar metadata rather than
   after. (Gapless playback and per-chapter artwork, Tier 3 #4–#5, shipped.)
5. **Query-per-view** (Performance #1, the open half) — the real ceiling for
   very large libraries, and a prerequisite for instant server-side search.
   Bigger: it changes the app's interaction model, so it wants its own pass.
6. **Waveform / seek preview, auto-generated chapters, bookmark clips** —
   genuine features rather than fixes; pick by appetite.

Deliberately **not** sequenced: the Electron major bump and the `jimp`
question (see Security). Both are real, both need their own verification
pass, and neither is a good candidate for bundling into feature work.

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
- [For the Joy of Books — best audiobook apps 2026](https://forthejoyofbooks.com/best-audiobook-app/) (customizable skip amounts)
- [Goodreads / Spotify community threads on marking audiobooks finished](https://www.goodreads.com/topic/show/17957277-marking-books-as-read) (manual finished-state gap)
