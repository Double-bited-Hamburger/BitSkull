/* BitSkull — palettes, extraction, import/export */
(function () {
  'use strict';
  const BS = window.BS;

  const gray = (n) => Array.from({ length: n }, (_, i) => { const v = Math.round((i / (n - 1)) * 255); return BS.rgbToHex(v, v, v); });

  BS.PALETTES = [
    // 1-bit & duotone
    { cat: '1-bit & Duotone', name: 'Black & White', colors: ['#000000', '#ffffff'] },
    { cat: '1-bit & Duotone', name: 'Ink & Paper', colors: ['#1b1a17', '#f1ede2'] },
    { cat: '1-bit & Duotone', name: 'Newsprint', colors: ['#1d1d1b', '#e9e3d2'] },
    { cat: '1-bit & Duotone', name: 'Blueprint', colors: ['#0b3d91', '#e8f1ff'] },
    { cat: '1-bit & Duotone', name: 'Acid', colors: ['#0b0b10', '#c6ff3d'] },
    { cat: '1-bit & Duotone', name: 'Blood', colors: ['#120000', '#ff1a1a'] },
    { cat: '1-bit & Duotone', name: 'Toxic', colors: ['#06140a', '#39ff14'] },
    { cat: '1-bit & Duotone', name: 'Midnight Orange', colors: ['#10002b', '#ff9e00'] },
    { cat: '1-bit & Duotone', name: 'Deep Sea', colors: ['#03045e', '#90e0ef'] },
    { cat: '1-bit & Duotone', name: 'Lavender', colors: ['#2e1a47', '#e0c3fc'] },
    { cat: '1-bit & Duotone', name: 'Bubblegum', colors: ['#2b0a3d', '#ff8fd0'] },
    { cat: '1-bit & Duotone', name: 'Amber Mono', colors: ['#1a0f00', '#ffb000'] },
    // Grayscale
    { cat: 'Grayscale', name: 'Gray 3', colors: gray(3) },
    { cat: 'Grayscale', name: 'Gray 4', colors: gray(4) },
    { cat: 'Grayscale', name: 'Gray 8', colors: gray(8) },
    { cat: 'Grayscale', name: 'Gray 16', colors: gray(16) },
    // Retro hardware
    { cat: 'Retro Hardware', name: 'Handheld Green', colors: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'] },
    { cat: 'Retro Hardware', name: 'Handheld Pocket', colors: ['#1f1f1a', '#5d5d52', '#a3a38f', '#e3e3cf'] },
    { cat: 'Retro Hardware', name: 'CGA Cyan/Magenta', colors: ['#000000', '#55ffff', '#ff55ff', '#ffffff'] },
    { cat: 'Retro Hardware', name: 'CGA Green/Red', colors: ['#000000', '#55ff55', '#ff5555', '#ffff55'] },
    { cat: 'Retro Hardware', name: 'EGA 16', colors: ['#000000', '#0000aa', '#00aa00', '#00aaaa', '#aa0000', '#aa00aa', '#aa5500', '#aaaaaa', '#555555', '#5555ff', '#55ff55', '#55ffff', '#ff5555', '#ff55ff', '#ffff55', '#ffffff'] },
    { cat: 'Retro Hardware', name: 'PICO-8', colors: ['#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8', '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa'] },
    { cat: 'Retro Hardware', name: 'C64', colors: ['#000000', '#ffffff', '#68372b', '#70a4b2', '#6f3d86', '#588d43', '#352879', '#b8c76f', '#6f4f25', '#433900', '#9a6759', '#444444', '#6c6c6c', '#9ad284', '#6c5eb5', '#959595'] },
    { cat: 'Retro Hardware', name: 'ZX Spectrum', colors: ['#000000', '#0000d7', '#d70000', '#d700d7', '#00d700', '#00d7d7', '#d7d700', '#d7d7d7', '#0000ff', '#ff0000', '#ff00ff', '#00ff00', '#00ffff', '#ffff00', '#ffffff'] },
    { cat: 'Retro Hardware', name: 'Teletext', colors: ['#000000', '#ff0000', '#00ff00', '#ffff00', '#0000ff', '#ff00ff', '#00ffff', '#ffffff'] },
    { cat: 'Retro Hardware', name: 'Apple II Hi-Res', colors: ['#000000', '#14f53c', '#ff44fd', '#14cffd', '#ff6a3c', '#ffffff'] },
    { cat: 'Retro Hardware', name: 'Virtual Red', colors: ['#000000', '#550000', '#aa0000', '#ff0000'] },
    { cat: 'Retro Hardware', name: 'Green Phosphor', colors: ['#001100', '#00561b', '#00a83a', '#33ff66'] },
    { cat: 'Retro Hardware', name: 'Amber Phosphor', colors: ['#120800', '#5c3300', '#b36b00', '#ffb000'] },
    // Print
    { cat: 'Print', name: 'CMYK Inks', colors: ['#ffffff', '#00aeef', '#ec008c', '#fff200', '#000000'] },
    { cat: 'Print', name: 'Riso Blue/Pink', colors: ['#f5f1e6', '#ff48b0', '#0078bf', '#2b2a6b'] },
    { cat: 'Print', name: 'Riso Yellow/Teal', colors: ['#f6f2e8', '#ffe800', '#00838a', '#123b3d'] },
    { cat: 'Print', name: 'Sepia', colors: ['#2b1d0e', '#5e4026', '#9a7449', '#d4b483', '#f4e4c1'] },
    { cat: 'Print', name: 'Banknote', colors: ['#1f3326', '#4f6b52', '#a9bfa0', '#eef0e2'] },
    { cat: 'Print', name: 'Cyanotype', colors: ['#0b2a5b', '#1f4e8c', '#5c8fc7', '#dfe9f5'] },
    // Mood
    { cat: 'Mood', name: 'Vaporwave', colors: ['#2d0a3d', '#b967ff', '#ff71ce', '#01cdfe', '#05ffa1', '#fffb96'] },
    { cat: 'Mood', name: 'Synthwave', colors: ['#120b26', '#2e2157', '#f706cf', '#fd3777', '#f9c80e', '#2de2e6'] },
    { cat: 'Mood', name: 'Cyberpunk', colors: ['#0d0221', '#261447', '#ff3864', '#2de2e6', '#f6019d', '#fffb96'] },
    { cat: 'Mood', name: 'Matrix', colors: ['#000000', '#003b00', '#008f11', '#00ff41'] },
    { cat: 'Mood', name: 'Thermal', colors: ['#000004', '#1f0a5c', '#6a0f8e', '#b5367a', '#e8642e', '#fca50a', '#fcffa4'] },
    { cat: 'Mood', name: 'Sunset', colors: ['#2b0f54', '#ab1f65', '#ff4f69', '#ff8142', '#ffda45', '#fff7f8'] },
    { cat: 'Mood', name: 'Forest', colors: ['#0e1a12', '#24412b', '#4f7a3a', '#a3b85c', '#e8e3b5'] },
    { cat: 'Mood', name: 'Ice', colors: ['#0a1426', '#22406b', '#4d86b3', '#9fd3e6', '#f0fbff'] },
    { cat: 'Mood', name: 'Gold', colors: ['#1c1200', '#5b4310', '#a8862e', '#ffd866', '#fff6d6'] },
    { cat: 'Mood', name: 'Spectrum', colors: ['#ff0000', '#ff8000', '#ffff00', '#00ff00', '#00ffff', '#0040ff', '#8000ff'] },
    { cat: 'Mood', name: 'Nightclub', colors: ['#050008', '#3a0ca3', '#7209b7', '#f72585', '#4cc9f0'] },
  ];

  BS.paletteByName = (name) => BS.PALETTES.find((p) => p.name === name);

  // ---------- Median cut + k-means extraction ----------
  BS.medianCut = function (px /* Array of [r,g,b] 0..255 */, n) {
    if (!px.length) return [[0, 0, 0], [255, 255, 255]];
    let boxes = [px];
    const range = (b) => {
      let mn = [255, 255, 255], mx = [0, 0, 0];
      for (const p of b) for (let c = 0; c < 3; c++) { if (p[c] < mn[c]) mn[c] = p[c]; if (p[c] > mx[c]) mx[c] = p[c]; }
      return [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
    };
    while (boxes.length < n) {
      let bi = -1, best = -1, bc = 0;
      boxes.forEach((b, i) => {
        if (b.length < 2) return;
        const r = range(b); const c = r.indexOf(Math.max(...r));
        const score = r[c] * Math.sqrt(b.length);
        if (score > best) { best = score; bi = i; bc = c; }
      });
      if (bi < 0 || best <= 0) break;
      const b = boxes[bi].slice().sort((a, z) => a[bc] - z[bc]);
      const mid = b.length >> 1;
      boxes.splice(bi, 1, b.slice(0, mid), b.slice(mid));
    }
    let cents = boxes.map((b) => {
      const s = [0, 0, 0]; for (const p of b) { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; }
      return [s[0] / b.length, s[1] / b.length, s[2] / b.length];
    });
    // k-means refinement
    for (let it = 0; it < 6; it++) {
      const sum = cents.map(() => [0, 0, 0, 0]);
      for (const p of px) {
        let bi = 0, bd = 1e12;
        for (let i = 0; i < cents.length; i++) {
          const c = cents[i]; const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
          if (d < bd) { bd = d; bi = i; }
        }
        const s = sum[bi]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++;
      }
      cents = cents.map((c, i) => (sum[i][3] ? [sum[i][0] / sum[i][3], sum[i][1] / sum[i][3], sum[i][2] / sum[i][3]] : c));
    }
    return cents.map((c) => c.map(Math.round));
  };

  BS.extractPalette = function (source, n) {
    const sw = source.width || source.videoWidth || 1, sh = source.height || source.videoHeight || 1;
    const s = Math.min(1, 140 / Math.max(sw, sh));
    const w = Math.max(1, Math.round(sw * s)), h = Math.max(1, Math.round(sh * s));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(source, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h).data;
    const px = [];
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 127) px.push([d[i], d[i + 1], d[i + 2]]);
    const cols = BS.medianCut(px, Math.max(2, n | 0));
    return cols.map((c) => BS.rgbToHex(c[0], c[1], c[2])).filter((v, i, a) => a.indexOf(v) === i)
      .sort((a, b) => BS.hexLuma(a) - BS.hexLuma(b));
  };

  // Random harmonious palette
  BS.randomPalette = function (n, rnd) {
    rnd = rnd || Math.random;
    const base = rnd() * 360;
    const scheme = Math.floor(rnd() * 4);
    const out = [];
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : i / (n - 1);
      let hue = base;
      if (scheme === 0) hue = base + t * 60; // analogous
      else if (scheme === 1) hue = base + (i % 2) * 180; // complementary
      else if (scheme === 2) hue = base + i * 120; // triad
      else hue = base + t * 300; // rainbow
      out.push(BS.hslToHex(hue, 0.55 + rnd() * 0.45, 0.06 + t * 0.86));
    }
    return out;
  };

  // ---------- Import / export ----------
  BS.parsePaletteText = function (text) {
    text = String(text || '');
    try {
      const j = JSON.parse(text);
      const arr = Array.isArray(j) ? j : j.colors || (j.palette && j.palette.colors);
      if (Array.isArray(arr)) return arr.map((c) => (String(c).startsWith('#') ? c : '#' + c)).filter((c) => /^#[0-9a-f]{6}$/i.test(c));
    } catch (e) { /* not json */ }
    const out = [];
    if (/GIMP Palette/i.test(text)) {
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})/);
        if (m) out.push(BS.rgbToHex(+m[1], +m[2], +m[3]));
      }
      return out;
    }
    const re = /#?\b([0-9a-f]{6})\b/gi; let m;
    while ((m = re.exec(text))) out.push('#' + m[1].toLowerCase());
    return out;
  };
  BS.paletteToGPL = (name, colors) =>
    'GIMP Palette\nName: ' + name + '\nColumns: 8\n#\n' +
    colors.map((h) => { const c = BS.hexToRgb(h); return c.map((v) => String(v).padStart(3, ' ')).join(' ') + '\t' + h; }).join('\n') + '\n';
  BS.paletteToHex = (colors) => colors.map((c) => c.replace('#', '')).join('\n') + '\n';
})();
