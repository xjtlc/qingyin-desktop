'use strict';

const { pathToFileURL } = require('node:url');

function cleanText(value, limit) {
  if (typeof value !== 'string') return '';
  return [...value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim()].slice(0, limit).join('');
}

function cleanLyricText(value, limit) {
  if (typeof value !== 'string') return '';
  return [...value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ')].slice(0, limit).join('');
}

function sanitizeTaskbarState(payload = {}, previous = {}) {
  const input = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const text = (name, length) => Object.hasOwn(input, name) ? cleanText(input[name], length) : cleanText(previous[name], length);
  const flag = (name, fallback = false) => typeof input[name] === 'boolean' ? input[name] : (typeof previous[name] === 'boolean' ? previous[name] : fallback);
  const theme = ['light', 'dark', 'system'].includes(input.theme) ? input.theme : (['light', 'dark', 'system'].includes(previous.theme) ? previous.theme : 'system');
  const kinds = ['idle', 'loading', 'error', 'prelude', 'lyric', 'plain', 'empty'];
  const kind = kinds.includes(input.kind) ? input.kind : (kinds.includes(previous.kind) ? previous.kind : 'idle');
  const number = (name, maximum, fallback = 0) => {
    const value = Object.hasOwn(input, name) ? input[name] : previous[name];
    return typeof value === 'number' && Number.isFinite(value) ? Math.min(maximum, Math.max(0, value)) : fallback;
  };
  const lineText = kind === 'lyric' ? cleanLyricText(Object.hasOwn(input, 'text') ? input.text : previous.text, 512) : text('text', 512);
  const lineStart = number('lineStart', 86400), lineEnd = Math.max(lineStart, number('lineEnd', 86400));
  const sourceWords = Object.hasOwn(input, 'words') ? input.words : previous.words;
  let words = [];
  if (Array.isArray(sourceWords) && sourceWords.length <= 256) {
    words = sourceWords.map(word => {
      if (!word || typeof word.text !== 'string' || [...word.text].length > 64 || !Number.isFinite(word.start) || !Number.isFinite(word.end) || word.start < lineStart || word.end < word.start || word.end > lineEnd) return null;
      return { text: word.text.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' '), start: word.start, end: word.end };
    });
    if (words.some(word => !word) || words.map(word => word.text).join('') !== lineText || words.some((word, index) => index > 0 && word.start < words[index - 1].start)) words = [];
  }
  return { text: lineText, title: text('title', 120), artist: text('artist', 120), playing: flag('playing'), enabled: flag('enabled', true), visible: flag('visible'), theme, kind,
    position: number('position', 86400), sampledAt: number('sampledAt', Number.MAX_SAFE_INTEGER), rate: number('rate', 4, 1), lineStart, lineEnd, words };
}

// Electron's display rectangles are already in device-independent pixels. Multiplying
// by scaleFactor here would put the strip on the wrong monitor at 125% / 150% scaling.
function taskbarBounds(display) {
  const b = display?.bounds, w = display?.workArea;
  if (!b || !w || ![b.x, b.y, b.width, b.height, w.x, w.y, w.width, w.height].every(Number.isFinite) || b.width <= 0 || b.height <= 0) return { placement: 'unavailable', bounds: null };
  const bottom = b.y + b.height - (w.y + w.height);
  const top = w.y - b.y, left = w.x - b.x, right = b.x + b.width - (w.x + w.width);
  // A full work area (or a 1-2px edge) means an auto-hidden taskbar. Do not leave a
  // floating lyric over another application's content when the taskbar is absent.
  if (bottom < 8) return { placement: Math.max(top, left, right) >= 8 ? 'unsupported-position' : 'auto-hidden', bounds: null };
  if (bottom > 120 || Math.max(top, left, right) >= 8) return { placement: 'unsupported-position', bounds: null };
  const offset = 36;
  // Start near the taskbar's left edge and shorten on narrow displays so that
  // the strip does not cover the usual centered Start/search/app-button area.
  const width = Math.floor(Math.min(360, b.width / 2 - 180 - offset));
  if (width < 100) return { placement: 'insufficient-space', bounds: null };
  const height = Math.floor(Math.min(38, bottom));
  return { placement: 'bottom', bounds: { x: Math.round(b.x + offset), y: Math.round(w.y + w.height + (bottom - height) / 2), width, height } };
}

function createTaskbarLyrics({ BrowserWindow, screen, nativeTheme, systemTheme, fullscreenMonitor, uiFile, preload, hiddenForTest = false, platform = process.platform }) {
  let state = sanitizeTaskbarState();
  let window = null, ready = false, disposed = false, appliedBounds = '';
  let resolvedTheme = null, themeRevision = 0;
  let monitor = null, monitorRunning = false, monitorRevision = 0;
  let fullscreenBlocked = null, appliedTopmost = false;
  const trustedURL = pathToFileURL(uiFile).href;
  let location = { placement: platform === 'win32' ? 'unavailable' : 'unsupported-platform', bounds: null };
  const listeners = ['display-added', 'display-removed', 'display-metrics-changed'];
  const isLive = () => window && !window.isDestroyed();
  const requested = () => !disposed && platform === 'win32' && state.enabled && state.visible && Boolean(state.text || state.title) && Boolean(location.bounds);
  const suppressed = () => Boolean(requested() && monitorRunning && fullscreenBlocked !== false);
  const eligible = () => requested() && !suppressed();

  function stopFullscreenMonitor() {
    monitorRunning = false;
    monitorRevision++;
    const previous = monitor;
    monitor = null;
    fullscreenBlocked = null;
    try { previous?.dispose(); } catch { /* The window still hides if native cleanup fails. */ }
  }
  function syncFullscreenMonitor() {
    if (typeof fullscreenMonitor !== 'function' || !requested()) {
      if (monitorRunning) stopFullscreenMonitor();
      return;
    }
    if (monitorRunning) return;
    monitorRunning = true;
    fullscreenBlocked = null;
    const revision = ++monitorRevision;
    try {
      monitor = fullscreenMonitor({ onChange(blocked) {
        if (disposed || !monitorRunning || revision !== monitorRevision) return;
        fullscreenBlocked = typeof blocked === 'boolean' ? blocked : null;
        reconcile();
      } });
      monitor.start();
    } catch {
      // An unknown foreground state must not leave lyrics over a fullscreen app.
      fullscreenBlocked = null;
    }
  }

  function applySystemTheme() {
    if (platform !== 'win32') return;
    if (resolvedTheme) state.theme = resolvedTheme;
    else if (typeof nativeTheme?.shouldUseDarkColorsForSystemIntegratedUI === 'boolean') state.theme = nativeTheme.shouldUseDarkColorsForSystemIntegratedUI ? 'dark' : 'light';
  }
  function refreshSystemTheme() {
    if (platform !== 'win32' || typeof systemTheme !== 'function') return;
    const revision = ++themeRevision;
    Promise.resolve().then(systemTheme).catch(() => null).then(theme => {
      if (disposed || revision !== themeRevision) return;
      resolvedTheme = ['light', 'dark'].includes(theme) ? theme : null;
      applySystemTheme(); sendState();
    });
  }
  function themeUpdated() { refreshSystemTheme(); applySystemTheme(); sendState(); }

  function sendState() {
    if (isLive() && ready) window.webContents.send('taskbar-lyrics:state', state);
  }
  function ensureWindow() {
    if (disposed || platform !== 'win32' || isLive()) return;
    ready = false;
    appliedBounds = '';
    appliedTopmost = false;
    window = new BrowserWindow({
      title: '青音 · 任务栏歌词', width: 360, height: 38, show: false,
      frame: false, transparent: true, backgroundColor: '#00000000',
      focusable: false, skipTaskbar: true, alwaysOnTop: false,
      resizable: false, movable: false, minimizable: false, maximizable: false,
      fullscreenable: false, hasShadow: false, autoHideMenuBar: true,
      webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false, backgroundThrottling: false },
    });
    window.removeMenu();
    window.setIgnoreMouseEvents(true);
    window.setAlwaysOnTop(false);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => { if (url !== trustedURL) event.preventDefault(); });
    window.webContents.on('did-finish-load', () => { ready = true; sendState(); reconcile(); });
    window.on('closed', () => { window = null; ready = false; });
    window.loadFile(uiFile).catch(() => { if (isLive()) window.hide(); });
  }
  function reconcile() {
    if (disposed) return;
    if (platform === 'win32') {
      try { location = taskbarBounds(screen.getPrimaryDisplay()); }
      catch { location = { placement: 'unavailable', bounds: null }; }
    }
    if (state.enabled) ensureWindow();
    syncFullscreenMonitor();
    if (!isLive()) return;
    const boundsKey = JSON.stringify(location.bounds);
    if (location.bounds && appliedBounds !== boundsKey) { window.setBounds(location.bounds, false); appliedBounds = boundsKey; }
    const topmost = Boolean(eligible() && ready);
    if (appliedTopmost !== topmost) {
      if (topmost) window.setAlwaysOnTop(true, 'pop-up-menu');
      else window.setAlwaysOnTop(false);
      appliedTopmost = topmost;
    }
    if (eligible() && ready && !hiddenForTest) {
      if (!window.isVisible()) window.showInactive();
    } else if (window.isVisible()) window.hide();
  }
  function status() {
    return { enabled: state.enabled, visible: Boolean(isLive() && window.isVisible()), eligible: Boolean(eligible()), suppressed: suppressed(), suppressionReason: suppressed() ? (fullscreenBlocked === true ? 'fullscreen' : 'checking') : null, supported: platform === 'win32', placement: location.placement, bounds: location.bounds ? { ...location.bounds } : null };
  }
  for (const event of listeners) screen.on(event, reconcile);
  nativeTheme?.on('updated', themeUpdated);
  applySystemTheme();
  reconcile();
  refreshSystemTheme();
  return {
    update(payload) { state = sanitizeTaskbarState(payload, state); applySystemTheme(); reconcile(); sendState(); return status(); },
    setEnabled(value) { if (typeof value !== 'boolean') throw new Error('歌词开关无效'); return this.update({ enabled: value }); },
    status,
    state: () => ({ ...state, words: state.words.map(word => ({ ...word })) }),
    owns(contents) { return Boolean(isLive() && contents === window.webContents); },
    trustedURL,
    dispose() {
      if (disposed) return;
      disposed = true;
      stopFullscreenMonitor();
      for (const event of listeners) screen.removeListener(event, reconcile);
      nativeTheme?.removeListener('updated', themeUpdated);
      if (isLive()) window.destroy();
      window = null;
    },
  };
}

module.exports = { sanitizeTaskbarState, taskbarBounds, createTaskbarLyrics };
