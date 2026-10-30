'use strict';

const path = require('node:path');
const { spawn: nativeSpawn } = require('node:child_process');

function watcherExecutable(root = path.join(__dirname, '..')) {
  return path.join(root.replace(/([/\\])app\.asar(?=[/\\]|$)/i, '$1app.asar.unpacked'), 'native', 'fullscreen-watcher.exe');
}

// The helper sends only a boolean heartbeat. Unknown/stale/error is null, so
// callers can keep the overlay hidden until Windows has actually been checked.
function createFullscreenMonitor(options = {}) {
  const platform = options.platform || process.platform;
  const spawn = options.spawn || nativeSpawn;
  const timers = options.timers || globalThis;
  const onChange = typeof options.onChange === 'function' ? options.onChange : () => {};
  const executable = options.executable || watcherExecutable();
  let active = false, disposed = false, child = null, revision = 0;
  let blocked = null, ready = false, buffer = '', watchdog = null, retry = null, failures = 0;

  function status() { return { blocked, ready, running: Boolean(active && child) }; }
  function publish(value, force = false) {
    const nextReady = typeof value === 'boolean';
    const changed = blocked !== value || ready !== nextReady;
    blocked = value; ready = nextReady;
    if (changed || force) onChange(value, status());
  }
  function cancel(name) {
    const handle = name === 'watchdog' ? watchdog : retry;
    if (handle !== null) timers.clearTimeout(handle);
    if (name === 'watchdog') watchdog = null; else retry = null;
  }
  function later(callback, delay) { const timer = timers.setTimeout(callback, delay); timer?.unref?.(); return timer; }
  function detach() {
    revision++; cancel('watchdog'); buffer = '';
    const previous = child; child = null;
    if (previous && !previous.killed) { try { previous.kill(); } catch {} }
  }
  function failed(token) {
    if (!active || disposed || token !== revision) return;
    detach(); publish(null);
    const delay = Math.min(15000, 1000 * 2 ** Math.min(failures++, 4));
    cancel('retry');
    retry = later(() => { retry = null; launch(); }, delay);
  }
  function armWatchdog(token, delay = 2000) {
    cancel('watchdog'); watchdog = later(() => { watchdog = null; failed(token); }, delay);
  }
  function launch() {
    if (!active || disposed || platform !== 'win32') return;
    const token = ++revision;
    buffer = '';
    try {
      child = spawn(executable, [String(process.pid)], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      if (!child?.stdout?.on || typeof child.on !== 'function') throw new Error('Unable to read fullscreen watcher');
      armWatchdog(token, 3000);
      child.stdout.on('data', chunk => {
        if (!active || disposed || token !== revision) return;
        buffer += Buffer.isBuffer(chunk) ? chunk.toString('ascii') : String(chunk);
        if (buffer.length > 256) { failed(token); return; }
        const lines = buffer.split('\n'); buffer = lines.pop();
        for (const raw of lines) {
          const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
          if (line !== '0' && line !== '1') { failed(token); return; }
          failures = 0; armWatchdog(token); publish(line === '1');
        }
      });
      child.stdout.on('error', () => failed(token));
      child.on('error', () => failed(token));
      child.on('exit', () => failed(token));
      child.on('close', () => failed(token));
    } catch { failed(token); }
  }
  return {
    start() {
      if (disposed || active) return status();
      active = true; failures = 0; publish(null, true);
      if (platform === 'win32') launch();
      return status();
    },
    stop() {
      if (!active) return status();
      active = false; cancel('retry'); detach(); publish(null);
      return status();
    },
    dispose() { if (disposed) return; this.stop(); disposed = true; },
    status,
  };
}

module.exports = { createFullscreenMonitor, watcherExecutable };
