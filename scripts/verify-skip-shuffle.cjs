'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron } = require('./test-deps.cjs').loadTestDependency('playwright');
const root = path.join(__dirname, '..');
const version = require('../package.json').version;
const packaged = Boolean(process.argv[2]);
const dataDir = path.join(root, 'test-output', `skip-shuffle-verification-${packaged ? 'packaged' : 'source'}`);
fs.mkdirSync(dataDir, { recursive: true });
function silentWav(name) {
  const destination = path.join(dataDir, name), rate = 48000, size = rate * 18 * 4;
  const bytes = Buffer.alloc(44 + size);
  bytes.write('RIFF'); bytes.writeUInt32LE(36 + size, 4); bytes.write('WAVE', 8);
  bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(2, 22); bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 4, 28);
  bytes.writeUInt16LE(4, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(size, 40);
  fs.writeFileSync(destination, bytes);
  return destination;
}
const goodFiles = [silentWav('静音播放 A.wav'), silentWav('静音播放 B.wav'), silentWav('静音播放 C.wav')];
const badFile = path.join(dataDir, '损坏验证音频.mp3');
fs.writeFileSync(badFile, '<html>This fixture is not audio.</html>');
fs.writeFileSync(path.join(dataDir, 'library.json'), JSON.stringify([...goodFiles, badFile].map(file => ({ path: file }))));
const preferences = (overrides = {}) => ({ volume: 0, output: 'browser', quality: 'auto', effects: 'off', shuffle: false, repeat: 'all', ...overrides });
fs.writeFileSync(path.join(dataDir, 'preferences.json'), JSON.stringify({ preferences: preferences(), favorites: [], history: [], sort: { field: 'default', direction: 'asc' } }));
const makeSong = (id, title, behavior = 'good') => ({ hash: `fixture-${id}`, albumId: 'fixture', albumAudioId: id, title, artist: '隔离验证', album: '静音测试', duration: 18, behavior });
const groups = {
  first: [makeSong(1, '首首失败', 'fail'), makeSong(2, '首首之后可播放'), makeSong(3, '首首备用')],
  consecutive: [makeSong(11, '连续失败一', 'fail'), makeSong(12, '连续损坏音频', 'bad'), makeSong(13, '连续失败后可播放')],
  allFailed: [makeSong(21, '全失败一', 'fail'), { ...makeSong(21, '全失败重复条目', 'fail'), playlistEntryId: 'duplicate-21' }, makeSong(22, '全失败二', 'fail'), makeSong(23, '全失败三', 'fail')],
  repeatOne: [makeSong(31, '单曲模式失败', 'fail'), makeSong(32, '单曲模式下一首')],
  end: [makeSong(41, '顺序前首可播放'), makeSong(42, '顺序末尾失败', 'fail')],
  random: Array.from({ length: 6 }, (_, index) => makeSong(50 + index, `随机验证 ${index + 1}`)),
  quality: [makeSong(61, '暂停音质失败验证', 'quality'), makeSong(62, '暂停音质下一首')],
  delayed: [makeSong(71, '迟到失败', 'delayed'), makeSong(72, '手动选中的歌曲'), makeSong(73, '手动切歌备用')],
  pending: [makeSong(81, '待跳失败', 'fail'), makeSong(82, '待跳自动候选'), makeSong(83, '待跳手动指定')],
  runtime: [makeSong(91, '就绪立即失败一'), makeSong(92, '就绪立即失败二'), makeSong(93, '就绪立即失败三')],
  stalled: [makeSong(94, '意外暂停后自动跳过'), makeSong(95, '停滞后的可播放歌曲')],
  login: [makeSong(101, '需要登录', 'login'), makeSong(102, '登录后的歌曲')],
  rejection: [makeSong(111, '浏览器拒绝播放'), makeSong(112, '浏览器拒绝后下一首')],
};
let application, page;
const errors = [], results = { version, run: packaged ? 'packaged' : 'source' };
const env = { ...process.env, QINGYIN_TEST: '1', QINGYIN_TEST_DATA: dataDir };
delete env.ELECTRON_RUN_AS_NODE;
delete env.QINGYIN_TEST_ACCOUNT_READONLY;

async function calls() { return application.evaluate(() => globalThis.fixtureCalls.filter(call => call.method === 'songUrl')); }
async function title() { return page.locator('#player-title').textContent(); }
async function waitSavedShuffle() {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const saved = await page.evaluate(() => window.music.store.get());
    if (saved.preferences?.shuffle === true) return;
    await page.waitForTimeout(100);
  }
  throw new Error('Random mode preference was not saved');
}
async function playing(expected) {
  await page.waitForFunction(expectedTitle => {
    const audio = document.querySelector('#audio');
    return document.querySelector('#player-title').textContent === expectedTitle && !audio.paused && audio.readyState >= 3 && audio.currentTime > .1 && !document.querySelector('#play-button').classList.contains('loading');
  }, expected, { timeout: 15000 });
}
async function quiet(milliseconds = 850) {
  const before = await calls();
  await page.waitForTimeout(milliseconds);
  assert.deepEqual(await calls(), before, 'The failure chain must stop without continually requesting songs');
  assert.equal(await page.locator('#audio').evaluate(audio => audio.paused), true);
}
async function reset(group, overrides = {}) {
  // IPC and filesystem writes stay real. These preferences belong exclusively to
  // this test process, never to the installed application's profile or account.
  await page.evaluate(saved => window.music.store.set(saved), { preferences: preferences(overrides), favorites: [], history: [], sort: { field: 'default', direction: 'asc' } });
  await application.evaluate((_electron, selected) => {
    for (const resolve of globalThis.fixtureHeld || []) resolve({ ok: false, code: 'NO_PLAYABLE_SOURCE', error: '迟到的隔离验证失败' });
    globalThis.fixtureHeld = [];
    globalThis.fixtureGroup = selected;
    globalThis.fixtureCalls = [];
  }, group);
  await page.reload();
  await page.locator('.discover-hero').waitFor();
  await page.waitForFunction(() => document.querySelector('#player-title').textContent === '把喜欢的声音，带到桌面' && document.querySelector('#repeat-button').title !== '');
  await page.locator('#search-input').fill(group);
  await page.locator('#search-input').press('Enter');
  await page.waitForFunction(count => document.querySelectorAll('.track-row').length === count && !!document.querySelector('[data-action="play-all"]'), groups[group].length);
}
async function clickSong(songTitle) {
  await page.locator('.track-title[data-action="play-song"]').filter({ hasText: new RegExp(`^${songTitle}$`) }).click();
}
async function setMode(label) {
  for (let count = 0; count < 5; count++) {
    if (await page.locator('#repeat-button').getAttribute('title') === label) return;
    await page.locator('#repeat-button').click();
  }
  assert.fail(`Playback mode ${label} was not reachable through the mode button`);
}
async function queueOrder() {
  await page.locator('#queue-button').click();
  const rows = await page.locator('#queue-content .queue-row').evaluateAll(nodes => nodes.map(node => ({ key: node.querySelector('[data-action="play-queue"]').dataset.key, title: node.querySelector('.track-title').textContent, current: node.classList.contains('current') })));
  await page.locator('#queue-panel [data-action="queue"]').click();
  return rows;
}
async function waitStopped() {
  await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(node => /已停止/.test(node.textContent)) && document.querySelector('#audio').paused && !document.querySelector('#play-button').classList.contains('loading'), null, { timeout: 15000 });
}

(async () => {
  application = await _electron.launch({ executablePath: process.argv[2] || require('electron'), args: packaged ? [] : [root], cwd: root, env, timeout: 30000 });
  page = await application.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false));
  await page.waitForFunction(() => typeof window.music?.invoke === 'function');
  const local = await page.evaluate(() => window.music.local.list());
  const good = local.find(song => song.title === '静音播放 A'), bad = local.find(song => song.title === '损坏验证音频');
  assert.ok(good?.url && bad?.url, 'Real local audio fixtures must be registered');
  await application.evaluate(({ ipcMain }, fixture) => {
    globalThis.fixtureGroups = fixture.groups;
    globalThis.fixtureGroup = 'first'; globalThis.fixtureCalls = []; globalThis.fixtureHeld = [];
    ipcMain.removeHandler('music:api');
    ipcMain.handle('music:api', async (_event, method, params = {}) => {
      globalThis.fixtureCalls.push({ method, hash: params.hash, quality: params.quality });
      const songs = globalThis.fixtureGroups[globalThis.fixtureGroup];
      let data = {};
      if (method === 'status') data = { loggedIn: true, user: { id: 'isolated-fixture', name: '隔离验证' }, platform: 'lite' };
      else if (method === 'recommendations') data = { playlists: [], songs: [] };
      else if (method === 'search') data = { songs, total: songs.length };
      else if (method === 'playlists') data = { playlists: [{ id: 'fixture-list', title: '隔离验证歌单', count: songs.length, private: true }], total: 1, hasMore: false };
      else if (method === 'playlistSongs') data = { songs: songs.map((song, index) => ({ ...song, playlistEntryId: `fixture:${index}`, playlistPosition: index })), total: songs.length, totalReported: true, totalReliable: true, hasMore: false, rawCount: songs.length, page: 1, pageSize: 300, offset: 0 };
      else if (method === 'songQualities') data = { tiers: [
        { id: 'auto', label: '自动（最高可播放）', group: 'auto', selectable: true },
        { id: 'lossless', label: '无损音质', group: 'standard', selectable: true, offered: true },
        { id: '128', label: '标准音质', group: 'standard', selectable: true, offered: true },
      ] };
      else if (method === 'songUrl') {
        const song = Object.values(globalThis.fixtureGroups).flat().find(item => item.hash === params.hash);
        if (!song) return { ok: false, code: 'FIXTURE_UNKNOWN', error: '未知的隔离验证歌曲' };
        if (song.behavior === 'delayed') return new Promise(resolve => globalThis.fixtureHeld.push(resolve));
        if (song.behavior === 'login') return { ok: false, code: 'LOGIN_REQUIRED', error: '隔离验证要求登录' };
        if (song.behavior === 'fail' || (song.behavior === 'quality' && params.quality === '128')) return { ok: false, code: 'NO_PLAYABLE_SOURCE', error: '隔离验证音频暂不可播放' };
        data = { url: song.behavior === 'bad' ? fixture.bad : fixture.good, duration: 18, preview: false, quality: { format: 'wav', bitDepth: 16, sampleRateHz: 48000, label: 'WAV 无损 · 16 bit / 48 kHz', streamVerified: true } };
      } else if (method === 'lyrics') data = { lines: [], plain: [] };
      else if (method === 'qrStart') data = { key: 'isolated-qr', image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', expiresIn: 180 };
      else if (method === 'qrCheck') data = { status: 'waiting' };
      return { ok: true, data };
    });
  }, { groups, good: good.url, bad: bad.url });
  await page.addInitScript(() => {
    Math.random = () => .37;
    const realPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function(...args) {
      if (window.fixtureRejectPlay) {
        const name = window.fixtureRejectPlay; window.fixtureRejectPlay = null;
        return Promise.reject(new DOMException('Isolated playback rejection', name));
      }
      return realPlay.apply(this, args);
    };
    window.fixtureRuntimeFailures = [];
    document.addEventListener('playing', event => {
      if (!window.fixtureRuntimeErrors || event.target.id !== 'audio') return;
      const audio = event.target, playingTitle = document.querySelector('#player-title').textContent;
      // Fire after the actual decoder has become ready and the app has confirmed
      // playback, before its three-second sustained-playback recovery threshold.
      setTimeout(() => {
        if (!window.fixtureRuntimeErrors || audio.paused || document.querySelector('#player-title').textContent !== playingTitle) return;
        window.fixtureRuntimeFailures.push(playingTitle);
        let injected = true;
        Object.defineProperty(audio, 'error', { configurable: true, get: () => injected ? { code: 3 } : null });
        audio.dispatchEvent(new Event('error'));
        injected = false;
      }, 25);
    }, true);
  });

  await reset('first');
  await page.locator('[data-action="play-all"]').click();
  await playing('首首之后可播放');
  assert.equal((await calls()).filter(call => call.hash === 'fixture-1').length, 1);
  assert.equal(await page.locator('#queue-size').textContent(), '3');
  results.firstFailureSkips = 'PASS';

  await reset('consecutive');
  await page.locator('[data-action="play-all"]').click();
  await playing('连续失败后可播放');
  assert.ok((await calls()).some(call => call.hash === 'fixture-11'));
  assert.ok((await calls()).some(call => call.hash === 'fixture-12'));
  results.consecutiveApiAndDecoderFailuresSkip = 'PASS';

  await reset('allFailed');
  await page.locator('[data-action="play-all"]').click();
  await waitStopped();
  assert.equal((await calls()).length, 4, 'All failed playlist entries, including duplicate resources, get exactly one attempt');
  assert.equal((await calls()).filter(call => call.hash === 'fixture-21').length, 2);
  await quiet();
  results.allFailureStopsAfterOneEntryRound = 'PASS';

  await reset('repeatOne', { repeat: 'one' });
  assert.equal(await page.locator('#repeat-button').getAttribute('title'), '单曲循环');
  await page.locator('[data-action="play-all"]').click();
  await playing('单曲模式下一首');
  assert.equal((await calls()).filter(call => call.hash === 'fixture-31').length, 1);
  results.singleRepeatSkipsFailedSong = 'PASS';

  await reset('end', { repeat: 'off' });
  await clickSong('顺序末尾失败');
  await waitStopped();
  assert.deepEqual((await calls()).map(call => call.hash), ['fixture-42']);
  await quiet();
  results.sequentialEndDoesNotWrap = 'PASS';

  await reset('runtime');
  await page.evaluate(() => { window.fixtureRuntimeErrors = true; });
  await page.locator('[data-action="play-all"]').click();
  await waitStopped();
  assert.equal((await page.evaluate(() => window.fixtureRuntimeFailures)).length, 3, 'Ready-then-error songs must not continually clear the failure round');
  assert.ok((await calls()).length <= 6, 'Runtime failures may prefetch, but must remain finite');
  await quiet();
  results.readyThenImmediateRuntimeFailuresStop = 'PASS';

  await reset('stalled');
  await page.locator('[data-action="play-all"]').click();
  await playing('意外暂停后自动跳过');
  // Simulate the backend pausing unexpectedly while the app still intends to
  // play. The watchdog must skip after its real observation window expires.
  await page.locator('#audio').evaluate(audio => audio.pause());
  await page.waitForTimeout(5000);
  assert.equal(await title(), '意外暂停后自动跳过', 'Brief stalls must not cause immediate skipping');
  await page.waitForFunction(() => document.querySelector('#player-title').textContent === '停滞后的可播放歌曲' && !document.querySelector('#audio').paused, null, { timeout: 23000 });
  assert.ok(await page.locator('.toast').allTextContents().then(messages => messages.some(message => /正在跳过/.test(message))));
  results.stalledPlaybackAdvancesAutomatically = 'PASS';

  await reset('random');
  assert.equal(await page.locator('#shuffle-button').count(), 0, 'Random playback uses the same mode button');
  const modeLabels = [];
  for (let index = 0; index < 4; index++) {
    const mode = await page.locator('#repeat-button').getAttribute('title'); modeLabels.push(mode);
    assert.match(await page.locator('#repeat-button').getAttribute('aria-label'), new RegExp(mode));
    await page.locator('#repeat-button').click();
  }
  assert.deepEqual(modeLabels, ['列表循环', '单曲循环', '顺序播放', '随机播放']);
  await setMode('随机播放');
  await page.locator('[data-action="play-all"]').click();
  await page.waitForFunction(() => !document.querySelector('#audio').paused && document.querySelector('#audio').currentTime > .1);
  const randomFirst = await title();
  assert.notEqual(randomFirst, groups.random[0].title, 'The deterministic random fixture must select a random list starting point');
  const randomRows = await queueOrder();
  assert.equal(randomRows.length, groups.random.length);
  assert.equal(new Set(randomRows.map(row => row.key)).size, groups.random.length);
  assert.deepEqual(randomRows.map(row => row.title).sort(), groups.random.map(song => song.title).sort());
  const currentIndex = randomRows.findIndex(row => row.current);
  assert.equal(randomRows[currentIndex].title, randomFirst);
  await page.locator('#next-button').click();
  await playing(randomRows[(currentIndex + 1) % randomRows.length].title);
  assert.deepEqual((await queueOrder()).map(row => row.key), randomRows.map(row => row.key), 'Next respects the visible queue order');
  await waitSavedShuffle();
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'preferences.json'), 'utf8'));
  assert.equal(saved.preferences.shuffle, true);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#repeat-button').title === '随机播放');
  results.fourModesRandomEntireListQueueAndRestartMemory = 'PASS';

  // The same existing play-all action also applies the saved random mode to a
  // fully loaded private playlist and to the local library.
  await page.locator('[data-view="playlists"]').click();
  await page.locator('.playlist-card').filter({ hasText: '隔离验证歌单' }).click();
  await page.waitForFunction(count => document.querySelectorAll('.track-row').length === count && !document.querySelector('[data-action="play-all"]').disabled, groups.random.length);
  await page.locator('[data-action="play-all"]').click();
  await page.waitForFunction(() => !document.querySelector('#audio').paused && document.querySelector('#audio').currentTime > .1);
  assert.equal((await queueOrder()).length, groups.random.length);
  await page.locator('[data-view="local"]').click();
  await page.locator('[data-action="play-all"]').click();
  await page.waitForFunction(() => !document.querySelector('#audio').paused && document.querySelector('#audio').currentTime > .1);
  assert.equal((await queueOrder()).length, 4);
  results.randomModeAppliesToPlaylistAndLocalList = 'PASS';

  await reset('quality');
  await page.locator('[data-action="play-all"]').click();
  await playing('暂停音质失败验证');
  await page.locator('#play-button').click();
  await page.waitForFunction(() => document.querySelector('#audio').paused);
  await application.evaluate(() => { globalThis.fixtureCalls = []; });
  await page.locator('#quality-tag').click();
  await page.locator('[data-action="set-quality"][data-quality="128"]').click();
  await page.waitForFunction(() => document.querySelector('#player-artist').title.includes('隔离验证音频') && !document.querySelector('#play-button').classList.contains('loading'));
  assert.equal(await title(), '暂停音质失败验证');
  assert.deepEqual((await calls()).map(call => call.hash), ['fixture-61']);
  await quiet();
  results.pausedQualityFailureDoesNotAdvanceOrResume = 'PASS';

  await reset('delayed');
  await clickSong('迟到失败');
  await page.waitForFunction(() => document.querySelector('#play-button').classList.contains('loading'));
  await application.evaluate(async () => {
    const deadline = Date.now() + 3000;
    while (!globalThis.fixtureHeld.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    if (!globalThis.fixtureHeld.length) throw new Error('Delayed fixture request was not started');
  });
  await clickSong('手动选中的歌曲');
  await playing('手动选中的歌曲');
  await application.evaluate(() => { for (const resolve of globalThis.fixtureHeld.splice(0)) resolve({ ok: false, code: 'NO_PLAYABLE_SOURCE', error: '迟到的隔离验证失败' }); });
  await page.waitForTimeout(850);
  assert.equal(await title(), '手动选中的歌曲');
  assert.equal(await page.locator('#audio').evaluate(audio => audio.paused), false);
  results.lateOldFailureDoesNotAdvanceNewSelection = 'PASS';

  await reset('pending');
  await page.evaluate(() => {
    const observer = new MutationObserver(() => {
      if ([...document.querySelectorAll('.toast')].some(node => node.textContent.includes('待跳失败') && node.textContent.includes('跳过'))) {
        observer.disconnect();
        [...document.querySelectorAll('.track-title[data-action="play-song"]')].find(node => node.textContent === '待跳手动指定').click();
      }
    });
    observer.observe(document.querySelector('#toast-stack'), { childList: true });
  });
  await clickSong('待跳失败');
  await playing('待跳手动指定');
  await page.waitForTimeout(850);
  assert.equal(await title(), '待跳手动指定');
  assert.equal(await page.locator('#audio').evaluate(audio => audio.paused), false);
  results.manualSelectionCancelsPendingSkip = 'PASS';

  await reset('login');
  await page.locator('[data-action="play-all"]').click();
  await page.locator('#login-modal').waitFor({ state: 'visible' });
  assert.equal(await title(), '需要登录');
  assert.deepEqual((await calls()).map(call => call.hash), ['fixture-101']);
  await quiet();
  results.loginRequiredDoesNotSkip = 'PASS';

  for (const rejection of ['NotAllowedError', 'AbortError']) {
    await reset('rejection');
    await page.evaluate(name => { window.fixtureRejectPlay = name; }, rejection);
    await page.locator('[data-action="play-all"]').click();
    await page.waitForFunction(() => !document.querySelector('#play-button').classList.contains('loading'));
    assert.equal(await title(), '浏览器拒绝播放');
    assert.deepEqual((await calls()).map(call => call.hash), ['fixture-111']);
    await quiet();
    results[rejection === 'NotAllowedError' ? 'autoplayRejectionDoesNotSkip' : 'cancelledPlaybackDoesNotSkip'] = 'PASS';
  }

  assert.deepEqual(errors, []);
  results.rendererErrors = errors;
  fs.writeFileSync(path.join(dataDir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
  await application.close(); application = null;
})().catch(async error => {
  console.error(error.stack);
  if (page && !page.isClosed()) {
    const state = await page.evaluate(() => { const audio = document.querySelector('#audio'); return { title: document.querySelector('#player-title').textContent, paused: audio.paused, time: audio.currentTime, readyState: audio.readyState, button: document.querySelector('#play-button').title, mode: document.querySelector('#repeat-button').title, messages: [...document.querySelectorAll('.toast')].map(node => node.textContent), runtimeFailures: window.fixtureRuntimeFailures }; }).catch(() => ({}));
    console.error(JSON.stringify({ fixtureState: state, requests: await calls().catch(() => []), completed: results }));
    await page.screenshot({ path: path.join(dataDir, 'failure.png') }).catch(() => {});
  }
  await application?.close().catch(() => {});
  process.exitCode = 1;
});
