# Veridex: design plan

Veridex is the public web app of this repository (research codename Agentic-RAG). Retrieval and
query embedding run in the visitor's browser; answers stream from the rate-limited LLM proxy.
This document is the plan the redesign was built to: tokens, layout, the retrieval merge, the game
system, motion, and the map from every UI element to the real data behind it. The app stays
vanilla TypeScript + Vite. `deploy/worker/`, `site-config.ts` (the Worker URL resolution and
`REQUIRE_WORKER_URL`), the Pages workflow and the repository name are untouched.

Concept: **8-bit arcade library**. An arcade title screen crossed with a terminal: a warm black
field, cream type, an amber-to-red striped band, a green prompt. Every edge sits on a 4 px grid.
The game layer (XP, levels, quests, trophies) rewards using the library well, never gates it, and
can be switched off.

## One assistant

Visitors never pick a library. Every question searches all five collection indexes plus any PDFs
the visitor attached; the answer cites whatever passages clear their own collection's bar. The
collection list, the composer pill, the hero tiles, the "try another collection" chips and the
palette's collection entries are gone. Subjects appear as a list in one place only: the About &
sources view. Each source card carries a small library tag ("CS & AI", "Indian Law") so
provenance stays visible.

## Retrieval merge

`gate.ts` (pure functions, unit-tested) and `engine.ts`:

1. The latest message (joined with the previous user message for a short follow-up, as before)
   is embedded once in the worker.
2. The worker searches each collection's int8 index (top `search_k` per collection, top
   `2 × search_k` for Grounded only). Uploaded PDFs are searched on the main thread.
3. Every hit gets `margin = cosine − threshold` of its own collection
   (`manifest.collections[].threshold`, the per-collection gate thresholds: CS & AI 0.74, Consumer
   Law 0.61, Indian Law 0.62, Human Biology 0.62, Physics & Chemistry 0.62; PDFs use
   `gate.upload_threshold`, 0.62).
4. A passage counts as evidence only when `margin ≥ 0`. Evidence is pooled, de-duplicated and
   ranked by margin (ties: higher cosine, then search order).
5. The best passages are packed within the existing context budget (`context_tokens`, at most
   `max_passages`), labelled C1, C2, … in rank order.

| coverage | Chat | Grounded only |
|---|---|---|
| ≥ 1 passage with margin ≥ 0 | grounded answer: citations, Verify on demand | synthesizer → guards → critic, as before, on the evidence only |
| none | general-knowledge answer, badge GENERAL KNOWLEDGE, line "General knowledge — not from the library", no citations (every label is stripped) | abstain card "Not enough evidence in the library to answer this.", no LLM call |

**Disclaimers and prompt variants follow the packed passages.** The collections the packed
passages come from choose:

- the chat request's `collection` field (the Worker's existing contract: a label and a notice):
  the labels of those collections joined, and their notices, de-duplicated;
- the Grounded only `profile`: the collection with the most packed passages (ties: the better
  margin); PDFs alone use the `uploads` profile;
- the notice pills under the answer, each shown only when it applies: Indian Law or Consumer Law →
  "Not legal advice."; CS & AI → "Code is not executed here; test it before use." only when the
  answer contains a code block; Human Biology → its manifest notice (it says the answer is not
  medical advice and where to go for symptoms or emergencies); Physics & Chemistry → its manifest
  notice about hazardous experiments. "Applies" is read as: the libraries the answer actually
  cites; when it cites none but passages were packed, all packed libraries (so an uncited law
  answer still says "Not legal advice."). This keeps a convolutional-network answer that cites only
  CS & AI from showing a medical notice because an uncited Human Biology passage was packed next
  to it. A general-knowledge answer (nothing packed) gets none. The footer hint is generic.

**Loading.** Measured from `public/data/manifest.json` (gzip sizes are what GitHub Pages
transfers; it gzips both `.bin` and `.json`):

| collection | passages | vectors.bin (gzip) | passages.json (gzip) |
|---|---|---|---|
| CS & AI | 1,797 | 540 KB | 474 KB |
| Consumer Law | 326 | 99 KB | 49 KB |
| Indian Law | 4,367 | 1,324 KB | 767 KB |
| Human Biology | 2,089 | 633 KB | 857 KB |
| Physics & Chemistry | 5,485 | 1,666 KB | 2,136 KB |
| **all five** | **14,064** | **4.26 MB** | **4.28 MB** |

Embeddings plus text come to 8.55 MB, over the ~8 MB target, so the worker loads only the
embeddings at startup (4.26 MB, all five, next to the model) and passage text is fetched per hit
from shards of 32 passages (`data/<collection>/text/<n>.json`, about 10 KB gzip each), written at
build time by `scripts/shard-library.mjs` from the committed `passages.json`. Vectors are checked
against the manifest's SHA-256; shards are checked for their row count. Both go into the Cache
API under the manifest version, so a second visit loads nothing from the network. One combined
LOADING LIBRARY bar covers the model and the five indexes. The before/after transfer sizes are
under Performance.

The hero line "1 ASSISTANT · N BOOKS · M PASSAGES" is computed from the manifest: unique
`doc_id`s across collections and the sum of `count`.

## Tokens

### Palette

| token | Night (default) | Day ("paper") | use |
|---|---|---|---|
| `--bg` | `#120806` | `#F6E3B4` | page field |
| `--panel` | `#1E0F0A` | `#FFF4D6` | panels |
| `--panel-2` | `#2A1610` | `#EBD3A0` | raised panels, inputs |
| `--line` | `#4A2A1C` | `#7A4A2C` | pixel borders (decorative) |
| `--edge` | `#8A6248` | `#7A4A2C` | boundaries of controls (3:1) |
| `--cream` | `#F6E3B4` | `#1E0F0A` | primary text |
| `--dim` | `#B39678` (the logo's `#A88B70`, lifted for AA under the CRT layer) | `#5F412C` | secondary text |
| `--amber` | `#F7A531` | `#7A4A00` | XP, focus ring, citation chips |
| `--orange` | `#F47A30` (text; AA under the CRT layer) | `#A33A06` | accent text (streak) |
| `--orange-fill` | `#F26A1B` | `#F26A1B` | primary button face (dark text) |
| `--amber-fill` | `#F7A531` | `#F7A531` | chips, badges, highlights (dark text) |
| `--red` | `#C8321E` | `#9A2016` | danger marks, abstain frame |
| `--red-text` | `#FF6B57` | `#9A2016` | red text (Night's `--red` is 3.7:1: marks only) |
| `--green` | `#3BD16F` | `#155A2B` | verified, success, prompt |
| `--shadow` | `#000000` | `#7A4A2C` | hard drop shadow |

The logo's own colours (cream `#F6E3B4`, amber `#F7A531`, orange `#F26A1B`, red `#C8321E`, dark
red `#8E2014`, green `#3BD16F`) are fixed in both themes; the logo always sits on a dark plate.

### Type (self-hosted with @fontsource, latin subsets)

| face | role | sizes |
|---|---|---|
| Press Start 2P | hero headline, level-up and achievement banners, panel titles (EVIDENCE) | 12 / 16 / 24 / 32 px |
| Silkscreen | labels, buttons, counters, the trace, tags; ALL CAPS, 0.05em tracking | 12 / 16 px |
| Pixelify Sans (variable) | answers and chat text, 18 px / 1.6 | 18 px body, 16 px small |
| IBM Plex Sans (variable) | "Clean text" setting: replaces Pixelify Sans for long reading | 18 px / 1.6 |

Four font files; Silkscreen and Pixelify Sans are preloaded. Press Start 2P downloads on first
use; IBM Plex Sans only when Clean text is on. Pixel faces render with font smoothing off.

### Grid and pixel kit

- Base unit 4 px: every spacing, size and offset is a multiple of 4.
- No border-radius. Corners are 4 px clip-path notches; a framed panel is a 4 px `--line` border
  plus a hard `4px 4px 0` shadow, and the notch polygon covers the shadow too (a staircase corner).
- Buttons: a 4 px bevel (light top-left, dark bottom-right inner edge). On `pointerdown` they move
  `translate(4px, 4px)` and lose the shadow, so they click down at once.
- Inputs: an inset bevel, a blinking block cursor (█, `steps(1)`), an amber focus ring.
- Focus ring everywhere: 4 px amber outline, 2 px offset (a focused notched control shows square
  corners so the ring is never clipped).
- Icons: a 16 × 16 pixel set drawn from ASCII bitmaps into `<rect>` runs, `shape-rendering:
  crispEdges`, shown at 16 or 32 px.
- Chunky pixel scrollbars (`::-webkit-scrollbar`, with `scrollbar-color` as the fallback).
- CRT effect (Settings → CRT effect, on by default): 6 % scanlines on a 2 px rhythm (a 1 × 4 px
  bitmap tile) on every surface (the field, the rail, panels, bubbles, dialogs, the logo plate) and
  a faint 6 % vignette on the page field (a 32 × 32 bitmap stretched to the window). It is a texture
  under the content rather than one overlay over the whole page: an overlay layer, and the
  full-screen repeating gradients the brief named, cost seconds of main-thread time in Lighthouse's
  GPU-less browser (see Performance). The 4 px grid keeps the scanline phase aligned across
  surfaces. Off under reduced motion, reduced transparency and more contrast. The contrast check
  takes the worst case (scanline plus vignette over the lighter colour of each pair).
- Starfield: a canvas with 48 stars that twinkle in steps four times a second; paused when the tab
  is hidden, drawn once and left static under reduced motion. `aria-hidden`.

## Layout

```
DESKTOP >= 1100 px
+------------ 272 ---+------------ chat <= 780 ------------+---- 380 (on demand) --+
| LOGO           [<] |  quest trace  EMBED>SEARCH>DRAFT>.. | EVIDENCE           [x]|
| +- PLAYER CARD --+ |  +- dialogue box -----------------+ | trace + stamp         |
| | LV 3 APPRENTICE| |  |[mark] answer ... [C1]          | | sentence list         |
| | ##### XP  F4   | |  +--------------------------------+ | +- inventory card --+ |
| +----------------+ |          user bubble with tail     | | C1 [CS & AI]      | |
| [+ NEW QUEST  ^O]  |                                    | | Pro Git > Rebasing| |
| HISTORY            |                                    | | excerpt ...       | |
|  Today / Earlier   |                                    | | ######.. cos 0.81 | |
| YOUR PDFS v        |  +- composer --------------------+ | +-------------------+ |
| footer links       |  | Ask anything...#              | |                       |
| index . Night/Day  |  | [CHAT|GROUNDED ONLY]   +   >  | |                       |
+--------------------+--+-------------------------------+-+-----------------------+
```

- The rail is a flex column with `gap`; every block is its own flex item, nothing is absolutely
  positioned, and the rail scrolls internally when it is taller than the window (the overlap bug
  of the previous build cannot recur).
- Tablet (700–1099 px): the rail is a slide-over drawer; evidence is a right drawer.
- Mobile (< 700 px): a top bar (menu, logo mark, XP mini-bar, settings); the composer is pinned to
  the bottom with the safe-area inset; evidence is a bottom sheet with two detents, momentum,
  rubber-banding and swipe-down to close.
- **The menu drawer** is the same wherever the menu button shows (below 1100 px, or a rail the
  visitor collapsed on a wide screen): it springs in from the left over a dimming scrim with the
  full rail (player card, NEW QUEST, history, PDFs, footer links); focus moves into it and is
  trapped (the page behind is `inert` and does not scroll); Esc, the scrim or a swipe to the left
  (1:1 tracking, release velocity) close it, and focus returns to the menu button.
- **The broken menu at 1366 px (Nov 2026), two causes.** (a) The collapse button's state was saved
  between visits, so a window of 1366 px reopened in the compact layout with the top bar; a
  collapsed rail is no longer remembered, so from 1100 px the rail is docked on every visit. (b) At
  1100 px and above, a collapsed rail was `display: none` and the drawer styles existed only below
  1100 px, so the menu button added `.open` to a hidden element; the collapsed rail now uses the
  same fixed drawer. Breakpoints are written in range syntax (`width < 1100px`), so a fractional
  viewport such as 1099.5 px at some display scales no longer falls between two queries, and the
  main column's rows are explicit, so a long conversation can never push the composer off screen.

**Title screen** (empty state, after the intro below on a first visit): the pixel logo builds in row by row (`steps()`, under 600 ms),
"PRESS ENTER TO ASK ANYTHING" blinks slowly under it, then the real stat line and DAILY QUESTS:
three cards picked deterministically by date from a pool of 30 hand-written questions across all
subjects (each checked against the index: `tests/e2e/quests.spec.ts` asserts that every pool
question has a passage with margin ≥ 0). A card shows the subject icon, the question and "+20 XP";
a click asks it; a completed quest shows a check for the rest of the day.

## Identity

`web-static/src/identity.ts` is the one source of who Veridex is: `VERIDEX_FACTS` (name, tagline,
builder, the model named in `deploy/worker/wrangler.jsonc`, true capabilities and limitations, the
Worker's real rate limits) and `libraryFacts(manifest)` (subjects, books, passages from the index
metadata). The About view and the offline introduction are rendered from them.

- **Every model request starts with an identity system prompt** (under 220 words): "You are
  Veridex, …", the facts, and the rules (never call yourself ChatGPT, GPT-4, Gemini or any other
  company's assistant or claim to be made by OpenAI or another lab; name the model when asked; no
  training cutoff; today's date). Each mode's own rules (citations, the JSON contracts) follow it
  unchanged in the same system message: one system message per request, identity first, because
  some providers drop or merge a second one. Variants: `chat` (with passages), `general` (no
  evidence: answer directly and concisely, no capabilities list unless asked), `synth`; the critic and
  the summarizer get short variants ("You are Veridex's verifier…") that leave their JSON or text
  contracts alone.
- **The Worker builds the prompts** and drops any `system` or `developer` message a client sends,
  so the identity cannot be skipped or replaced from the browser. `scripts/export-identity.mjs`
  (`npm run identity`) renders the variants into `deploy/worker/src/identity.ts` (constants with
  `{{today}}` where the date goes); a unit test fails when it drifts from `identity.ts`, and another
  runs the real Worker `validate`/`buildMessages` on what the browser sends and snapshots the exact
  upstream bodies. The browser sends structured fields only: `today` (its local date; the Worker
  keeps it only within two days of its own) and `identity_reminder` on a retry.
- **The live failure (Nov 2026) and its cause:** the identity change had only been staged, never
  deployed, so the running Worker still built its system message from `prompts.json` alone ("You are
  a helpful general assistant…"), ignored the new fields, and gpt-oss answered "I'm ChatGPT". The
  site cannot fix that by itself: the identity only reaches the model through a redeployed Worker.
- **Meta questions never reach the model, and the replies are need-to-know.** `classifyIntent()`
  (rules and keyword patterns, clause by clause) routes questions addressed to Veridex to `about`
  and greetings, thanks, goodbyes and "how are you" to `smalltalk`; both are answered in the browser.
  Each clause of an `about` question maps to one topic with a one-line answer; a combined question
  ("who are you and who built you") gets the matching lines in order, nothing else:

  | topic | asked as | reply |
  |---|---|---|
  | intro | introduce yourself, who are you, what are you, hi who's this | "Hi! I'm Veridex, and this little robot is Dex, your guide. Ask me anything - science, law, code, the human body - and I'll show you where my answers come from." |
  | identity | are you Veridex / ChatGPT / GPT / another assistant | "Yep, I'm Veridex!" or "Nope - I'm Veridex." |
  | builder | who built / made / created you | "Swapnil built me." |
  | model | what model / AI / LLM, what powers you | "I'm powered by an open-weight language model (gpt-oss-120b), with my own search and fact-checking on top." |
  | code | where is your code, are you open source, GitHub | "My code is on GitHub: …" (the repository link) |
  | capabilities | what can you do, how can you help | three short bullets and "Try a quest to start!" |
  | library | what's in your library, what do you know, what books | one line: the subjects and the real book count |
  | limits | what can't you do, limitations, are you always right | three short bullets |
  | how | how do you work | one sentence and the How it works button |

  They are plain replies in Dex's dialogue box (no trace, badge or footer; Dex takes the greeting
  pose); a limit such as the rate limit is mentioned only when the visitor actually hits it. Topic
  questions that share words stay with retrieval ("who built the Taj Mahal", "what can a neural
  network do", "what is a library in Python", "what model of atom did Bohr propose"; the unit tests
  hold 15 more). They earn XP like any answer and never count toward Polymath.
- **The prompts are need-to-know too.** The identity tells the model to describe itself only when
  asked, in one or two sentences, and never to volunteer the model, the code, library statistics or
  its limitations; the facts for those questions follow. General-knowledge answers do not mention
  the library or the model's sources (the "General knowledge - not from the library" label is the
  only provenance signal).
- **Safety net.** `findFalseIdentity()` looks for first-person claims only ("I am ChatGPT", "I was
  made by OpenAI", "my training cutoff…"; "ChatGPT was created by OpenAI" in an answer about AI is
  fine, code blocks are skipped). In Chat a hit retries once with `identity_reminder`; a second hit,
  or any hit in Grounded only, removes the sentence and adds "(Veridex removed an incorrect
  self-description.)".
- The prompt tells the model that OpenAI released gpt-oss-120b's weights while Veridex itself is not
  an OpenAI product, so a question about the model's origin is answered truthfully. The tagline is
  shown in the About view but kept out of the prompt: general-knowledge answers are not verified, so
  the model should not repeat "every answer verified" as a claim.

## Voice

Voice is progressive: the controls appear only when the browser has the API, and the controller
(`src/voice/voice.ts`, with `stt.ts`, `tts.ts`, `speech-text.ts`) loads on first use.

- **Input** (Web Speech `SpeechRecognition`, en-IN with an en-US fallback, interim results): the
  pixel mic button in the composer, Ctrl/Cmd+M, or holding Space for 250 ms when no field, button or
  dialog has focus (a tap still pages the conversation). While listening the composer shows the
  settled words in cream and the live guess dimmed, a 16-bar level meter (getUserMedia +
  AnalyserNode; an animated stand-in when the stream is refused) sits in the input's corner, the mic
  pulses green and Dex cups its ears. A pause of 1.2 s sends the question (Settings > Send after a
  pause, on by default); releasing Space sends in push-to-talk. The first use shows a one-time note:
  "Voice input uses your browser's speech service (in Chrome, audio is processed by Google). Typing
  works too." A blocked microphone, a missing device or an unreachable service each get their own
  message; Firefox (no recognition) hides the mic and the Voice settings say why.
- **Output** (`speechSynthesis`): every answer has SPEAK / STOP. Answers to spoken questions are
  read aloud (Read spoken replies, on); Read every answer is off by default. Text is cleaned for
  speech: citation markers removed, code blocks, tables and formulas announced ("A table with 4 rows
  is shown on screen."), URLs skipped, symbols read as words; one utterance per sentence (Chrome cuts
  long ones). The sentence being read gets an amber underline through the CSS Custom Highlight API
  (no DOM changes; off with Game effects off). Settings: voice (English voices, preferring a natural
  Indian or British one), speed and pitch 0.8–1.4, and a Robot filter (pitch x1.15, rate x1.05).
  Reading stops on a new question, Esc, STOP or leaving the page.
- **Phones:** the composer row keeps the mic and headset at 44 px by moving Add a PDF to the menu
  (it is still there) and shortening the switch label to GROUNDED; its accessible name stays
  "Grounded only". The hands-free chip is hidden there; the pressed headset shows the mode.
- **Hands-free** (headset button, "HANDS-FREE ON" chip): listen, auto-send, read the reply, listen
  again; it ends on the button, Esc, an error or 20 s without speech.

## Dex

Dex is Veridex's guide, an original pixel robot (`src/dex/`): a capsule head with a dark visor
whose green face changes, side bolts, an antenna, floating hands and a thruster flame, in seven
colours from the Veridex tokens on a 32 x 32 grid. Frames are compositions of small layers (face,
hands, antenna tip, a three-frame flame, "?", "z", sparkles) on one body map, 1–4 frames per state,
drawn as SVG runs with `shape-rendering: crispEdges` at whole-number scales only.
`scripts/dex-png.mjs` exports `public/brand/dex-512.png` (nearest-neighbour).

| state | when | look |
|---|---|---|
| greeting | page load, replies about Veridex | waves, happy face |
| idle | between events | slow bob (one sprite pixel), random blink every 3–6 s |
| listening | the mic is on | wide eyes, hands at the sides of the head, antenna glows green |
| thinking | search and draft | eyes scan left to right |
| speaking | an answer is read aloud | mouth moves on each word boundary |
| happy | Verified n/n or a checked Grounded answer | smile, two hops |
| confused | no evidence (Grounded only) | one raised eye, "?" |
| error | limits and failures | red X eyes, sinks two pixels |
| celebrate | level up, trophy | arms up, sparkles |
| sleeping | 2 minutes without input | eyes shut, "z z"; any key or tap wakes it |
| carried | while he is held | hands up, eyes wide, thruster flickering, a one-pixel wiggle |

`brain.ts` is a pure function from app events to a state, how long to hold it, and a status line;
the bubbles carry real numbers ("Searching 14,064 passages…", "Found 3 sources!", "Writing your
answer…", "Verified 2/2 sentences ✓", "The library doesn't cover this one.", "Too many questions -
back in 05:41") and each line also goes to its own polite live region.

**One floating Dex.** He lives in a fixed layer above the conversation and the desktop evidence
panel, below the scrim, the drawers, the evidence sheet, toasts and dialogs. Settings > Dex size:
Small x3, Medium x5, Large x7 (the default); on phones Large is x5 and Medium x4. His bubble uses
Silkscreen at 12 px (Small) or 14 px, at most 260 px wide, and picks the side where it fits (right,
left, above, below). Only his painted pixels take the pointer, so the transparent corners of his
square never block a click. Home is the bottom-left of the chat column just above the composer
(bottom-right on phones); the conversation keeps enough bottom padding to scroll clear of him. The
answer portrait is Dex at x2, and the latest answer's portrait follows his frames.

**Dragging** (Pointer Events, so mouse, touch and pen; `src/dex/mover.ts`, physics in
`src/dex/physics.ts`): pointerdown captures the pointer and keeps the grab offset; he tracks 1:1
with `transform` (rubber-banding past an edge) while the last 100 ms of positions give the release
velocity. On release the rest point is projected with Apple's formula (deceleration 0.995),
clamped inside the viewport (12 px plus the safe-area insets), and within 48 px of an edge snapped
onto it with a spring (bounce 0.2, about 0.35 s) that carries the release velocity; a throw past an
edge rubber-bands back. Dropped on the composer, he moves to the nearest free spot above it, so the
send button is never covered. A press that moves less than 6 px is a click (voice on or off); a
double-click or double-tap springs him home. While he is dragged he may say "Wheee!", "Where to?"
or "Hold on tight!" (with Game effects on). His position is remembered as a fraction of the
viewport and re-clamped on resize and orientation change. He is a focusable button ("Dex, your
guide. Press Enter to talk, arrow keys to move"): arrow keys move him 16 px (Shift 64 px), Home
sends him home, Enter or Space toggles voice. Settings > Reset Dex position. Under reduced motion
there is no momentum or spring (he goes straight to the drop point) and each state is a still frame.
Dex and the voice code are under 25 KB gzipped, bundled and minified (a unit test builds them).

## Intro: "Enter the game"

The first visit of each browser session opens with an arcade intro (`src/intro/intro.ts`, loaded on
demand, under 12 KB gzipped; a unit test builds it), about 3.2 s to PRESS START, every pixel motion
stepped:

| time | what happens |
|---|---|
| 0.0 s | black; a CRT powers on: a 2 px line opens to the full screen with a flash, a scanline rolls, the CRT texture comes on |
| 0.5 s | boot text types out in green Silkscreen: VERIDEX OS v1.0, CHECKING MEMORY … OK, LOADING LIBRARY with a segmented bar driven by the real index download (full at once when cached; the intro never waits for it), WAKING DEX … OK |
| 1.6 s | a pixel dissolve clears the screen; the VERIDEX logo (cloned from the page) builds from the top in 8 steps and three stripes slide in |
| 2.3 s | Dex flies in from the bottom-right on his flickering thruster, overshoots, settles beside the logo and waves: "Ready, player one?"; two parallax star layers drift |
| 3.0 s | PRESS START blinks once a second with a ▶ cursor (TAP TO START on touch screens); [SOUND: OFF] and © Veridex below |
| START | a 16 px block grid flips away diagonally (450 ms) to the app's title screen while Dex flies to his spot; with sound on, a short square-wave arpeggio (the press is the user gesture) |

Any key, click or tap jumps to PRESS START, and the next press enters; SKIP ▸ sits in the corner.
The overlay is a modal dialog headed "Veridex" with focus on PRESS START (Enter starts); the boot
text is `aria-hidden` and "Veridex is loading" is announced. The app loads underneath (the library
starts at once during the intro) and is `inert` until the intro closes, then interactive at once.
No extra network requests. A black cover in the HTML keeps the first paint dark until the app
knows whether the intro plays (it lifts by itself if the script never runs). Settings > Play intro
turns it off or replays it now. Under reduced motion it is the logo and PRESS START, then a 400 ms
fade. Nothing asks for fullscreen on its own; Settings and the command palette offer a Fullscreen
item.

## Components → real data

| element | source |
|---|---|
| hero stat line | manifest: unique `doc_id`s, sum of `count` |
| LOADING LIBRARY bar | worker byte progress: model files + five vectors.bin |
| index status (rail footer) | the same; "LIBRARY READY 2.1 S" from the measured load time |
| quest trace stages | `engine.ts` `onStage` events: embed, search, draft / synth, guards, critic; measured ms; skipped states |
| answer badge | GROUNDED: ≥ 1 valid citation; GENERAL KNOWLEDGE: none; NO EVIDENCE: Grounded only abstained |
| VERIFIED / PARTIAL / NO EVIDENCE stamp | `verify.ts` result (Chat, after Verify) or the grounded pipeline's guards + critic (Grounded only) |
| "2/2 SENTENCES BACKED BY SOURCES" | `VerifyResult.supported / total` |
| sentence list tags | `VerifyResult.sentences[].status` (supported / unsupported; the verifier has no partial state, so no sentence is ever tagged PARTIAL) |
| citation chips | labels left in the answer by `cleanCitations` |
| source card | the packed passage: library tag, document title, section path, pages, excerpt with the question's words marked, cosine and margin |
| notice pills | the packed passages' collections (see Retrieval merge) |
| XP, level, streak, trophies | the local game store (below) |

## Signature: quest trace + verified stamp

Above each answer the real stages form a level map, EMBED ▸ SEARCH ▸ DRAFT ▸ VERIFY in Chat and
EMBED ▸ SEARCH ▸ SYNTH ▸ GUARDS ▸ CRITIC in Grounded only (a revision round appends its stages).
Each node is a 12 px block: grey pending → amber blinking active → green done with its time in
Silkscreen. Connectors fill block by block. A skipped stage has a dashed outline and SKIPPED.
Space for the trace and the stamp is reserved so nothing shifts while streaming.

When (and only when) the verifier returns: all sentences supported → a green "VERIFIED ✓" stamp
slams in (scale 1.4 → 1 in 3 steps, a 2-frame 2 px screen nudge), "2/2 SENTENCES BACKED BY
SOURCES"; some → amber PARTIAL, "1/2 SENTENCES BACKED"; abstained → red NO EVIDENCE. Without a
verifier result (a Chat answer before Verify) the slot shows the RUN VERIFY button.

## Game system (local only; never blocks anything)

Stored in `localStorage` under `veridex.game.v1`, every access in try/catch. With storage blocked
the game runs in memory for the visit.

| event | XP |
|---|---|
| a question answered (done, not an error, not an abstention) | +10 |
| bonus: the answer is grounded and verified (all sentences supported, or Grounded only accepted) | +15 |
| running Verify | +5 |
| a daily quest completed | +20 |
| errors, rate limits, abstentions | 0 (never negative) |

Each answer can earn each award once (re-renders and reloads do not repeat it).

Levels: thresholds 0, 50, 150, 300, 500, 800, 1200, then +500 each (1700, 2200, …). Titles by
level: NOVICE, APPRENTICE, SCHOLAR, SAGE, ARCHIVIST, LOREMASTER, ORACLE (ORACLE from LV 7 on).

Streak: consecutive local calendar days with at least one answered question; a gap of more than a
day resets it to 1.

Achievements: FIRST QUESTION, FIRST VERIFIED ANSWER, FACT CHECKER (Verify 10 times), POLYMATH
(grounded answers citing 4 different libraries; tracked internally), BOOKWORM (attach a PDF), ON
FIRE (3-day streak), WEEK WARRIOR (7-day streak), QUEST CHAMPION (all three daily quests in a day).

Feedback: "+25 XP" floats up from the answer and the XP bar fills block by block; a level-up shows
a centred "LEVEL UP! LV 4 · SCHOLAR" banner with a 1 s pixel confetti burst (canvas, ≤ 80
particles, lazy-loaded), dismissed after 2.5 s or by click / Esc; an achievement slides in from
the top right for 4 s. Settings: Reset progress (with Undo) and Game effects off (hides XP,
toasts, banners and confetti; nothing else changes).

Sound (off by default): square / triangle oscillators through the Web Audio API, no files: send
blip, typewriter tick (separate toggle, off by default, throttled, very quiet), verified chime,
level-up arpeggio, error buzz; a master volume slider. Each sound starts in the same frame as its
visual.

## Motion spec

| what | how |
|---|---|
| game elements: stamp, logo build, XP fill, blinking, toasts | `steps()` easing, 2–6 frames |
| structure: evidence panel, sheet drag, drawers | `motion` springs, damping 1.0 / response 0.35 (`bounce: 0, visualDuration: 0.35`); interruptible, from the on-screen value, release velocity handed over, enter and exit on the same path |
| intro (first visit per session) | the arcade intro above: CRT power-on, boot text, dissolve, logo build, Dex fly-in and PRESS START, all stepped; the start wipe is a 16 px block grid in 9 steps (see Intro) |
| Dex drag | 1:1 tracking, then a per-axis spring (bounce 0.2 / 0.35 s to an edge, bounce 0 / 0.45 s elsewhere) that carries the release velocity |
| streaming | typewriter in chunks that catch up with the stream every frame (never slower than the network), blinking block cursor |
| stamp nudge | 2 frames of 2 px |

Only transform and opacity animate (plus the canvases). The library (model and indexes) starts loading once the page has loaded and gone idle, at most 1.5 s after the load event (at once while the intro plays). Reduced motion: no CRT intro (logo and PRESS START, then a fade), no Dex momentum or spring, no shake, starfield
twinkle, confetti or typewriter (text appears in chunks); state changes use 150 ms fades or
`steps()`.

## Accessibility

WCAG 2.2 AA in Night and Day, the CRT layer included. Full keyboard use: 4 px amber focus ring,
Esc closes overlays, focus is trapped in dialogs and the sheet and returns to the trigger. A polite
live region announces the finished answer, the verification result, level-ups and achievements.
Decorative canvases are `aria-hidden`. Touch targets ≥ 44 px. Landmarks: banner, navigation,
main, complementary. Pixel fonts never below 12 px; body text 18 px. `prefers-reduced-motion`,
`prefers-reduced-transparency` and `prefers-contrast: more` (CRT off, solid panels, stronger
edges) are respected.

## Contrast

`node web-static/scripts/contrast.mjs` (exit code 1 on any failure). Text needs 4.5:1, control
boundaries and graphics 3:1. Every text pair is also measured under the CRT layer at its worst
point (6 % scanline plus 6 % vignette darkening the lighter colour of the pair: the text in Night,
the paper in Day). To pass that, three logo-derived tokens moved: Night `--dim` #A88B70 →
#B39678 and text orange #F26A1B → #F47A30 (the button face keeps #F26A1B), Day `--dim` →
#5F412C and green → #155A2B; chips and badges that carry dark text use the bright amber
`--amber-fill` in both themes. The previous build's low-contrast Day "Code is not executed" pill
is now cream-on-raised-panel text (12.73:1 in Day).

| theme | pair | colours | ratio | under CRT (worst) | needed | result |
|---|---|---|---|---|---|---|
| night | body text | `#F6E3B4` on `#120806` | 15.58 | 12.05 | 4.5 | pass |
| night | answer text in the dialogue box | `#F6E3B4` on `#1E0F0A` | 14.69 | 11.35 | 4.5 | pass |
| night | user bubble, notices, inputs | `#F6E3B4` on `#2A1610` | 13.57 | 10.49 | 4.5 | pass |
| night | secondary text on the field | `#B39678` on `#120806` | 7.10 | 5.66 | 4.5 | pass |
| night | secondary text on panels (hints, result line) | `#B39678` on `#1E0F0A` | 6.69 | 5.33 | 4.5 | pass |
| night | placeholder in the composer | `#B39678` on `#2A1610` | 6.19 | 4.93 | 4.5 | pass |
| night | PRESS ENTER, quest titles | `#F7A531` on `#120806` | 9.77 | 7.65 | 4.5 | pass |
| night | panel titles, dialogue name | `#F7A531` on `#1E0F0A` | 9.20 | 7.21 | 4.5 | pass |
| night | streak count, accent text | `#F47A30` on `#1E0F0A` | 6.80 | 5.41 | 4.5 | pass |
| night | errors, NO EVIDENCE | `#FF6B57` on `#120806` | 7.05 | 5.59 | 4.5 | pass |
| night | error card text, NO EVIDENCE badge | `#FF6B57` on `#1E0F0A` | 6.64 | 5.27 | 4.5 | pass |
| night | trace timings, VERIFIED | `#3BD16F` on `#120806` | 9.91 | 7.77 | 4.5 | pass |
| night | GROUNDED badge, VERIFIED stamp, SUPPORTED | `#3BD16F` on `#1E0F0A` | 9.34 | 7.32 | 4.5 | pass |
| night | verify button on a raised panel | `#3BD16F` on `#2A1610` | 8.63 | 6.77 | 4.5 | pass |
| night | text on the primary (orange) button | `#120806` on `#F26A1B` | 6.45 | 5.15 | 4.5 | pass |
| night | text on amber chips and badges (C1, LV) | `#120806` on `#F7A531` | 9.77 | 7.65 | 4.5 | pass |
| night | code blocks | `#F6E3B4` on `#0C0503` | 15.95 | 12.33 | 4.5 | pass |
| night | control boundaries on the field | `#8A6248` vs `#120806` | 3.69 | n/a | 3.0 | pass |
| night | control boundaries on panels | `#8A6248` vs `#1E0F0A` | 3.48 | n/a | 3.0 | pass |
| night | focus ring on the field | `#F7A531` vs `#120806` | 9.77 | n/a | 3.0 | pass |
| night | focus ring on panels | `#F7A531` vs `#1E0F0A` | 9.20 | n/a | 3.0 | pass |
| night | abstain and error frames | `#C8321E` vs `#1E0F0A` | 3.49 | n/a | 3.0 | pass |
| night | XP blocks filled vs empty | `#F7A531` vs `#2A1610` | 8.50 | n/a | 3.0 | pass |
| night | XP blocks on the player card | `#F7A531` vs `#1E0F0A` | 9.20 | n/a | 3.0 | pass |
| day | body text | `#1E0F0A` on `#F6E3B4` | 14.69 | 12.02 | 4.5 | pass |
| day | answer text in the dialogue box | `#1E0F0A` on `#FFF4D6` | 16.99 | 13.91 | 4.5 | pass |
| day | user bubble, notices, inputs | `#1E0F0A` on `#EBD3A0` | 12.73 | 10.50 | 4.5 | pass |
| day | secondary text on the field | `#5F412C` on `#F6E3B4` | 7.27 | 5.95 | 4.5 | pass |
| day | secondary text on panels (hints, result line) | `#5F412C` on `#FFF4D6` | 8.41 | 6.89 | 4.5 | pass |
| day | placeholder in the composer | `#5F412C` on `#EBD3A0` | 6.30 | 5.19 | 4.5 | pass |
| day | PRESS ENTER, quest titles | `#7A4A00` on `#F6E3B4` | 5.90 | 4.83 | 4.5 | pass |
| day | panel titles, dialogue name | `#7A4A00` on `#FFF4D6` | 6.83 | 5.59 | 4.5 | pass |
| day | streak count, accent text | `#A33A06` on `#FFF4D6` | 6.05 | 4.96 | 4.5 | pass |
| day | errors, NO EVIDENCE | `#9A2016` on `#F6E3B4` | 6.39 | 5.23 | 4.5 | pass |
| day | error card text, NO EVIDENCE badge | `#9A2016` on `#FFF4D6` | 7.39 | 6.05 | 4.5 | pass |
| day | trace timings, VERIFIED | `#155A2B` on `#F6E3B4` | 6.55 | 5.36 | 4.5 | pass |
| day | GROUNDED badge, VERIFIED stamp, SUPPORTED | `#155A2B` on `#FFF4D6` | 7.58 | 6.20 | 4.5 | pass |
| day | verify button on a raised panel | `#155A2B` on `#EBD3A0` | 5.68 | 4.68 | 4.5 | pass |
| day | text on the primary (orange) button | `#1E0F0A` on `#F26A1B` | 6.08 | 5.14 | 4.5 | pass |
| day | text on amber chips and badges (C1, LV) | `#1E0F0A` on `#F7A531` | 9.20 | 7.65 | 4.5 | pass |
| day | code blocks | `#F6E3B4` on `#1E0F0A` | 14.69 | 12.02 | 4.5 | pass |
| day | control boundaries on the field | `#7A4A2C` vs `#F6E3B4` | 5.83 | n/a | 3.0 | pass |
| day | control boundaries on panels | `#7A4A2C` vs `#FFF4D6` | 6.74 | n/a | 3.0 | pass |
| day | focus ring on the field | `#7A4A00` vs `#F6E3B4` | 5.90 | n/a | 3.0 | pass |
| day | focus ring on panels | `#7A4A00` vs `#FFF4D6` | 6.83 | n/a | 3.0 | pass |
| day | abstain and error frames | `#9A2016` vs `#FFF4D6` | 7.39 | n/a | 3.0 | pass |
| day | XP blocks filled vs empty | `#C4560F` vs `#EBD3A0` | 3.06 | n/a | 3.0 | pass |
| day | XP blocks on the player card | `#C4560F` vs `#FFF4D6` | 4.09 | n/a | 3.0 | pass |
| both | level-up title | `#F7A531` on `#120806` | 9.77 | 7.65 | 4.5 | pass |
| both | level-up line | `#F6E3B4` on `#120806` | 15.58 | 12.05 | 4.5 | pass |
| both | level-up hint | `#B39678` on `#120806` | 7.10 | 5.66 | 4.5 | pass |

## Performance

**Lighthouse** (mobile preset, `vite preview` of the production build,
`node web-static/scripts/lighthouse.mjs`; the official run is in `docs/lighthouse.json`):

| category | this build | previous Veridex build | original app |
|---|---|---|---|
| Performance | **93** (two more runs: 90, 96) | 65 | 63 |
| Accessibility | **100** | 100 | 100 |
| Best Practices | **100** | 100 | 100 |
| SEO | **100** | 100 | 91 |

| metric | this build |
|---|---|
| First Contentful Paint | 0.9 s |
| Largest Contentful Paint | 0.9 s |
| Total Blocking Time | 320 ms (230–390 ms over three runs) |
| Cumulative Layout Shift | 0 |
| Speed Index | 2.8 s |

**What it took.** The first complete build scored 67 (Total Blocking Time 3.0 s). Lighthouse's lab
browser has no GPU, so everything is rasterized and composited in software, and its simulated 4×
CPU slowdown multiplies each such task. Hiding parts of the page one at a time (single runs; the
lab varies by about ±10 points):

| variant | Performance | Total Blocking Time |
|---|---|---|
| first build: CRT as a full-screen overlay of repeating gradients, boot with a gradient scanline band | 67 | 3,010 ms |
| CRT, starfield and boot hidden | 97 | 170 ms |
| only the CRT hidden | 91 | 320 ms |
| CRT drawn from bitmaps, still one overlay | 70 / 88 | 1,810 / 430 ms |
| CRT as a bitmap texture on each surface (no overlay) | 70 / 71 / 72 | 1.5–2.0 s |
| … and the starfield hidden | 70 | 1,760 ms |
| … and the boot hidden | 86 / 89 | 540 / 430 ms |
| **final: CRT texture, boot with a flat scanline band on its own layer** | **90 / 96 / 93** | 390 / 230 / 320 ms |

Two things were expensive: full-screen gradients (the brief's `repeating-linear-gradient`
scanlines) and the boot's gradient band, re-rasterized at every step it moved (one 1.6 s task).
So the scanlines and vignette are small bitmaps drawn as a texture on each surface, the boot's band
is a flat colour, and the boot is stepped by timers (8 frames). The look is the same; the CRT is
on from the first paint. The starfield canvas costs nothing measurable.

**JavaScript** (gzip -9; excluding fonts, KaTeX and the unchanged pdf.js chunk): the whole page
is **50.5 KB**, within the 70 KB budget.

| bundle | previous Veridex build | this build |
|---|---|---|
| main (`index-*.js`, engine included) | 40.7 KB | 46.1 KB |
| command palette (lazy) | 1.6 KB | 1.6 KB |
| How it works (lazy) | 2.2 KB | 1.4 KB |
| Achievements view (lazy) | n/a | 0.8 KB |
| confetti (lazy) | n/a | 0.6 KB |
| stylesheet | 9.4 KB | 8.9 KB |
| embedding worker (transformers.js + the int8 search) | not measured | 139.7 KB |

Fonts: four files, latin only: Silkscreen (8.4 KB) and Pixelify Sans (12.0 KB) are preloaded;
Press Start 2P (12.5 KB) loads on first use; IBM Plex Sans (45.7 KB) only with Clean text. KaTeX
and highlight.js still load only for an answer that needs them.

**Index transfer** (gzip, what GitHub Pages sends):

| | previous build (one collection, chosen by the visitor) | this build (one library) |
|---|---|---|
| at startup | the selected collection's text and vectors: 0.15 MB (Consumer Law) to 3.80 MB (Physics & Chemistry); the default, CS & AI, 1.01 MB | the vectors of all five collections: **4.26 MB** |
| per question | nothing more | the text shards holding the chosen passages: 10.8 KB each on average; a Chat answer needs at most 8, Grounded only at most 40 candidates (hits cluster, so usually fewer) |
| everything, if all of it were used | 8.55 MB (all five collections) | 4.26 MB vectors + 4.78 MB shards |
| model and ONNX Runtime | about 82 MB | unchanged |

Against the previous default (CS & AI) the unified index adds 3.25 MB at startup; that is what
searching every collection for every question requires. Everything is cached under the manifest
version, so a second visit downloads none of it. The model and indexes start loading once the page
has loaded and gone idle (at most 1.5 s after the load event).

## What changed in the engine

- `gate.ts`: the per-source top-1 gate (`decide`) is replaced by `marginOf`, `rankByMargin` and
  `evidenceOf` (pure, unit-tested); `pack`, `gateQueries` and `passageBlock` are unchanged.
- `engine.ts`: one search over every collection (worker) and the uploads, ranked by margin;
  Chat packs only evidence; Grounded only runs `groundedAnswer` on the evidence, with the profile
  and budgets of the dominant library, and abstains without a model call when there is none
  (`reason: "no_evidence"`). `ChatOutcome` gains `context` (the packed passages). The chat
  request's `collection` field and the Grounded only `profile` follow the packed passages.
  Prompts, guards, the critic, the revision round, history and summaries are unchanged.
- `embed.worker.ts` / `embedder.ts`: the worker also loads the five int8 indexes and answers a
  `search` message (embed + top-k per collection, with the measured embed and search times).
- `data.ts` / `library.ts`: vectors and text shards with checks and the Cache API; library
  totals; notices, prompt collection and dominant library.
- `citations.ts`: the source-line copy ("Answered from the library", "General knowledge — not
  from the library").
- `deploy/worker/`, `site-config.ts`, `REQUIRE_WORKER_URL`, the Pages workflow and the
  repository name are untouched. Parity with the Python index still holds (embedding cosine
  1.000; top-5 identical up to near-ties for all five collections).
