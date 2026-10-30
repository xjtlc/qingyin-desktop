'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');

async function buildFullscreenWatcher(options = {}) {
  const root = options.root || path.join(__dirname, '..');
  const source = path.join(root, 'native', 'fullscreen-watcher.cs');
  const executable = path.join(root, 'native', 'fullscreen-watcher.exe');
  const windows = process.env.SystemRoot || 'C:\\Windows';
  const compiler = options.compiler || path.join(windows, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  await fs.access(source); await fs.access(compiler);
  await new Promise((resolve, reject) => {
    execFile(compiler, ['/nologo', '/optimize+', '/target:exe', '/platform:anycpu', '/out:' + executable, source],
      { windowsHide: true, encoding: 'utf8', timeout: 30000, maxBuffer: 65536 },
      (error, stdout, stderr) => error ? reject(new Error('Fullscreen watcher build failed: ' + (stdout || stderr || error.message).trim())) : resolve());
  });
  await fs.access(executable);
  return executable;
}

module.exports = { buildFullscreenWatcher };
if (require.main === module) buildFullscreenWatcher().then(file => console.log('Built: ' + file)).catch(error => { console.error(error.message); process.exitCode = 1; });
