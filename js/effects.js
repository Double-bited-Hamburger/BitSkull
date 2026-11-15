/* BitSkull — adjustments, pre-dither effects (incl. Temporal Variation) and post effects */
(function () {
  'use strict';
  const BS = window.BS;
  const { clamp, hash2, fract, mulberry32 } = BS;

  // ---------------- Adjustments ----------------
  BS.ADJUST = [
    { k: 'exposure', l: 'Exposure', min: -3, max: 3, step: 0.01, d: 0 },
    { k: 'brightness', l: 'Brightness', min: -1, max: 1, step: 0.01, d: 0 },
    { k: 'contrast', l: 'Contrast', min: -1, max: 1, step: 0.01, d: 0 },
    { k: 'gamma', l: 'Gamma', min: 0.2, max: 3, step: 0.01, d: 1 },
    { k: 'saturation', l: 'Saturation', min: -1, max: 1, step: 0.01, d: 0 },
    { k: 'hue', l: 'Hue shift', min: -180, max: 180, step: 1, d: 0 },
    { k: 'temperature', l: 'Temperature', min: -1, max: 1, step: 0.01, d: 0 },
    { k: 'shadows', l: 'Shadows', min: -1, max: 1, step: 0.01, d: 0 },
    { k: 'midtones', l: 'Midtones', min: -1, max: 1, step: 0.01, d: 0 },
    { k: 'highlights', l: 'Highlights', min: -1, max: 1, step: 0.01, d: 0 },
    { k: 'blackPoint', l: 'Black point', min: 0, max: 0.95, step: 0.01, d: 0 },
    { k: 'whitePoint', l: 'White point', min: 0.05, max: 1, step: 0.01, d: 1 },
    { k: 'blur', l: 'Blur', min: 0, max: 20, step: 0.5, d: 0, size: true },
    { k: 'sharpen', l: 'Sharpen', min: 0, max: 4, step: 0.05, d: 0 },
    { k: 'noise', l: 'Noise', min: 0, max: 1, step: 0.01, d: 0 },
    { k: 'invert', l: 'Invert image', type: 'bool', d: false },
  ];
  BS.defaultAdjust = () => Object.fromEntries(BS.ADJUST.map((a) => [a.k, a.d]));

  BS.applyAdjust = function (ctx, A) {
    const { r, g, b, w, h } = ctx; const n = r.length; const k = ctx.k || 1;
    const exp = Math.pow(2, A.exposure || 0), br = (A.brightness || 0) * 0.5, con = A.contrast || 0;
    const cf = con >= 0 ? 1 + con * 3 : 1 + con;
    const gam = 1 / Math.max(0.05, A.gamma || 1), sat = 1 + (A.saturation || 0);
    const bp = A.blackPoint || 0, wp = Math.max(bp + 0.01, A.whitePoint == null ? 1 : A.whitePoint);
    const sh = A.shadows || 0, hi = A.highlights || 0, midG = Math.pow(2, -(A.midtones || 0));
    const tmp = A.temperature || 0, inv = !!A.invert;
    const hue = ((A.hue || 0) * Math.PI) / 180, cA = Math.cos(hue), sA = Math.sin(hue);
    const m = [0.213 + cA * 0.787 - sA * 0.213, 0.715 - 0.715 * cA - 0.715 * sA, 0.072 - 0.072 * cA + 0.928 * sA,
      0.213 - 0.213 * cA + 0.143 * sA, 0.715 + 0.285 * cA + 0.14 * sA, 0.072 - 0.072 * cA - 0.283 * sA,
      0.213 - 0.213 * cA - 0.787 * sA, 0.715 - 0.715 * cA + 0.715 * sA, 0.072 + 0.928 * cA + 0.072 * sA];
    const doHue = Math.abs(hue) > 1e-4;
    for (let i = 0; i < n; i++) {
      let R = r[i] * exp, G = g[i] * exp, B = b[i] * exp;
      if (tmp) { R += tmp * 0.12; B -= tmp * 0.12; }
      if (doHue) { const r0 = R, g0 = G, b0 = B; R = m[0] * r0 + m[1] * g0 + m[2] * b0; G = m[3] * r0 + m[4] * g0 + m[5] * b0; B = m[6] * r0 + m[7] * g0 + m[8] * b0; }
      R = (R - bp) / (wp - bp); G = (G - bp) / (wp - bp); B = (B - bp) / (wp - bp);
      R += br; G += br; B += br;
      R = (R - 0.5) * cf + 0.5; G = (G - 0.5) * cf + 0.5; B = (B - 0.5) * cf + 0.5;
      if (sat !== 1) { const l = 0.2126 * R + 0.7152 * G + 0.0722 * B; R = l + (R - l) * sat; G = l + (G - l) * sat; B = l + (B - l) * sat; }
      if (sh || hi) {
        const l = clamp(0.2126 * R + 0.7152 * G + 0.0722 * B, 0, 1);
        const dl = sh * (1 - l) * (1 - l) * 0.6 + hi * l * l * 0.6; R += dl; G += dl; B += dl;
      }
      R = R < 0 ? 0 : R > 1 ? 1 : R; G = G < 0 ? 0 : G > 1 ? 1 : G; B = B < 0 ? 0 : B > 1 ? 1 : B;
      if (midG !== 1) { R = Math.pow(R, midG); G = Math.pow(G, midG); B = Math.pow(B, midG); }
      if (gam !== 1) { R = Math.pow(R, gam); G = Math.pow(G, gam); B = Math.pow(B, gam); }
      if (inv) { R = 1 - R; G = 1 - G; B = 1 - B; }
      r[i] = R; g[i] = G; b[i] = B;
    }
    if (A.blur > 0) { const rad = A.blur * k; for (const c of [r, g, b]) BS.boxBlur(c, w, h, rad, 3); }
    if (A.sharpen > 0) sharpenCh(ctx, A.sharpen, Math.max(1, Math.round(k)));
    if (A.noise > 0) { const s = ctx.seed | 0; for (let i = 0; i < n; i++) { const v = (hash2(i % w, (i / w) | 0, s + 101) - 0.5) * A.noise; r[i] += v; g[i] += v; b[i] += v; } }
  };
  function sharpenCh(ctx, amt, rad) {
    const { w, h } = ctx;
    for (const key of ['r', 'g', 'b']) {
      const a = ctx[key]; const bl = Float32Array.from(a); BS.boxBlur(bl, w, h, rad, 1);
      for (let i = 0; i < a.length; i++) a[i] = a[i] + (a[i] - bl[i]) * amt;
    }
  }

  // ---------------- Pre effects (grid resolution, before dithering) ----------------
  const TV = [['static', 'Static noise'], ['roll', 'Rolling bar'], ['scan', 'Moving scanlines'], ['flicker', 'Flicker'], ['wobble', 'Wobble'], ['interlace', 'Interlace'], ['blocks', 'Block noise'], ['ripple', 'Ripple'], ['boil', 'Boil (dither shimmer)']];
  BS.PRE = {
    temporal: {
      name: 'Temporal Variation', anim: true,
      params: [{ k: 'pattern', l: 'Pattern', type: 'select', opts: TV, d: 'boil' }, { k: 'amount', l: 'Amount', min: 0, max: 1, step: 0.01, d: 0.3 }, { k: 'speed', l: 'Speed', min: 0, max: 4, step: 0.05, d: 1 }, { k: 'scale', l: 'Scale', min: 0.2, max: 8, step: 0.1, d: 1, size: true }],
      run(ctx, p) {
        const { w, h, r, g, b } = ctx; const t = (ctx.time || 0) * p.speed; const f = Math.floor(t * 24); const a = p.amount; const sc = Math.max(0.1, p.scale);
        if (p.pattern === 'wobble') {
          const map = new Int32Array(w * h);
          for (let y = 0; y < h; y++) { const off = Math.round(Math.sin(y / (12 * sc) + t * 6) * a * w * 0.03); for (let x = 0; x < w; x++) map[y * w + x] = y * w + clamp(x - off, 0, w - 1); }
          BS.remap(ctx, map); return;
        }
        if (p.pattern === 'boil') ctx.seed = (ctx.seed | 0) + f * 31;
        if (p.pattern === 'boil') ctx.frameSeed = f;
        const fl = (hash2(f, 3, 7) - 0.5) * a;
        const bandY = fract(t * 0.35) * h;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const i = y * w + x; let dv = 0;
          switch (p.pattern) {
            case 'static': dv = (hash2(x, y, f) - 0.5) * a; break;
            case 'roll': dv = Math.exp(-(((y - bandY) / (h * 0.07 * sc)) ** 2)) * a - a * 0.1; break;
            case 'scan': dv = Math.sin((y / (3 * sc) - t * 8) * Math.PI) * 0.5 * a; break;
            case 'flicker': dv = fl; break;
            case 'interlace': dv = ((y + f) & 1 ? 0.5 : -0.5) * a; break;
            case 'blocks': { const bs = 8 * sc; const bx = Math.floor(x / bs), by = Math.floor(y / bs); dv = hash2(bx, by, f + 5) > 0.82 ? (hash2(bx, by, f) - 0.5) * 2 * a : 0; break; }
            case 'ripple': { const d = Math.hypot(x - w / 2, y - h / 2); dv = Math.sin(d / (6 * sc) - t * 6) * 0.5 * a; break; }
            case 'boil': dv = (hash2(x, y, f) - 0.5) * a * 0.25; break;
          }
          r[i] += dv; g[i] += dv; b[i] += dv;
        }
      },
    },
    noise: { name: 'Noise', params: [{ k: 'amount', l: 'Amount', min: 0, max: 1, step: 0.01, d: 0.2 }, { k: 'color', l: 'Colour noise', type: 'bool', d: false }, { k: 'animate', l: 'Animate', type: 'bool', d: true }],
      run(ctx, p) { const { w, r, g, b } = ctx; const f = p.animate ? Math.floor((ctx.time || 0) * 24) : 0; for (let i = 0; i < r.length; i++) { const x = i % w, y = (i / w) | 0; const v = (hash2(x, y, f + 11) - 0.5) * p.amount; if (p.color) { r[i] += v; g[i] += (hash2(x, y, f + 12) - 0.5) * p.amount; b[i] += (hash2(x, y, f + 13) - 0.5) * p.amount; } else { r[i] += v; g[i] += v; b[i] += v; } } } },
    blur: { name: 'Blur', params: [{ k: 'radius', l: 'Radius', min: 0, max: 30, step: 0.5, d: 2, size: true }], run(ctx, p) { for (const c of [ctx.r, ctx.g, ctx.b]) BS.boxBlur(c, ctx.w, ctx.h, p.radius, 3); } },
    sharpen: { name: 'Sharpen', params: [{ k: 'amount', l: 'Amount', min: 0, max: 5, step: 0.05, d: 1 }, { k: 'radius', l: 'Radius', min: 1, max: 8, step: 1, d: 1, size: true }], run(ctx, p) { sharpenCh(ctx, p.amount, Math.max(1, Math.round(p.radius))); } },
    wave: { name: 'Wave', anim: true, params: [{ k: 'amp', l: 'Amplitude', min: 0, max: 1, step: 0.01, d: 0.1 }, { k: 'freq', l: 'Frequency', min: 0.5, max: 60, step: 0.5, d: 5 }, { k: 'speed', l: 'Speed', min: 0, max: 4, step: 0.05, d: 0.5 }], run(ctx, p) { BS.DIST.wave(ctx, p); } },
    rowshift: { name: 'Row Shift', params: [{ k: 'amount', l: 'Shift', min: 0, max: 1, step: 0.01, d: 0.1 }, { k: 'prob', l: 'Probability', min: 0, max: 1, step: 0.01, d: 0.15 }, { k: 'height', l: 'Row height', min: 1, max: 40, step: 1, d: 3, size: true }, { k: 'seed', l: 'Seed', min: 1, max: 999, step: 1, d: 3 }, { k: 'animate', l: 'Animate', type: 'bool', d: false }],
      run(ctx, p) { BS.DIST.rowshift(ctx, p, mulberry32(p.seed * 99 + (p.animate ? Math.floor((ctx.time || 0) * 12) : 0))); } },
    pixelsort: { name: 'Pixel Sort', params: [{ k: 'low', l: 'Low threshold', min: 0, max: 1, step: 0.01, d: 0.3 }, { k: 'high', l: 'High threshold', min: 0, max: 1, step: 0.01, d: 0.9 }, { k: 'dir', l: 'Direction', type: 'select', opts: [['h', 'Horizontal'], ['v', 'Vertical']], d: 'v' }, { k: 'reverse', l: 'Reverse', type: 'bool', d: false }],
      run(ctx, p) { BS.DIST.pixelsort(ctx, p); } },
    rgbshift: { name: 'RGB Shift', params: [{ k: 'amount', l: 'Horizontal', min: -1, max: 1, step: 0.01, d: 0.15 }, { k: 'vert', l: 'Vertical', min: -1, max: 1, step: 0.01, d: 0 }], run(ctx, p) { BS.DIST.rgbsplit(ctx, p); } },
    slices: { name: 'Slice Glitch', params: [{ k: 'amount', l: 'Shift', min: 0, max: 1, step: 0.01, d: 0.05 }, { k: 'maxh', l: 'Slice height', min: 0.01, max: 1, step: 0.01, d: 0.25 }, { k: 'seed', l: 'Seed', min: 1, max: 999, step: 1, d: 5 }, { k: 'animate', l: 'Animate', type: 'bool', d: false }],
      run(ctx, p) { BS.DIST.slices(ctx, p, mulberry32(p.seed * 7 + (p.animate ? Math.floor((ctx.time || 0) * 12) : 0))); } },
    mirror: { name: 'Mirror', params: [{ k: 'mode', l: 'Mode', type: 'select', opts: [['lr', 'Left → right'], ['rl', 'Right → left'], ['tb', 'Top → bottom'], ['bt', 'Bottom → top'], ['quad', 'Quad']], d: 'lr' }],
      run(ctx, p) {
        const { w, h } = ctx; const map = new Int32Array(w * h);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          let sx = x, sy = y;
          if ((p.mode === 'lr' || p.mode === 'quad') && x >= w / 2) sx = w - 1 - x;
          if (p.mode === 'rl' && x < w / 2) sx = w - 1 - x;
          if ((p.mode === 'tb' || p.mode === 'quad') && y >= h / 2) sy = h - 1 - y;
          if (p.mode === 'bt' && y < h / 2) sy = h - 1 - y;
          map[y * w + x] = sy * w + sx;
        }
        BS.remap(ctx, map);
      } },
    posterize: { name: 'Posterize', params: [{ k: 'levels', l: 'Levels', min: 2, max: 16, step: 1, d: 4 }], run(ctx, p) { const l = p.levels - 1; for (const c of [ctx.r, ctx.g, ctx.b]) for (let i = 0; i < c.length; i++) c[i] = Math.round(clamp(c[i], 0, 1) * l) / l; } },
    vignette: { name: 'Vignette (dithered)', params: [{ k: 'amount', l: 'Amount', min: -1, max: 1, step: 0.01, d: 0.5 }, { k: 'size', l: 'Size', min: 0.1, max: 1.5, step: 0.01, d: 0.75 }],
      run(ctx, p) { const { w, h } = ctx; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const dx = (x / w - 0.5) * 2, dy = (y / h - 0.5) * 2; const d = Math.sqrt(dx * dx + dy * dy) / Math.SQRT2; const v = clamp((d - p.size * 0.5) / (1 - p.size * 0.5 + 1e-3), 0, 1) * p.amount; const i = y * w + x; ctx.r[i] -= v; ctx.g[i] -= v; ctx.b[i] -= v; } } },
    edges: { name: 'Edge Boost', params: [{ k: 'amount', l: 'Amount', min: 0, max: 3, step: 0.05, d: 1 }],
      run(ctx, p) { const { w, h } = ctx; const L = BS.computeL(ctx).slice(); for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; const e = 4 * L[i] - L[i - 1] - L[i + 1] - L[i - w] - L[i + w]; ctx.r[i] += e * p.amount; ctx.g[i] += e * p.amount; ctx.b[i] += e * p.amount; } } },
    gradient: { name: 'Gradient Overlay', params: [{ k: 'angle', l: 'Angle', min: 0, max: 360, step: 1, d: 90 }, { k: 'amount', l: 'Amount', min: -1, max: 1, step: 0.01, d: 0.4 }],
      run(ctx, p) { const { w, h } = ctx; const a = (p.angle * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const t = ((x / w - 0.5) * c + (y / h - 0.5) * s) * p.amount; const i = y * w + x; ctx.r[i] += t; ctx.g[i] += t; ctx.b[i] += t; } } },
  };

  // ---------------- Post effects (output resolution, after dithering) ----------------
  function toF(data, n) { const r = new Float32Array(n), g = new Float32Array(n), b = new Float32Array(n); for (let i = 0; i < n; i++) { r[i] = data[i * 4]; g[i] = data[i * 4 + 1]; b[i] = data[i * 4 + 2]; } return [r, g, b]; }
  BS.POST = {
    bloom: { name: 'Glow', params: [{ k: 'threshold', l: 'Threshold', min: 0, max: 1, step: 0.01, d: 0.55 }, { k: 'radius', l: 'Radius', min: 1, max: 80, step: 0.5, d: 14 }, { k: 'intensity', l: 'Intensity', min: 0, max: 4, step: 0.01, d: 1.2 }, { k: 'tint', l: 'Tint', type: 'color', d: '#ffffff' }],
      run(d, W, H, p, info) {
        const u = info.unit; const ds = Math.max(1, Math.round((p.radius * u) / 6)); const w = Math.ceil(W / ds), h = Math.ceil(H / ds);
        const br = [new Float32Array(w * h), new Float32Array(w * h), new Float32Array(w * h)]; const cnt = new Float32Array(w * h);
        const th = p.threshold * 255;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const o = (y * W + x) * 4; const l = 0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2]; const j = ((y / ds) | 0) * w + ((x / ds) | 0); cnt[j]++;
          if (l > th) { const f = (l - th) / (255 - th + 1); br[0][j] += d[o] * f; br[1][j] += d[o + 1] * f; br[2][j] += d[o + 2] * f; }
        }
        for (let j = 0; j < w * h; j++) if (cnt[j]) { br[0][j] /= cnt[j]; br[1][j] /= cnt[j]; br[2][j] /= cnt[j]; }
        const rad = Math.max(1, (p.radius * u) / ds); for (const c of br) BS.boxBlur(c, w, h, rad, 3);
        const tint = BS.hexToRgb(p.tint).map((v) => v / 255);
        for (let y = 0; y < H; y++) {
          const fy = clamp(y / ds - 0.5, 0, h - 1), y0 = fy | 0, y1 = Math.min(h - 1, y0 + 1), ty = fy - y0;
          for (let x = 0; x < W; x++) {
            const fx = clamp(x / ds - 0.5, 0, w - 1), x0 = fx | 0, x1 = Math.min(w - 1, x0 + 1), tx = fx - x0; const o = (y * W + x) * 4;
            for (let c = 0; c < 3; c++) {
              const a = br[c]; const v = (a[y0 * w + x0] * (1 - tx) + a[y0 * w + x1] * tx) * (1 - ty) + (a[y1 * w + x0] * (1 - tx) + a[y1 * w + x1] * tx) * ty;
              const s = v * p.intensity * tint[c]; d[o + c] = 255 - ((255 - d[o + c]) * (255 - Math.min(255, s))) / 255;
            }
          }
        }
      } },
    chroma: { name: 'Chromatic Aberration', params: [{ k: 'amount', l: 'Amount', min: 0, max: 40, step: 0.1, d: 4 }, { k: 'radial', l: 'Radial', type: 'bool', d: true }, { k: 'angle', l: 'Angle (linear)', min: 0, max: 360, step: 1, d: 0 }],
      run(d, W, H, p, info) {
        const src = d.slice(); const amt = p.amount * info.unit; const a = (p.angle * Math.PI) / 180; const cx = W / 2, cy = H / 2, rr = Math.hypot(cx, cy);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          let dx, dy;
          if (p.radial) { dx = ((x - cx) / rr) * amt; dy = ((y - cy) / rr) * amt; } else { dx = Math.cos(a) * amt; dy = Math.sin(a) * amt; }
          const o = (y * W + x) * 4;
          const rx = clamp(Math.round(x - dx), 0, W - 1), ry = clamp(Math.round(y - dy), 0, H - 1);
          const bx = clamp(Math.round(x + dx), 0, W - 1), by = clamp(Math.round(y + dy), 0, H - 1);
          d[o] = src[(ry * W + rx) * 4]; d[o + 2] = src[(by * W + bx) * 4 + 2];
        }
      } },
    jpeg: { name: 'JPEG Glitch', params: [{ k: 'quality', l: 'Quality', min: 1, max: 100, step: 1, d: 20 }, { k: 'glitch', l: 'Corruption', min: 0, max: 1, step: 0.01, d: 0.12 }, { k: 'block', l: 'Block scale', min: 1, max: 8, step: 1, d: 1 }, { k: 'seed', l: 'Seed', min: 1, max: 999, step: 1, d: 4 }, { k: 'animate', l: 'Animate', type: 'bool', d: false }],
      run(d, W, H, p, info) { jpegGlitch(d, W, H, p, info); } },
    blur: { name: 'Blur', params: [{ k: 'radius', l: 'Radius', min: 0, max: 30, step: 0.25, d: 1.5 }],
      run(d, W, H, p, info) { const n = W * H; const ch = toF(d, n); const r = p.radius * info.unit; for (const c of ch) BS.boxBlur(c, W, H, r, 3); for (let i = 0; i < n; i++) { d[i * 4] = ch[0][i]; d[i * 4 + 1] = ch[1][i]; d[i * 4 + 2] = ch[2][i]; } } },
    sharpen: { name: 'Sharpen', params: [{ k: 'amount', l: 'Amount', min: 0, max: 4, step: 0.05, d: 0.8 }],
      run(d, W, H, p, info) { const n = W * H; const ch = toF(d, n); const r = Math.max(1, info.unit); for (let c = 0; c < 3; c++) { const bl = Float32Array.from(ch[c]); BS.boxBlur(bl, W, H, r, 1); for (let i = 0; i < n; i++) d[i * 4 + c] = ch[c][i] + (ch[c][i] - bl[i]) * p.amount; } } },
    scanlines: { name: 'Scanlines', params: [{ k: 'period', l: 'Spacing', min: 1, max: 40, step: 0.5, d: 4 }, { k: 'dark', l: 'Darkness', min: 0, max: 1, step: 0.01, d: 0.45 }, { k: 'thick', l: 'Thickness', min: 0.05, max: 0.95, step: 0.01, d: 0.4 }, { k: 'speed', l: 'Scroll speed', min: 0, max: 4, step: 0.05, d: 0 }],
      run(d, W, H, p, info) { const per = Math.max(1, p.period * info.unit); const off = (info.time || 0) * p.speed * per * 4; for (let y = 0; y < H; y++) { if (fract((y + off) / per) >= p.thick) continue; const m = 1 - p.dark; for (let x = 0; x < W; x++) { const o = (y * W + x) * 4; d[o] *= m; d[o + 1] *= m; d[o + 2] *= m; } } } },
    crt: { name: 'CRT Screen', params: [{ k: 'curve', l: 'Curvature', min: 0, max: 0.5, step: 0.01, d: 0.12 }, { k: 'mask', l: 'Aperture mask', min: 0, max: 1, step: 0.01, d: 0.35 }, { k: 'scan', l: 'Scanlines', min: 0, max: 1, step: 0.01, d: 0.3 }, { k: 'vig', l: 'Vignette', min: 0, max: 1, step: 0.01, d: 0.4 }],
      run(d, W, H, p, info) {
        const src = d.slice(); const u = Math.max(1, info.unit * 1.5);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          let nx = (x / W) * 2 - 1, ny = (y / H) * 2 - 1; const r2 = nx * nx + ny * ny;
          nx *= 1 + p.curve * r2 * 0.5; ny *= 1 + p.curve * r2 * 0.5;
          const o = (y * W + x) * 4;
          if (Math.abs(nx) > 1 || Math.abs(ny) > 1) { d[o] = d[o + 1] = d[o + 2] = 0; continue; }
          const sx = Math.round(((nx + 1) / 2) * (W - 1)), sy = Math.round(((ny + 1) / 2) * (H - 1)); const so = (sy * W + sx) * 4;
          const sub = Math.floor(x / u) % 3; const sl = 1 - p.scan * (0.5 + 0.5 * Math.cos((y / u) * Math.PI));
          const vg = 1 - p.vig * Math.pow(Math.max(Math.abs(nx), Math.abs(ny)), 4);
          for (let c = 0; c < 3; c++) d[o + c] = src[so + c] * (c === sub ? 1 : 1 - p.mask) * sl * vg;
        }
      } },
    vignette: { name: 'Vignette', params: [{ k: 'amount', l: 'Amount', min: 0, max: 1, step: 0.01, d: 0.5 }, { k: 'size', l: 'Size', min: 0.1, max: 1.5, step: 0.01, d: 0.8 }, { k: 'soft', l: 'Softness', min: 0.05, max: 1, step: 0.01, d: 0.5 }],
      run(d, W, H, p) { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const dx = (x / W - 0.5) * 2, dy = (y / H - 0.5) * 2; const dist = Math.sqrt(dx * dx + dy * dy) / Math.SQRT2; const t = clamp((dist - p.size * 0.6) / p.soft, 0, 1); const m = 1 - t * t * p.amount; const o = (y * W + x) * 4; d[o] *= m; d[o + 1] *= m; d[o + 2] *= m; } } },
    grain: { name: 'Film Grain', params: [{ k: 'amount', l: 'Amount', min: 0, max: 1, step: 0.01, d: 0.15 }, { k: 'size', l: 'Size', min: 1, max: 8, step: 0.5, d: 1 }, { k: 'color', l: 'Colour grain', type: 'bool', d: false }, { k: 'animate', l: 'Animate', type: 'bool', d: true }],
      run(d, W, H, p, info) { const f = p.animate ? info.frame || 0 : 0; const s = Math.max(1, p.size * info.unit * 0.5); const a = p.amount * 255; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const gx = (x / s) | 0, gy = (y / s) | 0; const o = (y * W + x) * 4; const v = (hash2(gx, gy, f + 1) - 0.5) * a; if (p.color) { d[o] += v; d[o + 1] += (hash2(gx, gy, f + 2) - 0.5) * a; d[o + 2] += (hash2(gx, gy, f + 3) - 0.5) * a; } else { d[o] += v; d[o + 1] += v; d[o + 2] += v; } } } },
    tint: { name: 'Tint', params: [{ k: 'color', l: 'Colour', type: 'color', d: '#ff3d7f' }, { k: 'mode', l: 'Blend', type: 'select', opts: [['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'], ['color', 'Colour (hue)'], ['normal', 'Normal']], d: 'overlay' }, { k: 'amount', l: 'Amount', min: 0, max: 1, step: 0.01, d: 0.5 }],
      run(d, W, H, p) {
        const t = BS.hexToRgb(p.color); const a = p.amount; const tl = BS.luma(t[0], t[1], t[2]) || 1;
        for (let i = 0, n = W * H; i < n; i++) {
          const o = i * 4; const l = BS.luma(d[o], d[o + 1], d[o + 2]);
          for (let c = 0; c < 3; c++) {
            const s = d[o + c] / 255, tc = t[c] / 255; let v;
            if (p.mode === 'multiply') v = s * tc; else if (p.mode === 'screen') v = 1 - (1 - s) * (1 - tc);
            else if (p.mode === 'overlay') v = s < 0.5 ? 2 * s * tc : 1 - 2 * (1 - s) * (1 - tc);
            else if (p.mode === 'color') v = (tc * l) / tl; else v = tc;
            d[o + c] = (s + (v - s) * a) * 255;
          }
        }
      } },
    rgbsplit: { name: 'RGB Split', params: [{ k: 'x', l: 'Offset X', min: -40, max: 40, step: 0.5, d: 4 }, { k: 'y', l: 'Offset Y', min: -40, max: 40, step: 0.5, d: 0 }],
      run(d, W, H, p, info) { const src = d.slice(); const ox = Math.round(p.x * info.unit), oy = Math.round(p.y * info.unit); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = (y * W + x) * 4; d[o] = src[(clamp(y - oy, 0, H - 1) * W + clamp(x - ox, 0, W - 1)) * 4]; d[o + 2] = src[(clamp(y + oy, 0, H - 1) * W + clamp(x + ox, 0, W - 1)) * 4 + 2]; } } },
    glitchbands: { name: 'Glitch Bands', params: [{ k: 'count', l: 'Bands', min: 1, max: 40, step: 1, d: 6 }, { k: 'shift', l: 'Shift', min: 0, max: 200, step: 1, d: 40 }, { k: 'height', l: 'Max height', min: 1, max: 200, step: 1, d: 30 }, { k: 'seed', l: 'Seed', min: 1, max: 999, step: 1, d: 9 }, { k: 'animate', l: 'Animate', type: 'bool', d: true }],
      run(d, W, H, p, info) {
        const rnd = mulberry32(p.seed * 17 + (p.animate ? Math.floor((info.time || 0) * 10) : 0)); const row = new Uint8ClampedArray(W * 4);
        for (let k = 0; k < p.count; k++) {
          const y0 = Math.floor(rnd() * H), hh = Math.max(1, Math.round(rnd() * p.height * info.unit)); const off = Math.round((rnd() - 0.5) * 2 * p.shift * info.unit);
          for (let y = y0; y < Math.min(H, y0 + hh); y++) { const o = y * W * 4; row.set(d.subarray(o, o + W * 4)); for (let x = 0; x < W; x++) { const sx = (((x - off) % W) + W) % W; d[o + x * 4] = row[sx * 4]; d[o + x * 4 + 1] = row[sx * 4 + 1]; d[o + x * 4 + 2] = row[sx * 4 + 2]; } }
        }
      } },
    invert: { name: 'Invert', params: [{ k: 'amount', l: 'Amount', min: 0, max: 1, step: 0.01, d: 1 }], run(d, W, H, p) { for (let i = 0, n = W * H * 4; i < n; i += 4) for (let c = 0; c < 3; c++) d[i + c] = d[i + c] + (255 - 2 * d[i + c]) * p.amount; } },
  };

  // JPEG-style 8x8 DCT quantisation with block corruption
  const COS = new Float32Array(64); for (let x = 0; x < 8; x++) for (let u = 0; u < 8; u++) COS[x * 8 + u] = Math.cos(((2 * x + 1) * u * Math.PI) / 16) * (u === 0 ? Math.SQRT1_2 : 1) * 0.5;
  const QY = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
  const QC = [17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99];
  function dct8(inp, out, tmp) {
    for (let y = 0; y < 8; y++) for (let u = 0; u < 8; u++) { let s = 0; for (let x = 0; x < 8; x++) s += inp[y * 8 + x] * COS[x * 8 + u]; tmp[y * 8 + u] = s; }
    for (let u = 0; u < 8; u++) for (let v = 0; v < 8; v++) { let s = 0; for (let y = 0; y < 8; y++) s += tmp[y * 8 + u] * COS[y * 8 + v]; out[v * 8 + u] = s; }
  }
  function idct8(inp, out, tmp) {
    for (let v = 0; v < 8; v++) for (let x = 0; x < 8; x++) { let s = 0; for (let u = 0; u < 8; u++) s += inp[v * 8 + u] * COS[x * 8 + u]; tmp[v * 8 + x] = s; }
    for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) { let s = 0; for (let v = 0; v < 8; v++) s += tmp[v * 8 + x] * COS[y * 8 + v]; out[y * 8 + x] = s; }
  }
  function jpegGlitch(d, W, H, p, info) {
    const q = p.quality < 50 ? 5000 / p.quality : 200 - p.quality * 2;
    const qy = QY.map((v) => Math.max(1, Math.floor((v * q + 50) / 100))), qc = QC.map((v) => Math.max(1, Math.floor((v * q + 50) / 100)));
    const rnd = mulberry32(p.seed * 131 + (p.animate ? Math.floor((info.time || 0) * 12) : 0));
    const bs = Math.max(1, Math.round(p.block * Math.max(1, info.unit)));
    const bw = Math.ceil(W / (8 * bs)), bh = Math.ceil(H / (8 * bs));
    const blk = [new Float32Array(64), new Float32Array(64), new Float32Array(64)]; const co = new Float32Array(64), tmp = new Float32Array(64);
    const prev = [new Float32Array(64), new Float32Array(64), new Float32Array(64)];
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      for (let yy = 0; yy < 8; yy++) for (let xx = 0; xx < 8; xx++) {
        const x = Math.min(W - 1, (bx * 8 + xx) * bs), y = Math.min(H - 1, (by * 8 + yy) * bs); const o = (y * W + x) * 4;
        const R = d[o], G = d[o + 1], B = d[o + 2];
        blk[0][yy * 8 + xx] = 0.299 * R + 0.587 * G + 0.114 * B - 128;
        blk[1][yy * 8 + xx] = -0.1687 * R - 0.3313 * G + 0.5 * B;
        blk[2][yy * 8 + xx] = 0.5 * R - 0.4187 * G - 0.0813 * B;
      }
      const corrupt = rnd() < p.glitch; const kind = (rnd() * 4) | 0;
      for (let c = 0; c < 3; c++) {
        dct8(blk[c], co, tmp); const Q = c ? qc : qy;
        for (let k = 0; k < 64; k++) co[k] = Math.round(co[k] / Q[k]) * Q[k];
        if (corrupt) {
          if (kind === 0) co[0] += (rnd() - 0.5) * 600;
          else if (kind === 1) { const k = 1 + ((rnd() * 20) | 0); co[k] += (rnd() - 0.5) * 900; }
          else if (kind === 2) co.set(prev[c]);
          else if (c > 0) co[0] += (rnd() - 0.5) * 900;
        }
        prev[c].set(co);
        idct8(co, blk[c], tmp);
      }
      for (let yy = 0; yy < 8; yy++) for (let xx = 0; xx < 8; xx++) {
        const Y = blk[0][yy * 8 + xx] + 128, Cb = blk[1][yy * 8 + xx], Cr = blk[2][yy * 8 + xx];
        const R = Y + 1.402 * Cr, G = Y - 0.344136 * Cb - 0.714136 * Cr, B = Y + 1.772 * Cb;
        for (let sy = 0; sy < bs; sy++) for (let sx = 0; sx < bs; sx++) {
          const x = (bx * 8 + xx) * bs + sx, y = (by * 8 + yy) * bs + sy; if (x >= W || y >= H) continue;
          const o = (y * W + x) * 4; d[o] = R; d[o + 1] = G; d[o + 2] = B;
        }
      }
    }
  }

  // Params helper for fx (size params scaled by grid factor k)
  BS.fxParams = function (fx, reg, k) {
    const def = reg[fx.type]; const o = {};
    for (const p of def.params) { let v = fx.p && fx.p[p.k] !== undefined ? fx.p[p.k] : p.d; if (p.size && k && typeof v === 'number') v *= k; o[p.k] = v; }
    return o;
  };
  BS.newFx = function (reg, type) { const def = reg[type]; return { uid: BS.uid(), type, on: true, p: Object.fromEntries(def.params.map((p) => [p.k, p.d])) }; };
})();
