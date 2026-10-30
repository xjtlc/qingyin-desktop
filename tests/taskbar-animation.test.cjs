'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const render = require('../ui/taskbar-render-state.js');
const source = fs.readFileSync(require.resolve('../ui/taskbar-lyrics.js'), 'utf8');

function runtime() {
  class Node {
    constructor() { this.children = []; this.style = {}; this.dataset = {}; this.clientWidth = 354; this.value = ''; }
    set textContent(value) { this.value = value; this.children = []; }
    get textContent() { return this.children.length ? this.children.map(child => child.textContent).join('') : this.value; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; this.value = ''; }
    setAttribute(name, value) { this[name] = value; }
    getBoundingClientRect() { return { width: this.children.length ? this.children[0].textContent.length * 20 : this.value.length * 20 }; }
    get scrollWidth() { return this.children.length ? this.children.reduce((sum, child) => sum + child.getBoundingClientRect().width, 0) : this.value.length * 20; }
  }
  const caption = new Node(), track = new Node(), rafs = new Map(), timers = new Map(), events = {};
  let time = 0, sequence = 0, stateListener, unsubscribed = false;
  const epoch = 1000000;
  const context = {
    document: { querySelector: selector => selector === '#taskbar-lyric' ? caption : track, createElement: () => new Node(), body: { dataset: {} }, documentElement: { dataset: {} } },
    window: { QingyinTaskbarRender: { ...render, normalize: state => render.normalize(state, epoch + time) }, matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener: (name, callback) => { events[name] = callback; }, taskbarLyrics: { onState: callback => { stateListener = callback; return () => { unsubscribed = true; }; } } },
    performance: { now: () => time }, ResizeObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: callback => { const id = ++sequence; rafs.set(id, callback); return id; }, cancelAnimationFrame: id => rafs.delete(id),
    setTimeout: (callback, delay) => { const id = ++sequence; timers.set(id, { callback, due: time + delay }); return id; }, clearTimeout: id => timers.delete(id),
  };
  vm.runInNewContext(source, context, { filename: 'taskbar-lyrics.js' });
  function send(overrides = {}) {
    stateListener({ text: '没有爱过你 我最爱是自己', kind: 'lyric', title: '测试歌曲', playing: true, position: 0, sampledAt: epoch + time, rate: 1, lineStart: 0, lineEnd: 4, ...overrides });
  }
  function advance(milliseconds) {
    const end = time + milliseconds;
    while (timers.size) {
      const next = [...timers].sort((a, b) => a[1].due - b[1].due)[0];
      if (next[1].due > end) break;
      time = next[1].due; timers.delete(next[0]); next[1].callback();
    }
    time = end;
  }
  function tickRaf(milliseconds = 16) {
    time += milliseconds;
    const next = [...rafs][0];
    if (next) { rafs.delete(next[0]); next[1](time); }
  }
  return { send, advance, tickRaf, track, rafs, timers, events, get position() { return Number(track.dataset.position); }, get unsubscribed() { return unsubscribed; } };
}

test('hidden compositor still advances within a sentence without RAF or new IPC events', () => {
  const page = runtime(); page.send();
  const before = page.track.children[0].children[1].style.clipPath;
  page.advance(650);
  assert.ok(page.position >= .6 && page.position <= .65);
  assert.notEqual(page.track.children[0].children[1].style.clipPath, before);
  assert.equal(page.rafs.size, 1); assert.equal(page.timers.size, 1);
});
test('normal RAF replaces the watchdog without creating parallel animation loops', () => {
  const page = runtime(); page.send();
  for (let i = 0; i < 40; i++) page.tickRaf();
  assert.equal(page.position, .64);
  assert.equal(page.rafs.size, 1); assert.equal(page.timers.size, 1);
});
test('pause cancels RAF and timer, including callbacks already queued before pause', () => {
  const page = runtime(); page.send();
  const staleFrame = [...page.rafs.values()][0], staleTimer = [...page.timers.values()][0].callback;
  page.advance(300); page.send({ position: .3, playing: false });
  staleFrame(900); staleTimer(); page.advance(650);
  assert.equal(page.position, .3); assert.equal(page.rafs.size, 0); assert.equal(page.timers.size, 0);
});
test('seek replaces the transport anchor immediately and continues from the new position', () => {
  const page = runtime(); page.send({ position: 2.5 }); page.advance(200);
  page.send({ position: .5 }); assert.equal(page.position, .5);
  page.advance(300); assert.equal(page.position, .8);
});
test('line ending stops both schedules and never interpolates into another sentence', () => {
  const page = runtime(); page.send({ position: 3.9 }); page.advance(650);
  assert.equal(page.position, 4); assert.equal(page.rafs.size, 0); assert.equal(page.timers.size, 0);
});
test('unload cancels both schedules, unsubscribes IPC, and invalidates queued callbacks', () => {
  const page = runtime(); page.send();
  const staleFrame = [...page.rafs.values()][0], staleTimer = [...page.timers.values()][0].callback;
  page.events.beforeunload(); staleFrame(900); staleTimer(); page.advance(650);
  assert.equal(page.position, 0); assert.equal(page.rafs.size, 0); assert.equal(page.timers.size, 0); assert.equal(page.unsubscribed, true);
});
