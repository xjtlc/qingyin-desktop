'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { deflateSync } = require('node:zlib');
const { MAX_LYRIC_BYTES, decodeLyricResponse, normalizeLyricText, toLrc } = require('../lib/lyric-timing.cjs');

function encodedKrc(source) {
  const key = [64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 210, 110, 105];
  const data = deflateSync(Buffer.from(source));
  for (let index = 0; index < data.length; index++) data[index] ^= key[index % key.length];
  return Buffer.concat([Buffer.from('krc1'), data]).toString('base64');
}

test('actual upstream KRC envelope decodes bounded XOR and zlib with absolute provider word timing', () => {
  const source = '[ar:Fixture]\n[2000,3000]<0,500,0>没有<500,1500,0>爱过你 <2200,800,0>自己';
  const body = { status: 200, fmt: 'krc', contenttype: 0, content: encodedKrc(source) };
  assert.equal(decodeLyricResponse(body, 'krc'), source);
  const result = normalizeLyricText(decodeLyricResponse(body, 'krc'));
  assert.equal(result.timing, 'word');
  assert.equal(result.text, '[00:02.000]没有爱过你 自己');
  assert.deepEqual(result.timedLines, [{ time: 2, end: 5, text: '没有爱过你 自己', words: [
    { text: '没有', start: 2, end: 2.5 }, { text: '爱过你 ', start: 2.5, end: 4 }, { text: '自己', start: 4.2, end: 5 },
  ] }]);
});

test('LRC envelope and legacy decodeContent preserve compatibility without invented word timing', () => {
  const lrc = '[00:01.25]甲\n[00:03.5]乙';
  assert.equal(decodeLyricResponse({ contenttype: 1, content: Buffer.from(lrc).toString('base64') }, 'lrc'), lrc);
  assert.equal(decodeLyricResponse({ decodeContent: lrc }, 'krc'), lrc);
  const result = normalizeLyricText(lrc);
  assert.equal(result.timing, 'line');
  assert.deepEqual(result.timedLines, [{ time: 1.25, end: 3.5, text: '甲' }, { time: 3.5, text: '乙' }]);
  assert.equal(result.timedLines.some(line => 'words' in line), false);
  assert.equal(toLrc([{ time: 59.9999, text: 'roll over' }]), '[01:00.000]roll over');
});

test('malformed, truncated and excessive compressed responses return empty instead of unbounded inflate', () => {
  assert.equal(decodeLyricResponse({ content: 'not base64!' }, 'krc'), '');
  assert.equal(decodeLyricResponse({ contenttype: 0, content: Buffer.from('krc1garbage').toString('base64') }, 'krc'), '');
  assert.equal(decodeLyricResponse({ contenttype: 0, content: Buffer.from('encrypted without header').toString('base64') }, 'krc'), '');
  assert.equal(decodeLyricResponse({ contenttype: 0, content: encodedKrc('A'.repeat(MAX_LYRIC_BYTES + 1)) }, 'krc'), '');
  assert.equal(decodeLyricResponse({ decodeContent: 'A'.repeat(MAX_LYRIC_BYTES + 1) }, 'lrc'), '');
  assert.deepEqual(normalizeLyricText(''), { text: '', timedLines: [], timing: 'none' });
  assert.deepEqual(normalizeLyricText('[ar:Fixture]\nplain\ntext'), { text: 'plain\ntext', timedLines: [], timing: 'none' });
});
