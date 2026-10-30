'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { sanitizeTaskbarState, taskbarBounds, createTaskbarLyrics } = require('../lib/taskbar-lyrics.cjs');

const primary = (width = 1440) => ({ bounds: { x: 0, y: 0, width, height: 960 }, workArea: { x: 0, y: 0, width, height: 912 }, scaleFactor: 1.5 });
function harness(options = {}) {
  const windows = [];
  class Window extends EventEmitter {
    constructor(settings) {
      super(); this.settings = settings; this.visible = false; this.destroyed = false; this.messages = []; this.actions = [];
      this.webContents = new EventEmitter();
      this.webContents.send = (...args) => this.messages.push(args);
      this.webContents.setWindowOpenHandler = handler => { this.openHandler = handler; };
      windows.push(this);
    }
    removeMenu() {}
    isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; }
    setBounds(value) { this.bounds = value; }
    setIgnoreMouseEvents(value) { this.ignoresMouse = value; }
    setAlwaysOnTop(...args) { this.alwaysOnTop = args; }
    loadFile(file) { this.file = file; return Promise.resolve(); }
    showInactive() { this.visible = true; this.actions.push('showInactive'); }
    hide() { this.visible = false; this.actions.push('hide'); }
    destroy() { this.destroyed = true; this.visible = false; this.emit('closed'); }
  }
  const screen = new EventEmitter(); let display = options.display || primary();
  screen.getPrimaryDisplay = () => display;
  const controller = createTaskbarLyrics({ BrowserWindow: Window, screen, uiFile: path.join(__dirname, '..', 'ui', 'taskbar-lyrics.html'), preload: 'taskbar-preload.cjs', platform: 'win32', ...options });
  return { controller, screen, windows, changeDisplay(value) { display = value; screen.emit('display-metrics-changed', display, ['workArea']); }, loaded() { windows.at(-1).webContents.emit('did-finish-load'); } };
}

test('taskbar uses DIP display/work-area bounds on scaled and negative-coordinate monitors', () => {
  const display = primary();
  assert.deepEqual(taskbarBounds(display), { placement: 'bottom', bounds: { x: 36, y: 917, width: 360, height: 38 } });
  display.bounds.x = -1440; display.bounds.y = -960; display.workArea.x = -1440; display.workArea.y = -960;
  assert.deepEqual(taskbarBounds(display).bounds, { x: -1404, y: -43, width: 360, height: 38 });
  assert.equal(taskbarBounds(primary(920)).bounds.width, 244);
  assert.equal(taskbarBounds(primary(700)).bounds.width, 134);
  assert.equal(taskbarBounds(primary(600)).placement, 'insufficient-space');
});

test('auto-hidden and non-bottom taskbars leave no lyric floating over content', () => {
  const display = primary();
  display.workArea.height = 960;
  assert.equal(taskbarBounds(display).placement, 'auto-hidden');
  display.workArea.height = 958;
  assert.equal(taskbarBounds(display).bounds, null);
  display.workArea = { x: 48, y: 0, width: 1392, height: 960 };
  assert.equal(taskbarBounds(display).placement, 'unsupported-position');
  display.workArea = { x: 0, y: 48, width: 1440, height: 912 };
  assert.equal(taskbarBounds(display).placement, 'unsupported-position');
  assert.equal(taskbarBounds({}).placement, 'unavailable');
});

test('taskbar state clamps untrusted strings and accepts only real boolean flags', () => {
  const state = sanitizeTaskbarState({ text: '  第一行\n第二行\u0000\u202e  ', title: '😀'.repeat(150), artist: '<img src=x>', playing: 'false', enabled: 'true', visible: 1, theme: 'unsafe', secret: 'hidden' });
  assert.equal(state.text, '第一行 第二行');
  assert.equal([...state.title].length, 120);
  assert.equal(state.artist, '<img src=x>');
  assert.equal(state.playing, false); assert.equal(state.enabled, true); assert.equal(state.visible, false); assert.equal(state.theme, 'system');
  assert.equal(Object.hasOwn(state, 'secret'), false);
  assert.deepEqual(sanitizeTaskbarState({ playing: true }, state), { ...state, playing: true });
  assert.equal(sanitizeTaskbarState({ kind: 'lyric' }, state).kind, 'lyric');
  assert.equal(sanitizeTaskbarState({ kind: 'untrusted' }, state).kind, 'idle');
});

test('display-only window never takes focus or intercepts taskbar mouse input', () => {
  const h = harness(); const window = h.windows[0];
  assert.equal(window.settings.focusable, false); assert.equal(window.settings.skipTaskbar, true); assert.equal(window.settings.transparent, true);
  assert.equal(window.settings.show, false); assert.equal(window.settings.webPreferences.nodeIntegration, false); assert.equal(window.settings.webPreferences.sandbox, true);
  assert.equal(window.settings.webPreferences.backgroundThrottling, false);
  assert.equal(window.ignoresMouse, true);
  assert.deepEqual(window.alwaysOnTop, [false]);
  assert.deepEqual(window.openHandler({ url: 'https://example.org' }), { action: 'deny' });
  let prevented = false;
  window.webContents.emit('will-navigate', { preventDefault() { prevented = true; } }, 'https://example.org');
  assert.equal(prevented, true);
  h.controller.update({ text: '第一句', title: '歌曲', visible: true, playing: true });
  assert.equal(window.isVisible(), false, 'wait until the HTML is ready');
  h.loaded();
  assert.equal(window.isVisible(), true);
  assert.deepEqual(window.alwaysOnTop, [true, 'pop-up-menu']);
  assert.deepEqual(window.actions, ['showInactive']);
  assert.equal(window.messages.at(-1)[1].text, '第一句');
  assert.equal(h.controller.owns(window.webContents), true);
  assert.equal(h.controller.owns({}), false);
  h.controller.dispose();
});

test('word timing crosses IPC intact and invalid or mismatched words are discarded', () => {
  const words = [{ text: '没有爱过你 ', start: 25.5, end: 27 }, { text: '我最爱是自己', start: 27.5, end: 31 }];
  const value = { text: '没有爱过你 我最爱是自己', kind: 'lyric', position: 28.1, sampledAt: 1791700000000, rate: 1, lineStart: 25, lineEnd: 32, words };
  assert.deepEqual(sanitizeTaskbarState(value).words, words);
  const spacedWords = [{ text: ' 没有爱过你 ', start: 25.5, end: 27 }, { text: '我最爱是自己 ', start: 27.5, end: 31 }];
  const spaced = sanitizeTaskbarState({ ...value, text: ' 没有爱过你 我最爱是自己 ', words: spacedWords });
  assert.equal(spaced.text, ' 没有爱过你 我最爱是自己 ');
  assert.deepEqual(spaced.words, spacedWords);
  assert.equal(sanitizeTaskbarState(value).position, 28.1);
  assert.equal(sanitizeTaskbarState(value).sampledAt, value.sampledAt);
  assert.deepEqual(sanitizeTaskbarState({ enabled: false }, sanitizeTaskbarState(value)).words, words);
  assert.deepEqual(sanitizeTaskbarState({ ...value, words: [{ text: value.text, start: 24, end: 31 }] }).words, []);
  assert.deepEqual(sanitizeTaskbarState({ ...value, words: [{ text: '错版本', start: 25, end: 31 }] }).words, []);
  assert.deepEqual(sanitizeTaskbarState({ ...value, words: [{ text: value.text, start: 25, end: Infinity }] }).words, []);
  const invalid = sanitizeTaskbarState({ position: NaN, sampledAt: 'now', rate: -1, lineStart: -1, lineEnd: Infinity });
  assert.equal(invalid.position, 0); assert.equal(invalid.sampledAt, 0); assert.equal(invalid.rate, 0); assert.equal(invalid.lineStart, 0); assert.equal(invalid.lineEnd, 0);
});

test('transparent lyric colors follow Windows taskbar theme independently from app mode', () => {
  const nativeTheme = new EventEmitter(); nativeTheme.shouldUseDarkColorsForSystemIntegratedUI = true;
  const h = harness({ nativeTheme }); h.loaded();
  h.controller.update({ text: '第一句', kind: 'lyric', visible: true, theme: 'light' });
  assert.equal(h.controller.state().theme, 'dark');
  nativeTheme.shouldUseDarkColorsForSystemIntegratedUI = false; nativeTheme.emit('updated');
  assert.equal(h.windows[0].messages.at(-1)[1].theme, 'light');
  h.controller.update({ theme: 'dark' }); assert.equal(h.controller.state().theme, 'light');
  h.controller.dispose(); assert.equal(nativeTheme.listenerCount('updated'), 0);
});

test('system setting overrides an inaccurate native theme and updates asynchronously', async () => {
  const nativeTheme = new EventEmitter(); nativeTheme.shouldUseDarkColorsForSystemIntegratedUI = false;
  let system = 'dark';
  const h = harness({ nativeTheme, systemTheme: () => system }); h.loaded();
  await new Promise(resolve => setImmediate(resolve));
  h.controller.update({ text: '第一句', kind: 'lyric', visible: true, theme: 'light' });
  assert.equal(h.controller.state().theme, 'dark');
  system = 'light'; nativeTheme.emit('updated'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.controller.state().theme, 'light');
  h.controller.dispose();
});

test('toggle, empty-state and display changes hide and restore the same taskbar window', () => {
  const h = harness(); h.loaded();
  h.controller.update({ text: '第一句', visible: true });
  assert.equal(h.controller.status().visible, true);
  h.controller.setEnabled(false); assert.equal(h.controller.status().visible, false);
  h.controller.setEnabled(true); assert.equal(h.controller.status().visible, true);
  const autoHidden = primary(); autoHidden.workArea.height = 960;
  h.changeDisplay(autoHidden);
  assert.equal(h.controller.status().placement, 'auto-hidden'); assert.equal(h.controller.status().visible, false);
  h.changeDisplay(primary()); assert.equal(h.controller.status().visible, true);
  h.controller.update({ visible: false }); assert.equal(h.controller.status().visible, false);
  h.controller.update({ text: '', title: '', visible: true }); assert.equal(h.controller.status().eligible, false);
  assert.equal(h.windows.length, 1);
  assert.throws(() => h.controller.setEnabled('false'), /开关无效/);
  h.controller.dispose();
});

test('isolated verification creates an inspectable window without ever covering the desktop', () => {
  const h = harness({ hiddenForTest: true }); h.loaded();
  h.controller.update({ text: '第一句', visible: true });
  assert.equal(h.controller.status().eligible, true); assert.equal(h.controller.status().visible, false);
  assert.deepEqual(h.windows[0].actions, []);
  assert.equal(h.windows[0].messages.at(-1)[1].text, '第一句');
  h.controller.dispose();
});

test('disposing destroys the taskbar and removes screen listeners', () => {
  const h = harness();
  assert.equal(h.screen.listenerCount('display-metrics-changed'), 1);
  h.controller.dispose(); h.controller.dispose();
  assert.equal(h.windows[0].isDestroyed(), true);
  assert.equal(h.screen.listenerCount('display-metrics-changed'), 0);
  h.controller.update({ text: '不能复活', visible: true });
  assert.equal(h.windows.length, 1);
});

test('unsupported platforms never create a Windows taskbar window', () => {
  const h = harness({ platform: 'linux' });
  h.controller.update({ text: '第一句', visible: true });
  assert.equal(h.windows.length, 0); assert.equal(h.controller.status().supported, false); assert.equal(h.controller.status().eligible, false);
  h.controller.dispose();
});

function monitoredHarness() {
  const monitors = [];
  const h = harness({ fullscreenMonitor({ onChange }) {
    const monitor = { starts: 0, disposed: false, sample: onChange,
      start() { this.starts++; }, dispose() { this.disposed = true; } };
    monitors.push(monitor);
    return monitor;
  } });
  return { ...h, monitors };
}

test('fullscreen hides lyrics and releases topmost, then restores the current line without taking focus', () => {
  const h = monitoredHarness(); h.loaded();
  h.controller.update({ text: '当前句', kind: 'lyric', visible: true, enabled: true });
  const window = h.windows[0], monitor = h.monitors[0];
  assert.equal(h.controller.status().suppressionReason, 'checking');
  assert.equal(window.isVisible(), false);
  monitor.sample(false);
  assert.equal(window.isVisible(), true);
  monitor.sample(true);
  assert.equal(h.controller.status().suppressionReason, 'fullscreen');
  assert.equal(window.isVisible(), false);
  assert.deepEqual(window.alwaysOnTop, [false]);
  h.controller.update({ text: '下一句', position: 38 });
  assert.equal(window.isVisible(), false);
  assert.equal(h.monitors.length, 1, 'Transport updates must not restart native detection');
  monitor.sample(false);
  assert.equal(window.isVisible(), true);
  assert.equal(h.controller.state().text, '下一句');
  assert.equal(h.controller.state().position, 38);
  assert.deepEqual(window.actions, ['showInactive', 'hide', 'showInactive']);
  assert.deepEqual(window.alwaysOnTop, [true, 'pop-up-menu']);
  h.controller.dispose();
  assert.equal(monitor.disposed, true);
});

test('fullscreen exit cannot undo the user switch, and stale detector callbacks cannot restore lyrics', () => {
  const h = monitoredHarness(); h.loaded();
  h.controller.update({ text: '当前句', visible: true });
  const old = h.monitors[0]; old.sample(false); old.sample(true);
  h.controller.setEnabled(false);
  assert.equal(old.disposed, true);
  old.sample(false);
  assert.equal(h.controller.status().enabled, false);
  assert.equal(h.controller.status().visible, false);
  h.controller.setEnabled(true);
  const fresh = h.monitors[1];
  old.sample(false);
  assert.equal(h.controller.status().suppressionReason, 'checking');
  fresh.sample(false);
  assert.equal(h.controller.status().visible, true);
  fresh.sample(null);
  assert.equal(h.controller.status().suppressionReason, 'checking');
  assert.equal(h.controller.status().visible, false);
  fresh.sample(false);
  assert.equal(h.controller.status().visible, true);
  h.controller.dispose();
  fresh.sample(false);
  assert.equal(h.windows[0].isDestroyed(), true);
});

test('native monitoring runs only while a lyric is requested in a supported taskbar', () => {
  const h = monitoredHarness(); h.loaded();
  assert.equal(h.monitors.length, 0);
  h.controller.update({ text: '当前句', visible: true });
  const old = h.monitors[0]; old.sample(false);
  const autoHidden = primary(); autoHidden.workArea.height = 960;
  h.changeDisplay(autoHidden);
  assert.equal(old.disposed, true);
  assert.equal(h.controller.status().visible, false);
  h.changeDisplay(primary());
  assert.equal(h.monitors.length, 2);
  h.monitors[1].sample(false);
  h.controller.update({ visible: false });
  assert.equal(h.monitors[1].disposed, true);
  assert.equal(h.controller.status().visible, false);
  assert.deepEqual(h.windows[0].alwaysOnTop, [false]);
  h.controller.dispose();
});
