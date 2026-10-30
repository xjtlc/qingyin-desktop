'use strict';

// Native WASAPI output. Source addresses stay private; events contain opaque handles.

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const crypto = require('node:crypto');
const { StringDecoder } = require('node:string_decoder');

function findMpv({ root, extra = [] } = {}) {
  // A packaged app keeps vendor/mpv outside the asar. The unpacked path must be probed
  // first: Electron shims fs so a path inside app.asar stats successfully even though
  // the binary there cannot be executed.
  const unpacked = root ? root.replace(/app\.asar([\\/]|$)/, 'app.asar.unpacked$1') : null;
  const candidates = [
    ...extra,
    unpacked ? path.join(unpacked, 'vendor', 'mpv', 'mpv.exe') : null,
    root ? path.join(root, 'vendor', 'mpv', 'mpv.exe') : null,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'mpv', 'mpv.exe') : null,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'mpv', 'mpv.exe') : null,
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'mpv', 'mpv.exe') : null,
  ].filter(Boolean).filter(candidate => !/[\\/]app\.asar[\\/]/.test(candidate));
  for (const candidate of candidates) {
    try { if (fs.statSync(candidate).isFile()) return candidate; } catch { /* keep looking */ }
  }
  // Finally consult PATH.
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, 'mpv.exe');
    try { if (fs.statSync(candidate).isFile()) return candidate; } catch { /* keep looking */ }
  }
  return null;
}

const MESSAGES = {
  MPV_NOT_FOUND: '未找到 mpv 播放组件，请切回内置播放。',
  MPV_START_FAILED: 'mpv 播放组件未能启动，请切回内置播放。',
  MPV_DISCONNECTED: 'mpv 播放连接已中断，请重试或切回内置播放。',
  MPV_CANCELLED: '播放请求已取消。',
  MPV_TIMEOUT: 'mpv 播放响应超时，请重试或切回内置播放。',
  MPV_LOAD_FAILED: 'mpv 无法播放这首歌，请重试或切回内置播放。',
  MPV_COMMAND_FAILED: 'mpv 未能完成播放操作，请重试。',
};
function playerError(code) { return Object.assign(new Error(MESSAGES[code] || MESSAGES.MPV_COMMAND_FAILED), { code }); }
const opaqueSource = value => typeof value === 'string' && /^qingyin-(?:stream|audio):\/\/track\/[a-z\d]+$/i.test(value) ? value : '';

function createMpvPlayer({ onEvent = () => {}, executable = null, exclusive = true,
  spawnProcess = spawn, connectPipe = pipe => net.connect(pipe), startTimeoutMs = 8000,
  commandTimeoutMs = 5000, loadTimeoutMs = 20000, retryDelayMs = 150 } = {}) {
  let instance = null;
  let starting = null;
  let detectedExe = executable;
  let requestId = 0;
  let loadGeneration = 0;
  let queueGeneration = 0;
  let pendingLoad = null;
  let wantedVolume = 100;
  const emptyState = () => ({ time: 0, duration: 0, paused: true, eof: false, volume: wantedVolume, audioParams: null, outParams: null, sourceId: '', playlistPos: -1, playlistCount: 0, error: null });
  let observed = emptyState();
  const status = () => ({ active: Boolean(instance?.ready && instance.socket && !instance.socket.destroyed), loading: Boolean(pendingLoad), ...observed, audioParams: observed.audioParams ? { ...observed.audioParams } : null, outParams: observed.outParams ? { ...observed.outParams } : null, error: observed.error ? { ...observed.error } : null, exclusive });
  const emit = (name, fields = {}) => { try { onEvent({ type: 'mpv', name, ...fields, state: status() }); } catch { /* listener isolation */ } };
  const settleLoad = (load, error) => {
    if (!load || load.done) return;
    load.done = true; clearTimeout(load.timer);
    if (pendingLoad === load) pendingLoad = null;
    error ? load.reject(error) : load.resolve(status());
  };
  const failLoad = (load, error) => {
    if (pendingLoad !== load || load.done) return;
    if (error.code !== 'MPV_CANCELLED') {
      observed.sourceId = load.sourceId; observed.paused = true; observed.eof = false;
      observed.error = { code: error.code, message: error.message }; emit('error', { error: observed.error });
    }
    settleLoad(load, error);
  };
  function closeInstance(current, error, name = 'error') {
    if (instance !== current) return;
    instance = null; starting = null;
    current.connectCancel?.();
    for (const request of current.requests.values()) { clearTimeout(request.timer); request.reject(error); }
    current.requests.clear();
    current.socket?.destroy();
    try { current.child?.kill(); } catch { /* already exited */ }
    const sourceId = observed.sourceId;
    observed = emptyState(); observed.sourceId = sourceId;
    observed.error = { code: error.code, message: error.message };
    if (pendingLoad) settleLoad(pendingLoad, error);
    emit(name, { error: observed.error });
    observed.sourceId = '';
  }
  function command(current, args) {
    if (instance !== current || !current.ready || !current.socket || current.socket.destroyed) return Promise.reject(playerError('MPV_DISCONNECTED'));
    return new Promise((resolve, reject) => {
      const id = ++requestId;
      const timer = setTimeout(() => { current.requests.delete(id); reject(playerError('MPV_TIMEOUT')); }, commandTimeoutMs);
      current.requests.set(id, { resolve, reject, timer });
      try { current.socket.write(`${JSON.stringify({ command: args, request_id: id })}\n`); }
      catch { clearTimeout(timer); current.requests.delete(id); reject(playerError('MPV_DISCONNECTED')); closeInstance(current, playerError('MPV_DISCONNECTED')); }
    });
  }
  function updatePlaylist(current, entries) {
    if (!Array.isArray(entries)) return;
    current.playlist = entries;
    for (const entry of entries) {
      const id = Number(entry.id);
      const sourceId = current.sources.get(entry.filename);
      if (Number.isFinite(id) && sourceId && !current.entries.has(id)) current.entries.set(id, sourceId);
    }
    if (current.entries.has(current.entryId) && observed.sourceId !== current.entries.get(current.entryId)) {
      observed.sourceId = current.entries.get(current.entryId); emit('source', { value: observed.sourceId });
    }
  }
  function completeLoaded(current) {
    const load = pendingLoad;
    if (load?.instance !== current || load.entryId !== current.entryId) return;
    if (current.failed.has(load.entryId)) return failLoad(load, playerError('MPV_LOAD_FAILED'));
    if (!current.loaded.has(load.entryId) || load.finishing) return;
    load.finishing = true;
    refreshLoaded(current, load.entryId, load);
  }
  function refreshLoaded(current, entryId, load = null) {
    const names = ['time-pos', 'duration', 'pause', 'eof-reached', 'volume', 'audio-params', 'audio-out-params'];
    Promise.all(names.map(name => command(current, ['get_property', name]).catch(() => undefined))).then(values => {
      if (pendingLoad !== load || instance !== current || current.entryId !== entryId) return;
      names.forEach((name, index) => { if (values[index] !== undefined) property(current, name, values[index]); });
      if (load) settleLoad(load);
      emit('file-loaded');
    });
  }
  function property(current, name, value) {
    if (name === 'playlist') { updatePlaylist(current, value); return; }
    if (name === 'time-pos') observed.time = Math.max(0, Number(value) || 0);
    else if (name === 'duration') observed.duration = Math.max(0, Number(value) || 0);
    else if (name === 'pause') observed.paused = Boolean(value);
    else if (name === 'eof-reached') observed.eof = Boolean(value);
    else if (name === 'volume') observed.volume = Math.max(0, Number(value) || 0);
    else if (name === 'audio-params' || name === 'audio-out-params') {
      const bounded = (input, max) => Number.isFinite(Number(input)) ? Math.max(0, Math.min(max, Math.round(Number(input)))) : 0;
      const params = value && typeof value === 'object' ? {
        samplerate: bounded(value.samplerate, 768000),
        format: /^(?:u8|s16|s32|s64|float|double)p?$/.test(String(value.format || '')) ? String(value.format) : '',
        channels: bounded(value['channel-count'], 64),
      } : null;
      if (name === 'audio-params') observed.audioParams = params;
      else observed.outParams = params;
    }
    else if (name === 'playlist-pos') observed.playlistPos = Number.isFinite(Number(value)) ? Number(value) : -1;
    else if (name === 'playlist-count') observed.playlistCount = Math.max(0, Number(value) || 0);
    else return;
    emit(name, { value: name === 'audio-params' ? observed.audioParams : name === 'audio-out-params' ? observed.outParams : name === 'pause' ? observed.paused : name === 'eof-reached' ? observed.eof : Number(value) || 0 });
  }
  function handleMessage(current, message) {
    if (instance !== current || !message || typeof message !== 'object') return;
    if (message.request_id !== undefined) {
      const request = current.requests.get(message.request_id);
      if (!request) return;
      current.requests.delete(message.request_id); clearTimeout(request.timer);
      message.error && message.error !== 'success' ? request.reject(playerError('MPV_COMMAND_FAILED')) : request.resolve(message.data);
      return;
    }
    if (['property-change', 'property_change'].includes(message.event)) return property(current, message.name, message.data);
    if (message.event === 'start-file') {
      current.entryId = Number(message.playlist_entry_id);
      observed = { ...emptyState(), paused: observed.paused, volume: observed.volume, playlistPos: observed.playlistPos, playlistCount: observed.playlistCount, sourceId: current.entries.get(current.entryId) || '' };
      emit('start-file'); return;
    }
    if (message.event === 'file-loaded') {
      current.loaded.add(current.entryId); observed.error = null;
      if (!pendingLoad) refreshLoaded(current, current.entryId);
      completeLoaded(current); return;
    }
    if (message.event === 'end-file') {
      const id = Number(message.playlist_entry_id);
      if (message.reason === 'error') current.failed.add(id);
      // An old entry can finish after a new load starts. It cannot end the new song.
      if (id !== current.entryId) return;
      if (pendingLoad && pendingLoad.instance === current && pendingLoad.entryId !== id) return;
      observed.eof = message.reason === 'eof';
      if (message.reason === 'error') {
        observed.error = { code: 'MPV_LOAD_FAILED', message: MESSAGES.MPV_LOAD_FAILED };
        if (!pendingLoad) emit('error', { error: observed.error });
        completeLoaded(current);
      }
      emit('end-file', { reason: ['eof', 'stop', 'quit', 'error', 'redirect'].includes(message.reason) ? message.reason : 'unknown', error: observed.error });
    }
  }
  function connect(current, timeout) {
    return new Promise((resolve, reject) => {
      let client;
      try { client = connectPipe(current.pipe); } catch { reject(playerError('MPV_START_FAILED')); return; }
      let timer;
      const cleanup = () => { clearTimeout(timer); client.removeListener('connect', connected); client.removeListener('error', failed); client.removeListener('close', failed); current.connectCancel = null; };
      const failed = () => { cleanup(); client.destroy(); reject(playerError('MPV_START_FAILED')); };
      const connected = () => { cleanup(); resolve(client); };
      current.connectCancel = failed;
      client.on('error', () => {}); // A destroyed connection attempt may report a late error.
      client.once('connect', connected); client.once('error', failed); client.once('close', failed);
      timer = setTimeout(failed, timeout);
    });
  }
  function start() {
    if (starting) return starting;
    if (instance?.ready) return Promise.resolve(status());
    detectedExe ||= findMpv({});
    if (!detectedExe) return Promise.reject(playerError('MPV_NOT_FOUND'));
    const current = { child: null, socket: null, ready: false, requests: new Map(), sources: new Map(), entries: new Map(), playlist: [], loaded: new Set(), failed: new Set(), entryId: null, pipe: `\\\\.\\pipe\\qingyin-mpv-${crypto.randomBytes(12).toString('hex')}` };
    instance = current;
    const promise = (async () => {
      try {
        current.child = spawnProcess(detectedExe, ['--no-config', '--load-scripts=no', '--idle=yes', '--no-video', '--force-window=no', '--terminal=no', '--gapless-audio=weak', '--audio-display=no', `--input-ipc-server=${current.pipe}`, '--ao=wasapi', `--audio-exclusive=${exclusive ? 'yes' : 'no'}`, '--volume-max=100'], { windowsHide: true, stdio: 'ignore' });
        current.child.on('error', () => closeInstance(current, playerError('MPV_START_FAILED')));
        current.child.on('exit', () => closeInstance(current, playerError('MPV_DISCONNECTED'), 'exit'));
        const deadline = Date.now() + startTimeoutMs;
        while (instance === current && Date.now() < deadline) {
          try { current.socket = await connect(current, Math.max(1, Math.min(500, deadline - Date.now()))); break; }
          catch { if (instance === current) await new Promise(resolve => setTimeout(resolve, retryDelayMs)); }
        }
        if (instance !== current) { current.socket?.destroy(); throw playerError('MPV_CANCELLED'); }
        if (!current.socket) throw playerError('MPV_START_FAILED');
        let buffer = ''; const decoder = new StringDecoder('utf8');
        current.socket.on('data', chunk => {
          if (instance !== current) return;
          buffer += decoder.write(chunk);
          if (buffer.length > 2_000_000) { closeInstance(current, playerError('MPV_DISCONNECTED')); return; }
          let index;
          while ((index = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
            try { handleMessage(current, JSON.parse(line)); } catch { /* malformed messages do not expose content */ }
          }
        });
        current.socket.on('error', () => closeInstance(current, playerError('MPV_DISCONNECTED')));
        current.socket.on('close', () => closeInstance(current, playerError('MPV_DISCONNECTED')));
        current.ready = true;
        const names = ['time-pos', 'duration', 'pause', 'eof-reached', 'volume', 'audio-params', 'audio-out-params', 'playlist', 'playlist-pos', 'playlist-count'];
        await Promise.all(names.map((name, id) => command(current, ['observe_property', id + 1, name])));
        if (instance !== current) throw playerError('MPV_CANCELLED');
        emit('ready'); return status();
      } catch (error) { closeInstance(current, error.code ? error : playerError('MPV_START_FAILED')); throw error.code ? error : playerError('MPV_START_FAILED'); }
    })();
    starting = promise;
    promise.finally(() => { if (starting === promise) starting = null; }).catch(() => {});
    return promise;
  }
  function load(url, { sourceId = '', volume, paused = false, time = 0 } = {}) {
    const generation = ++loadGeneration; queueGeneration++;
    if (pendingLoad) settleLoad(pendingLoad, playerError('MPV_CANCELLED'));
    const load = { generation, sourceId: opaqueSource(sourceId), entryId: null, instance: null, done: false };
    const promise = new Promise((resolve, reject) => { load.resolve = resolve; load.reject = reject; });
    load.promise = promise; pendingLoad = load;
    load.timer = setTimeout(() => { if (pendingLoad === load) { failLoad(load, playerError('MPV_TIMEOUT')); const current = instance; if (current) command(current, ['stop']).catch(() => {}); } }, loadTimeoutMs);
    const check = () => { if (load.done || generation !== loadGeneration) throw playerError('MPV_CANCELLED'); };
    (async () => {
      try {
        await start(); check();
        const current = instance; load.instance = current;
        current.sources.set(url, load.sourceId);
        if (Number.isFinite(Number(volume))) wantedVolume = Math.max(0, Math.min(100, Number(volume)));
        await command(current, ['set_property', 'volume', wantedVolume]); check();
        await command(current, ['set_property', 'pause', Boolean(paused)]); check();
        const startTime = Math.max(0, Number(time) || 0);
        await command(current, ['loadfile', url, 'replace', -1, { start: String(startTime) }]); check();
        const playlist = await command(current, ['get_property', 'playlist']); check();
        updatePlaylist(current, playlist);
        const entry = playlist?.find(item => item.filename === url);
        if (!entry || !Number.isFinite(Number(entry.id))) throw playerError('MPV_LOAD_FAILED');
        load.entryId = Number(entry.id); current.entries.set(load.entryId, load.sourceId);
        if (current.entryId === load.entryId) observed.sourceId = load.sourceId;
        completeLoaded(current);
      } catch (error) { if (!load.done) failLoad(load, error.code === 'MPV_CANCELLED' ? error : playerError(error.code === 'MPV_TIMEOUT' ? 'MPV_TIMEOUT' : 'MPV_LOAD_FAILED')); }
    })();
    return promise;
  }
  async function append(url, { sourceId = '' } = {}) {
    const generation = loadGeneration, queue = queueGeneration;
    if (pendingLoad) await pendingLoad.promise;
    if (generation !== loadGeneration || queue !== queueGeneration || !status().active || !observed.sourceId) throw playerError('MPV_CANCELLED');
    const current = instance;
    current.sources.set(url, opaqueSource(sourceId));
    const oldIds = new Set(current.playlist.map(entry => Number(entry.id)));
    await command(current, ['loadfile', url, 'append']);
    const playlist = await command(current, ['get_property', 'playlist']);
    if (instance !== current || generation !== loadGeneration || queue !== queueGeneration) throw playerError('MPV_CANCELLED');
    updatePlaylist(current, playlist);
    const entry = playlist?.find(item => item.filename === url && !oldIds.has(Number(item.id)));
    if (!entry) throw playerError('MPV_COMMAND_FAILED');
    current.entries.set(Number(entry.id), opaqueSource(sourceId));
    return status();
  }
  async function clearPlaylist() {
    queueGeneration++;
    if (instance?.ready) await command(instance, ['playlist-clear']);
    return status();
  }
  async function transport(args, name) {
    const current = instance;
    if (current?.ready) {
      await command(current, args);
      const value = await command(current, ['get_property', name]);
      if (instance === current) property(current, name, value);
    }
    return status();
  }
  const pause = value => transport(['set_property', 'pause', Boolean(value)], 'pause');
  const seek = seconds => transport(['seek', Math.max(0, Number(seconds) || 0), 'absolute+exact'], 'time-pos');
  async function setVolume(percent) {
    wantedVolume = Math.max(0, Math.min(100, Number(percent) || 0));
    if (instance?.ready) return transport(['set_property', 'volume', wantedVolume], 'volume');
    else observed.volume = wantedVolume;
    return status();
  }
  function stop() {
    loadGeneration++; queueGeneration++;
    if (pendingLoad) settleLoad(pendingLoad, playerError('MPV_CANCELLED'));
    const current = instance; instance = null; starting = null;
    if (current) {
      current.connectCancel?.();
      for (const request of current.requests.values()) { clearTimeout(request.timer); request.reject(playerError('MPV_CANCELLED')); }
      current.requests.clear(); current.socket?.destroy();
      try { current.child?.kill(); } catch { /* already exited */ }
    }
    observed = emptyState(); emit('end-file', { reason: 'stop' }); return status();
  }
  return { start, load, append, clearPlaylist, pause, seek, setVolume, stop, dispose: stop, status, get available() { return Boolean(detectedExe); }, get executable() { return detectedExe; } };
}

module.exports = { createMpvPlayer, findMpv };
