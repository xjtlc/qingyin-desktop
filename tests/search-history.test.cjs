'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const history = require('../ui/search-history.js');

test('search history keeps the 20 most recent distinct queries and normalizes persisted values', () => {
  assert.deepEqual(history.normalize([null, '  A  B  ', 'a b', '', 42, '青音']), ['A B', '青音']);
  const entries = Array.from({ length: 25 }, (_, i) => `歌曲 ${i}`);
  const recent = history.remember(entries, '  歌曲   5  ');
  assert.equal(recent.length, 20);
  assert.equal(recent[0], '歌曲 5');
  assert.equal(recent.filter(item => item === '歌曲 5').length, 1);
  assert.deepEqual(history.filter(['Hello World', '青音'], 'WORLD'), ['Hello World']);
  assert.deepEqual(history.remove(['Hello World', '青音'], ' hello   world '), ['青音']);
});

// A small DOM fixture exercises keyboard, focus and callback behavior without an Electron window.
class Element {
  constructor(tag, document) {
    this.tagName = tag;
    this.ownerDocument = document;
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.className = '';
    this.classList = { add: name => { this.className = `${this.className} ${name}`.trim(); } };
    this.value = '';
    this.hidden = false;
    this.textContent = '';
  }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  append(...nodes) { nodes.forEach(node => { node.parentNode = this; this.children.push(node); }); }
  replaceChildren(...nodes) { this.children.forEach(node => { node.parentNode = null; }); this.children = []; this.append(...nodes); }
  addEventListener(type, callback) { this.listeners.set(type, [...(this.listeners.get(type) || []), callback]); }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  focus() {
    if (this.ownerDocument.activeElement !== this) {
      this.ownerDocument.activeElement = this;
      this.emit('focus');
    }
  }
  emit(type, detail = {}) {
    const event = { target: this, ...detail, defaultPrevented: false, propagationStopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; },
      stopImmediatePropagation() { this.immediateStopped = true; },
    };
    for (const listener of this.listeners.get(type) || []) {
      listener(event);
      if (event.immediateStopped) break;
    }
    return event;
  }
  find(className) {
    if (this.className.split(' ').includes(className)) return this;
    for (const child of this.children) { const result = child.find(className); if (result) return result; }
    return null;
  }
}

function harness(initial = []) {
  const doc = new Element('#document');
  doc.ownerDocument = doc;
  doc.createElement = tag => new Element(tag, doc);
  const form = doc.createElement('form'), input = doc.createElement('input');
  doc.append(form); form.append(input);
  const browser = { QingyinSearchHistory: history };
  browser.window = browser;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../ui/search-history-panel.js'), 'utf8'), browser);
  const state = { history: initial, searches: [], removed: [], clears: 0 };
  const panel = browser.QingyinSearchHistoryPanel.create({ input, form,
    getHistory: () => state.history,
    onSearch: keyword => state.searches.push(keyword),
    onRemove: keyword => { state.removed.push(keyword); state.history = history.remove(state.history, keyword); },
    onClear: () => { state.clears += 1; state.history = []; },
  });
  return { doc, form, input, panel, state, popup: form.find('search-history-panel'),
    list: form.find('search-history-list'), removals: form.find('search-history-removals') };
}

test('focus displays at most eight history entries and filters without interpreting query text as markup', () => {
  const unsafe = '<img src=x onerror=alert(1)>';
  const h = harness([unsafe, ...Array.from({ length: 12 }, (_, i) => `歌曲 ${i}`)]);
  assert.equal(h.popup.hidden, true);
  assert.equal(h.input.getAttribute('role'), 'combobox');
  h.input.focus();
  assert.equal(h.list.children.length, 8);
  assert.equal(h.input.getAttribute('aria-expanded'), 'true');
  const label = h.list.children[0].find('search-history-keyword');
  assert.equal(label.textContent, unsafe);
  assert.equal(label.children.length, 0);
  assert.equal(h.list.getAttribute('role'), 'listbox');
  assert.equal(h.removals.children[0].getAttribute('aria-label'), `删除搜索记录：${unsafe}`);
  h.input.value = '歌曲 11'; h.input.emit('input');
  assert.equal(h.list.children.length, 1);
  assert.equal(h.list.children[0].find('search-history-keyword').textContent, '歌曲 11');
  h.input.value = '未保存的词'; h.input.emit('input');
  assert.equal(h.form.find('search-history-empty').textContent, '没有匹配的搜索记录');
  assert.equal(h.form.find('search-history-clear').hidden, false);
});

test('arrow keys navigate suggestions and Enter searches the selected query exactly once', () => {
  const h = harness(['第一首', '第二首']);
  h.input.focus();
  assert.equal(h.input.emit('keydown', { key: 'ArrowDown' }).defaultPrevented, true);
  assert.equal(h.input.getAttribute('aria-activedescendant'), h.list.children[0].id);
  h.input.emit('keydown', { key: 'ArrowUp' });
  assert.equal(h.input.getAttribute('aria-activedescendant'), h.list.children[1].id);
  const enter = h.input.emit('keydown', { key: 'Enter' });
  assert.equal(enter.defaultPrevented, true);
  assert.equal(enter.propagationStopped, true);
  assert.deepEqual(h.state.searches, ['第二首']);
  assert.equal(h.input.value, '第二首');
  assert.equal(h.popup.hidden, true);
  assert.equal(h.input.getAttribute('aria-activedescendant'), null);
  h.input.value = ''; h.input.emit('input');
  assert.equal(h.input.emit('keydown', { key: 'Enter' }).defaultPrevented, false);
  h.form.emit('submit');
  assert.equal(h.popup.hidden, true);
});

test('IME composition preserves candidate keys and blocks accidental form submissions', () => {
  const h = harness(['中文输入']);
  h.input.focus();
  h.input.emit('keydown', { key: 'ArrowDown' });
  h.input.emit('compositionstart');
  assert.equal(h.input.emit('keydown', { key: 'Enter', isComposing: true }).defaultPrevented, false);
  assert.equal(h.input.emit('keydown', { key: 'ArrowDown', keyCode: 229 }).defaultPrevented, false);
  assert.deepEqual(h.state.searches, []);
  const submit = h.form.emit('submit');
  assert.equal(submit.defaultPrevented, true);
  assert.equal(submit.immediateStopped, true);
  h.input.emit('compositionend');
  assert.equal(h.input.getAttribute('aria-activedescendant'), null);
  assert.equal(h.form.emit('submit').defaultPrevented, false);
});

test('removing or clearing history updates the open panel without starting a search', () => {
  const h = harness(['第一首', '第二首']);
  h.input.focus();
  h.removals.children[0].emit('click');
  assert.deepEqual(h.state.removed, ['第一首']);
  assert.equal(h.list.children.length, 1);
  assert.equal(h.popup.hidden, false);
  h.form.find('search-history-clear').emit('click');
  assert.equal(h.state.clears, 1);
  assert.equal(h.list.children.length, 0);
  assert.equal(h.form.find('search-history-clear').hidden, true);
  assert.match(h.form.find('search-history-empty').textContent, /还没有搜索记录/);
  assert.deepEqual(h.state.searches, []);
  h.state.history = ['新记录']; h.panel.refresh();
  h.list.children[0].emit('click');
  assert.deepEqual(h.state.searches, ['新记录']);
});

test('Escape, leaving the form and outside clicks close the panel; internal controls remain reachable', () => {
  const h = harness(['第一首']);
  h.input.focus();
  h.form.emit('focusout', { relatedTarget: h.removals.children[0] });
  assert.equal(h.popup.hidden, false);
  h.input.emit('keydown', { key: 'Escape' });
  assert.equal(h.popup.hidden, true);
  h.input.emit('click');
  h.doc.emit('pointerdown', { target: h.list.children[0] });
  assert.equal(h.popup.hidden, false);
  h.doc.emit('pointerdown', { target: h.doc });
  assert.equal(h.popup.hidden, true);
  h.input.emit('keydown', { key: 'ArrowDown' });
  assert.equal(h.popup.hidden, false);
  h.form.emit('focusout', { relatedTarget: h.doc });
  assert.equal(h.popup.hidden, true);
});
