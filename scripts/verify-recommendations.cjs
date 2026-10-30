'use strict';

// Run against source or a packaged executable with a completely isolated profile.
// The fake account never reads production credentials and playback is a silent WAV.
// Usage: node scripts/verify-recommendations.cjs [path/to/QingyinConcept.exe]
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { loadTestDependency } = require('./test-deps.cjs');
const { _electron } = loadTestDependency('playwright');
const root = path.resolve(__dirname, '..');
const executable = process.argv[2];
const layoutOnly = process.env.QINGYIN_VERIFY_LAYOUT_ONLY === '1';
const output = path.join(root, 'test-output', 'recommendations-preview-0.1.42', `${executable ? 'packaged' : 'source'}${layoutOnly ? '-layout' : ''}`);
const profile = path.join(output, 'isolated-data');
fs.mkdirSync(profile, { recursive: true });
const report = {
  version: require('../package.json').version, mode: executable ? 'packaged' : 'source',
  fixture: 'Only synthetic accounts and local silent WAV playback at volume zero. Production credentials, playlists, and preferences are not read or written.',
  screenshotBackdrop: 'Synthetic browser backdrop; capturePage does not include Windows DWM material.',
  checks: {}, screenshots: [], rendererErrors: [], remoteRendererRequests: [],
};
let application, page;

function createSilentWav(destination) {
  const rate = 48000, size = rate * 90 * 4, wav = Buffer.alloc(44 + size);
  wav.write('RIFF'); wav.writeUInt32LE(36 + size, 4); wav.write('WAVE', 8);
  wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(size, 40); fs.writeFileSync(destination, wav);
}
function artwork(top, bottom) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><defs><linearGradient id="a" x2="0" y2="1"><stop stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs><rect width="400" height="400" fill="url(#a)"/><circle cx="245" cy="145" r="90" fill="#f1ede7" opacity=".35"/><path d="M0 250Q130 195 215 280T400 240V400H0" fill="#d2e0e6" opacity=".7"/><path d="M0 300Q150 225 280 310T400 300V400H0" fill="#f0f2f1" opacity=".55"/></svg>`;
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}
function makeFixture() {
  const wav = path.join(profile, '推荐验收静音.wav'); createSilentWav(wav);
  const id = crypto.createHash('sha256').update(path.resolve(wav).toLowerCase()).digest('hex').slice(0, 24);
  fs.writeFileSync(path.join(profile, 'library.json'), JSON.stringify([{ path: wav }]));
  const stamp = new Date(), date = `${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, '0')}-${String(stamp.getDate()).padStart(2, '0')}`;
  fs.writeFileSync(path.join(profile, 'preferences.json'), JSON.stringify({
    preferences: { volume: 0, output: 'browser', quality: 'auto', effects: 'off', shuffle: false, repeat: 'all' },
    favorites: [], history: [], sort: { field: 'title', direction: 'desc' },
    // A legacy public-playlist cache from 0.1.41 must not pass as account daily recommendations.
    dailyRecommendations: { date, songs: [{ hash: 'legacy-public', title: '旧公开歌单缓存', artist: '隔离验收', duration: 90 }] },
  }));
  const cover = artwork('#527483', '#b9b7a8'), derivedCover = artwork('#7c797b', '#ccaca4');
  const songs = (prefix, names) => names.map((title, index) => ({
    hash: `${prefix}-${index}`, title, artist: '青音合奏', album: '隔离验收专辑', cover: index === 1 ? derivedCover : cover,
    albumAudioId: index + 1, duration: 90,
  }));
  return {
    accountId: 'recommendation-fixture-A', loggedIn: true, modes: { dailyRecommendations: 'songs', guessYouLike: 'songs' },
    date, url: `qingyin-audio://track/${id}`, calls: [], batch: 0, holdGuess: false, qrSuccess: true,
    daily: songs('daily', ['晚风来信', '晨光里的你', '把旋律留给今天']),
    guesses: [songs('guess-1', ['云端漫步', '春日序曲', '安静的海']), songs('guess-2', ['未读的信', '落日之后'])],
    dailyB: songs('daily-B', ['新账号的每日旋律', '重新出发']),
    guessB: songs('guess-B', ['新账号的合拍歌曲', '下一站音乐']),
    search: songs('search', ['搜索验收歌曲']),
    cover, derivedCover,
    playlists: [
      { id: 'fixture-default', listId: 'fixture-default', type: 0, title: '默认收藏', count: 0, private: true },
      { id: 'fixture-liked', listId: 'fixture-liked', type: 0, title: '我喜欢', count: 2, private: true },
      { id: 'fixture-real', listId: 'fixture-real', type: 0, title: '有平台封面的歌单', count: 0, private: true, cover },
      { id: 'fixture-derived', listId: 'fixture-derived', type: 0, title: '从歌曲补封面的歌单', count: 1, private: true },
    ],
  };
}

async function fixtureResponse(method, params = {}) {
  const fixture = globalThis.recommendationsFixture;
  fixture.calls.push({ method, params: { ...params } });
  let data = {};
  if (method === 'status') data = { loggedIn: fixture.loggedIn, user: fixture.loggedIn ? { id: fixture.accountId, name: '推荐隔离验收' } : null, platform: 'lite' };
  else if (method === 'recommendations') data = { playlists: [], songs: [] };
  else if (method === 'playlists') data = { playlists: fixture.playlists, total: fixture.playlists.length, hasMore: false };
  else if (method === 'playlistSongs') {
    const list = String(params.listId || params.id);
    const songs = list === 'fixture-derived' ? [{ ...fixture.search[0], cover: fixture.derivedCover }] : list === 'fixture-liked' ? fixture.daily.slice(0, 2).map(song => ({ ...song, cover: '' })) : [];
    data = { songs, total: songs.length, sourceTotal: songs.length, totalReliable: true, totalReported: true, page: 1, pageSize: params.pageSize || 300, rawCount: songs.length, hasMore: false };
  } else if (method === 'dailyRecommendations' || method === 'guessYouLike') {
    if (!fixture.loggedIn) return { ok: false, code: 'LOGIN_REQUIRED', error: '请先登录酷狗概念版账号。' };
    const mode = fixture.modes[method], accountId = fixture.accountId;
    if (mode === 'error') return { ok: false, code: 'REQUEST_FAILED', error: '隔离验收：推荐服务暂时未响应' };
    if (mode === 'expired') return { ok: false, code: 'LOGIN_REQUIRED', error: '隔离验收：账号已过期，请重新扫码登录' };
    if (mode === 'service-empty') return { ok: false, code: 'RECOMMENDATIONS_EMPTY', error: '酷狗暂未返回推荐歌曲' };
    const isB = accountId.endsWith('-B');
    const songs = mode === 'empty' ? [] : method === 'dailyRecommendations' ? (isB ? fixture.dailyB : fixture.daily) : isB ? fixture.guessB : fixture.guesses[fixture.batch++ % fixture.guesses.length];
    data = { songs, date: fixture.date, source: method === 'dailyRecommendations' ? 'kugou-daily' : 'kugou-personal-fm', accountId };
    if (method === 'guessYouLike' && fixture.holdGuess) {
      await new Promise(resolve => { globalThis.releaseRecommendationFixture = resolve; });
      globalThis.releaseRecommendationFixture = null;
    }
  } else if (method === 'songUrl') data = { url: fixture.url, duration: 90, preview: false, quality: { format: 'wav', bitDepth: 16, sampleRateHz: 48000, label: 'WAV 无损', streamVerified: true } };
  else if (method === 'songQualities') data = { tiers: [{ id: 'auto', label: '自动（最高可播放）', group: 'auto', selectable: true }] };
  else if (method === 'lyrics') data = { text: '' };
  else if (method === 'search') data = { songs: fixture.search, total: 1, page: 1 };
  else if (method === 'logout') { fixture.loggedIn = false; data = { loggedIn: false }; }
  else if (method === 'qrStart') data = { key: 'synthetic-qr', image: fixture.cover, expiresAt: Date.now() + 180000 };
  else if (method === 'qrCheck') {
    if (fixture.qrSuccess) { fixture.loggedIn = true; fixture.accountId = 'recommendation-fixture-B'; data = { status: 'success', user: { id: fixture.accountId, name: '推荐隔离验收' } }; }
    else data = { status: 'waiting' };
  }
  return { ok: true, data };
}

async function setFixture(values) {
  await application.evaluate((_electron, values) => Object.assign(globalThis.recommendationsFixture, values), values);
}
async function callCount(method) {
  return application.evaluate((_electron, method) => globalThis.recommendationsFixture.calls.filter(call => call.method === method).length, method);
}
async function waitSongs(songs) {
  const expected = songs.map(song => song.title);
  await page.waitForFunction(expected => JSON.stringify([...document.querySelectorAll('#main-content .track-row .track-title')].map(node => node.textContent)) === JSON.stringify(expected), expected, { timeout: 15000 });
}
async function queueTitles() {
  if (!(await page.locator('#queue-panel').isVisible())) await page.locator('#queue-button').click();
  return page.locator('#queue-content .track-title').allTextContents();
}
async function closeQueue() { if (await page.locator('#queue-panel').isVisible()) await page.locator('#queue-panel [data-action="queue"]').click(); }
async function waitPlaying(title) {
  await page.waitForFunction(title => {
    const audio = document.querySelector('#audio');
    return document.querySelector('#player-title').textContent === title && !audio.paused && audio.readyState >= 3 && audio.currentTime > .05 && !document.querySelector('#play-button').classList.contains('loading');
  }, title, { timeout: 15000 });
  await page.locator('#play-button').click();
  await page.waitForFunction(() => document.querySelector('#audio').paused);
}
async function capture(name) {
  // Electron can report the new media query before its compositor has painted
  // the theme. Let the 160-180 ms control transitions reach a rendered frame.
  await page.waitForTimeout(300);
  await page.evaluate(async () => {
    // Theme changes transition control colors; a screenshot taken in the first
    // frame would mix the old text colors with the newly applied glass backdrop.
    const transitions = document.getAnimations().filter(animation => animation.constructor.name === 'CSSTransition');
    await Promise.all(transitions.map(animation => animation.finished.catch(() => {})));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const themeColor = await page.evaluate(() => {
    const title = document.querySelector('#main-content .track-row:not(.current) .track-title');
    if (!title || !matchMedia('(prefers-color-scheme:dark)').matches) return null;
    const probe = document.createElement('span'); probe.style.cssText = 'position:absolute;visibility:hidden;color:var(--p-text)';
    document.body.append(probe);
    const result = { title: getComputedStyle(title).color, expected: getComputedStyle(probe).color };
    probe.remove(); return result;
  });
  if (themeColor) {
    assert.equal(themeColor.title, themeColor.expected, `${name}: dark song titles must use the completed dark text color`);
    report.themeColors ||= {}; report.themeColors[name] = themeColor;
  }
  const png = await application.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'));
  const destination = path.join(output, `${name}.png`); fs.writeFileSync(destination, Buffer.from(png, 'base64')); report.screenshots.push(destination);
}
async function checkLayout(label) {
  const layout = await page.evaluate(() => {
    const repeat = document.querySelector('#repeat-button').getBoundingClientRect(), quality = document.querySelector('#quality-tag').getBoundingClientRect();
    const box = rect => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });
    return {
      viewport: [innerWidth, innerHeight], documentWidth: document.documentElement.scrollWidth,
      main: { width: document.querySelector('#main-content').clientWidth, scrollWidth: document.querySelector('#main-content').scrollWidth },
      unloadedCovers: [...document.querySelectorAll('.playlist-cover img')].filter(node => !node.complete || !node.naturalWidth).length,
      footerControls: { repeat: box(repeat), quality: box(quality), intersect: Math.min(repeat.right, quality.right) - Math.max(repeat.left, quality.left) > 1 && Math.min(repeat.bottom, quality.bottom) - Math.max(repeat.top, quality.top) > 1 },
    };
  });
  assert.ok(layout.documentWidth <= layout.viewport[0] + 1, `${label}: document must not overflow horizontally`);
  assert.ok(layout.main.scrollWidth <= layout.main.width + 1, `${label}: music pane must not overflow horizontally`);
  assert.equal(layout.unloadedCovers, 0, `${label}: every visible playlist cover must load`);
  assert.equal(layout.footerControls.intersect, false, `${label}: repeat control and quality label must not overlap`);
  report.checks[label] = layout;
}

(async () => {
  const fixture = makeFixture();
  const bootstrap = path.join(profile, 'fixture-bootstrap.cjs');
  fs.writeFileSync(bootstrap, `const path=require('node:path');\nconst root=${JSON.stringify(root)};\nglobalThis.recommendationsFixture=${JSON.stringify(fixture)};\nconst file=path.join(root,'lib','kugou.cjs');\nrequire.cache[require.resolve(file)]={id:file,filename:file,loaded:true,exports:{createKugouAdapter:()=>({invoke:async(method,params)=>(${fixtureResponse.toString()})(method,params)})}};\nrequire(path.join(root,'main.cjs'));\n`);
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
      globalThis.recommendationsFixture = data.fixture;
      const invoke = new Function('method', 'params', `return (${data.functionText})(method,params);`);
      ipcMain.removeHandler('music:api'); ipcMain.handle('music:api', (_event, method, params) => invoke(method, params));
    }, { fixture, functionText: fixtureResponse.toString() });
    await page.reload();
  }
  await page.waitForFunction(() => document.querySelector('#sidebar-account').textContent.includes('推荐隔离验收'));
  await page.evaluate(() => {
    const backdrop = document.createElement('div'); backdrop.id = 'recommendation-test-backdrop';
    backdrop.style.cssText = 'position:fixed;inset:0;z-index:-1;pointer-events:none;background:#d0d7df'; document.body.prepend(backdrop);
  });
  await page.emulateMedia({ colorScheme: 'light' });
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 1000));
  assert.equal(await page.locator('.sidebar [data-view="guess"]').textContent(), '猜你喜欢');
  assert.equal(await page.locator('.sidebar [data-view="search"]').count(), 0);
  assert.equal(await page.locator('.sidebar-footnote').count(), 0);
  assert.ok((await page.locator('#search-input').getAttribute('placeholder')).includes('搜索'));
  report.checks.navigationAndFooter = 'PASS';

  if (layoutOnly) {
    await page.locator('[data-view="guess"]').click(); await waitSongs(fixture.guesses[0]);
    await page.locator('#main-content [data-action="play-all"]').click(); await waitPlaying(fixture.guesses[0][0].title);
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.locator('#recommendation-test-backdrop').evaluate((node, scheme) => { node.style.background = scheme === 'light' ? '#d0d7df' : '#141b29'; }, scheme);
      await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(920, 600));
      await checkLayout(`${scheme}FooterMinimum`); await capture(`${scheme}-guess-920x600`);
    }
    assert.deepEqual(report.rendererErrors, []); assert.deepEqual(report.remoteRendererRequests, []);
    report.status = 'PASS'; return;
  }

  await page.locator('[data-view="playlists"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.playlist-card').length === 4);
  await page.waitForFunction(() => [...document.querySelectorAll('.playlist-cover img')].length === 4 && [...document.querySelectorAll('.playlist-cover img')].every(node => node.complete && node.naturalWidth));
  await page.waitForFunction(source => [...document.querySelectorAll('.playlist-card')].find(node => node.textContent.includes('从歌曲补封面的歌单'))?.querySelector('.playlist-cover img')?.getAttribute('src') === source, fixture.derivedCover);
  const card = title => page.locator('.playlist-card').filter({ hasText: title });
  const collection = await card('默认收藏').locator('.playlist-cover img').getAttribute('src');
  const favorite = await card('我喜欢').locator('.playlist-cover img').getAttribute('src');
  assert.ok(collection.startsWith('data:image/svg+xml;'), 'An empty default collection needs designed artwork');
  assert.ok(favorite.startsWith('data:image/svg+xml;'), 'A favorite playlist without source art needs designed artwork');
  assert.notEqual(collection, favorite, 'Collection and favorite art must be visually distinct');
  assert.equal(await card('默认收藏').locator('img').getAttribute('data-playlist-art'), 'collection');
  assert.equal(await card('我喜欢').locator('img').getAttribute('data-playlist-art'), 'favorite');
  assert.equal(await card('有平台封面的歌单').locator('.playlist-cover img').getAttribute('src'), fixture.cover, 'Platform playlist artwork takes precedence');
  assert.equal(await card('从歌曲补封面的歌单').locator('.playlist-cover img').getAttribute('src'), fixture.derivedCover, 'Missing playlist artwork can use the first usable song artwork');
  const artworkCalls = await application.evaluate(() => globalThis.recommendationsFixture.calls.filter(call => call.method === 'playlistSongs'));
  assert.ok(artworkCalls.length > 0);
  for (const call of artworkCalls) {
    assert.equal(call.params.cover, undefined, 'Artwork queries send identifiers, not SVG/image payloads');
    assert.ok(call.params.pageSize <= 8, 'Artwork lookup should request a small first page');
  }
  report.checks.playlistArtwork = { distinctDesignedCovers: true, platformArtPreferred: true, firstSongArtUsed: true, smallArtworkQueries: artworkCalls.length };
  await checkLayout('lightPlaylistDesktop'); await capture('light-playlists-desktop');
  await card('默认收藏').click();
  await page.locator('.library-header').waitFor();
  assert.ok((await page.locator('#main-content').textContent()).includes('默认收藏'));
  assert.equal(await page.locator('#main-content img[data-playlist-art="collection"]').count(), 1, 'Playlist detail must retain its designed cover');
  report.checks.detailArtwork = 'PASS';

  await page.locator('[data-view="daily"]').click(); await waitSongs(fixture.daily);
  assert.equal(await callCount('dailyRecommendations'), 1, 'Daily view must request account recommendations, ignoring legacy public cache');
  assert.ok(!(await page.locator('#main-content').textContent()).includes('旧公开歌单缓存'));
  assert.equal(await page.locator('#main-content [data-action="sort-list"]').count(), 0, 'Daily order is the service order, independent of the saved library sort');
  assert.ok(!(await page.locator('#main-content').textContent()).includes('来自酷狗公开推荐歌单'));
  report.checks.dailyUsesAccountApiAndOrder = 'PASS';
  await page.locator('#main-content [data-action="enqueue-all"]').click();
  assert.deepEqual(await queueTitles(), fixture.daily.map(song => song.title)); await closeQueue();
  report.checks.dailyEnqueueOrder = 'PASS';
  await page.locator('#main-content [data-action="play-all"]').click(); await waitPlaying(fixture.daily[0].title);
  assert.deepEqual(await queueTitles(), fixture.daily.map(song => song.title)); await closeQueue();
  report.checks.dailyPlayAllOrder = 'PASS';
  await checkLayout('lightDailyDesktop'); await capture('light-daily-desktop');

  await page.locator('[data-view="guess"]').click(); await waitSongs(fixture.guesses[0]);
  assert.equal(await callCount('guessYouLike'), 1);
  assert.equal(await page.locator('#main-content [data-action="sort-list"]').count(), 0);
  await page.locator('#main-content [data-action="enqueue-all"]').click();
  assert.deepEqual(await queueTitles(), [...fixture.daily, ...fixture.guesses[0]].map(song => song.title)); await closeQueue();
  report.checks.guessEnqueueOrder = 'PASS';
  await page.locator('#main-content [data-action="play-all"]').click(); await waitPlaying(fixture.guesses[0][0].title);
  assert.deepEqual(await queueTitles(), fixture.guesses[0].map(song => song.title)); await closeQueue();
  report.checks.guessPlayAllOrder = 'PASS';
  await page.locator('[data-action="refresh-guess"]').click(); await waitSongs(fixture.guesses[1]);
  assert.equal(await callCount('guessYouLike'), 2, '换一批 must make a new personalized request');
  report.checks.guessRefresh = 'PASS';
  await checkLayout('lightGuessDesktop'); await capture('light-guess-desktop');

  await page.locator('#search-input').fill('搜索验收'); await page.locator('#search-input').press('Enter'); await waitSongs(fixture.search);
  assert.equal(await callCount('search'), 1, 'Top search remains available after removing the search sidebar entry');
  report.checks.globalSearch = 'PASS';
  await page.locator('[data-view="daily"]').click(); await waitSongs(fixture.daily);
  const dailyBeforeRefresh = await callCount('dailyRecommendations');
  await page.locator('[data-action="refresh-daily"]').click(); await waitSongs(fixture.daily);
  assert.equal(await callCount('dailyRecommendations'), dailyBeforeRefresh + 1);
  report.checks.dailyRefresh = 'PASS';

  for (const [view, method] of [['daily', 'dailyRecommendations'], ['guess', 'guessYouLike']]) {
    await page.locator(`[data-view="${view}"]`).click();
    await setFixture({ modes: { dailyRecommendations: 'songs', guessYouLike: 'songs', [method]: 'error' } });
    await page.locator(`[data-action="refresh-${view}"]`).first().click();
    await page.locator('#main-content .error-card').waitFor();
    assert.ok((await page.locator('#main-content .error-card').textContent()).includes('隔离验收：推荐服务暂时未响应'));
    assert.equal(await page.locator('#main-content .track-row').count(), 0, `${view}: error must not display stale songs as fresh recommendations`);
    await capture(`light-${view}-error`); report.checks[`${view}ErrorAndRetry`] = 'PASS';
    await setFixture({ modes: { dailyRecommendations: 'songs', guessYouLike: 'songs', [method]: 'empty' } });
    await page.locator('#main-content .error-card button').click();
    await page.locator('#main-content .empty-card').waitFor();
    assert.equal(await page.locator('#main-content .track-row').count(), 0);
    assert.equal(await page.locator('#main-content [data-action="play-all"]').count(), 0);
    report.checks[`${view}Empty`] = 'PASS';
    await setFixture({ modes: { dailyRecommendations: 'songs', guessYouLike: 'songs', [method]: 'service-empty' } });
    await page.locator(`[data-action="refresh-${view}"]`).first().click();
    await page.locator('#main-content .empty-card').waitFor();
    assert.equal(await page.locator('#main-content .error-card').count(), 0, `${view}: the backend empty-result code must show an empty state`);
    assert.equal(await page.locator('#main-content .track-row').count(), 0);
    report.checks[`${view}BackendEmptyCode`] = 'PASS';
    await setFixture({ modes: { dailyRecommendations: 'songs', guessYouLike: 'songs', [method]: 'expired' }, qrSuccess: false });
    await page.locator(`[data-action="refresh-${view}"]`).first().click();
    await page.locator('#main-content .error-card').waitFor();
    assert.ok((await page.locator('#sidebar-account').textContent()).includes('推荐隔离验收'), 'An expired service token may still have cached account metadata');
    await page.locator('#main-content .error-card button').click();
    await page.locator('#qr-frame img').waitFor();
    assert.equal(await page.locator('#login-modal .account-profile-avatar').count(), 0, `${view}: expiry recovery opens a fresh QR, not the cached account dialog`);
    await capture(`light-${view}-reauth`);
    await page.locator('#login-modal [data-action="close-modal"]').click();
    report.checks[`${view}ExpiredSessionOpensQr`] = 'PASS';
    await setFixture({ modes: { dailyRecommendations: 'songs', guessYouLike: 'songs' } });
    await page.locator(`[data-action="refresh-${view}"]`).first().click();
    await page.waitForFunction(() => document.querySelectorAll('#main-content .track-row').length > 0);
  }

  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.locator('#recommendation-test-backdrop').evaluate((node, scheme) => { node.style.background = scheme === 'light' ? '#d0d7df' : '#141b29'; }, scheme);
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(920, 600));
    for (const view of ['playlists', 'daily', 'guess']) {
      await page.locator(`[data-view="${view}"]`).click();
      if (view === 'playlists') await page.waitForFunction(() => [...document.querySelectorAll('.playlist-cover img')].every(node => node.complete && node.naturalWidth));
      else await page.waitForFunction(() => document.querySelectorAll('#main-content .track-row').length > 0);
      await checkLayout(`${scheme}${view}Minimum`); await capture(`${scheme}-${view}-920x600`);
    }
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 1000));
  await setFixture({ holdGuess: true });
  await page.locator('[data-view="guess"]').click();
  await page.locator('[data-action="refresh-guess"]').click();
  await application.evaluate(async () => { for (let attempt = 0; !globalThis.releaseRecommendationFixture && attempt < 50; attempt++) await new Promise(resolve => setTimeout(resolve, 20)); });
  assert.equal(await application.evaluate(() => typeof globalThis.releaseRecommendationFixture), 'function');
  await page.locator('#sidebar-account').click(); await page.locator('[data-action="logout"]').click();
  await page.waitForFunction(() => document.querySelector('#sidebar-account').textContent.includes('登录概念版账号'));
  await application.evaluate(() => { globalThis.recommendationsFixture.holdGuess = false; globalThis.releaseRecommendationFixture(); });
  await page.waitForTimeout(200);
  assert.equal(await page.locator('#main-content .track-row').count(), 0, 'An in-flight response must not repopulate recommendations after logout');
  assert.ok((await page.locator('#main-content').textContent()).includes('登录'));
  report.checks.logoutRejectsStalePersonalizedResponse = 'PASS';
  await capture('light-guess-login-required');
  await page.locator('[data-view="daily"]').click();
  assert.equal(await page.locator('#main-content .track-row').count(), 0, 'Logged-out daily view must clear account recommendation data');
  assert.ok((await page.locator('#main-content').textContent()).includes('登录'));
  report.checks.dailyLoginRequired = 'PASS';
  await setFixture({ qrSuccess: true });
  await page.locator('#main-content [data-action="account"]').click();
  await page.locator('#modal-layer').waitFor({ state: 'hidden', timeout: 15000 });
  await waitSongs(fixture.dailyB);
  assert.ok(!(await page.locator('#main-content').textContent()).includes(fixture.daily[0].title));
  await page.locator('[data-view="guess"]').click(); await waitSongs(fixture.guessB);
  report.checks.accountChangeLoadsOwnRecommendations = 'PASS';

  const playback = await page.locator('#audio').evaluate(node => ({ source: node.getAttribute('src'), volume: node.volume }));
  assert.equal(playback.volume, 0); report.checks.silentPlayback = playback;
  report.apiCalls = await application.evaluate(() => globalThis.recommendationsFixture.calls);
  assert.deepEqual(report.rendererErrors, []);
  assert.deepEqual(report.remoteRendererRequests, []);
  report.status = 'PASS';
})().catch(async error => {
  report.status = 'FAIL'; report.error = error.stack;
  if (page && !page.isClosed()) {
    report.failure = await page.evaluate(() => ({ content: document.querySelector('#main-content')?.innerText, modal: document.querySelector('#login-modal')?.innerText, account: document.querySelector('#sidebar-account')?.innerText })).catch(() => ({}));
    await capture('failure').catch(() => {});
  }
  console.error(error.stack); process.exitCode = 1;
}).finally(async () => {
  await application?.close().catch(() => {});
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, version: report.version, mode: report.mode, checks: Object.keys(report.checks).length, screenshots: report.screenshots.length, rendererErrors: report.rendererErrors, report: path.join(output, 'report.json') }));
});
