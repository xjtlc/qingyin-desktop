'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { _electron } = require('./test-deps.cjs').loadTestDependency('playwright');
const root = path.resolve(__dirname, '..');
const version = require('../package.json').version;
const output = path.join(root, 'test-output', 'palette-preview', process.argv[2] ? 'packaged' : 'source');
fs.mkdirSync(output, { recursive: true });
const wavFile = path.join(output, '配色预览静音.wav');
const rate = 48000, size = rate * 18 * 4, bytes = Buffer.alloc(44 + size);
bytes.write('RIFF'); bytes.writeUInt32LE(36 + size, 4); bytes.write('WAVE', 8); bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(2, 22); bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 4, 28); bytes.writeUInt16LE(4, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(size, 40);
fs.writeFileSync(wavFile, bytes);
const audioId = crypto.createHash('sha256').update(path.resolve(wavFile).toLowerCase()).digest('hex').slice(0, 24);
fs.writeFileSync(path.join(output, 'library.json'), JSON.stringify([{ path: wavFile }]));
fs.writeFileSync(path.join(output, 'preferences.json'), JSON.stringify({ preferences: { volume: 0, quality: 'auto' }, sort: { field: 'default', direction: 'asc' }, favorites: [], history: [] }));
const cover = (top, bottom, index) => 'data:image/svg+xml;base64,' + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160"><defs><linearGradient id="b" x2="1" y2="1"><stop stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs><rect width="160" height="160" fill="url(#b)"/><circle cx="${45 + index * 9}" cy="63" r="32" fill="#ffffff" opacity=".22"/><path d="M0 125Q40 60 90 130T180 115V160H0" fill="#101820" opacity=".30"/><path d="M0 145Q60 90 120 148T180 138V160H0" fill="#101820" opacity=".24"/></svg>`).toString('base64');
const names = ['此刻，慢慢听', '雨停之后', '回家的路', '潮汐', '午夜电台', '森林来信', '逆光', '漫游慢拍', '日光落在窗边', '好久不见', '晚风', '今天也有好心情'];
const colors = [['#c28c76', '#635569'], ['#728f9d', '#405464'], ['#a69879', '#605c50'], ['#719998', '#3e6376']];
const songs = names.map((title, index) => ({ hash: `palette-${index}`, albumAudioId: index + 1, title, artist: ['青音合奏', '海岸电台', '暮色乐队'][index % 3], album: ['日常片刻', '留给夜晚', '风经过的地方'][index % 3], duration: index === 0 ? 18 : 210 + index * 7, cover: cover(...colors[index % 4], index % 4), playlistEntryId: `palette:daily:${index}` }));
const fixture = { songs, playlists: [{ id: 'daily', title: '日常片刻', count: 12, cover: songs[0].cover, private: true }, { id: 'night', title: '留给夜晚', count: 12, cover: songs[1].cover, private: true }, { id: 'wind', title: '沿着风的方向', count: 12 }, { id: 'old', title: '旧时光里的声音', count: 12 }], url: `qingyin-audio://track/${audioId}` };
function fixtureResponse(method, params = {}) {
  const fixture = globalThis.paletteFixture;
  let data = {};
  if (method === 'status') data = { loggedIn: true, user: { id: 'palette', name: '配色预览' }, platform: 'lite' };
  else if (method === 'recommendations' || method === 'playlists') data = { playlists: fixture.playlists, songs: fixture.songs.slice(0, 3), total: 4, hasMore: false };
  else if (method === 'playlistSongs') data = { songs: fixture.songs, total: 12, sourceTotal: 12, totalReliable: true, totalReported: true, sourcePage: 1, page: 1, pageSize: 300, rawCount: 12, hasMore: false };
  else if (method === 'songUrl') data = { url: fixture.url, duration: 18, preview: false, quality: { format: 'wav', bitDepth: 16, sampleRateHz: 48000, label: 'WAV 无损', streamVerified: true, fallback: false } };
  else if (method === 'lyrics') data = { text: '[00:00.00]窗外的风，慢慢经过\n[00:04.00]把今天，交给一段旋律\n[00:08.00]此刻，听点喜欢的' };
  else if (method === 'songQualities') data = { tiers: [{ id: 'auto', label: '自动（最高可播放）', group: 'auto', selectable: true }, { id: 'viper_tape', label: '蝰蛇母带音质', group: 'svip', selectable: false, hint: '预览用不可选状态' }, { id: 'lossless', label: '无损音质', group: 'standard', selectable: true, hint: '保留原始音频细节' }, { id: '320', label: '高品质', group: 'standard', selectable: true }, { id: '128', label: '标准音质', group: 'standard', selectable: true }] };
  return { ok: true, data };
}
const bootstrap = path.join(output, 'fixture-bootstrap.cjs');
fs.writeFileSync(bootstrap, `const path = require('node:path');\nconst root=${JSON.stringify(root)};\nglobalThis.paletteFixture=${JSON.stringify(fixture)};\nconst adapterFile=path.join(root,'lib','kugou.cjs');\nrequire.cache[require.resolve(adapterFile)]={id:adapterFile,filename:adapterFile,loaded:true,exports:{createKugouAdapter:()=>({invoke:async(method,params)=>(${fixtureResponse.toString()})(method,params)})}};\nrequire(path.join(root,'main.cjs'));\n`);
const env = { ...process.env, QINGYIN_TEST: '1', QINGYIN_TEST_DATA: output };
delete env.ELECTRON_RUN_AS_NODE; delete env.QINGYIN_TEST_ACCOUNT_READONLY;
let application, page;
const report = { version, theme: '灰白柔雾玻璃 · 清晰文字', fixture: 'isolated account and silent audio; production profile not used', backdrop: 'Synthetic light/dark backdrops for browser-layer verification; not a Windows desktop capture', screenshots: [], rendererErrors: [] };
const backdrops = {
  light: 'radial-gradient(ellipse 23% 37% at 66% 43%,#d6e0ff 0,#c2cff3 65%,transparent 72%),radial-gradient(ellipse 14% 22% at 51% 70%,#f5d8e0 0,#e8bdca 58%,transparent 72%),radial-gradient(ellipse at 4% 8%,#f2f4f6 0,transparent 42%),linear-gradient(140deg,#d7dce1,#c7cbd6 60%,#e8ebef)',
  dark: 'radial-gradient(ellipse 23% 37% at 66% 43%,#a2b5ff 0,#7086ed 65%,transparent 72%),radial-gradient(ellipse 14% 22% at 51% 70%,#fcafbe 0,#dd607e 58%,transparent 72%),radial-gradient(ellipse at 4% 8%,#667380 0,transparent 42%),linear-gradient(140deg,#181d2a,#090b23 60%,#2d354c)',
};
let backdropCss;
async function setBackdrop(scheme) {
  if (backdropCss) await application.evaluate(({ BrowserWindow }, key) => BrowserWindow.getAllWindows()[0].webContents.removeInsertedCSS(key), backdropCss);
  backdropCss = await application.evaluate(({ BrowserWindow }, css) => BrowserWindow.getAllWindows()[0].webContents.insertCSS(css), `#preview-backdrop{position:fixed!important;inset:0!important;z-index:-1!important;background:${backdrops[scheme]}!important;pointer-events:none!important}`);
}
function readMaterial() {
  const selectors = ['.app-shell', '.main-shell', '.main-content', '.topbar', '.sidebar', '.player', '.queue-panel', '.lyrics-panel', '.login-modal', '.list-rail .rail-button'];
  return Object.fromEntries(selectors.map(selector => { const style = getComputedStyle(document.querySelector(selector)); return [selector, { background: style.backgroundColor, image: style.backgroundImage, blur: style.backdropFilter, blend: style.backgroundBlendMode }]; }));
}
async function capture(name) {
  await page.waitForTimeout(240);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const base64 = await application.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'));
  const filename = path.join(output, `${name}-${version}.png`);
  fs.writeFileSync(filename, Buffer.from(base64, 'base64')); report.screenshots.push(filename);
}
(async () => {
  try {
    application = await _electron.launch({ executablePath: process.argv[2] || require('electron'), args: process.argv[2] ? [] : [bootstrap], cwd: root, env, timeout: 30000 });
    page = await application.firstWindow();
    page.on('pageerror', error => report.rendererErrors.push(error.message));
    await application.evaluate(({ BrowserWindow }) => {
      const content = BrowserWindow.getAllWindows()[0].webContents;
      content.setBackgroundThrottling(false);
      // Hidden windows may pause colour interpolation. Capture the final styles,
      // while production keeps its normal hover and focus transitions.
      return content.insertCSS('*,*::before,*::after{transition:none!important;animation:none!important}');
    });
    if (process.argv[2]) {
      await application.evaluate(({ ipcMain }, data) => { globalThis.paletteFixture = data.fixture; ipcMain.removeHandler('music:api'); const handler = new Function('method', 'params', `return (${data.functionText})(method,params);`); ipcMain.handle('music:api', (_event, method, params) => handler(method, params)); }, { fixture, functionText: fixtureResponse.toString() });
      await page.reload();
    }
    await page.waitForFunction(() => document.querySelector('#sidebar-account').textContent.includes('配色预览'));
    // BrowserWindow.capturePage excludes DWM's desktop backdrop. Use a clearly
    // identified, test-only background to inspect translucency and CSS blur.
    await page.evaluate(() => { const backdrop = document.createElement('div'); backdrop.id = 'preview-backdrop'; backdrop.setAttribute('aria-hidden', 'true'); document.body.prepend(backdrop); });
    report.nativeTheme = await application.evaluate(({ nativeTheme }) => ({ source: nativeTheme.themeSource, dark: nativeTheme.shouldUseDarkColors }));
    report.scheme = await page.evaluate(() => matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light');
    await setBackdrop(report.scheme);
    const previousPalette = path.join(root, 'test-output', 'palette-preview', `palette-before-${version}.css`);
    const currentPalette = await page.evaluate(() => { const link = document.querySelector('link[href="palette.css"]'); link.id = 'preview-palette'; return link.href; });
    if (fs.existsSync(previousPalette)) {
      await page.evaluate(href => new Promise((resolve, reject) => { const link = document.querySelector('#preview-palette'); link.onload = resolve; link.onerror = () => reject(new Error('Previous preview stylesheet failed')); link.href = href; }), pathToFileURL(previousPalette).href);
      await capture('before-home');
      report.beforeMaterial = await page.evaluate(readMaterial);
      await page.evaluate(href => new Promise((resolve, reject) => { const link = document.querySelector('#preview-palette'); link.onload = resolve; link.onerror = () => reject(new Error('Current stylesheet failed')); link.href = href; }), currentPalette);
    }
    await capture('home');
    report.currentMaterial = await page.evaluate(readMaterial);
    if (report.beforeMaterial) assert.deepEqual(report.currentMaterial, report.beforeMaterial, 'Accepted glass backgrounds must stay unchanged');
    await page.locator('[data-view="playlists"]').click();
    await page.locator('.playlist-card').filter({ hasText: '日常片刻' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.track-row').length === 12 && document.querySelector('[data-action="play-all"]')?.disabled === false);
    await page.locator('.track-title[data-action="play-song"]').first().click();
    await page.waitForFunction(() => { const audio = document.querySelector('#audio'); return !audio.paused && audio.currentTime > .15; });
    await page.locator('#play-button').click();
    await page.locator('.track-row [data-action="favorite-song"]').first().click();
    await page.waitForTimeout(200);
    await capture('playlist');
    await page.locator('#quality-tag').click(); await capture('quality');
    await page.locator('#quality-panel [data-action="quality"]').click();
    await page.locator('[data-action="enqueue-all"]').click();
    await page.locator('#queue-button').click(); await capture('queue');
    await page.locator('#queue-panel [data-action="queue"]').click();
    await page.locator('#lyrics-button').click();
    await page.locator('.lyric-line').first().waitFor(); await capture('lyrics');
    await page.locator('#lyrics-panel [data-action="lyrics"]').click();
    await page.locator('#top-login').click(); await capture('account');
    await page.locator('[data-action="close-modal"]').click();
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(920, 600));
    await capture('minimum');
    report.palette = await page.evaluate(() => {
      const selectors = ['.app-shell', '.main-shell', '.main-content', '.topbar', '.sidebar', '.player', '.queue-panel', '.lyrics-panel', '.login-modal', '.list-rail .rail-button', '.track-row'];
      const surfaces = Object.fromEntries(selectors.map(selector => { const style = getComputedStyle(document.querySelector(selector)); return [selector, { background: style.backgroundColor, image: style.backgroundImage, blur: style.backdropFilter, opacity: style.opacity }]; }));
      return { accent: getComputedStyle(document.documentElement).getPropertyValue('--p-accent').trim(), mainCorner: getComputedStyle(document.querySelector('.main-shell')).borderTopLeftRadius, currentText: getComputedStyle(document.querySelector('.track-row.current .track-title')).color, disabledOpacity: getComputedStyle(document.querySelector('#quality-content button:disabled')).opacity, viewport: [innerWidth, innerHeight], surfaces };
    });
    assert.equal(report.palette.mainCorner, '0px');
    assert.equal(report.palette.surfaces['.main-shell'].background, 'rgba(0, 0, 0, 0)');
    assert.equal(report.palette.surfaces['.main-content'].background, 'rgba(0, 0, 0, 0)');
    assert.equal(report.palette.surfaces['.topbar'].background, 'rgba(0, 0, 0, 0)');
    assert.equal(report.palette.surfaces['.track-row'].blur, 'none');
    assert.equal(report.palette.surfaces['.sidebar'].blur, 'none');
    assert.equal(report.palette.surfaces['.player'].blur, 'none');
    assert.ok(report.palette.surfaces['.app-shell'].blur.includes('blur(32px)'));
    for (const surface of Object.values(report.palette.surfaces)) assert.equal(surface.opacity, '1');
    const cdp = await page.context().newCDPSession(page);
    report.foreground = {};
    for (const scheme of ['light', 'dark']) {
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
      await setBackdrop(scheme); await capture(`${scheme}-minimum`);
      report.foreground[scheme] = await page.evaluate(() => ({ title: getComputedStyle(document.querySelector('.track-title')).color, metadata: getComputedStyle(document.querySelector('.track-artist')).color, metadataSize: getComputedStyle(document.querySelector('.track-artist')).fontSize, shadow: getComputedStyle(document.querySelector('.track-title')).textShadow, coverText: getComputedStyle(document.querySelector('.track-thumb')).color, playText: getComputedStyle(document.querySelector('.main-play-button')).color }));
      await page.evaluate(() => { const toast = document.createElement('div'); toast.id = 'preview-error'; toast.className = 'toast error'; toast.textContent = '提示预览：播放暂时失败，请重试'; document.querySelector('#toast-stack').append(toast); });
      await capture(`${scheme}-error`);
      report.foreground[scheme].error = await page.locator('#preview-error').evaluate(node => getComputedStyle(node).color);
      await page.locator('#preview-error').evaluate(node => node.remove());
    }
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: report.scheme }] });
    await setBackdrop(report.scheme);
    await page.locator('#preview-backdrop').evaluate(node => { node.hidden = true; });
    await capture('transparent-native');
    await page.locator('#preview-backdrop').evaluate(node => { node.hidden = false; });
    // Emulate the media feature without rewriting the release stylesheet.
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-transparency', value: 'reduce' }] });
    assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-transparency:reduce)').matches), true);
    await capture('reduced-transparency');
    report.reducedTransparency = await page.evaluate(() => { const selectors = ['.app-shell', '.main-shell', '.sidebar', '.player', '.queue-panel', '.lyrics-panel', '.login-modal', '.list-rail .rail-button']; return Object.fromEntries(selectors.map(selector => { const style = getComputedStyle(document.querySelector(selector)); return [selector, { background: style.backgroundColor, blur: style.backdropFilter }]; })); });
    for (const surface of Object.values(report.reducedTransparency)) { assert.equal(surface.blur, 'none'); assert.ok(!surface.background.includes('rgba') && !surface.background.includes(' / ')); }
    assert.deepEqual(report.rendererErrors, []);
    console.log(JSON.stringify({ theme: report.theme, version, screenshots: report.screenshots.length, rendererErrors: report.rendererErrors, nativeTheme: report.nativeTheme, scheme: report.scheme, unchangedGlass: !report.beforeMaterial || JSON.stringify(report.currentMaterial) === JSON.stringify(report.beforeMaterial), foreground: report.foreground }));
  } finally { if (application) await application.close(); fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
