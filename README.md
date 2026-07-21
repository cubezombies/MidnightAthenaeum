# Tomelight

![Tomelight](assets/logo.png)

A desktop audiobook player for Windows, built with Electron. Plays local files with
real chapter navigation, per-book resume, per-book playback speed, bookmarks,
skip-silence, and a sleep timer. A **Continue listening** shelf, library filters, and
**series grouping** keep the book you're on one click away, even in a library of
thousands.

The name is *tome* + *light* — reading old tomes by candlelight.

## Icons

The app icon is generated from `assets/logo.png` — the emblem is cropped out
(dropping the wordmark) and written as `assets/icon.png` plus a multi-size
`build/icon.ico` used for the window and taskbar. Regenerate with `npm run icons`
(tweak the `CROP` constants in `scripts/make-icons.cjs` if the framing shifts).

Planned features, differentiators, and performance work are tracked in
[docs/ROADMAP.md](docs/ROADMAP.md).

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

**`.cue` fallback.** When a single-file book has no embedded chapters (a lone
`.mp3`, or an `.m4b` that omits them) but ships a sibling `.cue` sheet, the
chapter titles and offsets are read from that instead (`src/main/cue.js`). This
is a *fallback only* — real embedded chapters are never overridden. On the test
library it gave real chapters to ~47 otherwise-unnavigable books (some 80–180
chapters long).

## Where data lives

Everything is kept off `C:`. Paths are set in `src/main/paths.js` and can be
redirected with the `TOMELIGHT_DATA_ROOT` environment variable.

```
D:\Claude\Tomelight\
  userData\       Electron/Chromium profile and caches
  covers\         extracted cover art
  library.json    scanned library
  progress.json   per-book listening position
  bookmarks.json  per-book bookmarks
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

## Known limitations

- **Series-tagged titles.** Some publishers set every volume's `album` tag to the
  series name. For single-file books the more specific `title` tag is used
  instead, but a multi-track book (a folder of mp3s) has only the series name to
  show, so volumes of the same series can render with an identical title even
  though they are correctly kept as separate books. The folder names distinguish
  them on disk.
- **Box sets stay whole.** A single file (or folder) containing several novels is
  one entry with one long chapter list; there is no reliable signal to split it
  into constituent books.
- **Merged m4b parts use one chapter per file.** When a book shipped as numbered
  `.m4b` segments is merged, each segment becomes one chapter; any chapters
  embedded inside a segment are not surfaced.

## Keyboard

| Key | Action |
| --- | --- |
| `Space` | Play / pause |
| `←` / `→` | Back / forward 30s |
| `Shift` + `←` / `→` | Back / forward 5 min |
| `B` | Add a bookmark at the current spot |
| `S` | Toggle skip-silence |
| `T` | Open the sleep-timer menu |
| `Esc` | Close the sleep menu, or go back to the library |

## Finding your place

The library opens with a **Continue listening** shelf — the books you're partway
through, most-recently-played first, one click from resuming. Filter tabs (All /
In progress / Finished / Not started) narrow the grid below. Each book remembers
its own **playback speed**, and resuming after a pause **rewinds a few seconds**
(more the longer you were away) so you don't lose the thread.

### Series grouping

The **Group series** toggle collapses the volumes of a series into a single tile
(e.g. all 15 Spellmonger books become one), so a large library reads as series
rather than a wall of covers. Click a tile to open the series and see its volumes
in reading order; opening a volume and pressing Back returns you to the series.

Series are detected from the book title and author — `"Warmage: Spellmonger,
Book 2"` → *Spellmonger #2* — entirely in the app, with no re-scan. Grouping only
forms a tile when **two or more books share a series name and author**, which
keeps multi-author franchises (e.g. everything with "Star Wars" in the title) from
collapsing into one meaningless pile. Books whose titles don't spell out a series
(standalones, un-numbered novellas) stay as normal cards. On the real test library
this groups ~360 series covering ~1,500 books; the rest show individually.

## Bookmarks

Press `B` or the 🔖 button in the player to drop a bookmark at the current spot;
its label defaults to the current chapter. Bookmarks appear in the book's detail
view, where you can rename them, add a note, jump back with one click, or delete
them. Every manual pause also drops a single rolling **"Last stop"** marker so you
can always find where you set the book down — editing it makes it permanent.
Bookmarks are stored in `bookmarks.json` in the data folder.

## Skip silence

The ⏩ button (or `S`) shortens the dead air in a book. The audio is routed
through a Web Audio `AnalyserNode`; when it detects a *sustained* quiet gap
(≈0.2s, so natural between-word pauses are left alone) it briefly raises the
playback rate so the gap passes quickly, then snaps back to your speed the
instant speech returns — no hard cut. It stacks on your per-book speed (capped so
playback stays intelligible) and keeps working while the app is in the
background. On a long book with lots of pauses this reclaims a meaningful chunk
of time.

## Sleep timer

The moon control in the player bar stops playback after a set time — a fixed
duration (5–60 min), at the **end of the current chapter**, or at the **end of
the book**. The volume fades gently over the last 20 seconds rather than cutting
out. If you fall asleep, resuming rewinds 30 seconds so you don't lose your place,
and **+5 minutes** extends (or restarts) the timer and picks playback back up.
The duration countdown only runs while audio is playing, so pausing pauses it too.
