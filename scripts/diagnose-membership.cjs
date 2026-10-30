'use strict';
// Read the account only in memory. No cookies, grants, URLs or account IDs are
// printed, and neither the production profile nor its encrypted file is written.
const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const flags = new Set(process.argv.slice(2));
const songOption = process.argv.find(argument => argument.startsWith('--song='));
const titleWanted = songOption ? songOption.slice(7) : '特别的人';
process.env.platform = 'lite';
const diagnosticDir = path.join(root, 'test-output', 'membership-diagnosis');
fs.mkdirSync(diagnosticDir, { recursive: true });
const browserProfile = path.join(diagnosticDir, 'browser-profile');
fs.mkdirSync(browserProfile, { recursive: true });
// Chromium's Windows encryption key is stored encrypted in Local State. Copy
// that file into the isolated profile so safeStorage can read the account;
// never open the production Chromium profile for writing.
fs.copyFileSync(path.join(app.getPath('appData'), '青音概念桌面版', 'Local State'), path.join(browserProfile, 'Local State'));
app.setPath('userData', browserProfile);
const emit = item => console.log(JSON.stringify(item));
const number = value => Number.isFinite(Number(value)) ? Number(value) : undefined;
const countUrls = data => [data?.url, data?.play_url, data?.playUrl, data?.backupUrl, data?.backup_url].flat(Infinity).filter(value => typeof value === 'string' && /^https?:\/\//i.test(value)).length;
const numericFields = data => data && typeof data === 'object' ? Object.fromEntries(Object.entries(data).filter(([key, value]) => !/id|key|sign|token|auth|mid|hash|dfid/i.test(key) && (typeof value === 'number' || typeof value === 'boolean'))) : undefined;
app.whenReady().then(async () => {
  try {
    const accountPath = path.join(app.getPath('appData'), 'QingyinConcept', 'account.enc');
    const before = fs.readFileSync(accountPath);
    const session = JSON.parse(safeStorage.decryptString(before));
    if (flags.has('--refresh-auth')) delete session.cookie.auth;
    const upstream = path.join(root, 'vendor', 'kugou-api');
    const config = require(path.join(upstream, 'util', 'config.json'));
    const { createRequest } = require(path.join(upstream, 'util', 'request'));
    const secureRequest = options => {
      if (options.baseURL?.startsWith('http://')) {
        const host = new URL(options.baseURL).hostname;
        options.baseURL = 'https://gateway.kugou.com';
        options.headers = { ...options.headers, 'x-router': host };
      }
      return createRequest(options);
    };
    if (flags.has('--refresh-login')) {
      const response = await require(path.join(upstream, 'module', 'login_token'))({ cookie: { ...session.cookie } }, secureRequest);
      const allowed = new Set(['token', 'userid', 'vip_token', 'vip_type', 't1']);
      for (const entry of response.cookie || []) {
        const pair = String(entry).split(';', 1)[0], index = pair.indexOf('=');
        const key = pair.slice(0, index), value = pair.slice(index + 1);
        if (index > 0 && allowed.has(key) && value && value !== 'undefined') session.cookie[key] = value;
      }
      delete session.cookie.auth;
      emit({ stage: 'loginRefresh', status: number(response.body?.status), loginPresent: Boolean(session.cookie.token && session.cookie.userid), vipTokenPresent: Boolean(session.cookie.vip_token), vipType: number(session.cookie.vip_type), t1Present: Boolean(session.cookie.t1) });
    }
    emit({ stage: 'account', platform: session.platform, configuredPlatform: process.env.platform, appid: config.liteAppid, loginPresent: Boolean(session.cookie?.token && session.cookie?.userid), authPresent: Boolean(session.cookie?.auth), vipTokenPresent: Boolean(session.cookie?.vip_token), refreshInMemory: flags.has('--refresh-auth'), extendedBudget: flags.has('--extended-budget') });
    const traceModules = ['privilege_lite', 'user_verify', 'song_auth', 'song_url', 'song_url_auth'];
    for (const name of traceModules) {
      const file = require.resolve(path.join(upstream, 'module', name));
      const handler = require(file);
      require.cache[file].exports = async (params, request) => {
        if (name === 'song_url' && flags.has('--service-full-range')) params = { ...params, free_part: true };
        const started = Date.now();
        try {
          const response = await handler(params, options => {
            if (name.startsWith('song_url') && flags.has('--matching-client')) {
              options.params.clientver = config.liteClientver;
              options.params.version = 11436;
              options.params.kcard = 0;
            }
            if (flags.has('--session-cookie')) {
              const keys = new Set(['token', 'userid', 'auth', 't1', 'vip_token', 'vip_type', 'dfid', 'KUGOU_API_MID', 'KUGOU_API_GUID', 'KUGOU_API_DEV', 'KUGOU_API_MAC']);
              const value = Object.entries(options.cookie || {}).filter(([key, value]) => keys.has(key) && value !== undefined && value !== '').map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`).join('; ');
              options.headers = { ...options.headers, Cookie: value };
            }
            return request(options);
          });
          const body = response?.body || {}, data = body.data || body;
          const freePart = data.free_part || data.freePart;
          emit({ stage: 'route', name, requestedQuality: params.quality, appid: config.liteAppid, pid: name.startsWith('song_url') ? 411 : undefined, freePartRequested: Boolean(params.free_part), elapsedMs: Date.now() - started, status: number(body.status), code: number(body.error_code ?? body.errcode ?? body.code ?? body.err_code), hasGrant: Boolean(data.auth), openTimePresent: Boolean(data.open_time), urlCount: countUrls(data), responseQuality: typeof data.quality === 'string' || typeof data.quality === 'number' ? data.quality : undefined, responseFormat: data.extName || data.extname, serviceDuration: number(data.timeLength ?? data.timelength ?? data.duration), explicitPreview: number(data.is_free_part ?? data.isFreePart), freePartFields: freePart && typeof freePart === 'object' ? Object.keys(freePart).filter(key => !/token|auth|url|key|hash|user/i.test(key)) : undefined, freePartStart: number(freePart?.time_start ?? freePart?.start), freePartEnd: number(freePart?.time_end ?? freePart?.end), responseFields: Object.keys(data).filter(key => !/token|auth|url|key|hash|user/i.test(key)), errorNumber: number(data.error), numericFields: numericFields(data), privileges: numericFields(data.priv_status), variants: name === 'privilege_lite' ? (Array.isArray(data) ? data[0]?.relate_goods : data.relate_goods)?.map(item => ({ quality: item.quality, failProcess: number(item.fail_process), format: item.info?.extname, fileSize: number(item.info?.filesize), durationMs: number(item.info?.duration) })) : undefined });
          if (name === 'privilege_lite' && flags.has('--base-hash')) {
            for (const resource of Array.isArray(body.data) ? body.data : [body.data || body]) {
              if (Array.isArray(resource.relate_goods)) resource.relate_goods = resource.relate_goods.filter(item => !['128', '320', 'flac', 'high'].includes(String(item.quality)));
            }
            emit({ stage: 'diagnosticPolicy', ordinaryTiersUseOriginalSongHash: true });
          }
          return response;
        } catch (error) {
          const body = error?.body || {}, message = String(body.errmsg || body.error || (typeof body.msg === 'string' ? body.msg : '') || '');
          emit({ stage: 'route', name, requestedQuality: params.quality, elapsedMs: Date.now() - started, errorType: error.name, httpStatus: number(error.status), serviceCode: number(body.error_code ?? body.errcode ?? body.code ?? body.err_code), errorCode: /^[\w-]{1,40}$/.test(String(error.publicCode || error.code || body.msg?.code || '')) ? String(error.publicCode || error.code || body.msg?.code) : undefined, authenticationRejected: /auth|token|授权|登录/i.test(message), bodyFields: Object.keys(body).filter(key => !/token|auth|url|key|hash|user/i.test(key)) }); throw error;
        }
      };
    }
    const axios = require('axios');
    axios.interceptors.request.use(config => {
      if (config.params?.appid) emit({ stage: 'platform', appid: Number(config.params.appid), pid: number(config.params.pid), route: String(config.url || '').split('?')[0], loggedInRequest: Boolean(config.params.token && config.params.userid) });
      return config;
    });
    if (flags.has('--membership-only') || flags.has('--membership-batch')) {
      const { createRequest } = require(path.join(upstream, 'util', 'request'));
      const allowed = new Set(['is_vip', 'is_svip', 'is_qvip', 'is_dvip', 'vip_type', 'product_type', 'product_name', 'vip_name', 'busi_type', 'expire_time', 'end_time', 'endtime', 'expiretime', 'valid_days', 'vip_end_time', 'vip_expire_time', 'status', 'error_code', 'errcode', 'expire', 'expired', 'is_expire', 'm_type', 'm_end_time', 'm_y_endtime', 'user_type', 'y_type']);
      for (const name of flags.has('--membership-batch') ? ['batch_v1', 'user_batch_union_vipinfo'] : ['user_vip_detail', 'youth_union_vip']) {
        const response = name === 'batch_v1' ? await secureRequest({ baseURL: 'https://kugouvip.kugou.com', url: '/v1/batch_union_vipinfo', method: 'POST', encryptType: 'android', cookie: { ...session.cookie }, data: { product_type: 'svip', busi_type: 'concept', useridlist: [Number(session.cookie.userid)], get_type: 3 } })
          : await require(path.join(upstream, 'module', name))({ cookie: { ...session.cookie }, useridlist: [Number(session.cookie.userid)], clientappid: '3116' }, createRequest);
        const fields = {};
        const walk = (value, prefix = '', depth = 0) => {
          if (!value || typeof value !== 'object' || depth > 5) return;
          for (const [key, entry] of Object.entries(value)) {
            if (/id|key|sign|token|auth|mid|hash|dfid/i.test(key)) continue;
            if (allowed.has(key) && ['string', 'number', 'boolean'].includes(typeof entry)) fields[prefix + key] = entry;
            else if (entry && typeof entry === 'object') walk(entry, `${prefix}${/^\d{5,}$/.test(key) ? 'account' : key}.`, depth + 1);
          }
        };
        walk(response.body);
        emit({ stage: 'membership', name, fields, dataFields: Object.keys(response.body?.data || {}).filter(key => !/id|key|sign|token|auth|mid|hash|dfid/i.test(key)) });
      }
      emit({ stage: 'accountFile', unchanged: before.equals(fs.readFileSync(accountPath)) });
      return;
    }
    let { createKugouAdapter } = require('../lib/kugou.cjs');
    if (flags.has('--old-adapter')) {
      const asar = await import('@electron/asar');
      const Module = require('node:module');
      const archive = path.join(root, 'test-output', 'backup-0.1.31-20261007-213010', 'resources', 'app.asar');
      const source = asar.extractFile(archive, path.normalize('lib/kugou.cjs')).toString('utf8');
      const filename = path.join(root, 'lib', 'kugou.cjs');
      const loaded = new Module(filename);
      loaded.filename = filename;
      loaded.paths = Module._nodeModulePaths(path.dirname(filename));
      loaded._compile(source, filename);
      createKugouAdapter = loaded.exports.createKugouAdapter;
      emit({ stage: 'adapterVersion', version: '0.1.31', loadedInMemory: true });
    }
    const { createStreamManager } = require('../lib/stream.cjs');
    const streams = createStreamManager();
    const adapter = createKugouAdapter({ loadSession: () => session, saveSession: () => {}, songUrlBudgetMs: flags.has('--extended-budget') ? 90000 : 30000, resolveStream: async metadata => {
      emit({ stage: 'candidate', format: metadata.extName, preview: metadata.preview, duration: metadata.duration, fileSize: metadata.fileSize, bitrateKbps: metadata.bitrateKbps });
      const started = Date.now();
      const resolved = await streams.prepare(metadata);
      emit({ stage: 'verified', elapsedMs: Date.now() - started, duration: resolved.duration, preview: resolved.preview, format: resolved.quality?.format, bitDepth: resolved.quality?.bitDepth, sampleRateHz: resolved.quality?.sampleRateHz, bitrateKbps: resolved.quality?.bitrateKbps });
      return resolved;
    } });
    const library = await adapter.invoke('playlists');
    const targetList = library.data?.playlists?.find(list => list.title === '做梦') || library.data?.playlists?.find(list => list.count === 434) || library.data?.playlists?.find(list => /喜欢/.test(list.title));
    emit({ stage: 'playlistSelection', title: targetList?.title, count: targetList?.count });
    let song;
    if (flags.has('--reference')) song = { hash: '02A00CB5F4E6D7BD6569856ACF36FD97', albumId: '527873', albumAudioId: '27596599', title: 'secret base ～君がくれたもの～ (10 years after Ver.)', artist: '茅野愛衣 / 戸松遥 / 早見沙織', duration: 0 };
    if (targetList && !song) {
      for (let page = 1; page <= 4; page += 1) {
        const detail = await adapter.invoke('playlistSongs', { id: targetList.id, page });
        song = detail.data?.songs?.find(item => item.title === titleWanted);
        if (song || !detail.data?.hasMore) break;
      }
    }
    const fromPlaylist = Boolean(song);
    if (!song || flags.has('--search-selection')) {
      const search = await adapter.invoke('search', { keyword: titleWanted === '特别的人' ? '方大同 特别的人' : titleWanted });
      const searched = search.data?.songs?.find(item => item.title === titleWanted && (titleWanted !== '特别的人' || /方大同/.test(item.artist))) || search.data?.songs?.find(item => item.title.includes(titleWanted));
      if (song && searched) emit({ stage: 'metadataComparison', sameHash: song.hash === searched.hash, sameAlbum: song.albumId === searched.albumId, sameAlbumAudio: song.albumAudioId === searched.albumAudioId });
      song = searched;
    }
    if (!song) throw Object.assign(new Error('Selection unavailable'), { code: 'SELECTION_UNAVAILABLE' });
    emit({ stage: 'selection', title: song.title, artist: song.artist, album: song.album, duration: song.duration, fromPlaylist, albumPresent: Boolean(Number(song.albumId)), albumAudioPresent: Boolean(Number(song.albumAudioId)) });
    if (flags.has('--new-route') || flags.has('--new-authorized-route')) {
      let grant;
      if (flags.has('--new-authorized-route')) {
        const verified = await require(path.join(upstream, 'module', 'user_verify'))({ cookie: { ...session.cookie } }, secureRequest);
        const auth = verified.body?.data?.auth;
        grant = (await require(path.join(upstream, 'module', 'song_auth'))({ hash: song.hash, album_audio_id: Number(song.albumAudioId), auth, cookie: { ...session.cookie } }, secureRequest)).body?.data;
        emit({ stage: 'newAuthorization', verified: Boolean(auth), hasGrant: Boolean(grant?.auth), openTimePresent: Boolean(grant?.open_time) });
      }
      const response = await require(path.join(upstream, 'module', 'song_url_new'))({ hash: song.hash.toLowerCase(), album_audio_id: String(song.albumAudioId || '0'), cookie: { ...session.cookie } }, options => {
        if (grant?.auth) {
          options.data.tracker_param.auth = grant.auth;
          options.data.tracker_param.open_time = grant.open_time;
          options.data.tracker_param.module_id = 51;
        }
        if (flags.has('--direct-tls')) {
          options.baseURL = 'https://tracker.kugou.com';
          return createRequest(options);
        }
        return secureRequest(options);
      });
      const scan = (value, field = '', depth = 0) => {
        if (!value || typeof value !== 'object' || depth > 5) return;
        if (countUrls(value)) emit({ stage: 'newCandidate', field, urlCount: countUrls(value), format: value.extName || value.extname, quality: value.quality, flags: numericFields(value), fields: Object.keys(value).filter(key => !/token|auth|url|key|hash|user/i.test(key)) });
        for (const [key, entry] of Object.entries(value)) {
          if (entry && typeof entry === 'object' && !/token|auth|url|key|hash|user/i.test(key)) scan(entry, field ? `${field}.${key}` : key, depth + 1);
        }
      };
      emit({ stage: 'newRoute', status: response.body?.status, code: response.body?.error_code, fields: Object.keys(response.body?.data || response.body || {}).filter(key => !/token|auth|url|key|hash|user/i.test(key)) });
      scan(response.body);
      emit({ stage: 'accountFile', unchanged: before.equals(fs.readFileSync(accountPath)) });
      return;
    }
    const started = Date.now();
    const requestedQuality = flags.has('--lossless') ? 'lossless' : 'auto';
    const result = await adapter.invoke('songUrl', { ...song, quality: requestedQuality });
    emit({ stage: 'result', elapsedMs: Date.now() - started, ok: result.ok, code: result.code, preview: result.data?.preview, duration: result.data?.duration, quality: result.data?.quality });
    emit({ stage: 'accountFile', unchanged: before.equals(fs.readFileSync(accountPath)) });
  } catch (error) { emit({ stage: 'diagnostics', failed: true, type: error.name, code: /^[\w-]{1,40}$/.test(String(error.publicCode || error.code || '')) ? String(error.publicCode || error.code) : undefined, status: number(error?.status), serviceStatus: number(error?.body?.status), serviceCode: number(error?.body?.error_code ?? error?.body?.errcode ?? error?.body?.code ?? error?.body?.err_code), fields: Object.keys(error?.body || {}).filter(key => !/token|auth|url|key|hash|user/i.test(key)) }); process.exitCode = 1; }
}).finally(() => app.quit());
