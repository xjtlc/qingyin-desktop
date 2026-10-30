'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { createFullscreenMonitor, watcherExecutable } = require('../lib/fullscreen-monitor.cjs');

function harness(options = {}) {
  const children = [], callbacks = [], timers = new Map(); let timerId = 0;
  const fakeTimers = {
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  const monitor = createFullscreenMonitor({ platform: 'win32', executable: 'watcher.exe', timers: fakeTimers,
    onChange: (value, status) => callbacks.push({ value, status }),
    spawn(file, args, settings) {
      const child = new EventEmitter(); child.stdout = new EventEmitter(); child.killed = false;
      child.kill = () => { child.killed = true; child.emit('exit', null, 'SIGTERM'); child.emit('close'); };
      child.invocation = { file, args, settings }; children.push(child); return child;
    }, ...options });
  return { monitor, children, callbacks, timers,
    data(text, child = children.at(-1)) { child.stdout.emit('data', Buffer.from(text)); },
    fire(delay) { const entry = [...timers].find(([, timer]) => timer.delay === delay); assert.ok(entry, 'Expected timer ' + delay); timers.delete(entry[0]); entry[1].fn(); },
  };
}

test('packaged native helper resolves outside asar without changing source checkout paths', () => {
  assert.equal(watcherExecutable('D:\\Qingyin\\resources\\app.asar'), path.join('D:\\Qingyin\\resources\\app.asar.unpacked', 'native', 'fullscreen-watcher.exe'));
  assert.equal(watcherExecutable('D:\\Qingyin\\resources\\app.asar\\extra'), path.join('D:\\Qingyin\\resources\\app.asar.unpacked\\extra', 'native', 'fullscreen-watcher.exe'));
  assert.equal(watcherExecutable('D:\\app.asar-example'), path.join('D:\\app.asar-example', 'native', 'fullscreen-watcher.exe'));
  assert.equal(watcherExecutable('D:\\source'), path.join('D:\\source', 'native', 'fullscreen-watcher.exe'));
});

test('startup is unknown until a valid heartbeat and one persistent helper runs hidden', () => {
  const h = harness();
  assert.deepEqual(h.monitor.status(), { blocked: null, ready: false, running: false });
  h.monitor.start(); h.monitor.start();
  assert.equal(h.children.length, 1); assert.equal(h.callbacks[0].value, null);
  assert.deepEqual(h.children[0].invocation, { file: 'watcher.exe', args: [String(process.pid)], settings: { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] } });
  h.data('0\r'); assert.equal(h.monitor.status().ready, false);
  h.data('\n1\n');
  assert.deepEqual(h.callbacks.map(entry => entry.value), [null, false, true]);
  h.data('1\n1\n'); assert.equal(h.callbacks.length, 3, 'heartbeats refresh the watchdog without duplicate visibility changes');
  h.data('0\n'); assert.deepEqual(h.monitor.status(), { blocked: false, ready: true, running: true });
  assert.equal(h.timers.size, 1);
  h.monitor.dispose(); assert.equal(h.children[0].killed, true); assert.equal(h.timers.size, 0);
});

test('missing heartbeat hides the caption and starts a fresh helper after bounded backoff', () => {
  const h = harness(); h.monitor.start(); h.data('0\n'); const old = h.children[0];
  h.fire(2000);
  assert.equal(old.killed, true); assert.equal(h.callbacks.at(-1).value, null);
  assert.deepEqual(h.monitor.status(), { blocked: null, ready: false, running: false });
  h.data('0\n', old); assert.equal(h.monitor.status().ready, false, 'old child cannot restore the caption');
  h.fire(1000); assert.equal(h.children.length, 2);
  h.data('0\n'); assert.equal(h.callbacks.at(-1).value, false);
  h.monitor.dispose();
});

test('startup timeout, malformed protocol and oversized input never claim desktop visibility', () => {
  const h = harness(); h.monitor.start(); h.fire(3000); h.fire(1000);
  h.data('not-a-state\n'); assert.equal(h.monitor.status().ready, false);
  h.fire(2000); h.data('0'.repeat(257)); assert.equal(h.monitor.status().ready, false);
  h.fire(4000); h.data('0\n'); assert.equal(h.monitor.status().ready, true);
  h.monitor.dispose();
});

test('duplicate crash events schedule one retry and stop cancels all future callbacks', () => {
  const h = harness(); h.monitor.start(); h.data('0\n');
  const old = h.children[0]; old.emit('error', new Error('helper unavailable')); old.emit('exit', 1); old.emit('close', 1);
  assert.equal([...h.timers.values()].filter(value => value.delay === 1000).length, 1);
  h.monitor.stop(); assert.equal(h.timers.size, 0); const count = h.callbacks.length;
  old.stdout.emit('error', new Error('closed pipe')); h.data('1\n', old);
  assert.equal(h.callbacks.length, count); assert.equal(h.monitor.status().running, false);
  h.monitor.start(); h.data('0\n'); assert.equal(h.callbacks.at(-1).value, false);
  h.monitor.dispose(); h.monitor.start(); assert.equal(h.children.length, 2); assert.equal(h.timers.size, 0);
});

test('synchronous spawn errors retry without uncaught exceptions and backoff is capped', () => {
  let attempts = 0;
  const h = harness({ spawn() { attempts++; throw new Error('missing binary'); } });
  h.monitor.start();
  for (const delay of [1000, 2000, 4000, 8000, 15000, 15000]) h.fire(delay);
  assert.equal(attempts, 7); assert.equal(h.monitor.status().blocked, null);
  h.monitor.dispose(); assert.equal(h.timers.size, 0);
});

test('unsupported platforms never launch a Windows helper', () => {
  const h = harness({ platform: 'linux' }); h.monitor.start();
  assert.equal(h.children.length, 0); assert.equal(h.monitor.status().ready, false);
  h.monitor.dispose(); assert.equal(h.timers.size, 0);
});
