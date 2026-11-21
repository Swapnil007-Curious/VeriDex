// WCAG 2.2 contrast of the VeriDex tokens (DESIGN.md lists the output). Text pairs must reach 4.5:1
// (AA); boundaries of controls and graphics 3:1. Every text pair is also checked under the CRT layer
// at its worst point: scanline plus vignette darkening the lighter side of the pair (the text in
// Night, the paper in Day). Exit code 1 when a pair fails. Run: node scripts/contrast.mjs

const THEMES = {
  night: {
    bg: "#120806", panel: "#1E0F0A", panel2: "#2A1610", line: "#4A2A1C", edge: "#8A6248",
    cream: "#F6E3B4", dim: "#B39678", amber: "#F7A531", orange: "#F47A30", orangeFill: "#F26A1B", amberFill: "#F7A531",
    red: "#C8321E", redText: "#FF6B57", green: "#3BD16F", ink: "#120806", xp: "#F7A531", xpEmpty: "#2A1610", codeBg: "#0C0503", code: "#F6E3B4",
    crt: { color: "#000000", alpha: 1 - (1 - 0.06) * (1 - 0.06) }, // 6 % scanline, 6 % vignette at the corners
  },
  day: {
    bg: "#F6E3B4", panel: "#FFF4D6", panel2: "#EBD3A0", line: "#7A4A2C", edge: "#7A4A2C",
    cream: "#1E0F0A", dim: "#5F412C", amber: "#7A4A00", orange: "#A33A06", orangeFill: "#F26A1B", amberFill: "#F7A531",
    red: "#9A2016", redText: "#9A2016", green: "#155A2B", ink: "#1E0F0A", xp: "#C4560F", xpEmpty: "#EBD3A0", codeBg: "#1E0F0A", code: "#F6E3B4",
    crt: { color: "#1E0F0A", alpha: 1 - (1 - 0.05) * (1 - 0.05) },
  },
};

function rgb(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function hex([r, g, b]) {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}
function lum(h) {
  const c = rgb(h).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function ratio(a, b) {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
function blend(base, over, alpha) {
  const a = rgb(base);
  const o = rgb(over);
  return hex(a.map((v, i) => v * (1 - alpha) + (o[i] ?? 0) * alpha));
}
/** The pair under the CRT layer, darkening the lighter colour (the worst case). */
function underCrt(fg, bg, crt) {
  return lum(fg) > lum(bg) ? ratio(blend(fg, crt.color, crt.alpha), bg) : ratio(fg, blend(bg, crt.color, crt.alpha));
}

const TEXT = [
  ["cream", "bg", "body text"],
  ["cream", "panel", "answer text in the dialogue box"],
  ["cream", "panel2", "user bubble, notices, inputs"],
  ["dim", "bg", "secondary text on the field"],
  ["dim", "panel", "secondary text on panels (hints, result line)"],
  ["dim", "panel2", "placeholder in the composer"],
  ["amber", "bg", "PRESS ENTER, quest titles"],
  ["amber", "panel", "panel titles, dialogue name"],
  ["orange", "panel", "streak count, accent text"],
  ["redText", "bg", "errors, NO EVIDENCE"],
  ["redText", "panel", "error card text, NO EVIDENCE badge"],
  ["green", "bg", "trace timings, VERIFIED"],
  ["green", "panel", "GROUNDED badge, VERIFIED stamp, SUPPORTED"],
  ["green", "panel2", "verify button on a raised panel"],
  ["ink", "orangeFill", "text on the primary (orange) button"],
  ["ink", "amberFill", "text on amber chips and badges (C1, LV)"],
  ["code", "codeBg", "code blocks"],
];
const MARKS = [
  ["edge", "bg", "control boundaries on the field"],
  ["edge", "panel", "control boundaries on panels"],
  ["amber", "bg", "focus ring on the field"],
  ["amber", "panel", "focus ring on panels"],
  ["red", "panel", "abstain and error frames"],
  ["xp", "xpEmpty", "XP blocks filled vs empty"],
  ["xp", "panel", "XP blocks on the player card"],
];
// the level-up banner keeps its night colours in both themes
const FIXED = [
  ["#F7A531", "#120806", "level-up title"],
  ["#F6E3B4", "#120806", "level-up line"],
  ["#B39678", "#120806", "level-up hint"],
];

let failed = false;
const rows = [];
for (const [theme, t] of Object.entries(THEMES)) {
  for (const [fg, bg, use] of TEXT) {
    const r = ratio(t[fg], t[bg]);
    const c = underCrt(t[fg], t[bg], t.crt);
    const ok = r >= 4.5 && c >= 4.5;
    failed ||= !ok;
    rows.push(`| ${theme} | ${use} | \`${t[fg]}\` on \`${t[bg]}\` | ${r.toFixed(2)} | ${c.toFixed(2)} | 4.5 | ${ok ? "pass" : "FAIL"} |`);
  }
  for (const [fg, bg, use] of MARKS) {
    const r = ratio(t[fg], t[bg]);
    const ok = r >= 3;
    failed ||= !ok;
    rows.push(`| ${theme} | ${use} | \`${t[fg]}\` vs \`${t[bg]}\` | ${r.toFixed(2)} | n/a | 3.0 | ${ok ? "pass" : "FAIL"} |`);
  }
}
for (const [fg, bg, use] of FIXED) {
  const r = ratio(fg, bg);
  const c = underCrt(fg, bg, THEMES.night.crt);
  const ok = r >= 4.5 && c >= 4.5;
  failed ||= !ok;
  rows.push(`| both | ${use} | \`${fg}\` on \`${bg}\` | ${r.toFixed(2)} | ${c.toFixed(2)} | 4.5 | ${ok ? "pass" : "FAIL"} |`);
}
console.log("| theme | pair | colours | ratio | under CRT (worst) | needed | result |\n|---|---|---|---|---|---|---|");
console.log(rows.join("\n"));
process.exit(failed ? 1 : 0);
