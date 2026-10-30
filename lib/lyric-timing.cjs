'use strict';

const { inflateSync } = require('node:zlib');
const { parseLyrics } = require('../ui/lyrics-state.js');

const MAX_LYRIC_BYTES = 1024 * 1024;
const KRC_KEY = Buffer.from([64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 210, 110, 105]);

function decodeLyricResponse(body, fmt) {
  if (!body || typeof body !== 'object') return '';
  // Kept for modules/fixtures that already decode upstream responses. Actual
  // requests use decode:false so compressed content is bounded here.
  if (typeof body.decodeContent === 'string') return Buffer.byteLength(body.decodeContent) <= MAX_LYRIC_BYTES ? body.decodeContent : '';
  if (typeof body.content !== 'string' || body.content.length > MAX_LYRIC_BYTES * 2 || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.content)) return '';
  const bytes = Buffer.from(body.content, 'base64');
  if (bytes.length > MAX_LYRIC_BYTES) return '';
  if (bytes.subarray(0, 4).toString('ascii') === 'krc1') {
    const encrypted = Buffer.from(bytes.subarray(4));
    for (let index = 0; index < encrypted.length; index++) encrypted[index] ^= KRC_KEY[index % KRC_KEY.length];
    try { return inflateSync(encrypted, { maxOutputLength: MAX_LYRIC_BYTES }).toString('utf8'); }
    catch { return ''; }
  }
  // Plain UTF-8 responses are LRC. An invalid KRC response must fall back to a
  // separate LRC download instead of exposing encrypted bytes in the player.
  if (fmt === 'krc' && Number(body.contenttype) === 0) return '';
  return bytes.toString('utf8').replace(/^\uFEFF/, '');
}

function toLrc(lines) {
  return lines.map(line => {
    const milliseconds = Math.round(line.time * 1000);
    const minutes = Math.floor(milliseconds / 60000);
    const seconds = Math.floor(milliseconds / 1000) % 60;
    const fraction = milliseconds % 1000;
    return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(fraction).padStart(3, '0')}]${line.text}`;
  }).join('\n');
}

function normalizeLyricText(text) {
  const source = typeof text === 'string' && Buffer.byteLength(text) <= MAX_LYRIC_BYTES ? text : '';
  const { lines, plain } = parseLyrics(source);
  const timedLines = lines.map((line, index) => {
    const end = Number.isFinite(line.end) ? line.end : lines[index + 1]?.time;
    return { ...line, ...(Number.isFinite(end) && end >= line.time ? { end } : {}) };
  });
  const timing = timedLines.some(line => line.words?.length) ? 'word' : timedLines.length ? 'line' : 'none';
  return { text: timedLines.length ? toLrc(timedLines) : plain.join('\n'), timedLines, timing };
}

module.exports = { MAX_LYRIC_BYTES, decodeLyricResponse, normalizeLyricText, toLrc };
