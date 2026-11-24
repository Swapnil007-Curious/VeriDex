// Puts every file the site serves itself into public/ (nothing is loaded from a CDN at run time):
//   models/bge-small-en-v1.5/  the ONNX export of BAAI/bge-small-en-v1.5 at the revision pinned in
//                               assets.lock.json, each file checked against its SHA-256
//   ort/                        ONNX Runtime Web's WASM build (from node_modules)
//   pdfjs/                      the pdf.js worker (from node_modules)
//   vendor/                     KaTeX and highlight.js, copied from the Python app's vendored files
//   fonts/                      the four latin font files (fontsource packages, from node_modules)
//   licenses/                   the licence texts of the fonts and libraries above
// It also checks that the collection data (scripts/build_static_indexes.py) is present and splits
// each collection's passages into the text shards the app fetches per hit (shard-library.mjs).

import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { shardLibrary } from "./shard-library.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pub = join(root, "public");
const lock = JSON.parse(await readFile(join(root, "assets.lock.json"), "utf8"));
const site = JSON.parse(await readFile(join(root, "site.config.json"), "utf8"));
const dtype = process.env.MODEL_DTYPE || site.modelDtype || "fp16";
const MODEL_FILE = { fp16: "onnx/model_fp16.onnx", q8: "onnx/model_quantized.onnx" }[dtype];
if (!MODEL_FILE) throw new Error(`modelDtype must be fp16 or q8, got ${dtype}`);

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function fetchModel() {
  const { repo, revision, dir, files } = lock.model;
  const wanted = Object.keys(files).filter((f) => !f.startsWith("onnx/") || f === MODEL_FILE);
  for (const file of wanted) {
    const target = join(pub, "models", dir, file);
    const expected = files[file].sha256;
    if ((await exists(target)) && (await sha256(target)) === expected) continue;
    const url = `https://huggingface.co/${repo}/resolve/${revision}/${file}`;
    process.stdout.write(`downloading ${repo}@${revision.slice(0, 8)} ${file} ... `);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const data = Buffer.from(await res.arrayBuffer());
    const got = createHash("sha256").update(data).digest("hex");
    if (got !== expected) throw new Error(`${file}: SHA-256 ${got} does not match the lock ${expected}`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
    console.log(`${(data.length / 1e6).toFixed(1)} MB, verified`);
  }
}

async function copyInto(from, to, names) {
  await mkdir(to, { recursive: true });
  for (const name of names) await copyFile(join(from, name), join(to, name));
}

async function copyTree(from, to) {
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const src = join(from, entry.name);
    const dst = join(to, entry.name);
    if (entry.isDirectory()) await copyTree(src, dst);
    else await copyFile(src, dst);
  }
}

await fetchModel();
// the plain SIMD build: CPU inference only (no WebGPU), about half the size of the asyncify build
await copyInto(join(root, "node_modules/onnxruntime-web/dist"), join(pub, "ort"), [
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.wasm",
]);
await copyInto(join(root, "node_modules/pdfjs-dist/build"), join(pub, "pdfjs"), ["pdf.worker.min.mjs"]);
// latin subsets only: Press Start 2P, Silkscreen, Pixelify Sans (variable), IBM Plex Sans (variable)
await mkdir(join(pub, "fonts"), { recursive: true });
for (const [pkg, file] of [
  ["@fontsource/press-start-2p", "press-start-2p-latin-400-normal.woff2"],
  ["@fontsource/silkscreen", "silkscreen-latin-400-normal.woff2"],
  ["@fontsource-variable/pixelify-sans", "pixelify-sans-latin-wght-normal.woff2"],
  ["@fontsource-variable/ibm-plex-sans", "ibm-plex-sans-latin-wght-normal.woff2"],
]) {
  await copyFile(join(root, "node_modules", pkg, "files", file), join(pub, "fonts", file));
}
// the licence texts of the fonts and libraries the site serves (the woff2 subsets keep only the
// copyright line, and the bundles drop their headers); THIRD_PARTY.md at the repository root lists them
const licences = join(pub, "licenses");
await mkdir(licences, { recursive: true });
for (const [src, name] of [
  ["@fontsource/press-start-2p/LICENSE", "press-start-2p-OFL.txt"],
  ["@fontsource/silkscreen/LICENSE", "silkscreen-OFL.txt"],
  ["@fontsource-variable/pixelify-sans/LICENSE", "pixelify-sans-OFL.txt"],
  ["@fontsource-variable/ibm-plex-sans/LICENSE", "ibm-plex-sans-OFL.txt"],
  ["@huggingface/transformers/LICENSE", "transformers.js-LICENSE.txt"],
  ["pdfjs-dist/LICENSE", "pdf.js-LICENSE.txt"],
  ["motion/LICENSE.md", "motion-LICENSE.txt"],
]) {
  await copyFile(join(root, "node_modules", src), join(licences, name));
}
// onnxruntime-web has no LICENSE file in its package; its sources say "Copyright (c) Microsoft
// Corporation. All rights reserved. Licensed under the MIT License."
const mitTerms = (await readFile(join(root, "..", "LICENSE"), "utf8")).split(/\r?\n/).slice(4).join("\n");
await writeFile(join(licences, "onnxruntime-web-LICENSE.txt"), `MIT License\n\nCopyright (c) Microsoft Corporation\n\n${mitTerms}`);
await writeFile(
  join(licences, "README.txt"),
  [
    "Licences of the third-party files this site serves (written by scripts/prepare-assets.mjs).",
    "Fonts: SIL Open Font License 1.1 (the *-OFL.txt files). Transformers.js and pdf.js: Apache 2.0.",
    "ONNX Runtime Web and Motion: MIT. KaTeX (MIT) and highlight.js (BSD 3-Clause): vendor/*/LICENSE.",
    "Embedding model: BAAI/bge-small-en-v1.5, MIT (as declared on https://huggingface.co/BAAI/bge-small-en-v1.5),",
    "in the ONNX conversion Xenova/bge-small-en-v1.5.",
    "Library passages (data/): each document keeps its own licence, shown in the app under About & sources.",
    "Full list: THIRD_PARTY.md in https://github.com/Swapnil007-Curious/VeriDex",
    "",
  ].join("\n"),
);
await copyTree(join(root, "../src/ragsys/app/static/vendor"), join(pub, "vendor"));
await writeFile(join(pub, "vendor", "README.txt"), "Copied from src/ragsys/app/static/vendor by scripts/prepare-assets.mjs.\n");
if (!(await exists(join(pub, "data", "manifest.json")))) {
  throw new Error("public/data/manifest.json is missing: run python scripts/build_static_indexes.py");
}
const shards = await shardLibrary();
if (shards) console.log(`library text shards written: ${shards}`);
console.log(`assets ready (model ${dtype}: ${MODEL_FILE})`);
