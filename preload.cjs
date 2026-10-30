const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('music', Object.freeze({
  invoke: (method, params = {}) => ipcRenderer.invoke('music:api', method, params),
  window: (action) => ipcRenderer.invoke('music:window', action),
  onEvent: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('music:event', listener);
    return () => ipcRenderer.removeListener('music:event', listener);
  },
  local: Object.freeze({
    import: () => ipcRenderer.invoke('music:local-import'),
    list: () => ipcRenderer.invoke('music:local-list'),
    lyrics: (id) => ipcRenderer.invoke('music:local-lyrics', id),
  }),
  taskbarLyrics: Object.freeze({
    update: (payload) => ipcRenderer.invoke('music:taskbar-lyrics', 'update', payload),
    setEnabled: (enabled) => ipcRenderer.invoke('music:taskbar-lyrics', 'enabled', enabled),
    status: () => ipcRenderer.invoke('music:taskbar-lyrics', 'status'),
  }),
  sleepTimer: Object.freeze({
    set: (options) => ipcRenderer.invoke('music:sleep-timer', 'set', options),
    cancel: () => ipcRenderer.invoke('music:sleep-timer', 'cancel'),
    status: () => ipcRenderer.invoke('music:sleep-timer', 'status'),
    trackEnded: () => ipcRenderer.invoke('music:sleep-timer', 'track-ended'),
  }),
  store: Object.freeze({
    get: () => ipcRenderer.invoke('music:store-get'),
    set: (data) => ipcRenderer.invoke('music:store-set', data),
  }),
  mpv: Object.freeze({
    status: () => ipcRenderer.invoke('music:mpv-status'),
    send: (action, params) => ipcRenderer.invoke('music:mpv', action, params),
  }),
  openOfficial: () => ipcRenderer.invoke('music:official'),
}));
