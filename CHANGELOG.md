# Changelog

All notable changes to Midnight Athenaeum are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Each entry below is
also what gets attached as the GitHub Release's notes for that version (and
what the in-app "Check for Updates" screen shows) — see
`scripts/extract-changelog.cjs`.

## [Unreleased]

## [0.12.0] - 2026-07-24
### Changed
- The library grid now renders only the books actually in or near view,
  instead of accumulating every card you've ever scrolled past — memory and
  DOM size stay flat no matter how far you scroll a large library.
- Covers now get a small cached thumbnail (generated in the background,
  same pass that already fills in chapters) that the grid, series view, and
  duplicates finder load instead of the full-size image. Combined with the
  grid change above, scrolling back into a section you'd already passed no
  longer visibly pauses to redecode covers. The book view still shows your
  covers at full resolution.

## [0.11.0] - 2026-07-24
### Changed
- The library index moved from one monolithic `library.json` file to a real
  SQLite database (`library.db`), migrated automatically on first launch of
  this version — your old `library.json` is kept as `library.json.bak`, never
  deleted. Rescans and detail fills now write only the rows that actually
  changed instead of rewriting the whole file every time; on a 5,800+ book
  library this cut a routine background write from a full-file rewrite down
  to single-digit milliseconds. No visible change to search, sort, or
  filtering — this is purely a storage change underneath.

## [0.10.0] - 2026-07-23
### Added
- **Read along** — pairs an EPUB with its matching audiobook and shows the
  current chapter's text in a side panel while you listen. A new **Read
  along** button in the book view opens it (or prompts to pick the ebook
  file if none was found automatically); a background pass checks the whole
  library for matches over time, powering a new **Has ebook** library
  filter and a card badge. The panel auto-advances to the chapter matching
  what's playing when confident (exact chapter-count match, or proportional
  position as a weaker signal — never a wrong guess), and estimates your
  paragraph position within that chapter from how far through the audio
  chapter you are. Word-level highlighting is a further-out idea — this is
  the "even without it, showing the matching chapter is valuable" version
  from the roadmap.
  - New `src/main/epub.js`: a hand-rolled EPUB reader (ZIP central-directory
    parsing + narrow container.xml/OPF/NCX/nav.xhtml extraction), no new
    dependency. Handles nested/fragment-split tables of contents,
    percent-encoded paths, and both EPUB2 and EPUB3 conventions; chapter
    text is extracted safely in the renderer via `DOMParser`, not
    main-process regex.
  - New `src/main/ebook-pairing.js`: on-demand (not scan-time) folder-
    proximity matching, tuned against a real-data dry run of this library.
  - Verified with a 32-check synthetic EPUB harness (real generated
    fixtures covering nested TOCs, both EPUB eras, malformed markup, and a
    simulated DRM failure) before ever touching real files.

## [0.9.1] - 2026-07-23
### Fixed
- Skip-silence was cutting into narrators pausing to breathe mid-sentence
  (still talking, just inhaling), boosting playback speed for a moment in
  the middle of a sentence — audible as choppiness. The "sustained quiet"
  threshold before boosting was only 200ms, well under a normal breath
  pause; raised to 700ms, confirmed to fix it by ear.

## [0.9.0] - 2026-07-23
### Changed
- **Two-phase library scanning** — a scan now shows the grid much sooner by
  deferring the expensive parts of each book. Phase 1 reads only tags and
  duration (skipping cover art entirely, and — for single-file `.m4b`/`.m4a`
  books — chapter extraction, which costs one extra disk read per chapter).
  Phase 2 fills in cover art and chapters afterward, in the background at
  low priority, resuming automatically if interrupted and jumping the queue
  for any book you open before it gets there. Multi-track (mp3-folder)
  books are unaffected — their chapters already come for free alongside
  duration. Playback was never gated on chapters or cover art, so a book is
  fully playable the moment phase 1 finds it.

## [0.8.0] - 2026-07-23
### Added
- **Voice Boost** — a speech-tuned EQ for fast listening, where deep-voiced
  narration turns muddy at 2.5–3×. The 🎚 button (off by default; `V`
  toggles) runs two `BiquadFilterNode`s spliced into the existing Web Audio
  graph: a ~100Hz highpass clears low rumble, and a +8dB peaking filter at
  ~2.8kHz lifts the consonant/sibilance range that carries intelligibility.
  Both ramp smoothly rather than snapping, and stack cleanly with
  skip-silence and normalization since all three share the same graph.
- A native right-click context menu (Cut/Copy/Paste/Undo/Redo/Select All) in
  text fields — Electron ships none by default.

### Fixed
- The audio graph's "resume on play" check didn't account for Voice Boost,
  so with skip-silence and normalization both off, playback could route
  through a suspended Web Audio context and produce no sound at all —
  looking like a dead player rather than a missing EQ effect.
- A track that fails to load or decode now shows a toast explaining why,
  instead of failing completely silently (previously logged to the DevTools
  console only, so a broken file just looked like an unresponsive play
  button).
- Reduced book-scan concurrency to cut down on disk-seek thrashing on
  spinning HDDs, where reading several unrelated directories in parallel
  costs more in seek time than the overlap saves (SSDs are largely
  unaffected either way).

## [0.7.0] - 2026-07-23
### Added
- **File → Reorganize library by author…** — previews a move of every book
  into `<library folder>/<Author>/<Title>/` before anything happens, then
  moves on explicit confirm, journaling every individual move as it goes
  (not batched at the end) so an interruption leaves an accurate record of
  what's actually done. A book's own folder is only renamed wholesale when
  it exclusively owns that folder — a folder shared by unrelated books
  (confirmed real in this library: four different Alien audio dramas side
  by side) only has that book's own files moved out, leaving siblings
  untouched. **File → Undo last reorganization…** reverses the whole run.
  Since a book's id is derived from its file path, a move mints it a new
  one — execute and undo both carry progress, bookmarks, normalization
  gain, metadata overrides, and transcripts over to the right id rather
  than silently orphaning them on the next scan.

## [0.6.0] - 2026-07-22
### Added
- **File → Find duplicate books…** — scans the already-scanned library (no
  new file access) for the same book filed in more than one place. Groups
  by title+author, then splits into distinct *recordings* by matching
  duration/track count: a recording with 2+ copies is a real duplicate and
  offered for removal; a same-title recording with only 1 copy (a
  different narrator someone deliberately collected) is shown for context
  but never offered for removal — verified against a real library where
  both cases exist side by side (three different narrators of the same
  book vs. the same file copied across category folders). Removal moves
  the book's own files to the Recycle Bin (never the containing folder,
  which can hold unrelated sibling books) and updates the library
  immediately, no rescan needed.

## [0.5.1] - 2026-07-22
### Fixed
- Multi-part books using a "(01of17)"-style folder-per-disc naming
  convention (one folder per physical CD, no "Disc"/"CD" word in the name)
  showed up as N separate library entries instead of one merged book. Found
  on a real 330-track, 17-folder audiobook in this library — the existing
  disc-folder merge heuristic only recognized "Disc N"/"CD N"/"Part N"
  naming, not bare "N of M". **Needs a rescan** to re-group books that were
  already scanned under the old logic.
- The play button and the skip-silence button could visually overlap at
  some window widths. Cause: `.extras`' `min-width: 0` (added when making
  the player controls responsive) let its grid track shrink smaller than
  its actual content — but unlike the now-playing text (which genuinely
  shrinks via ellipsis), `.extras`' buttons/selects/slider have fixed sizes
  that can't shrink to match, so the content overflowed into the play
  button instead. Removed the incorrect `min-width: 0` and widened the
  responsive breakpoints for more headroom.

## [0.5.0] - 2026-07-22
### Added
- **Local, offline transcription and full-text search inside audiobooks.**
  "Transcribe this book" (book view) runs `ffmpeg-static` +
  `@kutalia/whisper-node-addon` (prebuilt whisper.cpp bindings) entirely
  on-device — no audio or text ever leaves your machine. GPU acceleration
  (Vulkan) is used automatically when available, with a CPU/BLAS fallback.
  Multi-track books get correct per-track timestamp offsets merged into one
  transcript. Once transcribed: **Search transcript** finds matching spoken
  lines and jumps straight to that moment, and a captions toggle shows the
  current line live while that book plays. One book transcribes at a time;
  the ~148MB English model downloads once, on first use.

  The real risk here was native-binary packaging through Electron's asar,
  not the transcription itself: `require()`-loading the native addon from
  inside `app.asar` works transparently, but `child_process.spawn()` does
  **not** — it needs a real filesystem path and fails silently (`ENOENT`)
  on the virtual asar one. Fixed by rewriting the ffmpeg path to
  `app.asar.unpacked` before spawning it. This — along with GPU detection,
  multi-track offset math, and the full pipeline — was verified end-to-end
  against a real packaged build and real generated speech audio before any
  UI was built on top of it, not assumed to work from documentation alone.

  Per-chapter summaries (mentioned as a future extension) are out of scope
  for this pass — Whisper transcribes, it doesn't summarize.

## [0.4.9] - 2026-07-22
### Added
- **Discord Rich Presence** — shows "Listening to *The Way of Kings* — Ch.
  12" on your Discord profile while a book plays, updating on chapter
  changes and play/pause. Off by default (new topbar toggle) — this reports
  what you're listening to externally, so it's opt-in like the online
  metadata lookup, not a launch-time default. Entirely best-effort: with no
  Discord client ID configured, or Discord not installed/running, every call
  silently no-ops rather than surfacing an error — verified a stuck/failed
  connection attempt is bounded to a few seconds internally rather than
  hanging, since the underlying RPC library doesn't reliably fail fast on
  its own. Needs a Discord Application ID to actually activate; inert until
  one is configured.

## [0.4.8] - 2026-07-22
### Fixed
- A large empty gap at the top of the window, introduced in 0.4.6. Cause:
  the icon sprite's `<svg style="display:none">` used an inline style
  attribute, which the page's CSP (`style-src 'self'`, no `unsafe-inline`)
  silently blocks rather than erroring on — the sprite rendered at its
  unstyled default size (300×150px) instead of being hidden, pushing
  everything below it down. Moved the rule into the stylesheet instead.

## [0.4.7] - 2026-07-22
### Fixed
- **Critical**: the app hung on startup, never showing a window. Cause:
  0.4.6's themed titlebar (`titleBarStyle: 'hidden'` + `titleBarOverlay`)
  broke window creation — this was the one change in 0.4.6 flagged as
  needing real-world verification, since it can't be tested in a sandboxed
  dev environment, and it turned out to be broken. Reverted back to the
  standard native title bar; everything else from 0.4.6 (icons, progress
  bar, focus states, layout fixes) is unaffected and stays in place. No
  data was at risk — this was purely a window-chrome regression.

## [0.4.6] - 2026-07-22
### Added
- A real SVG icon set replacing every emoji/Unicode-symbol icon in the app
  (play/pause, chapter skip, bookmark, sleep timer, theme toggle, etc.) —
  crisp at any size and colored via `currentColor`, so it always matches the
  theme instead of relying on the OS's emoji font.
- A themed titlebar: the app's own topbar now doubles as the window's drag
  region (`titleBarStyle: 'hidden'` + `titleBarOverlay`), replacing the
  plain default Windows title bar. The minimize/maximize/close buttons are
  still drawn natively by Windows itself (including Windows 11's
  snap-layout hover menu) — only their color is synced to the app's
  light/dark theme, not their behavior.
- A real progress bar for library scans (previously just small topbar text)
  and a loading indicator for the brief gap before the library first loads.
- A native tooltip on library/series cards showing the full title/author,
  since long titles get clamped to 2 lines in the grid.
- A visible keyboard-focus ring on library cards, matching the accent-colored
  focus style already used elsewhere (e.g. the metadata search results).

### Fixed
- The undo toast sat ~150px above the bottom edge when no book was playing
  (it always reserved space for the player bar, even when hidden).
- Two different modal/overlay backdrop dims were unified into one.
- The player's control row is now readable at the app's 940px minimum
  window width instead of cramming 7 controls' full labels into no space.

## [0.4.5] - 2026-07-22
### Fixed
- **Critical**: the preload script has been failing to load entirely since
  0.4.2, breaking `window.api` for the whole app — every button, the
  library load on startup, and the updates dialog all silently threw
  `Cannot read properties of undefined`. Cause: preload.js runs sandboxed
  (`webPreferences.sandbox: true`), and a sandboxed preload's `require()`
  only resolves a small built-in whitelist, not local project files — the
  `require('./finished')` added in 0.4.2 to share the "finished" threshold
  constant with main.js threw `module not found` at load time and silently
  killed the entire preload script. Fixed by inlining the (3-line) function
  directly in preload.js instead of requiring the shared module, with a
  comment explaining why. Everything that looked like separate bugs the last
  few releases — the empty library after updating, "Check for Updates" not
  opening, rescan/search doing nothing — was this one root cause.

## [0.4.4] - 2026-07-22
### Added
- **View → Toggle Developer Tools**, with the standard Ctrl+Shift+I/F12
  shortcut. The custom application menu replaces Electron's default one,
  which is what normally wires that shortcut up — without a `toggleDevTools`
  role somewhere in the replacement, the accelerator was simply never
  registered, not just hidden behind a different menu.

### Fixed
- The About window was sized a little too tight for its content (520px tall
  vs. content closer to ~490px plus title/menu bar chrome), forcing an
  unwanted scrollbar. Bumped to 580px.

## [0.4.3] - 2026-07-22
### Added
- **File → Change library location…** and **Reset library location to
  default** — relocating where Midnight Athenaeum stores its data no longer
  requires manually setting an environment variable. Picking a folder that
  already has a `library.json` in it switches to it directly (nothing is
  moved, the old location is left untouched); picking an empty folder moves
  the current library index, progress, bookmarks, and cached covers there.
  Either way the app restarts to apply it.

### Fixed
- The data location is now tracked in a small file at the standard app-data
  path instead of only an environment variable. A location set purely via an
  environment variable could appear to "lose" the library after certain
  relaunches (including the one an in-app update triggers) if the new
  process didn't inherit that variable — a real, if confusing-looking, issue
  hit on this developer's own machine. The underlying data was never
  actually at risk, only the pointer to it, and real installed users were
  never affected (this only applies to a location set outside the app in the
  first place) — but the new file-based mechanism is immune to this class of
  problem for everyone going forward.

## [0.4.2] - 2026-07-22
### Fixed
- The "Continue Listening" jump list refresh (which runs every few seconds
  during playback) no longer re-maps and re-serializes the entire library on
  every call — it now builds a lightweight id/title/author list instead of
  running every book through the full client-shaping the main library view
  needs.
- Applying or reverting an online metadata correction no longer re-sends the
  whole library over IPC, just the one changed book.
- Library search is now debounced instead of re-filtering, re-sorting, and
  re-grouping the whole library on every keystroke.
- A full library scan no longer blocks on a synchronous directory read per
  book when checking for a sibling `.cue` file.
- The skip-silence/normalization audio loop skips its per-tick sample read
  once normalization has locked its gain and skip-silence is off, instead of
  reading it unconditionally every 25ms.
- The main library grid's cards now share one delegated click/keydown
  listener instead of attaching a pair to every card.
- The "finished" position threshold was duplicated between the main and
  renderer processes; it's now a single shared constant so the two can't
  silently drift apart.
- A tag-parse failure during a scan is now aggregated and reported as a
  scan-level warning instead of being silently discarded.
- Several IPC handlers (`library:removeFolder`, `bookmarks:update`/`remove`,
  `metadata:search`/`preview`) now validate their arguments like the rest of
  the IPC surface, and a failed folder add/rescan/remove now shows a toast
  instead of failing silently.
- The About window now carries the same Content-Security-Policy as the main
  window (its inline style/script were split into external files to allow
  it).

## [0.4.1] - 2026-07-22
### Changed
- Real branding art for Midnight Athenaeum (previous release still carried
  the old Tomelight banner/icon, since the new art wasn't ready yet). App
  icon is cropped from the new banner the same way as before — the emblem
  only, no wordmark, so it stays legible down to taskbar sizes.

## [0.4.0] - 2026-07-22
### Changed
- Renamed from **Tomelight** to **Midnight Athenaeum**. The Tomelight name
  turned out to collide with an existing product (tomelight.com, an
  AI-powered D&D campaign tool) — picked after several rounds of checking
  candidates against npm, web search, and actual `.com` domains, since the
  first few "clean" picks each turned out to have their own real collisions
  once checked more thoroughly. Everything user-facing changed: the app
  itself, the installer, the GitHub repo, and the default data folder
  (`%APPDATA%\Midnight Athenaeum`, was `%APPDATA%\Tomelight`;
  `MIDNIGHT_ATHENAEUM_DATA_ROOT` replaces `TOMELIGHT_DATA_ROOT` as the local
  dev override). Old backup files (`"app": "Tomelight"`) still restore fine —
  only the default paths and branding changed, not the data format.

## [0.3.0] - 2026-07-22
### Added
- Windows media flyout, lock screen, and hardware/keyboard media key support
  (play/pause, previous/next chapter), with the book's cover, title, and
  author — and a live-updating chapter subtitle — via the standard
  `navigator.mediaSession` API.
- Taskbar thumbnail-toolbar buttons (previous chapter / play-pause / next
  chapter) on hover.
- A "Continue Listening" jump list of recently-played books on the taskbar
  icon / Start tile, which opens straight to that book.

## [0.2.3] - 2026-07-22
### Fixed
- The default data location was hardcoded to this developer's own `D:` drive
  convention (`D:\Claude\Tomelight`) rather than a real per-user default — on
  a machine with no `D:` drive the app would fail to start, and on any other
  machine it would create a nonsensical `D:\Claude\...` folder. Now defaults
  to the standard `%APPDATA%\Tomelight`, empty until you add your own library
  folder. `TOMELIGHT_DATA_ROOT` still overrides it for local dev.
- Related: Chromium's own profile folder (`userData`) wasn't created before
  Electron pointed it there, which silently failed on a genuinely fresh
  machine (masked for months by the old path already existing on disk from
  years of local use).

## [0.2.2] - 2026-07-22
### Added
- A Ko-fi donation link in **About Tomelight**.

## [0.2.1] - 2026-07-22
### Fixed
- Restarting to install a downloaded update showed the full interactive NSIS
  install wizard instead of installing quietly in the background — found by
  actually running the update flow end to end against a real published
  release, not just the check/download steps. `quitAndInstall()` now runs
  silently and relaunches the app automatically once done.
- The "What's new" text in the update dialog showed raw HTML tags (`<h3>`,
  `<li>`, …) instead of rendering them — GitHub returns the changelog section
  as rendered HTML, not plain text.

## [0.2.0] - 2026-07-22
### Added
- In-app update checking: **Help → Check for Updates…** checks GitHub
  Releases, shows this changelog's notes for the new version, downloads it in
  the background, and prompts to restart and install once it's ready.
- `LICENSE` file (MIT, matching the license already declared in
  `package.json`) — the repo is now public.

## [0.1.0] - 2026-07-22
### Added
- Library scanning with book grouping: single `.m4b`/`.m4a` files, folders of
  `.mp3` tracks, disc-numbered subfolders, and numbered-part `.m4b` merges.
- Custom MP4 chapter parser for QuickTime text chapter tracks, with a `.cue`
  sheet fallback for files with no embedded chapters.
- Multi-track unified timeline, per-book resume and playback speed, skip
  silence, volume normalization, sleep timer, and bookmarks with notes.
- Library browsing: continue-listening shelf, filters, sort, series grouping,
  "NEW" badges, chapter search, customizable skip amount, manual finished
  toggle, drag-and-drop folder add, light/dark theme.
- Backup/restore of progress, bookmarks, normalization, and metadata
  overrides to a portable JSON file.
- Opt-in online metadata lookup (Open Library) to correct title/author,
  fetch a description, and download a higher-res cover, cached locally.
- Windows installer and uninstaller (NSIS via electron-builder), published to
  GitHub Releases.
