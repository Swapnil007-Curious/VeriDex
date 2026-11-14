// Writes deploy/worker/src/identity.ts from src/identity.ts: the identity system prompts the
// Worker puts first in every upstream call (VERIDEX_SYSTEM and its short variants), with the real
// library counts from public/data/manifest.json. The Worker never takes prompt text from the
// browser, so this file is how the identity reaches it; tests/unit/identity.test.ts fails when the
// two drift. Run after changing src/identity.ts or the library: npm run identity
// (needs Node 22.18 or later: it loads the TypeScript module directly).

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { libraryFacts, workerIdentitySource } from "../src/identity.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(join(root, "public", "data", "manifest.json"), "utf8"));
const target = join(root, "..", "deploy", "worker", "src", "identity.ts");
await writeFile(target, workerIdentitySource(libraryFacts(manifest)));
console.log("identity prompts written to deploy/worker/src/identity.ts");
