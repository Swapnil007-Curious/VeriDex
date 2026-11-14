// Splits each collection's passages.json into shards of SHARD_ROWS passages under
// public/data/<collection>/text/<n>.json, so the app can fetch the text of a hit without
// downloading the whole collection (the embeddings load at startup; the text is fetched per hit).
// The committed passages.json is the source: it is checked against the manifest's SHA-256 first.
// A stamp per collection skips the work when nothing changed. Run by prepare-assets.mjs.

import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SHARD_ROWS = 32; // keep in step with src/library.ts

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const data = join(root, "public", "data");

export async function shardLibrary() {
  const manifest = JSON.parse(await readFile(join(data, "manifest.json"), "utf8"));
  let written = 0;
  for (const c of manifest.collections) {
    const src = join(data, c.files.passages.path);
    const raw = await readFile(src);
    const sha = createHash("sha256").update(raw).digest("hex");
    if (sha !== c.files.passages.sha256) throw new Error(`${c.files.passages.path}: SHA-256 does not match the manifest`);
    const dir = join(data, c.id, "text");
    const stampPath = join(dir, "stamp.json");
    const stamp = { sha256: sha, shard_rows: SHARD_ROWS, count: c.count };
    try {
      const old = JSON.parse(await readFile(stampPath, "utf8"));
      if (old.sha256 === stamp.sha256 && old.shard_rows === stamp.shard_rows && old.count === stamp.count) continue;
    } catch {
      /* no stamp yet */
    }
    const { rows } = JSON.parse(raw.toString("utf8"));
    if (rows.length !== c.count) throw new Error(`${c.id}: ${rows.length} rows but the manifest says ${c.count}`);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    for (let i = 0, n = 0; i < rows.length; i += SHARD_ROWS, n++) {
      await writeFile(join(dir, `${n}.json`), JSON.stringify({ rows: rows.slice(i, i + SHARD_ROWS) }));
      written++;
    }
    await writeFile(stampPath, JSON.stringify(stamp));
  }
  return written;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const n = await shardLibrary();
  console.log(n ? `library text shards written: ${n}` : "library text shards up to date");
}
