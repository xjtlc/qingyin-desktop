'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { _electron } = require('./test-deps.cjs').loadTestDependency('playwright');
const root = path.resolve(__dirname, '..');
const version = require('../package.json').version;
const output = path.join(root, 'test-output', `quality-panel-${version}`);
fs.mkdirSync(output, { recursive: true });

// Only this isolated fixture profile and silent local WAV are used. The FLAC and
// MP3 labels below are simulated service metadata for UI states, not codec tests.
const wavFile = path.join(output, '音质面板静音验证.wav');
const rate = 44100, size = rate * 30 * 4, bytes = Buffer.alloc(44 + size);
bytes.write('RIFF'); bytes.writeUInt32LE(36 + size, 4); bytes.write('WAVE', 8);
bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(2, 22);
bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 4, 28); bytes.writeUInt16LE(4, 32); bytes.writeUInt16LE(16, 34);
bytes.write('data', 36); bytes.writeUInt32LE(size, 40); fs.writeFileSync(wavFile, bytes);
fs.writeFileSync(path.join(output, 'library.json'), JSON.stringify([{ path: wavFile }]));
fs.writeFileSync(path.join(output, 'preferences.json'), JSON.stringify({ preferences: { volume: 0, quality: 'viper_tape', output: 'browser', effects: 'off' }, favorites: [], history: [] }));
const audioId = crypto.createHash('sha256').update(path.resolve(wavFile).toLowerCase()).digest('hex').slice(0, 24);
const cover = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160"><rect width="160" height="160" fill="#6686a7"/><circle cx="80" cy="80" r="48" fill="#dce5ee"/><circle cx="80" cy="80" r="18" fill="#4c6178"/></svg>').toString('base64');
const song = { hash: 'quality-panel-fixture', albumId: 'fixture', albumAudioId: 1, title: '同手同脚 · 面板验证', artist: '隔离预览', album: '简洁音质面板', duration: 30, cover };
const warning = '服务返回权益限制提示，请以实际播放授权为准';
const tiers = [
  { id: 'auto', label: '自动（最高可播放）', group: 'auto', hint: '按这首歌的实际可用性自动挑选最高音质' },
  { id: 'viper_tape', label: '蝰蛇母带音质', group: 'svip', spec: '格式待确认 · 320 kbps · 待验证', entitlementHint: warning, offered: true, playable: null },
  { id: 'viper_clear', label: '蝰蛇超清音质', group: 'svip', spec: '格式待确认 · 3424 kbps · 待验证', entitlementHint: warning, offered: true, playable: null },
  { id: 'viper_atmos', label: '蝰蛇全景声 2.0', group: 'svip', spec: '格式待确认 · 1955 kbps（估算） · 待验证', entitlementHint: warning, offered: true, playable: null },
  { id: 'lossless', label: '无损音质', group: 'standard', spec: '服务标注 FLAC · 900 kbps · 待验证', offered: true, playable: null },
  { id: '320', label: '高品质', group: 'standard', spec: '服务标注 MP3 · 320 kbps · 待验证', offered: true, playable: null },
  { id: '128', label: '标准音质', group: 'standard', spec: '服务标注 MP3 · 128 kbps · 待验证', offered: true, playable: null },
].map(tier => ({ ...tier, selectable: true }));
const fixture = { song, tiers, url: `qingyin-audio://track/${audioId}`, preview: false, network: [], calls: [] };
function response(method, params = {}) {
  const fixture = globalThis.qualityPanelFixture;
  fixture.calls.push({ method, quality: params.quality });
  let data = {};
  if (method === 'status') data = { loggedIn: true, user: { id: 'fixture', name: '界面预览' }, platform: 'lite' };
  else if (method === 'recommendations') data = { playlists: [], songs: [] };
  else if (method === 'search') data = { songs: [fixture.song], total: 1 };
  else if (method === 'songQualities') data = { tiers: fixture.tiers };
  else if (method === 'songUrl') data = { url: fixture.url, duration: 30, preview: fixture.preview,
    quality: fixture.preview ? { format: 'mp3', bitrateKbps: 128, sampleRateHz: 44100, label: 'MP3 · 128 kbps', short: 'MP3 128kbps', streamVerified: true, fallback: true }
      : { format: 'flac', bitDepth: 16, sampleRateHz: 44100, label: 'FLAC 无损 · 16 bit / 44.1 kHz', short: 'FLAC 无损', streamVerified: true, fallback: true, tierVerified: false, delivered: 'flac' } };
  else if (method === 'playlists') data = { playlists: [], total: 0, hasMore: false };
  else if (method === 'lyrics') data = { lines: [], plain: [] };
  return { ok: true, data };
}
const bootstrap = path.join(output, 'fixture-bootstrap.cjs');
fs.writeFileSync(bootstrap, `const path=require('node:path');\nconst root=${JSON.stringify(root)};\nglobalThis.qualityPanelFixture=${JSON.stringify(fixture)};\nconst {app,session}=require('electron');\napp.whenReady().then(()=>session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(details,done)=>{globalThis.qualityPanelFixture.network.push('external request blocked');done({cancel:true});}));\nconst file=path.join(root,'lib','kugou.cjs');\nrequire.cache[require.resolve(file)]={id:file,filename:file,loaded:true,exports:{createKugouAdapter:()=>({invoke:async(method,params)=>(${response.toString()})(method,params)})}};\nrequire(path.join(root,'main.cjs'));\n`);
const env = { ...process.env, QINGYIN_TEST: '1', QINGYIN_TEST_DATA: output };
delete env.ELECTRON_RUN_AS_NODE; delete env.QINGYIN_TEST_ACCOUNT_READONLY;
let application, page;
const report = { version, fixture: 'isolated profile, simulated codec metadata and silent WAV; no production account or external network', screenshots: [], layouts: {}, rendererErrors: [] };
async function capture(name) {
  await page.waitForTimeout(130);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const png = await application.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'));
  const destination = path.join(output, `${name}.png`); fs.writeFileSync(destination, Buffer.from(png, 'base64')); report.screenshots.push(destination);
}
async function inspectLayout(name) {
  const data = await page.evaluate(() => {
    const panel = document.querySelector('#quality-panel'), content = document.querySelector('#quality-content');
    const rect = panel.getBoundingClientRect(), rows = [...content.querySelectorAll('.quality-option')];
    return { panel: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height }, viewport: [innerWidth, innerHeight], horizontalOverflow: content.scrollWidth - content.clientWidth,
      rows: rows.map(row => ({ label: row.innerText.trim(), width: row.getBoundingClientRect().width, overflow: row.scrollWidth - row.clientWidth, title: row.title, selected: row.getAttribute('aria-pressed') })),
      footer: document.querySelector('#quality-note').textContent, header: document.querySelector('#quality-current').textContent, background: getComputedStyle(panel).backgroundColor };
  });
  assert.equal(data.rows.length, 7);
  assert.ok(data.panel.top >= 0 && data.panel.left >= 0 && data.panel.right <= data.viewport[0] && data.panel.bottom <= data.viewport[1]);
  assert.ok(data.horizontalOverflow <= 1 && data.rows.every(row => row.overflow <= 1));
  assert.deepEqual(data.rows.map(row => row.label), tiers.map(tier => tier.label));
  assert.equal(data.rows.filter(row => row.selected === 'true').length, 1);
  assert.equal(data.rows.find(row => row.selected === 'true').label, '蝰蛇母带音质');
  assert.ok(data.rows.find(row => row.label === '蝰蛇母带音质').title.includes(warning));
  assert.ok(data.footer.length <= 24);
  assert.match(data.header, /播放：FLAC 无损 · 16bit \/ 44\.1kHz · 已回退/);
  assert.ok(!data.header.includes('蝰蛇母带'));
  report.layouts[name] = data;
}
(async () => {
  try {
    application = await _electron.launch({ executablePath: require('electron'), args: [bootstrap], cwd: root, env, timeout: 30000 });
    page = await application.firstWindow(); page.on('pageerror', error => report.rendererErrors.push(error.message));
    await page.waitForFunction(() => document.querySelector('#sidebar-account')?.textContent.includes('界面预览'));
    await application.evaluate(({ BrowserWindow }) => { const content = BrowserWindow.getAllWindows()[0].webContents; content.setBackgroundThrottling(false); return content.insertCSS('*,*::before,*::after{transition:none!important;animation:none!important}'); });
    await page.locator('#quality-tag').click();
    await page.locator('.quality-option').last().waitFor();
    for (const tier of tiers) {
      await page.locator(`[data-action="set-quality"][data-quality="${tier.id}"]`).click();
      assert.equal(await page.locator('#quality-current').textContent(), `所选：${tier.label}`);
      assert.equal(await page.locator(`[data-quality="${tier.id}"]`).getAttribute('aria-pressed'), 'true');
    }
    await page.locator('[data-quality="viper_tape"]').click();
    await page.locator('#quality-panel [data-action="quality"]').click();
    await page.locator('#search-input').fill('音质面板'); await page.locator('#search-input').press('Enter');
    await page.locator('.track-title[data-action="play-song"]').first().click();
    await page.waitForFunction(() => !document.querySelector('#audio').paused && document.querySelector('#audio').currentTime > .1 && document.querySelector('#quality-tag').textContent.includes('FLAC'));
    await page.locator('#play-button').click(); await page.locator('#quality-tag').click();
    const cdp = await page.context().newCDPSession(page);
    for (const scheme of ['light', 'dark']) {
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
      for (const [label, width, height] of [['full', 1080, 740], ['small', 920, 600]]) {
        await application.evaluate(({ BrowserWindow }, dimensions) => BrowserWindow.getAllWindows()[0].setSize(...dimensions), [width, height]);
        await page.locator('#quality-content').evaluate(node => { node.scrollTop = 0; });
        await inspectLayout(`${scheme}-${label}`); await capture(`${scheme}-${label}`);
        await page.locator('[data-quality="128"]').scrollIntoViewIfNeeded();
        assert.equal(await page.locator('[data-quality="128"]').isVisible(), true);
      }
    }
    await application.evaluate(() => { globalThis.qualityPanelFixture.preview = true; });
    await page.locator('[data-quality="128"]').click();
    await page.waitForFunction(() => document.querySelector('#quality-tag').textContent.includes('试听') && document.querySelector('#quality-current').textContent.includes('128kbps'));
    assert.equal(await page.locator('#quality-current').textContent(), '试听：MP3 128kbps · 已回退');
    assert.match(await page.locator('#quality-tag').getAttribute('aria-label'), /试听片段/);
    assert.equal(await page.locator('[data-quality="128"]').getAttribute('aria-pressed'), 'true');
    await capture('dark-small-preview');
    report.networkRequests = await application.evaluate(() => globalThis.qualityPanelFixture.network);
    assert.deepEqual(report.networkRequests, []); assert.deepEqual(report.rendererErrors, []);
    report.result = 'PASS'; console.log(JSON.stringify({ result: report.result, version, screenshots: report.screenshots, networkRequests: report.networkRequests, rendererErrors: report.rendererErrors }));
  } finally {
    if (application) await application.close();
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
