(function (root) {
  'use strict';
  let nextId = 0;

  function create({ input, form, getHistory, onSearch, onRemove, onClear }) {
    const doc = input.ownerDocument;
    const id = `search-history-${++nextId}`;
    const element = (tag, className, text) => {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const panel = element('div', 'search-history-panel');
    const header = element('div', 'search-history-header');
    const title = element('span', '', '搜索历史');
    const clear = element('button', 'search-history-clear', '清空');
    const content = element('div', 'search-history-content');
    const list = element('div', 'search-history-list');
    const removals = element('div', 'search-history-removals');
    const empty = element('p', 'search-history-empty');
    const hint = element('p', 'search-history-hint', '↑ ↓ 选择，Enter 搜索');
    clear.type = 'button';
    clear.setAttribute('aria-label', '清空全部搜索历史');
    title.id = `${id}-title`;
    list.id = `${id}-list`;
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-labelledby', title.id);
    empty.setAttribute('role', 'status');
    header.append(title, clear);
    content.append(list, removals);
    panel.append(header, content, empty, hint);
    panel.hidden = true;
    form.classList.add('has-search-history');
    form.append(panel);
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-haspopup', 'listbox');
    input.setAttribute('aria-controls', list.id);
    input.setAttribute('aria-expanded', 'false');

    let open = false;
    let composing = false;
    let selected = -1;
    let visible = [];
    let options = [];

    function close() {
      open = false;
      selected = -1;
      panel.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      options.forEach(option => option.setAttribute('aria-selected', 'false'));
    }

    function setSelected(index) {
      selected = index;
      options.forEach((option, i) => option.setAttribute('aria-selected', String(i === index)));
      if (options[index]) input.setAttribute('aria-activedescendant', options[index].id);
      else input.removeAttribute('aria-activedescendant');
    }

    function search(keyword) {
      input.value = keyword;
      close();
      onSearch(keyword);
    }

    function render() {
      const helper = root.QingyinSearchHistory;
      const history = helper.normalize(getHistory());
      visible = helper.filter(history, input.value).slice(0, 8);
      list.replaceChildren();
      removals.replaceChildren();
      options = [];
      selected = -1;
      input.removeAttribute('aria-activedescendant');
      clear.hidden = history.length === 0;
      content.hidden = visible.length === 0;
      empty.hidden = visible.length > 0;
      hint.hidden = visible.length === 0;
      empty.textContent = history.length === 0 ? '还没有搜索记录，搜一首喜欢的歌吧' : '没有匹配的搜索记录';
      visible.forEach((keyword, index) => {
        const option = element('div', 'search-history-option');
        const icon = element('span', 'search-history-clock', '↶');
        const label = element('span', 'search-history-keyword', keyword);
        const remove = element('button', 'search-history-remove', '×');
        option.id = `${id}-option-${index}`;
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', 'false');
        option.setAttribute('aria-label', keyword);
        option.title = keyword;
        icon.setAttribute('aria-hidden', 'true');
        option.append(icon, label);
        option.addEventListener('pointerdown', event => event.preventDefault());
        option.addEventListener('pointermove', () => setSelected(index));
        option.addEventListener('click', () => search(keyword));
        remove.type = 'button';
        remove.title = `删除“${keyword}”`;
        remove.setAttribute('aria-label', `删除搜索记录：${keyword}`);
        remove.addEventListener('click', () => {
          onRemove(keyword);
          input.focus();
          refresh();
        });
        list.append(option);
        removals.append(remove);
        options.push(option);
      });
    }

    function show() {
      open = true;
      render();
      panel.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    }

    function refresh() {
      if (open) render();
    }

    input.addEventListener('focus', show);
    input.addEventListener('click', () => { if (!open) show(); });
    input.addEventListener('input', event => {
      if (!composing && !event.isComposing) show();
    });
    input.addEventListener('compositionstart', () => { composing = true; });
    input.addEventListener('compositionend', () => {
      composing = false;
      if (doc.activeElement === input) show();
    });
    input.addEventListener('keydown', event => {
      if (composing || event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape' && open) {
        event.preventDefault();
        event.stopPropagation();
        close();
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        if (!open) show();
        if (visible.length) {
          const next = event.key === 'ArrowDown' ? selected + 1 : selected < 0 ? visible.length - 1 : selected - 1;
          setSelected((next + visible.length) % visible.length);
        }
      } else if (event.key === 'Enter' && open && selected >= 0) {
        event.preventDefault();
        event.stopPropagation();
        search(visible[selected]);
      }
    });
    clear.addEventListener('click', () => {
      onClear();
      input.focus();
      refresh();
    });
    form.addEventListener('submit', event => {
      if (composing || event.isComposing) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      close();
    }, true);
    form.addEventListener('focusout', event => {
      if (!form.contains(event.relatedTarget)) close();
    });
    doc.addEventListener('pointerdown', event => {
      if (open && !form.contains(event.target)) close();
    });

    return { refresh, close };
  }

  root.QingyinSearchHistoryPanel = { create };
})(typeof window === 'object' ? window : globalThis);
