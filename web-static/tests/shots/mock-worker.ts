// A local stand-in for the Cloudflare Worker, used only by the screenshot run: it streams
// Server-Sent Events with real pauses (so a mid-answer state can be photographed) and answers the
// synthesizer, critic and rate-limit cases. A chat reply with passages quotes the first sentences
// of C1 and C2 and cites them (so the guards can really pass); without passages it writes a
// general-knowledge answer. Nothing here contacts the real proxy.

import { createServer, type Server } from "node:http";

export type MockMode = "answer" | "rate" | "stall" | "wait";

export interface MockWorker {
  server: Server;
  url: string;
  setMode(mode: MockMode): void;
  close(): Promise<void>;
}

const GENERAL =
  "Here is a short poem about the sea at night.\n\n" +
  "The tide comes in on silver feet,\nthe harbour lamps go dim;\nthe dark water hums a slow, low beat\nand the stars lean down to swim.\n\n" +
  "**Why it works:** short lines and a steady rhythm echo the waves, and the last image ties the sky to the sea.";

function firstSentence(text: string): string {
  const s = text.replace(/\s+/g, " ").trim();
  const m = /^(.{40,220}?[.!?])(\s|$)/.exec(s);
  return (m?.[1] ?? s.slice(0, 180)).replace(/\[|\]/g, "");
}

function sseChunk(text: string): string {
  return `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\n\n`;
}

export function startMockWorker(port: number): Promise<MockWorker> {
  let mode: MockMode = "answer";
  const server = createServer((req, res) => {
    const cors = { "access-control-allow-origin": req.headers.origin ?? "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "POST, OPTIONS" };
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      res.end();
      return;
    }
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c.toString()));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}") as { mode?: string; passages?: { label: string; text: string }[] };
      if (mode === "rate") {
        res.writeHead(429, { ...cors, "content-type": "application/json" });
        res.end(JSON.stringify({ error: "rate_limited", message: "Too many.", retry_after: 342 }));
        return;
      }
      res.writeHead(200, { ...cors, "content-type": "text/event-stream", "cache-control": "no-store" });
      const finish = (): void => {
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      };
      if (body.mode === "critic") {
        res.write(sseChunk(JSON.stringify({ verdict: "accept", unsupported_sentences: [], feedback: "" })));
        finish();
        return;
      }
      const passages = body.passages ?? [];
      if (body.mode === "synth") {
        const p = passages[0];
        res.write(sseChunk(JSON.stringify(p ? { abstain: false, answer: `${firstSentence(p.text)} [C1]`, citations: ["C1"] } : { abstain: true, answer: "", citations: [] })));
        finish();
        return;
      }
      const text = passages.length
        ? passages
            .slice(0, 2)
            .map((p) => `${firstSentence(p.text)} [${p.label}]`)
            .join(" ")
        : GENERAL;
      const words = text.split(/(?<=\s)/);
      let i = 0;
      // in "wait" mode the first words arrive after 6 s, so the search-and-draft state can be photographed
      const first = mode === "wait" ? 6000 : 0;
      const step = (): void => {
        if (i >= words.length) return finish();
        const n = Math.min(words.length - i, 2 + Math.floor(Math.random() * 3));
        res.write(sseChunk(words.slice(i, i + n).join("")));
        i += n;
        // in "stall" mode the stream pauses after the first words so the caret is visible
        setTimeout(step, mode === "stall" && i >= 12 && i < 16 ? 8000 : 50);
      };
      setTimeout(step, first);
    });
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      resolve({
        server,
        url: `http://localhost:${port}`,
        setMode: (m) => {
          mode = m;
        },
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}
