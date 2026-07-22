# Changelog

All notable changes to Midnight Athenaeum are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Each entry below is
also what gets attached as the GitHub Release's notes for that version (and
what the in-app "Check for Updates" screen shows) — see
`scripts/extract-changelog.cjs`.

## [Unreleased]

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
