'use strict';

// Run with `node scripts/verify-list-controls.cjs [absolute path to Qingyin.exe]`.
// The application and its browser profile use only this generated fixture folder;
// no production account, preferences, or listening history is read or changed.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron } = require('./test-deps.cjs').loadTestDependency('playwright');
const root = path.resolve(__dirname, '..');
const executable = process.argv.slice(2).find(value => !value.startsWith('--'));
if (executable) assert.ok(path.isAbsolute(executable) && fs.existsSync(executable), 'Supply an existing absolute executable path');
const dataDir = path.join(root, 'test-output', `list-controls-${executable ? 'packaged' : 'source'}-${Date.now()}`);
fs.mkdirSync(dataDir, { recursive: true });
const wavFile = path.join(dataDir, '列表验证静音.wav'), rate = 48000, size = rate * 30 * 4, wav = Buffer.alloc(44 + size);
wav.write('RIFF'); wav.writeUInt32LE(36 + size, 4); wav.write('WAVE', 8);
wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(size, 40); fs.writeFileSync(wavFile, wav);
fs.writeFileSync(path.join(dataDir, 'library.json'), JSON.stringify([{ path: wavFile }]));
fs.writeFileSync(path.join(dataDir, 'preferences.json'), JSON.stringify({ preferences: { volume: 0, output: 'browser', quality: 'auto', effects: 'off', shuffle: false, repeat: 'all' }, favorites: [], history: [], sort: { field: 'default', direction: 'asc' } }));
const cover = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" fill="#7294b4"/><circle cx="40" cy="40" r="21" fill="#dbe7f2"/><circle cx="40" cy="40" r="8" fill="#38516b"/></svg>').toString('base64');
const songs = Array.from({ length: 434 }, (_, index) => ({ hash: `list-controls-${index}`, albumId: 'fixture', albumAudioId: index + 1, title: `列表验证 ${String(index + 1).padStart(3, '0')}`, artist: `隔离验证 ${index % 3 + 1}`, album: '完整歌单验证', duration: 30, cover, playlistEntryId: `fixture:${index}`, playlistPosition: index }));
const otherSongs = songs.slice(0, 3).map((song, index) => ({ ...song, hash: `other-list-${index}`, title: `另一歌单 ${index + 1}` }));
const env = { ...process.env, QINGYIN_TEST: '1', QINGYIN_TEST_DATA: dataDir };
delete env.ELECTRON_RUN_AS_NODE; delete env.QINGYIN_TEST_ACCOUNT_READONLY;
let application, page;
const report = { fixture: 'isolated fake account and userData; 434-song catalog; real silent WAV', run: executable ? 'packaged' : 'source', checks: {}, geometry: {}, screenshots: [], rendererErrors: [] };
function checkpoint(name, result = 'PASS') { report.checks[name] = result; console.log(JSON.stringify({ checkpoint: name, result })); }
async function capture(name) {
  // Every caller already waits for the target scroll geometry. Extra animation
  // frames can take seconds in a hidden window and outlive the locate emphasis.
  const png = await application.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows().find(window => /\/ui\/index\.html(?:$|\?)/i.test(window.webContents.getURL().replaceAll('\\', '/'))).capturePage()).toPNG().toString('base64'));
  const filename = path.join(dataDir, `${name}-${report.version}.png`);
  fs.writeFileSync(filename, Buffer.from(png, 'base64')); report.screenshots.push(filename);
}
async function openPlaylist(title = '434 首列表验证歌单', count = 434) {
  await page.locator('[data-view="playlists"]').click();
  await page.locator('.playlist-card').filter({ hasText: title }).click();
  await page.waitForFunction(count => document.querySelectorAll('#main-content .track-list > .track-row').length === count && document.querySelector('[data-action="play-all"]')?.disabled === false, count);
  await page.locator('#list-rail').waitFor({ state: 'visible' });
}
async function jump(where) {
  const started = Date.now();
  await page.evaluate(where => {
    const main = document.querySelector('#main-content');
    if (window.listJumpObserver) { main.removeEventListener('scroll', window.listJumpObserver); main.removeEventListener('scrollend', window.listJumpObserver); }
    window.listJumpSamples = [];
    if (where !== 'current') return;
    const started = performance.now();
    const sample = event => queueMicrotask(() => {
      const row = main.querySelector('.track-row.current'); if (!row) return;
      const box = row.getBoundingClientRect(), pane = main.getBoundingClientRect(), style = getComputedStyle(row);
      window.listJumpSamples.push({ event: event.type, elapsedMs: Math.round(performance.now() - started), centerDelta: box.top + box.height / 2 - pane.top - pane.height / 2, scrollTop: main.scrollTop, classes: row.className, style: { background: style.backgroundColor, image: style.backgroundImage, shadow: style.boxShadow, outline: style.outline } });
    });
    window.listJumpObserver = sample;
    main.addEventListener('scroll', sample); main.addEventListener('scrollend', sample);
  }, where);
  // The app is deliberately hidden. Skip Playwright's animation-frame stability
  // delay, which otherwise outlives the short locate emphasis in hidden windows.
  await page.locator(`#list-rail [data-jump="${where}"]`).click({ force: true });
  const clickMs = Date.now() - started;
  const initialClasses = where === 'current' ? await page.locator('#main-content .track-row.current').getAttribute('class') : null;
  if (where === 'top') await page.waitForFunction(() => document.querySelector('#main-content').scrollTop < 1, undefined, { polling: 50 });
  else if (where === 'bottom') await page.waitForFunction(() => { const main = document.querySelector('#main-content'); return Math.abs(main.scrollHeight - main.clientHeight - main.scrollTop) < 1; }, undefined, { polling: 50 });
  else await page.waitForFunction(() => { const main = document.querySelector('#main-content').getBoundingClientRect(), row = document.querySelector('#main-content .track-row.current')?.getBoundingClientRect(); return row && Math.abs(row.top + row.height / 2 - main.top - main.height / 2) < 3; }, undefined, { polling: 50 });
  const scrollTop = await page.locator('#main-content').evaluate(node => node.scrollTop);
  const samples = where === 'current' ? await page.evaluate(() => window.listJumpSamples) : [];
  (report.jumps ||= []).push({ where, clickMs, elapsedMs: Date.now() - started, scrollTop, initialClasses, samples });
  return scrollTop;
}
async function railRect() { return page.locator('#list-rail').evaluate(node => { const { x, y, width, height } = node.getBoundingClientRect(); return { x, y, width, height }; }); }
async function buttonGeometry() {
  return page.evaluate(() => [...document.querySelectorAll('.library-actions button, .list-toolbar .sort-chip')].map(button => {
    const box = button.getBoundingClientRect(), svg = button.querySelector('svg')?.getBoundingClientRect();
    const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT), bounds = [];
    while (walker.nextNode()) {
      if (!walker.currentNode.textContent.trim() || walker.currentNode.parentElement.closest('svg')) continue;
      const range = document.createRange(); range.selectNodeContents(walker.currentNode);
      for (const rect of range.getClientRects()) if (rect.width) bounds.push(rect);
    }
    const text = bounds.length ? { left: Math.min(...bounds.map(rect => rect.left)), right: Math.max(...bounds.map(rect => rect.right)), top: Math.min(...bounds.map(rect => rect.top)), bottom: Math.max(...bounds.map(rect => rect.bottom)) } : null;
    const groupLeft = Math.min(svg?.left ?? Infinity, text?.left ?? Infinity), groupRight = Math.max(svg?.right ?? -Infinity, text?.right ?? -Infinity);
    return { action: button.dataset.action, text: button.textContent.trim(), display: getComputedStyle(button).display, groupCenterDelta: (groupLeft + groupRight) / 2 - box.left - box.width / 2, iconTextCenterDelta: svg && text ? svg.top + svg.height / 2 - (text.top + text.bottom) / 2 : null, horizontallyOrdered: !svg || !text || svg.right <= text.left + 1, height: box.height };
  }));
}
async function validateLayout(name) {
  const geometry = await page.evaluate(() => {
    const main = document.querySelector('#main-content').getBoundingClientRect(), rail = document.querySelector('#list-rail').getBoundingClientRect(), footer = document.querySelector('.player').getBoundingClientRect();
    const actions = [...document.querySelectorAll('#main-content .track-row .track-actions')].map(node => node.getBoundingClientRect());
    const visible = actions.filter(rect => rect.bottom > main.top && rect.top < main.bottom);
    return { main: { top: main.top, bottom: main.bottom, right: main.right }, rail: { left: rail.left, right: rail.right, top: rail.top, bottom: rail.bottom }, footerTop: footer.top, visibleActions: visible.length, maximumActionRight: Math.max(...visible.map(rect => rect.right)), mainHorizontalOverflow: document.querySelector('#main-content').scrollWidth - document.querySelector('#main-content').clientWidth, hasRail: document.querySelector('#main-content').classList.contains('has-rail') };
  });
  assert.ok(geometry.hasRail, `${name}: active lists reserve room for the rail`);
  assert.ok(geometry.visibleActions > 0, `${name}: actual song-row controls must be visible`);
  assert.ok(geometry.maximumActionRight + 3 <= geometry.rail.left, `${name}: rail must not cover song-row actions (${geometry.maximumActionRight} / ${geometry.rail.left})`);
  assert.ok(geometry.rail.top >= geometry.main.top && geometry.rail.bottom < geometry.footerTop, `${name}: rail stays within the song area and above the player`);
  assert.ok(geometry.rail.right <= geometry.main.right, `${name}: rail stays within the content window`);
  assert.ok(geometry.mainHorizontalOverflow <= 1, `${name}: the added rail must not introduce horizontal scrolling`);
  report.geometry[name] = geometry;
}

(async () => {
  application = await _electron.launch({ executablePath: executable || require('electron'), args: executable ? [] : [root], cwd: root, env, timeout: 30000 });
  await application.firstWindow();
  const deadline = Date.now() + 10000;
  while (!page && Date.now() < deadline) {
    page = application.windows().find(window => /\/ui\/index\.html(?:$|\?)/i.test(window.url().replaceAll('\\', '/')));
    if (!page) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(page, 'Select the main player window');
  page.on('pageerror', error => report.rendererErrors.push(error.message));
  report.version = await application.evaluate(({ app }) => app.getVersion());
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => /\/ui\/index\.html(?:$|\?)/i.test(window.webContents.getURL().replaceAll('\\', '/'))).webContents.setBackgroundThrottling(false));
  await page.waitForFunction(() => typeof window.music?.invoke === 'function');
  const local = await page.evaluate(() => window.music.local.list());
  const source = local.find(song => song.title === '列表验证静音'); assert.ok(source?.url);
  await application.evaluate(({ ipcMain }, fixture) => {
    globalThis.listControlsFixture = fixture;
    ipcMain.removeHandler('music:api');
    ipcMain.handle('music:api', async (_event, method, params = {}) => {
      const fixture = globalThis.listControlsFixture; let data = {};
      if (method === 'status') data = { loggedIn: true, user: { id: 'list-controls-fixture', name: '列表验证账号' }, platform: 'lite' };
      else if (method === 'recommendations' || method === 'playlists') data = { playlists: [{ id: 'fixture-list', title: '434 首列表验证歌单', count: 434, private: true, cover: fixture.songs[0].cover }, { id: 'other-list', title: '另一张验证歌单', count: 3, private: true, cover: fixture.songs[0].cover }], songs: [], total: 2, hasMore: false };
      else if (method === 'playlistSongs') {
        const songs = params.id === 'other-list' ? fixture.otherSongs : fixture.songs;
        const page = Number(params.page) || 1, offset = (page - 1) * 300, rows = songs.slice(offset, offset + 300), more = offset + rows.length < songs.length;
        data = { songs: rows, total: songs.length, sourceTotal: songs.length, totalReported: true, totalReliable: true, sourcePage: page, page, pageSize: 300, offset, rawCount: rows.length, hasMore: more, nextPage: more ? page + 1 : null, nextOffset: more ? offset + rows.length : null };
      } else if (method === 'songUrl') data = { url: fixture.url, duration: 30, preview: false, quality: { format: 'wav', bitDepth: 16, sampleRateHz: 48000, label: 'WAV 无损', streamVerified: true } };
      else if (method === 'songQualities') data = { tiers: [{ id: 'auto', label: '自动（最高可播放）', group: 'auto', selectable: true }] };
      else if (method === 'lyrics') data = { text: '[00:00.00]列表控件隔离验证' };
      return { ok: true, data };
    });
    ipcMain.removeHandler('music:mpv-status');
    ipcMain.handle('music:mpv-status', () => ({ available: false, state: { active: false, paused: true } }));
    ipcMain.removeHandler('music:mpv');
    ipcMain.handle('music:mpv', () => ({ ok: true, state: { active: false, paused: true }, queued: false }));
  }, { songs, otherSongs, url: source.url });
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#sidebar-account').textContent.includes('列表验证账号'));
  // Keep smooth scrolling and the locate-row highlight active; suppress only
  // cosmetic transitions and playback waves for stable hidden-window captures.
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => /\/ui\/index\.html(?:$|\?)/i.test(window.webContents.getURL().replaceAll('\\', '/'))).webContents.insertCSS('*,*::before,*::after{transition:none!important}.playing-wave i{animation:none!important}'));
  await page.locator('#list-rail').waitFor({ state: 'hidden' });
  await openPlaylist();
  assert.equal(await page.locator('#list-rail [data-jump]').count(), 3);
  assert.equal(await page.locator('#list-rail [data-jump="current"]').isDisabled(), true);
  checkpoint('noCurrentDisabledAndRailOnlyForSongLists');
  const before = await railRect(), bottom = await jump('bottom'), after = await railRect();
  assert.ok(bottom > 20000, 'Bottom jump must reach the end of the complete 434-song list');
  assert.deepEqual(after, before, 'The rail stays fixed while the song content scrolls');
  assert.equal(await jump('top'), 0);
  checkpoint('smoothTopBottomAndFixedRail', { bottom, rail: before });
  const centered = await buttonGeometry();
  assert.ok(centered.length >= 7, 'Measure action buttons and all sorting chips');
  for (const button of centered) {
    assert.ok(button.horizontallyOrdered, `${button.text}: icon and label share one horizontal row`);
    assert.ok(Math.abs(button.groupCenterDelta) <= 2.5, `${button.text}: icon/label group is horizontally centered (${button.groupCenterDelta})`);
    assert.ok(button.iconTextCenterDelta === null || Math.abs(button.iconTextCenterDelta) <= 3.5, `${button.text}: icon and label are vertically centered (${button.iconTextCenterDelta})`);
  }
  checkpoint('actionAndSortButtonAlignment', centered);
  await page.locator('.track-title[data-action="play-song"]').filter({ hasText: songs[210].title }).click();
  await page.waitForFunction(title => document.querySelector('#player-title').textContent === title && document.querySelector('#audio').readyState >= 3 && !document.querySelector('#audio').paused && !document.querySelector('#play-button').classList.contains('loading'), songs[210].title);
  await page.locator('#play-button').click();
  await page.waitForFunction(() => document.querySelector('#audio').paused);
  assert.equal(await page.locator('#list-rail [data-jump="current"]').isDisabled(), false);
  await jump('top');
  const currentStyle = await page.locator('#main-content .track-row.current').evaluate(node => { const style = getComputedStyle(node); return { background: style.backgroundColor, image: style.backgroundImage, shadow: style.boxShadow, outline: style.outline }; });
  const current = await jump('current');
  assert.ok(current > 10000 && current < bottom, 'Locate current song scrolls to the middle of the long list');
  const located = await page.locator('#main-content .track-row.current').evaluate(node => { const style = getComputedStyle(node); return { classes: node.className, title: node.querySelector('.track-title').textContent, style: { background: style.backgroundColor, image: style.backgroundImage, shadow: style.boxShadow, outline: style.outline } }; });
  assert.equal(located.title, songs[210].title);
  const centeredEmphasis = report.jumps.at(-1).samples.find(sample => Math.abs(sample.centerDelta) < 3 && sample.classes.includes('located'));
  assert.ok(centeredEmphasis || located.classes.includes('located'), 'Locating the current row adds visible emphasis when it arrives at the viewport center');
  assert.notDeepEqual(centeredEmphasis?.style || located.style, currentStyle, 'Locating the current row visibly emphasizes its background, border or outline');
  checkpoint('locateCurrentCenteredAndEmphasized', { scrollTop: current, ...located });
  await page.locator('[data-view="local"]').click();
  await page.locator('#list-rail').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#list-rail [data-jump="current"]').isDisabled(), true);
  await openPlaylist('另一张验证歌单', 3);
  assert.equal(await page.locator('#list-rail [data-jump="current"]').isDisabled(), true);
  await page.locator('[data-view="favorites"]').click();
  await page.locator('#list-rail').waitFor({ state: 'hidden' });
  await page.locator('[data-view="playlists"]').click();
  await page.locator('#list-rail').waitFor({ state: 'hidden' });
  checkpoint('currentAbsentDisabledAndEmptyOrCardViewsHideRail');
  await openPlaylist();
  await page.locator('[data-action="sort-direction"]').click();
  await page.waitForFunction(() => document.querySelector('.track-row .track-title')?.textContent === '列表验证 434');
  await jump('top');
  const reversedCurrent = await jump('current');
  assert.ok(reversedCurrent > current, 'Current location follows the visible reversed order');
  assert.equal(await page.locator('#main-content .track-row.current .track-title').textContent(), songs[210].title);
  checkpoint('locationFollowsChangedSortOrder', { reversedCurrent });
  await page.locator('[data-action="sort-direction"]').click();
  await page.waitForFunction(() => document.querySelector('.track-row .track-title')?.textContent === '列表验证 001');
  await page.evaluate(() => { const backdrop = document.createElement('div'); backdrop.id = 'list-controls-backdrop'; backdrop.style.cssText = 'position:fixed;inset:0;z-index:-1;pointer-events:none;background:#ced6e0'; document.body.prepend(backdrop); });
  report.screenshotBackdrop = 'Synthetic browser backdrop; native Windows Acrylic is not included in capturePage';
  for (const width of [1080, 920]) {
    await application.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows().find(window => /\/ui\/index\.html(?:$|\?)/i.test(window.webContents.getURL().replaceAll('\\', '/'))).setSize(width, 740), width);
    await page.waitForFunction(width => window.innerWidth === width, width);
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.locator('#list-controls-backdrop').evaluate((node, scheme) => { node.style.background = scheme === 'light' ? '#ced6e0' : '#161d2b'; }, scheme);
      await jump('current');
      await validateLayout(`${scheme}-${width}-current`);
      await capture(`${scheme}-${width}-current`);
      await jump('top');
      await validateLayout(`${scheme}-${width}-top`);
      await capture(`${scheme}-${width}-top`);
    }
  }
  checkpoint('lightDarkAndMinimumWindowLayouts');
  assert.deepEqual(report.rendererErrors, []);
  report.success = true;
  fs.writeFileSync(path.join(dataDir, 'results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ success: true, version: report.version, checks: Object.keys(report.checks), screenshots: report.screenshots, result: path.join(dataDir, 'results.json') }));
  await application.close(); application = null;
})().catch(async error => {
  console.error(error.stack); report.success = false; report.error = { message: error.message, stack: error.stack };
  if (page && !page.isClosed()) {
    report.failure = await page.evaluate(() => ({ title: document.querySelector('#player-title')?.textContent, rows: document.querySelectorAll('#main-content .track-row').length, railHidden: document.querySelector('#list-rail')?.hidden, scrollTop: document.querySelector('#main-content')?.scrollTop })).catch(() => ({}));
    await capture('failure').catch(() => {});
  }
  fs.writeFileSync(path.join(dataDir, 'results.json'), JSON.stringify(report, null, 2));
  console.error(JSON.stringify({ result: path.join(dataDir, 'results.json'), failure: report.failure }));
  await application?.close().catch(() => {}); process.exitCode = 1;
});
