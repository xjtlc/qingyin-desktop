(function (root, factory) {
  'use strict';
  const exports = factory();
  if (typeof module === 'object' && module.exports) module.exports = exports;
  else root.QingyinTaskbarRender = exports;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  let segmenter;
  try { segmenter = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' }); } catch {}
  function graphemes(text) {
    return segmenter ? [...segmenter.segment(text)].map(item => item.segment) : Array.from(text);
  }
  function unitsFor(text, words, start, end) {
    const timed = Array.isArray(words) ? words.filter(word => word && typeof word.text === 'string' && word.text.length) : [];
    const valid = timed.length && timed.map(word => word.text).join('') === text && timed.every(word =>
      Number.isFinite(Number(word.start)) && Number.isFinite(Number(word.end)) && Number(word.end) >= Number(word.start));
    // Standard LRC contains line timing only; sweep the whole sentence without inventing word timing.
    return (valid ? timed : [{ text, start, end }]).map(word => ({ text: word.text, start: Number(word.start), end: Number(word.end) }));
  }
  function normalize(state = {}, receivedAt = Date.now()) {
    if (!state || typeof state !== 'object') state = {};
    const text = Array.from(String(state.text || '')).slice(0, 512).join('');
    const kind = String(state.kind || 'idle');
    const lineStart = Math.max(0, finite(state.lineStart, finite(state.position, 0)));
    const proposedEnd = finite(state.lineEnd, lineStart);
    const lineEnd = proposedEnd > lineStart ? proposedEnd : lineStart + clamp(graphemes(text).length * .3, 2, 15);
    const rate = clamp(finite(state.rate, 1), 0, 4);
    const playing = Boolean(state.playing);
    const sampledAt = finite(state.sampledAt, receivedAt);
    const elapsed = playing ? clamp((receivedAt - sampledAt) / 1000, 0, 5) * rate : 0;
    const position = clamp(Math.max(0, finite(state.position, lineStart)) + elapsed, 0, lineEnd);
    return { text, kind, playing, rate, position, lineStart, lineEnd, units: kind === 'lyric' ? unitsFor(text, state.words, lineStart, lineEnd) : [], title: String(state.title || ''), theme: ['light', 'dark'].includes(state.theme) ? state.theme : 'system' };
  }
  function positionAt(state, elapsedSeconds) {
    const advance = state.playing && state.kind === 'lyric' ? Math.max(0, finite(elapsedSeconds, 0)) * state.rate : 0;
    return clamp(state.position + advance, 0, state.lineEnd);
  }
  function progressAt(unit, position) {
    if (unit.end <= unit.start) return position >= unit.start ? 1 : 0;
    return clamp((position - unit.start) / (unit.end - unit.start), 0, 1);
  }
  function scrollTarget(sungWidth, totalWidth, viewportWidth) {
    if (totalWidth <= viewportWidth || viewportWidth <= 0) return 0;
    return clamp(sungWidth - viewportWidth * .55, 0, totalWidth - viewportWidth);
  }
  return { normalize, positionAt, progressAt, scrollTarget, graphemes };
});
