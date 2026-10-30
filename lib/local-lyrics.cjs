'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const MAX_LYRIC_BYTES = 1024 * 1024;

function decodeLyricBytes(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length > MAX_LYRIC_BYTES) return '';
  try {
    if (buffer[0] === 0xff && buffer[1] === 0xfe) return new TextDecoder('utf-16le', { fatal: true }).decode(buffer.subarray(2));
    if (buffer[0] === 0xfe && buffer[1] === 0xff) return new TextDecoder('utf-16be', { fatal: true }).decode(buffer.subarray(2));
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    try { return new TextDecoder('gb18030', { fatal: true }).decode(buffer); }
    catch { return ''; }
  }
}

async function readRegisteredLyrics(localPaths, id) {
  // A renderer supplies only a library ID. It cannot choose a path or read arbitrary
  // text files; the companion filename is derived from an already imported track.
  if (typeof id !== 'string' || !/^[a-f\d]{24}$/i.test(id)) return { text: '' };
  const audio = localPaths.get(id);
  if (typeof audio !== 'string') return { text: '' };
  const file = path.join(path.dirname(audio), `${path.basename(audio, path.extname(audio))}.lrc`);
  let handle;
  try {
    handle = await fs.open(file, 'r');
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_LYRIC_BYTES) return { text: '' };
    // Bound the read as well as the initial size check: a file can grow between them.
    const bytes = Buffer.alloc(Math.min(stat.size + 1, MAX_LYRIC_BYTES + 1));
    let read = 0;
    while (read < bytes.length) {
      const chunk = await handle.read(bytes, read, bytes.length - read, read);
      if (!chunk.bytesRead) break;
      read += chunk.bytesRead;
    }
    return { text: decodeLyricBytes(bytes.subarray(0, read)) };
  } catch { return { text: '' }; }
  finally { if (handle) await handle.close().catch(() => {}); }
}

module.exports = { MAX_LYRIC_BYTES, decodeLyricBytes, readRegisteredLyrics };
