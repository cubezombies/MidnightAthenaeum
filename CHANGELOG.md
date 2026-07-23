# Changelog

All notable changes to Midnight Athenaeum are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Each entry below is
also what gets attached as the GitHub Release's notes for that version (and
what the in-app "Check for Updates" screen shows) — see
`scripts/extract-changelog.cjs`.

## [Unreleased]

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
