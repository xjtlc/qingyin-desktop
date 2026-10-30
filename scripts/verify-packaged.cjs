'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { chromium } = require('./test-deps.cjs').loadTestDependency('playwright');
const root = path.join(__dirname, '..');
const version = require('../package.json').version;
const fixtureDir = path.join(root, 'test-output', 'player-verification');
const destination = path.join(root, 'test-output', 'packaged-verification');
const dataDir = path.join(destination, 'data');
fs.mkdirSync(destination, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });
fs.copyFileSync(path.join(fixtureDir, 'library.json'), path.join(dataDir, 'library.json'));
let child;
let browser;
let page;
let diagnostic = '';
(async () => {
  assert.ok(process.argv[2], 'Packaged executable is required');
  fs.writeFileSync(path.join(dataDir, 'preferences.json'), JSON.stringify({ preferences: { volume: 0, output: 'browser', quality: 'auto', effects: 'off' }, favorites: [], history: [] }));
  const env = { ...process.env, QINGYIN_TEST: '1', QINGYIN_TEST_DATA: dataDir };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.QINGYIN_TEST_ACCOUNT_READONLY;
  child = spawn(process.argv[2], ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--enable-logging=stderr'], { cwd: path.dirname(process.argv[2]), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const endpoint = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Packaged browser startup timed out')), 25000);
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('exit', code => { clearTimeout(timeout); reject(new Error(`Packaged application exited: ${code}`)); });
    child.stderr.on('data', chunk => {
      diagnostic += chunk.toString();
      const match = diagnostic.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
  });
  browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  const mainPageDeadline = Date.now() + 15000;
  while (!page && Date.now() < mainPageDeadline) {
    page = context.pages().find(candidate => /\/ui\/index\.html(?:$|\?)/i.test(candidate.url().replaceAll('\\', '/')));
    if (!page) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(page, 'The main player page must be selected instead of the taskbar lyrics window');
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => typeof window.music?.mpv?.status === 'function');
  const waitNative = async predicate => {
    const deadline = Date.now() + 20000;
    let state;
    while (Date.now() < deadline) {
      state = (await page.evaluate(() => window.music.mpv.status())).state;
      if (predicate(state)) return state;
      await page.waitForTimeout(100);
    }
    throw new Error(`Native state timeout: ${JSON.stringify(state)}`);
  };
  await page.click('[data-view="local"]');
  await page.locator('.track-title[data-action="play-song"]').filter({ hasText: '48k' }).click();
  await page.waitForFunction(() => { const a = document.querySelector('audio'); return a && a.readyState >= 2 && !a.paused; });
  await page.evaluate(() => { document.querySelector('audio').currentTime = 4; });
  await page.click('#play-button');
  await page.waitForTimeout(500);
  await page.click('#output-button');
  await page.click('[data-output="mpv"]');
  const native = await waitNative(state => state.active && !state.loading && state.paused && state.time >= 3 && state.volume === 0 && state.audioParams?.samplerate === 48000 && state.outParams?.samplerate > 0);
  assert.equal(await page.evaluate(() => document.querySelector('audio').getAttribute('src')), null);
  assert.equal(await page.locator('#effects-button').isDisabled(), true);
  await page.click('[data-output="browser"]');
  await page.waitForFunction(() => { const a = document.querySelector('audio'); return a.paused && a.readyState >= 2 && a.currentTime >= 3; });
  await page.click('#output-panel [data-action="output"]');
  await page.evaluate(() => {
    window.packagedFailureMessages = [];
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE && node.matches('.toast')) window.packagedFailureMessages.push(node.textContent);
      }
    }).observe(document.querySelector('#toast-stack'), { childList: true });
  });
  await page.locator('.track-title[data-action="play-song"]').filter({ hasText: '不支持' }).click();
  await page.waitForFunction(() => window.packagedFailureMessages.some(message => message === '「不支持的音频」播放失败，正在跳过。'));
  await page.waitForFunction(() => {
    const audio = document.querySelector('audio');
    return !document.querySelector('#player-title').textContent.includes('不支持') && !audio.paused && audio.readyState >= 2;
  });
  assert.equal(await page.evaluate(() => window.packagedFailureMessages.filter(message => message.includes('「不支持的音频」')).length), 1);
  assert.deepEqual(errors, []);
  const result = { version, packagedStartup: 'PASS', browserLocalPlayback: 'PASS', nativeRealLoadMuteAndPause: 'PASS', switchingOutputPreservesPosition: 'PASS', unsupportedSourceChineseNoticeAndSkip: 'PASS', mpvAudioApiFormat: native.outParams, errors };
  fs.writeFileSync(path.join(destination, 'results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
})().catch(async error => {
  console.error(error.stack || error.message);
  if (page) await page.screenshot({ path: path.join(destination, 'failure.png') }).catch(() => {});
  if (!page) console.error(diagnostic.slice(-3000));
  process.exitCode = 1;
}).finally(async () => {
  if (page) await page.evaluate(() => window.music.window('close')).catch(() => {});
  if (browser) await browser.close().catch(() => {});
  if (child && child.exitCode === null) {
    await new Promise(resolve => { const timeout = setTimeout(resolve, 1500); child.once('exit', () => { clearTimeout(timeout); resolve(); }); });
    if (child.exitCode === null) child.kill();
  }
});
