const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const axios = require('axios');
process.env.platform = 'lite';
app.setName('青音概念桌面版');
app.setPath('userData', path.join(app.getPath('appData'), '青音概念桌面版'));
app.whenReady().then(async () => {
  try {
    const accountPath = path.join(app.getPath('appData'), 'QingyinConcept', 'account.enc');
    console.log(JSON.stringify({ accountExists: fs.existsSync(accountPath), encryptionAvailable: safeStorage.isEncryptionAvailable(), appData: app.getPath('appData') }));
    const session = JSON.parse(safeStorage.decryptString(fs.readFileSync(accountPath)));
    const { createKugouAdapter } = require('../lib/kugou.cjs');
    const api = createKugouAdapter({ loadSession: () => session, saveSession: () => {} });
    const status = await api.invoke('status');
    console.log(JSON.stringify({ loggedIn: status.data?.loggedIn, concept: status.data?.platform === 'lite' }));
    const search = await api.invoke('search', { keyword: process.argv[2] || '送别' });
    console.log(JSON.stringify({ searchOK: search.ok, count: search.data?.songs?.length, error: search.error }));
    if (!search.ok) return;
    for (const song of search.data.songs.slice(0, 3)) {
      const result = await api.invoke('songUrl', song);
      if (!result.ok) { console.log(JSON.stringify({ stage: 'songUrl', ok: false, code: result.code, error: result.error })); continue; }
      const url = new URL(result.data.url);
      try {
        const response = await axios.get(url.href, { headers: { Range: 'bytes=0-1023' }, responseType: 'stream', timeout: 15000, validateStatus: () => true });
        const chunks = []; let length = 0;
        for await (const chunk of response.data) { chunks.push(chunk); length += chunk.length; if (length >= 1024) break; }
        response.data.destroy();
        const head = Buffer.concat(chunks).subarray(0, 48);
        console.log(JSON.stringify({ stage: 'media', host: url.hostname, extension: path.extname(url.pathname), status: response.status, mime: response.headers['content-type'], range: response.headers['content-range'], headerHex: head.toString('hex'), text: /^[\x20-\x7e\r\n\t]+$/.test(head.toString('latin1')) ? head.toString('latin1') : undefined, preview: result.data.preview }));
      } catch (error) {
        console.log(JSON.stringify({ stage: 'media', host: url.hostname, error: error.code || 'NETWORK_FAILED' }));
        if (error.code === 'ERR_TLS_CERT_ALTNAME_INVALID') {
          url.protocol = 'http:';
          try {
            const response = await axios.get(url.href, { headers: { Range: 'bytes=0-1023' }, responseType: 'stream', timeout: 10000, validateStatus: () => true });
            const chunks = []; let length = 0;
            for await (const chunk of response.data) { chunks.push(chunk); length += chunk.length; if (length >= 1024) break; }
            response.data.destroy();
            console.log(JSON.stringify({ stage: 'original-http', host: url.hostname, status: response.status, mime: response.headers['content-type'], headerHex: Buffer.concat(chunks).subarray(0, 16).toString('hex') }));
          } catch (fallback) { console.log(JSON.stringify({ stage: 'original-http', error: fallback.code || 'NETWORK_FAILED' })); }
        }
      }
    }
  } catch (error) { console.log(JSON.stringify({ diagnostics: 'failed', errorType: error.name, code: error.code || '', message: String(error.message).replace(/https?:\/\/\S+/g, '[URL]').slice(0, 300) })); }
}).finally(() => app.quit());
