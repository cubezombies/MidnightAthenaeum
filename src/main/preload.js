'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('library:getState'),
  addFolder: () => ipcRenderer.invoke('library:addFolder'),
  removeFolder: (folder) => ipcRenderer.invoke('library:removeFolder', folder),
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
});
