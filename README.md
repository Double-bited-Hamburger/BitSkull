# BitSkull

A personal dithering studio for images, GIFs and video. Everything runs locally in the browser: no install, no uploads, no account.

## Run it
- Double-click **`BitSkull.exe`**. It's a single file with the whole app inside, so you can move it anywhere (Desktop, USB stick) on its own. The first time you run it, it unpacks to `%LOCALAPPDATA%\BitSkull\app`. It then opens in a frameless Edge (or Chrome) app window with its own private profile in `%LOCALAPPDATA%\BitSkull\profile`, which never shares cookies or logins with your normal browser. To rebuild it after changing the code, run `powershell -ExecutionPolicy Bypass -File build\build.ps1`. This uses the C# compiler that ships with Windows, so you don't need to install anything.
- Or double-click **`Start BitSkull.bat`**, or
- open `index.html` in Edge or Chrome, or
- run `node tools/serve.js` and visit http://localhost:5178

Optional URL flags: `?demo` loads the demo image, and `?demo&preset=Neon%20Glow` also applies a preset.

## What's inside
- **84 algorithms** in six families:
  - Error Diffusion (18), including Floyd–Steinberg, Atkinson, Jarvis–Judice–Ninke, Stucki, Sierra ×3, Stevenson–Arce and Riemersma/Hilbert
  - Ordered (11): Bayer, clustered dot, blue noise and more
  - Pattern (12)
  - Halftone (9), including CMYK and an RGB screen
  - Glitch (17): pixel sort, datamosh, VHS, error overflow and more
  - Special (17): ASCII, stipple, engraving, contours, LED, CRT, cross-stitch and more
- **Colour modes:**
  - Mono: maps luminance onto the palette, with luma cycles
  - Palette: nearest colour, using weighted RGB or OKLab
  - RGB: per-channel levels
- **Palettes:** 46 built-in, editable swatches with locks, shuffle, extract-from-image, and import/export (.gpl, .hex, .json).
- **Adjustments:** 16 controls, each with a lock so Randomize skips it.
- **Effect stacks:** 14 distortions before dithering, including Temporal Variation with 9 animated patterns, and 13 effects after dithering, including glow, chromatic aberration, JPEG glitch and CRT.
- **Animation timeline:** keyframe layers (from → to, ease, ping-pong or repeat) on any slider. Plays still images, GIFs, image sequences and video.
- **Presets:** 34 built-in looks with live thumbnails, plus your own presets (save, import, export).
- **Export:**
  - Raster: PNG, JPEG, WebP, TIFF, BMP and GIF, with DPI metadata
  - Vector: SVG, PDF and EPS
  - Animation: MP4 (H.264), GIF, animated PNG, and PNG sequence as a .zip
  - Batch: process many images at once
  - Resolution presets range from HD to 8K, social formats and A5–A3/Letter/Poster at any DPI, or set a custom size. *Crisp* upscales the dither grid with sharp pixels. *Re-dither* renders again at the output size, so the image stays sharp with nothing upscaled. Vector files are made of the dither pixels themselves, so they scale to any size with no loss.
- **Extras:** undo/redo, project files (settings plus the embedded image), copy/paste through the clipboard, split compare, and 6 themes.

Press **?** in the app for the full list of keyboard shortcuts.
