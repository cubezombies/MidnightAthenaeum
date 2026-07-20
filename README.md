# Audiobook-player

A desktop audiobook player for Windows, built with Electron. Plays local files with
real chapter navigation, per-book resume, and variable speed.

## Running it

```powershell
npm install
npm start
```

> **Note:** if your shell has `ELECTRON_RUN_AS_NODE=1` set (VS Code's integrated
> terminal does this), `electron` runs as plain Node and no window appears.
> Clear it first: `$env:ELECTRON_RUN_AS_NODE=$null`.

On first launch, click **Add folder** and point it at your audiobook directory.

## How a library is interpreted

Real libraries mix two conventions, so the scanner splits on file type:

| Layout | Treated as |
| --- | --- |
| One `.m4b` / `.m4a` file | One book; chapters read from inside the file |
| A folder of `.mp3` tracks | One book; each track becomes a chapter |
| `Disc 1/`, `Disc 2/` subfolders | Merged into a single book |

A folder is only merged as discs when it has several audio subfolders *and* at
least one is disc-named — so a series folder holding separate books per subfolder
stays separate.

Multi-track books play as one continuous timeline: the seek bar, chapter list and
saved position are all in whole-book seconds, and playback rolls over file
boundaries on its own.

## Chapters

Chapters come from a hand-written MP4 parser (`src/main/mp4-chapters.js`) rather
than from `music-metadata`.

`music-metadata`'s `includeChapters` option does not surface **QuickTime text
chapter tracks** — a second `trak` with handler `text`, linked from the audio
track by a `tref`/`chap` reference — which is how essentially every `.m4b` in the
wild stores chapters. On a real library it returned zero chapters for every file.
The parser here reads that track directly (with a fallback to Nero `chpl` atoms),
which is both more robust and roughly 50× faster, since it does targeted reads
instead of decoding the whole file. It also recovers chapters from files
`music-metadata` refuses to parse at all.

## Where data lives

Everything is kept off `C:`. Paths are set in `src/main/paths.js` and can be
redirected with the `AUDIOBOOK_DATA_ROOT` environment variable.

```
D:\Claude\AudiobookPlayer\
  userData\       Electron/Chromium profile and caches
  covers\         extracted cover art
  library.json    scanned library
  progress.json   per-book listening position
```

Scanning a large library takes a few minutes the first time. Results are cached
against each file's size and mtime, so rescans only reparse what changed.

To scan without launching the app (useful for a first run):

```powershell
node prime.mjs "E:\Books"
```

`probe.mjs` dumps an MP4's box structure, which is the quickest way to see how a
particular file stores its chapters:

```powershell
node probe.mjs "path\to\book.m4b"
```

## Layout

```
src/main/
  main.js            app lifecycle, window, IPC
  paths.js           where app data is written
  library.js         scanning, tag reading, cover extraction
  group.js           files -> books (disc merging, m4b vs mp3-folder)
  mp4-chapters.js    MP4/M4B chapter + duration parser
  media-protocol.js  ab-media:// with byte-range support
  store.js           atomic JSON persistence
  preload.js         contextBridge API
src/renderer/        UI (no framework)
```

Audio is served over a custom `ab-media://` protocol with HTTP range support
rather than by disabling `webSecurity`, so seeking inside a 40-hour file doesn't
re-read from the start. The handler validates every request against the folders
actually in your library, so it can't be used to read arbitrary files.

## Keyboard

| Key | Action |
| --- | --- |
| `Space` | Play / pause |
| `←` / `→` | Back / forward 30s |
| `Shift` + `←` / `→` | Back / forward 5 min |
| `Esc` | Back to library |
