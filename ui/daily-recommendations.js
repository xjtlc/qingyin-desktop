(function (root, factory) {
  'use strict';
  const exports = factory();
  if (typeof module === 'object' && module.exports) module.exports = exports;
  else root.QingyinDaily = exports;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const dayKey = (date = new Date()) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  function validDailyCache(cache, accountId, today = dayKey()) {
    return Boolean(accountId && cache?.source === 'kugou-daily' && String(cache.accountId) === String(accountId) && cache.date === today && Array.isArray(cache.songs) && cache.songs.length);
  }
  return { dayKey, validDailyCache };
});
