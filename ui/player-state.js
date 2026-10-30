(function (root, factory) {
  'use strict';
  const exports = factory();
  if (typeof module === 'object' && module.exports) module.exports = exports;
  else root.QingyinPlayerState = exports;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const cancelledError = () => { const error = new Error('播放请求已取消'); error.name = 'AbortError'; error.code = 'PLAYER_CANCELLED'; return error; };
  class PlayerState {
    constructor({ quality = 'auto', now = Date.now, ttl = 600000 } = {}) {
      this.quality = quality; this.session = 0; this.version = 0; this.prefetchVersion = 0;
      this.loadVersion = 0; this.currentLoad = null; this.now = now; this.ttl = ttl;
      this.cache = new Map(); this.inflight = new Map();
    }
    capture() { return { session: this.session, quality: this.quality, version: this.version }; }
    valid(token) { return Boolean(token && token.session === this.session && token.quality === this.quality && token.version === this.version); }
    cacheKey(songKey, token = this.capture()) { return JSON.stringify([token.session, token.quality, songKey]); }
    setQuality(quality, { preserveLocal = false } = {}) {
      if (quality === this.quality) return false;
      this.quality = quality; this.version++; this.invalidatePrefetch();
      if (preserveLocal && this.currentLoad?.songKey.startsWith('local:')) this.currentLoad.capture = this.capture();
      else this.cancelLoad();
      return true;
    }
    resetSession({ preserveLocal = false } = {}) {
      this.session++; this.version++; this.cache.clear(); this.inflight.clear(); this.invalidatePrefetch();
      if (preserveLocal && this.currentLoad?.songKey.startsWith('local:')) this.currentLoad.capture = this.capture();
      else this.cancelLoad();
    }
    invalidatePrefetch() { this.prefetchVersion++; }
    beginPrefetch() { this.invalidatePrefetch(); return { ...this.capture(), prefetchVersion: this.prefetchVersion }; }
    validPrefetch(token) { return this.valid(token) && token.prefetchVersion === this.prefetchVersion; }
    getCached(songKey, token = this.capture()) {
      if (!this.valid(token)) return null;
      const key = this.cacheKey(songKey, token), entry = this.cache.get(key);
      if (!entry) return null;
      if (this.now() - entry.at >= this.ttl) { this.cache.delete(key); return null; }
      return entry.playable;
    }
    forget(songKey) { this.cache.delete(this.cacheKey(songKey)); }
    async resolve(songKey, loader, token = this.capture()) {
      if (!this.valid(token)) throw cancelledError();
      const cached = this.getCached(songKey, token);
      if (cached) return cached;
      const key = this.cacheKey(songKey, token), pending = this.inflight.get(key);
      if (pending && this.valid(pending.token)) return pending.promise;
      const entry = { token, promise: null };
      entry.promise = Promise.resolve().then(() => loader(token)).then(playable => {
        if (!this.valid(token)) throw cancelledError();
        this.cache.set(key, { playable, at: this.now() }); return playable;
      }).finally(() => { if (this.inflight.get(key) === entry) this.inflight.delete(key); });
      this.inflight.set(key, entry); return entry.promise;
    }
    beginLoad(songKey, backend, restore = {}) {
      this.cancelLoad();
      const controller = new AbortController();
      const operation = { request: ++this.loadVersion, songKey, backend, capture: this.capture(), signal: controller.signal, controller, url: '', phase: 'preparing', errorShown: false, cancel: null, restore: { time: Math.max(0, Number(restore.time) || 0), paused: Boolean(restore.paused) } };
      this.currentLoad = operation; return operation;
    }
    current(operation) { return this.currentLoad === operation && !operation.signal.aborted && this.valid(operation.capture); }
    cancelLoad() {
      const previous = this.currentLoad; this.currentLoad = null;
      if (previous && !previous.signal.aborted) previous.controller.abort();
    }
  }
  function transportSnapshot({ backend, sourceId = '', native = null, audio = null, fallbackDuration = 0, restore = {} } = {}) {
    if (backend === 'mpv') {
      const matching = native && native.sourceId === sourceId;
      return { time: matching ? Math.max(0, Number(native.time) || 0) : Math.max(0, Number(restore.time) || 0), duration: matching && Number(native.duration) > 0 ? Number(native.duration) : Math.max(0, Number(fallbackDuration) || 0), paused: matching ? Boolean(native.paused) : true, ready: Boolean(matching && native.active && Number(native.duration) > 0) };
    }
    const duration = Number(audio?.duration);
    return { time: Math.max(0, Number(audio?.currentTime) || 0), duration: Number.isFinite(duration) && duration > 0 ? duration : Math.max(0, Number(fallbackDuration) || 0), paused: audio ? Boolean(audio.paused) : true, ready: Boolean(audio && Number.isFinite(duration) && duration > 0 && audio.readyState >= 3) };
  }
  class FailureNavigator {
    constructor() { this.failed = new Set(); }
    reset() { this.failed.clear(); }
    next(order, currentKey, { wrap = true } = {}) {
      if (currentKey) this.failed.add(currentKey);
      const at = order.indexOf(currentKey);
      for (let offset = 1; offset <= order.length; offset++) {
        const index = at + offset;
        if (!wrap && index >= order.length) break;
        const key = order[index % order.length];
        if (!this.failed.has(key)) return key;
      }
      return null;
    }
  }
  class ProgressWatchdog {
    constructor({ timeout = 20000, maxTickGap = 3000 } = {}) {
      this.timeout = timeout; this.maxTickGap = maxTickGap; this.reset();
    }
    reset() { this.context = null; this.lastTick = null; this.lastProgress = null; this.position = null; }
    check(context, transport, now) {
      if (!context || context.phase !== 'playing' || !context.wantPlayback || !context.url || context.signal?.aborted || context.failureHandled) { this.reset(); return false; }
      const position = Number(transport.time) || 0;
      if (context !== this.context || this.lastTick === null || now - this.lastTick > this.maxTickGap || now < this.lastTick || Math.abs(position - this.position) >= .05) {
        this.context = context; this.lastProgress = now; this.position = position;
      }
      this.lastTick = now;
      if (now - this.lastProgress < this.timeout) return false;
      this.reset(); return true;
    }
  }
  return { PlayerState, cancelledError, transportSnapshot, FailureNavigator, ProgressWatchdog };
});
