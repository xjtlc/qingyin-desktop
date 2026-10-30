'use strict';

// The deadline belongs to the main process, so hidden renderer throttling cannot
// delay sleep playback. The controller has no access to account or stored data.
function createSleepTimer({ now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, onExpire = () => {} } = {}) {
  const off = () => ({ active: false, mode: 'off', minutes: null, endsAt: null });
  let state = off();
  let timer = null;
  let generation = 0;
  const status = () => ({ ...state });
  const result = extra => ({ ok: true, state: status(), ...extra });

  function clear() {
    generation++;
    if (timer !== null) clearTimer(timer);
    timer = null;
  }
  function expire(reason) {
    if (!state.active) return false;
    const previousState = status();
    clear();
    state = off();
    // Reset before notifying, including if a listener asks for status or arms a
    // replacement timer while handling this one.
    try { onExpire({ type: 'sleep-timer', action: 'expired', reason, state: status(), previousState }); } catch { /* listener isolation */ }
    return true;
  }
  function schedule(expectedGeneration) {
    timer = setTimer(() => {
      if (expectedGeneration !== generation || state.mode !== 'minutes') return;
      timer = null;
      if (now() < state.endsAt) schedule(expectedGeneration);
      else expire('timer');
    }, Math.max(0, state.endsAt - now()));
    timer?.unref?.();
  }
  function set(options) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) return { ok: false, error: '定时停止设置无效', state: status() };
    if (options.mode !== 'after-track' && options.mode !== 'minutes') return { ok: false, error: '请选择停止方式', state: status() };
    if (options.mode === 'minutes' && (typeof options.minutes !== 'number' || !Number.isInteger(options.minutes) || options.minutes < 1 || options.minutes > 180)) {
      return { ok: false, error: '请输入 1 至 180 之间的整数分钟', state: status() };
    }
    clear();
    state = options.mode === 'after-track'
      ? { active: true, mode: 'after-track', minutes: null, endsAt: null }
      : { active: true, mode: 'minutes', minutes: options.minutes, endsAt: now() + options.minutes * 60_000 };
    if (state.mode === 'minutes') schedule(generation);
    return result();
  }
  function cancel() { clear(); state = off(); return result(); }
  function trackEnded() { return result({ consumed: state.mode === 'after-track' && expire('track-ended') }); }
  return { set, cancel, status, trackEnded, dispose: cancel };
}

module.exports = { createSleepTimer };
