# Changelog

All notable changes to Tomelight are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Each entry below is
also what gets attached as the GitHub Release's notes for that version (and
what the in-app "Check for Updates" screen shows) — see
`scripts/extract-changelog.cjs`.

## [Unreleased]

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
