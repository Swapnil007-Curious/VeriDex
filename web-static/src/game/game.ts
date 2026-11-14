// The game layer's state and events: XP, levels, the daily streak, quests and achievements, kept
// in localStorage (veridex.game.v1) through a key-value store whose every access is guarded. With
// storage blocked the state lives in memory for the visit. It never blocks or changes answers: the
// page reports what happened (an answer, a Verify run, a PDF) and shows what the game returns.

import { dailyQuests, questFor, type Quest } from "./quests.ts";
import { dayKey, liveStreak, nextStreak, progressOf, XP, type Progress } from "./rules.ts";

export const GAME_KEY = "veridex.game.v1";
const MAX_AWARD_IDS = 300;

export interface Achievement {
  id: string;
  name: string;
  desc: string;
  icon: string;
  goal: number;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: "first_question", name: "First question", desc: "Get your first answer.", icon: "star", goal: 1 },
  { id: "first_verified", name: "First verified answer", desc: "Get an answer with every sentence backed by its sources.", icon: "shield", goal: 1 },
  { id: "fact_checker", name: "Fact checker", desc: "Run Verify 10 times.", icon: "check", goal: 10 },
  { id: "polymath", name: "Polymath", desc: "Get grounded answers from 4 different libraries.", icon: "book", goal: 4 },
  { id: "bookworm", name: "Bookworm", desc: "Add a PDF.", icon: "upload", goal: 1 },
  { id: "on_fire", name: "On fire", desc: "Ask on 3 days in a row.", icon: "flame", goal: 3 },
  { id: "week_warrior", name: "Week warrior", desc: "Ask on 7 days in a row.", icon: "flame", goal: 7 },
  { id: "quest_champion", name: "Quest champion", desc: "Complete all 3 daily quests in one day.", icon: "trophy", goal: 3 },
];

export interface GameState {
  v: 1;
  xp: number;
  answered: number;
  verifiedAnswers: number;
  verifies: number;
  pdfs: number;
  libraries: string[]; // libraries that gave grounded answers (for Polymath; never shown as a list)
  streak: number;
  lastDay: string | null;
  bestStreak: number;
  quests: { day: string; done: string[] };
  questDays: string[]; // days on which all three quests were done
  unlocked: Record<string, number>;
  awards: Record<string, string[]>; // answer id -> awards it already earned
}

export interface KV {
  get<T>(key: string): T | null;
  set(key: string, value: unknown): boolean;
}

export function freshState(): GameState {
  return { v: 1, xp: 0, answered: 0, verifiedAnswers: 0, verifies: 0, pdfs: 0, libraries: [], streak: 0, lastDay: null, bestStreak: 0, quests: { day: "", done: [] }, questDays: [], unlocked: {}, awards: {} };
}

function sanitize(raw: unknown): GameState {
  const s = freshState();
  if (!raw || typeof raw !== "object") return s;
  const r = raw as Partial<GameState>;
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  s.xp = num(r.xp);
  s.answered = num(r.answered);
  s.verifiedAnswers = num(r.verifiedAnswers);
  s.verifies = num(r.verifies);
  s.pdfs = num(r.pdfs);
  s.streak = num(r.streak);
  s.bestStreak = num(r.bestStreak);
  s.lastDay = typeof r.lastDay === "string" ? r.lastDay : null;
  s.libraries = Array.isArray(r.libraries) ? r.libraries.filter((x): x is string => typeof x === "string").slice(0, 20) : [];
  if (r.quests && typeof r.quests.day === "string" && Array.isArray(r.quests.done)) s.quests = { day: r.quests.day, done: r.quests.done.filter((x) => typeof x === "string").slice(0, 3) };
  s.questDays = Array.isArray(r.questDays) ? r.questDays.filter((x): x is string => typeof x === "string").slice(-30) : [];
  if (r.unlocked && typeof r.unlocked === "object") for (const [k, v] of Object.entries(r.unlocked)) if (typeof v === "number") s.unlocked[k] = v;
  if (r.awards && typeof r.awards === "object") for (const [k, v] of Object.entries(r.awards)) if (Array.isArray(v)) s.awards[k] = v.filter((x) => typeof x === "string");
  return s;
}

export interface GameEvent {
  gained: number;
  levelUp: Progress | null;
  unlocked: Achievement[];
  quest: Quest | null;
}

const NOTHING: GameEvent = { gained: 0, levelUp: null, unlocked: [], quest: null };

export interface AnswerInfo {
  id: string;
  ok: boolean; // done, not an error, not an abstention, has text
  asked: boolean; // a question was answered or abstained on (counts for the streak)
  grounded: boolean; // cites at least one passage
  verified: boolean; // every sentence backed (Grounded only: guards passed and the critic accepted)
  libraries: string[]; // libraries of the cited passages
  question: string;
}

export class Game {
  state: GameState;

  constructor(
    private readonly kv: KV,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.state = sanitize(kv.get(GAME_KEY));
  }

  private save(): void {
    const ids = Object.keys(this.state.awards);
    if (ids.length > MAX_AWARD_IDS) for (const id of ids.slice(0, ids.length - MAX_AWARD_IDS)) delete this.state.awards[id];
    this.kv.set(GAME_KEY, this.state);
  }

  today(): string {
    return dayKey(this.now());
  }

  progress(): Progress {
    return progressOf(this.state.xp);
  }

  streak(): number {
    return liveStreak({ streak: this.state.streak, lastDay: this.state.lastDay }, this.today());
  }

  quests(): { quest: Quest; done: boolean }[] {
    const day = this.today();
    const done = this.state.quests.day === day ? this.state.quests.done : [];
    return dailyQuests(day).map((quest) => ({ quest, done: done.includes(quest.id) }));
  }

  /** Progress towards each achievement (for the Achievements view). */
  counts(): Record<string, number> {
    const s = this.state;
    const day = this.today();
    return {
      first_question: Math.min(1, s.answered),
      first_verified: Math.min(1, s.verifiedAnswers),
      fact_checker: s.verifies,
      polymath: s.libraries.length,
      bookworm: Math.min(1, s.pdfs),
      on_fire: Math.max(s.bestStreak, this.streak()),
      week_warrior: Math.max(s.bestStreak, this.streak()),
      quest_champion: s.questDays.length ? 3 : s.quests.day === day ? s.quests.done.length : 0,
    };
  }

  private has(id: string, award: string): boolean {
    return this.state.awards[id]?.includes(award) ?? false;
  }

  private mark(id: string, award: string): void {
    (this.state.awards[id] ??= []).push(award);
  }

  private settle(before: number, gained: number, quest: Quest | null): GameEvent {
    this.state.xp += gained;
    const after = this.progress();
    const unlocked: Achievement[] = [];
    const counts = this.counts();
    for (const a of ACHIEVEMENTS) {
      if (this.state.unlocked[a.id]) continue;
      if ((counts[a.id] ?? 0) >= a.goal) {
        this.state.unlocked[a.id] = this.now().getTime();
        unlocked.push(a);
      }
    }
    this.save();
    return { gained, levelUp: after.level > before ? after : null, unlocked, quest };
  }

  answer(info: AnswerInfo): GameEvent {
    if (!info.ok && !info.asked) return NOTHING;
    const before = this.progress().level;
    let gained = 0;
    let quest: Quest | null = null;
    const today = this.today();
    if (info.asked && !this.has(info.id, "streak")) {
      const s = nextStreak({ streak: this.state.streak, lastDay: this.state.lastDay }, today);
      this.state.streak = s.streak;
      this.state.lastDay = s.lastDay;
      this.state.bestStreak = Math.max(this.state.bestStreak, s.streak);
      this.mark(info.id, "streak");
    }
    if (info.ok) {
      if (!this.has(info.id, "answer")) {
        gained += XP.answer;
        this.state.answered += 1;
        this.mark(info.id, "answer");
      }
      if (info.grounded && info.verified && !this.has(info.id, "verifiedBonus")) {
        gained += XP.verifiedBonus;
        this.state.verifiedAnswers += 1;
        this.mark(info.id, "verifiedBonus");
      }
      if (info.grounded) for (const lib of info.libraries) if (lib !== "upload" && !this.state.libraries.includes(lib)) this.state.libraries.push(lib);
      const q = questFor(info.question, dailyQuests(today));
      if (q && !this.has(info.id, "quest")) {
        if (this.state.quests.day !== today) this.state.quests = { day: today, done: [] };
        if (!this.state.quests.done.includes(q.id)) {
          this.state.quests.done.push(q.id);
          gained += XP.quest;
          quest = q;
          this.mark(info.id, "quest");
          if (this.state.quests.done.length >= 3 && !this.state.questDays.includes(today)) this.state.questDays.push(today);
        }
      }
    }
    return this.settle(before, gained, quest);
  }

  verify(info: { id: string; grounded: boolean; allSupported: boolean; libraries: string[] }): GameEvent {
    if (this.has(info.id, "verify")) return NOTHING;
    const before = this.progress().level;
    let gained = XP.verify;
    this.state.verifies += 1;
    this.mark(info.id, "verify");
    if (info.grounded && info.allSupported && !this.has(info.id, "verifiedBonus")) {
      gained += XP.verifiedBonus;
      this.state.verifiedAnswers += 1;
      this.mark(info.id, "verifiedBonus");
    }
    return this.settle(before, gained, null);
  }

  pdf(): GameEvent {
    const before = this.progress().level;
    this.state.pdfs += 1;
    return this.settle(before, 0, null);
  }

  /** Start over; returns the old state for Undo. */
  reset(): GameState {
    const old = this.state;
    this.state = freshState();
    this.save();
    return old;
  }

  restore(state: GameState): void {
    this.state = sanitize(state);
    this.save();
  }
}
