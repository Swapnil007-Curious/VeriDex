// The game rules as pure functions (unit-tested): XP awards, level thresholds and titles, local
// calendar days and the daily streak. Nothing here touches the DOM or storage.

export const XP = {
  answer: 10, // a question answered
  verifiedBonus: 15, // the answer is grounded and verified
  verify: 5, // running Verify
  quest: 20, // a daily quest completed
} as const;

/** XP needed to reach each level, from LV 1; after the table, +500 per level. */
export const LEVEL_THRESHOLDS = [0, 50, 150, 300, 500, 800, 1200] as const;
export const TITLES = ["NOVICE", "APPRENTICE", "SCHOLAR", "SAGE", "ARCHIVIST", "LOREMASTER", "ORACLE"] as const;

/** XP at which ``level`` (1-based) begins. */
export function thresholdFor(level: number): number {
  if (level <= 1) return 0;
  const i = level - 1;
  if (i < LEVEL_THRESHOLDS.length) return LEVEL_THRESHOLDS[i] as number;
  const last = LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1] as number;
  return last + 500 * (i - (LEVEL_THRESHOLDS.length - 1));
}

export function levelFor(xp: number): number {
  const x = Math.max(0, Math.floor(xp));
  let level = 1;
  while (thresholdFor(level + 1) <= x) level++;
  return level;
}

export function titleFor(level: number): string {
  return TITLES[Math.min(Math.max(level, 1), TITLES.length) - 1] as string;
}

export interface Progress {
  xp: number;
  level: number;
  title: string;
  into: number; // XP earned inside the current level
  span: number; // XP the current level spans
  next: number; // XP at which the next level begins
}

export function progressOf(xp: number): Progress {
  const x = Math.max(0, Math.floor(xp));
  const level = levelFor(x);
  const start = thresholdFor(level);
  const next = thresholdFor(level + 1);
  return { xp: x, level, title: titleFor(level), into: x - start, span: next - start, next };
}

/** The local calendar day of a date, as YYYY-MM-DD. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Whole calendar days from ``a`` to ``b`` (both YYYY-MM-DD); daylight-saving shifts do not matter. */
export function daysBetween(a: string, b: string): number {
  const toUtc = (k: string): number => {
    const [y, m, d] = k.split("-").map(Number);
    return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

export interface Streak {
  streak: number;
  lastDay: string | null;
}

/** The streak after a question on ``today``: same day keeps it, the next day adds one, a gap restarts at 1. */
export function nextStreak(prev: Streak, today: string): Streak {
  if (!prev.lastDay || prev.streak <= 0) return { streak: 1, lastDay: today };
  const gap = daysBetween(prev.lastDay, today);
  if (gap <= 0) return { streak: prev.streak, lastDay: gap < 0 ? prev.lastDay : today };
  if (gap === 1) return { streak: prev.streak + 1, lastDay: today };
  return { streak: 1, lastDay: today };
}

/** The streak to show today: it lapses once a whole day has passed without a question. */
export function liveStreak(s: Streak, today: string): number {
  if (!s.lastDay) return 0;
  return daysBetween(s.lastDay, today) <= 1 ? s.streak : 0;
}
