'use strict';
const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
process.env.platform = 'lite';
app.setName('青音概念桌面版');
app.setPath('userData', path.join(app.getPath('appData'), '青音概念桌面版'));
app.whenReady().then(async () => {
  try {
    const session = JSON.parse(safeStorage.decryptString(fs.readFileSync(path.join(app.getPath('appData'), 'QingyinConcept', 'account.enc'))));
    const { createKugouAdapter } = require('../lib/kugou.cjs');
    const adapter = createKugouAdapter({ loadSession: () => session, saveSession: () => {} });
    const library = await adapter.invoke('playlists');
    if (!library.ok) throw new Error('PLAYLISTS_UNAVAILABLE');
    const list = library.data.playlists.find(item => item.title === '做梦') || library.data.playlists.find(item => item.title === '我喜欢');
    if (!list?.listId) throw new Error('TARGET_PLAYLIST_UNAVAILABLE');
    const vendor = path.join(root, 'vendor', 'kugou-api');
    const { createRequest } = require(path.join(vendor, 'util', 'request'));
    const fetchPage = require(path.join(vendor, 'module', 'playlist_track_all_new'));
    const first = (...values) => values.find(value => value !== undefined && value !== null && value !== '');
    const identity = row => {
      const item = row?.base || row?.song || row || {};
      const hash = String(first(item.FileHash, item.filehash, item.hash, item.file_hash, row?.hash) || '').trim().toUpperCase();
      const audioId = String(first(item.AlbumAudioID, item.album_audio_id, item.album_audioid, item.mixsongid, item.add_mixsongid, row?.album_audio_id) || '');
      return hash ? `${hash}:${audioId}` : '';
    };
    const result = { title: list.title, declaredCount: list.count, pages: [], totalRaw: 0, totalWithHash: 0, duplicateIdentities: 0 };
    const identities = new Set();
    for (let page = 1; page <= 4; page += 1) {
      const response = await fetchPage({ listid: list.listId, type: list.type, page, pagesize: 300, cookie: { ...session.cookie } }, createRequest);
      const body = response.body;
      const rows = ['data.info', 'data.songs', 'data.list', 'data.lists', 'data.files', 'data', 'songs', 'info'].map(field => field.split('.').reduce((object, key) => object?.[key], body)).find(Array.isArray) || [];
      const total = Number(first(body?.data?.count, body?.data?.total)) || list.count;
      const missing = rows.filter(row => !identity(row));
      let duplicates = 0;
      for (const row of rows) {
        const key = identity(row);
        if (!key) continue;
        if (identities.has(key)) duplicates += 1;
        identities.add(key);
      }
      result.pages.push({ page, rawCount: rows.length, withHash: rows.length - missing.length, duplicates, total,
        paginationFields: Object.keys(body?.data || {}).filter(key => /page|size|total|count|more|next/i.test(key)),
        missingHashRows: missing.map(row => {
          const item = row?.base || row?.song || row || {};
          return { fields: Object.keys(item), hasTitle: Boolean(first(item.SongName, item.songname, item.song_name, item.audio_name, item.title, item.filename, item.file_name, item.FileName, item.name)), hasAudioId: Boolean(first(item.album_audio_id, item.mixsongid, item.add_mixsongid)), hashInNestedFile: Boolean(item.file?.hash || item.audio_info?.hash) };
        }) });
      result.totalRaw += rows.length;
      result.totalWithHash += rows.length - missing.length;
      result.duplicateIdentities += duplicates;
      if (!rows.length || page * 300 >= total) break;
    }
    fs.writeFileSync(path.join(root, 'test-output', 'playlist-pages-diagnostics.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } catch { console.error('Read-only playlist diagnostics failed'); process.exitCode = 1; }
}).finally(() => app.quit());
