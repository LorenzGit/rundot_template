/**
 * Chroma-key matte + edge color decontamination.
 *
 * Does NOT merely clear green pixels. For anti-aliased edges:
 *   C ≈ α F + (1−α) G
 * recover F = (C − (1−α) G) / α, then mild despill.
 *
 * Pipeline:
 *  1. Estimate screen color G (border sample or fixed hex)
 *  2. Alpha from green-dominance / chroma distance (smoothstep)
 *  3. Small matte blur feather on alpha only
 *  4. Foreground reconstruction on partial-alpha pixels
 *  5. Green despill on remaining bias
 *  6. Optional premultiplied output
 *
 * Pure module — no Node I/O. Used by cutout.mjs and video-bg-removal.
 */

export const DEFAULT_CHROMA_DECONTAM = {
    screenMode: "auto-border", // auto-border | fixed
    keyR: 0,
    keyG: 255,
    keyB: 0,
    metric: "green-excess", // green-excess | ycbcr | rgb
    low: 0.1,
    high: 0.48,
    feather: 1.5,
    reconstruct: true,
    spillAmount: 0.15,
    premultiply: false,
    pureKeyPull: 0.35,
};

function smoothstep(edge0, edge1, x) {
    if (edge0 === edge1) return x < edge0 ? 0 : 1;
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}

function clamp01(x) {
    return x < 0 ? 0 : x > 1 ? 1 : x;
}

function clamp255(x) {
    return x < 0 ? 0 : x > 255 ? 255 : x | 0;
}

/** @param {string} hex rrggbb or #rrggbb */
export function parseHexKey(hex) {
    const h = String(hex || "00ff00")
        .replace(/^#/, "")
        .trim();
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return { r: 0, g: 255, b: 0 };
    return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
    };
}

/** Estimate screen color from border ring (median of samples). */
export function estimateScreenColor(rgba, w, h, fixed, pureKeyPull = 0) {
    if (fixed && pureKeyPull >= 1) return { r: fixed.r, g: fixed.g, b: fixed.b };

    const rs = [];
    const gs = [];
    const bs = [];
    const push = (x, y) => {
        const i = (y * w + x) * 4;
        rs.push(rgba[i]);
        gs.push(rgba[i + 1]);
        bs.push(rgba[i + 2]);
    };
    const step = Math.max(1, Math.floor(Math.min(w, h) / 64));
    for (let x = 0; x < w; x += step) {
        push(x, 0);
        push(x, h - 1);
    }
    for (let y = 0; y < h; y += step) {
        push(0, y);
        push(w - 1, y);
    }
    if (w > 8 && h > 8) {
        for (let x = 2; x < w - 2; x += step * 2) {
            push(x, 2);
            push(x, h - 3);
        }
    }
    const med = (a) => {
        a.sort((x, y) => x - y);
        return a[(a.length / 2) | 0];
    };
    let r = med(rs);
    let g = med(gs);
    let b = med(bs);

    if (fixed && pureKeyPull > 0) {
        const t = clamp01(pureKeyPull);
        r = Math.round(r * (1 - t) + fixed.r * t);
        g = Math.round(g * (1 - t) + fixed.g * t);
        b = Math.round(b * (1 - t) + fixed.b * t);
    }
    return { r, g, b };
}

function screenScore(r, g, b, G, metric) {
    if (metric === "green-excess") {
        const excess = g - Math.max(r, b);
        return clamp01(excess / 255);
    }
    if (metric === "ycbcr") {
        const toCbCr = (R, Gr, B) => {
            const Y = 0.299 * R + 0.587 * Gr + 0.114 * B;
            const Cb = 128 - 0.168736 * R - 0.331264 * Gr + 0.5 * B;
            const Cr = 128 + 0.5 * R - 0.418688 * Gr - 0.081312 * B;
            return { Y, Cb, Cr };
        };
        const p = toCbCr(r, g, b);
        const s = toCbCr(G.r, G.g, G.b);
        const d = Math.hypot(p.Cb - s.Cb, p.Cr - s.Cr);
        return clamp01(1 - d / 90);
    }
    const d = Math.max(Math.abs(r - G.r), Math.abs(g - G.g), Math.abs(b - G.b));
    return clamp01(1 - d / 180);
}

function blurAlpha(alpha, w, h, radius) {
    if (radius <= 0) return alpha;
    // Support fractional feather: round up to at least 1 when > 0
    const r = Math.max(1, Math.round(radius));
    const tmp = new Float32Array(w * h);
    const out = new Float32Array(w * h);
    const win = 2 * r + 1;
    for (let y = 0; y < h; y++) {
        let sum = 0;
        for (let x = -r; x <= r; x++) {
            const xx = Math.min(w - 1, Math.max(0, x));
            sum += alpha[y * w + xx];
        }
        for (let x = 0; x < w; x++) {
            tmp[y * w + x] = sum / win;
            const add = Math.min(w - 1, x + r + 1);
            const rem = Math.max(0, x - r);
            sum += alpha[y * w + add] - alpha[y * w + rem];
        }
    }
    for (let x = 0; x < w; x++) {
        let sum = 0;
        for (let y = -r; y <= r; y++) {
            const yy = Math.min(h - 1, Math.max(0, y));
            sum += tmp[yy * w + x];
        }
        for (let y = 0; y < h; y++) {
            out[y * w + x] = sum / win;
            const add = Math.min(h - 1, y + r + 1);
            const rem = Math.max(0, y - r);
            sum += tmp[add * w + x] - tmp[rem * w + x];
        }
    }
    return out;
}

/**
 * @param {Uint8ClampedArray} rgba source RGBA
 * @param {number} w
 * @param {number} h
 * @param {Partial<typeof DEFAULT_CHROMA_DECONTAM>} [opts]
 * @returns {{ data: Uint8ClampedArray, screen: {r:number,g:number,b:number} }}
 */
export function chromaDecontam(rgba, w, h, opts = {}) {
    const o = { ...DEFAULT_CHROMA_DECONTAM, ...opts };
    const fixed = { r: o.keyR, g: o.keyG, b: o.keyB };
    const G = o.screenMode === "fixed" ? fixed : estimateScreenColor(rgba, w, h, fixed, o.pureKeyPull);

    const n = w * h;
    const score = new Float32Array(n);
    for (let p = 0, i = 0; p < n; p++, i += 4) {
        score[p] = screenScore(rgba[i], rgba[i + 1], rgba[i + 2], G, o.metric);
    }

    const alphaRaw = new Float32Array(n);
    for (let p = 0; p < n; p++) {
        alphaRaw[p] = 1 - smoothstep(o.low, o.high, score[p]);
    }
    const alpha = o.feather > 0 ? blurAlpha(alphaRaw, w, h, o.feather) : alphaRaw;

    const out = new Uint8ClampedArray(rgba.length);
    const Gr = G.r / 255;
    const Gg = G.g / 255;
    const Gb = G.b / 255;
    const spill = clamp01(o.spillAmount);

    for (let p = 0, i = 0; p < n; p++, i += 4) {
        let a = alpha[p];
        const srcA = rgba[i + 3] / 255;
        a *= srcA;

        if (a < 0.001) {
            out[i] = 0;
            out[i + 1] = 0;
            out[i + 2] = 0;
            out[i + 3] = 0;
            continue;
        }

        // Source color in 0..1
        const cr = rgba[i] / 255;
        const cg = rgba[i + 1] / 255;
        const cb = rgba[i + 2] / 255;

        const despillRgb = (rr, gg, bb, spillAmt) => {
            let r0 = rr;
            let g0 = gg;
            let b0 = bb;
            if (spillAmt >= 1) return [r0, g0, b0];
            if (G.g >= G.r && G.g >= G.b) {
                const maxRB = Math.max(r0, b0);
                if (g0 > maxRB) g0 = maxRB + (g0 - maxRB) * spillAmt;
            } else if (G.r >= G.g && G.b >= G.g) {
                if (r0 > g0) r0 = g0 + (r0 - g0) * spillAmt;
                if (b0 > g0) b0 = g0 + (b0 - g0) * spillAmt;
            } else if (G.b >= G.r && G.b >= G.g) {
                const maxRG = Math.max(r0, g0);
                if (b0 > maxRG) b0 = maxRG + (b0 - maxRG) * spillAmt;
            }
            return [r0, g0, b0];
        };

        // Soft edges (mid-α): NEVER full un-key divide — that crushes AA into black
        // fringes when α is slightly low. Keep color = despilked source; α does the blend.
        // Near-opaque: full F = (C − (1−α)G) / α to kill residual screen cast.
        let r;
        let g;
        let b;
        const edgeZone = a < 0.92;

        if (!o.reconstruct || edgeZone) {
            // Stronger despill on edges (more green kill, no divide)
            const edgeSpill = edgeZone ? Math.min(spill, 0.12) : spill;
            [r, g, b] = despillRgb(cr, cg, cb, edgeSpill);
        } else {
            const inv = 1 - a;
            let pr = Math.max(0, cr - inv * Gr);
            let pg = Math.max(0, cg - inv * Gg);
            let pb = Math.max(0, cb - inv * Gb);
            r = clamp01(pr / a);
            g = clamp01(pg / a);
            b = clamp01(pb / a);
            [r, g, b] = despillRgb(r, g, b, spill);
        }

        // Kill black outlines: high-α + near-black RGB is almost always a failed edge
        // (over-keyed screen). Drop alpha further OR restore source non-green chroma.
        const mx = Math.max(r, g, b);
        if (a > 0.15 && mx < 0.1) {
            const ge = cg - Math.max(cr, cb);
            if (ge > 0.08) {
                // Still screen-like → more transparent, soft AA instead of black rim
                a *= 0.25;
            } else {
                r = clamp01(Math.max(r, cr));
                b = clamp01(Math.max(b, cb));
                g = clamp01(Math.min(Math.max(r, b), Math.max(g, cg * 0.5)));
            }
        }
        if (a > 0.05 && a < 0.95 && Math.max(r, g, b) < 0.08) {
            a = Math.min(a, 0.15);
        }

        if (o.premultiply) {
            out[i] = clamp255(r * a * 255);
            out[i + 1] = clamp255(g * a * 255);
            out[i + 2] = clamp255(b * a * 255);
            out[i + 3] = clamp255(a * 255);
        } else {
            out[i] = clamp255(r * 255);
            out[i + 1] = clamp255(g * 255);
            out[i + 2] = clamp255(b * 255);
            out[i + 3] = clamp255(a * 255);
        }
    }

    return { data: out, screen: G };
}

/**
 * cutout.mjs-compatible wrapper: mutates img.data in place like chromaCutout.
 * @param {{ w: number, h: number, data: Uint8ClampedArray }} img
 * @param {object} opts
 */
export function chromaDecontamCutout(img, opts = {}) {
    const key = opts.key ? parseHexKey(opts.key) : null;
    const { data, screen } = chromaDecontam(img.data, img.w, img.h, {
        screenMode: opts.screenMode || (key ? "fixed" : "auto-border"),
        keyR: key?.r ?? opts.keyR ?? 0,
        keyG: key?.g ?? opts.keyG ?? 255,
        keyB: key?.b ?? opts.keyB ?? 0,
        metric: opts.metric || "green-excess",
        low: opts.low ?? opts.decontamLow ?? 0.12,
        high: opts.high ?? opts.decontamHigh ?? 0.42,
        feather: opts.feather ?? opts.decontamFeather ?? 0.5,
        reconstruct: opts.reconstruct !== false,
        spillAmount: opts.spillAmount ?? 0.2,
        premultiply: !!opts.premultiply,
        pureKeyPull: opts.pureKeyPull ?? 0.35,
    });
    img.data.set(data);
    let opaque = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 8) opaque++;
    const transparentPct = Math.round((1 - opaque / (img.w * img.h)) * 100);
    return {
        w: img.w,
        h: img.h,
        data: img.data,
        transparentPct,
        screen,
    };
}
