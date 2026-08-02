import sharp from 'sharp';
import { readdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

// The untracked photo library at the repo root — see .gitignore.
const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = readdirSync(DIR).filter(f => f.toLowerCase().endsWith('.jpg')).sort();

// group by orientation so each sheet is visually consistent
const meta = [];
for (const f of files) {
  const m = await sharp(`${DIR}/${f}`).metadata();
  meta.push({ f, w: m.width, h: m.height, r: m.width / m.height });
}
meta.sort((a, b) => a.r - b.r);

const COLS = 6, CELL = 300, PAD = 6, LABEL = 26;
const perSheet = COLS * 4;

for (let s = 0; s * perSheet < meta.length; s++) {
  const chunk = meta.slice(s * perSheet, (s + 1) * perSheet);
  const rows = Math.ceil(chunk.length / COLS);
  const W = COLS * (CELL + PAD) + PAD;
  const H = rows * (CELL + PAD + LABEL) + PAD;
  const composites = [];

  for (let i = 0; i < chunk.length; i++) {
    const { f, w, h } = chunk[i];
    const col = i % COLS, row = Math.floor(i / COLS);
    const x = PAD + col * (CELL + PAD);
    const y = PAD + row * (CELL + PAD + LABEL);
    const buf = await sharp(`${DIR}/${f}`)
      .resize(CELL, CELL, { fit: 'contain', background: '#1C1A18' })
      .jpeg({ quality: 82 }).toBuffer();
    composites.push({ input: buf, top: y, left: x });
    const n = s * perSheet + i + 1;
    const svg = `<svg width="${CELL}" height="${LABEL}"><rect width="100%" height="100%" fill="#1C1A18"/>
      <text x="4" y="18" font-family="monospace" font-size="15" fill="#D9C3A5">#${n}  ${w}x${h}</text></svg>`;
    composites.push({ input: Buffer.from(svg), top: y + CELL, left: x });
  }

  await sharp({ create: { width: W, height: H, channels: 3, background: '#0E0D0C' } })
    .composite(composites).jpeg({ quality: 84 }).toFile(`sheet-${s + 1}.jpg`);
  console.log(`sheet-${s + 1}.jpg — ${chunk.length} תמונות (#${s * perSheet + 1}–#${s * perSheet + chunk.length})`);
}

// index for later reference
import { writeFileSync } from 'fs';
writeFileSync('index.json', JSON.stringify(meta.map((m, i) => ({ n: i + 1, ...m })), null, 1));
