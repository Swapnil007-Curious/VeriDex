// Dex, VeriDex's pixel robot guide (an original design): ASCII pixel maps on a 32 x 32 grid, one
// character per colour, seven colours from the VeriDex tokens. The body is one map; the face on
// the visor, the floating hands, the antenna tip, the thruster flame and the extras ("?", "z",
// sparkles) are small maps layered on it, so each state's 2-4 frames are compositions, not copies.

export const DEX_COLORS: Record<string, string> = {
  k: "#120806", // outline and visor
  c: "#F6E3B4", // cream body
  a: "#F7A531", // amber shading
  o: "#F26A1B", // orange accents: antenna tip, bolts, chest light, flame
  g: "#3BD16F", // the green face and the listening glow
  d: "#8A6248", // dim: trails, sleep, "z"
  r: "#C8321E", // red X eyes (error)
};

/** The body: capsule head with a dark visor and side bolts, a tapered body with a chest light, the nozzle. */
const BODY = [
  "................................",
  "................................",
  "................................",
  "...............dd...............",
  "...............dd...............",
  ".........kkkkkkkkkkkkkk.........",
  "........kcccccccccccccck........",
  ".......kcccccccccccccccck.......",
  ".......kcckkkkkkkkkkkkcak.......",
  "......kkckkkkkkkkkkkkkkakk......",
  ".....kokckkkkkkkkkkkkkkakok.....",
  ".....kokckkkkkkkkkkkkkkakok.....",
  "......kkckkkkkkkkkkkkkkakk......",
  ".......kcckkkkkkkkkkkkcak.......",
  ".......kcccccccccccccccak.......",
  "........kaaaaaaaaaaaaaak........",
  ".........kkkkkkkkkkkkkk.........",
  "..........kcccccccccak..........",
  "..........kcccccccccak..........",
  "..........kccccoocccak..........",
  "...........kcccooccak...........",
  "...........kcccccccak...........",
  "............kcccccak............",
  "............kcccaaak............",
  ".............kaaaak.............",
  ".............kkkkkk.............",
  "..............kkkk..............",
  "................................",
  "................................",
  "................................",
  "................................",
  "................................",
];

/** Faces on the visor: 14 x 6 at column 9, row 8 ("." keeps the dark visor). */
export const FACES: Record<string, string[]> = {
  neutral: ["..............", "..gg......gg..", "..gg......gg..", "..............", ".....gggg.....", ".............."],
  blink: ["..............", "..............", "..gg......gg..", "..............", ".....gggg.....", ".............."],
  wide: ["..............", "..ggg....ggg..", "..ggg....ggg..", "..ggg....ggg..", "......gg......", ".............."],
  happy: ["..............", "...g......g...", "..g.g....g.g..", "..............", ".....g..g.....", "......gg......"],
  error: ["..............", "..r.r....r.r..", "...r......r...", "..r.r....r.r..", "......dd......", ".............."],
  sleep: ["..............", "..............", "..ddd....ddd..", "..............", "......dd......", ".............."],
  confused: ["..............", "..gg..........", "..gg.....ggg..", ".......gg.....", ".....gg.......", ".............."],
  scan0: ["..............", "..............", ".gg...........", ".gg...........", "..............", ".............."],
  scan1: ["..............", "..............", "..d.gg........", "..d.gg........", "..............", ".............."],
  scan2: ["..............", "..............", ".....d.gg.....", ".....d.gg.....", "..............", ".............."],
  scan3: ["..............", "..............", "........d.gg..", "........d.gg..", "..............", ".............."],
  talk0: ["..............", "..gg......gg..", "..gg......gg..", "..............", ".....gggg.....", ".............."],
  talk1: ["..............", "..gg......gg..", "..gg......gg..", "......gg......", "......gg......", ".............."],
  talk2: ["..............", "..gg......gg..", "..gg......gg..", ".....gggg.....", ".....g..g.....", ".....gggg....."],
};

/** A floating hand. */
const HAND = [".kk.", "kcck", "kcak", ".kk."];

/** Where the hands float: [left x, y], [right x, y]. */
export const HAND_POSES: Record<string, [[number, number], [number, number]]> = {
  rest: [[3, 18], [25, 18]],
  wave1: [[3, 18], [26, 3]],
  wave2: [[3, 18], [27, 5]],
  ears: [[1, 8], [27, 8]],
  up: [[2, 1], [26, 1]],
};

/** The antenna tip (with its outline), at column 13, row 0. */
const ANTENNA: Record<string, string[]> = {
  normal: ["..kk..", ".kook.", ".kook."],
  listen: ["..kk..", ".kggk.", ".kggk."],
  glow: [".gkkg.", "gkggkg", "gkggkg"],
  sleep: ["..kk..", ".kddk.", ".kddk."],
};

/** The thruster flame under the nozzle, at column 14, row 27: three frames that flicker. */
const FLAMES = [
  ["oooo", ".aa.", "...."],
  ["aaaa", "oooo", ".aa."],
  ["oaao", "aooa", ".oo.", "..a."],
];

/** Extras: [map, x, y]. */
const EXTRAS: Record<string, [string[], number, number][]> = {
  question: [[[".aaa.", "a...a", "...aa", "..a..", ".....", "..a.."], 26, 0]],
  z1: [[["ddddd", "...d.", "..d..", ".d...", "ddddd"], 20, 0]],
  z2: [[["dddd", "..d.", ".d..", "dddd"], 27, 0]],
  sparkleA: [[[".a.", "aca", ".a."], 0, 12], [[".a.", "aca", ".a."], 29, 14], [[".a.", "aca", ".a."], 5, 27], [[".a.", "aca", ".a."], 24, 26]],
  sparkleB: [[[".c.", "cac", ".c."], 2, 9], [[".c.", "cac", ".c."], 28, 10], [[".c.", "cac", ".c."], 8, 29], [[".c.", "cac", ".c."], 21, 29]],
};

export interface FrameSpec {
  face: keyof typeof FACES;
  hands: keyof typeof HAND_POSES;
  antenna: keyof typeof ANTENNA;
  flame: 0 | 1 | 2;
  extras?: (keyof typeof EXTRAS)[];
  droop?: boolean; // the whole robot sinks two pixels (error)
}

function stamp(grid: string[][], map: readonly string[], x: number, y: number): void {
  map.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) {
      const ch = row[dx];
      const gy = y + dy;
      const gx = x + dx;
      if (ch && ch !== "." && grid[gy] && gx >= 0 && gx < 32) grid[gy][gx] = ch;
    }
  });
}

/** One frame: the layers stamped onto the body; 32 strings of 32 characters. */
export function composeFrame(spec: FrameSpec): string[] {
  const grid = BODY.map((row) => row.split(""));
  stamp(grid, ANTENNA[spec.antenna] ?? ANTENNA.normal ?? [], 13, 0);
  stamp(grid, FACES[spec.face] ?? FACES.neutral ?? [], 9, 8);
  const [[lx, ly], [rx, ry]] = HAND_POSES[spec.hands] ?? HAND_POSES.rest ?? [[0, 0], [0, 0]];
  stamp(grid, HAND, lx, ly);
  stamp(grid, HAND, rx, ry);
  stamp(grid, FLAMES[spec.flame] ?? [], 14, 27);
  for (const name of spec.extras ?? []) for (const [map, x, y] of EXTRAS[name] ?? []) stamp(grid, map, x, y);
  let rows = grid.map((r) => r.join(""));
  if (spec.droop) rows = [".".repeat(32), ".".repeat(32), ...rows.slice(0, 30)];
  return rows;
}

export type DexState = "idle" | "greeting" | "listening" | "thinking" | "speaking" | "happy" | "confused" | "error" | "celebrate" | "sleeping" | "carried";

/** The frames of each state and their rate (frames per second). */
export function stateFrames(state: DexState, opts: { sparkles: boolean }): { frames: FrameSpec[]; fps: number } {
  const f = (face: FrameSpec["face"], hands: FrameSpec["hands"], antenna: FrameSpec["antenna"], flame: 0 | 1 | 2, extras: FrameSpec["extras"] = [], droop = false): FrameSpec => ({ face, hands, antenna, flame, extras, droop });
  switch (state) {
    case "greeting":
      return { frames: [f("happy", "wave1", "normal", 0), f("happy", "wave2", "normal", 1)], fps: 4 };
    case "listening":
      return { frames: [f("wide", "ears", "listen", 0), f("wide", "ears", "glow", 1)], fps: 3 };
    case "thinking":
      return { frames: [f("scan0", "rest", "normal", 0), f("scan1", "rest", "normal", 1), f("scan2", "rest", "normal", 0), f("scan3", "rest", "normal", 1)], fps: 6 };
    case "speaking":
      return { frames: [f("talk0", "rest", "normal", 0), f("talk1", "rest", "normal", 1), f("talk2", "rest", "normal", 0)], fps: 8 };
    case "happy":
      return { frames: [f("happy", "rest", "normal", 0), f("happy", "rest", "normal", 1)], fps: 3 };
    case "confused":
      return { frames: [f("confused", "rest", "normal", 0, ["question"]), f("confused", "rest", "normal", 1, ["question"])], fps: 2 };
    case "error":
      return { frames: [f("error", "rest", "normal", 0, [], true)], fps: 1 };
    case "celebrate":
      return opts.sparkles
        ? { frames: [f("happy", "up", "normal", 0, ["sparkleA"]), f("happy", "up", "normal", 1, ["sparkleB"])], fps: 4 }
        : { frames: [f("happy", "up", "normal", 0)], fps: 1 };
    case "carried": // picked up: hands up, eyes wide, the thruster flickering
      return { frames: [f("wide", "up", "normal", 1), f("wide", "up", "normal", 2), f("wide", "up", "glow", 0)], fps: 8 };
    case "sleeping":
      return { frames: [f("sleep", "rest", "sleep", 0, ["z1"]), f("sleep", "rest", "sleep", 0, ["z1", "z2"])], fps: 1 };
    default:
      return { frames: [f("neutral", "rest", "normal", 0), f("neutral", "rest", "normal", 1)], fps: 3 };
  }
}

/** The blink frame of idle. */
export const BLINK: FrameSpec = { face: "blink", hands: "rest", antenna: "normal", flame: 0 };
