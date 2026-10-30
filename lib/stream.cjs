const axios = require('axios');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');

function validateURL(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || value.length > 8192) return null;
    if (url.port && !['80', '443'].includes(url.port)) return null;
    if (!['kugou.com', 'kugoucdn.com'].some(domain => host === domain || host.endsWith('.' + domain))) return null;
    return url.href;
  } catch { return null; }
}
function audioType(buffer) {
  const signature = buffer.subarray(0, 4).toString('ascii');
  if (buffer.subarray(0, 3).toString('ascii') === 'ID3') return 'audio/mpeg';
  if (signature === 'fLaC') return 'audio/flac';
  if (signature === 'OggS') return 'audio/ogg';
  if (signature === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WAVE') return 'audio/wav';
  if (buffer.subarray(4, 8).toString('ascii') === 'ftyp') return 'audio/mp4';
  if (buffer.length >= 4 && buffer[0] === 255 && (buffer[1] & 224) === 224) {
    if ((buffer[1] & 6) === 0 && (buffer[1] & 16) !== 0) return 'audio/aac';
    if ((buffer[1] & 6) !== 0 && ((buffer[2] >> 4) & 15) !== 15 && ((buffer[2] >> 2) & 3) !== 3) return 'audio/mpeg';
  }
  return '';
}
function qualityDetails(info = {}) {
  const format = String(info.format || '').toLowerCase();
  const bitrateKbps = Math.max(0, Math.round(Number(info.bitrateKbps) || 0));
  const sampleRateHz = Math.max(0, Math.round(Number(info.sampleRateHz) || 0));
  const bitDepth = format === 'mp3' ? 0 : Math.max(0, Math.round(Number(info.bitDepth) || 0));
  let label = format ? format.toUpperCase() : '音质待确认';
  if (['flac', 'wav'].includes(format)) {
    label += ' 无损';
    if (bitDepth && sampleRateHz) label += ` · ${bitDepth} bit / ${sampleRateHz / 1000} kHz`;
  } else if (bitrateKbps) label += ` · ${bitrateKbps} kbps`;
  return { format, bitrateKbps, sampleRateHz, bitDepth, label };
}
function audioInfo(buffer, hints = {}) {
  const mime = audioType(buffer);
  const formats = { 'audio/mpeg': 'mp3', 'audio/flac': 'flac', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/mp4': 'mp4', 'audio/aac': 'aac' };
  const info = { format: formats[mime] || '', bitrateKbps: Number(hints.bitrateKbps) || 0, sampleRateHz: 0, bitDepth: 0 };
  let duration = Number(hints.duration) || 0;
  if (mime === 'audio/flac' && buffer.length >= 42 && (buffer[4] & 127) === 0 && buffer.readUIntBE(5, 3) === 34) {
    // RFC 9639 section 8.2: STREAMINFO's packed rate/channels/depth/sample count.
    const packed = buffer.readBigUInt64BE(18);
    info.sampleRateHz = Number(packed >> 44n);
    info.bitDepth = Number((packed >> 36n) & 31n) + 1;
    const samples = Number(packed & ((1n << 36n) - 1n));
    if (info.sampleRateHz > 0 && samples > 0) duration = samples / info.sampleRateHz;
  } else if (mime === 'audio/mpeg') {
    let start = 0;
    if (buffer.subarray(0, 3).toString('ascii') === 'ID3') {
      start = buffer.length >= 10 ? 10 + ((buffer[6] & 127) * 2097152 + (buffer[7] & 127) * 16384 + (buffer[8] & 127) * 128 + (buffer[9] & 127)) + (buffer[5] & 16 ? 10 : 0) : buffer.length;
    }
    for (let offset = start; offset + 4 <= buffer.length; offset++) {
      const b1 = buffer[offset + 1], b2 = buffer[offset + 2], b3 = buffer[offset + 3];
      const version = (b1 >> 3) & 3, layer = (b1 >> 1) & 3, index = b2 >> 4, rateIndex = (b2 >> 2) & 3;
      if (buffer[offset] !== 255 || (b1 & 224) !== 224 || version === 1 || !layer || !index || index === 15 || rateIndex === 3) continue;
      const tables = version === 3 ? {
        3: [0,32,64,96,128,160,192,224,256,288,320,352,384,416,448],
        2: [0,32,48,56,64,80,96,112,128,160,192,224,256,320,384],
        1: [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320],
      } : { 3: [0,32,48,56,64,80,96,112,128,144,160,176,192,224,256], 2: [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160], 1: [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160] };
      info.bitrateKbps = tables[layer][index];
      info.sampleRateHz = [44100,48000,32000][rateIndex] / (version === 3 ? 1 : version === 2 ? 2 : 4);
      // Xing stores track-wide byte/frame counts for VBR files; one frame's
      // bitrate alone is not the track's average bitrate.
      const sideInfo = version === 3 ? ((b3 >> 6) === 3 ? 17 : 32) : ((b3 >> 6) === 3 ? 9 : 17);
      const xing = offset + 4 + (b1 & 1 ? 0 : 2) + sideInfo;
      if (xing + 16 <= buffer.length && ['Xing', 'Info'].includes(buffer.subarray(xing, xing + 4).toString('ascii'))) {
        const flags = buffer.readUInt32BE(xing + 4);
        const frames = flags & 1 ? buffer.readUInt32BE(xing + 8) : 0;
        const bytesOffset = xing + 8 + (flags & 1 ? 4 : 0);
        const bytes = flags & 2 && bytesOffset + 4 <= buffer.length ? buffer.readUInt32BE(bytesOffset) : 0;
        if (frames) duration = frames * (version === 3 ? 1152 : 576) / info.sampleRateHz;
        if (bytes && duration) info.bitrateKbps = bytes * 8 / duration / 1000;
      }
      break;
    }
  } else if (mime === 'audio/wav' && buffer.length >= 36 && buffer.subarray(12, 16).toString('ascii') === 'fmt ') {
    info.sampleRateHz = buffer.readUInt32LE(24);
    info.bitDepth = buffer.readUInt16LE(34);
    info.bitrateKbps = buffer.readUInt32LE(28) * 8 / 1000;
  }
  if (mime === 'audio/flac' && duration && hints.fileSize) info.bitrateKbps = Number(hints.fileSize) * 8 / duration / 1000;
  return { mime, duration, ...qualityDetails(info) };
}
function mediaError(unsupported = false) {
  const error = new Error(unsupported ? 'Unsupported audio' : 'Media unavailable');
  error.publicCode = unsupported ? 'UNSUPPORTED_AUDIO' : 'MEDIA_UNAVAILABLE';
  error.publicMessage = unsupported ? '这首歌返回了暂不支持的音频格式，请在概念版 App 中播放。' : '音乐文件暂时无法读取，请点击播放重试。';
  return error;
}
function createStreamManager({ request = config => axios(config), now = () => Date.now(), prepareTimeoutMs = 12000, streamIdleTimeoutMs = 8000 } = {}) {
  const entries = new Map();
  async function fetchCDN(value, method = 'GET', range, timeout = 8000, signal) {
    let url = validateURL(value);
    if (!url) throw mediaError();
    for (let hop = 0; hop < 4; hop++) {
      if (signal?.aborted) throw mediaError();
      const response = await request({ url, method, headers: range ? { Range: range } : {}, responseType: 'stream', timeout, maxContentLength: -1, maxRedirects: 0, signal, validateStatus: () => true });
      if (signal?.aborted) { response.data?.destroy?.(); throw mediaError(); }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        response.data?.destroy?.();
        url = validateURL(new URL(response.headers.location || '', url).href);
        if (!url) throw mediaError();
        continue;
      }
      return { response, url };
    }
    throw mediaError();
  }
  async function prepare(metadata) {
    const urls = [...new Set([...(metadata.urls || []), metadata.url].filter(value => typeof value === 'string' && validateURL(value)))].slice(0, 8);
    let unsupported = false;
    const deadline = now() + prepareTimeoutMs;
    const controller = new AbortController();
    let currentBody;
    const timer = setTimeout(() => { controller.abort(); currentBody?.destroy?.(mediaError()); }, prepareTimeoutMs);
    try {
      for (const candidate of urls) {
        if (controller.signal.aborted || now() >= deadline) break;
        let response;
        try {
          const fetched = await fetchCDN(candidate, 'GET', 'bytes=0-4095', Math.max(1, Math.min(5000, deadline - now())), controller.signal);
          response = fetched.response;
          currentBody = response.data;
          if (![200, 206].includes(response.status)) { response.data.destroy(); continue; }
          const chunks = []; let count = 0;
          for await (const chunk of response.data) {
            chunks.push(chunk); count += chunk.length;
            if (count >= 4096) break;
          }
          response.data.destroy();
          if (controller.signal.aborted) break;
          const bytes = Buffer.concat(chunks).subarray(0, 4096);
          const actualSize = Number(/\/(\d+)$/.exec(response.headers['content-range'] || '')?.[1]) || (response.status === 200 ? Number(response.headers['content-length']) : 0) || metadata.fileSize;
          const info = audioInfo(bytes, { ...metadata, fileSize: actualSize });
          const mime = info.mime;
          if (!mime) { unsupported = true; continue; }
          const id = crypto.randomBytes(16).toString('hex');
          for (const [key, entry] of entries) if (entry.expiresAt < now()) entries.delete(key);
          while (entries.size >= 128) entries.delete(entries.keys().next().value);
          entries.set(id, { url: fetched.url, mime, expiresAt: now() + 7200000 });
          return { url: `qingyin-stream://track/${id}`, cover: metadata.cover || '', duration: info.duration || metadata.duration || 0, preview: Boolean(metadata.preview), mime, extName: info.format, quality: qualityDetails(info) };
        } catch { response?.data?.destroy?.(); }
        finally { currentBody = null; }
      }
      throw mediaError(unsupported);
    } finally { clearTimeout(timer); currentBody?.destroy?.(); controller.abort(); }
  }
  async function handle(requestData) {
    const url = new URL(requestData.url);
    const id = url.pathname.slice(1);
    const entry = url.hostname === 'track' && /^[a-f0-9]{32}$/.test(id) && entries.get(id);
    const origin = requestData.headers.get('Origin');
    if (origin && origin !== 'null' && origin !== 'file://') return new Response(null, { status: 403 });
    if (!entry || entry.expiresAt < now()) return new Response(null, { status: 404 });
    if (!['GET', 'HEAD'].includes(requestData.method)) return new Response(null, { status: 405 });
    const range = requestData.headers.get('Range');
    if (range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range)) return new Response(null, { status: 416 });
    const controller = new AbortController();
    let source;
    let idleTimer;
    const cleanup = () => { clearTimeout(idleTimer); requestData.signal?.removeEventListener('abort', cancel); };
    const cancel = () => { controller.abort(); source?.destroy?.(); };
    requestData.signal?.addEventListener('abort', cancel, { once: true });
    if (requestData.signal?.aborted) cancel();
    try {
      const { response } = await fetchCDN(entry.url, requestData.method, range, 8000, controller.signal);
      source = response.data;
      if (![200, 206].includes(response.status)) { source.destroy(); cleanup(); return new Response(null, { status: response.status === 416 ? 416 : 502 }); }
      const headers = new Headers({ 'Content-Type': entry.mime, 'Access-Control-Allow-Origin': origin || 'null', 'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
      for (const key of ['content-length', 'content-range']) if (response.headers[key]) headers.set(key, response.headers[key]);
      entry.expiresAt = now() + 7200000;
      if (requestData.method === 'HEAD') { source.destroy(); cleanup(); return new Response(null, { status: response.status, headers }); }
      const guarded = Readable.from((async function* () {
        const iterator = source[Symbol.asyncIterator]();
        try {
          while (true) {
            let next;
            try {
              next = await Promise.race([
                iterator.next(),
                new Promise((_, reject) => { idleTimer = setTimeout(() => { controller.abort(); source.destroy(); reject(mediaError()); }, streamIdleTimeoutMs); }),
              ]);
            } finally { clearTimeout(idleTimer); }
            if (next.done) break;
            // No timer runs while the consumer applies backpressure.
            yield next.value;
          }
        } finally { source.destroy(); cleanup(); }
      })(), { objectMode: false });
      guarded.once('close', () => { cancel(); cleanup(); });
      return new Response(Readable.toWeb(guarded), { status: response.status, headers });
    } catch { source?.destroy?.(); controller.abort(); cleanup(); return new Response(null, { status: 502 }); }
  }
  return { prepare, handle };
}
module.exports = { createStreamManager, validateURL, audioType, audioInfo, qualityDetails };
