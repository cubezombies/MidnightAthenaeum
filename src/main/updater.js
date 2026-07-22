'use strict';

/**
 * Wraps electron-updater's autoUpdater. Every check is user-initiated (the
 * Help menu item, or the topbar button in the renderer) — nothing runs on a
 * timer. Status changes are pushed out through whatever sink main.js wires up
 * (normally `webContents.send`), never polled.
 */

const { app } = require('electron');
const { autoUpdater } = require('electron-updater');

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

let statusSink = null;

function setStatusSink(fn) {
  statusSink = fn;
}

function emit(status) {
  statusSink?.(status);
}

/**
 * electron-updater's releaseNotes is a plain string for a normal check, but
 * becomes an array of {version, note} when the check skips over several
 * versions at once (covering everything between the installed and latest
 * version) — flatten that into one block of text either way.
 */
function normalizeReleaseNotes(notes) {
  if (!notes) return '';
  if (typeof notes === 'string') return notes;
  if (Array.isArray(notes)) {
    return notes.map((n) => `${n.version}\n${n.note ?? ''}`).join('\n\n');
  }
  return '';
}

function friendlyError(err) {
  const msg = err?.message || String(err);
  if (/cannot find latest|no published versions/i.test(msg)) return 'No releases found.';
  if (/net::|ENOTFOUND|EAI_AGAIN|ETIMEDOUT/i.test(msg)) return 'No internet connection.';
  return `Update check failed: ${msg}`;
}

autoUpdater.on('checking-for-update', () => emit({ state: 'checking' }));

autoUpdater.on('update-available', (info) => emit({
  state: 'available',
  version: info.version,
  releaseNotes: normalizeReleaseNotes(info.releaseNotes),
}));

autoUpdater.on('update-not-available', () => emit({ state: 'not-available' }));

autoUpdater.on('download-progress', (progress) => emit({
  state: 'downloading',
  percent: Math.round(progress.percent),
}));

autoUpdater.on('update-downloaded', (info) => emit({
  state: 'downloaded',
  version: info.version,
  releaseNotes: normalizeReleaseNotes(info.releaseNotes),
}));

autoUpdater.on('error', (err) => emit({ state: 'error', error: friendlyError(err) }));

async function checkForUpdates() {
  if (!app.isPackaged) {
    emit({ state: 'error', error: 'Update checks only work in an installed build, not this dev copy.' });
    return;
  }
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    emit({ state: 'error', error: friendlyError(err) });
  }
}

function quitAndInstall() {
  autoUpdater.quitAndInstall();
}

module.exports = { setStatusSink, checkForUpdates, quitAndInstall };
