import sharp from 'sharp';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'fs';
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

// Two source libraries now, and the newer one wins per slot.
//
// The original library is the untracked Instagram-era export at the repo root,
// addressed by NUMBER through index.json. The second is `incoming/`, the
// studio's own full-resolution frames, addressed by SLOT ID: a file named
// g08.jpg is the g08 slot, which is what lets a session wire up photographs it
// has no way to look at first.
//
// A slot with no file in incoming/ is not rebuilt and not dropped — its
// derivatives in assets/img are already committed and its manifest entry is
// carried over verbatim. That is the case that matters: on a fresh clone the
// root library is absent entirely, so rebuilding "everything" would otherwise
// mean deleting every slot the new drop happens not to cover.
const DROP = resolve(ROOT, 'incoming');
const prevManifest = existsSync(resolve(HERE, 'manifest.json'))
  ? JSON.parse(readFileSync(resolve(HERE, 'manifest.json'), 'utf8'))
  : [];
const prevById = new Map(prevManifest.map(o => [o.id, o]));

// slot → source image number. Wide slots get scenes that survive a horizontal crop.
const SLOTS = [
  // about
  { id: 'about',        n: 17, ratio: [4,5],  w: [800, 1200] },
  // service cards
  { id: 'svc-couples',  n: 9,  ratio: [4,5],  w: [600, 900] },
  { id: 'svc-std',      n: 57, ratio: [4,5],  w: [600, 900] },
  { id: 'svc-prep',     n: 1,  ratio: [4,5],  w: [600, 900] },
  // focusX: the bride sits left of centre in the 2400px frame; attention
  // preferred the guest's face at the right edge. Measured, not guessed.
  { id: 'svc-event',    n: 58, ratio: [4,5],  w: [600, 900], focusX: 0.42 },
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
  { id: 'g14', n: 86, ratio: [4,5],  w: [500, 900], cat: 'prep',     alt: 'שושבינות' },
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
  const dropped = resolve(DROP, `${s.id}.jpg`);
  const fromDrop = existsSync(dropped);
  const file = fromDrop ? `incoming/${s.id}.jpg` : byNum.get(s.n);
  // Named is not the same as present: index.json still lists every numbered
  // original, but on a fresh clone none of them is on disk — the library is
  // untracked by design. Both misses land here.
  const src = fromDrop ? dropped : (file ? `${SRC}/${file}` : null);
  if (!src || !existsSync(src)) {
    // Keep whatever this slot already ships rather than dropping it out of the
    // manifest and off the page.
    const kept = prevById.get(s.id);
    if (kept) { manifest.push(kept); console.log(`${s.id.padEnd(14)} kept — no source on disk`); }
    else console.log(`!! ${s.id}: no source and nothing to keep`);
    continue;
  }
  const [rw, rh] = s.ratio;
  const meta = await sharp(src).metadata();
  const out = [];
  for (const w of s.w) {
    const h = Math.round(w * rh / rw);
    if (w > meta.width * 1.15) continue;           // never upscale meaningfully
    const base = s.w.length > 1 ? `${s.id}-${w}` : s.id;

    // `attention` is right nearly always, and catastrophically wrong when the
    // most salient thing in the frame is not the subject. svc-event is the
    // case that forced this: a landscape frame of the bride lifted on a chair,
    // centred, with a guest's face at the right edge — attention cropped to the
    // guest and cut the bride in half. focusX is the escape hatch, a fraction
    // of the source width to centre the window on; focusY does the same
    // vertically for the rarer wide-crop-of-a-tall-frame case. Both are only
    // consulted when set, so every other slot keeps the automatic behaviour.
    const win = () => {
      const sw = meta.width, sh = meta.height, want = rw / rh;
      let cw, ch;
      if (sw / sh > want) { ch = sh; cw = Math.round(sh * want); }
      else { cw = sw; ch = Math.round(sw / want); }
      const cx = (s.focusX ?? 0.5) * sw, cy = (s.focusY ?? 0.5) * sh;
      return {
        left: Math.max(0, Math.min(sw - cw, Math.round(cx - cw / 2))),
        top: Math.max(0, Math.min(sh - ch, Math.round(cy - ch / 2))),
        width: cw, height: ch,
      };
    };
    // Output sharpening, and it is not optional at these ratios. The 2026-08-11
    // sources are 2400px on the long edge and the wall serves them at 500 —
    // a ~5x downscale, which is a low-pass filter: the resampler averages away
    // exactly the eyelash and lace detail that reads as "shot on a real
    // camera". Every stock photo pipeline re-sharpens after resize for this
    // reason, and the site had no such step, so the new frames were landing
    // softer than the Instagram-era exports they replaced (those were already
    // sharpened by Instagram before export).
    //
    // m1 is deliberately below sharp's 1.0 default: it governs FLAT areas, and
    // on wedding portraits the flat areas are skin. Lifting it there sharpens
    // grain and pores into something that looks like a bad phone HDR. m2 —
    // jagged areas, i.e. real edges — is left at the default to do the work.
    const SHARPEN = { sigma: 0.8, m1: 0.4, m2: 2.0 };
    const cut = () => ((s.focusX == null && s.focusY == null)
      ? sharp(src).resize(w, h, { fit: 'cover', position: sharp.strategy.attention })
      : sharp(src).extract(win()).resize(w, h, { fit: 'cover' })
    ).sharpen(SHARPEN);

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
