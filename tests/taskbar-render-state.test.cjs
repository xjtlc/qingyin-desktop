'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalize, positionAt, progressAt, scrollTarget, graphemes } = require('../ui/taskbar-render-state.js');

test('precise word timing preserves gaps and continuous intra-word filling', () => {
  const state = normalize({ text: '没有爱过你', kind: 'lyric', position: 2.5, lineStart: 1, lineEnd: 6, words: [{ text: '没有', start: 1, end: 2 }, { text: '爱过你', start: 3, end: 6 }] });
  assert.deepEqual(state.units.map(unit => unit.text), ['没有', '爱过你']);
  assert.deepEqual(state.units.map(unit => progressAt(unit, 2.5)), [1, 0]);
  assert.equal(progressAt(state.units[1], 4.5), .5);
});
test('plain LRC sweeps the whole sentence without inventing word timing', () => {
  const state = normalize({ text: '一二三四', kind: 'lyric', position: 6, lineStart: 4, lineEnd: 8 });
  assert.deepEqual(state.units, [{ text: '一二三四', start: 4, end: 8 }]);
  assert.equal(progressAt(state.units[0], 6), .5);
});
test('zero-duration word keeps real timing for the rest of the line and fills instantly', () => {
  const words = [{ text: '爱', start: 1, end: 2 }, { text: ' ', start: 2, end: 2 }, { text: '你', start: 3, end: 4 }];
  const state = normalize({ text: '爱 你', kind: 'lyric', position: 2, lineStart: 1, lineEnd: 4, words });
  assert.deepEqual(state.units, words);
  assert.equal(progressAt(state.units[1], 1.99), 0);
  assert.equal(progressAt(state.units[1], 2), 1);
  assert.equal(progressAt(state.units[2], 3.5), .5);
});
test('mismatched and invalid word timing falls back to the current line', () => {
  const first = normalize({ text: '一二', kind: 'lyric', lineStart: 4, lineEnd: 8, words: [{ text: '其他', start: 1, end: 2 }] });
  const second = normalize({ text: '一二', kind: 'lyric', lineStart: 4, lineEnd: 8, words: [{ text: '一二', start: 8, end: 4 }] });
  assert.deepEqual(first.units, second.units);
  assert.deepEqual(first.units, [{ text: '一二', start: 4, end: 8 }]);
});
test('playback interpolates between updates and never passes the line boundary', () => {
  const state = normalize({ text: '实时', kind: 'lyric', playing: true, position: 4, sampledAt: 1000, lineStart: 3, lineEnd: 6, rate: 1 }, 1500);
  assert.equal(state.position, 4.5);
  assert.equal(positionAt(state, .25), 4.75);
  assert.equal(positionAt(state, 20), 6);
});
test('pause stays fixed and seeking backward replaces the previous anchor', () => {
  const paused = normalize({ text: '实时', kind: 'lyric', playing: false, position: 4, sampledAt: 1000, lineStart: 3, lineEnd: 6 }, 3000);
  assert.equal(positionAt(paused, 10), 4);
  const sought = normalize({ text: '实时', kind: 'lyric', playing: true, position: 3.1, sampledAt: 3000, lineStart: 3, lineEnd: 6 }, 3000);
  assert.equal(positionAt(sought, .1), 3.2);
});
test('unicode graphemes preserve emoji and combining characters', () => {
  assert.deepEqual(graphemes('青👨‍👩‍👧‍👦é'), ['青', '👨‍👩‍👧‍👦', 'é']);
});
test('caption codepoint limit preserves emoji and matching word timing', () => {
  const text = '🎵'.repeat(300);
  const state = normalize({ text, kind: 'lyric', lineStart: 0, lineEnd: 4, words: [{ text, start: 0, end: 4 }] });
  assert.equal(state.text, text); assert.equal(state.units[0].text, text); assert.equal(state.units.length, 1);
});
test('long lyric scrolling follows the sung location and stays within the line', () => {
  assert.equal(scrollTarget(40, 600, 260), 0);
  assert.equal(scrollTarget(260, 600, 260), 117);
  assert.equal(scrollTarget(600, 600, 260), 340);
  assert.equal(scrollTarget(600, 220, 260), 0);
});
test('non-lyric states never substitute song title or create blue text', () => {
  const idle = normalize({ title: '歌曲名', kind: 'idle', playing: true, position: 3 });
  assert.equal(idle.text, '');
  assert.deepEqual(idle.units, []);
  assert.equal(positionAt(idle, 50), 3);
  assert.deepEqual(normalize({ text: '前奏中', kind: 'prelude' }).units, []);
});
