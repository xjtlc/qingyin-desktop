const { app, BrowserWindow, ipcMain, dialog, protocol, safeStorage, shell, screen, nativeTheme } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { parseByteRange } = require('./lib/audio.cjs');
const { createStreamManager } = require('./lib/stream.cjs');
const { createMpvPlayer, findMpv } = require('./lib/mpv.cjs');
const { createTaskbarLyrics } = require('./lib/taskbar-lyrics.cjs');
const { readWindowsTaskbarTheme } = require('./lib/taskbar-theme.cjs');
const { createFullscreenMonitor } = require('./lib/fullscreen-monitor.cjs');
const { readRegisteredLyrics } = require('./lib/local-lyrics.cjs');
const { createSleepTimer } = require('./lib/sleep-timer.cjs');

process.env.platform = 'lite';
app.setName('青音概念桌面版');
app.setAppUserModelId('local.qingyin.concept');
// A separate data directory also isolates the browser profile and instance lock.
const isolated = Boolean(process.env.QINGYIN_TEST_DATA);
if (isolated && !process.env.QINGYIN_TEST_ACCOUNT_READONLY) {
  const browserProfile = path.join(process.env.QINGYIN_TEST_DATA, 'browser-profile');
  fs.mkdirSync(browserProfile, { recursive: true });
  app.setPath('userData', browserProfile);
}
protocol.registerSchemesAsPrivileged(['qingyin-audio', 'qingyin-stream'].map(scheme => ({ scheme, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } })));

let win;
let adapter;
let streams;
let mpv;
let taskbarLyrics;
let sleepTimer;
let localTracks = [];
let uiStore = {};
let dataDir;
const localPaths = new Map();
const allowedMethods = new Set(['status', 'qrStart', 'qrCheck', 'logout', 'search', 'recommendations', 'dailyRecommendations', 'guessYouLike', 'playlists', 'playlistSongs', 'songUrl', 'songQualities', 'lyrics']);
const allowedExtensions = new Set(['.mp3', '.flac', '.wav', '.m4a', '.aac', '.ogg', '.opus']);
const uiFile = path.join(__dirname, 'ui', 'index.html');
const trustedURL = pathToFileURL(uiFile).href;

function readJSON(name, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8')); }
  catch { return fallback; }
}
function writeJSON(name, value) {
  const destination = path.join(dataDir, name);
  const temp = `${destination}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(temp, destination);
}
function trusted(event) {
  if (!win || event.sender !== win.webContents || event.senderFrame?.url !== trustedURL) throw new Error('无法识别的调用来源');
}
function loadSession() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const directory = process.env.QINGYIN_TEST && process.env.QINGYIN_TEST_ACCOUNT_READONLY ? path.join(app.getPath('appData'), 'QingyinConcept') : dataDir;
    return JSON.parse(safeStorage.decryptString(fs.readFileSync(path.join(directory, 'account.enc'))));
  } catch { return null; }
}
function saveSession(session) {
  if (process.env.QINGYIN_TEST && process.env.QINGYIN_TEST_ACCOUNT_READONLY) return;
  const destination = path.join(dataDir, 'account.enc');
  if (session === null) {
    if (fs.existsSync(destination)) fs.unlinkSync(destination);
    return;
  }
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 账号加密暂不可用，无法安全保存登录状态');
  fs.writeFileSync(`${destination}.tmp`, safeStorage.encryptString(JSON.stringify(session)), { mode: 0o600 });
  fs.renameSync(`${destination}.tmp`, destination);
}
function loadLocal() {
  const entries = readJSON('library.json', []);
  localTracks = [];
  localPaths.clear();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || typeof entry.path !== 'string' || !allowedExtensions.has(path.extname(entry.path).toLowerCase()) || !fs.existsSync(entry.path)) continue;
    const id = crypto.createHash('sha256').update(path.resolve(entry.path).toLowerCase()).digest('hex').slice(0, 24);
    localPaths.set(id, entry.path);
    localTracks.push({ id, title: path.basename(entry.path, path.extname(entry.path)), artist: '本地音乐', album: '本机音乐库', cover: '', duration: 0, local: true, url: `qingyin-audio://track/${id}` });
  }
}
function registerIPC() {
  ipcMain.handle('music:api', async (event, method, params) => {
    trusted(event);
    if (!allowedMethods.has(method) || !params || typeof params !== 'object' || Array.isArray(params)) return { ok: false, error: '不支持的操作' };
    if (JSON.stringify(params).length > 12000) return { ok: false, error: '请求内容过长' };
    try { return await adapter.invoke(method, params); }
    catch { return { ok: false, error: '请求未完成，请重试' }; }
  });
  ipcMain.handle('music:window', (event, action) => {
    trusted(event);
    if (action === 'minimize') win.minimize();
    if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
    if (action === 'close') win.close();
  });
  ipcMain.handle('music:local-list', event => { trusted(event); return localTracks; });
  ipcMain.handle('music:sleep-timer', async (event, action, options) => {
    trusted(event);
    if (action === 'status') return { ok: true, state: sleepTimer.status() };
    if (action === 'cancel') return sleepTimer.cancel();
    if (action === 'track-ended') return sleepTimer.trackEnded();
    if (action !== 'set') return { ok: false, error: '不支持这个定时操作', state: sleepTimer.status() };
    const result = sleepTimer.set(options);
    // Avoid mpv advancing from its own gapless queue before the renderer wakes.
    if (result.ok && result.state.mode === 'after-track') await mpv?.clearPlaylist().catch(() => {});
    return result.ok ? { ok: true, state: sleepTimer.status() } : result;
  });
  ipcMain.handle('music:local-lyrics', async (event, id) => { trusted(event); return readRegisteredLyrics(localPaths, id); });
  ipcMain.handle('music:taskbar-lyrics', (event, action, payload) => {
    trusted(event);
    if (action === 'status') return taskbarLyrics.status();
    if (action === 'enabled') return taskbarLyrics.setEnabled(payload);
    if (action !== 'update' || !payload || typeof payload !== 'object' || Array.isArray(payload) || JSON.stringify(payload).length > 32000) throw new Error('任务栏歌词数据无效');
    return taskbarLyrics.update(payload);
  });
  ipcMain.handle('taskbar-lyrics:get-state', event => {
    if (!taskbarLyrics.owns(event.sender) || event.senderFrame?.url !== taskbarLyrics.trustedURL) throw new Error('无法识别的调用来源');
    return taskbarLyrics.state();
  });
  ipcMain.handle('music:local-import', async event => {
    trusted(event);
    const selection = await dialog.showOpenDialog(win, { title: '添加本地音乐', properties: ['openFile', 'multiSelections'], filters: [{ name: '音乐文件', extensions: [...allowedExtensions].map(x => x.slice(1)) }] });
    if (selection.canceled) return localTracks;
    for (const file of selection.filePaths) {
      if (allowedExtensions.has(path.extname(file).toLowerCase())) {
        const id = crypto.createHash('sha256').update(path.resolve(file).toLowerCase()).digest('hex').slice(0, 24);
        localPaths.set(id, file);
      }
    }
    writeJSON('library.json', [...localPaths.values()].map(file => ({ path: file })));
    loadLocal();
    return localTracks;
  });
  ipcMain.handle('music:store-get', event => { trusted(event); return uiStore; });
  ipcMain.handle('music:store-set', (event, data) => {
    trusted(event);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('无效数据');
    if (JSON.stringify(data).length > 2_000_000) throw new Error('收藏数据过大');
    uiStore = data;
    writeJSON('preferences.json', data);
    return true;
  });
  ipcMain.handle('music:official', async event => { trusted(event); await shell.openExternal('https://www.kugou.com/'); });
  ipcMain.handle('music:mpv-status', event => {
    trusted(event);
    return { available: Boolean(mpv?.available), executable: mpv?.executable || '', state: mpv ? mpv.status() : null };
  });
  ipcMain.handle('music:mpv', async (event, action, params = {}) => {
    trusted(event);
    if (!mpv?.available) return { ok: false, code: 'MPV_NOT_FOUND', error: '未找到 mpv 播放组件，请切回内置播放。' };
    // Transport actions carry no parameters, so the payload must stay optional.
    if (!params || typeof params !== 'object' || Array.isArray(params)) return { ok: false, code: 'MPV_BAD_PARAMS', error: '播放参数无效，请重试。' };
    try {
      if (action === 'volume') return { ok: true, state: await mpv.setVolume(params.volume * 100) };
      if (action === 'pause') return { ok: true, state: await mpv.pause(true) };
      if (action === 'resume') return { ok: true, state: await mpv.pause(false) };
      if (action === 'seek') return { ok: true, state: await mpv.seek(params.seconds) };
      if (action === 'stop') return { ok: true, state: mpv.stop() };
      if (action === 'clear') return { ok: true, state: await mpv.clearPlaylist() };
      if (action !== 'load' && action !== 'append') return { ok: false, code: 'MPV_UNKNOWN_ACTION', error: '不支持这个播放操作。' };
      // The renderer only ever holds opaque handles; the signed CDN URL stays here.
      const value = typeof params.url === 'string' ? params.url : '';
      const localId = /^qingyin-audio:\/\/track\/([a-z\d]+)$/i.exec(value)?.[1];
      const online = /^qingyin-stream:\/\/track\/[a-f0-9]{32}$/i.test(value);
      const target = online ? streams.resolve(value) : (localId ? localPaths.get(localId) : null);
      if (!target) return { ok: false, code: 'MPV_SOURCE_UNRESOLVED', error: '音乐地址已过期，请重新点击播放。' };
      if (action === 'append') {
        if (sleepTimer.status().mode === 'after-track') return { ok: true, queued: false, state: mpv.status() };
        const state = await mpv.append(target, { sourceId: value });
        return { ok: true, queued: true, state };
      }
      // Gapless hand-off: mpv already advanced to this file from its own playlist, so
      // loading it again would restart the track that is audibly already playing.
      const state = mpv.status();
      if (state.active && !state.loading && state.sourceId === value && !state.eof && !state.error) {
        if (typeof params.volume === 'number') await mpv.setVolume(params.volume * 100);
        if (typeof params.paused === 'boolean') await mpv.pause(params.paused);
        if (Number.isFinite(params.time)) await mpv.seek(params.time);
        return { ok: true, reused: true, state: mpv.status() };
      }
      const loaded = await mpv.load(target, { sourceId: value, volume: typeof params.volume === 'number' ? params.volume * 100 : undefined, paused: Boolean(params.paused), time: params.time });
      return { ok: true, state: loaded };
    } catch (error) {
      const messages = {
        MPV_NOT_FOUND: '未找到 mpv 播放组件，请切回内置播放。',
        MPV_START_FAILED: 'mpv 播放组件未能启动，请切回内置播放。',
        MPV_DISCONNECTED: 'mpv 播放连接已中断，请重试或切回内置播放。',
        MPV_CANCELLED: '播放请求已取消。',
        MPV_TIMEOUT: 'mpv 播放响应超时，请重试或切回内置播放。',
        MPV_LOAD_FAILED: 'mpv 无法播放这首歌，请重试或切回内置播放。',
        MPV_COMMAND_FAILED: 'mpv 未能完成播放操作，请重试。',
      };
      const code = Object.hasOwn(messages, error.code) ? error.code : 'MPV_LOAD_FAILED';
      return { ok: false, code, error: messages[code], state: mpv.status() };
    }
  });
}
function createWindow() {
  win = new BrowserWindow({
    width: 1080, height: 740, minWidth: 920, minHeight: 600,
    // Let the system material show through the client area.
    frame: false, backgroundColor: '#00000000', show: !process.env.QINGYIN_TEST,
    backgroundMaterial: 'acrylic',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false },
  });
  try { if (typeof win.setBackgroundMaterial === 'function') win.setBackgroundMaterial('acrylic'); } catch { /* material unsupported here */ }
  win.removeMenu();
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => { if (url !== trustedURL) event.preventDefault(); });
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  win.on('maximize', () => win.webContents.send('music:event', { type: 'maximized', value: true }));
  win.on('unmaximize', () => win.webContents.send('music:event', { type: 'maximized', value: false }));
  win.loadFile(uiFile);
  win.on('closed', () => { win = null; taskbarLyrics?.dispose(); });
}
const single = process.env.QINGYIN_TEST || isolated ? true : app.requestSingleInstanceLock();
if (!single) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
  app.whenReady().then(() => {
    dataDir = process.env.QINGYIN_TEST_DATA || path.join(app.getPath('appData'), 'QingyinConcept');
    fs.mkdirSync(dataDir, { recursive: true });
    loadLocal();
    uiStore = readJSON('preferences.json', {});
    const { createKugouAdapter } = require('./lib/kugou.cjs');
    streams = createStreamManager();
    sleepTimer = createSleepTimer({ onExpire: event => {
      // Calling pause immediately writes the native command before sending any
      // renderer event; a failed native transport must still stop playback.
      const native = mpv?.status();
      if (native?.loading) mpv.stop();
      else if (native?.active) {
        mpv.pause(true).catch(() => mpv.stop());
        mpv.clearPlaylist().catch(() => {});
      }
      if (win && !win.isDestroyed()) win.webContents.send('music:event', event);
    } });
    mpv = createMpvPlayer({ executable: findMpv({ root: __dirname }), onEvent: event => {
      if (event.name === 'end-file' && event.reason === 'eof' && sleepTimer.trackEnded().consumed) event = { ...event, sleepTimerConsumed: true };
      if (win && !win.isDestroyed()) win.webContents.send('music:event', event);
    } });
    adapter = createKugouAdapter({ loadSession, saveSession, resolveStream: streams.prepare });
    protocol.handle('qingyin-stream', streams.handle);
    protocol.handle('qingyin-audio', async request => {
      const origin = request.headers.get('Origin');
      if (origin && origin !== 'null' && origin !== 'file://') return new Response('Forbidden', { status: 403 });
      const parsed = new URL(request.url);
      const id = parsed.pathname.slice(1);
      const file = parsed.hostname === 'track' && localPaths.get(id);
      if (!file) return new Response('Not found', { status: 404 });
      try {
        if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
        const { size } = fs.statSync(file);
        const range = parseByteRange(request.headers.get('Range'), size);
        const headers = new Headers({ 'Accept-Ranges': 'bytes' });
        headers.set('Access-Control-Allow-Origin', origin || 'null');
        headers.set('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges');
        if (range === false) {
          headers.set('Content-Range', `bytes */${size}`);
          return new Response(null, { status: 416, headers });
        }
        const types = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.opus': 'audio/ogg' };
        headers.set('Content-Type', types[path.extname(file).toLowerCase()] || 'application/octet-stream');
        const start = range ? range.start : 0, end = range ? range.end : size - 1;
        headers.set('Content-Length', String(Math.max(0, end - start + 1)));
        if (range) headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
        const body = request.method === 'HEAD' || !size ? null : Readable.toWeb(fs.createReadStream(file, { start, end }));
        return new Response(body, { status: range ? 206 : 200, headers });
      }
      catch (error) {
        if (process.env.QINGYIN_TEST) console.error('Local audio:', error.message);
        return new Response('文件已移动或无法读取', { status: 404 });
      }
    });
    registerIPC();
    createWindow();
    // Keep the main player as the first window (including isolated Electron tests).
    taskbarLyrics = createTaskbarLyrics({ BrowserWindow, screen, nativeTheme, systemTheme: readWindowsTaskbarTheme, fullscreenMonitor: process.env.QINGYIN_TEST ? null : createFullscreenMonitor, uiFile: path.join(__dirname, 'ui', 'taskbar-lyrics.html'), preload: path.join(__dirname, 'taskbar-preload.cjs'), hiddenForTest: Boolean(process.env.QINGYIN_TEST) });
  }).catch(error => {
    if (process.env.QINGYIN_TEST) { console.error(error.message); app.exit(1); return; }
    dialog.showErrorBox('青音启动失败', '本地组件未能加载。请从桌面快捷方式重新打开，或检查程序目录是否完整。');
    app.quit();
  });
  app.on('before-quit', () => { sleepTimer?.dispose(); taskbarLyrics?.dispose(); mpv?.dispose(); });
  app.on('window-all-closed', () => { mpv?.dispose(); app.quit(); });
}
