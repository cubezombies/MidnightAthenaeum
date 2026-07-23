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

### 3. Listening statistics & streaks — **M**
Total time listened, books finished, current streak, top authors/narrators, pace
over time. `progress.json` timestamps already capture most of the raw signal.
A stats page is a strong retention feature and easy to make visually appealing.

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

**Out-of-band priority:** items 10–12 (folder management, confirm-before-destroy,
backup/export — all ⚠️, all shipped) protected against real data loss or were
dead-code gaps rather than missing polish. All three are now done.

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
