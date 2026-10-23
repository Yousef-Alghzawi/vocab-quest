(function (root) {
  // With transform-origin 0 0, translate(tx%, ty%) scale(s) moves point p% to tx + p * s.
  // We want the point in the middle (50%) but never a gap at the picture edges.
  function cameraFor(x, y, scale) {
    if (scale <= 1) return { tx: 0, ty: 0 };
    const clamp = (v) => Math.min(0, Math.max(100 - 100 * scale, v));
    return { tx: clamp(50 - x * scale) + 0, ty: clamp(50 - y * scale) + 0 };
  }

  // Aim for the symbol to fill about 35% of the view width.
  function zoomFor(r) {
    return Math.min(2, Math.max(1.2, 35 / (2 * r)));
  }

  function transformFor(x, y, scale) {
    if (scale <= 1) return '';
    const c = cameraFor(x, y, scale);
    return 'translate(' + c.tx + '%,' + c.ty + '%) scale(' + scale + ')';
  }

  // Voice for reading a story aloud when its narration clip is missing.
  function pickVoice(voices) {
    const list = voices || [];
    return list.find((v) => /^en[-_]GB/i.test(v.lang)) || list.find((v) => /^en/i.test(v.lang)) || null;
  }

  const api = { cameraFor, zoomFor, transformFor, pickVoice };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.StageCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
