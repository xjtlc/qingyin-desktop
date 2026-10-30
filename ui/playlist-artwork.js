(function (root, factory) {
  'use strict';
  const exports = factory();
  if (typeof module === 'object' && module.exports) module.exports = exports;
  else root.QingyinPlaylistArtwork = exports;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  function kind(list) { return /我喜欢|喜欢的|最爱/.test(String(list?.title || '')) ? 'favorite' : 'collection'; }
  const images = new Map();
  function designedCover(list) {
    const type = kind(list);
    if (images.has(type)) return images.get(type);
    const favorite = type === 'favorite';
    const colors = favorite ? ['#ead8d8', '#a97788', '#f8eded', '#694656'] : ['#dae7ee', '#7494ad', '#eff5f7', '#3b5d77'];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/></linearGradient><radialGradient id="disc"><stop stop-color="${colors[3]}"/><stop offset="1" stop-color="#253344"/></radialGradient></defs><rect width="600" height="600" fill="url(#bg)"/><circle cx="520" cy="70" r="230" fill="${colors[2]}" opacity=".17"/><path d="M0 470Q210 390 600 480V600H0" fill="${colors[2]}" opacity=".14"/><g transform="rotate(-12 300 290)"><rect x="118" y="117" width="352" height="352" rx="28" fill="${colors[2]}" opacity=".5"/><rect x="142" y="139" width="306" height="306" rx="20" fill="${colors[2]}"/><circle cx="295" cy="292" r="124" fill="url(#disc)"/><g fill="none" stroke="${colors[2]}" opacity=".14"><circle cx="295" cy="292" r="109"/><circle cx="295" cy="292" r="97"/><circle cx="295" cy="292" r="84"/></g><circle cx="295" cy="292" r="43" fill="${colors[1]}"/>${favorite ? '<path d="M295 310l-19-18a12 12 0 0 1 19-15 12 12 0 0 1 19 15Z" fill="#f8eded"/>' : '<g fill="none" stroke="#eff5f7" stroke-width="4" stroke-linecap="round"><path d="M281 292v-7m9 15v-24m10 28v-29m10 23v-15"/></g>'}<circle cx="295" cy="292" r="3" fill="${colors[3]}"/></g><text x="48" y="65" font-family="Segoe UI, sans-serif" font-size="17" letter-spacing="4" fill="${colors[3]}">QINGYIN / ${favorite ? 'FAVORITES' : 'COLLECTION'}</text><text x="48" y="535" font-family="Microsoft YaHei, sans-serif" font-size="32" font-weight="600" letter-spacing="5" fill="${colors[3]}">${favorite ? '我喜欢' : '日常收藏'}</text><text x="49" y="566" font-family="Segoe UI, sans-serif" font-size="12" letter-spacing="3" fill="${colors[3]}" opacity=".75">${favorite ? 'KEEP WHAT MOVES YOU' : 'A PLACE FOR YOUR MUSIC'}</text></svg>`;
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    images.set(type, url);
    return url;
  }
  return { kind, designedCover };
});
