/**
 * Synthetic green-screen fixture:
 *  - pure green plate
 *  - solid purple object
 *  - 50% blend edge pixel (simulates anti-alias): C = 0.5 F + 0.5 G
 * Asserts: green clears, purple stays, edge RGB is decontaminated (less green).
 */
import { writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodePng, decodePng } from "./cutout.mjs";
import { chromaDecontam } from "./chroma_decontam.mjs";

const DIR = dirname(fileURLToPath(import.meta.url)) + "/";
const W = 32;
const H = 32;

const d = new Uint8ClampedArray(W * H * 4);
// fill green
for (let i = 0; i < d.length; i += 4) {
  d[i] = 0;
  d[i + 1] = 255;
  d[i + 2] = 0;
  d[i + 3] = 255;
}
// purple block 8..24
for (let y = 8; y < 24; y++) {
  for (let x = 8; x < 24; x++) {
    const i = (y * W + x) * 4;
    d[i] = 120;
    d[i + 1] = 40;
    d[i + 2] = 180;
    d[i + 3] = 255;
  }
}
// anti-aliased edge column x=7, y=8..23: 50% blend of purple and green
for (let y = 8; y < 24; y++) {
  const i = (y * W + 7) * 4;
  d[i] = Math.round(0.5 * 120 + 0.5 * 0);
  d[i + 1] = Math.round(0.5 * 40 + 0.5 * 255);
  d[i + 2] = Math.round(0.5 * 180 + 0.5 * 0);
  d[i + 3] = 255;
}

writeFileSync(DIR + "decontam-src.png", encodePng({ w: W, h: H, data: d }));

const { data, screen } = chromaDecontam(d, W, H, {
  screenMode: "fixed",
  keyR: 0,
  keyG: 255,
  keyB: 0,
  metric: "green-excess",
  low: 0.12,
  high: 0.42,
  feather: 0,
  reconstruct: true,
  spillAmount: 0.2,
  premultiply: false,
});

writeFileSync(DIR + "decontam-out.png", encodePng({ w: W, h: H, data }));

const px = (x, y) => {
  const i = (y * W + x) * 4;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
};

const edgeBeforeG = Math.round(0.5 * 40 + 0.5 * 255); // ~147.5
const edge = px(7, 16);
const purple = px(16, 16);
const green = px(2, 2);

const checks = [
  ["screen estimate green-dominant", screen.g > screen.r && screen.g > screen.b, screen],
  ["pure green cleared", green[3] === 0, green],
  ["purple opaque", purple[3] >= 250, purple],
  ["purple stays purple-ish", purple[0] > purple[1] && purple[2] > purple[1], purple],
  ["edge has alpha mid/high", edge[3] > 40 && edge[3] < 255, edge],
  ["edge G reduced vs blend", edge[1] < edgeBeforeG - 20, { edge, edgeBeforeG }],
  ["edge not pure green", !(edge[1] > 200 && edge[0] < 40 && edge[2] < 40), edge],
];

let pass = 0;
for (const [name, ok, detail] of checks) {
  console.log(ok ? "PASS " : "FAIL ", name, " ", JSON.stringify(detail));
  if (ok) pass++;
}
console.log(`${pass}/${checks.length} PASS`);
if (pass < checks.length) process.exit(1);
