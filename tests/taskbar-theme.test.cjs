'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseWindowsTaskbarTheme, readWindowsTaskbarTheme } = require('../lib/taskbar-theme.cjs');

test('Windows system theme is parsed independently of app light mode', () => {
  assert.equal(parseWindowsTaskbarTheme('HKEY_CURRENT_USER\\Software\\Themes\r\n    AppsUseLightTheme    REG_DWORD    0x1\r\n    SystemUsesLightTheme    REG_DWORD    0x0\r\n'), 'dark');
  assert.equal(parseWindowsTaskbarTheme('    SystemUsesLightTheme    REG_DWORD    0x00000001\r\n'), 'light');
  assert.equal(parseWindowsTaskbarTheme('    AppsUseLightTheme    REG_DWORD    0x1\r\n'), null);
  assert.equal(parseWindowsTaskbarTheme('    SystemUsesLightTheme    REG_DWORD    0x2\r\n'), null);
  assert.equal(parseWindowsTaskbarTheme('    SystemUsesLightTheme    REG_SZ    0x0\r\n'), null);
});

test('read-only taskbar theme query is hidden, bounded and falls back on failure', async () => {
  let calls = 0;
  const result = await readWindowsTaskbarTheme({ platform: 'win32', execFile(file, args, options, callback) {
    calls++;
    assert.equal(file, 'reg.exe'); assert.equal(args[0], 'query'); assert.deepEqual(args.slice(-2), ['/v', 'SystemUsesLightTheme']);
    assert.equal(options.windowsHide, true); assert.equal(options.timeout, 2000); assert.equal(options.maxBuffer, 65536);
    callback(null, '    SystemUsesLightTheme    REG_DWORD    0x0\r\n');
  } });
  assert.equal(result, 'dark'); assert.equal(calls, 1);
  assert.equal(await readWindowsTaskbarTheme({ platform: 'win32', execFile(file, args, options, callback) { callback(new Error('not available')); } }), null);
  assert.equal(await readWindowsTaskbarTheme({ platform: 'linux', execFile() { throw new Error('must not run'); } }), null);
});
