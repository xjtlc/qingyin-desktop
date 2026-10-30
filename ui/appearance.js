(function (root, factory) {
  'use strict';
  const values = factory();
  if (typeof module === 'object' && module.exports) module.exports = values;
  else root.QingyinAppearance = values;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const DEFAULT_BRIGHTNESS = 72;
  function normalizeBrightness(value, fallback = DEFAULT_BRIGHTNESS) {
    if (value === null || value === undefined || value === '') return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(100, Math.max(0, Math.round(parsed))) : fallback;
  }
  function brightnessVariables(value) {
    const brightness = normalizeBrightness(value);
    return {
      '--qy-frost-brightness': (1.02 + brightness * 0.0039).toFixed(3),
      '--qy-glass-wash': (9 + brightness * 0.21).toFixed(1) + '%',
    };
  }
  return { DEFAULT_BRIGHTNESS, normalizeBrightness, brightnessVariables };
});
