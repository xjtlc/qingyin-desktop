const path = require('node:path');
const fs = require('node:fs');

(async () => {
  await require('./build-fullscreen-watcher.cjs').buildFullscreenWatcher();
  const { packager } = await import('@electron/packager');
  const paths = await packager({
    dir: path.join(__dirname, '..'), out: process.env.QINGYIN_BUILD_OUTPUT || path.join(__dirname, '..', 'dist'),
    name: 'QingyinConcept', executableName: 'QingyinConcept', platform: 'win32', arch: 'x64',
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
    electronZipDir: fs.existsSync(path.join(__dirname, '..', 'cache', `electron-v${require('electron/package.json').version}-win32-x64.zip`)) ? path.join(__dirname, '..', 'cache') : undefined,
    overwrite: true, asar: { unpackDir: '{vendor/mpv,native}' }, prune: true,
    ignore: [/^[/\\]vendor[/\\]kugou-api[/\\]\.git/, /^[/\\]vendor[/\\]kugou-api[/\\](docs|public|\.github)/, /^[/\\]vendor[/\\]mpv[/\\](doc|installer)/, /^[/\\](test-output|dist|cache|tests|scripts|restore-tools)(?:[/\\]|$)/, /\.log$/],
    win32metadata: { CompanyName: 'Qingyin Local', FileDescription: '青音 · 概念桌面版', ProductName: '青音概念桌面版' },
  });
  for (const output of paths) fs.copyFileSync(path.join(__dirname, '..', 'README.md'), path.join(output, '使用说明.md'));
  console.log('已构建：' + paths.join('\n'));
})().catch(error => { console.error(error.message); process.exit(1); });
