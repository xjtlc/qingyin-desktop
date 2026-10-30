'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.join(__dirname, '..');
const hash = 'a'.repeat(32), secondHash = 'b'.repeat(32);
const session = { platform: 'lite', cookie: { token: 'private-login', userid: 42, auth: 'private-persisted-auth', dfid: 'stable' } };
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
function clock() {
  let time = 0; const timers = new Map();
  return { now: () => time,
    setTimer(callback, delay) { const id = Symbol(); timers.set(id, { callback, at: time + delay }); return id; },
    clearTimer: id => timers.delete(id),
    advance(delay) { time += delay; for (const [id, timer] of timers) if (timer.at <= time) { timers.delete(id); timer.callback(); } },
    pending: () => timers.size };
}
function harness(overrides = {}, options = {}) {
  const calls = [], saves = [];
  const modules = ['user_verify', 'song_auth', 'song_url', 'song_url_auth', 'privilege_lite', 'login_qr_key', 'login_qr_create', 'login_qr_check', 'user_detail'];
  for (const name of modules) {
    const filename = require.resolve(path.join(root, 'vendor/kugou-api/module', `${name}.js`));
    require.cache[filename] = { id: filename, filename, loaded: true, exports: async (params, request) => {
      calls.push({ name, params });
      if (overrides[name]) return overrides[name](params, request);
      if (name === 'user_verify') return { body: { status: 1, data: { auth: 'private-fresh-auth' } }, cookie: [] };
      if (name === 'song_auth') return { body: { status: 1, data: { auth: 'private-song-grant' } }, cookie: [] };
      if (name === 'song_url_auth') return { body: { url: 'https://audio.kugou.com/full.mp3', extName: 'mp3' }, cookie: [] };
      if (name === 'login_qr_key') return { body: { data: { qrcode: 'concept-qr' } }, cookie: [] };
      if (name === 'login_qr_create') return { body: { data: { base64: 'data:image/png;base64,fixture' } }, cookie: [] };
      if (name === 'login_qr_check') return { body: { data: { status: 4, token: 'private-new-login', userid: 84 } }, cookie: [] };
      return { body: { status: 1, data: {} }, cookie: [] };
    } };
  }
  const filename = require.resolve('../lib/kugou.cjs'); delete require.cache[filename];
  const api = require(filename).createKugouAdapter({ loadSession: () => structuredClone(session), saveSession: value => { saves.push(structuredClone(value)); }, ...options });
  return { api, calls, saves, play: (value = hash) => api.invoke('songUrl', { hash: value, quality: '128' }) };
}

test('a persisted user grant is refreshed before membership authorization and never exposed', async () => {
  const h = harness({ user_verify: () => ({ body: { status: 1 }, cookie: ['auth=private-cookie-grant; Path=/'] }) });
  const result = await h.play();
  assert.equal(result.ok, true);
  assert.equal(JSON.stringify(result).includes('private-'), false);
  assert.equal(h.calls.find(call => call.name === 'user_verify').params.cookie.auth, undefined);
  assert.equal(h.calls.find(call => call.name === 'song_auth').params.auth, 'private-cookie-grant');
  assert.equal(h.saves.at(-1).cookie.auth, 'private-cookie-grant');
  assert.deepEqual(h.calls.map(call => call.name), ['song_url', 'user_verify', 'song_auth', 'song_url_auth']);
});

test('verified user grants are reused briefly and refreshed after the in-memory TTL', async () => {
  const timer = clock(); let grants = 0;
  const h = harness({ user_verify: () => ({ body: { data: { auth: `private-fresh-${++grants}` } }, cookie: [] }) }, timer);
  assert.equal((await h.play()).ok, true);
  assert.equal((await h.play(secondHash)).ok, true);
  assert.equal(grants, 1);
  timer.advance(180001);
  assert.equal((await h.play()).ok, true);
  assert.equal(grants, 2);
  assert.deepEqual(h.calls.filter(call => call.name === 'song_auth').map(call => call.params.auth), ['private-fresh-1', 'private-fresh-1', 'private-fresh-2']);
  assert.equal(timer.pending(), 0);
});

test('concurrent songs share verification while preserving their individual resolution deadlines', async () => {
  const axios = require('axios'), timer = clock(), entered = deferred(), verification = deferred();
  const h = harness({ user_verify: () => {
    assert.equal(axios[Symbol.for('qingyin.kugou.request-budget')].getStore(), undefined);
    entered.resolve(); return verification.promise;
  } }, timer);
  const first = h.play(); await entered.promise;
  timer.advance(10000); const second = h.play(secondHash);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.calls.filter(call => call.name === 'user_verify').length, 1);
  timer.advance(20000);
  assert.equal((await first).code, 'TIMEOUT');
  verification.resolve({ body: { status: 1, data: { auth: 'private-shared-grant' } }, cookie: [] });
  assert.equal((await second).ok, true);
  assert.deepEqual(h.calls.filter(call => call.name === 'song_auth').map(call => call.params.hash), [secondHash]);
  assert.equal(timer.pending(), 0);
});

test('a verification completed after logout cannot restore account grants', async () => {
  const entered = deferred(), verification = deferred();
  const h = harness({ user_verify: () => { entered.resolve(); return verification.promise; } });
  const pending = h.play(); await entered.promise;
  await h.api.invoke('logout');
  verification.resolve({ body: { data: { auth: 'private-late-grant' } }, cookie: ['auth=private-late-grant'] });
  assert.equal((await pending).code, 'SESSION_EXPIRED');
  assert.equal(h.saves.at(-1).cookie.auth, undefined);
  assert.equal(h.saves.at(-1).cookie.token, undefined);
  assert.equal(h.calls.some(call => call.name === 'song_auth'), false);
});

test('a new login has its own verification and cannot inherit a previous pending grant', async () => {
  const entered = deferred(), verification = deferred(); let verifies = 0;
  const h = harness({ user_verify: () => {
    if (++verifies === 1) { entered.resolve(); return verification.promise; }
    return { body: { data: { auth: 'private-new-account-grant' } }, cookie: [] };
  } });
  const old = h.play(); await entered.promise;
  await h.api.invoke('logout');
  const qr = await h.api.invoke('qrStart');
  assert.equal((await h.api.invoke('qrCheck', { key: qr.data.key })).data.status, 'success');
  assert.equal((await h.play(secondHash)).ok, true);
  verification.resolve({ body: { data: { auth: 'private-old-account-grant' } }, cookie: [] });
  assert.equal((await old).code, 'SESSION_EXPIRED');
  assert.equal(h.saves.at(-1).cookie.auth, 'private-new-account-grant');
  assert.equal(h.saves.at(-1).cookie.userid, '84');
  assert.equal(verifies, 2);
});

test('a rejected authorization grant permits only one ordinary verification and retry', async () => {
  let verifies = 0;
  const h = harness({
    user_verify: () => ({ body: { data: { auth: `private-grant-${++verifies}` } }, cookie: [] }),
    song_auth: params => {
      if (params.auth === 'private-grant-1') throw { status: 502, body: { error_code: 401 } };
      return { body: { data: { auth: 'private-song-grant' } }, cookie: [] };
    },
  });
  assert.equal((await h.play()).ok, true);
  assert.equal(verifies, 2);
  assert.deepEqual(h.calls.filter(call => call.name === 'song_auth').map(call => call.params.auth), ['private-grant-1', 'private-grant-2']);
});

test('persistent authorization rejection cannot cause a verification retry loop', async () => {
  let verifies = 0;
  const h = harness({
    user_verify: () => ({ body: { data: { auth: `private-grant-${++verifies}` } }, cookie: [] }),
    song_auth: () => { throw { status: 403, body: { errmsg: 'authorization expired' } }; },
    song_url: params => ({ body: params.free_part ? { url: 'https://audio.kugou.com/preview.mp3', extName: 'mp3' } : {}, cookie: [] }),
  });
  const result = await h.play();
  assert.equal(result.ok, true);
  assert.equal(result.data.preview, true);
  assert.equal(verifies, 2);
  assert.equal(h.calls.filter(call => call.name === 'song_auth').length, 2);
});

test('concurrent rejected grants share their one replacement verification', async () => {
  const entered = deferred(), replacement = deferred(); let verifies = 0;
  const h = harness({
    user_verify: () => {
      if (++verifies === 1) return { body: { data: { auth: 'private-original-grant' } }, cookie: [] };
      entered.resolve(); return replacement.promise;
    },
    song_auth: params => {
      if (params.auth === 'private-original-grant') throw { status: 403 };
      return { body: { data: { auth: 'private-song-grant' } }, cookie: [] };
    },
  });
  const first = h.play(), second = h.play(secondHash);
  await entered.promise; await new Promise(resolve => setImmediate(resolve));
  assert.equal(verifies, 2);
  replacement.resolve({ body: { data: { auth: 'private-replacement-grant' } }, cookie: [] });
  assert.equal((await first).ok, true);
  assert.equal((await second).ok, true);
  assert.equal(verifies, 2);
  assert.equal(h.calls.filter(call => call.name === 'song_auth').length, 4);
});

test('security challenges and expired login tokens stop instead of refreshing track authorization', async t => {
  for (const [error, code] of [[{ status: 428, body: { error_code: 'SECURITY_VERIFICATION_REQUIRED' } }, 'SECURITY_VERIFICATION_REQUIRED'], [{ status: 401, body: { errmsg: 'token expired' } }, 'LOGIN_REQUIRED']]) {
    await t.test(code, async () => {
      const h = harness({ song_auth: () => { throw error; } });
      assert.equal((await h.play()).code, code);
      assert.equal(h.calls.filter(call => call.name === 'user_verify').length, 1);
      assert.equal(h.calls.filter(call => call.name === 'song_auth').length, 1);
      assert.equal(h.calls.some(call => call.params.free_part), false);
    });
  }
});

test('an empty verification response never silently reuses the persisted grant', async () => {
  const h = harness({ user_verify: () => ({ body: { status: 1, data: {} }, cookie: [] }) });
  assert.equal((await h.play()).code, 'AUTH_REQUIRED');
  assert.equal(h.calls.some(call => call.name === 'song_auth'), false);
  assert.equal(h.calls.some(call => call.params.free_part), false);
});
