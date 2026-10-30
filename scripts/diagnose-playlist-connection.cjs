'use strict';
// Read-only account diagnostics. Credentials and server text never leave memory.
const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.join(__dirname, '..');
const output = path.join(root, 'test-output', 'playlist-connection');
const profile = path.join(output, 'browser-profile');
fs.mkdirSync(profile, { recursive: true });
fs.copyFileSync(path.join(app.getPath('appData'), '青音概念桌面版', 'Local State'), path.join(profile, 'Local State'));
app.setPath('userData', profile);
process.env.platform = 'lite';
const report = [];
const emit = value => { report.push(value); console.log(JSON.stringify(value)); };
const safeCode = value => /^[\w-]{1,40}$/.test(String(value ?? '')) ? String(value) : null;
const codes = body => Object.fromEntries(['status', 'error_code', 'errcode', 'code', 'errno'].map(key => [key, safeCode(body?.[key])]).filter(([, value]) => value !== null));
function failure(error) {
  const body = error?.body || {};
  const text = String(body.errmsg || body.error || (typeof body.msg === 'string' ? body.msg : ''));
  return { ok: false, httpStatus: Number(error?.status || error?.response?.status || body.msg?.response?.status) || null,
    codes: codes(body), networkCode: safeCode(error?.code || body.msg?.code),
    loginMessage: /token.{0,30}(?:invalid|expired|失效|过期)|未登录|登录/i.test(text),
    security: Boolean(error?.headers?.['ssa-code'] || error?.status === 428), bodyKeys: Object.keys(body).filter(key => /^[a-z_]{1,30}$/i.test(key)) };
}
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
app.whenReady().then(async () => {
  const accountPath = path.join(app.getPath('appData'), 'QingyinConcept', 'account.enc');
  const before = fs.readFileSync(accountPath);
  const session = JSON.parse(safeStorage.decryptString(before));
  if (session.platform !== 'lite' || !session.cookie?.token || !session.cookie?.userid) throw Object.assign(new Error(), { code: 'NO_ACCOUNT' });
  const { createKugouAdapter } = require('../lib/kugou.cjs');
  const upstream = path.join(root, 'vendor', 'kugou-api');
  const { createRequest } = require(path.join(upstream, 'util', 'request'));
  emit({ stage: 'account', platform: 'lite', credentialsPresent: true, writesEnabled: false });
  if (process.argv.includes('--check-identity')) {
    const secureRequest = config => {
      if (config.baseURL?.startsWith('http://')) { const host = new URL(config.baseURL).hostname; config.baseURL = 'https://gateway.kugou.com'; config.headers = { ...config.headers, 'x-router': host }; }
      return createRequest(config);
    };
    const probe = async (stage, operation) => {
      try { const response = await operation(); emit({ stage, ok: true, codes: codes(response.body), dataPresent: Boolean(response.body?.data), cookieKeys: (response.cookie || []).map(value => String(value).split('=', 1)[0]).filter(key => /^[a-z_]{1,20}$/i.test(key)) }); return response; }
      catch (error) { emit({ stage, ...failure(error) }); return null; }
    };
    await probe('userDetail', () => require(path.join(upstream, 'module', 'user_detail'))({ cookie: { ...session.cookie } }, secureRequest));
    await probe('matchedClientPlaylist', () => require(path.join(upstream, 'module', 'user_playlist'))({ page: 1, pagesize: 100, cookie: { ...session.cookie } }, config => createRequest({ ...config, headers: { ...config.headers, 'User-Agent': 'Android15-1070-11440-46-0-DiscoveryDRADProtocol-wifi' } })));
    const refreshed = await probe('loginRefresh', () => require(path.join(upstream, 'module', 'login_token'))({ cookie: { ...session.cookie } }, secureRequest));
    if (refreshed?.body?.status === 1) {
      for (const entry of refreshed.cookie || []) { const pair = String(entry).split(';', 1)[0], position = pair.indexOf('='); const key = pair.slice(0, position), value = pair.slice(position + 1); if (['token', 'userid', 't1', 'vip_token', 'vip_type'].includes(key) && value && value !== 'undefined') session.cookie[key] = value; }
      await probe('afterLoginRefresh', () => require(path.join(upstream, 'module', 'user_playlist'))({ page: 1, pagesize: 100, cookie: { ...session.cookie } }, secureRequest));
    }
  }
  const handler = require(path.join(upstream, 'module', 'user_playlist'));
  const started = Date.now();
  try {
    const response = await handler({ page: 1, pagesize: 100, cookie: { ...session.cookie } }, createRequest);
    const body = response.body;
    const rows = [body?.data?.info, body?.data?.lists, body?.data?.list, body?.data, body?.info].find(Array.isArray) || [];
    emit({ stage: 'rawPlaylists', ok: true, elapsedMs: Date.now() - started, codes: codes(body), count: rows.length,
      dataKeys: Object.keys(body?.data || {}).filter(key => /^[a-z_]{1,30}$/i.test(key)), security: Boolean(response.headers?.['ssa-code']) });
  } catch (error) { emit({ stage: 'rawPlaylists', elapsedMs: Date.now() - started, ...failure(error) }); }
  const api = createKugouAdapter({ loadSession: () => session, saveSession: () => {} });
  const result = await api.invoke('playlists', { page: 1 });
  emit({ stage: 'adapterPlaylists', ok: result.ok, code: safeCode(result.code), count: result.data?.playlists?.length || 0 });
  if (process.argv.includes('--refresh-device') && result.code === '20017') {
    try {
      const registration = await require(path.join(upstream, 'module', 'register_dev'))({ cookie: { ...session.cookie } }, createRequest);
      const deviceCookie = registration.cookie?.find(entry => String(entry).startsWith('dfid='));
      const dfid = deviceCookie ? String(deviceCookie).split(';', 1)[0].slice(5) : '';
      emit({ stage: 'deviceRegistration', codes: codes(registration.body), deviceReturned: Boolean(dfid), deviceChanged: Boolean(dfid && dfid !== session.cookie.dfid) });
      if (dfid && dfid !== '-' && registration.body?.status === 1) {
        session.cookie.dfid = dfid;
        const retried = createKugouAdapter({ loadSession: () => session, saveSession: () => {} });
        const recovered = await retried.invoke('playlists', { page: 1 });
        emit({ stage: 'afterDeviceRegistration', ok: recovered.ok, code: safeCode(recovered.code), count: recovered.data?.playlists?.length || 0 });
        if (recovered.ok && recovered.data?.playlists?.length) {
          const target = recovered.data.playlists.find(list => /喜欢/.test(list.title)) || recovered.data.playlists[0];
          const songs = await retried.invoke('playlistSongs', { ...target, page: 1, pageSize: 300 });
          emit({ stage: 'recoveredSongs', ok: songs.ok, code: safeCode(songs.code), count: songs.data?.songs?.length || 0, total: songs.data?.total, hasMore: songs.data?.hasMore });
        }
      }
    } catch (error) { emit({ stage: 'deviceRegistration', ...failure(error) }); }
  }
  if (result.ok && result.data?.playlists?.length) {
    const target = result.data.playlists.find(list => /喜欢/.test(list.title)) || result.data.playlists[0];
    const songs = await api.invoke('playlistSongs', { ...target, page: 1, pageSize: 300 });
    emit({ stage: 'adapterSongs', ok: songs.ok, code: safeCode(songs.code), count: songs.data?.songs?.length || 0, total: songs.data?.total, hasMore: songs.data?.hasMore });
  }
  emit({ stage: 'accountIntegrity', unchanged: digest(before) === digest(fs.readFileSync(accountPath)) });
}).catch(error => { emit({ stage: 'fatal', ...failure(error) }); process.exitCode = 1; }).finally(() => {
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  app.quit();
});
