/* BitSkull — shared helpers */
(function () {
  'use strict';
  const BS = (window.BS = window.BS || {});

  BS.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  BS.lerp = (a, b, t) => a + (b - a) * t;
  BS.fract = (x) => x - Math.floor(x);

  BS.hexToRgb = (h) => {
    h = String(h || '#000').replace('#', '').trim();
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h.slice(0, 6), 16) || 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  BS.rgbToHex = (r, g, b) =>
    '#' + [r, g, b].map((v) => Math.round(BS.clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
  BS.luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  BS.hexLuma = (h) => { const c = BS.hexToRgb(h); return BS.luma(c[0], c[1], c[2]) / 255; };

  BS.hslToHex = (h, s, l) => {
    h = ((h % 360) + 360) % 360; s = BS.clamp(s, 0, 1); l = BS.clamp(l, 0, 1);
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return BS.rgbToHex(f(0) * 255, f(8) * 255, f(4) * 255);
  };

  // Seeded PRNG
  BS.mulberry32 = (a) => function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // Deterministic 2D hash -> [0,1)
  BS.hash2 = (x, y, s) => {
    let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };

  BS.ease = {
    linear: (t) => t,
    in: (t) => t * t * t,
    out: (t) => 1 - Math.pow(1 - t, 3),
    inout: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    sine: (t) => 0.5 - 0.5 * Math.cos(Math.PI * t),
    hold: (t) => (t < 1 ? 0 : 1),
  };
  BS.EASES = [['linear', 'Linear'], ['in', 'Ease in'], ['out', 'Ease out'], ['inout', 'Ease in-out'], ['sine', 'Sine'], ['hold', 'Hold / step']];

  // sRGB (0..1) -> OKLab
  BS.toOklab = (r, g, b) => {
    const lin = (c) => { c = c < 0 ? 0 : c > 1 ? 1 : c; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    r = lin(r); g = lin(g); b = lin(b);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
  };

  BS.uid = () => Math.random().toString(36).slice(2, 9);
  BS.clone = (o) => JSON.parse(JSON.stringify(o));

  BS.isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);
  // Deep merge (arrays replaced)
  BS.merge = (target, src) => {
    if (!BS.isObj(src)) return target;
    for (const k of Object.keys(src)) {
      if (BS.isObj(src[k]) && BS.isObj(target[k])) BS.merge(target[k], src[k]);
      else target[k] = BS.isObj(src[k]) || Array.isArray(src[k]) ? BS.clone(src[k]) : src[k];
    }
    return target;
  };

  // CRC32
  const CRC = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; }
  BS.crc32 = (bytes, crc) => {
    let c = crc === undefined ? 0xffffffff : crc;
    for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };

  BS.download = (blob, name) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  };
  BS.canvasBlob = (c, type, q) => new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Encoding failed: ' + type))), type, q));
  BS.tick = () => new Promise((r) => setTimeout(r, 0));
  BS.fmtBytes = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
  BS.fmtTime = (t) => { t = Math.max(0, t || 0); const m = Math.floor(t / 60); const s = t - m * 60; return String(m).padStart(2, '0') + ':' + s.toFixed(2).padStart(5, '0'); };
  BS.store = {
    get(k, d) { try { const v = localStorage.getItem('bitskull.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('bitskull.' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
  };

  // Separable box blur on a Float32 channel (in place). r = radius in px (int)
  BS.boxBlur = (a, w, h, r, passes) => {
    r = Math.round(r);
    if (r < 1) return a;
    passes = passes || 2;
    const tmp = new Float32Array(Math.max(w, h));
    for (let p = 0; p < passes; p++) {
      for (let y = 0; y < h; y++) {
        const o = y * w; let s = 0; const d = 2 * r + 1;
        for (let x = -r; x <= r; x++) s += a[o + BS.clamp(x, 0, w - 1)];
        for (let x = 0; x < w; x++) {
          tmp[x] = s / d;
          s += a[o + Math.min(w - 1, x + r + 1)] - a[o + Math.max(0, x - r)];
        }
        for (let x = 0; x < w; x++) a[o + x] = tmp[x];
      }
      for (let x = 0; x < w; x++) {
        let s = 0; const d = 2 * r + 1;
        for (let y = -r; y <= r; y++) s += a[BS.clamp(y, 0, h - 1) * w + x];
        for (let y = 0; y < h; y++) {
          tmp[y] = s / d;
          s += a[Math.min(h - 1, y + r + 1) * w + x] - a[Math.max(0, y - r) * w + x];
        }
        for (let y = 0; y < h; y++) a[y * w + x] = tmp[y];
      }
    }
    return a;
  };
})();
