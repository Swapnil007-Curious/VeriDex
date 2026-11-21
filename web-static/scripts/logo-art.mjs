// The VeriDex logo as pixel art: every cell of every mark, redrawn on a grid from
// brand/veridex-logo-ref.png. One cell = one unit; brand.mjs turns the grids into <rect> runs
// (shape-rendering="crispEdges") and nearest-neighbour PNGs. Colours are fixed in both themes.

export const COLORS = {
  o: "#F7A531", // the angular frame and the shield outline
  k: "#1E0F0A", // the shield plate
  c: "#F6E3B4", // cream (top halves of the letters)
  a: "#F7A531", // amber
  n: "#F26A1B", // orange
  m: "#E04A1C", // orange-red
  r: "#C8321E", // red
  d: "#8E2014", // dark red
  s: "#F7A531", // the 4-point star
  g: "#3BD16F", // the prompt and the progress ticks
};

/** The striped band: top half cream, then amber, orange, orange-red, red, dark red. */
const BAND = ["c", "c", "c", "c", "c", "a", "n", "m", "r", "d"];

function grid(w, h) {
  return Array.from({ length: h }, () => Array(w).fill("."));
}

function paint(g, row, c0, c1, ch) {
  for (let c = c0; c <= c1; c++) if (g[row] && c >= 0 && c < g[row].length) g[row][c] = ch;
}

/** The shield: 24 x 22 cells. Outline, plate, star, the V with the striped band, red wings. */
export function shield() {
  const W = 24;
  const H = 22;
  const g = grid(W, H);
  // [outline cells left, outline cells right, interior from, interior to] per row
  const rows = [
    null, // row 0: the flat top edge
    [[4, 6], [17, 19], 7, 16],
    [[2, 3], [20, 21], 4, 19],
    [[1, 2], [21, 22], 3, 20],
    [[1, 1], [22, 22], 2, 21],
    ...Array.from({ length: 6 }, () => [[0, 0], [23, 23], 1, 22]), // rows 5-10: straight sides
  ];
  for (let r = 11; r <= 20; r++) {
    const i = r - 10; // 1..10: converge to the point
    rows.push([[i, i], [23 - i, 23 - i], i + 1, 22 - i]);
  }
  paint(g, 0, 6, 17, "o");
  rows.forEach((spec, r) => {
    if (!spec) return;
    const [[l0, l1], [r0, r1], i0, i1] = spec;
    paint(g, r, i0, i1, "k");
    paint(g, r, l0, l1, "o");
    paint(g, r, r0, r1, "o");
  });
  paint(g, 21, 11, 12, "o");
  // the 4-point star above the V
  for (const r of [1, 2, 6, 7]) paint(g, r, 11, 12, "s");
  paint(g, 3, 10, 13, "s");
  paint(g, 4, 8, 15, "s");
  paint(g, 5, 10, 13, "s");
  // the V: arms five cells thick stepping in one cell per row, merging at row 12
  const vColor = (r) => (r <= 11 ? "c" : ["a", "n", "m", "r", "d"][r - 12]);
  const vCells = new Set();
  for (let r = 7; r <= 16; r++) {
    const L = 2 + (r - 7);
    const spans = L + 4 < 23 - L - 4 ? [[L, L + 4], [19 - L, 23 - L]] : [[L, 23 - L]];
    for (const [a, b] of spans) {
      paint(g, r, a, b, vColor(r));
      for (let c = a; c <= b; c++) vCells.add(`${r}:${c}`);
    }
  }
  // the wings: plate cells outside the V from row 11 down, one cell clear of the V, striped
  for (let r = 11; r <= 20; r++) {
    for (let c = 0; c < W; c++) {
      if (g[r][c] !== "k") continue;
      const nearV = vCells.has(`${r}:${c - 1}`) || vCells.has(`${r}:${c + 1}`) || vCells.has(`${r - 1}:${c}`);
      const insideNotch = r <= 11 && c > 2 + (r - 7) + 4 && c < 19 - (2 + (r - 7));
      if (nearV || insideNotch) continue;
      g[r][c] = r % 2 ? "r" : "d";
    }
  }
  return g.map((row) => row.join(""));
}

const LETTERS = {
  V: ["##....##", "##....##", "##....##", "##....##", ".##..##.", ".##..##.", ".##..##.", "..####..", "..####..", "...##..."],
  E: ["######", "######", "##....", "##....", "#####.", "#####.", "##....", "##....", "######", "######"],
  R: ["######.", "#######", "##...##", "##...##", "######.", "#####..", "##.##..", "##..##.", "##...##", "##...##"],
  I: ["##", "##", "##", "##", "##", "##", "##", "##", "##", "##"],
  D: ["#####..", "######.", "##..###", "##...##", "##...##", "##...##", "##...##", "##..###", "######.", "#####.."],
  X: ["##....##", "##....##", ".##..##.", "..####..", "...##...", "...##...", "..####..", ".##..##.", "##....##", "##....##"],
};

/** The horizontal logo: shield, the green prompt, the angular frame, VERIDEX, the green ticks. 92 x 24. */
export function full() {
  const W = 92;
  const H = 24;
  const g = grid(W, H);
  shield().forEach((row, r) => {
    for (let c = 0; c < row.length; c++) if (row[c] !== ".") g[r + 2][c] = row[c];
  });
  // ">_" prompt above the frame
  [[0, 27], [1, 28], [2, 29], [3, 28], [4, 27]].forEach(([r, c]) => paint(g, r, c, c, "g"));
  paint(g, 4, 31, 34, "g");
  // the frame: a low left top edge stepping up to a high right one, cut corners
  paint(g, 6, 26, 49, "o");
  paint(g, 5, 50, 50, "o");
  paint(g, 4, 51, 51, "o");
  paint(g, 3, 52, 88, "o");
  paint(g, 4, 89, 89, "o");
  paint(g, 5, 90, 90, "o");
  for (let r = 6; r <= 19; r++) paint(g, r, 91, 91, "o");
  paint(g, 20, 90, 90, "o");
  paint(g, 21, 89, 89, "o");
  paint(g, 22, 30, 88, "o");
  for (let r = 6; r <= 18; r++) paint(g, r, 26, 26, "o");
  paint(g, 19, 27, 27, "o");
  paint(g, 20, 28, 28, "o");
  paint(g, 21, 29, 29, "o");
  // a notch in the bottom edge (the reference's raised segment)
  paint(g, 22, 52, 60, ".");
  paint(g, 21, 52, 60, "o");
  // the green progress bar (top right) and ticks (bottom right)
  paint(g, 5, 66, 80, "g");
  for (const c of [82, 84, 86]) paint(g, 5, c, c, "g");
  for (let c = 68; c <= 86; c += 2) paint(g, 20, c, c, "g");
  // VERIDEX, ten rows, the band striped by row
  let x = 31;
  for (const ch of "VERIDEX") {
    const bm = LETTERS[ch];
    bm.forEach((line, r) => {
      for (let c = 0; c < line.length; c++) if (line[c] === "#") g[9 + r][x + c] = BAND[r];
    });
    x += bm[0].length + 2;
  }
  return g.map((row) => row.join(""));
}

/** The 16 x 16 favicon: the shield outline and the V only (no star, no wings detail). */
export function favicon() {
  const g = grid(16, 16);
  paint(g, 0, 2, 13, "o");
  const spec = [
    [1, [1, 1], [14, 14], 2, 13],
    [2, [0, 0], [15, 15], 1, 14],
    [3, [0, 0], [15, 15], 1, 14],
    [4, [0, 0], [15, 15], 1, 14],
    [5, [0, 0], [15, 15], 1, 14],
    [6, [0, 0], [15, 15], 1, 14],
    [7, [0, 0], [15, 15], 1, 14],
    [8, [1, 1], [14, 14], 2, 13],
    [9, [2, 2], [13, 13], 3, 12],
    [10, [3, 3], [12, 12], 4, 11],
    [11, [4, 4], [11, 11], 5, 10],
    [12, [5, 5], [10, 10], 6, 9],
    [13, [6, 6], [9, 9], 7, 8],
  ];
  for (const [r, [l0, l1], [r0, r1], i0, i1] of spec) {
    paint(g, r, i0, i1, "k");
    paint(g, r, l0, l1, "o");
    paint(g, r, r0, r1, "o");
  }
  paint(g, 14, 7, 8, "o");
  const band = { 3: "c", 4: "c", 5: "c", 6: "a", 7: "n", 8: "r", 9: "d" };
  for (let r = 3; r <= 9; r++) {
    const L = 1 + (r - 3);
    const spans = L + 2 < 15 - L - 2 ? [[L, L + 2], [13 - L, 15 - L]] : [[L, 15 - L]];
    for (const [a, b] of spans) paint(g, r, Math.max(1, a), Math.min(14, b), band[r]);
  }
  return g.map((row) => row.join(""));
}

/** Merge each row into runs of one colour: [x, y, width, colour]. */
export function runs(rows) {
  const out = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      let w = 1;
      while (x + w < row.length && row[x + w] === ch) w++;
      if (ch !== ".") out.push([x, y, w, COLORS[ch] ?? "#ff00ff"]);
      x += w;
    }
  });
  return out;
}

/** An SVG of a grid at ``scale`` px per cell; ``rowGroups`` wraps each row in <g class="lr"> (the hero build). */
export function svg(rows, { scale = 4, title = "VeriDex", rowGroups = false, cls = "", plate = null } = {}) {
  const w = rows[0].length;
  const h = rows.length;
  const parts = [];
  if (plate) parts.push(`<rect width="${w}" height="${h}" fill="${plate}"/>`);
  if (rowGroups) {
    const byRow = new Map();
    for (const [x, y, rw, c] of runs(rows)) {
      if (!byRow.has(y)) byRow.set(y, []);
      byRow.get(y).push(`<rect x="${x}" y="${y}" width="${rw}" height="1" fill="${c}"/>`);
    }
    for (const [, rects] of [...byRow.entries()].sort((a, b) => a[0] - b[0])) parts.push(`<g class="lr">${rects.join("")}</g>`);
  } else {
    for (const [x, y, rw, c] of runs(rows)) parts.push(`<rect x="${x}" y="${y}" width="${rw}" height="1" fill="${c}"/>`);
  }
  const clsAttr = cls ? ` class="${cls}"` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg"${clsAttr} viewBox="0 0 ${w} ${h}" width="${w * scale}" height="${h * scale}" shape-rendering="crispEdges" role="img" aria-label="${title}"><title>${title}</title>${parts.join("")}</svg>`;
}
