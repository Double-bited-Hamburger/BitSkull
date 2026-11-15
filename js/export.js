/* BitSkull — export dialog: image, vector, animation/video and batch */
(function () {
  'use strict';
  const BS = window.BS, UI = BS.UI, App = BS.App, el = UI.el;
  const $ = (id) => document.getElementById(id);

  const SIZES = [
    ['orig', 'Original size'], ['grid', 'Native dither grid (1 px = 1 dither pixel)'], ['x0.5', '0.5×'], ['x2', '2×'], ['x3', '3×'], ['x4', '4×'], ['x8', '8×'], '-',
    ['1280x720', 'HD 1280×720'], ['1920x1080', 'Full HD 1920×1080'], ['2560x1440', 'QHD 2560×1440'], ['3840x2160', '4K UHD 3840×2160'], ['5120x2880', '5K 5120×2880'], ['7680x4320', '8K 7680×4320'], '-',
    ['1080x1080', 'Square 1080×1080'], ['2048x2048', 'Square 2048×2048'], ['1080x1350', 'Portrait 4:5 1080×1350'], ['1080x1920', 'Story / Reel 1080×1920'], ['1500x500', 'Banner 1500×500'], '-',
    ['a5', 'A5 at DPI'], ['a4', 'A4 at DPI'], ['a3', 'A3 at DPI'], ['letter', 'US Letter at DPI'], ['poster', 'Poster 18×24 in at DPI'], '-', ['custom', 'Custom']];
  const PAPER = { a5: [148, 210], a4: [210, 297], a3: [297, 420], letter: [215.9, 279.4], poster: [457.2, 609.6] };

  const st = Object.assign({ preset: 'orig', fit: 'contain', bg: 'paper', bgColor: '#000000', detail: 'crisp', dpi: 300, fmt: 'png', quality: 0.95, vfmt: 'svg', vbg: 'common', keepBg: true, ink: false, inkColor: '#000000', unit: 'px', afmt: 'mp4', fps: 24, bitrate: 20, lock: true, w: 0, h: 0 }, BS.store.get('export', {}));
  const save = () => BS.store.set('export', st);
  let tab = 'image', busy = false, cancelled = false, batchFiles = [];

  function srcDims() { const s = App.src; return s ? [s.w, s.h] : [1, 1]; }
  function gridDims() { const s = App.src; if (!s) return [1, 1]; const g = App.renderer.gridSize({ w: s.w, h: s.h }, App.S, {}); return [g.gw, g.gh]; }
  function sizeFor(preset, sw, sh) {
    if (preset === 'orig') return [sw, sh];
    if (preset === 'grid') { const ps = Math.max(0.25, App.S.dither.pixelSize); return [Math.max(1, Math.round(sw / ps)), Math.max(1, Math.round(sh / ps))]; }
    if (preset[0] === 'x') { const f = +preset.slice(1); return [Math.max(1, Math.round(sw * f)), Math.max(1, Math.round(sh * f))]; }
    if (PAPER[preset]) { let [a, b] = PAPER[preset].map((mm) => Math.round((mm / 25.4) * st.dpi)); if (sw > sh) [a, b] = [b, a]; return [a, b]; }
    const m = preset.match(/^(\d+)x(\d+)$/); if (m) return [+m[1], +m[2]];
    return [st.w || sw, st.h || sh];
  }
  function applyPreset() {
    const [sw, sh] = srcDims();
    if (st.preset !== 'custom') { const [w, h] = sizeFor(st.preset, sw, sh); st.w = w; st.h = h; }
    $('exW').value = st.w; $('exH').value = st.h; note();
  }
  function bgValue() {
    if (st.bg === 'transparent') return null;
    if (st.bg === 'custom') return st.bgColor;
    const pi = App.paperInk(); return st.bg === 'ink' ? pi.ink : pi.paper;
  }
  function opts(t) { return { w: Math.max(1, Math.min(16384, Math.round(st.w))), h: Math.max(1, Math.min(16384, Math.round(st.h))), fit: st.fit, bg: bgValue(), detail: st.detail, t: t || 0 }; }
  function note() {
    if (!App.src) return;
    const [sw, sh] = srcDims(); const [gw, gh] = gridDims();
    const sx = st.w / sw, sy = st.h / sh; const sc = st.fit === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
    const per = (sw * sc) / gw;
    let s = `Output ${st.w}×${st.h} px · ${(st.w / st.dpi * 2.54).toFixed(1)}×${(st.h / st.dpi * 2.54).toFixed(1)} cm at ${st.dpi} DPI. `;
    if (st.detail === 'crisp') s += `Dither grid ${gw}×${gh}, each dither pixel becomes ${per.toFixed(2)} px` + (Math.abs(per - Math.round(per)) > 0.01 && per > 1 ? ' — pick an integer multiple (2×, 3×…) for perfectly even pixels.' : '.');
    else s += `Re-dithered on a ${Math.round(gw * sc)}×${Math.round(gh * sc)} grid at output size: same look, finer grain, no upscaling.`;
    if (Math.abs(st.w / st.h - sw / sh) > 0.01 && tab !== 'vector') s += ` Aspect differs from the image → ${st.fit}.`;
    $('exSizeNote').textContent = s;
    const px = st.w * st.h; $('exEstimate').textContent = px > 60e6 ? 'Very large output — this can take a while and a lot of memory.' : '';
  }

  function progress(f, txt) {
    $('exProgress').hidden = f == null; if (f == null) return;
    $('exProgress').querySelector('i').style.width = (f * 100).toFixed(1) + '%'; $('exProgressTxt').textContent = txt || '';
  }
  const baseName = () => ((App.src && App.src.name) || 'bitskull').replace(/\.\w+$/, '').replace(/[^\w\-]+/g, '_') + '_bitskull';

  async function encodeStill(canvas, fmt) {
    const dpi = st.dpi;
    if (fmt === 'png') return [await BS.encodePNG(canvas, dpi), 'png'];
    if (fmt === 'jpeg') return [await BS.encodeJPEG(canvas, st.quality, dpi), 'jpg'];
    if (fmt === 'webp') return [await BS.encodeWebP(canvas, st.quality), 'webp'];
    const id = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    if (fmt === 'tiff') { let a = false; for (let i = 3; i < id.data.length; i += 4) if (id.data[i] < 255) { a = true; break; } return [BS.encodeTIFF(id, dpi, a), 'tif']; }
    if (fmt === 'bmp') return [BS.encodeBMP(id, dpi), 'bmp'];
    if (fmt === 'gif') { const g = new BS.GIF(canvas.width, canvas.height, false); g.addFrame(id.data, 10); return [g.finish(), 'gif']; }
    throw new Error('Unknown format');
  }

  async function exportImage() {
    progress(0.1, 'Rendering…'); await BS.tick();
    const res = await App.renderExport(opts(App.t));
    progress(0.6, 'Encoding…'); await BS.tick();
    const [blob, ext] = await encodeStill(res.canvas, st.fmt);
    BS.download(blob, `${baseName()}.${ext}`);
    return `${ext.toUpperCase()} · ${res.canvas.width}×${res.canvas.height} · ${BS.fmtBytes(blob.size)}`;
  }

  async function exportVector() {
    progress(0.1, 'Rendering dither grid…'); await BS.tick();
    const [sw, sh] = srcDims();
    const res = await App.renderExport({ w: st.detail === 'redither' ? st.w : sw, h: st.detail === 'redither' ? Math.round(st.w * sh / sw) : sh, fit: 'stretch', bg: null, detail: st.detail, t: App.t });
    progress(0.35, 'Tracing shapes…'); await BS.tick();
    const V = BS.vectorize(res.grid, res.gw, res.gh, { bg: st.vbg === 'none' ? null : st.vbg, inkOnly: st.ink, inkColor: st.inkColor });
    const nrect = V.layers.reduce((s, l) => s + l.rects.length, 0);
    if (nrect > 1.5e6 && !confirm(`This vector will contain ${nrect.toLocaleString()} shapes and may be very large. A bigger Pixel size makes lighter files. Continue?`)) throw new Error('Cancelled');
    const W = st.w, H = Math.round((st.w * V.gh) / V.gw);
    const o = { w: W, h: H, unit: st.unit, wmm: (W / st.dpi) * 25.4, hmm: (H / st.dpi) * 25.4, wpt: (W / st.dpi) * 72, hpt: (H / st.dpi) * 72, keepBg: st.keepBg && !st.ink };
    if (st.unit === 'px') { o.wpt = W * 0.75; o.hpt = H * 0.75; }
    progress(0.7, 'Writing file…'); await BS.tick();
    let blob, ext = st.vfmt;
    if (st.vfmt === 'svg') blob = BS.encodeSVG(V, o);
    else if (st.vfmt === 'pdf') blob = await BS.encodePDF(V, o);
    else blob = BS.encodeEPS(V, o);
    BS.download(blob, `${baseName()}.${ext}`);
    return `${ext.toUpperCase()} · ${V.layers.length} colour layer(s) · ${nrect.toLocaleString()} shapes · ${BS.fmtBytes(blob.size)}`;
  }

  async function exportAnim() {
    const s = App.src; const fps = BS.clamp(Math.round(st.fps), 1, 60);
    const dur = Math.max(0.05, +$('axDur').value || App.duration());
    const count = Math.max(1, Math.round(dur * fps));
    const wasT = App.t; if (App.playing) App.ACTIONS.play();
    const o = opts(0); const R = new BS.Renderer();
    const render = async (i) => (await App.renderExport(Object.assign({}, o, { t: i / fps }), R)).canvas;
    let blob, ext;
    const prog = (f) => progress(f, `Frame ${Math.min(count, Math.round(f * count))} / ${count}`);
    try {
      if (st.afmt === 'mp4') {
        blob = await BS.encodeMP4({ w: o.w, h: o.h, fps, count, bitrate: Math.round(st.bitrate * 1e6), bg: o.bg || '#000000' }, render, prog, () => cancelled); ext = 'mp4';
      } else if (st.afmt === 'gif') {
        const g = new BS.GIF(o.w, o.h, true);
        for (let i = 0; i < count; i++) { if (cancelled) throw new Error('Cancelled'); const c = await render(i); g.addFrame(c.getContext('2d').getImageData(0, 0, o.w, o.h).data, 100 / fps); prog((i + 1) / count); await BS.tick(); }
        blob = g.finish(); ext = 'gif';
      } else if (st.afmt === 'apng') {
        const a = new BS.APNG(o.w, o.h, count, fps, 0);
        for (let i = 0; i < count; i++) { if (cancelled) throw new Error('Cancelled'); const c = await render(i); await a.addFrame(c.getContext('2d').getImageData(0, 0, o.w, o.h).data); prog((i + 1) / count); }
        blob = a.finish(); ext = 'png';
      } else {
        const z = new BS.Zip(); const pad = String(count).length;
        for (let i = 0; i < count; i++) { if (cancelled) throw new Error('Cancelled'); const c = await render(i); await z.add(`${baseName()}_${String(i + 1).padStart(Math.max(4, pad), '0')}.png`, await BS.encodePNG(c, st.dpi)); prog((i + 1) / count); }
        blob = z.finish(); ext = 'zip';
      }
    } finally {
      if (s.type === 'video') await App.seekVideoExact(wasT); App.t = wasT; App.requestRender(true);
    }
    BS.download(blob, `${baseName()}${st.afmt === 'apng' ? '_anim' : ''}.${ext}`);
    return `${st.afmt.toUpperCase()} · ${count} frames · ${o.w}×${o.h} · ${BS.fmtBytes(blob.size)}`;
  }

  async function exportBatch() {
    if (!batchFiles.length) throw new Error('Choose some images first');
    const z = new BS.Zip(); const R = new BS.Renderer(); const S = BS.evalSettings(App.S, 0);
    for (let i = 0; i < batchFiles.length; i++) {
      if (cancelled) throw new Error('Cancelled');
      const f = batchFiles[i]; progress(i / batchFiles.length, `${i + 1} / ${batchFiles.length} · ${f.name}`);
      const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' });
      const [w, h] = st.preset === 'custom' ? [st.w, st.h] : sizeFor(st.preset, bmp.width, bmp.height);
      const sc = st.fit === 'cover' ? Math.max(w / bmp.width, h / bmp.height) : st.fit === 'contain' ? Math.min(w / bmp.width, h / bmp.height) : Math.max(w / bmp.width, h / bmp.height);
      const res = R.render({ el: bmp, w: bmp.width, h: bmp.height, key: 'batch' + i }, S, { outW: w, outH: h, fit: st.fit, bg: bgValue(), detail: st.detail === 'redither' ? sc : Math.min(1, sc), maxGrid: 40e6 });
      const [blob, ext] = await encodeStill(res.canvas, st.fmt);
      await z.add(f.name.replace(/\.\w+$/, '') + '_bitskull.' + ext, blob);
      bmp.close && bmp.close(); await BS.tick();
    }
    const out = z.finish(); BS.download(out, 'bitskull_batch.zip');
    return `${batchFiles.length} images · ${BS.fmtBytes(out.size)}`;
  }

  async function go() {
    if (busy) return; if (!App.src && tab !== 'batch') return UI.toast('Load an image first', true);
    busy = true; cancelled = false; $('exGo').disabled = true; $('exCancel').textContent = 'Stop';
    try {
      const msg = tab === 'image' ? await exportImage() : tab === 'vector' ? await exportVector() : tab === 'anim' ? await exportAnim() : await exportBatch();
      progress(1, 'Done'); UI.toast('Exported ' + msg); setTimeout(() => { if (!busy) progress(null); }, 1500);
    } catch (e) { console.error(e); progress(null); if (e.message !== 'Cancelled') UI.toast('Export failed: ' + e.message, true); else UI.toast('Export cancelled'); }
    busy = false; $('exGo').disabled = false; $('exCancel').textContent = 'Cancel';
  }

  function setTab(t) {
    tab = t;
    document.querySelectorAll('#expTabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    document.querySelectorAll('#exportDlg .tab-pane').forEach((p) => (p.hidden = p.dataset.pane !== t));
    $('exFit').closest('label').hidden = t === 'vector';
    $('exBg').closest('label').hidden = t === 'vector';
    $('exGo').textContent = t === 'batch' ? 'Process batch' : 'Export';
    if (t === 'anim') {
      const s = App.src; const d = s ? App.duration() : 4;
      $('axDur').value = +d.toFixed(2); st.fps = App.fps(); $('axFps').value = st.fps;
      $('axNote').textContent = !s ? '' : s.type === 'video' ? 'Exports the dithered clip frame by frame (no audio).' : s.type === 'frames' ? 'Exports every frame of the animation.' : App.S.anim.on ? 'Renders your animation layers and temporal effects.' : 'Tip: the image is still — use Animation › Convert to animation and add layers or a Temporal Variation effect first.';
    }
    note();
  }

  function sync() {
    $('exPreset').value = st.preset; $('exFit').value = st.fit; $('exBg').value = st.bg; $('exBgColor').value = st.bgColor; $('exBgColor').hidden = st.bg !== 'custom';
    $('exDetail').value = st.detail; $('exDpi').value = st.dpi; $('exLock').checked = st.lock;
    $('exFmt').value = st.fmt; $('exQuality').value = st.quality; $('exQualityVal').textContent = Math.round(st.quality * 100); $('exQualityWrap').hidden = !(st.fmt === 'jpeg' || st.fmt === 'webp');
    $('vxFmt').value = st.vfmt; $('vxBg').value = st.vbg; $('vxKeepBg').checked = st.keepBg; $('vxInk').checked = st.ink; $('vxInkColor').value = st.inkColor; $('vxUnit').value = st.unit;
    $('axFmt').value = st.afmt; $('axFps').value = st.fps; $('axBitrate').value = st.bitrate; $('axBitrateWrap').hidden = st.afmt !== 'mp4';
  }

  function build() {
    const sel = $('exPreset'); sel.innerHTML = '';
    for (const s of SIZES) sel.append(s === '-' ? el('option', { disabled: true }, '──────────') : el('option', { value: s[0] }, s[1]));
    document.querySelectorAll('#expTabs button').forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));
    const bind = (id, key, ev, conv, after) => { $(id).addEventListener(ev || 'change', (e) => { st[key] = conv ? conv(e.target) : e.target.value; save(); after && after(); sync(); note(); }); };
    bind('exPreset', 'preset', 'change', null, applyPreset);
    bind('exFit', 'fit'); bind('exBg', 'bg'); bind('exBgColor', 'bgColor', 'input');
    bind('exDetail', 'detail'); bind('exDpi', 'dpi', 'change', (t) => BS.clamp(+t.value || 300, 36, 2400), () => { if (PAPER[st.preset]) applyPreset(); });
    bind('exLock', 'lock', 'change', (t) => t.checked);
    bind('exFmt', 'fmt'); bind('exQuality', 'quality', 'input', (t) => +t.value);
    bind('vxFmt', 'vfmt'); bind('vxBg', 'vbg'); bind('vxKeepBg', 'keepBg', 'change', (t) => t.checked); bind('vxInk', 'ink', 'change', (t) => t.checked); bind('vxInkColor', 'inkColor', 'input'); bind('vxUnit', 'unit');
    bind('axFmt', 'afmt'); bind('axFps', 'fps', 'change', (t) => BS.clamp(+t.value || 24, 1, 60)); bind('axBitrate', 'bitrate', 'change', (t) => BS.clamp(+t.value || 20, 1, 200));
    const dim = (which) => () => {
      const [sw, sh] = srcDims(); let w = Math.round(+$('exW').value) || 1, h = Math.round(+$('exH').value) || 1;
      if (st.lock) { if (which === 'w') h = Math.max(1, Math.round((w * sh) / sw)); else w = Math.max(1, Math.round((h * sw) / sh)); }
      st.w = BS.clamp(w, 1, 16384); st.h = BS.clamp(h, 1, 16384); st.preset = 'custom'; save(); sync(); $('exW').value = st.w; $('exH').value = st.h; note();
    };
    $('exW').addEventListener('change', dim('w')); $('exH').addEventListener('change', dim('h'));
    $('exGo').onclick = go;
    $('exCancel').onclick = () => { if (busy) { cancelled = true; } else $('exportDlg').close(); };
    $('exportDlg').addEventListener('cancel', (e) => { if (busy) { e.preventDefault(); cancelled = true; } });
    $('bxPick').onclick = async () => { batchFiles = await UI.pickFile($('fileMulti')); $('bxInfo').textContent = batchFiles.length ? `${batchFiles.length} image(s) selected` : ''; };
  }

  BS.Export = {
    open(t) {
      if (!App.src && t !== 'batch') return UI.toast('Load an image first', true);
      sync(); if (App.src) applyPreset(); progress(null);
      setTab(t || (App.isTimed() && App.src.type !== 'image' ? 'anim' : tab));
      $('exportDlg').showModal();
    },
    async quickPNG() {
      if (!App.src) return;
      try { const res = await App.renderExport({ w: App.src.w, h: App.src.h, fit: 'stretch', bg: null, detail: 'crisp', t: App.t }); const b = await BS.encodePNG(res.canvas, st.dpi); BS.download(b, baseName() + '.png'); UI.toast('Saved PNG ' + res.canvas.width + '×' + res.canvas.height); }
      catch (e) { UI.toast('Export failed: ' + e.message, true); }
    },
  };
  build();
})();
