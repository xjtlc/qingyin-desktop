'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron } = require('./test-deps.cjs').loadTestDependency('playwright');
const root = path.resolve(__dirname, '..');
const version = require('../package.json').version;
const output = path.join(root, 'test-output', `playlist-recovery-${version}`);
fs.mkdirSync(output, { recursive: true });

// This bootstrap replaces the adapter before main.cjs is loaded. No real account
// is read, and both Node and Chromium HTTP requests are blocked in the fixture.
const image = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#7a9ab9"/><circle cx="50" cy="50" r="30" fill="#e5edf6"/></svg>').toString('base64');
const fixture = { image, expired: true, mode: 'auth', calls: [], network: [] };
function fixtureResponse(method, params = {}) {
  const state = globalThis.playlistRecoveryFixture;
  state.calls.push({ method, page: params.page ?? null, listId: params.listId ?? params.id ?? null });
  const playlist = (id, title, count) => ({ id, listId: id, title, count, cover: state.image, private: true });
  const playlists = [playlist('likes', '我喜欢', 4), playlist('evening', '晚风歌单', 1), playlist('travel', '路上听', 1)];
  let data = {};
  if (method === 'status') data = { loggedIn: true, user: { id: 'fixture', name: state.expired ? '待续期账号' : '恢复后的账号', avatar: state.image }, platform: 'lite' };
  else if (method === 'recommendations') data = { playlists: [], songs: [] };
  else if (method === 'playlists') {
    if (state.mode === 'network') return { ok: false, code: 'NETWORK_ERROR', error: '暂时无法连接酷狗服务，请检查网络或稍后重试' };
    if (state.expired) return { ok: false, code: 'LOGIN_REQUIRED', error: '登录已失效，请使用酷狗概念版 App 扫码重新登录' };
    const page = Number(params.page) || 1;
    data = { playlists: page === 1 ? playlists.slice(0, 2) : playlists.slice(2), total: 3, hasMore: page === 1, nextPage: page === 1 ? 2 : null };
  } else if (method === 'playlistSongs') {
    const page = Number(params.page) || 1;
    const songs = [1, 2, 3, 4].map(index => ({ hash: `recovery-${index}`, albumAudioId: index, title: `喜欢的歌 ${index}`, artist: '隔离验证', album: '恢复歌单', duration: 180, cover: state.image, playlistEntryId: `likes:${index}` }));
    data = { songs: page === 1 ? songs.slice(0, 2) : songs.slice(2), total: 4, sourceTotal: 4, totalReliable: true, totalReported: true, sourcePage: page, page, pageSize: 2, rawCount: 2, hasMore: page === 1, nextPage: page === 1 ? 2 : null };
  } else if (method === 'qrStart') data = { key: 'isolated-fixture-key', image: state.image, expiresIn: 180 };
  else if (method === 'qrCheck') { state.expired = false; data = { status: 'success', user: { id: 'fixture', name: '恢复后的账号' } }; }
  else if (method === 'songQualities') data = { tiers: [] };
  return { ok: true, data };
}
const bootstrap = path.join(output, 'fixture-bootstrap.cjs');
fs.writeFileSync(bootstrap, `const path = require('node:path');
const root = ${JSON.stringify(root)};
globalThis.playlistRecoveryFixture = ${JSON.stringify(fixture)};
for (const name of ['http', 'https']) {
  const network = require('node:' + name);
  network.get = network.request = () => { globalThis.playlistRecoveryFixture.network.push('Node external request blocked'); throw new Error('External network is disabled in playlist recovery verification'); };
}
const { app, session } = require('electron');
app.whenReady().then(() => session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, done) => { globalThis.playlistRecoveryFixture.network.push('Chromium external request blocked'); done({ cancel: true }); }));
const file = path.join(root, 'lib', 'kugou.cjs');
require.cache[require.resolve(file)] = { id: file, filename: file, loaded: true, exports: { createKugouAdapter: () => ({ invoke: async (method, params) => (${fixtureResponse.toString()})(method, params) }) } };
require(path.join(root, 'main.cjs'));
`);
fs.writeFileSync(path.join(output, 'preferences.json'), JSON.stringify({ preferences: { volume: 0, output: 'browser', taskbarLyricsEnabled: false }, favorites: [], history: [] }));
const env = { ...process.env, QINGYIN_TEST: '1', QINGYIN_TEST_DATA: output };
delete env.ELECTRON_RUN_AS_NODE;
delete env.QINGYIN_TEST_ACCOUNT_READONLY;
let application, page;
const report = { version, fixture: 'isolated profile, fake account and QR confirmation; no production account or external network', checks: [], screenshots: [], rendererErrors: [] };
async function capture(name) {
  const destination = path.join(output, `${name}.png`);
  const png = await application.evaluate(async ({ BrowserWindow }) => Promise.race([
    BrowserWindow.getAllWindows().find(window => /\/ui\/index\.html(?:$|\?)/i.test(window.webContents.getURL().replaceAll('\\', '/'))).capturePage().then(image => image.toPNG().toString('base64')),
    new Promise(resolve => setTimeout(() => resolve(null), 2000)),
  ]));
  if (!png) return;
  fs.writeFileSync(destination, Buffer.from(png, 'base64'));
  report.screenshots.push(destination);
}
async function callCount(method) {
  return application.evaluate((_electron, method) => globalThis.playlistRecoveryFixture.calls.filter(call => call.method === method).length, method);
}
(async () => {
  try {
    application = await _electron.launch({ executablePath: require('electron'), args: [bootstrap], cwd: root, env, timeout: 30000 });
    await application.firstWindow();
    const deadline = Date.now() + 10000;
    while (!page && Date.now() < deadline) {
      page = application.windows().find(window => /\/ui\/index\.html(?:$|\?)/i.test(window.url().replaceAll('\\', '/')));
      if (!page) await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(page, 'The main player page must be selected instead of the optional taskbar-lyrics window');
    page.on('pageerror', error => report.rendererErrors.push(error.message));
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => /\/ui\/index\.html(?:$|\?)/i.test(window.webContents.getURL().replaceAll('\\', '/'))).webContents.setBackgroundThrottling(false));
    await page.waitForFunction(() => document.querySelector('#sidebar-account')?.textContent.includes('待续期账号'), null, { polling: 100 });
    await page.locator('[data-view="playlists"]').click();
    const auth = page.locator('#main-content .error-card');
    await auth.locator('[data-action="reauth"]').waitFor();
    assert.match(await auth.innerText(), /扫码登录/);
    assert.equal(await auth.locator('[data-action="refresh-playlists"]').count(), 0);
    assert.match(await page.locator('#sidebar-account').innerText(), /待续期账号/);
    await capture('expired-session');
    report.checks.push('expired session keeps the account avatar and offers QR login');

    await auth.locator('[data-action="reauth"]').click();
    await page.locator('#qr-frame img').waitFor();
    assert.match(await page.locator('#qr-status').innerText(), /酷狗概念版 App 扫码登录/);
    await page.waitForFunction(() => document.querySelector('#modal-layer').hidden && document.querySelector('#sidebar-account').textContent.includes('恢复后的账号'), null, { timeout: 12000, polling: 100 });
    await page.waitForFunction(() => document.querySelectorAll('#main-content .playlist-card').length === 2, null, { polling: 100 });
    assert.equal(await page.locator('#main-content .error-card').count(), 0);
    assert.ok(await callCount('qrCheck') >= 1);
    assert.ok(await callCount('playlists') >= 2);
    report.checks.push('QR confirmation automatically reloads account playlists');
    await page.locator('[data-action="more-playlists"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#main-content .playlist-card').length === 3, null, { polling: 100 });
    assert.equal(await page.locator('[data-action="more-playlists"]').count(), 0);
    assert.match(await page.locator('#main-content').innerText(), /我喜欢/);
    assert.match(await page.locator('#main-content').innerText(), /路上听/);
    await capture('restored-playlists');
    report.checks.push('subsequent playlist page appends all three playlists');

    await page.locator('.playlist-card').filter({ has: page.locator('.playlist-title', { hasText: '我喜欢' }) }).click();
    await page.waitForFunction(() => document.querySelectorAll('#main-content .track-row').length === 4, null, { polling: 100 });
    assert.match(await page.locator('#main-content').innerText(), /喜欢的歌 4/);
    assert.equal(await page.locator('#main-content .error-card').count(), 0);
    const detailPages = await application.evaluate(() => globalThis.playlistRecoveryFixture.calls.filter(call => call.method === 'playlistSongs').map(call => call.page));
    assert.deepEqual(detailPages, [1, 2]);
    await capture('restored-likes-all-pages');
    report.checks.push('liked songs automatically load both pages after reauthentication');

    await page.locator('[data-view="playlists"]').click();
    await application.evaluate(() => { globalThis.playlistRecoveryFixture.mode = 'network'; });
    await page.locator('[data-action="refresh-playlists"]').first().click();
    const network = page.locator('#main-content .error-card');
    await network.locator('[data-action="refresh-playlists"]').waitFor();
    assert.match(await network.innerText(), /重新加载/);
    assert.equal(await network.locator('[data-action="reauth"]').count(), 0);
    assert.equal(await page.locator('#modal-layer').isVisible(), false);
    const qrStarts = await callCount('qrStart');
    await capture('temporary-network-error');
    await application.evaluate(() => { globalThis.playlistRecoveryFixture.mode = 'auth'; });
    await network.locator('[data-action="refresh-playlists"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#main-content .playlist-card').length === 2, null, { polling: 100 });
    assert.equal(await callCount('qrStart'), qrStarts);
    assert.equal(await page.locator('#main-content .error-card').count(), 0);
    report.checks.push('network errors offer retry and recover without forcing QR login');
    report.calls = await application.evaluate(() => globalThis.playlistRecoveryFixture.calls);
    report.network = await application.evaluate(() => globalThis.playlistRecoveryFixture.network);
    assert.deepEqual(report.network, []);
    assert.deepEqual(report.rendererErrors, []);
    report.success = true;
    console.log(JSON.stringify({ version, success: true, checks: report.checks, externalRequests: report.network.length, rendererErrors: report.rendererErrors, output }, null, 2));
  } catch (error) {
    report.error = error.message;
    if (page) report.lastVisibleText = await page.locator('body').innerText().catch(() => 'Renderer unavailable');
    if (application) report.calls = await application.evaluate(() => globalThis.playlistRecoveryFixture.calls).catch(() => []);
    throw error;
  } finally {
    if (application) await application.close();
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
