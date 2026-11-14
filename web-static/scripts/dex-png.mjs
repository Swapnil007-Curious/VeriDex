// Dex as a 512 px PNG for docs and social posts: the 32 x 32 greeting frame from src/dex/frames.ts
// on a transparent field, scaled 16x nearest-neighbour so every sprite pixel stays square.
// Run: node scripts/dex-png.mjs (scripts/brand.mjs runs it too). Writes public/brand/dex-512.png.

import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { composeFrame, DEX_COLORS, stateFrames } from "../src/dex/frames.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function dexPng(file = join(root, "public", "brand", "dex-512.png"), size = 512) {
  const rows = composeFrame(stateFrames("greeting", { sparkles: false }).frames[0]);
  const cells = rows.length;
  if (!Number.isInteger(size / cells)) throw new Error(`${size} px is not a whole multiple of ${cells} cells`);
  const raw = Buffer.alloc(cells * cells * 4); // transparent
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const hex = DEX_COLORS[row[x]];
      if (!hex) continue;
      const n = Number.parseInt(hex.slice(1), 16);
      raw.set([(n >> 16) & 255, (n >> 8) & 255, n & 255, 255], (y * cells + x) * 4);
    }
  });
  await mkdir(dirname(file), { recursive: true });
  await sharp(raw, { raw: { width: cells, height: cells, channels: 4 } })
    .resize(size, size, { kernel: "nearest" })
    .png({ compressionLevel: 9 })
    .toFile(file);
  return file;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`wrote ${await dexPng()}`);
}
