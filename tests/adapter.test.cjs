'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.join(__dirname, '..');
const moduleNames = ['login_qr_key', 'login_qr_create', 'login_qr_check', 'register_dev', 'user_detail', 'user_playlist', 'playlist_track_all', 'playlist_track_all_new', 'top_playlist', 'search', 'song_url', 'user_verify', 'song_auth', 'song_url_auth', 'privilege_lite', 'search_lyric', 'lyric'];
const hash = '1234567890ABCDEF1234567890ABCDEF';
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function budgetClock() {
  let time = 0;
  const timers = new Map();
  return {
    now: () => time,
    setTimer: (callback, delay) => { const id = Symbol(); timers.set(id, { callback, at: time + delay }); return id; },
    clearTimer: id => timers.delete(id),
    advance(delay) { time += delay; for (const [id, timer] of timers) if (timer.at <= time) { timers.delete(id); timer.callback(); } },
    pending: () => timers.size,
  };
}
function harness(overrides = {}, initialSession = null, resolveStream, adapterOptions = {}) {
  const calls = [];
  let saved;
  for (const name of moduleNames) {
    const filename = path.join(root, 'vendor', 'kugou-api', 'module', `${name}.js`);
    require.cache[require.resolve(filename)] = { id: filename, filename, loaded: true, exports: async (params, request) => {
      calls.push({ name, params });
      if (overrides[name]) return overrides[name](params, request);
      if (name === 'register_dev') return { body: { status: 1 }, cookie: ['dfid=device-fingerprint'] };
      if (name === 'login_qr_key') return { body: { data: { qrcode: 'concept-target-3116' } }, cookie: [] };
      if (name === 'login_qr_create') return { body: { data: { base64: 'data:image/png;base64,test' } }, cookie: [] };
      if (name === 'user_verify') return { body: { status: 1, data: { auth: 'private-verified-auth' } }, cookie: ['auth=private-verified-auth'] };
      return { body: { status: 1, data: {} }, cookie: [] };
    } };
  }
  const filename = path.join(root, 'lib', 'kugou.cjs');
  delete require.cache[require.resolve(filename)];
  const { createKugouAdapter } = require(filename);
  const api = createKugouAdapter({ loadSession: () => initialSession, saveSession: state => { saved = structuredClone(state); }, resolveStream, ...adapterOptions });
  return { api, calls, saved: () => saved };
}

test('lyrics download KRC even when search preview contains only a timed song title', async () => {
  const { deflateSync } = require('node:zlib');
  const key = [64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 210, 110, 105];
  const encrypted = deflateSync(Buffer.from('[2000,2000]<0,500,0>甲 <500,1500,0>乙'));
  for (let index = 0; index < encrypted.length; index++) encrypted[index] ^= key[index % key.length];
  const h = harness({
    search_lyric: () => ({ body: { lrctxt: '[00:00]Artist - Title', proposal: 'hash-recording', candidates: [{ id: 'other', accesskey: 'a' }, { id: 'hash-recording', accesskey: 'b' }] } }),
    lyric: params => ({ body: { status: 200, fmt: params.fmt, contenttype: 0, content: Buffer.concat([Buffer.from('krc1'), encrypted]).toString('base64') } }),
  });
  const result = await h.api.invoke('lyrics', { hash, artist: 'Artist', title: 'Title', duration: 123, albumAudioId: '789' });
  assert.equal(result.ok, true);
  assert.equal(result.data.timing, 'word');
  assert.deepEqual(result.data.timedLines, [{ time: 2, end: 4, text: '甲 乙', words: [{ text: '甲 ', start: 2, end: 2.5 }, { text: '乙', start: 2.5, end: 4 }] }]);
  assert.deepEqual(h.calls.map(({ name }) => name), ['search_lyric', 'lyric']);
  assert.equal(h.calls[0].params.keywords, 'Artist - Title');
  assert.equal(h.calls[0].params.album_audio_id, 789);
  assert.equal(h.calls[0].params.duration, 123000);
  assert.equal(h.calls[1].params.id, 'hash-recording');
  assert.equal(h.calls[1].params.fmt, 'krc');
  assert.equal(h.calls[1].params.decode, false);
  assert.equal(JSON.stringify(result.data).includes('accesskey'), false);
});

test('lyrics fall back to actual base64 LRC when KRC is malformed or unavailable', async () => {
  for (const rejection of [false, true]) {
    const h = harness({
      search_lyric: () => ({ body: { candidates: [{ id: '1', accesskey: 'a' }] } }),
      lyric: params => {
        if (params.fmt === 'krc' && rejection) throw Object.assign(new Error('unavailable'), { code: 'ETIMEDOUT' });
        return { body: { contenttype: params.fmt === 'lrc' ? 1 : 0, content: Buffer.from(params.fmt === 'lrc' ? '[00:01]甲\n[00:03]乙' : 'bad krc').toString('base64') } };
      },
    });
    const result = await h.api.invoke('lyrics', { hash });
    assert.equal(result.ok, true);
    assert.equal(result.data.timing, 'line');
    assert.deepEqual(result.data.timedLines, [{ time: 1, end: 3, text: '甲' }, { time: 3, text: '乙' }]);
    assert.deepEqual(h.calls.filter(call => call.name === 'lyric').map(call => call.params.fmt), ['krc', 'lrc']);
  }
});

test('lyrics retain usable inline fallback and report download failures without leaking provider details', async () => {
  const h = harness({
    search_lyric: () => ({ body: { data: { lrctxt: '[00:01]inline', candidates: [{ id: '1', accesskey: 'a' }] } } }),
    lyric: () => { throw new Error('https://private.invalid?token=secret'); },
  });
  assert.equal((await h.api.invoke('lyrics', { hash })).data.timedLines[0].text, 'inline');
  const unavailable = harness({
    search_lyric: () => ({ body: { candidates: [{ id: '1', accesskey: 'a' }] } }),
    lyric: () => { throw new Error('https://private.invalid?token=secret'); },
  });
  const error = await unavailable.api.invoke('lyrics', { hash });
  assert.equal(error.ok, false);
  assert.equal(JSON.stringify(error).includes('secret'), false);
  const empty = await unavailable.api.invoke('lyrics', { hash: '../invalid' });
  assert.deepEqual(empty, { ok: true, data: { text: '', timedLines: [], timing: 'none' } });
});
test('concept-only persistence preserves device identity and removes all account secrets on logout', async () => {
  const h = harness({}, { platform: 'lite', cookie: { token: 'secret-token', userid: '42', auth: 'secret-auth', vip_token: 'secret-vip', KUGOU_API_GUID: 'stable-guid', KUGOU_API_MID: 'stable-mid', KUGOU_API_DEV: 'stable-dev', dfid: 'stable-dfid' }, user: { id: '42', name: '用户' } });
  const status = await h.api.invoke('status');
  assert.equal(status.data.loggedIn, true);
  assert.equal(JSON.stringify(status).includes('secret'), false);
  assert.equal((await h.api.invoke('qrStart', { platform: 'standard' })).code, 'CONCEPT_ONLY');
  await h.api.invoke('logout');
  assert.equal(h.saved().cookie.KUGOU_API_GUID, 'stable-guid');
  assert.equal(h.saved().cookie.KUGOU_API_MID, 'stable-mid');
  for (const name of ['token', 'userid', 'auth', 'vip_token']) assert.equal(h.saved().cookie[name], undefined);
  assert.equal((await h.api.invoke('playlists')).code, 'LOGIN_REQUIRED');
});
test('a QR result arriving after logout cannot recreate a logged-in session', async () => {
  const delayed = deferred();
  const h = harness({ login_qr_check: () => delayed.promise });
  const qr = await h.api.invoke('qrStart');
  const checking = h.api.invoke('qrCheck', { key: qr.data.key });
  await new Promise(resolve => setImmediate(resolve));
  await h.api.invoke('logout');
  delayed.resolve({ body: { data: { status: 4, token: 'late-secret', userid: 88 } }, cookie: ['token=late-secret', 'userid=88'] });
  assert.equal((await checking).data.status, 'expired');
  assert.equal((await h.api.invoke('status')).data.loggedIn, false);
  assert.equal(h.saved().cookie.token, undefined);
});
test('a replacement QR invalidates an older in-flight QR authorization', async () => {
  const delayed = deferred(); let sequence = 0;
  const h = harness({ login_qr_key: () => ({ body: { data: { qrcode: `concept-${++sequence}-3116` } }, cookie: [] }), login_qr_check: () => delayed.promise });
  const first = await h.api.invoke('qrStart');
  const checking = h.api.invoke('qrCheck', { key: first.data.key });
  await new Promise(resolve => setImmediate(resolve));
  await h.api.invoke('qrStart');
  delayed.resolve({ body: { data: { status: 4, token: 'old-secret', userid: 88 } }, cookie: [] });
  assert.equal((await checking).data.status, 'expired');
  assert.equal((await h.api.invoke('status')).data.loggedIn, false);
});
test('public playlist metadata includes durations, album audio ids and pagination', async () => {
  const h = harness({ playlist_track_all: () => ({ body: { data: { count: 170, songs: [{ hash, name: 'Artist - Title', timelen: 207777, mixsongid: 32203997, album_id: 101, albuminfo: { name: 'Album' }, singerinfo: [{ name: 'Artist' }], cover: 'http://imge.kugou.com/x/{size}.jpg' }] } }, cookie: [] }) });
  const result = await h.api.invoke('playlistSongs', { id: 'collection_public' });
  assert.equal(result.data.songs[0].duration, 207.777);
  assert.equal(result.data.songs[0].albumAudioId, '32203997');
  assert.equal(result.data.songs[0].cover, 'https://imge.kugou.com/x/400.jpg');
  assert.equal(result.data.songs[0].album, 'Album');
  assert.equal(result.data.hasMore, true);
  assert.equal(result.data.nextPage, 2);
});

test('a 434-entry private playlist keeps a legitimate duplicate and its entire second page', async () => {
  const rows = Array.from({ length: 434 }, (_, index) => ({ hash, name: `Artist - Title ${index}`, album_audio_id: index === 299 ? 1 : index + 1 }));
  rows[299] = { ...rows[0] };
  const h = harness({ playlist_track_all_new: params => ({ body: { data: { count: 434, page: params.page, pagesize: params.pagesize, info: rows.slice((params.page - 1) * params.pagesize, params.page * params.pagesize) } }, cookie: [] }) }, { platform: 'lite', cookie: { token: 'private-token', userid: 42, dfid: 'stable' } });
  const firstPage = (await h.api.invoke('playlistSongs', { id: 'my-favourites', listId: '1' })).data;
  assert.equal(firstPage.songs.length, 300);
  assert.equal(firstPage.rawCount, 300);
  assert.equal(firstPage.pageSize, 300);
  assert.equal(firstPage.totalReported, true);
  assert.equal(firstPage.sourceTotal, 434);
  assert.equal(firstPage.hasMore, true);
  assert.equal(firstPage.nextPage, 2);
  assert.equal(firstPage.nextOffset, 300);
  assert.equal(firstPage.songs[0].hash, firstPage.songs[299].hash);
  assert.equal(firstPage.songs[0].albumAudioId, firstPage.songs[299].albumAudioId);
  assert.notEqual(firstPage.songs[0].playlistEntryId, firstPage.songs[299].playlistEntryId);
  const secondPage = (await h.api.invoke('playlistSongs', { id: 'my-favourites', listId: '1', page: firstPage.nextPage, pageSize: firstPage.pageSize, offset: firstPage.nextOffset })).data;
  const combined = [...firstPage.songs, ...secondPage.songs];
  assert.equal(combined.length, 434);
  assert.equal(new Set(combined.map(song => song.playlistEntryId)).size, 434);
  assert.equal(secondPage.rawCount, 134);
  assert.equal(secondPage.offset, 300);
  assert.equal(secondPage.total, 434);
  assert.equal(secondPage.hasMore, false);
  assert.equal(secondPage.nextPage, null);
  assert.equal(secondPage.nextOffset, null);
  assert.deepEqual(h.calls.map(call => [call.params.page, call.params.pagesize]), [[1, 300], [2, 300]]);
});

test('playlist pagination uses raw rows rather than the playable subset', async () => {
  const rows = Array.from({ length: 300 }, (_, index) => index === 100 ? { name: 'No playable hash' } : { hash, album_audio_id: index + 1 });
  const h = harness({ playlist_track_all_new: () => ({ body: { data: { count: 434, pagesize: 300, info: rows } }, cookie: [] }) }, { platform: 'lite', cookie: { token: 'private-token', userid: 42, dfid: 'stable' } });
  const result = (await h.api.invoke('playlistSongs', { id: 'private', listId: '1' })).data;
  assert.equal(result.rawCount, 300);
  assert.equal(result.songs.length, 299);
  assert.equal(result.nextPage, 2);
  assert.equal(result.nextOffset, 300);
  assert.equal(result.songs[100].playlistPosition, 101);
});

test('short public pages advance their raw offset without skipping entries', async () => {
  const rows = Array.from({ length: 65 }, (_, index) => ({ hash, album_audio_id: index + 1 }));
  const h = harness({ playlist_track_all: params => ({ body: { data: { total: rows.length, songs: rows.slice(params.offset, params.offset + 30) } }, cookie: [] }) });
  let page = 1, offset = 0, pageSize = 100;
  const songs = [];
  while (page) {
    const result = (await h.api.invoke('playlistSongs', { id: 'public', page, pageSize, offset })).data;
    songs.push(...result.songs);
    page = result.nextPage;
    offset = result.nextOffset;
    pageSize = result.pageSize;
  }
  assert.equal(songs.length, 65);
  assert.equal(new Set(songs.map(song => song.playlistEntryId)).size, 65);
  assert.deepEqual(h.calls.map(call => call.params.offset), [0, 30, 60]);
  assert.deepEqual(songs.map(song => Number(song.albumAudioId)), Array.from({ length: 65 }, (_, index) => index + 1));
});

test('a server-reported smaller private page size becomes the stable continuation size', async () => {
  const rows = Array.from({ length: 234 }, (_, index) => ({ hash, album_audio_id: index + 1 }));
  const h = harness({ playlist_track_all_new: params => {
    const size = Math.min(params.pagesize, 100);
    return { body: { data: { count: rows.length, pagesize: size, info: rows.slice((params.page - 1) * size, params.page * size) } }, cookie: [] };
  } }, { platform: 'lite', cookie: { token: 'private-token', userid: 42, dfid: 'stable' } });
  let page = 1, pageSize;
  const songs = [];
  while (page) {
    const result = (await h.api.invoke('playlistSongs', { id: 'private', listId: '1', page, pageSize })).data;
    songs.push(...result.songs);
    page = result.nextPage;
    pageSize = result.pageSize;
  }
  assert.equal(songs.length, 234);
  assert.equal(new Set(songs.map(song => song.playlistEntryId)).size, 234);
  assert.deepEqual(h.calls.map(call => call.params.pagesize), [300, 100, 100]);
});

test('missing totals and page-local counts require a probe, while empty pages always stop', async t => {
  for (const mode of ['missing', 'page-count', 'stale-total']) await t.test(mode, async () => {
    const h = harness({ playlist_track_all: params => {
      const songs = params.page === 1 ? [{ hash, album_audio_id: 1 }, { hash, album_audio_id: 2 }] : [];
      const totals = mode === 'page-count' ? { count: songs.length } : mode === 'stale-total' ? { total: 434 } : {};
      return { body: { data: { ...totals, songs } }, cookie: [] };
    } });
    const firstPage = (await h.api.invoke('playlistSongs', { id: 'public' })).data;
    assert.equal(firstPage.hasMore, true);
    assert.equal(firstPage.nextPage, 2);
    assert.equal(firstPage.nextOffset, 2);
    assert.equal(firstPage.totalReported, mode !== 'missing');
    const emptyPage = (await h.api.invoke('playlistSongs', { id: 'public', page: firstPage.nextPage, offset: firstPage.nextOffset })).data;
    assert.equal(emptyPage.rawCount, 0);
    assert.equal(emptyPage.hasMore, false);
    assert.equal(emptyPage.nextPage, null);
    assert.equal(emptyPage.nextOffset, null);
  });
});

test('playlist page numbers are whole and an account change invalidates an in-flight page', async () => {
  const delayed = deferred();
  const h = harness({ playlist_track_all_new: () => delayed.promise }, { platform: 'lite', cookie: { token: 'private-token', userid: 42, dfid: 'stable' } });
  const loading = h.api.invoke('playlistSongs', { id: 'private', listId: '1', page: 2.9 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.calls[0].params.page, 2);
  await h.api.invoke('logout');
  delayed.resolve({ body: { data: { count: 434, info: [{ hash }] } }, cookie: [] });
  assert.equal((await loading).code, 'LOGIN_REQUIRED');
});
test('normal concept authorization uses account entitlement and never relays auth credentials', async () => {
  const h = harness({ song_url: () => ({ body: {}, cookie: [] }), user_verify: () => ({ body: { data: { auth: 'private-user-auth' } }, cookie: ['auth=private-user-auth'] }), song_auth: () => ({ body: { data: { auth: 'private-track-auth', open_time: 123 } }, cookie: [] }), song_url_auth: params => ({ body: { url: 'https://audio.kugou.com/song.mp3', timeLength: 210 }, cookie: [] }) }, { platform: 'lite', cookie: { token: 'private-login-token', userid: 42, dfid: 'stable-fingerprint' } });
  const result = await h.api.invoke('songUrl', { hash, albumId: 101, albumAudioId: 32203997, quality: 128 });
  assert.equal(result.ok, true);
  assert.equal(result.data.url, 'https://audio.kugou.com/song.mp3');
  assert.equal(JSON.stringify(result).includes('private-'), false);
  assert.deepEqual(h.calls.map(c => c.name), ['song_url', 'user_verify', 'song_auth', 'song_url_auth']);
  assert.equal(h.calls.at(-1).params.album_audio_id, 32203997);
  assert.equal(h.calls.at(-1).params.auth, 'private-track-auth');
  assert.equal(h.calls.at(-1).params.quality, 128);
});
test('security verification stops authorization fallback and network errors redact tokens', async () => {
  const h = harness({ song_url: () => { throw { status: 428, body: { error_code: 'SECURITY_VERIFICATION_REQUIRED', msg: 'token=do-not-relay' } }; }, search: () => { throw { body: { error_code: 152, msg: 'token=do-not-relay' } }; } }, { platform: 'lite', cookie: { token: 'private-login-token', userid: 42 } });
  const result = await h.api.invoke('songUrl', { hash, quality: 128 });
  assert.equal(result.code, 'SECURITY_VERIFICATION_REQUIRED');
  assert.deepEqual(h.calls.map(c => c.name), ['song_url']);
  assert.equal(JSON.stringify(result).includes('do-not-relay'), false);
  assert.equal((await h.api.invoke('search', { keyword: '歌名' })).code, 'LOGIN_REQUIRED');
});
test('audio candidates preserve original schemes and include backups even with an empty primary list', async () => {
  const h = harness({ song_url: () => ({ body: { url: [], backupUrl: ['http://fs.youthandroid2.kugou.com/authorized.mp3', 'https://backup.kugou.com/authorized.mp3', 'http://fs.youthandroid2.kugou.com/authorized.mp3'], extName: 'mp3', fileHead: 0, fileSize: 2000000 }, cookie: [] }) });
  const result = await h.api.invoke('songUrl', { hash, quality: 128 });
  assert.equal(result.ok, true);
  assert.equal(result.data.url, 'http://fs.youthandroid2.kugou.com/authorized.mp3');
  assert.deepEqual(result.data.urls, ['http://fs.youthandroid2.kugou.com/authorized.mp3', 'https://backup.kugou.com/authorized.mp3']);
  assert.equal(result.data.mime, 'audio/mpeg');
  assert.equal(result.data.extName, 'mp3');
  assert.equal(result.data.fileHead, 0);
});
test('an unreadable ordinary URL falls through to normal concept authorization and returns only an opaque stream', async () => {
  const received = [];
  const h = harness({
    song_url: () => ({ body: { url: ['http://first.kugou.com/failed.mp3'] }, cookie: [] }),
    user_verify: () => ({ body: { data: { auth: 'private-user-auth' } }, cookie: ['auth=private-user-auth'] }),
    song_auth: () => ({ body: { data: { auth: 'private-track-auth', open_time: 123 } }, cookie: [] }),
    song_url_auth: () => ({ body: { url: ['http://authorized.kugou.com/valid.mp3'], backupUrl: ['http://backup.kugou.com/valid.mp3'], extName: 'mp3', timeLength: 200 }, cookie: [] }),
  }, { platform: 'lite', cookie: { token: 'private-token', userid: 42, dfid: 'stable-fingerprint' } }, async metadata => {
    received.push(metadata);
    await new Promise(resolve => setImmediate(resolve));
    if (received.length === 1) return null;
    return { ...metadata, url: 'qingyin-stream://track/abc123' };
  });
  const result = await h.api.invoke('songUrl', { hash, albumAudioId: 123, quality: 128 });
  assert.equal(result.ok, true);
  assert.equal(result.data.url, 'qingyin-stream://track/abc123');
  assert.equal(result.data.duration, 200);
  assert.equal(result.data.mime, 'audio/mpeg');
  assert.equal(received.length, 2);
  assert.deepEqual(received[1].urls, ['http://authorized.kugou.com/valid.mp3', 'http://backup.kugou.com/valid.mp3']);
  assert.equal(JSON.stringify(result).includes('kugou.com'), false);
  assert.equal(result.data.urls, undefined);
  assert.deepEqual(h.calls.map(c => c.name), ['song_url', 'user_verify', 'song_auth', 'song_url_auth']);
});
test('a security verification error from a stream resolver prevents alternate authorization attempts', async () => {
  const h = harness({ song_url: () => ({ body: { url: ['http://audio.kugou.com/stream.mp3'] }, cookie: [] }) }, { platform: 'lite', cookie: { token: 'private-token', userid: 42 } }, async () => { throw Object.assign(new Error('private details'), { code: 'SECURITY_VERIFICATION_REQUIRED' }); });
  const result = await h.api.invoke('songUrl', { hash, quality: 128 });
  assert.equal(result.code, 'SECURITY_VERIFICATION_REQUIRED');
  assert.deepEqual(h.calls.map(c => c.name), ['song_url']);
  assert.equal(JSON.stringify(result).includes('private'), false);
});
test('a preview passes through the stream resolver after a failed full candidate', async () => {
  const received = [];
  const h = harness({ song_url: params => ({ body: { url: [params.free_part ? 'http://preview.kugou.com/clip.mp3' : 'http://audio.kugou.com/full.mp3'], extName: 'mp3' }, cookie: [] }) }, null, async metadata => {
    received.push(metadata);
    return metadata.preview ? { url: 'qingyin-stream://track/preview123' } : null;
  });
  const result = await h.api.invoke('songUrl', { hash, quality: 128 });
  assert.equal(result.ok, true);
  assert.equal(result.data.preview, true);
  assert.equal(received.length, 2);
  assert.equal(received[0].preview, false);
  assert.equal(received[1].preview, true);
});
test('native CDN failures survive an unavailable entitlement route without becoming permission errors', async () => {
  const h = harness({
    song_url: params => ({ body: params.free_part ? {} : { url: ['http://audio.kugou.com/failed.mp3'] }, cookie: [] }),
    user_verify: () => ({ body: { data: { auth: 'private-user-auth' } }, cookie: ['auth=private-user-auth'] }),
    song_auth: () => ({ body: { data: { auth: 'private-track-auth', open_time: 123 } }, cookie: [] }),
    song_url_auth: () => ({ body: {}, cookie: [] }),
  }, { platform: 'lite', cookie: { token: 'private-token', userid: 42, dfid: 'stable-fingerprint' } }, async () => { throw Object.assign(new Error('private URL and token'), { publicCode: 'MEDIA_UNAVAILABLE', publicMessage: 'private URL and token' }); });
  const result = await h.api.invoke('songUrl', { hash, quality: 128 });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'MEDIA_UNAVAILABLE');
  assert.equal(result.error, '音乐文件暂时无法读取，请点击播放重试。');
  assert.equal(JSON.stringify(result).includes('private'), false);
  assert.deepEqual(h.calls.map(c => c.name), ['song_url', 'user_verify', 'song_auth', 'song_url_auth', 'song_url']);
});

test('maximum quality continues past MP3 returned for high and chooses verified FLAC', async () => {
  const { Readable } = require('node:stream');
  const { createStreamManager } = require('../lib/stream.cjs');
  const flac = Buffer.alloc(42); flac.write('fLaC'); flac[4] = 128; flac.writeUIntBE(34, 5, 3);
  flac.writeBigUInt64BE((44100n << 44n) | (1n << 41n) | (15n << 36n) | (44100n * 168n), 18);
  const manager = createStreamManager({ request: async config => ({ status: 206, headers: {}, data: Readable.from(config.url.includes('/high') ? Buffer.from([255, 251, 144, 0]) : flac) }) });
  const h = harness({
    song_url: params => ({ body: { url: [`http://fs.kugou.com/${params.quality}`], extName: 'flac', bitRate: 3108000, fileSize: 16510863, timeLength: 168 }, cookie: [] }),
    user_verify: () => ({ body: {}, cookie: ['auth=private-auth'] }),
    song_auth: () => ({ body: { data: { auth: 'private-grant', open_time: 123 } }, cookie: [] }),
    song_url_auth: () => ({ body: {}, cookie: [] }),
  }, { platform: 'lite', cookie: { token: 'private-token', userid: 42, dfid: 'stable' } }, manager.prepare);
  const result = await h.api.invoke('songUrl', { hash });
  assert.equal(result.ok, true);
  assert.deepEqual(h.calls.filter(c => c.name === 'song_url').map(c => c.params.quality), ['high', 'flac']);
  assert.equal(result.data.quality.mode, 'max');
  assert.equal(result.data.quality.requested, 'flac');
  assert.equal(result.data.quality.format, 'flac');
  assert.equal(result.data.quality.sampleRateHz, 44100);
  assert.equal(result.data.quality.bitDepth, 16);
  assert.equal(result.data.quality.fallback, true);
  assert.match(result.data.quality.label, /FLAC.*16 bit.*44.1 kHz/);
  assert.equal(JSON.stringify(result).includes('kugou.com'), false);
});

test('ordinary quality tiers reuse authorization for the same hash and verify the user once', async () => {
  const h = harness({
    song_url: () => ({ body: {}, cookie: [] }),
    user_verify: () => ({ body: {}, cookie: ['auth=private-auth'] }),
    song_auth: () => ({ body: { data: { auth: 'private-grant', open_time: 123 } }, cookie: [] }),
    song_url_auth: params => ({ body: params.quality === 320 ? { url: 'http://fs.kugou.com/320.mp3', extName: 'mp3', bitRate: 320000 } : {}, cookie: [] }),
  }, { platform: 'lite', cookie: { token: 'private-token', userid: 42, dfid: 'stable' } });
  const result = await h.api.invoke('songUrl', { hash });
  assert.equal(result.ok, true);
  assert.deepEqual(h.calls.filter(c => c.name === 'song_url_auth').map(c => c.params.quality), ['high', 'flac', 320]);
  assert.equal(h.calls.filter(c => c.name === 'user_verify').length, 1);
  assert.equal(h.calls.filter(c => c.name === 'song_auth').length, 1);
  assert.equal(result.data.quality.bitrateKbps, 320);
  assert.equal(result.data.quality.fallback, true);
});

test('variant hashes get separate normal authorizations and carry service format hints', async () => {
  const hashes = { high: 'A'.repeat(32), flac: 'B'.repeat(32), 320: 'C'.repeat(32), super: 'D'.repeat(32) };
  const h = harness({
    privilege_lite: params => {
      assert.equal(typeof params.album_id, 'string');
      return { body: { data: [{ relate_goods: Object.entries(hashes).map(([quality, hash]) => ({ quality, hash, album_id: 101, album_audio_id: 123, info: { duration: 10000, filesize: 400000, bitrate: 320, extname: 'mp3' } })) }] }, cookie: [] };
    },
    song_url: () => ({ body: {}, cookie: [] }),
    user_verify: () => ({ body: {}, cookie: ['auth=private-auth'] }),
    song_auth: () => ({ body: { data: { auth: 'private-grant', open_time: 123 } }, cookie: [] }),
    song_url_auth: params => ({ body: params.quality === 320 ? { url: 'http://fs.kugou.com/320.mp3' } : {}, cookie: [] }),
  }, { platform: 'lite', cookie: { token: 'private-token', userid: 42, dfid: 'stable' } });
  const result = await h.api.invoke('songUrl', { hash, albumId: 101 });
  assert.equal(result.ok, true);
  assert.deepEqual(h.calls.filter(c => c.name === 'song_auth').map(c => c.params.hash), [hashes.high, hashes.flac, hashes[320]].map(h => h.toLowerCase()));
  assert.equal(h.calls.filter(c => c.name === 'user_verify').length, 1);
  assert.equal(result.data.duration, 10);
  assert.equal(result.data.quality.bitrateKbps, 320);
  assert.equal(result.data.quality.format, 'mp3');
  assert.equal(h.calls.some(c => c.params.hash === hashes.super.toLowerCase()), false);
});

test('preview is requested only after full ordinary tiers have been exhausted', async () => {
  const h = harness({ song_url: params => ({ body: params.free_part ? { url: 'http://fs.kugou.com/preview.mp3', extName: 'mp3', bitRate: 128000 } : {}, cookie: [] }) });
  const result = await h.api.invoke('songUrl', { hash });
  const calls = h.calls.filter(c => c.name === 'song_url');
  assert.deepEqual(calls.map(c => c.params.quality), ['high', 'flac', 320, 128, 128]);
  assert.equal(calls.slice(0, -1).some(c => c.params.free_part), false);
  assert.equal(calls.at(-1).params.free_part, true);
  assert.equal(result.data.preview, true);
  assert.equal(result.data.quality.fallback, true);
});

test('an unsupported protected quality mode is not requested', async () => {
  const h = harness();
  const result = await h.api.invoke('songUrl', { hash, quality: 'super' });
  assert.equal(result.code, 'INVALID_QUALITY');
  assert.deepEqual(h.calls, []);
});

test('maximum lossless compares public16/44.1 with authorized24/96 before returning', async () => {
  const h = harness({
    song_url: params => ({ body: { url: `http://fs.kugou.com/${params.quality}-public.flac`, extName: 'flac' }, cookie: [] }),
    user_verify: () => ({ body: {}, cookie: ['auth=private-auth'] }),
    song_auth: () => ({ body: { data: { auth: 'private-grant', open_time: 123 } }, cookie: [] }),
    song_url_auth: params => ({ body: { url: `http://fs.kugou.com/${params.quality}-auth.flac`, extName: 'flac' }, cookie: [] }),
  }, { platform: 'lite', cookie: { token: 'private-token', userid: 42, dfid: 'stable' } }, async metadata => ({
    url: `qingyin-stream://track/${'a'.repeat(32)}`,
    quality: { format: 'flac', bitrateKbps: 1000, sampleRateHz: metadata.url.includes('-auth') ? 96000 : 44100, bitDepth: metadata.url.includes('-auth') ? 24 : 16 },
  }));
  const result = await h.api.invoke('songUrl', { hash });
  assert.equal(result.data.quality.bitDepth, 24);
  assert.equal(result.data.quality.sampleRateHz, 96000);
  assert.deepEqual(h.calls.filter(c => c.name === 'song_url').map(c => c.params.quality), ['high', 'flac']);
  assert.deepEqual(h.calls.filter(c => c.name === 'song_url_auth').map(c => c.params.quality), ['high', 'flac']);
  assert.equal(h.calls.filter(c => c.name === 'song_auth').length, 1);
  assert.equal(h.calls.filter(c => c.name === 'user_verify').length, 1);
  assert.equal(h.calls.some(c => c.params.free_part), false);
});

test('maximum lossless compares both variant hashes and keeps the highest verified format', async () => {
  const highHash = 'a'.repeat(32), flacHash = 'b'.repeat(32);
  const h = harness({
    privilege_lite: () => ({ body: { data: [{ relate_goods: [{ quality: 'high', hash: highHash }, { quality: 'flac', hash: flacHash }] }] }, cookie: [] }),
    song_url: params => ({ body: { url: `http://fs.kugou.com/${params.quality}-public.flac`, extName: 'flac' }, cookie: [] }),
    user_verify: () => ({ body: {}, cookie: ['auth=private-auth'] }),
    song_auth: () => ({ body: { data: { auth: 'private-grant', open_time: 123 } }, cookie: [] }),
    song_url_auth: params => ({ body: { url: `http://fs.kugou.com/${params.quality}-auth.flac`, extName: 'flac' }, cookie: [] }),
  }, { platform: 'lite', cookie: { token: 'private-token', userid: 42, dfid: 'stable' } }, async metadata => ({
    url: `qingyin-stream://track/${'a'.repeat(32)}`,
    quality: { format: 'flac', bitrateKbps: 1000, bitDepth: 24, sampleRateHz: metadata.url.includes('flac-public') ? 192000 : 96000 },
  }));
  const result = await h.api.invoke('songUrl', { hash });
  assert.equal(result.data.quality.sampleRateHz, 192000);
  assert.equal(result.data.quality.requested, 'flac');
  assert.deepEqual(h.calls.filter(c => c.name === 'song_auth').map(c => c.params.hash), [highHash, flacHash]);
  assert.equal(h.calls.filter(c => c.name === 'user_verify').length, 1);
});

test('explicit high compares its ordinary and authorized streams without requesting other tiers', async () => {
  const h = harness({
    song_url: () => ({ body: { url: 'http://fs.kugou.com/public.flac', extName: 'flac' }, cookie: [] }),
    user_verify: () => ({ body: {}, cookie: ['auth=private-auth'] }),
    song_auth: () => ({ body: { data: { auth: 'private-grant', open_time: 123 } }, cookie: [] }),
    song_url_auth: () => ({ body: { url: 'http://fs.kugou.com/auth.flac', extName: 'flac' }, cookie: [] }),
  }, { platform: 'lite', cookie: { token: 'private-token', userid: 42, dfid: 'stable' } }, async metadata => ({
    url: `qingyin-stream://track/${'a'.repeat(32)}`,
    quality: { format: 'flac', bitrateKbps: 1000, sampleRateHz: metadata.url.includes('/auth') ? 96000 : 44100, bitDepth: metadata.url.includes('/auth') ? 24 : 16 },
  }));
  const result = await h.api.invoke('songUrl', { hash, quality: 'high' });
  assert.equal(result.data.quality.mode, 'high');
  assert.equal(result.data.quality.bitDepth, 24);
  assert.equal(result.data.quality.sampleRateHz, 96000);
  assert.deepEqual(h.calls.filter(c => ['song_url', 'song_url_auth'].includes(c.name)).map(c => c.params.quality), ['high', 'high']);
});

test('a security challenge after a playable public lossless candidate still stops selection', async () => {
  const h = harness({
    song_url: () => ({ body: { url: 'http://fs.kugou.com/public.flac', extName: 'flac' }, cookie: [] }),
    user_verify: () => ({ body: {}, cookie: ['auth=private-auth'] }),
    song_auth: () => { throw { status: 428, body: { error_code: 'SECURITY_VERIFICATION_REQUIRED' } }; },
  }, { platform: 'lite', cookie: { token: 'private-token', userid: 42, dfid: 'stable' } });
  const result = await h.api.invoke('songUrl', { hash });
  assert.equal(result.code, 'SECURITY_VERIFICATION_REQUIRED');
  assert.deepEqual(h.calls.filter(c => c.name === 'song_url').map(c => c.params.quality), ['high']);
  assert.equal(h.calls.some(c => c.params.free_part), false);
});
