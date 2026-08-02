import sharp from 'sharp';
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

// Anchored to the repo, not to the shell's CWD, so `node tools/build-assets.mjs`
// works from anywhere. The sources are the untracked photo library at the repo
// root — see .gitignore.
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const idx = JSON.parse(readFileSync(resolve(HERE, 'index.json'), 'utf8'));
const byNum = new Map(idx.map(o => [o.n, o.f]));
const SRC = ROOT;
const OUT = resolve(ROOT, 'assets/img');
mkdirSync(OUT, { recursive: true });

// slot → source image number. Wide slots get scenes that survive a horizontal crop.
const SLOTS = [
  // about
  { id: 'about',        n: 17, ratio: [4,5],  w: [800, 1200] },
  // service cards
  { id: 'svc-couples',  n: 9,  ratio: [4,5],  w: [600, 900] },
  { id: 'svc-std',      n: 57, ratio: [4,5],  w: [600, 900] },
  { id: 'svc-prep',     n: 1,  ratio: [4,5],  w: [600, 900] },
  { id: 'svc-event',    n: 58, ratio: [4,5],  w: [600, 900] },
  { id: 'svc-people',   n: 84, ratio: [4,5],  w: [600, 900] },
  // gallery (order matches the design's PHOTOS array)
  { id: 'g01', n: 11, ratio: [4,5],  w: [500, 900], cat: 'weddings', alt: 'רגע החופה' },
  { id: 'g02', n: 8,  ratio: [4,5],  w: [500, 900], cat: 'weddings', alt: 'פורטרט כלה' },
  { id: 'g03', n: 76, ratio: [16,9], w: [600, 1100], cat: 'weddings', alt: 'הזוג אחרי הטקס' },
  { id: 'g04', n: 62, ratio: [4,5],  w: [500, 900], cat: 'std',      alt: 'צילומי זוגיות בלוקיישן' },
  { id: 'g05', n: 78, ratio: [4,5],  w: [500, 900], cat: 'weddings', alt: 'השמלה והצעדים הראשונים' },
  { id: 'g06', n: 7,  ratio: [16,9], w: [600, 1100], cat: 'std',     alt: 'Save the Date בשקיעה' },
  { id: 'g07', n: 83, ratio: [4,5],  w: [500, 900], cat: 'weddings', alt: 'ריקודים' },
  { id: 'g08', n: 73, ratio: [21,9], w: [700, 1300], cat: 'weddings', alt: 'חופה בשקיעה' },
  { id: 'g09', n: 19, ratio: [4,5],  w: [500, 900], cat: 'prep',     alt: 'איפור בבוקר האירוע' },
  { id: 'g10', n: 85, ratio: [4,5],  w: [500, 900], cat: 'prep',     alt: 'עיצוב שיער לכלה' },
  { id: 'g11', n: 82, ratio: [16,9], w: [600, 1100], cat: 'prep',    alt: 'פרטי השמלה' },
  { id: 'g12', n: 66, ratio: [4,5],  w: [500, 900], cat: 'events',   alt: 'עיצוב שולחנות באירוע' },
  { id: 'g13', n: 80, ratio: [16,9], w: [600, 1100], cat: 'events',  alt: 'חגיגה עם האורחים' },
  { id: 'g14', n: 86, ratio: [4,5],  w: [500, 900], cat: 'events',   alt: 'שושבינות' },
  { id: 'g15', n: 50, ratio: [4,5],  w: [500, 900], cat: 'std',      alt: 'זוג בעיר' },
  { id: 'g16', n: 10, ratio: [4,5],  w: [500, 900], cat: 'weddings', alt: 'רגע שקט בין השניים' },
  { id: 'g17', n: 39, ratio: [16,9], w: [600, 1100], cat: 'weddings', alt: 'ההליכה אל החופה' },
  { id: 'g18', n: 74, ratio: [4,5],  w: [500, 900], cat: 'std',      alt: 'פורטרט זוגי' },
  // testimonial avatars
  { id: 'avatar-1', n: 53, ratio: [1,1], w: [112] },
  { id: 'avatar-2', n: 70, ratio: [1,1], w: [112] },
  { id: 'avatar-3', n: 79, ratio: [1,1], w: [112] },
  // full-bleed CTA background + film poster
  { id: 'cta',   n: 59, ratio: [21,9], w: [1200, 2000] },
  { id: 'film-poster', n: 64, ratio: [16,9], w: [900, 1600] },
];

const manifest = [];
for (const s of SLOTS) {
  const file = byNum.get(s.n);
  if (!file) { console.log('!! missing #' + s.n); continue; }
  const [rw, rh] = s.ratio;
  const src = `${SRC}/${file}`;
  const meta = await sharp(src).metadata();
  const out = [];
  for (const w of s.w) {
    const h = Math.round(w * rh / rw);
    if (w > meta.width * 1.15) continue;           // never upscale meaningfully
    const base = s.w.length > 1 ? `${s.id}-${w}` : s.id;
    const cut = () => sharp(src).resize(w, h, { fit: 'cover', position: sharp.strategy.attention });

    // JPEG first: it is the fallback every browser can read, and it sets the
    // budget the WebP has to beat. Shipping a WebP that is larger than the
    // JPEG beside it means <picture> picks the heavier file on the newer
    // browser — tools/check.sh fails on exactly that.
    const jpg = await cut().jpeg({ quality: 80, mozjpeg: true }).toBuffer();
    writeFileSync(`${OUT}/${base}.jpg`, jpg);

    // Photographic frames with fine grain occasionally lose to mozjpeg at
    // q78. Step down rather than pick one global quality: only the handful of
    // slots that need it pay for it.
    let webp = null;
    for (const q of [78, 74, 70, 66, 62]) {
      webp = await cut().webp({ quality: q }).toBuffer();
      if (webp.length < jpg.length) break;
    }
    if (webp.length >= jpg.length) {
      console.log(`!! ${base}.webp ${webp.length} B >= ${base}.jpg ${jpg.length} B`);
    }
    writeFileSync(`${OUT}/${base}.webp`, webp);
    out.push({ w, h, base });
  }
  manifest.push({ ...s, src: file, srcW: meta.width, srcH: meta.height, out });
  console.log(`${s.id.padEnd(14)} #${String(s.n).padStart(2)}  ${meta.width}x${meta.height} → ${out.map(o => o.w + 'x' + o.h).join(', ')}`);
}
writeFileSync(resolve(HERE, 'manifest.json'), JSON.stringify(manifest, null, 1));
