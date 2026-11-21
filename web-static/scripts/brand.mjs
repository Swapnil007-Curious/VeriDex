// Brand assets for VeriDex, all generated from the pixel grids in logo-art.mjs (no external art):
//   public/brand/logo-full.svg        the horizontal logo (shield, prompt, frame, VERIDEX, ticks)
//   public/brand/logo-mark.svg        the shield only
//   public/favicon.svg                the shield simplified for 16 px
//   public/icons/apple-touch-icon.png 180 px, public/icons/icon-192.png, public/icons/icon-512.png:
//                                     the shield on the night field, nearest-neighbour, whole-cell scales
//   public/og-image.png               1200x630: the logo on a dark field with scanlines and the
//                                     tagline in Press Start 2P (rendered through Playwright's Chromium)
//   public/brand/dex-512.png          Dex, the pixel guide (scripts/dex-png.mjs)
//   public/site.webmanifest
//   index.html                        the hero logo, inlined between the hero-logo markers with one
//                                     <g class="lr"> per row (the row-by-row build animates them)
// Run: node scripts/brand.mjs  (the outputs are committed; rerun after changing logo-art.mjs).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { dexPng } from "./dex-png.mjs";
import { COLORS, favicon, full, runs, shield, svg } from "./logo-art.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pub = join(root, "public");
const NIGHT = "#120806";

function hexRgb(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** A grid centred on a square canvas of ``cells``, scaled by whole cells (nearest-neighbour). */
async function iconPng(rows, cells, size, file) {
  const scale = size / cells;
  if (!Number.isInteger(scale)) throw new Error(`${file}: ${size} px is not a whole multiple of ${cells} cells`);
  const raw = Buffer.alloc(cells * cells * 4);
  const [br, bg, bb] = hexRgb(NIGHT);
  for (let i = 0; i < cells * cells; i++) raw.set([br, bg, bb, 255], i * 4);
  const ox = Math.floor((cells - rows[0].length) / 2);
  const oy = Math.floor((cells - rows.length) / 2);
  for (const [x, y, w, color] of runs(rows)) {
    const [r, g, b] = hexRgb(color);
    for (let i = 0; i < w; i++) raw.set([r, g, b, 255], ((oy + y) * cells + ox + x + i) * 4);
  }
  await sharp(raw, { raw: { width: cells, height: cells, channels: 4 } })
    .resize(size, size, { kernel: "nearest" })
    .png({ compressionLevel: 9 })
    .toFile(file);
}

async function ogImage(file) {
  const { chromium } = await import("playwright");
  const fontData = await readFile(join(root, "node_modules/@fontsource/press-start-2p/files/press-start-2p-latin-400-normal.woff2"));
  const font = `data:font/woff2;base64,${fontData.toString("base64")}`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @font-face { font-family: "Press Start 2P"; src: url("${font}") format("woff2"); }
    html, body { margin: 0; }
    body { width: 1200px; height: 630px; overflow: hidden; background: ${NIGHT}; position: relative;
      font-family: "Press Start 2P", monospace; -webkit-font-smoothing: none; }
    .logo { position: absolute; left: 140px; top: 150px; }
    .logo svg { width: 920px; height: 240px; display: block; }
    .tag { position: absolute; left: 0; right: 0; top: 452px; text-align: center; color: ${COLORS.c}; font-size: 24px; line-height: 40px; letter-spacing: 0; }
    .sub { position: absolute; left: 0; right: 0; top: 508px; text-align: center; color: ${COLORS.a}; font-size: 16px; line-height: 24px; }
    .scan { position: absolute; inset: 0; background: repeating-linear-gradient(to bottom, rgba(0,0,0,0) 0 2px, rgba(0,0,0,.28) 2px 4px); }
    .vignette { position: absolute; inset: 0; background: radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,.55) 100%); }
    .stars i { position: absolute; width: 4px; height: 4px; background: ${COLORS.c}; opacity: .5; }
  </style></head><body>
    <div class="stars">${[
      [60, 60], [210, 96], [388, 44], [530, 112], [720, 70], [880, 36], [1060, 88], [1140, 180], [96, 420], [1110, 470], [40, 560], [300, 588], [930, 584], [640, 600],
    ]
      .map(([x, y]) => `<i style="left:${x}px;top:${y}px"></i>`)
      .join("")}</div>
    <div class="logo">${svg(full(), { scale: 10 })}</div>
    <div class="tag">ASK ANYTHING. GET CITED ANSWERS.</div>
    <div class="sub">1 ASSISTANT - OPEN BOOKS - RETRIEVAL IN YOUR BROWSER</div>
    <div class="scan"></div><div class="vignette"></div>
  </body></html>`;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: file, type: "png" });
  } finally {
    await browser.close();
  }
}

/** Replace the hero logo between the markers in index.html. */
async function inlineHero() {
  const path = join(root, "index.html");
  const html = await readFile(path, "utf8");
  const start = "<!-- hero-logo:start -->";
  const end = "<!-- hero-logo:end -->";
  const a = html.indexOf(start);
  const b = html.indexOf(end);
  if (a < 0 || b < a) throw new Error("index.html: the hero-logo markers are missing");
  const logo = svg(full(), { scale: 4, rowGroups: true, cls: "hero-logo", title: "VeriDex" });
  await writeFile(path, `${html.slice(0, a + start.length)}\n${logo}\n${html.slice(b)}`);
}

await mkdir(join(pub, "icons"), { recursive: true });
await mkdir(join(pub, "brand"), { recursive: true });
await writeFile(join(pub, "brand", "logo-full.svg"), `${svg(full(), { scale: 4 })}\n`);
await writeFile(join(pub, "brand", "logo-mark.svg"), `${svg(shield(), { scale: 4 })}\n`);
await writeFile(join(pub, "favicon.svg"), `${svg(favicon(), { scale: 2 })}\n`);
await iconPng(shield(), 30, 180, join(pub, "icons", "apple-touch-icon.png"));
await iconPng(shield(), 32, 192, join(pub, "icons", "icon-192.png"));
await iconPng(shield(), 32, 512, join(pub, "icons", "icon-512.png"));
await ogImage(join(pub, "og-image.png"));
await dexPng(join(pub, "brand", "dex-512.png"));
await writeFile(
  join(pub, "site.webmanifest"),
  `${JSON.stringify(
    {
      name: "VeriDex",
      short_name: "VeriDex",
      description: "One assistant for a library of open books and Indian law, with cited answers.",
      start_url: "./",
      scope: "./",
      display: "standalone",
      background_color: NIGHT,
      theme_color: NIGHT,
      icons: [
        { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      ],
    },
    null,
    2,
  )}\n`,
);
await inlineHero();
console.log("brand assets written to public/ and the hero logo inlined in index.html");
