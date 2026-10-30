const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');
(async () => {
  const version = require('electron/package.json').version;
  const name = `electron-v${version}-win32-x64.zip`;
  const target = path.join(__dirname, '..', 'cache', name);
  const expected = require('electron/checksums.json')[name];
  let completed = 0;
  let last = Date.now();
  const url = process.argv[2] || `https://github.com/electron/electron/releases/download/v${version}/${name}`;
  const result = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!result.ok) throw new Error(`Download failed: ${result.status}`);
  const total = Number(result.headers.get('content-length'));
  const hash = crypto.createHash('sha256');
  await pipeline(Readable.fromWeb(result.body), async function* (source) {
    for await (const chunk of source) {
      hash.update(chunk); completed += chunk.length;
      if (Date.now() - last > 10000) { console.log(`Electron: ${Math.round(completed / total * 100)}%`); last = Date.now(); }
      yield chunk;
    }
  }, fs.createWriteStream(target));
  if (hash.digest('hex') !== expected) throw new Error('Electron checksum mismatch');
  console.log('Electron 下载及 SHA256 校验完成');
})().catch(error => { console.error(error.message); process.exit(1); });
