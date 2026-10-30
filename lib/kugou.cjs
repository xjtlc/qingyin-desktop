'use strict';

// Load the upstream constants only after selecting the concept edition.
process.env.platform = 'lite';
const path = require('node:path');
const crypto = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const upstream = path.join(__dirname, '..', 'vendor', 'kugou-api');
const { calculateMid } = require(path.join(upstream, 'util', 'util'));
const { createRequest } = require(path.join(upstream, 'util', 'request'));
const axios = require('axios');
const { qualityDetails } = require('./stream.cjs');
const { decodeLyricResponse, normalizeLyricText } = require('./lyric-timing.cjs');
axios.defaults.timeout = 15000;
axios.defaults.maxContentLength = 10 * 1024 * 1024;

// Upstream rebuilds its Axios config, so a scoped interceptor carries cancellation
// through both signed API calls and the resolver's streamed CDN verification.
const requestBudgetKey = Symbol.for('qingyin.kugou.request-budget');
const requestBudget = axios[requestBudgetKey] ||= (() => {
  const context = new AsyncLocalStorage();
  axios.interceptors.request.use(config => {
    const budget = context.getStore();
    if (!budget) return config;
    budget.check();
    config.signal = config.signal ? AbortSignal.any([config.signal, budget.signal]) : budget.signal;
    config.timeout = Math.max(1, Math.min(Number(config.timeout) || 15000, budget.remaining()));
    return config;
  });
  return context;
})();

const MODULES = new Set(['login_qr_key', 'login_qr_create', 'login_qr_check', 'login_token', 'register_dev', 'user_detail', 'user_playlist', 'playlist_track_all', 'playlist_track_all_new', 'top_playlist', 'recommend_songs', 'personal_fm', 'search', 'song_url', 'user_verify', 'song_auth', 'song_url_auth', 'privilege_lite', 'search_lyric', 'lyric', 'artist_detail', 'artist_audios', 'artist_albums', 'album_songs', 'album_detail']);
// Catalogue metadata describes variants and entitlement hints. It does not prove
// that the account can obtain a playable stream for any particular tier.
const QUALITY_TIER_IDS = ['128', '320', 'flac', 'high', 'viper_atmos', 'viper_tape', 'viper_clear', 'super', 'multitrack'];
// Grouped the way the service presents them, so the picker can mirror that layout.
const QUALITY_TIERS = [
  { id: 'auto', label: '自动（最高可播放）', group: 'auto', hint: '按这首歌的实际可用性自动挑选最高音质' },
  { id: 'viper_tape', label: '蝰蛇母带音质', group: 'svip', hint: '请求服务提供的母带档位，以实际授权和返回音源为准' },
  { id: 'viper_clear', label: '蝰蛇超清音质', group: 'svip', hint: '请求服务提供的超清档位，以实际授权和返回音源为准' },
  { id: 'viper_atmos', label: '蝰蛇全景声 2.0', group: 'svip', hint: '请求服务提供的全景声档位，以实际授权和返回音源为准' },
  { id: 'lossless', label: '无损音质', group: 'standard', hint: '优先高解析无损，其次 CD 级无损；不可用时回退可播放音质' },
  { id: '320', label: '高品质', group: 'standard', hint: '320 kbps MP3' },
  { id: '128', label: '标准音质', group: 'standard', hint: '128 kbps MP3' },
];
// A premium tier is tried first and then falls back down the ladder, so a song that
// simply does not offer it still plays instead of erroring out.
const QUALITY_LADDERS = {
  auto: ['high', 'flac', 320, 128],
  max: ['high', 'flac', 320, 128], // legacy alias kept for older builds and tests
  lossless: ['high', 'flac', 320, 128],
  high: ['high'], // the hi-res lossless rung on its own
  viper_clear: ['viper_clear', 'high', 'flac', 320, 128],
  viper_tape: ['viper_tape', 'viper_clear', 'high', 'flac', 320, 128],
  viper_atmos: ['viper_atmos', 'high', 'flac', 320, 128],
  '320': [320],
  '128': [128],
};
// Tiers that can carry a lossless stream; the picker compares all of them before deciding.
const LOSSLESS_TIERS = ['high', 'flac'];
const SPECIAL_TIERS = new Set(['viper_tape', 'viper_clear', 'viper_atmos']);
// This is an entitlement hint, not a verified membership or playback decision.
const ENTITLEMENT_HINT_PROCESS = 36;
const DEVICE_KEYS = ['KUGOU_API_PLATFORM', 'KUGOU_API_GUID', 'KUGOU_API_MID', 'KUGOU_API_DEV', 'KUGOU_API_MAC', 'dfid'];
const COOKIE_KEYS = new Set([...DEVICE_KEYS, 'token', 'userid', 'auth', 'vip_token', 'vip_type', 't1']);
const clean = value => String(value ?? '').replace(/<[^>]*>/g, '').trim();
const withoutFileSuffix = value => clean(value).replace(/\.(?:mp3|flac|wav|aac|m4a|mp4|ogg|opus|wma|ape)$/i, '').trim();
const first = (...values) => values.find(value => value !== undefined && value !== null && value !== '');
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const losslessQuality = quality => ['flac', 'wav'].includes(quality?.format);
const lossyQuality = quality => ['mp3', 'mpeg', 'aac', 'm4a', 'mp4', 'ogg', 'opus'].includes(quality?.format);
function ordinaryTier(quality) {
  if (losslessQuality(quality)) return quality.bitDepth > 16 || quality.sampleRateHz > 48000 ? 'high' : 'flac';
  if (lossyQuality(quality) && quality.bitrateKbps > 0) return quality.bitrateKbps >= 300 ? '320' : '128';
  return '';
}
function ordinaryTierSatisfied(quality, tier) {
  const id = String(tier);
  if (id === '128') return true;
  if (LOSSLESS_TIERS.includes(id)) return losslessQuality(quality);
  return id === '320' && (losslessQuality(quality) || (lossyQuality(quality) && quality.bitrateKbps >= 300));
}
function imageUrl(value) {
  const url = clean(value).replace(/\{size\}/g, '400');
  return /^https?:\/\//i.test(url) ? url.replace(/^http:/i, 'https:') : '';
}
function normalizeSong(input) {
  // Recommendation rows put playback metadata in base, while authors and
  // artwork may live alongside it. Keep both layers without losing the base's
  // recording identity or changing flat search/playlist responses.
  const outer = input?.song || input || {};
  const s = { ...input, ...outer, ...(outer?.base || input?.base || {}) };
  const filename = clean(first(s.FileName, s.filename, s.file_name, s.name, s.title));
  const split = filename.indexOf(' - ');
  const artistList = first(...[s.singers, s.authors, s.singerinfo, s.author_name, s.singer].filter(value => !Array.isArray(value) || value.length));
  const artist = Array.isArray(artistList) ? artistList.map(a => clean(first(a?.name, a?.author_name, a?.singer_name, typeof a === 'string' ? a : ''))).filter(Boolean).join(' / ') : clean(first(s.SingerName, s.singername, s.singer_name, s.artist, artistList, split >= 0 ? filename.slice(0, split) : ''));
  const title = withoutFileSuffix(first(s.SongName, s.songname, s.song_name, s.audio_name, s.title, split >= 0 ? filename.slice(split + 3) : filename));
  const hash = clean(first(s.FileHash, s.filehash, s.hash, s.file_hash, input?.hash)).toUpperCase();
  let duration = number(first(s.Duration, s.duration, s.time_length, s.timelength, s.timelen, input?.duration));
  if (duration > 20000) duration /= 1000;
  const relatedAlbum = Array.isArray(s.relate_goods) ? s.relate_goods.find(item => item?.albumname || item?.info?.image) : null;
  const cover = [s.Image, s.image, s.img, s.imgurl, s.cover, s.album_sizable_cover, s.sizable_cover, input?.cover, s.trans_param?.union_cover, relatedAlbum?.info?.image].map(imageUrl).find(Boolean) || '';
  return {
    id: hash || clean(first(s.album_audio_id, s.audio_id, s.id)), hash, title: title || '未知歌曲', artist: artist || '未知歌手',
    album: clean(first(s.AlbumName, s.album_name, s.albumname, s.albuminfo?.name, s.album, relatedAlbum?.albumname)),
    albumId: clean(first(s.AlbumID, s.album_id, s.albumid, input?.album_id)),
    albumAudioId: clean(first(s.AlbumAudioID, s.album_audio_id, s.album_audioid, s.mixsongid, s.add_mixsongid, input?.album_audio_id)),
    cover, duration,
    artistId: number(first(s.SingerId, s.SingerID, s.singerid, s.singer_id, s.author_id, Array.isArray(artistList) ? first(artistList[0]?.author_id, artistList[0]?.singer_id, artistList[0]?.id) : undefined)),
  };
}
function normalizePlaylist(p) {
  const globalId = clean(first(p.global_collection_id, p.globalCollectionId, p.specialid, p.special_id));
  const listId = clean(first(p.listid, p.list_id));
  return {
    id: globalId || listId || clean(p.id), globalId, listId,
    title: clean(first(p.name, p.title, p.listname, p.list_name, p.specialname)) || '未命名歌单',
    cover: imageUrl(first(p.cover, p.pic, p.img, p.imgurl, p.image, p.sizable_cover, p.list_img, p.cover_url)),
    count: number(first(p.count, p.songcount, p.song_count, p.filecount, p.file_count, p.total)),
    type: number(first(p.type, p.list_type)),
  };
}
function arrayAt(body, keys) {
  if (Array.isArray(body)) return body;
  for (const key of keys) {
    const value = key.split('.').reduce((object, part) => object?.[part], body);
    if (Array.isArray(value)) return value;
  }
  return [];
}
function normalizeUser(data, fallbackId) {
  const u = data?.userinfo || data?.user_info || data || {};
  return { id: clean(first(u.userid, u.user_id, u.id, fallbackId)), name: clean(first(u.nickname, u.nick_name, u.username, u.user_name, u.name)) || '酷狗用户', avatar: imageUrl(first(u.pic, u.pic_url, u.avatar, u.image, u.headimg)) };
}
function fail(message, code) { const error = new Error(message); error.publicMessage = message; error.publicCode = code; return error; }
function resolutionBudget({ timeoutMs, now, setTimer, clearTimer }) {
  const deadline = now() + timeoutMs;
  const controller = new AbortController();
  const error = fail('获取音乐地址超时，请稍后重试。', 'TIMEOUT');
  let rejectDeadline;
  const expired = new Promise((_, reject) => { rejectDeadline = reject; });
  // A deadline may fire between steps; the raced requests also observe rejection.
  expired.catch(() => {});
  const expire = () => { if (!controller.signal.aborted) { controller.abort(error); rejectDeadline(error); } };
  const timer = setTimer(expire, timeoutMs);
  const budget = {
    signal: controller.signal, error,
    remaining: () => Math.max(0, deadline - now()),
    check(optional = false) {
      if (controller.signal.aborted || budget.remaining() <= 0 || (optional && budget.remaining() < Math.min(3000, timeoutMs / 10))) { expire(); throw error; }
    },
    async run(operation, optional = false) {
      budget.check(optional);
      const pending = Promise.resolve().then(() => {
        budget.check(optional);
        return requestBudget.run(budget, operation);
      });
      return Promise.race([pending, expired]);
    },
    close() { clearTimer(timer); controller.abort(error); },
  };
  return budget;
}
function publicError(error) {
  const body = error?.body || {};
  const code = first(error?.publicCode, body.error_code, body.errcode, body.code, error?.code);
  if (code === 'SECURITY_VERIFICATION_REQUIRED' || error?.status === 428 || error?.headers?.['ssa-code']) return { ok: false, error: '请在酷狗概念版 App 中完成安全验证后重试', code: 'SECURITY_VERIFICATION_REQUIRED' };
  if (error?.publicMessage) return { ok: false, error: error.publicMessage, ...(code ? { code: String(code) } : {}) };
  if (['152', '20018'].includes(String(code))) return { ok: false, error: '登录已失效，请重新用酷狗音乐概念版 App 扫码登录', code: 'LOGIN_REQUIRED' };
  const serverMessage = first(body.errmsg, body.error, typeof body.msg === 'string' ? body.msg : '');
  if (/token.{0,30}(?:invalid|expired|失效|过期)|未登录|请.{0,10}登录|登录.{0,10}(?:失效|过期)/i.test(String(serverMessage || ''))) return { ok: false, error: '登录已失效，请重新用酷狗音乐概念版 App 扫码登录', code: 'LOGIN_REQUIRED' };
  const network = body.msg;
  if (['ECONNABORTED', 'ETIMEDOUT'].includes(first(error?.code, network?.code))) return { ok: false, error: '酷狗服务响应超时，请稍后重试', code: 'TIMEOUT' };
  // Upstream errors can include request URLs and tokens. Never relay their text.
  return { ok: false, error: '暂时无法连接酷狗服务，请检查网络或稍后重试', ...(code && /^[\w-]{1,40}$/.test(String(code)) ? { code: String(code) } : {}) };
}
function parseCookies(cookie) {
  const result = {};
  if (cookie && typeof cookie === 'object' && !Array.isArray(cookie)) {
    for (const [key, value] of Object.entries(cookie)) if (COOKIE_KEYS.has(key) && value !== undefined && value !== 'undefined') result[key] = String(value);
  }
  return result;
}

function createKugouAdapter({ loadSession = () => null, saveSession = () => {}, resolveStream, songUrlBudgetMs = 30000, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let cookie = {};
  let user = null;
  let generation = 0;
  let registration = null;
  let registered = false;
  let qrRequest = 0;
  // A persisted grant can outlive its server validity. Only grants verified in
  // this adapter instance are fresh; sharing a short cache avoids duplicate
  // verification when playback and prefetch resolve songs concurrently.
  let userAuthorization = null;
  let authorizationRefresh = null;
  let accountRecovery = null;
  const USER_AUTHORIZATION_TTL = 3 * 60 * 1000;
  const pendingQr = new Map();
  const playlistIndex = new Map();
  const persist = () => saveSession({ platform: 'lite', cookie: { ...cookie }, user });
  const ready = Promise.resolve().then(loadSession).catch(() => null).then(async session => {
    if (session?.platform === 'lite') { cookie = parseCookies(session.cookie); user = session.user ? normalizeUser(session.user, cookie.userid) : null; }
    cookie.KUGOU_API_PLATFORM = 'lite';
    cookie.KUGOU_API_GUID ||= crypto.randomBytes(16).toString('hex');
    cookie.KUGOU_API_MID ||= calculateMid(cookie.KUGOU_API_GUID);
    cookie.KUGOU_API_DEV ||= crypto.randomBytes(16).toString('hex').toUpperCase();
    cookie.KUGOU_API_MAC ||= '02:00:00:00:00:00';
    registered = Boolean(cookie.dfid && cookie.dfid !== '-');
    await persist();
  });
  const loggedIn = () => Boolean(cookie.token && cookie.userid && cookie.userid !== '0');
  const mergeCookies = list => {
    let changed = false;
    for (const entry of list || []) {
      const pair = String(entry).split(';', 1)[0];
      const index = pair.indexOf('=');
      const key = pair.slice(0, index), value = pair.slice(index + 1);
      if (index > 0 && COOKIE_KEYS.has(key) && value && value !== 'undefined' && value !== cookie[key]) { cookie[key] = value; changed = true; }
    }
    return changed;
  };
  async function call(name, params = {}, options = {}) {
    options.budget?.check();
    if (!MODULES.has(name)) throw fail('接口不可用', 'UNSUPPORTED');
    const currentGeneration = generation;
    const inputCookie = options.cookie || { ...cookie };
    const handler = require(path.join(upstream, 'module', `${name}.js`));
    const response = await handler({ ...params, cookie: inputCookie }, config => {
      // Ask for every tier the service knows about, including the 超级VIP ones, so the
      // quality picker can report what a song actually offers instead of guessing.
      if (name === 'privilege_lite' && config.data && typeof config.data === 'object') config.data.qualities = [...QUALITY_TIER_IDS];
      // The public endpoint uses an offset, rather than a server-side page number.
      // Keep that cursor independent of a response that is shorter than requested.
      if (name === 'playlist_track_all' && Number.isSafeInteger(params.offset) && params.offset >= 0) config.params.begin_idx = params.offset;
      // Send credentials through TLS even for old modules whose source uses HTTP.
      if (config.baseURL?.startsWith('http://')) {
        const originalHost = new URL(config.baseURL).hostname;
        config.baseURL = 'https://gateway.kugou.com';
        config.headers = { ...config.headers, 'x-router': originalHost };
      }
      return createRequest(config);
    });
    if (response?.headers?.['ssa-code']) throw fail('请在酷狗概念版 App 中完成安全验证后重试', 'SECURITY_VERIFICATION_REQUIRED');
    options.budget?.check();
    if (currentGeneration === generation && options.merge !== false && mergeCookies(response.cookie)) await persist();
    return options.rawResponse ? response : response.body;
  }
  async function ensureDevice() {
    if (registered) return;
    if (!registration) registration = call('register_dev').then(body => { registered = Boolean(body?.status === 1 && cookie.dfid); }).finally(() => { registration = null; });
    await registration;
  }
  const serviceErrorCode = error => String(first(error?.body?.error_code, error?.body?.errcode, error?.body?.code, error?.publicCode, '') ?? '');
  async function recoverPlaylistAccount(rejectedCookie, startedGeneration, error) {
    if (generation !== startedGeneration || !loggedIn()) throw fail('登录已更改，请重新打开歌单', 'LOGIN_REQUIRED');
    // Another private request may have already renewed this rejected token.
    if (cookie.token !== rejectedCookie.token) return;
    if (serviceErrorCode(error) === '20017' && cookie.dfid !== rejectedCookie.dfid) return;
    if (!accountRecovery || accountRecovery.generation !== startedGeneration || accountRecovery.token !== rejectedCookie.token) {
      const recovery = { generation: startedGeneration, token: rejectedCookie.token, promise: null };
      accountRecovery = recovery;
      recovery.promise = (async () => {
        const assertCurrent = () => { if (generation !== startedGeneration || !loggedIn()) throw fail('登录已更改，请重新打开歌单', 'LOGIN_REQUIRED'); };
        // Cloud lists use 20017 for more than one identity rejection. Confirm
        // account expiry with the account service before asking for a new login.
        if (serviceErrorCode(error) === '20017') {
          try {
            await call('user_detail', {}, { cookie: rejectedCookie, merge: false });
            assertCurrent();
            // A live account can instead have stale device registration. Reuse
            // its original identity and make one normal registration attempt.
            const registrationResult = await call('register_dev', {}, { cookie: rejectedCookie, merge: false, rawResponse: true });
            assertCurrent();
            const entry = (registrationResult.cookie || []).find(value => String(value).startsWith('dfid='));
            const dfid = entry ? String(entry).split(';', 1)[0].slice(5) : '';
            if (registrationResult.body?.status !== 1 || !dfid || ['-', 'undefined'].includes(dfid)) throw fail('酷狗暂时无法验证歌单设备信息，请稍后重试', 'PLAYLIST_UNAVAILABLE');
            cookie.dfid = dfid; registered = true;
            await persist();
            return;
          } catch (verificationError) {
            assertCurrent();
            if (publicError(verificationError).code === 'SECURITY_VERIFICATION_REQUIRED') throw verificationError;
            if (!['152', '20018'].includes(serviceErrorCode(verificationError))) throw verificationError;
          }
        }
        const response = await call('login_token', {}, { cookie: rejectedCookie, merge: false, rawResponse: true });
        assertCurrent();
        const refreshed = { ...parseCookies(response.body?.data) };
        for (const entry of response.cookie || []) {
          const pair = String(entry).split(';', 1)[0], index = pair.indexOf('=');
          const key = pair.slice(0, index), value = pair.slice(index + 1);
          if (['token', 'userid', 't1', 'vip_token', 'vip_type'].includes(key) && value && value !== 'undefined') refreshed[key] = value;
        }
        if (response.body?.status !== 1 || !refreshed.token || String(refreshed.userid || rejectedCookie.userid) !== String(rejectedCookie.userid)) throw fail('登录已失效，请重新用酷狗音乐概念版 App 扫码登录', 'LOGIN_REQUIRED');
        for (const key of ['token', 't1', 'vip_token', 'vip_type']) if (refreshed[key] !== undefined) cookie[key] = String(refreshed[key]);
        delete cookie.auth;
        userAuthorization = null; authorizationRefresh = null;
        await persist();
      })().finally(() => { if (accountRecovery === recovery) accountRecovery = null; });
    }
    await accountRecovery.promise;
  }
  async function privatePlaylistCall(name, params) {
    const startedGeneration = generation, rejectedCookie = { ...cookie };
    try { return await call(name, params); }
    catch (error) {
      if (publicError(error).code === 'SECURITY_VERIFICATION_REQUIRED' || !['152', '20017', '20018'].includes(serviceErrorCode(error))) throw error;
      await recoverPlaylistAccount(rejectedCookie, startedGeneration, error);
      if (generation !== startedGeneration || !loggedIn()) throw fail('登录已更改，请重新打开歌单', 'LOGIN_REQUIRED');
      // Retry once only. Authentication/security failures are never hidden by an
      // empty playlist or a public substitute.
      return call(name, params);
    }
  }
  function rememberPlaylists(list) {
    const normalized = list.map(normalizePlaylist).filter(p => p.id);
    for (const item of normalized) playlistIndex.set(item.id, item);
    return normalized;
  }
  function requireLogin() { if (!loggedIn()) throw fail('请先用酷狗音乐概念版 App 扫码登录', 'LOGIN_REQUIRED'); }
  async function accountRecommendations(moduleName, source, label, params) {
    requireLogin();
    const startedGeneration = generation;
    const accountId = String(cookie.userid);
    let body;
    try { body = await call(moduleName, params); }
    catch (error) {
      if (startedGeneration !== generation) throw fail('登录状态已改变，请重新打开推荐', 'SESSION_EXPIRED');
      if (number(first(error?.body?.error_code, error?.body?.errcode)) === 152) throw fail('登录已失效，请重新用酷狗音乐概念版 App 扫码登录', 'LOGIN_REQUIRED');
      throw error;
    }
    if (startedGeneration !== generation || !loggedIn() || accountId !== String(cookie.userid)) throw fail('登录状态已改变，请重新打开推荐', 'SESSION_EXPIRED');
    const serviceCode = first(body?.error_code, body?.errcode);
    if (body?.status === 0 || body?.status === '0' || (serviceCode !== undefined && String(serviceCode) !== '0')) {
      const error = { body };
      if (Number(serviceCode) === 152) throw fail('登录已失效，请重新用酷狗音乐概念版 App 扫码登录', 'LOGIN_REQUIRED');
      if (['LOGIN_REQUIRED', 'SECURITY_VERIFICATION_REQUIRED'].includes(publicError(error).code)) throw error;
      throw fail(`酷狗暂时无法提供${label}，请稍后重试`, 'RECOMMENDATIONS_UNAVAILABLE');
    }
    const rows = arrayAt(body, ['data.songs', 'data.song_list', 'data.songlist', 'data.info', 'data.list', 'data.lists', 'data.files', 'data', 'songs', 'song_list', 'songlist', 'info', 'list']);
    const songs = rows.map(normalizeSong).filter(song => /^[a-f0-9]{32}$/i.test(song.hash));
    // Keep the provider's ordering and recording variants. An empty response
    // must stay empty instead of being replaced with unrelated public charts.
    if (!songs.length) throw fail(`酷狗暂未返回${label}，请稍后重试`, 'RECOMMENDATIONS_EMPTY');
    const rawDate = clean(first(body?.data?.date, body?.data?.recommend_date, body?.date, body?.recommend_date));
    const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? new Date(`${rawDate}T00:00:00Z`) : null;
    const date = parsedDate && Number.isFinite(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === rawDate ? rawDate : '';
    return { songs, source, accountId, ...(date ? { date } : {}) };
  }
  function authorizationRejected(error) {
    const code = publicError(error).code;
    if (['SECURITY_VERIFICATION_REQUIRED', 'LOGIN_REQUIRED', 'SESSION_EXPIRED'].includes(code)) return false;
    const body = error?.body || {};
    const statuses = [error?.response?.status, error?.status, body.error_code, body.errcode, body.code].map(Number);
    const message = String(first(body.errmsg, body.error, typeof body.msg === 'string' ? body.msg : '') || '');
    return statuses.some(status => [401, 403].includes(status)) || ['AUTH_REQUIRED', 'AUTH_INVALID', 'AUTH_EXPIRED'].includes(code)
      || /(?:auth(?:orization)?|grant).{0,30}(?:invalid|expired)|授权(?:凭证)?.{0,12}(?:过期|失效|无效)/i.test(message);
  }
  function refreshUserAuthorization({ force = false, failedAuth } = {}) {
    requireLogin();
    const fresh = userAuthorization?.generation === generation
      && userAuthorization.expiresAt > now() && userAuthorization.auth === cookie.auth;
    // A concurrent request may already have replaced the rejected grant.
    if (fresh && (!force || (failedAuth && userAuthorization.auth !== failedAuth))) return Promise.resolve(userAuthorization.auth);
    if (authorizationRefresh?.generation === generation) return authorizationRefresh.promise;
    userAuthorization = null;
    const refresh = { generation, promise: null };
    const inputCookie = { ...cookie };
    delete inputCookie.auth;
    // This is a shared, independently bounded verification request. Each song
    // races its own deadline while waiting, so one timeout cannot cancel another
    // song's verification or let a cancelled song continue authorization.
    refresh.promise = requestBudget.exit(() => call('user_verify', {}, { cookie: inputCookie, merge: false, rawResponse: true }))
      .then(async response => {
        if (refresh.generation !== generation || !loggedIn() || inputCookie.token !== cookie.token) throw fail('登录状态已改变，请重新播放', 'SESSION_EXPIRED');
        const grantCookie = (response.cookie || []).map(entry => String(entry).split(';', 1)[0]).find(entry => entry.startsWith('auth='));
        const auth = String(first(response.body?.data?.auth, response.body?.auth, grantCookie?.slice(5)) || '').trim();
        if (!auth) throw fail('无法确认概念版账号的播放授权，请重新登录后重试', 'AUTH_REQUIRED');
        cookie.auth = auth;
        userAuthorization = { generation, auth, expiresAt: now() + USER_AUTHORIZATION_TTL };
        await persist();
        if (refresh.generation !== generation || inputCookie.token !== cookie.token) throw fail('登录状态已改变，请重新播放', 'SESSION_EXPIRED');
        return auth;
      }).finally(() => { if (authorizationRefresh === refresh) authorizationRefresh = null; });
    authorizationRefresh = refresh;
    return refresh.promise;
  }
  function declaredPreview(data) {
    const flag = value => value === 1 || value === true || value === '1' ? true
      : value === 0 || value === false || value === '0' ? false : null;
    const previewFlags = [data.is_free_part, data.isFreePart, data.IsFreePart].map(flag);
    const fullFlags = [data.is_full_audio, data.isFullAudio, data.IsFullAudio].map(flag);
    // Actual responses can identify a full stream with is_full_audio instead of
    // is_free_part. Conflicting declarations remain conservative about previews.
    if (previewFlags.includes(true) || fullFlags.includes(false)) return true;
    if (previewFlags.includes(false) || fullFlags.includes(true)) return false;
    return null;
  }
  function streamData(body, hints = {}) {
    const data = body?.data || body || {};
    const candidates = [data.url, data.play_url, data.playUrl, data.backupUrl, data.backup_url, data.backupurl, data.urls].flat(Infinity);
    const urls = [...new Set(candidates.filter(url => typeof url === 'string' && /^https?:\/\//i.test(url)))];
    if (!urls.length) return null;
    let duration = number(first(data.timeLength, data.timelength, data.duration, data.time_length, hints.duration));
    if (duration > 20000) duration /= 1000;
    const freePart = data.free_part || data.freePart;
    const explicitPreview = declaredPreview(data);
    const extName = clean(first(data.extName, data.extname, data.format, hints.extName)).toLowerCase();
    const mimeTypes = { mp3: 'audio/mpeg', mpeg: 'audio/mpeg', ogg: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', wav: 'audio/wav', m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac' };
    const serviceMime = clean(first(data.mime, data.content_type, data.contentType));
    return {
      url: urls[0], urls, extName, format: extName, fileHead: number(first(data.fileHead, data.file_head)),
      mime: /^audio\//i.test(serviceMime) ? serviceMime : mimeTypes[extName] || '',
      fileSize: number(first(data.fileSize, data.filesize, data.file_size, hints.fileSize)),
      bitrateKbps: (() => { const value = number(first(data.bitRate, data.bitrate, data.bit_rate, hints.bitrateKbps)); return value > 10000 ? value / 1000 : value; })(),
      cover: imageUrl(first(data.img, data.imgurl, data.cover, data.album_sizable_cover)), duration,
      // A preview range can accompany a full member stream. Prefer the service's
      // explicit flag; without one, keep the existing conservative range check.
      preview: explicitPreview ?? Boolean(number(data.is_free_part) || number(data.isFreePart) || number(data.IsFreePart) || (freePart && (number(freePart.time_end) > 0 || number(freePart.end) > 0))),
    };
  }
  async function prepareStream(body, preview = false, selection = {}) {
    const metadata = streamData(body, selection.hints);
    if (!metadata) return null;
    const data = body?.data || body || {};
    // Asking for a preview does not override an explicitly returned full stream.
    if (preview && declaredPreview(data) !== false) metadata.preview = true;
    const requested = selection.requested || 128;
    const requestedTier = String(requested);
    const returnedTier = clean(first(data.quality, data.quality_type, data.qualityType)).toLowerCase();
    const returnedHash = clean(first(data.hash, data.fileHash, data.filehash, data.file_hash)).toLowerCase();
    // A service can silently return a lower quality. The request alone, a FLAC
    // header, and a large bitrate cannot establish a branded tier's identity.
    const identityMatches = returnedTier
      ? QUALITY_TIER_IDS.includes(returnedTier) && returnedTier === requestedTier && (!returnedHash || returnedHash === selection.hash)
      : Boolean(selection.independentVariant && returnedHash && returnedHash === selection.hash);
    const addQuality = (stream, streamVerified = false) => {
      const details = qualityDetails(stream.quality || { format: stream.extName, bitrateKbps: metadata.bitrateKbps });
      const special = SPECIAL_TIERS.has(requestedTier);
      const tierVerified = streamVerified && !stream.preview && (special ? identityMatches : ordinaryTierSatisfied(details, requestedTier));
      const delivered = streamVerified && !stream.preview ? (special && tierVerified ? requestedTier : ordinaryTier(details)) : '';
      if (!streamVerified) details.label = `${details.format ? details.format.toUpperCase() : '音频'} · 服务信息待验证`;
      return { ...stream, quality: {
        mode: selection.mode || 'max', requested, ...details,
        streamVerified, tierVerified, delivered,
        // Preserve decoder-provided channel/codec information when a resolver has
        // it; neither property is inferred from the selected quality or bitrate.
        ...(streamVerified && number(stream.quality?.channels) > 0 ? { channels: number(stream.quality.channels) } : {}),
        ...(streamVerified && /^[\w.-]{1,40}$/.test(stream.quality?.codec || '') ? { codec: stream.quality.codec } : {}),
        fallback: Boolean(selection.fallback || (special && !tierVerified)),
      } };
    };
    if (typeof resolveStream !== 'function') return addQuality(metadata);
    let resolved;
    try { resolved = await resolveStream(metadata); }
    catch (error) {
      if (['MEDIA_UNAVAILABLE', 'UNSUPPORTED_AUDIO'].includes(error?.publicCode)) {
        const sanitized = fail(error.publicCode === 'MEDIA_UNAVAILABLE' ? '音乐文件暂时无法读取，请点击播放重试。' : '这首歌返回了暂不支持的音频格式，请在概念版 App 中播放。', error.publicCode);
        sanitized.streamResolutionFailure = true;
        throw sanitized;
      }
      throw error;
    }
    if (!resolved || typeof resolved.url !== 'string' || !resolved.url) return null;
    // The production resolver returns an opaque local stream URL. CDN URLs and
    // signed backup links remain inside the native process.
    return addQuality({
      url: resolved.url, cover: imageUrl(first(resolved.cover, metadata.cover)),
      duration: number(first(resolved.duration, metadata.duration)),
      preview: Boolean(metadata.preview || resolved.preview),
      mime: clean(first(resolved.mime, metadata.mime)),
      extName: clean(first(resolved.extName, metadata.extName)),
      fileHead: number(first(resolved.fileHead, metadata.fileHead)),
      quality: resolved.quality,
    }, Boolean(resolved.quality && clean(resolved.quality.format)));
  }
  const methods = {
    status: async () => ({ loggedIn: loggedIn(), user: loggedIn() ? user || normalizeUser({}, cookie.userid) : null, platform: 'lite' }),
    qrStart: async params => {
      const startedGeneration = generation;
      const startedQrRequest = ++qrRequest;
      if (params.platform && params.platform !== 'lite') throw fail('本播放器仅支持酷狗音乐概念版账号', 'CONCEPT_ONLY');
      // Device registration improves session continuity; QR itself still works if it is unavailable.
      try { await ensureDevice(); } catch (error) { if (publicError(error).code === 'SECURITY_VERIFICATION_REQUIRED') throw error; }
      const result = await call('login_qr_key');
      const key = clean(first(result?.data?.qrcode, result?.data?.key, result?.qrcode, result?.key));
      if (!key) throw fail('暂时无法生成登录二维码，请稍后重试', 'QR_UNAVAILABLE');
      const created = await call('login_qr_create', { key, qrimg: true });
      if (startedGeneration !== generation || startedQrRequest !== qrRequest) throw fail('登录已取消，请重新获取二维码', 'QR_CANCELLED');
      pendingQr.clear();
      pendingQr.set(key, { expiresAt: Date.now() + 180000, cookie: { ...cookie } });
      return { key, image: created?.data?.base64 || '', expiresIn: 180 };
    },
    qrCheck: async params => {
      const startedGeneration = generation;
      const qr = pendingQr.get(params.key);
      if (!qr || qr.expiresAt <= Date.now()) return { status: 'expired' };
      const result = await call('login_qr_check', { key: params.key }, { cookie: qr.cookie, merge: false });
      if (startedGeneration !== generation || pendingQr.get(params.key) !== qr) return { status: 'expired' };
      const data = result?.data || {};
      const status = number(data.status);
      if (status === 4) {
        if (!data.token || !data.userid) throw fail('登录授权未完成，请重新扫码', 'LOGIN_INCOMPLETE');
        const loginGeneration = ++generation;
        userAuthorization = null; authorizationRefresh = null;
        cookie = { ...Object.fromEntries(DEVICE_KEYS.filter(key => qr.cookie[key]).map(key => [key, qr.cookie[key]])), token: String(data.token), userid: String(data.userid) };
        for (const key of ['vip_token', 'vip_type', 't1']) if (data[key] !== undefined) cookie[key] = String(data[key]);
        user = normalizeUser(data, cookie.userid);
        await persist();
        pendingQr.delete(params.key);
        try { const detail = await call('user_detail'); if (loginGeneration === generation) { user = normalizeUser(detail?.data, cookie.userid); await persist(); } } catch (_) { /* QR's user identity remains usable. */ }
        if (loginGeneration !== generation) return { status: 'expired' };
        return { status: 'success', user };
      }
      if (status === 0) { pendingQr.delete(params.key); return { status: 'expired' }; }
      return { status: status === 2 ? 'scanned' : 'waiting' };
    },
    logout: async () => {
      generation += 1;
      userAuthorization = null; authorizationRefresh = null;
      cookie = Object.fromEntries(DEVICE_KEYS.filter(key => cookie[key]).map(key => [key, cookie[key]]));
      user = null; pendingQr.clear(); playlistIndex.clear();
      await persist();
      return { loggedIn: false, user: null, platform: 'lite' };
    },
    search: async params => {
      const keyword = clean(params.keyword).slice(0, 200);
      if (!keyword) return { songs: [], total: 0 };
      let body;
      try { body = await call('search', { keywords: keyword, type: 'song', page: Math.max(1, number(params.page) || 1), pagesize: 30 }); }
      catch (error) { if (number(error?.body?.error_code) === 152) throw fail(loggedIn() ? '登录需要重新确认，请用酷狗音乐概念版 App 重新扫码后搜索' : '搜索需要登录，请用酷狗音乐概念版 App 扫码登录', 'LOGIN_REQUIRED'); throw error; }
      const songs = arrayAt(body, ['data.lists', 'data.list', 'data.info', 'data.songs', 'lists', 'list']).map(normalizeSong).filter(s => s.hash);
      return { songs, total: number(first(body?.data?.total, body?.data?.total_count, body?.total, songs.length)) };
    },
    recommendations: async () => {
      const body = await call('top_playlist', { page: 1, pagesize: 12 });
      return { playlists: rememberPlaylists(arrayAt(body, ['data.special_list', 'data.specials', 'data.list', 'data.lists', 'data.info', 'data', 'list', 'special_list'])) };
    },
    dailyRecommendations: async () => accountRecommendations('recommend_songs', 'kugou-daily', '每日推荐', { platform: 'android' }),
    // login is the provider's initial recommendation fetch. Deliberately omit
    // hash/songid/playtime and never forward renderer-supplied feedback actions.
    guessYouLike: async () => accountRecommendations('personal_fm', 'kugou-personal-fm', '猜你喜欢', { action: 'login', platform: 'android', remain_songcnt: 0 }),
    playlists: async params => {
      requireLogin();
      const startedGeneration = generation;
      const playlists = [];
      let page = Math.max(1, number(params.page) || 1);
      let total = 0;
      let hasMore = false;
      // Most libraries fit one page. Continue full pages when loading the library
      // initially; an explicit page requests a single batch for very large libraries.
      for (let batch = 0; batch < (params.page ? 1 : 20); batch += 1) {
        const body = await privatePlaylistCall('user_playlist', { page, pagesize: 100 });
        if (startedGeneration !== generation) throw fail('登录已更改，请重新打开歌单', 'LOGIN_REQUIRED');
        const list = rememberPlaylists(arrayAt(body, ['data.info', 'data.lists', 'data.list', 'data', 'info']));
        playlists.push(...list);
        total = number(first(body?.data?.total, body?.data?.count, body?.total, playlists.length));
        hasMore = list.length === 100 && (!total || page * 100 < total || total === playlists.length);
        if (!hasMore) break;
        page += 1;
      }
      return { playlists, total: Math.max(total, playlists.length), hasMore, nextPage: hasMore ? page : null };
    },
    playlistSongs: async params => {
      const found = playlistIndex.get(clean(params.id)) || {};
      const listId = clean(first(params.listId, params.listid, found.listId));
      const globalId = clean(first(params.globalId, params.global_collection_id, found.globalId, params.id));
      if (!globalId && !listId) throw fail('歌单信息不完整', 'INVALID_PLAYLIST');
      const startedGeneration = generation;
      const page = Math.min(1000000, Math.max(1, Math.floor(number(params.page) || 1)));
      const privateList = Boolean(listId && loggedIn());
      const requestedSize = Math.min(300, Math.max(1, Math.floor(number(params.pageSize) || (privateList ? 300 : 100))));
      let offset = privateList ? (page - 1) * requestedSize : Math.max(0, Math.floor(number(first(params.offset, (page - 1) * requestedSize))));
      let body;
      if (privateList) body = await privatePlaylistCall('playlist_track_all_new', { listid: listId, type: first(params.type, found.type, 0), page, pagesize: requestedSize });
      else body = await call('playlist_track_all', { id: globalId, page, pagesize: requestedSize, offset });
      if (startedGeneration !== generation) throw fail('登录已更改，请重新打开歌单', 'LOGIN_REQUIRED');
      const rawSongs = arrayAt(body, ['data.info', 'data.songs', 'data.list', 'data.lists', 'data.files', 'data', 'songs', 'info']);
      const rawCount = rawSongs.length;
      const echoedSize = Math.floor(number(first(body?.data?.pagesize, body?.data?.page_size, body?.pagesize, body?.page_size)));
      const pageSize = echoedSize > 0 && echoedSize <= requestedSize ? echoedSize : requestedSize;
      if (privateList) offset = (page - 1) * pageSize;
      const entryScope = `${privateList ? 'private' : 'public'}:${privateList ? listId : globalId}`;
      // A playlist can contain the same recording more than once. Identify the
      // entry by its source position; the audio hash identifies playable content.
      const songs = rawSongs.map((entry, index) => ({ ...normalizeSong(entry), playlistEntryId: `${entryScope}:${offset + index}`, playlistPosition: offset + index })).filter(s => s.hash);
      const explicitTotal = first(body?.data?.total, body?.data?.total_count, body?.total, body?.total_count);
      const reported = first(explicitTotal, body?.data?.count, body?.count);
      const totalReported = reported !== undefined && Number.isFinite(Number(reported)) && Number(reported) >= 0;
      const sourceTotal = totalReported ? Math.floor(Number(reported)) : null;
      // Some endpoints use count for the current page. An ambiguous count, or no
      // count at all, needs one more page probe; an empty page always terminates.
      const trustworthyTotal = totalReported && (explicitTotal !== undefined || sourceTotal > rawCount);
      const consumed = offset + rawCount;
      const hasMore = rawCount > 0 && (!trustworthyTotal || consumed < sourceTotal);
      const echoedPage = Math.floor(number(first(body?.data?.page, body?.page)));
      return {
        songs, total: Math.max(sourceTotal || 0, consumed), sourceTotal, totalReported, totalReliable: trustworthyTotal,
        sourcePage: echoedPage > 0 ? echoedPage : null,
        page, pageSize, rawCount, offset, hasMore, nextPage: hasMore ? page + 1 : null,
        nextOffset: hasMore ? (privateList ? offset + pageSize : consumed) : null,
      };
    },
    songQualities: async params => {
      const hash = clean(params.hash).toLowerCase();
      // The picker describes requests the user may make. A catalogue response is
      // never a playback probe, including when it reports an entitlement hint.
      const baseRow = tier => ({ id: tier.id, label: tier.label, group: tier.group, hint: tier.hint, selectable: true, playable: null });
      if (!/^[a-f0-9]{32}$/.test(hash)) {
        return { tiers: QUALITY_TIERS.map(tier => ({ ...baseRow(tier), offered: null, reason: tier.id === 'auto' ? 'AUTO' : 'UNKNOWN' })) };
      }
      const body = await call('privilege_lite', { hash, album_id: String(number(params.albumId)) });
      const resource = arrayAt(body, ['data'])[0] || body?.data || {};
      const variants = new Map();
      for (const variant of arrayAt(resource, ['relate_goods'])) {
        const tier = String(variant.quality).toLowerCase();
        if (!QUALITY_TIER_IDS.includes(tier) || !/^[a-f0-9]{32}$/i.test(variant.hash || '')) continue;
        const seconds = number(variant.info?.duration) / 1000;
        const fileSize = Math.max(0, number(variant.info?.filesize));
        const reported = Math.max(0, number(variant.info?.bitrate));
        // Premium tiers come back without a bitrate; derive one from size and duration.
        const derived = seconds > 0 && fileSize > 0 ? fileSize * 8 / seconds / 1000 : 0;
        variants.set(tier, {
          failProcess: number(variant.fail_process), fileSize,
          bitrateKbps: reported > 10000 ? reported / 1000 : (reported || derived),
          bitrateSource: reported > 0 ? 'reported' : derived > 0 ? 'estimated' : 'unknown',
          extName: clean(variant.info?.extname).toLowerCase(),
        });
      }
      const specOf = variant => {
        const kbps = Math.round(variant.bitrateKbps || 0);
        const knownFormat = ['mp3', 'mpeg', 'flac', 'wav', 'aac', 'm4a', 'mp4', 'ogg', 'opus'].includes(variant.extName);
        const format = knownFormat ? `服务标注 ${variant.extName.toUpperCase()}` : '格式待确认';
        const rate = kbps ? ` · ${kbps} kbps${variant.bitrateSource === 'estimated' ? '（估算）' : ''}` : '';
        return `${format}${rate} · 待验证`;
      };
      const rowFor = (tier, variant) => {
        const base = baseRow(tier);
        if (tier.id === 'auto') return { ...base, offered: null, reason: 'AUTO' };
        if (!variant) return { ...base, offered: false, reason: 'NOT_REPORTED' };
        const entitlementHint = variant.failProcess === ENTITLEMENT_HINT_PROCESS;
        return {
          ...base, offered: true, reason: entitlementHint ? 'ENTITLEMENT_UNCONFIRMED' : 'OFFERED_UNVERIFIED',
          ...(entitlementHint ? { entitlementHint: '服务返回权益限制提示，请以实际播放授权为准' } : {}),
          spec: specOf(variant), bitrateKbps: Math.round(variant.bitrateKbps || 0),
          bitrateSource: variant.bitrateSource, fileSize: variant.fileSize,
        };
      };
      return {
        tiers: QUALITY_TIERS.map(tier => rowFor(tier, tier.id === 'lossless' ? (variants.get('high') || variants.get('flac')) : variants.get(tier.id))),
      };
    },
    songUrl: async params => {
      const hash = clean(params.hash).toLowerCase();
      if (!/^[a-f0-9]{32}$/.test(hash)) throw fail('歌曲信息不完整，无法播放', 'INVALID_SONG');
      const requestedMode = String(params.quality ?? 'max').toLowerCase();
      const ladder = QUALITY_LADDERS[requestedMode];
      if (!ladder) throw fail('不支持这个音质档位', 'INVALID_QUALITY');
      const tiers = ladder;
      const lastLosslessTier = [...tiers].reverse().find(entry => LOSSLESS_TIERS.includes(String(entry)));
      const input = { hash, album_id: number(params.albumId), album_audio_id: number(params.albumAudioId) };
      const songGeneration = generation;
      const budget = resolutionBudget({ timeoutMs: Math.max(1, Number(songUrlBudgetMs) || 30000), now, setTimer, clearTimer });
      let best;
      let fullPreview;
      const request = (name, data) => budget.run(() => {
        if (songGeneration !== generation) throw fail('登录状态已改变，请重新播放', 'SESSION_EXPIRED');
        return call(name, data, { budget });
      }, Boolean(best || fullPreview));
      const prepare = (body, preview, selection) => budget.run(() => prepareStream(body, preview, selection), Boolean(best || fullPreview));
      let previousError;
      let lastTransportError;
      const rememberError = error => {
        if (error === budget.error || ['SECURITY_VERIFICATION_REQUIRED', 'LOGIN_REQUIRED', 'AUTH_REQUIRED', 'SESSION_EXPIRED'].includes(publicError(error).code)) throw error;
        if (error?.streamResolutionFailure) lastTransportError = error;
        previousError = error;
      };
      try {
      const variants = new Map();
      if (String(tiers[0]) !== '128') {
        try {
          const privilege = await request('privilege_lite', { hash, album_id: String(input.album_id) });
          const resource = arrayAt(privilege, ['data'])[0] || privilege?.data || {};
          for (const variant of arrayAt(resource, ['relate_goods'])) {
            const tier = String(variant.quality).toLowerCase();
            if (!QUALITY_TIER_IDS.includes(tier) || !/^[a-f0-9]{32}$/i.test(variant.hash || '')) continue;
            variants.set(tier, {
              hash: variant.hash.toLowerCase(), album_id: number(first(variant.album_id, input.album_id)), album_audio_id: number(first(variant.album_audio_id, input.album_audio_id)),
              hints: { duration: number(variant.info?.duration) / 1000, fileSize: number(variant.info?.filesize), bitrateKbps: number(variant.info?.bitrate), extName: clean(variant.info?.extname).toLowerCase() },
            });
          }
        } catch (error) { rememberError(error); }
      }
      let verification;
      const authorizations = new Map();
        const authorize = async candidate => {
          if (songGeneration !== generation) throw fail('登录状态已改变，请重新播放', 'SESSION_EXPIRED');
          if (!loggedIn()) return null;
        verification ||= (async () => {
          // Registration is shared with other songs and QR login; one song's
          // private budget must not cancel that shared, independently bounded call.
            await budget.run(() => requestBudget.exit(() => ensureDevice()), Boolean(best || fullPreview));
            return budget.run(() => refreshUserAuthorization(), Boolean(best || fullPreview));
          })();
          const auth = await budget.run(() => verification, Boolean(best || fullPreview));
          if (songGeneration !== generation) throw fail('登录状态已改变，请重新播放', 'SESSION_EXPIRED');
          if (!authorizations.has(candidate.hash)) authorizations.set(candidate.hash, (async () => {
            try { return (await request('song_auth', { ...candidate, auth }))?.data || {}; }
            catch (error) {
              if (!authorizationRejected(error)) throw error;
              const replacement = await budget.run(() => refreshUserAuthorization({ force: true, failedAuth: auth }), Boolean(best || fullPreview));
              if (songGeneration !== generation) throw fail('登录状态已改变，请重新播放', 'SESSION_EXPIRED');
              verification = Promise.resolve(replacement);
              return (await request('song_auth', { ...candidate, auth: replacement }))?.data || {};
            }
          })());
          return authorizations.get(candidate.hash);
      };
      const lossless = stream => losslessQuality(stream?.quality) && (stream.quality.streamVerified || typeof resolveStream !== 'function');
      const meets = (stream, tier) => {
        if (stream.preview) return false;
        if (SPECIAL_TIERS.has(String(tier))) return stream.quality.tierVerified;
        if (String(tier) === '128') return true;
        if (LOSSLESS_TIERS.includes(String(tier))) return lossless(stream);
        return String(tier) === '320' && (lossless(stream) || ((stream.quality.streamVerified || typeof resolveStream !== 'function') && ordinaryTierSatisfied(stream.quality, tier)));
      };
      // Format takes precedence over bitrate. An unknown container with a large
      // reported bitrate cannot outrank verified ordinary lossless audio.
      const score = stream => lossless(stream)
        ? 100 + stream.quality.bitDepth / 32 + stream.quality.sampleRateHz / 200000
        : (lossyQuality(stream.quality) ? 10 : 0) + Math.min(9, Math.max(0, number(stream.quality.bitrateKbps) / 1000));
      // Never settle on the first lossless stream: the same rung can yield a better spec
      // from the authorized route, and a lower rung can still beat a higher one.
      const compareLosslessRoutes = tier => LOSSLESS_TIERS.includes(String(tier));
      const consider = (stream, tier, index) => {
        if (!stream) return null;
        stream.quality.fallback = Boolean(index || !meets(stream, tier));
        if (stream.preview) { fullPreview ||= stream; return null; }
        if (!best || score(stream) > score(best) || (score(stream) === score(best) && stream.quality.tierVerified && !best.quality.tierVerified)) best = stream;
        if (!meets(stream, tier) || compareLosslessRoutes(tier)) return null;
        // A validated branded stream may use a lossy or multichannel container.
        // Return that confirmed delivery instead of an earlier ordinary FLAC.
        return SPECIAL_TIERS.has(String(tier)) ? stream : best;
      };
      for (let index = 0; index < tiers.length; index++) {
        const tier = tiers[index];
        const variant = variants.get(String(tier));
        const candidate = { ...input, ...(variant ? { hash: variant.hash, album_id: variant.album_id, album_audio_id: variant.album_audio_id } : {}), quality: tier };
        const independentVariant = Boolean(variant && variant.hash !== input.hash && [...variants.entries()].every(([id, other]) => id === String(tier) || other.hash !== variant.hash));
        const selection = { mode: requestedMode, requested: tier, hash: candidate.hash, independentVariant, fallback: index > 0, hints: variant?.hints };
        try { const ready = consider(await prepare(await request('song_url', candidate), false, selection), tier, index); if (ready) return ready; } catch (error) { rememberError(error); }
        try {
          const authorization = await authorize(candidate);
          if (authorization?.auth || authorization?.open_time) {
            const ready = consider(await prepare(await request('song_url_auth', { ...candidate, auth: authorization.auth, open_time: authorization.open_time }), false, selection), tier, index);
            if (ready) return ready;
          }
        } catch (error) { rememberError(error); }
        if (lastLosslessTier !== undefined && String(tier) === String(lastLosslessTier) && lossless(best)) return best;
      }
      if (best) return best;
      if (fullPreview) return fullPreview;
      // Official preview mode obeys the service's own preview entitlement.
      try { const stream = await prepare(await request('song_url', { ...input, quality: 128, free_part: true }), true, { mode: requestedMode, requested: 128, fallback: requestedMode !== '128' }); if (stream) return stream; } catch (error) { rememberError(error); }
      if (lastTransportError) throw lastTransportError;
      if (previousError && publicError(previousError).code === 'TIMEOUT') throw previousError;
      throw fail(loggedIn() ? '这首歌暂时无法播放，请在概念版 App 中确认账号的播放权限' : '这首歌需要登录或播放权限，请先用概念版 App 扫码登录', 'PLAYBACK_UNAVAILABLE');
      } catch (error) {
        if (error === budget.error && (best || fullPreview)) return best || fullPreview;
        throw error;
      } finally { budget.close(); }
    },
    lyrics: async params => {
      const hash = clean(params.hash);
      if (!/^[a-f0-9]{32}$/i.test(hash)) return normalizeLyricText('');
      const result = await call('search_lyric', {
        hash, album_audio_id: number(params.albumAudioId),
        keywords: [clean(params.artist), clean(params.title)].filter(Boolean).join(' - ').slice(0, 200),
        duration: Math.round(number(params.duration) * 1000),
      });
      let best = normalizeLyricText(String(result?.lrctxt || result?.data?.lrctxt || ''));
      // The service's hash-selected candidate identifies the recording. Search
      // previews sometimes contain only the song title; they must not bypass
      // downloading the actual lyrics and provider word timing.
      const candidates = arrayAt(result, ['candidates', 'data.candidates']);
      const proposal = clean(first(result?.proposal, result?.data?.proposal));
      const candidate = candidates.find(item => clean(item?.id) === proposal) || candidates[0];
      if (!candidate?.id || !candidate?.accesskey) return best;
      let lastError;
      for (const fmt of ['krc', 'lrc']) {
        try {
          const downloaded = await call('lyric', { id: candidate.id, accesskey: candidate.accesskey, fmt, decode: false });
          const normalized = normalizeLyricText(decodeLyricResponse(downloaded, fmt));
          if (normalized.timing === 'word') return normalized;
          if (normalized.timedLines.length > best.timedLines.length || (!best.text && normalized.text)) best = normalized;
        } catch (error) { lastError = error; }
      }
      if (!best.text && lastError) throw lastError;
      return best;
    },
  };
  return { async invoke(method, params = {}) {
    try {
      await ready;
      if (!Object.hasOwn(methods, method)) throw fail('接口不可用', 'UNSUPPORTED');
      if (!params || typeof params !== 'object' || Array.isArray(params)) throw fail('请求参数无效', 'INVALID_PARAMS');
      return { ok: true, data: await methods[method](params) };
    } catch (error) { return publicError(error); }
  } };
}

module.exports = { createKugouAdapter };
