'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { MAX_LYRIC_BYTES, decodeLyricBytes, readRegisteredLyrics } = require('../lib/local-lyrics.cjs');

async function removeFixture(directory) {
  const target = path.resolve(directory);
  assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
  assert.equal(path.basename(target).startsWith('qingyin-lrc-'), true);
  await fs.rm(target, { recursive: true, force: true });
}

test('local lyrics decode UTF-8, UTF-16 BOM variants and legacy GB18030', () => {
  const text = '[00:01.00]你好';
  assert.equal(decodeLyricBytes(Buffer.from(text)), text);
  assert.equal(decodeLyricBytes(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)])), text);
  const utf16 = Buffer.from(text, 'utf16le');
  assert.equal(decodeLyricBytes(Buffer.concat([Buffer.from([0xff, 0xfe]), utf16])), text);
  const bigEndian = Buffer.from(utf16); bigEndian.swap16();
  assert.equal(decodeLyricBytes(Buffer.concat([Buffer.from([0xfe, 0xff]), bigEndian])), text);
  assert.equal(decodeLyricBytes(Buffer.from([0xc4, 0xe3, 0xba, 0xc3])), '你好');
  assert.equal(decodeLyricBytes(Buffer.alloc(MAX_LYRIC_BYTES + 1)), '');
});

test('local lyric IPC accepts only a registered track ID and its companion LRC', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'qingyin-lrc-'));
  t.after(() => removeFixture(directory));
  const audio = path.join(directory, '同名歌曲.FLAC');
  const lyrics = '[00:01.20]第一句\n[00:03.50]第二句';
  await fs.writeFile(audio, 'fixture'); await fs.writeFile(path.join(directory, '同名歌曲.lrc'), lyrics);
  const id = 'a'.repeat(24), registered = new Map([[id, audio]]);
  assert.deepEqual(await readRegisteredLyrics(registered, id), { text: lyrics });
  assert.deepEqual(await readRegisteredLyrics(registered, 'b'.repeat(24)), { text: '' });
  assert.deepEqual(await readRegisteredLyrics(registered, path.join(directory, '同名歌曲.lrc')), { text: '' });
  assert.deepEqual(await readRegisteredLyrics(registered, { path: audio }), { text: '' });
  assert.equal(JSON.stringify(await readRegisteredLyrics(registered, id)).includes(directory), false);
});

test('missing, oversized or non-file lyric companions safely return empty text', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'qingyin-lrc-'));
  t.after(() => removeFixture(directory));
  const id = 'a'.repeat(24), registered = new Map([[id, path.join(directory, 'song.mp3')]]);
  assert.deepEqual(await readRegisteredLyrics(registered, id), { text: '' });
  const companion = path.join(directory, 'song.lrc');
  await fs.writeFile(companion, Buffer.alloc(MAX_LYRIC_BYTES + 1, 0x61));
  assert.deepEqual(await readRegisteredLyrics(registered, id), { text: '' });
  await fs.unlink(companion); await fs.mkdir(companion);
  assert.deepEqual(await readRegisteredLyrics(registered, id), { text: '' });
});
