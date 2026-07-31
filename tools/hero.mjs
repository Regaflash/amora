import sharp from 'sharp';
import { readFileSync, mkdirSync } from 'fs';
import { execFileSync } from 'child_process';

const FF = readFileSync('.ffpath', 'utf8').trim();
const idx = JSON.parse(readFileSync('index.json', 'utf8'));
const byNum = new Map(idx.map(o => [o.n, o.f]));
const SRC = './amora-media';
const OUT = '/home/claude/repo/assets/video';
mkdirSync(OUT, { recursive: true });
mkdirSync('./hero-tmp', { recursive: true });

// Atmospheric frames — the hero carries centred text over a dark scrim, so
// these need mood and negative space, not busy detail.
const SETS = {
  wide:     { w: 1920, h: 1080, picks: [7, 17, 29, 73, 11] },
  vertical: { w: 1080, h: 1920, picks: [8, 17, 37, 78, 7] },
};

const HOLD = 2.6;   // seconds each frame is held
const FADE = 0.9;   // crossfade duration
const FPS  = 25;

const run = (args) => execFileSync(FF, args, { stdio: ['ignore', 'ignore', 'pipe'] });

for (const [name, cfg] of Object.entries(SETS)) {
  const { w, h, picks } = cfg;
  // Loop seamlessly: replay the first frame at the end and crossfade into it.
  const seq = [...picks, picks[0]];
  const clips = [];

  for (let i = 0; i < seq.length; i++) {
    const src = `${SRC}/${byNum.get(seq[i])}`;
    // Oversample 2x so zoompan has real pixels to work with instead of blurring.
    const still = `./hero-tmp/${name}-${i}.jpg`;
    await sharp(src).resize(w * 2, h * 2, { fit: 'cover', position: sharp.strategy.attention })
      .jpeg({ quality: 94 }).toFile(still);

    const frames = Math.round(HOLD * FPS);
    const dir = i % 2 === 0 ? 'in' : 'out';          // alternate push-in / pull-out
    const z = dir === 'in'
      ? `min(1.0006+0.00045*on,1.10)`
      : `max(1.10-0.00045*on,1.0006)`;
    const clip = `./hero-tmp/${name}-${i}.mp4`;
    run(['-y', '-loop', '1', '-i', still,
      '-vf', `zoompan=z='${z}':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${w}x${h}:fps=${FPS},format=yuv420p`,
      '-t', String(HOLD), '-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast', '-an', clip]);
    clips.push(clip);
  }

  // Chain the crossfades: each transition eats FADE seconds of overlap.
  const inputs = clips.flatMap(c => ['-i', c]);
  let filter = '', prev = '0:v', t = 0;
  for (let i = 1; i < clips.length; i++) {
    t += HOLD - FADE;
    const out = i === clips.length - 1 ? 'vout' : `x${i}`;
    filter += `[${prev}][${i}:v]xfade=transition=fade:duration=${FADE}:offset=${t.toFixed(3)}[${out}];`;
    prev = out;
  }
  filter = filter.replace(/;$/, '');
  const total = (HOLD - FADE) * (clips.length - 1) + HOLD;
  // Trim the tail so the loop point lands mid-crossfade back into frame one.
  const dur = (total - HOLD).toFixed(3);
  const master = `./hero-tmp/${name}-master.mp4`;
  run(['-y', ...inputs, '-filter_complex', filter, '-map', '[vout]', '-t', dur,
    '-c:v', 'libx264', '-crf', '17', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-an', master]);

  // Delivery encodes. faststart puts the moov atom first so playback can begin
  // before the whole file lands.
  run(['-y', '-i', master, '-c:v', 'libx264', '-crf', '26', '-preset', 'slow',
    '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an',
    `${OUT}/hero-${name}.mp4`]);
  run(['-y', '-i', master, '-c:v', 'libvpx-vp9', '-crf', '36', '-b:v', '0',
    '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2', '-pix_fmt', 'yuv420p', '-an',
    `${OUT}/hero-${name}.webm`]);

  // Poster = the true first frame, so there is never a flash on swap-in.
  run(['-y', '-i', master, '-vframes', '1', '-q:v', '2', `./hero-tmp/${name}-poster.jpg`]);
  for (const [ext, opt] of [['webp', { quality: 74 }], ['jpg', { quality: 78, mozjpeg: true }]])
    await sharp(`./hero-tmp/${name}-poster.jpg`).resize(Math.round(w / 1.5), Math.round(h / 1.5))
      [ext === 'webp' ? 'webp' : 'jpeg'](opt).toFile(`/home/claude/repo/assets/img/hero-${name}-poster.${ext}`);

  console.log(`${name}: ${dur}s @ ${w}x${h}`);
}
