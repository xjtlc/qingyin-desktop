'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron } = require('./test-deps.cjs').loadTestDependency('playwright');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2), baseline = args.includes('--baseline');
const executable = args.find(value => !value.startsWith('--'));
const dataDir = path.join(root, 'test-output', `rendering-verification-${baseline ? 'baseline' : 'updated'}-${executable ? 'packaged' : 'source'}`);
fs.mkdirSync(dataDir, { recursive: true });
const wavFile = path.join(dataDir, '渲染验证静音.wav'), rate = 48000, size = rate * 18 * 4, wav = Buffer.alloc(44 + size);
wav.write('RIFF'); wav.writeUInt32LE(36 + size, 4); wav.write('WAVE', 8);
wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(size, 40); fs.writeFileSync(wavFile, wav);
fs.writeFileSync(path.join(dataDir, 'library.json'), JSON.stringify([{ path: wavFile }]));
fs.writeFileSync(path.join(dataDir, 'preferences.json'), JSON.stringify({ preferences: { volume: 0, output: 'browser', quality: 'auto', effects: 'off', shuffle: false, repeat: 'all' }, favorites: [], history: [], sort: { field: 'default', direction: 'asc' } }));
const cover = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" fill="#7294b4"/><circle cx="40" cy="40" r="21" fill="#dbe7f2"/><circle cx="40" cy="40" r="8" fill="#38516b"/></svg>').toString('base64');
const songs = Array.from({ length: 434 }, (_, index) => ({ hash: `rendering-${index}`, albumId: 'fixture', albumAudioId: index + 1, title: `渲染验证 ${String(index + 1).padStart(3, '0')}`, artist: `隔离验证 ${index % 3 + 1}`, album: '完整歌单验证', duration: 18, cover, playlistEntryId: `fixture:${index}`, playlistPosition: index }));
let application, page;
const report = { baseline, fixture: 'isolated fake account, 434 songs, real silent WAV, mocked native IPC; production profile is not used', screenshots: [], measurements: {}, panels: {}, rendererErrors: [] };
const env = { ...process.env, QINGYIN_TEST: '1', QINGYIN_TEST_DATA: dataDir };
delete env.ELECTRON_RUN_AS_NODE; delete env.QINGYIN_TEST_ACCOUNT_READONLY;

async function capture(name) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const png = await application.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows().find(window => /\/ui\/index\.html(?:$|\?)/i.test(window.webContents.getURL().replaceAll('\\', '/'))).capturePage()).toPNG().toString('base64'));
  const destination = path.join(dataDir, `${name}-${report.version}.png`);
  fs.writeFileSync(destination, Buffer.from(png, 'base64')); report.screenshots.push(destination);
}
async function begin(name) { await page.evaluate(name => window.beginRenderMeasurement(name), name); }
async function finish(name, { changingSong = false, nativeTick = false } = {}) {
  // Let asynchronous media events and mutation deliveries settle before reading.
  await page.waitForTimeout(220);
  const result = await page.evaluate(() => window.finishRenderMeasurement());
  report.measurements[name] = result;
  if (!baseline) {
    assert.equal(result.mainRootRebuilds, 0, `${name}: playback must preserve the main content`);
    assert.equal(result.largeListRebuilds, 0, `${name}: playback must preserve the 434-song list`);
    assert.equal(result.hiddenQueueRebuilds, 0, `${name}: hidden queues must not be rendered`);
    assert.ok(result.rowsReplaced <= (changingSong ? 2 : 1), `${name}: only the previous/current row may change, got ${result.rowsReplaced}`);
    assert.ok(result.rowCoversReplaced <= (changingSong ? 2 : 1), `${name}: unaffected row covers must survive`);
    assert.ok(result.footerCoverReplacements <= (changingSong ? 1 : 0), `${name}: the same song's footer cover must survive, got ${result.footerCoverReplacements}`);
    if (nativeTick) {
      assert.equal(result.rowsReplaced, 0, 'Native timeline updates must preserve every row');
      assert.equal(result.rowCoversReplaced, 0, 'Native timeline updates must preserve every row cover');
      assert.equal(result.footerIconReplacements, 0, 'Native timeline updates must preserve footer icons');
    }
  }
  assert.equal(result.rowsPresent, 434, `${name}: no song may disappear`);
  return result;
}
async function waitPlaying(expected) {
  await page.waitForFunction(title => { const audio = document.querySelector('#audio'); return document.querySelector('#player-title').textContent === title && !audio.paused && audio.readyState >= 3 && audio.currentTime > .1 && !document.querySelector('#play-button').classList.contains('loading'); }, expected, { timeout: 15000 });
}

(async () => {
  application = await _electron.launch({ executablePath: executable || require('electron'), args: executable ? [] : [root], cwd: root, env, timeout: 30000 });
  await application.firstWindow();
  const pageDeadline = Date.now() + 10000;
  while (!page && Date.now() < pageDeadline) {
    page = application.windows().find(window => /\/ui\/index\.html(?:$|\?)/i.test(window.url().replaceAll('\\', '/')));
    if (!page) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(page, 'The main player page must be selected instead of the optional taskbar-lyrics window');
  page.on('pageerror', error => report.rendererErrors.push(error.message));
  report.version = await application.evaluate(({ app }) => app.getVersion());
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => /\/ui\/index\.html(?:$|\?)/i.test(window.webContents.getURL().replaceAll('\\', '/'))).webContents.setBackgroundThrottling(false));
  await page.waitForFunction(() => typeof window.music?.invoke === 'function');
  const local = await page.evaluate(() => window.music.local.list());
  const source = local.find(song => song.title === '渲染验证静音'); assert.ok(source?.url);
  await application.evaluate(({ ipcMain, BrowserWindow }, fixture) => {
    globalThis.renderFixture = { ...fixture, loggedIn: true, held: [], holdFirst: true, apiCalls: [], state: { active: false, loading: false, sourceId: '', paused: true, time: 0, duration: 18, volume: 0, audioParams: { samplerate: 48000, format: 's16', channels: 'stereo' }, outParams: { samplerate: 48000, format: 's16', channels: 'stereo' }, error: null } };
    ipcMain.removeHandler('music:api');
    ipcMain.handle('music:api', async (_event, method, params = {}) => {
      const fixture = globalThis.renderFixture; fixture.apiCalls.push({ method, hash: params.hash }); let data = {};
      if (method === 'status') data = { loggedIn: fixture.loggedIn, user: fixture.loggedIn ? { id: 'rendering-fixture', name: '渲染验证' } : null, platform: 'lite' };
      else if (method === 'recommendations' || method === 'playlists') data = { playlists: [{ id: 'fixture-list', title: '434 首渲染验证歌单', count: 434, private: true, cover: fixture.songs[0].cover }], songs: [], total: 1, hasMore: false };
      else if (method === 'playlistSongs') {
        const page = Number(params.page) || 1, offset = (page - 1) * 300, rows = fixture.songs.slice(offset, offset + 300);
        data = { songs: rows, total: 434, sourceTotal: 434, totalReported: true, totalReliable: true, sourcePage: page, page, pageSize: 300, offset, rawCount: rows.length, hasMore: page === 1, nextPage: page === 1 ? 2 : null, nextOffset: page === 1 ? 300 : null };
      } else if (method === 'songUrl') {
        const playable = { url: fixture.url, duration: 18, preview: false, quality: { format: 'wav', bitDepth: 16, sampleRateHz: 48000, label: 'WAV 无损', streamVerified: true } };
        if (fixture.holdFirst && params.hash === 'rendering-0') return new Promise(resolve => fixture.held.push(() => resolve({ ok: true, data: playable })));
        data = playable;
      } else if (method === 'songQualities') data = { tiers: [
        { id: 'auto', label: '自动（最高可播放）', group: 'auto', selectable: true },
        { id: 'viper_tape', label: '蝰蛇母带音质', group: 'svip', selectable: false, hint: '隔离验证不可选状态' },
        { id: 'lossless', label: '无损音质', group: 'standard', selectable: true },
        { id: '128', label: '标准音质', group: 'standard', selectable: true },
      ] };
      else if (method === 'lyrics') data = { text: Array.from({ length: 36 }, (_, index) => `[00:${String(Math.floor(index / 2)).padStart(2, '0')}.${index % 2 ? '50' : '00'}]${['此刻，让声音慢慢经过', '留下歌单里熟悉的旋律', '听见今天，也听见自己'][index % 3]} · ${String(index + 1).padStart(2, '0')}`).join('\n') };
      else if (method === 'logout') { fixture.loggedIn = false; data = { loggedIn: false }; }
      else if (method === 'qrStart') data = { key: 'isolated-rendering-qr', image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', expiresIn: 180 };
      else if (method === 'qrCheck') data = { status: 'waiting' };
      return { ok: true, data };
    });
    ipcMain.removeHandler('music:mpv-status');
    ipcMain.handle('music:mpv-status', () => ({ available: true, state: globalThis.renderFixture.state }));
    ipcMain.removeHandler('music:mpv');
    ipcMain.handle('music:mpv', (_event, action, params = {}) => {
      const fixture = globalThis.renderFixture;
      if (action === 'stop') fixture.state = { ...fixture.state, active: false, sourceId: '', paused: true, time: 0 };
      else if (action === 'load') fixture.state = { ...fixture.state, active: true, loading: false, sourceId: params.url, paused: Boolean(params.paused), time: Number(params.time) || 0, duration: 18, volume: 0 };
      else if (action === 'pause' || action === 'resume') {
        fixture.state = { ...fixture.state, paused: action === 'pause' };
        BrowserWindow.getAllWindows().find(window => /\/ui\/index\.html(?:$|\?)/i.test(window.webContents.getURL().replaceAll('\\', '/'))).webContents.send('music:event', { type: 'mpv', name: 'pause', state: fixture.state });
      } else if (action === 'seek') fixture.state = { ...fixture.state, time: Number(params.seconds) || 0 };
      return { ok: true, state: fixture.state, queued: false };
    });
  }, { songs, url: source.url });
  await page.reload();
  // Navigation clears insertCSS. Apply it to the final fixture page, so a hidden
  // window cannot freeze a toast's entry animation at opacity zero.
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => /\/ui\/index\.html(?:$|\?)/i.test(window.webContents.getURL().replaceAll('\\', '/'))).webContents.insertCSS('*,*::before,*::after{transition:none!important;animation:none!important}'));
  await page.waitForFunction(() => document.querySelector('#sidebar-account').textContent.includes('渲染验证'));
  await page.locator('[data-view="playlists"]').click();
  await page.locator('.playlist-card').filter({ hasText: '434 首渲染验证歌单' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.track-row').length === 434 && document.querySelector('[data-action="play-all"]')?.disabled === false);
  await page.evaluate(() => {
    window.beginRenderMeasurement = name => {
      const main = document.querySelector('#main-content'), queue = document.querySelector('#queue-content'), cover = document.querySelector('#player-cover');
      const rows = [...main.querySelectorAll('.track-row')];
      const metrics = { name, started: performance.now(), mainRootRebuilds: 0, largeListRebuilds: 0, removedTrackRows: 0, hiddenQueueRebuilds: 0, footerCoverReplacements: 0, footerIconReplacements: 0 };
      const icons = ['#play-button', '#repeat-button', '#mute-button'].map(selector => document.querySelector(selector));
      const countRows = nodes => [...nodes].reduce((count, node) => count + (node.nodeType === 1 ? Number(node.matches('.track-row')) + node.querySelectorAll('.track-row').length : 0), 0);
      const observer = new MutationObserver(records => {
        for (const record of records) {
          if (record.type !== 'childList') continue;
          if (record.target === main) metrics.mainRootRebuilds++;
          if (record.target.nodeType === 1 && record.target.matches('.track-list') && countRows(record.addedNodes) + countRows(record.removedNodes) > 2) metrics.largeListRebuilds++;
          if (main.contains(record.target) || record.target === main) metrics.removedTrackRows += countRows(record.removedNodes);
          if (record.target === queue && document.querySelector('#queue-panel').hidden) metrics.hiddenQueueRebuilds++;
          if (record.target === cover) metrics.footerCoverReplacements++;
          if (icons.some(icon => icon === record.target || icon.contains(record.target))) metrics.footerIconReplacements++;
        }
      });
      observer.observe(main, { childList: true, subtree: true }); observer.observe(queue, { childList: true, subtree: true }); observer.observe(cover, { childList: true, subtree: true });
      for (const icon of icons) observer.observe(icon, { childList: true, subtree: true });
      window.renderMeasurement = { metrics, observer, rows: rows.map(node => ({ key: node.dataset.trackKey, node, cover: node.querySelector('.track-thumb')?.firstElementChild })) };
    };
    window.finishRenderMeasurement = () => {
      const { metrics, observer, rows } = window.renderMeasurement;
      observer.disconnect();
      const present = new Map([...document.querySelectorAll('#main-content .track-row')].map(node => [node.dataset.trackKey, node]));
      return { name: metrics.name, mainRootRebuilds: metrics.mainRootRebuilds, largeListRebuilds: metrics.largeListRebuilds, removedTrackRows: metrics.removedTrackRows, hiddenQueueRebuilds: metrics.hiddenQueueRebuilds, footerCoverReplacements: metrics.footerCoverReplacements, footerIconReplacements: metrics.footerIconReplacements, rowsReplaced: rows.filter(row => present.get(row.key) !== row.node).length, rowCoversReplaced: rows.filter(row => present.get(row.key)?.querySelector('.track-thumb')?.firstElementChild !== row.cover).length, rowsPresent: present.size, elapsedMs: Math.round(performance.now() - metrics.started) };
    };
  });
  await page.locator('.track-title[data-action="play-song"]').first().click();
  await application.evaluate(async () => {
    const deadline = Date.now() + 5000;
    while (!globalThis.renderFixture.held.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
    if (!globalThis.renderFixture.held.length) throw new Error('Fixture audio load did not start');
  });
  await page.waitForFunction(() => document.querySelector('#play-button').classList.contains('loading') && !!document.querySelector('#player-cover img'));
  await begin('browserConfirmation');
  await application.evaluate(() => { const fixture = globalThis.renderFixture; fixture.holdFirst = false; for (const resolve of fixture.held.splice(0)) resolve(); });
  await waitPlaying(songs[0].title); await finish('browserConfirmation');

  await begin('browserPause');
  await page.locator('#play-button').click();
  await page.waitForFunction(() => document.querySelector('#audio').paused && document.querySelector('#play-button').title === '播放');
  await finish('browserPause');
  await begin('browserResume');
  await page.locator('#play-button').click();
  await waitPlaying(songs[0].title); await finish('browserResume');

  await begin('manualNextSong');
  await page.locator('#next-button').click();
  await waitPlaying(songs[1].title); await finish('manualNextSong', { changingSong: true });

  await page.locator('#queue-button').click();
  assert.equal(await page.locator('#queue-content .queue-row').count(), 434);
  assert.equal(await page.locator('#queue-content .queue-row.current').count(), 1);
  assert.equal(await page.locator('#queue-content .queue-row.current .track-title').textContent(), songs[1].title);
  await page.locator('#queue-panel [data-action="queue"]').click();

  await page.locator('#output-button').click();
  await page.locator('[data-action="set-output"][data-output="mpv"]').click();
  await page.waitForFunction(() => document.querySelector('#output-button').title.includes('mpv') && !document.querySelector('#play-button').classList.contains('loading') && document.querySelector('#play-button').title === '暂停');
  await page.locator('#output-panel [data-action="output"]').click();
  await page.waitForTimeout(220);
  await begin('nativeTimePositionBurst');
  await application.evaluate(({ BrowserWindow }) => {
    const fixture = globalThis.renderFixture, content = BrowserWindow.getAllWindows().find(window => /\/ui\/index\.html(?:$|\?)/i.test(window.webContents.getURL().replaceAll('\\', '/'))).webContents;
    for (let index = 1; index <= 60; index++) {
      fixture.state = { ...fixture.state, time: 6 + index / 10 };
      content.send('music:event', { type: 'mpv', name: 'time-pos', state: fixture.state });
    }
  });
  await page.waitForFunction(() => document.querySelector('#current-time').textContent === '00:12');
  await finish('nativeTimePositionBurst', { nativeTick: true });
  assert.ok(Math.abs(await page.locator('#seek').evaluate(node => Number(node.value)) - 100 * 12 / 18) < .2, 'Native ticks must still update progress');
  report.nativeTicks = 60;
  await page.locator('#play-button').click();
  await page.waitForFunction(() => document.querySelector('#play-button').title === '播放');
  await page.locator('#output-button').click();
  await page.locator('[data-action="set-output"][data-output="browser"]').click();
  await page.waitForFunction(() => document.querySelector('#output-button').title.includes('内置') && document.querySelector('#audio').paused && document.querySelector('#audio').currentTime > 11);
  await page.locator('#output-panel [data-action="output"]').click();

  // These synthetic browser backdrops are only screenshot fixtures; capturePage
  // cannot capture Windows' native DWM Acrylic behind the application.
  report.screenshotBackdrop = 'Synthetic browser backdrop; not a Windows desktop capture';
  await page.evaluate(() => {
    const backdrop = document.createElement('div'); backdrop.id = 'rendering-backdrop'; backdrop.style.cssText = 'position:fixed;inset:0;z-index:-1;pointer-events:none;background:#ced6e0'; document.body.prepend(backdrop);
  });
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.locator('#rendering-backdrop').evaluate((node, scheme) => { node.style.background = scheme === 'light' ? '#ced6e0' : '#161d2b'; }, scheme);
    await page.evaluate(() => {
      for (const error of [false, true]) { const toast = document.createElement('div'); toast.id = error ? 'rendering-error-toast' : 'rendering-toast'; toast.className = error ? 'toast error' : 'toast'; toast.textContent = error ? '提示验证：这首歌播放失败，已跳过' : '提示验证：设置已保存'; document.querySelector('#toast-stack').append(toast); }
    });
    await page.waitForTimeout(100);
    report.panels[scheme] = await page.evaluate(() => {
      const selectors = ['#queue-panel', '#effects-panel', '#quality-panel', '#output-panel', '#lyrics-panel', '#login-modal', '#rendering-toast', '#rendering-error-toast'];
      return Object.fromEntries(selectors.map(selector => {
        const style = getComputedStyle(document.querySelector(selector));
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d'); context.fillStyle = style.backgroundColor; context.fillRect(0, 0, 1, 1);
        const pixel = [...context.getImageData(0, 0, 1, 1).data];
        return [selector, { background: style.backgroundColor, pixel, alpha: pixel[3] / 255, image: style.backgroundImage, blur: style.backdropFilter, opacity: style.opacity }];
      }));
    });
    if (!baseline) {
      for (const [selector, style] of Object.entries(report.panels[scheme])) {
        assert.equal(style.alpha, 1, `${scheme} ${selector}: floating surfaces must be fully opaque`);
        assert.equal(style.image, 'none', `${scheme} ${selector}: no translucent layered background`);
        assert.equal(style.blur, 'none', `${scheme} ${selector}: opaque floating surfaces need no backdrop blur`);
        assert.equal(style.opacity, '1', `${scheme} ${selector}: text must remain fully opaque`);
        if (!selector.includes('toast')) {
          // The dedicated lyrics canvas is defined by lyrics.css, loaded after
          // palette.css; its opaque listening surface has its own two colours.
          const expectedBackground = selector === '#lyrics-panel'
            ? (scheme === 'light' ? 'rgb(237, 241, 244)' : 'rgb(28, 38, 50)')
            : (scheme === 'light' ? 'rgb(237, 241, 246)' : 'rgb(43, 49, 60)');
          assert.equal(style.background, expectedBackground, `${scheme} ${selector}: expected canvas colour`);
        }
      }
    }
    await page.locator('#toast-stack').evaluate(node => node.replaceChildren());
    await page.locator('#main-content').evaluate(node => node.scrollTo({ top: 320, behavior: 'instant' }));
    const mainScrollBefore = await page.locator('#main-content').evaluate(node => node.scrollTop);
    await page.locator('#effects-button').click();
    await page.locator('#effects-panel').waitFor({ state: 'visible' });
    await page.locator('#lyrics-button').click();
    await page.locator('.lyric-line').first().waitFor();
    await page.waitForFunction(() => { const content = document.querySelector('#lyrics-content'); return content && content.scrollHeight > content.clientHeight && content.scrollTop > 50; });
    const effectsHiddenByLyrics = await page.locator('#effects-panel').evaluate(node => node.hidden);
    const mainScrollAfterLyrics = await page.locator('#main-content').evaluate(node => node.scrollTop);
    await page.locator('#lyrics-content').evaluate(node => node.scrollTo({ top: 100, behavior: 'instant' }));
    const mainScrollAfterManualLyrics = await page.locator('#main-content').evaluate(node => node.scrollTop);
    if (!baseline) {
      assert.equal(effectsHiddenByLyrics, true, 'Opening lyrics must close effects');
      assert.equal(mainScrollAfterLyrics, mainScrollBefore, 'Following an active lyric must not move the underlying song list');
      assert.equal(mainScrollAfterManualLyrics, mainScrollBefore, 'Scrolling lyrics must not move the underlying song list');
    }
    // Use the actual seek handler to advance to another lyric and restore the
    // application's normal following position after the manual scroll check.
    const restorePercent = scheme === 'light' ? 70 : 75;
    await page.locator('#seek').evaluate((node, value) => { node.value = String(value); node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true })); }, restorePercent);
    await page.waitForFunction(expected => { const content = document.querySelector('#lyrics-content'), active = content?.querySelector('.lyric-line.active'); return active?.dataset.lyricIndex === String(expected) && content.scrollTop > 500; }, Math.floor(restorePercent * 18 / 100 * 2));
    await page.waitForTimeout(500);
    if (!baseline) assert.equal(await page.locator('#main-content').evaluate(node => node.scrollTop), mainScrollBefore, 'Restoring lyric following must preserve the song-list position');
    await capture(`${scheme}-lyrics`);
    if (baseline && !effectsHiddenByLyrics) await page.locator('#effects-panel [data-action="effects"]').click();
    await page.locator('#effects-button').click();
    const lyricsHiddenByEffects = await page.locator('#lyrics-panel').evaluate(node => node.hidden);
    if (!baseline) assert.equal(lyricsHiddenByEffects, true, 'Opening effects must close lyrics');
    report.panels[scheme].interactions = { effectsHiddenByLyrics, lyricsHiddenByEffects, mainScrollBefore, mainScrollAfterLyrics, mainScrollAfterManualLyrics };
    await capture(`${scheme}-effects`);
    await page.locator('#effects-panel [data-action="effects"]').click();
  }
  await page.locator('#top-login').click();
  await page.locator('.account-modal-content').waitFor();
  assert.equal(await page.locator('#login-modal').evaluate(node => getComputedStyle(node).opacity), '1');
  await page.locator('[data-action="logout"]').click();
  await page.locator('#top-login').click();
  await page.locator('#qr-frame img').waitFor();
  await capture('dark-login');
  assert.deepEqual(report.rendererErrors, []);
  report.success = true;
  fs.writeFileSync(path.join(dataDir, 'results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ version: report.version, baseline, measurements: report.measurements, opaquePanels: baseline ? 'MEASURED' : 'PASS', schemes: Object.keys(report.panels), nativeTicks: report.nativeTicks, rendererErrors: report.rendererErrors, screenshots: report.screenshots.length }));
  await application.close(); application = null;
})().catch(async error => {
  console.error(error.stack);
  report.success = false;
  report.error = { message: error.message, stack: error.stack };
  if (page && !page.isClosed()) {
    report.failure = await page.evaluate(() => ({ title: document.querySelector('#player-title').textContent, button: document.querySelector('#play-button').title, rows: document.querySelectorAll('.track-row').length, queueRows: document.querySelectorAll('#queue-content .queue-row').length, output: document.querySelector('#output-button').title, currentTime: document.querySelector('#current-time').textContent })).catch(() => ({}));
    await capture('failure').catch(() => {});
  }
  fs.writeFileSync(path.join(dataDir, 'results.json'), JSON.stringify(report, null, 2));
  console.error(JSON.stringify({ measurements: report.measurements, failure: report.failure, rendererErrors: report.rendererErrors }));
  await application?.close().catch(() => {}); process.exitCode = 1;
});
