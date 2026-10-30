(function (root, factory) {
  'use strict';
  const exports = factory();
  if (typeof module === 'object' && module.exports) module.exports = exports;
  else root.QingyinLyricsState = exports;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  function lyricOffset(source) {
    const offsets = [...source.matchAll(/\[offset:\s*([+-]?\d+)\s*\]/gi)];
    return offsets.length ? Number(offsets[offsets.length - 1][1]) / 1000 : 0;
  }

  // Provider word times are absolute seconds. Reject incomplete or mismatched
  // segments rather than inventing timings or losing spaces between words.
  function normalizeTimedLines(input) {
    if (!Array.isArray(input)) return [];
    const lines = [];
    for (const item of input.slice(0, 5000)) {
      if (!item || typeof item !== 'object' || !Number.isFinite(item.time) || item.time < 0 || typeof item.text !== 'string' || !item.text.trim()) continue;
      const line = { time: item.time, text: item.text };
      if (Number.isFinite(item.end) && item.end >= item.time) line.end = item.end;
      if (Array.isArray(item.words) && item.words.length && item.words.length <= 500 && Number.isFinite(line.end)) {
        let previousStart = item.time;
        const words = [];
        for (const word of item.words) {
          if (!word || typeof word.text !== 'string' || !Number.isFinite(word.start) || !Number.isFinite(word.end)
            || word.start < previousStart || word.start < item.time || word.end < word.start || word.end > line.end + .001) break;
          words.push({ text: word.text, start: word.start, end: word.end });
          previousStart = word.start;
        }
        if (words.length === item.words.length && words.map(word => word.text).join('') === item.text) line.words = words;
      }
      lines.push(line);
    }
    return lines.sort((a, b) => a.time - b.time);
  }

  function parseKrc(source) {
    const offset = lyricOffset(source), lines = [];
    for (const raw of source.split(/\r?\n/)) {
      const match = raw.match(/^\s*\[(\d+),(\d+)\](.*)$/);
      if (!match) continue;
      const base = Number(match[1]) / 1000, duration = Number(match[2]) / 1000;
      if (!Number.isFinite(base) || !Number.isFinite(duration)) continue;
      const time = Math.max(0, base + offset), end = Math.max(time, base + duration + offset), words = [];
      const tags = [...match[3].matchAll(/<(\d+),(\d+),(\d+)>/g)];
      // A KRC line without word markers is still a real timed line, but it does
      // not justify karaoke highlighting of individual characters.
      const text = tags.length ? tags.map((tag, index) => {
        const wordText = match[3].slice(tag.index + tag[0].length, tags[index + 1]?.index ?? match[3].length);
        const start = Math.max(time, base + Number(tag[1]) / 1000 + offset);
        const wordEnd = Math.max(start, base + (Number(tag[1]) + Number(tag[2])) / 1000 + offset);
        words.push({ text: wordText, start, end: wordEnd });
        return wordText;
      }).join('') : match[3];
      if (text.trim()) lines.push({ time, end, text, ...(words.length ? { words } : {}) });
    }
    return normalizeTimedLines(lines);
  }

  function parseLyrics(input) {
    if (input && typeof input === 'object' && !Array.isArray(input)) {
      const supplied = normalizeTimedLines(input.timedLines);
      if (supplied.length) return { lines: supplied, plain: [] };
      input = input.text;
    }
    const source = String(input || '').replace(/^\uFEFF/, '');
    const krc = parseKrc(source);
    if (krc.length) return { lines: krc, plain: [] };
    const offset = lyricOffset(source);
    const lines = [], plain = [];
    for (const raw of source.split(/\r?\n/)) {
      const tags = [...raw.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
      const value = raw.replace(/\[[^\]]*\]/g, '').trim();
      if (!value) continue;
      if (tags.length) {
        for (const tag of tags) {
          if (Number(tag[2]) >= 60) continue;
          const seconds = Number(tag[1]) * 60 + Number(tag[2]) + (tag[3] ? Number(`0.${tag[3]}`) : 0);
          lines.push({ time: Math.max(0, seconds + offset), text: value });
        }
      } else if (!/^\s*\[[a-z]+:/i.test(raw)) plain.push(value);
    }
    return { lines: lines.sort((a, b) => a.time - b.time), plain: lines.length ? [] : plain };
  }

  function activeIndex(lines, time) {
    if (!Array.isArray(lines) || !lines.length) return -1;
    const position = Number.isFinite(Number(time)) ? Math.max(0, Number(time)) : 0;
    let low = 0, high = lines.length - 1, active = -1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      if (lines[middle].time <= position) { active = middle; low = middle + 1; }
      else high = middle - 1;
    }
    return active;
  }

  function segmentProgress(start, end, time) {
    const position = Number(time);
    if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(position)) return 0;
    if (end <= start) return position >= end ? 1 : 0;
    return Math.max(0, Math.min(1, (position - start) / (end - start)));
  }

  function wordProgress(line, time) {
    return Array.isArray(line?.words) ? line.words.map(word => segmentProgress(word.start, word.end, time)) : [];
  }

  function lineProgress(line, time) {
    return segmentProgress(line?.time, line?.end, time);
  }

  function caption({ song = null, lyrics = {} } = {}) {
    if (!song) return { text: '', kind: 'idle' };
    if (lyrics.loading) return { text: '正在加载歌词…', kind: 'loading' };
    if (lyrics.error) return { text: '歌词暂时不可用', kind: 'error' };
    if (Array.isArray(lyrics.lines) && lyrics.lines.length) {
      const line = lyrics.lines[lyrics.active];
      return line ? { text: String(line.text || ''), kind: 'lyric' } : { text: '前奏中', kind: 'prelude' };
    }
    if (Array.isArray(lyrics.plain) && lyrics.plain.length) return { text: '纯文本歌词 · 在青音中查看', kind: 'plain' };
    return { text: '暂无歌词', kind: 'empty' };
  }

  return { parseLyrics, parseKrc, normalizeTimedLines, activeIndex, caption, wordProgress, lineProgress };
});
