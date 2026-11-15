/* BitSkull — application controller */
(function () {
  'use strict';
  const BS = window.BS, UI = BS.UI, el = UI.el;
  const $ = (id) => document.getElementById(id);

  const App = (BS.App = {
    S: BS.normalizeSettings(BS.store.get('settings', null)),
    src: null,
    renderer: new BS.Renderer(),
    thumbR: new BS.Renderer(),
    view: { zoom: 1, px: 0, py: 0, split: 0.5, compare: false },
    t: 0, playing: false, loop: true,
    hist: [], fut: [], snap: null,
    cat: 'All', search: '',
    updMode: 'live', quality: 'normal', adaptive: true,
    userPresets: BS.store.get('presets', []),
    userPalettes: BS.store.get('palettes', []),
    locks: BS.store.get('locks', { algo: false, dither: false, palette: false }),
    lastRes: null, dirty: false,
  });
  App.snap = JSON.stringify(App.S);
  const QCAP = { draft: 350e3, normal: 1.2e6, high: 4e6, full: 0 };

  // =============== Source handling ===============
  let srcSeq = 0;
  function frameIndexAt(s, t) {
    if (!s.total) return 0;
    let tt = ((t % s.total) + s.total) % s.total, acc = 0;
    for (let i = 0; i < s.delays.length; i++) { acc += s.delays[i]; if (tt < acc) return i; }
    return s.frames.length - 1;
  }
  App.handle = function (t) {
    const s = App.src; if (!s) return null;
    if (s.type === 'video') return { el: s.el, w: s.w, h: s.h, key: s.id + '@' + s.el.currentTime.toFixed(4) };
    if (s.type === 'frames') { const i = frameIndexAt(s, t == null ? App.t : t); return { el: s.frames[i], w: s.w, h: s.h, key: s.id + '#' + i }; }
    return { el: s.el, w: s.w, h: s.h, key: s.id };
  };
  App.isTimed = () => !!App.src && (App.src.type !== 'image' || App.S.anim.on);
  App.duration = () => { const s = App.src; if (!s) return App.S.anim.duration; if (s.type === 'video') return s.duration || 1; if (s.type === 'frames') return s.total; return Math.max(0.1, +App.S.anim.duration || 4); };
  App.fps = () => Math.max(1, Math.round(+App.S.anim.fps || 24));

  async function setSource(src) {
    if (App.src && App.src.type === 'video') { App.src.el.pause(); URL.revokeObjectURL(App.src.el.src); }
    stop();
    src.id = 's' + ++srcSeq;
    App.src = src; App.t = 0;
    $('empty').hidden = true;
    $('srcInfo').textContent = `${src.name || 'Untitled'} · ${src.w}×${src.h}` + (src.type === 'video' ? ` · video ${BS.fmtTime(src.duration)}` : src.type === 'frames' ? ` · ${src.frames.length} frames` : '');
    if (src.type === 'video' || src.type === 'frames') App.S.anim.fps = src.type === 'frames' ? Math.min(60, Math.round(src.frames.length / src.total)) || 24 : App.S.anim.fps;
    fitView();
    drawOriginal(true);
    buildTimeline();
    requestRender(true);
    scheduleThumbs();
  }
  App.setSource = setSource;

  async function loadImageFile(f) {
    let bmp;
    try { bmp = await createImageBitmap(f, { imageOrientation: 'from-image' }); }
    catch (e) {
      const url = URL.createObjectURL(f); const img = new Image(); img.src = url;
      await img.decode().catch(() => { throw new Error('Could not read this image'); }); bmp = img;
    }
    const w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight;
    const maxSide = 8192; let el2 = bmp, W = w, H = h;
    if (Math.max(w, h) > maxSide) { const s = maxSide / Math.max(w, h); W = Math.round(w * s); H = Math.round(h * s); const c = document.createElement('canvas'); c.width = W; c.height = H; c.getContext('2d').drawImage(bmp, 0, 0, W, H); el2 = c; UI.toast('Large image downsized to ' + W + '×' + H); }
    await setSource({ type: 'image', el: el2, w: W, h: H, name: f.name });
  }
  async function decodeGif(f) {
    if (!('ImageDecoder' in window)) return null;
    try {
      const dec = new ImageDecoder({ data: await f.arrayBuffer(), type: 'image/gif' });
      await dec.tracks.ready; const n = Math.min(600, dec.tracks.selectedTrack.frameCount);
      if (n < 2) return null;
      const frames = [], delays = [];
      for (let i = 0; i < n; i++) { const r = await dec.decode({ frameIndex: i }); const vf = r.image; frames.push(await createImageBitmap(vf)); delays.push(Math.max(0.02, (vf.duration || 100000) / 1e6)); vf.close(); }
      dec.close();
      return { frames, delays };
    } catch (e) { console.warn(e); return null; }
  }
  function setFrames(frames, delays, name) {
    const total = delays.reduce((a, b) => a + b, 0);
    return setSource({ type: 'frames', frames, delays, total, w: frames[0].width, h: frames[0].height, name });
  }
  async function loadVideoFile(f) {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.loop = false; v.crossOrigin = 'anonymous';
    v.src = URL.createObjectURL(f);
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('This video format can’t be decoded by the browser (try MP4/H.264 or WebM)')); });
    v.addEventListener('seeked', () => { if (!App.playing) { drawOriginal(); requestRender(true); } });
    await setSource({ type: 'video', el: v, w: v.videoWidth, h: v.videoHeight, duration: v.duration, name: f.name });
  }
  async function loadFile(f) {
    if (!f) return;
    const n = f.name.toLowerCase();
    try {
      if (n.endsWith('.json') || n.endsWith('.bitskull')) return loadProject(await f.text());
      if (/\.(gpl|hex|txt)$/.test(n)) return importPaletteText(await f.text(), f.name);
      if ((f.type || '').startsWith('video/') || /\.(mp4|webm|mov|m4v|mkv|ogv)$/.test(n)) return await loadVideoFile(f);
      if (f.type === 'image/gif' || n.endsWith('.gif')) { const g = await decodeGif(f); if (g) return setFrames(g.frames, g.delays, f.name); }
      if ((f.type || '').startsWith('image/') || /\.(png|jpe?g|webp|bmp|avif|gif|svg|ico|tiff?)$/.test(n)) return await loadImageFile(f);
      UI.toast('Unsupported file: ' + f.name, true);
    } catch (e) { console.error(e); UI.toast(e.message || String(e), true); }
  }
  App.loadFile = loadFile;
  async function loadSequence(files) {
    files = files.filter((f) => (f.type || '').startsWith('image/')).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (!files.length) return;
    if (files.length === 1) return loadImageFile(files[0]);
    const frames = []; for (const f of files) frames.push(await createImageBitmap(f));
    const d = 1 / App.fps();
    setFrames(frames, frames.map(() => d), files[0].name + ` (+${files.length - 1})`);
  }

  function demoImage() {
    const W = 1200, H = 800; const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
    let g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#1a1446'); g.addColorStop(0.45, '#c2408c'); g.addColorStop(0.62, '#ffb35c'); g.addColorStop(1, '#2a1a3a');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    g = x.createRadialGradient(820, 330, 10, 820, 330, 190); g.addColorStop(0, '#fff6c8'); g.addColorStop(0.6, '#ffcf5a'); g.addColorStop(1, 'rgba(255,140,60,0)');
    x.fillStyle = g; x.beginPath(); x.arc(820, 330, 190, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#ffd36b'; for (let i = 0; i < 7; i++) { x.globalAlpha = 0.9; x.fillRect(630, 300 + i * 26, 380, 6 + i * 1.5); }
    x.globalAlpha = 1;
    x.fillStyle = '#1b1035'; x.beginPath(); x.moveTo(0, 560);
    for (let i = 0; i <= 24; i++) x.lineTo((i / 24) * W, 520 - Math.abs(Math.sin(i * 1.7)) * 160 - (i % 3) * 20);
    x.lineTo(W, H); x.lineTo(0, H); x.fill();
    g = x.createLinearGradient(0, 560, 0, H); g.addColorStop(0, '#2b1a4a'); g.addColorStop(1, '#0b0716'); x.fillStyle = g; x.fillRect(0, 600, W, 200);
    x.strokeStyle = 'rgba(255,80,200,.7)'; x.lineWidth = 2;
    for (let i = 0; i < 12; i++) { const y = 600 + Math.pow(i / 12, 2) * 200; x.beginPath(); x.moveTo(0, y); x.lineTo(W, y); x.stroke(); }
    for (let i = -12; i <= 12; i++) { x.beginPath(); x.moveTo(W / 2 + i * 20, 600); x.lineTo(W / 2 + i * 140, H); x.stroke(); }
    g = x.createRadialGradient(290, 380, 20, 330, 420, 170); g.addColorStop(0, '#e9fbff'); g.addColorStop(0.35, '#6fd6ff'); g.addColorStop(1, '#0a1f4a');
    x.fillStyle = g; x.beginPath(); x.arc(330, 420, 150, 0, Math.PI * 2); x.fill();
    x.font = '900 120px Consolas, monospace'; x.textAlign = 'center'; x.fillStyle = '#fff'; x.shadowColor = '#ff2bd6'; x.shadowBlur = 30; x.fillText('BITSKULL', W / 2, 160); x.shadowBlur = 0;
    for (let i = 0; i < 16; i++) { const v = Math.round((i / 15) * 255); x.fillStyle = `rgb(${v},${v},${v})`; x.fillRect(40 + i * 70, 735, 70, 40); }
    return c;
  }
  App.loadDemo = () => setSource({ type: 'image', el: demoImage(), w: 1200, h: 800, name: 'demo.png' });

  // =============== Rendering ===============
  App.raf = 0;
  function requestRender(force) {
    if (!App.src) return;
    if (App.updMode === 'manual' && !force) { App.dirty = true; $('stats').textContent = 'Changes pending — press Enter to render'; return; }
    if (App.raf) return;
    App.raf = requestAnimationFrame(renderNow);
  }
  App.requestRender = requestRender;
  function renderNow() {
    App.raf = 0; App.dirty = false;
    const h = App.handle(); if (!h) return;
    const S = BS.evalSettings(App.S, App.t);
    let cap = QCAP[App.quality];
    if (App.adaptive && (BS.dragging || App.playing)) cap = cap ? Math.min(cap, App.playing ? 600e3 : 450e3) : 600e3;
    const g = App.renderer.gridSize(h, S, { maxGrid: cap });
    let k = 1;
    if (S.post.some((f) => f.on)) {
      const vp = $('viewport'); const target = Math.min(vp.clientWidth * (window.devicePixelRatio || 1), 2400);
      k = Math.max(1, Math.min(4, Math.round(target / g.gw)));
      while (k > 1 && g.gw * k * g.gh * k > 3.5e6) k--;
    }
    try {
      const res = App.renderer.render(h, S, { maxGrid: cap, outW: g.gw * k, outH: g.gh * k, time: App.t, frame: Math.floor(App.t * App.fps()), target: $('viewCanvas') });
      App.lastRes = res;
      $('stats').textContent = `grid ${res.gw}×${res.gh}${res.reduced ? ' (preview)' : ''} · ${res.ms.toFixed(0)} ms` + (App.isTimed() ? ` · ${BS.fmtTime(App.t)}` : '');
    } catch (e) { console.error(e); UI.toast('Render error: ' + e.message, true); }
    layoutView();
    if (App.isTimed()) updateTimeUI();
  }
  App.renderNow = renderNow;

  let origKey = '';
  function drawOriginal(force) {
    const h = App.handle(); if (!h) return;
    if (!force && h.key === origKey) return; origKey = h.key;
    const c = $('origCanvas'); const s = Math.min(1, 1600 / Math.max(h.w, h.h));
    c.width = Math.round(h.w * s); c.height = Math.round(h.h * s);
    const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(h.el, 0, 0, c.width, c.height);
  }

  // =============== View (zoom / pan / compare) ===============
  function baseSize() {
    const vp = $('viewport'); const s = App.src; if (!s) return { W: 1, H: 1, bw: 1, bh: 1 };
    const W = vp.clientWidth, H = vp.clientHeight; const f = Math.min((W - 32) / s.w, (H - 32) / s.h);
    return { W, H, bw: s.w * f, bh: s.h * f };
  }
  function layoutView() {
    if (!App.src) return;
    const { W, H, bw, bh } = baseSize(); const v = App.view;
    const dw = bw * v.zoom, dh = bh * v.zoom;
    const wrap = $('canvasWrap');
    wrap.style.width = dw + 'px'; wrap.style.height = dh + 'px';
    wrap.style.left = (W - dw) / 2 + v.px + 'px'; wrap.style.top = (H - dh) / 2 + v.py + 'px';
    $('viewCanvas').style.clipPath = v.compare ? `inset(0 0 0 ${(v.split * 100).toFixed(2)}%)` : '';
    $('splitLine').style.left = v.split * 100 + '%';
    $('zoomLabel').textContent = Math.abs(v.zoom - 1) < 1e-3 && !v.px && !v.py ? 'Fit' : Math.round(v.zoom * (bw / App.src.w) * 100) + '%';
  }
  App.layoutView = layoutView;
  function fitView() { App.view.zoom = 1; App.view.px = 0; App.view.py = 0; layoutView(); }
  function zoomBy(f, cx, cy) {
    const { W, H, bw, bh } = baseSize(); const v = App.view;
    const oldW = bw * v.zoom, oldH = bh * v.zoom; const left = (W - oldW) / 2 + v.px, top = (H - oldH) / 2 + v.py;
    if (cx == null) { cx = W / 2; cy = H / 2; }
    const nz = BS.clamp(v.zoom * f, 0.1, 64); const r = nz / v.zoom;
    const nl = cx - (cx - left) * r, nt = cy - (cy - top) * r;
    v.zoom = nz; v.px = nl - (W - bw * nz) / 2; v.py = nt - (H - bh * nz) / 2;
    layoutView(); hud('Zoom ' + Math.round(nz * (bw / App.src.w) * 100) + '%');
  }
  function zoom1to1() {
    if (!App.lastRes || !App.src) return; const { bw } = baseSize();
    App.view.zoom = App.lastRes.gw / (window.devicePixelRatio || 1) / bw; App.view.px = 0; App.view.py = 0; layoutView(); hud('1:1 dither pixels');
  }
  let hudT = 0;
  function hud(t) { const h = $('hud'); h.textContent = t; h.classList.add('show'); clearTimeout(hudT); hudT = setTimeout(() => h.classList.remove('show'), 1100); }
  App.hud = hud;
  function setCompare(on) { App.view.compare = on; document.body.classList.toggle('compare', on); $('cmpBtn').classList.toggle('on', on); drawOriginal(); layoutView(); }

  // =============== History ===============
  let saveT = 0;
  function commit() {
    const now = JSON.stringify(App.S);
    if (now !== App.snap) { App.hist.push(App.snap); if (App.hist.length > 150) App.hist.shift(); App.fut = []; App.snap = now; }
    clearTimeout(saveT); saveT = setTimeout(() => BS.store.set('settings', App.S), 400);
  }
  App.commit = commit;
  function undo() { if (!App.hist.length) return hud('Nothing to undo'); App.fut.push(App.snap); App.snap = App.hist.pop(); App.S = BS.normalizeSettings(JSON.parse(App.snap)); rebuildAll(); requestRender(true); hud('Undo'); }
  function redo() { if (!App.fut.length) return hud('Nothing to redo'); App.hist.push(App.snap); App.snap = App.fut.pop(); App.S = BS.normalizeSettings(JSON.parse(App.snap)); rebuildAll(); requestRender(true); hud('Redo'); }

  // generic setters
  function live(fn) { fn(App.S); if (App.updMode === 'live') requestRender(); }
  function done(fn) { fn(App.S); requestRender(App.updMode !== 'manual'); commit(); }
  const isAnim = (t) => BS.animatedTargets(App.S).has(t);

  // =============== Panels ===============
  const CAT_SHORT = { All: 'All', 'Error Diffusion': 'Diffusion', Ordered: 'Ordered', Pattern: 'Pattern', Halftone: 'Halftone', Glitch: 'Glitch', Special: 'Special' };
  function visibleAlgos() {
    const q = App.search.trim().toLowerCase();
    return BS.ALGOS.filter((a) => (App.cat === 'All' || a.cat === App.cat) && (!q || a.name.toLowerCase().includes(q) || a.cat.toLowerCase().includes(q)));
  }
  function buildAlgoPanel() {
    const S = App.S; const a = BS.ALGO[S.algo];
    $('algoName').textContent = a.name; $('algoCat').textContent = a.cat;
    $('algoCount').textContent = BS.ALGOS.length;
    const chips = $('catChips'); chips.innerHTML = '';
    ['All', ...BS.ALGO_CATS].forEach((c) => chips.append(el('button', { class: c === App.cat ? 'on' : '', onclick: () => { App.cat = c; buildAlgoPanel(); } }, CAT_SHORT[c])));
    const list = $('algoList'); list.innerHTML = '';
    let lastCat = '';
    for (const al of visibleAlgos()) {
      if (al.cat !== lastCat) { list.append(el('div', { class: 'grp-h' }, al.cat)); lastCat = al.cat; }
      list.append(el('button', { class: al.id === S.algo ? 'on' : '', onclick: () => setAlgo(al.id) }, al.name));
    }
    const on = list.querySelector('.on');
    if (on) { const top = on.offsetTop - 26, bot = on.offsetTop + on.offsetHeight; if (top < list.scrollTop || bot > list.scrollTop + list.clientHeight) list.scrollTop = Math.max(0, on.offsetTop - list.clientHeight / 2); }
    const box = $('algoParams'); box.innerHTML = '';
    const vals = BS.algoParams(S, a.id);
    for (const p of a.params) {
      box.append(UI.param(p, {
        value: vals[p.k], animated: isAnim('algo.' + p.k),
        onInput: (v) => live((S) => { (S.algoParams[a.id] = S.algoParams[a.id] || {})[p.k] = v; }),
        onChange: (v) => done((S) => { (S.algoParams[a.id] = S.algoParams[a.id] || {})[p.k] = v; }),
      }));
    }
    if (a.params.length) box.append(el('button', { class: 'link', style: 'align-self:flex-end', onclick: () => done((S) => { delete S.algoParams[a.id]; }) || buildAlgoPanel() }, 'Reset algorithm settings'));
  }
  function setAlgo(id, quiet) {
    if (!BS.ALGO[id]) return;
    App.S.algo = id; buildAlgoPanel(); buildDitherPanel(); requestRender(true); commit();
    if (!quiet) hud(BS.ALGO[id].name);
  }
  App.setAlgo = setAlgo;
  function stepAlgo(d) {
    const list = visibleAlgos().length ? visibleAlgos() : BS.ALGOS;
    let i = list.findIndex((a) => a.id === App.S.algo);
    i = i < 0 ? 0 : (i + d + list.length) % list.length;
    setAlgo(list[i].id);
  }
  function stepCat(d) { const cats = ['All', ...BS.ALGO_CATS]; let i = cats.indexOf(App.cat); App.cat = cats[(i + d + cats.length) % cats.length]; buildAlgoPanel(); hud('Category: ' + App.cat); }

  function buildDitherPanel() {
    const S = App.S; const a = BS.ALGO[S.algo]; const box = $('ditherCtl'); box.innerHTML = '';
    const strengthLabel = a.kind === 'diffusion' ? 'Error diffusion' : a.kind === 'threshold' ? 'Pattern spread' : 'Strength';
    const defs = [
      { k: 'pixelSize', l: 'Pixel size', min: 0.5, max: 32, step: 0.25, d: 2 },
      { k: 'strength', l: strengthLabel, min: 0, max: 2, step: 0.01, d: 1 },
      { k: 'bias', l: 'Threshold bias', min: -1, max: 1, step: 0.01, d: 0 },
      { k: 'jitter', l: 'Jitter', min: 0, max: 1, step: 0.01, d: 0 },
      { k: 'seed', l: 'Seed', min: 1, max: 9999, step: 1, d: 1 },
    ];
    if (a.kind === 'diffusion') defs.splice(4, 0, { k: 'serpentine', l: 'Serpentine scan', type: 'bool', d: true });
    for (const d of defs) box.append(UI.param(d, { value: S.dither[d.k], animated: isAnim('dither.' + d.k), onInput: (v) => live((S) => { S.dither[d.k] = v; }), onChange: (v) => done((S) => { S.dither[d.k] = v; }) }));
  }
  function buildColorPanel() {
    const S = App.S; document.querySelectorAll('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === S.color.mode));
    const box = $('colorCtl'); box.innerHTML = ''; const c = S.color;
    const add = (d) => box.append(UI.param(d, { value: c[d.k], animated: isAnim('color.' + d.k), onInput: (v) => live((S) => { S.color[d.k] = v; }), onChange: (v) => { done((S) => { S.color[d.k] = v; }); if (d.rebuild) buildColorPanel(); } }));
    if (c.mode === 'mono') {
      add({ k: 'order', l: 'Palette order', type: 'select', opts: [['luma', 'Dark → light'], ['custom', 'As listed']], d: 'luma' });
      add({ k: 'cycles', l: 'Luma cycles', min: 1, max: 32, step: 0.05, d: 1 });
      add({ k: 'mirrorCycles', l: 'Mirror cycles', type: 'bool', d: false });
      add({ k: 'invert', l: 'Invert palette', type: 'bool', d: false });
    } else if (c.mode === 'palette') {
      add({ k: 'metric', l: 'Colour matching', type: 'select', opts: [['weighted', 'Weighted RGB'], ['rgb', 'Plain RGB'], ['oklab', 'Perceptual (OKLab)']], d: 'weighted' });
    } else {
      add({ k: 'rgbLevels', l: 'Levels per channel', min: 2, max: 8, step: 1, d: 2 });
    }
    add({ k: 'keepAlpha', l: 'Keep transparency', type: 'bool', d: true });
  }
  function setMode(m) { done((S) => { S.color.mode = m; }); buildColorPanel(); hud('Colour: ' + m); }

  function buildPalettePanel() {
    const S = App.S; const sel = $('palSelect'); sel.innerHTML = '';
    const groups = {};
    BS.PALETTES.forEach((p, i) => { (groups[p.cat] = groups[p.cat] || []).push(el('option', { value: 'b' + i }, `${p.name} (${p.colors.length})`)); });
    sel.append(el('option', { value: '' }, S.palette.name ? `● ${S.palette.name}` : '● Custom'));
    if (App.userPalettes.length) sel.append(el('optgroup', { label: 'My palettes' }, App.userPalettes.map((p, i) => el('option', { value: 'u' + i }, `${p.name} (${p.colors.length})`))));
    for (const [g, opts] of Object.entries(groups)) sel.append(el('optgroup', { label: g }, opts));
    sel.value = '';
    const sw = $('swatches'); sw.innerHTML = '';
    S.palette.colors.forEach((hex, i) => {
      const locked = !!S.palette.locks[i];
      const inp = el('input', { type: 'color', value: hex, title: hex + ' — click to edit' });
      inp.addEventListener('input', () => { d.style.background = inp.value; live((S) => { S.palette.colors[i] = inp.value; S.palette.name = ''; }); });
      inp.addEventListener('change', () => { done((S) => { S.palette.colors[i] = inp.value; S.palette.name = ''; }); });
      const lk = el('button', { class: 'sw-lock' + (locked ? ' on' : ''), title: 'Lock colour', onclick: (e) => { e.stopPropagation(); App.S.palette.locks[i] = !App.S.palette.locks[i]; commit(); buildPalettePanel(); } }, locked ? '🔒' : '🔓');
      const del = S.palette.colors.length > 2 ? el('button', { class: 'sw-del', title: 'Remove', onclick: (e) => { e.stopPropagation(); done((S) => { S.palette.colors.splice(i, 1); S.palette.locks.splice(i, 1); S.palette.name = ''; }); buildPalettePanel(); } }, '✕') : null;
      const d = el('div', { class: 'sw', style: `background:${hex}` }, inp, lk, del);
      sw.append(d);
    });
  }
  function setPalette(colors, name) {
    done((S) => { S.palette = { name: name || '', colors: colors.slice(0, 256), locks: colors.slice(0, 256).map(() => false) }; });
    buildPalettePanel();
  }
  App.setPalette = setPalette;
  function stepPalette(d) {
    const i = BS.PALETTES.findIndex((p) => p.name === App.S.palette.name);
    const n = BS.PALETTES.length; const j = i < 0 ? 0 : (i + d + n) % n;
    setPalette(BS.PALETTES[j].colors, BS.PALETTES[j].name); hud('Palette: ' + BS.PALETTES[j].name);
  }
  function shufflePalette() {
    const P = App.S.palette; const n = P.colors.length;
    const rnd = BS.randomPalette(n);
    done((S) => { S.palette.colors = S.palette.colors.map((c, i) => (S.palette.locks[i] ? c : rnd[i])); S.palette.name = ''; });
    buildPalettePanel(); hud('Palette shuffled');
  }
  function importPaletteText(text, name) {
    const cols = BS.parsePaletteText(text);
    if (cols.length < 2) return UI.toast('No colours found in ' + (name || 'file'), true);
    setPalette(cols, (name || 'Imported').replace(/\.\w+$/, '')); UI.toast(`Imported ${cols.length} colours`);
  }

  function buildAdjustPanel() {
    const S = App.S; const box = $('adjustCtl'); box.innerHTML = '';
    for (const d of BS.ADJUST) {
      box.append(UI.param(d, {
        value: S.adjust[d.k], lockable: true, locked: !!S.adjustLocks[d.k], animated: isAnim('adjust.' + d.k),
        onLock: (on) => { App.S.adjustLocks[d.k] = on; commit(); },
        onInput: (v) => live((S) => { S.adjust[d.k] = v; }), onChange: (v) => done((S) => { S.adjust[d.k] = v; }),
      }));
    }
  }

  function buildFxPanel(ns) {
    const reg = ns === 'pre' ? BS.PRE : BS.POST; const S = App.S;
    const add = $(ns + 'Add'); add.innerHTML = '';
    add.append(el('option', { value: '' }, ns === 'pre' ? '＋ Add distortion…' : '＋ Add effect…'));
    for (const [k, d] of Object.entries(reg)) add.append(el('option', { value: k }, d.name));
    add.onchange = () => { const t = add.value; add.value = ''; if (!t) return; done((S) => { S[ns].push(BS.newFx(reg, t)); }); buildFxPanel(ns); buildTimeline(); if (reg[t].anim && !App.isTimed()) UI.toast(reg[t].name + ' moves over time — use Animation › Convert to animation to see it play'); };
    const list = $(ns + 'List'); list.innerHTML = '';
    S[ns].forEach((fx, idx) => {
      const def = reg[fx.type]; if (!def) return;
      const vals = BS.fxParams(fx, reg);
      const cb = el('input', { type: 'checkbox', title: 'Enable' }); cb.checked = fx.on;
      cb.addEventListener('change', () => { done((S) => { S[ns][idx].on = cb.checked; }); card.classList.toggle('off', !cb.checked); });
      const move = (d) => { const j = idx + d; if (j < 0 || j >= S[ns].length) return; done((S) => { const a = S[ns]; [a[idx], a[j]] = [a[j], a[idx]]; }); buildFxPanel(ns); };
      const head = el('div', { class: 'fx-h' }, cb,
        el('span', { class: 'name', title: 'Collapse / expand', onclick: () => card.classList.toggle('collapsed') }, def.name),
        el('button', { title: 'Move up', onclick: () => move(-1) }, '↑'), el('button', { title: 'Move down', onclick: () => move(1) }, '↓'),
        el('button', { title: 'Duplicate', onclick: () => { done((S) => { const c = BS.clone(S[ns][idx]); c.uid = BS.uid(); S[ns].splice(idx + 1, 0, c); }); buildFxPanel(ns); } }, '⧉'),
        el('button', { title: 'Remove', onclick: () => { done((S) => { S[ns].splice(idx, 1); }); buildFxPanel(ns); buildTimeline(); } }, '✕'));
      const params = el('div', { class: 'params' });
      for (const p of def.params) {
        params.append(UI.param(p, { value: vals[p.k], animated: isAnim(`${ns}.${fx.uid}.${p.k}`), onInput: (v) => live((S) => { S[ns][idx].p[p.k] = v; }), onChange: (v) => done((S) => { S[ns][idx].p[p.k] = v; }) }));
      }
      const card = el('div', { class: 'fx' + (fx.on ? '' : ' off') }, head, params);
      list.append(card);
    });
  }

  // =============== Presets ===============
  let thumbJob = 0;
  function presetList() {
    const q = ($('presetSearch').value || '').toLowerCase();
    const all = App.userPresets.map((p, i) => ({ p, user: i })).concat(BS.PRESETS.map((p) => ({ p, user: -1 })));
    return all.filter(({ p }) => !q || p.name.toLowerCase().includes(q) || (p.tags || '').includes(q));
  }
  function buildPresetPanel() {
    const grid = $('presetGrid'); grid.innerHTML = '';
    const items = presetList();
    $('presetCount').textContent = BS.PRESETS.length + App.userPresets.length;
    for (const it of items) {
      const c = el('canvas', { width: 96, height: 72 });
      const card = el('div', { class: 'preset' + (it.user >= 0 ? ' user' : ''), title: it.p.name + (it.p.tags ? ' — ' + it.p.tags : ''), onclick: () => applyPresetObj(it.p) }, c, el('span', null, it.p.name));
      if (it.user >= 0) card.append(el('button', { class: 'del', title: 'Delete preset', onclick: (e) => { e.stopPropagation(); if (!confirm('Delete preset “' + it.p.name + '”?')) return; App.userPresets.splice(it.user, 1); BS.store.set('presets', App.userPresets); buildPresetPanel(); } }, '✕'));
      it.canvas = c;
      grid.append(card);
    }
    scheduleThumbs(items);
  }
  function scheduleThumbs(items) {
    items = items || null;
    const job = ++thumbJob;
    setTimeout(async () => {
      if (job !== thumbJob) return;
      if (!items) { buildPresetPanel(); return; }
      if (!App.src) return;
      const h = App.handle(0); const tc = document.createElement('canvas');
      const s = Math.min(1, 360 / Math.max(h.w, h.h)); tc.width = Math.round(h.w * s); tc.height = Math.round(h.h * s);
      tc.getContext('2d').drawImage(h.el, 0, 0, tc.width, tc.height);
      const th = { el: tc, w: h.w, h: h.h, key: 'thumb' + h.key };
      for (const it of items) {
        if (job !== thumbJob) return;
        try {
          const S = BS.applyPreset(App.S, it.p);
          const g = App.thumbR.gridSize(th, S, { maxGrid: 96 * 72 });
          const res = App.thumbR.render(th, S, { maxGrid: 96 * 72, outW: Math.max(g.gw, 96), outH: Math.max(g.gh, Math.round(96 * g.gh / g.gw)), time: 0.5 });
          const cx = it.canvas.getContext('2d'); cx.imageSmoothingEnabled = false; cx.clearRect(0, 0, 96, 72);
          const sc = Math.max(96 / res.canvas.width, 72 / res.canvas.height);
          cx.drawImage(res.canvas, (96 - res.canvas.width * sc) / 2, (72 - res.canvas.height * sc) / 2, res.canvas.width * sc, res.canvas.height * sc);
        } catch (e) { console.warn('thumb', it.p.name, e); }
        await BS.tick();
      }
    }, 120);
  }
  function applyPresetObj(p) {
    App.S = BS.applyPreset(App.S, p); rebuildAll(); requestRender(true); commit(); hud('Preset: ' + p.name);
  }
  function savePreset() {
    const name = prompt('Preset name:', 'My look ' + (App.userPresets.length + 1)); if (!name) return;
    const s = BS.clone(App.S); delete s.adjustLocks;
    App.userPresets.unshift({ name, tags: 'mine', s }); BS.store.set('presets', App.userPresets); buildPresetPanel(); UI.toast('Preset saved');
  }

  // =============== Randomize ===============
  function randomizeAll() {
    const r = Math.random; const S = App.S;
    if (!App.locks.algo) { const pool = BS.ALGOS.filter((a) => a.id !== 'posterize'); S.algo = pool[(r() * pool.length) | 0].id; S.algoParams[S.algo] = {}; const a = BS.ALGO[S.algo]; for (const p of a.params) if ((p.type || 'range') === 'range' && r() < 0.6) { const span = p.max - p.min; let v = p.min + span * (0.15 + r() * 0.5); v = Math.round(v / p.step) * p.step; S.algoParams[S.algo][p.k] = +v.toFixed(4); } }
    if (!App.locks.dither) { S.dither.pixelSize = [1, 1.5, 2, 2, 2, 3, 3, 4, 6][(r() * 9) | 0]; S.dither.strength = +(0.7 + r() * 0.5).toFixed(2); S.dither.bias = +((r() - 0.5) * 0.2).toFixed(2); S.dither.seed = 1 + ((r() * 999) | 0); }
    if (!App.locks.palette) {
      const anyLock = S.palette.locks.some(Boolean);
      if (anyLock) { const n = S.palette.colors.length; const rp = BS.randomPalette(n); S.palette.colors = S.palette.colors.map((c, i) => (S.palette.locks[i] ? c : rp[i])); S.palette.name = ''; }
      else if (r() < 0.65) { const p = BS.PALETTES[(r() * BS.PALETTES.length) | 0]; S.palette = { name: p.name, colors: p.colors.slice(), locks: p.colors.map(() => false) }; }
      else { const n = 2 + ((r() * 5) | 0); S.palette = { name: '', colors: BS.randomPalette(n), locks: new Array(n).fill(false) }; }
      S.color.mode = S.palette.colors.length > 4 && r() < 0.5 ? 'palette' : r() < 0.08 ? 'rgb' : 'mono';
    }
    randomizeAdjust(false);
    rebuildAll(); requestRender(true); commit(); hud('Randomized');
  }
  function randomizeAdjust(single) {
    const r = Math.random; const S = App.S; const L = S.adjustLocks;
    const set = (k, v) => { if (!L[k]) S.adjust[k] = +v.toFixed(2); };
    set('contrast', -0.1 + r() * 0.55); set('brightness', (r() - 0.5) * 0.3); set('gamma', 0.75 + r() * 0.6); set('saturation', (r() - 0.3) * 0.8);
    set('exposure', 0); set('shadows', (r() - 0.5) * 0.4); set('highlights', (r() - 0.5) * 0.4); set('midtones', (r() - 0.5) * 0.4);
    set('hue', r() < 0.2 ? (r() - 0.5) * 120 : 0); set('blur', 0); set('sharpen', r() < 0.3 ? r() * 1.2 : 0); set('noise', r() < 0.2 ? r() * 0.15 : 0);
    if (single) { buildAdjustPanel(); requestRender(true); commit(); hud('Adjustments randomized'); }
  }

  // =============== Timeline ===============
  function buildTimeline() {
    const tl = $('timeline'); const timed = App.isTimed();
    tl.hidden = !timed;
    if (!timed) { stop(); return; }
    const S = App.S; const isImg = App.src && App.src.type === 'image';
    $('tlDur').value = +App.duration().toFixed(2); $('tlDur').disabled = !isImg;
    $('tlFps').value = App.fps();
    $('tlClose').textContent = isImg ? 'Exit animation' : S.anim.on ? 'Layers: on' : 'Layers: off';
    $('tlLoop').classList.toggle('on', App.loop);
    const box = $('tlLayers'); box.innerHTML = '';
    if (!isImg && !S.anim.on && S.anim.layers.length) box.append(el('div', { class: 'muted small' }, 'Animation layers are switched off for this clip.'));
    if (!S.anim.layers.length) { box.append(el('div', { class: 'muted small' }, isImg ? 'No layers yet — add one to animate any slider (from → to over time), or add a Temporal Variation distortion.' : 'Playing the clip. Add layers to animate any slider over the clip’s time.')); updateTimeUI(); return; }
    box.append(el('div', { class: 'layer-head' }, el('span'), el('span', null, 'Property'), el('span', null, 'From'), el('span', null, 'To'), el('span', null, 'Start s'), el('span', null, 'End s'), el('span', null, 'Ease'), el('span', null, 'Mode'), el('span')));
    const targets = BS.animTargets(S); const dur = App.duration();
    S.anim.layers.forEach((L, i) => {
      const on = el('input', { type: 'checkbox', title: 'Enable layer' }); on.checked = L.on !== false;
      on.onchange = () => { done((S) => { S.anim.layers[i].on = on.checked; }); rebuildAll(); };
      const tsel = el('select', null, targets.map((t) => el('option', { value: t.t }, t.l)));
      if (!targets.find((t) => t.t === L.target)) tsel.append(el('option', { value: L.target }, L.target + ' (missing)'));
      tsel.value = L.target;
      tsel.onchange = () => { const t = targets.find((x) => x.t === tsel.value); done((S) => { const l = S.anim.layers[i]; l.target = tsel.value; if (t) { const cur = BS.getTarget(S, t.t); l.from = +(+cur || t.min).toFixed(3); l.to = +Math.min(t.max, (+cur || t.min) + (t.max - t.min) * 0.3).toFixed(3); } }); rebuildAll(); };
      const num = (k, step) => { const n = el('input', { type: 'number', step: step || 0.01, value: L[k] }); n.onchange = () => { done((S) => { S.anim.layers[i][k] = +n.value; }); buildTimeline(); }; return n; };
      const ease = el('select', null, BS.EASES.map(([v, t]) => el('option', { value: v }, t))); ease.value = L.ease || 'linear';
      ease.onchange = () => done((S) => { S.anim.layers[i].ease = ease.value; });
      const mode = el('select', null, [['once', 'Once'], ['pingpong', 'Ping-pong'], ['repeat', 'Repeat']].map(([v, t]) => el('option', { value: v }, t))); mode.value = L.mode || 'once';
      mode.onchange = () => done((S) => { S.anim.layers[i].mode = mode.value; });
      const x = el('button', { class: 'x', title: 'Delete layer', onclick: () => { done((S) => { S.anim.layers.splice(i, 1); }); rebuildAll(); } }, '✕');
      const s0 = BS.clamp(L.start / dur, 0, 1), e0 = BS.clamp(L.end / dur, 0, 1);
      const track = el('div', { class: 'track' }, el('i', { style: `left:${s0 * 100}%;width:${Math.max(0.5, (e0 - s0) * 100)}%` }), el('b', { class: 'ph', style: `left:${BS.clamp(App.t / dur, 0, 1) * 100}%` }));
      box.append(el('div', { class: 'layer' }, on, tsel, num('from'), num('to'), num('start', 0.1), num('end', 0.1), ease, mode, x, el('span'), track));
    });
    updateTimeUI();
  }
  function updateTimeUI() {
    const d = App.duration();
    $('tlTime').textContent = BS.fmtTime(App.t) + ' / ' + BS.fmtTime(d);
    if (!scrubbing) $('tlScrub').value = Math.round(BS.clamp(App.t / d, 0, 1) * 1000);
    $('tlPlay').textContent = App.playing ? '⏸' : '▶';
    document.querySelectorAll('.layer .ph').forEach((b) => { b.style.left = BS.clamp(App.t / d, 0, 1) * 100 + '%'; });
  }
  function addLayer() {
    if (!App.src) return;
    if (!App.isTimed()) convertToAnimation(true);
    const S = App.S; const dur = App.duration();
    done((S) => { S.anim.on = true; S.anim.layers.push({ id: BS.uid(), target: 'adjust.contrast', from: +(+S.adjust.contrast).toFixed(2), to: +Math.min(1, +S.adjust.contrast + 0.6).toFixed(2), start: 0, end: +dur.toFixed(2), ease: 'inout', mode: 'pingpong', on: true }); });
    rebuildAll(); hud('Layer added');
  }
  function convertToAnimation(on) {
    if (!App.src) return UI.toast('Load an image first', true);
    if (App.src.type !== 'image') { done((S) => { S.anim.on = on == null ? !S.anim.on : on; }); rebuildAll(); return; }
    done((S) => { S.anim.on = on == null ? !S.anim.on : on; });
    App.t = 0; rebuildAll(); requestRender(true);
    if (App.S.anim.on) { hud('Animation mode'); if (!App.S.anim.layers.length && !App.S.pre.some((f) => f.type === 'temporal')) UI.toast('Add a layer (L) or a Temporal Variation distortion to make it move'); }
    else { stop(); hud('Still mode'); }
  }
  App.convertToAnimation = convertToAnimation;

  // playback
  let lastTs = 0, lastFrame = -1;
  function play() {
    if (!App.isTimed()) { convertToAnimation(true); }
    if (!App.isTimed()) return;
    App.playing = true; updateTimeUI();
    const s = App.src;
    if (s.type === 'video') {
      if (s.el.ended || s.el.currentTime >= s.duration - 0.01) s.el.currentTime = 0;
      s.el.play().catch((e) => UI.toast(e.message, true));
      const step = () => {
        if (!App.playing || App.src !== s) return;
        App.t = s.el.currentTime; drawOriginal(); renderNow();
        if (s.el.ended) { if (App.loop) { s.el.currentTime = 0; s.el.play(); } else { stop(); return; } }
        if (s.el.requestVideoFrameCallback) s.el.requestVideoFrameCallback(step); else requestAnimationFrame(step);
      };
      if (s.el.requestVideoFrameCallback) s.el.requestVideoFrameCallback(step); else requestAnimationFrame(step);
      return;
    }
    lastTs = performance.now(); lastFrame = -1;
    const tick = (ts) => {
      if (!App.playing) return;
      const dt = (ts - lastTs) / 1000; lastTs = ts; App.t += dt;
      const d = App.duration();
      if (App.t >= d) { if (App.loop) App.t %= d; else { App.t = d; stop(); renderNow(); return; } }
      const f = Math.floor(App.t * App.fps());
      if (f !== lastFrame) { lastFrame = f; if (s.type === 'frames') drawOriginal(); renderNow(); }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  function stop() { App.playing = false; if (App.src && App.src.type === 'video') App.src.el.pause(); if ($('tlPlay')) updateTimeUI(); requestRender(true); }
  function togglePlay() { if (!App.src) return; App.playing ? stop() : play(); }
  App.seek = function (t) {
    const d = App.duration(); App.t = BS.clamp(t, 0, d);
    const s = App.src;
    if (s && s.type === 'video') { s.el.currentTime = Math.min(App.t, Math.max(0, s.duration - 0.001)); }
    else { drawOriginal(); requestRender(true); }
    updateTimeUI();
  };
  App.seekVideoExact = (t) => new Promise((res) => {
    const v = App.src.el; const target = Math.min(t, Math.max(0, App.src.duration - 0.001));
    if (Math.abs(v.currentTime - target) < 1e-4 && v.readyState >= 2) return res();
    const on = () => { v.removeEventListener('seeked', on); res(); };
    v.addEventListener('seeked', on); v.currentTime = target;
  });
  let scrubbing = false;

  // =============== Project / clipboard ===============
  function canvasOfSource() {
    const h = App.handle(); const c = document.createElement('canvas'); c.width = h.w; c.height = h.h; c.getContext('2d').drawImage(h.el, 0, 0); return c;
  }
  async function saveProject() {
    const proj = { app: 'BitSkull', version: 1, settings: App.S };
    if (App.src && App.src.type === 'image') {
      const c = canvasOfSource(); const b = await BS.canvasBlob(c, 'image/png');
      if (b.size < 40 * 1048576) proj.image = { name: App.src.name, data: await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); }) };
    }
    const base = ((App.src && App.src.name) || 'project').replace(/\.\w+$/, '');
    BS.download(new Blob([JSON.stringify(proj)], { type: 'application/json' }), base + '.bitskull.json');
    UI.toast('Project saved' + (proj.image ? ' (with image)' : ''));
  }
  async function loadProject(text) {
    let j; try { j = JSON.parse(text); } catch (e) { return UI.toast('Not a valid project / preset file', true); }
    if (Array.isArray(j) || j.presets) { const list = Array.isArray(j) ? j : j.presets; let n = 0; for (const p of list) if (p && p.name && (p.s || p.settings)) { App.userPresets.unshift({ name: p.name, tags: p.tags || 'mine', s: p.s || p.settings }); n++; } BS.store.set('presets', App.userPresets); buildPresetPanel(); return UI.toast(`Imported ${n} preset(s)`); }
    if (j.colors || (j.palette && !j.settings)) return importPaletteText(text, 'Palette');
    const s = j.settings || j.s || j;
    App.S = BS.normalizeSettings(s); rebuildAll(); commit();
    if (j.image && j.image.data) {
      const img = new Image(); img.src = j.image.data; await img.decode();
      await setSource({ type: 'image', el: img, w: img.naturalWidth, h: img.naturalHeight, name: j.image.name || 'project image' });
    } else requestRender(true);
    UI.toast('Project loaded');
  }
  App.loadProject = loadProject;
  async function copyImage() {
    if (!App.src) return;
    try {
      const res = await App.renderExport({ w: App.src.w, h: App.src.h, fit: 'stretch', detail: 'crisp', bg: null, t: App.t });
      const b = await BS.canvasBlob(res.canvas, 'image/png');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]); UI.toast('Copied to clipboard');
    } catch (e) { UI.toast('Copy failed: ' + e.message, true); }
  }

  // Export helper used by export.js and quick actions
  App.renderExport = async function (o, renderer) {
    renderer = renderer || (App._expR = App._expR || new BS.Renderer());
    const s = App.src; const t = o.t || 0;
    if (s.type === 'video') await App.seekVideoExact(t);
    const h = App.handle(t);
    const S = BS.evalSettings(App.S, t);
    const sx = o.w / s.w, sy = o.h / s.h;
    const sc = o.fit === 'cover' ? Math.max(sx, sy) : o.fit === 'contain' ? Math.min(sx, sy) : Math.max(sx, sy);
    const detail = o.detail === 'redither' ? sc : Math.min(1, sc);
    return renderer.render(h, S, { outW: o.w, outH: o.h, fit: o.fit, bg: o.bg, detail, time: t, frame: Math.floor(t * App.fps()), maxGrid: 40e6 });
  };
  App.paperInk = () => { const q = BS.buildQuant(App.S); return { paper: BS.rgbToHex(...q.paper), ink: BS.rgbToHex(...q.ink) }; };

  // =============== Rebuild ===============
  function rebuildAll() {
    buildAlgoPanel(); buildDitherPanel(); buildColorPanel(); buildPalettePanel(); buildAdjustPanel(); buildFxPanel('pre'); buildFxPanel('post'); buildTimeline();
  }
  App.rebuildAll = rebuildAll;

  // =============== Menus ===============
  const THEMES = [['void', 'Void (acid)'], ['synth', 'Synth'], ['matrix', 'Matrix'], ['amber', 'Amber'], ['ice', 'Ice'], ['light', 'Light']];
  function setTheme(t) { document.documentElement.dataset.theme = t; BS.store.set('theme', t); }
  function cycleTheme() { const i = THEMES.findIndex((x) => x[0] === document.documentElement.dataset.theme); const n = THEMES[(i + 1) % THEMES.length]; setTheme(n[0]); hud('Theme: ' + n[1]); }
  const openFile = async () => { const [f] = await UI.pickFile($('fileOpen')); loadFile(f); };
  const ACTIONS = {
    open: openFile,
    openSeq: async () => loadSequence(await UI.pickFile($('fileMulti'))),
    demo: () => App.loadDemo(),
    openProject: async () => { const [f] = await UI.pickFile($('fileText')); if (f) loadProject(await f.text()); },
    saveProject, export: () => BS.Export && BS.Export.open(), quickPng: () => BS.Export && BS.Export.quickPNG(), copy: copyImage, batch: () => BS.Export && BS.Export.open('batch'),
    undo, redo, random: randomizeAll, randPal: shufflePalette, resetAll: () => { if (!confirm('Reset every setting to default?')) return; App.S = BS.defaultSettings(); rebuildAll(); requestRender(true); commit(); },
    fit: fitView, z1: zoom1to1, zin: () => zoomBy(1.25), zout: () => zoomBy(0.8), compare: () => setCompare(!App.view.compare), panels: () => { document.body.classList.toggle('hide-panels'); setTimeout(() => { layoutView(); requestRender(true); }, 30); },
    full: () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {}); },
    anim: () => convertToAnimation(), play: togglePlay, layer: addLayer, help: () => $('helpDlg').showModal(),
    about: () => { $('aboutStats').textContent = `${BS.ALGOS.length} algorithms · ${Object.keys(BS.PRE).length} distortions · ${Object.keys(BS.POST).length} effects · ${BS.PALETTES.length} palettes · ${BS.PRESETS.length} presets`; $('aboutDlg').showModal(); },
    savePreset, theme: cycleTheme,
  };
  App.ACTIONS = ACTIONS;
  const MENUS = [
    ['File', [['Open image / GIF / video…', 'Ctrl+O', 'open'], ['Open image sequence…', '', 'openSeq'], ['Load demo image', '', 'demo'], '-', ['Open project…', 'Ctrl+Shift+O', 'openProject'], ['Save project', 'Ctrl+S', 'saveProject'], '-', ['Export…', 'Ctrl+E', 'export'], ['Quick export PNG', 'Ctrl+Shift+E', 'quickPng'], ['Copy image', 'Ctrl+C', 'copy'], ['Batch process…', 'Ctrl+B', 'batch']]],
    ['Edit', [['Undo', 'Ctrl+Z', 'undo'], ['Redo', 'Ctrl+Y', 'redo'], '-', ['Randomize all', 'R', 'random'], ['Shuffle palette', 'Shift+R', 'randPal'], ['Save look as preset…', 'Ctrl+Shift+S', 'savePreset'], '-', ['Reset all settings', '', 'resetAll']]],
    ['View', [['Fit to window', 'F', 'fit'], ['1:1 dither pixels', '1', 'z1'], ['Zoom in', '+', 'zin'], ['Zoom out', '−', 'zout'], '-', ['Split compare', '\\', 'compare'], ['Hold to see original', 'H', null], ['Hide panels', 'Tab', 'panels'], ['Fullscreen', 'Shift+F', 'full'], ['Cycle theme', 'T', 'theme']]],
    ['Animation', [['Convert to animation / still', 'A', 'anim'], ['Play / pause', 'Space', 'play'], ['Add layer', 'L', 'layer']]],
    ['Help', [['Keyboard shortcuts', '?', 'help'], ['About BitSkull', '', 'about']]],
  ];
  function buildMenus() {
    const nav = $('menus'); nav.innerHTML = '';
    for (const [name, items] of MENUS) {
      const pop = el('div', { class: 'menu-pop' });
      for (const it of items) {
        if (it === '-') { pop.append(el('hr')); continue; }
        pop.append(el('button', { onclick: () => { closeMenus(); if (it[2]) ACTIONS[it[2]](); } }, el('span', null, it[0]), el('span', { class: 'kb' }, it[1])));
      }
      if (name === 'View') { pop.append(el('hr')); for (const [k, l] of THEMES) pop.append(el('button', { onclick: () => { closeMenus(); setTheme(k); } }, el('span', null, 'Theme: ' + l), el('span', { class: 'kb' }, ''))); }
      const m = el('div', { class: 'menu' }, el('button', { onclick: (e) => { e.stopPropagation(); const open = m.classList.contains('open'); closeMenus(); if (!open) m.classList.add('open'); }, onmouseenter: () => { if (nav.querySelector('.menu.open') && !m.classList.contains('open')) { closeMenus(); m.classList.add('open'); } } }, name), pop);
      nav.append(m);
    }
    document.addEventListener('click', closeMenus);
  }
  function closeMenus() { document.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open')); }

  const SHORTCUTS = [
    ['Files', [['Ctrl+O', 'Open image / GIF / video'], ['Ctrl+V', 'Paste image from clipboard'], ['Ctrl+S', 'Save project'], ['Ctrl+Shift+O', 'Open project'], ['Ctrl+E', 'Export dialog'], ['Ctrl+Shift+E', 'Quick export PNG'], ['Ctrl+C', 'Copy result'], ['Ctrl+B', 'Batch process']]],
    ['Editing', [['Ctrl+Z', 'Undo'], ['Ctrl+Y / Ctrl+Shift+Z', 'Redo'], ['R', 'Randomize unlocked settings'], ['Shift+R', 'Shuffle unlocked palette colours'], ['Ctrl+Shift+S', 'Save look as preset'], ['Enter', 'Render now (manual mode)']]],
    ['Algorithm & colour', [['← / →', 'Previous / next algorithm'], ['Shift+← / →', 'Previous / next category'], ['[ / ]', 'Pixel size − / +'], [', / .', 'Previous / next palette'], ['M', 'Cycle colour mode'], ['I', 'Invert palette']]],
    ['View', [['F or 0', 'Fit to window'], ['1', '1:1 dither pixels'], ['+ / −  or wheel', 'Zoom'], ['Drag', 'Pan'], ['H (hold)', 'Show original'], ['\\', 'Split compare'], ['Tab', 'Hide / show panels'], ['Shift+F', 'Fullscreen'], ['T', 'Cycle theme']]],
    ['Animation', [['A', 'Convert to animation / still'], ['Space', 'Play / pause'], ['Home', 'Go to start'], ['L', 'Add animation layer']]],
    ['Help', [['? or F1', 'This list'], ['Esc', 'Close menus / dialogs']]],
  ];
  function buildHelp() {
    const b = $('helpBody'); b.innerHTML = '';
    for (const [g, list] of SHORTCUTS) { b.append(el('h4', null, g)); for (const [k, d] of list) b.append(el('div', { class: 'k' }, el('span', null, d), el('kbd', null, k))); }
  }

  // =============== Events ===============
  function bindEvents() {
    $('btnExport').onclick = ACTIONS.export; $('btnRandom').onclick = randomizeAll;
    $('emptyOpen').onclick = openFile; $('emptyDemo').onclick = App.loadDemo;
    $('algoPrev').onclick = () => stepAlgo(-1); $('algoNext').onclick = () => stepAlgo(1);
    $('algoSearch').oninput = (e) => { App.search = e.target.value; buildAlgoPanel(); };
    document.querySelectorAll('#modeSeg button').forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
    $('palSelect').onchange = (e) => {
      const v = e.target.value; if (!v) return;
      const p = v[0] === 'u' ? App.userPalettes[+v.slice(1)] : BS.PALETTES[+v.slice(1)];
      setPalette(p.colors, p.name); hud('Palette: ' + p.name);
    };
    $('palAdd').onclick = () => { const c = App.S.palette.colors; const a = BS.hexToRgb(c[c.length - 2] || '#000'), b = BS.hexToRgb(c[c.length - 1] || '#fff'); done((S) => { S.palette.colors.push(BS.rgbToHex((a[0] + b[0]) / 2 + 30, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2 + 30)); S.palette.locks.push(false); S.palette.name = ''; }); buildPalettePanel(); };
    $('palShuffle').onclick = shufflePalette;
    $('palReverse').onclick = () => { done((S) => { S.palette.colors.reverse(); S.palette.locks.reverse(); S.color.order = 'custom'; }); buildPalettePanel(); buildColorPanel(); };
    $('palSort').onclick = () => { done((S) => { const z = S.palette.colors.map((c, i) => [c, S.palette.locks[i]]).sort((a, b) => BS.hexLuma(a[0]) - BS.hexLuma(b[0])); S.palette.colors = z.map((x) => x[0]); S.palette.locks = z.map((x) => x[1]); }); buildPalettePanel(); };
    $('palExtract').onclick = () => {
      if (!App.src) return UI.toast('Load an image first', true);
      const n = BS.clamp(+$('palExtractN').value || 6, 2, 64); const h = App.handle();
      const cols = BS.extractPalette(h.el, n); setPalette(cols, 'Source');
      if (App.S.color.mode !== 'palette') { done((S) => { S.color.mode = 'palette'; }); buildColorPanel(); }
      UI.toast(`Extracted ${cols.length} colours · switched to Palette mode`);
    };
    $('palImport').onclick = async () => { const [f] = await UI.pickFile($('fileText')); if (f) importPaletteText(await f.text(), f.name); };
    $('palExport').onclick = () => {
      const P = App.S.palette; const name = P.name || 'bitskull-palette';
      BS.download(new Blob([BS.paletteToGPL(name, P.colors)], { type: 'text/plain' }), name.replace(/\W+/g, '_') + '.gpl');
      navigator.clipboard && navigator.clipboard.writeText(P.colors.join(' ')).catch(() => {});
      UI.toast('Saved .gpl · hex list copied to clipboard');
    };
    $('palSave').onclick = () => { const name = prompt('Palette name:', App.S.palette.name || 'My palette'); if (!name) return; App.userPalettes.unshift({ name, colors: App.S.palette.colors.slice() }); BS.store.set('palettes', App.userPalettes); App.S.palette.name = name; buildPalettePanel(); UI.toast('Palette saved'); };
    $('adjReset').onclick = () => { done((S) => { const d = BS.defaultAdjust(); for (const k of Object.keys(d)) if (!S.adjustLocks[k]) S.adjust[k] = d[k]; }); buildAdjustPanel(); };
    $('adjRandom').onclick = () => randomizeAdjust(true);
    $('presetSearch').oninput = buildPresetPanel; $('presetSave').onclick = savePreset;
    $('presetImport').onclick = async () => { const [f] = await UI.pickFile($('fileText')); if (f) loadProject(await f.text()); };
    $('presetExport').onclick = () => { if (!App.userPresets.length) return UI.toast('You have no saved presets yet', true); BS.download(new Blob([JSON.stringify({ app: 'BitSkull', presets: App.userPresets }, null, 1)], { type: 'application/json' }), 'bitskull-presets.json'); };

    $('updMode').onchange = (e) => { App.updMode = e.target.value; if (App.updMode !== 'manual') requestRender(true); };
    $('quality').onchange = (e) => { App.quality = e.target.value; requestRender(true); };
    $('adaptive').onchange = (e) => { App.adaptive = e.target.checked; };
    $('cmpBtn').onclick = ACTIONS.compare; $('zoomIn').onclick = ACTIONS.zin; $('zoomOut').onclick = ACTIONS.zout; $('zoomLabel').onclick = fitView; $('zoom1').onclick = zoom1to1;

    // timeline
    $('tlPlay').onclick = togglePlay; $('tlStart').onclick = () => App.seek(0);
    $('tlLoop').onclick = () => { App.loop = !App.loop; $('tlLoop').classList.toggle('on', App.loop); };
    $('tlScrub').addEventListener('pointerdown', () => { scrubbing = true; if (App.playing) stop(); });
    $('tlScrub').addEventListener('input', (e) => { App.seek((+e.target.value / 1000) * App.duration()); });
    $('tlScrub').addEventListener('change', () => { scrubbing = false; });
    $('tlDur').onchange = (e) => { const v = Math.max(0.1, +e.target.value || 4); done((S) => { S.anim.duration = v; S.anim.layers.forEach((l) => { if (l.end > v) l.end = v; }); }); buildTimeline(); };
    $('tlFps').onchange = (e) => { done((S) => { S.anim.fps = BS.clamp(Math.round(+e.target.value || 24), 1, 60); }); };
    $('tlAdd').onclick = addLayer;
    $('tlClose').onclick = () => convertToAnimation(App.src && App.src.type === 'image' ? false : undefined);

    // viewport interactions
    const vp = $('viewport');
    vp.addEventListener('wheel', (e) => { if (!App.src) return; e.preventDefault(); const r = vp.getBoundingClientRect(); zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    let pan = null;
    vp.addEventListener('pointerdown', (e) => {
      if (!App.src || e.button === 2) return;
      if (e.target.closest('#splitLine')) {
        const wrap = $('canvasWrap').getBoundingClientRect();
        const mv = (ev) => { App.view.split = BS.clamp((ev.clientX - wrap.left) / wrap.width, 0, 1); layoutView(); };
        const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
        window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); return;
      }
      pan = { x: e.clientX, y: e.clientY, px: App.view.px, py: App.view.py }; vp.classList.add('panning'); vp.setPointerCapture(e.pointerId);
    });
    vp.addEventListener('pointermove', (e) => { if (!pan) return; App.view.px = pan.px + e.clientX - pan.x; App.view.py = pan.py + e.clientY - pan.y; layoutView(); });
    vp.addEventListener('pointerup', () => { pan = null; vp.classList.remove('panning'); });
    vp.addEventListener('dblclick', (e) => { if (!e.target.closest('#empty')) fitView(); });
    window.addEventListener('resize', () => { layoutView(); });
    document.addEventListener('pointerup', () => { if (BS.dragging) { BS.dragging = false; requestRender(true); } });

    // drag & drop + paste
    let dragDepth = 0;
    window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
    window.addEventListener('dragleave', (e) => { e.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging');
      const files = Array.from(e.dataTransfer.files || []);
      if (files.length > 1 && files.every((f) => (f.type || '').startsWith('image/'))) loadSequence(files); else loadFile(files[0]);
    });
    window.addEventListener('paste', (e) => {
      if (e.target.matches && e.target.matches('input, textarea')) return;
      const item = Array.from(e.clipboardData.items || []).find((i) => i.type.startsWith('image/'));
      if (item) { const f = item.getAsFile(); loadFile(new File([f], 'pasted.png', { type: f.type })); }
    });

    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', (e) => { if (e.key === 'h' || e.key === 'H') document.body.classList.remove('hold'); });
  }

  function onKey(e) {
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'textarea' || tag === 'select' || (tag === 'input' && !['range', 'checkbox', 'color', 'button'].includes(e.target.type));
    if (document.querySelector('dialog[open]')) { return; }
    if (e.key === 'Escape') { closeMenus(); return; }
    if (typing) return;
    const k = e.key, ctrl = e.ctrlKey || e.metaKey, sh = e.shiftKey;
    const run = (fn) => { e.preventDefault(); fn(); };
    if (ctrl) {
      const kk = k.toLowerCase();
      if (kk === 'o') return run(sh ? ACTIONS.openProject : openFile);
      if (kk === 's') return run(sh ? savePreset : saveProject);
      if (kk === 'e') return run(sh ? ACTIONS.quickPng : ACTIONS.export);
      if (kk === 'z') return run(sh ? redo : undo);
      if (kk === 'y') return run(redo);
      if (kk === 'b') return run(ACTIONS.batch);
      if (kk === 'c' && !String(window.getSelection())) return run(copyImage);
      return;
    }
    if (e.target.type === 'range' && (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown')) return;
    switch (k) {
      case 'ArrowLeft': return run(() => (sh ? stepCat(-1) : stepAlgo(-1)));
      case 'ArrowRight': return run(() => (sh ? stepCat(1) : stepAlgo(1)));
      case '[': case ']': return run(() => { const d = k === ']' ? 1 : -1; const ps = App.S.dither.pixelSize; const steps = [0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32]; let i = steps.findIndex((s) => s >= ps - 1e-6); if (i < 0) i = steps.length - 1; if (steps[i] !== ps && d < 0) i++; const v = steps[BS.clamp(i + d, 0, steps.length - 1)]; done((S) => { S.dither.pixelSize = v; }); buildDitherPanel(); hud('Pixel size ' + v); });
      case ',': return run(() => stepPalette(-1));
      case '.': return run(() => stepPalette(1));
      case 'r': return run(randomizeAll);
      case 'R': return run(shufflePalette);
      case ' ': return run(togglePlay);
      case 'Home': return run(() => App.seek(0));
      case 'h': case 'H': if (!e.repeat && App.src) { drawOriginal(); document.body.classList.add('hold'); } return e.preventDefault();
      case '\\': return run(ACTIONS.compare);
      case 'f': case '0': return run(fitView);
      case 'F': return run(ACTIONS.full);
      case '1': return run(zoom1to1);
      case '+': case '=': return run(ACTIONS.zin);
      case '-': case '_': return run(ACTIONS.zout);
      case 'Tab': return run(ACTIONS.panels);
      case '?': case 'F1': return run(ACTIONS.help);
      case 'i': case 'I': return run(() => { done((S) => { S.color.invert = !S.color.invert; }); buildColorPanel(); hud('Invert palette'); });
      case 'm': case 'M': return run(() => { const m = ['mono', 'palette', 'rgb']; setMode(m[(m.indexOf(App.S.color.mode) + 1) % 3]); });
      case 'a': case 'A': return run(() => convertToAnimation());
      case 'l': case 'L': return run(addLayer);
      case 't': case 'T': return run(cycleTheme);
      case 'Enter': return run(() => requestRender(true));
    }
  }

  // =============== Init ===============
  function init() {
    setTheme(BS.store.get('theme', 'void'));
    buildMenus(); buildHelp(); rebuildAll(); buildPresetPanel(); bindEvents();
    // section lock buttons for randomize
    const addLock = (sec, key, label) => {
      const h = document.querySelector(`.sec[data-sec="${sec}"] h3`);
      const b = el('button', { class: 'link', title: `Lock ${label} (excluded from Randomize)` }, App.locks[key] ? '🔒' : '🔓');
      b.onclick = () => { App.locks[key] = !App.locks[key]; b.textContent = App.locks[key] ? '🔒' : '🔓'; BS.store.set('locks', App.locks); };
      h.append(el('span', { class: 'sec-actions' }, b));
    };
    addLock('algo', 'algo', 'algorithm'); addLock('dither', 'dither', 'dither settings'); addLock('palette', 'palette', 'palette');
    // warm up blue noise in idle time
    setTimeout(() => BS.blueNoise(), 300);
    // URL options: ?demo  ?preset=Name  ?algo=id
    const q = new URLSearchParams(location.search);
    if (q.has('demo')) {
      App.loadDemo().then(() => {
        const p = q.get('preset') && BS.PRESETS.find((x) => x.name.toLowerCase() === q.get('preset').toLowerCase());
        if (p) applyPresetObj(p);
        if (q.get('algo')) setAlgo(q.get('algo'), true);
        if (q.has('compare')) setCompare(true);
        if (q.has('anim')) addLayer();
        if (q.has('export')) setTimeout(() => BS.Export.open(q.get('export') || undefined), 50);
        if (q.has('play')) play();
      });
    }
  }
  init();
})();
