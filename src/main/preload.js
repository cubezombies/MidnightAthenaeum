'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Mirrors FINISHED_TAIL_SECONDS/isFinishedByPosition in src/main/finished.js.
// Can't require('./finished') here: this preload runs sandboxed
// (webPreferences sandbox: true), and a sandboxed preload's require() only
// resolves a small built-in whitelist, not local project files — attempting
// it throws "module not found" and silently kills the whole preload script,
// which is a much worse failure than a duplicated constant (window.api ends
// up undefined, breaking every IPC call the app makes). If this threshold
// ever changes, update both copies.
function isFinishedByPosition(position, duration) {
  return duration ? position >= duration - 30 : false;
}

contextBridge.exposeInMainWorld('api', {
  isFinishedByPosition,

  getState: () => ipcRenderer.invoke('library:getState'),
  addFolder: () => ipcRenderer.invoke('library:addFolder'),
  addFolderPaths: (paths) => ipcRenderer.invoke('library:addFolderPaths', paths),
  removeFolder: (folder) => ipcRenderer.invoke('library:removeFolder', folder),
  // File.path was removed from the renderer for security; this is the current
  // replacement, needed to resolve a drag-and-dropped folder's real path.
  getPathForFile: (file) => webUtils.getPathForFile(file),
  rescan: () => ipcRenderer.invoke('library:rescan'),
  ensureBookDetail: (bookId) => ipcRenderer.invoke('library:ensureBookDetail', bookId),
  saveProgress: (payload) => ipcRenderer.invoke('progress:save', payload),
  clearProgress: (bookId) => ipcRenderer.invoke('progress:clear', bookId),
  setFinished: (payload) => ipcRenderer.invoke('progress:setFinished', payload),
  addBookmark: (payload) => ipcRenderer.invoke('bookmarks:add', payload),
  updateBookmark: (payload) => ipcRenderer.invoke('bookmarks:update', payload),
  removeBookmark: (payload) => ipcRenderer.invoke('bookmarks:remove', payload),
  restoreBookmark: (payload) => ipcRenderer.invoke('bookmarks:restore', payload),
  saveNormalization: (payload) => ipcRenderer.invoke('normalization:save', payload),
  revealDataFolder: () => ipcRenderer.invoke('app:revealDataFolder'),
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),
  searchMetadata: (query) => ipcRenderer.invoke('metadata:search', query),
  previewMetadata: (key) => ipcRenderer.invoke('metadata:preview', key),
  applyMetadata: (payload) => ipcRenderer.invoke('metadata:apply', payload),
  clearMetadata: (bookId) => ipcRenderer.invoke('metadata:clear', bookId),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  getInitialOpenBook: () => ipcRenderer.invoke('app:getInitialOpenBook'),
  setPlayingState: (isPlaying) => ipcRenderer.invoke('player:setPlayingState', isPlaying),
  setDiscordPresenceEnabled: (enabled) => ipcRenderer.invoke('discord:setEnabled', enabled),
  updateDiscordActivity: (info) => ipcRenderer.invoke('discord:updateActivity', info),
  startTranscription: (bookId) => ipcRenderer.invoke('transcribe:start', bookId),
  cancelTranscription: (bookId) => ipcRenderer.invoke('transcribe:cancel', bookId),
  getTranscribeStatus: (bookId) => ipcRenderer.invoke('transcribe:getStatus', bookId),
  getTranscript: (bookId) => ipcRenderer.invoke('transcript:get', bookId),
  deleteTranscript: (bookId) => ipcRenderer.invoke('transcript:delete', bookId),
  findDuplicates: () => ipcRenderer.invoke('duplicates:find'),
  removeDuplicateBook: (bookId) => ipcRenderer.invoke('duplicates:remove', bookId),
  planReorganize: () => ipcRenderer.invoke('reorganize:plan'),
  executeReorganize: () => ipcRenderer.invoke('reorganize:execute'),
  cancelReorganize: () => ipcRenderer.invoke('reorganize:cancel'),
  undoReorganize: () => ipcRenderer.invoke('reorganize:undo'),
  hasReorganizeUndo: () => ipcRenderer.invoke('reorganize:hasUndo'),
  findEbookPairing: (bookId) => ipcRenderer.invoke('ebook:findPairing', bookId),
  setEbookPairing: (payload) => ipcRenderer.invoke('ebook:setPairing', payload),
  pickEbookFile: () => ipcRenderer.invoke('ebook:pickFile'),
  getEbookToc: (bookId) => ipcRenderer.invoke('ebook:getToc', bookId),
  getEbookSpineHtml: (payload) => ipcRenderer.invoke('ebook:getSpineHtml', payload),

  onLibraryChanged: (cb) => {
    const listener = (_event, state) => cb(state);
    ipcRenderer.on('library:changed', listener);
    return () => ipcRenderer.off('library:changed', listener);
  },
  onBooksUpdated: (cb) => {
    const listener = (_event, books) => cb(books);
    ipcRenderer.on('library:booksUpdated', listener);
    return () => ipcRenderer.off('library:booksUpdated', listener);
  },
  onDetailProgress: (cb) => {
    const listener = (_event, payload) => cb(payload);
    ipcRenderer.on('library:detailProgress', listener);
    return () => ipcRenderer.off('library:detailProgress', listener);
  },
  onPairingProgress: (cb) => {
    const listener = (_event, payload) => cb(payload);
    ipcRenderer.on('library:pairingProgress', listener);
    return () => ipcRenderer.off('library:pairingProgress', listener);
  },
  onThumbnailProgress: (cb) => {
    const listener = (_event, payload) => cb(payload);
    ipcRenderer.on('library:thumbnailProgress', listener);
    return () => ipcRenderer.off('library:thumbnailProgress', listener);
  },
  onScanProgress: (cb) => {
    const listener = (_event, payload) => cb(payload);
    ipcRenderer.on('library:scan-progress', listener);
    return () => ipcRenderer.off('library:scan-progress', listener);
  },
  onUpdateStatus: (cb) => {
    const listener = (_event, status) => cb(status);
    ipcRenderer.on('update:status', listener);
    return () => ipcRenderer.off('update:status', listener);
  },
  onOpenUpdates: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('updates:open', listener);
    return () => ipcRenderer.off('updates:open', listener);
  },
  onMediaControl: (cb) => {
    const listener = (_event, action) => cb(action);
    ipcRenderer.on('media:control', listener);
    return () => ipcRenderer.off('media:control', listener);
  },
  onOpenBook: (cb) => {
    const listener = (_event, bookId) => cb(bookId);
    ipcRenderer.on('player:openBook', listener);
    return () => ipcRenderer.off('player:openBook', listener);
  },
  onTranscribeProgress: (cb) => {
    const listener = (_event, info) => cb(info);
    ipcRenderer.on('transcribe:progress', listener);
    return () => ipcRenderer.off('transcribe:progress', listener);
  },
  onOpenDuplicates: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('duplicates:open', listener);
    return () => ipcRenderer.off('duplicates:open', listener);
  },
  onOpenReorganize: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('reorganize:open', listener);
    return () => ipcRenderer.off('reorganize:open', listener);
  },
  onReorganizeUndoRequested: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('reorganize:undo-requested', listener);
    return () => ipcRenderer.off('reorganize:undo-requested', listener);
  },
  onReorganizeProgress: (cb) => {
    const listener = (_event, info) => cb(info);
    ipcRenderer.on('reorganize:progress', listener);
    return () => ipcRenderer.off('reorganize:progress', listener);
  },
});
