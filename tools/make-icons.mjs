#!/usr/bin/env node
// Amora Studio — favicon / touch-icon generator.
//
//   node tools/make-icons.mjs            # regenerate from assets/img/logo.jpg
//   node tools/make-icons.mjs path.jpg   # regenerate from a new master
//
// Build-time only. tools/ is .vercelignore'd and never served; the generated
// files are committed, so a deploy needs no build step and no node_modules.
//
// Why these sizes:
//   16 / 32   what desktop browsers actually paint in a tab and a bookmark bar.
//   48        Google's stated minimum for the favicon it shows in search
//             results, and the size everything else is a multiple of.
//   96, 192   2x and 4x of 48 — Android home screen and high-DPI tabs.
//   180       Apple's fixed apple-touch-icon size. Flattened onto an opaque
//             background because iOS does not honour transparency and renders
//             it black.
//
// favicon.ico is written by hand rather than with a package: an .ico is a
// 6-byte header, one 16-byte directory entry per image, and the payloads. PNG
// payloads are legal in .ico from Vista onward and every browser in use reads
// them. Doing it inline keeps the repo at zero runtime AND zero build
// dependencies beyond sharp, which tools/build-assets.mjs already needs.

import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.argv[2] ? resolve(process.argv[2]) : resolve(ROOT, 'assets/img/logo.jpg');

// The mark sits on a light marble field. Any padding or flattening must use
// the same ivory the site uses (--ivory / #FFFDF9) so the icon does not grow a
// grey halo on iOS.
const IVORY = { r: 255, g: 253, b: 249, alpha: 1 };

function png(size) {
  return sharp(SRC)
    .resize(size, size, { fit: 'cover', kernel: 'lanczos3' })
    .flatten({ background: IVORY })
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();
}

// --- .ico container ---------------------------------------------------------
// ICONDIR:   reserved(2)=0, type(2)=1, count(2)
// ICONDIRENTRY (16 bytes each): w(1) h(1) colors(1) reserved(1)
//   planes(2) bpp(2) bytes(4) offset(4).  A 256px image is encoded as 0.
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const dir = Buffer.alloc(16 * images.length);
  let offset = 6 + dir.length;
  images.forEach((img, i) => {
    const at = i * 16;
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, at + 0);
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, at + 1);
    dir.writeUInt8(0, at + 2);          // palette size — 0 for PNG payloads
    dir.writeUInt8(0, at + 3);          // reserved
    dir.writeUInt16LE(1, at + 4);       // colour planes
    dir.writeUInt16LE(32, at + 6);      // bits per pixel
    dir.writeUInt32LE(img.data.length, at + 8);
    dir.writeUInt32LE(offset, at + 12);
    offset += img.data.length;
  });

  return Buffer.concat([header, dir, ...images.map((i) => i.data)]);
}

const meta = await sharp(SRC).metadata();
if (meta.width !== meta.height) {
  console.warn(`!  ${SRC} is ${meta.width}x${meta.height}, not square — cover-cropping.`);
}
if (meta.width < 192) {
  console.warn(`!  master is only ${meta.width}px; 180 and 192 are upscaled. ` +
               'Replace assets/img/logo.jpg with a >=512px master when one exists.');
}

const icoSizes = [16, 32, 48];
const icoImages = [];
for (const size of icoSizes) icoImages.push({ size, data: await png(size) });
await writeFile(resolve(ROOT, 'favicon.ico'), ico(icoImages));
console.log(`favicon.ico            ${icoSizes.join('/')} px`);

// No standalone 48px PNG: favicon.ico already carries one, and an icon file
// nothing links to is the kind of thing this pass exists to remove.
// 512 exists because Chrome's install prompt requires 192 AND 512. With the
// old 150px master it would have been an upscale, so the manifest shipped
// without it and the site was not installable. A real 4096px master arrived
// 2026-08-05 and that constraint went away.
const files = [
  ['assets/img/icon-96.png', 96],
  ['assets/img/icon-192.png', 192],
  ['assets/img/icon-512.png', 512],
  ['assets/img/apple-touch-icon.png', 180],
];
for (const [rel, size] of files) {
  const data = await png(size);
  await writeFile(resolve(ROOT, rel), data);
  console.log(`${rel.padEnd(22)} ${size}px  ${data.length} B`);
}
