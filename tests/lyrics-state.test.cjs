'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLyrics, activeIndex, caption, wordProgress, lineProgress } = require('../ui/lyrics-state.js');

test('LRC supports repeated timestamps, minute sorting and fractional precision', () => {
  const result = parseLyrics('[01:02.125]later\r\n[00:01.5][00:10:25]same line\n[00:02.05]short fraction');
  assert.deepEqual(result, { lines: [
    { time: 1.5, text: 'same line' },
    { time: 2.05, text: 'short fraction' },
    { time: 10.25, text: 'same line' },
    { time: 62.125, text: 'later' },
  ], plain: [] });
});

test('LRC applies signed millisecond offset to all timestamps regardless of tag location', () => {
  assert.deepEqual(parseLyrics('[00:01.00]one\n[offset:+250]\n[00:03]three').lines, [
    { time: 1.25, text: 'one' }, { time: 3.25, text: 'three' },
  ]);
  assert.deepEqual(parseLyrics('[offset:-1500]\n[00:01]one\n[00:03]three').lines, [
    { time: 0, text: 'one' }, { time: 1.5, text: 'three' },
  ]);
  assert.equal(parseLyrics('[offset:300]\n[offset:-100]\n[00:01]last offset wins').lines[0].time, .9);
});

test('metadata and blank timestamps never become lyrics and seconds must be below sixty', () => {
  const result = parseLyrics('\uFEFF[ar:Artist]\n[ti:Title]\n[al:Album]\n[by:Editor]\n[offset:0]\n[00:00.00]\n[00:60.00]invalid\n[01:59.999]valid');
  assert.deepEqual(result, { lines: [{ time: 119.999, text: 'valid' }], plain: [] });
  assert.deepEqual(parseLyrics('[00:60]invalid only'), { lines: [], plain: [] });
  assert.deepEqual(parseLyrics(''), { lines: [], plain: [] });
});

test('pure text remains text and receives no invented playback positions', () => {
  const text = '<img src=x onerror=alert(1)>\nA & B\n\n[ar:Artist]';
  assert.deepEqual(parseLyrics(text), { lines: [], plain: ['<img src=x onerror=alert(1)>', 'A & B'] });
  assert.deepEqual(parseLyrics('unmapped introduction\n[00:01]timed'), { lines: [{ time: 1, text: 'timed' }], plain: [] });
});

test('active line follows exact position through forward and backward seeks without leading time', () => {
  const { lines } = parseLyrics('[00:01]one\n[00:03]three\n[00:06]six');
  assert.equal(activeIndex(lines, .999), -1);
  assert.equal(activeIndex(lines, 1), 0);
  assert.equal(activeIndex(lines, 2.999), 0);
  assert.equal(activeIndex(lines, 3), 1);
  assert.equal(activeIndex(lines, 20), 2);
  assert.equal(activeIndex(lines, 1.1), 0);
  assert.equal(activeIndex(lines, 0), -1);
  assert.equal(activeIndex([], 30), -1);
});

test('duplicate and offset-clamped timestamps use the last line at the same instant', () => {
  const { lines } = parseLyrics('[offset:-1000]\n[00:00.2]first\n[00:00.8]second\n[00:02]third\n[00:02]fourth');
  assert.equal(activeIndex(lines, 0), 1);
  assert.equal(activeIndex(lines, .999), 1);
  assert.equal(activeIndex(lines, 1), 3);
});

test('caption distinguishes idle, loading, errors, prelude, timed, plain and missing lyrics', () => {
  const song = { title: 'song' }, lines = [{ time: 2, text: 'the current lyric' }];
  assert.deepEqual(caption(), { text: '', kind: 'idle' });
  assert.deepEqual(caption({ lyrics: { loading: true } }), { text: '', kind: 'idle' });
  assert.deepEqual(caption({ song, lyrics: { loading: true } }), { text: '正在加载歌词…', kind: 'loading' });
  assert.deepEqual(caption({ song, lyrics: { error: new Error('failed') } }), { text: '歌词暂时不可用', kind: 'error' });
  assert.deepEqual(caption({ song, lyrics: { lines, active: -1 } }), { text: '前奏中', kind: 'prelude' });
  assert.deepEqual(caption({ song, lyrics: { lines, active: 0 } }), { text: 'the current lyric', kind: 'lyric' });
  assert.deepEqual(caption({ song, lyrics: { plain: ['first', 'last'] } }), { text: '纯文本歌词 · 在青音中查看', kind: 'plain' });
  assert.deepEqual(caption({ song }), { text: '暂无歌词', kind: 'empty' });
});

test('caption leaves HTML-shaped lyric content as text for UI textContent consumers', () => {
  const text = '<script>window.bad=true</script>';
  assert.deepEqual(caption({ song: { title: 'song' }, lyrics: { lines: [{ time: 0, text }], active: 0 } }), { text, kind: 'lyric' });
});

test('KRC retains provider word intervals, line duration and spaces without character estimates', () => {
  const parsed = parseLyrics('[offset:+100]\n[1000,2000]<0,500,0>Hello <700,1000,0>世界\n[5000,1500]plain timed');
  assert.deepEqual(parsed, { lines: [
    { time: 1.1, end: 3.1, text: 'Hello 世界', words: [{ text: 'Hello ', start: 1.1, end: 1.6 }, { text: '世界', start: 1.8, end: 2.8000000000000003 }] },
    { time: 5.1, end: 6.6, text: 'plain timed' },
  ], plain: [] });
  assert.deepEqual(parseLyrics('[offset:-1500]\n[1000,2000]<0,500,0>甲<700,1000,0>乙').lines[0], {
    time: 0, end: 1.5, text: '甲乙', words: [{ text: '甲', start: 0, end: 0 }, { text: '乙', start: .19999999999999996, end: 1.2000000000000002 }],
  });
});

test('object payload accepts exact absolute word times and rejects mismatched or invalid segments', () => {
  const line = { time: 1, end: 4, text: 'A B', words: [{ text: 'A ', start: 1, end: 2 }, { text: 'B', start: 3, end: 4 }] };
  assert.deepEqual(parseLyrics({ text: '[00:00]legacy', timedLines: [line] }), { lines: [line], plain: [] });
  for (const words of [
    [{ text: 'A', start: 1, end: 2 }, { text: 'B', start: 3, end: 4 }],
    [{ text: 'A ', start: NaN, end: 2 }, { text: 'B', start: 3, end: 4 }],
    [{ text: 'A ', start: 1, end: 2 }, { text: 'B', start: 3, end: 5 }],
    [{ text: 'A ', start: 2, end: 3 }, { text: 'B', start: 1, end: 4 }],
  ]) assert.deepEqual(parseLyrics({ timedLines: [{ ...line, words }] }).lines, [{ time: 1, end: 4, text: 'A B' }]);
  assert.deepEqual(parseLyrics({ text: '[00:02]fallback', timedLines: [{ time: Infinity, text: 'invalid' }] }).lines, [{ time: 2, text: 'fallback' }]);
  assert.deepEqual(parseLyrics({ text: '[00:02]local' }).lines, [{ time: 2, text: 'local' }]);
});

test('word progress follows provider durations through pauses between words and backward seek', () => {
  const line = { time: 1, end: 6, text: '甲乙', words: [{ text: '甲', start: 1, end: 2 }, { text: '乙', start: 4, end: 6 }] };
  assert.deepEqual(wordProgress(line, .9), [0, 0]);
  assert.deepEqual(wordProgress(line, 1.5), [.5, 0]);
  assert.deepEqual(wordProgress(line, 3), [1, 0]);
  assert.deepEqual(wordProgress(line, 5), [1, .5]);
  assert.deepEqual(wordProgress(line, 10), [1, 1]);
  assert.deepEqual(wordProgress(line, 1.25), [.25, 0]);
  assert.deepEqual(wordProgress({ time: 1, text: 'LRC has no words' }, 5), []);
  assert.equal(lineProgress(line, 3.5), .5);
  assert.equal(lineProgress({ time: 1 }, 3), 0);
  assert.deepEqual(wordProgress({ words: [{ text: '短', start: 2, end: 2 }] }, 2), [1]);
});
