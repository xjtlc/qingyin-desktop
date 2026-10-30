const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseByteRange } = require('../lib/audio.cjs');
test('audio ranges support seek, suffix and clamped final chunks', () => {
  assert.deepEqual(parseByteRange('bytes=100-199', 1000), { start: 100, end: 199 });
  assert.deepEqual(parseByteRange('bytes=800-', 1000), { start: 800, end: 999 });
  assert.deepEqual(parseByteRange('bytes=-100', 1000), { start: 900, end: 999 });
  assert.deepEqual(parseByteRange('bytes=800-9999', 1000), { start: 800, end: 999 });
  assert.deepEqual(parseByteRange('bytes=-2000', 1000), { start: 0, end: 999 });
});
test('invalid or unsatisfiable audio ranges never read beyond the file', () => {
  for (const range of ['bytes=1000-', 'bytes=50-10', 'bytes=0-1,4-5', 'bytes=-0', 'bytes=-', 'bytes=9999999999999999999-']) assert.equal(parseByteRange(range, 1000), false);
  assert.equal(parseByteRange('bytes=0-', 0), false);
  assert.equal(parseByteRange(null, 1000), null);
});
