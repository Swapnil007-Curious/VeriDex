import type { Page, Route } from "@playwright/test";

export const PROXY = "https://proxy.test.invalid";

/** A streamed chat completion in the provider's SSE format, as the proxy passes it through. */
export function sse(text: string, pieces = 6): string {
  const words = text.match(/\S+\s*/g) ?? [text];
  const size = Math.max(1, Math.ceil(words.length / pieces));
  let out = "";
  for (let i = 0; i < words.length; i += size) {
    const delta = words.slice(i, i + size).join("");
    out += `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: delta }, finish_reason: null }] })}\n\n`;
  }
  out += `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`;
  return `${out}data: [DONE]\n\n`;
}

export interface ProxyCall {
  mode: string;
  body: Record<string, unknown>;
}

/** Route the proxy: ``reply(body)`` returns the text to stream (or a Response-like object). */
export async function mockProxy(
  page: Page,
  reply: (body: Record<string, unknown>) => string | { status: number; json: Record<string, unknown> } | Promise<string>,
): Promise<ProxyCall[]> {
  const calls: ProxyCall[] = [];
  await page.route(`${PROXY}/**`, async (route: Route) => {
    const req = route.request();
    const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    const body = JSON.parse(req.postData() ?? "{}") as Record<string, unknown>;
    calls.push({ mode: String(body.mode), body });
    const r = await reply(body);
    if (typeof r === "string") return route.fulfill({ status: 200, headers: { ...headers, "content-type": "text/event-stream" }, body: sse(r) });
    return route.fulfill({ status: r.status, headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(r.json) });
  });
  return calls;
}

export async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => document.documentElement.dataset.ready === "true", undefined, { timeout: 120_000 });
}

export async function ask(page: Page, text: string): Promise<void> {
  await page.fill("#composer-input", text);
  await page.press("#composer-input", "Enter");
}

/** A minimal valid PDF (Helvetica text, one line per entry, one page per list). */
export function makePdf(pages: string[][]): Buffer {
  const objects: string[] = [];
  const add = (s: string): number => objects.push(s);
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add(""); // pages, filled below
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const kids: number[] = [];
  for (const lines of pages) {
    const ops = lines.map((l, i) => `BT /F1 ${i === 0 ? 14 : 11} Tf 72 ${760 - i * 22} Td (${l.replace(/[()\\]/g, (c) => `\\${c}`)}) Tj ET`).join("\n");
    const content = add(`<< /Length ${ops.length} >>\nstream\n${ops}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

export interface SpeechMock {
  /** recognizer starts, utterances spoken (texts), cancels */
  started: number;
  spoken: string[];
  cancels: number;
}

/**
 * Fake Web Speech APIs and microphone, installed before the page's scripts: the page sees a
 * recognizer (driven by window.__speech.say(final, interim)) and a speech synthesizer that
 * records each utterance (window.__speech.next() ends the current one; with auto, each ends by
 * itself). getUserMedia is refused, so the meter shows its stand-in. input/output false remove an
 * API, like a browser without it.
 */
export async function mockSpeech(page: Page, opts: { input?: boolean; output?: boolean; auto?: boolean } = {}): Promise<void> {
  await page.addInitScript(
    ({ input, output, auto }) => {
      type Handler = ((e?: unknown) => void) | null;
      interface Rec {
        onresult: Handler;
        onerror: Handler;
        onend: Handler;
      }
      interface Utt {
        text: string;
        onstart: Handler;
        onend: Handler;
        onerror: Handler;
        onboundary: Handler;
      }
      const w = window as unknown as Record<string, unknown>;
      const finals: string[] = [];
      let rec: Rec | null = null;
      let current: Utt | null = null;
      const state = { started: 0, spoken: [] as string[], cancels: 0 };
      const speech = {
        state,
        say(final: string, interim = "") {
          if (!rec) return;
          const resultIndex = finals.length;
          if (final) finals.push(final);
          const results: unknown[] = finals.map((t) => Object.assign([{ transcript: t }], { isFinal: true }));
          if (interim) results.push(Object.assign([{ transcript: interim }], { isFinal: false }));
          rec.onresult?.({ resultIndex, results });
        },
        error(code: string) {
          rec?.onerror?.({ error: code });
        },
        next() {
          const u = current;
          current = null;
          u?.onend?.();
        },
      };
      w.__speech = speech;
      const off = (name: string): void => {
        Object.defineProperty(window, name, { value: undefined, configurable: true, writable: true });
      };
      if (input) {
        class FakeRecognition {
          lang = "";
          interimResults = false;
          continuous = false;
          maxAlternatives = 1;
          onresult: Handler = null;
          onerror: Handler = null;
          onend: Handler = null;
          start(): void {
            rec = this;
            finals.length = 0;
            state.started += 1;
          }
          stop(): void {
            setTimeout(() => this.onend?.(), 0);
          }
          abort(): void {}
        }
        w.SpeechRecognition = FakeRecognition;
        w.webkitSpeechRecognition = FakeRecognition;
      } else {
        off("SpeechRecognition");
        off("webkitSpeechRecognition");
      }
      if (output) {
        const synth = {
          getVoices: () => [{ name: "Google UK English Female", lang: "en-GB", voiceURI: "test-en-gb", default: false, localService: false }],
          speak(u: Utt) {
            state.spoken.push(u.text);
            current = u;
            setTimeout(() => {
              u.onstart?.();
              u.onboundary?.({ name: "word", charIndex: 0 });
              if (auto) setTimeout(() => speech.next(), 30);
            }, 10);
          },
          cancel() {
            state.cancels += 1;
            current = null;
          },
          addEventListener() {},
        };
        Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
        w.SpeechSynthesisUtterance = class {
          constructor(public text: string) {}
        };
      } else {
        off("speechSynthesis");
        off("SpeechSynthesisUtterance");
      }
      if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("No microphone in tests", "NotFoundError"));
    },
    { input: opts.input ?? true, output: opts.output ?? true, auto: opts.auto ?? false },
  );
}

export async function speechState(page: Page): Promise<SpeechMock> {
  return page.evaluate(() => (window as unknown as { __speech: { state: SpeechMock } }).__speech.state);
}
