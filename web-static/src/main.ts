// VeriDex: the page controller. One assistant over one library: every question searches all
// collection indexes (in the embedding worker) and the attached PDFs; replies stream from the LLM
// proxy. Model text is rendered by markdown.ts (text nodes only); everything else is built with
// createElement. The UI shows only data the pipeline really produces (DESIGN.md maps each element
// to its source). The game layer (XP, quests, trophies) is local and never changes an answer.

import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/components.css";
import "./styles/dex-voice.css";
import "./styles/intro.css";
import { ProxyError } from "./api.ts";
import { loadManifest } from "./data.ts";
import { Embedder } from "./embedder.ts";
import { Assistant, type ChatOutcome, type GroundedCheck, type StageEvent } from "./engine.ts";
import { ACHIEVEMENTS, Game, type GameEvent } from "./game/game.ts";
import type { Summary, Turn } from "./history.ts";
import { classifyIntent, libraryFacts, limitationsText, VERIDEX_FACTS } from "./identity.ts";
import { answerNotices, libraryTag, libraryTotals, TextShards } from "./library.ts";
import { copyText, render, SAFE_URL } from "./markdown.ts";
import { storage } from "./storage.ts";
import type { Manifest, Passage } from "./types.ts";
import { UploadError, UploadStore } from "./uploads.ts";
import type { VerifyResult } from "./verify.ts";
import { Dex } from "./dex/dex.ts";
import type { Point, Size } from "./dex/physics.ts";
import { dexStill, DexSprite } from "./dex/sprite.ts";
import type { Voice } from "./voice/voice.ts";
import { buildLogo } from "./ui/boot.ts";
import { $, ampText, el, modKey, pressFeedback } from "./ui/dom.ts";
import { describeError, formatCountdown, type ErrorView } from "./ui/errors.ts";
import { Evidence } from "./ui/evidence.ts";
import { excerpt, markTerms, queryTerms } from "./ui/highlight.ts";
import { dismissLevelUp, renderHud, showLevelUp, trophyToast, xpFloat } from "./ui/hud.ts";
import { hydrateIcons, pixelIcon, setIcon, SUBJECT_ICONS } from "./ui/icons.ts";
import { linkLabels } from "./ui/linking.ts";
import { coarsePointer, fade, reducedMotion, springTo, springTransform, syncReducedMotion, VelocityTracker } from "./ui/motion.ts";
import { applyPrefs, DEFAULTS, gameOn, loadPrefs, savePrefs, speechTuning, type Prefs } from "./ui/prefs.ts";
import { buildShareUrl, parseShareParams } from "./ui/share.ts";
import { sfx } from "./ui/sound.ts";
import { stampLabel, stampNode, type Verdict } from "./ui/stamp.ts";
import { startStarfield } from "./ui/starfield.ts";
import { currentTheme, themeToggleLabel } from "./ui/theme.ts";
import { toast } from "./ui/toast.ts";
import { applyStage, finishTrace, initialTrace, renderTrace, type TraceStep } from "./ui/trace.ts";
import { ensureHljs, ensureKatex, needsCode, needsMath } from "./ui/vendor.ts";

declare const __WORKER_URL__: string;
declare const __MODEL_DTYPE__: string;

const BASE = import.meta.env.BASE_URL;
const STORE_KEY = "ragsys.static.v1";
const MAX_CONVERSATIONS = 50;
const REPO = "https://github.com/Swapnil007-Curious/VeriDex";
const TITLE = "VeriDex";

type Status = "streaming" | "done" | "error" | "stopped";

interface StoredError extends ErrorView {
  at: number;
}

interface Meta {
  status: Status;
  mode?: "chat" | "grounded_only";
  grounded?: boolean;
  sourceLine?: string;
  citations?: string[];
  passages?: Passage[];
  context?: Passage[];
  notices?: string[];
  outcome?: "answered" | "abstained";
  closest?: { heading_path: string; pages: string }[];
  abstentionMessage?: string;
  error?: StoredError;
  verify?: VerifyResult | { error: string };
  statusText?: string;
  trace?: TraceStep[];
  check?: GroundedCheck;
  verifyMs?: number;
  intent?: "about" | "smalltalk";
  variant?: string;
  identityFix?: "retried" | "stripped";
}

interface Message {
  id?: string;
  role: "user" | "assistant";
  content: string;
  meta?: Meta;
  node?: HTMLElement;
  stamped?: boolean;
}

interface Conversation {
  id: string;
  title: string;
  created: number;
  updated: number;
  groundedOnly: boolean;
  summary: Summary | null;
  messages: Message[];
}

const state = {
  conversations: [] as Conversation[],
  currentId: null as string | null,
  manifest: null as Manifest | null,
  assistant: null as Assistant | null,
  streaming: null as { controller: AbortController; conv: Conversation; msg: Message; shown: number } | null,
  autoScroll: true,
  uploading: false,
  modelReady: false,
  evidenceFor: null as Message | null,
  prefs: {} as Prefs,
};

let evidence: Evidence;
let game: Game;
let dex: Dex;

// voice: the controller loads on first use; support is known up front so the controls can hide
const W = window as unknown as Record<string, unknown>;
const VOICE_IN = Boolean(W.SpeechRecognition || W.webkitSpeechRecognition);
const VOICE_OUT = Boolean(W.speechSynthesis) && typeof W.SpeechSynthesisUtterance === "function";
let voice: Voice | null = null;
let voiceLoading: Promise<Voice | null> | null = null;
const spokenQuestions = new Set<string>(); // ids of questions asked by voice (this visit only)

function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

function uid(): string {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ------------------------------------------------------------------ persistence

function current(): Conversation | null {
  return state.conversations.find((c) => c.id === state.currentId) ?? null;
}

function stripMeta(meta: Meta | undefined): Meta | undefined {
  if (!meta) return undefined;
  const { context: _c, statusText: _s, ...rest } = meta;
  if (rest.status === "streaming") rest.status = "stopped";
  if (rest.trace) rest.trace = finishTrace(rest.trace);
  return rest;
}

function saveAll(): void {
  if (!storage.ok) return;
  const data = state.conversations.slice(0, MAX_CONVERSATIONS).map((c) => ({
    ...c,
    messages: c.messages.map((m) => ({ id: m.id, role: m.role, content: m.content, meta: stripMeta(m.meta) })),
  }));
  while (!storage.set(STORE_KEY, { v: 1, conversations: data })) {
    const idx = data.map((c) => c.id !== state.currentId).lastIndexOf(true);
    if (idx < 0) {
      storage.ok = false;
      $("storage-note").hidden = false;
      return;
    }
    data.splice(idx, 1);
  }
}

function loadAll(): void {
  if (!storage.probe()) {
    storage.ok = false;
    $("storage-note").hidden = false;
    return;
  }
  const data = storage.get<{ conversations?: Conversation[] }>(STORE_KEY);
  if (data && Array.isArray(data.conversations)) {
    state.conversations = data.conversations.filter((c) => c && typeof c.id === "string" && Array.isArray(c.messages));
  }
}

// ------------------------------------------------------------------ game feedback

function libsOf(passages: readonly Passage[] | undefined): string[] {
  return [...new Set((passages ?? []).map((p) => p.source).filter((s) => s !== "upload"))];
}

function playGame(ev: GameEvent, host: HTMLElement | null | undefined): void {
  renderHud(game.progress(), game.streak());
  if (ev.quest) renderQuests();
  if (!gameOn(state.prefs)) return;
  if (ev.gained && host) xpFloat(host, ev.gained);
  const notes: string[] = [];
  if (ev.gained) notes.push(`Plus ${ev.gained} XP.`);
  if (ev.levelUp || ev.unlocked.length) dex.send({ type: "celebrate" });
  if (ev.levelUp) {
    showLevelUp(ev.levelUp);
    sfx.levelUp();
    notes.push(`Level up: level ${ev.levelUp.level}, ${ev.levelUp.title}.`);
  }
  for (const a of ev.unlocked) {
    trophyToast(a);
    notes.push(`Achievement unlocked: ${a.name}.`);
  }
  if (ev.levelUp || ev.unlocked.length) setTimeout(() => announce(notes.join(" ")), 900);
}

function renderQuests(): void {
  const list = $("quest-list");
  list.textContent = "";
  for (const { quest, done } of game.quests()) {
    const li = el("li");
    const b = el("button", `quest frame${done ? " is-done" : ""}`);
    b.type = "button";
    const icon = el("span", "quest-icon");
    icon.appendChild(pixelIcon(SUBJECT_ICONS[quest.subject] ?? "star", 32));
    b.appendChild(icon);
    b.appendChild(el("span", "quest-q", quest.q));
    const foot = el("span", "quest-foot");
    if (done) {
      const d = el("span", "quest-done");
      d.append(pixelIcon("check", 16), el("span", null, "Done"));
      foot.append(d);
    } else foot.appendChild(el("span", "quest-xp", "+20 XP"));
    b.appendChild(foot);
    b.setAttribute("aria-label", `${done ? "Completed quest" : "Daily quest, 20 XP"}: ${quest.q}`);
    b.addEventListener("click", () => {
      if (state.streaming) return;
      void sendMessage(quest.q);
    });
    li.appendChild(b);
    list.appendChild(li);
  }
}

// ------------------------------------------------------------------ mode control

function groundedOnly(): boolean {
  return $<HTMLInputElement>("grounded-only").checked;
}

function placeSegIndicator(animated: boolean): void {
  const control = $("mode-control");
  const checked = control.querySelector<HTMLInputElement>(".seg-input:checked");
  const label = checked ? control.querySelector<HTMLElement>(`label[for="${checked.id}"]`) : null;
  const ind = $("seg-indicator");
  if (!label) return;
  const x = label.offsetLeft;
  ind.style.width = `${label.offsetWidth}px`;
  const m = /translateX\(([-\d.]+)px\)/.exec(ind.style.transform);
  const from = m ? Number.parseFloat(m[1] ?? "0") : x;
  if (!animated || reducedMotion()) ind.style.transform = `translateX(${x}px)`;
  else springTransform(ind, "translateX", from, x);
}

function setMode(grounded: boolean): void {
  $<HTMLInputElement>(grounded ? "grounded-only" : "mode-chat").checked = true;
  placeSegIndicator(true);
  state.prefs = savePrefs({ mode: grounded ? "grounded" : "chat" });
}

function updateTitle(): void {
  const c = current();
  document.title = c?.title ? `${c.title} · ${TITLE}` : TITLE;
}

// ------------------------------------------------------------------ rail

/** While the drawer is open the page behind it is inert (focus stays in the drawer) and does not scroll. */
function lockBehindDrawer(on: boolean): void {
  for (const id of ["main", "evidence", "dex-layer"]) {
    const node = document.getElementById(id);
    if (node) node.inert = on;
  }
  document.documentElement.classList.toggle("drawer-open", on);
}

/** The rail is docked (wide screen, not collapsed): it is not a drawer there. */
function railDocked(): boolean {
  return window.matchMedia("(width >= 1100px)").matches && $("app").dataset.rail !== "collapsed";
}

function openRailDrawer(): void {
  const rail = $("rail");
  const scrim = $("scrim");
  lockBehindDrawer(true);
  scrim.hidden = false;
  fade(scrim, Number(getComputedStyle(scrim).opacity) || 0, 1, 150);
  rail.classList.remove("closing");
  rail.classList.add("open");
  $("open-rail").setAttribute("aria-expanded", "true");
  const w = rail.getBoundingClientRect().width;
  const m = /matrix\(([^)]+)\)/.exec(getComputedStyle(rail).transform);
  const cur = m ? Number.parseFloat((m[1] ?? "").split(",")[4] ?? "0") : -w;
  springTransform(rail, "translateX", cur, 0);
  $("new-chat").focus({ preventScroll: true });
}

function closeRailDrawer(velocity?: number): void {
  const rail = $("rail");
  if (!rail.classList.contains("open")) return;
  lockBehindDrawer(false);
  if (railDocked()) {
    // it became docked while open (the window grew): no slide, just tidy up
    rail.classList.remove("open", "closing");
    rail.style.transform = "";
    $("scrim").hidden = true;
    $("open-rail").setAttribute("aria-expanded", "false");
    return;
  }
  rail.classList.remove("open");
  rail.classList.add("closing");
  $("open-rail").setAttribute("aria-expanded", "false");
  const scrim = $("scrim");
  if (!evidence.open || evidence.mode() === "panel") {
    fade(scrim, 1, 0, 150, () => {
      if (!rail.classList.contains("open") && (!evidence.open || evidence.mode() === "panel")) scrim.hidden = true;
    });
  }
  const w = rail.getBoundingClientRect().width;
  const m = /matrix\(([^)]+)\)/.exec(getComputedStyle(rail).transform);
  const cur = m ? Number.parseFloat((m[1] ?? "").split(",")[4] ?? "0") : 0;
  springTransform(rail, "translateX", cur, -w, {
    ...(velocity !== undefined ? { velocity, gesture: true } : {}),
    onComplete: () => {
      if (!rail.classList.contains("open")) rail.classList.remove("closing");
    },
  });
  const active = document.activeElement;
  if (!active || active === document.body || rail.contains(active)) $("open-rail").focus();
}

/** Swipe left on the open drawer to close it: it follows the finger 1:1 and the release velocity decides. */
function wireRailSwipe(): void {
  const rail = $("rail");
  const vt = new VelocityTracker();
  let start: { x: number; y: number; id: number } | null = null;
  let tracking = false;
  let dx = 0;
  rail.addEventListener("pointerdown", (e) => {
    if (!rail.classList.contains("open") || e.button !== 0) return;
    start = { x: e.clientX, y: e.clientY, id: e.pointerId };
    tracking = false;
    dx = 0;
    vt.reset();
  });
  rail.addEventListener("pointermove", (e) => {
    if (!start || e.pointerId !== start.id) return;
    const mx = e.clientX - start.x;
    const my = e.clientY - start.y;
    if (!tracking) {
      if (mx < -10 && Math.abs(mx) > Math.abs(my) * 1.2) {
        tracking = true;
        rail.setPointerCapture(e.pointerId);
      } else if (Math.abs(my) > 10 || mx > 10) start = null;
      return;
    }
    dx = Math.min(0, mx);
    rail.style.transform = `translateX(${dx}px)`;
    vt.add(dx);
  });
  const end = (e: PointerEvent): void => {
    if (!start || e.pointerId !== start.id) return;
    const was = tracking;
    start = null;
    tracking = false;
    if (!was) return;
    const v = vt.velocity();
    const w = rail.getBoundingClientRect().width;
    if (dx < -w / 3 || v < -500) closeRailDrawer(v);
    else springTransform(rail, "translateX", dx, 0, { velocity: v, gesture: true });
  };
  rail.addEventListener("pointerup", end);
  rail.addEventListener("pointercancel", end);
}

/**
 * Collapse or dock the rail on a wide screen. Not remembered between visits: a collapsed rail
 * saved in an earlier visit is what put a 1366 px window into the compact layout.
 */
function setRailCollapsed(collapsed: boolean): void {
  const rail = $("rail");
  if (rail.classList.contains("open")) {
    lockBehindDrawer(false);
    rail.classList.remove("open", "closing");
    $("scrim").hidden = true;
    $("open-rail").setAttribute("aria-expanded", "false");
  }
  rail.style.transform = "";
  $("app").dataset.rail = collapsed ? "collapsed" : "open";
  const b = $("rail-collapse");
  b.setAttribute("aria-expanded", collapsed ? "false" : "true");
  b.setAttribute("aria-label", collapsed ? "Expand the sidebar" : "Collapse the sidebar");
  if (!collapsed) $("rail-collapse").focus();
}

// ------------------------------------------------------------------ history

function groupTitle(updated: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return updated >= d.getTime() ? "Today" : "Earlier";
}

function renderConversationList(): void {
  const host = $("conv-list");
  host.textContent = "";
  const convs = [...state.conversations].sort((a, b) => (b.updated || 0) - (a.updated || 0));
  $("conv-empty").hidden = convs.length > 0;
  let group = "";
  let ul: HTMLUListElement | null = null;
  for (const c of convs) {
    const g = groupTitle(c.updated || 0);
    if (g !== group) {
      group = g;
      host.appendChild(el("p", "conv-group-title", g));
      ul = el("ul", "conv-list");
      host.appendChild(ul);
    }
    const li = el("li", "conv-item");
    if (c.id === state.currentId) li.setAttribute("aria-current", "true");
    const open = el("button", "conv-open", c.title || "New quest");
    open.type = "button";
    open.title = c.title || "New quest";
    open.addEventListener("click", () => {
      openConversation(c.id);
      closeRailDrawer();
    });
    const del = el("button", "conv-del");
    del.type = "button";
    del.setAttribute("aria-label", `Delete chat: ${c.title || "New quest"}`);
    del.appendChild(pixelIcon("trash", 16));
    del.addEventListener("click", () => deleteConversation(c.id));
    li.append(open, del);
    ul?.appendChild(li);
  }
}

function newConversation(): void {
  if (state.streaming) stopStreaming();
  voice?.stopAll();
  state.currentId = null;
  evidence.hide();
  renderMessages();
  renderConversationList();
  updateTitle();
  $("composer-input").focus();
}

function ensureConversation(): Conversation {
  let c = current();
  if (!c) {
    c = { id: uid(), title: "", created: Date.now(), updated: Date.now(), groundedOnly: groundedOnly(), summary: null, messages: [] };
    state.conversations.unshift(c);
    state.currentId = c.id;
    state.conversations.length = Math.min(state.conversations.length, MAX_CONVERSATIONS);
  }
  return c;
}

function openConversation(id: string): void {
  if (state.streaming) stopStreaming();
  state.currentId = id;
  evidence.hide();
  updateTitle();
  renderConversationList();
  renderMessages();
  scrollToBottom(true);
}

function deleteConversation(id: string): void {
  const idx = state.conversations.findIndex((c) => c.id === id);
  const removed = state.conversations[idx];
  if (!removed) return;
  if (state.streaming?.conv.id === id) stopStreaming();
  state.conversations.splice(idx, 1);
  const wasCurrent = state.currentId === id;
  if (wasCurrent) {
    state.currentId = null;
    evidence.hide();
  }
  saveAll();
  renderConversationList();
  renderMessages();
  updateTitle();
  toast("Chat deleted", {
    label: "Undo",
    onClick: () => {
      state.conversations.splice(Math.min(idx, state.conversations.length), 0, removed);
      if (wasCurrent) state.currentId = removed.id;
      saveAll();
      renderConversationList();
      renderMessages();
      updateTitle();
    },
  });
}

// ------------------------------------------------------------------ messages

/** Dex's status lines go to their own polite live region, so they never cut off the app's. */
function dexAnnounce(text: string): void {
  const live = $("dex-live");
  live.textContent = "";
  setTimeout(() => {
    live.textContent = text;
  }, 30);
}

function announce(text: string): void {
  const live = $("live");
  live.textContent = "";
  setTimeout(() => {
    live.textContent = text;
  }, 30);
}

function renderMessages(): void {
  const list = $("messages");
  list.textContent = "";
  const c = current();
  const msgs = c?.messages ?? [];
  $("hero").hidden = msgs.length > 0;
  document.documentElement.dataset.view = msgs.length ? "chat" : "title";
  $("evidence-toggle").hidden = !msgs.some((m) => m.meta?.passages?.length);
  if (c) msgs.forEach((m, i) => list.appendChild(messageNode(c, m, i)));
  if (state.evidenceFor && !msgs.includes(state.evidenceFor)) {
    state.evidenceFor = null;
    evidence.hide();
  }
}

function lastIndex(c: Conversation, role: Message["role"]): number {
  for (let i = c.messages.length - 1; i >= 0; i--) if (c.messages[i]?.role === role) return i;
  return -1;
}

function actionButton(label: string, aria: string, iconName: string | null, onClick: (b: HTMLButtonElement) => void): HTMLButtonElement {
  const b = el("button", "act");
  b.type = "button";
  if (iconName) b.appendChild(pixelIcon(iconName, 16));
  b.appendChild(el("span", null, label));
  b.setAttribute("aria-label", aria);
  b.addEventListener("click", () => onClick(b));
  return b;
}

function messageNode(c: Conversation, m: Message, index: number): HTMLElement {
  const li = el("li", `msg ${m.role}`);
  m.node = li;
  if (m.role === "user") {
    li.appendChild(el("span", "visually-hidden", "You asked:"));
    li.appendChild(el("div", "bubble-user", m.content));
    if (index === lastIndex(c, "user") && !state.streaming) {
      const actions = el("div", "msg-actions");
      actions.appendChild(actionButton("Edit", "Edit and resend your last question", null, () => startEdit(c, m, li)));
      actions.appendChild(actionButton("Copy", "Copy your question", "copy", (b) => copyText(m.content, b.querySelector("span") ?? b)));
      li.appendChild(actions);
    }
    return li;
  }
  li.appendChild(el("span", "visually-hidden", "VeriDex answered:"));
  renderAnswer(c, m, li, true);
  return li;
}

function passageMap(m: Message): Map<string, Passage> {
  const map = new Map<string, Passage>();
  for (const p of m.meta?.context ?? []) map.set(p.label, p);
  for (const p of m.meta?.passages ?? []) map.set(p.label, p);
  return map;
}

function citeFactory(m: Message): (label: string) => HTMLElement | null {
  const map = passageMap(m);
  return (label) => {
    const p = map.get(label);
    if (!p) return null;
    const b = el("button", "cite-inline", label);
    b.type = "button";
    b.dataset.label = label;
    b.setAttribute("aria-label", `Source ${label}: ${docTitle(p)}`);
    b.addEventListener("mouseenter", () => linkSource(m, label, true));
    b.addEventListener("mouseleave", () => linkSource(m, null, false));
    b.addEventListener("focus", () => linkSource(m, label, true));
    b.addEventListener("blur", () => linkSource(m, null, false));
    b.addEventListener("click", () => showEvidence(m, b, label));
    return b;
  };
}

/** Hovering or focusing a citation highlights its source card (and the matching chips). */
function linkSource(m: Message, label: string | null, scroll: boolean): void {
  if (state.evidenceFor === m && evidence.open) evidence.link(label, scroll);
  if (m.node) linkLabels(m.node, label);
}

function questionFor(c: Conversation, m: Message): string {
  const idx = c.messages.indexOf(m);
  for (let i = idx - 1; i >= 0; i--) {
    const q = c.messages[i];
    if (q?.role === "user") return q.content;
  }
  return "";
}

/** The real verdict of an answer, or null when nothing was checked yet. */
function verdictOf(meta: Meta): { verdict: Verdict; supported?: number; total?: number } | null {
  if (meta.mode === "grounded_only") {
    if (meta.outcome === "abstained") return { verdict: "unsupported" };
    if (meta.outcome === "answered" && meta.check?.guards?.passed && meta.check.critic?.verdict === "accept") return { verdict: "supported" };
    return null;
  }
  if (meta.verify && !("error" in meta.verify)) {
    const { supported, total } = meta.verify;
    if (!total) return null;
    return { verdict: supported === total ? "supported" : supported > 0 ? "partial" : "unsupported", supported, total };
  }
  return null;
}

function traceFor(c: Conversation, m: Message): TraceStep[] {
  const meta = m.meta as Meta;
  const base = meta.trace ?? initialTrace(c.groundedOnly);
  if (meta.mode !== "grounded_only" && (meta.grounded || meta.status === "streaming")) {
    const v = verdictOf(meta);
    const hasVerify = base.some((s) => s.id === "verify");
    const steps = hasVerify ? base : [...base, { id: "verify", label: "Verify", status: "pending" as const, ms: null }];
    return steps.map((s) => (s.id === "verify" && v ? { ...s, status: "done" as const, ms: meta.verifyMs ?? s.ms, verdict: v.verdict } : s));
  }
  return base.filter((s) => s.id !== "verify");
}

let verifying: Message | null = null;

function badgeFor(meta: Meta): HTMLElement | null {
  if (meta.status === "streaming" || meta.error) return null;
  if (meta.mode === "grounded_only" && meta.outcome === "abstained") return null;
  const b = el("span", "badge");
  if (meta.intent) return null; // a reply about VeriDex or small talk is plain
  if (meta.grounded) {
    b.classList.add("badge-grounded");
    b.append(pixelIcon("shield", 16), el("span", null, "Grounded"));
  } else if (meta.status === "done" || meta.status === "stopped") {
    b.classList.add("badge-general");
    b.append(pixelIcon("question", 16), el("span", null, "General knowledge"));
  } else return null;
  return b;
}

function renderAnswer(c: Conversation, m: Message, li: HTMLElement, final: boolean): void {
  const meta = m.meta ?? { status: "done" };
  m.meta ??= meta;
  const keep = li.querySelector(":scope > .visually-hidden");
  li.textContent = "";
  if (keep) li.appendChild(keep);
  // the quest trace (space is reserved from the first frame); replies about VeriDex have none
  if (!meta.intent) {
    const trace = el("div");
    renderTrace(trace, traceFor(c, m));
    li.appendChild(trace);
  }
  if (meta.error) {
    li.appendChild(errorCard(c, meta.error));
    return;
  }
  if (meta.mode === "grounded_only" && meta.outcome === "abstained") {
    li.appendChild(abstainCard(c, m));
    li.appendChild(answerActions(c, m));
    return;
  }
  const box = el("article", "dbox frame");
  const head = el("header", "dbox-head");
  const portrait = el("span", "portrait");
  portrait.appendChild(portraitDex(c, m));
  const img = el("img");
  img.src = `${BASE}favicon.svg`;
  img.alt = "";
  img.width = 32;
  img.height = 32;
  portrait.appendChild(img);
  head.append(portrait, el("span", "dbox-name", "VeriDex"));
  const badge = badgeFor(meta);
  if (badge) head.appendChild(badge);
  box.appendChild(head);
  const body = el("div", "answer");
  box.appendChild(body);
  const streaming = meta.status === "streaming";
  const s = state.streaming;
  const shownText = streaming && s?.msg === m ? m.content.slice(0, s.shown) : m.content;
  if (streaming && !m.content) {
    const t = el("div", "thinking");
    t.appendChild(el("span", "caret"));
    t.appendChild(el("span", null, meta.statusText || "Searching the library…"));
    body.appendChild(t);
  } else if (shownText) {
    body.appendChild(render(shownText, { cite: citeFactory(m), highlight: final && !streaming }));
    if (streaming) appendCaret(body);
    else if (final) void loadVendorsFor(c, m, li);
  }
  if (!meta.intent) box.appendChild(resultRow(c, m));
  if (!streaming && meta.passages?.length) box.appendChild(sourceChips(m));
  if (!streaming && meta.notices?.length) {
    const n = el("div", "notices");
    for (const text of meta.notices) {
      const pill = el("span", "notice");
      pill.append(pixelIcon("info", 16), el("span", null, text));
      n.appendChild(pill);
    }
    box.appendChild(n);
  }
  li.appendChild(box);
  if (!streaming) li.appendChild(answerActions(c, m));
}

let portraitTemplate: SVGSVGElement | null = null;
let livePortrait: DexSprite | null = null;

/**
 * Dex at x2 in an answer's portrait (the favicon shows instead when Dex is hidden): the latest
 * answer's portrait follows the floating Dex frame by frame, older ones keep a still frame.
 */
function portraitDex(c: Conversation, m: Message): SVGSVGElement {
  const latest = [...c.messages].reverse().find((x) => x.role === "assistant");
  if (latest === m) {
    livePortrait ??= new DexSprite(2);
    return livePortrait.svg;
  }
  portraitTemplate ??= dexStill(2);
  return portraitTemplate.cloneNode(true) as SVGSVGElement;
}

function appendCaret(body: HTMLElement): void {
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  let last: Text | null = null;
  while (walker.nextNode()) {
    const t = walker.currentNode as Text;
    if (t.textContent?.trim() && !t.parentElement?.closest("pre")) last = t;
  }
  const caret = el("span", "caret");
  caret.setAttribute("aria-hidden", "true");
  const host = last?.parentElement && !last.parentElement.closest("pre") ? last.parentElement : body;
  host.appendChild(caret);
}

function resultRow(c: Conversation, m: Message): HTMLElement {
  const meta = m.meta as Meta;
  const row = el("div", "result");
  if (meta.status === "streaming") {
    row.appendChild(el("span", "result-line", m.content ? (meta.context?.length ? `Using ${meta.context.length} passage${meta.context.length === 1 ? "" : "s"} from the library` : "Writing…") : "Working…"));
    return row;
  }
  const v = verdictOf(meta);
  if (v && v.verdict !== "none") {
    const slam = !m.stamped;
    m.stamped = true;
    row.appendChild(stampNode(v.verdict as Exclude<Verdict, "none">, { supported: v.supported, total: v.total, slam, nudgeTarget: slam ? $("column") : null }));
    if (slam && v.verdict === "supported") sfx.verified();
    return row;
  }
  if (meta.mode !== "grounded_only" && meta.grounded && meta.passages?.length && !meta.verify) {
    row.appendChild(el("span", "result-line", meta.sourceLine ?? ""));
    const b = el("button", "btn btn-small act-verify");
    b.type = "button";
    b.append(pixelIcon("shield", 16), el("span", null, verifying === m ? "Verifying…" : "Run verify"));
    b.disabled = verifying === m;
    b.setAttribute("aria-label", "Verify this answer against its sources");
    b.addEventListener("click", () => void verify(c, m));
    row.appendChild(b);
    return row;
  }
  if (meta.verify && "error" in meta.verify) {
    row.appendChild(el("span", "result-line", `Verify failed: ${meta.verify.error}`));
    return row;
  }
  const line = meta.status === "stopped" && !m.content ? "Stopped" : meta.status === "stopped" ? `Stopped · ${meta.sourceLine ?? ""}` : (meta.sourceLine ?? "");
  row.appendChild(el("span", "result-line", line));
  return row;
}

/** KaTeX and highlight.js only when the answer needs them; re-render once they arrive. */
async function loadVendorsFor(c: Conversation, m: Message, li: HTMLElement): Promise<void> {
  const wantMath = needsMath(m.content) && !window.katex;
  const wantCode = needsCode(m.content) && !window.hljs;
  if (!wantMath && !wantCode) return;
  try {
    await Promise.all([wantMath ? ensureKatex(BASE) : null, wantCode ? ensureHljs(BASE) : null]);
  } catch {
    return;
  }
  if (m.node === li && document.body.contains(li) && m.meta?.status !== "streaming") renderAnswer(c, m, li, true);
}

function shortHeading(path: string): string {
  const parts = path.split(" > ");
  return parts.length > 2 ? `${parts[0]} › ${parts[parts.length - 1]}` : parts.join(" › ");
}

function docTitle(p: Passage): string {
  if (p.title) return p.title;
  const coll = state.manifest?.collections.find((c) => c.id === p.source);
  return coll?.sources.find((s) => s.doc_id === p.doc_id)?.title ?? p.heading_path.split(" > ")[0] ?? "Document";
}

function sourceChips(m: Message): HTMLElement {
  const ul = el("ul", "src-chips");
  for (const p of m.meta?.passages ?? []) {
    const li = el("li");
    const b = el("button", "src-chip");
    b.type = "button";
    b.dataset.label = p.label;
    b.appendChild(el("b", null, p.label));
    b.appendChild(el("span", null, `${docTitle(p)} · ${shortHeading(p.heading_path)}`));
    b.title = p.heading_path;
    b.setAttribute("aria-label", `Open source ${p.label}: ${docTitle(p)}, ${p.heading_path}`);
    b.addEventListener("mouseenter", () => linkSource(m, p.label, true));
    b.addEventListener("mouseleave", () => linkSource(m, null, false));
    b.addEventListener("click", () => showEvidence(m, b, p.label));
    li.appendChild(b);
    ul.appendChild(li);
  }
  return ul;
}

function abstainCard(c: Conversation, m: Message): HTMLElement {
  const meta = m.meta as Meta;
  const card = el("section", "over frame");
  card.setAttribute("aria-label", "Not enough evidence");
  const slam = !m.stamped;
  m.stamped = true;
  card.appendChild(stampNode("unsupported", { slam, detail: false }));
  card.appendChild(el("p", "over-title", "Not enough evidence in the library"));
  card.appendChild(el("p", "over-text", "Try Chat mode for a general answer."));
  const retry = el("button", "btn btn-primary");
  retry.type = "button";
  const retryText = el("span");
  retryText.appendChild(ampText("Switch to Chat & retry"));
  retry.append(pixelIcon("regenerate", 16), retryText);
  retry.addEventListener("click", () => {
    setMode(false);
    c.groundedOnly = false;
    regenerate(c);
  });
  if (c.messages[c.messages.length - 1] === m && !state.streaming) card.appendChild(retry);
  if (meta.closest?.length) {
    const d = el("details", "closest");
    d.appendChild(el("summary", null, "Closest sections (below the evidence bar)"));
    const ul = el("ul");
    for (const s of meta.closest) ul.appendChild(el("li", null, `${s.heading_path}${s.pages ? ` (p. ${s.pages})` : ""}`));
    d.appendChild(ul);
    card.appendChild(d);
  }
  return card;
}

const countdowns = new WeakMap<HTMLElement, number>();

function errorCard(c: Conversation, err: StoredError): HTMLElement {
  const card = el("section", "error-card frame");
  card.setAttribute("role", "alert");
  const title = el("p", "error-title");
  title.append(pixelIcon("close", 16), el("span", "error-box", err.title));
  card.appendChild(title);
  const detail = el("p", "error-detail");
  card.appendChild(detail);
  const actions = el("div", "error-actions");
  const retry = el("button", "btn");
  retry.type = "button";
  retry.append(pixelIcon("regenerate", 16), el("span", null, "Retry"));
  retry.addEventListener("click", () => regenerate(c));
  actions.appendChild(retry);
  card.appendChild(actions);
  const update = (): void => {
    if (err.countdown && err.retryAfter !== null) {
      const left = err.retryAfter - (Date.now() - err.at) / 1000;
      if (left > 0) {
        detail.textContent = `Try again in ${formatCountdown(left)}`;
        return;
      }
      detail.textContent = "You can try again now.";
      const t = countdowns.get(card);
      if (t) clearInterval(t);
      return;
    }
    detail.textContent = err.detail ?? "";
    detail.hidden = !err.detail;
  };
  update();
  if (err.countdown) countdowns.set(card, window.setInterval(update, 1000));
  return card;
}

function answerActions(c: Conversation, m: Message): HTMLElement {
  const actions = el("div", "msg-actions");
  const meta = m.meta;
  if (VOICE_OUT && spokenText(m)) actions.appendChild(speakButton(m));
  if (m.content) actions.appendChild(actionButton("Copy", "Copy the answer", "copy", (b) => copyText(m.content, b.querySelector("span") ?? b)));
  if (c.messages[c.messages.length - 1] === m && !state.streaming && !meta?.intent) {
    actions.appendChild(actionButton("Regenerate", "Regenerate the answer", "regenerate", () => regenerate(c)));
  }
  if (!meta?.intent) actions.appendChild(
    actionButton("Share", "Copy a link that pre-fills this question", "share", (b) => {
      const url = buildShareUrl(location.origin, BASE, questionFor(c, m), null);
      copyText(url, b.querySelector("span") ?? b, "Share");
      toast("Link copied. It pre-fills the question; it never sends it.");
    }),
  );
  if (meta?.passages?.length || meta?.mode === "grounded_only") {
    actions.appendChild(actionButton("Evidence", "Show the evidence panel", "evidence", (b) => showEvidence(m, b)));
  }
  if (meta?.intent === "about" && meta.variant?.split("+").includes("how")) {
    actions.appendChild(actionButton("How it works", "Open How it works", "info", () => void openHowItWorks()));
  }
  return actions;
}

/** What reading an answer aloud says: the answer, or the abstention line. */
function spokenText(m: Message): string {
  if (m.content.trim()) return m.content;
  return m.meta?.outcome === "abstained" ? (m.meta.abstentionMessage ?? "There is not enough evidence in the library to answer this.") : "";
}

function speakButton(m: Message): HTMLButtonElement {
  m.id ??= uid();
  const b = actionButton("Speak", "Read the answer aloud", "soundOn", () => void toggleSpeak(m));
  b.classList.add("speak-btn");
  b.dataset.speakId = m.id ?? "";
  syncSpeakButton(b, voice?.speakingId ?? null);
  return b;
}

function syncSpeakButton(b: HTMLElement, speakingId: string | null): void {
  const on = speakingId !== null && b.dataset.speakId === speakingId;
  if (b.dataset.on === String(on)) return;
  b.dataset.on = String(on);
  b.classList.toggle("is-on", on);
  b.setAttribute("aria-label", on ? "Stop reading the answer" : "Read the answer aloud");
  const label = b.querySelector("span");
  if (label) label.textContent = on ? "Stop" : "Speak";
  b.querySelector("svg")?.replaceWith(pixelIcon(on ? "stop" : "soundOn", 16));
}

function syncSpeakButtons(speakingId: string | null): void {
  for (const b of document.querySelectorAll<HTMLElement>(".speak-btn")) syncSpeakButton(b, speakingId);
}

async function toggleSpeak(m: Message): Promise<void> {
  const v = await loadVoice();
  if (!v) return;
  if (v.speakingId === m.id) v.stopSpeaking();
  else readAloud(v, m);
}

function readAloud(v: Voice, m: Message): void {
  m.id ??= uid();
  v.speak(m.id, spokenText(m), () => m.node?.querySelector(".answer, .over") ?? null);
}

// ------------------------------------------------------------------ voice

function loadVoice(): Promise<Voice | null> {
  if (!VOICE_IN && !VOICE_OUT) return Promise.resolve(null);
  voiceLoading ??= import("./voice/voice.ts").then(
    ({ Voice: VoiceController }) => {
      const composer = $<HTMLTextAreaElement>("composer-input");
      voice = new VoiceController(
        {
          composer,
          wrap: composer.parentElement as HTMLElement,
          overlay: $("voice-overlay"),
          finalEl: $("vo-final"),
          interimEl: $("vo-interim"),
          meter: $("voice-meter"),
          micBtn: $<HTMLButtonElement>("mic-btn"),
          hfBtn: $<HTMLButtonElement>("hf-btn"),
          hfChip: $("hf-chip"),
        },
        {
          settings: () => ({ autoSend: state.prefs.autoSend ?? DEFAULTS.autoSend, voiceURI: state.prefs.voiceURI, ...speechTuning(state.prefs), highlight: gameOn(state.prefs) }),
          send: (text) => {
            if (state.streaming) return false;
            void sendMessage(text, { spoken: true });
            return true;
          },
          autosize,
          dex: (e) => dex.send(e),
          dexWord: () => dex.word(),
          error: (text) => {
            toast(text);
            dex.send({ type: "error", kind: "other", message: "I can't hear you right now." });
          },
          announce,
          onSpeaking: (id) => syncSpeakButtons(id),
          onListening: (on) => $("composer").classList.toggle("is-listening", on),
        },
      );
      return voice;
    },
    () => null,
  );
  return voiceLoading;
}

/** The one-time note about the browser's speech service; true once it was accepted. */
function voiceNotice(): Promise<boolean> {
  if (state.prefs.voiceNotice) return Promise.resolve(true);
  const d = $<HTMLDialogElement>("voice-notice");
  if (d.open) return Promise.resolve(false);
  return new Promise((resolve) => {
    let ok = false;
    const accept = (): void => {
      ok = true;
      state.prefs = savePrefs({ voiceNotice: true });
      d.close();
    };
    const cancel = (): void => d.close();
    $("vn-ok").addEventListener("click", accept, { once: true });
    $("vn-cancel").addEventListener("click", cancel, { once: true });
    d.addEventListener(
      "close",
      () => {
        $("vn-ok").removeEventListener("click", accept);
        $("vn-cancel").removeEventListener("click", cancel);
        resolve(ok);
      },
      { once: true },
    );
    d.showModal();
    $("vn-ok").focus();
  });
}

const VOICE_MISSING = "Voice input needs Chrome, Edge or Safari. Typing works too.";

/** Mic button, Ctrl/Cmd+M, a click on Dex, hold-Space, the headset button. */
async function startVoice(mode: "toggle" | "push" | "hands-free"): Promise<void> {
  if (!VOICE_IN) {
    dex.say(VOICE_MISSING);
    return;
  }
  const seen = Boolean(state.prefs.voiceNotice);
  if (!(await voiceNotice())) return;
  const v = await loadVoice();
  if (!v) return;
  if (mode === "hands-free") v.setHandsFree(!v.handsFree);
  else if (mode === "toggle") v.toggleListening();
  else if (seen && spaceHeld && !v.listening) v.listen("push"); // after the note, a fresh press is needed
}

// ------------------------------------------------------------------ evidence panel content

function evidenceContent(c: Conversation, m: Message): DocumentFragment {
  const frag = document.createDocumentFragment();
  const meta = m.meta as Meta;
  frag.appendChild(el("p", "ev-title", "Quest trace"));
  const t = el("div");
  renderTrace(t, traceFor(c, m), { onVerify: meta.grounded && meta.mode !== "grounded_only" && !meta.verify ? () => void verify(c, m) : undefined, verifying: verifying === m });
  frag.appendChild(t);
  const v = verdictOf(meta);
  if (v && v.verdict !== "none") frag.appendChild(stampNode(v.verdict as Exclude<Verdict, "none">, { supported: v.supported, total: v.total }));
  else if (meta.check?.detail && meta.mode === "grounded_only") frag.appendChild(el("p", "ev-empty", meta.check.detail));
  if (meta.verify && !("error" in meta.verify)) {
    frag.appendChild(el("p", "ev-title", `Sentence check · ${meta.verify.supported}/${meta.verify.total} backed`));
    const ul = el("ul", "sentences");
    for (const s of meta.verify.sentences) {
      const li = el("li");
      li.appendChild(el("span", `s-tag ${s.status}`, s.status === "supported" ? "Supported" : "Unsupported"));
      const text = el("span", null, s.text);
      if (s.reasons.length) text.appendChild(el("span", "s-why", s.reasons.join("; ")));
      li.appendChild(text);
      ul.appendChild(li);
    }
    frag.appendChild(ul);
  }
  const passages = meta.passages ?? [];
  frag.appendChild(el("p", "ev-title", passages.length ? `Sources · ${passages.length}` : "Sources"));
  if (!passages.length) {
    frag.appendChild(el("p", "ev-empty", meta.mode === "grounded_only" && meta.outcome === "abstained" ? "No passage cleared the evidence bar, so none is cited." : "This answer cites no passages."));
    return frag;
  }
  const terms = queryTerms(questionFor(c, m));
  const list = el("div", "source-list");
  for (const p of passages) list.appendChild(sourceCard(m, p, terms));
  frag.appendChild(list);
  return frag;
}

function segBar(fraction: number): HTMLElement {
  const bar = el("span", "seg-bar");
  bar.setAttribute("aria-hidden", "true");
  const n = Math.round(Math.max(0, Math.min(1, fraction)) * 10);
  for (let i = 0; i < 10; i++) bar.appendChild(el("i", i < n ? "on" : null));
  return bar;
}

function sourceCard(m: Message, p: Passage, terms: string[]): HTMLElement {
  const card = el("article", "source-card frame");
  card.dataset.label = p.label;
  const head = el("button", "source-head");
  head.type = "button";
  head.setAttribute("aria-expanded", "false");
  head.appendChild(el("span", "source-label", p.label));
  const meta = el("span", "source-meta");
  meta.appendChild(el("span", "source-title", docTitle(p)));
  const section = p.heading_path.split(" > ").slice(1).join(" › ");
  meta.appendChild(el("span", "source-section", `${section || p.heading_path}${p.pages ? ` · p. ${p.pages}` : ""}`));
  head.appendChild(meta);
  const chev = el("span", "source-chevron");
  chev.appendChild(pixelIcon("chevron", 16));
  head.appendChild(chev);
  card.appendChild(head);
  const tags = el("div", "source-tags");
  const tag = el("span", "tag");
  const tagText = el("span");
  tagText.appendChild(ampText(libraryTag(p.source, state.manifest?.collections)));
  tag.append(pixelIcon(SUBJECT_ICONS[p.source] ?? "book", 16), tagText);
  tags.appendChild(tag);
  card.appendChild(tags);
  const body = el("div", "source-body");
  const ex = el("div", "source-excerpt");
  ex.appendChild(markTerms(excerpt(p.text, terms), terms));
  body.appendChild(ex);
  card.appendChild(body);
  if (typeof p.score === "number" && Number.isFinite(p.score)) {
    const rel = el("div", "relevance");
    rel.appendChild(segBar(p.score));
    const margin = typeof p.margin === "number" ? ` · ${p.margin >= 0 ? "+" : ""}${p.margin.toFixed(3)}` : "";
    rel.appendChild(el("span", "score-num", `cos ${p.score.toFixed(3)}${margin}`));
    rel.setAttribute("aria-label", `Relevance: cosine ${p.score.toFixed(3)}${typeof p.margin === "number" ? `, margin ${p.margin.toFixed(3)} over the library's threshold` : ""}`);
    card.appendChild(rel);
  }
  card.addEventListener("mouseenter", () => linkSource(m, p.label, false));
  card.addEventListener("mouseleave", () => linkSource(m, null, false));
  head.addEventListener("click", () => {
    const open = card.classList.toggle("is-open");
    head.setAttribute("aria-expanded", open ? "true" : "false");
    const before = body.getBoundingClientRect().height;
    ex.textContent = "";
    ex.classList.toggle("source-full", open);
    ex.appendChild(open ? markTerms(p.text, terms) : markTerms(excerpt(p.text, terms), terms));
    const after = body.getBoundingClientRect().height;
    if (!reducedMotion() && before !== after) {
      body.style.height = `${before}px`;
      body.style.overflow = "hidden";
      springTo(body, { height: [`${before}px`, `${after}px`] }, {
        onComplete: () => {
          body.style.height = "";
          body.style.overflow = "";
        },
      });
    }
  });
  return card;
}

function showEvidence(m: Message, opener?: HTMLElement | null, label?: string): void {
  const c = current();
  if (!c) return;
  state.evidenceFor = m;
  evidence.setContent(evidenceContent(c, m));
  evidence.show(opener ?? null, label ? "full" : "half");
  if (label) requestAnimationFrame(() => evidence.openCard(label));
}

function refreshEvidence(): void {
  const c = current();
  const m = state.evidenceFor;
  if (!c || !m || !evidence.open) return;
  evidence.setContent(evidenceContent(c, m));
}

// ------------------------------------------------------------------ scrolling

function nearBottom(): boolean {
  const s = $("scroller");
  return s.scrollHeight - s.scrollTop - s.clientHeight < 80;
}

function scrollToBottom(force: boolean): void {
  const s = $("scroller");
  if (force || state.autoScroll) {
    s.scrollTop = s.scrollHeight;
    state.autoScroll = true;
    $("jump").hidden = true;
  }
}

// ------------------------------------------------------------------ sending

function historyFor(c: Conversation): Turn[] {
  const out: Turn[] = [];
  for (const m of c.messages) {
    const meta = m.meta;
    if (m.role === "assistant" && (!m.content || meta?.error || meta?.status === "streaming")) continue;
    const content = m.role === "assistant" ? m.content.replace(/[ \t]*\[C\d{1,3}\]/g, "") : m.content;
    if (content.trim()) out.push({ role: m.role, content: content.slice(0, 4000) });
  }
  return out.slice(-40);
}

function setBusy(busy: boolean): void {
  $("stop-btn").hidden = !busy;
  $("send-btn").hidden = busy;
  $<HTMLButtonElement>("stop-btn").disabled = false;
  for (const q of $("quest-list").querySelectorAll<HTMLButtonElement>(".quest")) q.disabled = busy;
  setText($("key-hint"), busy ? "Esc to stop" : "Enter to send · Shift+Enter for a new line · / to focus");
}

let renderPending = false;

/** Render the streaming answer on the next frame; the typewriter advances in chunks that catch up. */
function scheduleRender(c: Conversation, m: Message): void {
  if (renderPending) return;
  renderPending = true;
  requestAnimationFrame(() => {
    renderPending = false;
    const s = state.streaming;
    let more = false;
    if (s && s.msg === m) {
      const target = m.content.length;
      if (reducedMotion()) s.shown = target;
      else if (s.shown < target) {
        s.shown = Math.min(target, s.shown + Math.max(3, Math.ceil((target - s.shown) / 4)));
        sfx.tick();
      }
      more = s.shown < target;
    }
    if (m.node) renderAnswer(c, m, m.node, false);
    scrollToBottom(false);
    if (more) scheduleRender(c, m);
  });
}

async function sendMessage(text: string, opts: { spoken?: boolean } = {}): Promise<void> {
  const value = text.trim();
  if (!value || state.streaming) return;
  voice?.stopSpeaking();
  const c = ensureConversation();
  c.groundedOnly = groundedOnly();
  // a failed exchange is replaced by the resend: the question was kept in the composer
  const last = c.messages[c.messages.length - 1];
  if (last?.role === "assistant" && last.meta?.error) {
    c.messages.pop();
    if (c.messages[c.messages.length - 1]?.role === "user") c.messages.pop();
  }
  if (!c.title) {
    c.title = value.replace(/\s+/g, " ").slice(0, 60);
    updateTitle();
  }
  const question: Message = { id: uid(), role: "user", content: value };
  if (opts.spoken && question.id) spokenQuestions.add(question.id);
  c.messages.push(question);
  c.updated = Date.now();
  sfx.send();
  await runAssistant(c);
}

async function runAssistant(c: Conversation): Promise<void> {
  const a = state.assistant;
  // questions about VeriDex and small talk skip retrieval: their trace is the draft alone
  const meta0 = classifyIntent(questionForNext(c)) !== "normal";
  const m: Message = {
    id: uid(),
    role: "assistant",
    content: "",
    meta: {
      status: "streaming",
      statusText: meta0 ? "…" : !state.modelReady ? "Will send when the library is ready…" : c.groundedOnly ? "Searching and checking the library…" : "Searching the library…",
      trace: meta0 ? initialTrace(false, true, true) : initialTrace(c.groundedOnly),
      ...(meta0 ? { intent: classifyIntent(questionForNext(c)) as "about" | "smalltalk" } : {}),
    },
  };
  c.messages.push(m);
  saveAll();
  renderConversationList();
  renderMessages();
  scrollToBottom(true);
  const controller = new AbortController();
  state.streaming = { controller, conv: c, msg: m, shown: 0 };
  setBusy(true);
  announce("VeriDex is answering.");
  const meta = m.meta as Meta;
  if (!meta0 && state.manifest) dex.send({ type: "search", passages: libraryTotals(state.manifest).passages });
  try {
    if (!a) throw new ProxyError("loading", "The page is still loading.", 0);
    const out: ChatOutcome = await a.chat(
      { turns: historyFor(c), groundedOnly: c.groundedOnly, summary: c.summary, suggestion: game.quests().find((x) => !x.done)?.quest.q ?? null, dex: state.prefs.dex ?? DEFAULTS.dex },
      {
        onContext: (grounded, passages) => {
          meta.context = passages;
          meta.statusText = grounded ? `Found ${passages.length} passage${passages.length === 1 ? "" : "s"} in the library…` : "No evidence in the library; answering from general knowledge…";
          dex.send(grounded ? { type: "found", sources: new Set(passages.map((p) => p.doc_id)).size } : { type: "no-evidence" });
          scheduleRender(c, m);
        },
        onToken: (t) => {
          m.content += t;
          scheduleRender(c, m);
        },
        onRestart: () => {
          m.content = "";
          if (state.streaming?.msg === m) state.streaming.shown = 0;
          scheduleRender(c, m);
        },
        onStatus: (s) => {
          meta.statusText = s;
          scheduleRender(c, m);
        },
        onStage: (e: StageEvent) => {
          meta.trace = applyStage(meta.trace ?? [], e);
          if (e.status === "active" && (e.stage === "draft" || e.stage === "synth")) dex.send({ type: "draft" });
          scheduleRender(c, m);
        },
      },
      controller.signal,
    );
    m.content = out.answer;
    Object.assign(meta, {
      mode: out.mode,
      grounded: out.grounded,
      sourceLine: out.stopped && !out.answer ? "" : out.sourceLine,
      citations: out.citations,
      passages: out.passages,
      context: out.context,
      notices: answerNotices(out.passages, out.context, out.answer, state.manifest?.collections ?? []),
      outcome: out.outcome,
      closest: out.closest,
      abstentionMessage: out.abstentionMessage,
      check: out.check,
      intent: out.intent,
      variant: out.variant,
      identityFix: out.identityFix,
    });
    if (out.summary) c.summary = out.summary;
    meta.status = out.stopped ? "stopped" : "done";
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") meta.status = "stopped";
    else {
      meta.status = "error";
      meta.error = { ...describeError(err), at: Date.now() };
      sfx.error();
      const box = $<HTMLTextAreaElement>("composer-input");
      if (!box.value.trim()) {
        box.value = questionFor(c, m);
        autosize();
      }
    }
  }
  meta.trace = finishTrace(meta.trace ?? []);
  finishMessage(c, m);
}

/** The question the next answer will reply to (the last user message). */
function questionForNext(c: Conversation): string {
  for (let i = c.messages.length - 1; i >= 0; i--) {
    const q = c.messages[i];
    if (q?.role === "user") return q.content;
  }
  return "";
}

function finishMessage(c: Conversation, m: Message): void {
  const meta = m.meta as Meta;
  delete meta.statusText;
  state.streaming = null;
  setBusy(false);
  c.updated = Date.now();
  saveAll();
  renderMessages();
  renderConversationList();
  scrollToBottom(false);
  const v = verdictOf(meta);
  const verdictText = v ? `${stampLabel(v.verdict).label}. ${stampLabel(v.verdict, v.supported, v.total).detail}.` : (meta.sourceLine ?? "");
  announce(meta.error ? `${meta.error.title} ${meta.error.detail ?? ""}` : meta.outcome === "abstained" ? "Not enough evidence in the library to answer this." : `Answer finished. ${verdictText}`);
  const ok = meta.status === "done" && !meta.error && meta.outcome !== "abstained" && m.content.trim().length > 0;
  const ev = game.answer({
    id: m.id ?? uid(),
    ok,
    asked: ok || (meta.status === "done" && meta.outcome === "abstained"),
    grounded: Boolean(meta.grounded),
    verified: v?.verdict === "supported",
    libraries: libsOf(meta.passages),
    question: questionFor(c, m),
  });
  dexReact(meta, v);
  playGame(ev, m.node?.querySelector<HTMLElement>(".dbox, .over") ?? m.node);
  afterAnswer(c, m);
  if (meta.passages?.length && evidence.mode() === "panel" && !evidence.open && state.evidenceFor === null && !meta.error) {
    // desktop: the evidence slides in on its own for the first cited answer
    showEvidence(m, null);
  } else if (state.evidenceFor && evidence.open) refreshEvidence();
}

/** Dex's reaction to a finished answer. */
function dexReact(meta: Meta, v: ReturnType<typeof verdictOf>): void {
  if (meta.error) {
    const e = meta.error;
    const left = e.retryAfter === null ? null : e.retryAfter - (Date.now() - e.at) / 1000;
    dex.send(e.kind === "rate" ? { type: "error", kind: "rate", ...(left === null ? {} : { wait: formatCountdown(left) }) } : { type: "error", kind: "other", message: e.title });
  } else if (meta.outcome === "abstained") dex.send({ type: "abstain" });
  else if (v?.verdict === "supported") dex.send({ type: "verified", supported: v.supported ?? 0, total: v.total ?? 0 });
  else if (meta.intent && meta.status === "done") dex.send({ type: "greet" }); // replies about VeriDex: the greeting pose
  else dex.send({ type: "answer", kind: meta.status === "stopped" ? "stopped" : meta.intent ? "local" : meta.grounded ? "grounded" : "general" });
}

/** Read the answer aloud when asked to (spoken question, every answer, hands-free), else keep listening. */
function afterAnswer(c: Conversation, m: Message): void {
  const meta = m.meta as Meta;
  if (meta.error || meta.status !== "done") {
    if (meta.error) voice?.setHandsFree(false);
    return;
  }
  const q = [...c.messages].reverse().find((x) => x.role === "user");
  const spoken = Boolean(q?.id && spokenQuestions.has(q.id));
  const p = state.prefs;
  const read = VOICE_OUT && spokenText(m) && ((p.autoRead ?? DEFAULTS.autoRead) || (spoken && (p.readSpoken ?? DEFAULTS.readSpoken)) || voice?.handsFree);
  if (read) void loadVoice().then((v) => v && readAloud(v, m));
  else voice?.resume();
}

function stopStreaming(): void {
  state.streaming?.controller.abort();
}

function regenerate(c: Conversation): void {
  if (state.streaming) return;
  if (c.messages[c.messages.length - 1]?.role === "assistant") c.messages.pop();
  if (c.messages[c.messages.length - 1]?.role !== "user") return;
  c.groundedOnly = groundedOnly();
  void runAssistant(c);
}

function startEdit(c: Conversation, m: Message, li: HTMLElement): void {
  const box = el("div", "edit-box");
  const area = el("textarea");
  area.id = `edit-${uid()}`;
  const label = el("label", "visually-hidden", "Edit your question");
  label.htmlFor = area.id;
  area.value = m.content;
  area.maxLength = 4000;
  const row = el("div", "edit-row");
  const cancel = el("button", "btn", "Cancel");
  cancel.type = "button";
  const save = el("button", "btn btn-primary", "Save and send");
  save.type = "button";
  row.append(cancel, save);
  box.append(label, area, row);
  li.textContent = "";
  li.appendChild(box);
  area.focus();
  cancel.addEventListener("click", () => renderMessages());
  const submit = (): void => {
    const v = area.value.trim();
    if (!v) return;
    c.messages.length = c.messages.indexOf(m);
    c.messages.push({ id: uid(), role: "user", content: v });
    c.groundedOnly = groundedOnly();
    void runAssistant(c);
  };
  save.addEventListener("click", submit);
  area.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") renderMessages();
  });
}

async function verify(c: Conversation, m: Message): Promise<void> {
  const a = state.assistant;
  const meta = m.meta;
  if (!a || !meta || verifying) return;
  verifying = m;
  if (m.node) renderAnswer(c, m, m.node, true);
  refreshEvidence();
  const t0 = performance.now();
  try {
    meta.verify = await a.verify(questionFor(c, m) || "(question)", m.content, meta.passages ?? []);
  } catch (err) {
    meta.verify = { error: err instanceof Error ? err.message : "The verification failed. Try again." };
  }
  meta.verifyMs = performance.now() - t0;
  verifying = null;
  m.stamped = false;
  saveAll();
  if (m.node) renderAnswer(c, m, m.node, true);
  refreshEvidence();
  const v = meta.verify;
  announce("error" in v ? v.error : `Verification finished: ${v.supported} of ${v.total} sentences backed by sources.`);
  if ("error" in v) dex.send({ type: "error", kind: "other", message: "The check failed. Try again." });
  else dex.send(v.total > 0 && v.supported === v.total ? { type: "verified", supported: v.supported, total: v.total } : { type: "partial", supported: v.supported, total: v.total });
  if (!("error" in v)) {
    const ev = game.verify({ id: m.id ?? uid(), grounded: Boolean(meta.grounded), allSupported: v.total > 0 && v.supported === v.total, libraries: libsOf(meta.passages) });
    playGame(ev, m.node?.querySelector<HTMLElement>(".dbox"));
  }
}

// ------------------------------------------------------------------ uploads

function renderUploads(): void {
  const list = $("upload-list");
  list.textContent = "";
  const store = state.assistant?.uploads as UploadStore | undefined;
  for (const d of store?.docs ?? []) {
    const li = el("li", "upload-item");
    li.appendChild(el("span", "name", d.name));
    li.appendChild(el("span", "meta", `${d.pages} p.`));
    const del = el("button", "icon-btn");
    del.type = "button";
    del.setAttribute("aria-label", `Remove ${d.name}`);
    del.appendChild(pixelIcon("close", 16));
    del.addEventListener("click", () => {
      store?.remove(d.docId);
      uploadStatus(`${d.name} removed.`, null, false);
      renderUploads();
    });
    li.appendChild(del);
    list.appendChild(li);
  }
  const max = state.manifest?.uploads.max_files ?? 3;
  const full = state.uploading || !store || store.docs.length >= max;
  $<HTMLButtonElement>("upload-btn").disabled = full;
  $<HTMLButtonElement>("attach-btn").disabled = full;
}

function uploadStatus(text: string, pct: number | null, isError: boolean): void {
  $("upload-status").classList.toggle("error", isError);
  $("upload-text").textContent = text;
  const bar = $<HTMLProgressElement>("upload-bar");
  bar.hidden = pct === null;
  if (pct !== null) bar.value = Math.max(0, Math.min(100, pct));
}

async function uploadFile(file: File): Promise<void> {
  const a = state.assistant;
  if (!a) return;
  const store = a.uploads as UploadStore;
  state.uploading = true;
  renderUploads();
  uploadStatus(`Reading ${file.name}…`, 0, false);
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await a.library.ready;
    const doc = await store.add({ name: file.name, bytes }, a.library, (stage, done, total) => {
      const label = stage === "reading" ? "Reading pages" : "Indexing passages";
      uploadStatus(`${label} ${done}/${total}…`, total ? (100 * done) / total : null, false);
    });
    uploadStatus(`${doc.name} is ready (${doc.source.chunks.length} passages). It is searched with the library.`, null, false);
    toast(`${doc.name} is ready to search.`);
    announce(`${doc.name} is ready.`);
    playGame(game.pdf(), null);
  } catch (err) {
    uploadStatus(err instanceof UploadError ? err.message : `The PDF could not be processed${err instanceof Error ? `: ${err.message}` : ""}.`, null, true);
  }
  state.uploading = false;
  renderUploads();
}

// ------------------------------------------------------------------ about, settings, achievements

function renderAbout(): void {
  const root = $("about-sources");
  root.textContent = "";
  const m = state.manifest;
  if (!m) {
    root.appendChild(el("p", null, "The library is still loading."));
    return;
  }
  const t = libraryTotals(m);
  const f = VERIDEX_FACTS;
  const lib = libraryFacts(m);
  const who = el("section", "about-group");
  const wh = el("h3");
  wh.append(pixelIcon("shield", 16), el("span", null, f.name));
  who.appendChild(wh);
  who.appendChild(el("p", "about-intro", `${f.tagline} ${f.name} is ${f.project} built by ${f.builtBy}: an app built around ${f.model}, an open-weight language model served through ${f.provider} via a proxy. It is not ChatGPT and is not made by an AI lab.`));
  for (const [title, items] of [
    ["What it can do", f.capabilities.map((x) => x)],
    ["Limits", limitationsText()],
  ] as [string, string[]][]) {
    who.appendChild(el("p", "ev-title", title));
    const ul = el("ul", "about-list");
    for (const x of items) ul.appendChild(el("li", null, `${x[0]?.toUpperCase()}${x.slice(1)}.`));
    who.appendChild(ul);
  }
  root.appendChild(who);
  root.appendChild(el("p", "about-intro", `One assistant searches all ${t.books} books and ${t.passages.toLocaleString("en-US")} passages at once (${lib.subjects.length} subjects), plus any PDF you add. This is what is in the library, by subject: excerpts of the editions below, cleaned and split into passages, each under its own licence. Each source card under an answer names the library it came from.`));
  for (const c of m.collections) {
    const sec = el("section", "about-group");
    const h = el("h3");
    const hText = el("span");
    hText.appendChild(ampText(`${c.label} · ${c.count.toLocaleString("en-US")} passages`));
    h.append(pixelIcon(SUBJECT_ICONS[c.id] ?? "book", 16), hText);
    sec.appendChild(h);
    if (c.notice) sec.appendChild(el("p", "set-hint", c.notice));
    const ul = el("ul", "about-list");
    for (const s of c.sources) {
      const li = el("li");
      li.appendChild(el("strong", null, s.title || "Document"));
      if (s.authors) li.appendChild(document.createTextNode(` — ${s.authors}`));
      if (s.edition) li.appendChild(document.createTextNode(` (${s.edition})`));
      li.appendChild(document.createTextNode(". Licence: "));
      if (s.licence_url && SAFE_URL.test(s.licence_url)) {
        const link = el("a", null, s.licence || s.licence_url);
        link.href = s.licence_url;
        link.rel = "noopener noreferrer";
        link.target = "_blank";
        li.appendChild(link);
      } else li.appendChild(document.createTextNode(s.licence || "as stated in the source"));
      if (s.source_url && SAFE_URL.test(s.source_url)) {
        li.appendChild(document.createTextNode(". "));
        const link = el("a", null, "Source");
        link.href = s.source_url;
        link.rel = "noopener noreferrer";
        link.target = "_blank";
        li.appendChild(link);
      }
      ul.appendChild(li);
    }
    sec.appendChild(ul);
    root.appendChild(sec);
  }
}

function openAbout(): void {
  renderAbout();
  $<HTMLDialogElement>("about").showModal();
}

function syncSettings(): void {
  const p = state.prefs;
  $<HTMLInputElement>(p.theme === "light" ? "set-day" : "set-night").checked = true;
  $<HTMLInputElement>((p.text ?? DEFAULTS.text) === "clean" ? "set-clean" : "set-pixel").checked = true;
  $<HTMLInputElement>("set-crt").checked = p.crt ?? DEFAULTS.crt;
  $<HTMLInputElement>("set-game").checked = p.game ?? DEFAULTS.game;
  $<HTMLInputElement>("set-sound").checked = p.sound ?? DEFAULTS.sound;
  $<HTMLInputElement>("set-tick").checked = p.tick ?? DEFAULTS.tick;
  $<HTMLInputElement>("set-tick").disabled = !(p.sound ?? DEFAULTS.sound);
  $<HTMLInputElement>("set-volume").value = String(p.volume ?? DEFAULTS.volume);
  $<HTMLInputElement>("set-volume").disabled = !(p.sound ?? DEFAULTS.sound);
  $<HTMLInputElement>("set-dex").checked = p.dex ?? DEFAULTS.dex;
  $<HTMLInputElement>(`set-dex-${p.dexSize ?? DEFAULTS.dexSize}`).checked = true;
  $<HTMLInputElement>("set-intro").checked = p.intro ?? DEFAULTS.intro;
  $<HTMLInputElement>("set-autosend").checked = p.autoSend ?? DEFAULTS.autoSend;
  $<HTMLInputElement>("set-readspoken").checked = p.readSpoken ?? DEFAULTS.readSpoken;
  $<HTMLInputElement>("set-autoread").checked = p.autoRead ?? DEFAULTS.autoRead;
  $<HTMLInputElement>("set-robot").checked = p.robot ?? DEFAULTS.robot;
  const rate = p.rate ?? DEFAULTS.rate;
  const pitch = p.pitch ?? DEFAULTS.pitch;
  $<HTMLInputElement>("set-rate").value = String(rate);
  $<HTMLInputElement>("set-pitch").value = String(pitch);
  setText($("set-rate-out"), `${rate.toFixed(2)}x`);
  setText($("set-pitch-out"), pitch.toFixed(2));
}

/** Fill the voice list (English voices; the browser loads them late, so this runs again on voiceschanged). */
function fillVoices(v: Voice): void {
  const select = $<HTMLSelectElement>("set-voice");
  const voices = v.voices();
  const chosen = state.prefs.voiceURI ?? "";
  select.textContent = "";
  select.appendChild(new Option("Automatic (Indian or British English)", ""));
  for (const x of voices) select.appendChild(new Option(`${x.name} (${x.lang})`, x.voiceURI, false, x.voiceURI === chosen));
  select.value = voices.some((x) => x.voiceURI === chosen) ? chosen : "";
}

function setupVoiceSettings(): void {
  const note = $("voice-unsupported");
  const lines: string[] = [];
  if (!VOICE_IN) lines.push("Voice input needs speech recognition, which Chrome, Edge and Safari have and Firefox does not. Typing works everywhere.");
  if (!VOICE_OUT) lines.push("This browser can't read answers aloud.");
  note.textContent = lines.join(" ");
  note.hidden = lines.length === 0;
  for (const row of document.querySelectorAll<HTMLElement>("[data-voice]")) row.hidden = row.dataset.voice === "in" ? !VOICE_IN : !VOICE_OUT;
  if (VOICE_OUT) {
    window.speechSynthesis.addEventListener?.("voiceschanged", () => {
      if (voice) fillVoices(voice);
    });
  }
}

function openSettings(): void {
  syncSettings();
  $<HTMLDialogElement>("settings").showModal();
  if (VOICE_OUT) void loadVoice().then((v) => v && fillVoices(v));
}

function setPrefs(update: Prefs): void {
  state.prefs = savePrefs(update);
  applyPrefs(state.prefs);
  if ("dexSize" in update || "dex" in update) dex.resize();
  syncThemeButtons();
  syncSettings();
  positionBlockCursor();
}

async function openAchievementsView(): Promise<void> {
  const { openAchievements } = await import("./ui/achievements-view.ts");
  openAchievements(ACHIEVEMENTS, game.state.unlocked, game.counts());
}

function syncThemeButtons(): void {
  const light = currentTheme() === "light";
  $("theme-toggle").setAttribute("aria-label", themeToggleLabel());
  setText($("theme-label"), light ? "Night" : "Day");
  setIcon($("theme-icon"), light ? "moon" : "sun");
}

function toggleTheme(): void {
  setPrefs({ theme: currentTheme() === "light" ? "dark" : "light" });
}

async function openCommandPalette(): Promise<void> {
  const { openPalette } = await import("./ui/palette.ts");
  const items = [];
  items.push({ id: "new", group: "Actions", label: "New quest", kbd: `${modKey} ⇧ O`, icon: "plus", run: () => newConversation() });
  items.push({ id: "settings", group: "Actions", label: "Settings", icon: "settings", run: () => openSettings() });
  items.push({ id: "achievements", group: "Actions", label: "Achievements", icon: "trophy", run: () => void openAchievementsView() });
  items.push({ id: "theme", group: "Actions", label: currentTheme() === "light" ? "Switch to the night theme" : "Switch to the day theme", icon: currentTheme() === "light" ? "moon" : "sun", run: () => toggleTheme() });
  items.push({ id: "text", group: "Actions", label: (state.prefs.text ?? "pixel") === "clean" ? "Use pixel text" : "Use clean text", icon: "book", run: () => setPrefs({ text: (state.prefs.text ?? "pixel") === "clean" ? "pixel" : "clean" }) });
  items.push({ id: "pdf", group: "Actions", label: "Add a PDF", icon: "upload", run: () => $("file-input").click() });
  items.push({ id: "how", group: "Actions", label: "How it works", icon: "info", run: () => void openHowItWorks() });
  items.push({ id: "about", group: "Actions", label: "About & sources", icon: "book", run: () => openAbout() });
  items.push({ id: "shortcuts", group: "Actions", label: "Keyboard shortcuts", icon: "keyboard", run: () => undefined });
  if (document.fullscreenEnabled) items.push({ id: "fullscreen", group: "Actions", label: document.fullscreenElement ? "Leave fullscreen" : "Fullscreen", icon: "collapse", run: () => void toggleFullscreen() });
  items.push({ id: "intro", group: "Actions", label: "Play the intro", icon: "star", run: () => void playIntroNow() });
  items.push({ id: "dex-home", group: "Actions", label: "Reset Dex position", icon: "regenerate", run: () => dex.mover.goHome() });
  items.push({ id: "repo", group: "Actions", label: "GitHub repository", hint: REPO.replace("https://", ""), icon: "github", run: () => window.open(REPO, "_blank", "noopener,noreferrer") });
  for (const { quest, done } of game.quests()) {
    items.push({ id: `quest:${quest.id}`, group: "Daily quests", label: quest.q, hint: done ? "Done today" : "+20 XP", icon: SUBJECT_ICONS[quest.subject] ?? "star", run: () => void sendMessage(quest.q) });
  }
  for (const c of [...state.conversations].sort((a, b) => (b.updated || 0) - (a.updated || 0)).slice(0, 30)) {
    items.push({ id: `chat:${c.id}`, group: "History", label: c.title || "New quest", hint: groupTitle(c.updated || 0), icon: "history", run: () => openConversation(c.id) });
  }
  openPalette(items);
}

/** Fullscreen only when the visitor asks for it (Settings, the palette); never automatically. */
async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    toast("This browser did not allow fullscreen.");
  }
}

async function openHowItWorks(): Promise<void> {
  const { openHow } = await import("./ui/how.ts");
  openHow(REPO);
}

async function closeTopOverlay(): Promise<boolean> {
  if (dismissLevelUp()) return true;
  for (const id of ["about", "settings"]) {
    const d = $<HTMLDialogElement>(id);
    if (d.open) {
      d.close();
      return true;
    }
  }
  if (document.querySelector("dialog.palette[open], dialog.how[open], dialog.achievements[open]")) {
    const [{ closePalette }, { closeHow }, { closeAchievements }] = await Promise.all([import("./ui/palette.ts"), import("./ui/how.ts"), import("./ui/achievements-view.ts")]);
    if (closePalette() || closeHow() || closeAchievements()) return true;
  }
  if (evidence.open && evidence.mode() !== "panel") {
    evidence.hide();
    return true;
  }
  if ($("rail").classList.contains("open")) {
    closeRailDrawer();
    return true;
  }
  return false;
}

// ------------------------------------------------------------------ composer and wiring

function autosize(): void {
  const box = $<HTMLTextAreaElement>("composer-input");
  box.style.height = "auto";
  const line = Number.parseFloat(getComputedStyle(box).lineHeight) || 28;
  box.style.height = `${Math.min(box.scrollHeight, line * 8 + 28)}px`;
  const n = box.value.length;
  const max = state.manifest?.limits.max_message_chars ?? 4000;
  setText($("char-count"), n > max * 0.85 ? `${n} / ${max}` : "");
  box.parentElement?.classList.toggle("has-text", n > 0);
}

/** Put the blinking block cursor right after the placeholder text. */
function positionBlockCursor(): void {
  const box = $<HTMLTextAreaElement>("composer-input");
  const cursor = $("block-cursor");
  const probe = el("span", null, box.placeholder);
  const cs = getComputedStyle(box);
  probe.style.font = cs.font;
  probe.style.letterSpacing = cs.letterSpacing;
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.whiteSpace = "pre";
  document.body.appendChild(probe);
  const w = probe.getBoundingClientRect().width;
  probe.remove();
  cursor.style.left = `${Math.round(Number.parseFloat(cs.paddingLeft) + w + 2)}px`;
  cursor.style.top = `${Math.round(Number.parseFloat(cs.paddingTop) + 4)}px`;
}

function wire(): void {
  $("composer").addEventListener("submit", (e) => {
    e.preventDefault();
    const box = $<HTMLTextAreaElement>("composer-input");
    const text = box.value;
    if (!text.trim() || state.streaming) return;
    box.value = "";
    autosize();
    void sendMessage(text);
  });
  $("composer-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      $<HTMLFormElement>("composer").requestSubmit();
    }
  });
  $("composer-input").addEventListener("input", autosize);
  $("stop-btn").addEventListener("click", () => {
    stopStreaming();
    voice?.stopSpeaking();
  });
  $("mic-btn").addEventListener("click", () => void startVoice("toggle"));
  $("hf-btn").addEventListener("click", () => void startVoice("hands-free"));
  $("dex").title = VOICE_IN ? `Talk to Dex (${modKey}+M). Drag to move him.` : "Dex, VeriDex's guide. Drag to move him.";
  wireRailSwipe();
  window.matchMedia("(width >= 1100px)").addEventListener?.("change", () => {
    if (railDocked()) closeRailDrawer();
  });
  $("new-chat").addEventListener("click", () => {
    newConversation();
    closeRailDrawer();
  });
  $("wordmark").addEventListener("click", (e) => {
    e.preventDefault();
    newConversation();
    closeRailDrawer();
  });
  for (const r of $("mode-control").querySelectorAll<HTMLInputElement>(".seg-input")) {
    r.addEventListener("change", () => {
      placeSegIndicator(true);
      const c = current();
      if (c) {
        c.groundedOnly = groundedOnly();
        saveAll();
      }
      state.prefs = savePrefs({ mode: groundedOnly() ? "grounded" : "chat" });
    });
  }
  $("upload-btn").addEventListener("click", () => $("file-input").click());
  $("attach-btn").addEventListener("click", () => $("file-input").click());
  $("file-input").addEventListener("change", () => {
    const input = $<HTMLInputElement>("file-input");
    const f = input.files?.[0];
    input.value = "";
    if (f) void uploadFile(f);
  });
  $("pdf-toggle").addEventListener("click", () => {
    const open = $("pdf-toggle").getAttribute("aria-expanded") !== "true";
    $("pdf-toggle").setAttribute("aria-expanded", open ? "true" : "false");
    $("pdf-body").hidden = !open;
    state.prefs = savePrefs({ pdfOpen: open });
  });
  $("open-rail").addEventListener("click", openRailDrawer);
  $("rail-close").addEventListener("click", () => closeRailDrawer());
  $("rail-collapse").addEventListener("click", () => setRailCollapsed($("app").dataset.rail !== "collapsed"));
  // the composer moves when the rail docks or the evidence panel opens: Dex's home moves with it
  new MutationObserver(() => window.setTimeout(() => dex.mover.layout(), 420)).observe($("app"), { attributes: true, attributeFilter: ["data-rail", "data-evidence"] });
  new ResizeObserver(() => dex.mover.layout()).observe($("dock"));
  $("scrim").addEventListener("click", () => {
    closeRailDrawer();
    if (evidence.open && evidence.mode() !== "panel") evidence.hide();
  });
  $("evidence-close").addEventListener("click", () => evidence.hide());
  $("evidence-toggle").addEventListener("click", (e) => {
    if (evidence.open) evidence.hide();
    else {
      const c = current();
      const m = [...(c?.messages ?? [])].reverse().find((x) => x.meta?.passages?.length || x.meta?.mode === "grounded_only");
      if (m) showEvidence(m, e.currentTarget as HTMLElement);
    }
  });
  $("about-btn").addEventListener("click", openAbout);
  $("about-close").addEventListener("click", () => $<HTMLDialogElement>("about").close());
  $("settings-btn").addEventListener("click", openSettings);
  $("settings-top").addEventListener("click", openSettings);
  $("settings-close").addEventListener("click", () => $<HTMLDialogElement>("settings").close());
  for (const d of [$<HTMLDialogElement>("about"), $<HTMLDialogElement>("settings")]) {
    let opener: Element | null = null;
    d.addEventListener("click", (e) => {
      if (e.target === d) d.close();
    });
    d.addEventListener("close", () => {
      if (opener instanceof HTMLElement && document.body.contains(opener)) opener.focus();
      opener = null;
    });
    const show = d.showModal.bind(d);
    d.showModal = () => {
      opener = document.activeElement;
      show();
    };
  }
  $("ach-btn").addEventListener("click", () => void openAchievementsView());
  $("how-btn").addEventListener("click", () => void openHowItWorks());
  $("theme-toggle").addEventListener("click", toggleTheme);
  // settings
  for (const id of ["set-night", "set-day"]) $(id).addEventListener("change", (e) => setPrefs({ theme: (e.target as HTMLInputElement).value === "light" ? "light" : "dark" }));
  for (const id of ["set-pixel", "set-clean"]) $(id).addEventListener("change", (e) => setPrefs({ text: (e.target as HTMLInputElement).value === "clean" ? "clean" : "pixel" }));
  $("set-crt").addEventListener("change", (e) => setPrefs({ crt: (e.target as HTMLInputElement).checked }));
  $("set-game").addEventListener("change", (e) => setPrefs({ game: (e.target as HTMLInputElement).checked }));
  $("set-sound").addEventListener("change", (e) => {
    setPrefs({ sound: (e.target as HTMLInputElement).checked });
    sfx.send();
  });
  $("set-tick").addEventListener("change", (e) => setPrefs({ tick: (e.target as HTMLInputElement).checked }));
  $("set-volume").addEventListener("change", (e) => {
    setPrefs({ volume: Number((e.target as HTMLInputElement).value) });
    sfx.send();
  });
  $("set-dex").addEventListener("change", (e) => setPrefs({ dex: (e.target as HTMLInputElement).checked }));
  for (const size of ["small", "medium", "large"] as const) $(`set-dex-${size}`).addEventListener("change", () => setPrefs({ dexSize: size }));
  $("set-dex-home").addEventListener("click", () => {
    dex.mover.goHome();
    toast("Dex is back home.");
  });
  $("set-intro").addEventListener("change", (e) => setPrefs({ intro: (e.target as HTMLInputElement).checked }));
  $("set-intro-replay").addEventListener("click", () => {
    $<HTMLDialogElement>("settings").close();
    void playIntroNow();
  });
  $("set-fullscreen-row").hidden = !document.fullscreenEnabled;
  $("set-fullscreen").addEventListener("click", () => void toggleFullscreen());
  $("set-autosend").addEventListener("change", (e) => setPrefs({ autoSend: (e.target as HTMLInputElement).checked }));
  $("set-readspoken").addEventListener("change", (e) => setPrefs({ readSpoken: (e.target as HTMLInputElement).checked }));
  $("set-autoread").addEventListener("change", (e) => setPrefs({ autoRead: (e.target as HTMLInputElement).checked }));
  $("set-robot").addEventListener("change", (e) => setPrefs({ robot: (e.target as HTMLInputElement).checked }));
  $("set-voice").addEventListener("change", (e) => setPrefs({ voiceURI: (e.target as HTMLSelectElement).value || undefined }));
  for (const id of ["set-rate", "set-pitch"] as const) {
    $(id).addEventListener("input", (e) => {
      const value = Number((e.target as HTMLInputElement).value);
      setText($(`${id}-out`), id === "set-rate" ? `${value.toFixed(2)}x` : value.toFixed(2));
    });
    $(id).addEventListener("change", (e) => setPrefs(id === "set-rate" ? { rate: Number((e.target as HTMLInputElement).value) } : { pitch: Number((e.target as HTMLInputElement).value) }));
  }
  $("set-voice-test").addEventListener("click", () => void loadVoice().then((v) => v?.test()));
  $("set-reset").addEventListener("click", () => {
    const old = game.reset();
    renderHud(game.progress(), game.streak());
    renderQuests();
    toast("Progress reset", {
      label: "Undo",
      onClick: () => {
        game.restore(old);
        renderHud(game.progress(), game.streak());
        renderQuests();
      },
    });
  });
  $("scroller").addEventListener("scroll", () => {
    state.autoScroll = nearBottom();
    $("jump").hidden = state.autoScroll || !current();
  });
  $("jump").addEventListener("click", () => scrollToBottom(true));
  window.addEventListener("resize", () => placeSegIndicator(false));
  document.addEventListener("keydown", (e) => {
    const mod = e.metaKey || e.ctrlKey;
    const target = e.target as HTMLElement | null;
    const inField = target?.matches?.("input, textarea, select, [contenteditable]");
    if (mod && e.key.toLowerCase() === "k") {
      e.preventDefault();
      void openCommandPalette();
    } else if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "m") {
      e.preventDefault();
      void startVoice("toggle");
    } else if (e.key === " " && VOICE_IN && !mod && !e.repeat && spaceTalks(target)) {
      e.preventDefault();
      spaceHeld = true;
      clearTimeout(spaceTimer);
      spaceTimer = window.setTimeout(() => {
        spaceTimer = 0;
        void startVoice("push");
      }, 250);
    } else if (mod && e.shiftKey && e.key.toLowerCase() === "o") {
      e.preventDefault();
      newConversation();
    } else if (e.key === "/" && !inField && !mod) {
      e.preventDefault();
      $("composer-input").focus();
    } else if (e.key === "Enter" && !inField && !mod && (target === document.body || target === null) && !$("hero").hidden) {
      e.preventDefault();
      $("composer-input").focus();
    } else if (e.key === "Escape") {
      void closeTopOverlay().then((closed) => {
        if (closed || voice?.stopAll()) return;
        if (state.streaming) stopStreaming();
      });
    }
  });
  document.addEventListener("keyup", (e) => {
    if (e.key !== " ") return;
    spaceHeld = false;
    if (spaceTimer) {
      // a tap, not a hold: Space keeps paging the conversation
      clearTimeout(spaceTimer);
      spaceTimer = 0;
      $("scroller").scrollBy({ top: $("scroller").clientHeight * 0.8, behavior: reducedMotion() ? "auto" : "smooth" });
    } else if (voice?.pushing) voice.stopListening(true);
  });
}

let spaceTimer = 0;
let spaceHeld = false;

/** Hold-Space talks only when focus is on the page itself, not in a field, button or dialog. */
function spaceTalks(target: HTMLElement | null): boolean {
  if (document.querySelector("dialog[open]")) return false;
  return !target || target === document.body || !target.closest("input, textarea, select, button, a, summary, [contenteditable], [role=button], [tabindex], dialog, .rail");
}

/** The library download, for the intro's boot screen (it subscribes; the in-app bar is separate). */
const libraryLoad = { fraction: 0, done: false, listeners: new Set<(fraction: number, done: boolean) => void>() };

function reportLibrary(fraction: number, done: boolean): void {
  libraryLoad.fraction = fraction;
  libraryLoad.done = done;
  for (const l of libraryLoad.listeners) l(fraction, done);
}

const INTRO_KEY = "veridex.intro.v1";
let introPlaying = false;

/** The intro plays on the first visit of each browser session, unless Settings turned it off. */
function introWanted(): boolean {
  if (!(state.prefs.intro ?? DEFAULTS.intro)) return false;
  try {
    return sessionStorage.getItem(INTRO_KEY) !== "1";
  } catch {
    return false;
  }
}

function removeIntroCover(): void {
  document.getElementById("intro-cover")?.remove();
}

/** Where Dex lives when he has not been moved: above the composer, bottom-left (bottom-right on phones). */
function dexHome(size: Size): Point {
  const form = $("composer").getBoundingClientRect();
  const phone = window.innerWidth < 700;
  return { x: phone ? form.right - size.w : form.left, y: form.top - size.h - 4 };
}

async function playIntroNow(): Promise<void> {
  if (introPlaying) return;
  introPlaying = true;
  try {
    sessionStorage.setItem(INTRO_KEY, "1");
  } catch {
    /* without session storage the intro may show again next time */
  }
  try {
    const { playIntro } = await import("./intro/intro.ts");
    await playIntro({
      logo: document.querySelector<SVGSVGElement>(".hero-logo"),
      reducedMotion: reducedMotion(),
      touch: coarsePointer() || window.innerWidth < 700,
      sound: () => state.prefs.sound ?? DEFAULTS.sound,
      toggleSound: () => {
        setPrefs({ sound: !(state.prefs.sound ?? DEFAULTS.sound) });
        return state.prefs.sound ?? DEFAULTS.sound;
      },
      jingle: () => sfx.start(),
      progress: (listener) => {
        libraryLoad.listeners.add(listener);
        listener(libraryLoad.fraction, libraryLoad.done);
        return () => libraryLoad.listeners.delete(listener);
      },
      announce,
      onStart: (from) => {
        if (from) dex.mover.flyFrom(from);
        dex.send({ type: "greet" });
      },
    });
  } catch {
    removeIntroCover();
  } finally {
    introPlaying = false;
    $("composer-input").focus({ preventScroll: true });
  }
}

function trackModel(embedder: Embedder): void {
  const bar = $("load-bar");
  for (let i = 0; i < 10; i++) bar.appendChild(el("i"));
  const blocks = [...bar.children] as HTMLElement[];
  const pct = $("load-pct");
  const label = $("load-label");
  const text = $("model-text");
  const dot = $("model-dot");
  embedder.onProgress((loaded, total) => {
    const f = total ? loaded / total : 0;
    reportLibrary(f, false);
    const n = Math.floor(f * 10);
    blocks.forEach((b, i) => b.classList.toggle("on", i < n));
    setText(pct, `${Math.floor(f * 100)}%`);
    setText(text, `Loading library ${Math.floor(f * 100)}%`);
  });
  embedder.ready.then(
    (ms) => {
      state.modelReady = true;
      blocks.forEach((b) => b.classList.add("on"));
      $("load-lib").classList.add("is-ready");
      setText(label, "Library ready");
      setText(pct, `${(ms / 1000).toFixed(1)} s`);
      setText(text, `Library ready (${(ms / 1000).toFixed(1)} s)`);
      dot.classList.remove("busy");
      dot.classList.add("ok");
      reportLibrary(1, true);
    },
    (err: unknown) => {
      const line = `The library could not be loaded: ${err instanceof Error ? err.message : String(err)}`;
      setText(label, "Library failed");
      setText(text, line);
      setText(pct, "");
      dot.classList.remove("busy");
      dot.classList.add("bad");
      reportLibrary(libraryLoad.fraction, true);
    },
  );
}

async function init(): Promise<void> {
  syncReducedMotion();
  state.prefs = loadPrefs();
  applyPrefs(state.prefs);
  hydrateIcons();
  pressFeedback();
  syncThemeButtons();
  const kbd = document.querySelector<HTMLElement>("#new-chat .kbd");
  if (kbd) kbd.textContent = modKey === "Ctrl" ? "^⇧O" : "⌘⇧O";
  if (state.prefs.mode === "grounded") $<HTMLInputElement>("grounded-only").checked = true;
  if (state.prefs.pdfOpen === false) {
    $("pdf-toggle").setAttribute("aria-expanded", "false");
    $("pdf-body").hidden = true;
  }
  loadAll();
  game = new Game({ get: (k) => storage.get(k), set: (k, v) => storage.set(k, v) });
  dex = new Dex({
    button: $("dex"),
    bubble: $("dex-bubble"),
    reducedMotion,
    effects: () => gameOn(state.prefs),
    size: () => state.prefs.dexSize ?? DEFAULTS.dexSize,
    announce: dexAnnounce,
    home: dexHome,
    composer: () => {
      const r = $("composer").getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    },
    onActivate: () => void startVoice("toggle"),
    onFrame: (spec) => livePortrait?.show(spec),
  });
  $("mic-btn").hidden = !VOICE_IN;
  $("hf-btn").hidden = !VOICE_IN;
  $("mic-btn").title = `Talk to Dex (${modKey}+M)`;
  setupVoiceSettings();
  wire();
  evidence = new Evidence(() => {
    if (!evidence.open) state.evidenceFor = null;
  });
  const share = parseShareParams(location.search);
  if (share) history.replaceState(null, "", `${location.pathname}${location.hash}`);
  renderHud(game.progress(), game.streak());
  renderQuests();
  renderConversationList();
  renderMessages();
  renderUploads();
  placeSegIndicator(false);
  updateTitle();
  if (share?.q) $<HTMLTextAreaElement>("composer-input").value = share.q;
  autosize();
  const intro = introWanted();
  if (intro) void playIntroNow();
  else {
    removeIntroCover();
    buildLogo();
    dex.send({ type: "load" });
    dex.say("Hi! I'm Dex, VeriDex's guide. Ask me anything.", 4500);
  }
  document.documentElement.classList.add("ready");
  void document.fonts?.ready.then(positionBlockCursor);
  positionBlockCursor();
  requestAnimationFrame(() => startStarfield($<HTMLCanvasElement>("stars"), () => getComputedStyle(document.documentElement).getPropertyValue("--star").trim() || "#f6e3b4"));
  try {
    const manifest = await loadManifest(BASE);
    state.manifest = manifest;
    const t = libraryTotals(manifest);
    setText($("stat-line"), `1 assistant · ${t.books} books · ${t.passages.toLocaleString("en-US")} passages`);
    // the model and the five indexes start once the page has loaded and gone idle (at most 1.5 s
    // after the load event): their start-up (WASM compile, model parse) competes with the first paint
    await new Promise<void>((resolve) => {
      const go = (): void => {
        const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
        // during the intro the library starts at once: its boot screen shows the real progress
        if (introPlaying) resolve();
        else if (ric) ric(() => resolve(), { timeout: 1500 });
        else setTimeout(resolve, 200);
      };
      if (document.readyState === "complete") go();
      else window.addEventListener("load", go, { once: true });
    });
    const embedder = new Embedder(BASE, __MODEL_DTYPE__, manifest.model.query_instruction, {
      version: manifest.version,
      collections: manifest.collections.map((c) => ({ id: c.id, file: c.files.vectors })),
    });
    trackModel(embedder);
    const shards = new TextShards(BASE, manifest);
    const uploads = new UploadStore(BASE, manifest.uploads, manifest.gate.upload_threshold);
    state.assistant = new Assistant(manifest, embedder, shards, uploads, __WORKER_URL__);
    const u = manifest.uploads;
    $("upload-privacy").textContent = `Up to ${u.max_files} PDFs, ${u.max_mb} MB each. Indexed in this browser, never uploaded.`;
    $("upload-btn").title = `Up to ${u.max_files} PDFs (${u.max_mb} MB, ${u.max_pages} pages each). Only passages that match a question are sent with it.`;
    renderUploads();
    // hooks for the browser tests (embedding and search parity with the Python index)
    (window as unknown as Record<string, unknown>).__ragsysTest = {
      embedQueries: async (q: string[]) => (await embedder.queries(q)).map((v) => Array.from(v)),
      search: async (id: string, q: string[], k = 5) => {
        const out: { id: string; score: number }[][] = [];
        for (const text of q) {
          const res = await embedder.search([text], k, id);
          const chunks = await shards.resolve(res.hits.map((h) => ({ source: h.source, row: h.row })));
          out.push(res.hits.map((h, i) => ({ id: chunks[i]?.chunk_id ?? "", score: h.score })));
        }
        return out;
      },
      margins: async (q: string) => {
        const res = await embedder.search([q], 5);
        return res.hits.map((h) => ({ source: h.source, score: h.score, margin: h.score - (manifest.collections.find((c) => c.id === h.source)?.threshold ?? 1) }));
      },
      intro: () => void playIntroNow(),
    };
    document.documentElement.dataset.ready = "true";
  } catch (err) {
    setText($("load-label"), "Library failed");
    setText($("model-text"), `The site data could not be loaded: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!introPlaying) $("composer-input").focus({ preventScroll: true });
}

void init();
