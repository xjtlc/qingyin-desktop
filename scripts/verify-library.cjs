'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron } = require('./test-deps.cjs').loadTestDependency('playwright');
const root = path.join(__dirname, '..');
const version = require('../package.json').version;
const dataDir = path.join(root, 'test-output', `library-verification-${process.argv[2] ? 'packaged' : 'source'}`);
fs.mkdirSync(dataDir, { recursive: true });
const sentinel = { hash: 'saved-library-song', title: '保留的本机收藏', artist: '验证', duration: 180 };
fs.writeFileSync(path.join(dataDir, 'preferences.json'), JSON.stringify({ preferences: { volume: 0 }, sort: { field: 'default', direction: 'asc', updatedAt: Date.now() }, favorites: [sentinel], history: [sentinel] }));
fs.writeFileSync(path.join(dataDir, 'library.json'), '[]');
let application, page;
const errors = [], results = {};
const env = { ...process.env, QINGYIN_TEST: '1', QINGYIN_TEST_DATA: dataDir };
delete env.ELECTRON_RUN_AS_NODE;
delete env.QINGYIN_TEST_ACCOUNT_READONLY;
async function poll(read, predicate, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Verification polling timed out');
}
async function launch() {
  application = await _electron.launch({ executablePath: process.argv[2] || require('electron'), args: process.argv[2] ? [] : [root], cwd: root, env, timeout: 30000 });
  page = await application.firstWindow();
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false));
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => typeof window.music?.invoke === 'function');
  // Replace only the API of this isolated fixture process. Store IPC and disk writes
  // remain real, and the production account and profile are never used.
  await application.evaluate(({ ipcMain }) => {
    globalThis.fixtureLoggedIn = true;
    globalThis.fixturePages = [];
    const songs = Array.from({ length: 434 }, (_, index) => ({ hash: `fixture-${index}`, albumAudioId: index, title: `验证歌曲 ${String(index + 1).padStart(3, '0')}`, artist: index % 2 ? '暮色乐队' : '青音合奏', album: '日常片刻', duration: 180 + index % 45 }));
    songs[299] = { ...songs[9] };
    ipcMain.removeHandler('music:api');
    ipcMain.handle('music:api', async (_event, method, params = {}) => {
      let data = {};
      if (method === 'status') data = { loggedIn: globalThis.fixtureLoggedIn, user: globalThis.fixtureLoggedIn ? { id: 'fixture', name: '验证账号' } : null, platform: 'lite' };
      else if (method === 'recommendations') data = { playlists: [{ id: 'one', title: '安静的日常', count: 42 }, { id: 'two', title: '夜晚慢慢听', count: 36 }, { id: 'three', title: '沿着风的方向', count: 28 }, { id: 'four', title: '旧时光里的声音', count: 51 }], songs: songs.slice(0, 4) };
      else if (method === 'search') data = { songs: songs.slice(0, 2), total: 2 };
      else if (method === 'playlists') data = { playlists: [{ id: 'liked', title: '我喜欢', count: 434, private: true }, { id: 'night', title: '夜晚慢慢听', count: 434, private: true }], total: 2, hasMore: false };
      else if (method === 'playlistSongs') {
        const page = Number(params.page) || 1, pageSize = 300;
        globalThis.fixturePages.push(page);
        if (page === 2) await new Promise(resolve => setTimeout(resolve, 250));
        const offset = (page - 1) * pageSize;
        const rows = songs.slice(offset, offset + pageSize).map((song, index) => ({ ...song, playlistEntryId: `private:liked:${offset + index}`, playlistPosition: offset + index }));
        data = { songs: rows, total: 434, sourceTotal: 434, totalReported: true, totalReliable: true, sourcePage: page, page, pageSize, offset, rawCount: rows.length, hasMore: page === 1, nextPage: page === 1 ? 2 : null, nextOffset: page === 1 ? 300 : null };
      } else if (method === 'logout') { globalThis.fixtureLoggedIn = false; data = { loggedIn: false }; }
      else if (method === 'qrStart') data = { key: 'fixture-qr', image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', expiresIn: 180 };
      else if (method === 'qrCheck') { globalThis.fixtureLoggedIn = true; data = { status: 'success', user: { id: 'fixture', name: '验证账号' } }; }
      else if (method === 'songQualities') data = { tiers: [{ id: 'auto', label: '自动（最高可播放）', group: 'auto', available: true, reason: 'AUTO' }, { id: 'lossless', label: '无损音质', group: 'standard', available: true, offered: true, reason: 'OK' }] };
      return { ok: true, data };
    });
  });
  await page.reload();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-action="account"]')].some(node => node.textContent.includes('验证账号')));
}
async function openPlaylist() {
  await page.locator('[data-view="playlists"]').click();
  await page.locator('.playlist-card').filter({ hasText: '我喜欢' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.track-row').length === 434 && document.querySelector('[data-action="play-all"]')?.disabled === false);
  assert.equal(await page.locator('.track-row').count(), 434);
  assert.equal(await page.locator('[data-action="play-all"]').isEnabled(), true);
  assert.equal(await page.locator('[data-action="enqueue-all"]').isEnabled(), true);
}
async function screenshot(name) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const png = await application.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'));
  fs.writeFileSync(path.join(dataDir, `${name}-${version}.png`), Buffer.from(png, 'base64'));
}
(async () => {
  await launch();
  console.log('Fixture launched');
  await screenshot('home');
  await openPlaylist();
  console.log('All playlist pages loaded');
  assert.deepEqual(await application.evaluate(() => globalThis.fixturePages), [1, 2]);
  const keys = await page.locator('.track-title[data-action="play-song"]').evaluateAll(nodes => nodes.map(node => node.dataset.key));
  assert.equal(new Set(keys).size, 434);
  assert.equal(await page.locator('.track-title').filter({ hasText: /^验证歌曲 010$/ }).count(), 2);
  await page.locator('[data-action="sort-direction"]').click();
  assert.equal((await page.locator('.track-title').first().textContent()).trim(), '验证歌曲 434');
  assert.equal((await page.locator('.track-index').first().textContent()).trim(), '01');
  await screenshot('playlist');
  await page.locator('[data-action="enqueue-all"]').click();
  assert.equal(await page.locator('#queue-size').textContent(), '434');
  await page.locator('#queue-button').click();
  assert.equal(await page.locator('#queue-content .queue-row').count(), 434);
  await screenshot('queue');
  await page.locator('#queue-panel [data-action="queue"]').click();
  await page.locator('#quality-tag').click();
  await screenshot('quality');
  await page.locator('#quality-panel [data-action="quality"]').click();
  // Close directly after the final direction click, without waiting for the save.
  await page.evaluate(() => { document.querySelector('[data-action="sort-direction"]').click(); document.querySelector('[data-action="sort-direction"]').click(); document.querySelector('[data-window="close"]').click(); });
  await application.waitForEvent('close', { timeout: 10000 }); application = null;
  console.log('Immediate close completed');
  const stored = JSON.parse(fs.readFileSync(path.join(dataDir, 'preferences.json'), 'utf8'));
  assert.equal(stored.sort.direction, 'desc');
  assert.equal(stored.favorites[0].hash, sentinel.hash);
  assert.equal(stored.history[0].hash, sentinel.hash);
  results.fullPlaylistAndQueue = 434; results.immediateCloseSavedDirection = stored.sort.direction;
  await launch();
  console.log('Restart completed');
  await openPlaylist();
  assert.equal((await page.locator('.track-title').first().textContent()).trim(), '验证歌曲 434');
  results.restartRemembered = true;
  await page.locator('[data-action="account"]').first().click();
  await screenshot('account');
  await page.locator('[data-action="logout"]').click();
  assert.equal(await page.locator('.track-row').count(), 0);
  await page.locator('[data-action="account"]').first().click();
  await page.waitForFunction(() => document.querySelector('#modal-layer').hidden, { timeout: 10000 });
  await openPlaylist();
  assert.equal((await page.locator('.track-title').first().textContent()).trim(), '验证歌曲 434');
  results.reloginRemembered = true;
  console.log('Relogin completed');
  // Delay startup hydration, then change direction before the saved data arrives.
  await application.evaluate(({ ipcMain }) => {
    const original = ipcMain._invokeHandlers.get('music:store-get');
    globalThis.fixtureHydrated = false;
    ipcMain.removeHandler('music:store-get');
    ipcMain.handle('music:store-get', async (...args) => { await new Promise(resolve => setTimeout(resolve, 4000)); globalThis.fixtureHydrated = true; return original(...args); });
  });
  await page.reload();
  await page.locator('#search-input').fill('验证');
  await page.locator('#search-input').press('Enter');
  await page.locator('[data-action="sort-direction"]').waitFor();
  assert.equal(await application.evaluate(() => globalThis.fixtureHydrated), false);
  await page.locator('[data-action="sort-direction"]').click();
  await poll(() => page.evaluate(() => window.music.store.get()), value => value.sort?.direction === 'desc');
  const hydrated = await page.evaluate(() => window.music.store.get());
  assert.equal(hydrated.favorites[0].hash, sentinel.hash);
  assert.equal(hydrated.history[0].hash, sentinel.hash);
  results.startupInteractionPreservedLibrary = true;
  assert.deepEqual(errors, []);
  results.rendererErrors = errors;
  fs.writeFileSync(path.join(dataDir, 'result.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
  await application.close(); application = null;
})().catch(async error => { console.error(error); if (page && !page.isClosed()) await screenshot('failure').catch(() => {}); if (application) await application.close().catch(() => {}); process.exitCode = 1; });
