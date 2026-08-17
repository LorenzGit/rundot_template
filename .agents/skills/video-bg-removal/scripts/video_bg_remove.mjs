#!/usr/bin/env node
/**
 * video_bg_remove.mjs — extract frames, matte, encode transparent video.
 *
 * Usage:
 *   node video_bg_remove.mjs --in clip.mp4 --out clip.webm [options]
 *
 * Outputs (CSS-Tricks hybrid — dual browser delivery):
 *   --out path.webm           VP9 alpha WebM (Chrome / Firefox / Edge)
 *   --also-hevc path.mov      HEVC-with-alpha MOV (Safari / iOS) — optional
 *
 * Engines: chroma-decontam (default) | chroma | studio-white | birefnet
 *
 * Serving (do NOT rely on <source> order alone):
 *   player.src = supportsHEVCAlpha() ? 'hero.mov' : 'hero.webm'
 *   https://css-tricks.com/overlaying-video-with-transparency-while-wrangling-cross-browser-support/
 */
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  rmSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  copyFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import {
  parseHex,
  chromaMatte,
  chromaDecontamMatte,
  studioWhiteMatte,
  temporalMedianAlpha,
} from './matte_frame.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  return process.argv[i + 1] ?? fallback;
}
function flag(name) {
  return process.argv.includes(name);
}

function usage() {
  console.log(`Usage: node video_bg_remove.mjs --in <video> --out <webm> [options]
  --engine chroma-decontam|chroma|studio-white|birefnet
       (default chroma-decontam — matte + F=(C-(1-α)G)/α edge decontam)
  --key rrggbb                            chroma key (default 00ff00)
  --tolerance N                           legacy chroma full-key distance (48)
  --softness N                            legacy chroma soft band (24)
  --white-threshold N                     studio-white luma cut (230)
  --screen-mode auto-border|fixed         decontam screen estimate (auto-border)
  --metric green-excess|ycbcr|rgb         decontam matte metric (green-excess)
  --decontam-low N                        screen fully clear below score (0.12)
  --decontam-high N                       FG fully opaque above score (0.42)
  --feather N                             alpha feather px (0.5)
  --spill-amount N                        0=hard despill … 1=none (0.2)
  --reconstruct on|off                    edge FG reconstruction (on)
  --pure-key-pull N                       blend auto G toward --key (0.35)
  --fps N                                 extract fps (source or 24)
  --crf N                                 VP9 CRF 0-63 (32)
  --max-height N                          scale longest edge down (0=off)
  --temporal-median R                     alpha median radius (0=off, 1=window3)
  --also-png path.png                     write first matted frame
  --also-hevc path.mov                    also encode HEVC-with-alpha for Safari (macOS VT)
  --hevc-bitrate Nk                       HEVC VideoToolbox bitrate (default 4M)
  --hevc-alpha-quality N                  VideoToolbox alpha_quality 0–1 (default 0.9)
  --work-dir path                         keep intermediate frames
  --birefnet-py path                      birefnet_cutout.py
  --birefnet-python path                  python with torch
  --birefnet-model name                   default "General Use (Light)"
  --birefnet-res 1024|2048
`);
}

async function loadPngDecode() {
  // Prefer sharp if present; else pure pngjs via dynamic import of built-in fallback.
  try {
    const sharp = (await import('sharp')).default;
    return {
      async decode(path) {
        const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        return { rgba: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), w: info.width, h: info.height };
      },
      async encode(path, rgba, w, h) {
        await sharp(Buffer.from(rgba), { raw: { width: w, height: h, channels: 4 } }).png().toFile(path);
      },
    };
  } catch {
    // Fallback: use ffmpeg for png encode/decode via raw rgba intermediate
    return null;
  }
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, ...opts });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed:\n${r.stderr || r.stdout}`);
  }
  return r;
}

function probeFps(input) {
  const r = spawnSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate', '-of', 'csv=p=0', input],
    { encoding: 'utf8' },
  );
  const s = (r.stdout || '').trim();
  if (s.includes('/')) {
    const [a, b] = s.split('/').map(Number);
    if (b) return Math.min(30, Math.max(1, Math.round(a / b)));
  }
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 24;
}

async function main() {
  if (flag('--help') || flag('-h')) {
    usage();
    process.exit(0);
  }
  const input = arg('--in') || arg('-i');
  const output = arg('--out') || arg('-o');
  if (!input || !output) {
    usage();
    process.exit(1);
  }
  const engine = arg('--engine', 'chroma-decontam');
  const keyHex = arg('--key', '00ff00');
  const tolerance = Number(arg('--tolerance', '48'));
  const softness = Number(arg('--softness', '24'));
  const whiteThreshold = Number(arg('--white-threshold', '230'));
  const screenMode = arg('--screen-mode', 'auto-border');
  const metric = arg('--metric', 'green-excess');
  const decontamLow = Number(arg('--decontam-low', '0.12'));
  const decontamHigh = Number(arg('--decontam-high', '0.42'));
  const feather = Number(arg('--feather', '0.5'));
  const spillAmount = Number(arg('--spill-amount', '0.2'));
  const reconstruct = arg('--reconstruct', 'on') !== 'off';
  const pureKeyPull = Number(arg('--pure-key-pull', '0.35'));
  const crf = Number(arg('--crf', '32'));
  const maxHeight = Number(arg('--max-height', '0'));
  const temporalR = Number(arg('--temporal-median', '0'));
  const alsoPng = arg('--also-png');
  const alsoHevc = arg('--also-hevc');
  const hevcBitrate = arg('--hevc-bitrate', '4M');
  const hevcAlphaQuality = arg('--hevc-alpha-quality', '0.9');
  const keepWork = arg('--work-dir');
  const fpsArg = arg('--fps');
  const fps = fpsArg ? Number(fpsArg) : probeFps(resolve(input));

  const work = keepWork
    ? resolve(keepWork)
    : join(resolve(dirname(output)), `.vbg-${Date.now()}`);
  const framesIn = join(work, 'in');
  const framesOut = join(work, 'out');
  mkdirSync(framesIn, { recursive: true });
  mkdirSync(framesOut, { recursive: true });

  const inAbs = resolve(input);
  const outAbs = resolve(output);
  mkdirSync(dirname(outAbs), { recursive: true });

  // High-quality scaler for alpha mattes. Default bilinear (sws) hardens soft
  // edges when downscaling; lanczos + full_chroma keeps partial-alpha ramps.
  const SWS =
    'flags=lanczos+accurate_rnd+full_chroma_int+full_chroma_inp';
  const scaleFilter =
    maxHeight > 0
      ? `fps=${fps},scale=-2:'min(ih,${maxHeight})':${SWS}`
      : `fps=${fps}`;

  console.log(JSON.stringify({ step: 'extract', fps, engine, input: inAbs, scale: maxHeight > 0 ? 'lanczos' : 'none' }));
  run('ffmpeg', [
    '-y',
    '-i',
    inAbs,
    '-vf',
    scaleFilter,
    '-start_number',
    '0',
    join(framesIn, 'f%05d.png'),
  ]);

  const names = readdirSync(framesIn)
    .filter((n) => n.endsWith('.png'))
    .sort();
  if (names.length === 0) throw new Error('no frames extracted');

  const io = await loadPngDecode();
  if (!io) {
    // Install-free path: shell to python3 + Pillow for PNG RGBA
    const matteOpt = {
      keyHex,
      tolerance,
      softness,
      whiteThreshold,
      temporalR,
      screenMode,
      metric,
      decontamLow,
      decontamHigh,
      feather,
      spillAmount,
      reconstruct,
      pureKeyPull,
      birefnetPy: arg('--birefnet-py'),
      birefnetPython: arg('--birefnet-python'),
      birefnetModel: arg('--birefnet-model', 'General Use (Light)'),
      birefnetRes: arg('--birefnet-res', '1024'),
    };
    await processWithPillow(names, framesIn, framesOut, engine, matteOpt);
  } else {
    await processWithSharp(io, names, framesIn, framesOut, engine, {
      keyHex,
      tolerance,
      softness,
      whiteThreshold,
      temporalR,
      screenMode,
      metric,
      decontamLow,
      decontamHigh,
      feather,
      spillAmount,
      reconstruct,
      pureKeyPull,
      birefnetPy: arg('--birefnet-py'),
      birefnetPython: arg('--birefnet-python'),
      birefnetModel: arg('--birefnet-model', 'General Use (Light)'),
      birefnetRes: arg('--birefnet-res', '1024'),
    });
  }

  console.log(JSON.stringify({ step: 'encode', frames: names.length, out: outAbs }));
  // Direct yuva420p encode — avoid same-size scale=iw:ih (was hardening edges).
  // HQ sws flags only apply when extract actually scales (max-height).
  run('ffmpeg', [
    '-y',
    '-framerate',
    String(fps),
    '-i',
    join(framesOut, 'f%05d.png'),
    '-c:v',
    'libvpx-vp9',
    '-pix_fmt',
    'yuva420p',
    '-auto-alt-ref',
    '0',
    '-b:v',
    '0',
    '-crf',
    String(crf),
    outAbs,
  ]);

  if (alsoPng) {
    copyFileSync(join(framesOut, names[0]), resolve(alsoPng));
  }

  // Probe WebM alpha
  const probe = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_streams', outAbs],
    { encoding: 'utf8' },
  );
  const hasAlpha =
    (probe.stdout || '').includes('alpha_mode') ||
    (probe.stdout || '').includes('yuva');

  /** @type {string | null} */
  let hevcOut = null;
  let hevcOk = false;
  if (alsoHevc) {
    // CSS-Tricks Safari path: HEVC-with-alpha QuickTime (.mov, hvc1).
    // Encode from matted PNGs (preserves alpha better than WebM re-encode).
    // Requires macOS VideoToolbox (hevc_videotoolbox).
    hevcOut = resolve(alsoHevc);
    mkdirSync(dirname(hevcOut), { recursive: true });
    console.log(JSON.stringify({ step: 'encode-hevc', out: hevcOut }));
    try {
      run('ffmpeg', [
        '-y',
        '-framerate',
        String(fps),
        '-i',
        join(framesOut, 'f%05d.png'),
        '-c:v',
        'hevc_videotoolbox',
        '-allow_sw',
        '1',
        '-alpha_quality',
        hevcAlphaQuality,
        '-tag:v',
        'hvc1',
        '-pix_fmt',
        'bgra',
        '-b:v',
        hevcBitrate,
        '-an',
        hevcOut,
      ]);
      const hevcProbe = spawnSync(
        'ffprobe',
        ['-v', 'error', '-show_streams', hevcOut],
        { encoding: 'utf8' },
      );
      hevcOk =
        (hevcProbe.stdout || '').includes('hevc') ||
        (hevcProbe.stdout || '').includes('hvc1');
    } catch (err) {
      console.warn(
        JSON.stringify({
          warn: 'hevc-encode-failed',
          message: err instanceof Error ? err.message : String(err),
          hint: 'HEVC-with-alpha needs macOS hevc_videotoolbox; WebM was still written',
        }),
      );
    }
  }

  console.log(
    JSON.stringify({
      ok: hasAlpha,
      output: outAbs,
      hevc: hevcOut,
      hevcOk,
      frames: names.length,
      fps,
      engine,
      alpha: hasAlpha,
    }),
  );

  if (!keepWork) {
    rmSync(work, { recursive: true, force: true });
  }
  if (!hasAlpha) process.exit(2);
}

async function processWithSharp(io, names, framesIn, framesOut, engine, opt) {
  if (engine === 'birefnet') {
    await runBirefnet(names, framesIn, framesOut, opt);
    return;
  }
  const key = parseHex(opt.keyHex);
  /** @type {Uint8ClampedArray[]} */
  const matted = [];
  let w = 0;
  let h = 0;
  for (const name of names) {
    const { rgba, w: ww, h: hh } = await io.decode(join(framesIn, name));
    w = ww;
    h = hh;
    let out;
    if (engine === 'chroma-decontam' || engine === 'chroma_decontam') {
      out = chromaDecontamMatte(rgba, w, h, {
        key: opt.keyHex,
        screenMode: opt.screenMode,
        metric: opt.metric,
        low: opt.decontamLow,
        high: opt.decontamHigh,
        feather: opt.feather,
        spillAmount: opt.spillAmount,
        reconstruct: opt.reconstruct,
        pureKeyPull: opt.pureKeyPull,
      });
    } else if (engine === 'chroma') out = chromaMatte(rgba, w, h, key, opt.tolerance, opt.softness);
    else if (engine === 'studio-white')
      out = studioWhiteMatte(rgba, w, h, opt.whiteThreshold, 28, opt.softness);
    else throw new Error(`unknown engine ${engine}`);
    matted.push(out);
  }
  const final = opt.temporalR > 0 ? temporalMedianAlpha(matted, opt.temporalR) : matted;
  for (let i = 0; i < names.length; i++) {
    await io.encode(join(framesOut, names[i]), final[i], w, h);
  }
}

async function processWithPillow(names, framesIn, framesOut, engine, opt) {
  if (engine === 'birefnet') {
    await runBirefnet(names, framesIn, framesOut, opt);
    return;
  }
  // Preferred path without sharp: softshadows PNG I/O + our matte engines
  if (
    engine === 'chroma-decontam' ||
    engine === 'chroma_decontam' ||
    engine === 'chroma' ||
    engine === 'studio-white'
  ) {
    const softshadowsCutout = resolve(
      __dirname,
      '../../bg-removal-softshadows/cutout.mjs',
    );
    let decodePng;
    let encodePng;
    if (existsSync(softshadowsCutout)) {
      const cut = await import(pathToFileURL(softshadowsCutout).href);
      decodePng = cut.decodePng;
      encodePng = cut.encodePng;
    } else {
      // local skill copy may only have chroma_decontam — fall through to python
      decodePng = null;
    }
    if (decodePng && encodePng) {
      const key = parseHex(opt.keyHex);
      /** @type {Uint8ClampedArray[]} */
      const matted = [];
      let w = 0;
      let h = 0;
      for (const name of names) {
        const img = decodePng(readFileSync(join(framesIn, name)));
        w = img.w;
        h = img.h;
        let out;
        if (engine === 'chroma-decontam' || engine === 'chroma_decontam') {
          out = chromaDecontamMatte(img.data, w, h, {
            key: opt.keyHex,
            screenMode: opt.screenMode,
            metric: opt.metric,
            low: opt.decontamLow,
            high: opt.decontamHigh,
            feather: opt.feather,
            spillAmount: opt.spillAmount,
            reconstruct: opt.reconstruct,
            pureKeyPull: opt.pureKeyPull,
          });
        } else if (engine === 'chroma') {
          out = chromaMatte(img.data, w, h, key, opt.tolerance, opt.softness);
        } else {
          out = studioWhiteMatte(img.data, w, h, opt.whiteThreshold, 28, opt.softness);
        }
        matted.push(out);
      }
      const final =
        opt.temporalR > 0 ? temporalMedianAlpha(matted, opt.temporalR) : matted;
      for (let i = 0; i < names.length; i++) {
        writeFileSync(
          join(framesOut, names[i]),
          encodePng({ w, h, data: final[i] }),
        );
      }
      return;
    }
  }
  // Write a tiny python matte runner using Pillow
  const py = `
import sys, json
from pathlib import Path
from PIL import Image
import math

frames_in = Path(sys.argv[1])
frames_out = Path(sys.argv[2])
engine = sys.argv[3]
key = tuple(int(sys.argv[4][i:i+2], 16) for i in (0,2,4))
tolerance = float(sys.argv[5])
softness = float(sys.argv[6])
white_threshold = float(sys.argv[7])
temporal_r = int(sys.argv[8])
names = sorted(p.name for p in frames_in.glob('*.png'))

def chroma(px, key, t0, t1):
    r,g,b,a = px
    dr,dg,db = r-key[0], g-key[1], b-key[2]
    dist = math.sqrt(dr*dr+dg*dg+db*db)
    if dist <= t0: alpha = 0
    elif dist >= t1: alpha = a
    else: alpha = int(a * (dist-t0)/(t1-t0))
    nr,ng,nb = r,g,b
    if 0 < alpha < 250 and dist < t1*1.4:
        spill = 1 - min(1, dist/(t1*1.4))
        if key[1] >= key[0] and key[1] >= key[2]:
            lim = max(nr, nb)
            ng = int(ng*(1-spill)+lim*spill)
    return (nr,ng,nb,alpha)

def studio(px, hard, soft):
    r,g,b,a = px
    mx, mn = max(r,g,b), min(r,g,b)
    sat = mx-mn
    luma = 0.2126*r+0.7152*g+0.0722*b
    if sat <= 28 and luma >= hard: return (r,g,b,0)
    if sat <= 38 and luma >= soft:
        t = (luma-soft)/max(1, hard-soft)
        s = 1 - min(1, sat/38)
        return (r,g,b,int(a*(1-t*s)))
    return (r,g,b,a)

rgba_frames = []
sizes = None
for name in names:
    im = Image.open(frames_in/name).convert('RGBA')
    sizes = im.size
    pix = list(im.getdata())
    t0, t1 = tolerance, tolerance+softness
    if engine in ('chroma', 'chroma-decontam', 'chroma_decontam'):
        # Python fallback is legacy chroma only (no full decontam)
        out = [chroma(p, key, t0, t1) for p in pix]
    elif engine == 'studio-white':
        out = [studio(p, white_threshold, white_threshold-softness) for p in pix]
    else:
        raise SystemExit('engine')
    rgba_frames.append(out)

if temporal_r > 0:
    n = len(rgba_frames[0])
    for fi in range(len(rgba_frames)):
        for pi in range(n):
            vals = []
            for d in range(-temporal_r, temporal_r+1):
                j = min(len(rgba_frames)-1, max(0, fi+d))
                vals.append(rgba_frames[j][pi][3])
            vals.sort()
            a = vals[len(vals)//2]
            r,g,b,_ = rgba_frames[fi][pi]
            rgba_frames[fi][pi] = (r,g,b,a)

for i, name in enumerate(names):
    im = Image.new('RGBA', sizes)
    im.putdata(rgba_frames[i])
    im.save(frames_out/name)
print(json.dumps({"frames": len(names), "size": sizes}))
`;
  const scriptPath = join(framesIn, '_matte.py');
  writeFileSync(scriptPath, py);
  run('python3', [
    scriptPath,
    framesIn,
    framesOut,
    engine,
    opt.keyHex.replace('#', ''),
    String(opt.tolerance),
    String(opt.softness),
    String(opt.whiteThreshold),
    String(opt.temporalR || 0),
  ]);
}

async function runBirefnet(names, framesIn, framesOut, opt) {
  const pyScript =
    opt.birefnetPy ||
    resolve(__dirname, '../../bg-removal-softshadows/birefnet_cutout.py');
  const python =
    opt.birefnetPython ||
    resolve(__dirname, '../../bg-removal-softshadows/.venv/bin/python');
  if (!existsSync(python)) {
    throw new Error(
      `birefnet python not found at ${python}. Create the bg-removal-softshadows venv or pass --birefnet-python.`,
    );
  }
  if (!existsSync(pyScript)) throw new Error(`birefnet script missing: ${pyScript}`);
  let i = 0;
  for (const name of names) {
    i++;
    const src = join(framesIn, name);
    const dst = join(framesOut, name);
    console.log(JSON.stringify({ step: 'birefnet', frame: i, total: names.length }));
    run(python, [
      pyScript,
      src,
      dst,
      '--model',
      opt.birefnetModel,
      '--resolution',
      String(opt.birefnetRes),
      '--no-shadow',
    ]);
  }
}

main().catch((e) => {
  console.error(e.stack || e.message || e);
  process.exit(1);
});
