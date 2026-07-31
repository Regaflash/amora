import sharp from 'sharp';
import { readdirSync } from 'fs';
const DIR = './amora-media';
const files = readdirSync(DIR).filter(f => f.toLowerCase().endsWith('.jpg')).sort();

const hashes = [];
for (const f of files) {
  const buf = await sharp(`${DIR}/${f}`).greyscale().resize(8, 8, { fit: 'fill' }).raw().toBuffer();
  const avg = buf.reduce((a, b) => a + b, 0) / buf.length;
  hashes.push({ f, h: Array.from(buf).map(v => v > avg ? '1' : '0').join('') });
}
const groups = new Map();
for (const { f, h } of hashes) {
  if (!groups.has(h)) groups.set(h, []);
  groups.get(h).push(f);
}
const dupes = [...groups.values()].filter(g => g.length > 1);
console.log('קבוצות זהות ויזואלית:', dupes.length);
let redundant = 0;
for (const g of dupes) { redundant += g.length - 1; console.log('  ' + g.length + 'x  ' + g.join(' | ')); }
console.log('---');
console.log('סה"כ קבצים:', files.length);
console.log('עודפים:', redundant);
console.log('תמונות ייחודיות:', files.length - redundant);
