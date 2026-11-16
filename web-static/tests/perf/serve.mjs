// Minimal static server for the latency measurements: serves dist-perf/ under /agentic-rag/ like
// GitHub Pages (no compression). `vite preview` cannot be used here because the Cloudflare plugin
// refuses assets over 25 MiB (the 64 MB ONNX model).
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(process.argv[2] ?? "dist-perf");
const port = Number(process.argv[3] ?? 4175);
const base = "/agentic-rag/";
const types = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm", ".svg": "image/svg+xml",
  ".png": "image/png", ".woff2": "font/woff2", ".bin": "application/octet-stream",
  ".onnx": "application/octet-stream", ".webmanifest": "application/manifest+json", ".txt": "text/plain",
};

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (!url.pathname.startsWith(base)) {
    res.writeHead(302, { location: base }).end();
    return;
  }
  let rel = decodeURIComponent(url.pathname.slice(base.length)) || "index.html";
  if (rel.endsWith("/")) rel += "index.html";
  const file = normalize(join(root, rel));
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const st = statSync(file);
    if (!st.isFile()) throw new Error("not a file");
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream", "content-length": st.size });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404).end();
  }
}).listen(port, () => console.log(`serving ${root} at http://localhost:${port}${base}`));
