'use strict';

// Account-aware, read-only protocol diagnostics. Only schema and completeness are
// emitted; credentials, user IDs, song names, hashes, and signed requests stay in memory.
const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
process.env.platform = 'lite';
const root = path.join(__dirname, '..');
const output = path.join(root, 'test-output', 'recommendation-probe-0.1.42');
fs.mkdirSync(output, { recursive: true });
app.setName('青音概念桌面版');
// Match the installed app's safeStorage context for read-only decryption. No
// BrowserWindow/session is created, and no production Preferences/account writes occur.
app.setPath('userData', path.join(app.getPath('appData'), '青音概念桌面版'));
const upstream = path.join(root, 'vendor', 'kugou-api');
const { createRequest } = require(path.join(upstream, 'util', 'request'));
const axios = require('axios');
axios.defaults.timeout = 15000;
axios.defaults.maxContentLength = 10 * 1024 * 1024;

const results = [];
const selectedModule = process.argv.find(arg => arg.startsWith('--module='))?.slice('--module='.length);
const outputResult = result => { results.push(result); console.log(JSON.stringify(result)); };
const codes = body => Object.fromEntries(['status', 'error_code', 'errcode', 'code', 'errno'].filter(k => ['number', 'boolean'].includes(typeof body?.[k]) || (typeof body?.[k] === 'string' && /^[\w-]{1,40}$/.test(body[k]))).map(k => [k, body[k]]));
function outline(value, depth = 0) {
  if (value == null) return 'null';
  if (depth > 5) return typeof value;
  if (Array.isArray(value)) return { count: value.length, sample: value.length ? outline(value[0], depth + 1) : null };
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, outline(entry, depth + 1)]));
  return typeof value;
}
function arrays(value, prefix = '', depth = 0) {
  if (!value || typeof value !== 'object' || depth > 5) return [];
  if (Array.isArray(value)) return [{ path: prefix, count: value.length, sampleShape: value.length ? outline(value[0]) : null }];
  return Object.entries(value).flatMap(([key, entry]) => arrays(entry, prefix ? `${prefix}.${key}` : key, depth + 1));
}
function at(value, dotted) { return dotted.split('.').reduce((current, key) => current?.[key], value); }
function first(...items) { return items.find(item => item !== undefined && item !== null && item !== ''); }
function completeness(input) {
  const s = input?.base || input?.song || input || {};
  const artist = first(s.authors, input?.authors, s.singers, input?.singers, s.singerinfo, s.author_name, s.SingerName, s.singername, s.singer_name, s.artist);
  const title = first(s.audio_name, s.song_name, s.SongName, s.songname, s.name, s.title, s.filename, s.FileName);
  return {
    hash: Boolean(first(s.hash, s.filehash, s.FileHash, s.file_hash, input?.hash)),
    title: Boolean(title), artist: Boolean(artist),
    cover: Boolean(first(s.cover, s.Image, s.image, s.img, s.imgurl, s.album_sizable_cover, s.sizable_cover, s.trans_param?.union_cover, s.relate_goods?.[0]?.info?.image, input?.cover, input?.album_sizable_cover, input?.sizable_cover)),
    album: Boolean(first(s.albumname, s.album_name, s.AlbumName, s.albuminfo?.name, s.relate_goods?.[0]?.albumname, input?.album_name)),
    albumAudioId: Boolean(first(s.album_audio_id, s.AlbumAudioID, s.mixsongid, input?.album_audio_id)),
    duration: Boolean(first(s.duration, s.Duration, s.timelength, s.timelen, s.time_length, input?.duration)),
  };
}
function safeError(error) {
  const body = error?.body || {};
  return { failed: true, errorType: error?.name || 'UpstreamError', httpStatus: error?.status || error?.response?.status || null, responseCodes: codes(body), networkCode: /^[\w-]{1,40}$/.test(String(error?.code || '')) ? error.code : null, bodyShape: outline(body) };
}

app.whenReady().then(async () => {
  if (!safeStorage.isEncryptionAvailable()) throw Object.assign(new Error(), { code: 'ENCRYPTION_UNAVAILABLE' });
  outputResult({ stage: 'encryption', available: true });
  const encrypted = fs.readFileSync(path.join(app.getPath('appData'), 'QingyinConcept', 'account.enc'));
  outputResult({ stage: 'stored-session', found: true });
  let session;
  try { session = JSON.parse(safeStorage.decryptString(encrypted)); }
  catch { throw Object.assign(new Error(), { code: 'SESSION_DECRYPT_FAILED' }); }
  finally { encrypted.fill(0); }
  if (session.platform !== 'lite' || !session.cookie?.token) throw Object.assign(new Error(), { code: 'NO_CONCEPT_ACCOUNT' });
  const cookie = { ...session.cookie };
  session = null;
  outputResult({ stage: 'account', authenticated: true, platform: 'lite', appid: require(path.join(upstream, 'util')).appid, persistSession: false });
  async function call(moduleName, params = {}) {
    const handler = require(path.join(upstream, 'module', `${moduleName}.js`));
    const response = await handler({ ...params, cookie: { ...cookie } }, config => {
      if (config.baseURL?.startsWith('http://')) {
        const host = new URL(config.baseURL).hostname;
        config.baseURL = 'https://gateway.kugou.com'; config.headers = { ...config.headers, 'x-router': host };
      }
      return createRequest(config);
    });
    if (response?.headers?.['ssa-code']) throw Object.assign(new Error(), { code: 'SECURITY_VERIFICATION_REQUIRED', status: 428 });
    for (const entry of response.cookie || []) {
      const pair = String(entry).split(';', 1)[0]; const index = pair.indexOf('=');
      if (index > 0) cookie[pair.slice(0, index)] = pair.slice(index + 1);
    }
    return response.body;
  }
  for (const [moduleName, params] of [
    ['recommend_songs', { platform: 'android' }],
    ['everyday_recommend', { platform: 'android' }],
    ['personal_fm', { action: 'login', platform: 'android' }],
  ]) {
    if (selectedModule && selectedModule !== moduleName) continue;
    try {
      const body = await call(moduleName, params);
      const found = arrays(body);
      outputResult({ stage: moduleName, responseCodes: codes(body), bodyShape: outline(body), arrays: found.map(({ path: fieldPath, count, sampleShape }) => ({ path: fieldPath, count, sampleShape, sampleCompleteness: count ? completeness(at(body, fieldPath)[0]) : null, metadataFields: ['sizable_cover', 'trans_param.union_cover', 'relate_goods.0.info.image', 'relate_goods.0.albumname', 'singerinfo.0.name', 'singerinfo.0.author_name'].map(field => ({ path: field, presentCount: at(body, fieldPath).filter(song => at(song, field)).length, urlCount: at(body, fieldPath).filter(song => /^https?:\/\//.test(String(at(song, field) || ''))).length, sizeTemplateCount: at(body, fieldPath).filter(song => String(at(song, field) || '').includes('{size}')).length })) })) });
    } catch (error) { outputResult({ stage: moduleName, ...safeError(error) }); }
  }
  if (selectedModule === 'adapter') {
    const { createKugouAdapter } = require('../lib/kugou.cjs');
    const adapter = createKugouAdapter({ loadSession: () => ({ platform: 'lite', cookie: { ...cookie } }), saveSession: () => {} });
    for (const method of ['dailyRecommendations', 'guessYouLike']) {
      const result = await adapter.invoke(method, {});
      const songs = result?.data?.songs || [];
      outputResult({ stage: method, ok: result.ok, ...(result.code ? { code: result.code } : {}), count: songs.length, fields: ['hash', 'title', 'artist', 'cover', 'album', 'albumId', 'albumAudioId', 'duration'].map(field => ({ field, populated: songs.filter(song => Boolean(song[field])).length })), source: result?.data?.source || null });
    }
  }
  if (!selectedModule) try {
    const body = await call('user_playlist', { page: 1, pagesize: 100 });
    const lists = arrays(body).find(entry => ['data.info', 'data.list', 'data.lists', 'data'].includes(entry.path));
    outputResult({ stage: 'user_playlist', responseCodes: codes(body), arrayPaths: arrays(body).map(entry => ({ path: entry.path, count: entry.count, sampleShape: entry.sampleShape })) });
    const list = lists ? at(body, lists.path) : [];
    for (const targetName of ['默认收藏', '我喜欢']) {
      const target = list.find(item => first(item.name, item.title, item.listname, item.list_name, item.specialname) === targetName);
      if (!target) { outputResult({ stage: 'playlist-cover', label: targetName, found: false }); continue; }
      const knownCoverKeys = ['cover', 'pic', 'img', 'imgurl', 'image', 'sizable_cover', 'list_img', 'cover_url'];
      const coverFields = Object.entries(target).filter(([key]) => /cover|pic|image|img/i.test(key)).map(([key, value]) => ({ key, type: typeof value, present: Boolean(value), url: typeof value === 'string' && /^https?:\/\//.test(value), recognized: knownCoverKeys.includes(key) }));
      outputResult({ stage: 'playlist-cover', label: targetName, found: true, count: Number(first(target.count, target.songcount, target.song_count, target.filecount, target.file_count, target.total) || 0), shape: outline(target), coverFields });
      if (first(target.listid, target.list_id)) {
        try {
          const songs = await call('playlist_track_all_new', { listid: first(target.listid, target.list_id), type: Number(first(target.type, target.list_type, 0)), page: 1, pagesize: 4 });
          outputResult({ stage: 'playlist-cover-songs', label: targetName, responseCodes: codes(songs), arrays: arrays(songs).map(({ path: fieldPath, count, sampleShape }) => ({ path: fieldPath, count, sampleShape, sampleCompleteness: count ? completeness(at(songs, fieldPath)[0]) : null })) });
        } catch (error) { outputResult({ stage: 'playlist-cover-songs', label: targetName, ...safeError(error) }); }
      }
    }
  } catch (error) { outputResult({ stage: 'user_playlist', ...safeError(error) }); }
  for (const key of Object.keys(cookie)) { cookie[key] = null; delete cookie[key]; }
}).catch(error => { outputResult({ stage: 'failed', ...safeError(error) }); process.exitCode = 1; }).finally(() => {
  fs.writeFileSync(path.join(output, selectedModule ? `${selectedModule}-metadata.json` : 'protocol-metadata.json'), JSON.stringify(results, null, 2));
  app.quit();
});
