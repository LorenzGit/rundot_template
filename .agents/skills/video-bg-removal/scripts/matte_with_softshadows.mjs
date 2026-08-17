#!/usr/bin/env node
/**
 * Matte a green-screen (or uniform-BG) video using bg-removal-softshadows
 * cutout.mjs (chroma + soft-shadow recovery + despill).
 *
 * This is the preferred offline path for Imagine clips: same math as the
 * softshadows skill, not the lightweight video-bg-removal chroma helper.
 *
 * Usage:
 *   node matte_with_softshadows.mjs --in clip.mp4 --out-dir ./frames \
 *     [--fps 12] [--max-height 480] [--key auto|rrggbb] [--frames N]
 *
 * Writes: out-dir/f00000.png … and prints JSON summary.
 */
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
  existsSync,
  copyFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CUTOUT = resolve(
  __dirname,
  "../../bg-removal-softshadows/cutout.mjs",
);

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  return process.argv[i + 1] ?? fallback;
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")}\n${r.stderr || r.stdout}`);
  }
  return r;
}

function sampleKey(pngPath) {
  // Use a tiny node snippet via cutout's first-pixel isn't enough — shell to python if available.
  const r = spawnSync(
    "python3",
    [
      "-c",
      `
from PIL import Image
im=Image.open(${JSON.stringify(pngPath)}).convert("RGB")
w,h=im.size
samples=[im.getpixel((x,y)) for x in range(0,w,max(1,w//20)) for y in range(0,max(4,h//15))]
rs=sorted(s[0] for s in samples); gs=sorted(s[1] for s in samples); bs=sorted(s[2] for s in samples)
mid=len(samples)//2
print(f"{rs[mid]:02x}{gs[mid]:02x}{bs[mid]:02x}")
`,
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0) return "00ff00";
  return (r.stdout || "00ff00").trim();
}

const input = arg("--in") || arg("-i");
const outDir = arg("--out-dir") || arg("-o");
if (!input || !outDir) {
  console.error(
    "Usage: node matte_with_softshadows.mjs --in clip.mp4 --out-dir ./frames [options]",
  );
  process.exit(1);
}
if (!existsSync(CUTOUT)) {
  console.error("cutout.mjs missing at", CUTOUT);
  process.exit(1);
}

const fps = Number(arg("--fps", "12"));
// OPTIONAL downscale AFTER matte only (0 = keep full source resolution for cutout).
// Never scale before softshadows cutout — that destroys edge quality.
const maxHAfter = Number(arg("--max-height-after", "0"));
const maxFrames = Number(arg("--frames", "0")); // 0 = all extracted
const keyArg = arg("--key", "auto");
const tolerance = arg("--tolerance", "52");
const work = resolve(outDir);
const raw = join(work, "raw");
const matted = join(work, "matted");
rmSync(work, { recursive: true, force: true });
mkdirSync(raw, { recursive: true });
mkdirSync(matted, { recursive: true });

// Full-resolution extract — only fps resampling, NO scale.
const vf = `fps=${fps}`;

console.error(
  JSON.stringify({
    step: "extract",
    fps,
    scaleBeforeMatte: false,
    maxHAfter,
    input: resolve(input),
  }),
);
run("ffmpeg", [
  "-y",
  "-i",
  resolve(input),
  "-vf",
  vf,
  "-start_number",
  "0",
  join(raw, "f%05d.png"),
]);

let names = readdirSync(raw)
  .filter((n) => n.endsWith(".png"))
  .sort();
if (maxFrames > 0 && names.length > maxFrames) {
  const picked = [];
  for (let i = 0; i < maxFrames; i++) {
    picked.push(names[Math.round((i * (names.length - 1)) / (maxFrames - 1))]);
  }
  names = [...new Set(picked)].sort();
}

const key =
  keyArg === "auto" ? sampleKey(join(raw, names[0])) : keyArg.replace(/^#/, "");
console.error(
  JSON.stringify({
    step: "matte",
    engine: "bg-removal-softshadows/cutout.mjs",
    key,
    frames: names.length,
    fullRes: true,
  }),
);

let i = 0;
for (const name of names) {
  i++;
  const src = join(raw, name);
  const dstFull = join(matted, `f${String(i - 1).padStart(5, "0")}.png`);
  const r = spawnSync(
    "node",
    [
      CUTOUT,
      src,
      "-o",
      dstFull,
      "--mode",
      "chroma",
      "--key",
      key,
      "--tolerance",
      String(tolerance),
      "--despill",
      "100",
      "--shadow",
      "on",
      "--shadow-strength",
      "100",
      "--smooth",
      "2",
      "--feather",
      "1",
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0) {
    throw new Error(`cutout failed on ${name}: ${r.stderr || r.stdout}`);
  }
  // Optional display-size resize AFTER matte only.
  if (maxHAfter > 0) {
    run("ffmpeg", [
      "-y",
      "-i",
      dstFull,
      "-vf",
      `scale=-2:'min(ih,${maxHAfter})'`,
      dstFull,
    ]);
  }
  if (i === 1 || i === names.length || i % 20 === 0) {
    console.error(
      JSON.stringify({
        step: "frame",
        i,
        total: names.length,
        stats: (r.stdout || "").trim(),
      }),
    );
  }
}

console.log(
  JSON.stringify({
    ok: true,
    engine: "bg-removal-softshadows/cutout.mjs",
    key,
    frames: names.length,
    outDir: matted,
    fps,
    scaleBeforeMatte: false,
    maxHAfter,
  }),
);
