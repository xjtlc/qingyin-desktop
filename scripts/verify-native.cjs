const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron } = require('./test-deps.cjs').loadTestDependency('playwright');
const root = path.join(__dirname, '..');
const output = path.join(root, 'test-output');
const testData = path.join(output, 'native-data');
let runningApp;
fs.mkdirSync(testData, { recursive: true });
function wavFile(destination) {
  const rate = 22050, duration = 8, size = rate * duration * 2;
  const buffer = Buffer.alloc(44 + size);
  buffer.write('RIFF'); buffer.writeUInt32LE(36 + size, 4); buffer.write('WAVE', 8);
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(size, 40);
  for (let i = 0; i < rate * duration; i++) buffer.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 330 / rate) * 400), 44 + i * 2);
  fs.writeFileSync(destination, buffer);
}
wavFile(path.join(testData, '音频播放验证.wav'));
fs.writeFileSync(path.join(testData, 'library.json'), JSON.stringify([{ path: path.join(testData, '音频播放验证.wav') }]));

(async () => {
  const env = { ...process.env, QINGYIN_TEST: '1', QINGYIN_TEST_DATA: testData };
  delete env.ELECTRON_RUN_AS_NODE;
  const electron = await _electron.launch({ executablePath: process.argv[2] || require('electron'), args: process.argv[2] ? [] : [root], cwd: root, env, timeout: 30000 });
  runningApp = electron;
  const errors = [];
  const page = await electron.firstWindow();
  page.on('console', message => { if (message.type() === 'error') console.log('Renderer:', message.text().slice(0, 400)); });
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => typeof window.music?.invoke === 'function');
  const security = await page.evaluate(() => ({ require: typeof window.require, process: typeof window.process }));
  assert.equal(security.require, 'undefined'); assert.equal(security.process, 'undefined');
  const status = await page.evaluate(() => window.music.invoke('status'));
  assert.equal(status.ok, true); assert.equal(status.data.loggedIn, false);
  assert.equal(status.data.platform, 'lite');
  const local = await page.evaluate(() => window.music.local.list());
  assert.equal(local.length, 1);
  const range = await page.evaluate(async track => {
    const response = await fetch(track.url, { headers: { Range: 'bytes=100-199' } });
    return { status: response.status, contentRange: response.headers.get('content-range'), size: (await response.arrayBuffer()).byteLength };
  }, local[0]);
  assert.equal(range.status, 206); assert.equal(range.size, 100);
  const audio = await page.evaluate(async track => {
    const sound = document.createElement('audio'); sound.volume = 0; sound.src = track.url;
    document.body.append(sound);
    await new Promise((resolve, reject) => {
      sound.addEventListener('loadedmetadata', resolve, { once: true });
      sound.addEventListener('error', () => reject(new Error('Local audio failed: ' + sound.error?.code)), { once: true });
      setTimeout(() => reject(new Error('Audio metadata timeout')), 10000);
    });
    await sound.play();
    await new Promise(resolve => setTimeout(resolve, 700));
    const before = sound.currentTime;
    sound.currentTime = 4;
    await new Promise(resolve => setTimeout(resolve, 500));
    const result = { duration: sound.duration, before, after: sound.currentTime };
    sound.pause(); sound.remove(); return result;
  }, local[0]);
  assert.equal(Math.round(audio.duration), 8); assert.ok(audio.before > 0.2); assert.ok(audio.after > 4.1);
  console.log('Native isolation / local audio decode, advance, seek: PASS');
  const denied = await page.evaluate(() => window.music.invoke('vipReceive'));
  assert.equal(denied.ok, false);
  const search = await page.evaluate(() => window.music.invoke('search', { keyword: '送别', page: 1 }));
  if (search.ok) console.log('Live concept search:', search.data.songs.length, 'songs');
  else console.log('Live concept search unavailable:', search.error);
  await page.screenshot({ path: path.join(output, 'home.png') });
  assert.deepEqual(errors, []);
  await electron.close();
  fs.writeFileSync(path.join(output, 'native-results.json'), JSON.stringify({ security, range, audio, search: search.ok ? { count: search.data.songs.length } : { error: search.error }, errors }, null, 2));
})().catch(async error => { console.error(error.stack); await runningApp?.close().catch(() => {}); process.exit(1); });
