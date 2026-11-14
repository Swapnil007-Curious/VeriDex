// Daily quests: three questions a day, picked deterministically from the date out of a pool of 30
// hand-written questions across every library. Each pool question was checked against the index:
// tests/e2e/quests.spec.ts asserts that the best passage for every one comes from its own library
// and clears that library's threshold (margin >= 0), so a quest always has evidence to answer from.

export interface Quest {
  id: string;
  subject: string; // the library the question was written for (shown as its icon)
  q: string;
}

export const QUEST_POOL: Quest[] = [
  { id: "cs1", subject: "cs_ai", q: "What does git rebase do, and when is it dangerous?" },
  { id: "cs2", subject: "cs_ai", q: "How does a convolutional layer differ from a fully connected layer?" },
  { id: "cs3", subject: "cs_ai", q: "What is the difference between a list and a tuple in Python?" },
  { id: "cs4", subject: "cs_ai", q: "How do you create a new branch in Git and switch to it?" },
  { id: "cs5", subject: "cs_ai", q: "What is dropout and why does it reduce overfitting?" },
  { id: "cs6", subject: "cs_ai", q: "How do you undo the last commit in Git?" },
  { id: "cs7", subject: "cs_ai", q: "How do you handle exceptions in Python with try and except?" },
  { id: "il1", subject: "indian_law", q: "What does Article 21 of the Constitution protect?" },
  { id: "il2", subject: "indian_law", q: "What are the fundamental duties of every citizen under Article 51A?" },
  { id: "il3", subject: "indian_law", q: "How can Parliament amend the Constitution under Article 368?" },
  { id: "il4", subject: "indian_law", q: "Who is liable to register under the CGST Act, 2017?" },
  { id: "il5", subject: "indian_law", q: "What is the punishment for murder under the Bharatiya Nyaya Sanhita, 2023?" },
  { id: "il6", subject: "indian_law", q: "What are the instalments and due dates for paying advance tax under the Income-tax Act, 2025?" },
  { id: "cl1", subject: "consumer_law", q: "Who can file a complaint before a District Commission?" },
  { id: "cl2", subject: "consumer_law", q: "What is the time limit for filing a consumer complaint?" },
  { id: "cl3", subject: "consumer_law", q: "What must an e-commerce entity do under the Consumer Protection (E-Commerce) Rules, 2020?" },
  { id: "cl4", subject: "consumer_law", q: "What is the pecuniary jurisdiction of the District Commission?" },
  { id: "cl5", subject: "consumer_law", q: "How is a consumer dispute referred to mediation?" },
  { id: "hb1", subject: "human_biology", q: "How does a muscle fiber contract?" },
  { id: "hb2", subject: "human_biology", q: "What are the chambers and valves of the heart?" },
  { id: "hb3", subject: "human_biology", q: "How does the body keep blood pH within its normal range?" },
  { id: "hb4", subject: "human_biology", q: "What is the structure of the cell membrane?" },
  { id: "hb5", subject: "human_biology", q: "How are bones formed and how do they develop?" },
  { id: "hb6", subject: "human_biology", q: "What happens during the process of breathing?" },
  { id: "pc1", subject: "physics_chemistry", q: "What does Archimedes' principle state?" },
  { id: "pc2", subject: "physics_chemistry", q: "How does the ideal gas law relate pressure, volume and temperature?" },
  { id: "pc3", subject: "physics_chemistry", q: "What is the difference between an SN1 and an SN2 reaction?" },
  { id: "pc4", subject: "physics_chemistry", q: "How does Newton's second law relate force, mass and acceleration?" },
  { id: "pc5", subject: "physics_chemistry", q: "What is time dilation in special relativity?" },
  { id: "pc6", subject: "physics_chemistry", q: "What is a Brønsted-Lowry acid?" },
];

/** FNV-1a of a string: the seed of the day. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a small deterministic generator. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The three quests of a day (YYYY-MM-DD): three different libraries, the same for everyone that day. */
export function dailyQuests(day: string, pool: readonly Quest[] = QUEST_POOL): Quest[] {
  const next = rng(hash(`veridex:${day}`));
  const subjects = [...new Set(pool.map((q) => q.subject))];
  for (let i = subjects.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [subjects[i], subjects[j]] = [subjects[j] as string, subjects[i] as string];
  }
  return subjects.slice(0, 3).map((s) => {
    const options = pool.filter((q) => q.subject === s);
    return options[Math.floor(next() * options.length)] as Quest;
  });
}

const norm = (s: string): string => s.trim().replace(/\s+/g, " ").toLowerCase();

/** The quest a question completes (exact text, ignoring case and spacing), if any. */
export function questFor(question: string, quests: readonly Quest[]): Quest | null {
  const n = norm(question);
  return quests.find((q) => norm(q.q) === n) ?? null;
}
