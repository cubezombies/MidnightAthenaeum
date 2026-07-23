'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

// The standard per-user app-data location (%APPDATA%\Midnight Athenaeum on
// Windows) — every real install starts here empty; a user adds their own
// library folder on first launch. `MIDNIGHT_ATHENAEUM_DATA_ROOT` overrides
// this for local dev (this developer's own machine points it at a D: drive),
// but that must never be the *default* baked into the shipped app: it's this
// machine's convention, not a real user's, and a plain install can't assume
// a D: drive even exists.
const OS_DEFAULT_ROOT = path.join(app.getPath('appData'), 'Midnight Athenaeum');

// A user-chosen data location (File > Change library location…) is recorded
// here — deliberately *always* at the OS default, never at the location it
// points to, so there's one fixed place to find "where did the user put
// their data" no matter where that turns out to be. This is what
// changeDataLocation() in main.js writes.
const LOCATION_FILE = path.join(OS_DEFAULT_ROOT, 'location.json');

function readPersistedLocation() {
  try {
    const parsed = JSON.parse(fs.readFileSync(LOCATION_FILE, 'utf8'));
    return typeof parsed.dataRoot === 'string' && parsed.dataRoot ? parsed.dataRoot : null;
  } catch {
    return null;
  }
}

/** Persist a user-chosen data location. Takes effect on next launch — paths below are computed once at startup. */
function setDataLocation(newRoot) {
  fs.mkdirSync(path.dirname(LOCATION_FILE), { recursive: true });
  fs.writeFileSync(LOCATION_FILE, JSON.stringify({ dataRoot: newRoot }, null, 2), 'utf8');
}

/** Back to the OS default — used if the user picks "Reset to default location". */
function clearDataLocation() {
  try {
    fs.rmSync(LOCATION_FILE, { force: true });
  } catch {
    // Best effort — worst case the old override just gets picked up again next launch.
  }
}

const DATA_ROOT = process.env.MIDNIGHT_ATHENAEUM_DATA_ROOT || readPersistedLocation() || OS_DEFAULT_ROOT;

module.exports = {
  DATA_ROOT,
  OS_DEFAULT_ROOT,
  setDataLocation,
  clearDataLocation,
  USER_DATA: path.join(DATA_ROOT, 'userData'),
  COVER_CACHE: path.join(DATA_ROOT, 'covers'),
  // Covers fetched from the online metadata lookup, kept separate from
  // extracted-from-file covers so the two provenances aren't muddled on disk.
  ONLINE_COVER_CACHE: path.join(DATA_ROOT, 'covers-online'),
  LIBRARY_FILE: path.join(DATA_ROOT, 'library.json'),
  PROGRESS_FILE: path.join(DATA_ROOT, 'progress.json'),
  BOOKMARKS_FILE: path.join(DATA_ROOT, 'bookmarks.json'),
  NORMALIZATION_FILE: path.join(DATA_ROOT, 'normalization.json'),
  METADATA_FILE: path.join(DATA_ROOT, 'metadata-overrides.json'),
  // Per-book timestamped transcripts (opt-in, local Whisper transcription).
  TRANSCRIPTS_DIR: path.join(DATA_ROOT, 'transcripts'),
  // The downloaded ggml model file(s) — large (100MB+), kept out of backups
  // and re-downloadable, so it lives alongside rather than inside the other
  // small JSON stores.
  WHISPER_MODEL_DIR: path.join(DATA_ROOT, 'whisper-models'),
  // Default location backups are offered/looked for. A sibling of DATA_ROOT
  // (not inside it) on purpose: deleting or corrupting the live data folder
  // must not take the backups down with it.
  BACKUP_DIR: path.join(path.dirname(DATA_ROOT), 'Midnight Athenaeum Backups'),
};
