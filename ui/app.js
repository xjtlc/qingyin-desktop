'use strict';

(() => {
  const $ = (selector, parent = document) => parent.querySelector(selector);
  const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
  const bridge = window.music;
  const audio = $('#audio');
  const { PlayerState, transportSnapshot, cancelledError, FailureNavigator, ProgressWatchdog } = window.QingyinPlayerState;
  const { OrderedStore, collectPlaylistPages } = window.QingyinLibraryState;
  const { normalize, remember, remove, filter } = window.QingyinSearchHistory;
  const { dayKey, validDailyCache } = window.QingyinDaily;
  const { designedCover, kind: playlistArtKind } = window.QingyinPlaylistArtwork;
  const { parseLyrics, activeIndex, caption: lyricCaption } = window.QingyinLyricsState;
  const { DEFAULT_BRIGHTNESS, normalizeBrightness, brightnessVariables } = window.QingyinAppearance;
  const playerState = new PlayerState();
  const failureNavigator = new FailureNavigator();
  const progressWatchdog = new ProgressWatchdog();
  const renderedHTML = new WeakMap();
  function setHTML(node, html) {
    if (renderedHTML.get(node) === html) return;
    node.innerHTML = html; renderedHTML.set(node, html);
  }
  function setText(node, value) {
    const text = String(value);
    if (node.textContent !== text) node.textContent = text;
  }
  const paths = {
    discover: '<path d="m12 3 7.8 4.5v9L12 21l-7.8-4.5v-9L12 3Z"/><path d="m12 7 4 5-4 5-4-5 4-5Z"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    playlist: '<path d="M4 5h11M4 10h11M4 15h6M18 9v10"/><path d="m18 9 3-1v4l-3 1"/><ellipse cx="15.5" cy="19" rx="2.5" ry="2"/>',
    heart: '<path d="M20.4 4.9a5.4 5.4 0 0 0-7.6.3L12 6l-.8-.8a5.4 5.4 0 0 0-7.6 7.6L12 21l8.4-8.2a5.4 5.4 0 0 0 0-7.9Z"/>',
    folder: '<path d="M3 8V5h6l2 3h10v11H3V8Z"/><path d="M3 8h8"/>',
    history: '<path d="M3 10a9 9 0 1 1 2 8M3 5v5h5"/><path d="M12 7v5l3 2"/>',
    user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',
    arrowRight: '<path d="m9 5 7 7-7 7"/>',
    arrowLeft: '<path d="m15 5-7 7 7 7"/>',
    arrowUp: '<path d="M12 19V6m-6 6 6-6 6 6"/>',
    arrowDown: '<path d="M12 5v13m6-6-6 6-6-6"/>',
    toTop: '<path d="M5 5h14M12 19V9m-5 5 5-5 5 5"/>',
    toBottom: '<path d="M5 19h14M12 5v10m5-5-5 5-5-5"/>',
    locate: '<circle cx="12" cy="12" r="6.5"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/><circle cx="12" cy="12" r="1.6"/>',
    external: '<path d="M14 3h7v7M21 3l-10 10M10 4H4v16h16v-6"/>',
    minus: '<path d="M5 12h14"/>',
    maximize: '<rect x="5" y="5" width="14" height="14" rx="1"/>',
    restore: '<path d="M8 4h12v12M4 8h12v12H4V8Z"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    music: '<path d="M9 18V5l11-2v13M9 8l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2.5"/><ellipse cx="17" cy="16" rx="3" ry="2.5"/>',
    play: '<path d="M7 4.5v15l12-7.5-12-7.5Z"/>',
    pause: '<path d="M7 5h3v14H7zM14 5h3v14h-3z"/>',
    previous: '<path d="M6 5h2v14H6zM19 5l-9 7 9 7V5Z"/>',
    next: '<path d="M16 5h2v14h-2zM5 5l9 7-9 7V5Z"/>',
    repeat: '<path d="M19 7H6a3 3 0 0 0-3 3v2M19 7l-3-3m3 3-3 3M5 17h13a3 3 0 0 0 3-3v-2M5 17l3 3m-3-3 3-3"/>',
    repeatOne: '<path d="M19 7H6a3 3 0 0 0-3 3v2M19 7l-3-3m3 3-3 3M5 17h13a3 3 0 0 0 3-3v-2M5 17l3 3m-3-3 3-3M11 10l2-1v6"/>',
    shuffle: '<path d="M3 6h2c5 0 7 12 12 12h4M17 14l4 4-4 4M3 18h2c2 0 4-2 5-4M14 9c1-2 2-3 4-3h3M17 2l4 4-4 4"/>',
    volume: '<path d="M3 9h4l5-4v14l-5-4H3V9ZM16 8a6 6 0 0 1 0 8M19 5a10 10 0 0 1 0 14"/>',
    muted: '<path d="M3 9h4l5-4v14l-5-4H3V9ZM16 9l5 6m0-6-5 6"/>',
    queue: '<path d="M3 5h18M3 10h12M3 15h12M3 20h12M19 13l4 3.5-4 3.5v-7Z"/>',
    refresh: '<path d="M20 10a8 8 0 0 0-14-5L3 8m0-5v5h5M4 14a8 8 0 0 0 14 5l3-3m0 5v-5h-5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
    scan: '<path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5M3 12h18"/>',
    logout: '<path d="M9 3H4v18h5M10 12h11m-4-4 4 4-4 4"/>',
    lyric: '<path d="M5 3h14v18H5V3ZM8 7h8M8 11h8M8 15h5"/>',
    spinner: '<path d="M21 12a9 9 0 1 1-9-9"/>',
    headphones: '<path d="M4 14v-3a8 8 0 0 1 16 0v3M4 12H2v7h4v-7H4ZM20 12h2v7h-4v-7h2Z"/>',
    sliders: '<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h9M17 17h3"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="15" cy="17" r="2"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
    keyboard: '<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M6 9h1m4 0h1m4 0h1M6 13h1m4 0h1m4 0h1M8 16h8"/>',
    playNext: '<path d="M4 4v10l8-5-8-5ZM15 4v10M4 19h16m-4-3 4 3-4 3"/>',
  };
  const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.music}</svg>`;
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const safeImage = (url) => typeof url === 'string' && (/^https:\/\//i.test(url) || /^data:image\/(?:png|jpeg|jpg|gif|webp|svg\+xml);/i.test(url)) ? url : '';
  const safeAudio = (url) => typeof url === 'string' && (/^https:\/\//i.test(url) || /^qingyin-audio:\/\/track\/[a-z\d]+$/i.test(url) || /^qingyin-stream:\/\/track\/[a-f0-9]{32}$/i.test(url)) ? url : '';
  const time = (seconds) => { const number = Math.max(0, Math.floor(Number(seconds) || 0)); return `${String(Math.floor(number / 60)).padStart(2, '0')}:${String(number % 60).padStart(2, '0')}`; };
  const songKeyOf = (song) => `${song.local ? 'local' : 'song'}:${song.hash || song.id || song.title}:${song.albumAudioId || ''}`;
  const keyOf = (song) => `${songKeyOf(song)}${song.playlistEntryId ? `:entry:${song.playlistEntryId}` : ''}`;
  const catalog = new Map();
  const state = {
    view: 'discover', stack: [], parentView: 'discover', selectedPlaylist: null,
    user: null, loggedIn: false, statusLoading: true,
    recommendations: { loading: true, loaded: false, playlists: [], songs: [], error: null },
    daily: { date: '', source: '', accountId: '', loading: false, loaded: false, songs: [], error: null },
    guess: { source: '', accountId: '', loading: false, loaded: false, songs: [], error: null },
    playlists: { loading: false, loaded: false, items: [], total: 0, hasMore: false, nextPage: null, error: null },
    detail: { loading: false, songs: [], total: 0, rawLoaded: 0, page: 0, nextPage: 1, hasMore: false, complete: false, error: null },
    search: { keyword: '', page: 1, songs: [], total: 0, loading: false, error: null },
    searchHistory: [],
    local: [], favorites: [], history: [], visibleSongs: [], visiblePlaylists: [],
    queue: [], current: null, shuffleOrder: [], audioLoading: false, playbackError: '', shuffle: false, repeat: 'all', volume: .7, muted: false,
    sort: { field: 'default', direction: 'asc' }, sortUpdatedAt: 0, effects: 'off', quality: 'auto', brightness: DEFAULT_BRIGHTNESS, taskbarLyricsEnabled: true,
    listRendered: false, listHasCurrent: false,
    output: 'browser', mpvAvailable: false, mpvErrorShown: false,
    qualities: { key: null, loading: false, tiers: [], error: null },
    modal: null, qr: null, qrBusy: false, qrEpoch: 0, qrPoll: null, qrCountdown: null,
    lyrics: { key: null, loading: false, lines: [], plain: [], error: null, active: -1 },
    saved: {},
  };
  let viewRequest = 0;
  let dailyRequest = 0;
  let guessRequest = 0;
  let coverRequest = 0;
  const playlistCovers = new Map();
  let playRequest = 0;
  let lyricRequest = 0;
  let qualityRequest = 0;
  let prefetchRequest = 0;
  let appendedKey = null;
  let prefetchedNext = null;
  let nativeQueueMutation = Promise.resolve();
  let saveTimer;
  let sortTouched = false;
  let settingsLoaded = false;
  let resolveSettingsReady;
  const settingsReady = new Promise(resolve => { resolveSettingsReady = resolve; });
  let previousFocus;
  let seeking = false;
  let locateTimer = null;
  let locateScrollEnd = null;
  let lyricsFollowTimer = null;
  let lyricsBrowsing = false;
  let taskbarLastState = '';
  let playback = null;
  let queueRevision = 0;
  let priorityNextKey = null;
  let sleepState = { active: false, mode: 'off', endsAt: null, minutes: null };
  let sleepStopped = false;
  const currentTransport = () => transportSnapshot({ backend: playback?.backend || 'browser', sourceId: playback?.url || '', native: state.mpvState, audio, fallbackDuration: state.current?.duration, restore: playback?.restore });
  const isPaused = () => currentTransport().paused;
  const settingsStore = new OrderedStore(data => bridge?.store?.set ? bridge.store.set(data) : Promise.resolve(), data => { state.saved = data; });

  function hydrateIcons(parent = document) {
    $$('[data-icon]', parent).forEach(node => { node.innerHTML = icon(node.dataset.icon); });
  }
  $('#brightness-control').insertAdjacentHTML('beforebegin', '<button class="icon-button comfort-toolbar-button" id="sleep-button" data-action="sleep" aria-label="定时停止" title="定时停止" aria-expanded="false"><span data-icon="clock"></span></button><button class="icon-button comfort-toolbar-button" id="shortcuts-button" data-action="shortcuts" aria-label="快捷操作" title="快捷操作" aria-expanded="false"><span data-icon="keyboard"></span></button>');
  $('#queue-panel .panel-header').insertAdjacentHTML('afterend', '<div class="queue-toolbar"><span>按实际播放顺序排列</span><button data-action="clear-queue" disabled>清空队列</button></div>');
  hydrateIcons();
  const searchHistoryPanel = window.QingyinSearchHistoryPanel.create({
    input: $('#search-input'), form: $('#search-form'), getHistory: () => state.searchHistory,
    onSearch: submitSearch,
    onRemove: keyword => { state.searchHistory = remove(state.searchHistory, keyword); persist(); },
    onClear: () => { state.searchHistory = []; persist(); },
  });
  function submitSearch(value) {
    const keyword = String(value || '').trim().slice(0, 100);
    $('#search-input').value = keyword;
    if (keyword) { state.searchHistory = remember(state.searchHistory, keyword); persist(); }
    searchHistoryPanel.close();
    navigate('search', { keyword });
    $('#search-input').blur();
  }
  function toast(message, error = false, undo = null) {
    const node = document.createElement('div');
    node.className = `toast${error ? ' error' : ''}`;
    node.textContent = message;
    if (undo) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'toast-action'; button.textContent = '撤销';
      button.addEventListener('click', async () => { button.disabled = true; try { await undo(); node.remove(); } catch (error) { toast(error.message || '暂时无法撤销', true); } });
      node.append(button);
    }
    $('#toast-stack').append(node);
    setTimeout(() => node.remove(), undo ? 9000 : error ? 6800 : 3500);
    while ($('#toast-stack').childElementCount > 3) $('#toast-stack').firstElementChild.remove();
  }
  async function api(method, params = {}) {
    if (!bridge?.invoke) { const error = new Error('请通过桌面快捷方式打开青音，以连接本地播放器。'); error.code = 'BRIDGE_UNAVAILABLE'; throw error; }
    const response = await bridge.invoke(method, params);
    if (!response?.ok) { const error = new Error(response?.error || '连接暂时未完成，请稍后重试。'); error.code = response?.code || 'REQUEST_FAILED'; throw error; }
    return response.data || {};
  }
  // A file extension is never part of a song's name. Trimming it here also cleans titles
  // that were saved into favourites or history before the service layer did this.
  const AUDIO_TITLE_SUFFIX = /\.(mp3|mpeg|mpga|flac|wav|wave|m4a|mp4|aac|ogg|oga|opus|ape|wma|wv|dsf|dff|aif|aiff|alac|tak|mpc)$/i;
  const cleanTitle = value => String(value ?? '').trim().replace(AUDIO_TITLE_SUFFIX, '').trim();
  function registerSongs(songs) {
    return (Array.isArray(songs) ? songs : []).filter(song => song && typeof song === 'object').map(song => {
      const normalized = { ...song, title: cleanTitle(song.title) || '未命名歌曲', artist: String(song.artist || '未知歌手'), album: String(song.album || ''), duration: Number(song.duration) || 0 };
      catalog.set(keyOf(normalized), normalized);
      return normalized;
    });
  }
  function storedSong(song) {
    const copy = { ...song };
    if (!copy.local) delete copy.url;
    return copy;
  }
  function settingsSnapshot() {
    return { ...state.saved, favorites: state.favorites.map(storedSong), history: state.history.slice(0, 100).map(storedSong), searchHistory: state.searchHistory, dailyRecommendations: { date: state.daily.date, source: state.daily.source, accountId: state.daily.accountId, songs: state.daily.songs.map(storedSong) }, sort: { field: state.sort.field, direction: state.sort.direction, updatedAt: state.sortUpdatedAt }, preferences: { volume: state.volume, shuffle: state.shuffle, repeat: state.repeat, effects: state.effects, quality: state.quality, output: state.output, brightness: state.brightness, taskbarLyricsEnabled: state.taskbarLyricsEnabled } };
  }
  async function saveSettings() {
    try {
      await settingsReady;
      if (!settingsLoaded) throw new Error('本机设置尚未读取完成，请重新打开程序后重试。');
      return await settingsStore.save(settingsSnapshot());
    } catch (error) { toast('本机设置未能保存，请检查磁盘空间后重试。', true); throw error; }
  }
  function persist(immediate = false) {
    clearTimeout(saveTimer);
    if (immediate) return saveSettings();
    saveTimer = setTimeout(() => { saveSettings().catch(() => {}); }, 180);
  }
  function setBrightness(value, save = true) {
    state.brightness = normalizeBrightness(value);
    const vars = brightnessVariables(state.brightness);
    for (const [name, cssValue] of Object.entries(vars)) document.documentElement.style.setProperty(name, cssValue);
    $('#brightness-slider').value = String(state.brightness);
    $('#brightness-value').textContent = state.brightness + '%';
    if (save) persist();
  }
  function persistSort() {
    sortTouched = true; state.sortUpdatedAt = Math.max(Date.now(), state.sortUpdatedAt + 1);
    // This contains only display preferences. A synchronous mirror protects the last
    // click even when Windows closes the renderer before IPC acknowledgement.
    try { localStorage.setItem('qingyin.sort.v1', JSON.stringify({ ...state.sort, updatedAt: state.sortUpdatedAt })); } catch { /* Native storage remains the primary copy. */ }
    return persist(true);
  }
  function isFavorite(song) { return state.favorites.some(item => songKeyOf(item) === songKeyOf(song)); }
  function favorite(song) {
    if (!song) return;
    const selected = isFavorite(song);
    // Stamp the moment it was saved so 本机收藏 can be ordered by 添加时间.
    state.favorites = selected ? state.favorites.filter(item => songKeyOf(item) !== songKeyOf(song)) : [{ ...storedSong(song), addedAt: Date.now() }, ...state.favorites];
    persist(); updateCounts(); updatePlayer(); renderPreserve(); renderQueue();
    toast(selected ? '已移出本机收藏' : '已加入本机收藏');
  }
  function addHistory(song) {
    state.history = [storedSong(song), ...state.history.filter(item => songKeyOf(item) !== songKeyOf(song))].slice(0, 100);
    persist();
    if (state.view === 'history') renderPreserve();
  }
  function cover(song, className = '') {
    const image = safeImage(song.cover);
    return image ? `<img class="${esc(className)}" src="${esc(image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : icon('music');
  }
  function playlistCover(list) {
    const image = safeImage(list.cover);
    return image ? `<img src="${esc(image)}" data-playlist-image="true" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<img class="playlist-designed-cover" data-playlist-art="${playlistArtKind(list)}" src="${esc(designedCover(list))}" alt="" loading="lazy">`;
  }
  function playlistParams(list) { return { id: list.id, listId: list.listId, globalId: list.globalId, type: list.type }; }
  function empty({ heading, message, symbol = 'music', action = '', label = '', secondary = false, className = '' }) {
    return `<div class="empty-card ${esc(className)}"><div class="empty-illustration">${icon(symbol)}</div><div><h3>${esc(heading)}</h3><p>${esc(message)}</p>${action ? `<button class="${secondary ? 'secondary-button' : 'primary-button'}" data-action="${esc(action)}">${icon(action === 'account' ? 'scan' : action === 'import' ? 'plus' : 'refresh')}${esc(label)}</button>` : ''}</div></div>`;
  }
  function errorCard(error, retryAction) {
    const login = error?.code === 'LOGIN_REQUIRED' || error?.code === 'AUTH_REQUIRED' || error?.code === 'SESSION_EXPIRED';
    return `<div class="error-card"><div class="empty-illustration">${icon(login ? 'scan' : 'info')}</div><div><h3>${login ? '先登录，找回你的音乐' : '连接暂时停了一拍'}</h3><p>${esc(error?.message || '服务暂时未响应，请稍后重试。')}</p></div><button class="secondary-button" data-action="${login ? 'reauth' : retryAction}">${icon(login ? 'scan' : 'refresh')}${login ? '扫码登录' : '重新加载'}</button></div>`;
  }
  const loading = (label = '正在加载音乐…') => `<div class="content-loading"><div class="loading-disc"></div><span>${esc(label)}</span></div>`;
  function skeletons() { return `<div class="skeleton-grid preview-grid">${Array.from({ length: 5 }, () => '<div class="skeleton-card"><div class="skeleton-cover"></div><div class="skeleton-line"></div><div class="skeleton-line short"></div></div>').join('')}</div>`; }
  function renderPlaylists(playlists, preview = false) {
    state.visiblePlaylists = playlists;
    return `<div class="playlist-grid${preview ? ' preview-grid' : ''}">${playlists.map((list, index) => `<button class="playlist-card" data-action="open-playlist" data-playlist-index="${index}" aria-label="打开歌单：${esc(list.title)}"><span class="playlist-cover">${playlistCover(list)}${Number(list.count) > 0 ? `<span class="cover-count">${Number(list.count).toLocaleString()} 首</span>` : ''}<span class="card-play">${icon('play')}</span></span><span class="playlist-title">${esc(list.title || '未命名歌单')}</span><span class="playlist-description">${state.view === 'playlists' ? '酷狗概念版 · 我的歌单' : '酷狗概念版歌单'}</span></button>`).join('')}</div>`;
  }
  function trackRows(songs, compact = false) {
    return songs.map((song, index) => {
      const key = keyOf(song), current = state.current && keyOf(state.current) === key, selected = isFavorite(song);
      // Rows are numbered by where they sit on screen, so the first row always reads 01.
      const label = String(index + 1).padStart(2, '0');
      return `<div class="track-row${current ? ' current' : ''}" data-track-key="${esc(key)}"><span class="track-index"><span class="track-position" data-number="${label}">${current ? `<span class="playing-wave${isPaused() ? ' paused' : ''}"><i></i><i></i><i></i></span>` : label}</span><button data-action="play-song" data-key="${esc(key)}" aria-label="播放 ${esc(song.title)}" title="播放">${icon('play')}</button></span><div class="track-name-cell"><span class="track-thumb">${cover(song)}</span><div class="track-text"><button class="track-title" data-action="play-song" data-key="${esc(key)}" title="${esc(song.title)}">${esc(song.title)}</button><div class="track-artist">${song.local ? '<small class="local-badge">本地</small>' : ''}<span>${esc(song.artist)}</span></div></div></div><span class="track-album" title="${esc(song.album)}">${esc(song.album || '—')}</span><span class="track-duration">${song.duration > 0 ? time(song.duration) : '—'}</span><div class="track-actions"><button class="icon-button${selected ? ' favorite-on' : ''}" data-action="favorite-song" data-key="${esc(key)}" aria-label="${selected ? '取消本机收藏' : '本机收藏'} ${esc(song.title)}" title="${selected ? '取消本机收藏' : '加入本机收藏'}">${icon('heart')}</button><button class="icon-button play-next-action" data-action="play-next" data-key="${esc(key)}" aria-label="下一首播放 ${esc(song.title)}" title="下一首播放">${icon('playNext')}</button><button class="icon-button" data-action="enqueue" data-key="${esc(key)}" aria-label="加入播放队列 ${esc(song.title)}" title="加入播放队列">${icon('plus')}</button></div></div>`;
    }).join('');
  }
  const SORT_FIELDS = { default: '默认顺序', title: '标题', artist: '歌手', added: '添加时间' };
  function sortSongs(songs, field = state.sort.field) {
    const { direction } = state.sort;
    if (songs.length < 2) return songs;
    // Reversing the untouched order is a first-class choice: a playlist can legitimately
    // be wanted last-track-first, and the order the service returns is not always it.
    if (field === 'default') return direction === 'desc' ? [...songs].reverse() : songs;
    const weight = direction === 'desc' ? -1 : 1;
    if (field === 'added') {
      // Songs saved before this version carry no stamp; they sink to the older end
      // while keeping their stored (newest-first) relative order.
      return [...songs].sort((a, b) => weight * ((Number(a.addedAt) || 0) - (Number(b.addedAt) || 0)));
    }
    // Chinese titles need collation-aware ordering; numeric keeps "第2首" before "第10首".
    const text = song => String((field === 'title' ? song.title : song.artist) || '');
    return [...songs].sort((a, b) => weight * text(a).localeCompare(text(b), 'zh-Hans-CN', { numeric: true, sensitivity: 'base' }));
  }
  function sortToolbar(fields) {
    const { direction } = state.sort;
    const active = fields.includes(state.sort.field) ? state.sort.field : 'default';
    const chip = value => `<button class="sort-chip${active === value ? ' active' : ''}" data-action="sort-list" data-field="${value}" aria-pressed="${active === value}">${SORT_FIELDS[value]}</button>`;
    return `<div class="list-toolbar"><span class="list-toolbar-label">排序</span>${fields.map(chip).join('')}<button class="sort-chip" data-action="sort-direction" aria-label="切换升序或降序" title="切换升序或降序">${icon(direction === 'asc' ? 'arrowUp' : 'arrowDown')}${direction === 'asc' ? '升序' : '降序'}</button></div>`;
  }
  // The jump controls live in a fixed rail, not in this toolbar: a toolbar scrolls out of
  // view exactly when a long list makes the buttons worth pressing.
  function updateListRail() {
    const rail = $('#list-rail');
    if (!rail) return;
    const visible = state.listRendered && state.visibleSongs.length > 0;
    rail.hidden = !visible;
    $('#main-content').classList.toggle('has-rail', visible);
    const button = rail.querySelector('[data-jump="current"]');
    button.disabled = !state.listHasCurrent;
    const label = state.listHasCurrent ? '定位到正在播放的歌曲' : '当前没有正在播放且在本列表中的歌曲';
    button.title = label; button.setAttribute('aria-label', label);
  }
  function jumpInList(destination) {
    const main = $('#main-content');
    if ($('#list-rail').hidden) return;
    clearTimeout(locateTimer);
    if (locateScrollEnd) main.removeEventListener('scrollend', locateScrollEnd);
    locateScrollEnd = null;
    $$('.track-row.located', main).forEach(item => item.classList.remove('located'));
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
    if (destination === 'top' || destination === 'bottom') {
      main.scrollTo({ top: destination === 'top' ? 0 : main.scrollHeight - main.clientHeight, behavior });
      return;
    }
    if (destination !== 'current' || !state.current || !state.listHasCurrent) return;
    const row = main.querySelector(`.track-list .track-row[data-track-key="${CSS.escape(keyOf(state.current))}"]`);
    if (!row) { updateListRail(); return; }
    const bounds = row.getBoundingClientRect(), pane = main.getBoundingClientRect();
    const top = main.scrollTop + bounds.top - pane.top - (main.clientHeight - bounds.height) / 2;
    const target = Math.max(0, Math.min(top, main.scrollHeight - main.clientHeight));
    row.classList.add('located');
    const settled = (force = false) => {
      if (locateScrollEnd !== settled) return;
      if (force !== true && Math.abs(main.scrollTop - target) > 2) return;
      main.removeEventListener('scrollend', settled);
      locateScrollEnd = null; clearTimeout(locateTimer);
      if (row.isConnected) { row.classList.add('located'); locateTimer = setTimeout(() => row.classList.remove('located'), 1800); }
    };
    locateScrollEnd = settled;
    if (Math.abs(main.scrollTop - target) <= 1 || behavior === 'instant') {
      main.scrollTo({ top: target, behavior }); settled(true);
    } else {
      main.addEventListener('scrollend', settled);
      locateTimer = setTimeout(() => settled(true), 5000);
      main.scrollTo({ top: target, behavior });
    }
  }
  function trackList(songs, fields = ['default', 'title', 'artist'], { preserveOrder = false } = {}) {
    const field = fields.includes(state.sort.field) ? state.sort.field : 'default';
    const ordered = preserveOrder ? songs : sortSongs(songs, field);
    state.visibleSongs = ordered;
    const currentKey = state.current ? keyOf(state.current) : null;
    state.listRendered = true;
    state.listHasCurrent = Boolean(currentKey) && ordered.some(song => keyOf(song) === currentKey);
    const partial = state.view === 'detail' && state.detail.hasMore && state.sort.direction === 'desc';
    const note = partial ? `<div class="inline-message">${icon('info')}${state.detail.loading ? '正在自动读取完整歌单，完成后按倒序排列。' : '歌单读取未完成，请继续读取后查看完整倒序。'}</div>` : '';
    return (preserveOrder ? '' : sortToolbar(fields)) + note + `<div class="list-header"><span>#</span><span>歌曲 / 歌手</span><span>专辑</span><span>时长</span><span>操作</span></div><div class="track-list">${trackRows(ordered)}</div>`;
  }
  function renderDiscover() {
    const rec = state.recommendations;
    const playlists = rec.playlists.slice(0, 5);
    state.visibleSongs = rec.songs.slice(0, 3);
    const bottomSongs = state.visibleSongs.length ? `<div><div class="section-head"><h2>听点新鲜的<small>FRESH SOUNDS</small></h2></div><div class="compact-tracks">${trackRows(state.visibleSongs, true)}</div></div>` : `<div class="welcome-card"><div><h3>${state.loggedIn ? '手机里的喜欢，也在这里。' : '你熟悉的歌，我们接着听。'}</h3><p>${state.loggedIn ? '打开概念版歌单，延续此刻的好心情。' : '用酷狗概念版扫码登录，读取你的账号歌单。'}</p><button class="primary-button" data-action="${state.loggedIn ? 'my-playlists' : 'account'}">${icon(state.loggedIn ? 'playlist' : 'scan')}${state.loggedIn ? '打开我的歌单' : '登录概念版账号'}</button></div><div class="welcome-card-art">${icon('headphones')}</div></div>`;
    return `<div class="page-intro"><div><h1>此刻，听点喜欢的。</h1><p>A LITTLE MUSIC. A LITTLE MORE YOU.</p></div><button class="small-pill" data-action="refresh-discover" title="刷新推荐歌单">${icon('refresh')}换一点灵感</button></div><section class="discover-hero"><div class="hero-copy"><div class="hero-kicker">MUSIC FOR YOUR EVERYDAY</div><h2>把生活调成<br><span>你喜欢的频率。</span></h2><p>一段旋律，一点松弛。<br>在自己的节奏里，慢慢找到好心情。</p><div class="hero-actions"><button class="primary-button" data-action="explore">${icon('play')}探索歌单</button><button class="hero-link" data-action="import">导入本地音乐 ${icon('arrowRight')}</button></div></div><div class="hero-art" aria-hidden="true"><div class="hero-grid"></div><div class="hero-orbit"></div><div class="hero-orbit second"></div><div class="hero-record"><div class="hero-record-label"><strong>青音</strong><small>QINGYIN / SIDE A</small></div></div><span class="hero-spark">✳</span><div class="hero-badge"><span></span><span></span><span></span><span></span><span></span><span></span></div><div class="hero-caption">STAY IN YOUR OWN RHYTHM</div></div></section><section id="recommendations"><div class="section-head"><h2>发现好歌单<small>CURATED PLAYLISTS</small></h2>${rec.loaded && rec.playlists.length > 5 ? `<button class="text-button" data-action="all-recommendations">查看全部 ${icon('arrowRight')}</button>` : ''}</div>${rec.loading ? skeletons() : rec.error ? errorCard(rec.error, 'refresh-discover') : playlists.length ? renderPlaylists(playlists, true) : empty({ heading: '新的歌单还在路上', message: '暂时没有获取到推荐歌单。稍后刷新，或从本地音乐开始。', action: 'refresh-discover', label: '刷新歌单', secondary: true, className: 'empty-discover' })}</section><div class="discover-bottom">${bottomSongs}<div class="library-shortcut"><div class="eyebrow">A SPACE FOR YOUR COLLECTION</div><h3>你的收藏，<br>你的声音角落。</h3><p>把喜欢的歌留在本机，随时回到熟悉的旋律。</p><button class="text-button" data-action="my-favorites">打开本机收藏 ${icon('arrowRight')}</button><div class="shortcut-art" aria-hidden="true">${icon('heart')}</div></div></div>`;
  }
  function renderDaily() {
    const daily = state.daily, today = dayKey();
    const head = '<div class="page-intro personalized-heading"><div><div class="daily-today">' + esc(today) + ' · FOR YOU TODAY</div><h1>每日推荐</h1><p>每天，和喜欢的旋律见一面。</p></div><button class="small-pill" data-action="refresh-daily"' + (daily.loading ? ' disabled' : '') + '>' + icon('refresh') + '刷新推荐</button></div>';
    if (state.statusLoading) return head + loading('正在连接你的账号…');
    if (!state.loggedIn) return head + empty({ heading: '今天的好歌，为你而来', message: '登录酷狗概念版账号，听听酷狗为你准备的每日推荐。', symbol: 'music', action: 'account', label: '登录后听推荐' });
    if (daily.loading || !daily.loaded && !daily.error) return head + loading('正在读取酷狗每日推荐…');
    if (daily.error?.code === 'RECOMMENDATIONS_EMPTY') return head + empty({ heading: '今日推荐还在路上', message: '酷狗暂未返回推荐歌曲，稍后再来听听。', symbol: 'music', action: 'refresh-daily', label: '重新获取' });
    if (daily.error) return head + errorCard(daily.error, 'refresh-daily');
    if (!daily.songs.length) return head + empty({ heading: '今日推荐还在路上', message: '酷狗暂未返回推荐歌曲，稍后再来听听。', symbol: 'music', action: 'refresh-daily', label: '重新获取' });
    return head + '<p class="recommendation-summary">酷狗为你推荐 · 今日 ' + daily.songs.length + ' 首</p><div class="library-actions daily-actions"><button class="primary-button" data-action="play-all">' + icon('play') + '播放今日推荐</button><button class="secondary-button" data-action="enqueue-all">' + icon('plus') + '加入队列</button></div>' +
      trackList(daily.songs, undefined, { preserveOrder: true });
  }
  function renderGuess() {
    const guess = state.guess;
    const head = `<div class="page-intro personalized-heading"><div><div class="daily-today">YOUR PERSONAL RADIO</div><h1>猜你喜欢</h1><p>沿着你的喜好，遇见下一首好歌。</p></div><button class="small-pill" data-action="refresh-guess"${guess.loading ? ' disabled' : ''}>${icon('refresh')}换一批</button></div>`;
    if (state.statusLoading) return head + loading('正在连接你的账号…');
    if (!state.loggedIn) return head + empty({ heading: '从喜欢，听到更多喜欢', message: '登录酷狗概念版账号，开启你的专属推荐。', symbol: 'headphones', action: 'account', label: '登录后听推荐' });
    if (guess.loading || !guess.loaded && !guess.error) return head + loading('正在寻找合你心意的歌…');
    if (guess.error?.code === 'RECOMMENDATIONS_EMPTY') return head + empty({ heading: '下一段旋律还在路上', message: '酷狗暂未返回推荐歌曲，稍后换一批试试。', symbol: 'headphones', action: 'refresh-guess', label: '换一批' });
    if (guess.error) return head + errorCard(guess.error, 'refresh-guess');
    if (!guess.songs.length) return head + empty({ heading: '下一段旋律还在路上', message: '酷狗暂未返回推荐歌曲，稍后换一批试试。', symbol: 'headphones', action: 'refresh-guess', label: '换一批' });
    return head + `<p class="recommendation-summary">来自酷狗猜你喜欢 · 为你挑选 ${guess.songs.length} 首</p><div class="library-actions personalized-actions"><button class="primary-button" data-action="play-all">${icon('play')}播放这一批</button><button class="secondary-button" data-action="enqueue-all">${icon('plus')}加入队列</button></div>` + trackList(guess.songs, undefined, { preserveOrder: true });
  }
  function renderSearch() {
    const search = state.search;
    const intro = `<div class="page-intro search-heading"><div><h1>${search.keyword ? '找到你想听的。' : '想听什么，搜一下。'}</h1><p>每一首歌，都有一个抵达你的方式。</p></div></div>`;
    if (!search.keyword) return intro + empty({ heading: '从一首歌的名字开始', message: '在上方搜索框输入歌曲、歌手或专辑名称，按 Enter 查找酷狗概念版音乐。', symbol: 'search', className: 'search-empty' }) + '<div class="inline-message">' + icon('info') + '搜索音乐需要登录酷狗概念版账号。账号歌单会在扫码确认后加载。</div>';
    const summary = `<div class="search-summary">搜索 <strong>“${esc(search.keyword)}”</strong>${!search.loading && !search.error ? ` · 找到 ${Number(search.total).toLocaleString()} 首歌曲` : ''}</div>`;
    if (search.loading) return intro + summary + loading('正在寻找你想听的音乐…');
    if (search.error) return intro + summary + errorCard(search.error, 'retry-search');
    if (!search.songs.length) return intro + summary + empty({ heading: '还没找到这段旋律', message: '试试更短的关键词，或输入歌手名字再次搜索。', symbol: 'search' });
    return intro + summary + `<div class="library-actions"><button class="primary-button" data-action="play-all">${icon('play')}播放本页</button><button class="secondary-button" data-action="enqueue-all">${icon('plus')}加入队列</button></div>` + '<div class="search-order-note">按搜索相关性排序</div>' + trackList(search.songs, undefined, { preserveOrder: true }) + `<div class="pagination"><button class="secondary-button" data-action="search-previous" ${search.page <= 1 ? 'disabled' : ''}>${icon('arrowLeft')}上一页</button><span>第 ${search.page} 页</span><button class="secondary-button" data-action="search-next" ${search.page * 30 >= search.total ? 'disabled' : ''}>下一页 ${icon('arrowRight')}</button></div>`;
  }
  function renderAccountPlaylists() {
    const intro = '<div class="page-intro"><div><h1>我的概念版歌单</h1><p>熟悉的旋律，从手机来到桌面。</p></div><button class="small-pill" data-action="refresh-playlists">' + icon('refresh') + '刷新歌单</button></div>';
    if (!state.loggedIn) return intro + empty({ heading: '让你的歌单，来到这里', message: '使用酷狗概念版 App 扫码，并在手机上确认。登录后读取你账号里的概念版歌单。', symbol: 'playlist', action: 'account', label: '登录概念版账号' });
    if (state.playlists.loading) return intro + loading('正在读取你的概念版歌单…');
    if (state.playlists.error) return intro + errorCard(state.playlists.error, 'refresh-playlists');
    if (!state.playlists.items.length) return intro + empty({ heading: '歌单里，还留着很多可能', message: '暂未读取到账号歌单。你可以在酷狗概念版 App 中查看歌单，再点击刷新。', symbol: 'playlist', action: 'refresh-playlists', label: '刷新歌单', secondary: true });
    return intro + renderPlaylists(state.playlists.items) + (state.playlists.hasMore ? `<div class="pagination"><span>已加载 ${state.playlists.items.length} 张歌单</span><button class="secondary-button" data-action="more-playlists">加载更多歌单 ${icon('arrowRight')}</button></div>` : '');
  }
  function renderDetail() {
    const list = state.selectedPlaylist || {}, detail = state.detail;
    const count = detail.total || Number(list.count) || detail.songs.length;
    const head = `<div class="library-header"><div class="library-art">${playlistCover(list)}</div><div class="library-copy"><div class="eyebrow">KUGOU CONCEPT PLAYLIST</div><h1>${esc(list.title || '歌单')}</h1><p>${count ? `${count.toLocaleString()} 首歌曲 · ` : ''}酷狗概念版歌单</p></div></div>`;
    if (detail.loading && !detail.songs.length) return head + loading('正在打开歌单…');
    if (detail.error && !detail.songs.length) return head + errorCard(detail.error, 'retry-detail');
    if (!detail.songs.length) return head + empty({ heading: '这张歌单，还没有声音', message: '暂未读取到歌曲。你可以刷新歌单，或在酷狗概念版 App 中检查内容。', symbol: 'playlist', action: 'retry-detail', label: '重新读取', secondary: true });
    const pending = !detail.complete;
    const progress = pending ? `<div class="playlist-load-status${detail.loading ? ' loading' : ''}" role="status" aria-live="polite"><span>${detail.loading ? '正在加载全部歌曲' : '等待继续读取'}</span><span>${detail.rawLoaded || detail.songs.length} / ${detail.total || '更多'} 首</span>${!detail.loading ? '<button class="text-button" data-action="more-detail">继续读取</button>' : ''}</div>` : '';
    return head + `<div class="library-actions"><button class="primary-button" data-action="play-all"${pending ? ' disabled' : ''}>${icon('play')}播放全部</button><button class="secondary-button" data-action="enqueue-all"${pending ? ' disabled' : ''}>${icon('plus')}加入队列</button><button class="text-button" data-action="retry-detail">${icon('refresh')}刷新</button></div>` + progress + trackList(detail.songs) + (detail.error ? errorCard(detail.error, 'more-detail') : '');
  }
  function renderLibrary() {
    const type = state.view;
    const config = {
      local: { title: '本地音乐', subtitle: '你电脑里的声音，随时打开就能听。', eyebrow: 'YOUR LOCAL SOUND', symbol: 'folder', songs: state.local, className: 'local-art' },
      favorites: { title: '本机收藏', subtitle: '留在这台电脑里的喜欢。不会同步到酷狗账号。', eyebrow: 'SAVED ON THIS COMPUTER', symbol: 'heart', songs: state.favorites, className: 'favorites-art' },
      history: { title: '最近播放', subtitle: '那些陪过你的旋律，值得再听一遍。', eyebrow: 'A LITTLE REWIND', symbol: 'history', songs: state.history, className: 'history-art' },
    }[type];
    const head = `<div class="library-header"><div class="library-art ${config.className}">${icon(config.symbol)}</div><div class="library-copy"><div class="eyebrow">${config.eyebrow}</div><h1>${config.title}</h1><p>${config.songs.length} 首歌曲 · ${config.subtitle}</p></div></div>`;
    const actions = `<div class="library-actions">${config.songs.length ? `<button class="primary-button" data-action="play-all">${icon('play')}播放全部</button>` : ''}${type === 'local' ? `<button class="${config.songs.length ? 'secondary' : 'primary'}-button" data-action="import">${icon('plus')}添加本地音乐</button>` : ''}${config.songs.length ? `<button class="secondary-button" data-action="enqueue-all">${icon('plus')}加入队列</button>` : ''}</div>`;
    if (!config.songs.length) return head + actions + empty(type === 'local' ? { heading: '给你的音乐，留个位置', message: '添加电脑上的 MP3、FLAC、WAV、M4A 等音乐文件。不用登录，也能听。', symbol: 'folder' } : type === 'favorites' ? { heading: '喜欢的旋律，慢慢收集', message: '点击歌曲旁的爱心，把喜欢的歌留在这台电脑。', symbol: 'heart' } : { heading: '好音乐，会留下回响', message: '开始播放一首歌，这里就会留下你的聆听足迹。', symbol: 'history' });
    return head + actions + trackList(config.songs, type === 'favorites' ? ['default', 'title', 'artist', 'added'] : undefined);
  }
  function renderMain() {
    state.visibleSongs = []; state.visiblePlaylists = [];
    state.listRendered = false; state.listHasCurrent = false;
    const labels = { discover: '音乐发现', daily: '每日推荐', guess: '猜你喜欢', search: '搜索结果', playlists: '概念版歌单', favorites: '本机收藏', local: '本地音乐', history: '最近播放', detail: '歌单详情', recommendations: '发现好歌单' };
    $('#topbar-location').textContent = labels[state.view] || '音乐发现';
    const navView = state.view === 'detail' ? state.parentView === 'playlists' ? 'playlists' : 'discover' : state.view === 'recommendations' ? 'discover' : state.view;
    $$('.nav-item').forEach(button => { const active = button.dataset.view === navView; button.classList.toggle('active', active); active ? button.setAttribute('aria-current', 'page') : button.removeAttribute('aria-current'); });
    let html;
    if (state.view === 'discover') html = renderDiscover();
    else if (state.view === 'search') html = renderSearch();
    else if (state.view === 'daily') html = renderDaily();
    else if (state.view === 'guess') html = renderGuess();
    else if (state.view === 'playlists') html = renderAccountPlaylists();
    else if (state.view === 'detail') html = renderDetail();
    else if (state.view === 'recommendations') html = '<div class="page-intro"><div><h1>发现好歌单</h1><p>给每一种心情，选一张合拍的歌单。</p></div><button class="small-pill" data-action="refresh-discover">' + icon('refresh') + '刷新歌单</button></div>' + (state.recommendations.loading ? skeletons() : state.recommendations.error ? errorCard(state.recommendations.error, 'refresh-discover') : renderPlaylists(state.recommendations.playlists));
    else html = renderLibrary();
    $('#main-content').innerHTML = html;
    updateListRail();
  }
  function renderPreserve() {
    const scroll = $('#main-content').scrollTop;
    renderMain();
    // Restore instantly: the pane carries `scroll-behavior: smooth`, which would otherwise
    // animate the restore and stall whenever the window is in the background.
    $('#main-content').scrollTo({ top: scroll, behavior: 'instant' });
  }
  function snapshot() { return { view: state.view, parentView: state.parentView, selectedPlaylist: state.selectedPlaylist, detail: state.detail }; }
  async function navigate(view, options = {}) {
    if (state.view !== view || options.playlist) state.stack.push(snapshot());
    state.view = view;
    $('#queue-panel').hidden = true;
    closeLyrics();
    $('#effects-panel').hidden = true;
    $('#quality-panel').hidden = true;
    $('#output-panel').hidden = true;
    $('#lyrics-button').classList.remove('active');
    if (view === 'detail') { state.parentView = options.parent || state.parentView; state.selectedPlaylist = options.playlist || state.selectedPlaylist; state.detail = { loading: true, songs: [], total: Number(state.selectedPlaylist?.count) || 0, rawLoaded: 0, page: 0, nextPage: 1, hasMore: false, complete: false, error: null }; }
    if (view === 'search' && options.keyword !== undefined) state.search = { keyword: options.keyword, page: 1, songs: [], total: 0, loading: Boolean(options.keyword), error: null };
    renderMain(); $('#main-content').scrollTop = 0;
    if (view === 'search') { if (options.keyword !== undefined && options.keyword) loadSearch(); else if (!state.search.keyword) $('#search-input').focus(); }
    if (view === 'daily' && (!state.daily.loaded || state.daily.date !== dayKey() || state.daily.error)) loadDailyRecommendations();
    if (view === 'guess' && (!state.guess.loaded || state.guess.error)) loadGuessYouLike();
    if (view === 'playlists' && state.loggedIn && !state.playlists.loaded) loadPlaylists();
    if (view === 'detail') loadDetail();
  }
  function goBack() {
    const previous = state.stack.pop();
    if (previous) { viewRequest++; Object.assign(state, previous); renderMain(); $('#main-content').scrollTop = 0; if (state.view === 'detail' && state.detail.loading) loadDetail(); if (state.view === 'search' && state.search.loading) loadSearch(); if (state.view === 'daily' && (!state.daily.loaded || state.daily.date !== dayKey())) loadDailyRecommendations(); if (state.view === 'guess' && !state.guess.loaded) loadGuessYouLike(); }
    else if (state.view !== 'discover') { state.view = 'discover'; renderMain(); }
  }
  async function loadRecommendations() {
    state.recommendations.loading = true; state.recommendations.error = null;
    if (['discover', 'recommendations'].includes(state.view)) renderPreserve();
    try {
      const data = await api('recommendations');
      state.recommendations = { loading: false, loaded: true, playlists: Array.isArray(data.playlists) ? data.playlists : [], songs: registerSongs(data.songs), error: null };
    } catch (error) { state.recommendations.loading = false; state.recommendations.error = error; }
    if (['discover', 'recommendations'].includes(state.view)) renderPreserve();
  }
  async function loadDailyRecommendations(force = false) {
    const today = dayKey();
    if (state.statusLoading || !state.loggedIn || state.daily.loading) return;
    const accountId = String(state.user?.id || '');
    if (!force && validDailyCache(state.daily, accountId, today)) return;
    const request = ++dailyRequest;
    const session = playerState.session;
    const isCurrent = () => request === dailyRequest && session === playerState.session && state.loggedIn && String(state.user?.id || '') === accountId;
    state.daily = { date: today, source: '', accountId, loading: true, loaded: false, songs: [], error: null };
    if (state.view === 'daily') renderPreserve();
    try {
      const data = await api('dailyRecommendations');
      if (!isCurrent()) return;
      if (data.source !== 'kugou-daily' || String(data.accountId) !== accountId) throw new Error('推荐账号未能确认，请重新登录后再试。');
      state.daily = { date: today, source: data.source, accountId, loading: false, loaded: true, songs: registerSongs(data.songs), error: null };
      persist();
    } catch (error) {
      if (!isCurrent()) return;
      state.daily = { date: today, source: '', accountId, loading: false, loaded: false, songs: [], error };
    }
    if (state.view === 'daily') renderPreserve();
  }
  async function loadGuessYouLike(force = false) {
    if (state.statusLoading || !state.loggedIn || state.guess.loading) return;
    const accountId = String(state.user?.id || '');
    if (!force && state.guess.loaded && state.guess.accountId === accountId) return;
    const request = ++guessRequest, session = playerState.session;
    const isCurrent = () => request === guessRequest && session === playerState.session && state.loggedIn && String(state.user?.id || '') === accountId;
    state.guess = { source: '', accountId, loading: true, loaded: false, songs: [], error: null };
    if (state.view === 'guess') renderPreserve();
    try {
      const data = await api('guessYouLike');
      if (!isCurrent()) return;
      if (data.source !== 'kugou-personal-fm' || String(data.accountId) !== accountId) throw new Error('推荐账号未能确认，请重新登录后再试。');
      state.guess = { source: data.source, accountId, loading: false, loaded: true, songs: registerSongs(data.songs), error: null };
    } catch (error) {
      if (!isCurrent()) return;
      state.guess = { source: '', accountId, loading: false, loaded: false, songs: [], error };
    }
    if (state.view === 'guess') renderPreserve();
  }
  async function enrichPlaylistCovers(items) {
    const request = ++coverRequest, session = playerState.session;
    const pending = items.filter(list => !safeImage(list.cover) && Number(list.count) > 0);
    const isCurrent = () => request === coverRequest && session === playerState.session && state.loggedIn;
    async function worker() {
      while (pending.length && isCurrent()) {
        const list = pending.shift(), key = String(list.listId || list.globalId || list.id);
        let image = playlistCovers.get(key);
        if (!image) {
          try {
            const data = await api('playlistSongs', { ...playlistParams(list), page: 1, pageSize: 8 });
            image = (data.songs || []).map(song => safeImage(song.cover)).find(Boolean);
          } catch { /* A temporary cover failure must not prevent opening the playlist. */ }
        }
        if (!isCurrent()) return;
        if (image) {
          playlistCovers.set(key, image); list.cover = image;
          if (state.selectedPlaylist?.id === list.id) state.selectedPlaylist.cover = image;
          if (state.view === 'playlists' || state.view === 'detail' && state.selectedPlaylist?.id === list.id) renderPreserve();
        }
      }
    }
    await Promise.all([worker(), worker()]);
  }
  async function loadPlaylists(more = false) {
    const session = playerState.session;
    state.playlists.loading = true; state.playlists.error = null;
    if (state.view === 'playlists') renderPreserve();
    try { const data = await api('playlists', more && state.playlists.nextPage ? { page: state.playlists.nextPage } : {}); if (session !== playerState.session) return; const received = Array.isArray(data.playlists) ? data.playlists : []; const combined = more ? [...state.playlists.items, ...received] : received; state.playlists = { loading: false, loaded: true, items: [...new Map(combined.map(item => [String(item.id), item])).values()], total: Number(data.total) || combined.length, hasMore: Boolean(data.hasMore), nextPage: data.nextPage, error: null }; }
    catch (error) { if (session !== playerState.session) return; state.playlists.loading = false; state.playlists.error = error; }
    updateCounts(); if (state.view === 'playlists') renderPreserve();
    if (!state.playlists.error && session === playerState.session) enrichPlaylistCovers(state.playlists.items);
  }
  async function loadSearch() {
    const request = ++viewRequest;
    const { keyword, page } = state.search;
    if (!keyword) return;
    state.search.loading = true; state.search.error = null;
    if (state.view === 'search') renderPreserve();
    try {
      const data = await api('search', { keyword, page });
      if (request !== viewRequest || state.search.keyword !== keyword || state.search.page !== page) return;
      state.search.songs = registerSongs(data.songs); state.search.total = Number(data.total) || state.search.songs.length; state.search.loading = false;
    } catch (error) { if (request !== viewRequest) return; state.search.loading = false; state.search.error = error; }
    if (state.view === 'search') renderPreserve();
  }
  async function loadDetail(more = false) {
    const request = ++viewRequest, list = state.selectedPlaylist;
    if (!list) return;
    const session = playerState.session;
    const isCurrent = () => request === viewRequest && session === playerState.session && state.selectedPlaylist === list && state.view === 'detail';
    await collectPlaylistPages({
      initial: more ? state.detail : { total: Number(list.count) || 0 }, keyOf, isCurrent,
      fetchPage: async cursor => { const data = await api('playlistSongs', { ...list, ...cursor }); return { ...data, songs: registerSongs(data.songs) }; },
      onProgress: progress => { state.detail = progress; renderPreserve(); },
    });
  }
  async function importMusic() {
    if (!bridge?.local?.import) { toast('请通过桌面快捷方式打开青音，再添加本地音乐。', true); return; }
    try {
      const previous = state.local.length;
      const songs = await bridge.local.import();
      state.local = registerSongs(songs); updateCounts();
      await navigate('local');
      if (state.local.length > previous) toast(`已添加 ${state.local.length - previous} 首本地音乐`);
    } catch { toast('音乐文件未能添加，请重新选择文件。', true); }
  }
  function updateCounts() {
    $('#favorite-count').textContent = state.favorites.length || '';
    $('#local-count').textContent = state.local.length || '';
    $('#playlist-count').textContent = state.playlists.items.length || '';
  }
  function updateAccount() {
    const name = state.loggedIn ? state.user?.name || '酷狗概念版账号' : '登录概念版账号';
    const avatar = safeImage(state.user?.avatar);
    $('#sidebar-account').innerHTML = `<span class="account-avatar">${state.loggedIn && avatar ? `<img src="${esc(avatar)}" alt="" referrerpolicy="no-referrer">` : icon('user')}</span><span class="account-copy"><strong>${esc(name)}</strong><small>${state.loggedIn ? '酷狗概念版账号 · 已登录' : '让手机里的歌单，来到桌面'}</small></span><span class="account-arrow">${icon('arrowRight')}</span>`;
    $('#top-login').innerHTML = `<span class="tiny-avatar">${state.loggedIn && avatar ? `<img src="${esc(avatar)}" alt="" referrerpolicy="no-referrer">` : icon('user')}</span><span>${state.statusLoading ? '连接账号…' : state.loggedIn ? esc(name) : '登录账号'}</span>`;
    $('#top-login').title = state.loggedIn ? '查看概念版账号' : '登录酷狗概念版账号';
  }
  async function loadStatus() {
    try { const data = await api('status'); state.loggedIn = Boolean(data.loggedIn); state.user = state.loggedIn ? data.user || null : null; }
    catch (error) { toast(error.message, true); }
    state.statusLoading = false; updateAccount();
    const savedDaily = state.saved.dailyRecommendations;
    if (state.loggedIn && validDailyCache(savedDaily, state.user?.id)) state.daily = { ...savedDaily, loading: false, loaded: true, songs: registerSongs(savedDaily.songs), error: null };
    if (['discover', 'playlists', 'daily', 'guess'].includes(state.view)) renderPreserve();
    if (state.view === 'daily') loadDailyRecommendations();
    if (state.view === 'guess') loadGuessYouLike();
  }
  function cancelPlayback() {
    const previous = playback;
    playback = null;
    clearTimeout(previous?.skipTimer);
    previous?.cancel?.();
    playerState.cancelLoad();
    invalidatePrefetch(false);
  }
  async function stopPlayback({ clearCurrent = false } = {}) {
    failureNavigator.reset();
    cancelPlayback(); ++playRequest;
    state.audioLoading = false; state.playbackError = '';
    audio.pause(); audio.removeAttribute('src'); audio.load();
    state.mpvState = null;
    if (clearCurrent) {
      state.current = null; lyricRequest++; qualityRequest++;
      resetLyricsFollow();
      state.lyrics = { key: null, loading: false, lines: [], plain: [], error: null, active: -1 };
      state.qualities = { key: null, loading: false, tiers: [], error: null };
      if (!$('#lyrics-panel').hidden) renderLyrics();
    }
    playbackUI(); renderOutput(); renderQuality();
    try { await bridge?.mpv?.send?.('stop'); } catch { /* UI cancellation still invalidates the pending operation. */ }
  }
  function mediaFailure() {
    const error = new Error('音频未能加载');
    error.name = 'MediaPlaybackError';
    error.mediaCode = audio.error?.code || 4;
    return error;
  }
  function playbackMessage(error, local = false) {
    if (error.name === 'NotAllowedError') return '点击播放按钮，开始聆听。';
    if (error.name === 'TimeoutError') return local ? '本地音乐加载超时，请检查文件后点击播放重试。' : '音乐加载超时，请检查网络后点击播放重试。';
    if (error.mediaCode === 2 || error.name === 'NetworkError') return local ? '本地文件无法读取，请检查文件是否已移动，再点击播放重试。' : '音乐连接中断，请检查网络后点击播放重试。';
    if (error.mediaCode === 3) return local ? '当前音频无法解码，请尝试 MP3、WAV 或 FLAC 文件。' : '音频未能解码，请点击播放重新获取。';
    if (error.mediaCode === 4 || error.name === 'NotSupportedError') return local ? '这份文件未提供可识别的音频，请尝试其他音乐文件。' : '暂未读取到可播放的音频，请点击播放重试。若仍失败，请在酷狗概念版 App 中检查这首歌的可听权限。';
    if (typeof error.message === 'string' && /[\u3400-\u9fff]/.test(error.message)) return error.message;
    return local ? '本地音乐暂时无法播放，请检查文件后重试。' : '音乐暂时无法播放，请点击播放重试，或在酷狗概念版 App 中检查可听权限。';
  }
  function reportPlaybackError(error, context = playback) {
    if (!context || context.request !== playRequest || context !== playback || !playerState.current(context) || context.failureHandled || error.name === 'AbortError') return;
    context.failureHandled = true;
    state.audioLoading = false;
    context.phase = 'failed';
    const message = playbackMessage(error, Boolean(state.current?.local));
    state.playbackError = message;
    if (state.current && !state.current.local) playerState.forget(keyOf(state.current));
    audio.pause();
    if (context.backend === 'mpv') bridge?.mpv?.send?.('stop').catch(() => {});
    const skip = context.wantPlayback && error.name !== 'NotAllowedError' && !['LOGIN_REQUIRED', 'AUTH_REQUIRED', 'SESSION_EXPIRED', 'SECURITY_VERIFICATION_REQUIRED', 'BRIDGE_UNAVAILABLE'].includes(error.code);
    if (!context.errorShown) { context.errorShown = true; toast(skip ? `「${state.current?.title || '这首歌'}」播放失败，正在跳过。` : message, !skip && error.name !== 'NotAllowedError'); }
    updatePlayer();
    if (skip) {
      invalidatePrefetch();
      context.skipTimer = setTimeout(() => {
        if (context !== playback || context.request !== playRequest || !playerState.current(context) || !context.wantPlayback) return;
        const nextKey = failureNavigator.next(playOrder(), keyOf(state.current), { wrap: state.repeat !== 'off' });
        const next = state.queue.find(song => keyOf(song) === nextKey);
        if (next) playSong(next, null, null, { automatic: true });
        else {
          context.wantPlayback = false;
          toast(state.repeat === 'off' ? '后续歌曲均无法播放，已停止。' : '本轮队列没有可播放的歌曲，已停止。', true);
        }
      }, 250);
    }
  }
  const EFFECT_PRESETS = [
    { id: 'off', label: '原音', hint: '不做任何处理，保持原始音质', preamp: 1, bands: [] },
    { id: 'hifi', label: 'HIFI 高保真', hint: '轻微提升解析力与空气感，几乎不改变原声', preamp: .92, bands: [['peaking', 1600, .8, 1], ['highshelf', 9000, .7, 2]] },
    { id: 'bass', label: '超重低音', hint: '强化低频下潜与力度，适合电子与嘻哈', preamp: .75, bands: [['lowshelf', 80, .7, 7], ['peaking', 180, 1, 2.5], ['highshelf', 10000, .7, 1]] },
    { id: 'vocal', label: '人声清晰', hint: '突出中频、削弱浑浊感，适合人声与播客', preamp: .85, bands: [['peaking', 300, 1, -3], ['peaking', 3000, .9, 4], ['highshelf', 9000, .7, 1.5]] },
    { id: 'pop', label: '流行', hint: '两端微扬的听感曲线', preamp: .85, bands: [['lowshelf', 120, .7, 4], ['peaking', 500, 1, -2], ['highshelf', 8000, .7, 3]] },
    { id: 'rock', label: '摇滚', hint: '强调鼓点与吉他，中频略退', preamp: .82, bands: [['lowshelf', 100, .7, 5], ['peaking', 800, 1, -4], ['peaking', 3200, .9, 3], ['highshelf', 9000, .7, 3]] },
    { id: 'classical', label: '古典', hint: '自然宽广的厅堂感', preamp: .92, bands: [['lowshelf', 100, .7, 1.5], ['peaking', 2500, .8, 1.5], ['highshelf', 11000, .7, 2]] },
    { id: 'jazz', label: '爵士', hint: '温暖厚实的中低频', preamp: .89, bands: [['lowshelf', 150, .7, 3], ['peaking', 400, 1, 1.5], ['highshelf', 8000, .7, 1.5]] },
  ];
  const effectPreset = id => EFFECT_PRESETS.find(preset => preset.id === id) || EFFECT_PRESETS[0];
  let audioContext = null, effectInput = null, effectOutput = null, effectLimiter = null, effectBands = [];
  function ensureEffectGraph() {
    if (audioContext) return true;
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return false;
    try {
      audioContext = new Context();
      effectInput = audioContext.createGain();
      effectOutput = audioContext.createGain();
      effectLimiter = audioContext.createDynamicsCompressor();
      // A limiter catches the peaks an EQ boost creates instead of letting them clip.
      effectLimiter.threshold.value = -1; effectLimiter.knee.value = 0; effectLimiter.ratio.value = 12;
      effectLimiter.attack.value = .003; effectLimiter.release.value = .25;
      // Routing an element through Web Audio requires a CORS-clean resource: with a
      // cross-origin source and no crossOrigin attribute Chromium outputs pure silence
      // while the progress bar keeps moving. crossOrigin is set once at startup.
      audioContext.createMediaElementSource(audio).connect(effectInput);
      effectLimiter.connect(effectOutput);
      effectOutput.connect(audioContext.destination);
      return true;
    } catch { audioContext = null; effectInput = null; effectOutput = null; effectLimiter = null; return false; }
  }
  function applyEffect(id) {
    const preset = effectPreset(id);
    // 原音 bypasses both equalization and the compressor. The system output path
    // may still resample; this switch never promises device-level bit-perfect audio.
    if (preset.id === 'off' && !audioContext) return true;
    if (!ensureEffectGraph()) return false;
    for (const band of effectBands) { try { band.disconnect(); } catch { /* already detached */ } }
    effectBands = [];
    try { effectInput.disconnect(); } catch { /* no outgoing edge yet */ }
    effectInput.gain.value = preset.preamp;
    let tail = effectInput;
    for (const [type, frequency, q, gain] of preset.bands) {
      const band = audioContext.createBiquadFilter();
      band.type = type; band.frequency.value = frequency; band.Q.value = q; band.gain.value = gain;
      tail.connect(band); tail = band; effectBands.push(band);
    }
    effectLimiter.disconnect();
    if (preset.id !== 'off') effectLimiter.connect(effectOutput);
    tail.connect(preset.id === 'off' ? effectOutput : effectLimiter);
    return true;
  }
  function renderEffects() {
    const current = effectPreset(state.effects);
    const native = mpvActive(), active = !native && current.id !== 'off';
    $('#effects-current').textContent = native ? 'mpv 输出不应用此均衡器' : active ? `${current.label} · 已启用` : '原音 · 均衡器与压缩器均已关闭';
    $('#effects-content').innerHTML = EFFECT_PRESETS.map(preset => `<button class="effect-option${!native && preset.id === state.effects ? ' active' : ''}" data-action="set-effect" data-effect="${preset.id}" aria-pressed="${!native && preset.id === state.effects}"${native ? ' disabled' : ''}><span class="effect-option-copy"><strong>${esc(preset.label)}</strong><small>${esc(native ? '切回内置播放后可选择音效' : preset.hint)}</small></span><span class="effect-check">${icon('check')}</span></button>`).join('');
    $('#effects-button').disabled = native;
    $('#effects-button').classList.toggle('active', active);
    $('#effects-button').setAttribute('aria-pressed', String(active));
    const label = native ? 'mpv 输出不应用此均衡器，切回内置播放后可选择' : active ? `音效：${current.label}，点击更换` : '音效：原音，点击选择';
    $('#effects-button').title = label; $('#effects-button').setAttribute('aria-label', label);
  }
  function resumeAudio() { if (audioContext?.state === 'suspended') audioContext.resume().catch(() => {}); }
  async function chooseEffect(id) {
    if (mpvActive()) return;
    const preset = effectPreset(id);
    if (preset.id === state.effects) return;
    const previous = state.effects;
    state.effects = preset.id;
    if (!applyEffect(preset.id)) { state.effects = previous; toast('当前环境无法启用音效，请重启青音后重试。', true); return; }
    resumeAudio(); persist(); renderEffects();
    toast(preset.id === 'off' ? '已恢复原音，不做任何处理' : `音效已开启：${preset.label}`);
  }
  function startMediaPlayback(context, url) {
    applyEffect(state.effects);
    resumeAudio();
    return new Promise((resolve, reject) => {
      let settled = false;
      let hasPlayed = false;
      let positioned = context.restore.time <= 0;
      const cleanup = () => {
        clearTimeout(timer);
        audio.removeEventListener('loadedmetadata', ready);
        audio.removeEventListener('canplay', ready);
        audio.removeEventListener('playing', playing);
        audio.removeEventListener('error', failed);
        context.signal.removeEventListener('abort', cancelled);
        context.cancel = null;
      };
      const finish = (error) => {
        if (settled) return;
        settled = true; cleanup();
        if (error) reject(error);
        else { context.phase = 'playing'; resolve(); }
      };
      const ready = () => {
        if (context !== playback || context.request !== playRequest || context.signal.aborted) { cancelled(); return; }
        if (!positioned && audio.readyState >= 1 && Number.isFinite(audio.duration)) { audio.currentTime = Math.min(context.restore.time, Math.max(0, audio.duration - .05)); positioned = true; }
        const transportReady = context.restore.paused ? audio.paused : hasPlayed && !audio.paused;
        if (positioned && transportReady && audio.readyState >= 3 && Number.isFinite(audio.duration) && audio.duration > 0) finish();
      };
      const playing = () => { hasPlayed = true; ready(); };
      const failed = () => finish(mediaFailure());
      const cancelled = () => finish(cancelledError());
      const timer = setTimeout(() => { const error = new Error('音乐加载超时'); error.name = 'TimeoutError'; finish(error); }, 20000);
      context.cancel = cancelled;
      context.url = url; context.phase = 'loading';
      audio.addEventListener('loadedmetadata', ready);
      audio.addEventListener('canplay', ready);
      audio.addEventListener('playing', playing);
      audio.addEventListener('error', failed);
      context.signal.addEventListener('abort', cancelled, { once: true });
      audio.preload = 'auto'; audio.src = url; applyOutputMode();
      if (context.restore.paused) { audio.load(); ready(); }
      else try { audio.play().then(ready, finish); } catch (error) { finish(error); }
    });
  }
  // Only the chosen backend loads audio. MPV owns its native timeline and transport.
  const mpvActive = () => state.output === 'mpv' && state.mpvAvailable && Boolean(bridge?.mpv);
  function applyOutputMode() {
    audio.muted = state.muted;
    audio.volume = state.volume;
  }
  async function mpvSend(action, params) {
    if (!mpvActive()) return null;
    try { return await bridge.mpv.send(action, params); }
    catch { return { ok: false, error: '原生播放器连接中断，请切回内置播放重试。', code: 'MPV_DISCONNECTED' }; }
  }
  async function resolveSong(song) {
    return playerState.resolve(keyOf(song), token => api('songUrl', { hash: song.hash, albumId: song.albumId, albumAudioId: song.albumAudioId, quality: token.quality }));
  }
  function nextInQueue() {
    if (priorityNextKey) { const priority = state.queue.find(song => keyOf(song) === priorityNextKey); if (priority) return priority; }
    const order = playOrder();
    if (!order.length) return null;
    const currentKey = state.current ? keyOf(state.current) : null;
    const at = currentKey ? order.indexOf(currentKey) : -1;
    let nextKey = at >= 0 ? order[at + 1] : order[0];
    if (nextKey === undefined && state.repeat === 'all') nextKey = order[0];
    if (nextKey === undefined || nextKey === currentKey) return null;
    return state.queue.find(song => keyOf(song) === nextKey) || null;
  }
  function invalidatePrefetch(clearNative = true) {
    prefetchRequest++; playerState.invalidatePrefetch(); prefetchedNext = null; appendedKey = null;
    if (clearNative && mpvActive()) {
      const request = prefetchRequest, operation = playback;
      nativeQueueMutation = nativeQueueMutation.catch(() => {}).then(() => {
        if (request !== prefetchRequest || operation !== playback || !mpvActive()) return;
        return bridge.mpv.send('clear');
      }).catch(() => {});
    }
  }
  async function prefetchNext() {
    invalidatePrefetch();
    if (sleepState.mode === 'after-track' || sleepStopped) return;
    const upcoming = nextInQueue();
    if (!upcoming || state.repeat === 'one' && !priorityNextKey || !playback || playback.phase !== 'playing') return;
    const request = prefetchRequest, operation = playback, token = playerState.beginPrefetch();
    try {
      const playable = upcoming.local ? { url: upcoming.url } : await resolveSong(upcoming);
      if (request !== prefetchRequest || operation !== playback || !playerState.validPrefetch(token) || !safeAudio(playable.url)) return;
      prefetchedNext = { song: upcoming, playable, token, request };
      if (mpvActive()) {
        nativeQueueMutation = nativeQueueMutation.catch(() => {}).then(async () => {
          if (request !== prefetchRequest || operation !== playback || !playerState.validPrefetch(token)) return;
          const sent = await mpvSend('append', { url: playable.url });
          if (request === prefetchRequest && sent?.ok && sent.queued !== false) appendedKey = keyOf(upcoming);
          else if (request === prefetchRequest) prefetchedNext = null;
        });
        await nativeQueueMutation;
      }
    } catch { /* Prefetch never changes the current playback or reports an error. */ }
  }
  async function mpvLoad(context, url) {
    if (context !== playback || context.request !== playRequest || !playerState.current(context)) throw cancelledError();
    context.url = url; context.phase = 'loading';
    const result = await mpvSend('load', { url, volume: state.muted ? 0 : state.volume, paused: context.restore.paused, time: context.restore.time });
    if (context !== playback || context.signal.aborted) throw cancelledError();
    if (!result?.ok) { const error = new Error(result?.error || '原生播放器未能加载音乐。'); error.code = result?.code || 'MPV_LOAD_FAILED'; if (error.code === 'MPV_CANCELLED') error.name = 'AbortError'; throw error; }
    if (result.state?.sourceId !== url || !result.state.active || !(Number(result.state.duration) > 0)) { const error = new Error('原生播放器未能确认音频已加载。'); error.code = 'MPV_LOAD_FAILED'; throw error; }
    state.mpvState = result.state; context.phase = 'playing';
    renderOutput();
  }
  async function fallbackFromMpv(error, context = playback) {
    if (!context || context !== playback || context.backend !== 'mpv' || context.signal.aborted || context.fallbackStarted) return;
    if (error.code === 'MPV_CANCELLED' || error.name === 'AbortError') return;
    context.fallbackStarted = true;
    if (error.code === 'MPV_SOURCE_UNRESOLVED' && state.current && !state.current.local) playerState.forget(keyOf(state.current));
    const restore = context.lastPosition || context.restore || currentTransport(), song = state.current;
    state.output = 'browser'; state.mpvErrorShown = true;
    persist(); renderOutput(); renderEffects();
    toast('mpv 输出暂不可用，已切回内置播放。');
    if (song) await playSong(song, null, { time: restore.time, paused: !context.wantPlayback, fallback: true }, { automatic: true });
  }
  function confirmPlayback(context) {
    if (!context || context !== playback || context.signal.aborted) return;
    context.cancel?.();
    context.phase = 'playing'; state.audioLoading = false; state.playbackError = '';
    if (!context.historyRecorded && !currentTransport().paused) { context.historyRecorded = true; addHistory(state.current); }
    if (!context.prefetchStarted) { context.prefetchStarted = true; loadQualities(); prefetchNext(); }
    if (state.current?.preview && !context.previewNotified) { context.previewNotified = true; toast('当前播放为试听片段，可听范围由酷狗概念版账号权限决定。'); }
    playbackUI(); renderQuality();
  }
  function adoptNativeNext(entry, native) {
    const song = entry.song, playable = entry.playable;
    if (priorityNextKey === keyOf(song)) priorityNextKey = null;
    cancelPlayback();
    const context = playerState.beginLoad(keyOf(song), 'mpv', { time: native.time, paused: native.paused });
    context.request = ++playRequest; context.url = playable.url; context.phase = 'loading'; context.adopted = true;
    context.wantPlayback = !context.restore.paused;
    playback = context;
    const timer = setTimeout(() => { const error = { code: 'MPV_TIMEOUT', message: '原生播放器加载超时。' }; fallbackFromMpv(error, context).catch(() => {}); }, 20000);
    const cancel = () => { clearTimeout(timer); context.signal.removeEventListener('abort', cancel); context.cancel = null; };
    context.cancel = cancel; context.signal.addEventListener('abort', cancel, { once: true });
    state.current = { ...song, ...(safeImage(playable.cover) ? { cover: playable.cover } : {}), quality: playable.quality || null, preview: Boolean(playable.preview) };
    state.audioLoading = true; state.playbackError = ''; state.mpvState = native;
    resetLyricsFollow();
    lyricRequest++; qualityRequest++; state.lyrics = { key: null, loading: true, lines: [], plain: [], error: null, active: -1 }; state.qualities = { key: null, loading: false, tiers: [], error: null };
    if (!$('#lyrics-panel').hidden) renderLyrics();
    loadLyrics();
    playbackUI();
  }
  function handleNativeEvent(event) {
    if (!playback || playback.backend !== 'mpv' || playback.signal.aborted) return;
    if (event.sleepTimerConsumed || sleepStopped && event.name === 'end-file') {
      if (event.state?.sourceId === playback.url) state.mpvState = { ...event.state, paused: true };
      pauseForSleep(false); return;
    }
    let context = playback;
    const native = event.state || {};
    if (native.sourceId && native.sourceId !== context.url) {
      const next = prefetchedNext;
      if (next && playerState.validPrefetch(next.token) && native.sourceId === next.playable.url && state.queue.some(song => keyOf(song) === keyOf(next.song))) {
        adoptNativeNext(next, native); context = playback;
      } else return;
    }
    const matching = Boolean(context.url && native.sourceId === context.url);
    if (matching) {
      const previousPaused = state.mpvState?.paused;
      state.mpvState = native;
      if (!native.error && Number(native.duration) > 0) context.lastPosition = { time: Number(native.time) || 0, paused: Boolean(native.paused) };
      if (state.current && Number(native.duration) > 0) state.current.duration = Number(native.duration);
      if (previousPaused !== native.paused) { updatePlayer(); syncCurrentRows(); }
      else syncProgress();
      syncLyrics();
    }
    if (event.name === 'error' || (event.name === 'end-file' && event.reason === 'error') || event.name === 'exit') {
      if (!matching && native.sourceId) return;
      const error = { name: 'Error', code: native.error?.code || 'MPV_DISCONNECTED', message: native.error?.message || '原生播放器已断开。' };
      fallbackFromMpv(error, context).catch(() => {}); return;
    }
    if (!matching) return;
    if (event.name === 'file-loaded' && context.adopted && native.active && Number(native.duration) > 0) confirmPlayback(context);
    if (event.name === 'pause' && context.phase === 'playing' && native.active && Number(native.duration) > 0 && !native.paused) confirmPlayback(context);
    if (event.name === 'end-file' && event.reason === 'eof' && !context.endedHandled) {
      context.endedHandled = true;
      const queued = prefetchedNext && appendedKey === keyOf(prefetchedNext.song) && playerState.validPrefetch(prefetchedNext.token);
      if (!queued) moveTrack(1, true);
    }
    if (['ready', 'file-loaded', 'audio-params', 'audio-out-params', 'pause'].includes(event.name)) renderOutput();
  }
  function renderOutput() {
    const active = mpvActive();
    const currentNative = playback?.backend === 'mpv' && state.mpvState?.sourceId === playback.url ? state.mpvState : null;
    const out = currentNative?.outParams;
    const sourceRate = Number(currentNative?.audioParams?.samplerate) || (state.current?.quality?.streamVerified ? Number(state.current.quality.sampleRateHz) : 0);
    const outputRate = Number(out?.samplerate) || 0;
    const resampling = sourceRate > 0 && outputRate > 0 && sourceRate !== outputRate ? `；音源 ${sourceRate / 1000} kHz → 输出 ${outputRate / 1000} kHz，设备格式协商后发生重采样` : '';
    const negotiated = out?.samplerate
      ? `当前输出：${out.samplerate / 1000} kHz · ${out.format || '未知格式'} · ${out.channels} 声道（请求独占）${resampling}`
      : '请求独占播放，按设备实际支持的能力协商采样率';
    const rows = [
      { id: 'browser', label: '内置播放', note: 'Chromium 输出，经系统共享混音，采样率固定为设备混音率', blocked: false },
      { id: 'mpv', label: 'mpv 独占输出', note: state.mpvAvailable ? negotiated : '未检测到 mpv，无法使用', blocked: !state.mpvAvailable },
    ];
    $('#output-current').textContent = active ? 'mpv 独占输出' : '内置播放';
    $('#output-content').innerHTML = rows.map(row => `<button class="effect-option${row.id === (active ? 'mpv' : 'browser') ? ' active' : ''}" data-action="set-output" data-output="${row.id}" aria-pressed="${row.id === (active ? 'mpv' : 'browser')}"${row.blocked ? ' disabled' : ''}><span class="effect-option-copy"><strong>${esc(row.label)}</strong><small>${esc(row.note)}</small></span><span class="effect-check">${icon('check')}</span></button>`).join('');
    const button = $('#output-button');
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
    const label = active ? '输出方式：mpv 独占输出' : '输出方式：内置播放';
    button.title = label; button.setAttribute('aria-label', label);
  }
  async function chooseOutput(id) {
    const next = id === 'mpv' && state.mpvAvailable ? 'mpv' : 'browser';
    if (state.output === next) return;
    const restore = currentTransport();
    state.output = next; state.mpvErrorShown = false;
    applyOutputMode(); persist(); renderOutput(); renderEffects();
    toast(next === 'mpv' ? '已切换到 mpv 独占输出' : '已切回内置播放');
    if (state.current) await playSong(state.current, null, restore);
  }
  const QUALITY_GROUPS = [['auto', ''], ['svip', '高级音质'], ['standard', '常规音质']];
  const selectedQualityLabel = () => state.qualities.tiers.find(tier => tier.id === state.quality)?.label || ({ auto: '自动（最高可播放）', max: '自动（最高可播放）', '128': '标准音质', '320': '高品质', flac: 'FLAC', high: 'Hi-Res', lossless: '无损音质', viper_tape: '蝰蛇母带音质', viper_clear: '蝰蛇超清音质', viper_atmos: '蝰蛇全景声 2.0' })[state.quality] || state.quality;
  function qualityRow(tier) {
    const active = tier.id === state.quality;
    const blocked = tier.selectable === false;
    const note = [tier.spec || tier.hint || '', tier.entitlementHint || '', tier.reason === 'NOT_REPORTED' ? '服务未报告此版本，可尝试请求' : '', tier.playable === null && tier.offered === true ? '实际可播放情况待授权与音频验证' : ''].filter(Boolean).join(' · ');
    return `<button class="effect-option quality-option${active ? ' active' : ''}" data-action="set-quality" data-quality="${esc(tier.id)}" aria-pressed="${active}" title="${esc(note)}"${blocked ? ' disabled' : ''}><span class="effect-option-copy"><strong>${esc(tier.label)}</strong></span><span class="effect-check">${icon('check')}</span></button>`;
  }
  function renderQuality() {
    updateQualityTag(state.current);
    const info = state.qualities, tiers = info.tiers || [];
    const selectedLabel = selectedQualityLabel();
    const quality = state.current?.quality;
    const actual = !state.audioLoading && !state.playbackError && playback?.phase === 'playing' && quality?.streamVerified ? quality : null;
    const spec = actual ? Number(actual.bitDepth) > 0 && Number(actual.sampleRateHz) > 0
      ? `${Number(actual.bitDepth)}bit / ${Number(actual.sampleRateHz) / 1000}kHz`
      : Number(actual.bitrateKbps) > 0 ? `${Math.round(Number(actual.bitrateKbps))}kbps` : '' : '';
    const actualLabel = actual ? String(actual.short || actual.label?.split('·')[0] || actual.format?.toUpperCase() || '').trim() : '';
    const extraSpec = spec && !actualLabel.replace(/\s/g, '').includes(spec.replace(/\s/g, '')) ? spec : '';
    $('#quality-current').textContent = state.current?.local ? '本地原音质' : actual
      ? `${state.current.preview ? '试听' : '播放'}：${[actualLabel, extraSpec, actual.fallback ? '已回退' : ''].filter(Boolean).join(' · ')}`
      : `所选：${selectedLabel}`;
    $('#quality-current').title = $('#quality-tag').title;
    const body = QUALITY_GROUPS.map(([group, title]) => {
      const rows = tiers.filter(tier => tier.group === group);
      if (!rows.length) return '';
      return `${title ? `<div class="quality-group">${esc(title)}</div>` : ''}${rows.map(qualityRow).join('')}`;
    }).join('');
    $('#quality-content').innerHTML = `${info.loading ? '<div class="content-loading"><div class="loading-disc"></div><span>读取音质中…</span></div>' : ''}${body || '<div class="queue-empty">播放在线歌曲后查看音质。</div>'}${info.error ? `<div class="inline-message">${icon('info')}${esc(info.error)}</div>` : ''}`;
  }
  async function loadQualities(force = false) {
    const song = state.current;
    if (song?.local) { qualityRequest++; state.qualities = { key: null, loading: false, tiers: [], error: null }; renderQuality(); return; }
    const key = song ? keyOf(song) : 'catalogue';
    if (!force && state.qualities.key === key && !state.qualities.error) return;
    const request = ++qualityRequest;
    state.qualities = { key, loading: true, tiers: state.qualities.key === key ? state.qualities.tiers : [], error: null };
    renderQuality();
    try {
      const data = await api('songQualities', song ? { hash: song.hash, albumId: song.albumId } : {});
      if (request !== qualityRequest || (state.current ? keyOf(state.current) : 'catalogue') !== key) return;
      state.qualities = { key, loading: false, tiers: Array.isArray(data.tiers) ? data.tiers : [], error: null };
    } catch (error) {
      if (request !== qualityRequest || (state.current ? keyOf(state.current) : 'catalogue') !== key) return;
      state.qualities = { key, loading: false, tiers: [], error: error.message };
    }
    renderQuality();
  }
  async function chooseQuality(id) {
    if (id === state.quality) return;
    const restore = currentTransport();
    const changed = playerState.setQuality(id, { preserveLocal: Boolean(state.current?.local) });
    state.quality = id;
    invalidatePrefetch();
    persist(); renderQuality();
    const tier = (state.qualities.tiers || []).find(item => item.id === id);
    toast(id === 'auto' ? '音质已设为自动（最高可播放）' : `音质已设为「${tier ? tier.label : id}」`);
    if (changed && state.current && !state.current.local) await playSong(state.current, null, restore);
  }
  function updateQualityTag(song) {
    const tag = $('#quality-tag');
    const selected = selectedQualityLabel();
    const policy = ['auto', 'max'].includes(state.quality) ? '已优先选择最高可播放音质，实际音质取决于歌曲和账号权限。' : '按所选档位请求音频，实际交付以音频验证和账号权限为准。';
    tag.hidden = false;
    if (song?.local) { tag.textContent = '本地原音质'; tag.title = '按本地音乐文件的原始音质播放。'; tag.setAttribute('aria-label', '本地原音质'); return; }
    const quality = song?.quality;
    const verified = quality?.streamVerified === true && typeof quality.format === 'string' && quality.format.trim();
    const ready = !state.audioLoading && !state.playbackError && playback?.phase === 'playing' && playback.url;
    const label = verified ? String(quality.label || quality.format.toUpperCase()).trim() : '';
    tag.textContent = state.audioLoading ? `${selected} · 获取中` : ready && label ? `${quality.fallback ? '回退 · ' : ''}${label}${song.preview ? ' · 试听' : ''}` : selected;
    const details = [`所选档位：${selected}。`, policy];
    if (ready && verified) {
      details.push(`当前音频：${label}。`);
      const metadata = [];
      if (Number(quality.bitrateKbps) > 0) metadata.push(`码率 ${Number(quality.bitrateKbps)} kbps`);
      if (Number(quality.sampleRateHz) > 0) metadata.push(`采样率 ${Number(quality.sampleRateHz) / 1000} kHz`);
      if (Number(quality.bitDepth) > 0) metadata.push(`位深 ${Number(quality.bitDepth)} bit`);
      if (metadata.length) details.push(`${metadata.join(' · ')}。`);
      if (quality.fallback) details.push('服务未交付优先请求的档位，已使用当前可播放音质。');
      if (quality.tierVerified && quality.delivered) details.push(`服务档位已验证：${state.qualities.tiers.find(item => item.id === quality.delivered)?.label || label}。`);
      else if (!['auto', 'max', '128', '320', 'flac', 'high', 'lossless'].includes(state.quality)) details.push('当前媒体规格已验证，所选高级档位的身份未确认。');
    } else if (ready) details.push('当前音频的具体参数暂未读取到。');
    if (ready && song?.preview) details.push('当前为试听片段。');
    tag.title = details.join('\n');
    tag.setAttribute('aria-label', `所选音质：${selected}${ready && label ? `；实际播放：${label}` : ''}${ready && quality?.fallback ? '；已回退' : ''}${ready && song?.preview ? '；试听片段' : ''}`);
  }
  function updatePlayer() {
    const song = state.current;
    if (!$('#lyrics-panel').hidden) updateLyricsCover(song);
    setText($('#player-title'), song?.title || '把喜欢的声音，带到桌面');
    $('#player-title').title = song?.title || '查看歌词';
    setText($('#player-artist'), state.playbackError ? '暂时无法播放 · 点击播放按钮重试' : song ? `${song.artist}${song.album ? ` · ${song.album}` : ''}` : '选一首歌，让此刻有声');
    $('#player-artist').title = state.playbackError || '';
    setHTML($('#player-cover'), song ? cover(song) : icon('music'));
    $('#player-favorite').disabled = !song;
    $('#player-favorite').classList.toggle('favorite-on', Boolean(song && isFavorite(song)));
    $('#player-favorite').setAttribute('aria-label', song && isFavorite(song) ? '取消当前歌曲的本机收藏' : '本机收藏当前歌曲');
    $('#player-favorite').title = song && isFavorite(song) ? '取消本机收藏' : '加入本机收藏';
    $('#play-button').disabled = !song;
    $('#play-button').classList.toggle('loading', state.audioLoading);
    setHTML($('#play-button'), icon(state.audioLoading ? 'spinner' : isPaused() ? 'play' : 'pause'));
    const playLabel = state.playbackError ? '重试播放' : isPaused() ? '播放' : '暂停';
    $('#play-button').setAttribute('aria-label', playLabel); $('#play-button').title = playLabel;
    $('#prev-button').disabled = !state.queue.length;
    $('#next-button').disabled = !state.queue.length;
    setText($('#queue-size'), state.queue.length);
    $('#repeat-button').classList.toggle('active', state.shuffle || state.repeat !== 'off');
    const repeatLabel = playbackModeLabel();
    setHTML($('#repeat-button'), icon(state.shuffle ? 'shuffle' : state.repeat === 'one' ? 'repeatOne' : 'repeat'));
    $('#repeat-button').title = repeatLabel; $('#repeat-button').setAttribute('aria-label', `${repeatLabel}，点击切换`);
    setHTML($('#mute-button'), icon(state.muted || state.volume === 0 ? 'muted' : 'volume'));
    $('#mute-button').title = state.muted ? '取消静音' : '静音'; $('#mute-button').setAttribute('aria-label', state.muted ? '取消静音' : '静音');
    $('#volume').value = state.muted ? 0 : state.volume;
    updateQualityTag(song);
    syncProgress();
    syncTaskbarLyrics();
  }
  function syncProgress() {
    const transport = currentTransport(), duration = transport.duration;
    // A decoder can become ready and fail immediately. Only sustained playback
    // breaks a consecutive failure round, so those songs cannot loop forever.
    if (playback?.phase === 'playing' && playback.wantPlayback && !playback.failureReset && transport.ready && !transport.paused && transport.time >= playback.restore.time + 3) {
      failureNavigator.reset(); playback.failureReset = true;
    }
    setText($('#current-time'), time(transport.time));
    setText($('#duration-time'), time(duration));
    $('#seek').disabled = !state.current || !transport.ready || duration <= 0;
    if (!seeking) $('#seek').value = duration > 0 ? Math.min(100, transport.time / duration * 100) : 0;
  }
  async function seekTo(seconds) {
    progressWatchdog.reset();
    const context = playback;
    const transport = currentTransport();
    const position = Math.min(Math.max(0, Number(seconds) || 0), transport.duration || Number.MAX_SAFE_INTEGER);
    if (context?.backend === 'mpv') {
      const result = await mpvSend('seek', { seconds: position });
      if (result && !result.ok) await fallbackFromMpv(result, context);
      else if (context === playback && !context.signal.aborted && result?.state?.sourceId === context.url) state.mpvState = result.state;
    }
    else if (Number.isFinite(audio.duration)) audio.currentTime = position;
    syncProgress(); syncLyrics();
  }
  function syncCurrentRows() {
    const key = state.current ? keyOf(state.current) : null, main = $('#main-content');
    for (const row of $$('.track-row.current', main)) {
      if (row.dataset.trackKey === key) continue;
      row.classList.remove('current');
      const position = $('.track-position', row);
      if (position) position.textContent = position.dataset.number;
    }
    const rows = key ? $$(`.track-row[data-track-key="${CSS.escape(key)}"]`, main) : [];
    for (const row of rows) {
      row.classList.add('current');
      const position = $('.track-position', row);
      if (!position) continue;
      let wave = $('.playing-wave', position);
      if (!wave) { position.innerHTML = '<span class="playing-wave"><i></i><i></i><i></i></span>'; wave = position.firstElementChild; }
      wave.classList.toggle('paused', isPaused());
      if (state.current.duration > 0) setText($('.track-duration', row), time(state.current.duration));
    }
    state.listHasCurrent = rows.length > 0; updateListRail();
    if (!$('#queue-panel').hidden) {
      for (const row of $$('.queue-row', $('#queue-content'))) row.classList.toggle('current', row.dataset.trackKey === key);
    }
  }
  function playbackUI() { updatePlayer(); syncCurrentRows(); }
  async function playSong(song, queue = null, restore = null, { automatic = false } = {}) {
    if (!song) return;
    if (automatic && sleepStopped) return;
    sleepStopped = false;
    if (queue) { queueRevision++; priorityNextKey = null; }
    if (priorityNextKey === keyOf(song)) priorityNextKey = null;
    if (!automatic) failureNavigator.reset();
    cancelPlayback();
    const request = ++playRequest;
    const context = playerState.beginLoad(keyOf(song), mpvActive() ? 'mpv' : 'browser', restore || {});
    context.request = request;
    context.wantPlayback = !context.restore.paused;
    playback = context;
    progressWatchdog.reset();
    audio.pause(); audio.removeAttribute('src'); audio.load();
    const queueChanged = Boolean(queue) || !state.queue.some(item => keyOf(item) === keyOf(song));
    if (queue) { state.queue = [...queue]; if (state.shuffle) rebuildShuffleOrder(keyOf(song)); }
    else if (!state.queue.some(item => keyOf(item) === keyOf(song))) { state.queue.push(song); if (state.shuffle) state.shuffleOrder.push(keyOf(song)); }
    state.current = { ...song }; state.audioLoading = true; state.playbackError = '';
    if (queueChanged) renderQueue();
    resetLyricsFollow();
    state.lyrics = { key: null, loading: true, lines: [], plain: [], error: null, active: -1 }; lyricRequest++;
    qualityRequest++; state.qualities = { key: null, loading: false, tiers: [], error: null };
    playbackUI();
    if (!$('#lyrics-panel').hidden) renderLyrics();
    loadLyrics();
    try {
      if (bridge?.mpv?.send) await bridge.mpv.send('stop').catch(() => {});
      if (request !== playRequest || context.signal.aborted) return;
      let playable = song.local ? { url: song.url } : await resolveSong(song);
      if (request !== playRequest || context.signal.aborted) return;
      const url = safeAudio(playable.url);
      if (!url) throw new Error('这首歌暂时没有可用的播放地址，请在概念版 App 中检查可听权限。');
      state.current = { ...state.current, ...(safeImage(playable.cover) ? { cover: playable.cover } : {}), ...(Number(playable.duration) > 0 ? { duration: Number(playable.duration) } : {}), preview: Boolean(playable.preview), quality: playable.quality && typeof playable.quality === 'object' ? { ...playable.quality } : null };
      if (context.backend === 'mpv') { if (audioContext?.state === 'running') await audioContext.suspend(); await mpvLoad(context, url); }
      else await startMediaPlayback(context, url);
      if (request !== playRequest) return;
      confirmPlayback(context);
    } catch (error) {
      if (request !== playRequest) return;
      state.audioLoading = false;
      if (error.name !== 'AbortError') {
        if (context.backend === 'mpv' && String(error.code || '').startsWith('MPV_')) { await fallbackFromMpv(error, context); return; }
        audio.pause(); audio.removeAttribute('src'); audio.load();
        reportPlaybackError(error, context);
        if (['LOGIN_REQUIRED', 'AUTH_REQUIRED', 'SESSION_EXPIRED'].includes(error.code)) openLogin();
      }
    }
    playbackUI();
  }
  async function playPause() {
    if (!state.current) return;
    if (sleepStopped && playback?.backend === 'mpv' && (state.mpvState?.eof || !state.mpvState?.active)) { sleepStopped = false; return playSong(state.current, null, { time: 0, paused: false }); }
    if (sleepStopped && playback) playback.endedHandled = false;
    sleepStopped = false;
    const context = playback;
    progressWatchdog.reset();
    if (state.audioLoading) { await stopPlayback(); return; }
    if (context?.backend === 'mpv' && context.phase === 'playing' && !state.playbackError) { context.wantPlayback = isPaused(); const result = await mpvSend(context.wantPlayback ? 'resume' : 'pause'); if (result && !result.ok) await fallbackFromMpv(result, context); return; }
    if (!isPaused()) { if (playback) playback.wantPlayback = false; audio.pause(); return; }
    if (!playback?.url || audio.error || state.playbackError) { await playSong(state.current); return; }
    if (playback) playback.wantPlayback = true;
    try { await audio.play(); } catch (error) { reportPlaybackError(error, context); }
  }
  function rebuildShuffleOrder(leadKey = null) {
    const keys = state.queue.map(keyOf);
    for (let i = keys.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [keys[i], keys[j]] = [keys[j], keys[i]]; }
    // Keep the song that is already playing at the head of the new order.
    if (leadKey && keys.length > 1) { const at = keys.indexOf(leadKey); if (at > 0) { keys.splice(at, 1); keys.unshift(leadKey); } }
    state.shuffleOrder = keys;
  }
  const playbackMode = () => state.shuffle ? 'shuffle' : state.repeat;
  const playbackModeLabel = () => ({ all: '列表循环', one: '单曲循环', off: '顺序播放', shuffle: '随机播放' })[playbackMode()];
  function changePlaybackMode() {
    const next = ({ all: 'one', one: 'off', off: 'shuffle', shuffle: 'all' })[playbackMode()];
    state.shuffle = next === 'shuffle'; state.repeat = state.shuffle ? 'all' : next;
    if (state.shuffle) rebuildShuffleOrder(state.current ? keyOf(state.current) : null);
    else state.shuffleOrder = [];
    persist(); renderQueue(); updatePlayer(); prefetchNext();
    toast(`已切换到${playbackModeLabel()}`);
  }
  function playVisibleList() {
    if (!state.visibleSongs.length) return;
    const index = state.shuffle ? Math.floor(Math.random() * state.visibleSongs.length) : 0;
    return playSong(state.visibleSongs[index], state.visibleSongs);
  }
  // Play order is the queue itself, or a shuffled permutation of it while shuffle is on.
  // Removed songs drop out and new ones append, so the order survives queue edits.
  function playOrder() {
    if (!state.shuffle) return state.queue.map(keyOf);
    const present = state.queue.map(keyOf), alive = new Set(present);
    state.shuffleOrder = state.shuffleOrder.filter(key => alive.has(key));
    const ordered = new Set(state.shuffleOrder);
    for (const key of present) if (!ordered.has(key)) { state.shuffleOrder.push(key); ordered.add(key); }
    return state.shuffleOrder;
  }
  function moveTrack(direction, ended = false) {
    if (ended && sleepStopped) return;
    if (!ended) sleepStopped = false;
    if (!state.queue.length) return;
    if (direction > 0 && priorityNextKey) {
      const priority = state.queue.find(song => keyOf(song) === priorityNextKey); priorityNextKey = null;
      if (priority) { playSong(priority); return; }
    }
    if (direction < 0 && currentTransport().time > 3 && !ended) { seekTo(0); return; }
    if (ended && state.repeat === 'one' && state.current) { playSong(state.current); return; }
    const order = playOrder();
    if (!order.length) return;
    const at = state.current ? order.indexOf(keyOf(state.current)) : -1;
    let index;
    if (direction < 0) index = at <= 0 ? order.length - 1 : at - 1;
    else {
      index = at + 1;
      if (index >= order.length) {
        if (ended && state.repeat === 'off') { if (playback) playback.wantPlayback = false; if (playback?.backend === 'mpv') mpvSend('pause'); else audio.pause(); playbackUI(); return; }
        index = 0;
      }
    }
    const next = state.queue.find(song => keyOf(song) === order[index]);
    if (next) playSong(next);
  }
  function enqueue(song, silent = false) {
    if (!song) return;
    if (state.queue.some(item => keyOf(item) === keyOf(song))) { if (!silent) toast('这首歌已经在播放队列里'); return; }
    state.queue.push(song);
    queueRevision++;
    if (state.shuffle) state.shuffleOrder.push(keyOf(song));
    if (!silent) { updatePlayer(); renderQueue(); prefetchNext(); toast('已加入播放队列'); }
  }
  function enqueueNext(song) {
    if (!song) return;
    const target = keyOf(song), current = state.current ? keyOf(state.current) : null;
    if (target === current) { toast('这首歌正在播放'); return; }
    const order = playOrder().filter(key => key !== target);
    state.queue = state.queue.filter(item => keyOf(item) !== target);
    const position = current ? state.queue.findIndex(item => keyOf(item) === current) + 1 : 0;
    state.queue.splice(Math.max(0, position), 0, song);
    if (state.shuffle) { order.splice(Math.max(0, order.indexOf(current) + 1), 0, target); state.shuffleOrder = order; }
    queueRevision++;
    priorityNextKey = target;
    updatePlayer(); renderQueue(); prefetchNext();
    toast(`已设为下一首：${song.title}`);
  }
  async function removeFromQueue(key) {
    if (!state.queue.some(song => keyOf(song) === key)) return;
    state.queue = state.queue.filter(song => keyOf(song) !== key);
    state.shuffleOrder = state.shuffleOrder.filter(item => item !== key);
    if (priorityNextKey === key) priorityNextKey = null;
    queueRevision++;
    if (state.current && keyOf(state.current) === key) await stopPlayback({ clearCurrent: true });
    else prefetchNext();
    renderQueue(); playbackUI();
  }
  async function clearQueue() {
    if (!state.queue.length) return;
    const previous = { queue: [...state.queue], order: [...state.shuffleOrder], priority: priorityNextKey, current: state.current, position: currentTransport().time };
    state.queue = []; state.shuffleOrder = []; priorityNextKey = null; const revision = ++queueRevision;
    await stopPlayback({ clearCurrent: true }); renderQueue();
    toast('已清空播放队列', false, async () => {
      if (queueRevision !== revision || state.queue.length || state.current) throw new Error('队列已更改，无法撤销这次清空');
      state.queue = previous.queue; state.shuffleOrder = previous.order; queueRevision++;
      if (previous.current) await playSong(previous.current, null, { time: previous.position, paused: true });
      priorityNextKey = previous.priority;
      updatePlayer(); renderQueue();
    });
  }
  function renderQueue() {
    if ($('#queue-panel').hidden) return;
    // Rows follow the actual play order, so shuffle is visible instead of implied.
    const byKey = new Map(state.queue.map(song => [keyOf(song), song]));
    const songs = playOrder().map(key => byKey.get(key)).filter(Boolean);
    $('#queue-panel [data-action="clear-queue"]').disabled = songs.length === 0;
    $('#queue-count').textContent = `${state.queue.length} 首歌曲${state.shuffle ? ' · 随机顺序' : ''}`;
    $('#queue-content').innerHTML = songs.length ? songs.map(song => { const key = keyOf(song); return `<div class="queue-row${state.current && keyOf(state.current) === key ? ' current' : ''}" data-track-key="${esc(key)}"><button data-action="play-queue" data-key="${esc(key)}"><span class="track-thumb">${cover(song)}</span><span class="track-text"><span class="track-title">${esc(song.title)}</span><span class="track-artist">${esc(song.artist)}</span></span></button><button class="icon-button queue-next" data-action="play-next" data-key="${esc(key)}" aria-label="下一首播放 ${esc(song.title)}" title="下一首播放">${icon('playNext')}</button><button class="icon-button" data-action="remove-queue" data-key="${esc(key)}" aria-label="从队列移除 ${esc(song.title)}" title="从队列移除">${icon('close')}</button></div>`; }).join('') : '<div class="queue-empty">队列还是空的。<br>选一首歌，让此刻有声。</div>';
  }
  function syncTaskbarLyrics() {
    const song = state.current, transport = currentTransport();
    const active = activeIndex(state.lyrics.lines, transport.time);
    const current = lyricCaption({ song, lyrics: { ...state.lyrics, active } });
    const line = current.kind === 'lyric' ? state.lyrics.lines[active] : null;
    const start = line?.time || 0;
    const following = state.lyrics.lines[active + 1]?.time;
    const end = Number.isFinite(line?.end) && line.end > start ? line.end : Number.isFinite(following) && following > start ? following : Math.min(transport.duration || Infinity, start + Math.max(3, Math.min(12, [...(line?.text || '')].length * .35)));
    const payload = { ...current, title: song?.title || '', artist: song?.artist || '', playing: Boolean(song && !state.audioLoading && !state.playbackError && transport.ready && !transport.paused), visible: Boolean(song), enabled: state.taskbarLyricsEnabled, theme: window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark',
      position: Math.round(transport.time * 1000) / 1000, rate: playback?.backend === 'mpv' ? 1 : audio.playbackRate || 1, lineStart: start, lineEnd: line ? end : 0, words: line?.words || [] };
    const serialized = JSON.stringify(payload);
    if (serialized === taskbarLastState || !bridge?.taskbarLyrics?.update) return;
    taskbarLastState = serialized;
    bridge.taskbarLyrics.update({ ...payload, sampledAt: Date.now() }).catch(() => { if (taskbarLastState === serialized) taskbarLastState = ''; });
  }
  function updateTaskbarToggle() {
    const button = $('#taskbar-lyrics-toggle');
    button.setAttribute('aria-pressed', String(state.taskbarLyricsEnabled));
    button.setAttribute('aria-label', `任务栏歌词：${state.taskbarLyricsEnabled ? '开启，点击关闭' : '关闭，点击开启'}`);
    button.title = state.taskbarLyricsEnabled ? '任务栏歌词已开启 · 点击关闭' : '在 Windows 任务栏左侧显示当前歌词';
  }
  async function toggleTaskbarLyrics() {
    if (!bridge?.taskbarLyrics?.setEnabled) { toast('请从桌面快捷方式打开新版青音后使用任务栏歌词。', true); return; }
    const button = $('#taskbar-lyrics-toggle');
    if (button.disabled) return;
    button.disabled = true;
    const previous = state.taskbarLyricsEnabled;
    state.taskbarLyricsEnabled = !previous; updateTaskbarToggle();
    try {
      await bridge.taskbarLyrics.setEnabled(state.taskbarLyricsEnabled);
      syncTaskbarLyrics(); await persist(true).catch(() => {});
    } catch {
      state.taskbarLyricsEnabled = previous; updateTaskbarToggle();
      toast('任务栏歌词未能切换，请稍后重试。', true);
    } finally { button.disabled = false; }
  }
  function renderLyrics() {
    const song = state.current, lyrics = state.lyrics;
    resetLyricsFollow();
    updateLyricsCover(song);
    if (!song) { $('#lyrics-body').innerHTML = `<div class="lyrics-placeholder">${icon('music')}<p>选一首歌，这里会跟着旋律亮起。</p></div>`; updateLyricsFooter(); return; }
    let content;
    if (lyrics.loading) content = '<div class="lyric-empty"><div class="loading-disc"></div><span>正在寻找歌词…</span></div>';
    else if (lyrics.error) content = `<div class="lyric-empty">${icon('info')}<span>${esc(lyrics.error.message)}</span><button class="text-button" data-action="retry-lyrics">${icon('refresh')}重新加载歌词</button></div>`;
    else if (lyrics.lines.length) content = `<div class="lyrics-content" id="lyrics-content" tabindex="0" aria-label="歌词，可点击跳到对应时间">${lyrics.lines.map((line, index) => `<button type="button" class="lyric-line" data-action="seek-lyric" data-lyric-index="${index}" aria-label="跳到 ${time(line.time)}：${esc(line.text)}" title="${time(line.time)} · 点击跳转">${esc(line.text)}</button>`).join('')}</div>`;
    else if (lyrics.plain.length) content = `<div class="lyrics-content lyrics-plain" id="lyrics-content" tabindex="0" aria-label="纯文本歌词">${lyrics.plain.map(line => `<p class="lyric-line">${esc(line)}</p>`).join('')}</div>`;
    else content = `<div class="lyric-empty">${icon('lyric')}<span>${song.local ? '没有找到本地歌词<br>将同名 .lrc 文件放在音乐文件旁即可读取。' : '这首歌暂时没有歌词<br>让旋律自己讲述。'}</span></div>`;
    $('#lyrics-body').innerHTML = `<div class="lyrics-track"><div class="lyrics-art">${safeImage(song.cover) ? `<img src="${esc(safeImage(song.cover))}" alt="" referrerpolicy="no-referrer">` : `<div class="cover-fallback">${icon('music')}</div>`}</div><div class="lyrics-song-copy"><h2>${esc(song.title)}</h2><p class="lyrics-artist">${esc(song.artist)}</p>${song.album ? `<p class="lyrics-album">${esc(song.album)}</p>` : ''}</div></div>${content}`;
    lyrics.active = -1;
    updateLyricsFooter();
    updateTaskbarToggle();
    syncLyrics({ force: true, immediate: true });
  }
  function updateLyricsCover(song) {
    const source = safeImage(song?.cover);
    const image = source ? `<img src="${esc(source)}" alt="" referrerpolicy="no-referrer">` : '';
    const ambient = $('#lyrics-ambient');
    if (ambient) setHTML(ambient, image);
    const art = $('.lyrics-art', $('#lyrics-body'));
    if (art) setHTML(art, image || `<div class="cover-fallback">${icon('music')}</div>`);
  }
  function updateLyricsFooter() {
    const lyrics = state.lyrics;
    const hasLyrics = Boolean(state.current && !lyrics.loading && !lyrics.error && (lyrics.lines.length || lyrics.plain.length));
    const footer = $('.lyrics-footer', $('#lyrics-panel'));
    if (footer) footer.hidden = !hasLyrics;
    const hint = $('#lyrics-hint');
    if (hint) hint.textContent = lyrics.lines.length ? lyricsBrowsing ? '浏览歌词中 · 稍后继续跟随' : '点击歌词，跳到这一句' : '纯文本歌词';
    const follow = $('#lyrics-follow');
    if (follow) follow.hidden = !hasLyrics || !lyrics.lines.length || !lyricsBrowsing;
    $('#lyrics-content')?.classList.toggle('browsing', lyricsBrowsing);
  }
  function resetLyricsFollow() {
    clearTimeout(lyricsFollowTimer);
    lyricsFollowTimer = null;
    lyricsBrowsing = false;
  }
  function pauseLyricsFollow() {
    if ($('#lyrics-panel').hidden || !state.lyrics.lines.length) return;
    clearTimeout(lyricsFollowTimer);
    lyricsBrowsing = true;
    updateLyricsFooter();
    // Listening continues while the user explores another part of the lyrics.
    lyricsFollowTimer = setTimeout(resumeLyricsFollow, 6000);
  }
  function resumeLyricsFollow() {
    resetLyricsFollow();
    updateLyricsFooter();
    syncLyrics({ force: true });
  }
  function closeLyrics() {
    resetLyricsFollow();
    $('#lyrics-panel').hidden = true;
    $('#lyrics-button').classList.remove('active');
    updateLyricsFooter();
  }
  async function loadLyrics(force = false) {
    const song = state.current;
    if (!song) { state.lyrics.loading = false; syncTaskbarLyrics(); if (!$('#lyrics-panel').hidden) renderLyrics(); return; }
    const key = keyOf(song);
    if (!force && state.lyrics.key === key && !state.lyrics.error) return;
    const request = ++lyricRequest;
    state.lyrics = { key, loading: true, lines: [], plain: [], error: null, active: -1 };
    syncTaskbarLyrics(); if (!$('#lyrics-panel').hidden) renderLyrics();
    try {
      const data = song.local ? await bridge?.local?.lyrics?.(song.id) || { text: '' } : await api('lyrics', { hash: song.hash, title: song.title, artist: song.artist, albumAudioId: song.albumAudioId, duration: song.duration });
      if (request !== lyricRequest || !state.current || keyOf(state.current) !== key) return;
      state.lyrics = { key, loading: false, ...parseLyrics(data), error: null, active: -1 };
    } catch (error) { if (request !== lyricRequest || !state.current || keyOf(state.current) !== key) return; state.lyrics.loading = false; state.lyrics.error = error; }
    if (!$('#lyrics-panel').hidden) renderLyrics();
    syncLyrics();
  }
  function syncLyrics({ force = false, immediate = false } = {}) {
    const active = activeIndex(state.lyrics.lines, currentTransport().time);
    const changed = active !== state.lyrics.active;
    const previousActive = state.lyrics.active;
    state.lyrics.active = active;
    syncTaskbarLyrics();
    if ($('#lyrics-panel').hidden || !state.lyrics.lines.length) return;
    const content = $('#lyrics-content');
    if (!content) return;
    if (changed) {
      const previous = $(`[data-lyric-index="${previousActive}"]`, content);
      previous?.classList.remove('active');
      previous?.removeAttribute('aria-current');
    }
    const line = $(`[data-lyric-index="${active}"]`, content);
    if (line) {
      line.classList.add('active');
      line.setAttribute('aria-current', 'true');
      if (lyricsBrowsing || (!changed && !force)) return;
      const offset = line.getBoundingClientRect().top - content.getBoundingClientRect().top;
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      content.scrollTo({ top: content.scrollTop + offset - (content.clientHeight - line.clientHeight) / 2, behavior: immediate || reduceMotion ? 'instant' : 'smooth' });
    }
  }
  function toggleLyrics() {
    const panel = $('#lyrics-panel');
    if (!panel.hidden) { closeLyrics(); return; }
    panel.hidden = false;
    $('#lyrics-button').classList.add('active');
    $('#queue-panel').hidden = true; $('#effects-panel').hidden = true; $('#quality-panel').hidden = true; $('#output-panel').hidden = true;
    renderLyrics(); loadLyrics();
  }
  function stopQR() {
    state.qrEpoch++; clearTimeout(state.qrPoll); clearInterval(state.qrCountdown); state.qrPoll = null; state.qrCountdown = null; state.qrBusy = false;
  }
  function closeModal() {
    stopQR(); state.modal = null; $('#modal-layer').hidden = true;
    if (previousFocus?.isConnected) previousFocus.focus();
  }
  function openLogin() {
    if (state.modal === 'login') return;
    stopQR(); previousFocus = document.activeElement; state.modal = 'login';
    $('#login-modal').innerHTML = `<button class="icon-button modal-close" data-action="close-modal" aria-label="关闭登录">${icon('close')}</button><div class="login-symbol" aria-hidden="true"><span></span><span></span><span></span></div><div class="eyebrow">YOUR MUSIC. YOUR MOMENT.</div><h2 id="login-title">让熟悉的歌单，来到桌面。</h2><p class="login-subtitle">登录酷狗概念版账号</p><div class="qr-frame" id="qr-frame"><div class="loading-disc"></div></div><div class="qr-status" id="qr-status" role="status">正在生成二维码…</div><div class="qr-countdown" id="qr-countdown"></div><button class="text-button qr-refresh" id="qr-refresh" data-action="refresh-qr">${icon('refresh')}刷新二维码</button><div class="login-instructions"><span class="instruction-number">1</span><p>打开手机上的 <strong>酷狗概念版 App</strong></p><span class="instruction-number">2</span><p>使用 App 扫码，并在手机上确认登录</p></div><div class="login-note">青音是非官方本地客户端<br>登录用于读取概念版账号、歌单和可播放的音乐。</div>`;
    $('#modal-layer').hidden = false; $('.modal-close', $('#login-modal')).focus(); startQR();
  }
  function openAccount() {
    if (!state.loggedIn) { openLogin(); return; }
    previousFocus = document.activeElement; state.modal = 'account';
    const avatar = safeImage(state.user?.avatar);
    $('#login-modal').innerHTML = `<button class="icon-button modal-close" data-action="close-modal" aria-label="关闭账号">${icon('close')}</button><div class="account-modal-content"><div class="eyebrow">KUGOU CONCEPT ACCOUNT</div><div class="account-profile-avatar">${avatar ? `<img src="${esc(avatar)}" alt="" referrerpolicy="no-referrer">` : icon('user')}</div><h2 id="login-title">${esc(state.user?.name || '酷狗概念版账号')}</h2><p>已登录酷狗概念版账号<br>${state.user?.id ? `账号 ID：${esc(state.user.id)}<br>` : ''}音乐的可听范围由账号权限决定。</p><button class="secondary-button" data-action="logout">${icon('logout')}退出账号</button><div class="login-note">本机收藏和本地音乐会保留在这台电脑。</div></div>`;
    $('#modal-layer').hidden = false; $('.modal-close', $('#login-modal')).focus();
  }
  async function startQR() {
    stopQR();
    const epoch = state.qrEpoch; state.qr = null; state.qrBusy = true;
    if (state.modal !== 'login') return;
    $('#qr-frame').className = 'qr-frame'; $('#qr-frame').innerHTML = '<div class="loading-disc"></div>';
    $('#qr-status').textContent = '正在生成二维码…'; $('#qr-status').classList.remove('success'); $('#qr-countdown').textContent = '';
    $('#qr-refresh').disabled = true;
    try {
      const data = await api('qrStart', { platform: 'lite' });
      if (state.qrEpoch !== epoch || state.modal !== 'login') return;
      const image = safeImage(data.image);
      if (!data.key || !image) throw new Error('二维码暂未生成，请点击刷新重试。');
      state.qr = { key: data.key, image, expiresAt: Date.now() + Math.max(10, Number(data.expiresIn) || 180) * 1000, status: 'waiting' };
      $('#qr-frame').innerHTML = `<img src="${esc(image)}" alt="使用酷狗概念版 App 扫描此登录二维码">`;
      $('#qr-status').textContent = '使用酷狗概念版 App 扫码登录';
      state.qrBusy = false; $('#qr-refresh').disabled = false;
      updateQRCountdown(); state.qrCountdown = setInterval(updateQRCountdown, 1000); state.qrPoll = setTimeout(() => pollQR(epoch), 1600);
    } catch (error) {
      if (state.qrEpoch !== epoch || state.modal !== 'login') return;
      state.qrBusy = false; $('#qr-refresh').disabled = false;
      $('#qr-frame').innerHTML = `<div class="qr-error">${icon('info')}${esc(error.message)}</div>`;
      $('#qr-status').textContent = '二维码未能生成'; $('#qr-countdown').textContent = '检查网络连接后，点击刷新二维码';
    }
  }
  function updateQRCountdown() {
    if (state.modal !== 'login' || !state.qr) return;
    const remaining = Math.max(0, Math.ceil((state.qr.expiresAt - Date.now()) / 1000));
    if (!remaining && !['success', 'expired'].includes(state.qr.status)) { expireQR(); return; }
    $('#qr-countdown').textContent = state.qr.status === 'expired' ? '点击下方刷新，获取新的二维码' : `二维码 ${time(remaining)} 后失效`;
  }
  function expireQR() {
    if (!state.qr || state.modal !== 'login') return;
    state.qr.status = 'expired'; clearTimeout(state.qrPoll); clearInterval(state.qrCountdown);
    $('#qr-frame').classList.add('expired');
    $('#qr-frame').innerHTML = `<img src="${esc(state.qr.image)}" alt="已过期的二维码"><div class="qr-overlay">${icon('refresh')}二维码已过期</div>`;
    $('#qr-status').textContent = '让我们重新连接'; $('#qr-countdown').textContent = '点击下方刷新，获取新的二维码'; $('#qr-refresh').disabled = false;
  }
  async function pollQR(epoch) {
    if (epoch !== state.qrEpoch || state.modal !== 'login' || !state.qr || state.qr.status === 'expired') return;
    try {
      const data = await api('qrCheck', { key: state.qr.key });
      if (epoch !== state.qrEpoch || state.modal !== 'login' || state.qr?.status === 'expired') return;
      if (data.status === 'expired') { expireQR(); return; }
      if (data.status === 'success') {
        state.qr.status = 'success'; clearInterval(state.qrCountdown);
        $('#qr-frame').innerHTML = `<div class="qr-overlay">${icon('check')}手机已确认登录</div>`;
        $('#qr-status').textContent = '正在确认账号信息…'; $('#qr-countdown').textContent = ''; $('#qr-refresh').disabled = true;
        const verified = await api('status');
        if (epoch !== state.qrEpoch || state.modal !== 'login') return;
        if (!verified.loggedIn) throw new Error('账号状态尚未确认，请刷新二维码重新登录。');
        state.loggedIn = true; state.user = verified.user || data.user || null; state.statusLoading = false;
        playerState.resetSession({ preserveLocal: true }); invalidatePrefetch(); viewRequest++; qualityRequest++;
        if (state.current && !state.current.local) await stopPlayback();
        resetAccountPlaylists();
        updateAccount(); updateCounts(); closeModal(); toast('已登录酷狗概念版账号');
        if (state.view === 'search' && state.search.keyword) loadSearch();
        else if (state.view === 'playlists') loadPlaylists();
        else if (state.view === 'daily') loadDailyRecommendations();
        else if (state.view === 'guess') loadGuessYouLike();
        else renderPreserve();
        return;
      }
      state.qr.status = data.status === 'scanned' ? 'scanned' : 'waiting';
      $('#qr-status').textContent = data.status === 'scanned' ? '扫码成功，请在手机上确认登录' : '使用酷狗概念版 App 扫码登录';
      if (data.status === 'scanned') $('#qr-status').classList.add('success');
      else $('#qr-status').classList.remove('success');
      state.qrPoll = setTimeout(() => pollQR(epoch), 1800);
    } catch (error) {
      if (epoch !== state.qrEpoch || state.modal !== 'login') return;
      $('#qr-status').textContent = error.message || '登录连接暂时中断';
      $('#qr-countdown').textContent = '点击刷新二维码，重新连接';
      $('#qr-refresh').disabled = false; clearInterval(state.qrCountdown);
      $('#qr-frame').classList.add('expired');
    }
  }
  function resetAccountPlaylists() {
    dailyRequest++; guessRequest++; coverRequest++; playlistCovers.clear();
    state.daily = { date: '', source: '', accountId: '', loading: false, loaded: false, songs: [], error: null };
    state.guess = { source: '', accountId: '', loading: false, loaded: false, songs: [], error: null };
    persist();
    state.playlists = { loading: false, loaded: false, items: [], total: 0, hasMore: false, nextPage: null, error: null };
    state.detail = { loading: false, songs: [], total: 0, rawLoaded: 0, page: 0, nextPage: 1, hasMore: false, complete: false, error: null };
    state.selectedPlaylist = null;
    state.stack = state.stack.filter(view => !['detail', 'playlists'].includes(view.view));
    if (state.view === 'detail') state.view = 'playlists';
  }
  async function logout() {
    const button = $('[data-action="logout"]'); if (button) button.disabled = true;
    try {
      await api('logout');
      playerState.resetSession({ preserveLocal: true }); invalidatePrefetch(); viewRequest++; qualityRequest++;
      if (state.current && !state.current.local) await stopPlayback();
      state.loggedIn = false; state.user = null; resetAccountPlaylists(); updateAccount(); updateCounts(); closeModal(); updatePlayer(); renderPreserve(); toast('已退出酷狗概念版账号');
    } catch (error) { toast(error.message, true); if (button) button.disabled = false; }
  }
  function closeComfortPanels(except = '') {
    for (const name of ['sleep', 'shortcuts']) {
      if (name === except) continue;
      $(`#${name}-panel`).hidden = true; $(`#${name}-button`).setAttribute('aria-expanded', 'false');
    }
  }
  function toggleComfortPanel(name) {
    const panel = $(`#${name}-panel`), opening = panel.hidden;
    closeComfortPanels(); panel.hidden = !opening;
    $(`#${name}-button`).setAttribute('aria-expanded', String(opening));
    if (opening) {
      searchHistoryPanel.close(); closeLyrics();
      for (const id of ['queue', 'effects', 'quality', 'output', 'brightness']) $(`#${id}-panel`).hidden = true;
      $('#brightness-button').setAttribute('aria-expanded', 'false');
      panel.querySelector('button')?.focus();
      if (name === 'sleep') renderSleepTimer();
    } else $(`#${name}-button`).focus();
  }
  function renderSleepTimer() {
    const remaining = sleepState.endsAt ? Math.max(0, Math.ceil((sleepState.endsAt - Date.now()) / 1000)) : 0;
    const label = !sleepState.active ? '未设置定时' : sleepState.mode === 'after-track' ? '本首播完后暂停' : `${time(remaining)} 后暂停`;
    setText($('#sleep-status'), label);
    $('#sleep-button').classList.toggle('has-timer', sleepState.active);
    $('#sleep-button').title = sleepState.active ? `定时停止：${label}` : '定时停止';
    $('#sleep-button').setAttribute('aria-label', $('#sleep-button').title);
    $('#sleep-panel [data-action="cancel-sleep"]').disabled = !sleepState.active;
    for (const button of $$('#sleep-panel [data-action="set-sleep"]')) {
      button.setAttribute('aria-pressed', String(sleepState.active && (button.dataset.mode === 'after-track' ? sleepState.mode === 'after-track' : sleepState.mode === 'minutes' && Number(button.dataset.minutes) === sleepState.minutes)));
      if (button.dataset.mode === 'after-track') button.disabled = !state.current;
    }
  }
  async function setSleepTimer(options) {
    if (options.mode === 'after-track' && !state.current) { toast('先选择一首歌，再设置播完停止'); return; }
    const response = await bridge?.sleepTimer?.set(options);
    if (!response?.ok) throw new Error(response?.error || '定时停止暂不可用，请重新打开新版青音');
    sleepState = response.state;
    if (!sleepState.active) { renderSleepTimer(); return; }
    sleepStopped = false;
    if (sleepState.mode === 'after-track') invalidatePrefetch();
    renderSleepTimer(); toast(sleepState.mode === 'after-track' ? '这首歌播完后暂停' : `已设置 ${sleepState.minutes} 分钟后暂停`);
  }
  async function cancelSleepTimer() {
    const result = await bridge?.sleepTimer?.cancel();
    if (!result?.ok) throw new Error(result?.error || '暂时无法取消定时');
    sleepState = result.state; renderSleepTimer(); prefetchNext(); toast('已取消定时停止');
  }
  function pauseForSleep(notify = true) {
    sleepStopped = true; sleepState = { active: false, mode: 'off', endsAt: null, minutes: null };
    if (playback) { playback.wantPlayback = false; clearTimeout(playback.skipTimer); playback.endedHandled = true; }
    invalidatePrefetch(); audio.pause();
    if (state.audioLoading) stopPlayback().catch(() => {});
    else if (playback?.backend === 'mpv') {
      if (state.mpvState) state.mpvState = { ...state.mpvState, paused: true };
      mpvSend('pause').then(playbackUI);
    }
    progressWatchdog.reset(); renderSleepTimer(); playbackUI();
    if (notify) toast('定时结束，已暂停播放');
  }
  const actions = {
    'list-jump': element => jumpInList(element.dataset.jump),
    account: openAccount, reauth: openLogin, 'close-modal': closeModal, 'refresh-qr': startQR, logout,
    brightness: () => { const panel = $('#brightness-panel'); panel.hidden = !panel.hidden; $('#brightness-button').setAttribute('aria-expanded', String(!panel.hidden)); },
    'brightness-reset': () => setBrightness(DEFAULT_BRIGHTNESS),
    'taskbar-lyrics': toggleTaskbarLyrics,
    sleep: () => toggleComfortPanel('sleep'), shortcuts: () => toggleComfortPanel('shortcuts'),
    'set-sleep': element => setSleepTimer(element.dataset.mode === 'after-track' ? { mode: 'after-track' } : { mode: 'minutes', minutes: Number(element.dataset.minutes) }),
    'cancel-sleep': cancelSleepTimer,
    official: async () => { try { await bridge?.openOfficial?.(); } catch { toast('官网暂时无法打开，请稍后重试。', true); } },
    back: goBack, import: importMusic,
    'refresh-discover': loadRecommendations,
    'refresh-daily': () => loadDailyRecommendations(true),
    'refresh-guess': () => loadGuessYouLike(true),
    explore: () => { if (state.recommendations.error) loadRecommendations(); $('#recommendations')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
    'all-recommendations': () => navigate('recommendations'),
    'my-playlists': () => navigate('playlists'), 'my-favorites': () => navigate('favorites'),
    'refresh-playlists': () => state.loggedIn ? loadPlaylists() : openLogin(), 'more-playlists': () => loadPlaylists(true),
    'open-playlist': (element) => { const list = state.visiblePlaylists[Number(element.dataset.playlistIndex)]; if (list) navigate('detail', { playlist: list, parent: state.view }); },
    'retry-detail': () => loadDetail(), 'more-detail': () => loadDetail(true),
    'retry-search': loadSearch,
    'search-previous': () => { if (state.search.page > 1) { state.search.page--; loadSearch(); $('#main-content').scrollTop = 0; } },
    'search-next': () => { state.search.page++; loadSearch(); $('#main-content').scrollTop = 0; },
    'play-song': (element) => { const song = catalog.get(element.dataset.key); if (song) playSong(song, state.visibleSongs.some(item => keyOf(item) === keyOf(song)) ? state.visibleSongs : [song]); },
    'favorite-song': (element) => favorite(catalog.get(element.dataset.key)),
    'favorite-current': () => favorite(state.current),
    enqueue: (element) => enqueue(catalog.get(element.dataset.key)),
    'play-next': element => enqueueNext(catalog.get(element.dataset.key)),
    'clear-queue': clearQueue,
    'play-all': playVisibleList,
    'enqueue-all': () => { const previous = state.queue.length; state.visibleSongs.forEach(song => enqueue(song, true)); updatePlayer(); renderQueue(); prefetchNext(); toast(state.queue.length > previous ? `已加入 ${state.queue.length - previous} 首歌曲` : '这些歌曲已经在队列里'); },
    'play-pause': playPause, previous: () => moveTrack(-1), next: () => moveTrack(1),
    'sort-list': (element) => {
      const field = element.dataset.field || 'default';
      // "按添加时间" means newest first to a listener, so pick that direction on entry.
      if (field === 'added' && state.sort.field !== 'added') state.sort.direction = 'desc';
      state.sort.field = field;
      renderPreserve(); return persistSort();
    },
    'sort-direction': () => { state.sort.direction = state.sort.direction === 'asc' ? 'desc' : 'asc'; renderPreserve(); return persistSort(); },
    repeat: changePlaybackMode,
    mute: () => { state.muted = !state.muted; applyOutputMode(); mpvSend('volume', { volume: state.muted ? 0 : state.volume }); updatePlayer(); },
    queue: () => { $('#queue-panel').hidden = !$('#queue-panel').hidden; if (!$('#queue-panel').hidden) { closeLyrics(); $('#effects-panel').hidden = true; $('#quality-panel').hidden = true; $('#output-panel').hidden = true; renderQueue(); } },
    effects: () => { const panel = $('#effects-panel'); panel.hidden = !panel.hidden; if (!panel.hidden) { $('#queue-panel').hidden = true; closeLyrics(); $('#quality-panel').hidden = true; $('#output-panel').hidden = true; renderEffects(); } },
    'set-effect': (element) => chooseEffect(element.dataset.effect),
    quality: () => { const panel = $('#quality-panel'); panel.hidden = !panel.hidden; if (!panel.hidden) { $('#queue-panel').hidden = true; closeLyrics(); $('#effects-panel').hidden = true; $('#output-panel').hidden = true; renderQuality(); loadQualities(); } },
    'set-quality': (element) => chooseQuality(element.dataset.quality),
    output: () => { const panel = $('#output-panel'); panel.hidden = !panel.hidden; if (!panel.hidden) { $('#queue-panel').hidden = true; closeLyrics(); $('#effects-panel').hidden = true; $('#quality-panel').hidden = true; renderOutput(); } },
    'set-output': (element) => chooseOutput(element.dataset.output),
    'play-queue': (element) => { const song = state.queue.find(item => keyOf(item) === element.dataset.key); if (song) playSong(song); },
    'remove-queue': element => removeFromQueue(element.dataset.key),
    lyrics: toggleLyrics, 'retry-lyrics': () => loadLyrics(true),
    'follow-lyrics': resumeLyricsFollow,
    'seek-lyric': async element => {
      const line = state.lyrics.lines[Number(element.dataset.lyricIndex)];
      if (!line || $('#lyrics-panel').hidden) return;
      if (!currentTransport().ready) { toast('歌曲还在加载，请稍后跳转'); return; }
      resetLyricsFollow(); updateLyricsFooter();
      await seekTo(line.time);
      syncLyrics({ force: true });
    },
  };
  document.addEventListener('click', async event => {
    const panelAction = event.target.closest('[data-action]')?.dataset.action;
    if (panelAction && !['sleep', 'shortcuts', 'set-sleep', 'cancel-sleep'].includes(panelAction) && !event.target.closest('.comfort-panel')) closeComfortPanels();
    const windowButton = event.target.closest('[data-window]');
    if (windowButton) {
      try {
        if (windowButton.dataset.window === 'close') { clearTimeout(saveTimer); await saveSettings().catch(() => {}); }
        await bridge?.window?.(windowButton.dataset.window);
      } catch { toast('窗口操作暂未完成。', true); }
      return;
    }
    const navigation = event.target.closest('[data-view]');
    if (navigation) { navigate(navigation.dataset.view); return; }
    const target = event.target.closest('[data-action]');
    if (target && !target.disabled && actions[target.dataset.action]) {
      try { await actions[target.dataset.action](target); } catch (error) { toast(error.message || '操作暂未完成，请重试。', true); }
    }
    if (event.target === $('#modal-layer')) closeModal();
  });
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') {
      const openComfort = ['sleep', 'shortcuts'].find(name => !$(`#${name}-panel`).hidden);
      closeComfortPanels();
      if (openComfort) $(`#${openComfort}-button`).focus();
      $('#brightness-panel').hidden = true; $('#brightness-button').setAttribute('aria-expanded', 'false');
      if (state.modal) closeModal();
      else { $('#queue-panel').hidden = true; closeLyrics(); $('#effects-panel').hidden = true; $('#quality-panel').hidden = true; $('#output-panel').hidden = true; }
      return;
    }
    if (state.modal && event.key === 'Tab') {
      const controls = $$('button:not(:disabled), input, [tabindex="0"]', $('#login-modal'));
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); closeComfortPanels(); if (state.modal) closeModal(); $('#search-input').focus(); $('#search-input').select(); return; }
    if (state.modal || document.activeElement.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) || event.altKey || event.metaKey) return;
    if (event.ctrlKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); moveTrack(event.key === 'ArrowLeft' ? -1 : 1); return; }
    if (!event.ctrlKey && event.key === '?') { event.preventDefault(); actions.shortcuts(); return; }
    if (event.ctrlKey || event.shiftKey) return;
    if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { if (currentTransport().ready) { event.preventDefault(); seekTo(currentTransport().time + (event.key === 'ArrowRight' ? 5 : -5)).catch(() => {}); } return; }
    if (['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); state.volume = Math.round(Math.max(0, Math.min(1, state.volume + (event.key === 'ArrowUp' ? .05 : -.05))) * 100) / 100; state.muted = false; applyOutputMode(); mpvSend('volume', { volume: state.volume }); persist(); updatePlayer(); return; }
    const shortcuts = { m: 'mute', q: 'queue', l: 'lyrics', '?': 'shortcuts' };
    if (shortcuts[event.key.toLowerCase()]) { event.preventDefault(); actions[shortcuts[event.key.toLowerCase()]](); return; }
    if (event.code === 'Space' && !state.modal && !['INPUT', 'TEXTAREA', 'BUTTON'].includes(document.activeElement.tagName)) { event.preventDefault(); playPause(); }
  });
  $('#search-form').addEventListener('submit', event => {
    event.preventDefault(); submitSearch($('#search-input').value);
  });
  $('#sleep-form').addEventListener('submit', event => { event.preventDefault(); if ($('#sleep-form').reportValidity()) setSleepTimer({ mode: 'minutes', minutes: Number($('#sleep-minutes').value) }).catch(error => toast(error.message, true)); });
  $('#volume').addEventListener('input', event => { state.volume = Number(event.target.value); state.muted = false; applyOutputMode(); mpvSend('volume', { volume: state.volume }); persist(); updatePlayer(); });
  $('#brightness-slider').addEventListener('input', event => setBrightness(event.target.value));
  $('#seek').addEventListener('input', () => { seeking = true; const duration = currentTransport().duration; if (duration > 0) $('#current-time').textContent = time(duration * Number($('#seek').value) / 100); });
  $('#seek').addEventListener('change', async () => { try { const duration = currentTransport().duration; if (duration > 0) await seekTo(duration * Number($('#seek').value) / 100); } finally { seeking = false; syncProgress(); syncLyrics(); } });
  $('#seek').addEventListener('blur', () => { seeking = false; syncProgress(); });
  audio.addEventListener('timeupdate', () => { syncProgress(); syncLyrics(); });
  audio.addEventListener('waiting', syncTaskbarLyrics);
  audio.addEventListener('canplay', syncTaskbarLyrics);
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', syncTaskbarLyrics);
  audio.addEventListener('loadedmetadata', () => { if (playback?.request === playRequest && playback.url === audio.getAttribute('src') && state.current && Number.isFinite(audio.duration)) { state.current.duration = audio.duration; const original = catalog.get(keyOf(state.current)); if (original) original.duration = audio.duration; } syncProgress(); });
  audio.addEventListener('playing', () => { if (playback?.backend === 'browser' && playback.request === playRequest && playback.phase === 'playing' && audio.readyState >= 3 && Number.isFinite(audio.duration) && audio.duration > 0) confirmPlayback(playback); });
  audio.addEventListener('pause', () => { updatePlayer(); syncCurrentRows(); });
  // A stalled stream may never emit an error. Watch actual time advancement;
  // manual pause, seeking, cancellation and sleep reset the observation window.
  const progressTimer = setInterval(() => {
    if (seeking) { progressWatchdog.reset(); return; }
    const context = playback;
    if (!progressWatchdog.check(context, currentTransport(), performance.now())) return;
    const error = new Error('播放进度长时间没有前进'); error.name = 'TimeoutError'; error.code = 'PLAYBACK_STALLED';
    reportPlaybackError(error, context);
  }, 1000);
  audio.addEventListener('ended', async () => {
    if (playback?.backend !== 'browser' || sleepStopped) return;
    const context = playback;
    try {
      const result = await bridge?.sleepTimer?.trackEnded();
      if (result?.consumed) { pauseForSleep(false); return; }
    } catch { if (sleepState.mode === 'after-track') { pauseForSleep(); return; } }
    if (context === playback && !sleepStopped) moveTrack(1, true);
  });
  audio.addEventListener('error', () => {
    if (!audio.error || !playback || playback.request !== playRequest || playback.url !== audio.getAttribute('src') || playback.phase === 'loading') return;
    reportPlaybackError(mediaFailure());
  });
  bridge?.onEvent?.((event) => {
    if (event?.type === 'sleep-timer' && event.action === 'expired') { pauseForSleep(); return; }
    if (event?.type === 'maximized') { $('#maximize-icon').innerHTML = icon(event.value ? 'restore' : 'maximize'); return; }
    if (event?.type === 'mpv') {
      handleNativeEvent(event);
    }
  });
  document.addEventListener('error', event => {
    if (event.target.tagName !== 'IMG') return;
    const parent = event.target.parentElement;
    if (event.target.dataset.playlistImage) {
      const card = parent.closest('.playlist-card');
      const list = card ? state.visiblePlaylists[Number(card.dataset.playlistIndex)] : state.selectedPlaylist;
      if (list) { event.target.remove(); parent.insertAdjacentHTML('afterbegin', playlistCover({ ...list, cover: '' })); return; }
    }
    event.target.remove();
    if (!parent.querySelector('svg')) parent.insertAdjacentHTML('afterbegin', icon(parent.classList.contains('account-avatar') || parent.classList.contains('tiny-avatar') ? 'user' : 'music'));
  }, true);
  const sleepDisplayTimer = setInterval(() => { if (sleepState.active && !$('#sleep-panel').hidden) renderSleepTimer(); }, 1000);
  window.addEventListener('beforeunload', () => { stopQR(); resetLyricsFollow(); clearInterval(progressTimer); clearInterval(sleepDisplayTimer); });

  async function initialize() {
    // 音效 routes the element through Web Audio, which only stays audible for a
    // CORS-clean resource; this must be set before any media loads. Normal
    // playback is unaffected — verified on both the local and the online scheme.
    audio.crossOrigin = 'anonymous';
    renderMain(); updatePlayer();
    const initial = await Promise.allSettled([bridge?.store?.get?.() || {}, bridge?.local?.list?.() || []]);
    if (initial[0].status === 'fulfilled') {
      state.saved = initial[0].value || {};
      state.searchHistory = normalize(state.saved.searchHistory);
      searchHistoryPanel.refresh();
      state.favorites = registerSongs(state.saved.favorites); state.history = registerSongs(state.saved.history).slice(0, 100);
      const preferences = state.saved.preferences || {};
      if (Number.isFinite(Number(preferences.volume))) state.volume = Math.min(1, Math.max(0, Number(preferences.volume)));
      state.shuffle = Boolean(preferences.shuffle); state.repeat = state.shuffle ? 'all' : ['all', 'one', 'off'].includes(preferences.repeat) ? preferences.repeat : 'all'; audio.volume = state.volume;
      state.effects = effectPreset(preferences.effects).id; applyEffect(state.effects);
      if (typeof preferences.quality === 'string') state.quality = preferences.quality;
      if (preferences.output === 'mpv') state.output = 'mpv';
      setBrightness(normalizeBrightness(preferences.brightness), false);
      state.taskbarLyricsEnabled = preferences.taskbarLyricsEnabled !== false;
      updateTaskbarToggle();
      let savedSort = state.saved.sort || {};
      try { const mirror = JSON.parse(localStorage.getItem('qingyin.sort.v1') || 'null'); if (mirror && Number(mirror.updatedAt) > (Number(savedSort.updatedAt) || 0)) savedSort = mirror; } catch { /* Keep the native saved order. */ }
      if (!sortTouched) {
        if (SORT_FIELDS[savedSort.field]) state.sort.field = savedSort.field;
        if (['asc', 'desc'].includes(savedSort.direction)) state.sort.direction = savedSort.direction;
        state.sortUpdatedAt = Number(savedSort.updatedAt) || 0;
      }
    }
    settingsLoaded = initial[0].status === 'fulfilled';
    if (initial[1].status === 'fulfilled') state.local = registerSongs(initial[1].value);
    resolveSettingsReady();
    if (settingsLoaded && (sortTouched || state.sortUpdatedAt > (Number(state.saved.sort?.updatedAt) || 0))) persist(true).catch(() => {});
    updateCounts(); updatePlayer(); renderEffects(); renderQuality();
    const mpvStatus = bridge?.mpv?.status ? await bridge.mpv.status().catch(() => null) : null;
    state.mpvAvailable = Boolean(mpvStatus?.available);
    if (!state.mpvAvailable) state.output = 'browser';
    applyOutputMode(); renderOutput(); renderPreserve();
    const timerStatus = await bridge?.sleepTimer?.status().catch(() => null);
    if (timerStatus?.ok) sleepState = timerStatus.state;
    renderSleepTimer();
    await Promise.allSettled([loadStatus(), loadRecommendations()]);
  }
  initialize().catch(() => toast('初始化暂未完成，请关闭窗口后重新启动青音。', true));
})();
