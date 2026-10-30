'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.join(__dirname, '..');
const modules = ['user_playlist', 'playlist_track_all_new', 'playlist_track_all', 'user_detail', 'login_token', 'register_dev'];
const hash = '1234567890ABCDEF1234567890ABCDEF';
const oldToken = 'fixture-private-old-token';
const newToken = 'fixture-private-renewed-token';
const oldAuth = 'fixture-private-old-auth';
const session = () => ({ platform: 'lite', cookie: {
  userid: '42', token: oldToken, auth: oldAuth, dfid: 'fixture-old-dfid',
  KUGOU_API_GUID: 'fixture-stable-guid', KUGOU_API_MID: 'fixture-stable-mid',
  KUGOU_API_DEV: 'fixture-stable-dev', KUGOU_API_MAC: '02:00:00:00:00:00',
}, user: { id: '42', name: '验证账号' } });
const rejected = code => ({ status: 502, body: { status: 0, error_code: code } });
const playlists = () => ({ body: { status: 1, data: { total: 1, info: [
  { global_collection_id: 'collection_fixture', listid: '1', name: '我喜欢', count: 434 },
] } }, cookie: [] });
const tracks = () => ({ body: { status: 1, data: { total: 1, info: [
  { hash, name: '歌手 - 歌曲', duration: 180 },
] } }, cookie: [] });
const renewed = () => ({ body: { status: 1, data: { userid: 42, token: newToken, t1: 'fixture-private-t1' } }, cookie: [] });
const defer = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness(t, overrides) {
  const calls = [], writes = [], originals = new Map();
  for (const name of modules) {
    const filename = require.resolve(path.join(root, 'vendor', 'kugou-api', 'module', `${name}.js`));
    originals.set(filename, require.cache[filename]);
    require.cache[filename] = { id: filename, filename, loaded: true, exports: async params => {
      calls.push({ name, params: structuredClone(params) });
      if (!overrides[name]) throw new Error(`Unexpected fixture module: ${name}`);
      return overrides[name](params);
    } };
  }
  t.after(() => { for (const [filename, original] of originals) { if (original) require.cache[filename] = original; else delete require.cache[filename]; } });
  const filename = require.resolve(path.join(root, 'lib', 'kugou.cjs'));
  delete require.cache[filename];
  const { createKugouAdapter } = require(filename);
  const api = createKugouAdapter({ loadSession: session, saveSession: value => { writes.push(structuredClone(value)); } });
  return { api, calls, writes, saved: () => writes.at(-1) };
}
function noSecrets(result) {
  const text = JSON.stringify(result);
  for (const secret of [oldToken, newToken, oldAuth, 'fixture-private-t1', 'fixture-private-vip', 'private.invalid']) assert.equal(text.includes(secret), false);
}

test('20017 followed by confirmed 20018 expiry reports login required and preserves account and known playlists', async t => {
  let reads = 0;
  const h = harness(t, {
    user_playlist: () => { if (++reads === 1) return playlists(); throw rejected(20017); },
    user_detail: () => { throw rejected(20018); },
    login_token: () => { throw rejected(20018); },
    playlist_track_all_new: params => { assert.equal(params.listid, '1'); return tracks(); },
  });
  assert.equal((await h.api.invoke('playlists')).data.playlists.length, 1);
  const previous = structuredClone(h.saved());
  const failed = await h.api.invoke('playlists');
  assert.equal(failed.code, 'LOGIN_REQUIRED');
  noSecrets(failed);
  assert.deepEqual(h.saved(), previous);
  assert.equal((await h.api.invoke('status')).data.loggedIn, true);
  assert.equal((await h.api.invoke('playlistSongs', { id: 'collection_fixture' })).data.songs.length, 1);
  assert.deepEqual(h.calls.map(call => call.name), ['user_playlist', 'user_playlist', 'user_detail', 'login_token', 'playlist_track_all_new']);
});

test('a renewable private playlist session retries once with the new token and saves only permitted account fields', async t => {
  const h = harness(t, {
    user_playlist: params => { if (params.cookie.token === oldToken) throw rejected(152); return playlists(); },
    login_token: () => ({ body: { status: 1, data: {
      userid: 42, token: newToken, auth: 'untrusted-auth', KUGOU_API_GUID: 'untrusted-device', arbitrary: 'untrusted-field',
    } }, cookie: ['token=' + newToken, 'userid=42', 't1=fixture-private-t1', 'vip_token=fixture-private-vip', 'arbitrary=untrusted-field', 'dfid=untrusted-dfid'] }),
  });
  const result = await h.api.invoke('playlists');
  assert.equal(result.ok, true);
  assert.equal(result.data.playlists[0].count, 434);
  assert.deepEqual(h.calls.map(call => call.name), ['user_playlist', 'login_token', 'user_playlist']);
  assert.equal(h.calls.at(-1).params.cookie.token, newToken);
  assert.equal(h.saved().cookie.token, newToken);
  assert.equal(h.saved().cookie.userid, '42');
  assert.equal(h.saved().cookie.auth, undefined);
  assert.equal(h.saved().cookie.arbitrary, undefined);
  assert.equal(h.saved().cookie.KUGOU_API_GUID, session().cookie.KUGOU_API_GUID);
  assert.equal(h.saved().cookie.dfid, session().cookie.dfid);
  noSecrets(result);
});

test('a live account rejected by cloud lists refreshes its own device registration and retries once', async t => {
  const h = harness(t, {
    user_playlist: params => { if (params.cookie.dfid === 'fixture-old-dfid') throw rejected(20017); return playlists(); },
    user_detail: () => ({ body: { status: 1, data: { userid: 42 } }, cookie: ['token=untrusted-detail-token'] }),
    register_dev: params => {
      assert.equal(params.cookie.KUGOU_API_GUID, session().cookie.KUGOU_API_GUID);
      assert.equal(params.cookie.KUGOU_API_MID, session().cookie.KUGOU_API_MID);
      return { body: { status: 1, data: { dfid: 'fixture-renewed-dfid' } }, cookie: ['dfid=fixture-renewed-dfid; Path=/', 'token=untrusted-registration-token'] };
    },
  });
  const result = await h.api.invoke('playlists');
  assert.equal(result.ok, true);
  assert.deepEqual(h.calls.map(call => call.name), ['user_playlist', 'user_detail', 'register_dev', 'user_playlist']);
  assert.equal(h.saved().cookie.dfid, 'fixture-renewed-dfid');
  assert.equal(h.saved().cookie.token, oldToken);
  assert.equal(h.saved().cookie.KUGOU_API_GUID, session().cookie.KUGOU_API_GUID);
  noSecrets(result);
});

test('simultaneous private list and track failures share one account renewal', async t => {
  const refresh = defer(), entered = defer();
  const h = harness(t, {
    user_playlist: params => { if (params.cookie.token === oldToken) throw rejected(20018); return playlists(); },
    playlist_track_all_new: params => { if (params.cookie.token === oldToken) throw rejected(152); return tracks(); },
    login_token: () => { entered.resolve(); return refresh.promise; },
  });
  const list = h.api.invoke('playlists');
  await entered.promise;
  const songs = h.api.invoke('playlistSongs', { id: 'private', listId: '1' });
  await tick();
  assert.equal(h.calls.filter(call => call.name === 'login_token').length, 1);
  refresh.resolve(renewed());
  const results = await Promise.all([list, songs]);
  assert.equal(results.every(result => result.ok), true);
  assert.equal(h.calls.filter(call => call.name === 'login_token').length, 1);
  assert.equal(h.calls.filter(call => ['user_playlist', 'playlist_track_all_new'].includes(call.name) && call.params.cookie.token === newToken).length, 2);
  results.forEach(noSecrets);
});

test('a delayed rejection of the old dfid reuses registration already repaired by another private request', async t => {
  const delayedFailure = defer(), firstEntered = defer();
  const h = harness(t, {
    user_playlist: params => {
      if (params.cookie.dfid === 'fixture-old-dfid') { firstEntered.resolve(); return delayedFailure.promise; }
      return playlists();
    },
    playlist_track_all_new: params => { if (params.cookie.dfid === 'fixture-old-dfid') throw rejected(20017); return tracks(); },
    user_detail: () => ({ body: { status: 1 }, cookie: [] }),
    register_dev: () => ({ body: { status: 1 }, cookie: ['dfid=fixture-renewed-dfid'] }),
  });
  const list = h.api.invoke('playlists');
  await firstEntered.promise;
  assert.equal((await h.api.invoke('playlistSongs', { id: 'private', listId: '1' })).ok, true);
  delayedFailure.reject(rejected(20017));
  const result = await list;
  assert.equal(result.ok, true);
  assert.equal(h.calls.filter(call => call.name === 'register_dev').length, 1);
  assert.equal(h.calls.filter(call => call.name === 'user_detail').length, 1);
  assert.equal(h.saved().cookie.token, oldToken);
  noSecrets(result);
});

test('logout during token renewal cannot restore account cookies or return private playlists', async t => {
  const refresh = defer(), entered = defer();
  const h = harness(t, {
    user_playlist: () => { throw rejected(152); },
    login_token: () => { entered.resolve(); return refresh.promise; },
  });
  const pending = h.api.invoke('playlists');
  await entered.promise;
  await h.api.invoke('logout');
  const afterLogout = structuredClone(h.saved());
  refresh.resolve(renewed());
  const result = await pending;
  assert.equal(result.code, 'LOGIN_REQUIRED');
  assert.equal(result.data, undefined);
  assert.deepEqual(h.saved(), afterLogout);
  for (const key of ['token', 'userid', 'auth', 'vip_token', 't1']) assert.equal(h.saved().cookie[key], undefined);
  assert.equal((await h.api.invoke('status')).data.loggedIn, false);
  assert.equal(h.calls.filter(call => call.name === 'user_playlist').length, 1);
  noSecrets(result);
});

test('logout during device registration cannot restore the old account or new dfid', async t => {
  const registration = defer(), entered = defer();
  const h = harness(t, {
    user_playlist: () => { throw rejected(20017); },
    user_detail: () => ({ body: { status: 1 }, cookie: [] }),
    register_dev: () => { entered.resolve(); return registration.promise; },
  });
  const pending = h.api.invoke('playlists');
  await entered.promise;
  await h.api.invoke('logout');
  const previous = structuredClone(h.saved());
  registration.resolve({ body: { status: 1 }, cookie: ['dfid=late-device', 'token=' + newToken] });
  assert.equal((await pending).code, 'LOGIN_REQUIRED');
  assert.deepEqual(h.saved(), previous);
  assert.equal(h.saved().cookie.dfid, session().cookie.dfid);
  assert.equal((await h.api.invoke('status')).data.loggedIn, false);
});

test('SSA challenges on list fetch, account verification or renewal stop recovery immediately', async t => {
  for (const stage of ['list', 'detail', 'refresh']) await t.test(stage, async st => {
    const challenge = () => { throw { status: 428, headers: { 'ssa-code': 'fixture-challenge' }, body: { status: 0, error_code: 'SECURITY_VERIFICATION_REQUIRED', msg: 'https://private.invalid?token=' + oldToken } }; };
    const h = harness(st, {
      user_playlist: () => { if (stage === 'list') return challenge(); throw rejected(stage === 'detail' ? 20017 : 152); },
      user_detail: challenge,
      login_token: challenge,
    });
    const result = await h.api.invoke('playlists');
    assert.equal(result.code, 'SECURITY_VERIFICATION_REQUIRED');
    assert.equal(h.calls.filter(call => call.name === 'user_playlist').length, 1);
    assert.equal(h.calls.some(call => call.name === 'register_dev'), false);
    assert.equal(h.calls.some(call => call.name === 'login_token'), stage === 'refresh');
    assert.equal(h.saved().cookie.token, oldToken);
    noSecrets(result);
  });
});

test('network timeouts keep their timeout classification and do not trigger account renewal', async t => {
  const h = harness(t, { user_playlist: () => { throw { body: { status: 0, msg: { code: 'ECONNABORTED', message: 'https://private.invalid?token=' + oldToken } } }; } });
  const result = await h.api.invoke('playlists');
  assert.equal(result.code, 'TIMEOUT');
  assert.deepEqual(h.calls.map(call => call.name), ['user_playlist']);
  noSecrets(result);
});

test('a temporary recovery timeout can be retried by refreshing again', async t => {
  let refreshes = 0;
  const h = harness(t, {
    user_playlist: params => { if (params.cookie.token === oldToken) throw rejected(20018); return playlists(); },
    login_token: () => { if (++refreshes === 1) throw { body: { msg: { code: 'ETIMEDOUT' } } }; return renewed(); },
  });
  assert.equal((await h.api.invoke('playlists')).code, 'TIMEOUT');
  assert.equal(h.saved().cookie.token, oldToken);
  assert.equal((await h.api.invoke('playlists')).ok, true);
  assert.equal(refreshes, 2);
});

test('a renewal for another user is rejected without replacing the saved account', async t => {
  const h = harness(t, {
    user_playlist: () => { throw rejected(152); },
    login_token: () => ({ body: { status: 1, data: { userid: 43, token: newToken } }, cookie: [] }),
  });
  await h.api.invoke('status');
  const previous = structuredClone(h.saved());
  const result = await h.api.invoke('playlists');
  assert.equal(result.code, 'LOGIN_REQUIRED');
  assert.deepEqual(h.saved(), previous);
  assert.equal(h.calls.filter(call => call.name === 'user_playlist').length, 1);
  noSecrets(result);
});

test('a rejected retry terminates after one renewal instead of recursing indefinitely', async t => {
  const h = harness(t, { user_playlist: () => { throw rejected(20018); }, login_token: renewed });
  const result = await h.api.invoke('playlists');
  assert.equal(result.code, 'LOGIN_REQUIRED');
  assert.deepEqual(h.calls.map(call => call.name), ['user_playlist', 'login_token', 'user_playlist']);
  noSecrets(result);
});
