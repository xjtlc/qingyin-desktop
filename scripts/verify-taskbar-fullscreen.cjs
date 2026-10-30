'use strict';

// Exercise the packaged native taskbar window without displaying, activating or
// modifying any desktop window. The fake detector controls only a separate
// controller created from the final package; the production profile is unused.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron } = require('./test-deps.cjs').loadTestDependency('playwright');

const root = path.resolve(__dirname, '..');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const executable = process.argv[2];
assert.ok(executable, 'Pass the final packaged executable path');
const output = path.join(root, 'test-output', `taskbar-fullscreen-${version}`, 'packaged');
const profile = path.join(output, 'isolated-data');
fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(path.join(profile, 'preferences.json'), JSON.stringify({ preferences: { volume: 0 }, favorites: [], history: [] }));
const env = { ...process.env, QINGYIN_TEST: '1', QINGYIN_TEST_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.QINGYIN_TEST_ACCOUNT_READONLY;
let application;
const checks = [];
const snapshots = [];

function check(name, operation) {
  operation();
  checks.push(name);
}

(async () => {
  application = await _electron.launch({ executablePath: executable, args: [], cwd: root, env, timeout: 30000 });
  const packagedVersion = await application.evaluate(({ app }) => app.getVersion());
  assert.equal(packagedVersion, version, 'Verification must use the final package matching the source version');
  await application.firstWindow();
  let main;
  for (let index = 0; index < 100 && !main; index++) {
    main = application.windows().find(page => /\/index\.html(?:$|[?#])/.test(page.url()));
    if (!main) await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(main, 'Identify the main page by its own URL');
  await application.evaluate(({ ipcMain, session }) => {
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_event, done) => done({ cancel: true }));
    ipcMain.removeHandler('music:api');
    ipcMain.handle('music:api', () => ({ ok: true, data: { loggedIn: false, songs: [], playlists: [] } }));
  });

  const setup = await application.evaluate(async ({ app, BrowserWindow, screen, nativeTheme }) => {
    const require = process.mainModule.require.bind(process.mainModule);
    const path = require('node:path');
    const { createTaskbarLyrics } = require(path.join(app.getAppPath(), 'lib', 'taskbar-lyrics.cjs'));
    const beforeWindows = new Set(BrowserWindow.getAllWindows().map(window => window.id));
    const monitors = [];
    const controller = createTaskbarLyrics({
      BrowserWindow, screen, nativeTheme,
      uiFile: path.join(app.getAppPath(), 'ui', 'taskbar-lyrics.html'),
      preload: path.join(app.getAppPath(), 'taskbar-preload.cjs'),
      platform: 'win32', hiddenForTest: true,
      fullscreenMonitor({ onChange }) {
        const monitor = {
          onChange, starts: 0, stops: 0, disposals: 0,
          start() { this.starts++; },
          stop() { this.stops++; },
          dispose() { this.disposals++; },
        };
        monitors.push(monitor);
        return monitor;
      },
    });
    const window = BrowserWindow.getAllWindows().find(window => !beforeWindows.has(window.id));
    if (!window) throw new Error('The test controller must create its own native taskbar window');
    if (window.webContents.isLoading()) {
      await new Promise((resolve, reject) => {
        window.webContents.once('did-finish-load', resolve);
        window.webContents.once('did-fail-load', (_event, errorCode, description) => reject(new Error(`${errorCode}: ${description}`)));
      });
    }
    globalThis.__taskbarFullscreenFixture = { controller, window, monitors };
    return { packagedPath: app.getAppPath(), windowURL: window.webContents.getURL(), hidden: !window.isVisible() };
  });
  assert.match(setup.packagedPath, /app\.asar$/i, 'Controller must be loaded from the packaged ASAR');
  assert.match(setup.windowURL, /\/taskbar-lyrics\.html(?:$|[?#])/);
  assert.equal(setup.hidden, true);

  const snapshot = async label => {
    const value = await application.evaluate(() => {
      const { controller, window, monitors } = globalThis.__taskbarFullscreenFixture;
      return {
        status: controller.status(), state: controller.state(),
        native: { destroyed: window.isDestroyed(), visible: !window.isDestroyed() && window.isVisible(), alwaysOnTop: !window.isDestroyed() && window.isAlwaysOnTop() },
        monitors: monitors.map(monitor => ({ starts: monitor.starts, stops: monitor.stops, disposals: monitor.disposals })),
      };
    });
    assert.equal(value.native.visible, false, 'Verification must never expose a fixture on the desktop');
    snapshots.push({ label, ...value });
    return value;
  };
  const update = payload => application.evaluate((_electron, payload) => globalThis.__taskbarFullscreenFixture.controller.update(payload), payload);
  const change = (value, index = -1) => application.evaluate((_electron, { value, index }) => {
    const monitors = globalThis.__taskbarFullscreenFixture.monitors;
    const monitor = index < 0 ? monitors.at(index) : monitors[index];
    if (!monitor) throw new Error('Expected an active fake monitor');
    monitor.onChange(value);
  }, { value, index });

  const fixture = { text: '全屏时自动隐藏', title: '合成样例', kind: 'lyric', playing: true, enabled: true, visible: true, position: .5, sampledAt: Date.now(), lineStart: 0, lineEnd: 10, rate: 1 };
  await update(fixture);
  let value = await snapshot('checking-before-first-native-sample');
  check('Initial detection hides lyrics until the first sample', () => {
    assert.equal(value.status.placement, 'bottom');
    assert.equal(value.status.suppressed, true);
    assert.equal(value.status.suppressionReason, 'checking');
    assert.equal(value.status.eligible, false);
    assert.equal(value.native.alwaysOnTop, false);
    assert.equal(value.monitors.length, 1);
    assert.equal(value.monitors[0].starts, 1);
  });

  await change(false);
  value = await snapshot('normal-desktop');
  check('Normal desktop restores eligibility and topmost taskbar placement', () => {
    assert.equal(value.status.suppressed, false);
    assert.equal(value.status.suppressionReason, null);
    assert.equal(value.status.eligible, true);
    assert.equal(value.native.alwaysOnTop, true);
  });

  await change(true);
  value = await snapshot('fullscreen-enter');
  check('Fullscreen detection clears native always-on-top and eligibility', () => {
    assert.equal(value.status.suppressed, true);
    assert.equal(value.status.suppressionReason, 'fullscreen');
    assert.equal(value.status.eligible, false);
    assert.equal(value.native.alwaysOnTop, false);
  });

  await update({ text: '隐藏期间歌词仍然同步', position: 2.5, words: [], sampledAt: Date.now() });
  value = await snapshot('fullscreen-lyric-update');
  check('Lyric updates cannot bring the overlay back during fullscreen', () => {
    assert.equal(value.status.suppressed, true);
    assert.equal(value.status.suppressionReason, 'fullscreen');
    assert.equal(value.status.eligible, false);
    assert.equal(value.native.alwaysOnTop, false);
    assert.equal(value.state.text, '隐藏期间歌词仍然同步');
    assert.equal(value.state.position, 2.5);
    assert.equal(value.monitors.length, 1);
  });

  await change(false);
  value = await snapshot('fullscreen-exit');
  check('Leaving fullscreen restores the latest lyric without changing preferences', () => {
    assert.equal(value.status.suppressed, false);
    assert.equal(value.status.eligible, true);
    assert.equal(value.native.alwaysOnTop, true);
    assert.equal(value.status.enabled, true);
    assert.equal(value.state.text, '隐藏期间歌词仍然同步');
  });

  await change(true);
  await application.evaluate(() => globalThis.__taskbarFullscreenFixture.controller.setEnabled(false));
  const disabled = await snapshot('disabled-during-fullscreen');
  check('Turning lyrics off stops the detector and clears topmost state', () => {
    assert.equal(disabled.status.enabled, false);
    assert.equal(disabled.status.eligible, false);
    assert.equal(disabled.native.alwaysOnTop, false);
    assert.ok(disabled.monitors[0].stops + disabled.monitors[0].disposals > 0);
  });
  await change(false, 0);
  value = await snapshot('stale-fullscreen-exit-after-disable');
  check('A late fullscreen-exit callback cannot override the disabled preference', () => {
    assert.equal(value.status.enabled, false);
    assert.equal(value.status.eligible, false);
    assert.equal(value.native.alwaysOnTop, false);
    assert.equal(value.monitors.length, disabled.monitors.length);
  });

  await application.evaluate(() => globalThis.__taskbarFullscreenFixture.controller.setEnabled(true));
  value = await snapshot('reenabled-new-detector');
  check('Reenabling lyrics creates a fresh detector and waits for its sample', () => {
    assert.equal(value.status.suppressionReason, 'checking');
    assert.equal(value.status.eligible, false);
    assert.equal(value.native.alwaysOnTop, false);
    assert.equal(value.monitors.length, 2);
    assert.equal(value.monitors[1].starts, 1);
  });
  await change(true, 0);
  value = await snapshot('stale-fullscreen-callback-new-generation');
  check('A stale detector cannot suppress or resume a new generation', () => assert.equal(value.status.suppressionReason, 'checking'));
  await change(false);
  value = await snapshot('fresh-generation-ready');
  check('The fresh detector can restore the enabled lyric', () => {
    assert.equal(value.status.suppressed, false);
    assert.equal(value.status.eligible, true);
    assert.equal(value.native.alwaysOnTop, true);
  });

  await change(null);
  value = await snapshot('detection-unavailable');
  check('Unknown detector state hides rather than overlays fullscreen content', () => {
    assert.equal(value.status.suppressionReason, 'checking');
    assert.equal(value.status.eligible, false);
    assert.equal(value.native.alwaysOnTop, false);
  });
  await change(false);
  await update({ visible: false });
  value = await snapshot('no-visible-song');
  check('No visible song stops fullscreen polling', () => {
    assert.equal(value.status.eligible, false);
    assert.equal(value.native.alwaysOnTop, false);
    assert.ok(value.monitors[1].stops + value.monitors[1].disposals > 0);
  });
  await change(true, 1);
  await update({ visible: true });
  await change(false);
  value = await snapshot('song-restored');
  check('A later song starts a new monitor and resumes normally', () => {
    assert.equal(value.monitors.length, 3);
    assert.equal(value.status.eligible, true);
    assert.equal(value.native.alwaysOnTop, true);
  });

  await application.evaluate(() => globalThis.__taskbarFullscreenFixture.controller.dispose());
  value = await snapshot('disposed');
  check('Disposal destroys the caption and stops all detectors', () => {
    assert.equal(value.native.destroyed, true);
    assert.equal(value.status.eligible, false);
    for (const monitor of value.monitors) assert.ok(monitor.stops + monitor.disposals > 0);
  });
  await change(false);
  await update({ text: '不能重新创建窗口', visible: true, enabled: true });
  value = await snapshot('disposed-late-callback-and-update');
  check('Callbacks and updates after disposal cannot recreate the native caption', () => {
    assert.equal(value.native.destroyed, true);
    assert.equal(value.status.eligible, false);
    assert.equal(value.monitors.length, 3);
  });

  const nativeHelper = await application.evaluate(async ({ app }) => {
    const require = process.mainModule.require.bind(process.mainModule);
    const path = require('node:path');
    const fs = require('node:fs');
    const { execFile } = require('node:child_process');
    const { createFullscreenMonitor, watcherExecutable } = require(path.join(app.getAppPath(), 'lib', 'fullscreen-monitor.cjs'));
    const executable = watcherExecutable(app.getAppPath());
    if (!fs.existsSync(executable)) throw new Error('The native fullscreen helper must be present in the packaged unpacked directory');
    const selfTest = JSON.parse(await new Promise((resolve, reject) => {
      execFile(executable, ['--self-test'], { windowsHide: true, encoding: 'utf8', timeout: 5000, maxBuffer: 4096 }, (error, stdout) => error ? reject(error) : resolve(stdout.trim()));
    }));
    let timer, resolveSample, rejectSample;
    const changes = [];
    const samplePromise = new Promise((resolve, reject) => { resolveSample = resolve; rejectSample = reject; });
    const monitor = createFullscreenMonitor({
      executable,
      onChange(value, status) {
        changes.push({ value, status });
        if (typeof value === 'boolean') resolveSample({ value, status });
      },
    });
    try {
      timer = setTimeout(() => rejectSample(new Error('The packaged read-only fullscreen helper did not report a Windows sample')), 5000);
      monitor.start();
      const firstSample = await samplePromise;
      clearTimeout(timer);
      await new Promise(resolve => setTimeout(resolve, 350));
      const running = monitor.status();
      monitor.stop();
      const stopped = monitor.status();
      monitor.dispose();
      return { executable, selfTest, firstSample, running, stopped, changes };
    } finally {
      clearTimeout(timer);
      monitor.dispose();
    }
  });
  check('The actual packaged native classifier passes its geometry/shell self-tests', () => {
    assert.match(nativeHelper.executable, /app\.asar\.unpacked[\\/]native[\\/]fullscreen-watcher\.exe$/i);
    assert.equal(nativeHelper.selfTest.passed, true);
    assert.ok(nativeHelper.selfTest.checks >= 20);
  });
  check('The actual native helper reports and stops without desktop interaction', () => {
    assert.equal(typeof nativeHelper.firstSample.value, 'boolean');
    assert.equal(nativeHelper.firstSample.status.ready, true);
    assert.equal(nativeHelper.running.running, true);
    assert.equal(nativeHelper.stopped.running, false);
    assert.equal(nativeHelper.stopped.ready, false);
  });

  const result = { status: 'PASS', version: packagedVersion, fixture: 'Actual packaged controller/native BrowserWindow, injected fullscreen detector, hidden and isolated', setup, checks, snapshots, nativeHelper };
  fs.writeFileSync(path.join(output, 'fullscreen-behavior.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ status: result.status, version: result.version, checks: checks.length, report: path.join(output, 'fullscreen-behavior.json') }));
})().catch(error => {
  console.error(error.stack);
  process.exitCode = 1;
}).finally(async () => {
  await application?.evaluate(() => globalThis.__taskbarFullscreenFixture?.controller.dispose()).catch(() => {});
  await application?.close().catch(() => {});
});
