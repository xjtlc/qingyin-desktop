'use strict';

// Isolated source/packaged acceptance test. No production account or profile is
// opened. Audio is a local silent WAV at volume zero; mpv is an IPC fixture.
// Usage: node scripts/verify-status-lyrics.cjs [path/to/QingyinConcept.exe]
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { loadTestDependency } = require('./test-deps.cjs');
const { _electron } = loadTestDependency('playwright');
const root = path.resolve(__dirname, '..');
const executable = process.argv[2];
const output = path.join(root, 'test-output', 'status-lyrics-preview-0.1.43', executable ? 'packaged' : 'source');
const profile = path.join(output, 'isolated-data');
fs.mkdirSync(profile, { recursive: true });
const report = {
  version: require('../package.json').version, mode: executable ? 'packaged' : 'source',
  fixture: 'Synthetic account, isolated profile, silent local WAV at volume zero and synthetic mpv IPC. Production credentials and preferences are not read or written.',
  screenshotBackdrop: 'Synthetic browser backdrop; capturePage excludes Windows DWM material.',
  checks: {}, screenshots: [], rendererErrors: [], remoteRendererRequests: [],
};
let application, page, taskbarPage;

function makeFixture() {
  const rate = 48000, size = rate * 90 * 4, wav = Buffer.alloc(44 + size);
  wav.write('RIFF'); wav.writeUInt32LE(36 + size, 4); wav.write('WAVE', 8);
  wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(size, 40);
  const wavPath = path.join(profile, '状态栏歌词验收静音.wav'); fs.writeFileSync(wavPath, wav);
  fs.writeFileSync(path.join(profile, '状态栏歌词验收静音.lrc'), '[00:00.00]本地歌词第一句\n[00:04.00]本地歌词第二句\n[00:08.00]本地歌词第三句');
  const id = crypto.createHash('sha256').update(path.resolve(wavPath).toLowerCase()).digest('hex').slice(0, 24);
  fs.writeFileSync(path.join(profile, 'library.json'), JSON.stringify([{ path: wavPath }]));
  fs.writeFileSync(path.join(profile, 'preferences.json'), JSON.stringify({ preferences: { volume: 0, output: 'browser', quality: 'auto', effects: 'off', shuffle: false, repeat: 'all' }, favorites: [], history: [], sort: { field: 'default', direction: 'asc' } }));
  const firstLines = ['此刻，让声音慢慢经过', '把熟悉的旋律留在身边', '晚风经过安静的窗边', '这一句，跟着进度亮起来', '愿每一种心情都有声音', '听见今天，也听见自己', '音乐把时光轻轻连接', '慢慢听见这一刻的温柔', '让晚风慢慢吹过那些来不及说完的故事，把所有平凡的片刻都留在这一段旋律里', '耳边的旋律仍旧轻轻流动'];
  const newerLines = firstLines.map(line => `新歌 · ${line}`);
  const lrc = lines => lines.map((line, index) => `[00:${String(index * 4).padStart(2, '0')}.00]${line}`).join('\n');
  const cover = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><defs><linearGradient id="a" x2="0" y2="1"><stop stop-color="#527483"/><stop offset="1" stop-color="#b9b7a8"/></linearGradient></defs><rect width="400" height="400" fill="url(#a)"/><circle cx="260" cy="145" r="85" fill="#f1ede7" opacity=".4"/><path d="M0 260Q130 180 230 285T400 230V400H0" fill="#d2e0e6" opacity=".7"/></svg>').toString('base64');
  const hashes = ['status-sync', 'status-delayed', 'status-newer', 'status-empty', 'status-plain', 'status-error'];
  const titles = ['此刻的旋律', '迟到的歌词', '下一首的旋律', '无歌词的歌', '纯文本的歌', '加载失败的歌'];
  return {
    url: `qingyin-audio://track/${id}`, calls: [], holdHash: null, delayedReleased: false, firstLines, newerLines,
    lyrics: { 'status-sync': lrc(firstLines), 'status-delayed': '[00:00.00]迟到的旧歌歌词不可覆盖新歌', 'status-newer': lrc(newerLines), 'status-empty': '', 'status-plain': '纯文本第一句\n纯文本第二句\n纯文本最后一句' },
    songs: hashes.map((hash, index) => ({ hash, title: titles[index], artist: '青音合奏', album: '状态栏歌词隔离验收', cover, albumAudioId: index + 1, duration: 90, playlistEntryId: `status:fixture:${index}` })),
    native: { active: false, loading: false, sourceId: '', paused: true, time: 0, duration: 90, volume: 0 },
  };
}

async function fixtureResponse(method, params = {}) {
  const fixture = globalThis.statusLyricsFixture;
  fixture.calls.push({ method, hash: params.hash });
  let data = {};
  if (method === 'status') data = { loggedIn: true, user: { id: 'status-lyrics-fixture', name: '状态歌词隔离验证' }, platform: 'lite' };
  else if (method === 'recommendations' || method === 'playlists') data = { playlists: [{ id: 'status-lyrics-fixture', title: '状态栏歌词验收歌单', count: fixture.songs.length, private: true, cover: fixture.songs[0].cover }], songs: [], total: 1, hasMore: false };
  else if (method === 'playlistSongs') data = { songs: fixture.songs, total: fixture.songs.length, sourceTotal: fixture.songs.length, totalReliable: true, totalReported: true, page: 1, pageSize: 300, rawCount: fixture.songs.length, hasMore: false };
  else if (method === 'songUrl') data = { url: fixture.url, duration: 90, preview: false, quality: { format: 'wav', bitDepth: 16, sampleRateHz: 48000, label: 'WAV 无损', streamVerified: true, fallback: false } };
  else if (method === 'songQualities') data = { tiers: [{ id: 'auto', label: '自动（最高可播放）', group: 'auto', selectable: true }, { id: 'lossless', label: '无损音质', group: 'standard', selectable: true }] };
  else if (method === 'lyrics') {
    if (params.hash === 'status-error') return { ok: false, code: 'REQUEST_FAILED', error: '隔离验收：歌词服务暂未响应' };
    if (params.hash === fixture.holdHash && !fixture.delayedReleased) await new Promise(resolve => { globalThis.releaseStatusLyricsFixture = resolve; });
    data = { text: fixture.lyrics[params.hash] || '' };
  }
  return { ok: true, data };
}

async function callCount(hash) {
  return application.evaluate((_electron, hash) => globalThis.statusLyricsFixture.calls.filter(call => call.method === 'lyrics' && (!hash || call.hash === hash)).length, hash);
}
async function expectLine(text) {
  for (let attempt = 0; attempt < 50 && !taskbarPage; attempt++) {
    taskbarPage = application.windows().find(window => /\/taskbar-lyrics\.html(?:$|[?#])/.test(window.url()));
    if (!taskbarPage) await page.waitForTimeout(100);
  }
  assert.ok(taskbarPage, 'Playing must create the independent taskbar lyrics window');
  await taskbarPage.waitForFunction(text => document.querySelector('#taskbar-lyric')?.textContent.includes(text), text, { polling: 100, timeout: 15000 });
}
const lyricText = () => taskbarPage.locator('#taskbar-lyric').textContent();
async function seek(seconds) {
  // Range step=.1 quantizes percentages; seek safely inside the target sentence,
  // rather than accidentally rounding a boundary to the previous sentence.
  const target = seconds + .25;
  await page.locator('#seek').evaluate((node, seconds) => { node.value = String(seconds / 90 * 100); node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true })); }, target);
  await page.waitForFunction(seconds => Math.abs(document.querySelector('#audio').currentTime - seconds) < .3, target);
}
async function selectSong(index, pause = true) {
  await page.locator('#main-content .track-title[data-action="play-song"]').nth(index).click();
  await page.waitForFunction(title => {
    const audio = document.querySelector('#audio');
    return document.querySelector('#player-title').textContent === title && !audio.paused && audio.readyState >= 3 && !document.querySelector('#play-button').classList.contains('loading');
  }, globalThis.fixture.songs[index].title, { timeout: 15000 });
  if (pause) { await page.locator('#play-button').click(); await page.waitForFunction(() => document.querySelector('#audio').paused); }
}
async function capture(name) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const png = await application.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows().find(window => /\/index\.html(?:$|[?#])/.test(window.webContents.getURL())).capturePage()).toPNG().toString('base64'));
  const destination = path.join(output, `${name}.png`); fs.writeFileSync(destination, Buffer.from(png, 'base64')); report.screenshots.push(destination);
}
async function captureTaskbar(name) {
  const png = await application.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(window => /\/taskbar-lyrics\.html(?:$|[?#])/.test(window.webContents.getURL()));
    return (await window.capturePage()).toPNG().toString('base64');
  });
  const destination = path.join(output, `${name}.png`); fs.writeFileSync(destination, Buffer.from(png, 'base64')); report.screenshots.push(destination);
}
async function checkFooterLayout(label) {
  const layout = await taskbarPage.evaluate(() => {
    const lyric = document.querySelector('#taskbar-lyric'), rect = lyric.getBoundingClientRect(), style = getComputedStyle(lyric);
    return { viewport: [innerWidth, innerHeight], documentWidth: document.documentElement.scrollWidth, lyric: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height, scrollWidth: lyric.scrollWidth, clientWidth: lyric.clientWidth }, style: { whiteSpace: style.whiteSpace, overflow: style.overflow, textOverflow: style.textOverflow }, theme: document.documentElement.dataset.theme || document.body.dataset.theme, playing: document.body.dataset.playing, kind: document.body.dataset.kind };
  });
  const lyric = layout.lyric;
  assert.ok(lyric && lyric.width >= 100 && lyric.height >= 12, `${label}: taskbar lyric must remain usable`);
  assert.ok(layout.documentWidth <= layout.viewport[0] + 1, `${label}: document must not overflow horizontally`);
  assert.ok(lyric.left >= -1 && lyric.right <= layout.viewport[0] + 1 && lyric.top >= -1 && lyric.bottom <= layout.viewport[1] + 1, `${label}: lyric must fit inside taskbar window`);
  layout.window = await application.evaluate(({ BrowserWindow, screen }) => {
    const window = BrowserWindow.getAllWindows().find(window => /\/taskbar-lyrics\.html(?:$|[?#])/.test(window.webContents.getURL()));
    const bounds = window.getBounds(), display = screen.getDisplayMatching(bounds);
    return { bounds, displayBounds: display.bounds, workArea: display.workArea, visible: window.isVisible(), alwaysOnTop: window.isAlwaysOnTop(), focusable: window.isFocusable(), url: window.webContents.getURL() };
  });
  layout.status = await page.evaluate(() => window.music.taskbarLyrics.status());
  report.checks[label] = layout;
  assert.equal(layout.window.visible, false, 'Isolated verification must not display its fixture overlay on the user desktop');
  assert.equal(layout.window.alwaysOnTop, true);
  assert.equal(layout.window.focusable, false);
  assert.equal(layout.status.enabled, true);
  if (layout.status.supported && layout.status.eligible) {
    const bounds = layout.window.bounds, display = layout.window.displayBounds;
    assert.ok(bounds.x >= display.x && bounds.x + bounds.width <= display.x + display.width, `${label}: overlay must stay within display`);
    assert.ok(bounds.y >= display.y && bounds.y + bounds.height <= display.y + display.height, `${label}: overlay must stay within display (${JSON.stringify(bounds)} versus ${JSON.stringify(display)})`);
  }
  report.checks[label] = layout;
}

(async () => {
  const fixture = globalThis.fixture = makeFixture(), bootstrap = path.join(profile, 'fixture-bootstrap.cjs');
  fs.writeFileSync(bootstrap, `const path=require('node:path');\nconst root=${JSON.stringify(root)};\nglobalThis.statusLyricsFixture=${JSON.stringify(fixture)};\nconst file=path.join(root,'lib','kugou.cjs');\nrequire.cache[require.resolve(file)]={id:file,filename:file,loaded:true,exports:{createKugouAdapter:()=>({invoke:async(method,params)=>(${fixtureResponse.toString()})(method,params)})}};\nrequire(path.join(root,'main.cjs'));\n`);
  const env = { ...process.env, QINGYIN_TEST: '1', QINGYIN_TEST_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE; delete env.QINGYIN_TEST_ACCOUNT_READONLY;
  application = await _electron.launch({ executablePath: executable || require('electron'), args: executable ? [] : [bootstrap], cwd: root, env, timeout: 30000 });
  await application.firstWindow();
  for (let attempt = 0; attempt < 100 && !page; attempt++) {
    page = application.windows().find(window => /\/index\.html(?:$|[?#])/.test(window.url()));
    if (!page) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(page, 'The app main page must load');
  page.on('pageerror', error => report.rendererErrors.push(error.message));
  page.on('request', request => { if (/^https?:\/\//i.test(request.url())) report.remoteRendererRequests.push(request.url()); });
  report.electronOrAppVersion = await application.evaluate(({ app }) => app.getVersion());
  if (executable) report.version = report.electronOrAppVersion;
  await application.evaluate(({ BrowserWindow, session }) => {
    BrowserWindow.getAllWindows().find(window => /\/index\.html(?:$|[?#])/.test(window.webContents.getURL())).webContents.setBackgroundThrottling(false);
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
  });
  await application.evaluate(({ ipcMain, BrowserWindow }, data) => {
    if (data.packaged) {
      globalThis.statusLyricsFixture = data.fixture;
      const invoke = new Function('method', 'params', `return (${data.functionText})(method,params);`);
      ipcMain.removeHandler('music:api'); ipcMain.handle('music:api', (_event, method, params) => invoke(method, params));
    }
    ipcMain.removeHandler('music:mpv-status'); ipcMain.handle('music:mpv-status', () => ({ available: true, state: globalThis.statusLyricsFixture.native }));
    ipcMain.removeHandler('music:mpv');
    ipcMain.handle('music:mpv', (_event, action, params = {}) => {
      const fixture = globalThis.statusLyricsFixture;
      if (action === 'stop') fixture.native = { ...fixture.native, active: false, sourceId: '', paused: true, time: 0 };
      else if (action === 'load') fixture.native = { ...fixture.native, active: true, loading: false, sourceId: params.url, paused: Boolean(params.paused), time: Number(params.time) || 0, duration: 90, volume: 0 };
      else if (action === 'pause' || action === 'resume') {
        fixture.native = { ...fixture.native, paused: action === 'pause' };
        BrowserWindow.getAllWindows().find(window => /\/index\.html(?:$|[?#])/.test(window.webContents.getURL())).webContents.send('music:event', { type: 'mpv', name: 'pause', state: fixture.native });
      } else if (action === 'seek') {
        fixture.native = { ...fixture.native, time: Number(params.seconds) || 0 };
        BrowserWindow.getAllWindows().find(window => /\/index\.html(?:$|[?#])/.test(window.webContents.getURL())).webContents.send('music:event', { type: 'mpv', name: 'time-pos', state: fixture.native });
      }
      return { ok: true, state: fixture.native, queued: false };
    });
  }, { packaged: Boolean(executable), fixture, functionText: fixtureResponse.toString() });
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#sidebar-account')?.textContent.includes('状态歌词隔离验证'));
  await page.evaluate(() => { const backdrop = document.createElement('div'); backdrop.id = 'status-test-backdrop'; backdrop.style.cssText = 'position:fixed;inset:0;z-index:-1;pointer-events:none;background:#d0d7df'; document.body.prepend(backdrop); });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => /\/index\.html(?:$|[?#])/.test(window.webContents.getURL())).setSize(1440, 1000));
  assert.equal(await page.locator('#lyrics-panel').isVisible(), false);
  report.checks.initialStatus = await page.evaluate(() => window.music.taskbarLyrics.status());
  assert.equal(report.checks.initialStatus.enabled, true);
  await page.locator('[data-view="playlists"]').click();
  await page.locator('.playlist-card').filter({ hasText: '状态栏歌词验收歌单' }).click();
  await page.waitForFunction(() => document.querySelectorAll('#main-content .track-row').length === 6);
  await selectSong(0);
  await expectLine(fixture.firstLines[0]);
  assert.equal(await taskbarPage.evaluate(() => typeof window.music), 'undefined', 'Taskbar renderer must not receive the main music bridge');
  assert.ok(await callCount('status-sync') > 0, 'Playing must request lyrics without opening the full lyrics panel');
  assert.equal(await page.locator('#lyrics-panel').isVisible(), false);
  report.checks.closedPanelAutomaticLoading = 'PASS';

  await page.locator('#play-button').click(); await expectLine(fixture.firstLines[1]);
  await taskbarPage.waitForFunction(() => document.body.dataset.playing === 'true', null, { polling: 100 });
  await page.locator('#play-button').click();
  await taskbarPage.waitForFunction(() => document.body.dataset.playing === 'false', null, { polling: 100 });
  const paused = await lyricText();
  await page.waitForTimeout(1200);
  assert.equal(await lyricText(), paused, 'Pausing must keep the current lyric line');
  report.checks.playbackAndPause = 'PASS';
  await seek(20); await expectLine(fixture.firstLines[5]);
  await seek(8); await expectLine(fixture.firstLines[2]);
  report.checks.bidirectionalSeek = 'PASS';

  const lyricsCountBeforeOpen = await callCount('status-sync');
  await page.locator('#lyrics-button').click();
  await page.waitForFunction(() => !document.querySelector('#lyrics-panel').hidden && document.querySelectorAll('button.lyric-line').length === 10);
  assert.equal(await callCount('status-sync'), lyricsCountBeforeOpen, 'Opening the full lyrics page must reuse loaded lyrics');
  const toggle = page.locator('[data-action="taskbar-lyrics"]');
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
  await toggle.click();
  await page.waitForFunction(async () => (await window.music.taskbarLyrics.status()).enabled === false);
  assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
  await page.waitForFunction(async () => (await window.music.store.get()).preferences?.taskbarLyricsEnabled === false);
  await toggle.click();
  await page.waitForFunction(async () => (await window.music.taskbarLyrics.status()).enabled === true);
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
  await page.waitForFunction(async () => (await window.music.store.get()).preferences?.taskbarLyricsEnabled === true);
  report.checks.taskbarToggle = 'PASS';
  await page.locator('button.lyric-line[data-lyric-index="6"]').click();
  await expectLine(fixture.firstLines[6]);
  assert.equal(await page.locator('#lyrics-panel').isVisible(), true);
  report.checks.completeLyricsReuseAndSeek = 'PASS'; await capture('light-full-lyrics');
  await page.keyboard.press('Escape');
  await page.locator('#lyrics-panel').waitFor({ state: 'hidden' });

  await seek(32); await expectLine(fixture.firstLines[8]);
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await taskbarPage.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.locator('#status-test-backdrop').evaluate((node, scheme) => { node.style.background = scheme === 'light' ? '#d0d7df' : '#141b29'; }, scheme);
    for (const [label, width, height] of [['desktop', 1440, 1000], ['minimum', 920, 600]]) {
      await application.evaluate(({ BrowserWindow }, [width, height]) => BrowserWindow.getAllWindows().find(window => /\/index\.html(?:$|[?#])/.test(window.webContents.getURL())).setSize(width, height), [width, height]);
      await checkFooterLayout(`${scheme}-${label}`); await capture(`${scheme}-main-${width}x${height}`); await captureTaskbar(`${scheme}-taskbar-${width}x${height}`);
    }
  }
  report.checks.longLineTextPreserved = await lyricText();
  assert.ok(report.checks.longLineTextPreserved.includes(fixture.firstLines[8]));
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => /\/index\.html(?:$|[?#])/.test(window.webContents.getURL())).setSize(1440, 1000));

  await application.evaluate(() => { globalThis.statusLyricsFixture.holdHash = 'status-delayed'; });
  await selectSong(1);
  await taskbarPage.waitForFunction(() => !document.querySelector('#taskbar-lyric').textContent.includes('来不及说完'), null, { polling: 100 });
  for (let attempt = 0; attempt < 30 && !await callCount('status-delayed'); attempt++) await page.waitForTimeout(100);
  assert.ok(await callCount('status-delayed') > 0);
  await selectSong(2); await expectLine(fixture.newerLines[0]);
  await application.evaluate(() => { globalThis.statusLyricsFixture.delayedReleased = true; globalThis.releaseStatusLyricsFixture?.(); globalThis.releaseStatusLyricsFixture = null; });
  await page.waitForTimeout(350); await expectLine(fixture.newerLines[0]);
  assert.ok(!(await lyricText()).includes('迟到的旧歌'));
  report.checks.lateResponseCannotReplaceCurrent = 'PASS';

  await page.locator('#output-button').click();
  await page.locator('[data-action="set-output"][data-output="mpv"]').click();
  await page.waitForFunction(() => document.querySelector('#output-button').title.includes('mpv') && !document.querySelector('#play-button').classList.contains('loading'));
  if (await page.locator('#output-panel').isVisible()) await page.locator('#output-panel [data-action="output"]').click();
  await application.evaluate(({ BrowserWindow }) => { const fixture = globalThis.statusLyricsFixture; fixture.native = { ...fixture.native, time: 28, paused: true }; BrowserWindow.getAllWindows().find(window => /\/index\.html(?:$|[?#])/.test(window.webContents.getURL())).webContents.send('music:event', { type: 'mpv', name: 'time-pos', state: fixture.native }); });
  await expectLine(fixture.newerLines[7]);
  await page.locator('#seek').evaluate(node => { node.value = String(12.25 / 90 * 100); node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true })); });
  await expectLine(fixture.newerLines[3]);
  report.checks.nativeTimeAndSeek = 'PASS';
  await page.locator('#output-button').click(); await page.locator('[data-action="set-output"][data-output="browser"]').click();
  await page.waitForFunction(() => document.querySelector('#output-button').title.includes('内置') && document.querySelector('#audio').paused);
  if (await page.locator('#output-panel').isVisible()) await page.locator('#output-panel [data-action="output"]').click();

  await selectSong(3);
  await expectLine('暂无歌词');
  assert.ok(!(await lyricText()).includes('新歌'));
  await page.locator('#lyrics-button').click(); await page.locator('.lyric-empty').waitFor();
  assert.equal(await page.locator('#lyrics-body .lyric-line').count(), 0);
  report.checks.emptyLyrics = await lyricText();
  await page.keyboard.press('Escape');
  await selectSong(4);
  await expectLine('纯文本歌词');
  await page.locator('#lyrics-button').click();
  await page.locator('.lyrics-plain').waitFor();
  assert.equal(await page.locator('.lyrics-plain .lyric-line').count(), 3);
  report.checks.plainLyrics = await lyricText();
  await page.keyboard.press('Escape');
  await selectSong(5);
  await expectLine('歌词暂时不可用');
  await page.locator('#lyrics-button').click(); await page.locator('[data-action="retry-lyrics"]').waitFor();
  report.checks.lyricsError = await lyricText();
  await page.keyboard.press('Escape');
  report.checks.localSilentPlayback = await page.locator('#audio').evaluate(node => ({ source: node.getAttribute('src'), volume: node.volume }));
  assert.equal(report.checks.localSilentPlayback.source, fixture.url); assert.equal(report.checks.localSilentPlayback.volume, 0);
  await page.locator('[data-view="local"]').click();
  await page.waitForFunction(() => document.querySelectorAll('#main-content .track-row').length === 1);
  await page.locator('#main-content .track-title[data-action="play-song"]').click();
  await page.waitForFunction(() => document.querySelector('#player-title').textContent === '状态栏歌词验收静音' && !document.querySelector('#audio').paused && !document.querySelector('#play-button').classList.contains('loading'));
  await page.locator('#play-button').click();
  await expectLine('本地歌词第一句');
  await seek(8); await expectLine('本地歌词第三句');
  await page.locator('#lyrics-button').click();
  await page.waitForFunction(() => document.querySelectorAll('button.lyric-line').length === 3);
  report.checks.localLrcSync = 'PASS';
  await capture('local-lrc-complete');
  await page.keyboard.press('Escape');
  const unsafeLocal = await page.evaluate(() => window.music.local.lyrics('../../account.enc'));
  assert.ok(!unsafeLocal.text, 'The local lyric API must reject arbitrary paths');
  report.checks.localLrcRegisteredIdOnly = 'PASS';

  // Exercise production throttling while the main window is minimized. Normal
  // visual QA above disables throttling only so hidden-window RAF can settle.
  await seek(0);
  await application.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find(window => /\/index\.html(?:$|[?#])/.test(window.webContents.getURL()));
    main.webContents.setBackgroundThrottling(true); main.minimize();
  });
  await page.locator('#play-button').click();
  await taskbarPage.waitForFunction(() => document.querySelector('#taskbar-lyric').textContent.includes('本地歌词第二句'), null, { polling: 100, timeout: 12000 });
  report.checks.minimizedProductionThrottling = await application.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find(window => /\/index\.html(?:$|[?#])/.test(window.webContents.getURL()));
    return { minimized: main.isMinimized(), backgroundThrottling: main.webContents.getBackgroundThrottling() };
  });
  assert.equal(report.checks.minimizedProductionThrottling.backgroundThrottling, true);
  assert.equal(report.checks.minimizedProductionThrottling.minimized, true);
  await captureTaskbar('taskbar-main-minimized');
  await page.locator('#play-button').click();
  await application.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find(window => /\/index\.html(?:$|[?#])/.test(window.webContents.getURL()));
    main.restore(); main.hide(); main.webContents.setBackgroundThrottling(false);
  });

  await page.locator('#lyrics-button').click(); await page.locator('[data-action="taskbar-lyrics"]').click();
  await page.waitForFunction(async () => (await window.music.store.get()).preferences?.taskbarLyricsEnabled === false);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#sidebar-account')?.textContent.includes('状态歌词隔离验证'));
  await page.waitForFunction(async () => (await window.music.taskbarLyrics.status()).enabled === false);
  await page.locator('#lyrics-button').click();
  assert.equal(await page.locator('[data-action="taskbar-lyrics"]').getAttribute('aria-pressed'), 'false');
  report.checks.toggleSurvivesReload = 'PASS';
  report.apiCalls = await application.evaluate(() => globalThis.statusLyricsFixture.calls);
  assert.deepEqual(report.rendererErrors, []); assert.deepEqual(report.remoteRendererRequests, []);
  report.status = 'PASS';
})().catch(async error => {
  report.status = 'FAIL'; report.error = error.stack;
  if (page && !page.isClosed()) { report.failure = await page.evaluate(() => ({ title: document.querySelector('#player-title')?.textContent, audio: { paused: document.querySelector('#audio')?.paused, time: document.querySelector('#audio')?.currentTime }, panelHidden: document.querySelector('#lyrics-panel')?.hidden })).catch(() => ({})); report.taskbarFailure = taskbarPage ? await lyricText().catch(() => '') : 'missing'; await capture('failure').catch(() => {}); }
  console.error(error.stack); process.exitCode = 1;
}).finally(async () => {
  await application?.close().catch(() => {}); fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, version: report.version, mode: report.mode, checks: Object.keys(report.checks).length, screenshots: report.screenshots.length, rendererErrors: report.rendererErrors, report: path.join(output, 'report.json') }));
});
