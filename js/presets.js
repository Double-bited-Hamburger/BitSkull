/* BitSkull — built-in presets (partial settings merged over defaults) */
(function () {
  'use strict';
  const BS = window.BS;
  const pal = (name) => { const p = BS.paletteByName(name); return { name, colors: p.colors.slice(), locks: p.colors.map(() => false) }; };
  const fx = (type, p) => ({ uid: BS.uid(), type, on: true, p: Object.assign(Object.fromEntries((BS.PRE[type] || BS.POST[type]).params.map((q) => [q.k, q.d])), p || {}) });

  BS.PRESETS = [
    { name: 'Classic Mac 1-bit', tags: 'mono', s: { algo: 'atkinson', dither: { pixelSize: 2 }, palette: pal('Black & White'), adjust: { contrast: 0.15 } } },
    { name: 'Newsprint', tags: 'print halftone', s: { algo: 'ht_euclid', algoParams: { ht_euclid: { cell: 7, angle: 45 } }, dither: { pixelSize: 1 }, palette: pal('Newsprint'), adjust: { contrast: 0.2 }, post: [fx('grain', { amount: 0.06 })] } },
    { name: 'CMYK Pop', tags: 'print halftone color', s: { algo: 'ht_cmyk', algoParams: { ht_cmyk: { cell: 9 } }, dither: { pixelSize: 1 }, color: { mode: 'palette' }, adjust: { saturation: 0.3, contrast: 0.1 } } },
    { name: 'Handheld Green', tags: 'retro game', s: { algo: 'bayer4', dither: { pixelSize: 4 }, palette: pal('Handheld Green'), adjust: { contrast: 0.25 } } },
    { name: 'Riso Duo', tags: 'print', s: { algo: 'bluenoise', dither: { pixelSize: 2 }, color: { mode: 'palette' }, palette: pal('Riso Blue/Pink'), adjust: { saturation: 0.4 }, post: [fx('grain', { amount: 0.08, size: 2 })] } },
    { name: 'Neon Glow', tags: 'glow color', s: { algo: 'floyd', dither: { pixelSize: 3 }, palette: pal('Synthwave'), adjust: { contrast: 0.3 }, post: [fx('bloom', { threshold: 0.45, radius: 18, intensity: 1.6 })] } },
    { name: 'Matrix Terminal', tags: 'ascii glow', s: { algo: 'ascii', algoParams: { ascii: { cell: 10, invert: true, set: 'binary' } }, dither: { pixelSize: 1 }, palette: pal('Matrix'), color: { mode: 'mono' }, post: [fx('bloom', { threshold: 0.4, radius: 10, intensity: 1.2 }), fx('scanlines', { period: 3, dark: 0.35 })] } },
    { name: 'VHS Tape', tags: 'glitch animated', s: { algo: 'bayer4', dither: { pixelSize: 2 }, color: { mode: 'rgb', rgbLevels: 3 }, adjust: { saturation: 0.25 }, pre: [fx('temporal', { pattern: 'roll', amount: 0.35 })], post: [fx('chroma', { amount: 5 }), fx('scanlines', { period: 3, dark: 0.3 }), fx('grain', { amount: 0.1 })] } },
    { name: 'Glitch Sorter', tags: 'glitch', s: { algo: 'g_pixelsort', algoParams: { g_pixelsort: { low: 0.3, high: 0.95, dir: 'v' } }, dither: { pixelSize: 2 }, color: { mode: 'palette' }, palette: pal('Vaporwave') } },
    { name: 'JPEG Rot', tags: 'glitch', s: { algo: 'floyd', dither: { pixelSize: 2 }, color: { mode: 'palette' }, palette: pal('PICO-8'), post: [fx('jpeg', { quality: 12, glitch: 0.18 })] } },
    { name: 'Arcade CRT', tags: 'retro', s: { algo: 'crt', dither: { pixelSize: 1 }, adjust: { contrast: 0.2, saturation: 0.3 }, post: [fx('crt', { curve: 0.14 }), fx('bloom', { threshold: 0.5, radius: 8, intensity: 0.8 })] } },
    { name: 'LED Billboard', tags: 'glow color', s: { algo: 'led', algoParams: { led: { cell: 9, size: 0.85 } }, dither: { pixelSize: 1 }, color: { mode: 'palette' }, palette: pal('EGA 16'), post: [fx('bloom', { threshold: 0.35, radius: 10, intensity: 1.3 })] } },
    { name: 'Banknote Engraving', tags: 'print lines', s: { algo: 'engrave', algoParams: { engrave: { period: 4 } }, dither: { pixelSize: 1 }, palette: pal('Banknote'), adjust: { contrast: 0.25 } } },
    { name: 'Stipple Ink', tags: 'print', s: { algo: 'stipple', algoParams: { stipple: { cell: 5 } }, dither: { pixelSize: 1 }, palette: pal('Ink & Paper'), adjust: { contrast: 0.2 } } },
    { name: 'Thermal Vision', tags: 'color', s: { algo: 'floyd', dither: { pixelSize: 3 }, palette: pal('Thermal'), adjust: { contrast: 0.2 }, post: [fx('bloom', { threshold: 0.6, radius: 12, intensity: 0.7 })] } },
    { name: 'Blueprint', tags: 'lines', s: { algo: 'edgeink', algoParams: { edgeink: { thr: 0.14, fill: 'bayer' } }, dither: { pixelSize: 1.5 }, palette: pal('Blueprint'), adjust: { contrast: -0.3 }, pre: [] } },
    { name: 'Amber Monitor', tags: 'retro glow', s: { algo: 'bayer8', dither: { pixelSize: 2 }, palette: pal('Amber Phosphor'), post: [fx('scanlines', { period: 3, dark: 0.5 }), fx('bloom', { threshold: 0.4, radius: 9, intensity: 1 })] } },
    { name: 'Vaporwave Dream', tags: 'color', s: { algo: 'bluenoise', dither: { pixelSize: 2 }, color: { mode: 'palette' }, palette: pal('Vaporwave'), adjust: { saturation: 0.5 }, post: [fx('chroma', { amount: 3 })] } },
    { name: 'Pixel Art Poster', tags: 'color pixel', s: { algo: 'floyd', dither: { pixelSize: 6, strength: 0.55 }, color: { mode: 'palette', metric: 'oklab' }, palette: pal('PICO-8'), adjust: { saturation: 0.25, contrast: 0.1 } } },
    { name: 'Woodcut Print', tags: 'print lines', s: { algo: 'woodcut', algoParams: { woodcut: { period: 5, warp: 2 } }, dither: { pixelSize: 1 }, palette: pal('Ink & Paper'), adjust: { contrast: 0.3 } } },
    { name: 'Topographic', tags: 'lines', s: { algo: 'contour', algoParams: { contour: { levels: 14, smooth: 3 } }, dither: { pixelSize: 1 }, palette: pal('Deep Sea'), color: { invert: true } } },
    { name: 'Pulse Lines', tags: 'lines', s: { algo: 'wavelines', algoParams: { wavelines: { period: 9, amp: 1.6 } }, dither: { pixelSize: 1 }, palette: pal('Black & White'), color: { invert: true }, adjust: { contrast: 0.2 } } },
    { name: 'Cyber Spiral', tags: 'lines color', s: { algo: 'spiral', algoParams: { spiral: { period: 6 } }, dither: { pixelSize: 1 }, palette: pal('Cyberpunk'), color: { mode: 'palette' }, post: [fx('bloom', { threshold: 0.5, radius: 10, intensity: 1 })] } },
    { name: 'Cross Stitch', tags: 'craft color', s: { algo: 'stitch', algoParams: { stitch: { cell: 8 } }, dither: { pixelSize: 1 }, color: { mode: 'palette' }, palette: pal('PICO-8') } },
    { name: 'Datamosh', tags: 'glitch', s: { algo: 'g_datamosh', algoParams: { g_datamosh: { block: 14, prob: 0.45 } }, dither: { pixelSize: 2 }, color: { mode: 'palette' }, palette: pal('C64') } },
    { name: 'Broken Signal', tags: 'glitch animated', s: { algo: 'g_rowshift', algoParams: { g_rowshift: { amount: 0.2, prob: 0.25 } }, dither: { pixelSize: 2 }, palette: pal('Acid'), pre: [fx('temporal', { pattern: 'static', amount: 0.25 })], post: [fx('rgbsplit', { x: 5 }), fx('glitchbands', {})] } },
    { name: 'Bit Crush', tags: 'glitch color', s: { algo: 'g_bitcrush', algoParams: { g_bitcrush: { bits: 2, xor: 60 } }, dither: { pixelSize: 2 }, color: { mode: 'rgb', rgbLevels: 2 } } },
    { name: 'Photocopy', tags: 'mono', s: { algo: 'threshold', algoParams: { threshold: { level: 0.45 } }, dither: { pixelSize: 1 }, palette: pal('Ink & Paper'), adjust: { contrast: 0.4, noise: 0.15, sharpen: 1 }, post: [fx('grain', { amount: 0.08, size: 1.5 })] } },
    { name: 'Red Alert', tags: 'mono', s: { algo: 'floyd', dither: { pixelSize: 3 }, palette: pal('Blood'), adjust: { contrast: 0.35 }, post: [fx('scanlines', { period: 4, dark: 0.5 })] } },
    { name: 'Psychedelic Cycles', tags: 'color', s: { algo: 'floyd', dither: { pixelSize: 2 }, palette: pal('Spectrum'), color: { cycles: 3, order: 'custom' } } },
    { name: 'Boiling Ink', tags: 'animated', s: { algo: 'floyd', dither: { pixelSize: 2 }, palette: pal('Ink & Paper'), pre: [fx('temporal', { pattern: 'boil', amount: 0.3 })], anim: { on: true, duration: 2, fps: 12 } } },
    { name: 'Dot Matrix Receipt', tags: 'print', s: { algo: 'dotmatrix', algoParams: { dotmatrix: { cell: 5 } }, dither: { pixelSize: 1 }, palette: pal('Ink & Paper'), adjust: { contrast: 0.2 } } },
    { name: 'Glitch Cathedral', tags: 'glitch', s: { algo: 'g_melt', algoParams: { g_melt: { prob: 0.4, length: 0.4 } }, dither: { pixelSize: 2 }, palette: pal('Gold') } },
    { name: 'Lo-fi Cyan', tags: 'color', s: { algo: 'cluster8', dither: { pixelSize: 2 }, palette: pal('Cyanotype'), adjust: { contrast: 0.15 } } },
  ];

  BS.applyPreset = function (cur, preset) {
    const base = BS.defaultSettings();
    BS.merge(base, preset.s || preset.settings || {});
    // keep the user's animation layers unless preset defines anim
    if (!(preset.s && preset.s.anim)) base.anim = BS.clone(cur.anim);
    base.pre = (base.pre || []).map((f) => Object.assign({}, f, { uid: BS.uid() }));
    base.post = (base.post || []).map((f) => Object.assign({}, f, { uid: BS.uid() }));
    return BS.normalizeSettings(base);
  };
})();
