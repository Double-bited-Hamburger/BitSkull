/* BitSkull — dithering engine: quantizer, engines and 80 algorithms */
(function () {
  'use strict';
  const BS = window.BS;
  const { fract, hash2, mulberry32 } = BS;

  const ALGOS = (BS.ALGOS = []);
  const BY = (BS.ALGO = {});
  BS.ALGO_CATS = ['Error Diffusion', 'Ordered', 'Pattern', 'Halftone', 'Glitch', 'Special'];
  function add(a) { a.params = a.params || []; a.kind = a.kind || 'custom'; ALGOS.push(a); BY[a.id] = a; return a; }

  // Merge defaults + overrides; size params are scaled by k (grid scale) so previews and exports match.
  BS.algoParams = function (S, id, k) {
    const a = BY[id]; const o = {};
    if (!a) return o;
    const ov = (S.algoParams && S.algoParams[id]) || {};
    for (const p of a.params) {
      let v = ov[p.k] !== undefined ? ov[p.k] : p.d;
      if (p.size && k && typeof v === 'number') v = v * k;
      o[p.k] = v;
    }
    return o;
  };

  BS.computeL = function (ctx) {
    const { r, g, b } = ctx; const n = r.length;
    const L = ctx.L && ctx.L.length === n ? ctx.L : new Float32Array(n);
    for (let i = 0; i < n; i++) L[i] = 0.2126 * r[i] + 0.7152 * g[i] + 0.0722 * b[i];
    ctx.L = L;
    return L;
  };

  // ---------- Quantizer ----------
  BS.buildQuant = function (S) {
    const mode = S.color.mode || 'mono';
    let hex = (S.palette && S.palette.colors ? S.palette.colors : []).slice();
    if (hex.length === 0) hex = ['#000000', '#ffffff'];
    if (hex.length === 1) hex = ['#000000', hex[0]];
    let cols = hex.map((h) => BS.hexToRgb(h).map((v) => v / 255));
    if (mode === 'mono' && S.color.order !== 'custom') cols.sort((a, b) => BS.luma(a[0], a[1], a[2]) - BS.luma(b[0], b[1], b[2]));
    if (S.color.invert) cols.reverse();
    const n = cols.length;
    const c8 = cols.map((c) => [Math.round(c[0] * 255), Math.round(c[1] * 255), Math.round(c[2] * 255)]);
    const q = { mode, cols, c8, n, nm: n - 1 };
    let li = 0, di = 0;
    cols.forEach((c, i) => { const l = BS.luma(c[0], c[1], c[2]); if (l > BS.luma(...cols[li])) li = i; if (l < BS.luma(...cols[di])) di = i; });
    if (mode === 'mono') { q.inkI = 0; q.paperI = n - 1; } else { q.inkI = di; q.paperI = li; }
    q.ink = c8[q.inkI]; q.paper = c8[q.paperI];
    const lv = Math.max(2, S.color.rgbLevels | 0 || 2);
    q.rl = lv - 1;

    const useLab = S.color.metric === 'oklab';
    const plain = S.color.metric === 'rgb';
    const P = useLab ? cols.map((c) => BS.toOklab(c[0], c[1], c[2])) : cols;
    const cache = new Int16Array(262144).fill(-1);
    q.nearest = function (r, g, b) {
      r = r < 0 ? 0 : r > 1 ? 1 : r; g = g < 0 ? 0 : g > 1 ? 1 : g; b = b < 0 ? 0 : b > 1 ? 1 : b;
      const key = (((r * 63 + 0.5) | 0) << 12) | (((g * 63 + 0.5) | 0) << 6) | ((b * 63 + 0.5) | 0);
      const v = cache[key];
      if (v >= 0) return v;
      let x = r, y = g, z = b;
      if (useLab) { const o = BS.toOklab(r, g, b); x = o[0]; y = o[1]; z = o[2]; }
      let best = 0, bd = 1e9;
      for (let i = 0; i < n; i++) {
        const p = P[i]; const dx = x - p[0], dy = y - p[1], dz = z - p[2];
        const d = useLab || plain ? dx * dx + dy * dy + dz * dz : dx * dx * 0.3 + dy * dy * 0.59 + dz * dz * 0.11;
        if (d < bd) { bd = d; best = i; }
      }
      cache[key] = best;
      return best;
    };
    // average nearest-neighbour distance -> ordered dither spread for colour mode
    let s = 0;
    for (let i = 0; i < n; i++) {
      let m = 1e9;
      for (let j = 0; j < n; j++) if (i !== j) {
        const d = Math.hypot(cols[i][0] - cols[j][0], cols[i][1] - cols[j][1], cols[i][2] - cols[j][2]);
        if (d < m) m = d;
      }
      s += m;
    }
    q.spread = n > 1 ? Math.min(1, s / n) : 1;
    // colour of a pixel given mode (for "special" renderers)
    q.colorAt = function (r, g, b, L) {
      if (mode === 'mono') { let i = Math.round(L * q.nm); i = i < 0 ? 0 : i > q.nm ? q.nm : i; return c8[i]; }
      if (mode === 'palette') return c8[q.nearest(r, g, b)];
      const f = (v) => Math.round(Math.max(0, Math.min(1, v)) * q.rl) / q.rl * 255;
      return [f(r), f(g), f(b)];
    };
    return q;
  };

  function put(out, i, c) { const o = i << 2; out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255; }
  BS.putPx = put;

  // ---------- Error diffusion engine ----------
  function prepKernel(K) {
    const k = K.k; const div = K.div;
    return { n: k.length, dx: Int32Array.from(k.map((e) => e[0])), dy: Int32Array.from(k.map((e) => e[1])), w: Float32Array.from(k.map((e) => e[2] / div)) };
  }
  function diffuse(ctx, K, opt) {
    opt = opt || {};
    const { w, h, q, d } = ctx; const out = ctx.out; const mode = q.mode;
    const str = (d.strength == null ? 1 : d.strength) * (opt.gain || 1);
    const bias = (d.bias || 0) * 0.5, jit = d.jitter || 0;
    const rnd = mulberry32((ctx.seed | 0) * 7919 + 13);
    const serp = opt.serp !== undefined ? opt.serp : d.serpentine !== false;
    const kernels = (opt.kernels || [K]).map(prepKernel);
    let ker = kernels[0];
    const mono = mode === 'mono', pal = mode === 'palette';
    let Lb, R, G, B;
    if (mono) Lb = Float32Array.from(ctx.L); else { R = Float32Array.from(ctx.r); G = Float32Array.from(ctx.g); B = Float32Array.from(ctx.b); }
    const nm = q.nm, c8 = q.c8, cols = q.cols, lv = q.rl;
    const wrap = !!opt.wrap;
    const tmp = [0, 0, 0];
    for (let y = 0; y < h; y++) {
      const rev = serp && (y & 1);
      if (opt.pick) ker = kernels[opt.pick(y) % kernels.length];
      const kn = ker.n, kdx = ker.dx, kdy = ker.dy, kw = ker.w;
      for (let xi = 0; xi < w; xi++) {
        const x = rev ? w - 1 - xi : xi; const i = y * w + x;
        const jv = jit ? (rnd() - 0.5) * jit : 0;
        let er = 0, eg = 0, eb = 0;
        if (mono) {
          let v = Lb[i] + bias;
          if (wrap) v = v - Math.floor(v);
          let qi = Math.round((v + jv) * nm); qi = qi < 0 ? 0 : qi > nm ? nm : qi;
          put(out, i, c8[qi]);
          er = (v - qi / nm) * str;
        } else if (pal) {
          let r = R[i] + bias, g = G[i] + bias, b = B[i] + bias;
          if (wrap) { r -= Math.floor(r); g -= Math.floor(g); b -= Math.floor(b); }
          const qi = q.nearest(r + jv, g + jv, b + jv); const c = cols[qi];
          put(out, i, c8[qi]);
          er = (r - c[0]) * str; eg = (g - c[1]) * str; eb = (b - c[2]) * str;
        } else {
          let r = R[i] + bias, g = G[i] + bias, b = B[i] + bias;
          if (wrap) { r -= Math.floor(r); g -= Math.floor(g); b -= Math.floor(b); }
          const qr = Math.max(0, Math.min(lv, Math.round((r + jv) * lv))) / lv;
          const qg = Math.max(0, Math.min(lv, Math.round((g + jv) * lv))) / lv;
          const qb = Math.max(0, Math.min(lv, Math.round((b + jv) * lv))) / lv;
          tmp[0] = qr * 255; tmp[1] = qg * 255; tmp[2] = qb * 255; put(out, i, tmp);
          er = (r - qr) * str; eg = (g - qg) * str; eb = (b - qb) * str;
        }
        for (let k = 0; k < kn; k++) {
          const xx = x + (rev ? -kdx[k] : kdx[k]), yy = y + kdy[k];
          if (xx < 0 || xx >= w || yy >= h) continue;
          const j = yy * w + xx, wt = kw[k];
          if (mono) Lb[j] += er * wt; else { R[j] += er * wt; G[j] += eg * wt; B[j] += eb * wt; }
        }
      }
    }
  }
  BS.diffuse = diffuse;

  // ---------- Threshold (ordered) engine ----------
  function thresh(ctx, T) {
    const { w, h, q, d } = ctx; const out = ctx.out; const mode = q.mode;
    const str = d.strength == null ? 1 : d.strength, bias = (d.bias || 0) * 0.5, jit = d.jitter || 0, seed = ctx.seed | 0;
    const nm = q.nm, c8 = q.c8, sp = q.spread * str, lv = q.rl;
    const L = ctx.L, R = ctx.r, G = ctx.g, B = ctx.b;
    const tmp = [0, 0, 0];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        let t = T(x, y);
        t = 0.5 + (t - 0.5) * str;
        if (jit) t += (hash2(x, y, seed) - 0.5) * jit;
        if (mode === 'mono') {
          let qi = Math.floor((L[i] + bias) * nm + t); qi = qi < 0 ? 0 : qi > nm ? nm : qi;
          put(out, i, c8[qi]);
        } else if (mode === 'palette') {
          const o = (t - 0.5) * sp + bias;
          put(out, i, c8[q.nearest(R[i] + o, G[i] + o, B[i] + o)]);
        } else {
          tmp[0] = (Math.max(0, Math.min(lv, Math.floor((R[i] + bias) * lv + t))) / lv) * 255;
          tmp[1] = (Math.max(0, Math.min(lv, Math.floor((G[i] + bias) * lv + t))) / lv) * 255;
          tmp[2] = (Math.max(0, Math.min(lv, Math.floor((B[i] + bias) * lv + t))) / lv) * 255;
          put(out, i, tmp);
        }
      }
    }
  }
  BS.thresh = thresh;

  // ---------- Threshold maps ----------
  const MCACHE = {};
  function bayer(n) {
    const key = 'b' + n; if (MCACHE[key]) return MCACHE[key];
    let m = [0], s = 1;
    while (s < n) {
      const s2 = s * 2, nm = new Array(s2 * s2);
      for (let y = 0; y < s2; y++) for (let x = 0; x < s2; x++) {
        const base = m[(y % s) * s + (x % s)];
        nm[y * s2 + x] = 4 * base + [0, 2, 3, 1][((y >= s) << 1) | (x >= s)];
      }
      m = nm; s = s2;
    }
    return (MCACHE[key] = Float32Array.from(m, (v) => (v + 0.5) / (n * n)));
  }
  function rankMatrix(key, n, f) {
    if (MCACHE[key]) return MCACHE[key];
    const idx = []; const val = [];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { idx.push(y * n + x); val.push(f(x, y) + (y * n + x) * 1e-9); }
    idx.sort((a, b) => val[a] - val[b]);
    const m = new Float32Array(n * n);
    idx.forEach((p, r) => { m[p] = (r + 0.5) / (n * n); });
    return (MCACHE[key] = m);
  }
  let BN = null;
  function blueNoise() {
    if (BN) return BN;
    const N = 64, NN = N * N, sig = 1.5;
    const lut = new Float32Array(NN);
    for (let dy = 0; dy < N; dy++) for (let dx = 0; dx < N; dx++) {
      const a = Math.min(dx, N - dx), b = Math.min(dy, N - dy);
      lut[dy * N + dx] = Math.exp(-(a * a + b * b) / (2 * sig * sig));
    }
    const E = new Float32Array(NN), bits = new Uint8Array(NN);
    const addE = (p, s) => {
      const px = p % N, py = (p / N) | 0;
      for (let y = 0; y < N; y++) {
        const ry = ((y - py + N) % N) * N, row = y * N;
        for (let x = 0; x < N; x++) E[row + x] += s * lut[ry + ((x - px + N) % N)];
      }
    };
    const rnd = mulberry32(1337);
    const ones = Math.floor(NN * 0.1);
    let placed = 0;
    while (placed < ones) { const p = (rnd() * NN) | 0; if (!bits[p]) { bits[p] = 1; addE(p, 1); placed++; } }
    const tight = () => { let b = -1, bv = -1e9; for (let i = 0; i < NN; i++) if (bits[i] && E[i] > bv) { bv = E[i]; b = i; } return b; };
    const voidp = () => { let b = -1, bv = 1e9; for (let i = 0; i < NN; i++) if (!bits[i] && E[i] < bv) { bv = E[i]; b = i; } return b; };
    for (let it = 0; it < 3000; it++) {
      const t = tight(); bits[t] = 0; addE(t, -1);
      const v = voidp();
      bits[v] = 1; addE(v, 1);
      if (v === t) break;
    }
    const rank = new Float32Array(NN);
    const pb = bits.slice(), pe = E.slice();
    let r = ones - 1;
    while (r >= 0) { const t = tight(); bits[t] = 0; addE(t, -1); rank[t] = r--; }
    bits.set(pb); E.set(pe);
    r = ones;
    while (r < NN) { const v = voidp(); bits[v] = 1; addE(v, 1); rank[v] = r++; }
    BN = Float32Array.from(rank, (v) => (v + 0.5) / NN);
    return BN;
  }
  BS.blueNoise = blueNoise;
  BS.bayer = bayer;

  const matT = (M, n, scale) => { const s = Math.max(1, Math.round(scale || 1)); return (x, y) => M[(((y / s) | 0) % n) * n + (((x / s) | 0) % n)]; };

  // continuous rotated screen: f(u,v) with u,v in cell units
  function screenT(p, f) {
    const a = ((p.angle || 0) * Math.PI) / 180, cell = Math.max(0.5, p.cell || 6);
    const ca = Math.cos(a) / cell, sa = Math.sin(a) / cell;
    return (x, y) => { const X = x + 0.5, Y = y + 0.5; return f(X * ca + Y * sa, -X * sa + Y * ca); };
  }
  const fu = (u) => u - Math.floor(u) - 0.5;
  const SHAPES = {
    circle: (u, v) => { const a = fu(u), b = fu(v); return Math.min(1, Math.PI * (a * a + b * b)); },
    euclid: (u, v) => 1 - (Math.cos(2 * Math.PI * u) + Math.cos(2 * Math.PI * v) + 2) / 4,
    square: (u, v) => { const s = Math.max(Math.abs(fu(u)), Math.abs(fu(v))) * 2; return s * s; },
    line: (u, v) => Math.abs(fu(v)) * 2,
    diamond: (u, v) => { const s = Math.abs(fu(u)) + Math.abs(fu(v)); return Math.min(1, 2 * s * s); },
    ellipse: (u, v) => { const a = fu(u), b = fu(v) * 1.7; return Math.min(1, Math.PI * (a * a + b * b) * 0.6); },
    cross: (u, v) => Math.min(Math.abs(fu(u)), Math.abs(fu(v))) * 2,
  };
  BS.SHAPES = SHAPES;

  const P = {
    scale: { k: 'scale', l: 'Matrix scale', min: 1, max: 8, step: 1, d: 1, size: true },
    cell: (d) => ({ k: 'cell', l: 'Cell size', min: 2, max: 64, step: 0.5, d: d || 6, size: true }),
    angle: (d) => ({ k: 'angle', l: 'Angle', min: 0, max: 180, step: 1, d: d || 0 }),
  };

  // ======================= ERROR DIFFUSION =======================
  const K = {
    floyd: { div: 16, k: [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]] },
    falsefloyd: { div: 8, k: [[1, 0, 3], [0, 1, 3], [1, 1, 2]] },
    jjn: { div: 48, k: [[1, 0, 7], [2, 0, 5], [-2, 1, 3], [-1, 1, 5], [0, 1, 7], [1, 1, 5], [2, 1, 3], [-2, 2, 1], [-1, 2, 3], [0, 2, 5], [1, 2, 3], [2, 2, 1]] },
    stucki: { div: 42, k: [[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2], [-2, 2, 1], [-1, 2, 2], [0, 2, 4], [1, 2, 2], [2, 2, 1]] },
    atkinson: { div: 8, k: [[1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1]] },
    burkes: { div: 32, k: [[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2]] },
    sierra: { div: 32, k: [[1, 0, 5], [2, 0, 3], [-2, 1, 2], [-1, 1, 4], [0, 1, 5], [1, 1, 4], [2, 1, 2], [-1, 2, 2], [0, 2, 3], [1, 2, 2]] },
    sierra2: { div: 16, k: [[1, 0, 4], [2, 0, 3], [-2, 1, 1], [-1, 1, 2], [0, 1, 3], [1, 1, 2], [2, 1, 1]] },
    sierralite: { div: 4, k: [[1, 0, 2], [-1, 1, 1], [0, 1, 1]] },
    stevenson: { div: 200, k: [[2, 0, 32], [-3, 1, 12], [-1, 1, 26], [1, 1, 30], [3, 1, 16], [-2, 2, 12], [0, 2, 26], [2, 2, 12], [-3, 3, 5], [-1, 3, 12], [1, 3, 12], [3, 3, 5]] },
    fan: { div: 16, k: [[1, 0, 7], [-2, 1, 1], [-1, 1, 3], [0, 1, 5]] },
    shiaufan: { div: 8, k: [[1, 0, 4], [-2, 1, 1], [-1, 1, 1], [0, 1, 2]] },
    shiaufan2: { div: 16, k: [[1, 0, 8], [-3, 1, 1], [-2, 1, 1], [-1, 1, 2], [0, 1, 4]] },
    pigeon: { div: 14, k: [[1, 0, 2], [2, 0, 1], [-2, 1, 1], [-1, 1, 1], [0, 1, 2], [1, 1, 1], [2, 1, 1], [-2, 2, 1], [0, 2, 1], [2, 2, 1]] },
    horizontal: { div: 1, k: [[1, 0, 1]] },
    vertical: { div: 1, k: [[0, 1, 1]] },
    diagonal: { div: 2, k: [[1, 1, 1], [1, 0, 1]] },
  };
  BS.KERNELS = K;
  const ED = [
    ['floyd', 'Floyd–Steinberg'], ['falsefloyd', 'False Floyd–Steinberg'], ['jjn', 'Jarvis–Judice–Ninke'], ['stucki', 'Stucki'],
    ['atkinson', 'Atkinson'], ['burkes', 'Burkes'], ['sierra', 'Sierra'], ['sierra2', 'Two-Row Sierra'], ['sierralite', 'Sierra Lite'],
    ['stevenson', 'Stevenson–Arce'], ['fan', 'Fan'], ['shiaufan', 'Shiau–Fan'], ['shiaufan2', 'Shiau–Fan 2'], ['pigeon', 'Pigeon'],
    ['horizontal', 'Horizontal Line'], ['vertical', 'Vertical Line'], ['diagonal', 'Diagonal Drift'],
  ];
  for (const [id, name] of ED) add({ id, name, cat: 'Error Diffusion', kind: 'diffusion', run: (ctx) => diffuse(ctx, K[id]) });

  // Riemersma (Hilbert curve) dithering
  function d2xy(n, d, o) {
    let x = 0, y = 0, t = d;
    for (let s = 1; s < n; s <<= 1) {
      const rx = 1 & (t >> 1), ry = 1 & (t ^ rx);
      if (ry === 0) { if (rx === 1) { x = s - 1 - x; y = s - 1 - y; } const tt = x; x = y; y = tt; }
      x += s * rx; y += s * ry; t >>= 2;
    }
    o[0] = x; o[1] = y;
  }
  add({
    id: 'riemersma', name: 'Riemersma (Hilbert)', cat: 'Error Diffusion', kind: 'diffusion',
    params: [{ k: 'hist', l: 'History length', min: 4, max: 32, step: 1, d: 16 }, { k: 'ratio', l: 'Decay', min: 0.02, max: 0.5, step: 0.01, d: 0.0625 }],
    run(ctx, p) {
      const { w, h, q, d, out } = ctx; const mode = q.mode;
      const n = 1 << Math.ceil(Math.log2(Math.max(w, h, 2)));
      const Q = p.hist | 0; const wts = new Float32Array(Q); let ws = 0;
      for (let i = 0; i < Q; i++) { wts[i] = Math.pow(p.ratio, (Q - 1 - i) / (Q - 1)); ws += wts[i]; }
      for (let i = 0; i < Q; i++) wts[i] /= ws;
      const str = d.strength == null ? 1 : d.strength, bias = (d.bias || 0) * 0.5;
      const hr = new Float32Array(Q), hg = new Float32Array(Q), hb = new Float32Array(Q);
      let head = 0; const o = [0, 0]; const tmp = [0, 0, 0];
      const nm = q.nm, lv = q.rl;
      for (let k = 0, N = n * n; k < N; k++) {
        d2xy(n, k, o); const x = o[0], y = o[1];
        if (x >= w || y >= h) continue;
        const i = y * w + x;
        let er = 0, eg = 0, eb = 0;
        for (let j = 0; j < Q; j++) { const idx = (head + j) % Q; er += hr[idx] * wts[j]; eg += hg[idx] * wts[j]; eb += hb[idx] * wts[j]; }
        er *= str; eg *= str; eb *= str;
        let nr, ng, nb;
        if (mode === 'mono') {
          const v = ctx.L[i] + bias + er; let qi = Math.round(v * nm); qi = qi < 0 ? 0 : qi > nm ? nm : qi;
          put(out, i, q.c8[qi]); nr = v - qi / nm; ng = 0; nb = 0;
        } else if (mode === 'palette') {
          const r = ctx.r[i] + bias + er, g = ctx.g[i] + bias + eg, b = ctx.b[i] + bias + eb;
          const qi = q.nearest(r, g, b); const c = q.cols[qi]; put(out, i, q.c8[qi]);
          nr = r - c[0]; ng = g - c[1]; nb = b - c[2];
        } else {
          const r = ctx.r[i] + bias + er, g = ctx.g[i] + bias + eg, b = ctx.b[i] + bias + eb;
          const qr = Math.max(0, Math.min(lv, Math.round(r * lv))) / lv, qg = Math.max(0, Math.min(lv, Math.round(g * lv))) / lv, qb = Math.max(0, Math.min(lv, Math.round(b * lv))) / lv;
          tmp[0] = qr * 255; tmp[1] = qg * 255; tmp[2] = qb * 255; put(out, i, tmp);
          nr = r - qr; ng = g - qg; nb = b - qb;
        }
        hr[head] = nr; hg[head] = ng; hb[head] = nb; head = (head + 1) % Q;
      }
    },
  });

  // ======================= ORDERED =======================
  [2, 4, 8, 16].forEach((n) => add({ id: 'bayer' + n, name: `Bayer ${n}×${n}`, cat: 'Ordered', kind: 'threshold', params: [P.scale], run: (ctx, p) => thresh(ctx, matT(bayer(n), n, p.scale)) }));
  const clusterF = (n) => (x, y) => { const dx = x + 0.5 - n / 2, dy = y + 0.5 - n / 2; return dx * dx + dy * dy + Math.atan2(dy, dx) * 1e-3; };
  add({ id: 'cluster4', name: 'Clustered Dot 4×4', cat: 'Ordered', kind: 'threshold', params: [P.scale], run: (ctx, p) => thresh(ctx, matT(rankMatrix('c4', 4, clusterF(4)), 4, p.scale)) });
  add({ id: 'cluster8', name: 'Clustered Dot 8×8', cat: 'Ordered', kind: 'threshold', params: [P.scale], run: (ctx, p) => thresh(ctx, matT(rankMatrix('c8', 8, clusterF(8)), 8, p.scale)) });
  add({ id: 'bluenoise', name: 'Blue Noise', cat: 'Ordered', kind: 'threshold', params: [P.scale], run: (ctx, p) => thresh(ctx, matT(blueNoise(), 64, p.scale)) });
  add({ id: 'whitenoise', name: 'White Noise', cat: 'Ordered', kind: 'threshold', params: [P.scale], run: (ctx, p) => { const s = Math.max(1, Math.round(p.scale)); thresh(ctx, (x, y) => hash2((x / s) | 0, (y / s) | 0, ctx.seed)); } });
  add({ id: 'ign', name: 'Interleaved Gradient', cat: 'Ordered', kind: 'threshold', params: [P.scale], run: (ctx, p) => { const s = Math.max(1, Math.round(p.scale)); thresh(ctx, (x, y) => fract(52.9829189 * fract(0.06711056 * ((x / s) | 0) + 0.00583715 * ((y / s) | 0)))); } });
  add({ id: 'diagord', name: 'Diagonal Ordered 8×8', cat: 'Ordered', kind: 'threshold', params: [P.scale], run: (ctx, p) => thresh(ctx, matT(rankMatrix('dg8', 8, (x, y) => Math.abs(((x + y) % 8) - 3.5) * 10 + Math.abs(x - y) * 0.01), 8, p.scale)) });
  add({ id: 'spiralord', name: 'Spiral Ordered 8×8', cat: 'Ordered', kind: 'threshold', params: [P.scale], run: (ctx, p) => thresh(ctx, matT(rankMatrix('sp8', 8, (x, y) => { const dx = x - 3.5, dy = y - 3.5; return Math.hypot(dx, dy) * 2 + (Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI); }), 8, p.scale)) });

  // ======================= PATTERN =======================
  const L1 = (v) => Math.abs(fu(v)) * 2;
  const PATTERNS = [
    ['lines_h', 'Horizontal Lines', 0, (u, v) => L1(v)],
    ['lines_v', 'Vertical Lines', 90, (u, v) => L1(v)],
    ['lines_d', 'Diagonal Lines', 45, (u, v) => L1(v)],
    ['crosshatch', 'Crosshatch', 45, (u, v) => Math.min(L1(v) * 0.55, 0.45 + L1(u) * 0.55)],
    ['grid', 'Grid', 0, (u, v) => Math.min(L1(u), L1(v))],
    ['hexdots', 'Hex Dots', 0, (u, v) => {
      const sy = Math.sqrt(3);
      const ax = fu(u), ay = (fract(v / sy) - 0.5) * sy;
      const bx = fu(u + 0.5), by = (fract(v / sy + 0.5) - 0.5) * sy;
      return Math.min(1, (Math.min(ax * ax + ay * ay, bx * bx + by * by) * Math.PI) / 0.866);
    }],
    ['diamonds', 'Diamond Grid', 0, (u, v) => Math.abs(fu(u)) + Math.abs(fu(v))],
    ['brick', 'Brick', 0, (u, v) => { const row = Math.floor(v); const uu = u / 2 + (row & 1) * 0.5; const bx = L1(uu), by = L1(v); return Math.min(1 - bx, 1 - by) * 1.6; }],
    ['waves', 'Waves', 0, (u, v) => L1(v + 0.35 * Math.sin(u * Math.PI))],
    ['zigzag', 'Zigzag', 0, (u, v) => L1(v + 0.5 * L1(u * 0.5))],
    ['checker', 'Checker', 0, (u, v) => { const par = (Math.floor(u) + Math.floor(v)) & 1; const dd = Math.max(Math.abs(fu(u)), Math.abs(fu(v))) * 2; return par ? dd * 0.5 : 0.5 + dd * 0.5; }],
    ['weave', 'Basket Weave', 0, (u, v) => { const par = (Math.floor(u) + Math.floor(v)) & 1; return par ? L1(v * 3) : L1(u * 3); }],
  ];
  for (const [id, name, ang, f] of PATTERNS) add({ id, name, cat: 'Pattern', kind: 'threshold', params: [P.cell(6), P.angle(ang)], run: (ctx, p) => thresh(ctx, screenT(p, f)) });

  // ======================= HALFTONE =======================
  const HT = [['ht_circle', 'Circle Dots', 'circle', 45], ['ht_euclid', 'Euclidean Dots', 'euclid', 45], ['ht_square', 'Square Dots', 'square', 45], ['ht_line', 'Line Screen', 'line', 45],
    ['ht_diamond', 'Diamond Dots', 'diamond', 45], ['ht_ellipse', 'Ellipse Dots', 'ellipse', 45], ['ht_cross', 'Cross Screen', 'cross', 45]];
  for (const [id, name, shape, ang] of HT) add({ id, name, cat: 'Halftone', kind: 'threshold', params: [P.cell(8), P.angle(ang)], run: (ctx, p) => thresh(ctx, screenT(p, SHAPES[shape])) });

  const SHAPE_OPTS = [['circle', 'Circle'], ['euclid', 'Euclidean'], ['square', 'Square'], ['line', 'Line'], ['diamond', 'Diamond'], ['ellipse', 'Ellipse']];
  add({
    id: 'ht_cmyk', name: 'CMYK Halftone', cat: 'Halftone', kind: 'threshold',
    params: [P.cell(8), { k: 'shape', l: 'Dot shape', type: 'select', opts: SHAPE_OPTS, d: 'circle' }, { k: 'gcr', l: 'Black generation', min: 0, max: 1, step: 0.01, d: 0.8 },
      { k: 'rot', l: 'Screen rotation', min: 0, max: 90, step: 1, d: 0 }, { k: 'paper', l: 'Paper', type: 'color', d: '#f7f4ec' }, { k: 'snap', l: 'Snap to palette', type: 'bool', d: false }],
    run(ctx, p) {
      const { w, h, r, g, b, out, q } = ctx; const f = SHAPES[p.shape] || SHAPES.circle;
      const angs = [15, 75, 0, 45].map((a) => ((a + p.rot) * Math.PI) / 180);
      const cell = Math.max(0.5, p.cell); const cs = angs.map((a) => [Math.cos(a) / cell, Math.sin(a) / cell]);
      const inks = [[0, 0.68, 0.94], [0.93, 0, 0.55], [1, 0.95, 0], [0.08, 0.08, 0.1]];
      const paper = BS.hexToRgb(p.paper).map((v) => v / 255);
      const str = ctx.d.strength == null ? 1 : ctx.d.strength;
      const tmp = [0, 0, 0];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        let c = 1 - r[i], m = 1 - g[i], yy = 1 - b[i];
        const k = Math.min(c, m, yy) * p.gcr;
        if (k < 1) { c = (c - k) / (1 - k); m = (m - k) / (1 - k); yy = (yy - k) / (1 - k); } else { c = m = yy = 0; }
        const amt = [c, m, yy, k];
        let R = paper[0], G = paper[1], B = paper[2];
        for (let s = 0; s < 4; s++) {
          const X = x + 0.5, Y = y + 0.5; const u = X * cs[s][0] + Y * cs[s][1], v = -X * cs[s][1] + Y * cs[s][0];
          const t = 0.5 + (f(u, v) - 0.5) * str;
          if (amt[s] > t) { R *= inks[s][0]; G *= inks[s][1]; B *= inks[s][2]; }
        }
        if (p.snap && q.mode === 'palette') put(out, i, q.c8[q.nearest(R, G, B)]);
        else { tmp[0] = R * 255; tmp[1] = G * 255; tmp[2] = B * 255; put(out, i, tmp); }
      }
    },
  });
  add({
    id: 'ht_rgb', name: 'RGB Screen', cat: 'Halftone', kind: 'threshold',
    params: [P.cell(6), { k: 'shape', l: 'Dot shape', type: 'select', opts: SHAPE_OPTS, d: 'circle' }, { k: 'rot', l: 'Screen rotation', min: 0, max: 90, step: 1, d: 15 }],
    run(ctx, p) {
      const { w, h, r, g, b, out } = ctx; const f = SHAPES[p.shape] || SHAPES.circle;
      const angs = [0, 30, 60].map((a) => ((a + p.rot) * Math.PI) / 180);
      const cell = Math.max(0.5, p.cell); const cs = angs.map((a) => [Math.cos(a) / cell, Math.sin(a) / cell]);
      const ch = [r, g, b]; const tmp = [0, 0, 0]; const str = ctx.d.strength == null ? 1 : ctx.d.strength;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        for (let s = 0; s < 3; s++) {
          const X = x + 0.5, Y = y + 0.5; const u = X * cs[s][0] + Y * cs[s][1], v = -X * cs[s][1] + Y * cs[s][0];
          const t = 0.5 + (f(u, v) - 0.5) * str;
          tmp[s] = ch[s][i] > t ? 255 : 0;
        }
        put(out, i, tmp);
      }
    },
  });

  // ======================= GLITCH =======================
  const BASES = [['floyd', 'Floyd–Steinberg'], ['atkinson', 'Atkinson'], ['bayer', 'Bayer 8×8'], ['blue', 'Blue noise'], ['none', 'None (nearest)']];
  function baseDither(ctx, base) {
    if (base === 'atkinson') diffuse(ctx, K.atkinson);
    else if (base === 'bayer') thresh(ctx, matT(bayer(8), 8, 1));
    else if (base === 'blue') thresh(ctx, matT(blueNoise(), 64, 1));
    else if (base === 'none') thresh(ctx, () => 0.5);
    else diffuse(ctx, K.floyd);
  }
  BS.baseDither = baseDither;
  BS.DITHER_BASES = BASES;
  function remap(ctx, map) {
    for (const ch of ['r', 'g', 'b', 'a']) { const s = ctx[ch], d = new Float32Array(s.length); for (let i = 0; i < map.length; i++) d[i] = s[map[i]]; ctx[ch] = d; }
  }
  BS.remap = remap;
  function ident(w, h) { const m = new Int32Array(w * h); for (let i = 0; i < m.length; i++) m[i] = i; return m; }
  const wrapI = (v, n) => ((v % n) + n) % n;
  const gseed = { k: 'gseed', l: 'Glitch seed', min: 1, max: 999, step: 1, d: 7 };
  const baseP = { k: 'base', l: 'Base dither', type: 'select', opts: BASES, d: 'floyd' };

  // distortion: (ctx, p, rnd) => void (mutates ctx channels)
  const DIST = {
    pixelsort(ctx, p) {
      const { w, h } = ctx; const L = BS.computeL(ctx); const map = ident(w, h);
      const vert = p.dir === 'v'; const lines = vert ? w : h, len = vert ? h : w;
      const seg = [];
      const flush = () => {
        if (seg.length > 1) {
          const sorted = seg.slice().sort((a, b) => (p.reverse ? L[b] - L[a] : L[a] - L[b]));
          for (let k = 0; k < seg.length; k++) map[seg[k]] = sorted[k];
        }
        seg.length = 0;
      };
      for (let l = 0; l < lines; l++) {
        for (let s = 0; s < len; s++) {
          const i = vert ? s * w + l : l * w + s;
          if (L[i] >= p.low && L[i] <= p.high) seg.push(i); else flush();
        }
        flush();
      }
      remap(ctx, map);
    },
    rowshift(ctx, p, rnd) {
      const { w, h } = ctx; const map = ident(w, h); const hh = Math.max(1, Math.round(p.height));
      for (let y0 = 0; y0 < h; y0 += hh) {
        if (rnd() > p.prob) continue;
        const off = Math.round((rnd() - 0.5) * 2 * p.amount * w);
        for (let y = y0; y < Math.min(h, y0 + hh); y++) for (let x = 0; x < w; x++) map[y * w + x] = y * w + wrapI(x - off, w);
      }
      remap(ctx, map);
    },
    slices(ctx, p, rnd) {
      const { w, h } = ctx; const map = ident(w, h); let y0 = 0;
      while (y0 < h) {
        const hh = Math.max(1, Math.round(rnd() * p.maxh * h * 0.2));
        const off = Math.round((rnd() - 0.5) * 2 * p.amount * w);
        for (let y = y0; y < Math.min(h, y0 + hh); y++) for (let x = 0; x < w; x++) map[y * w + x] = y * w + wrapI(x - off, w);
        y0 += hh;
      }
      remap(ctx, map);
    },
    blocks(ctx, p, rnd) {
      const { w, h } = ctx; const map = ident(w, h); const bs = Math.max(2, Math.round(p.block));
      for (let by = 0; by < h; by += bs) for (let bx = 0; bx < w; bx += bs) {
        if (rnd() > p.prob) continue;
        const dx = Math.round((rnd() - 0.5) * 2 * p.amount * w), dy = Math.round((rnd() - 0.5) * 2 * p.amount * h);
        for (let y = by; y < Math.min(h, by + bs); y++) for (let x = bx; x < Math.min(w, bx + bs); x++) map[y * w + x] = wrapI(y + dy, h) * w + wrapI(x + dx, w);
      }
      remap(ctx, map);
    },
    rgbsplit(ctx, p) {
      const { w, h } = ctx; const ox = Math.round(p.amount * w * 0.05), oy = Math.round(p.vert * h * 0.05);
      const sh = (arr, dx, dy) => { const d = new Float32Array(arr.length); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[y * w + x] = arr[BS.clamp(y - dy, 0, h - 1) * w + BS.clamp(x - dx, 0, w - 1)]; return d; };
      ctx.r = sh(ctx.r, ox, oy); ctx.b = sh(ctx.b, -ox, -oy);
    },
    wave(ctx, p) {
      const { w, h } = ctx; const map = ident(w, h); const ph = (ctx.time || 0) * p.speed * 6;
      for (let y = 0; y < h; y++) { const off = Math.round(Math.sin((y / h) * p.freq * Math.PI * 2 + ph) * p.amp * w * 0.1); for (let x = 0; x < w; x++) map[y * w + x] = y * w + BS.clamp(x - off, 0, w - 1); }
      remap(ctx, map);
    },
    melt(ctx, p, rnd) {
      const { w, h } = ctx; const map = ident(w, h); const L = BS.computeL(ctx);
      for (let x = 0; x < w; x++) {
        if (rnd() > p.prob) continue;
        let y0 = Math.floor(rnd() * h * 0.8);
        if (p.bright) { for (let y = y0; y < h; y++) if (L[y * w + x] > 0.6) { y0 = y; break; } }
        const len = Math.round(rnd() * p.length * h);
        for (let y = y0; y < Math.min(h, y0 + len); y++) map[y * w + x] = y0 * w + x;
      }
      remap(ctx, map);
    },
    interlace(ctx, p) {
      const { w, h } = ctx; const map = ident(w, h);
      for (let y = 1; y < h; y += 2) { const off = Math.round(Math.sin(y * 0.05 * p.freq + (ctx.time || 0) * 4) * p.amount * w * 0.05); for (let x = 0; x < w; x++) map[y * w + x] = y * w + BS.clamp(x - off, 0, w - 1); }
      remap(ctx, map);
    },
    vhs(ctx, p, rnd) {
      const { w, h } = ctx; const map = ident(w, h);
      const bandY = fract(p.pos + (ctx.time || 0) * 0.15) * h, bandH = p.band * h * 0.3;
      for (let y = 0; y < h; y++) {
        const inBand = Math.abs(y - bandY) < bandH;
        const j = Math.round((rnd() - 0.5) * (inBand ? p.amount * w * 0.2 : p.jitter * 4));
        for (let x = 0; x < w; x++) map[y * w + x] = y * w + BS.clamp(x - j, 0, w - 1);
      }
      remap(ctx, map);
      for (let y = 0; y < h; y++) {
        if (Math.abs(y - bandY) >= bandH) continue;
        for (let x = 0; x < w; x++) { const i = y * w + x; const nz = (hash2(x, y, ctx.seed) - 0.5) * p.noise; ctx.r[i] += nz; ctx.g[i] += nz; ctx.b[i] += nz; }
      }
    },
    mirror(ctx, p, rnd) {
      const { w, h } = ctx; const map = ident(w, h); const bh = Math.max(1, Math.round(p.band * h * 0.1));
      for (let y0 = 0; y0 < h; y0 += bh) {
        if (rnd() > p.prob) continue;
        const a = Math.floor(rnd() * w * 0.6), b = Math.min(w - 1, a + Math.floor(w * (0.2 + rnd() * 0.6)));
        for (let y = y0; y < Math.min(h, y0 + bh); y++) for (let x = a; x <= b; x++) map[y * w + x] = y * w + (a + b - x);
      }
      remap(ctx, map);
    },
    datamosh(ctx, p, rnd) {
      const { w, h } = ctx; const map = ident(w, h); const bs = Math.max(2, Math.round(p.block));
      for (let by = 0; by < h; by += bs) for (let bx = 0; bx < w; bx += bs) {
        if (rnd() > p.prob) continue;
        const fromLeft = rnd() < 0.6 && bx >= bs; const fromUp = !fromLeft && by >= bs;
        if (!fromLeft && !fromUp) continue;
        for (let y = by; y < Math.min(h, by + bs); y++) for (let x = bx; x < Math.min(w, bx + bs); x++) {
          const i = y * w + x; map[i] = fromLeft ? map[i - bs] : map[i - bs * w];
        }
      }
      remap(ctx, map);
    },
  };
  BS.DIST = DIST;

  function glitch(id, name, params, fn) {
    add({ id, name, cat: 'Glitch', kind: 'diffusion', params: params.concat([baseP, gseed]),
      run(ctx, p) { const rnd = mulberry32(p.gseed * 1000 + (ctx.frameSeed || 0)); fn(ctx, p, rnd); BS.computeL(ctx); baseDither(ctx, p.base); } });
  }
  glitch('g_pixelsort', 'Pixel Sort', [{ k: 'low', l: 'Low threshold', min: 0, max: 1, step: 0.01, d: 0.25 }, { k: 'high', l: 'High threshold', min: 0, max: 1, step: 0.01, d: 0.85 }, { k: 'dir', l: 'Direction', type: 'select', opts: [['h', 'Horizontal'], ['v', 'Vertical']], d: 'h' }, { k: 'reverse', l: 'Reverse order', type: 'bool', d: false }], DIST.pixelsort);
  glitch('g_rowshift', 'Row Shift', [{ k: 'amount', l: 'Shift amount', min: 0, max: 1, step: 0.01, d: 0.15 }, { k: 'prob', l: 'Probability', min: 0, max: 1, step: 0.01, d: 0.2 }, { k: 'height', l: 'Row height', min: 1, max: 40, step: 1, d: 2, size: true }], DIST.rowshift);
  glitch('g_slices', 'Slice Shift', [{ k: 'amount', l: 'Shift amount', min: 0, max: 1, step: 0.01, d: 0.08 }, { k: 'maxh', l: 'Slice height', min: 0.01, max: 1, step: 0.01, d: 0.3 }], DIST.slices);
  glitch('g_blocks', 'Block Displace', [{ k: 'block', l: 'Block size', min: 2, max: 128, step: 1, d: 16, size: true }, { k: 'amount', l: 'Displacement', min: 0, max: 0.5, step: 0.01, d: 0.06 }, { k: 'prob', l: 'Probability', min: 0, max: 1, step: 0.01, d: 0.15 }], DIST.blocks);
  glitch('g_rgbsplit', 'RGB Split', [{ k: 'amount', l: 'Horizontal', min: -1, max: 1, step: 0.01, d: 0.25 }, { k: 'vert', l: 'Vertical', min: -1, max: 1, step: 0.01, d: 0 }], DIST.rgbsplit);
  glitch('g_wave', 'Wave Warp', [{ k: 'amp', l: 'Amplitude', min: 0, max: 1, step: 0.01, d: 0.15 }, { k: 'freq', l: 'Frequency', min: 0.5, max: 60, step: 0.5, d: 6 }, { k: 'speed', l: 'Anim speed', min: 0, max: 4, step: 0.05, d: 1 }], DIST.wave);
  glitch('g_melt', 'Melt / Drip', [{ k: 'prob', l: 'Drip density', min: 0, max: 1, step: 0.01, d: 0.3 }, { k: 'length', l: 'Drip length', min: 0, max: 1, step: 0.01, d: 0.3 }, { k: 'bright', l: 'Start at highlights', type: 'bool', d: true }], DIST.melt);
  glitch('g_interlace', 'Interlace Tear', [{ k: 'amount', l: 'Tear amount', min: 0, max: 2, step: 0.01, d: 0.6 }, { k: 'freq', l: 'Frequency', min: 0.1, max: 10, step: 0.1, d: 1 }], DIST.interlace);
  glitch('g_vhs', 'VHS Tracking', [{ k: 'pos', l: 'Band position', min: 0, max: 1, step: 0.01, d: 0.7 }, { k: 'band', l: 'Band size', min: 0, max: 1, step: 0.01, d: 0.25 }, { k: 'amount', l: 'Band tear', min: 0, max: 1, step: 0.01, d: 0.4 }, { k: 'jitter', l: 'Line jitter', min: 0, max: 4, step: 0.1, d: 0.6 }, { k: 'noise', l: 'Band noise', min: 0, max: 2, step: 0.01, d: 0.6 }], DIST.vhs);
  glitch('g_mirror', 'Mirror Glitch', [{ k: 'band', l: 'Band height', min: 0.1, max: 5, step: 0.1, d: 0.6 }, { k: 'prob', l: 'Probability', min: 0, max: 1, step: 0.01, d: 0.35 }], DIST.mirror);
  glitch('g_datamosh', 'Datamosh Smear', [{ k: 'block', l: 'Block size', min: 2, max: 96, step: 1, d: 12, size: true }, { k: 'prob', l: 'Smear amount', min: 0, max: 1, step: 0.01, d: 0.35 }], DIST.datamosh);

  // Intrinsic glitch dithers
  add({ id: 'g_overflow', name: 'Error Overflow', cat: 'Glitch', kind: 'diffusion', params: [{ k: 'gain', l: 'Error gain', min: 0.5, max: 4, step: 0.05, d: 1.6 }], run: (ctx, p) => diffuse(ctx, K.floyd, { wrap: true, gain: p.gain }) });
  add({ id: 'g_scanerr', name: 'Scanline Error', cat: 'Glitch', kind: 'diffusion', params: [{ k: 'gain', l: 'Error gain', min: 0.5, max: 3, step: 0.05, d: 1.2 }, { k: 'bleed', l: 'Vertical bleed', min: 0, max: 1, step: 0.01, d: 0.1 }],
    run: (ctx, p) => diffuse(ctx, { div: 1, k: [[1, 0, 1 - p.bleed], [0, 1, p.bleed]] }, { gain: p.gain, serp: false }) });
  add({ id: 'g_brokenbayer', name: 'Broken Bayer', cat: 'Glitch', kind: 'threshold', params: [{ k: 'chaos', l: 'Chaos', min: 0, max: 1, step: 0.01, d: 0.4 }, { k: 'band', l: 'Band height', min: 1, max: 64, step: 1, d: 8, size: true }, gseed],
    run(ctx, p) {
      const M = bayer(8); const rnd = mulberry32(p.gseed * 77 + (ctx.frameSeed || 0)); const bh = Math.max(1, Math.round(p.band));
      const offs = []; for (let y = 0; y < ctx.h; y += bh) offs.push(rnd() < p.chaos ? [(rnd() * 8) | 0, (rnd() * 8) | 0, rnd() < 0.3] : [0, 0, false]);
      thresh(ctx, (x, y) => { const o = offs[(y / bh) | 0]; const xx = o[2] ? 7 - (x & 7) : x; return M[(((y + o[1]) & 7) << 3) + ((xx + o[0]) & 7)]; });
    } });
  add({ id: 'g_bitcrush', name: 'Bit Crush', cat: 'Glitch', kind: 'threshold', params: [{ k: 'bits', l: 'Bits kept', min: 1, max: 8, step: 1, d: 3 }, { k: 'xor', l: 'XOR pattern', min: 0, max: 255, step: 1, d: 40 }, { k: 'shift', l: 'Bit shift', min: 0, max: 7, step: 1, d: 0 }],
    run(ctx, p) {
      const { w, h } = ctx; const mask = (0xff << (8 - p.bits)) & 0xff;
      for (const ch of ['r', 'g', 'b']) { const a = ctx[ch]; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; let v = (Math.max(0, Math.min(1, a[i])) * 255) | 0; v = ((v << p.shift) | (v >> (8 - p.shift))) & 255; v = (v & mask) ^ (((x ^ y) * p.xor) & 255 & ~mask); a[i] = v / 255; } }
      BS.computeL(ctx); thresh(ctx, () => 0.5);
    } });
  add({ id: 'g_randkernel', name: 'Random Kernel', cat: 'Glitch', kind: 'diffusion', params: [{ k: 'band', l: 'Band height', min: 1, max: 64, step: 1, d: 6, size: true }, gseed],
    run(ctx, p) { const ks = [K.floyd, K.atkinson, K.horizontal, K.vertical, K.stucki, K.fan, K.diagonal]; const rnd = mulberry32(p.gseed * 31 + (ctx.frameSeed || 0)); const picks = []; const bh = Math.max(1, Math.round(p.band)); for (let y = 0; y < ctx.h; y += bh) picks.push((rnd() * ks.length) | 0); diffuse(ctx, null, { kernels: ks, pick: (y) => picks[(y / bh) | 0] }); } });
  add({ id: 'g_static', name: 'Static Noise', cat: 'Glitch', kind: 'threshold', params: [{ k: 'streak', l: 'Streaks', min: 0, max: 1, step: 0.01, d: 0.5 }, gseed],
    run(ctx, p) { const rnd = mulberry32(p.gseed * 13 + (ctx.frameSeed || 0)); const st = new Float32Array(ctx.h); for (let y = 0; y < ctx.h; y++) st[y] = rnd() < 0.15 ? rnd() : 0; thresh(ctx, (x, y) => fract(hash2(x, y, p.gseed + (ctx.frameSeed || 0)) + st[y] * p.streak * hash2(x >> 3, y, 9))); } });

  // ======================= SPECIAL =======================
  function inkPaper(ctx) {
    const q = ctx.q;
    return {
      paper: q.paper,
      ink: (i) => (q.mode === 'mono' ? q.ink : q.colorAt(ctx.r[i] * 0.85, ctx.g[i] * 0.85, ctx.b[i] * 0.85, ctx.L[i])),
    };
  }
  function fill(out, c) { for (let i = 0, n = out.length >> 2; i < n; i++) put(out, i, c); }
  function disc(out, w, h, cx, cy, rad, c) {
    if (rad <= 0) return;
    const r2 = rad * rad; const x0 = Math.max(0, Math.floor(cx - rad)), x1 = Math.min(w - 1, Math.ceil(cx + rad));
    const y0 = Math.max(0, Math.floor(cy - rad)), y1 = Math.min(h - 1, Math.ceil(cy + rad));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const dx = x + 0.5 - cx, dy = y + 0.5 - cy; if (dx * dx + dy * dy <= r2) put(out, y * w + x, c); }
  }
  function cellAvg(ctx, x0, y0, cw, ch) {
    const { w, h } = ctx; let r = 0, g = 0, b = 0, L = 0, n = 0;
    for (let y = y0; y < Math.min(h, y0 + ch); y++) for (let x = x0; x < Math.min(w, x0 + cw); x++) { const i = y * w + x; r += ctx.r[i]; g += ctx.g[i]; b += ctx.b[i]; L += ctx.L[i]; n++; }
    n = n || 1; return [r / n, g / n, b / n, L / n];
  }
  const biasL = (ctx, v) => v + (ctx.d.bias || 0) * 0.5;

  add({ id: 'threshold', name: 'Threshold', cat: 'Special', params: [{ k: 'level', l: 'Level', min: 0, max: 1, step: 0.01, d: 0.5 }],
    run(ctx, p) { const { out, q } = ctx; const ip = inkPaper(ctx); for (let i = 0; i < ctx.L.length; i++) put(out, i, biasL(ctx, ctx.L[i]) < p.level ? ip.ink(i) : q.paper); } });
  add({ id: 'posterize', name: 'Posterize (Nearest)', cat: 'Special', kind: 'threshold', run: (ctx) => thresh(ctx, () => 0.5) });
  add({ id: 'mosaic', name: 'Mosaic', cat: 'Special', params: [{ k: 'cell', l: 'Tile size', min: 2, max: 64, step: 1, d: 8, size: true }, { k: 'dither', l: 'Tile dither', type: 'select', opts: [['none', 'None'], ['floyd', 'Floyd–Steinberg'], ['bayer', 'Bayer']], d: 'none' }, { k: 'gap', l: 'Grout', min: 0, max: 0.4, step: 0.01, d: 0 }],
    run(ctx, p) {
      const { w, h, out, q } = ctx; const c = Math.max(1, Math.round(p.cell)); const bw = Math.ceil(w / c), bh = Math.ceil(h / c);
      const sub = { w: bw, h: bh, r: new Float32Array(bw * bh), g: new Float32Array(bw * bh), b: new Float32Array(bw * bh), q, d: ctx.d, seed: ctx.seed, out: new Uint8ClampedArray(bw * bh * 4) };
      for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) { const a = cellAvg(ctx, bx * c, by * c, c, c); const j = by * bw + bx; sub.r[j] = a[0]; sub.g[j] = a[1]; sub.b[j] = a[2]; }
      BS.computeL(sub);
      if (p.dither === 'floyd') diffuse(sub, K.floyd); else if (p.dither === 'bayer') thresh(sub, matT(bayer(4), 4, 1)); else thresh(sub, () => 0.5);
      const g = Math.round(p.gap * c);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const j = ((y / c) | 0) * bw + ((x / c) | 0), o = j * 4;
        const gx = x % c, gy = y % c;
        if (g && (gx < g || gy < g)) put(out, y * w + x, q.ink); else put(out, y * w + x, [sub.out[o], sub.out[o + 1], sub.out[o + 2]]);
      }
    } });

  const ATLAS = {};
  function glyphs(chars, cw, ch, bold) {
    const key = chars + '|' + cw + 'x' + ch + bold; if (ATLAS[key]) return ATLAS[key];
    const list = Array.from(chars); const c = document.createElement('canvas'); c.width = cw * list.length; c.height = ch;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = `${bold ? 'bold ' : ''}${Math.round(ch * 0.92)}px Consolas, "Cascadia Mono", "Courier New", monospace`;
    list.forEach((s, i) => x.fillText(s, i * cw + cw / 2, ch / 2 + ch * 0.04));
    const d = x.getImageData(0, 0, c.width, ch).data;
    const gl = list.map((s, i) => { const m = new Uint8Array(cw * ch); let cov = 0; for (let yy = 0; yy < ch; yy++) for (let xx = 0; xx < cw; xx++) { const on = d[(yy * c.width + i * cw + xx) * 4 + 3] > 100 ? 1 : 0; m[yy * cw + xx] = on; cov += on; } return { m, cov: cov / (cw * ch) }; });
    return (ATLAS[key] = gl);
  }
  const CHARSETS = [['standard', ' .:-=+*#%@'], ['dense', " .'`^\",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$"], ['blocks', ' ░▒▓█'], ['binary', ' 01'], ['hex', ' 0123456789ABCDEF'], ['lines', ' .-=≡#'], ['custom', '']];
  add({ id: 'ascii', name: 'ASCII Art', cat: 'Special',
    params: [{ k: 'cell', l: 'Character size', min: 4, max: 48, step: 1, d: 10, size: true }, { k: 'set', l: 'Character set', type: 'select', opts: CHARSETS.map((c) => [c[0], c[0][0].toUpperCase() + c[0].slice(1)]), d: 'standard' },
      { k: 'custom', l: 'Custom ramp (light → dark)', type: 'text', d: ' .oO@' }, { k: 'invert', l: 'Terminal mode (light on dark)', type: 'bool', d: false }, { k: 'bold', l: 'Bold', type: 'bool', d: true }, { k: 'autosort', l: 'Sort ramp by density', type: 'bool', d: true }],
    run(ctx, p) {
      const { w, h, out, q } = ctx; const cw = Math.max(3, Math.round(p.cell * 0.62)), chh = Math.max(4, Math.round(p.cell));
      let set = p.set === 'custom' ? p.custom || ' #' : (CHARSETS.find((c) => c[0] === p.set) || CHARSETS[0])[1];
      let gl = glyphs(set, cw, chh, p.bold).slice();
      if (p.autosort) gl.sort((a, b) => a.cov - b.cov);
      const ng = gl.length; const ink = p.invert ? q.paper : q.ink; const paper = p.invert ? q.ink : q.paper;
      for (let cy = 0; cy < h; cy += chh) for (let cx = 0; cx < w; cx += cw) {
        const a = cellAvg(ctx, cx, cy, cw, chh); const L = BS.clamp(biasL(ctx, a[3]), 0, 1);
        const gi = Math.round((p.invert ? L : 1 - L) * (ng - 1)); const g = gl[gi].m;
        const col = q.mode === 'mono' ? ink : q.colorAt(a[0], a[1], a[2], a[3]);
        for (let yy = 0; yy < chh && cy + yy < h; yy++) for (let xx = 0; xx < cw && cx + xx < w; xx++) put(out, (cy + yy) * w + cx + xx, g[yy * cw + xx] ? col : paper);
      }
    } });
  add({ id: 'stipple', name: 'Stipple', cat: 'Special',
    params: [{ k: 'cell', l: 'Spacing', min: 2, max: 32, step: 0.5, d: 5, size: true }, { k: 'mode', l: 'Modulation', type: 'select', opts: [['size', 'Dot size'], ['density', 'Dot density']], d: 'size' }, { k: 'dot', l: 'Dot size', min: 0.2, max: 2, step: 0.05, d: 1 }, { k: 'jitter', l: 'Scatter', min: 0, max: 1, step: 0.01, d: 0.8 }, { k: 'gamma', l: 'Tone gamma', min: 0.3, max: 3, step: 0.05, d: 1 }],
    run(ctx, p) {
      const { w, h, out } = ctx; const ip = inkPaper(ctx); fill(out, ip.paper); const s = Math.max(1, p.cell);
      for (let gy = 0; gy * s < h + s; gy++) for (let gx = 0; gx * s < w + s; gx++) {
        const jx = (hash2(gx, gy, ctx.seed) - 0.5) * p.jitter * s, jy = (hash2(gx, gy, ctx.seed + 9) - 0.5) * p.jitter * s;
        const cx = gx * s + s / 2 + jx, cy = gy * s + s / 2 + jy;
        const xi = BS.clamp(Math.round(cx), 0, w - 1), yi = BS.clamp(Math.round(cy), 0, h - 1), i = yi * w + xi;
        const D = Math.pow(BS.clamp(1 - biasL(ctx, ctx.L[i]), 0, 1), p.gamma);
        if (p.mode === 'size') disc(out, w, h, cx, cy, s * 0.62 * Math.sqrt(D) * p.dot, ip.ink(i));
        else if (hash2(gx, gy, ctx.seed + 3) < D) disc(out, w, h, cx, cy, s * 0.35 * p.dot, ip.ink(i));
      }
    } });
  function lineMod(id, name, extra, coord) {
    add({ id, name, cat: 'Special', params: [{ k: 'period', l: 'Line spacing', min: 2, max: 64, step: 0.5, d: 6, size: true }, { k: 'thick', l: 'Thickness', min: 0.1, max: 2, step: 0.01, d: 1 }].concat(extra),
      run(ctx, p) {
        const { w, h, out } = ctx; const ip = inkPaper(ctx); const co = coord(ctx, p);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const i = y * w + x; const L = BS.clamp(biasL(ctx, ctx.L[i]), 0, 1); const D = 1 - L;
          const v = co(x + 0.5, y + 0.5, L);
          put(out, i, Math.abs(fract(v) - 0.5) * 2 < D * p.thick ? ip.ink(i) : ip.paper);
        }
      } });
  }
  lineMod('lines_mod', 'Line Modulation', [P.angle(0), { k: 'wave', l: 'Waviness', min: 0, max: 2, step: 0.01, d: 0 }], (ctx, p) => { const a = (p.angle * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a); return (x, y) => { const u = x * c + y * s, v = -x * s + y * c; return v / p.period + p.wave * Math.sin(u / (p.period * 3)); }; });
  lineMod('woodcut', 'Woodcut', [{ k: 'warp', l: 'Tone warp', min: 0, max: 6, step: 0.05, d: 1.5 }, P.angle(0)], (ctx, p) => { const a = (p.angle * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a); return (x, y, L) => (-x * s + y * c) / p.period + L * p.warp; });
  lineMod('rings', 'Concentric Rings', [{ k: 'cx', l: 'Center X', min: 0, max: 1, step: 0.01, d: 0.5 }, { k: 'cy', l: 'Center Y', min: 0, max: 1, step: 0.01, d: 0.5 }], (ctx, p) => (x, y) => Math.hypot(x - p.cx * ctx.w, y - p.cy * ctx.h) / p.period);
  lineMod('spiral', 'Spiral', [{ k: 'cx', l: 'Center X', min: 0, max: 1, step: 0.01, d: 0.5 }, { k: 'cy', l: 'Center Y', min: 0, max: 1, step: 0.01, d: 0.5 }, { k: 'arms', l: 'Arms', min: 1, max: 8, step: 1, d: 1 }], (ctx, p) => (x, y) => { const dx = x - p.cx * ctx.w, dy = y - p.cy * ctx.h; return Math.hypot(dx, dy) / p.period + (p.arms * (Math.atan2(dy, dx) + Math.PI)) / (2 * Math.PI); });

  add({ id: 'wavelines', name: 'Pulse Lines', cat: 'Special',
    params: [{ k: 'period', l: 'Line spacing', min: 3, max: 64, step: 0.5, d: 8, size: true }, { k: 'amp', l: 'Amplitude', min: 0, max: 4, step: 0.05, d: 1.4 }, { k: 'thick', l: 'Line width', min: 0.5, max: 6, step: 0.1, d: 1.2, size: true }, { k: 'occlude', l: 'Occlude lines behind', type: 'bool', d: true }],
    run(ctx, p) {
      const { w, h, out } = ctx; const ip = inkPaper(ctx); fill(out, ip.paper); const P2 = p.period;
      const lines = Math.ceil(h / P2);
      for (let li = 0; li <= lines; li++) {
        const base = li * P2 + P2 / 2; let prev = null;
        for (let x = 0; x < w; x++) {
          const sy = BS.clamp(Math.round(base), 0, h - 1); const i = sy * w + x;
          const D = 1 - BS.clamp(biasL(ctx, ctx.L[i]), 0, 1);
          const yc = base - D * p.amp * P2;
          const a = prev == null ? yc : prev; const y0 = Math.floor(Math.min(a, yc) - p.thick / 2), y1 = Math.ceil(Math.max(a, yc) + p.thick / 2);
          if (p.occlude) for (let y = Math.max(0, y1); y < Math.min(h, Math.ceil(base + P2 * 0.5)); y++) put(out, y * w + x, ip.paper);
          for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) put(out, y * w + x, ip.ink(i));
          prev = yc;
        }
      }
    } });
  add({ id: 'engrave', name: 'Engraving', cat: 'Special',
    params: [{ k: 'period', l: 'Line spacing', min: 2, max: 32, step: 0.5, d: 5, size: true }, P.angle(45), { k: 'layers', l: 'Hatch layers', min: 1, max: 4, step: 1, d: 4 }],
    run(ctx, p) {
      const { w, h, out } = ctx; const ip = inkPaper(ctx); const base = (p.angle * Math.PI) / 180;
      const angs = [base, base + Math.PI / 2, base + Math.PI / 4, base - Math.PI / 4].slice(0, p.layers).map((a) => [Math.cos(a), Math.sin(a)]);
      const n = angs.length; const th = angs.map((_, k) => k / n);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x; const D = 1 - BS.clamp(biasL(ctx, ctx.L[i]), 0, 1); let ink = false;
        for (let k = 0; k < n && !ink; k++) {
          if (D <= th[k]) break;
          const local = Math.min(1, (D - th[k]) * n);
          const v = (-(x + 0.5) * angs[k][1] + (y + 0.5) * angs[k][0]) / p.period;
          if (Math.abs(fract(v) - 0.5) * 2 < local * 0.9) ink = true;
        }
        put(out, i, ink ? ip.ink(i) : ip.paper);
      }
    } });
  add({ id: 'contour', name: 'Topographic Contours', cat: 'Special',
    params: [{ k: 'levels', l: 'Contour levels', min: 2, max: 40, step: 1, d: 10 }, { k: 'smooth', l: 'Smoothing', min: 0, max: 8, step: 1, d: 2, size: true }, { k: 'width', l: 'Line width', min: 1, max: 4, step: 1, d: 1 }, { k: 'tone', l: 'Tone fill', type: 'bool', d: false }],
    run(ctx, p) {
      const { w, h, out, q } = ctx; const ip = inkPaper(ctx); const L = Float32Array.from(ctx.L); BS.boxBlur(L, w, h, p.smooth, 2);
      if (p.tone) thresh(ctx, matT(bayer(4), 4, 1)); else fill(out, ip.paper);
      const band = new Int16Array(w * h); for (let i = 0; i < w * h; i++) band[i] = Math.floor(BS.clamp(biasL(ctx, L[i]), 0, 0.9999) * p.levels);
      const r = p.width | 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x; let edge = false;
        for (let d = 1; d <= r && !edge; d++) { if (x + d < w && band[i + d] !== band[i]) edge = true; if (y + d < h && band[i + d * w] !== band[i]) edge = true; }
        if (edge) put(out, i, p.tone ? q.ink : ip.ink(i));
      }
    } });
  add({ id: 'edgeink', name: 'Edge Ink', cat: 'Special',
    params: [{ k: 'thr', l: 'Edge threshold', min: 0.01, max: 1, step: 0.01, d: 0.18 }, { k: 'smooth', l: 'Pre-smooth', min: 0, max: 6, step: 1, d: 1, size: true }, { k: 'fill', l: 'Shading fill', type: 'select', opts: [['none', 'None'], ['floyd', 'Floyd–Steinberg'], ['bayer', 'Bayer']], d: 'none' }],
    run(ctx, p) {
      const { w, h, out, q } = ctx; const ip = inkPaper(ctx); const L = Float32Array.from(ctx.L); BS.boxBlur(L, w, h, p.smooth, 1);
      if (p.fill === 'floyd') diffuse(ctx, K.floyd); else if (p.fill === 'bayer') thresh(ctx, matT(bayer(8), 8, 1)); else fill(out, ip.paper);
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const gx = -L[i - w - 1] - 2 * L[i - 1] - L[i + w - 1] + L[i - w + 1] + 2 * L[i + 1] + L[i + w + 1];
        const gy = -L[i - w - 1] - 2 * L[i - w] - L[i - w + 1] + L[i + w - 1] + 2 * L[i + w] + L[i + w + 1];
        if (Math.hypot(gx, gy) > p.thr * 2) put(out, i, q.mode === 'mono' ? q.ink : ip.ink(i));
      }
    } });
  add({ id: 'led', name: 'LED Matrix', cat: 'Special',
    params: [{ k: 'cell', l: 'LED pitch', min: 3, max: 48, step: 1, d: 8, size: true }, { k: 'size', l: 'LED size', min: 0.2, max: 1, step: 0.01, d: 0.8 }, { k: 'bright', l: 'Size by brightness', type: 'bool', d: false }, { k: 'square', l: 'Square LEDs', type: 'bool', d: false }, { k: 'bg', l: 'Background', type: 'select', opts: [['black', 'Black'], ['ink', 'Palette darkest'], ['paper', 'Palette lightest']], d: 'black' }],
    run(ctx, p) {
      const { w, h, out, q } = ctx; const c = Math.max(2, Math.round(p.cell)); const bg = p.bg === 'black' ? [0, 0, 0] : p.bg === 'ink' ? q.ink : q.paper; fill(out, bg);
      for (let cy = 0; cy < h; cy += c) for (let cx = 0; cx < w; cx += c) {
        const a = cellAvg(ctx, cx, cy, c, c); const col = q.colorAt(a[0], a[1], a[2], BS.clamp(biasL(ctx, a[3]), 0, 1));
        const rad = (c / 2) * p.size * (p.bright ? Math.sqrt(BS.clamp(a[3], 0, 1)) : 1);
        if (p.square) { const s = Math.round(rad); for (let y = Math.max(0, Math.round(cy + c / 2 - s)); y < Math.min(h, Math.round(cy + c / 2 + s)); y++) for (let x = Math.max(0, Math.round(cx + c / 2 - s)); x < Math.min(w, Math.round(cx + c / 2 + s)); x++) put(out, y * w + x, col); }
        else disc(out, w, h, cx + c / 2, cy + c / 2, rad, col);
      }
    } });
  add({ id: 'crt', name: 'CRT Phosphor', cat: 'Special',
    params: [{ k: 'levels', l: 'Levels per channel', min: 2, max: 8, step: 1, d: 3 }, { k: 'scan', l: 'Scanline every', min: 0, max: 8, step: 1, d: 3 }, { k: 'dark', l: 'Scanline darkness', min: 0, max: 1, step: 0.01, d: 0.6 }],
    run(ctx, p) {
      const { w, h, out } = ctx; const M = bayer(4); const lv = p.levels - 1; const ch = [ctx.r, ctx.g, ctx.b]; const tmp = [0, 0, 0];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x; const s = x % 3; const t = M[((y & 3) << 2) + (x & 3)];
        let v = Math.max(0, Math.min(lv, Math.floor((ch[s][i] + (ctx.d.bias || 0) * 0.5) * lv + t))) / lv;
        if (p.scan && y % p.scan === p.scan - 1) v *= 1 - p.dark;
        tmp[0] = tmp[1] = tmp[2] = 0; tmp[s] = v * 255; put(out, i, tmp);
      }
    } });
  add({ id: 'dotmatrix', name: 'Dot Matrix Print', cat: 'Special',
    params: [{ k: 'cell', l: 'Dot pitch', min: 3, max: 40, step: 0.5, d: 6, size: true }, { k: 'size', l: 'Max dot size', min: 0.3, max: 1.5, step: 0.01, d: 1.05 }, { k: 'stagger', l: 'Stagger rows', type: 'bool', d: true }],
    run(ctx, p) {
      const { w, h, out } = ctx; const ip = inkPaper(ctx); fill(out, ip.paper); const c = Math.max(2, p.cell);
      for (let row = 0; row * c < h + c; row++) {
        const off = p.stagger && row & 1 ? c / 2 : 0;
        for (let col = -1; col * c < w + c; col++) {
          const cx = col * c + c / 2 + off, cy = row * c + c / 2;
          const a = cellAvg(ctx, Math.max(0, Math.round(cx - c / 2)), Math.max(0, Math.round(cy - c / 2)), Math.round(c), Math.round(c));
          const D = 1 - BS.clamp(biasL(ctx, a[3]), 0, 1);
          const i = BS.clamp(Math.round(cy), 0, h - 1) * w + BS.clamp(Math.round(cx), 0, w - 1);
          disc(out, w, h, cx, cy, (c / 2) * p.size * Math.sqrt(D), ip.ink(i));
        }
      }
    } });
  add({ id: 'stitch', name: 'Cross Stitch', cat: 'Special',
    params: [{ k: 'cell', l: 'Stitch size', min: 3, max: 40, step: 1, d: 8, size: true }, { k: 'thick', l: 'Thread width', min: 0.5, max: 4, step: 0.1, d: 1.2, size: true }, { k: 'skip', l: 'Skip paper-coloured cells', type: 'bool', d: true }],
    run(ctx, p) {
      const { w, h, out, q } = ctx; fill(out, q.paper); const c = Math.max(3, Math.round(p.cell)); const t = p.thick;
      for (let cy = 0; cy < h; cy += c) for (let cx = 0; cx < w; cx += c) {
        const a = cellAvg(ctx, cx, cy, c, c); const col = q.colorAt(a[0], a[1], a[2], BS.clamp(biasL(ctx, a[3]), 0, 1));
        if (p.skip && col[0] === q.paper[0] && col[1] === q.paper[1] && col[2] === q.paper[2]) continue;
        for (let yy = 0; yy < c && cy + yy < h; yy++) for (let xx = 0; xx < c && cx + xx < w; xx++) {
          if (Math.abs(xx - yy) <= t || Math.abs(xx + yy - (c - 1)) <= t) put(out, (cy + yy) * w + cx + xx, col);
        }
      }
    } });

  BS.algoIndex = (id) => ALGOS.findIndex((a) => a.id === id);
})();
