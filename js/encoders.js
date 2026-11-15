/* BitSkull — file encoders: PNG/JPEG (+DPI), BMP, TIFF, GIF, APNG, ZIP, SVG, PDF, EPS, MP4 */
(function () {
  'use strict';
  const BS = window.BS;
  const TE = new TextEncoder();

  class Bytes {
    constructor(cap) { this.b = new Uint8Array(cap || 1 << 16); this.n = 0; }
    ensure(k) { if (this.n + k <= this.b.length) return; let c = this.b.length * 2; while (c < this.n + k) c *= 2; const nb = new Uint8Array(c); nb.set(this.b.subarray(0, this.n)); this.b = nb; }
    u8(v) { this.ensure(1); this.b[this.n++] = v & 255; }
    u16le(v) { this.u8(v); this.u8(v >> 8); }
    u32le(v) { this.u16le(v & 0xffff); this.u16le((v >>> 16) & 0xffff); }
    u16be(v) { this.u8(v >> 8); this.u8(v); }
    u32be(v) { this.u8(v >>> 24); this.u8(v >>> 16); this.u8(v >>> 8); this.u8(v); }
    bytes(a) { this.ensure(a.length); this.b.set(a, this.n); this.n += a.length; }
    str(s) { for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i)); }
    out() { return this.b.slice(0, this.n); }
  }
  BS.Bytes = Bytes;

  const deflate = async (u8, raw) => {
    const s = new Blob([u8]).stream().pipeThrough(new CompressionStream(raw ? 'deflate-raw' : 'deflate'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  };
  BS.deflate = deflate;

  function pngChunk(type, data) {
    const b = new Bytes(data.length + 12); b.u32be(data.length); const t = TE.encode(type); b.bytes(t); b.bytes(data);
    const crcIn = new Uint8Array(4 + data.length); crcIn.set(t, 0); crcIn.set(data, 4); b.u32be(BS.crc32(crcIn)); return b.out();
  }

  // ---------- PNG / JPEG with DPI ----------
  BS.encodePNG = async function (canvas, dpi) {
    const buf = new Uint8Array(await (await BS.canvasBlob(canvas, 'image/png')).arrayBuffer());
    if (!dpi) return new Blob([buf], { type: 'image/png' });
    const ppm = Math.round(dpi / 0.0254); const d = new Bytes(9); d.u32be(ppm); d.u32be(ppm); d.u8(1);
    const phys = pngChunk('pHYs', d.out());
    const ihdrEnd = 8 + 25;
    return new Blob([buf.subarray(0, ihdrEnd), phys, buf.subarray(ihdrEnd)], { type: 'image/png' });
  };
  BS.encodeJPEG = async function (canvas, q, dpi) {
    const flat = document.createElement('canvas'); flat.width = canvas.width; flat.height = canvas.height;
    const x = flat.getContext('2d'); x.fillStyle = '#ffffff'; x.fillRect(0, 0, flat.width, flat.height); x.drawImage(canvas, 0, 0);
    const buf = new Uint8Array(await (await BS.canvasBlob(flat, 'image/jpeg', q)).arrayBuffer());
    if (dpi && buf[2] === 0xff && buf[3] === 0xe0 && buf[6] === 0x4a && buf[7] === 0x46) { buf[13] = 1; buf[14] = dpi >> 8; buf[15] = dpi & 255; buf[16] = dpi >> 8; buf[17] = dpi & 255; }
    return new Blob([buf], { type: 'image/jpeg' });
  };
  BS.encodeWebP = async (canvas, q) => BS.canvasBlob(canvas, 'image/webp', q);

  BS.encodeBMP = function (id, dpi) {
    const { width: w, height: h, data } = id; const row = (w * 3 + 3) & ~3; const size = 54 + row * h; const ppm = Math.round((dpi || 72) / 0.0254);
    const b = new Bytes(size); b.str('BM'); b.u32le(size); b.u32le(0); b.u32le(54);
    b.u32le(40); b.u32le(w); b.u32le(h); b.u16le(1); b.u16le(24); b.u32le(0); b.u32le(row * h); b.u32le(ppm); b.u32le(ppm); b.u32le(0); b.u32le(0);
    const line = new Uint8Array(row);
    for (let y = h - 1; y >= 0; y--) {
      for (let x = 0; x < w; x++) { const o = (y * w + x) * 4; const a = data[o + 3] / 255; line[x * 3] = data[o + 2] * a + 255 * (1 - a); line[x * 3 + 1] = data[o + 1] * a + 255 * (1 - a); line[x * 3 + 2] = data[o] * a + 255 * (1 - a); }
      b.bytes(line);
    }
    return new Blob([b.out()], { type: 'image/bmp' });
  };

  BS.encodeTIFF = function (id, dpi, alpha) {
    const { width: w, height: h, data } = id; const spp = alpha ? 4 : 3;
    const entries = [[256, 4, 1, w], [257, 4, 1, h], [258, 3, spp, 'bps'], [259, 3, 1, 1], [262, 3, 1, 2], [273, 4, 1, 'pix'], [277, 3, 1, spp], [278, 4, 1, h], [279, 4, 1, w * h * spp], [282, 5, 1, 'xres'], [283, 5, 1, 'yres'], [284, 3, 1, 1], [296, 3, 1, 2]];
    if (alpha) entries.push([338, 3, 1, 2]);
    const ifdSize = 2 + entries.length * 12 + 4; const extra = 8 + ifdSize;
    const bpsOff = extra, xresOff = bpsOff + spp * 2 + ((spp * 2) & 1), yresOff = xresOff + 8, pixOff = yresOff + 8;
    const b = new Bytes(pixOff + w * h * spp + 16);
    b.str('II'); b.u16le(42); b.u32le(8); b.u16le(entries.length);
    for (const [tag, type, count, val] of entries) {
      b.u16le(tag); b.u16le(type); b.u32le(count);
      const v = val === 'bps' ? bpsOff : val === 'pix' ? pixOff : val === 'xres' ? xresOff : val === 'yres' ? yresOff : val;
      if (type === 3 && count === 1) { b.u16le(v); b.u16le(0); } else b.u32le(v);
    }
    b.u32le(0);
    for (let i = 0; i < spp; i++) b.u16le(8);
    if ((spp * 2) & 1) b.u8(0);
    b.u32le(Math.round(dpi || 72)); b.u32le(1); b.u32le(Math.round(dpi || 72)); b.u32le(1);
    for (let i = 0, n = w * h; i < n; i++) { b.u8(data[i * 4]); b.u8(data[i * 4 + 1]); b.u8(data[i * 4 + 2]); if (alpha) b.u8(data[i * 4 + 3]); }
    return new Blob([b.out()], { type: 'image/tiff' });
  };

  // ---------- GIF ----------
  function lzw(indices, minCode, out) {
    const clear = 1 << minCode, eoi = clear + 1; let size = minCode + 1, next = eoi + 1;
    const dict = new Map(); let cur = 0, bits = 0; const blk = [];
    const emit = (code) => { cur |= code << bits; bits += size; while (bits >= 8) { blk.push(cur & 255); cur >>>= 8; bits -= 8; } };
    emit(clear);
    let prefix = indices[0];
    for (let i = 1; i < indices.length; i++) {
      const k = indices[i]; const key = (prefix << 8) | k; const hit = dict.get(key);
      if (hit !== undefined) { prefix = hit; continue; }
      emit(prefix);
      if (next < 4096) { dict.set(key, next++); if (next > 1 << size && size < 12) size++; }
      else { emit(clear); dict.clear(); next = eoi + 1; size = minCode + 1; }
      prefix = k;
    }
    emit(prefix); emit(eoi);
    if (bits > 0) blk.push(cur & 255);
    out.u8(minCode);
    for (let i = 0; i < blk.length; i += 255) { const n = Math.min(255, blk.length - i); out.u8(n); for (let j = 0; j < n; j++) out.u8(blk[i + j]); }
    out.u8(0);
  }
  BS.GIF = class {
    constructor(w, h, loop) {
      this.w = w; this.h = h; this.parts = [];
      const b = new Bytes(64); b.str('GIF89a'); b.u16le(w); b.u16le(h); b.u8(0); b.u8(0); b.u8(0);
      if (loop !== false) { b.u8(0x21); b.u8(0xff); b.u8(11); b.str('NETSCAPE2.0'); b.u8(3); b.u8(1); b.u16le(0); b.u8(0); }
      this.parts.push(b.out());
    }
    addFrame(data, delayCs) {
      const n = this.w * this.h; const map = new Map(); const idx = new Uint8Array(n); let trans = -1; let pal = [];
      let over = false;
      for (let i = 0; i < n && !over; i++) {
        if (data[i * 4 + 3] < 128) { if (trans < 0) { trans = pal.length; pal.push(0); } continue; }
        const c = (data[i * 4] << 16) | (data[i * 4 + 1] << 8) | data[i * 4 + 2];
        if (!map.has(c)) { if (pal.length >= 256) { over = true; break; } map.set(c, pal.length); pal.push(c); }
      }
      if (over) {
        const px = []; const step = Math.max(1, Math.floor(n / 40000));
        for (let i = 0; i < n; i += step) if (data[i * 4 + 3] >= 128) px.push([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]);
        const cols = BS.medianCut(px, trans >= 0 ? 255 : 256);
        pal = cols.map((c) => (c[0] << 16) | (c[1] << 8) | c[2]); if (trans >= 0) { trans = pal.length; pal.push(0); }
        const cache = new Int16Array(32768).fill(-1);
        for (let i = 0; i < n; i++) {
          if (data[i * 4 + 3] < 128) { idx[i] = trans; continue; }
          const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2]; const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
          let v = cache[key];
          if (v < 0) { let bd = 1e9; v = 0; for (let k = 0; k < cols.length; k++) { const c = cols[k]; const d = (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2; if (d < bd) { bd = d; v = k; } } cache[key] = v; }
          idx[i] = v;
        }
      } else {
        for (let i = 0; i < n; i++) idx[i] = data[i * 4 + 3] < 128 ? trans : map.get((data[i * 4] << 16) | (data[i * 4 + 1] << 8) | data[i * 4 + 2]);
      }
      const bitsN = Math.max(1, Math.ceil(Math.log2(Math.max(2, pal.length)))); const tsize = 1 << bitsN;
      const b = new Bytes(n + 2048);
      b.u8(0x21); b.u8(0xf9); b.u8(4); b.u8((1 << 2) | (trans >= 0 ? 1 : 0)); b.u16le(Math.max(2, Math.round(delayCs))); b.u8(trans >= 0 ? trans : 0); b.u8(0);
      b.u8(0x2c); b.u16le(0); b.u16le(0); b.u16le(this.w); b.u16le(this.h); b.u8(0x80 | (bitsN - 1));
      for (let i = 0; i < tsize; i++) { const c = pal[i] || 0; b.u8(c >> 16); b.u8(c >> 8); b.u8(c); }
      lzw(idx, Math.max(2, bitsN), b);
      this.parts.push(b.out());
    }
    finish() { this.parts.push(new Uint8Array([0x3b])); return new Blob(this.parts, { type: 'image/gif' }); }
  };

  // ---------- APNG ----------
  BS.APNG = class {
    constructor(w, h, frames, fps, loops) {
      this.w = w; this.h = h; this.fps = fps; this.seq = 0; this.first = true;
      const ih = new Bytes(13); ih.u32be(w); ih.u32be(h); ih.u8(8); ih.u8(6); ih.u8(0); ih.u8(0); ih.u8(0);
      const ac = new Bytes(8); ac.u32be(frames); ac.u32be(loops || 0);
      this.parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', ih.out()), pngChunk('acTL', ac.out())];
    }
    async addFrame(data) {
      const { w, h } = this; const raw = new Uint8Array((w * 4 + 1) * h);
      for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; raw.set(data.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1); }
      const z = await deflate(raw);
      const fc = new Bytes(26); fc.u32be(this.seq++); fc.u32be(w); fc.u32be(h); fc.u32be(0); fc.u32be(0); fc.u16be(1); fc.u16be(this.fps); fc.u8(0); fc.u8(0);
      this.parts.push(pngChunk('fcTL', fc.out()));
      if (this.first) { this.parts.push(pngChunk('IDAT', z)); this.first = false; }
      else { const fd = new Uint8Array(z.length + 4); new DataView(fd.buffer).setUint32(0, this.seq++); fd.set(z, 4); this.parts.push(pngChunk('fdAT', fd)); }
    }
    finish() { this.parts.push(pngChunk('IEND', new Uint8Array(0))); return new Blob(this.parts, { type: 'image/apng' }); }
  };

  // ---------- ZIP (store) ----------
  BS.Zip = class {
    constructor() { this.parts = []; this.cd = []; this.off = 0; }
    async add(name, blob) {
      const data = new Uint8Array(await blob.arrayBuffer()); const crc = BS.crc32(data); const nm = TE.encode(name);
      const d = new Date(); const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1); const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
      const h = new Bytes(30 + nm.length); h.u32le(0x04034b50); h.u16le(20); h.u16le(0x0800); h.u16le(0); h.u16le(time); h.u16le(date); h.u32le(crc); h.u32le(data.length); h.u32le(data.length); h.u16le(nm.length); h.u16le(0); h.bytes(nm);
      const c = new Bytes(46 + nm.length); c.u32le(0x02014b50); c.u16le(20); c.u16le(20); c.u16le(0x0800); c.u16le(0); c.u16le(time); c.u16le(date); c.u32le(crc); c.u32le(data.length); c.u32le(data.length); c.u16le(nm.length); c.u16le(0); c.u16le(0); c.u16le(0); c.u16le(0); c.u32le(0); c.u32le(this.off); c.bytes(nm);
      const hb = h.out(); this.parts.push(hb, data); this.cd.push(c.out()); this.off += hb.length + data.length;
    }
    finish() {
      const size = this.cd.reduce((s, c) => s + c.length, 0);
      const e = new Bytes(22); e.u32le(0x06054b50); e.u16le(0); e.u16le(0); e.u16le(this.cd.length); e.u16le(this.cd.length); e.u32le(size); e.u32le(this.off); e.u16le(0);
      return new Blob([...this.parts, ...this.cd, e.out()], { type: 'application/zip' });
    }
  };

  // ---------- Vector: rectangles from the dither grid ----------
  // returns { gw, gh, layers: [{hex, rects:[x,y,w,h,...]}], bgHex }
  BS.vectorize = function (grid, gw, gh, opts) {
    opts = opts || {};
    const counts = new Map();
    for (let i = 0, n = gw * gh; i < n; i++) { if (grid[i * 4 + 3] < 128) continue; const c = (grid[i * 4] << 16) | (grid[i * 4 + 1] << 8) | grid[i * 4 + 2]; counts.set(c, (counts.get(c) || 0) + 1); }
    let bg = null;
    if (opts.bg === 'common') { let m = -1; for (const [c, v] of counts) if (v > m) { m = v; bg = c; } }
    else if (opts.bg === 'lightest' || opts.bg === 'darkest') {
      let best = null, bl = opts.bg === 'lightest' ? -1 : 1e9;
      for (const c of counts.keys()) { const l = BS.luma(c >> 16, (c >> 8) & 255, c & 255); if (opts.bg === 'lightest' ? l > bl : l < bl) { bl = l; best = c; } }
      bg = best;
    }
    const key = (i) => { if (grid[i * 4 + 3] < 128) return -1; const c = (grid[i * 4] << 16) | (grid[i * 4 + 1] << 8) | grid[i * 4 + 2]; if (c === bg) return -1; return opts.inkOnly ? 0 : c; };
    const layers = new Map();
    let active = new Map();
    for (let y = 0; y < gh; y++) {
      const next = new Map(); let x = 0;
      while (x < gw) {
        const k = key(y * gw + x); let x1 = x + 1;
        while (x1 < gw && key(y * gw + x1) === k) x1++;
        if (k >= 0) {
          const id = x + ',' + x1 + ',' + k; const prev = active.get(id);
          if (prev) { prev[3]++; next.set(id, prev); }
          else { const r = [x, y, x1 - x, 1]; next.set(id, r); if (!layers.has(k)) layers.set(k, []); layers.get(k).push(r); }
        }
        x = x1;
      }
      active = next;
    }
    const hex = (c) => '#' + c.toString(16).padStart(6, '0');
    return { gw, gh, bgHex: bg == null ? null : hex(bg), layers: [...layers.entries()].map(([c, rects]) => ({ hex: opts.inkOnly ? opts.inkColor || '#000000' : hex(c), rects })) };
  };

  BS.encodeSVG = function (V, opts) {
    const parts = [];
    const wAttr = opts.unit === 'mm' ? opts.wmm.toFixed(2) + 'mm' : Math.round(opts.w);
    const hAttr = opts.unit === 'mm' ? opts.hmm.toFixed(2) + 'mm' : Math.round(opts.h);
    parts.push(`<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${V.gw} ${V.gh}" width="${wAttr}" height="${hAttr}" shape-rendering="crispEdges">\n<!-- Made with BitSkull -->\n`);
    if (opts.keepBg && V.bgHex) parts.push(`<rect id="background" width="${V.gw}" height="${V.gh}" fill="${V.bgHex}"/>\n`);
    V.layers.forEach((L, li) => {
      parts.push(`<g id="color-${li + 1}-${L.hex.slice(1)}" fill="${L.hex}"><path d="`);
      const r = L.rects; let chunk = '';
      for (let i = 0; i < r.length; i++) { const q = r[i]; chunk += `M${q[0]} ${q[1]}h${q[2]}v${q[3]}h-${q[2]}z`; if (chunk.length > 60000) { parts.push(chunk); chunk = ''; } }
      parts.push(chunk, '"/></g>\n');
    });
    parts.push('</svg>\n');
    return new Blob(parts, { type: 'image/svg+xml' });
  };

  BS.encodeEPS = function (V, opts) {
    const W = opts.wpt, H = opts.hpt, sx = W / V.gw, sy = H / V.gh; const parts = [];
    parts.push(`%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 ${Math.ceil(W)} ${Math.ceil(H)}\n%%HiResBoundingBox: 0 0 ${W.toFixed(3)} ${H.toFixed(3)}\n%%Creator: BitSkull\n%%EndComments\ngsave\n0 ${H.toFixed(4)} translate ${sx.toFixed(6)} ${(-sy).toFixed(6)} scale\n`);
    const rgb = (h) => BS.hexToRgb(h).map((v) => (v / 255).toFixed(4)).join(' ');
    if (opts.keepBg && V.bgHex) parts.push(`${rgb(V.bgHex)} setrgbcolor 0 0 ${V.gw} ${V.gh} rectfill\n`);
    for (const L of V.layers) {
      let s = `${rgb(L.hex)} setrgbcolor\n`;
      for (const q of L.rects) { s += `${q[0]} ${q[1]} ${q[2]} ${q[3]} rectfill\n`; if (s.length > 60000) { parts.push(s); s = ''; } }
      parts.push(s);
    }
    parts.push('grestore\nshowpage\n%%EOF\n');
    return new Blob(parts, { type: 'application/postscript' });
  };

  BS.encodePDF = async function (V, opts) {
    const W = opts.wpt, H = opts.hpt, sx = W / V.gw, sy = H / V.gh;
    const rgb = (h) => BS.hexToRgb(h).map((v) => (v / 255).toFixed(4)).join(' ');
    const cs = [`q ${sx.toFixed(6)} 0 0 ${(-sy).toFixed(6)} 0 ${H.toFixed(4)} cm\n`];
    if (opts.keepBg && V.bgHex) cs.push(`${rgb(V.bgHex)} rg 0 0 ${V.gw} ${V.gh} re f\n`);
    for (const L of V.layers) {
      let s = `${rgb(L.hex)} rg\n`;
      for (const q of L.rects) { s += `${q[0]} ${q[1]} ${q[2]} ${q[3]} re\n`; if (s.length > 60000) { cs.push(s); s = ''; } }
      cs.push(s, 'f\n');
    }
    cs.push('Q\n');
    const content = await deflate(new Uint8Array(await new Blob(cs).arrayBuffer()));
    const parts = []; const offs = []; let pos = 0;
    const push = (x) => { const u = typeof x === 'string' ? TE.encode(x) : x; parts.push(u); pos += u.length; };
    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'.replace(/[\xE2\xE3\xCF\xD3]/g, 'X'));
    const obj = (n, body) => { offs[n] = pos; push(`${n} 0 obj\n${body}\nendobj\n`); };
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W.toFixed(3)} ${H.toFixed(3)}] /Contents 4 0 R /Resources << >> >>`);
    offs[4] = pos; push(`4 0 obj\n<< /Length ${content.length} /Filter /FlateDecode >>\nstream\n`); push(content); push('\nendstream\nendobj\n');
    obj(5, '<< /Producer (BitSkull) /Creator (BitSkull) >>');
    const xref = pos;
    let x = 'xref\n0 6\n0000000000 65535 f \n'; for (let i = 1; i <= 5; i++) x += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
    push(x + `trailer\n<< /Size 6 /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(parts, { type: 'application/pdf' });
  };

  // ---------- MP4 (H.264 via WebCodecs) ----------
  const be32 = (v) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
  const be16 = (v) => [(v >> 8) & 255, v & 255];
  const s4 = (s) => [...s].map((c) => c.charCodeAt(0));
  const z = (n) => new Array(n).fill(0);
  function cat(parts) { const arr = parts.map((p) => (p instanceof Uint8Array ? p : Uint8Array.from(p))); const n = arr.reduce((s, a) => s + a.length, 0); const o = new Uint8Array(n); let k = 0; for (const a of arr) { o.set(a, k); k += a.length; } return o; }
  function box(type, ...parts) { const body = cat(parts); return cat([be32(body.length + 8), s4(type), body]); }
  function full(type, v, f, ...parts) { return box(type, [v, (f >> 16) & 255, (f >> 8) & 255, f & 255], ...parts); }
  function u32list(list) { const o = new Uint8Array(list.length * 4); const dv = new DataView(o.buffer); list.forEach((v, i) => dv.setUint32(i * 4, v)); return o; }
  const MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000].flatMap(be32);

  class MP4Muxer {
    constructor(w, h, fps) { this.w = w; this.h = h; this.fps = fps; this.samples = []; this.avcC = null; }
    add(chunk, meta) {
      if (meta && meta.decoderConfig && meta.decoderConfig.description && !this.avcC) {
        const d = meta.decoderConfig.description; this.avcC = d instanceof ArrayBuffer ? new Uint8Array(d.slice(0)) : new Uint8Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength));
      }
      const buf = new Uint8Array(chunk.byteLength); chunk.copyTo(buf); this.samples.push({ data: buf, key: chunk.type === 'key' });
    }
    finish() {
      const { w, h, fps } = this; const N = this.samples.length; const ts = fps * 1000, delta = 1000; const durMs = Math.round((N * 1000) / fps);
      const ftyp = box('ftyp', s4('isom'), be32(512), s4('isom'), s4('iso2'), s4('avc1'), s4('mp41'));
      const dataSize = this.samples.reduce((s, x) => s + x.data.length, 0);
      const mdatHead = cat([be32(dataSize + 8), s4('mdat')]);
      const keys = []; this.samples.forEach((s, i) => { if (s.key) keys.push(i + 1); }); if (!keys.length) keys.push(1);
      const avc1 = box('avc1', z(6), be16(1), z(16), be16(w), be16(h), be32(0x00480000), be32(0x00480000), be32(0), be16(1), z(32), be16(0x18), be16(0xffff), box('avcC', this.avcC || new Uint8Array(0)));
      const stbl = box('stbl',
        full('stsd', 0, 0, be32(1), avc1),
        full('stts', 0, 0, be32(1), be32(N), be32(delta)),
        full('stss', 0, 0, be32(keys.length), u32list(keys)),
        full('stsc', 0, 0, be32(1), be32(1), be32(N), be32(1)),
        full('stsz', 0, 0, be32(0), be32(N), u32list(this.samples.map((s) => s.data.length))),
        full('stco', 0, 0, be32(1), be32(ftyp.length + 8)));
      const minf = box('minf', full('vmhd', 0, 1, z(8)), box('dinf', full('dref', 0, 0, be32(1), full('url ', 0, 1))), stbl);
      const mdia = box('mdia', full('mdhd', 0, 0, be32(0), be32(0), be32(ts), be32(N * delta), be16(0x55c4), be16(0)), full('hdlr', 0, 0, be32(0), s4('vide'), z(12), s4('BitSkull Video'), [0]), minf);
      const tkhd = full('tkhd', 0, 3, be32(0), be32(0), be32(1), be32(0), be32(durMs), z(8), be16(0), be16(0), be16(0), be16(0), MATRIX, be32((w * 65536) >>> 0), be32((h * 65536) >>> 0));
      const mvhd = full('mvhd', 0, 0, be32(0), be32(0), be32(1000), be32(durMs), be32(0x00010000), be16(0x0100), z(10), MATRIX, z(24), be32(2));
      const moov = box('moov', mvhd, box('trak', tkhd, mdia));
      return new Blob([ftyp, mdatHead, ...this.samples.map((s) => s.data), moov], { type: 'video/mp4' });
    }
  }

  BS.encodeMP4 = async function (o, renderFrame, onProgress, isCancelled) {
    if (!('VideoEncoder' in window)) throw new Error('This browser has no WebCodecs video encoder. Use Edge or Chrome, or export GIF / APNG / PNG sequence.');
    const w = o.w & ~1, h = o.h & ~1;
    const codecs = ['avc1.640034', 'avc1.640033', 'avc1.640032', 'avc1.64002A', 'avc1.640028', 'avc1.4D0034', 'avc1.4D0028', 'avc1.42E034', 'avc1.42E01F'];
    let cfg = null;
    for (const codec of codecs) {
      for (const hw of ['no-preference', 'prefer-software']) {
        const c = { codec, width: w, height: h, bitrate: o.bitrate, framerate: o.fps, avc: { format: 'avc' }, hardwareAcceleration: hw };
        try { const s = await VideoEncoder.isConfigSupported(c); if (s.supported) { cfg = c; break; } } catch (e) { /* try next */ }
      }
      if (cfg) break;
    }
    if (!cfg) throw new Error(`H.264 encoding isn't available at ${w}×${h}. Try a smaller size.`);
    const mux = new MP4Muxer(w, h, o.fps); let err = null;
    const enc = new VideoEncoder({ output: (c, m) => mux.add(c, m), error: (e) => { err = e; } });
    enc.configure(cfg);
    const tmp = document.createElement('canvas'); tmp.width = w; tmp.height = h; const tx = tmp.getContext('2d');
    for (let i = 0; i < o.count; i++) {
      if (isCancelled && isCancelled()) { enc.close(); throw new Error('Cancelled'); }
      const c = await renderFrame(i);
      tx.fillStyle = o.bg || '#000'; tx.fillRect(0, 0, w, h); tx.imageSmoothingEnabled = false; tx.drawImage(c, 0, 0, w, h);
      const vf = new VideoFrame(tmp, { timestamp: Math.round((i * 1e6) / o.fps), duration: Math.round(1e6 / o.fps) });
      enc.encode(vf, { keyFrame: i % Math.max(1, Math.round(o.fps * 2)) === 0 }); vf.close();
      while (enc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 4));
      if (err) throw err;
      if (onProgress) onProgress((i + 1) / o.count);
    }
    await enc.flush(); enc.close();
    if (err) throw err;
    return mux.finish();
  };
})();
