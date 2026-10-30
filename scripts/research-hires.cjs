// Read-only source-quality diagnostics. No account or production files are written.
const { app, safeStorage, BrowserWindow, protocol } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
process.env.platform = 'lite';
app.setName('青音概念桌面版');
app.setPath('userData', path.join(app.getPath('appData'), '青音概念桌面版'));
protocol.registerSchemesAsPrivileged([{ scheme: 'qingyin-stream', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);
const log = value => console.log(JSON.stringify(value));
const upstream = path.join(__dirname, '..', 'vendor', 'kugou-api');
const { createRequest } = require(path.join(upstream, 'util', 'request'));
const axios = require('axios');
axios.defaults.timeout = 15000;
axios.defaults.maxContentLength = 10 * 1024 * 1024;
const { createStreamManager, validateURL } = require('../lib/stream.cjs');
let window;
app.whenReady().then(async () => {
  const stored = JSON.parse(safeStorage.decryptString(fs.readFileSync(path.join(app.getPath('appData'), 'QingyinConcept', 'account.enc'))));
  if (stored.platform !== 'lite' || !stored.cookie?.token) throw new Error('No concept account');
  const cookie = { ...stored.cookie };
  log({ stage: 'account', authenticated: true, platform: 'lite', persistentWrites: false });
  async function call(name, params = {}) {
    const handler = require(path.join(upstream, 'module', `${name}.js`));
    const response = await handler({ ...params, cookie: { ...cookie } }, config => {
      if (config.baseURL?.startsWith('http://')) {
        const originalHost = new URL(config.baseURL).hostname;
        config.baseURL = 'https://gateway.kugou.com';
        config.headers = { ...config.headers, 'x-router': originalHost };
      }
      return createRequest(config);
    });
    if (response?.headers?.['ssa-code']) throw Object.assign(new Error('Security verification required'), { publicCode: 'SECURITY_VERIFICATION_REQUIRED' });
    for (const entry of response.cookie || []) {
      const pair = String(entry).split(';', 1)[0];
      const i = pair.indexOf('=');
      if (i > 0) cookie[pair.slice(0, i)] = pair.slice(i + 1);
    }
    return response.body;
  }
  const manager = createStreamManager();
  protocol.handle('qingyin-stream', request => manager.handle(request));
  window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, autoplayPolicy: 'no-user-gesture-required' } });
  await window.loadURL('data:text/html,<meta charset="utf-8"><body>Muted source diagnostics</body>');
  async function decode(url) {
    return window.webContents.executeJavaScript(`(async () => {
      const audio = new Audio(); audio.muted = true; audio.src = ${JSON.stringify(url)};
      document.body.append(audio);
      try {
        await new Promise((resolve,reject) => {
          const timer=setTimeout(()=>reject(new Error('decode timeout')),12000);
          audio.addEventListener('canplay',()=>{clearTimeout(timer);resolve();},{once:true});
          audio.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('audio error '+audio.error?.code));},{once:true});
        });
        await audio.play(); await new Promise(resolve=>setTimeout(resolve,900));
        const before=audio.currentTime; audio.currentTime=20;
        await new Promise(resolve=>setTimeout(resolve,700));
        return {decode:true,duration:audio.duration,advanceSeconds:before,seekSeconds:audio.currentTime};
      } catch(error) {return {decode:false,type:error.name,reason:error.message};}
      finally {audio.pause();audio.remove();audio.src='';}
    })()`);
  }
  const song = { hash: '02A00CB5F4E6D7BD6569856ACF36FD97', album_id: '527873', album_audio_id: 27596599 };
  const privilege = await call('privilege_lite', song);
  const resource = Array.isArray(privilege.data) ? privilege.data[0] : privilege.data;
  const variants = resource?.relate_goods || [];
  log({ stage: 'song', title: 'secret base ～君がくれたもの～ (10 years after Ver.)', artist: '茅野愛衣、戸松遥、早見沙織', sourceHash: song.hash, qualities: variants.map(v => ({ quality: v.quality, hash: v.hash, albumId: v.album_id, albumAudioId: v.album_audio_id, info: { duration: v.info?.duration, fileSize: v.info?.filesize, bitrateKbps: v.info?.bitrate, extension: v.info?.extname }, status: v.status, failProcess: v.fail_process })) });
  let verified = Boolean(cookie.auth);
  for (const tier of ['high', 'viper_clear', 'viper_tape']) {
    const variant = variants.find(v => v.quality === tier);
    if (!variant) { log({ stage: 'tier', tier, availableVariant: false }); continue; }
    const candidate = { quality: tier, hash: variant.hash, album_id: variant.album_id || song.album_id, album_audio_id: variant.album_audio_id || song.album_audio_id };
    let body = await call('song_url', candidate);
    let data = body.data || body;
    const urlsFor = d => [d.url,d.play_url,d.playUrl,d.backupUrl,d.backup_url,d.backupurl,d.urls].flat(Infinity).filter(u => typeof u === 'string' && validateURL(u));
    let urls = urlsFor(data);
    log({ stage: 'ordinary-response', tier, status: body.status, privilegeStatus: data.priv_status, failure: data.fail_process, fileHead: data.fileHead, extension: data.extName, size: data.fileSize, bitrate: data.bitRate, duration: data.timeLength, sourceCount: urls.length });
    if (!urls.length) {
      if (!verified) { await call('user_verify'); verified = true; }
      const authorization = (await call('song_auth', candidate))?.data || {};
      if (authorization.auth || authorization.open_time) {
        body = await call('song_url_auth', { ...candidate, auth: authorization.auth, open_time: authorization.open_time });
        data = body.data || body; urls = urlsFor(data);
        log({ stage: 'authorized-response', tier, status: body.status, privilegeStatus: data.priv_status, failure: data.fail_process, fileHead: data.fileHead, extension: data.extName, size: data.fileSize, bitrate: data.bitRate, duration: data.timeLength, sourceCount: urls.length });
      }
    }
    if (!urls.length) { log({ stage: 'result', tier, playableSource: false }); continue; }
    const hints = { urls, fileSize: data.fileSize || variant.info?.filesize, bitrateKbps: variant.info?.bitrate, duration: Number(data.timeLength || variant.info?.duration) / 1000, extName: data.extName || variant.info?.extname };
    try {
      const resolved = await manager.prepare(hints);
      log({ stage: 'header', tier, mime: resolved.mime, duration: resolved.duration, quality: resolved.quality });
      log({ stage: 'native', tier, ...(await decode(resolved.url)) });
    } catch (error) {
      log({ stage: 'source', tier, code: error.publicCode || 'MEDIA_UNAVAILABLE' });
    }
  }
}).catch(error => {
  log({ stage: 'failed', type: error.name, code: error.publicCode || error.body?.error_code || '' });
  process.exitCode = 1;
}).finally(() => { window?.destroy(); app.quit(); });
