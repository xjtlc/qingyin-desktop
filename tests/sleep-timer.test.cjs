'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSleepTimer } = require('../lib/sleep-timer.cjs');

function harness() {
  let time = 10_000, nextId = 0;
  const timers = new Map(), callbacks = [], events = [];
  const timer = createSleepTimer({
    now: () => time,
    setTimer(callback, delay) { const id = ++nextId; timers.set(id, { callback, at: time + delay }); callbacks.push(callback); return id; },
    clearTimer: id => timers.delete(id),
    onExpire: event => events.push(event),
  });
  return { timer, events, callbacks, timers,
    advance(delay) { time += delay; for (const [id, item] of [...timers]) if (item.at <= time) { timers.delete(id); item.callback(); } },
  };
}

test('15, 30, 60 and custom minute deadlines expire once in the main-process clock', () => {
  for (const minutes of [1, 15, 30, 60, 180]) {
    const h = harness();
    assert.deepEqual(h.timer.set({ mode: 'minutes', minutes }), { ok: true, state: { active: true, mode: 'minutes', minutes, endsAt: 10_000 + minutes * 60_000 } });
    h.advance(minutes * 60_000 - 1);
    assert.equal(h.events.length, 0);
    h.advance(1);
    assert.equal(h.events.length, 1);
    assert.equal(h.events[0].reason, 'timer');
    assert.equal(h.events[0].previousState.minutes, minutes);
    assert.deepEqual(h.timer.status(), { active: false, mode: 'off', minutes: null, endsAt: null });
    h.callbacks[0](); h.advance(60_000);
    assert.equal(h.events.length, 1);
    assert.equal(h.timers.size, 0);
  }
});

test('cancel invalidates even a callback already queued for delivery', () => {
  const h = harness();
  h.timer.set({ mode: 'minutes', minutes: 15 });
  assert.equal(h.timer.cancel().state.active, false);
  h.callbacks[0](); h.advance(900_000);
  assert.equal(h.events.length, 0);
  assert.equal(h.timers.size, 0);
});

test('replacing a deadline never lets the earlier callback stop the replacement', () => {
  const h = harness();
  h.timer.set({ mode: 'minutes', minutes: 15 }); h.advance(60_000);
  h.timer.set({ mode: 'minutes', minutes: 30 });
  h.callbacks[0](); h.advance(899_999);
  assert.equal(h.events.length, 0);
  assert.equal(h.timer.status().minutes, 30);
  assert.equal(h.timers.size, 1);
  h.advance(900_001);
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0].previousState.minutes, 30);
});

test('after-track consumes exactly one natural end and replaces an old deadline', () => {
  const h = harness();
  assert.equal(h.timer.trackEnded().consumed, false);
  h.timer.set({ mode: 'minutes', minutes: 15 });
  assert.deepEqual(h.timer.set({ mode: 'after-track' }).state, { active: true, mode: 'after-track', minutes: null, endsAt: null });
  assert.equal(h.timers.size, 0);
  h.callbacks[0](); h.advance(999_999);
  assert.equal(h.events.length, 0);
  const end = h.timer.trackEnded();
  assert.equal(end.consumed, true);
  assert.equal(end.state.active, false);
  assert.equal(h.events[0].reason, 'track-ended');
  assert.equal(h.timer.trackEnded().consumed, false);
  assert.equal(h.events.length, 1);
});

test('normal track ends leave a running minute deadline intact', () => {
  const h = harness();
  const scheduled = h.timer.set({ mode: 'minutes', minutes: 30 });
  assert.deepEqual(h.timer.trackEnded(), { ...scheduled, consumed: false });
  assert.equal(h.timers.size, 1);
  assert.equal(h.events.length, 0);
});

test('invalid minutes or mode preserve the active timer and only accept integer numbers', () => {
  const h = harness();
  h.timer.set({ mode: 'minutes', minutes: 60 });
  for (const minutes of [-1, 0, 181, 1.5, NaN, Infinity, '15', null, {}, true]) assert.equal(h.timer.set({ mode: 'minutes', minutes }).ok, false);
  for (const options of [null, [], 15, { mode: 'off' }, { mode: 'unknown' }, {}]) assert.equal(h.timer.set(options).ok, false);
  assert.equal(h.timer.status().minutes, 60);
  assert.equal(h.timers.size, 1);
  h.advance(3_600_000);
  assert.equal(h.events.length, 1);
});

test('an early callback re-arms against its deadline and dispose prevents later playback changes', () => {
  const h = harness();
  h.timer.set({ mode: 'minutes', minutes: 1 });
  // Simulate a timer provider delivering early after removing its timer.
  h.timers.clear(); h.callbacks[0]();
  assert.equal(h.events.length, 0);
  assert.equal(h.timers.size, 1);
  h.timer.dispose(); h.callbacks[1](); h.advance(60_000);
  assert.equal(h.events.length, 0);
  assert.equal(h.timers.size, 0);
});

test('expiry resets state before its listener and listener errors do not revive the timer', () => {
  let timer;
  timer = createSleepTimer({ onExpire() { assert.equal(timer.status().active, false); throw new Error('fixture-listener'); } });
  timer.set({ mode: 'after-track' });
  assert.equal(timer.trackEnded().consumed, true);
  assert.equal(timer.status().active, false);
  const first = timer.status(); first.active = true;
  assert.equal(timer.status().active, false);
});

async function mainHarness() {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const { pathToFileURL } = require('node:url');
  const root = path.join(__dirname, '..'), handlers = new Map(), events = [], calls = [];
  let ready, nativeEvent, nativeState = { active: true, loading: false, paused: false }, time = 10_000;
  const deadlines = new Map(); let timerId = 0;
  const contents = { session: { setPermissionRequestHandler() {} }, setWindowOpenHandler() {}, on() {}, send(_channel, event) { events.push(event); } };
  class Window {
    constructor() { this.webContents = contents; }
    setBackgroundMaterial() {} removeMenu() {} on() {} loadFile() {} isDestroyed() { return false; }
  }
  const native = { available: true, executable: 'fixture-mpv',
    status: () => ({ ...nativeState }),
    clearPlaylist() { calls.push('clear'); return Promise.resolve({ ...nativeState }); },
    pause(value) { calls.push(['pause', value]); nativeState.paused = value; return Promise.resolve({ ...nativeState }); },
    stop() { calls.push('stop'); nativeState = { active: false, loading: false, paused: true }; return { ...nativeState }; },
  };
  const electron = {
    app: { setName() {}, setAppUserModelId() {}, setPath() {}, on() {}, getPath: () => 'fixture-data',
      whenReady: () => ({ then(callback) { ready = Promise.resolve().then(callback); return ready; } }),
      exit() { throw new Error('Fixture main failed'); }, quit() {} },
    BrowserWindow: Window, ipcMain: { handle: (channel, callback) => handlers.set(channel, callback) },
    protocol: { registerSchemesAsPrivileged() {}, handle() {} },
    dialog: {}, safeStorage: {}, shell: {}, screen: {}, nativeTheme: {},
  };
  const modules = {
    electron, 'node:fs': { mkdirSync() {}, readFileSync() { throw new Error('fixture-empty-data'); } },
    './lib/audio.cjs': {}, './lib/stream.cjs': { createStreamManager: () => ({ resolve: () => 'fixture-native-source' }) },
    './lib/mpv.cjs': { findMpv: () => 'fixture-mpv', createMpvPlayer(options) { nativeEvent = options.onEvent; return native; } },
    './lib/taskbar-lyrics.cjs': { createTaskbarLyrics: () => ({ dispose() {} }) },
    './lib/taskbar-theme.cjs': {}, './lib/fullscreen-monitor.cjs': {}, './lib/local-lyrics.cjs': {},
    './lib/kugou.cjs': { createKugouAdapter: () => ({}) },
    './lib/sleep-timer.cjs': { createSleepTimer: options => createSleepTimer({ ...options, now: () => time,
      setTimer(callback, delay) { const id = ++timerId; deadlines.set(id, { callback, at: time + delay }); return id; },
      clearTimer: id => deadlines.delete(id),
    }) },
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'main.cjs'), 'utf8'), {
    require: name => Object.hasOwn(modules, name) ? modules[name] : require(name),
    __dirname: root, process: { env: { QINGYIN_TEST: '1', QINGYIN_TEST_DATA: 'fixture-data' } }, console,
  }, { filename: 'main.cjs' });
  await ready;
  const event = { sender: contents, senderFrame: { url: pathToFileURL(path.join(root, 'ui', 'index.html')).href } };
  return { calls, events, native,
    invoke: (action, payload, origin = event) => handlers.get('music:sleep-timer')(origin, action, payload),
    mpv: (action, payload) => handlers.get('music:mpv')(event, action, payload),
    emitNative: data => nativeEvent({ type: 'mpv', state: { ...nativeState }, ...data }),
    loading(value) { nativeState.loading = value; },
    advance(delay) { time += delay; for (const [id, item] of [...deadlines]) if (item.at <= time) { deadlines.delete(id); item.callback(); } },
  };
}

test('main IPC rejects unknown origins, preserves valid state on bad input and blocks native prefetch after-track', async () => {
  const h = await mainHarness();
  await assert.rejects(h.invoke('set', { mode: 'after-track' }, { sender: {}, senderFrame: { url: 'https://untrusted.example' } }), /无法识别的调用来源/);
  assert.equal((await h.invoke('status')).state.active, false);
  assert.equal((await h.invoke('set', { mode: 'minutes', minutes: '15' })).ok, false);
  assert.equal((await h.invoke('unknown')).ok, false);
  assert.equal((await h.invoke('set', { mode: 'after-track' })).state.mode, 'after-track');
  assert.deepEqual(h.calls, ['clear']);
  const queued = await h.mpv('append', { url: `qingyin-stream://track/${'a'.repeat(32)}` });
  assert.equal(queued.ok, true); assert.equal(queued.queued, false);
  assert.equal((await h.invoke('cancel')).state.active, false);
});

test('natural native end consumes after-track once, pauses in main and flags the renderer end event', async () => {
  const h = await mainHarness();
  await h.invoke('set', { mode: 'after-track' });
  h.emitNative({ name: 'end-file', reason: 'stop' });
  assert.equal((await h.invoke('status')).state.active, true);
  h.emitNative({ name: 'end-file', reason: 'eof' });
  assert.equal(h.events.filter(event => event.type === 'sleep-timer').length, 1);
  assert.equal(h.events.at(-1).sleepTimerConsumed, true);
  assert.deepEqual(h.calls, ['clear', ['pause', true], 'clear']);
  assert.equal((await h.invoke('track-ended')).consumed, false);
  h.emitNative({ name: 'end-file', reason: 'eof' });
  assert.equal(h.events.filter(event => event.type === 'sleep-timer').length, 1);
});

test('main minute expiry pauses an active native player and cancels a still-loading native player', async () => {
  const h = await mainHarness();
  await h.invoke('set', { mode: 'minutes', minutes: 1 });
  h.advance(60_000);
  assert.deepEqual(h.calls, [['pause', true], 'clear']);
  assert.equal(h.events[0].reason, 'timer');
  h.loading(true);
  await h.invoke('set', { mode: 'minutes', minutes: 1 });
  h.advance(60_000);
  assert.equal(h.calls.at(-1), 'stop');
  assert.equal(h.events.filter(event => event.type === 'sleep-timer').length, 2);
});
