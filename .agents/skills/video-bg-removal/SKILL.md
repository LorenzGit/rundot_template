---
name: video-bg-removal
description: "Remove backgrounds from short character/FX videos and encode dual transparent delivery (CSS-Tricks hybrid): VP9 alpha WebM for Chrome/Firefox + HEVC-with-alpha MOV for Safari. Engines: chroma-decontam (default), legacy chroma, BiRefNet, studio-white. Use for transparent looping character videos, showcase models, UI-overlaid hero clips."
---

# Video background removal → transparent WebM + Safari HEVC

Still images use `bg-removal-softshadows`. **Videos need a different pipeline:**
extract frames → matte each frame → encode **two** alpha formats (CSS-Tricks
hybrid — there is no single native alpha codec that works in every browser):

| File | Codec | Browsers |
| --- | --- | --- |
| `hero.webm` | VP9 `yuva420p` (`alpha_mode=1`) | Chrome / Firefox / Edge |
| `hero.mov` | HEVC-with-alpha (`hvc1`, VideoToolbox) | Safari 13+ / iOS 13+ |

Reference:
https://css-tricks.com/overlaying-video-with-transparency-while-wrangling-cross-browser-support/

**Serving rule (critical):** set **one** `video.src` in JS. Do **not** rely on
`<source>` order alone — Safari supports VP9 *without* alpha and will paint a
black plate if it picks the WebM.

```ts
function supportsHEVCAlpha(): boolean {
  const ua = navigator.userAgent.toLowerCase();
  const hasMediaCapabilities = !!(
    navigator.mediaCapabilities && navigator.mediaCapabilities.decodingInfo
  );
  const isSafari =
    ua.includes('safari') && !ua.includes('chrome') && ua.includes('version/');
  const isIOS = /ipad|iphone|ipod/.test(ua);
  return (isSafari || isIOS) && hasMediaCapabilities;
}

player.src = supportsHEVCAlpha() ? './assets/heroes/arcane.mov' : './assets/heroes/arcane.webm';
// also: muted, playsInline, loop, autoplay for GIF-like idle
```

## Engines

| Engine | Best for | Speed | Notes |
| --- | --- | --- | --- |
| **chroma-decontam** (default) | Green/magenta screens, rendered/Imagine clips | Fast | Estimates `G`, smoothstep alpha, **reconstructs edge RGB** `F=(C-(1-α)G)/α`, despill — kills green halo |
| **chroma** | Legacy distance key | Fast | Soft edge + light spill; may leave green fringe |
| **studio-white** | Near-uniform light gray/white plates | Fast | Fragile if subject has white cloth |
| **birefnet** | Complex/textured/photographic BG, no chroma plate | Slow (CPU, per frame) | Reuses `bg-removal-softshadows` venv + model |

Prefer generating Imagine clips on **flat #00FF00 green** and matting with
**chroma-decontam**. BiRefNet is frame-by-frame only when chroma is impossible.

## Pipeline (blocking steps)

1. **Stage the first frame** on a flat key color (`#00FF00` green recommended)
   with `grok-image-video` / Imagine. Subject fully opaque; no green on the
   costume if possible (or use magenta `#FF00FF`).
2. **`image_to_video`** with a locked camera, in-place idle/action. Prompt the
   background to stay solid green.
3. **Matte + encode:**

```bash
SKILL=rundot_template/.agents/skills/video-bg-removal
# From workspace root, or pass absolute paths.
node $SKILL/scripts/video_bg_remove.mjs \
  --in path/to/clip.mp4 \
  --out path/to/clip.webm \
  --also-hevc path/to/clip.mov \
  --engine chroma-decontam \
  --key 00ff00 \
  --screen-mode auto-border \
  --metric green-excess \
  --decontam-low 0.12 \
  --decontam-high 0.42 \
  --feather 0.5 \
  --spill-amount 0.2 \
  --fps 24 \
  --crf 32
```

4. **Verify:** `ffprobe` WebM shows `alpha_mode : 1`. Decode one frame of the
   MOV with alpha (corners transparent). Composite over a checker in Safari
   **and** Chrome. Edges must not carry a green halo; subject must not hole-punch.

## Engines detail

### chroma-decontam (default)

1. Estimate screen color `G` (border median, optional pull toward `--key`).
2. Alpha from green-excess / YCbCr / RGB score + smoothstep band.
3. Feather alpha only.
4. Reconstruct foreground on partial edges: `F = (C − (1−α)G) / α`.
5. Mild despill (`--spill-amount` 0=hard … 1=none).

```bash
node scripts/video_bg_remove.mjs -i hero.mp4 -o hero.webm --engine chroma-decontam --key 00ff00
```

### chroma (legacy)

RGB distance to `--key`. Pixels within `--tolerance` become transparent;
near-key fringe gets partial alpha + spill. Prefer **chroma-decontam**.

```bash
node scripts/video_bg_remove.mjs -i hero.mp4 -o hero.webm --engine chroma --key 00ff00
```

### studio-white

Keys near-white / light-gray studio plates (luma + low saturation).

```bash
node scripts/video_bg_remove.mjs -i hero.mp4 -o hero.webm --engine studio-white --white-threshold 230
```

### birefnet

Shells out per frame to `bg-removal-softshadows/birefnet_cutout.py` with
`--no-shadow` (shadows on video plates usually look wrong). Requires that
skill’s venv and model download.

```bash
node scripts/video_bg_remove.mjs -i hero.mp4 -o hero.webm --engine birefnet \
  --birefnet-py ../bg-removal-softshadows/birefnet_cutout.py \
  --birefnet-python ../bg-removal-softshadows/.venv/bin/python \
  --birefnet-model "General Use (Light)" --birefnet-res 1024
```

## Encode settings

### WebM (Chrome / Firefox / Edge)

```text
libvpx-vp9 -pix_fmt yuva420p -auto-alt-ref 0 -b:v 0 -crf 28..36
```

- **Must** set `-auto-alt-ref 0` for VP9 alpha.

### HEVC-with-alpha MOV (Safari) — `--also-hevc`

```text
hevc_videotoolbox -alpha_quality 0.75 -tag:v hvc1 -pix_fmt bgra -b:v 2500k
```

- macOS only (VideoToolbox). Encode from matted PNG sequence, not by
  re-wrapping WebM without `-c:v libvpx-vp9` on decode (alpha can be dropped).
- Standalone re-encode from an existing alpha WebM:

```bash
ffmpeg -y -c:v libvpx-vp9 -i hero.webm \
  -c:v hevc_videotoolbox -allow_sw 1 -alpha_quality 0.75 \
  -tag:v hvc1 -pix_fmt bgra -b:v 2500k -an hero.mov
```

- Prefer 480–720px tall heroes for roster UIs (file size).
- Looping idles: trim to a clean cycle with `ffmpeg -ss/-t` before matting if
  the Imagine clip has a bad tail.

## In-engine (DOM / React)

Silkward `HeroLoop` follows the CSS-Tricks pattern: still first, then one
`video.src` chosen by `supportsHEVCAlpha()`. For Pixi HTMLVideo textures use
the same picker — never hardcode only `.webm` on iOS.

```ts
const video = document.createElement('video');
video.src = supportsHEVCAlpha()
  ? './assets/heroes/arcane.mov'
  : './assets/heroes/arcane.webm';
video.loop = true;
video.muted = true;
video.playsInline = true;
await video.play();
```

## Grok Imagine recipe (game heroes)

1. `image_gen`: full-body three-quarter, low-poly stylized hero, **solid pure
   green `#00FF00` backdrop**, no ground plane shadow if you want a clean key
   (or keep a soft shadow and accept partial alpha under feet).
2. `image_to_video` 6s: “subtle idle breath and cloak sway, camera locked,
   solid green background unchanged”.
3. Run this skill with **`--engine chroma-decontam`** and **`--also-hevc`**:

```bash
node scripts/video_bg_remove.mjs \
  --in sources/heroes/arcane-green.mp4 \
  --out public/assets/heroes/arcane.webm \
  --also-hevc public/assets/heroes/arcane.mov \
  --engine chroma-decontam --key 00ff00
```

4. Card thumbnails: extract one matted PNG (`--also-png`) or still from the
   first frame.

## Verification checklist

1. `ffprobe out.webm` → `alpha_mode : 1` (or yuva in stream).
2. Decode one MOV frame → corners fully transparent, subject opaque.
3. Safari: loads `.mov`, no black plate. Chrome: loads `.webm`, alpha over UI.
4. No green fringe on silhouette; hair/fx retain soft edges if possible.
5. File size sane for mobile (WebM often ~1–2 MB; HEVC ~2–3 MB per 6s idle).

## Files

- `scripts/video_bg_remove.mjs` — CLI: extract → matte → WebM (+ optional HEVC).
- `scripts/matte_frame.mjs` — frame matte helpers (decontam / chroma / studio).
- `scripts/chroma_decontam.mjs` — pure edge-reconstruction matte (shared logic
  with `bg-removal-softshadows/chroma_decontam.mjs`).
- `scripts/test-alpha-webm.mjs` — synthetic red-circle → WebM, asserts alpha.

## Limits

- Chroma fails if the subject wears the key color or the video generator
  muddies the plate — re-gen on magenta or switch to birefnet.
- BiRefNet CPU is minutes per 6s@24fps clip; batch overnight for many heroes.
- Temporal flicker on AI mattes: optional `--temporal-median 3` smooths alpha
  across neighboring frames.
- HEVC encode requires macOS VideoToolbox; on Linux the WebM still ships.
- Do not use for live camera matting; this is an offline asset tool.
