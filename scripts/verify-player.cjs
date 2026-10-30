'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { _electron } = require('./test-deps.cjs').loadTestDependency('playwright');
const root = path.join(__dirname, '..');
const version = require('../package.json').version;
const dataDir = path.join(root, 'test-output', 'player-verification');
fs.mkdirSync(dataDir, { recursive: true });

function silentWav(name, rate) {
  const destination = path.join(dataDir, name);
  const size = rate * 18 * 4;
  const bytes = Buffer.alloc(44 + size);
  bytes.write('RIFF'); bytes.writeUInt32LE(36 + size, 4); bytes.write('WAVE', 8);
  bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(2, 22); bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 4, 28);
  bytes.writeUInt16LE(4, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(size, 40);
  fs.writeFileSync(destination, bytes);
  return destination;
}
const lowFile = silentWav('静音验证 48k.wav', 48000);
const highFile = silentWav('静音验证 96k.wav', 96000);
const badFile = path.join(dataDir, '不支持的音频.mp3');
fs.writeFileSync(badFile, '<html>Invalid audio verification fixture</html>');
fs.writeFileSync(path.join(dataDir, 'library.json'), JSON.stringify([lowFile, highFile, badFile].map(file => ({ path: file }))));
fs.writeFileSync(path.join(dataDir, 'preferences.json'), JSON.stringify({ preferences: { volume: 0, output: 'browser', quality: 'auto', effects: 'off' }, favorites: [], history: [] }));

let application;
let verificationPage;
(async () => {
  const env = { ...process.env, QINGYIN_TEST: '1', QINGYIN_TEST_DATA: dataDir };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.QINGYIN_TEST_ACCOUNT_READONLY;
  application = await _electron.launch({ executablePath: process.argv[2] || require('electron'), args: process.argv[2] ? [] : [root], cwd: root, env, timeout: 30000 });
  await application.firstWindow();
  let page;
  const pageDeadline = Date.now() + 10000;
  while (!page && Date.now() < pageDeadline) {
    page = application.windows().find(window => /\/ui\/index\.html(?:$|\?)/i.test(window.url().replaceAll('\\', '/')));
    if (!page) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(page, 'The main player page must be selected instead of the optional taskbar-lyrics window');
  verificationPage = page;
  const waitNative = async (predicate, timeout = 20000) => {
    const deadline = Date.now() + timeout;
    let state;
    while (Date.now() < deadline) {
      state = (await page.evaluate(() => window.music.mpv.status())).state;
      if (predicate(state)) return state;
      await page.waitForTimeout(100);
    }
    throw new Error(`Native state timeout: ${JSON.stringify(state)}`);
  };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const waitSavedQuality = async quality => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const saved = await page.evaluate(() => window.music.store.get());
      if (saved.preferences?.quality === quality) return;
      await page.waitForTimeout(50);
    }
    throw new Error(`Quality preference did not save: ${quality}`);
  };
  await page.waitForFunction(() => typeof window.music?.invoke === 'function');
  const local = await page.evaluate(() => window.music.local.list());
  const low = local.find(song => song.title.includes('48k'));
  const high = local.find(song => song.title.includes('96k'));
  assert.ok(low && high);
  // Fixtures replace only this isolated test process's API. Production account data
  // is neither read nor copied; stream and player IPC remain the real implementation.
  await application.evaluate(({ ipcMain }, sources) => {
    globalThis.qingyinVerifyCalls = [];
    const nativeHandler = ipcMain._invokeHandlers.get('music:mpv');
    ipcMain.removeHandler('music:mpv');
    ipcMain.handle('music:mpv', async (event, action, params) => {
      const item = { method: 'native', action, volume: params?.volume, time: params?.time, paused: params?.paused };
      globalThis.qingyinVerifyCalls.push(item);
      const result = await nativeHandler(event, action, params);
      item.resultVolume = result?.state?.volume;
      return result;
    });
    ipcMain.removeHandler('music:api');
    ipcMain.handle('music:api', (_event, method, params = {}) => {
      globalThis.qingyinVerifyCalls.push({ method, quality: params.quality });
      const song = { hash: '11111111111111111111111111111111', albumId: '1', albumAudioId: 1, title: '音质切换验证', artist: '测试', duration: 18 };
      let data = {};
      if (method === 'status') data = { loggedIn: true, user: { id: 'verification', name: '验证账号' }, platform: 'lite' };
      else if (method === 'recommendations') data = { playlists: [], songs: [] };
      else if (method === 'search') data = { songs: [song], total: 1 };
      else if (method === 'songQualities') data = { tiers: [
        { id: 'auto', label: '自动（最高可播放）', group: 'auto', available: true, reason: 'AUTO' },
        { id: 'lossless', label: '无损音质', group: 'standard', available: true, offered: true, reason: 'OK' },
        { id: '320', label: '高品质', group: 'standard', available: true, offered: true, reason: 'OK' },
        { id: '128', label: '标准音质', group: 'standard', available: true, offered: true, reason: 'OK' },
      ] };
      else if (method === 'songUrl') {
        const standard = params.quality === '128';
        data = { url: standard ? sources.low : sources.high, duration: 18, preview: false,
          quality: { format: 'wav', bitDepth: 16, sampleRateHz: standard ? 48000 : 96000, label: `WAV 无损 · 16 bit / ${standard ? 48 : 96} kHz`, fallback: false, streamVerified: true } };
      } else if (method === 'lyrics') data = { lines: [], plain: [] };
      else if (method === 'logout') data = { loggedIn: false, user: null };
      else if (method === 'playlists') data = { playlists: [], total: 0, hasMore: false };
      return { ok: true, data };
    });
  }, { low: low.url, high: high.url });
  await page.addInitScript(() => {
    window.qingyinVerifyEdges = [];
    const connect = AudioNode.prototype.connect;
    const disconnect = AudioNode.prototype.disconnect;
    AudioNode.prototype.connect = function(target, ...args) {
      window.qingyinVerifyEdges.push({ from: this, to: target });
      return connect.call(this, target, ...args);
    };
    AudioNode.prototype.disconnect = function(...args) {
      window.qingyinVerifyEdges = window.qingyinVerifyEdges.filter(edge => edge.from !== this || (args[0] && edge.to !== args[0]));
      return disconnect.apply(this, args);
    };
  });
  await page.reload();
  await page.locator('.discover-hero').waitFor();
  await page.locator('#quality-tag').click();
  await page.locator('[data-action="set-quality"][data-quality="lossless"]').waitFor();
  assert.equal(await page.locator('#quality-tag').textContent(), '自动（最高可播放）', 'The loaded catalogue must refresh the footer before any selection');
  for (const [quality, label] of [['lossless', '无损音质'], ['320', '高品质'], ['128', '标准音质'], ['lossless', '无损音质']]) {
    await page.locator(`[data-action="set-quality"][data-quality="${quality}"]`).click();
    assert.equal(await page.locator('#quality-tag').textContent(), label, 'Idle quality changes must immediately update the footer');
    assert.equal(await page.locator('#quality-current').textContent(), `所选：${label}`);
    assert.match(await page.locator('#quality-tag').getAttribute('title'), new RegExp(`所选档位：${label}`));
    assert.equal(await page.locator('#quality-tag').getAttribute('aria-label'), `所选音质：${label}`);
    assert.equal(await page.locator('#audio').getAttribute('src'), null);
    await waitSavedQuality(quality);
  }
  assert.deepEqual(await application.evaluate(() => globalThis.qingyinVerifyCalls.filter(call => call.method === 'songUrl')), []);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#quality-tag').textContent === '无损音质');
  await page.locator('#quality-tag').click();
  await page.waitForFunction(() => document.querySelector('#quality-tag').getAttribute('aria-label') === '所选音质：无损音质' && document.querySelector('#quality-current').textContent === '所选：无损音质');
  await page.locator('[data-action="set-quality"][data-quality="auto"]').click();
  await page.waitForFunction(() => document.querySelector('#quality-tag').textContent === '自动（最高可播放）');
  await page.locator('#quality-panel [data-action="quality"]').click();
  await page.locator('[data-view="local"]').click();
  await page.locator('.track-title[data-action="play-song"]').filter({ hasText: '48k' }).click();
  await page.waitForFunction(() => !document.querySelector('#audio').paused && document.querySelector('#audio').currentTime > .3);
  assert.equal(await page.locator('#audio').evaluate(audio => audio.volume), 0);
  await page.locator('#seek').evaluate(node => { node.value = '30'; node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForFunction(() => document.querySelector('#audio').currentTime > 5);
  await page.locator('#play-button').click();
  const before = await page.locator('#audio').evaluate(audio => audio.currentTime);
  assert.ok(before > 5 && before < 17, `Unexpected position after seek: ${before}`);

  await page.locator('#effects-button').click();
  await page.locator('[data-action="set-effect"]').filter({ hasText: 'HIFI' }).click();
  assert.ok(await page.evaluate(() => window.qingyinVerifyEdges.some(edge => edge.to instanceof DynamicsCompressorNode)));
  await page.locator('[data-action="set-effect"][data-effect="off"]').click();
  assert.equal(await page.evaluate(() => window.qingyinVerifyEdges.some(edge => edge.to instanceof DynamicsCompressorNode)), false);
  await page.locator('#effects-panel [data-action="effects"]').click();

  const native = await page.evaluate(() => window.music.mpv.status());
  assert.equal(native.available, true);
  await page.evaluate(() => { window.qingyinNativeEvents = []; window.music.onEvent(event => { if (event.type === 'mpv') window.qingyinNativeEvents.push(event); }); });
  await page.locator('#output-button').click();
  await page.locator('[data-action="set-output"][data-output="mpv"]').click();
  await waitNative(state => state?.active && !state?.loading && state?.sourceId && state?.paused && state?.time > 4.5 && state?.duration > 0 && state.outParams?.samplerate > 0 && state.audioParams?.samplerate === 48000);
  const mpvPaused = await page.evaluate(() => window.music.mpv.status());
  assert.equal(mpvPaused.state.volume, 0);
  assert.ok(Math.abs(mpvPaused.state.time - before) < 1);
  assert.equal(await page.locator('#audio').getAttribute('src'), null);
  await page.locator('#output-panel [data-action="output"]').click();
  assert.equal(await page.locator('#effects-button').isDisabled(), true);
  assert.equal(await page.locator('[data-action="set-effect"]').filter({ hasText: 'HIFI' }).isDisabled(), true);
  await page.locator('#play-button').click();
  await waitNative(state => state?.time > before + .4);
  assert.equal(await page.locator('#audio').getAttribute('src'), null);
  await page.locator('#play-button').click();
  await waitNative(state => state?.paused);
  const switchTime = (await page.evaluate(() => window.music.mpv.status())).state.time;
  await page.locator('#output-button').click();
  await page.locator('[data-action="set-output"][data-output="browser"]').click();
  await page.waitForFunction(() => document.querySelector('#audio').paused && document.querySelector('#audio').currentTime > 5);
  assert.ok(Math.abs(await page.locator('#audio').evaluate(audio => audio.currentTime) - switchTime) < 1);
  assert.equal((await page.evaluate(() => window.music.mpv.status())).state.active, false);
  await page.locator('#output-panel [data-action="output"]').click();

  await page.locator('#search-input').fill('音质切换验证');
  await page.locator('#search-input').press('Enter');
  await page.locator('.track-title[data-action="play-song"]').filter({ hasText: '音质切换验证' }).click();
  await page.waitForFunction(() => !document.querySelector('#audio').paused && document.querySelector('#audio').currentTime > .2);
  await page.locator('#seek').evaluate(node => { node.value = '35'; node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForFunction(() => document.querySelector('#audio').currentTime > 5);
  await page.locator('#play-button').click();
  await page.locator('#quality-tag').click();
  await page.locator('[data-action="set-quality"][data-quality="128"]').click();
  await page.waitForFunction(() => document.querySelector('#audio').paused && document.querySelector('#audio').currentTime > 5 && document.querySelector('#quality-tag').textContent.includes('48'));
  const standardSource = await page.locator('#audio').getAttribute('src');
  assert.match(await page.locator('#quality-tag').getAttribute('title'), /标准音质/);
  await page.locator('[data-action="set-quality"][data-quality="lossless"]').click();
  await page.waitForFunction(() => document.querySelector('#audio').paused && document.querySelector('#audio').currentTime > 5 && document.querySelector('#quality-tag').textContent.includes('96'));
  await page.screenshot({ path: path.join(dataDir, `quality-${version}.png`) });
  assert.notEqual(await page.locator('#audio').getAttribute('src'), standardSource);
  const calls = await application.evaluate(() => globalThis.qingyinVerifyCalls.filter(call => call.method === 'songUrl').map(call => call.quality));
  assert.ok(calls.includes('128') && calls.includes('lossless'));
  await page.locator('#quality-panel [data-action="quality"]').click();

  await page.locator('#output-button').click();
  await page.locator('[data-action="set-output"][data-output="mpv"]').click();
  const highNative = await waitNative(state => state?.active && !state?.loading && state?.sourceId && state?.duration > 0 && state.audioParams?.samplerate === 96000 && state.outParams?.samplerate > 0);
  if (highNative.audioParams.samplerate !== highNative.outParams.samplerate) {
    await page.waitForFunction(rates => { const text = document.querySelector('#output-content').textContent; return text.includes(`${rates.source} kHz`) && text.includes(`${rates.output} kHz`) && text.includes('重采样'); }, { source: highNative.audioParams.samplerate / 1000, output: highNative.outParams.samplerate / 1000 });
  }
  await page.screenshot({ path: path.join(dataDir, `output-${version}.png`) });
  await page.locator('#output-panel [data-action="output"]').click();
  const mainPid = await application.evaluate(() => process.pid);
  const nativeProcesses = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process -Filter "Name=\'mpv.exe\'" | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress'], { encoding: 'utf8', windowsHide: true }).trim() || '[]');
  const nativePid = [].concat(nativeProcesses).find(item => item.ParentProcessId === mainPid)?.ProcessId;
  assert.equal(typeof nativePid, 'number');
  process.kill(nativePid);
  await page.waitForFunction(() => document.querySelector('#output-button').title.includes('内置播放') && document.querySelector('#audio').paused && document.querySelector('#audio').currentTime > 5);
  await page.locator('#output-button').click();
  await page.locator('[data-action="set-output"][data-output="mpv"]').click();
  await waitNative(state => state?.active && !state?.loading && state?.sourceId);
  await page.locator('#output-panel [data-action="output"]').click();
  await page.locator('#top-login').click();
  await page.locator('[data-action="logout"]').click();
  await waitNative(state => !state?.active);
  assert.equal(await page.locator('#audio').getAttribute('src'), null);
  assert.equal(await page.evaluate(() => JSON.stringify(window.qingyinNativeEvents).includes('"path":')), false);
  assert.deepEqual(errors, []);
  const result = { version, qualityCatalogueFooterSync: 'PASS', idleQualityFooterAndAccessibilitySync: 'PASS', savedQualityRestoresAfterReload: 'PASS', localDecodeSeekPause: 'PASS', originalEffectBypass: 'PASS', mpvRealLoadMuteTimeline: 'PASS', outputSwitchPreservesPosition: 'PASS', qualitySwitchPreservesPauseAndChangesSource: 'PASS', nativeExitFallbackAndRestart: 'PASS', logoutStopsMpv: 'PASS', opaqueNativeEvents: 'PASS', mpvAudioApiFormat: mpvPaused.state.outParams, errors };
  await page.screenshot({ path: path.join(dataDir, `player-${version}.png`) });
  fs.writeFileSync(path.join(dataDir, 'results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  await application.close();
})().catch(async error => {
  console.error(error.stack);
  if (verificationPage && !verificationPage.isClosed()) {
    console.error(JSON.stringify(await verificationPage.evaluate(async () => { const audio = document.querySelector('#audio'); return { title: document.querySelector('#player-title').textContent, button: document.querySelector('#play-button').title, audioTime: audio.currentTime, audioDuration: audio.duration, audioPaused: audio.paused, audioError: audio.error?.code, displayedTime: document.querySelector('#current-time').textContent, qualityTag: document.querySelector('#quality-tag').textContent, qualityCurrent: document.querySelector('#quality-current').textContent, savedPreferences: (await window.music.store.get()).preferences, messages: [...document.querySelectorAll('.toast')].map(node => node.textContent) }; }).catch(() => ({}))));
    console.error(JSON.stringify(await application.evaluate(() => globalThis.qingyinVerifyCalls).catch(() => [])));
    console.error(JSON.stringify(await verificationPage.evaluate(async () => ({ native: await window.music.mpv.status(), nativeEvents: window.qingyinNativeEvents?.slice(-18) })).catch(() => ({}))));
    await verificationPage.screenshot({ path: path.join(dataDir, 'failure.png') }).catch(() => {});
  }
  await application?.close().catch(() => {}); process.exit(1);
});
