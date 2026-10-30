'use strict';

// Isolated integration check. It never reads account.enc or the production
// browser profile, and every playable song resolves to a local silent WAV.
// Usage: node scripts/verify-lyrics.cjs [path/to/QingyinConcept.exe]
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { loadTestDependency } = require('./test-deps.cjs');
const { _electron } = loadTestDependency('playwright');
const root = path.resolve(__dirname, '..');
const executable = process.argv[2];
const output = path.join(root, 'test-output', 'lyrics-preview-0.1.41', executable ? 'packaged' : 'source');
const profile = path.join(output, 'isolated-data');
fs.mkdirSync(profile, { recursive: true });
const reportFile = path.join(output, 'report.json');
const report = {
  version: require('../package.json').version,
  mode: executable ? 'packaged' : 'source',
  fixture: 'Isolated fake account; all playback uses a local silent WAV at volume zero. No production profile or account is read.',
  screenshotBackdrop: 'Synthetic browser backdrop; capturePage does not include Windows DWM material.',
  checks: {}, screenshots: [], rendererErrors: [], remoteRendererRequests: [],
};
let application, page;

function createSilentWav(destination) {
  const rate = 48000, seconds = 90, size = rate * seconds * 4, wav = Buffer.alloc(44 + size);
  wav.write('RIFF'); wav.writeUInt32LE(36 + size, 4); wav.write('WAVE', 8);
  wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(size, 40); fs.writeFileSync(destination, wav);
}
function abstractCover(top, bottom) {
  return 'data:image/svg+xml;base64,' + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><defs><linearGradient id="a" x2="0" y2="1"><stop stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs><rect width="400" height="400" fill="url(#a)"/><circle cx="160" cy="155" r="87" fill="#e8edf4" opacity=".15"/><path d="M0 280Q100 210 210 300T400 265V400H0" fill="#d0dce7" opacity=".5"/><path d="M0 315Q110 260 225 325T400 310V400H0" fill="#f0f3f6" opacity=".6"/></svg>`).toString('base64');
}
async function createFixture() {
  const wav = path.join(profile, '歌词验证静音.wav');
  createSilentWav(wav);
  const id = crypto.createHash('sha256').update(path.resolve(wav).toLowerCase()).digest('hex').slice(0, 24);
  fs.writeFileSync(path.join(profile, 'library.json'), JSON.stringify([{ path: wav }]));
  fs.writeFileSync(path.join(profile, 'preferences.json'), JSON.stringify({ preferences: { volume: 0, output: 'browser', quality: 'auto', effects: 'off', shuffle: false, repeat: 'all' }, favorites: [], history: [], sort: { field: 'default', direction: 'asc' } }));
  let firstCover = abstractCover('#0b1223', '#42596b');
  const reference = process.env.QINGYIN_REFERENCE_COVER || '';
  if (fs.existsSync(reference)) {
    const sharp = loadTestDependency('sharp');
    const metadata = await sharp(reference).metadata();
    // Crop only the artwork from the user's supplied screenshot. This file is
    // a test fixture under test-output, which build.cjs excludes from releases.
    const scaleX = metadata.width / 1649, scaleY = metadata.height / 1070;
    const png = await sharp(reference).extract({ left: Math.round(402 * scaleX), top: Math.round(273 * scaleY), width: Math.round(405 * scaleX), height: Math.round(404 * scaleY) }).resize(560, 560).png().toBuffer();
    fs.writeFileSync(path.join(output, 'reference-cover-fixture.png'), png);
    firstCover = 'data:image/png;base64,' + png.toString('base64');
    report.referenceCover = 'Cropped from the user-provided screenshot; isolated fixture only.';
  }
  const copy = [
    '风经过窗边，音乐慢慢响起', '这一刻，把心事放进旋律里',
    '幸得艰辛的引路甜蜜', '不致太寡', '青春的快餐只要求快', '不理哪一家',
    '哪有玩味的空档来欣赏', '细致淡雅', '到大悟大彻将虎咽的升华',
    '等消化学沏茶', '至共你觉得苦也不太差',
    '让晚风慢慢吹过那些来不及说完的故事，把所有平凡的片刻都留在这一段旋律里',
    '灯光落在安静的窗台', '给每一种心情留一个声音的位置',
    '耳边的旋律仍旧轻轻流动', '此刻，就这样慢慢听',
  ];
  const lyrics = Object.fromEntries(['lyrics-bitter', 'lyrics-next'].map((hash, song) => [hash, copy.map((line, index) => `[${String(Math.floor(index * 4 / 60)).padStart(2, '0')}:${String(index * 4 % 60).padStart(2, '0')}.00]${song ? `第二首 · ${line}` : line}`).join('\n')]));
  lyrics['lyrics-empty'] = '';
  const songs = [
    { hash: 'lyrics-bitter', title: '苦瓜', artist: '陈奕迅', album: 'Stranger Under My Skin', cover: firstCover },
    { hash: 'lyrics-next', title: '晚风来信', artist: '青音合奏', album: '隔离验收 · 切歌状态', cover: abstractCover('#637e78', '#c6a991') },
    { hash: 'lyrics-empty', title: '没有封面与歌词的歌', artist: '隔离验证', album: '', cover: '' },
  ].map((song, index) => ({ ...song, albumAudioId: index + 1, duration: 90, playlistEntryId: `lyrics:fixture:${index}` }));
  return { songs, lyrics, url: `qingyin-audio://track/${id}`, calls: [] };
}

function fixtureResponse(method, params = {}) {
  const fixture = globalThis.lyricsFixture;
  fixture.calls.push({ method, hash: params.hash });
  let data = {};
  if (method === 'status') data = { loggedIn: true, user: { id: 'lyrics-fixture', name: '歌词隔离验证' }, platform: 'lite' };
  else if (method === 'recommendations' || method === 'playlists') data = { playlists: [{ id: 'lyrics-fixture', title: '歌词交互验收', count: fixture.songs.length, private: true }], songs: [], total: 1, hasMore: false };
  else if (method === 'playlistSongs') data = { songs: fixture.songs, total: fixture.songs.length, sourceTotal: fixture.songs.length, totalReliable: true, totalReported: true, sourcePage: 1, page: 1, pageSize: 300, rawCount: fixture.songs.length, hasMore: false };
  else if (method === 'songUrl') data = { url: fixture.url, duration: 90, preview: false, quality: { format: 'wav', bitDepth: 16, sampleRateHz: 48000, label: 'WAV 无损', streamVerified: true, fallback: false } };
  else if (method === 'lyrics') data = { text: fixture.lyrics[params.hash] || '' };
  else if (method === 'songQualities') data = { tiers: [{ id: 'auto', label: '自动（最高可播放）', group: 'auto', selectable: true }, { id: 'lossless', label: '无损音质', group: 'standard', selectable: true }] };
  return { ok: true, data };
}

async function capture(name) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const png = await application.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'));
  const destination = path.join(output, `${name}.png`);
  fs.writeFileSync(destination, Buffer.from(png, 'base64')); report.screenshots.push(destination);
}
async function seek(seconds) {
  await page.locator('#seek').evaluate((node, seconds) => {
    node.value = String(seconds / 90 * 100);
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
  }, seconds);
  await page.waitForFunction(seconds => Math.abs(document.querySelector('#audio').currentTime - seconds) < .2, seconds);
}
async function assertCentered(label, expected) {
  await page.waitForFunction(expected => {
    const content = document.querySelector('#lyrics-content'), active = content?.querySelector('.lyric-line.active');
    if (!content || !active || Number(active.dataset.lyricIndex) !== expected) return false;
    const outer = content.getBoundingClientRect(), line = active.getBoundingClientRect();
    return Math.abs(line.top + line.height / 2 - outer.top - outer.height / 2) < 7;
  }, expected, { timeout: 12000 });
  report.checks[label] = await page.evaluate(() => {
    const content = document.querySelector('#lyrics-content'), active = content.querySelector('.lyric-line.active');
    const outer = content.getBoundingClientRect(), line = active.getBoundingClientRect();
    return { active: Number(active.dataset.lyricIndex), centerOffsetPx: Math.round((line.top + line.height / 2 - outer.top - outer.height / 2) * 100) / 100, scrollTop: Math.round(content.scrollTop) };
  });
}
async function checkLayout(label) {
  const layout = await page.evaluate(() => {
    const panel = document.querySelector('#lyrics-panel').getBoundingClientRect();
    const selectors = ['.lyrics-top', '.lyrics-track', '.lyrics-art', '.lyrics-song-copy', '#lyrics-content', '.lyrics-footer'];
    const boxes = Object.fromEntries(selectors.map(selector => {
      const node = document.querySelector(selector), rect = node.getBoundingClientRect();
      return [selector, { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth }];
    }));
    const overflowLines = [...document.querySelectorAll('.lyric-line')].filter(node => node.scrollWidth > node.clientWidth + 2).map(node => node.dataset.lyricIndex);
    return { viewport: [innerWidth, innerHeight], panel: { left: panel.left, top: panel.top, right: panel.right, bottom: panel.bottom }, documentWidth: document.documentElement.scrollWidth, boxes, overflowLines };
  });
  assert.ok(layout.documentWidth <= layout.viewport[0] + 1, `${label}: document must not overflow horizontally`);
  for (const [selector, box] of Object.entries(layout.boxes)) {
    assert.ok(box.width > 0 && box.height > 0, `${label}: ${selector} must have a visible layout`);
    assert.ok(box.left >= layout.panel.left - 2 && box.right <= layout.panel.right + 2, `${label}: ${selector} must stay inside the lyrics panel horizontally`);
    assert.ok(box.top >= layout.panel.top - 2 && box.bottom <= layout.panel.bottom + 2, `${label}: ${selector} must stay inside the lyrics panel vertically`);
  }
  assert.deepEqual(layout.overflowLines, [], `${label}: long lyrics must wrap without horizontal overflow`);
  report.checks[label] = layout;
}
async function waitPlaying(title) {
  await page.waitForFunction(title => {
    const audio = document.querySelector('#audio');
    return document.querySelector('#player-title').textContent === title && !audio.paused && audio.readyState >= 3 && audio.currentTime > .1 && !document.querySelector('#play-button').classList.contains('loading');
  }, title, { timeout: 15000 });
  await page.locator('#play-button').click();
  await page.waitForFunction(() => document.querySelector('#audio').paused);
}

(async () => {
  const fixture = await createFixture();
  const bootstrap = path.join(profile, 'fixture-bootstrap.cjs');
  fs.writeFileSync(bootstrap, `const path=require('node:path');\nconst root=${JSON.stringify(root)};\nglobalThis.lyricsFixture=${JSON.stringify(fixture)};\nconst file=path.join(root,'lib','kugou.cjs');\nrequire.cache[require.resolve(file)]={id:file,filename:file,loaded:true,exports:{createKugouAdapter:()=>({invoke:async(method,params)=>(${fixtureResponse.toString()})(method,params)})}};\nrequire(path.join(root,'main.cjs'));\n`);
  const env = { ...process.env, QINGYIN_TEST: '1', QINGYIN_TEST_DATA: profile };
  delete env.ELECTRON_RUN_AS_NODE; delete env.QINGYIN_TEST_ACCOUNT_READONLY;
  application = await _electron.launch({ executablePath: executable || require('electron'), args: executable ? [] : [bootstrap], cwd: root, env, timeout: 30000 });
  page = await application.firstWindow();
  page.on('pageerror', error => report.rendererErrors.push(error.message));
  page.on('request', request => { if (/^https?:\/\//i.test(request.url())) report.remoteRendererRequests.push(request.url()); });
  report.electronOrAppVersion = await application.evaluate(({ app }) => app.getVersion());
  if (executable) report.version = report.electronOrAppVersion;
  await application.evaluate(({ BrowserWindow, session }) => {
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
  });
  if (executable) {
    await application.evaluate(({ ipcMain }, data) => {
      globalThis.lyricsFixture = data.fixture;
      const invoke = new Function('method', 'params', `return (${data.functionText})(method,params);`);
      ipcMain.removeHandler('music:api'); ipcMain.handle('music:api', (_event, method, params) => invoke(method, params));
    }, { fixture, functionText: fixtureResponse.toString() });
    await page.reload();
  }
  await page.waitForFunction(() => document.querySelector('#sidebar-account').textContent.includes('歌词隔离验证'));
  await page.evaluate(() => {
    const backdrop = document.createElement('div'); backdrop.id = 'lyrics-test-backdrop';
    backdrop.style.cssText = 'position:fixed;inset:0;z-index:-1;pointer-events:none;background:#d0d7df'; document.body.prepend(backdrop);
  });
  await page.emulateMedia({ colorScheme: 'light' });
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 1000));
  await page.locator('#lyrics-button').click();
  await page.locator('.lyrics-placeholder').waitFor();
  assert.equal(await page.locator('#lyrics-body img').count(), 0, 'The initial empty state must not invent cover art');
  assert.equal(await page.locator('#lyrics-ambient img').count(), 0, 'The initial empty state must not invent artwork atmosphere');
  assert.equal(await page.locator('#lyrics-ambient').evaluate(node => getComputedStyle(node).backgroundImage), 'none', 'The initial empty state must clear artwork atmosphere');
  report.checks.initialEmpty = 'PASS';
  await capture('light-empty');
  await page.keyboard.press('Escape');
  await page.locator('#lyrics-panel').waitFor({ state: 'hidden' });
  await page.locator('[data-view="playlists"]').click();
  await page.locator('.playlist-card').filter({ hasText: '歌词交互验收' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.track-row').length === 3);
  await page.locator('.track-title[data-action="play-song"]').first().click();
  await waitPlaying('苦瓜');
  await seek(28);
  const mainScroll = await page.locator('#main-content').evaluate(node => node.scrollTop);
  await page.locator('#lyrics-button').click();
  await page.waitForFunction(() => document.querySelectorAll('button.lyric-line').length === 16);
  assert.equal(await page.locator('.lyrics-artist').textContent(), '陈奕迅');
  assert.equal(await page.locator('.lyrics-album').textContent(), 'Stranger Under My Skin');
  await page.locator('#play-button').click();
  await page.waitForFunction(() => !document.querySelector('#audio').paused);
  assert.equal(await page.locator('#lyrics-panel').isVisible(), true, 'Using the player controls must preserve the open lyrics panel');
  await page.locator('#play-button').click();
  await page.waitForFunction(() => document.querySelector('#audio').paused);
  assert.equal(await page.locator('#lyrics-panel').isVisible(), true, 'Pausing playback must preserve the open lyrics panel');
  const seekBox = await page.locator('#seek').boundingBox();
  await page.locator('#seek').click({ position: { x: seekBox.width * .32, y: seekBox.height / 2 } });
  assert.equal(await page.locator('#lyrics-panel').isVisible(), true, 'Clicking the playback progress must preserve the open lyrics panel');
  await seek(28);
  report.checks.playerControlsPreserveLyrics = 'PASS';
  await assertCentered('openAtCurrentLine', 7);
  await checkLayout('lightDesktopLayout');
  await capture('light-lyrics-desktop');

  await page.locator('button.lyric-line[data-lyric-index="10"]').click();
  await page.waitForFunction(() => Math.abs(document.querySelector('#audio').currentTime - 40) < .2);
  await assertCentered('clickSeeksAndCenters', 10);
  const keyboardLine = page.locator('button.lyric-line[data-lyric-index="9"]');
  await keyboardLine.focus(); await keyboardLine.press('Enter');
  await page.waitForFunction(() => Math.abs(document.querySelector('#audio').currentTime - 36) < .2);
  await assertCentered('enterSeeksAndCenters', 9);

  await page.locator('#lyrics-content').hover();
  await page.mouse.wheel(0, -220);
  await page.waitForFunction(() => !document.querySelector('#lyrics-follow').hidden);
  await page.waitForTimeout(400);
  const manualScroll = await page.locator('#lyrics-content').evaluate(node => node.scrollTop);
  await seek(44);
  await page.waitForFunction(() => document.querySelector('.lyric-line.active')?.dataset.lyricIndex === '11');
  const afterSeekScroll = await page.locator('#lyrics-content').evaluate(node => node.scrollTop);
  assert.ok(Math.abs(afterSeekScroll - manualScroll) < 3, 'Manual browsing must suspend automatic lyric scrolling');
  assert.equal(await page.locator('#main-content').evaluate(node => node.scrollTop), mainScroll, 'Lyric browsing must preserve the underlying song list scroll position');
  report.checks.manualBrowsing = { scrollBeforeSeek: manualScroll, scrollAfterSeek: afterSeekScroll, underlyingMainScroll: mainScroll };
  await capture('light-manual-follow-paused');
  await page.locator('#lyrics-follow').click();
  await assertCentered('followButtonRestores', 11);
  assert.equal(await page.locator('#lyrics-follow').isVisible(), false, 'Follow button must hide after restoring automatic following');

  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.locator('#lyrics-test-backdrop').evaluate((node, scheme) => { node.style.background = scheme === 'light' ? '#d0d7df' : '#141b29'; }, scheme);
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 1000));
    await seek(32); await assertCentered(`${scheme}DesktopCentered`, 8);
    await checkLayout(`${scheme}DesktopLayout`); await capture(`${scheme}-lyrics-desktop`);
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(920, 600));
    await seek(36); await assertCentered(`${scheme}MinimumCentered`, 9);
    await checkLayout(`${scheme}MinimumLayout`); await capture(`${scheme}-lyrics-920x600`);
  }
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion:reduce)').matches), true);
  await seek(48); await assertCentered('reducedMotionCenters', 12);
  report.checks.reducedMotion = await page.evaluate(() => {
    const selectors = ['#lyrics-panel', '#lyrics-ambient', '.lyrics-art', '.lyric-line', '.lyric-line.active', '#lyrics-follow'];
    return Object.fromEntries(selectors.map(selector => {
      const style = getComputedStyle(document.querySelector(selector));
      return [selector, { animation: style.animationName, animationDuration: style.animationDuration, transitionDuration: style.transitionDuration, scrollBehavior: style.scrollBehavior }];
    }));
  });
  for (const [selector, style] of Object.entries(report.checks.reducedMotion)) {
    assert.ok(style.animation === 'none' || style.animationDuration.split(',').every(value => parseFloat(value) <= .001), `Reduced motion: ${selector} must not animate`);
    assert.ok(style.transitionDuration.split(',').every(value => parseFloat(value) <= .001), `Reduced motion: ${selector} must not transition`);
  }
  await capture('light-reduced-motion');

  const originalCover = await page.locator('.lyrics-art img').getAttribute('src');
  await page.locator('#next-button').click(); await waitPlaying('晚风来信');
  await page.waitForFunction(() => document.querySelector('.lyrics-song-copy h2')?.textContent === '晚风来信' && document.querySelector('button.lyric-line')?.textContent.includes('第二首'));
  assert.notEqual(await page.locator('.lyrics-art img').getAttribute('src'), originalCover, 'Changing songs must replace cover art');
  assert.equal(await page.locator('.lyrics-artist').textContent(), '青音合奏');
  report.checks.changeSong = 'PASS'; await capture('light-second-song');
  await page.locator('#next-button').click(); await waitPlaying('没有封面与歌词的歌');
  await page.locator('.lyric-empty').waitFor();
  assert.equal(await page.locator('#lyrics-body img').count(), 0, 'Missing cover art must not reuse the previous song cover');
  assert.equal(await page.locator('#lyrics-ambient img').count(), 0, 'Missing cover art must not retain previous artwork atmosphere');
  assert.equal(await page.locator('#lyrics-body .lyric-line').count(), 0, 'An empty song must not retain the previous song lyrics');
  assert.equal(await page.locator('#lyrics-ambient').evaluate(node => getComputedStyle(node).backgroundImage), 'none', 'Missing cover art must clear previous atmosphere');
  assert.equal(await page.locator('#lyrics-follow').isVisible(), false);
  report.checks.noCoverAndNoLyrics = 'PASS'; await capture('light-no-cover-no-lyrics');
  await page.keyboard.press('Escape');
  await page.locator('#lyrics-panel').waitFor({ state: 'hidden' });
  report.checks.escapeCloses = 'PASS';
  report.checks.localSilentPlayback = await page.locator('#audio').evaluate(node => ({ source: node.getAttribute('src'), volume: node.volume }));
  assert.equal(report.checks.localSilentPlayback.source, fixture.url);
  assert.equal(report.checks.localSilentPlayback.volume, 0);
  report.apiCalls = await application.evaluate(() => globalThis.lyricsFixture.calls);
  assert.deepEqual(report.rendererErrors, []);
  assert.deepEqual(report.remoteRendererRequests, []);
  report.status = 'PASS';
})().catch(async error => {
  report.status = 'FAIL'; report.error = error.stack;
  if (page && !page.isClosed()) {
    report.failure = await page.evaluate(() => ({ title: document.querySelector('#player-title')?.textContent, time: document.querySelector('#audio')?.currentTime, lyricRows: document.querySelectorAll('.lyric-line').length, active: document.querySelector('.lyric-line.active')?.dataset.lyricIndex, content: document.querySelector('#lyrics-content') ? { scrollTop: document.querySelector('#lyrics-content').scrollTop, height: document.querySelector('#lyrics-content').clientHeight } : null })).catch(() => ({}));
    await capture('failure').catch(() => {});
  }
  console.error(error.stack); process.exitCode = 1;
}).finally(async () => {
  await application?.close().catch(() => {});
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, version: report.version, mode: report.mode, checks: Object.keys(report.checks).length, screenshots: report.screenshots.length, rendererErrors: report.rendererErrors, report: reportFile }));
});
