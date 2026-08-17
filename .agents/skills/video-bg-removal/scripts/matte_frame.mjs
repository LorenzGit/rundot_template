/**
 * Pure Node frame matte helpers (no native deps).
 * Input/output: raw RGBA Uint8ClampedArray + width/height.
 *
 * Engines:
 *  - chromaDecontamMatte — preferred for green/magenta screens (edge reconstruct)
 *  - chromaMatte — legacy distance key + light spill
 *  - studioWhiteMatte — light studio plates
 */

export {
  chromaDecontam,
  chromaDecontamCutout,
  estimateScreenColor,
  parseHexKey,
  DEFAULT_CHROMA_DECONTAM,
} from './chroma_decontam.mjs';

import {
  chromaDecontam,
  parseHexKey,
  DEFAULT_CHROMA_DECONTAM,
} from './chroma_decontam.mjs';

/** @param {string} hex rrggbb or #rrggbb */
export function parseHex(hex) {
  const h = hex.replace(/^#/, '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`bad hex key: ${hex}`);
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/**
 * Preferred green/magenta key: matte + F=(C-(1-α)G)/α edge decontam + despill.
 * @param {Uint8ClampedArray} rgba
 * @param {number} w
 * @param {number} h
 * @param {object} [opts] see DEFAULT_CHROMA_DECONTAM; also key hex string via opts.key
 */
export function chromaDecontamMatte(rgba, w, h, opts = {}) {
  const key = opts.key
    ? parseHexKey(opts.key)
    : opts.keyRgb || { r: opts.keyR ?? 0, g: opts.keyG ?? 255, b: opts.keyB ?? 0 };
  const { data } = chromaDecontam(rgba, w, h, {
    ...DEFAULT_CHROMA_DECONTAM,
    ...opts,
    keyR: key.r,
    keyG: key.g,
    keyB: key.b,
  });
  return data;
}

/**
 * Chroma key with soft edge + green/magenta spill suppression (legacy).
 * Prefer chromaDecontamMatte for anti-aliased edges / green halo.
 * @param {Uint8ClampedArray} rgba
 * @param {number} w
 * @param {number} h
 * @param {{ r: number, g: number, b: number }} key
 * @param {number} tolerance  ~ color distance for full transparent
 * @param {number} softness   extra distance band for partial alpha
 */
export function chromaMatte(rgba, w, h, key, tolerance = 48, softness = 24) {
  const out = new Uint8ClampedArray(rgba.length);
  const t0 = Math.max(1, tolerance);
  const t1 = t0 + Math.max(0, softness);
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];
    const a = rgba[i + 3];
    const dr = r - key.r;
    const dg = g - key.g;
    const db = b - key.b;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    let alpha;
    if (dist <= t0) alpha = 0;
    else if (dist >= t1) alpha = a;
    else alpha = Math.round(a * ((dist - t0) / (t1 - t0)));

    let nr = r;
    let ng = g;
    let nb = b;
    // Spill: pull dominant key channel toward neutral when near key
    if (alpha > 0 && alpha < 250 && dist < t1 * 1.4) {
      const spill = 1 - Math.min(1, dist / (t1 * 1.4));
      if (key.g >= key.r && key.g >= key.b) {
        // green screen
        const lim = Math.max(nr, nb);
        ng = Math.round(ng * (1 - spill) + lim * spill);
      } else if (key.r >= key.g && key.r >= key.b && key.b >= key.g) {
        // magenta-ish
        const lim = Math.max(ng, Math.min(nr, nb));
        nr = Math.round(nr * (1 - spill * 0.5) + lim * spill * 0.5);
        nb = Math.round(nb * (1 - spill * 0.5) + lim * spill * 0.5);
      }
    }
    out[i] = nr;
    out[i + 1] = ng;
    out[i + 2] = nb;
    out[i + 3] = alpha;
  }
  return out;
}

/**
 * Near-white / light-gray studio key.
 * High-luma low-saturation pixels become transparent.
 */
export function studioWhiteMatte(rgba, w, h, whiteThreshold = 230, satMax = 28, softness = 20) {
  const out = new Uint8ClampedArray(rgba.length);
  const hard = whiteThreshold;
  const soft = Math.max(0, whiteThreshold - softness);
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];
    const a = rgba[i + 3];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max - min;
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    let alpha = a;
    if (sat <= satMax && luma >= hard) alpha = 0;
    else if (sat <= satMax + 10 && luma >= soft) {
      const t = (luma - soft) / Math.max(1, hard - soft);
      const s = 1 - Math.min(1, sat / (satMax + 10));
      alpha = Math.round(a * (1 - t * s));
    }
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
    out[i + 3] = alpha;
  }
  return out;
}

/**
 * Temporal median on alpha channel across odd window of frames.
 * @param {Uint8ClampedArray[]} frames same size RGBA
 * @param {number} radius 1 => window 3
 */
export function temporalMedianAlpha(frames, radius = 1) {
  if (frames.length === 0) return frames;
  const n = frames[0].length;
  const out = frames.map((f) => new Uint8ClampedArray(f));
  const w = radius * 2 + 1;
  for (let fi = 0; fi < frames.length; fi++) {
    for (let i = 3; i < n; i += 4) {
      const vals = [];
      for (let d = -radius; d <= radius; d++) {
        const j = Math.min(frames.length - 1, Math.max(0, fi + d));
        vals.push(frames[j][i]);
      }
      vals.sort((a, b) => a - b);
      out[fi][i] = vals[Math.floor(w / 2)];
    }
  }
  return out;
}
