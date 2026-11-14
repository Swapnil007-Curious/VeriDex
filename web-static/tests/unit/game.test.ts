// The game layer: XP and level math, titles, the streak across days (and month ends), daily
// quests, achievements, awards that never repeat for one answer, and storage-blocked mode.

import { describe, expect, it } from "vitest";
import { ACHIEVEMENTS, Game, GAME_KEY, type KV } from "../../src/game/game.ts";
import { dailyQuests, QUEST_POOL, questFor } from "../../src/game/quests.ts";
import { dayKey, daysBetween, levelFor, liveStreak, nextStreak, progressOf, thresholdFor, titleFor } from "../../src/game/rules.ts";

class MemoryKV implements KV {
  data = new Map<string, string>();
  get<T>(key: string): T | null {
    const raw = this.data.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  }
  set(key: string, value: unknown): boolean {
    this.data.set(key, JSON.stringify(value));
    return true;
  }
}

/** Storage that throws on every access (private windows, blocked site data), behind the same guard as storage.ts. */
const blockedKV: KV = {
  get: () => null,
  set: () => false,
};

const at = (iso: string) => () => new Date(iso);

describe("XP and levels", () => {
  it("uses the thresholds 0, 50, 150, 300, 500, 800, 1200, then +500", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map(thresholdFor)).toEqual([0, 50, 150, 300, 500, 800, 1200, 1700, 2200]);
    expect([0, 49, 50, 149, 150, 1199, 1200, 1699, 1700, 2200].map(levelFor)).toEqual([1, 1, 2, 2, 3, 6, 7, 7, 8, 9]);
  });
  it("names the levels and caps the title at ORACLE", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 12].map(titleFor)).toEqual(["NOVICE", "APPRENTICE", "SCHOLAR", "SAGE", "ARCHIVIST", "LOREMASTER", "ORACLE", "ORACLE"]);
  });
  it("reports progress inside the level", () => {
    expect(progressOf(175)).toEqual({ xp: 175, level: 3, title: "SCHOLAR", into: 25, span: 150, next: 300 });
    expect(progressOf(-5).level).toBe(1);
  });
});

describe("streak across days", () => {
  it("adds a day, keeps the same day, restarts after a gap", () => {
    let s = nextStreak({ streak: 0, lastDay: null }, "2026-11-12");
    expect(s).toEqual({ streak: 1, lastDay: "2026-11-12" });
    s = nextStreak(s, "2026-11-12");
    expect(s.streak).toBe(1);
    s = nextStreak(s, "2026-11-13");
    s = nextStreak(s, "2026-11-14");
    expect(s.streak).toBe(3);
    expect(nextStreak(s, "2026-11-16")).toEqual({ streak: 1, lastDay: "2026-11-16" });
  });
  it("crosses month and year ends by calendar day", () => {
    expect(daysBetween("2026-02-28", "2026-03-01")).toBe(1);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
    expect(nextStreak({ streak: 4, lastDay: "2026-12-31" }, "2027-01-01").streak).toBe(5);
  });
  it("shows a lapsed streak as 0 but keeps it through the next day", () => {
    expect(liveStreak({ streak: 3, lastDay: "2026-11-13" }, "2026-11-14")).toBe(3);
    expect(liveStreak({ streak: 3, lastDay: "2026-11-12" }, "2026-11-14")).toBe(0);
    expect(dayKey(new Date(2026, 10, 4, 23, 59))).toBe("2026-11-04");
  });
});

describe("daily quests", () => {
  it("has 30 questions over all five libraries and picks three different libraries, the same all day", () => {
    expect(QUEST_POOL).toHaveLength(30);
    expect(new Set(QUEST_POOL.map((q) => q.subject)).size).toBe(5);
    const a = dailyQuests("2026-11-14");
    expect(a).toHaveLength(3);
    expect(new Set(a.map((q) => q.subject)).size).toBe(3);
    expect(dailyQuests("2026-11-14")).toEqual(a);
    const days = ["2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18"].map((d) => dailyQuests(d).map((q) => q.id).join());
    expect(new Set(days).size).toBeGreaterThan(1);
    expect(questFor(`  ${a[0]?.q.toUpperCase()} `, a)?.id).toBe(a[0]?.id);
    expect(questFor("something else", a)).toBeNull();
  });
});

describe("awards", () => {
  const base = { ok: true, asked: true, grounded: true, verified: false, libraries: ["cs_ai"], question: "q" };
  it("gives +10 per answer, +15 for grounded and verified, +5 for Verify, each once per answer", () => {
    const g = new Game(new MemoryKV(), at("2026-11-14T10:00:00"));
    expect(g.answer({ ...base, id: "m1" }).gained).toBe(10);
    expect(g.answer({ ...base, id: "m1" }).gained).toBe(0); // a re-render does not pay twice
    expect(g.verify({ id: "m1", grounded: true, allSupported: true, libraries: ["cs_ai"] }).gained).toBe(20);
    expect(g.verify({ id: "m1", grounded: true, allSupported: true, libraries: ["cs_ai"] }).gained).toBe(0);
    expect(g.answer({ ...base, id: "m2", verified: true }).gained).toBe(25);
    expect(g.state.xp).toBe(55);
  });
  it("gives nothing for errors and abstentions, but an abstention still counts for the streak", () => {
    const g = new Game(new MemoryKV(), at("2026-11-14T10:00:00"));
    expect(g.answer({ ...base, id: "e1", ok: false, asked: false }).gained).toBe(0);
    expect(g.streak()).toBe(0);
    expect(g.answer({ ...base, id: "a1", ok: false, asked: true }).gained).toBe(0);
    expect(g.streak()).toBe(1);
    expect(g.state.xp).toBe(0);
  });
  it("pays +20 for a daily quest once, and Quest champion after all three", () => {
    const g = new Game(new MemoryKV(), at("2026-11-14T10:00:00"));
    const quests = g.quests().map((x) => x.quest);
    const e1 = g.answer({ ...base, id: "q1", question: quests[0]?.q ?? "" });
    expect(e1.gained).toBe(30);
    expect(e1.quest?.id).toBe(quests[0]?.id);
    expect(g.answer({ ...base, id: "q1b", question: quests[0]?.q ?? "" }).gained).toBe(10);
    g.answer({ ...base, id: "q2", question: quests[1]?.q ?? "" });
    const e3 = g.answer({ ...base, id: "q3", question: quests[2]?.q ?? "" });
    expect(e3.unlocked.map((a) => a.id)).toContain("quest_champion");
    expect(g.quests().every((x) => x.done)).toBe(true);
  });
  it("levels up at 50 XP and unlocks achievements as counts reach their goals", () => {
    const g = new Game(new MemoryKV(), at("2026-11-14T10:00:00"));
    const first = g.answer({ ...base, id: "a" });
    expect(first.unlocked.map((a) => a.id)).toEqual(["first_question"]);
    let levelUp = null;
    for (let i = 0; i < 4; i++) levelUp = g.answer({ ...base, id: `b${i}` }).levelUp ?? levelUp;
    expect(levelUp).toMatchObject({ level: 2, title: "APPRENTICE" });
    for (const lib of ["indian_law", "human_biology", "physics_chemistry"]) g.answer({ ...base, id: lib, libraries: [lib] });
    expect(g.state.unlocked.polymath).toBeDefined();
    expect(g.pdf().unlocked.map((a) => a.id)).toEqual(["bookworm"]);
    expect(ACHIEVEMENTS).toHaveLength(8);
  });
  it("unlocks On fire on the third day in a row", () => {
    const kv = new MemoryKV();
    for (const [i, day] of ["2026-11-12", "2026-11-13", "2026-11-14"].entries()) {
      const g = new Game(kv, at(`${day}T09:00:00`));
      const e = g.answer({ ...base, id: `d${i}` });
      if (i === 2) expect(e.unlocked.map((a) => a.id)).toContain("on_fire");
    }
  });
  it("resets with Undo and survives a reload", () => {
    const kv = new MemoryKV();
    const g = new Game(kv, at("2026-11-14T10:00:00"));
    g.answer({ ...base, id: "x" });
    const old = g.reset();
    expect(g.state.xp).toBe(0);
    g.restore(old);
    expect(new Game(kv, at("2026-11-14T11:00:00")).state.xp).toBe(10);
    expect(kv.data.has(GAME_KEY)).toBe(true);
  });
});

describe("storage-blocked mode", () => {
  it("keeps playing in memory when storage is blocked", () => {
    const g = new Game(blockedKV, at("2026-11-14T10:00:00"));
    expect(g.answer({ ok: true, asked: true, grounded: false, verified: false, libraries: [], question: "q", id: "1" }).gained).toBe(10);
    expect(g.state.xp).toBe(10);
    expect(new Game(blockedKV).state.xp).toBe(0); // nothing was persisted
  });
});
