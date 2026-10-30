const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createStreamManager, audioType, audioInfo, validateURL } = require('../lib/stream.cjs');
test('normal audio headers are recognized while HTML and encrypted files are rejected', () => {
  assert.equal(audioType(Buffer.from('ID3\x03\0\0')), 'audio/mpeg');
  assert.equal(audioType(Buffer.from([255, 251, 144, 0])), 'audio/mpeg');
  assert.equal(audioType(Buffer.from('OggS\0')), 'audio/ogg');
  assert.equal(audioType(Buffer.from('fLaC\0')), 'audio/flac');
  assert.equal(audioType(Buffer.from('<html>Denied</html>')), '');
  assert.equal(audioType(Buffer.from('7cd532eb86027f4b', 'hex')), '');
});
test('only ordinary platform CDN addresses are accepted', () => {
  assert.equal(validateURL('http://fs.youthandroid2.kugou.com/test.mp3'), 'http://fs.youthandroid2.kugou.com/test.mp3');
  for (const url of ['http://127.0.0.1/a', 'https://kugou.com.evil.test/a', 'file:///C:/secret', 'https://user:pass@fs.kugou.com/a', 'https://fs.kugou.com:8000/a']) assert.equal(validateURL(url), null);
});
test('stream verification uses original HTTP and backup CDN and returns an opaque URL', async () => {
  const calls = [];
  const manager = createStreamManager({ request: async config => {
    calls.push(config);
    return { status: config.url.includes('/bad') ? 403 : 206, headers: { 'content-type': 'application/octet-stream', 'content-range': 'bytes 0-31/1000', 'content-length': '32' }, data: Readable.from(Buffer.from('ID3' + 'x'.repeat(29))) };
  } });
  const stream = await manager.prepare({ urls: ['http://fs.kugou.com/bad', 'http://fs.kugou.com/good'], duration: 123, preview: false });
  assert.match(stream.url, /^qingyin-stream:\/\/track\/[a-f0-9]{32}$/);
  assert.equal(stream.mime, 'audio/mpeg'); assert.equal(stream.duration, 123); assert.equal(stream.urls, undefined);
  assert.equal(calls[1].url, 'http://fs.kugou.com/good');
  assert.equal(calls[1].maxContentLength, -1);
  const response = await manager.handle(new Request(stream.url, { headers: { Origin: 'file://', Range: 'bytes=0-31' } }));
  assert.equal(response.status, 206); assert.equal(response.headers.get('content-type'), 'audio/mpeg');
  assert.equal((await response.arrayBuffer()).byteLength, 32);
  assert.equal(calls[2].headers.Range, 'bytes=0-31');
  assert.equal(calls[2].maxContentLength, -1);
});
test('verification rejects nonaudio responses and redirects outside the platform', async () => {
  const manager = createStreamManager({ request: async () => ({ status: 200, headers: {}, data: Readable.from(Buffer.from('<html>Forbidden</html>')) }) });
  await assert.rejects(manager.prepare({ urls: ['http://fs.kugou.com/a'] }), error => error.publicCode === 'UNSUPPORTED_AUDIO');
  const redirected = createStreamManager({ request: async () => ({ status: 302, headers: { location: 'http://127.0.0.1/internal' }, data: Readable.from([]) }) });
  await assert.rejects(redirected.prepare({ urls: ['http://fs.kugou.com/a'] }), error => error.publicCode === 'MEDIA_UNAVAILABLE');
});

test('probe deadline destroys a response stalled after headers', async () => {
  let body, signal;
  const manager = createStreamManager({ prepareTimeoutMs: 30, request: async config => {
    signal = config.signal;
    body = new Readable({ read() {} });
    return { status: 206, headers: {}, data: body };
  } });
  await assert.rejects(manager.prepare({ urls: ['http://fs.kugou.com/stalled'] }), error => error.publicCode === 'MEDIA_UNAVAILABLE');
  assert.equal(body.destroyed, true);
  assert.equal(signal.aborted, true);
});

test('redirect hops share one probe deadline and cancellation signal', async () => {
  const signals = [];
  const manager = createStreamManager({ prepareTimeoutMs: 35, request: config => new Promise((resolve, reject) => {
    signals.push(config.signal);
    const cancel = () => { clearTimeout(timer); reject(new Error('Aborted')); };
    const timer = setTimeout(() => {
      config.signal.removeEventListener('abort', cancel);
      resolve({ status: 302, headers: { location: '/another-hop' }, data: Readable.from([]) });
    }, 20);
    config.signal.addEventListener('abort', cancel, { once: true });
  }) });
  await assert.rejects(manager.prepare({ urls: ['http://fs.kugou.com/redirect'] }), error => error.publicCode === 'MEDIA_UNAVAILABLE');
  assert.equal(signals.length, 2);
  assert.equal(signals[0], signals[1]);
  assert.equal(signals[1].aborted, true);
});

test('a stalled forwarded body times out and closes its CDN connection', async () => {
  let body, signal, calls = 0;
  const manager = createStreamManager({ streamIdleTimeoutMs: 30, request: async config => {
    calls++;
    signal = config.signal;
    body = calls === 1 ? Readable.from(Buffer.from('ID3probe')) : new Readable({ read() {} });
    return { status: 200, headers: {}, data: body };
  } });
  const stream = await manager.prepare({ urls: ['http://fs.kugou.com/a'] });
  const response = await manager.handle(new Request(stream.url));
  await assert.rejects(response.arrayBuffer());
  assert.equal(body.destroyed, true);
  assert.equal(signal.aborted, true);
});

test('healthy long streams are not subject to an overall playback deadline', async () => {
  let calls = 0;
  const manager = createStreamManager({ streamIdleTimeoutMs: 35, request: async () => {
    calls++;
    const body = calls === 1 ? Readable.from(Buffer.from('ID3probe')) : Readable.from((async function* () {
      for (let i = 0; i < 8; i++) { await new Promise(resolve => setTimeout(resolve, 10)); yield Buffer.alloc(100, i); }
    })());
    return { status: 200, headers: {}, data: body };
  } });
  const stream = await manager.prepare({ urls: ['http://fs.kugou.com/a'] });
  const response = await manager.handle(new Request(stream.url));
  assert.equal((await response.arrayBuffer()).byteLength, 800);
});

test('cancelling a renderer response closes the upstream body and request', async () => {
  let body, signal, calls = 0;
  const manager = createStreamManager({ streamIdleTimeoutMs: 1000, request: async config => {
    calls++;
    signal = config.signal;
    body = calls === 1 ? Readable.from(Buffer.from('ID3probe')) : new Readable({ read() {} });
    return { status: 200, headers: {}, data: body };
  } });
  const stream = await manager.prepare({ urls: ['http://fs.kugou.com/a'] });
  const response = await manager.handle(new Request(stream.url));
  await response.body.cancel();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(body.destroyed, true);
  assert.equal(signal.aborted, true);
});

test('MPEG frame headers govern actual bitrate and sample rate despite lossless hints', () => {
  const standard = audioInfo(Buffer.from([255, 251, 144, 0]), { format: 'flac', bitrateKbps: 3108 });
  assert.equal(standard.format, 'mp3');
  assert.equal(standard.bitrateKbps, 128);
  assert.equal(standard.sampleRateHz, 44100);
  assert.equal(standard.bitDepth, 0);
  assert.equal(standard.label, 'MP3 · 128 kbps');
  const high = audioInfo(Buffer.from([255, 251, 224, 0]));
  assert.equal(high.bitrateKbps, 320);
});

test('FLAC STREAMINFO supplies real depth, rate and duration independently of bitrate hints', () => {
  const bytes = Buffer.alloc(42); bytes.write('fLaC'); bytes[4] = 128; bytes.writeUIntBE(34, 5, 3);
  bytes.writeBigUInt64BE((96000n << 44n) | (1n << 41n) | (23n << 36n) | (96000n * 200n), 18);
  const info = audioInfo(bytes, { bitrateKbps: 128, fileSize: 77700000, duration: 999 });
  assert.equal(info.format, 'flac');
  assert.equal(info.sampleRateHz, 96000);
  assert.equal(info.bitDepth, 24);
  assert.equal(info.duration, 200);
  assert.equal(info.bitrateKbps, 3108);
  assert.equal(info.label, 'FLAC 无损 · 24 bit / 96 kHz');
});

test('large ID3 tags do not manufacture a bitrate or sample depth', () => {
  const bytes = Buffer.alloc(20); bytes.write('ID3'); bytes[3] = 4; bytes[8] = 50;
  bytes.set([255, 251, 224, 0], 12);
  const info = audioInfo(bytes, { bitrateKbps: 128 });
  assert.equal(info.bitrateKbps, 128);
  assert.equal(info.sampleRateHz, 0);
  assert.equal(info.bitDepth, 0);
});
