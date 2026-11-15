/* BitSkull — settings model, animation evaluation and the render pipeline */
(function () {
  'use strict';
  const BS = window.BS;

  BS.defaultSettings = () => ({
    v: 1,
    algo: 'floyd',
    algoParams: {},
    dither: { pixelSize: 2, strength: 1, bias: 0, jitter: 0, serpentine: true, seed: 1 },
    color: { mode: 'mono', order: 'luma', invert: false, cycles: 1, mirrorCycles: false, metric: 'weighted', rgbLevels: 2, keepAlpha: true },
    palette: { name: 'Black & White', colors: ['#000000', '#ffffff'], locks: [false, false] },
    adjust: BS.defaultAdjust(),
    adjustLocks: {},
    pre: [],
    post: [],
    anim: { on: false, duration: 4, fps: 24, loop: true, layers: [] },
  });

  BS.normalizeSettings = (S) => {
    const d = BS.defaultSettings();
    const out = BS.merge(d, S || {});
    if (!BS.ALGO[out.algo]) out.algo = 'floyd';
    out.palette.locks = out.palette.colors.map((_, i) => !!(out.palette.locks && out.palette.locks[i]));
    out.pre = (out.pre || []).filter((f) => BS.PRE[f.type]).map((f) => ({ uid: f.uid || BS.uid(), type: f.type, on: f.on !== false, p: f.p || {} }));
    out.post = (out.post || []).filter((f) => BS.POST[f.type]).map((f) => ({ uid: f.uid || BS.uid(), type: f.type, on: f.on !== false, p: f.p || {} }));
    out.anim.layers = (out.anim.layers || []).map((l) => Object.assign({ id: BS.uid(), target: 'adjust.contrast', from: 0, to: 1, start: 0, end: out.anim.duration, ease: 'inout', mode: 'once', on: true }, l));
    return out;
  };

  // ---------- Animation ----------
  BS.animTargets = function (S) {
    const list = [];
    const num = (p) => p.type === undefined || p.type === 'range';
    for (const a of BS.ADJUST) if (num(a)) list.push({ t: 'adjust.' + a.k, l: 'Adjust › ' + a.l, min: a.min, max: a.max, step: a.step });
    list.push({ t: 'dither.pixelSize', l: 'Dither › Pixel size', min: 0.5, max: 32, step: 0.25 });
    list.push({ t: 'dither.strength', l: 'Dither › Strength', min: 0, max: 2, step: 0.01 });
    list.push({ t: 'dither.bias', l: 'Dither › Threshold bias', min: -1, max: 1, step: 0.01 });
    list.push({ t: 'dither.jitter', l: 'Dither › Jitter', min: 0, max: 1, step: 0.01 });
    list.push({ t: 'dither.seed', l: 'Dither › Seed', min: 1, max: 9999, step: 1 });
    list.push({ t: 'color.cycles', l: 'Colour › Luma cycles', min: 1, max: 32, step: 0.05 });
    const al = BS.ALGO[S.algo];
    if (al) for (const p of al.params) if (num(p)) list.push({ t: 'algo.' + p.k, l: al.name + ' › ' + p.l, min: p.min, max: p.max, step: p.step });
    for (const ns of ['pre', 'post']) {
      const reg = ns === 'pre' ? BS.PRE : BS.POST;
      (S[ns] || []).forEach((fx, i) => { const def = reg[fx.type]; if (!def) return; for (const p of def.params) if (num(p)) list.push({ t: `${ns}.${fx.uid}.${p.k}`, l: `${ns === 'pre' ? 'Distort' : 'FX'} ${i + 1} ${def.name} › ${p.l}`, min: p.min, max: p.max, step: p.step }); });
    }
    return list;
  };
  BS.getTarget = function (S, target) {
    const [ns, a, b] = target.split('.');
    if (ns === 'adjust' || ns === 'dither' || ns === 'color') return S[ns][a];
    if (ns === 'algo') return BS.algoParams(S, S.algo)[a];
    if (ns === 'pre' || ns === 'post') { const fx = S[ns].find((f) => f.uid === a); if (!fx) return undefined; const reg = ns === 'pre' ? BS.PRE : BS.POST; return BS.fxParams(fx, reg)[b]; }
  };
  function setTarget(S, target, val) {
    const [ns, a, b] = target.split('.');
    if (ns === 'adjust' || ns === 'dither' || ns === 'color') S[ns][a] = val;
    else if (ns === 'algo') { S.algoParams[S.algo] = S.algoParams[S.algo] || {}; S.algoParams[S.algo][a] = val; }
    else if (ns === 'pre' || ns === 'post') { const fx = S[ns].find((f) => f.uid === a); if (fx) fx.p[b] = val; }
  }
  BS.layerValue = function (L, t) {
    const s = +L.start || 0, e = Math.max(s + 1e-3, +L.end || 0);
    let u = BS.clamp((t - s) / (e - s), 0, 1);
    if (L.mode === 'pingpong') u = u < 0.5 ? u * 2 : (1 - u) * 2;
    else if (L.mode === 'repeat') u = t < s ? 0 : BS.fract((t - s) / (e - s));
    const f = BS.ease[L.ease] || BS.ease.linear;
    return +L.from + (+L.to - +L.from) * f(u);
  };
  BS.animatedTargets = (S) => new Set(S.anim && S.anim.on ? S.anim.layers.filter((l) => l.on !== false).map((l) => l.target) : []);
  BS.evalSettings = function (S, t) {
    if (!S.anim || !S.anim.on || !S.anim.layers.length) return S;
    const o = BS.clone(S);
    for (const L of S.anim.layers) if (L.on !== false) setTarget(o, L.target, BS.layerValue(L, t));
    return o;
  };

  // ---------- Renderer ----------
  const mk = () => document.createElement('canvas');
  BS.Renderer = class {
    constructor() {
      this.g = mk(); this.gc = this.g.getContext('2d', { willReadFrequently: true });
      this.d = mk(); this.dc = this.d.getContext('2d');
      this.baseKey = ''; this.base = null;
    }
    sample(src, gw, gh) {
      const key = src.key + '|' + gw + 'x' + gh;
      if (this.baseKey === key && this.base) return this.base;
      const c = this.g; c.width = gw; c.height = gh; const x = this.gc;
      x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
      x.clearRect(0, 0, gw, gh);
      // progressive halving for large reductions (better quality than one big step)
      let el = src.el, ew = src.w, eh = src.h;
      while (ew > gw * 2.5 && eh > gh * 2.5) {
        const t = mk(); t.width = Math.max(gw, Math.round(ew / 2)); t.height = Math.max(gh, Math.round(eh / 2));
        const tx = t.getContext('2d'); tx.imageSmoothingQuality = 'high'; tx.drawImage(el, 0, 0, t.width, t.height);
        el = t; ew = t.width; eh = t.height;
      }
      x.drawImage(el, 0, 0, gw, gh);
      const d = x.getImageData(0, 0, gw, gh).data; const n = gw * gh;
      const r = new Float32Array(n), g = new Float32Array(n), b = new Float32Array(n), a = new Float32Array(n);
      for (let i = 0; i < n; i++) { r[i] = d[i * 4] / 255; g[i] = d[i * 4 + 1] / 255; b[i] = d[i * 4 + 2] / 255; a[i] = d[i * 4 + 3] / 255; }
      this.base = { r, g, b, a }; this.baseKey = key;
      return this.base;
    }
    gridSize(src, S, o) {
      const ps = Math.max(0.25, +S.dither.pixelSize || 1);
      const detail = o.detail || 1;
      let gw = Math.max(1, Math.round((src.w / ps) * detail)), gh = Math.max(1, Math.round((src.h / ps) * detail));
      let reduced = false;
      if (o.maxGrid && gw * gh > o.maxGrid) { const f = Math.sqrt(o.maxGrid / (gw * gh)); gw = Math.max(1, Math.round(gw * f)); gh = Math.max(1, Math.round(gh * f)); reduced = true; }
      return { gw, gh, reduced, k: gw / (src.w / ps) };
    }
    // Returns { canvas, gw, gh, grid (RGBA at grid res), reduced, ms }
    render(src, S, o) {
      o = o || {};
      const t0 = performance.now();
      const { gw, gh, reduced, k } = this.gridSize(src, S, o);
      const base = this.sample(src, gw, gh);
      const n = gw * gh;
      const ctx = { w: gw, h: gh, k, r: base.r.slice(), g: base.g.slice(), b: base.b.slice(), a: base.a.slice(), time: o.time || 0, frame: o.frame || 0, seed: (S.dither.seed | 0) + 1, d: S.dither, S, frameSeed: 0 };
      BS.applyAdjust(ctx, S.adjust);
      for (const fx of S.pre || []) if (fx.on && BS.PRE[fx.type]) BS.PRE[fx.type].run(ctx, BS.fxParams(fx, BS.PRE, k), ctx);
      BS.computeL(ctx);
      if (S.color.mode === 'mono' && (+S.color.cycles || 1) !== 1) {
        const cy = +S.color.cycles, L = ctx.L;
        for (let i = 0; i < n; i++) {
          const v = BS.clamp(L[i], 0, 1) * cy;
          L[i] = S.color.mirrorCycles ? 1 - Math.abs((BS.fract(v / 2) * 2) - 1) : v >= cy ? 1 : BS.fract(v);
        }
      }
      ctx.q = BS.buildQuant(S);
      ctx.out = new Uint8ClampedArray(n * 4);
      const algo = BS.ALGO[S.algo] || BS.ALGO.floyd;
      const p = BS.algoParams(S, algo.id, k);
      ctx.p = p;
      algo.run(ctx, p);
      const out = ctx.out, A = ctx.a, keep = S.color.keepAlpha !== false;
      for (let i = 0; i < n; i++) out[i * 4 + 3] = keep ? (A[i] >= 0.5 ? 255 : 0) : 255;
      this.d.width = gw; this.d.height = gh;
      this.dc.putImageData(new ImageData(out, gw, gh), 0, 0);

      // ---- output ----
      const W = Math.max(1, Math.round(o.outW || gw)), H = Math.max(1, Math.round(o.outH || gh));
      const oc = o.target || mk();
      if (oc.width !== W) oc.width = W;
      if (oc.height !== H) oc.height = H;
      const hasPost = (S.post || []).some((f) => f.on && BS.POST[f.type]);
      const x = oc.getContext('2d', { willReadFrequently: hasPost });
      x.imageSmoothingEnabled = false;
      let dx = 0, dy = 0, dw = W, dh = H;
      const fit = o.fit || 'stretch';
      if (fit !== 'stretch') {
        const s = fit === 'cover' ? Math.max(W / gw, H / gh) : Math.min(W / gw, H / gh);
        dw = gw * s; dh = gh * s; dx = (W - dw) / 2; dy = (H - dh) / 2;
      }
      x.clearRect(0, 0, W, H);
      if (o.bg) { x.fillStyle = o.bg; x.fillRect(0, 0, W, H); }
      x.drawImage(this.d, dx, dy, dw, dh);
      if (hasPost) {
        const id = x.getImageData(0, 0, W, H);
        const info = { time: o.time || 0, frame: o.frame || 0, unit: Math.max(0.05, dw / 1000) };
        for (const fx of S.post) if (fx.on && BS.POST[fx.type]) BS.POST[fx.type].run(id.data, W, H, BS.fxParams(fx, BS.POST), info);
        x.putImageData(id, 0, 0);
      }
      return { canvas: oc, gw, gh, grid: out, reduced, k, ms: performance.now() - t0 };
    }
  };
})();
