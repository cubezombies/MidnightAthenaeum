'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');
const { isFinishedByPosition } = require('./finished');

contextBridge.exposeInMainWorld('api', {
  // Pure/sync — lets the renderer compute the same "finished" value main.js
  // will persist, without duplicating the threshold constant on both sides.
  isFinishedByPosition,

  getState: () => ipcRenderer.invoke('library:getState'),
  addFolder: () => ipcRenderer.invoke('library:addFolder'),
  addFolderPaths: (paths) => ipcRenderer.invoke('library:addFolderPaths', paths),
  removeFolder: (folder) => ipcRenderer.invoke('library:removeFolder', folder),
  // File.path was removed from the renderer for security; this is the current
  // replacement, needed to resolve a drag-and-dropped folder's real path.
  getPathForFile: (file) => webUtils.getPathForFile(file),
  rescan: () => ipcRenderer.invoke('library:rescan'),
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

  onLibraryChanged: (cb) => {
    const listener = (_event, state) => cb(state);
    ipcRenderer.on('library:changed', listener);
    return () => ipcRenderer.off('library:changed', listener);
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
});
