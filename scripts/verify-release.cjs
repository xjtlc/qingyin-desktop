'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = path.join(__dirname, '..');
const directory = path.resolve(process.argv[2] || path.join(root, 'dist', 'QingyinConcept-win32-x64'));
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

(async () => {
  const asar = await import('@electron/asar');
  const archive = path.join(directory, 'resources', 'app.asar');
  const extract = filename => asar.extractFile(archive, path.normalize(filename));
  const expected = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const actual = JSON.parse(extract('package.json').toString('utf8'));
  assert.equal(actual.version, expected.version);
  assert.equal(actual.name, expected.name);
  assert.equal(actual.main, expected.main);
  assert.deepEqual(actual.dependencies, expected.dependencies);
  // A root output exclusion must not remove a dependency's own dist directory.
  // Verify actual runtime entry points, rather than package metadata alone.
  for (const name of Object.keys(expected.dependencies)) {
    const packageDir = `node_modules/${name}`;
    const metadata = JSON.parse(extract(`${packageDir}/package.json`).toString('utf8'));
    const entryBase = path.posix.normalize(`${packageDir}/${metadata.main || 'index.js'}`);
    const entry = [entryBase, `${entryBase}.js`, `${entryBase}.cjs`, `${entryBase}.json`, `${entryBase}/index.js`].find(candidate => {
      const file = path.join(root, ...candidate.split('/'));
      return fs.existsSync(file) && fs.statSync(file).isFile();
    });
    assert.ok(entry, `Cannot locate source entry point for ${name}`);
    const source = path.join(root, ...entry.split('/'));
    assert.equal(digest(extract(entry)), digest(fs.readFileSync(source)), `Missing or mismatched runtime dependency: ${name}`);
  }
  // Packager rewrites the manifest while pruning development dependencies.
  const files = ['main.cjs', 'preload.cjs', 'lib/audio.cjs', 'lib/kugou.cjs', 'lib/stream.cjs', 'lib/mpv.cjs', 'lib/sleep-timer.cjs', 'ui/index.html', 'ui/app.js', 'ui/player-state.js', 'ui/library-state.js', 'ui/search-history.js', 'ui/search-history-panel.js', 'ui/search-history-panel.css', 'ui/comfort.css', 'ui/list-controls.css', 'ui/styles.css', 'ui/harmony.css', 'ui/palette.css'];
  for (const filename of files) assert.equal(digest(extract(filename)), digest(fs.readFileSync(path.join(root, filename))), `Packaged file mismatch: ${filename}`);
  const accidental = asar.listPackage(archive).filter(filename => /^[/\\](?:test-output|dist|tests|scripts|cache)[/\\]/.test(filename) || /(?:^|[/\\])account\.enc$/.test(filename));
  assert.deepEqual(accidental, []);
  const executable = path.join(directory, 'resources', 'app.asar.unpacked', 'vendor', 'mpv', 'mpv.exe');
  assert.equal(digest(fs.readFileSync(executable)), digest(fs.readFileSync(path.join(root, 'vendor', 'mpv', 'mpv.exe'))));
  assert.equal(fs.readFileSync(path.join(directory, '使用说明.md'), 'utf8'), fs.readFileSync(path.join(root, 'README.md'), 'utf8'));
  console.log(JSON.stringify({ version: actual.version, matchingSourceFiles: files.length, runtimeDependencies: Object.keys(expected.dependencies).length, bundledMpv: 'PASS', excludedTestData: 'PASS', documentation: 'PASS' }));
})().catch(error => { console.error(error.message); process.exit(1); });
