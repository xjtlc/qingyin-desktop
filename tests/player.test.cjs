'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PlayerState, transportSnapshot, FailureNavigator, ProgressWatchdog } = require('../ui/player-state.js');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const cancelled = error => error.name === 'AbortError' && error.code === 'PLAYER_CANCELLED';

test('stalled browser or native playback expires only after twenty seconds without progress', () => {
  for (const backend of ['browser', 'mpv']) {
    const watchdog = new ProgressWatchdog(), context = { backend, phase: 'playing', wantPlayback: true, url: 'fixture', signal: { aborted: false } };
    for (let now = 0; now < 20000; now += 1000) assert.equal(watchdog.check(context, { time: 8, paused: false }, now), false);
    assert.equal(watchdog.check(context, { time: 8, paused: true, ready: false }, 20000), true);
    context.failureHandled = true;
    assert.equal(watchdog.check(context, { time: 8 }, 21000), false);
  }
});

test('normal progress, manual pause, seek and a new source restart the stall observation', () => {
  const watchdog = new ProgressWatchdog(), context = { phase: 'playing', wantPlayback: true, url: 'one', signal: { aborted: false } };
  let now = 0;
  for (; now < 25000; now += 1000) assert.equal(watchdog.check(context, { time: now / 1000 }, now), false);
  for (let i = 0; i < 18; i++, now += 1000) assert.equal(watchdog.check(context, { time: 25 }, now), false);
  context.wantPlayback = false;
  assert.equal(watchdog.check(context, { time: 25, paused: true }, now), false);
  now += 1000; context.wantPlayback = true;
  for (let i = 0; i < 18; i++, now += 1000) assert.equal(watchdog.check(context, { time: 25 }, now), false);
  // Both explicit reset (seek) and actual backward time movement are safe.
  watchdog.reset();
  for (let i = 0; i < 18; i++, now += 1000) assert.equal(watchdog.check(context, { time: 25 }, now), false);
  assert.equal(watchdog.check(context, { time: 4 }, now), false);
  now += 1000;
  const next = { ...context, url: 'two' };
  assert.equal(watchdog.check(next, { time: 4 }, now), false);
  next.signal = { aborted: true };
  assert.equal(watchdog.check(next, { time: 4 }, now + 30000), false);
});

test('sleep or a suspended renderer cannot immediately classify a song as stalled', () => {
  const watchdog = new ProgressWatchdog(), context = { phase: 'playing', wantPlayback: true, url: 'one' };
  for (let now = 0; now < 18000; now += 1000) assert.equal(watchdog.check(context, { time: 8 }, now), false);
  assert.equal(watchdog.check(context, { time: 8 }, 90000), false);
  for (let now = 91000; now < 110000; now += 1000) assert.equal(watchdog.check(context, { time: 8 }, now), false);
  assert.equal(watchdog.check(context, { time: 8 }, 110000), true);
});

test('changing an already cached song from 128 to FLAC negotiates another stream', async () => {
  const player = new PlayerState({ quality: '128' }), requested = [];
  const resolve = () => player.resolve('song:one', async token => { requested.push(token.quality); return { url: token.quality, quality: { format: token.quality === '128' ? 'mp3' : 'flac' } }; });
  assert.equal((await resolve()).url, '128');
  assert.equal((await resolve()).url, '128');
  player.setQuality('lossless');
  assert.equal((await resolve()).quality.format, 'flac');
  player.setQuality('128');
  assert.equal((await resolve()).url, '128');
  assert.deepEqual(requested, ['128', 'lossless']);
});

test('account changes cannot reuse a previous account stream', async () => {
  const player = new PlayerState(), requested = [];
  const resolve = () => player.resolve('song:one', async token => { requested.push(token.session); return { url: `account-${token.session}` }; });
  assert.equal((await resolve()).url, 'account-0');
  player.resetSession();
  assert.equal((await resolve()).url, 'account-1');
  assert.deepEqual(requested, [0, 1]);
});

test('a slow previous account response is discarded rather than poisoning the new cache', async () => {
  const player = new PlayerState(), old = deferred();
  const pending = player.resolve('song:one', () => old.promise);
  const rejected = assert.rejects(pending, cancelled);
  player.resetSession();
  const fresh = { url: 'new-account' };
  await player.resolve('song:one', () => fresh);
  old.resolve({ url: 'expired-account' });
  await rejected;
  assert.equal(player.getCached('song:one'), fresh);
});

test('a late quality response cannot replace the currently requested quality', async () => {
  const player = new PlayerState({ quality: '128' }), old = deferred();
  const pending = player.resolve('song:one', () => old.promise), rejected = assert.rejects(pending, cancelled);
  player.setQuality('lossless');
  const lossless = { url: 'flac' };
  await player.resolve('song:one', () => lossless);
  old.resolve({ url: 'mp3' });
  await rejected;
  assert.equal(player.getCached('song:one'), lossless);
});

test('prefetch is invalid after a replacement, quality change, session change, or explicit clear', () => {
  const player = new PlayerState();
  let token = player.beginPrefetch(); assert.equal(player.validPrefetch(token), true);
  const replacement = player.beginPrefetch(); assert.equal(player.validPrefetch(token), false); assert.equal(player.validPrefetch(replacement), true);
  token = replacement; player.setQuality('lossless'); assert.equal(player.validPrefetch(token), false);
  token = player.beginPrefetch(); player.resetSession(); assert.equal(player.validPrefetch(token), false);
  token = player.beginPrefetch(); player.invalidatePrefetch(); assert.equal(player.validPrefetch(token), false);
});

test('same account, song, and quality share one negotiation while an old generation cannot delete the replacement', async () => {
  const player = new PlayerState({ quality: '128' }), first = deferred(), second = deferred(); let calls = 0;
  const old = player.resolve('song:one', () => { calls++; return first.promise; }), oldRejected = assert.rejects(old, cancelled);
  const duplicate = player.resolve('song:one', () => { calls++; throw new Error('duplicate network request'); }), duplicateRejected = assert.rejects(duplicate, cancelled);
  await Promise.resolve(); assert.equal(calls, 1);
  player.setQuality('lossless'); player.setQuality('128');
  const replacement = player.resolve('song:one', () => { calls++; return second.promise; });
  await Promise.resolve(); assert.equal(calls, 2);
  first.resolve({ url: 'stale' }); await Promise.all([oldRejected, duplicateRejected]);
  const joined = player.resolve('song:one', () => { calls++; throw new Error('replacement was deleted'); });
  second.resolve({ url: 'fresh' });
  assert.deepEqual(await replacement, { url: 'fresh' }); assert.deepEqual(await joined, { url: 'fresh' }); assert.equal(calls, 2);
});

test('switching tracks and stopping abort loading and prohibit a late load commit', () => {
  const player = new PlayerState();
  const old = player.beginLoad('song:one', 'mpv', { time: 12, paused: true });
  assert.equal(player.current(old), true);
  const next = player.beginLoad('song:two', 'browser');
  assert.equal(old.signal.aborted, true); assert.equal(player.current(old), false); assert.equal(player.current(next), true);
  player.cancelLoad();
  assert.equal(next.signal.aborted, true); assert.equal(player.current(next), false);
});

test('login and logout keep a local song attached to its actual native timeline', () => {
  const player = new PlayerState(), local = player.beginLoad('local:file:1', 'mpv', { time: 18, paused: true });
  local.url = 'qingyin-audio://track/one'; local.phase = 'playing';
  player.resetSession({ preserveLocal: true });
  assert.equal(local.signal.aborted, false); assert.equal(player.current(local), true);
  player.setQuality('lossless', { preserveLocal: true });
  assert.equal(local.signal.aborted, false); assert.equal(player.current(local), true);
  player.resetSession({ preserveLocal: true });
  assert.equal(player.current(local), true);
  const online = player.beginLoad('song:cloud', 'mpv');
  player.resetSession({ preserveLocal: true });
  assert.equal(online.signal.aborted, true); assert.equal(player.current(online), false);
});

test('the cache expires signed streams at its configured lifetime', async () => {
  let now = 100; const player = new PlayerState({ now: () => now, ttl: 50 }); let calls = 0;
  const resolve = () => player.resolve('song:one', async () => ({ url: `signed-${++calls}` }));
  await resolve(); now = 149; assert.equal((await resolve()).url, 'signed-1');
  now = 150; assert.equal((await resolve()).url, 'signed-2');
});

test('retry after a failed or expired stream obtains a fresh source immediately', async () => {
  const player = new PlayerState(); let calls = 0;
  const resolve = () => player.resolve('song:one', async () => ({ url: `signed-${++calls}` }));
  assert.equal((await resolve()).url, 'signed-1');
  player.forget('song:one');
  assert.equal((await resolve()).url, 'signed-2');
});

test('native progress, pause and readiness are independent of a muted or empty browser element', () => {
  const value = transportSnapshot({ backend: 'mpv', sourceId: 'native-one', native: { sourceId: 'native-one', active: true, time: 12, duration: 180, paused: false }, audio: { currentTime: 90, duration: 200, readyState: 4, paused: true } });
  assert.deepEqual(value, { time: 12, duration: 180, paused: false, ready: true });
  const paused = transportSnapshot({ backend: 'mpv', sourceId: 'native-one', native: { sourceId: 'native-one', active: true, time: 18, duration: 180, paused: true } });
  assert.equal(paused.paused, true); assert.equal(paused.time, 18);
});

test('old native song state cannot mark a new source ready or make it resume', () => {
  const value = transportSnapshot({ backend: 'mpv', sourceId: 'native-new', native: { sourceId: 'native-old', active: true, time: 80, duration: 200, paused: false }, restore: { time: 24, paused: true }, fallbackDuration: 180 });
  assert.deepEqual(value, { time: 24, duration: 180, paused: true, ready: false });
});

test('consecutive failures visit a looping queue once and then stop', () => {
  const failures = new FailureNavigator(), order = ['a', 'b', 'c'];
  assert.equal(failures.next(order, 'b'), 'c');
  assert.equal(failures.next(order, 'c'), 'a');
  assert.equal(failures.next(order, 'a'), null);
  assert.equal(failures.next(['only'], 'only'), null);
  assert.equal(failures.next([], 'removed'), null);
});

test('sequential failure skipping never wraps to earlier songs', () => {
  const failures = new FailureNavigator();
  assert.equal(failures.next(['a', 'b', 'c'], 'b', { wrap: false }), 'c');
  assert.equal(failures.next(['a', 'b', 'c'], 'c', { wrap: false }), null);
});

test('failure skipping follows shuffled entry identities including duplicate recordings', () => {
  const failures = new FailureNavigator(), order = ['song:same:entry:2', 'song:other:entry:1', 'song:same:entry:0'];
  assert.equal(failures.next(order, order[0]), order[1]);
  assert.equal(failures.next(order, order[1]), order[2]);
  assert.equal(failures.next(order, order[2]), null);
});

test('a user retry or successful playback starts a fresh failure round after queue edits', () => {
  const failures = new FailureNavigator();
  failures.next(['a', 'b'], 'a'); failures.next(['a', 'b'], 'b');
  assert.equal(failures.next(['b', 'new'], 'b'), 'new');
  failures.reset();
  assert.equal(failures.next(['a', 'b'], 'b'), 'a');
});
