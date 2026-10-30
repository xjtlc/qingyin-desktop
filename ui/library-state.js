(function (root, factory) {
  'use strict';
  const exports = factory();
  if (typeof module === 'object' && module.exports) module.exports = exports;
  else root.QingyinLibraryState = exports;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const copy = value => JSON.parse(JSON.stringify(value));
  class OrderedStore {
    constructor(write, onSaved = () => {}) { this.write = write; this.onSaved = onSaved; this.queue = []; this.running = false; this.latest = Promise.resolve(); }
    save(data) {
      const snapshot = copy(data);
      this.latest = new Promise((resolve, reject) => this.queue.push({ snapshot, resolve, reject }));
      if (!this.running) this.drain();
      return this.latest;
    }
    async drain() {
      this.running = true;
      while (this.queue.length) {
        const entry = this.queue.shift();
        try { await this.write(entry.snapshot); this.onSaved(entry.snapshot); entry.resolve(); }
        catch (error) { entry.reject(error); }
      }
      this.running = false;
    }
  }
  const pageError = message => Object.assign(new Error(message), { code: 'PLAYLIST_PAGINATION_INVALID' });
  const positiveInt = value => Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
  const nonnegative = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
  // Page numbers and offsets are service cursors. Song normalization and deduplication
  // never decide the next request or whether all service entries have been read.
  async function collectPlaylistPages({ fetchPage, keyOf, initial = {}, isCurrent = () => true, onProgress = () => {} }) {
    let progress = { songs: [...(initial.songs || [])], total: Number(initial.total) || 0, rawLoaded: Number(initial.rawLoaded) || 0, page: Number(initial.page) || 0, nextPage: positiveInt(initial.nextPage) || 1, nextOffset: initial.nextOffset ?? null, pageSize: positiveInt(initial.pageSize), hasMore: true, complete: false, loading: true, error: null, pages: [...(initial.pages || [])], signatures: [...(initial.signatures || [])] };
    const pages = new Set(progress.pages), signatures = new Set(progress.signatures);
    const publish = () => { if (isCurrent()) onProgress({ ...progress, songs: [...progress.songs], pages: [...pages], signatures: [...signatures] }); };
    publish();
    try {
      while (isCurrent()) {
        const page = progress.nextPage, offset = progress.nextOffset;
        const cursor = JSON.stringify([page, offset]);
        if (!page || pages.has(cursor)) throw pageError('服务重复返回已读取的页码，已停止加载。请重试或刷新歌单。');
        const data = await fetchPage({ page, ...(progress.pageSize ? { pageSize: progress.pageSize } : {}), ...(offset !== null ? { offset } : {}) });
        if (!isCurrent()) return;
        const songs = Array.isArray(data.songs) ? data.songs : [];
        const rawCount = nonnegative(data.rawCount) ?? songs.length;
        const hasMore = data.hasMore === true;
        const nextPage = hasMore ? positiveInt(data.nextPage) : null;
        const nextOffset = hasMore ? nonnegative(data.nextOffset) : null;
        if (data.page !== undefined && positiveInt(data.page) !== page) throw pageError('服务返回的歌曲页码不匹配，请重试或刷新歌单。');
        if (data.sourcePage != null && positiveInt(data.sourcePage) !== page) throw pageError('服务重复返回已读取的歌曲页，请重试或刷新歌单。');
        if (hasMore && (!nextPage || nextPage <= page || pages.has(JSON.stringify([nextPage, nextOffset])))) throw pageError('服务未返回新的歌曲页码，已停止加载。请重试或刷新歌单。');
        if (hasMore && rawCount === 0) throw pageError('服务暂未返回后续歌曲，已保留已读内容。请重试。');
        // Entry ids may be synthesized from offsets, so compare actual song content
        // as well as service page ids when guarding against an ignored page cursor.
        const signature = data.pageSignature || (songs.length ? JSON.stringify(songs.map(song => [song.hash || '', song.albumAudioId || '', song.albumId || '', song.title || '', song.artist || ''])) : '');
        if (signature && signatures.has(signature) && positiveInt(data.sourcePage) !== page) throw pageError('服务重复返回同一页歌曲，已保留已读内容。请重试或刷新歌单。');
        const rawLoaded = progress.rawLoaded + rawCount;
        const reliable = data.totalReliable ?? (data.totalReported === true);
        const total = reliable ? Math.max(Number(data.total) || 0, rawLoaded) : Math.max(progress.total, Number(data.sourceTotal) || 0, rawLoaded);
        if (!hasMore && reliable && Number(data.sourceTotal ?? data.total) > rawLoaded) throw pageError('歌单还有歌曲暂未读取到，已保留已读内容。请继续读取或刷新。');
        const existing = new Set(progress.songs.map(keyOf));
        const received = songs.filter(song => { const key = keyOf(song); if (existing.has(key)) return false; existing.add(key); return true; });
        pages.add(cursor); if (signature) signatures.add(signature);
        progress = { ...progress, songs: [...progress.songs, ...received], total, sourceTotal: data.sourceTotal ?? progress.sourceTotal, totalReported: data.totalReported ?? progress.totalReported, rawLoaded, page, nextPage, nextOffset, pageSize: positiveInt(data.pageSize) || progress.pageSize, hasMore, complete: !hasMore, loading: hasMore, error: null };
        publish();
        if (!hasMore) return progress;
      }
    } catch (error) {
      if (!isCurrent()) return;
      progress = { ...progress, loading: false, complete: false, error }; publish(); return progress;
    }
  }
  return { OrderedStore, collectPlaylistPages };
});
