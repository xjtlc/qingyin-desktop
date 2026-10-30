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
    const api = createKugouAdapter({ loadSession: () => session, saveSession: () => {} });
    const result = await api.invoke('playlists', { page: 1 });
    const liked = result.data?.playlists?.find(p => p.title === '我喜欢') || result.data?.playlists?.find(p => /喜欢/.test(p.title));
    if (!liked?.listId) { console.log(JSON.stringify({ likedFound: false })); return; }
    const upstream = path.join(__dirname, '..', 'vendor', 'kugou-api');
    const { createRequest } = require(path.join(upstream, 'util', 'request'));
    const response = await require(path.join(upstream, 'module', 'playlist_track_all_new'))({ listid: liked.listId, type: liked.type, page: 1, pagesize: 300, cookie: { ...session.cookie } }, createRequest);
    const body = response.body;
    const arrays = ['data.info', 'data.songs', 'data.list', 'data.lists', 'data.files', 'data', 'songs', 'info'];
    const rows = arrays.map(p => p.split('.').reduce((o, k) => o?.[k], body)).find(Array.isArray) || [];
    const fields = new Set();
    const walk = (object, prefix = '', depth = 0) => {
      for (const [key, value] of Object.entries(object || {})) {
        const field = prefix + key;
        if (/^(?:(?:add|create|collect|file|update|modify|last|play).*?(?:time|at)|.*(?:sort|order|weight|position)|idx|index)$/i.test(key) && Number.isFinite(Number(value)) && value !== '' && value !== null) fields.add(field);
        else if (value && typeof value === 'object' && !Array.isArray(value) && depth < 2) walk(value, field + '.', depth + 1);
      }
    };
    rows.slice(0, 3).forEach(row => walk(row));
    const ordering = [...fields].map(field => {
      const values = rows.map(row => field.split('.').reduce((o, k) => o?.[k], row)).filter(v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))).map(Number);
      return { field, count: values.length, ascending: values.every((v, i) => !i || v >= values[i - 1]), descending: values.every((v, i) => !i || v <= values[i - 1]), distinct: new Set(values).size };
    });
    console.log(JSON.stringify({ likedFound: true, rowCount: rows.length, total: body?.data?.count || body?.data?.total, rowFields: Object.keys(rows[0] || {}), ordering }));
  } catch (error) { console.log(JSON.stringify({ diagnostics: 'failed', type: error.name, code: error.publicCode || '' })); process.exitCode = 1; }
}).finally(() => app.quit());
