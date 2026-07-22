# Tomelight

![Tomelight](assets/logo.png)

A desktop audiobook player for Windows, built with Electron. Plays local files with
real chapter navigation, per-book resume, per-book playback speed, bookmarks,
skip-silence, volume normalization, and a sleep timer. A **Continue listening**
shelf, library filters, and **series grouping** keep the book you're on one click
away, even in a library of thousands. Light and dark themes, following the system
by default.

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

On first launch, click **Folders** in the top bar to add your audiobook
directory. The same panel lists every folder currently in your library — each
with a live book count — and lets you remove one, which drops its books from
Tomelight without touching anything on disk. Removing a folder that holds
thousands of books asks for confirmation first, since there's no undo.

You can also just **drag a folder onto the window** — it shows a drop-zone
overlay while you're dragging and adds the folder the same way "Folders → Add
folder" would. Dropping something that isn't a folder (e.g. an individual file)
is rejected with a toast rather than silently doing nothing.

## Installer

The easiest way to install Tomelight is to grab the prebuilt installer from
[**Releases**](https://github.com/cubezombies/Tomelight/releases/latest) —
download `Tomelight-Setup-<version>.exe` and run it. No admin rights needed.

It's a per-user NSIS installer — the standard default install location
(`%LOCALAPPDATA%\Programs\Tomelight`), no admin rights needed. It adds Start
Menu and Desktop shortcuts and registers an entry in *Settings → Apps* with
its own uninstaller (`Uninstall Tomelight.exe`, also reachable from Apps). The
"Choose Install Location" page lets you pick a different folder if you'd
rather — e.g. this developer's own machine installs everything to `D:`, a
personal convention with no bearing on where it installs for anyone else.
Uninstalling removes the installed program files and shortcuts only — it
never touches the data folder described below, so your library, progress, and
bookmarks survive an uninstall/reinstall.

The installer is unsigned (no code-signing certificate), so Windows SmartScreen
will show an "unrecognized publisher" warning on first run — click **More
info → Run anyway**.

*Tested:* a full cycle using the actual downloaded release asset (not just a
local build) — downloaded `Tomelight-Setup-0.1.0.exe` from the published
Release, verified its SHA-256 against the digest GitHub recorded for it,
installed it silently to the default `%LOCALAPPDATA%\Programs\Tomelight`
location, confirmed the installed app loads the real library over IPC exactly
like the dev build, then uninstalled and confirmed the install directory,
shortcuts, and registry entry were gone while the data folder was untouched.

### Building it yourself

```powershell
npm install
npm run dist
```

produces `dist\Tomelight-Setup-<version>.exe` the same way the Release build
does. `npm run pack` builds an unpacked `dist\win-unpacked\` folder instead,
for a quick smoke test without going through the installer.

### Cutting a release

Pushing a tag matching `v*.*.*` (e.g. `v0.1.1`) runs
[`.github/workflows/release.yml`](.github/workflows/release.yml), which builds
the installer on `windows-latest` and publishes it to a GitHub Release via
electron-builder's GitHub provider — so bumping `version` in `package.json`,
tagging, and pushing the tag is the whole release process. The workflow can
also be re-run manually (`workflow_dispatch`) against an existing tag if a
run needs retrying.

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

**Searching a chapter list.** Some books have a lot of chapters — *Wind and
Truth* has 212 — so the book view has a search box above the list. It filters by
title text or by chapter number (typing `150` jumps straight to chapter 150
without scrolling), updating as you type. `Esc` clears the search first, then
un-focuses the box on a second press, rather than leaving the book view.

## Where data lives

Everything is kept off `C:`. Paths are set in `src/main/paths.js` and can be
redirected with the `TOMELIGHT_DATA_ROOT` environment variable.

```
D:\Claude\Tomelight\
  userData\               Electron/Chromium profile and caches
  covers\                 extracted cover art
  covers-online\          covers fetched via the online metadata lookup
  library.json            scanned library
  progress.json           per-book listening position, speed
  bookmarks.json          per-book bookmarks
  normalization.json      per-book measured loudness gain
  metadata-overrides.json per-book online metadata corrections
```

Scanning a large library takes a few minutes the first time. Results are cached
against each file's size and mtime, so rescans only reparse what changed.

### Backup and restore

**File → Backup data…** bundles `progress.json`, `bookmarks.json`,
`normalization.json`, and `metadata-overrides.json` into one timestamped JSON
file and lets you choose where to save it — deliberately defaulting to
`D:\Claude\Tomelight-Backups`, a sibling of the data folder rather than
something inside it, so deleting or corrupting the live data folder can't take
the backup down with it too. Cached cover images from the online lookup aren't
included (they're just re-fetchable), so a restored override may briefly show
no cover until you look it up again.

**File → Restore from backup…** reads a backup file, shows what it contains
(book counts, when it was made) in a confirmation dialog, and — only if you
confirm — replaces your current progress, bookmarks, normalization, and
online-metadata data with it. This can't be undone, so it's worth being sure
before confirming.

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
  metadata-lookup.js Open Library search/description/cover fetch
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

## Online metadata lookup

Scanned tags are sometimes wrong or incomplete — a garbage ripper tag as the
author, a missing description, no embedded cover. The book view's **Look up
online** button searches [Open Library](https://openlibrary.org) for the real
title, author, description, and a higher-resolution cover, and lets you apply
one as a correction on top of the scanned data.

It's opt-in and off by default — the first click shows what it does and what it
sends before turning it on, and nothing is looked up automatically at any other
time (no lookups on scan, on library load, or in the background). Everything
fetched is cached locally in `metadata-overrides.json` and `covers-online\`, so
once applied a book displays correctly offline. **Revert to file tags** on a
corrected book removes the override (and its cached cover) and goes back to
what was scanned from the file.

Source is Open Library only. Google Books' keyless tier returned a quota error
on the very first request in testing, before shipping a single real query,
which would have meant asking every user to obtain their own API key just to
use the feature — rejected as too much friction for an opt-in convenience.
Audible has no public API, and scraping it would be a ToS risk this app isn't
taking on.

**Series-splitting is out of scope.** The original ask included using this
lookup to split box sets / series-tagged titles apart. Open Library's series
data turned out to be too sparse and inconsistent across this library's real
books to build a reliable feature on — it's a metadata-correction tool
(title/author/description/cover), not a re-grouping one. The existing
[series detection](#series-grouping) (parsed from the title/author already in
Tomelight) and the [known series-tagged-title limitation](#known-limitations)
above are unaffected by this feature.

## Keyboard

| Key | Action |
| --- | --- |
| `Space` | Play / pause |
| `←` / `→` | Back / forward (skip amount, default 30s — set via the **Skip** dropdown) |
| `Shift` + `←` / `→` | Back / forward 5 min |
| `B` | Add a bookmark at the current spot |
| `S` | Toggle skip-silence |
| `N` | Toggle volume normalization |
| `T` | Open the sleep-timer menu |
| `Esc` | Close the sleep menu, or go back to the library |

## Finding your place

The library opens with a **Continue listening** shelf — the books you're partway
through, most-recently-played first, one click from resuming. Filter tabs (All /
In progress / Finished / Not started) narrow the grid below. Each book remembers
its own **playback speed**, and resuming after a pause **rewinds a few seconds**
(more the longer you were away) so you don't lose the thread.

The **Skip** dropdown in the player sets how far the ↺/↻ buttons and the plain
`←`/`→` keys jump — 10/15/30/45/60s, 30 by default. The buttons' labels update to
match, and it's remembered across restarts. `Shift`+`←`/`→` is a separate, fixed
5-minute jump either way.

Finished status is normally automatic — a book counts as finished once you're
within 30 seconds of the end — but the book view has a **Mark as finished / Mark
as not finished** button for the two cases that can't detect on their own: a book
you finished elsewhere (no listening position recorded here at all), or one you
gave up on that's sitting at 99% and cluttering "In progress." The button always
wins over the automatic guess until you toggle it again or use **Reset progress**,
which clears the override along with everything else.

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

### "NEW" badge

Books added since you last opened Tomelight get a small **NEW** pill on their
cover, Spotify/Netflix-style — useful for a library that keeps growing. It
clears the next time you open the app, not the moment you glance at it, so it
doesn't disappear before you've actually had a chance to notice it. A brand new
install doesn't retroactively badge your whole library. With **Group series**
on, a series tile shows NEW too if any volume inside it is new — otherwise a
newly added volume of a series you already own would be invisible behind the
tile.

## Bookmarks

Press `B` or the 🔖 button in the player to drop a bookmark at the current spot;
its label defaults to the current chapter. Bookmarks appear in the book's detail
view, where you can rename them, add a note, jump back with one click, or delete
them. Every manual pause also drops a single rolling **"Last stop"** marker so you
can always find where you set the book down — editing it makes it permanent.
Bookmarks are stored in `bookmarks.json` in the data folder.

Deleting one doesn't ask first — it shows a brief **Undo** toast instead, since a
delete you didn't mean is a one-click fix rather than something worth interrupting
you to confirm. The same applies to **Reset progress** in the book view. Undo
restores the exact bookmark or the exact position/speed you had, not an
approximation.

## Skip silence

The ⏩ button (or `S`) shortens the dead air in a book. The audio is routed
through a Web Audio `AnalyserNode`; when it detects a *sustained* quiet gap
(≈0.2s, so natural between-word pauses are left alone) it briefly raises the
playback rate so the gap passes quickly, then snaps back to your speed the
instant speech returns — no hard cut. It stacks on your per-book speed (capped so
playback stays intelligible) and keeps working while the app is in the
background. On a long book with lots of pauses this reclaims a meaningful chunk
of time.

## Theme

Follows the OS light/dark preference until you choose otherwise. The ☀/☾ button
in the top bar toggles between light and dark; once you click it, that choice is
remembered (`localStorage`) and applied before the window paints, so there's no
flash of the wrong theme on launch. To go back to following the system, clear it:
`localStorage.removeItem('theme')` in DevTools, or delete `Local Storage` under
the app's data folder.

## Volume normalization

Books ripped from different sources sit at wildly different levels (~7 dB spread
across the test library), so switching books used to mean reaching for the volume
slider. The ⚖ button (on by default; `N` toggles) evens this out: the first time a
book plays, its gated loudness is measured over ~30 seconds and a gain is computed
to bring it to a common level, stored in `normalization.json` and applied
instantly on every later play. The gain is clamped and peak-limited so boosting a
quiet book never clips.

The audio runs through a small Web Audio graph
(`source → analyser → normalize gain → volume gain → output`). Putting the
analyser first means loudness is measured at full scale regardless of your volume
setting; putting volume in the graph (rather than on the element) means the
measurement — and skip-silence — are unaffected by where you set the slider.

## Sleep timer

The moon control in the player bar stops playback after a set time — a fixed
duration (5–60 min), at the **end of the current chapter**, or at the **end of
the book**. The volume fades gently over the last 20 seconds rather than cutting
out. If you fall asleep, resuming rewinds 30 seconds so you don't lose your place,
and **+5 minutes** extends (or restarts) the timer and picks playback back up.
The duration countdown only runs while audio is playing, so pausing pauses it too.
