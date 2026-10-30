'use strict';
// Capture the real packaged transparent caption at a synthetic paused mid-line
// frame. It never displays a fixture window or reads a production profile.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { _electron } = require('./test-deps.cjs').loadTestDependency('playwright');
const root = path.resolve(__dirname, '..');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const executable = process.argv[2];
assert.ok(executable, 'Pass the final packaged executable path');
const output = path.join(root, 'test-output', `taskbar-karaoke-preview-${version}`, 'packaged');
const profile = path.join(output, 'preview-isolated-data');
fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(path.join(profile, 'preferences.json'), JSON.stringify({ preferences: { volume: 0 }, favorites: [], history: [] }));
const env = { ...process.env, QINGYIN_TEST: '1', QINGYIN_TEST_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE; delete env.QINGYIN_TEST_ACCOUNT_READONLY;
let application;
function expectedTaskbarTheme() {
  const value = execFileSync('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', '/v', 'SystemUsesLightTheme'], { encoding: 'utf8', windowsHide: true, timeout: 3000 });
  const match = value.match(/SystemUsesLightTheme\s+REG_DWORD\s+0x([\da-f]+)/i);
  assert.ok(match, 'The independent Windows system-theme registry value must be readable');
  return Number.parseInt(match[1], 16) === 0 ? 'dark' : 'light';
}
(async () => {
  application = await _electron.launch({ executablePath: executable, args: [], cwd: root, env, timeout: 30000 });
  const packagedVersion = await application.evaluate(({ app }) => app.getVersion());
  assert.equal(packagedVersion, version, 'Capture must use the final package matching the current source version');
  await application.firstWindow();
  let main, taskbar;
  for (let i = 0; i < 100 && (!main || !taskbar); i++) {
    main = application.windows().find(page => /\/index\.html(?:$|[?#])/.test(page.url()));
    taskbar = application.windows().find(page => /\/taskbar-lyrics\.html(?:$|[?#])/.test(page.url()));
    if (!main || !taskbar) await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(main && taskbar);
  await application.evaluate(({ ipcMain, session }) => {
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_event, done) => done({ cancel: true }));
    ipcMain.removeHandler('music:api');
    ipcMain.handle('music:api', () => ({ ok: true, data: { loggedIn: false, songs: [], playlists: [] } }));
  });
  await main.reload();
  await main.waitForTimeout(300);
  const text = '不怕想起 才算是胜利', chars = [...text];
  const words = chars.map((text, index) => ({ text, start: index * 4 / chars.length, end: (index + 1) * 4 / chars.length }));
  const pausedPosition = 3.2;
  await main.evaluate(({ text, words, pausedPosition }) => window.music.taskbarLyrics.update({ text, words, kind: 'lyric', title: '合成样例 · 任务栏歌词预览', playing: false, enabled: true, visible: true, position: pausedPosition, lineStart: 0, lineEnd: 4, sampledAt: Date.now(), rate: 1 }), { text, words, pausedPosition });
  await taskbar.waitForFunction(text => document.querySelector('#taskbar-lyric').getAttribute('aria-label') === text, text, { polling: 50 });
  const expectedTheme = expectedTaskbarTheme();
  const actualTheme = await taskbar.locator('html').getAttribute('data-theme');
  assert.equal(actualTheme, expectedTheme, 'Actual default taskbar text must follow SystemUsesLightTheme independently of the app theme');
  const placement = await main.evaluate(() => window.music.taskbarLyrics.status());
  const nativeGeometry = await application.evaluate(({ BrowserWindow, screen }) => {
    const display = screen.getPrimaryDisplay();
    const window = BrowserWindow.getAllWindows().find(window => /\/taskbar-lyrics\.html(?:$|[?#])/.test(window.webContents.getURL()));
    return { scaleFactor: display.scaleFactor, displayBounds: display.bounds, workArea: display.workArea, windowBounds: window.getBounds(), contentBounds: window.getContentBounds() };
  });
  const typography = await taskbar.evaluate(() => {
    const caption = document.querySelector('#taskbar-lyric');
    const firstUnit = document.querySelector('.lyric-unit');
    const style = getComputedStyle(caption);
    const bodyStyle = getComputedStyle(document.body);
    const rect = node => { const { x, y, width, height } = node.getBoundingClientRect(); return { x, y, width, height }; };
    return { fontSize: Number.parseFloat(style.fontSize), lineHeight: Number.parseFloat(style.lineHeight), fontWeight: style.fontWeight, paddingLeft: Number.parseFloat(bodyStyle.paddingLeft), paddingRight: Number.parseFloat(bodyStyle.paddingRight), captionRect: rect(caption), firstUnitRect: rect(firstUnit), viewport: { width: innerWidth, height: innerHeight } };
  });
  assert.equal(placement.placement, 'bottom', 'The compact reference requires a visible bottom taskbar');
  assert.equal(placement.bounds.x, nativeGeometry.displayBounds.x + 36, 'The caption window must start 36 DIP from the left edge');
  assert.equal(nativeGeometry.windowBounds.x, placement.bounds.x);
  assert.equal(nativeGeometry.windowBounds.y, placement.bounds.y);
  assert.equal(typography.fontSize, 14, 'Compact lyrics must use a 14 DIP font, approximately 21 physical pixels at 150%');
  assert.equal(typography.fontWeight, '400', 'Reference lyrics use normal font weight');
  assert.equal(typography.paddingLeft, 1);
  assert.equal(typography.paddingRight, 1);
  assert.ok(Math.abs(typography.firstUnitRect.x - 1) < .01, 'The reference phrase must begin at the left caption inset');
  assert.ok(Math.abs(typography.captionRect.y + typography.captionRect.height / 2 - typography.viewport.height / 2) < 1, 'Compact lyrics must be vertically centered in the caption');
  const taskbarTop = nativeGeometry.workArea.y + nativeGeometry.workArea.height;
  const taskbarBottom = nativeGeometry.displayBounds.y + nativeGeometry.displayBounds.height;
  const windowTop = nativeGeometry.windowBounds.y;
  const windowBottom = windowTop + nativeGeometry.windowBounds.height;
  assert.ok(windowTop >= taskbarTop && windowBottom <= taskbarBottom, 'The caption must stay inside the Windows taskbar');
  assert.ok(Math.abs((windowTop + windowBottom) / 2 - (taskbarTop + taskbarBottom) / 2) <= 2, 'The native caption must align with the taskbar vertical midpoint');
  const physical = {
    effectiveFontPixels: typography.fontSize * nativeGeometry.scaleFactor,
    textStartFromDisplayLeft: (nativeGeometry.windowBounds.x - nativeGeometry.displayBounds.x + typography.firstUnitRect.x) * nativeGeometry.scaleFactor,
    captionCenterFromTaskbarTop: (nativeGeometry.windowBounds.y - taskbarTop + typography.captionRect.y + typography.captionRect.height / 2) * nativeGeometry.scaleFactor,
    taskbarHeight: (taskbarBottom - taskbarTop) * nativeGeometry.scaleFactor,
  };
  assert.ok(Math.abs(physical.textStartFromDisplayLeft - 37 * nativeGeometry.scaleFactor) < .01, 'Physical text start must account for actual display scaling');
  const geometry = { placement, ...nativeGeometry, typography, physical };
  const readFrame = () => taskbar.evaluate(() => ({ position: Number(document.querySelector('#taskbar-lyric-track').dataset.position), clips: [...document.querySelectorAll('.lyric-unit-fill')].map(node => node.style.clipPath), playing: document.body.dataset.playing }));
  await main.evaluate(() => window.music.taskbarLyrics.update({ position: .7, playing: true, sampledAt: Date.now() }));
  await taskbar.waitForFunction(() => document.body.dataset.playing === 'true', null, { polling: 50 });
  const before = await readFrame(); await taskbar.waitForTimeout(650); const after = await readFrame();
  assert.ok(after.position > before.position + .4, 'The final package must keep sparse-clock karaoke advancing');
  assert.notDeepEqual(after.clips, before.clips);
  await main.evaluate(pausedPosition => window.music.taskbarLyrics.update({ position: pausedPosition, playing: false, sampledAt: Date.now() }), pausedPosition);
  await taskbar.waitForFunction(() => document.body.dataset.playing === 'false', null, { polling: 50 });
  const paused = await readFrame(); await taskbar.waitForTimeout(250); const held = await readFrame();
  assert.equal(held.position, paused.position); assert.deepEqual(held.clips, paused.clips);
  const screenshots = [], screenshotDimensions = [];
  for (const theme of ['dark', 'light']) {
    await taskbar.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    const captured = await application.evaluate(async ({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find(window => /\/taskbar-lyrics\.html(?:$|[?#])/.test(window.webContents.getURL()));
      window.webContents.invalidate();
      await window.capturePage(undefined, { stayHidden: true });
      await new Promise(resolve => setTimeout(resolve, 120));
      const image = await window.capturePage(undefined, { stayHidden: true });
      const png = image.toPNG();
      return { png: png.toString('base64'), visible: window.isVisible(), physicalImageSize: { width: png.readUInt32BE(16), height: png.readUInt32BE(20) } };
    });
    assert.equal(captured.visible, false);
    const destination = path.join(output, `reference-short-${theme}-mid-line.png`);
    fs.writeFileSync(destination, Buffer.from(captured.png, 'base64'));
    screenshots.push(destination);
    screenshotDimensions.push({ path: destination, physicalImageSize: captured.physicalImageSize });
  }
  const result = { status: 'PASS', version: packagedVersion, fixture: 'Synthetic word timing; actual packaged renderer; hidden, silent and isolated', systemTheme: { expectedTheme, actualTheme }, geometry, sparseClock: { before: before.position, after: after.position }, pausedClock: { paused: paused.position, held: held.position }, screenshots, screenshotDimensions };
  fs.writeFileSync(path.join(output, 'final-system-theme-and-clock.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
})().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => { await application?.close().catch(() => {}); });
