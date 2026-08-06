// Amora Studio — hero loop encoder.
//
//   node tools/make-hero-video.mjs wide.mp4 vertical.mp4
//   node tools/make-hero-video.mjs wide.mp4 vertical.mp4 --in 4,0 --dur 12
//
// Takes the two raw downloads from YouTube Studio and produces everything the
// hero serves: two muted loops and a full-resolution poster for each, cut from
// the loop's own first frame so the still and the video are the same picture.
//
// Build-time only. tools/ is .vercelignore'd and never served; the outputs are
// committed, so a deploy needs no build step and no node_modules — the same
// contract tools/make-icons.mjs works under.
//
// ffmpeg comes from the ffmpeg-static npm package if it is installed, and from
// PATH otherwise. This repo has no package.json on purpose, so:
//
//   npm install --no-save ffmpeg-static
//
// WHY THE HERO IS SELF-HOSTED AT ALL
//
// It used to be two YouTube embeds. They failed in ways the site could not fix
// from its own side — a Content ID claimant can block playback in embedded
// players while allowing it on YouTube, and the embed answered with error 153
// while both videos played perfectly on youtube.com. Three separate hypotheses
// were tested and disproved before that one: embedding was already enabled,
// neither video is geo-blocked in Israel, and the poster was not covering
// anything. Every remaining explanation lived on YouTube's side of the wire.
//
// WHY THE OUTPUT LOOKS THE WAY IT DOES
//
//   -an          The hero is muted in every browser — none autoplay with sound.
//                The audio track is bytes nobody hears, and on these two clips
//                it is also the surface both copyright claims attached to.
//   -crf 24      Visually transparent at this size for footage this soft. The
//                source has already been through YouTube's encoder once; a
//                second aggressive pass is what makes a hero look worse than
//                the film it came from.
//   faststart    Moves the index to the front so playback can begin before the
//                file has finished arriving. Without it a hero waits for the
//                whole download.
//   yuv420p      The only chroma layout every browser and every iOS version
//                decodes. 4:2:2 or 4:4:4 out of an editor plays on a desktop
//                and shows a black rectangle on a phone.
//
// The clip must LOOP WITHOUT A SEAM. That is a cutting decision, not an
// encoding one: pick --in so the first and last frames sit on similar motion
// and framing. A visible jump every twelve seconds reads as broken in a way
// that a shorter clip never does.

import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'assets', 'video');
const IMG_DIR = path.join(ROOT, 'assets', 'img');

// Above this, re-cut shorter rather than compressing harder. A hero is
// decoration and the guard in main.js already refuses to load it on a metered
// connection; the budget is what keeps that promise meaningful for everyone
// else.
const BUDGET_MB = 6;
const TARGET_MB = 4;

function ffmpegPath() {
  // createRequire, not a bare require: this file is an ES module and `require`
  // is not defined in one. Written that way first, the ReferenceError was
  // swallowed by the catch below and the fallback silently reached for an
  // ffmpeg that is not on PATH — a spawn failure two hundred lines away from
  // its cause. A catch that hides its own bug is worse than no catch.
  try {
    const req = createRequire(import.meta.url);
    const p = req('ffmpeg-static');
    if (p && fs.existsSync(p)) return p;
  } catch (e) {
    if (e && e.code !== 'MODULE_NOT_FOUND') throw e;
  }
  return 'ffmpeg';
}

const FFMPEG = ffmpegPath();

function run(args) {
  return execFileSync(FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'] });
}

function probe(file) {
  // spawnSync, not the try/catch around execFileSync this started as. ffmpeg
  // prints stream info to stderr and `-f null -` is a perfectly valid output,
  // so it exits ZERO — the catch that was meant to read the banner never ran
  // and probe returned 0x0 every time. Both guards below depend on it, so both
  // were silently dead: neither the upscale warning nor the "cut runs past the
  // end of the source" check could ever fire. Read stderr unconditionally.
  const r = spawnSync(FFMPEG, ['-hide_banner', '-i', file], { encoding: 'utf8' });
  const s = (r.stderr || '') + (r.stdout || '');
  const dim = s.match(/,\s(\d{2,5})x(\d{2,5})[\s,]/);
  const dur = s.match(/Duration:\s(\d+):(\d+):(\d+\.\d+)/);
  return {
    w: dim ? +dim[1] : 0,
    h: dim ? +dim[2] : 0,
    seconds: dur ? (+dur[1] * 3600 + +dur[2] * 60 + +dur[3]) : 0,
  };
}

function mb(file) {
  return fs.statSync(file).size / 1024 / 1024;
}

/** One cut: trim, strip audio, scale to the exact box, and lift a poster from
 *  the first frame of what was kept. */
function encode({ src, out, poster, width, height, start, dur }) {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // -ss BEFORE -i seeks by keyframe and is fast; the small inaccuracy does not
  // matter for a decorative loop and avoids decoding everything up to the cut.
  run([
    '-y', '-ss', String(start), '-i', src, '-t', String(dur),
    '-an',
    '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-crf', '24', '-preset', 'slow',
    '-movflags', '+faststart',
    // Cover, not contain: fill the box and crop the overflow, so the loop never
    // letterboxes inside a hero that is a different shape from the source.
    '-vf', `scale=${width}:${height}:force_original_aspect_ratio=increase,` +
           `crop=${width}:${height},setsar=1`,
    out,
  ]);

  // The poster is the loop's own opening frame, so the fade from still to
  // moving picture has nothing to cross. It also replaces posters that were
  // stuck at the source's 1280px — upscaling those produced blur, not detail.
  run([
    '-y', '-i', out, '-frames:v', '1', '-q:v', '2',
    poster.replace(/\.webp$/, '.jpg'),
  ]);
  run(['-y', '-i', out, '-frames:v', '1', '-q:v', '80', poster]);
}

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const [wideSrc, vertSrc] = process.argv.slice(2).filter(a => !a.startsWith('--') &&
  !/^[\d.,]+$/.test(a));

if (!wideSrc || !vertSrc) {
  console.error(
    'usage: node tools/make-hero-video.mjs <wide-source> <vertical-source>\n' +
    '       [--in <wideStart>,<verticalStart>]   seconds into each source, default 0,0\n' +
    '       [--dur <seconds>]                    loop length, default 12\n');
  process.exit(1);
}

const [inWide = '0', inVert = '0'] = arg('in', '0,0').split(',');
const dur = Number(arg('dur', '12'));

const jobs = [
  { label: 'wide',     src: wideSrc, width: 1920, height: 1080, start: Number(inWide),
    out: path.join(OUT_DIR, 'hero-wide.mp4'),
    poster: path.join(IMG_DIR, 'hero-wide-poster.webp') },
  { label: 'vertical', src: vertSrc, width: 1080, height: 1920, start: Number(inVert),
    out: path.join(OUT_DIR, 'hero-vertical.mp4'),
    poster: path.join(IMG_DIR, 'hero-vertical-poster.webp') },
];

console.log(`ffmpeg: ${FFMPEG}\n`);
let over = false;

for (const j of jobs) {
  if (!fs.existsSync(j.src)) {
    console.error(`missing source for ${j.label}: ${j.src}`);
    process.exit(1);
  }
  const info = probe(j.src);
  console.log(`${j.label.padEnd(9)} source ${info.w}x${info.h}, ${info.seconds.toFixed(1)}s`);

  if (info.w && info.w < j.width) {
    console.log(`${''.padEnd(9)} note: source is narrower than ${j.width}px — ` +
                `the output will be upscaled and will look soft`);
  }
  if (info.seconds && j.start + dur > info.seconds) {
    console.error(`${''.padEnd(9)} --in ${j.start} + --dur ${dur} runs past the ` +
                  `end of a ${info.seconds.toFixed(1)}s source`);
    process.exit(1);
  }

  encode({ ...j, dur });

  const size = mb(j.out);
  const flag = size > BUDGET_MB ? '  ✗ OVER BUDGET — re-cut shorter'
             : size > TARGET_MB ? '  ⚠ above target'
             : '  ✓';
  if (size > BUDGET_MB) over = true;
  console.log(`${''.padEnd(9)} ${path.relative(ROOT, j.out)}  ${size.toFixed(2)} MB${flag}`);
  console.log(`${''.padEnd(9)} ${path.relative(ROOT, j.poster)}  ` +
              `${mb(j.poster).toFixed(2)} MB (poster, from frame 1)\n`);
}

if (over) {
  console.error(`One or more clips exceed ${BUDGET_MB} MB. Lower --dur rather than ` +
                `raising -crf: a shorter loop beats a mushy one.`);
  process.exit(1);
}
console.log('Done. Commit the outputs; delete the raw sources.');
