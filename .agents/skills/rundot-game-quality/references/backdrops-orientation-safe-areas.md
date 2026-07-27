# Backdrops, orientation, and safe areas

## Image aspect-ratio contract

Record each important image's intrinsic ratio, intended container ratio, fit
mode, crop-safe area, and any orientation-specific variants before integrating
it. Aspect ratio is part of the art, not a flexible implementation detail.

- Use `cover` only for decorative imagery that may crop. Keep the focal subject,
  branding, horizon, and other composition-critical details inside a safe crop
  shared by the tested containers.
- Use `contain` for characters, products, cards, instructional art, logos, and
  other must-see content. Design the surrounding surface to absorb letterboxing
  rather than stretching the image.
- Scale Pixi/canvas sprites uniformly. Do not set both display width and height
  to unrelated target values. Intentional nine-slice panels, tiles, gradients,
  and programmatic geometry are exceptions because they are designed to resize.
- Generate or compose separate square, portrait, and wide assets when cropping
  or letterboxing would damage the composition. Higher resolution does not fix
  the wrong aspect ratio.
- Treat any accidental stretch, squash, warped circle, distorted character,
  clipped focal subject, or unstable crop as a blocking defect.

Treat these as three separate layout layers:

1. **Full-viewport backdrop:** decorative scene/key art behind the game on
   desktop, tablets, embeds, and orientation changes. Fill it with CSS
   `background-size: cover` or image `object-fit: cover`; preserve aspect ratio
   and allow only intentional decorative cropping. Never geometrically stretch
   art to fill a mismatched aspect ratio.
2. **Playable frame:** the portrait, landscape, or both-orientation game canvas
   and UI. Keep its declared design aspect ratio/scale behavior. Do not expand a
   portrait HUD/playfield into desktop sidebars simply to occupy empty space.
3. **Safe interactive area:** controls, HUD, dialogs, close actions, and paid
   surfaces positioned inside RUN/device safe-area insets within the playable
   frame. Decorative backdrop art must never carry required UI.

## Required desktop behavior

- A portrait game on desktop/landscape shows a deliberate full-bleed backdrop
  behind the centered playable frame—never plain bars, a narrow/cropped copy of
  the game, or empty side areas.
- Keep crop-critical subjects and readable branding in the safe center of each
  backdrop composition. Use distinct portrait and landscape/wide compositions
  when one source image cannot survive both crops.
- For `orientation: Both`, define layouts, input, safe areas, and backdrop crops
  for each orientation. Test resize/orientation transitions rather than merely
  rotating a screenshot.

## Verification

Capture phone portrait, short/tall phone, tablet portrait/landscape, and desktop
wide screenshots after final art changes. Check focal subject, no distorted art,
no visible empty/skinny frame, safe controls, dialogs, keyboard/focus behavior,
and no crop-dependent instructions or text. Compare recognizable circles,
faces, logos, and repeated objects against the source asset; these reveal subtle
non-uniform scaling quickly.
