(function (root, factory) {
  'use strict';
  const exports = factory();
  if (typeof module === 'object' && module.exports) module.exports = exports;
  else root.QingyinSearchHistory = exports;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const clean = value => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  const key = value => clean(value).toLocaleLowerCase();

  function normalize(values) {
    const seen = new Set();
    return (Array.isArray(values) ? values : []).map(clean).filter(value => {
      const identity = key(value);
      if (!identity || seen.has(identity)) return false;
      seen.add(identity);
      return true;
    }).slice(0, 20);
  }
  function remember(values, query) {
    const value = clean(query);
    return value ? normalize([value, ...normalize(values)]) : normalize(values);
  }
  function remove(values, query) {
    const identity = key(query);
    return normalize(values).filter(value => key(value) !== identity);
  }
  function filter(values, query) {
    const term = key(query);
    return normalize(values).filter(value => key(value).includes(term));
  }
  return { normalize, remember, remove, filter };
});
