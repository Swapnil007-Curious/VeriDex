// Text for speech: an answer's Markdown turned into plain sentences a speech voice can read.
// Citation markers go, code blocks and tables are announced instead of read, symbols are spoken as
// words, URLs are skipped. Long sentences are split so the browser never drops a long utterance.

const SYMBOLS: [RegExp, string][] = [
  [/\s*(?:→|⟶|->)\s*/g, " to "],
  [/\s*(?:←|<-)\s*/g, " from "],
  [/\s*(?:⇒|=>)\s*/g, " implies "],
  [/\s*≈\s*/g, " about "],
  [/\s*≥\s*/g, " at least "],
  [/\s*≤\s*/g, " at most "],
  [/\s*≠\s*/g, " is not equal to "],
  [/\s*×\s*/g, " times "],
  [/\s*÷\s*/g, " divided by "],
  [/\s*±\s*/g, " plus or minus "],
  [/∞/g, " infinity "],
  [/°/g, " degrees"],
  [/\s&\s/g, " and "],
  [/…/g, "."],
];

/** Plain text of an answer for speaking (one paragraph per line). */
export function cleanForSpeech(md: string): string {
  const out: string[] = [];
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const fence = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence?.[1]) {
      const mark = fence[1];
      while (i + 1 < lines.length && !(lines[i + 1] ?? "").trim().startsWith(mark[0]?.repeat(3) ?? "```")) i++;
      i++; // the closing fence
      out.push("A code block is shown on screen.");
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      let rows = 0;
      let j = i;
      while (j < lines.length && /^\s*\|.*\|\s*$/.test(lines[j] ?? "")) {
        if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[j] ?? "")) rows++;
        j++;
      }
      const body = Math.max(0, rows - 1); // the header row is not counted
      out.push(`A table with ${body} ${body === 1 ? "row" : "rows"} is shown on screen.`);
      i = j - 1;
      continue;
    }
    if (/^\s*\$\$/.test(line)) {
      // "$$ x $$" on one line, or "$$" opening a block that a later line closes
      if (!line.trim().slice(2).endsWith("$$")) {
        while (i + 1 < lines.length && !(lines[i + 1] ?? "").trim().endsWith("$$")) i++;
        i++;
      }
      out.push("A formula is shown on screen.");
      continue;
    }
    let t = line
      .replace(/^\s{0,3}#{1,6}\s+(.*)$/, "$1.")
      .replace(/^\s*>\s?/, "")
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\((?:[^)]*)\)/g, "$1")
      .replace(/\s*\[(?:C\d{1,3}(?:\s*[,;]\s*C\d{1,3})*)\]/g, "")
      .replace(/https?:\/\/\S+|www\.\S+/g, "")
      .replace(/\$([^$\n]+)\$/g, (_m, tex: string) => tex.replace(/\\[a-zA-Z]+/g, " ").replace(/[{}^_\\]/g, " "))
      .replace(/(\*\*|__)(.+?)\1/g, "$2")
      .replace(/(\*|_)(\S(?:.*?\S)?)\1/g, "$2")
      .replace(/`([^`]+)`/g, "$1");
    for (const [re, word] of SYMBOLS) t = t.replace(re, word);
    t = t.replace(/\s+/g, " ").trim();
    if (!t) continue;
    if (!/[.!?:;]$/.test(t)) t = `${t.replace(/,$/, "")}.`;
    out.push(t);
  }
  return out.join("\n");
}

/** The answer as a queue of sentences, none longer than ``max`` characters. */
export function speechSentences(md: string, max = 220): string[] {
  const sentences: string[] = [];
  for (const para of cleanForSpeech(md).split("\n")) {
    for (const s of para.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) ?? []) {
      let rest = s.trim();
      while (rest.length > max) {
        const cut = Math.max(rest.lastIndexOf(", ", max), rest.lastIndexOf("; ", max), rest.lastIndexOf(" ", max));
        const at = cut > max / 3 ? cut + 1 : max;
        sentences.push(rest.slice(0, at).trim());
        rest = rest.slice(at).trim();
      }
      if (rest) sentences.push(rest);
    }
  }
  return sentences;
}
