const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron } = require('./test-deps.cjs').loadTestDependency('playwright');
const root = path.join(__dirname, '..');
const output = path.join(root, 'test-output');
const dataDir = path.join(output, 'online-data');
const keyword = process.env.QINGYIN_VERIFY_QUERY || '送别';
const songIndex = Number.isInteger(Number(process.env.QINGYIN_VERIFY_INDEX)) && Number(process.env.QINGYIN_VERIFY_INDEX) >= 0 ? Number(process.env.QINGYIN_VERIFY_INDEX) : 2;
fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(path.join(dataDir, 'preferences.json'), JSON.stringify({ preferences: { volume: 0 } }));
let application;
(async () => {
  const env = { ...process.env, QINGYIN_TEST: '1', QINGYIN_TEST_ACCOUNT_READONLY: '1', QINGYIN_TEST_DATA: dataDir };
  delete env.ELECTRON_RUN_AS_NODE;
  application = await _electron.launch({ executablePath: process.argv[2] || require('electron'), args: process.argv[2] ? [] : [root], cwd: root, env, timeout: 30000 });
  await application.firstWindow();
  let page;
  const mainPageDeadline = Date.now() + 15000;
  while (!page && Date.now() < mainPageDeadline) {
    page = application.windows().find(candidate => /\/ui\/index\.html(?:$|\?)/i.test(candidate.url().replaceAll('\\', '/')));
    if (!page) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(page, 'The main player page must be selected instead of the taskbar lyrics window');
  const errors = [];
  page.on('pageerror', error => errors.push(error.name));
  await page.locator('.discover-hero').waitFor();
  const status = await page.evaluate(() => window.music.invoke('status'));
  assert.equal(status.data.loggedIn, true);
  await page.locator('#search-input').fill(keyword); await page.locator('#search-input').press('Enter');
  await page.locator('.track-row').nth(songIndex).waitFor({ timeout: 25000 });
  await page.locator('.track-title[data-action="play-song"]').nth(songIndex).click();
  await page.waitForFunction(() => {
    const audio = document.querySelector('#audio');
    return !audio.paused && audio.readyState >= 3 && audio.currentTime > 1;
  }, undefined, { timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector('#quality-tag').textContent.includes('获取中'));
  const quality = { label: await page.locator('#quality-tag').innerText(), tooltip: await page.locator('#quality-tag').getAttribute('title') };
  assert.match(quality.label, /FLAC|MP3|AAC|WAV|OGG|OPUS|M4A|无损|音频/);
  assert.match(quality.tooltip, /最高可播放/);
  if (process.env.QINGYIN_VERIFY_QUALITY) assert.ok(quality.label.includes(process.env.QINGYIN_VERIFY_QUALITY), 'Expected verified high-resolution quality');
  const playback = await page.locator('#audio').evaluate(audio => ({ duration: audio.duration, currentTime: audio.currentTime, mutedForTest: audio.volume === 0, localProxy: audio.src.startsWith('qingyin-stream:') }));
  assert.equal(playback.mutedForTest, true); assert.equal(playback.localProxy, true); assert.ok(playback.duration > 20);
  const range = await page.locator('#audio').evaluate(async audio => {
    const response = await fetch(audio.src, { headers: { Range: 'bytes=0-31' } });
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { status: response.status, mime: response.headers.get('content-type'), byteCount: bytes.length, signature: String.fromCharCode(...bytes.slice(0, 4)) };
  });
  assert.equal(range.status, 206); assert.equal(range.byteCount, 32); assert.match(range.mime, /^audio\//);
  if (range.mime === 'audio/flac') assert.equal(range.signature, 'fLaC');
  if (range.mime === 'audio/mpeg') assert.equal(range.signature.slice(0, 3), 'ID3');
  await page.locator('#seek').evaluate((element, duration) => {
    element.value = String(20 / duration * 100);
    element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true }));
  }, playback.duration);
  await page.waitForFunction(() => document.querySelector('#audio').currentTime > 20.2, undefined, { timeout: 10000 });
  await page.locator('#play-button').click();
  assert.equal(await page.locator('#audio').evaluate(audio => audio.paused), true);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(output, 'online-quality.png'), timeout: 10000 });
  console.log(JSON.stringify({ authenticatedConceptSearch: 'PASS', onlineAudioDecode: 'PASS', quality, playback, seek20Seconds: 'PASS', range, errors }));
  fs.writeFileSync(path.join(output, 'online-results.json'), JSON.stringify({ authenticatedConceptSearch: 'PASS', onlineAudioDecode: 'PASS', quality, playback, seek20Seconds: 'PASS', range, errors }, null, 2));
  await application.close();
})().catch(async error => { console.error(error.name + ': ' + error.message); await application?.close().catch(() => {}); process.exit(1); });
