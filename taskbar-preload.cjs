'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// This display-only window deliberately has no account, audio, store or window API.
contextBridge.exposeInMainWorld('taskbarLyrics', Object.freeze({
  getState: () => ipcRenderer.invoke('taskbar-lyrics:get-state'),
  onState: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('taskbar-lyrics:state', listener);
    return () => ipcRenderer.removeListener('taskbar-lyrics:state', listener);
  },
}));
