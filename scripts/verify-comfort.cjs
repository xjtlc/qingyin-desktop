'use strict';

// Every fixture, session and browser profile belongs to this test run. No
// production profile or account is read, copied or written by this verifier.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron } = require('./test-deps.cjs').loadTestDependency('playwright');
const root = path.resolve(__dirname, '..');
const executable = process.argv.slice(2).find(value => !value.startsWith('--'));
const minuteDeadline = process.argv.includes('--minute-deadline');
const minimumPanels = process.argv.includes('--minimum-panels');
const dataDir = path.join(root, 'test-output', `comfort-verification-${executable ? 'packaged' : 'source'}-${Date.now()}`);
fs.mkdirSync(dataDir, { recursive: true });
function silentWav(name, duration = 75) {
  const destination = path.join(dataDir, name), rate = 48000, size = rate * duration * 4;
  const bytes = Buffer.alloc(44 + size);
  bytes.write('RIFF'); bytes.writeUInt32LE(36 + size, 4); bytes.write('WAVE', 8);
  bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(2, 22); bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 4, 28);
  bytes.writeUInt16LE(4, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(size, 40);
  fs.writeFileSync(destination, bytes); return destination;
}
const files = ['A', 'B', 'C'].map(letter => silentWav(`舒心验证 ${letter}.wav`));
const preferences = { volume: 0, output: 'browser', quality: 'auto', effects: 'off', shuffle: false, repeat: 'all' };
fs.writeFileSync(path.join(dataDir, 'library.json'), JSON.stringify(files.map(file => ({ path: file }))));
fs.writeFileSync(path.join(dataDir, 'preferences.json'), JSON.stringify({ preferences, favorites: [], history: [], searchHistory: [], sort: { field: 'default', direction: 'asc' } }));
const songs = ['A', 'B', 'C'].map((letter, index) => ({ hash: `comfort-${letter}`, albumId: 'fixture', albumAudioId: index + 1, title: `舒心功能 ${letter}`, artist: '隔离验证', album: '功能验证', duration: 75 }));
const env = { ...process.env, QINGYIN_TEST: '1', QINGYIN_TEST_DATA: dataDir };
delete env.ELECTRON_RUN_AS_NODE; delete env.QINGYIN_TEST_ACCOUNT_READONLY;
let application, page;
const report = { fixture: 'isolated fake account and userData, real silent WAV, mocked online catalog', run: executable ? 'packaged' : 'source', checks: {}, screenshots: [], rendererErrors: [] };
function checkpoint(name, value = 'PASS') { report.checks[name] = value; console.log(JSON.stringify({ checkpoint: name, result: value })); }
async function capture(name) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const png = await application.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows().find(window => /\/ui\/index\.html(?:$|\?)/i.test(window.webContents.getURL().replaceAll('\\', '/'))).capturePage()).toPNG().toString('base64'));
  const filename = path.join(dataDir, `${name}-${report.version}.png`);
  fs.writeFileSync(filename, Buffer.from(png, 'base64')); report.screenshots.push(filename);
}
async function ready() {
  await page.waitForFunction(() => document.querySelector('#sidebar-account').textContent.includes('舒心验证账号'));
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => /\/ui\/index\.html(?:$|\?)/i.test(window.webContents.getURL().replaceAll('\\', '/'))).webContents.insertCSS('*,*::before,*::after{transition:none!important;animation:none!important}'));
}
async function search(query) {
  await page.locator('#search-input').fill(query); await page.locator('#search-input').press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.track-row').length === 3 && !document.querySelector('.content-loading'));
}
async function playing(title) {
  await page.waitForFunction(expected => { const audio = document.querySelector('#audio'); return document.querySelector('#player-title').textContent === expected && !audio.paused && audio.readyState >= 3 && audio.currentTime > .1 && !document.querySelector('#play-button').classList.contains('loading'); }, title, { timeout: 15000 });
}
async function queueRows() {
  const panel = page.locator('#queue-panel');
  if (await panel.isHidden()) await page.locator('#queue-button').click();
  const rows = await page.locator('#queue-content .queue-row').evaluateAll(nodes => nodes.map(node => ({ title: node.querySelector('.track-title').textContent, key: node.dataset.trackKey, current: node.classList.contains('current') })));
  return rows;
}
async function closeQueue() {
  if (await page.locator('#queue-panel').isVisible()) await page.locator('#queue-panel [data-action="queue"]').click();
}
async function openSleep() {
  if (await page.locator('#sleep-panel').isHidden()) await page.locator('#sleep-button').click();
}
async function closeSleep() {
  if (await page.locator('#sleep-panel').isVisible()) await page.locator('#sleep-panel [data-action="sleep"]').click();
}
async function setMode(title) {
  for (let attempt = 0; attempt < 5; attempt++) {
    if (await page.locator('#repeat-button').getAttribute('title') === title) return;
    await page.locator('#repeat-button').click();
  }
  assert.fail(`Playback mode was not reachable: ${title}`);
}
async function waitSavedHistory(expected) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const actual = await page.evaluate(() => window.music.store.get());
    if (JSON.stringify(actual.searchHistory) === JSON.stringify(expected)) return;
    await page.waitForTimeout(50);
  }
  assert.deepEqual((await page.evaluate(() => window.music.store.get())).searchHistory, expected);
}

(async () => {
  application = await _electron.launch({ executablePath: executable || require('electron'), args: executable ? [] : [root], cwd: root, env, timeout: 30000 });
  await application.firstWindow();
  const deadline = Date.now() + 10000;
  while (!page && Date.now() < deadline) {
    page = application.windows().find(window => /\/ui\/index\.html(?:$|\?)/i.test(window.url().replaceAll('\\', '/')));
    if (!page) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(page, 'The main player window must be selected');
  page.on('pageerror', error => report.rendererErrors.push(error.message));
  report.version = await application.evaluate(({ app }) => app.getVersion());
  const profile = await application.evaluate(({ app }) => app.getPath('userData'));
  assert.equal(path.resolve(profile), path.resolve(dataDir, 'browser-profile'));
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => /\/ui\/index\.html(?:$|\?)/i.test(window.webContents.getURL().replaceAll('\\', '/'))).webContents.setBackgroundThrottling(false));
  await page.waitForFunction(() => typeof window.music?.invoke === 'function');
  const local = await page.evaluate(() => window.music.local.list());
  const urls = ['A', 'B', 'C'].map(letter => local.find(song => song.title === `舒心验证 ${letter}`)?.url);
  assert.ok(urls.every(Boolean));
  await application.evaluate(({ ipcMain }, fixture) => {
    globalThis.comfortFixture = { ...fixture, calls: [], held: [], holdHash: '' };
    ipcMain.removeHandler('music:api');
    ipcMain.handle('music:api', (_event, method, params = {}) => {
      const fixture = globalThis.comfortFixture; fixture.calls.push({ method, params }); let data = {};
      if (method === 'status') data = { loggedIn: true, user: { id: 'comfort-verification', name: '舒心验证账号' }, platform: 'lite' };
      else if (method === 'search') data = { songs: fixture.songs, total: 3 };
      else if (method === 'recommendations') data = { playlists: [], songs: [] };
      else if (method === 'playlists') data = { playlists: [], total: 0, hasMore: false };
      else if (method === 'songUrl') {
        data = { url: fixture.urls[fixture.songs.findIndex(song => song.hash === params.hash)], duration: 75, preview: false, quality: { format: 'wav', bitDepth: 16, sampleRateHz: 48000, label: 'WAV 无损', streamVerified: true } };
        if (fixture.holdHash === params.hash) return new Promise(resolve => fixture.held.push(() => resolve({ ok: true, data })));
      }
      else if (method === 'lyrics') data = { lines: [], plain: [] };
      else if (method === 'songQualities') data = { tiers: [{ id: 'auto', label: '自动（最高可播放）', group: 'auto', available: true, selectable: true }] };
      return { ok: true, data };
    });
  }, { songs, urls });
  await page.reload(); await ready();
  // The remaining scenarios intentionally use public DOM controls and IPC. The
  // application's closure state is never replaced with a test-only substitute.
  await search('夜曲'); await search('测试 歌手'); await search('夜曲');
  await waitSavedHistory(['夜曲', '测试 歌手']);
  await page.reload(); await ready();
  await page.locator('#search-input').fill(''); await page.locator('#search-input').focus();
  await page.locator('.search-history-panel').waitFor();
  assert.equal(await page.locator('.search-history-option').count(), 2);
  await capture('search-history');
  await page.locator('.search-history-remove').first().click();
  await waitSavedHistory(['测试 歌手']);
  await page.locator('.search-history-option').click();
  await page.waitForFunction(() => document.querySelectorAll('.track-row').length === 3);
  assert.equal(await page.locator('#search-input').inputValue(), '测试 歌手');
  await page.locator('#search-input').fill(''); await page.locator('#search-input').focus();
  await page.locator('.search-history-clear').click();
  await waitSavedHistory([]);
  checkpoint('searchHistoryRemembersDeduplicatesRestoresDeletesClears');

  await search('功能验证');
  await page.locator('[data-action="play-all"]').click(); await playing(songs[0].title);
  await page.locator('.track-row').filter({ hasText: songs[2].title }).locator('[data-action="play-next"]').click();
  let rows = await queueRows(); assert.deepEqual(rows.map(row => row.title), [songs[0].title, songs[2].title, songs[1].title]);
  await closeQueue(); await page.locator('#next-button').click(); await playing(songs[2].title);
  await setMode('单曲循环');
  await page.locator('.track-row').filter({ hasText: songs[1].title }).locator('[data-action="play-next"]').click();
  await page.locator('#audio').evaluate(audio => { audio.currentTime = audio.duration - .25; }); await playing(songs[1].title);
  assert.equal(await page.locator('#repeat-button').getAttribute('title'), '单曲循环');
  await page.locator('#audio').evaluate(audio => { audio.currentTime = audio.duration - .25; });
  await page.waitForFunction(expected => { const audio = document.querySelector('#audio'); return document.querySelector('#player-title').textContent === expected && !audio.paused && audio.currentTime > .1 && audio.currentTime < 2; }, songs[1].title);
  checkpoint('playNextOverridesRepeatOneOnceAndPreservesRepeatPreference');
  await setMode('随机播放');
  await page.locator('.track-row').filter({ hasText: songs[0].title }).locator('[data-action="play-next"]').click();
  rows = await queueRows(); const currentAt = rows.findIndex(row => row.current);
  assert.equal(rows[(currentAt + 1) % rows.length].title, songs[0].title); assert.equal(rows.length, 3);
  await closeQueue(); await page.locator('#next-button').click(); await playing(songs[0].title);
  rows = await queueRows();
  await page.locator('#queue-content .queue-row.current [data-action="remove-queue"]').click();
  await page.waitForFunction(() => document.querySelector('#audio').paused && document.querySelector('#audio').getAttribute('src') === null);
  assert.equal((await queueRows()).length, 2);
  await page.locator('[data-action="clear-queue"]').click();
  await page.waitForFunction(() => document.querySelector('#queue-size').textContent === '0' && document.querySelector('#play-button').disabled && document.querySelector('#audio').paused);
  await capture('empty-queue');
  await page.locator('.toast').filter({ hasText: '已清空播放队列' }).locator('.toast-action').click();
  assert.equal((await queueRows()).length, 2);
  assert.equal(await page.locator('#audio').evaluate(audio => audio.paused), true);
  await page.locator('[data-action="clear-queue"]').click(); await closeQueue();
  checkpoint('playNextRespectsLinearAndShuffleOrderAndQueueRemovalStopsPlayback');

  await setMode('列表循环'); await page.locator('[data-action="play-all"]').click(); await playing(songs[0].title);
  await page.keyboard.press('Control+k'); assert.equal(await page.locator('#search-input').evaluate(node => document.activeElement === node), true);
  await page.locator('#search-input').fill('快捷键 输入测试'); await page.keyboard.press('Space');
  assert.equal(await page.locator('#audio').evaluate(node => node.paused), false);
  await page.locator('#main-content').focus(); await page.keyboard.press('Space');
  await page.waitForFunction(() => document.querySelector('#audio').paused);
  await page.keyboard.press('Space'); await playing(songs[0].title);
  await page.keyboard.press('Control+ArrowRight'); await playing(songs[1].title);
  await page.keyboard.press('Control+ArrowLeft'); await playing(songs[0].title);
  await page.keyboard.press('ArrowRight'); await page.waitForFunction(() => { const audio = document.querySelector('#audio'); return audio.currentTime > 4.8 && audio.readyState >= 3 && !audio.seeking; });
  await page.keyboard.press('ArrowLeft'); await page.waitForFunction(() => document.querySelector('#audio').currentTime < 2);
  await page.keyboard.press('ArrowUp'); assert.equal(await page.locator('#volume').inputValue(), '0.05');
  await page.keyboard.press('ArrowDown'); assert.equal(await page.locator('#volume').inputValue(), '0');
  await page.keyboard.press('m'); assert.match(await page.locator('#mute-button').getAttribute('title'), /取消静音/);
  await page.keyboard.press('m'); assert.equal(await page.locator('#mute-button').getAttribute('title'), '静音');
  await page.keyboard.press('q'); await page.locator('#queue-panel').waitFor();
  await page.keyboard.press('Escape'); await page.locator('#queue-panel').waitFor({ state: 'hidden' });
  await page.keyboard.press('l'); await page.locator('#lyrics-panel').waitFor();
  await page.keyboard.press('Escape'); await page.locator('#lyrics-panel').waitFor({ state: 'hidden' });
  await page.locator('#shortcuts-button').click();
  await page.locator('#shortcuts-panel').waitFor();
  assert.match(await page.locator('#shortcuts-panel').textContent(), /Ctrl.*K/i);
  await capture('keyboard-help'); await page.keyboard.press('Escape');
  await page.locator('#shortcuts-panel').waitFor({ state: 'hidden' });
  checkpoint('keyboardPlaybackSearchFocusTypingIsolationAndHelp');

  await application.evaluate(() => { globalThis.comfortFixture.holdHash = 'comfort-A'; });
  await page.reload(); await ready(); await search('迟到播放地址验证');
  await page.locator('[data-action="play-all"]').click();
  await page.waitForFunction(() => document.querySelector('#play-button').classList.contains('loading'));
  await queueRows(); await page.locator('[data-action="clear-queue"]').click();
  await application.evaluate(() => { globalThis.comfortFixture.holdHash = ''; for (const release of globalThis.comfortFixture.held.splice(0)) release(); });
  await page.waitForTimeout(500);
  assert.equal(await page.locator('#queue-size').textContent(), '0');
  assert.equal(await page.locator('#audio').getAttribute('src'), null);
  assert.equal(await page.locator('#play-button').isDisabled(), true);
  await closeQueue();
  checkpoint('queueClearRejectsLatePlaybackResolution');

  const invalid = await page.evaluate(() => window.music.sleepTimer.set({ mode: 'minutes', minutes: 0 }));
  assert.equal(invalid.ok, false); assert.equal(invalid.state.active, false);
  await openSleep();
  await page.locator('[data-action="set-sleep"][data-minutes="15"]').click();
  const activeTimer = await page.evaluate(() => window.music.sleepTimer.status());
  assert.equal(activeTimer.state.mode, 'minutes'); assert.equal(activeTimer.state.minutes, 15);
  await capture('sleep-timer');
  await page.reload(); await ready();
  assert.equal((await page.evaluate(() => window.music.sleepTimer.status())).state.endsAt, activeTimer.state.endsAt);
  await openSleep(); await page.locator('[data-action="cancel-sleep"]').click(); await closeSleep();
  assert.equal((await page.evaluate(() => window.music.sleepTimer.status())).state.active, false);
  await search('本首结束验证'); await setMode('单曲循环');
  await page.locator('[data-action="play-all"]').click(); await playing(songs[0].title);
  await openSleep(); await page.locator('[data-action="set-sleep"][data-mode="after-track"]').click(); await closeSleep();
  assert.equal((await page.evaluate(() => window.music.sleepTimer.status())).state.mode, 'after-track');
  await page.locator('#audio').evaluate(audio => { audio.currentTime = audio.duration - .25; });
  await page.waitForFunction(() => document.querySelector('#audio').ended && document.querySelector('#audio').paused, null, { timeout: 5000 });
  await page.waitForFunction(async () => !(await window.music.sleepTimer.status()).state.active);
  await page.waitForTimeout(400);
  assert.equal(await page.locator('#player-title').textContent(), songs[0].title);
  assert.equal(await page.locator('#audio').evaluate(audio => audio.paused), true);
  checkpoint('sleepTimerValidationCancellationReloadAndAfterTrackOverridesRepeatOne');

  const native = await page.evaluate(() => window.music.mpv.status());
  assert.equal(native.available, true, 'The restored native player must be available');
  await setMode('列表循环'); await page.locator('[data-action="play-all"]').click(); await playing(songs[0].title);
  await page.locator('#output-button').click(); await page.locator('[data-action="set-output"][data-output="mpv"]').click();
  await page.waitForFunction(async () => { const { state } = await window.music.mpv.status(); return state.active && !state.loading && !state.paused && state.time > .1; });
  if (await page.locator('#output-panel').isVisible()) await page.locator('#output-panel [data-action="output"]').click();
  await openSleep(); await page.locator('[data-action="set-sleep"][data-mode="after-track"]').click(); await closeSleep();
  await page.waitForFunction(async () => (await window.music.mpv.status()).state.playlistCount <= 1);
  assert.equal((await page.evaluate(url => window.music.mpv.send('append', { url }), urls[1])).queued, false, 'The native main process must reject gapless prefetch while after-track is armed');
  assert.equal((await page.evaluate(() => window.music.mpv.send('seek', { seconds: 74.6 }))).ok, true);
  await page.waitForFunction(async () => { const timer = await window.music.sleepTimer.status(); const { state } = await window.music.mpv.status(); return !timer.state.active && (state.paused || !state.active); }, null, { timeout: 10000 });
  await page.waitForTimeout(400);
  assert.equal(await page.locator('#player-title').textContent(), songs[0].title);
  checkpoint('nativeAfterTrackStopsGaplessQueueAndDoesNotAdvance');
  await page.locator('#output-button').click(); await page.locator('[data-action="set-output"][data-output="browser"]').click();
  if (await page.locator('#output-panel').isVisible()) await page.locator('#output-panel [data-action="output"]').click();

  if (minuteDeadline) {
    await setMode('列表循环'); await page.locator('[data-action="play-all"]').click(); await playing(songs[0].title);
    await openSleep(); await page.locator('#sleep-minutes').fill('1');
    const start = Date.now();
    await page.locator('#sleep-form button[type="submit"]').click();
    await page.waitForFunction(async () => { const timer = await window.music.sleepTimer.status(); return timer.state.mode === 'minutes' && timer.state.minutes === 1; });
    await closeSleep();
    await page.waitForFunction(() => document.querySelector('#audio').paused, null, { timeout: 68000 });
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 59000 && elapsed < 67000, `Unexpected deadline elapsed: ${elapsed}`);
    assert.equal((await page.evaluate(() => window.music.sleepTimer.status())).state.active, false);
    assert.ok(await page.locator('#audio').evaluate(audio => audio.currentTime > 58 && audio.currentTime < 67));
    checkpoint('realMinuteDeadlinePausesPlaybackAndPreservesPosition', { status: 'PASS', elapsed });
  }
  if (minimumPanels) {
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => /\/ui\/index\.html(?:$|\?)/i.test(window.webContents.getURL().replaceAll('\\', '/'))).setSize(920, 680));
    report.minimumPanels = {};
    for (const colorScheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme });
      const measurements = {};
      const measure = async selector => {
        const result = await page.locator(selector).evaluate(node => {
          const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
          return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height, viewport: { width: innerWidth, height: innerHeight }, background: style.backgroundColor, opacity: style.opacity, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth };
        });
        assert.ok(result.x >= 0 && result.y >= 0 && result.right <= result.viewport.width + 1 && result.bottom <= result.viewport.height + 1, `${selector} must remain inside the minimum window`);
        assert.ok(result.scrollWidth <= result.clientWidth + 1, `${selector} must not overflow horizontally`);
        assert.equal(result.opacity, '1');
        assert.doesNotMatch(result.background, /^rgba\([^)]*,\s*0(?:\.\d+)?\)$/);
        return result;
      };
      await openSleep(); measurements.sleep = await measure('#sleep-panel'); await capture(`minimum-${colorScheme}-sleep`); await closeSleep();
      await page.locator('#shortcuts-button').click(); measurements.shortcuts = await measure('#shortcuts-panel'); await capture(`minimum-${colorScheme}-shortcuts`); await page.keyboard.press('Escape');
      await page.locator('#search-input').fill(''); await page.locator('#search-input').focus();
      measurements.history = await measure('.search-history-panel'); await capture(`minimum-${colorScheme}-history`); await page.keyboard.press('Escape');
      measurements.toolbar = await page.locator('.topbar').evaluate(node => {
        const form = node.querySelector('#search-form').getBoundingClientRect(), controls = node.querySelector('.topbar-actions').getBoundingClientRect();
        return { searchRight: form.right, controlsLeft: controls.left, width: innerWidth };
      });
      assert.ok(measurements.toolbar.searchRight <= measurements.toolbar.controlsLeft + 1, 'Search and toolbar must not overlap at minimum width');
      report.minimumPanels[colorScheme] = measurements;
    }
    checkpoint('minimumWidthLightAndDarkPanelsRemainOpaqueAndInsideWindow');
  }
  await capture('completed'); assert.deepEqual(report.rendererErrors, []);
  report.success = true; fs.writeFileSync(path.join(dataDir, 'results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, dataDir })); await application.close(); application = null;
})().catch(async error => {
  report.success = false; report.error = { message: error.message, stack: error.stack };
  if (page && !page.isClosed()) {
    report.failure = await page.evaluate(async () => ({ title: document.querySelector('#player-title').textContent, button: document.querySelector('#play-button').title, audioTime: document.querySelector('#audio').currentTime, audioPaused: document.querySelector('#audio').paused, sleepTimer: await window.music.sleepTimer.status(), history: (await window.music.store.get()).searchHistory, queueRows: document.querySelectorAll('#queue-content .queue-row').length, toasts: [...document.querySelectorAll('.toast')].map(node => node.textContent) })).catch(() => ({}));
    await capture('failure').catch(() => {});
  }
  fs.writeFileSync(path.join(dataDir, 'results.json'), JSON.stringify(report, null, 2));
  console.error(error.stack); console.error(JSON.stringify(report)); await application?.close().catch(() => {}); process.exitCode = 1;
});
