'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.join(__dirname, '..');
// Load the adapter first so the upstream constants select the concept appid.
const { createKugouAdapter } = require('../lib/kugou.cjs');
const personalFmRequest = require('../vendor/kugou-api/module/personal_fm.js');
const dailyRequest = require('../vendor/kugou-api/module/recommend_songs.js');
const hash = '0123456789ABCDEF0123456789ABCDEF';
const otherHash = 'FEDCBA9876543210FEDCBA9876543210';
const session = { platform: 'lite', cookie: { token: 'private-login-token', userid: 42, dfid: 'stable-device' } };
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };

function harness(overrides = {}, initialSession = session) {
  const calls = [], saves = [];
  const modules = ['recommend_songs', 'personal_fm', 'top_playlist', 'login_qr_key', 'login_qr_create', 'login_qr_check', 'user_detail'];
  for (const name of modules) {
    const filename = require.resolve(path.join(root, 'vendor/kugou-api/module', `${name}.js`));
    require.cache[filename] = { id: filename, filename, loaded: true, exports: async params => {
      calls.push({ name, params });
      if (overrides[name]) return overrides[name](params);
      if (name === 'login_qr_key') return { body: { data: { qrcode: 'replacement-account' } }, cookie: [] };
      if (name === 'login_qr_create') return { body: { data: { base64: 'data:image/png;base64,fixture' } }, cookie: [] };
      if (name === 'login_qr_check') return { body: { data: { status: 4, token: 'private-new-token', userid: 84 } }, cookie: [] };
      return { body: { status: 1, data: { songs: [{ hash, songname: 'Song', singername: 'Artist' }] } }, cookie: [] };
    } };
  }
  const api = createKugouAdapter({ loadSession: () => structuredClone(initialSession), saveSession: value => saves.push(structuredClone(value)) });
  return { api, calls, saves };
}

test('both personalized endpoints require concept login before any provider request', async () => {
  const h = harness({}, null);
  for (const method of ['dailyRecommendations', 'guessYouLike']) assert.equal((await h.api.invoke(method)).code, 'LOGIN_REQUIRED');
  assert.equal(h.calls.length, 0);
});

test('daily recommendations retain provider order, nested metadata and account identity', async () => {
  const h = harness({ recommend_songs: () => ({ body: { status: 1, data: { date: '2026-10-10', songs: [
    { base: { hash: hash.toLowerCase(), filename: 'Singer - First.mp3', timelen: 208500, album_audio_id: 101, album_id: 7, album_name: 'Album' }, authors: [{ author_name: 'Singer' }, { author_name: 'Guest' }], cover: 'http://img.kugou.com/cover/{size}.jpg', token: 'do-not-return' },
    { song: { base: { hash: otherHash, songname: 'Second', duration: 180 }, singerinfo: [{ name: 'Other singer' }], sizable_cover: 'https://img.kugou.com/other/{size}.jpg' } },
    { hash: 'invalid', name: 'Not playable' },
  ] } }, cookie: [] }) });
  const result = await h.api.invoke('dailyRecommendations');
  assert.equal(result.ok, true);
  assert.equal(result.data.source, 'kugou-daily');
  assert.equal(result.data.accountId, '42');
  assert.equal(result.data.date, '2026-10-10');
  assert.deepEqual(result.data.songs.map(song => song.hash), [hash, otherHash]);
  assert.deepEqual(result.data.songs[0], { id: hash, hash, title: 'First', artist: 'Singer / Guest', album: 'Album', albumId: '7', albumAudioId: '101', cover: 'https://img.kugou.com/cover/400.jpg', duration: 208.5, artistId: 0 });
  assert.equal(result.data.songs[1].artist, 'Other singer');
  assert.equal(result.data.songs[1].cover, 'https://img.kugou.com/other/400.jpg');
  assert.equal(JSON.stringify(result).includes('private-'), false);
  assert.equal(JSON.stringify(result).includes('do-not-return'), false);
  assert.deepEqual(h.calls.map(call => call.name), ['recommend_songs']);
  assert.equal(h.calls[0].params.platform, 'android');
  assert.equal(h.calls[0].params.cookie.KUGOU_API_PLATFORM, 'lite');
});

test('guess-you-like performs only the initial read and ignores renderer feedback parameters', async () => {
  const h = harness({ personal_fm: () => ({ body: { status: 1, data: { song_list: [{ hash, songname: 'First', singer: 'Singer' }, { hash: otherHash, name: 'Second' }] } }, cookie: [] }) });
  const result = await h.api.invoke('guessYouLike', { action: 'click_red', hash, songid: 55, playtime: 120, cur_mark: 'private-mark', remain_songcnt: 99, platform: 'standard', mode: 'radio' });
  assert.equal(result.ok, true);
  assert.equal(result.data.source, 'kugou-personal-fm');
  assert.equal(result.data.accountId, '42');
  assert.deepEqual(result.data.songs.map(song => song.hash), [hash, otherHash]);
  assert.equal(result.data.songs[0].artist, 'Singer');
  assert.deepEqual(h.calls.map(call => call.name), ['personal_fm']);
  assert.deepEqual(Object.keys(h.calls[0].params).sort(), ['action', 'cookie', 'platform', 'remain_songcnt']);
  assert.equal(h.calls[0].params.action, 'login');
  assert.equal(h.calls[0].params.remain_songcnt, 0);
});

test('real daily and personal-FM field layouts preserve authors, album, artwork and duration', async () => {
  const h = harness({
    recommend_songs: () => ({ body: { status: 1, error_code: 0, data: { song_list: [{ hash, songname: 'Daily song', author_name: 'Daily singer', singerinfo: [], album_name: 'Daily album', album_audio_id: 101, sizable_cover: 'http://img.kugou.com/daily/{size}.jpg', time_length: 205000 }] } }, cookie: [] }),
    personal_fm: () => ({ body: { status: 1, error_code: 0, data: { song_list: [
      { hash, songname: 'FM song', author_name: 'FM singer', singerinfo: [{ name: 'FM singer' }], mixsongid: 202, time_length: 180000, trans_param: { union_cover: 'http://img.kugou.com/fm/{size}.jpg' }, relate_goods: [{ albumname: 'FM album', info: { image: 'http://img.kugou.com/related/{size}.jpg' } }] },
      { hash: otherHash, songname: 'Other FM song', cover: 'invalid-provider-value', trans_param: { union_cover: '' }, relate_goods: [{ albumname: 'Other album', info: { image: 'https://img.kugou.com/other/{size}.jpg' } }] },
    ] } }, cookie: [] }),
  });
  const daily = await h.api.invoke('dailyRecommendations');
  assert.equal(daily.ok, true);
  assert.equal(daily.data.songs[0].artist, 'Daily singer');
  assert.equal(daily.data.songs[0].cover, 'https://img.kugou.com/daily/400.jpg');
  assert.equal(daily.data.songs[0].duration, 205);
  assert.equal(daily.data.songs[0].albumAudioId, '101');
  const fm = await h.api.invoke('guessYouLike');
  assert.equal(fm.ok, true);
  assert.equal(fm.data.songs[0].artist, 'FM singer');
  assert.equal(fm.data.songs[0].album, 'FM album');
  assert.equal(fm.data.songs[0].albumAudioId, '202');
  assert.equal(fm.data.songs[0].duration, 180);
  assert.equal(fm.data.songs[0].cover, 'https://img.kugou.com/fm/400.jpg');
  assert.equal(fm.data.songs[1].album, 'Other album');
  assert.equal(fm.data.songs[1].cover, 'https://img.kugou.com/other/400.jpg');
});

test('upstream requests retain concept identity and use recommendation fetch routes without feedback', async () => {
  const cookie = { ...session.cookie, KUGOU_API_MID: 'stable-mid' };
  const fm = await personalFmRequest({ action: 'login', platform: 'android', remain_songcnt: 0, cookie }, config => config);
  assert.equal(fm.url, '/v2/personal_recommend');
  assert.equal(fm.headers['x-router'], 'persnfm.service.kugou.com');
  assert.equal(fm.data.appid, 3116);
  assert.equal(fm.data.action, 'login');
  assert.equal(fm.data.userid, 42);
  for (const field of ['hash', 'songid', 'playtime', 'cur_mark']) assert.equal(fm.data[field], undefined);
  const daily = await dailyRequest({ platform: 'android', cookie }, config => config);
  assert.equal(daily.url, '/everyday_song_recommend');
  assert.equal(daily.headers['x-router'], 'everydayrec.service.kugou.com');
  assert.equal(daily.data.userid, 42);
  assert.equal(daily.data.platform, 'android');
});

test('only valid provider dates are returned and unavailable dates are not invented', async t => {
  for (const date of [undefined, '2026-02-30', '2026-13-01', 'private-token']) await t.test(String(date), async () => {
    const h = harness({ recommend_songs: () => ({ body: { status: 1, data: { date, songs: [{ hash }] } }, cookie: [] }) });
    const result = await h.api.invoke('dailyRecommendations');
    assert.equal(result.ok, true);
    assert.equal(result.data.date, undefined);
  });
});

test('missing personalized songs and provider rejection never substitute public playlists', async t => {
  for (const method of ['dailyRecommendations', 'guessYouLike']) {
    const moduleName = method === 'dailyRecommendations' ? 'recommend_songs' : 'personal_fm';
    await t.test(`${method}: empty`, async () => {
      const h = harness({ [moduleName]: () => ({ body: { status: 1, data: { songs: [] } }, cookie: [] }) });
      const result = await h.api.invoke(method);
      assert.equal(result.code, 'RECOMMENDATIONS_EMPTY');
      assert.equal(result.data, undefined);
      assert.deepEqual(h.calls.map(call => call.name), [moduleName]);
    });
    await t.test(`${method}: rejected`, async () => {
      const h = harness({ [moduleName]: () => ({ body: { status: 1, errcode: 503, errmsg: 'private-server-details', data: { songs: [{ hash }] } }, cookie: [] }) });
      const result = await h.api.invoke(method);
      assert.equal(result.code, 'RECOMMENDATIONS_UNAVAILABLE');
      assert.equal(JSON.stringify(result).includes('private'), false);
      assert.deepEqual(h.calls.map(call => call.name), [moduleName]);
    });
  }
});

test('expired login and security challenges remain actionable and redact provider details', async t => {
  for (const [error, code] of [
    [{ body: { error_code: 152, errmsg: 'private-token' } }, 'LOGIN_REQUIRED'],
    [{ body: { errmsg: 'token expired: private-token' } }, 'LOGIN_REQUIRED'],
    [{ status: 428, body: { error_code: 'SECURITY_VERIFICATION_REQUIRED', errmsg: 'private-token' } }, 'SECURITY_VERIFICATION_REQUIRED'],
  ]) await t.test(code, async () => {
    const h = harness({ personal_fm: () => { throw error; } });
    const result = await h.api.invoke('guessYouLike');
    assert.equal(result.code, code);
    assert.equal(JSON.stringify(result).includes('private'), false);
  });
});

test('recommendations finishing after logout cannot expose old account results or restore cookies', async t => {
  for (const method of ['dailyRecommendations', 'guessYouLike']) await t.test(method, async () => {
    const entered = deferred(), response = deferred();
    const moduleName = method === 'dailyRecommendations' ? 'recommend_songs' : 'personal_fm';
    const h = harness({ [moduleName]: () => { entered.resolve(); return response.promise; } });
    const pending = h.api.invoke(method); await entered.promise;
    await h.api.invoke('logout');
    response.resolve({ body: { status: 1, data: { songs: [{ hash }] } }, cookie: ['token=private-late-token', 'userid=42'] });
    const result = await pending;
    assert.equal(result.code, 'SESSION_EXPIRED');
    assert.equal(result.data, undefined);
    assert.equal(h.saves.at(-1).cookie.token, undefined);
    assert.equal(h.saves.at(-1).cookie.userid, undefined);
  });
});

test('a replacement login receives its own recommendations while an old request stays invalid', async () => {
  const entered = deferred(), response = deferred(); let reads = 0;
  const h = harness({ recommend_songs: () => {
    if (++reads === 1) { entered.resolve(); return response.promise; }
    return { body: { status: 1, data: { songs: [{ hash: otherHash }] } }, cookie: [] };
  } });
  const old = h.api.invoke('dailyRecommendations'); await entered.promise;
  await h.api.invoke('logout');
  const qr = await h.api.invoke('qrStart');
  assert.equal((await h.api.invoke('qrCheck', { key: qr.data.key })).data.status, 'success');
  const current = await h.api.invoke('dailyRecommendations');
  assert.equal(current.ok, true);
  assert.equal(current.data.accountId, '84');
  assert.equal(current.data.songs[0].hash, otherHash);
  response.resolve({ body: { status: 1, data: { songs: [{ hash }] } }, cookie: ['token=private-old-token', 'userid=42'] });
  assert.equal((await old).code, 'SESSION_EXPIRED');
  assert.equal(h.saves.at(-1).cookie.userid, '84');
  assert.equal(h.saves.at(-1).cookie.token, 'private-new-token');
});
