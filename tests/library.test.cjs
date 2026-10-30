'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { OrderedStore, collectPlaylistPages } = require('../ui/library-state.js');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const keyOf = song => song.playlistEntryId;
const tracks = count => Array.from({ length: count }, (_, index) => ({ hash: 'A'.repeat(32), albumAudioId: String(index), title: `歌曲 ${index}`, playlistEntryId: `entry:${index}` }));
const pageOf = (rows, page, size = 300) => ({ songs: rows.slice((page - 1) * size, page * size), rawCount: rows.slice((page - 1) * size, page * size).length, page, sourcePage: page, pageSize: size, total: rows.length, sourceTotal: rows.length, totalReported: true, totalReliable: true, hasMore: page * size < rows.length, nextPage: page * size < rows.length ? page + 1 : null, nextOffset: page * size < rows.length ? page * size : null });

test('all 434 playlist entries load automatically, including the duplicate recording', async () => {
  const rows = tracks(434);
  rows[299] = { ...rows[0], playlistEntryId: 'entry:299' };
  const calls = [], states = [];
  const result = await collectPlaylistPages({ keyOf, fetchPage: async cursor => { calls.push(cursor); return pageOf(rows, cursor.page); }, onProgress: state => states.push(state) });
  assert.equal(result.songs.length, 434);
  assert.equal(result.rawLoaded, 434);
  assert.equal(new Set(result.songs.map(keyOf)).size, 434);
  assert.equal(result.songs[0].albumAudioId, result.songs[299].albumAudioId);
  assert.deepEqual(calls, [{ page: 1 }, { page: 2, pageSize: 300, offset: 300 }]);
  assert.equal(states[1].loading, true);
  assert.equal(result.complete, true);
});

test('a failed second page resumes without reloading or duplicating the first page', async () => {
  const rows = tracks(5);
  const failure = await collectPlaylistPages({ keyOf, fetchPage: async cursor => { if (cursor.page === 2) throw new Error('network'); return pageOf(rows, cursor.page, 3); } });
  assert.equal(failure.songs.length, 3);
  assert.equal(failure.nextPage, 2);
  assert.equal(failure.loading, false);
  assert.equal(failure.complete, false);
  const calls = [];
  const resumed = await collectPlaylistPages({ keyOf, initial: failure, fetchPage: async cursor => { calls.push(cursor.page); return pageOf(rows, cursor.page, 3); } });
  assert.deepEqual(calls, [2]);
  assert.equal(resumed.songs.length, 5);
  assert.equal(resumed.error, null);
  assert.equal(resumed.complete, true);
});

test('leaving the page or changing account discards an in-flight response', async () => {
  const request = deferred();
  let active = true;
  const states = [];
  const pending = collectPlaylistPages({ keyOf, isCurrent: () => active, fetchPage: () => request.promise, onProgress: state => states.push(state) });
  active = false; request.resolve(pageOf(tracks(5), 1, 3));
  assert.equal(await pending, undefined);
  assert.equal(states.length, 1);
  assert.equal(states[0].songs.length, 0);
});

test('an ignored page cursor stops repeated content without silently duplicating a page', async () => {
  const rows = tracks(6);
  const result = await collectPlaylistPages({ keyOf, fetchPage: async cursor => ({ ...pageOf(rows, cursor.page, 3), sourcePage: null, songs: rows.slice(0, 3) }) });
  assert.equal(result.songs.length, 3);
  assert.equal(result.complete, false);
  assert.equal(result.error.code, 'PLAYLIST_PAGINATION_INVALID');
});

test('an echoed old page is rejected even if the requested page keeps increasing', async () => {
  const rows = tracks(6);
  const result = await collectPlaylistPages({ keyOf, fetchPage: async cursor => ({ ...pageOf(rows, cursor.page, 3), sourcePage: 1 }) });
  assert.equal(result.songs.length, 3);
  assert.equal(result.nextPage, 2);
  assert.equal(result.complete, false);
});

test('legitimate identical recordings across whole pages remain distinct when the service confirms the page', async () => {
  const rows = tracks(6).map((song, index) => ({ ...tracks(1)[0], playlistEntryId: `entry:${index}` }));
  const result = await collectPlaylistPages({ keyOf, fetchPage: async cursor => pageOf(rows, cursor.page, 3) });
  assert.equal(result.songs.length, 6);
  assert.equal(result.complete, true);
});

test('an empty response before the reported total is retryable and cannot claim completion', async () => {
  const rows = tracks(5);
  const result = await collectPlaylistPages({ keyOf, fetchPage: async cursor => cursor.page === 1 ? pageOf(rows, 1, 3) : { ...pageOf(rows, 2, 3), songs: [], rawCount: 0 } });
  assert.equal(result.songs.length, 3);
  assert.equal(result.nextPage, 2);
  assert.equal(result.complete, false);
  assert.equal(result.error.code, 'PLAYLIST_PAGINATION_INVALID');
});

test('unknown or page-local totals use raw entries read rather than a guessed offset', async () => {
  const rows = tracks(3);
  const result = await collectPlaylistPages({ keyOf, fetchPage: async ({ page }) => {
    const songs = page === 1 ? rows.slice(0, 2) : page === 2 ? rows.slice(2) : [];
    return { songs, rawCount: songs.length, page, sourcePage: page, pageSize: 300, total: page * 300, sourceTotal: songs.length, totalReported: true, totalReliable: false, hasMore: songs.length > 0, nextPage: songs.length ? page + 1 : null, nextOffset: songs.length ? page * 300 : null };
  } });
  assert.equal(result.rawLoaded, 3);
  assert.equal(result.total, 3);
  assert.equal(result.complete, true);
});

test('service nextPage and stable page size are honored rather than inferred from song count', async () => {
  const rows = tracks(4), calls = [];
  const result = await collectPlaylistPages({ keyOf, fetchPage: async cursor => {
    calls.push(cursor);
    return cursor.page === 1 ? { ...pageOf(rows, 1, 2), nextPage: 4 } : { ...pageOf(rows, 2, 2), page: 4, sourcePage: 4 };
  } });
  assert.equal(result.complete, true);
  assert.deepEqual(calls, [{ page: 1 }, { page: 4, pageSize: 2, offset: 2 }]);
});

test('settings are copied and written in order so a slow old write cannot restore an old direction', async () => {
  const first = deferred(), written = [];
  const store = new OrderedStore(async snapshot => { written.push(snapshot.sort.direction); if (written.length === 1) await first.promise; });
  const one = store.save({ sort: { direction: 'asc' } });
  const data = { sort: { direction: 'desc' } };
  const two = store.save(data); data.sort.direction = 'asc';
  assert.deepEqual(written, ['asc']);
  first.resolve(); await Promise.all([one, two]);
  assert.deepEqual(written, ['asc', 'desc']);
});

test('a failed settings write does not prevent the next direction from saving', async () => {
  let attempts = 0;
  const saved = [];
  const store = new OrderedStore(async () => { if (++attempts === 1) throw new Error('disk'); }, snapshot => saved.push(snapshot.sort.direction));
  await assert.rejects(store.save({ sort: { direction: 'asc' } }));
  await store.save({ sort: { direction: 'desc' } });
  assert.deepEqual(saved, ['desc']);
});
