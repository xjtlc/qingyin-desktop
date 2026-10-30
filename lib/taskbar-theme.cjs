'use strict';
const { execFile } = require('node:child_process');

function parseWindowsTaskbarTheme(output) {
  const match = String(output || '').match(/^\s*SystemUsesLightTheme\s+REG_DWORD\s+(0x[0-9a-f]+)\s*$/im);
  if (!match) return null;
  const value = Number.parseInt(match[1], 16);
  return value === 0 ? 'dark' : value === 1 ? 'light' : null;
}

// Windows permits a light application theme alongside a dark taskbar. Read
// the system choice directly because some Chromium versions expose app mode
// through both nativeTheme properties. This never changes Windows settings.
function readWindowsTaskbarTheme(options = {}) {
  if ((options.platform || process.platform) !== 'win32') return Promise.resolve(null);
  const run = options.execFile || execFile;
  return new Promise(resolve => {
    try {
      run('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', '/v', 'SystemUsesLightTheme'],
        { windowsHide: true, encoding: 'utf8', timeout: 2000, maxBuffer: 65536 },
        (error, stdout) => resolve(error ? null : parseWindowsTaskbarTheme(stdout)));
    } catch { resolve(null); }
  });
}

module.exports = { parseWindowsTaskbarTheme, readWindowsTaskbarTheme };
