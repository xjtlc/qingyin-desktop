'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createMpvPlayer } = require('../lib/mpv.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
const source = n => `qingyin-stream://track/${String(n).repeat(32)}`;
const secret = n => `http://fs.kugou.com/${n}.flac?private-signature=never-render`;

function fixture(options = {}) {
  const children = [], sockets = [], commands = [], events = [], launches = [];
  let nextEntry = 0;
  class Socket extends EventEmitter {
    constructor() { super(); this.destroyed = false; this.playlist = []; this.props = { 'time-pos': 0, duration: 180, pause: true, 'eof-reached': false, volume: 100, 'audio-params': { samplerate: 96000, format: 's32', 'channel-count': 2, privatePath: secret(1) }, 'audio-out-params': { samplerate: 48000, format: 's32', 'channel-count': 2 } }; }
    destroy() { if (!this.destroyed) { this.destroyed = true; this.emit('close'); } }
    message(value) { this.emit('data', Buffer.from(JSON.stringify(value) + '\n')); }
    property(name, data) { this.props[name] = data; this.message({ event: 'property-change', name, data }); }
    write(raw) {
      const request = JSON.parse(raw); const [name, ...args] = request.command;
      commands.push({ socket: this, ...request });
      queueMicrotask(() => {
        if (this.destroyed) return;
        if (options.noReply?.(request.command)) return;
        if (options.reject?.(request.command)) { this.message({ request_id: request.request_id, error: `private failure ${secret(1)}` }); return; }
        let data;
        if (name === 'set_property') { if (options.silentSet) this.props[args[0]] = args[1]; else this.property(args[0], args[1]); }
        if (name === 'get_property') data = args[0] === 'playlist' ? this.playlist.map(entry => ({ ...entry })) : this.props[args[0]];
        if (name === 'playlist-clear') { this.playlist = this.playlist.filter(entry => entry.current); this.property('playlist-count', this.playlist.length); }
        if (name === 'loadfile') {
          const entry = { id: ++nextEntry, filename: args[0], current: args[1] === 'replace', playing: args[1] === 'replace' };
          if (args[1] === 'replace') this.playlist = [entry]; else this.playlist.push(entry);
          this.message({ event: 'property-change', name: 'playlist', data: this.playlist.map(item => ({ ...item })) });
          this.property('playlist-count', this.playlist.length);
          if (args[1] === 'replace') {
            this.props['time-pos'] = Number(args[3]?.start) || 0;
            this.message({ event: 'start-file', playlist_entry_id: entry.id });
            if (!options.manualLoaded) this.message({ event: 'file-loaded' });
          }
        }
        if (name === 'seek') { if (options.silentSet) this.props['time-pos'] = args[0]; else this.property('time-pos', args[0]); }
        this.message({ request_id: request.request_id, error: 'success', data });
      });
      return true;
    }
  }
  const player = createMpvPlayer({ executable: 'mock-mpv.exe', onEvent: event => events.push(event),
    startTimeoutMs: 80, commandTimeoutMs: 80, loadTimeoutMs: 180, retryDelayMs: 1,
    spawnProcess: (_exe, args) => { launches.push(args); const child = new EventEmitter(); child.kill = () => { child.killed = true; return true; }; children.push(child); return child; },
    connectPipe: () => { const socket = new Socket(); sockets.push(socket); if (!options.manualConnect) queueMicrotask(() => socket.emit('connect')); return socket; },
    ...options.playerOptions,
  });
  return { player, children, sockets, commands, events, launches };
}

test('shared startup keeps only the latest pending load and applies initial mute before loading', async () => {
  const f = fixture({ manualConnect: true });
  const first = f.player.load(secret(1), { sourceId: source(1), volume: 0 });
  const cancelled = assert.rejects(first, { code: 'MPV_CANCELLED' });
  const second = f.player.load(secret(2), { sourceId: source(2), volume: 0, paused: true, time: 24 });
  assert.equal(f.children.length, 1);
  f.sockets[0].emit('connect');
  const state = await second; await cancelled;
  assert.equal(state.sourceId, source(2)); assert.equal(state.time, 24); assert.equal(state.paused, true); assert.equal(state.volume, 0);
  const sent = f.commands.map(item => item.command);
  assert.deepEqual(sent.filter(command => command[0] === 'loadfile').map(command => command[1]), [secret(2)]);
  assert.ok(sent.findIndex(command => command[0] === 'set_property' && command[1] === 'volume' && command[2] === 0) < sent.findIndex(command => command[0] === 'loadfile'));
  assert.ok(f.launches[0].includes('--gapless-audio=weak')); assert.ok(f.launches[0].includes('--no-config'));
  f.player.stop();
});

test('load waits for its file-loaded event rather than just command acknowledgment', async () => {
  const f = fixture({ manualLoaded: true }); let completed = false;
  const load = f.player.load(secret(1), { sourceId: source(1) }).then(value => { completed = true; return value; });
  await tick(); assert.equal(completed, false);
  f.sockets[0].message({ event: 'file-loaded' });
  assert.equal((await load).sourceId, source(1));
  assert.equal(f.events.filter(event => event.name === 'file-loaded').length, 1);
  f.player.stop();
});

test('entry ids isolate cancellation, stale errors and file-loaded from replacement loads', async () => {
  const f = fixture({ manualLoaded: true });
  const first = f.player.load(secret(1), { sourceId: source(1) });
  const cancelled = assert.rejects(first, { code: 'MPV_CANCELLED' }); await tick();
  const oldId = f.sockets[0].playlist[0].id;
  let finished = false;
  const second = f.player.load(secret(2), { sourceId: source(2) }).then(value => { finished = true; return value; });
  await tick(); await cancelled;
  f.sockets[0].message({ event: 'end-file', playlist_entry_id: oldId, reason: 'error', file_error: secret(1) });
  assert.equal(f.events.some(event => event.name === 'error'), false); assert.equal(finished, false);
  f.sockets[0].message({ event: 'file-loaded' });
  assert.equal((await second).sourceId, source(2)); f.player.stop();
});

test('load and runtime decoder failures surface sanitized errors, never private paths', async () => {
  const f = fixture({ manualLoaded: true }); const load = f.player.load(secret(1), { sourceId: source(1) });
  const rejected = assert.rejects(load, error => error.code === 'MPV_LOAD_FAILED' && !error.message.includes('kugou'));
  await tick(); const id = f.sockets[0].playlist[0].id;
  f.sockets[0].message({ event: 'end-file', playlist_entry_id: id, reason: 'error', file_error: secret(1) }); await rejected;
  assert.equal(f.player.status().error.code, 'MPV_LOAD_FAILED'); assert.equal(f.player.status().eof, false);
  assert.equal(JSON.stringify([f.events, f.player.status()]).includes('private-signature'), false);
  assert.equal(f.player.status().path, undefined); f.player.stop();
  const g = fixture(); await g.player.load(secret(2), { sourceId: source(2) });
  g.sockets[0].message({ event: 'end-file', playlist_entry_id: g.sockets[0].playlist[0].id, reason: 'error', file_error: secret(2) });
  assert.equal(g.events.some(event => event.name === 'error' && event.state.sourceId === source(2)), true); g.player.stop();
});

test('IPC command rejection and missing file-loaded have bounded failure responses', async () => {
  const f = fixture({ reject: command => command[0] === 'loadfile' });
  await assert.rejects(f.player.load(secret(1), { sourceId: source(1) }), { code: 'MPV_LOAD_FAILED' }); f.player.stop();
  const g = fixture({ manualLoaded: true, playerOptions: { loadTimeoutMs: 30 } });
  await assert.rejects(g.player.load(secret(2), { sourceId: source(2) }), { code: 'MPV_TIMEOUT' }); g.player.stop();
  const h = fixture({ noReply: command => command[0] === 'set_property', playerOptions: { commandTimeoutMs: 20 } });
  await assert.rejects(h.player.load(secret(3), { sourceId: source(3) }), { code: 'MPV_TIMEOUT' }); h.player.stop();
});

test('stop clears playback and cancels pending operations; delayed old exit cannot affect restart', async () => {
  const f = fixture({ manualLoaded: true }); const first = f.player.load(secret(1), { sourceId: source(1) });
  const rejected = assert.rejects(first, { code: 'MPV_CANCELLED' }); await tick();
  const append = f.player.append(secret(2), { sourceId: source(2) }); const appendRejected = assert.rejects(append, { code: 'MPV_CANCELLED' });
  f.player.stop(); await rejected; await appendRejected;
  assert.equal(f.player.status().sourceId, ''); assert.equal(f.player.status().outParams, null); assert.equal(f.player.status().active, false);
  await f.player.start();
  f.children[0].emit('exit', 0); f.sockets[0].emit('close'); f.sockets[0].emit('error', new Error(secret(1)));
  assert.equal(f.player.status().active, true); assert.equal(f.sockets[1].destroyed, false); f.player.stop();
});

test('child spawn errors and IPC disconnection recover on the next load', async () => {
  const f = fixture({ manualConnect: true }); const load = f.player.load(secret(1), { sourceId: source(1) });
  const rejected = assert.rejects(load); f.children[0].emit('error', Object.assign(new Error(secret(1)), { code: 'ENOENT' })); await rejected;
  assert.equal(f.player.status().active, false);
  const g = fixture(); await g.player.load(secret(2), { sourceId: source(2) }); g.sockets[0].emit('error', new Error(secret(2)));
  assert.equal(g.player.status().active, false);
  const state = await g.player.load(secret(3), { sourceId: source(3) }); assert.equal(state.active, true); assert.equal(g.children.length, 2); g.player.stop();
});

test('automatic playlist transitions expose only opaque source ids and distinguish EOF from stop', async () => {
  const f = fixture(); await f.player.load(secret(1), { sourceId: source(1) });
  await f.player.append(secret(2), { sourceId: source(2) }); const [first, second] = f.sockets[0].playlist;
  f.sockets[0].message({ event: 'end-file', playlist_entry_id: first.id, reason: 'eof' });
  assert.equal(f.events.at(-1).state.eof, true); assert.equal(f.events.at(-1).state.sourceId, source(1));
  f.sockets[0].message({ event: 'start-file', playlist_entry_id: second.id }); f.sockets[0].message({ event: 'file-loaded' });
  await tick();
  assert.equal(f.player.status().sourceId, source(2)); assert.equal(f.player.status().eof, false);
  assert.equal(f.player.status().paused, false);
  assert.equal(f.events.filter(event => event.name === 'file-loaded').at(-1).state.paused, false);
  await f.player.clearPlaylist(); assert.equal(f.commands.some(item => item.command[0] === 'playlist-clear'), true);
  assert.equal(JSON.stringify([f.events, f.player.status()]).includes('private-signature'), false);
  f.player.stop(); assert.equal(f.events.at(-1).reason, 'stop'); assert.equal(f.events.at(-1).state.eof, false);
});

test('transport replies reflect actual pause, volume and seek even before observer notifications', async () => {
  const f = fixture({ silentSet: true }); await f.player.load(secret(1), { sourceId: source(1), volume: 0 });
  assert.equal((await f.player.pause(true)).paused, true);
  assert.equal((await f.player.pause(false)).paused, false);
  assert.equal((await f.player.setVolume(25)).volume, 25);
  assert.equal((await f.player.seek(35)).time, 35);
  f.player.stop();
});

test('decoder parameters are refreshed on load, observed safely, and cleared on stop', async () => {
  const f = fixture(); const state = await f.player.load(secret(1), { sourceId: source(1) });
  assert.deepEqual(state.audioParams, { samplerate: 96000, format: 's32', channels: 2 });
  assert.deepEqual(state.outParams, { samplerate: 48000, format: 's32', channels: 2 });
  assert.equal(f.events.filter(event => event.name === 'file-loaded').at(-1).state.audioParams.samplerate, 96000);
  assert.ok(f.commands.some(item => item.command[0] === 'observe_property' && item.command[2] === 'audio-params'));
  f.sockets[0].property('audio-params', { samplerate: 44100, format: 'floatp', 'channel-count': 2, filename: secret(2) });
  assert.deepEqual(f.player.status().audioParams, { samplerate: 44100, format: 'floatp', channels: 2 });
  f.sockets[0].property('audio-params', { samplerate: 'Infinity', format: secret(2), 'channel-count': -2 });
  assert.deepEqual(f.player.status().audioParams, { samplerate: 0, format: '', channels: 0 });
  assert.equal(JSON.stringify([f.events, f.player.status()]).includes('private-signature'), false);
  f.player.stop(); assert.equal(f.player.status().audioParams, null); assert.equal(f.player.status().outParams, null);
});
