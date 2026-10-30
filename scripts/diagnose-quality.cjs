const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
process.env.platform = 'lite';
app.setName('青音概念桌面版');
app.setPath('userData', path.join(app.getPath('appData'), '青音概念桌面版'));
app.whenReady().then(async () => {
  try {
    const session = JSON.parse(safeStorage.decryptString(fs.readFileSync(path.join(app.getPath('appData'), 'QingyinConcept', 'account.enc'))));
    const { createKugouAdapter } = require('../lib/kugou.cjs');
    const { createStreamManager } = require('../lib/stream.cjs');
    const streams = createStreamManager();
    const api = createKugouAdapter({ loadSession: () => session, saveSession: () => {}, resolveStream: async metadata => {
      console.log(JSON.stringify({ stage: 'source', format: metadata.extName, duration: metadata.duration, fileSize: metadata.fileSize, quality: metadata.quality }));
      const resolved = await streams.prepare(metadata);
      console.log(JSON.stringify({ stage: 'verified', mime: resolved.mime, quality: resolved.quality }));
      return resolved;
    } });
    const keyword = process.argv[3] || '送别';
    const index = Number.isInteger(Number(process.argv[4])) && Number(process.argv[4]) >= 0 ? Number(process.argv[4]) : 2;
    const search = await api.invoke('search', { keyword });
    if (!search.ok || !search.data.songs[index]) throw new Error('Search unavailable');
    const song = search.data.songs[index];
    console.log(JSON.stringify({ stage: 'selection', title: song.title, artist: song.artist }));
    const quality = process.argv[2] || 'max';
    const result = await api.invoke('songUrl', { ...song, quality });
    if (!result.ok) { console.log(JSON.stringify({ stage: 'result', ok: false, code: result.code })); return; }
    console.log(JSON.stringify({ stage: 'result', ok: true, requested: quality, mime: result.data.mime, format: result.data.extName, duration: result.data.duration, preview: result.data.preview, quality: result.data.quality }));
  } catch (error) { console.log(JSON.stringify({ diagnostics: 'failed', type: error.name, code: error.publicCode || '' })); process.exitCode = 1; }
}).finally(() => app.quit());
