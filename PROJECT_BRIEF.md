# BitSkull: Project Brief

> A complete description of the BitSkull project, written so another agent can compare it with a second idea and merge the two into one.
> Repo: https://github.com/Double-bited-Hamburger/BitSkull (public, branch `main`, release `v1.0.0` with `BitSkull.exe`)

---

## 1. What it is

BitSkull is a **personal desktop dithering studio** for images, GIFs and video. It turns any picture or clip into a stylised 1-bit, retro, halftone, glitch or print look. You can then export the result as a high-resolution raster, a scalable vector, an animation or a video.

The functionality is **inspired by Dither Boy** (Studio AAA's commercial dithering app), but it is an original implementation: original code, name, logo and presets. No assets were copied from Dither Boy.

### Why it exists (user story)
- The owner downloaded a cracked copy of Dither Boy. It contained malware that stole browser cookies and sessions and hijacked their Telegram and Instagram accounts.
- They wanted their **own safe version** with the same power, for personal creative use.
- This makes these **non-negotiable design values**:
  - **100% local and offline.** No network calls, no telemetry, no accounts, no uploads.
  - **Its own isolated browser profile** when launched as an app, so it never shares cookies or sessions with the user's normal browser.
  - **Nothing to install.** It runs on stock Windows 11.

### Owner's original requirements
1. Match the latest Dither Boy feature set (algorithms, effects, shortcuts and so on). It doesn't have to be 1:1.
2. **Logo:** a vector skull in a hacker/glitch style (inspired by the Watch Dogs vibe, not a copy) with an **open mouth**.
3. Add extra useful features, especially **ready-made presets** for popular Dither Boy-style looks.
4. **Export in all common formats, including vector.** Offer predefined resolutions plus a custom size that scales **without quality loss**.
5. Later: ship it as **a single `.exe`**, then put it on GitHub (public) so it can be downloaded at school without logging in.

---

## 2. Tech stack and constraints

| Aspect | Choice | Why |
|---|---|---|
| Language | Plain HTML, CSS and JavaScript (ES2020+) | Zero build step and zero dependencies |
| Script loading | Classic `<script>` tags, one global namespace `window.BS` | Must run from `file://` (ES modules and workers are blocked there) |
| Rendering | Canvas 2D with a hand-written float pipeline (no WebGL) | Deterministic, portable, and preview matches export exactly |
| Video encode | WebCodecs `VideoEncoder` (H.264) plus a custom MP4 muxer | No ffmpeg, no libraries |
| GIF decode | `ImageDecoder` (WebCodecs) | Native animated-GIF frame access |
| Compression | `CompressionStream('deflate')` | PNG/APNG/PDF zlib streams without libraries |
| Encoders | Hand-written: GIF (LZW), APNG, TIFF, BMP, ZIP (store), SVG, PDF, EPS, MP4 container, PNG `pHYs` and JPEG JFIF DPI injection | No third-party code at all |
| Persistence | `localStorage`, keys prefixed `bitskull.` | Custom presets, palettes, export settings and theme |
| Desktop shell | Small C# (.NET Framework 4) launcher → Edge/Chrome `--app` window | Compiles with the `csc.exe` that ships with Windows; no SDK needed |
| External deps | **None** (no npm, no CDN, no fonts from the web) | Security and offline use |

Target browsers are Chromium-based: Edge or Chrome. WebCodecs (needed for MP4 export and GIF import) is Chromium-only.

---

## 3. File map

```
BitSkull/
├── BitSkull.exe          Single-file app (≈290 KB), with all web files embedded as resources
├── index.html            App shell: menubar, panels, stage, timeline, dialogs
├── css/app.css           Layout + 6 themes via CSS variables
├── js/
│   ├── util.js           Math helpers, colour helpers (hex/rgb/OKLab/luma), PRNG (mulberry32, hash2),
│   │                     easing, crc32, download/blob helpers, localStorage wrapper, box blur
│   ├── palettes.js       46 palettes, median-cut + k-means extraction, random palette,
│   │                     parse/export .gpl / .hex / .json
│   ├── dither.js         84 algorithms, error-diffusion engine, threshold engine, blue noise,
│   │                     quantizer (mono / palette / rgb), distortion remap
│   ├── effects.js        16 adjustments, 14 pre-dither effects, 13 post-dither effects
│   ├── pipeline.js       Settings schema, normalisation, animation evaluation, Renderer class
│   ├── presets.js        34 built-in presets + applyPreset()
│   ├── encoders.js       All file encoders + vectorizer + MP4 muxer
│   ├── ui.js             Tiny DOM/param-control helpers, toasts, file picker
│   ├── app.js            Main controller (state, panels, view, history, timeline, menus, shortcuts)
│   └── export.js         Export dialog (Image / Vector / Animation / Batch)
├── assets/logo.svg       Original glitch-skull logo (vector)
├── build/
│   ├── Launcher.cs       Source of BitSkull.exe
│   ├── build.ps1         Rebuild script (uses Windows' built-in csc.exe)
│   └── bitskull.ico      Multi-size icon (16–256 px) rendered from logo.svg
├── tools/serve.js        Optional Node static server (port 5178) for development
├── Start BitSkull.bat    Alternative launcher (Edge app mode on index.html)
├── README.md             User-facing readme
└── PROJECT_BRIEF.md      This file
```

Size: roughly 260 KB of JavaScript in total, with no minification.

---

## 4. Rendering pipeline

```
source (image / video frame / GIF frame)
  → sample to a working grid   (grid = source size ÷ pixelSize, capped by quality mode)
  → adjustments                (16 controls)
  → pre-effects stack          (ordered, toggleable; distortions happen here)
  → dither algorithm           (error diffusion / threshold / pattern / halftone / glitch / special)
  → quantizer                  (mono gradient map, palette nearest-colour, or RGB levels)
  → upscale / fit to output    (nearest-neighbour = crisp pixels)
  → post-effects stack         (ordered, toggleable; glow, CRT, chroma, etc.)
  → canvas
```

**Key ideas**
- **Grid scale factor `k`.** Every size-type parameter (radius, period, offset, and so on) is multiplied by `k`. This makes a reduced-resolution preview look identical to the full-resolution export.
- **Quality caps for preview:** draft 350k px, normal 1.2M px, high 4M px, or full. In adaptive mode the cap drops automatically while you drag a slider or play the timeline.
- **Post-effects** use `unit = outputWidth / 1000`, so they scale with the output size.
- **Renderer API:**
  - Call: `render(src, settings, {maxGrid, detail, outW, outH, fit, bg, time, frame, target})`
  - Returns: `{canvas, gw, gh, grid, reduced, k, ms}`

### Quantizer / colour modes
- **Mono.** Maps luminance onto the palette as a gradient. Options:
  - order (dark→light, or as listed)
  - **luma cycles**, which repeat the palette several times across the tonal range for psychedelic bands
  - mirror cycles
  - invert
  - keep transparency
- **Palette.** Picks the nearest colour in the palette for each pixel, using one of three metrics: weighted RGB, plain RGB or **OKLab** (perceptual). A 6-bit lookup cache keeps this fast.
- **RGB.** Dithers each channel separately to N levels (2–8).

---

## 5. Feature inventory (exact, taken from the code)

### 5.1 Algorithms: 84 in 6 categories

**Error Diffusion (18):** Floyd–Steinberg, False Floyd–Steinberg, Jarvis–Judice–Ninke, Stucki, Atkinson, Burkes, Sierra, Two-Row Sierra, Sierra Lite, Stevenson–Arce, Fan, Shiau–Fan, Shiau–Fan 2, Pigeon, Horizontal Line, Vertical Line, Diagonal Drift, Riemersma (Hilbert curve).
The engine supports a serpentine scan, a strength (diffusion gain) setting, threshold bias, jitter and seed.

**Ordered (11):** Bayer 2×2, 4×4, 8×8 and 16×16, Clustered Dot 4×4 and 8×8, Blue Noise (void-and-cluster, generated at runtime), White Noise, Interleaved Gradient, Diagonal Ordered 8×8, Spiral Ordered 8×8.

**Pattern (12):** Horizontal Lines, Vertical Lines, Diagonal Lines, Crosshatch, Grid, Hex Dots, Diamond Grid, Brick, Waves, Zigzag, Checker, Basket Weave.

**Halftone (9):** Circle Dots, Euclidean Dots, Square Dots, Line Screen, Diamond Dots, Ellipse Dots, Cross Screen, CMYK Halftone (4 rotated screens), RGB Screen. Each screen has a cell size and an angle.

**Glitch (17):**
- Distortion-based, each layered on a selectable base dither (11): Pixel Sort, Row Shift, Slice Shift, Block Displace, RGB Split, Wave Warp, Melt/Drip, Interlace Tear, VHS Tracking, Mirror Glitch, Datamosh Smear.
- Broken-dither algorithms (6): Error Overflow, Scanline Error, Broken Bayer, Bit Crush, Random Kernel, Static Noise.

**Special (17):** Threshold, Posterize (Nearest), Mosaic, ASCII Art, Stipple, Line Modulation, Woodcut, Concentric Rings, Spiral, Pulse Lines, Engraving, Topographic Contours, Edge Ink, LED Matrix, CRT Phosphor, Dot Matrix Print, Cross Stitch.

### 5.2 Global dither controls
- Pixel size (0.5–32)
- Error diffusion strength
- Threshold bias
- Jitter
- Serpentine scan
- Seed
- Per-algorithm parameters, which vary by algorithm (for example cell size, angle, line width, characters, base dither or amplitude)

### 5.3 Palettes: 46 built-in
- **1-bit and duotone (12):** Black & White, Ink & Paper, Newsprint, Blueprint, Acid, Blood, Toxic, Midnight Orange, Deep Sea, Lavender, Bubblegum, Amber Mono.
- **Grayscale (4):** Gray 3, Gray 4, Gray 8, Gray 16.
- **Retro hardware (13):** Handheld Green, Handheld Pocket, CGA Cyan/Magenta, CGA Green/Red, EGA 16, PICO-8, C64, ZX Spectrum, Teletext, Apple II Hi-Res, Virtual Red, Green Phosphor, Amber Phosphor.
- **Print (6):** CMYK Inks, Riso Blue/Pink, Riso Yellow/Teal, Sepia, Banknote, Cyanotype.
- **Mood (11):** Vaporwave, Synthwave, Cyberpunk, Matrix, Thermal, Sunset, Forest, Ice, Gold, Spectrum, Nightclub.

**Palette editor**
- Swatches can be edited, locked or deleted, and new ones added.
- Shuffle, reverse, and sort by luma.
- Extract a palette from the image (median cut followed by k-means), with 2–64 colours.
- Random palette.
- Import from `.gpl` (GIMP), `.hex`, `.json` or pasted text.
- Export as `.gpl`, which also copies the hex list to the clipboard.
- Save your own palettes, which persist.

### 5.4 Adjustments: 16, each with a lock so Randomize skips it
Exposure, Brightness, Contrast, Gamma, Saturation, Hue, Temperature, Shadows, Midtones, Highlights, Black point, White point, Blur, Sharpen, Noise, Invert.

### 5.5 Pre-dither effects: 14, stackable, reorderable, duplicable
Each effect's parameters are in brackets.

| Effect | Parameters |
|---|---|
| Temporal Variation | pattern, amount, speed, scale. Patterns (9): static, roll, scan, flicker, wobble, interlace, blocks, ripple, boil |
| Noise | amount, color, animate |
| Blur | radius |
| Sharpen | amount, radius |
| Wave | amp, freq, speed |
| Row Shift | amount, prob, height, seed, animate |
| Pixel Sort | low, high, dir, reverse |
| RGB Shift | amount, vert |
| Slice Glitch | amount, maxh, seed, animate |
| Mirror | mode |
| Posterize | levels |
| Vignette (dithered) | amount, size |
| Edge Boost | amount |
| Gradient Overlay | angle, amount |

### 5.6 Post-dither effects: 13, stackable, reorderable, duplicable
| Effect | Parameters |
|---|---|
| Glow | threshold, radius, intensity, tint |
| Chromatic Aberration | amount, radial, angle |
| JPEG Glitch (real DCT block corruption) | quality, glitch, block, seed, animate |
| Blur | radius |
| Sharpen | amount |
| Scanlines | period, dark, thick, speed |
| CRT Screen | curve, mask, scan, vig |
| Vignette | amount, size, soft |
| Film Grain | amount, size, color, animate |
| Tint | color, mode, amount |
| RGB Split | x, y |
| Glitch Bands | count, shift, height, seed, animate |
| Invert | amount |

### 5.7 Presets: 34 built-in, each with a live thumbnail rendered from the current image
Classic Mac 1-bit, Newsprint, CMYK Pop, Handheld Green, Riso Duo, Neon Glow, Matrix Terminal, VHS Tape, Glitch Sorter, JPEG Rot, Arcade CRT, LED Billboard, Banknote Engraving, Stipple Ink, Thermal Vision, Blueprint, Amber Monitor, Vaporwave Dream, Pixel Art Poster, Woodcut Print, Topographic, Pulse Lines, Cyber Spiral, Cross Stitch, Datamosh, Broken Signal, Bit Crush, Photocopy, Red Alert, Psychedelic Cycles, Boiling Ink, Dot Matrix Receipt, Glitch Cathedral, Lo-fi Cyan.

**Working with presets**
- Filter them by name.
- Save the current look as your own preset.
- Import or export presets as JSON.
- A preset is a *partial* settings object (`{name, tags, s:{…}}`) that gets merged over the defaults. If the preset doesn't define an animation, the current one is kept.

### 5.8 Animation and timeline
- **Sources:** a still image (animated through effect parameters), an animated GIF, a video file (MP4/WebM/MOV, whatever Chromium can decode), or an image sequence.
- **Layers:** any numeric parameter can be animated, including:
  - adjustments (`adjust.*`)
  - dither controls (`dither.*`)
  - luma cycles (`color.cycles`)
  - algorithm parameters (`algo.*`)
  - parameters of individual pre- and post-effects (`pre.<uid>.<k>`, `post.<uid>.<k>`)
- **Layer settings:** from → to values, start and end time, an ease (Linear, Ease in, Ease out, Ease in-out, Sine, Hold/step), and a mode (once, ping-pong or repeat).
- **Effect animation:** effects with an `animate` or `speed` setting also change over time on their own.
- **Playback:**
  - Uses requestAnimationFrame, or requestVideoFrameCallback for video.
  - Has play/pause, loop, go to start and a scrub bar.
  - Duration and fps are adjustable (defaults are 4 s and 24 fps).

### 5.9 Export
**Tabs:** Image, Vector, Animation/Video, Batch.

**Resolution presets**
| Group | Sizes |
|---|---|
| Relative | Original size; native dither grid (1 px = 1 dither pixel); 0.5×, 2×, 3×, 4×, 8× |
| Screen | HD 1280×720, Full HD 1920×1080, QHD 2560×1440, 4K 3840×2160, 5K 5120×2880, 8K 7680×4320 |
| Social | Square 1080×1080 and 2048×2048, Portrait 4:5 1080×1350, Story/Reel 1080×1920, Banner 1500×500 |
| Print | A5, A4, A3, US Letter and Poster 18×24 in, each at a chosen DPI (default 300; orientation follows the image) |
| Custom | Width and height up to 16384 px, with an aspect-ratio lock |

**Other options**
- **Fit:** contain, cover or stretch.
- **Background:** paper colour, ink colour, transparent or a custom colour.
- **Detail mode** (this is how quality is kept when going bigger):
  - *Crisp* upscales the dither grid with nearest-neighbour scaling, so every dither pixel becomes a perfectly sharp block.
  - *Re-dither* runs the whole pipeline again at the output resolution, giving finer detail with no interpolation at all.

**Formats**
- **Raster:** PNG (with DPI), JPEG (with quality and DPI), WebP, TIFF (with alpha and DPI), BMP, GIF.
- **Vector:**
  - SVG, PDF and EPS.
  - The vectorizer merges each colour's runs of dither pixels into rectangles, so the file is exact and scales infinitely.
  - Options: background on or off, an "ink only" single-colour mode, and units in px or mm.
- **Animation/Video:**
  - MP4 (H.264 via WebCodecs). It tries several H.264 profiles, from High 5.2 down to Baseline 3.1, until the browser's encoder accepts one, with a bitrate setting.
  - Animated GIF (local palettes, median cut when there are more than 256 colours, transparency, loop).
  - APNG.
  - A PNG sequence as a `.zip`.
  - Settings: fps and duration.
- **Batch:** drop many images, apply the current look to all of them, and download a `.zip`.

**Also**
- A progress bar with cancel.
- Export settings are remembered.
- Quick PNG export with Ctrl+Shift+E.
- Copy the result to the clipboard.

### 5.10 Projects and files
- **Open:** images, GIFs, videos, image sequences, palette files and project files. You can use the file picker, drag and drop, or paste.
- **Projects:** saved as `.bitskull.json`, containing the full settings plus the source image embedded as a data URL.
- **Undo/redo:** works through JSON snapshots of the settings.

### 5.11 UI
- **Layout:**
  - Menubar with File, Edit, View, Animation and Help menus.
  - Left panel with algorithm, dither, colour and palette sections.
  - Centre stage with the viewport.
  - Bottom bar with update mode, preview quality, adaptive mode, compare, zoom, fit and 1:1, plus the grid size and render time in ms.
  - Timeline.
  - Right panel with presets, adjustments, pre-effects and post-effects.
- **Algorithm picker:** category chips, search, and ‹ › arrows to step through.
- **View:** zoom with the wheel or +/−, pan by dragging, fit, and 1:1.
- **Compare:** hold H to see the original, or use split compare with a draggable divider.
- **Randomize:** respects the section locks for algorithm, dither and palette, and the per-control locks on adjustments.
- **Update mode:** live, or manual (press Enter to render).
- **Themes (6):** void (default), synth, matrix, amber, ice, light.
- **URL flags** for testing and automation: `?demo` loads the demo image. With it you can add `&preset=<name>`, `&algo=<id>`, `&compare`, `&anim`, `&export=<tab>` and `&play`.

### 5.12 Keyboard shortcuts (BitSkull's own design; Dither Boy publishes no shortcut list)
| Group | Keys |
|---|---|
| Files | Ctrl+O open · Ctrl+V paste image · Ctrl+S save project · Ctrl+Shift+O open project · Ctrl+E export · Ctrl+Shift+E quick PNG · Ctrl+C copy result · Ctrl+B batch |
| Editing | Ctrl+Z undo · Ctrl+Y / Ctrl+Shift+Z redo · R randomize · Shift+R shuffle palette · Ctrl+Shift+S save preset · Enter render (manual mode) |
| Algorithm & colour | ←/→ algorithm · Shift+←/→ category · [ / ] pixel size · , / . palette · M colour mode · I invert palette |
| View | F or 0 fit · 1 1:1 · +/− or wheel zoom · drag pan · H (hold) original · \ split compare · Tab hide panels · Shift+F fullscreen · T theme |
| Animation | A animation on/off · Space play/pause · Home go to start · L add layer |
| Help | ? or F1 shortcut list · Esc close menus and dialogs |

---

## 6. Settings schema (defaults)

```json
{
  "v": 1,
  "algo": "floyd",
  "algoParams": {},
  "dither": { "pixelSize": 2, "strength": 1, "bias": 0, "jitter": 0, "serpentine": true, "seed": 1 },
  "color": { "mode": "mono", "order": "luma", "invert": false, "cycles": 1, "mirrorCycles": false,
             "metric": "weighted", "rgbLevels": 2, "keepAlpha": true },
  "palette": { "name": "Black & White", "colors": ["#000000", "#ffffff"], "locks": [false, false] },
  "adjust": { "exposure": 0, "brightness": 0, "contrast": 0, "gamma": 1, "saturation": 0, "hue": 0,
              "temperature": 0, "shadows": 0, "midtones": 0, "highlights": 0, "blackPoint": 0,
              "whitePoint": 1, "blur": 0, "sharpen": 0, "noise": 0, "invert": false },
  "adjustLocks": {},
  "pre": [],
  "post": [],
  "anim": { "on": false, "duration": 4, "fps": 24, "loop": true, "layers": [] }
}
```

- `pre` and `post` hold arrays of `{uid, type, on, ...params}`.
- An animation layer has the form `{id, target, from, to, start, end, ease, mode, on}`.
- A preset has the form `{name, tags, s: <partial settings>}`.

---

## 7. Desktop packaging (`BitSkull.exe`)

- It is a .NET Framework 4 WinExe built with `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`, which is on every Windows 10/11 PC. No SDK, NuGet or downloads are needed.
- `index.html`, `css/`, `js/` and `assets/` are embedded as manifest resources named `app/<path>`.
- **On launch:**
  1. It takes a SHA-1 of all the embedded resources.
  2. If the hash differs from `%LOCALAPPDATA%\BitSkull\app\.version`, it unpacks the files there.
  3. It finds Edge, then Chrome, using App Paths in the registry and then the default install folders.
  4. It runs the browser with `--app=file:///…/index.html --user-data-dir=%LOCALAPPDATA%\BitSkull\profile --window-size=1500,950 --no-first-run --disable-sync`, which gives a chromeless window with a **private, isolated profile**.
  5. If no Chromium browser is found, it opens `index.html` in the default browser.
- Errors are shown in a MessageBox.
- The icon is `build/bitskull.ico` (PNG-in-ICO at 256, 64, 48, 32, 24 and 16 px), rendered from `logo.svg`.
- The exe is **not code-signed**. On a fresh download, SmartScreen asks the user to click "More info", then "Run anyway".
- To rebuild: `powershell -ExecutionPolicy Bypass -File build\build.ps1`.

---

## 8. Logo

`assets/logo.svg` is an original vector **glitch skull with a dropped, open jaw**.
- Built as a single even-odd path, with holes for the eyes, nose, teeth gaps and a crack.
- The right half is shaded with a dither pattern.
- It has one glowing acid-lime pixel eye (`#c6ff3d`).
- It has cyan and magenta RGB-split ghost copies, and two horizontally shifted glitch bands.
- It sits on a dark rounded square (`#0b0b10`).

The style is inspired by hacker-collective skull iconography, but it is deliberately not a copy of the Watch Dogs/DedSec mark, which is a Ubisoft trademark.

---

## 9. Verification status

**Tested and passing** (automated in headless Edge, plus visual checks):
- All 84 algorithms in all 3 colour modes.
- All pre-effects, post-effects and presets render without errors.
- Every encoder produces valid files. The MP4 plays with the correct size and duration. GIF and APNG play.
- Importing and playing back GIFs and video; frame-accurate video export.
- All export paths in the dialog.
- Shortcuts and undo/redo.
- Running directly from `file://`.
- `BitSkull.exe` unpacks the app, opens the app window and renders correctly.
- The public GitHub release download works without logging in.

**Not yet tested:**
- Real photos from the user (only the built-in procedural demo image was used).
- Long or large videos.
- Batch export with many real files.
- Very large re-dither exports (8K) for memory use.
- `Start BitSkull.bat`.
- Running on a locked-down school PC, which may block unsigned executables. The fallback is to open `index.html` in the browser.

## 10. Known limitations
- Everything runs on the main thread, because Workers are not available from `file://`. Large re-dither exports and long MP4 exports block the UI, although a progress bar and cancel are provided.
- There is no GPU acceleration, so very large previews rely on the quality cap and adaptive mode.
- MP4 export needs WebCodecs, which means Chromium. There is no audio track in exported video.
- The exe depends on Edge or Chrome being installed (they are by default on Windows 11). It is a launcher, not an embedded WebView.
- Custom presets and palettes live in the browser profile's localStorage. Deleting `%LOCALAPPDATA%\BitSkull\profile` wipes them, so export presets to JSON to back them up.
- Vector export of very fine dithers can produce large files, because each run of pixels becomes one rectangle.

## 11. Natural next steps / extension ideas
- A Web Worker or OffscreenCanvas render path when served over http(s), to keep the UI responsive.
- A WebGL/WebGPU fast path for ordered and halftone algorithms, giving real-time 4K preview.
- Audio passthrough in MP4 export.
- A true native shell (WebView2 or Tauri) with its own window icon and file associations.
- Layer masks and brushes, to apply different dithers to different regions.
- Webcam or live input.
- Palette and preset sharing via files.
- A code-signed build to avoid the SmartScreen prompt.

---

## 12. Notes for the merging agent
- **Keep these values whatever the merged idea is:** offline and local-only, no network, an isolated profile, zero dependencies, and nothing to install.
- **Most reusable modules:**
  - `dither.js` (algorithms and quantizer)
  - `effects.js`
  - `encoders.js` (every format plus the vectorizer and MP4 muxer)
  - `pipeline.js` (settings, animation and the renderer)
  - These are UI-independent and talk only through `window.BS`.
- **UI-specific code** lives in `app.js`, `export.js`, `ui.js`, `index.html` and `app.css`.
- **To add an algorithm:** call `add({...})` in `dither.js`. Use `kind` = `diffusion` (with a kernel) or `threshold` (with a matrix or function); anything else defaults to `custom` and supplies `run(ctx, p)`. Give it `params` definitions in the form `{k, l, min, max, step, d}`. The UI, randomizer, presets and animation targets pick it up automatically.
- **To add an effect:** add an entry to `BS.PRE` with `{name, params, run(ctx, p)}`, where ctx holds float channels r, g, b and w, h. For `BS.POST`, the entry is `{name, params, run(data, W, H, p)}` and works on RGBA bytes. A param flagged `size: true` is scaled by the grid factor.
- **To add a preset:** append `{name, tags, s}` to `BS.PRESETS`.
