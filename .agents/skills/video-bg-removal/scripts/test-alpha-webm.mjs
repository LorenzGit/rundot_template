#!/usr/bin/env node
/**
 * Synthetic red circle on green → chroma matte → VP9 alpha WebM.
 * Must print PASS lines.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const work = join(root, '../.test-work');
const frames = join(work, 'frames');
const mp4 = join(work, 'src.mp4');
const webm = join(work, 'out.webm');

rmSync(work, { recursive: true, force: true });
mkdirSync(frames, { recursive: true });

// Build green-screen PNGs with a red ball via pure PPM + ffmpeg (no sharp)
// Use ffmpeg lavfi instead
const gen = spawnSync(
  'ffmpeg',
  [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=0x00FF00:s=160x160:d=0.5:r=12',
    '-f',
    'lavfi',
    '-i',
    'color=c=0xDC2828:s=40x40:d=0.5:r=12',
    '-filter_complex',
    '[0][1]overlay=x=20+t*80:y=60',
    '-pix_fmt',
    'yuv420p',
    mp4,
  ],
  { encoding: 'utf8' },
);
if (gen.status !== 0) {
  console.error(gen.stderr);
  process.exit(1);
}

const rem = spawnSync(
  'node',
  [
    join(root, 'video_bg_remove.mjs'),
    '--in',
    mp4,
    '--out',
    webm,
    '--engine',
    'chroma',
    '--key',
    '00ff00',
    '--tolerance',
    '40',
    '--softness',
    '20',
    '--fps',
    '12',
    '--crf',
    '30',
  ],
  { encoding: 'utf8' },
);
console.log(rem.stdout);
if (rem.status !== 0) {
  console.error(rem.stderr);
  process.exit(1);
}

const probe = spawnSync('ffprobe', ['-v', 'error', '-show_streams', webm], {
  encoding: 'utf8',
});
const okAlpha =
  (probe.stdout || '').includes('alpha_mode') || (probe.stdout || '').includes('yuva');
if (!existsSync(webm)) {
  console.log('FAIL missing webm');
  process.exit(1);
}
if (!okAlpha) {
  console.log('FAIL no alpha_mode');
  console.log(probe.stdout);
  process.exit(1);
}
console.log('PASS alpha webm encoded');
console.log('PASS ffprobe alpha_mode');
rmSync(work, { recursive: true, force: true });
console.log('PASS cleanup');
