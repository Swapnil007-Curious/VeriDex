# Edits: IEEE version and writing refinement (2026-11-23)

This file lists every sentence changed in the writing pass on the full version (`paper/main.tex`),
every changed sentence in the generated table captions, and how each sentence of the IEEE version
(`paper/ieee/main_ieee.tex`) relates to the full version. The lists were produced by a
sentence-level comparison of the previous commit with the working tree.

## Rules of the pass

- Prose only. No number, macro (`\V{...}`), citation, label or claim strength was changed. Every
  hedge the statistics need ("not significant", the intervals, "unconfirmed", "inconclusive") is
  kept.
- Removed: "not X but Y" contrasts and their reversed forms ("X rather than Y", "X, not Y",
  "not only X"), clipped negative tails ("computed, never stored"), claim-style paragraph headings
  (the claim moved into the paragraph's first sentence), bold labels in the contribution list,
  en dashes used as connectors (`synthesizer--guards--critic`), "serves as", a pseudo-cleft opener
  ("What filtering buys is"), comma splices and over-long sentences (split).
- Kept: numeric ranges and the term "min--max" (en dashes that are not connectors), structural
  `\paragraph` headings, and the method statement that the error-analysis labels were assigned
  with AI assistance.
- No sentence used delve, crucial, pivotal, showcase, leverage, utilize, landscape, tapestry,
  testament, underscore, highlight (verb), intricate, meticulous, seamless, furthermore,
  additionally, notably or moreover before or after the pass. "Robustness check" (primary-table
  caption) is the statistical term and stays.
- Invisible characters: none in the hand-written sources. Four Lighthouse values carried a raw
  non-breaking space from `docs/lighthouse.json` into `tables/numbers.tex`; `tex_escape` now
  writes `~`. The prompt listings keep their straight quotes (they are the prompt text, verbatim);
  one quoted evaluation question in the error examples now uses LaTeX quotes.

## Changes that follow the IEEE review

After the writing pass, an independent reviewer read the IEEE PDF (`REVIEW.md`, third review).
The text fixes it led to are included in the lists below and are marked there; they add
definitions, hedges the statistics require ("on the textbooks the difference is not
significant", "not significant" for the 0.412 against 0.471 comparison) and confounds the reader
needs (the fixed-256 configuration also uses hybrid retrieval and reranking; the hosted model runs
on the provider's hardware). No number changed. To keep the preprint's main text within eight
pages after these additions, Figure 3 (the descriptive selective-prediction sweep) and Table 4
(error categories) moved to Appendices C and D, where the text now points.

## Non-prose changes

- `sections/acknowledgment.tex` (new): the Acknowledgment section, with the author's text
  verbatim, input by both versions before the references. There is no separate AI-declaration
  section and no TODO or placeholder about disclosure in either version.
- `macros.tex` (new): the macros both versions share (`\V`, the pending-result switches, `\cmd`,
  `\gptoss`), moved out of `main.tex` unchanged.
- `figures/pipeline.tex` (new): Figure 1 (TikZ), moved out of `sections/system.tex` so that both
  versions use it. After the review, the LLM boxes have a thick border (readable in grayscale), the
  revision note is set at the figure's font size instead of `\tiny`, and the box width is a
  parameter (31 mm in the preprint, 38 mm in the IEEE column).
- Generated tables: `scripts/paper_tables.py` writes each caption as
  `\TabCaption{label}{title}{notes}` plus `\TabNotes`. The preprint prints exactly the caption it
  printed before (title, period, notes) below the table; the IEEE version prints the title above
  the table and the notes below it. `\ExtRef{Table}{label}` refers to a table only the full
  version has (the IEEE version cites the extended version there); `\SecRef` writes "§" or
  "Section".
- PDF metadata (both versions): `pdftitle` = the paper title, `pdfauthor` = Swapnil Shukla; subject,
  keywords and creator are empty. The producer and creation date are set by the TeX engine.
- `references.bib`: one new entry, the extended version (`shukla2026veridexext`), cited only by the
  IEEE version; Robertson and Zaragoza's issue number now has an en dash (`1--2`) and Cormack et
  al.'s SIGIR proceedings title is capitalised. `paper/ieee/references_ieee.bib` is generated from `references.bib` by
  `paper_tables.py`: IEEEtran.bst prints every url and ignores eprint, so entries with a venue or
  an arXiv id lose their url, arXiv-only entries get `howpublished = {arXiv:<id>}`, proceedings
  lose editors, publisher and address, no entry keeps a month, and "Proceedings of the" or
  "The ... Conference" becomes "Proc.", as in IEEE references. Titles that the source wraps in
  double braces are unwrapped so that all titles print in sentence case; acronyms, model names and
  proper nouns stay braced. Authors, venues, years, volumes and pages are unchanged (checked entry
  by entry).
- `scripts/paper_figures.py` also writes `figures/retrieval_deltas_ieee.pdf`, the same data at the
  IEEE column width with less height per row and the legend inside the CS/AI panel. The preprint's
  figures are unchanged.
- `scripts/paper_claims.py` audits the hand-written LaTeX of both versions (macros used, digits
  typed outside macros).
- `\V{repro.head}` now reads the commit the tables were regenerated at.

## IEEE version

`paper/ieee/main_ieee.tex` uses the IEEEtran conference class (v1.8b, vendored with IEEEtran.bst
v1.14, as `acl.sty` is for the preprint) and inputs the generated tables, `tables/numbers.tex`,
`macros.tex`, Figure 1, the retrieval figure and the Acknowledgment. It is 6 pages including the
references. Switches at the top of `main_ieee.tex` add or drop optional blocks: the
selective-prediction figure (off), the error-category table (off; the text gives every count), the
table of Holm-corrected tests (off), the deployment section (on) and the cross-domain subsection
(on). Turning on the two figures/tables gives roughly half a column more for a 7-page limit.

Material left to the extended version, which the IEEE version cites: the appendix (prompts,
hyperparameters, all result tables, the error-analysis procedure, the test-access log and the
reproducibility details), the absolute retrieval table, the app modes, the deployment measurements
table and latency figure, the ethics statement, the deployment's cold-load figures, and the
detailed filter, grid and hyperparameter values.

The IEEE text uses American spelling (artifact, normalized, labeled, judgment, favor, toward,
quantized); the full version keeps British spelling.

The IEEE text is the refined full text, shortened. 41 of its sentences are identical to the full
version (up to citation style: `\cite` for `\citep`/`\citet`, "Fig." for "Figure", "Section" for
"§"). The other 86 are listed below next to the closest full-version sentence; some differ only in
spelling. Each keeps
its source's numbers and hedges; the shortening drops detail (settings, examples, secondary
numbers that Tables II and III show), not qualifications. Two qualifiers that an early draft of
the IEEE text dropped were restored after the comparison: "on the statutes" in the verification
contribution and "of system parameters" in the tuning statement.

## 1. Full version: changed sentences

Lines marked `after (review)` come from the IEEE review fixes; all others are the writing pass.

### `paper/sections/abstract.tex`

```text
before: On held-out questions, structure-aware chunks raise how much gold evidence fits in the generator's context on the statutes (\V{cl.ret.struct-b.dcov} \V{cl.ret.struct-b.dcovci}) but not on the textbooks.
before: Verification raises the faithfulness of released statute answers from \V{cl.gen.G2.faith} to \V{cl.gen.G4.faith} (\V{cl.rel.G4-G2} \V{cl.rel.G4-G2ci}), mainly by withholding answers that contain uncited sentences: NLI support of cited sentences does not change significantly, and the verified system answers only \V{cl.gen.G4.corrall} of answerable statute questions correctly (\V{cl.gen.G2.corrall} without verification).
after (review): On held-out questions, structure-aware chunks raise the share of gold evidence that fits in the generator's context on the statutes (\V{cl.ret.struct-b.dcov}, 95\% CI \V{cl.ret.struct-b.dcovci}); on the textbooks the difference is not significant.
after:  Verification raises the faithfulness of released statute answers from \V{cl.gen.G2.faith} to \V{cl.gen.G4.faith} (\V{cl.rel.G4-G2} \V{cl.rel.G4-G2ci}), mainly by withholding answers that contain uncited sentences.
after (review): The support of cited sentences under a natural language inference (NLI) judge does not change significantly, and the verified system answers only \V{cl.gen.G4.corrall} of answerable statute questions correctly (\V{cl.gen.G2.corrall} without verification; not significant).
```

### `paper/sections/introduction.tex`

```text
before: Retrieval-augmented generation (RAG) grounds an answer in retrieved passages \citep{lewis2020rag,karpukhin2020dpr}, but grounding is not the same as support: generative search engines often cite passages that do not back the sentence they are attached to \citep{liu2023verifiability}, and commercial legal research tools built on retrieval still hallucinate \citep{magesh2024hallucination,dahl2024fictions}.
after:  Retrieval-augmented generation (RAG) grounds an answer in retrieved passages \citep{lewis2020rag,karpukhin2020dpr}, yet a grounded answer can still contain unsupported sentences: generative search engines often cite passages that do not back the sentence they are attached to \citep{liu2023verifiability}, and commercial legal research tools built on retrieval still hallucinate \citep{magesh2024hallucination,dahl2024fictions}.
```

```text
before: It runs on a \V{hw.cores}-core laptop CPU with a small local generator (qwen2.5:3b); a hosted open-weight model serves as a generator-scale ablation.
before: All tuning of system parameters used a dev split; test access was logged.
after:  It runs on a \V{hw.cores}-core laptop CPU with a small local generator (qwen2.5:3b), which a hosted open-weight model replaces in a generator-scale ablation.
after:  All tuning of system parameters used a dev split, and every test access was logged.
```

```text
before: \item \textbf{Structure-aware chunking measured by token-budget coverage.} Chunks that follow sections and clauses raise the coverage of gold provisions within a \V{gen.budget}-token context on the statutes (\V{cl.ret.struct-b.dcov} \V{cl.ret.struct-b.dcovci}; \V{cl.strict.strict.d} under a strict relevance rule), while the Recall@5 difference is \V{cl.ret.struct-b.dr5sig}.
before: Fixed-256 hybrid retrieval with reranking comes close, far more slowly, so short chunks may explain the gain as much as section alignment; on the textbooks neither difference is significant (\S\ref{sec:res-retrieval}).
before: \item \textbf{An accounting of verification.} Citation and number guards plus a critic raise released-answer faithfulness on the statutes (\V{cl.rel.G4-G2} \V{cl.rel.G4-G2ci}, significant after Holm correction), but almost entirely by withholding answers with uncited sentences: NLI support of cited sentences changes by \V{cl.cit.G4-G2} \V{cl.cit.G4-G2ci}, and the critic with its revision round adds nothing measurable over the guards used as a filter.
after:  \item We measure chunkers by token-budget coverage.
after:  Chunks that follow sections and clauses raise the coverage of gold provisions within a \V{gen.budget}-token context on the statutes (\V{cl.ret.struct-b.dcov} \V{cl.ret.struct-b.dcovci}; \V{cl.strict.strict.d} under a strict relevance rule), while the Recall@5 difference is \V{cl.ret.struct-b.dr5sig}.
after:  Fixed-256 hybrid retrieval with reranking comes close but is far slower, so short chunks may explain the gain as much as section alignment.
after:  On the textbooks neither difference is significant (\S\ref{sec:res-retrieval}).
after:  \item We account for what verification does.
after:  Citation and number guards plus a critic raise released-answer faithfulness on the statutes (\V{cl.rel.G4-G2} \V{cl.rel.G4-G2ci}, significant after Holm correction), almost entirely by withholding answers with uncited sentences.
after:  NLI support of cited sentences changes by \V{cl.cit.G4-G2} \V{cl.cit.G4-G2ci}, and the critic with its revision round adds nothing measurable over the guards used as a filter.
```

```text
before: \item \textbf{A generator-scale ablation and an error analysis.} \gptoss{} (with larger budgets) in place of the local generator changes accuracy by \V{cl.boot.G2H-G2.acc} \V{cl.boot.G2H-G2.accci} on the statutes (inconclusive) and by \V{cs.boot.G2H-G2.acc} \V{cs.boot.G2H-G2.accci} on the textbooks (permutation $p=\V{sec.cs.G2H-G2.acc.p}$, uncorrected); \V{err.evalartifact} of \V{err.n} sampled failures are artefacts of the automatic evaluation (\S\ref{sec:res-generation}, \S\ref{sec:res-errors}).
before: \item \textbf{A deployment without hosting costs.} A static site searches \V{lib.passages} passages in the browser from a \V{lib.vecgz}\,MB int8 index.
before: We report load and retrieval latency (on dev questions) and list how this pipeline differs from the evaluated one; its answer quality is not measured (\S\ref{sec:deploy}).
after:  \item Replacing the local generator by \gptoss{} (with larger budgets) changes accuracy by \V{cl.boot.G2H-G2.acc} \V{cl.boot.G2H-G2.accci} on the statutes (inconclusive) and by \V{cs.boot.G2H-G2.acc} \V{cs.boot.G2H-G2.accci} on the textbooks (permutation $p=\V{sec.cs.G2H-G2.acc.p}$, uncorrected).
after:  In an error analysis, \V{err.evalartifact} of \V{err.n} sampled failures are artefacts of the automatic evaluation (\S\ref{sec:res-generation}, \S\ref{sec:res-errors}).
after:  \item A static site without hosting costs searches \V{lib.passages} passages in the browser from a \V{lib.vecgz}\,MB int8 index.
after:  We report its load and retrieval latency (on dev questions) and list how its pipeline differs from the evaluated one; its answer quality is not measured (\S\ref{sec:deploy}).
```

This URL change belongs to the repository rename (agentic-rag to VeriDex, remote now
`Swapnil007-Curious/veridex`), made at the same time outside this writing pass:

```text
before: The code, configurations, result tables and the scripts that generate every number in this paper are public.\footnote{\url{https://github.com/Swapnil007-Curious/agentic-rag}}
after:  The code, configurations, result tables and the scripts that generate every number in this paper are public.\footnote{\url{https://github.com/Swapnil007-Curious/VeriDex}}
```

### `paper/sections/related.tex`

```text
before: \citet{chen2024densex} show that finer retrieval units help downstream QA under a fixed computation budget, the view our token-budget coverage takes for chunkers; \citet{jimeno2024chunking} chunk reports by document elements, and \citet{qu2024semantic} find that semantic chunking does not consistently justify its cost.
after:  \citet{chen2024densex} show that finer retrieval units help downstream QA under a fixed computation budget, and our token-budget coverage applies the same view to chunkers.
after:  \citet{jimeno2024chunking} chunk reports by document elements, and \citet{qu2024semantic} find that semantic chunking does not consistently justify its cost.
```

```text
before: Attribution is evaluated with NLI in ALCE \citep{gao2023alce} and formalised as AIS \citep{rashkin2023ais}; SummaC shows that NLI judges need inputs split to the granularity they were trained on \citep{laban2022summac}, and AlignScore trains a dedicated consistency model \citep{zha2023alignscore}.
after (review): Attribution is evaluated with NLI in ALCE \citep{gao2023alce} and formalised as AIS (attributable to identified sources; \citealp{rashkin2023ais}); SummaC shows that NLI judges need inputs split to the granularity they were trained on \citep{laban2022summac}, and AlignScore trains a dedicated consistency model \citep{zha2023alignscore}.
```

### `paper/sections/system.tex`

```text
before: (none)
after:  \providecommand{\pipelinebox}{31mm}
```

```text
before: box/.style={draw, rounded corners=1pt, align=center, text width=31mm, inner sep=2pt, fill=white,
after:  box/.style={draw, rounded corners=1pt, align=center, text width=\pipelinebox, inner sep=2pt, fill=white,
```

```text
before: llm/.style={box, fill=blue!7},
after:  llm/.style={box, fill=blue!7, line width=1.1pt},
```

```text
before: \node[font=\tiny, anchor=east, align=right] at ($(cri.west)+(-4.8mm,0)$) {revise, once,\\with a larger budget};
after:  \node[font=\scriptsize, anchor=east, align=right] at ($(cri.west)+(-4.8mm,0)$) {revise, once,\\with a larger budget};
```

```text
before: Blue: LLM calls.
after (review): Blue with a thick border: LLM calls.
```

```text
before: Figure~\ref{fig:arch} shows the pipeline; every run records its configuration, git commit and hardware.
after (review): Figure~\ref{fig:arch} shows the pipeline; every run records its configuration, git commit (flagging uncommitted changes) and hardware.
```

```text
before: A generic parser handles textbooks: headings from font size and numbering, code blocks kept verbatim, exercises and indexes dropped.
after:  A generic parser handles textbooks: it finds headings from font size and numbering, keeps code blocks verbatim and drops exercises and indexes.
```

```text
before: BM25 uses a tokenizer that also emits normalised statute references (``section 2(7)'' $\rightarrow$ \cmd{s2(7)}); dense retrieval uses bge-small, -base or -large with exact cosine search; hybrids fuse both by RRF ($k=\V{ret.rrfk}$) or a linear combination of min--max normalised scores ($\alpha=\V{ret.alpha}$).
after (review): BM25 uses a tokenizer that also emits normalised statute references (``section 2(7)'' $\rightarrow$ \cmd{s2(7)}); dense retrieval uses bge-small, -base or -large with exact cosine search; hybrids fuse both by RRF ($k=\V{ret.rrfk}$) or a linear combination of min--max normalised scores (dense weight $\alpha=\V{ret.alpha}$).
```

```text
before: After a guard failure or a revise verdict the synthesizer gets one revision round with the context extended to \V{gen.revbudget} tokens and the reasons; if that round fails too, the system abstains (prompts in Appendix~\ref{app:prompts}).
before: Checks are made per sentence, but the decision is to release or withhold the whole answer; no sentence is dropped.
after:  After a guard failure or a revise verdict the synthesizer gets one revision round, with the reasons and a context extended to \V{gen.revbudget} tokens; if that round fails too, the system abstains (prompts in Appendix~\ref{app:prompts}).
after:  The checks work per sentence, but the system releases or withholds the whole answer and never drops a single sentence.
```

```text
before: \emph{Grounded only} runs the synthesizer--guards--critic loop on them, or abstains without a model call; \emph{Chat} cites them or labels its reply as general knowledge, and runs the guards and critic on demand.
after:  \emph{Grounded only} runs the loop of synthesizer, guards and critic on them, or abstains without a model call; \emph{Chat} cites them or labels its reply as general knowledge, and runs the guards and critic on demand.
```

### `paper/sections/setup.tex`

```text
before: Three more collections and two Python books are served by the web app without an evaluation set.
after:  The web app also serves three more collections and two Python books, which have no evaluation set.
```

```text
before: Both sets were built automatically with qwen2.5:3b (temperature \V{ev.temp}, seed \V{ev.seed}).
after:  We built both sets automatically with qwen2.5:3b (temperature \V{ev.temp}, seed \V{ev.seed}).
```

```text
before: Unanswerable questions asked about topics outside the corpus or moved an accepted question to another law, state or year; the check that the top \V{ev.rcheck} passages of a hybrid retriever do not answer them rejected \V{cl.ev.rcheckfail} of \V{cl.ev.rcheckin} candidates: the items are plainly out of scope and the check had nothing to filter (\V{cl.ev.usel} selected).
after:  Unanswerable questions asked about topics outside the corpus or moved an accepted question to another law, state or year.
after:  The check that the top \V{ev.rcheck} passages of a hybrid retriever do not answer them rejected \V{cl.ev.rcheckfail} of \V{cl.ev.rcheckin} candidates; the items are plainly out of scope, so the check had nothing to filter (\V{cl.ev.usel} selected).
```

```text
before: No generated item was reviewed by a person (Table~\ref{tab:filters}).
after:  No person reviewed any generated item (Table~\ref{tab:filters}).
```

```text
before: A question belongs to dev when a salted SHA-256 hash of its id, truncated and read as a number in $[0,1)$, falls below \V{split.dev}, otherwise to test; the split is computed, never stored.
after:  A question belongs to dev when a salted SHA-256 hash of its id, truncated and read as a number in $[0,1)$, falls below \V{split.dev}, otherwise to test; the split is computed each time and not stored.
```

```text
before: On dev we ran \V{cl.grid.n} configurations for consumer law (four chunkers; BM25, dense with three encoder sizes, RRF and linear hybrids; cross-reference expansion and reranking on or off) and \V{cs.grid.n} for CS/AI.
after (review): On dev we ran \V{cl.grid.n} configurations for consumer law (four chunkers; BM25, dense with three encoder sizes, RRF and linear hybrids; cross-reference expansion and reranking on or off) and \V{cs.grid.n} for CS/AI (structural and fixed-512 chunkers only).
```

```text
before: Besides Recall@$k$, MRR@10 and nDCG@10 we report \emph{token-budget coverage} at $b$ tokens: the share of gold provisions covered when ranked chunks are taken in order until the next would exceed $b$.
after (review): Besides Recall@$k$ (share of gold provisions in the top $k$ chunks), MRR@10 and nDCG@10 we report \emph{token-budget coverage} at $b$ tokens: the share of gold provisions covered when ranked chunks are taken in order until the next would exceed $b$.
```

```text
before: We also report correct refusal (abstention on unanswerable questions), false abstention (on answerable ones), the number of released wrong answers, and citation precision and recall, which use retrieval relevance to the gold provisions rather than NLI.
after:  We also report correct refusal (abstention on unanswerable questions), false abstention (on answerable ones), the number of released wrong answers, and citation precision and recall, which measure retrieval relevance to the gold provisions and do not use NLI.
```

### `paper/sections/results.tex`

```text
before: Both use the same encoder, so the difference is due to chunking, including the heading path that structural chunks carry: they are short (mean \V{cl.tok.structural} tokens against \V{cl.tok.fixed512}), so more distinct provisions fit than the two fixed-512 windows a \V{gen.budget}-token budget admits.
after:  Both use the same encoder, so the difference comes from chunking, including the heading path that structural chunks carry.
after:  Structural chunks are short (mean \V{cl.tok.structural} tokens against \V{cl.tok.fixed512}), so a \V{gen.budget}-token budget holds more distinct provisions than the two fixed-512 windows it admits.
```

```text
before: Short chunks alone may explain much of the gain: fixed-256 windows with hybrid retrieval and reranking reach similar coverage (\V{cl.ret.f256-hyb-rr.dcov} \V{cl.ret.f256-hyb-rr.dcovci} over naive RAG) but take \V{cl.ret.f256-hyb-rr.lat}\,ms per query on the CPU against \V{cl.ret.struct-b.lat}\,ms; we did not test section-aligned and fixed chunks of equal length.
after (review): Short chunks alone may explain much of the gain: fixed-256 windows reach similar coverage (\V{cl.ret.f256-hyb-rr.dcov} \V{cl.ret.f256-hyb-rr.dcovci} over naive RAG), although that configuration also uses hybrid retrieval and reranking, which raise its latency to \V{cl.ret.f256-hyb-rr.lat}\,ms per query on the CPU against \V{cl.ret.struct-b.lat}\,ms (Table~\ref{tab:retrieval}); we did not test section-aligned and fixed chunks of equal length.
```

```text
before: \paragraph{Retrieval is the largest gain.}
after:  \paragraph{Retrieval.}
after:  The retrieval change gives the largest gain.
```

```text
before: \paragraph{Verification mostly enforces citation format.}
after:  \paragraph{Verification.}
```

```text
before: So the verifier mainly enforces the citation format; it shows no measurable ability to detect cited but unsupported content, in line with weak self-critique by small models \citep{huang2024selfcorrect}.
before: What filtering buys is fewer wrong answers: on consumer law G4 releases \V{cl.sent.G4.wrong} answers judged incorrect against \V{cl.sent.G2.wrong} for G2, at the price of \V{cl.sent.G4.correct} correct answers against \V{cl.sent.G2.correct}.
after:  The verifier therefore mainly enforces the citation format and shows no measurable ability to detect cited but unsupported content, in line with weak self-critique by small models \citep{huang2024selfcorrect}.
after:  Filtering does reduce wrong answers: on consumer law G4 releases \V{cl.sent.G4.wrong} answers judged incorrect against \V{cl.sent.G2.wrong} for G2, at the price of \V{cl.sent.G4.correct} correct answers against \V{cl.sent.G2.correct}.
```

```text
before: \paragraph{A larger generator helps, if at all, on the textbooks.}
after:  \paragraph{Generator scale.}
after:  A larger generator helps, if at all, on the textbooks.
```

```text
before: On consumer law its differences to G2 are \V{cl.rel.G2H-G2} \V{cl.rel.G2H-G2ci} in released-answer faithfulness and \V{cl.boot.G2H-G2.acc} \V{cl.boot.G2H-G2.accci} in accuracy; the intervals are wide, so we cannot detect a difference rather than show there is none.
after:  On consumer law its differences to G2 are \V{cl.rel.G2H-G2} \V{cl.rel.G2H-G2ci} in released-answer faithfulness and \V{cl.boot.G2H-G2.acc} \V{cl.boot.G2H-G2.accci} in accuracy; the intervals are wide, so the data neither detect a difference nor show that there is none.
```

```text
before: It is much faster (median \V{cl.gen.G2H.p50}\,s against \V{cl.gen.G2.p50}\,s).
after (review): On the provider's hardware it is much faster than the local model on the laptop (median \V{cl.gen.G2H.p50}\,s against \V{cl.gen.G2.p50}\,s).
```

```text
before: \begin{figure}[t]
before: \centering
before: \includegraphics[width=\columnwidth]{figures/selective.pdf}
before: \caption{Accuracy of released answers against coverage when G2 and G4 also abstain below a top-1 retrieval-score threshold swept over the test scores (descriptive; points with at least five answered questions).
before: Circle (G2) and square (G4) at the right end: no threshold.
before: Star: G5, i.e.\ G4 with the threshold tuned on dev.}
before: \label{fig:selective}
before: \end{figure}
before: G5's retrieval-score threshold (\V{abs.thr}) was tuned on dev for the abstention F1 of the threshold alone (dev precision \V{abs.devp}, recall \V{abs.devr}), although G4 already refuses every unanswerable question; on test it abstained before generation on \V{cl.gen.G5.lowretrievalscore} questions, raised false abstention from \V{cl.gen.G4.falseabspct} to \V{cl.gen.G5.falseabspct} and changed accuracy relative to G4 by \V{cl.boot.G5-G4.acc} \V{cl.boot.G5-G4.accci} (all \V{sec.cl.G5-G4.acc.loss} discordant questions favour G4; permutation $p=\V{sec.cl.G5-G4.acc.p}$).
before: The tuning objective, not only the small dev set, explains this: the score separates answerable from unanswerable test questions well (AUROC \V{cl.ret.struct-b.auroc}), but there were no unanswerable questions left for it to catch.
before: In the descriptive sweep of Figure~\ref{fig:selective}, at G4's coverage (\V{cl.sel.G4.cov0}), G2 with a score threshold reaches an accuracy of released answers of \V{cl.sel.G2.atG4}, against \V{cl.sel.G4.acc0} for G4 (CS/AI: \V{cs.sel.G2.atG4} against \V{cs.sel.G4.acc0}); abstaining at random would keep G2's \V{cl.sel.G2.acc0}.
after:  G5's retrieval-score threshold (\V{abs.thr}) was tuned on dev for the abstention F1 of the threshold alone (dev precision \V{abs.devp}, recall \V{abs.devr}), although G4 already refuses every unanswerable question.
after (review): On test it abstained before generation on \V{cl.gen.G5.lowretrievalscore} questions, raised false abstention from \V{cl.gen.G4.falseabspct} to \V{cl.gen.G5.falseabspct}, lowered released-answer faithfulness by \V{cl.rel.G5-G4} \V{cl.rel.G5-G4ci} and changed accuracy relative to G4 by \V{cl.boot.G5-G4.acc} \V{cl.boot.G5-G4.accci} (all \V{sec.cl.G5-G4.acc.loss} discordant questions favour G4; permutation $p=\V{sec.cl.G5-G4.acc.p}$).
after (review): Besides the small dev set, the tuning objective explains this: the score separates answerable from unanswerable test questions well (area under the ROC curve \V{cl.ret.struct-b.auroc}), but G4 left no unanswerable questions for it to catch.
after (review): In the descriptive sweep of Figure~\ref{fig:selective} (Appendix~\ref{app:tables}), at G4's coverage (share of questions answered, \V{cl.sel.G4.cov0}), G2 with a score threshold reaches an accuracy of released answers of \V{cl.sel.G2.atG4}, against \V{cl.sel.G4.acc0} for G4 (CS/AI: \V{cs.sel.G2.atG4} against \V{cs.sel.G4.acc0}); abstaining at random would keep G2's \V{cl.sel.G2.acc0}.
```

```text
before: \input{tables/errors}
after:  (removed)
```

```text
before: The largest group in Table~\ref{tab:errors}, \emph{evaluation artefacts} (\V{err.evalartifact}), are not system errors: correct answers that the NLI judge does not entail (code, a formula, a short noun phrase), one gold answer that contradicts its source (it says mediation applies to public-interest cases, which the Mediation Rules exclude) and one ambiguous question.
after (review): The largest group in Table~\ref{tab:errors} (Appendix~\ref{app:errors}), \emph{evaluation artefacts} (\V{err.evalartifact}), are not system errors: correct answers that the NLI judge does not entail (code, a formula, a short noun phrase), one gold answer that contradicts its source (it says mediation applies to public-interest cases, which the Mediation Rules exclude) and one ambiguous question.
```

### `paper/sections/deployment.tex`

```text
before: The public assistant is a static site on GitHub Pages plus a proxy on the Cloudflare Workers free plan; model calls use the provider's free API tier, so the app costs nothing only within that tier's quotas.
before: In the browser, a Web Worker embeds the question with bge-small-en-v1.5 (ONNX, half precision, Transformers.js) and searches the structural chunks of all \V{lib.collections} collections (\V{lib.passages} passages from \V{lib.docs} documents), stored as int8 vectors with one scale each (\V{lib.vecgz}\,MB gzip), verified by SHA-256 and kept in the Cache API; passage text is fetched per hit from small shards.
after (review): The public assistant is a static site on GitHub Pages plus a proxy on the Cloudflare Workers free plan; model calls use the provider's free API tier, so the app is free only within that tier's quotas.
after:  In the browser, a Web Worker embeds the question with bge-small-en-v1.5 (ONNX, half precision, Transformers.js) and searches the structural chunks of all \V{lib.collections} collections (\V{lib.passages} passages from \V{lib.docs} documents).
after:  The vectors are stored as int8 with one scale per vector (\V{lib.vecgz}\,MB gzip), verified by SHA-256 and kept in the Cache API; passage text is fetched per hit from small shards.
```

```text
before: (iv) its ``verified'' stamp comes from the guards and critic, not the NLI judge; and
after:  (iv) its ``verified'' stamp comes from the guards and critic and does not involve the NLI judge; and
```

### `paper/sections/conclusion.tex`

```text
before: On held-out questions, structure-aware chunking increased how much gold evidence fits in the generator's context for statutes but not for textbooks.
before: Verification behaved as a filter that mainly enforces citation format, with no measurable change in the support of cited sentences; a larger hosted generator made no detectable difference on the statutes and gave an unconfirmed accuracy gain on the textbooks; and \V{err.evalartifact} of \V{err.n} sampled failures were evaluation artefacts.
after (review): On held-out questions, structure-aware chunking increased the share of gold evidence that fits in the generator's context for statutes; for textbooks the difference was not significant.
after:  Verification behaved as a filter that mainly enforces citation format, with no measurable change in the support of cited sentences, and a larger hosted generator made no detectable difference on the statutes and gave an unconfirmed accuracy gain on the textbooks.
after:  Of \V{err.n} sampled failures, \V{err.evalartifact} were evaluation artefacts.
```

### `paper/sections/limitations.tex`

```text
before: The test splits hold \V{cl.ev.test.n} and \V{cs.ev.test.n} questions, so intervals are wide and several comparisons are inconclusive rather than negative; some significant differences rest on a handful of questions.
before: The questions were generated and filtered by the same small model that answers them, from single provisions with those provisions as gold evidence; this matches the units the structural chunker produces and keeps only what the small model can answer, which may favour the structural chunker and push the generator comparison towards no difference.
after:  The test splits hold \V{cl.ev.test.n} and \V{cs.ev.test.n} questions, so intervals are wide and several comparisons are inconclusive: they neither show nor exclude a difference.
after:  Some significant differences rest on a handful of questions.
after (review): The same small model that answers the questions also generated and filtered them, from one or two source provisions with those provisions as gold evidence.
after:  This matches the units the structural chunker produces and keeps only what the small model can answer, which may favour the structural chunker and push the generator comparison towards no difference.
```

```text
before: Sampling failures reveals only false negatives of the judge, its false positives are unmeasured, and the error categories were assigned with AI assistance in a single pass, without a second annotator or an agreement study, and are exclusive (one label per failure).
after:  Sampling failures reveals only false negatives of the judge; its false positives are unmeasured.
after:  The error categories were assigned with AI assistance in a single pass, without a second annotator or an agreement study, and are exclusive (one label per failure).
```

```text
before: Generation used temperature \V{gen.temp} with a fixed seed and cached responses, but quantised local inference and hosted APIs are not guaranteed to be bit-reproducible, and the test runs were made from working trees with uncommitted changes whose diffs were not recorded.
after:  Generation used temperature \V{gen.temp} with a fixed seed and cached responses, but quantised local inference and hosted APIs are not guaranteed to be bit-reproducible.
after:  The test runs were made from working trees with uncommitted changes whose diffs were not recorded.
```

### `paper/sections/ethics.tex`

```text
before: Our design leans towards withholding rather than guessing, and the paper reports what that costs in unanswered questions.
after:  The design prefers withholding an answer to guessing, and this paper reports what that costs in unanswered questions.
```

### `paper/sections/appendix.tex`

```text
before: (none)
after:  \begin{figure}[t]
after:  \centering
after:  \includegraphics[width=\columnwidth]{figures/selective.pdf}
after:  \caption{Accuracy of released answers against coverage when G2 and G4 also abstain below a top-1 retrieval-score threshold swept over the test scores (descriptive; points with at least five answered questions).
after:  Circle (G2) and square (G4) at the right end: no threshold.
after:  Star: G5, i.e.\ G4 with the threshold tuned on dev.}
after:  \label{fig:selective}
after:  \end{figure}
```

```text
before: (none)
after:  \input{tables/errors}
```


## 2. Generated table captions: changed sentences

Caption text is written by `scripts/paper_tables.py`. Lines marked `after (review)` come from the IEEE review fixes.

### `paper/tables/bootstrap_compact.tex` (tab:bootstrap)

```text
before: Bold = interval excludes 0 (a bound at 0.000 counts as including 0); for overall accuracy, bold also requires a paired permutation test to give $p<0.05$ (uncorrected), and $^\dagger$ marks an interval that excludes 0 without it (few questions differ).
before: Table~\ref{tab:bootstrap-full} adds faithfulness on jointly answered questions, correct refusal and further pairs.
after (review): Bold = interval excludes 0 (a bound at 0.000 counts as including 0); for overall accuracy, bold also requires a paired permutation test to give $p<0.05$ (uncorrected), and $^\dagger$ marks an interval that excludes 0 without it (few questions differ). -- = not computed.
after:  Faithfulness on jointly answered questions, correct refusal and further pairs: \ExtRef{Table}{tab:bootstrap-full}.
```

### `paper/tables/devgrid.tex` (tab:devgrid)

```text
before: Used only to choose the test configurations; no test claims rest on it.
after:  The grid served only to choose the test configurations; no test claim rests on it.
```

### `paper/tables/errors.tex` (tab:errors)

```text
before: Error categories of 20 G4 test failures (of \V{cl.err.nfail} consumer-law and \V{cs.err.nfail} CS/AI failures), sampled with seed \V{err.seed} in proportion to the failures per collection.
after:  Error categories of 20 sampled G4 test failures.
after:  The sample was drawn from the \V{cl.err.nfail} consumer-law and \V{cs.err.nfail} CS/AI failures with seed \V{err.seed}, in proportion to the failures per collection.
```

### `paper/tables/generation_extra.tex` (tab:genextra)

```text
before: Citation precision = share of cited passages relevant to a gold provision (retrieval relevance, not NLI); citation recall = share of gold provisions covered by the cited passages (both over answered answerable questions).
after:  Citation precision = share of cited passages relevant to a gold provision (based on retrieval relevance, without NLI); citation recall = share of gold provisions covered by the cited passages (both over answered answerable questions).
```

### `paper/tables/generation_test.tex` (tab:generation)

```text
before: Ans.\ = share answered; Faith.\ = released-answer faithfulness (mean over answers); Uncit.\ = share of released sentences without a citation and Sup.\ = NLI support of cited sentences (both pooled over sentences, so they do not combine into Faith.); Corr.\ = correct among answered answerable questions (the accuracy of released answers); Wrong = released answers judged incorrect; F.\,abst.\ = false abstention; Calls = mean LLM calls per question (critic, revision and JSON-repair calls included); p50 s = median latency.
before: Metrics: \S\ref{sec:setup}; citation precision and recall: Table~\ref{tab:genextra}.
after (review): Ans.\ = share of all questions answered; Faith.\ = released-answer faithfulness (mean over answers); Uncit.\ = share of released sentences without a citation and Sup.\ = NLI support of cited sentences (both pooled over sentences, so they do not combine into Faith.); Corr.\ = correct among answered answerable questions (the accuracy of released answers); Overall = overall accuracy; Wrong = released answers judged incorrect; Refusal = correct refusal (share of unanswerable questions withheld); F.\,abst.\ = false abstention (share of answerable questions withheld); Calls = mean LLM calls per question (critic, revision and JSON-repair calls included); p50 s = median latency.
after (review): G3 and G5 are derived from the G2 and G4 records without new runs, so their Calls and p50 s come from those records.
after:  Metrics: \SecRef{sec:setup}; citation precision and recall: \ExtRef{Table}{tab:genextra}.
```


## 3. IEEE version: shortened sentences and their full-version source

### `paper/ieee/sections/abstract.tex`

```text
full:   Reading \V{err.n} sampled failures shows that \V{err.evalartifact} are artefacts of the automatic evaluation.
IEEE:   Reading \V{err.n} sampled failures shows that \V{err.evalartifact} are artifacts of the automatic evaluation.
```

```text
full:   (condensed from several sentences; closest: Dashed: abstention paths (the synthesizer finds no answer, or the guards or critic still reject after the revision).)
IEEE:   abstention, attribution, faithfulness, legal informatics, question answering, retrieval-augmented generation
```

### `paper/ieee/sections/introduction.tex`

```text
full:   For statutes the cost of an unsupported sentence is concrete: a wrong time limit or monetary threshold misleads a reader who cannot easily check the source.
IEEE:   For statutes the cost is concrete: a wrong time limit or monetary threshold misleads a reader who cannot easily check the source.
```

```text
full:   And what does verification buy and cost, given that withholding answers raises the faithfulness of what is released but fails users on answerable questions, and that a check sharing its criterion with the metric can look better than it is?
IEEE:   For the small domain collections that individual practitioners build, we ask which design choices change what the generator actually sees (chunkers are usually compared by Recall@$k$, which ignores how many retrieved chunks fit into the generator's token budget) and what verification buys and costs (withholding answers raises the faithfulness of what is released but fails users on answerable questions, and a check sharing its criterion with the metric can look better than it is).
```

```text
full:   We study these questions with VeriDex (codename \emph{agentic-rag}), an open pipeline evaluated on Indian consumer-protection law (the Consumer Protection Act, 2019 and its Rules; \V{cl.docs} documents) and on selected chapters of \V{cs.docs} open computer-science textbooks.
IEEE:   We study these questions with VeriDex, an open pipeline evaluated on Indian consumer-protection law and on selected chapters of \V{cs.docs} open computer-science textbooks.
```

```text
full:   It runs on a \V{hw.cores}-core laptop CPU with a small local generator (qwen2.5:3b), which a hosted open-weight model replaces in a generator-scale ablation.
IEEE:   It runs on a \V{hw.cores}-core laptop CPU with a small local generator (qwen2.5:3b), which a hosted open-weight model replaces in an ablation.
```

```text
full:   (condensed from several sentences; closest: In an error analysis, \V{err.evalartifact} of \V{err.n} sampled failures are artefacts of the automatic evaluation (\S\ref{sec:res-generation}, \S\ref{sec:res-errors}).)
IEEE:   Our contributions, the first three resting on test-split results, are (i) a measurement of chunkers by token-budget coverage, under which section-aligned chunks raise coverage on the statutes (on the textbooks the difference is not significant) and short chunks may explain the gain as much as section alignment; (ii) an accounting of verification, which raises released-answer faithfulness on the statutes almost entirely by withholding answers with uncited sentences; (iii) a generator-scale ablation and an error analysis in which \V{err.evalartifact} of \V{err.n} sampled failures are artifacts of the automatic evaluation; and (iv) a static deployment without hosting costs whose retrieval runs in the browser (its answer quality is not measured).
```

```text
full:   The code, configurations, result tables and the scripts that generate every number in this paper are public.\footnote{\url{https://github.com/Swapnil007-Curious/VeriDex}}
IEEE:   Code, configurations, result tables and the scripts that generate every number are public,\footnote{\url{https://github.com/Swapnil007-Curious/VeriDex}} and an extended version~\cite{shukla2026veridexext} adds the prompts, hyperparameters, all result tables and the reproducibility details.
```

### `paper/ieee/sections/related.tex`

```text
full:   Hybrids fuse the two by reciprocal rank fusion (RRF; \citealp{cormack2009rrf}) or by a convex combination of normalised scores, which \citet{bruch2023fusion} find to outperform RRF; cross-encoders rerank a short list \citep{nogueira2019bert}, here a distilled MiniLM model \citep{wang2020minilm}.
IEEE:   Hybrids fuse the two by reciprocal rank fusion (RRF)~\cite{cormack2009rrf} or by a convex combination of normalized scores, which Bruch et al.~\cite{bruch2023fusion} find to outperform RRF; cross-encoders rerank a short list~\cite{nogueira2019bert}, here a distilled MiniLM model~\cite{wang2020minilm}.
```

```text
full:   \citet{chen2024densex} show that finer retrieval units help downstream QA under a fixed computation budget, and our token-budget coverage applies the same view to chunkers.
IEEE:   Chen et al.~\cite{chen2024densex} show that finer retrieval units help downstream QA under a fixed computation budget, and our token-budget coverage applies the same view to chunkers; other work chunks reports by document elements~\cite{jimeno2024chunking} or finds that semantic chunking does not consistently justify its cost~\cite{qu2024semantic}.
```

```text
full:   Self-RAG trains a model to critique its own generations \citep{asai2024selfrag}, CRAG grades retrieved documents and falls back to other sources \citep{yan2024crag}, and Chain-of-Verification plans and answers verification questions before revising \citep{dhuliawala2024cove}; without external feedback, however, models often fail to correct themselves \citep{huang2024selfcorrect}.
IEEE:   Self-RAG trains a model to critique its own generations~\cite{asai2024selfrag}, CRAG grades retrieved documents~\cite{yan2024crag}, and Chain-of-Verification answers verification questions before revising~\cite{dhuliawala2024cove}; without external feedback, however, models often fail to correct themselves~\cite{huang2024selfcorrect}.
```

```text
full:   Attribution is evaluated with NLI in ALCE \citep{gao2023alce} and formalised as AIS (attributable to identified sources; \citealp{rashkin2023ais}); SummaC shows that NLI judges need inputs split to the granularity they were trained on \citep{laban2022summac}, and AlignScore trains a dedicated consistency model \citep{zha2023alignscore}.
IEEE:   Attribution is evaluated with NLI in ALCE~\cite{gao2023alce} and formalized as AIS (attributable to identified sources)~\cite{rashkin2023ais}.
```

```text
full:   Attribution is evaluated with NLI in ALCE \citep{gao2023alce} and formalised as AIS (attributable to identified sources; \citealp{rashkin2023ais}); SummaC shows that NLI judges need inputs split to the granularity they were trained on \citep{laban2022summac}, and AlignScore trains a dedicated consistency model \citep{zha2023alignscore}.
IEEE:   NLI judges need inputs split to the granularity they were trained on~\cite{laban2022summac}; AlignScore trains a dedicated consistency model~\cite{zha2023alignscore}; RAGAS~\cite{es2024ragas} and ARES~\cite{saadfalcon2024ares} use LLM judges.
```

```text
full:   We use a DeBERTa-v3 NLI model \citep{he2021debertav3} and examine where it fails (\S\ref{sec:res-errors}).
IEEE:   We use a DeBERTa-v3 NLI model~\cite{he2021debertav3} and examine where it fails.
```

```text
full:   \citet{kamath2020selective} calibrate when a QA model should abstain under domain shift, SQuAD~2.0 made unanswerable questions standard \citep{rajpurkar2018squad2}, and \citet{feng2024abstain} study when LLMs should abstain because of knowledge gaps.
IEEE:   Work on abstention calibrates QA models under domain shift~\cite{kamath2020selective}, adds unanswerable questions~\cite{rajpurkar2018squad2} and studies abstention under knowledge gaps~\cite{feng2024abstain}; we report refusal and false abstention separately.
```

```text
full:   IL-TUR benchmarks understanding and reasoning over Indian legal documents \citep{joshi2024iltur}, and LegalBench-RAG evaluates the retrieval of precise legal snippets \citep{pipitone2024legalbenchrag}; audits of commercial legal tools find frequent hallucinations \citep{magesh2024hallucination,dahl2024fictions}.
IEEE:   For law, IL-TUR benchmarks reasoning over Indian legal documents~\cite{joshi2024iltur} and LegalBench-RAG the retrieval of legal snippets~\cite{pipitone2024legalbenchrag}.
```

### `paper/ieee/sections/system.tex`

```text
full:   Figure~\ref{fig:arch} shows the pipeline; every run records its configuration, git commit (flagging uncommitted changes) and hardware.
IEEE:   Fig.~\ref{fig:arch} shows the pipeline; every run records its configuration, its git commit (and whether the working tree had uncommitted changes) and its hardware.
```

```text
full:   PyMuPDF extracts text with line positions and font sizes; cleaning removes running headers, page numbers and watermarks, and the Hindi pages and lines of the bilingual Gazette copies.
IEEE:   After PyMuPDF text extraction, cleaning removes running headers, page numbers, watermarks and the Hindi text of the bilingual Gazette copies.
```

```text
full:   A statute parser recovers chapters, sections or rules, sub-sections, clauses, provisos and explanations, each with a stable identifier (\cmd{cpa2019:s35(1)(a)}) and character offsets, and resolves internal cross-references to node identifiers (\V{cl.xrefs} in the consumer-law corpus).
IEEE:   A statute parser recovers chapters, sections or rules, sub-sections, clauses, provisos and explanations, each with a stable identifier, and resolves internal cross-references (\V{cl.xrefs} in the consumer-law corpus); a generic parser handles the textbooks.
```

```text
full:   \emph{Fixed} chunkers cut windows of \V{ch.fixed256.size} or \V{ch.fixed512.size} tokens (overlap \V{ch.fixed256.ov} or \V{ch.fixed512.ov}).
IEEE:   \emph{Fixed} chunkers cut windows of \V{ch.fixed256.size} or \V{ch.fixed512.size} tokens.
```

```text
full:   The \emph{semantic} chunker breaks between sentence or clause units where the bge-small cosine distance exceeds its \V{ch.sem.pct}th percentile, within \V{ch.sem.min}--\V{ch.sem.max} tokens.
IEEE:   The \emph{semantic} chunker breaks between sentence or clause units where the bge-small cosine distance exceeds its \V{ch.sem.pct}th percentile.
```

```text
full:   BM25 uses a tokenizer that also emits normalised statute references (``section 2(7)'' $\rightarrow$ \cmd{s2(7)}); dense retrieval uses bge-small, -base or -large with exact cosine search; hybrids fuse both by RRF ($k=\V{ret.rrfk}$) or a linear combination of min--max normalised scores (dense weight $\alpha=\V{ret.alpha}$).
IEEE:   BM25 uses a tokenizer that also emits normalized statute references; dense retrieval uses bge-small, -base or -large; hybrids fuse both by RRF ($k=\V{ret.rrfk}$) or a linear combination of min--max normalized scores (dense weight $\alpha=\V{ret.alpha}$).
```

```text
full:   Optional \emph{cross-reference expansion} adds up to \V{ret.xrefmax} chunks covering provisions referenced by the top \V{ret.xrefm} chunks (explored on dev, never selected), and optional reranking scores the top \V{ret.rerankn} with the cross-encoder \cmd{ms-marco-MiniLM-L-6-v2}.
IEEE:   Optional cross-reference expansion (explored on dev, never selected) and optional reranking of the top \V{ret.rerankn} with the cross-encoder \cmd{ms-marco-MiniLM-L-6-v2} follow.
```

```text
full:   Ranked chunks are packed in order until the next would exceed the token budget (\V{gen.budget} for the local model, \V{h.budget} for the hosted one), each wrapped in delimiters and labelled \cmd{[C$i$]}.
IEEE:   Ranked chunks are packed in order until the next would exceed the token budget (\V{gen.budget} for the local model, \V{h.budget} for the hosted one), each labeled \cmd{[C$i$]}.
```

```text
full:   The \emph{synthesizer} answers in strict JSON from the passages only, ends every sentence with the label of a supporting passage, copies numbers exactly, and abstains when the passages do not answer; passages are marked as untrusted data.
IEEE:   The \emph{synthesizer} answers in strict JSON from the passages only, ends every sentence with the label of a supporting passage, copies numbers exactly, and abstains when the passages do not answer.
```

```text
full:   After a guard failure or a revise verdict the synthesizer gets one revision round, with the reasons and a context extended to \V{gen.revbudget} tokens; if that round fails too, the system abstains (prompts in Appendix~\ref{app:prompts}).
IEEE:   After a guard failure or a revise verdict the synthesizer gets one revision round, with the reasons and a context extended to \V{gen.revbudget} tokens; if that round fails too, the system abstains.
```

```text
full:   The checks work per sentence, but the system releases or withholds the whole answer and never drops a single sentence.
IEEE:   The checks work per sentence, but the system releases or withholds the whole answer.
```

### `paper/ieee/sections/setup.tex`

```text
full:   We built both sets automatically with qwen2.5:3b (temperature \V{ev.temp}, seed \V{ev.seed}).
IEEE:   We built both question sets automatically with qwen2.5:3b.
```

```text
full:   Answerable candidates (\V{cl.ev.acand} for consumer law, \V{cs.ev.acand} for CS/AI) were drafted from provisions sampled by document and by type: definition, factual, procedural, numeric, cross-reference (the answer needs a provision the source refers to) and multi-section (it needs two provisions); the source provisions are the gold evidence.
IEEE:   Answerable candidates were drafted from provisions sampled by document and by type (definition, factual, procedural, numeric, cross-reference and multi-section), with the source provisions as gold evidence.
```

```text
full:   A candidate was kept only if it passed, in order: a format check (questions of \V{ev.qwords.lo}--\V{ev.qwords.hi} words); no provision numbers; lexical overlap with the source of at most \V{ev.copy} after one paraphrase; all gold-answer numbers present in the source; an LLM judgement that the source supports the answer; no conflicting numbers or entities when the model answered from the source alone; and no near-duplicate (cosine above \V{ev.dup}).
IEEE:   A candidate was kept only if it passed seven filters in order: format, no provision numbers, lexical overlap with the source of at most \V{ev.copy}, gold-answer numbers present in the source, an LLM support judgment, no conflict when answered from the source alone, and no near-duplicate.
```

```text
full:   Unanswerable questions asked about topics outside the corpus or moved an accepted question to another law, state or year.
IEEE:   Unanswerable questions asked about topics outside the corpus or moved an accepted question to another law, state or year; they are plainly out of scope, so a retrieval check that they are not answered by the corpus rejected \V{cl.ev.rcheckfail} of \V{cl.ev.rcheckin} consumer-law candidates (\V{cl.ev.usel} selected).
```

```text
full:   (condensed from several sentences; closest: Some significant differences rest on a handful of questions.)
IEEE:   CS/AI has no cross-reference questions.
```

```text
full:   No person reviewed any generated item (Table~\ref{tab:filters}).
IEEE:   No person reviewed any generated item.
```

```text
full:   A question belongs to dev when a salted SHA-256 hash of its id, truncated and read as a number in $[0,1)$, falls below \V{split.dev}, otherwise to test; the split is computed each time and not stored.
IEEE:   A question belongs to dev when a salted, truncated SHA-256 hash of its id falls below \V{split.dev}, otherwise to test.
```

```text
full:   This gives \V{cl.ev.dev.a}+\V{cl.ev.dev.u} (answerable + unanswerable) dev and \V{cl.ev.test.a}+\V{cl.ev.test.u} test questions for consumer law, and \V{cs.ev.dev.a}+\V{cs.ev.dev.u} and \V{cs.ev.test.a}+\V{cs.ev.test.u} for CS/AI.
IEEE:   This gives \V{cl.ev.dev.a}+\V{cl.ev.dev.u} (answerable + unanswerable) dev questions for consumer law and \V{cs.ev.dev.a}+\V{cs.ev.dev.u} for CS/AI; Table~\ref{tab:corpus} gives the test counts.
```

```text
full:   Only two evaluation scripts can obtain test questions and every access is logged (Table~\ref{tab:access}); all parameter tuning used dev.
IEEE:   Only two evaluation scripts can obtain test questions, every access is logged, and all parameter tuning used dev.
```

```text
full:   On dev we ran \V{cl.grid.n} configurations for consumer law (four chunkers; BM25, dense with three encoder sizes, RRF and linear hybrids; cross-reference expansion and reranking on or off) and \V{cs.grid.n} for CS/AI (structural and fixed-512 chunkers only).
IEEE:   On dev we ran \V{cl.grid.n} retrieval configurations for consumer law (four chunkers, BM25, three dense encoders and two hybrids, with and without expansion and reranking) and \V{cs.grid.n} for CS/AI (structural and fixed-512 chunkers only).
```

```text
full:   Besides Recall@$k$ (share of gold provisions in the top $k$ chunks), MRR@10 and nDCG@10 we report \emph{token-budget coverage} at $b$ tokens: the share of gold provisions covered when ranked chunks are taken in order until the next would exceed $b$.
IEEE:   Besides Recall@$k$ (the share of a question's gold provisions covered by the top $k$ chunks) we report \emph{token-budget coverage} at $b$ tokens: the share of gold provisions covered when ranked chunks are taken in order until the next would exceed $b$.
```

```text
full:   An answer's \emph{faithfulness} is the share of its sentences (citation tags removed) entailed with probability at least \V{nli.thr} by a single cited passage under \cmd{\V{nli.model}} (passages split into \V{nli.win}-token windows, stride \V{nli.stride}); a sentence without a citation counts as unsupported.
IEEE:   An answer's \emph{faithfulness} is the share of its sentences (citation tags removed) entailed with probability at least \V{nli.thr} by a single cited passage under \cmd{\V{nli.model}}, taking the maximum over \V{nli.win}-token windows of the passage (stride \V{nli.stride}), so long passages are not truncated; a sentence without a citation counts as unsupported.
```

```text
full:   The local generator is qwen2.5:3b \citep{qwen2024qwen25} through Ollama on the CPU (temperature \V{gen.temp}, at most \V{gen.maxtok} output tokens, a \V{gen.ctxwin}-token context).
IEEE:   The local generator is qwen2.5:3b~\cite{qwen2024qwen25} through Ollama (temperature \V{gen.temp}) on the laptop CPU (\V{hw.cpu}; \V{hw.ram}\,GB of RAM; no GPU).
```

```text
full:   The hosted generator is \gptoss{} \citep{openai2025gptoss}, a mixture-of-experts model, through \V{h.provider} (temperature \V{h.temp}, reasoning effort ``\V{h.effort}'', at most \V{h.maxtok} output tokens), chosen on \V{h.date}, before any of its results were seen, as the largest general instruction-tuned open-weight model the provider listed.
IEEE:   The hosted generator is \gptoss{}~\cite{openai2025gptoss}, a mixture-of-experts model, through \V{h.provider} (reasoning effort ``\V{h.effort}''), chosen, before any of its results were seen, as the largest general instruction-tuned open-weight model the provider listed.
```

```text
full:   G3 and G5 are derived from the G2 and G4 records without new runs, so their Calls and p50 s come from those records.
IEEE:   G3 and G5 are derived from the records of G2 and G4 without new LLM calls.
```

```text
full:   G5 and G6 were not run on CS/AI (G5 lowered accuracy on consumer law and CS/AI dev has only \V{cs.ev.dev.u} unanswerable questions; G6 is the slowest system).
IEEE:   G5 and G6 were run only on consumer law (G5 lowered accuracy there; G6 is the slowest system).
```

```text
full:   They stopped before reaching it (on consumer law at the provider's daily quota) and were then restricted to G2H, so G4H has no results.
IEEE:   The hosted runs stopped before reaching G4H, the hosted model with guards and critic (on consumer law at the provider's daily quota), so G4H has no results.
```

```text
full:   Intervals come from a paired bootstrap over questions (\V{boot.n} resamples, seed \V{boot.seed}, 95\% percentile intervals; \citealp{koehn2004significance,dror2018hitchhiker}); we call a difference significant when its interval excludes zero.
IEEE:   Intervals come from a paired bootstrap over questions (\V{boot.n} resamples, 95\% percentile intervals)~\cite{koehn2004significance,dror2018hitchhiker}; a difference is significant when its interval excludes zero.
```

```text
full:   Overall accuracy is binary per question, and when every question on which two systems differ favours one of them, a percentile interval excludes zero with as few as \V{prim.cl.G4-G2.acc.loss} such questions; for accuracy we therefore also require a paired permutation test to give $p<\V{stat.alpha}$.
IEEE:   A percentile interval for binary accuracy can exclude zero when only \V{prim.cl.G4-G2.acc.loss} questions differ, all in one direction, so an accuracy difference also needs a paired permutation test with $p<\V{stat.alpha}$.
```

```text
full:   (condensed from several sentences; closest: Faithfulness on jointly answered questions, correct refusal and further pairs: \ExtRef{Table}{tab:bootstrap-full}.)
IEEE:   \emph{Released-answer faithfulness} is each system's faithfulness over its own answers; comparing only jointly answered questions would score a stricter system on an easier subset.
```

```text
full:   Because percentile intervals are unreliable when few questions differ, we also test a family of \V{prim.m} primary comparisons, fixed after the first draft (when the test results were known), with paired permutation tests (\V{prim.nperm} permutations) and Holm's correction (Table~\ref{tab:primary}).
IEEE:   A family of \V{prim.m} primary comparisons, fixed after the first draft (when the test results were known), is also tested with paired permutation tests and Holm's correction\ifshowprimary{} (Table~\ref{tab:primary})\fi: structural against naive coverage, and G4 against G2 in released-answer faithfulness and accuracy, on both collections, plus G2H against G2 in accuracy on consumer law.
```

### `paper/ieee/sections/results.tex`

```text
full:   \includegraphics[width=\columnwidth]{figures/retrieval_deltas.pdf}
IEEE:   \includegraphics[width=\columnwidth]{figures/retrieval_deltas_ieee.pdf}
```

```text
full:   Labels: chunker, retriever (dense or hybrid-linear) with encoder size (s/b), rr = MiniLM reranking.
IEEE:   Labels: chunker, retriever and encoder size (s/b); rr = reranking.
```

```text
full:   (condensed from several sentences; closest: This gives \V{cl.ev.dev.a}+\V{cl.ev.dev.u} (answerable + unanswerable) dev and \V{cl.ev.test.a}+\V{cl.ev.test.u} test questions for consumer law, and \V{cs.ev.dev.a}+\V{cs.ev.dev.u} and \V{cs.ev.test.a}+\V{cs.ev.test.u} for CS/AI.)
IEEE:   Naive RAG reaches Recall@5 \V{cl.ret.naive.r5} and coverage \V{cl.ret.naive.cov1024} on consumer law (CS/AI: \V{cs.ret.naive.r5} and \V{cs.ret.naive.cov1024}); the other absolute values are in the extended version~\cite{shukla2026veridexext}.}
```

```text
full:   On consumer law (Figure~\ref{fig:retrieval}), the dev-selected configuration (structural chunks, dense bge-base) raises coverage at \V{gen.budget} tokens from \V{cl.ret.naive.cov1024} to \V{cl.ret.struct-b.cov1024} (\V{cl.ret.struct-b.dcov} \V{cl.ret.struct-b.dcovci}; Holm-adjusted $p=\V{prim.cl.cov.pholm}$), while its Recall@5 difference is \V{cl.ret.struct-b.dr5sig} (\V{cl.ret.struct-b.dr5} \V{cl.ret.struct-b.dr5ci}).
IEEE:   On consumer law (Fig.~\ref{fig:retrieval}), the dev-selected configuration (structural chunks, dense bge-base) raises coverage at \V{gen.budget} tokens from \V{cl.ret.naive.cov1024} to \V{cl.ret.struct-b.cov1024} (\V{cl.ret.struct-b.dcov} \V{cl.ret.struct-b.dcovci}; Holm-adjusted $p=\V{prim.cl.cov.pholm}$; strict relevance: \V{cl.strict.strict.d} \V{cl.strict.strict.dci}), while its Recall@5 difference is \V{cl.ret.struct-b.dr5sig} (\V{cl.ret.struct-b.dr5} \V{cl.ret.struct-b.dr5ci}).
```

```text
full:   Structural chunks are short (mean \V{cl.tok.structural} tokens against \V{cl.tok.fixed512}), so a \V{gen.budget}-token budget holds more distinct provisions than the two fixed-512 windows it admits.
IEEE:   Both use the same encoder, so the difference comes from chunking: structural chunks, which carry their heading path, are short (mean \V{cl.tok.structural} tokens against \V{cl.tok.fixed512}), so a \V{gen.budget}-token budget holds more distinct provisions than the two fixed-512 windows it admits.
```

```text
full:   Short chunks alone may explain much of the gain: fixed-256 windows reach similar coverage (\V{cl.ret.f256-hyb-rr.dcov} \V{cl.ret.f256-hyb-rr.dcovci} over naive RAG), although that configuration also uses hybrid retrieval and reranking, which raise its latency to \V{cl.ret.f256-hyb-rr.lat}\,ms per query on the CPU against \V{cl.ret.struct-b.lat}\,ms (Table~\ref{tab:retrieval}); we did not test section-aligned and fixed chunks of equal length.
IEEE:   Short chunks alone may explain much of the gain: fixed-256 windows reach similar coverage (\V{cl.ret.f256-hyb-rr.dcov} \V{cl.ret.f256-hyb-rr.dcovci}), although that configuration also uses hybrid retrieval and reranking, which raise its latency to \V{cl.ret.f256-hyb-rr.lat}\,ms per query against \V{cl.ret.struct-b.lat}\,ms; we did not test section-aligned and fixed chunks of equal length.
```

```text
full:   On CS/AI no difference is significant, including structural against fixed-512 chunks with the same encoder (coverage \V{cs.dret.struct-s-f512-s.dcov} \V{cs.dret.struct-s-f512-s.dcovci}) and bge-small against bge-base (Recall@5 \V{cs.ret.f512-s.dr5} \V{cs.ret.f512-s.dr5ci}).
IEEE:   On CS/AI, whose long sections the structural chunker splits more often (\V{cs.split.structural} against \V{cl.split.structural}), no difference is significant, including structural against fixed-512 chunks with the same encoder (coverage \V{cs.dret.struct-s-f512-s.dcov} \V{cs.dret.struct-s-f512-s.dcovci}; not shown in Fig.~\ref{fig:retrieval}).
```

```text
full:   On consumer law, G2 improves on naive RAG in released-answer faithfulness (\V{cl.rel.G2-G1} \V{cl.rel.G2-G1ci}), in support of cited sentences (\V{cl.cit.G2-G1} \V{cl.cit.G2-G1ci}) and in overall accuracy (\V{cl.boot.G2-G1.acc} \V{cl.boot.G2-G1.accci}).
IEEE:   The retrieval change gives the largest gain on test (Tables~\ref{tab:generation} and~\ref{tab:bootstrap}): G2 improves on naive RAG in released-answer faithfulness and cited-sentence support on both collections, and in overall accuracy on consumer law only (\V{cl.boot.G2-G1.acc} \V{cl.boot.G2-G1.accci}).
```

```text
full:   Among cited sentences, NLI support does not change significantly (G4$-$G2: \V{cl.cit.G4-G2} \V{cl.cit.G4-G2ci} on consumer law, \V{cs.cit.G4-G2} \V{cs.cit.G4-G2ci} on CS/AI), and the critic with its revision round adds nothing measurable over the guard filter (G4$-$G3 released-answer faithfulness \V{cl.rel.G4-G3} \V{cl.rel.G4-G3ci}; G3 withholds guard failures without revising them) while nearly doubling the LLM calls.
IEEE:   Among cited sentences, NLI support does not change significantly on either collection (consumer law: \V{cl.cit.G4-G2} \V{cl.cit.G4-G2ci}), and the critic with its revision round adds nothing measurable over the guard filter (G4$-$G3: \V{cl.rel.G4-G3} \V{cl.rel.G4-G3ci}) while nearly doubling the LLM calls.
```

```text
full:   The overall-accuracy differences (\V{cl.boot.G4-G2.acc} \V{cl.boot.G4-G2.accci}; \V{cs.boot.G4-G2.acc} \V{cs.boot.G4-G2.accci}) rest on \V{prim.cl.G4-G2.acc.loss} and \V{prim.cs.G4-G2.acc.loss} questions that G2 got right and G4 did not, with none in the other direction; the permutation tests give $p=\V{prim.cl.G4-G2.acc.p}$ and $p=\V{prim.cs.G4-G2.acc.p}$, not significant even before correction.
IEEE:   The overall-accuracy differences of G4 to G2 rest on \V{prim.cl.G4-G2.acc.loss} (consumer law) and \V{prim.cs.G4-G2.acc.loss} (CS/AI) questions that G2 got right and G4 did not, with none in the other direction; the permutation tests give $p=\V{prim.cl.G4-G2.acc.p}$ and $p=\V{prim.cs.G4-G2.acc.p}$, not significant even before correction.
```

```text
full:   G2 and G4 refuse all \V{cl.gen.nunans} and \V{cs.gen.nunans} unanswerable questions, but these are easy (\S\ref{sec:setup}); naive RAG already refuses \V{cl.gen.G1.refusaln} and \V{cs.gen.G1.refusaln}.
IEEE:   G2 and G4 refuse every unanswerable question, but these are easy; naive RAG already refuses \V{cl.gen.G1.refusaln} of \V{cl.gen.nunans} and \V{cs.gen.G1.refusaln} of \V{cs.gen.nunans}.
```

```text
full:   G6, built on the configuration with the best dev Recall@5, is far worse than G4 (released-answer faithfulness \V{cl.rel.G6-G4} \V{cl.rel.G6-G4ci}); its fixed-256 windows split \V{cl.split.fixed256} of the sections (structural: \V{cl.split.structural}).
IEEE:   G6, built on the configuration with the best dev Recall@5, is far worse than G4 (released-answer faithfulness \V{cl.rel.G6-G4} \V{cl.rel.G6-G4ci}).
```

```text
full:   On consumer law its differences to G2 are \V{cl.rel.G2H-G2} \V{cl.rel.G2H-G2ci} in released-answer faithfulness and \V{cl.boot.G2H-G2.acc} \V{cl.boot.G2H-G2.accci} in accuracy; the intervals are wide, so the data neither detect a difference nor show that there is none.
IEEE:   On consumer law its differences to G2 have wide intervals (Table~\ref{tab:bootstrap}), so the data neither detect a difference nor show that there is none.
```

```text
full:   On CS/AI it raises accuracy by \V{cs.boot.G2H-G2.acc} \V{cs.boot.G2H-G2.accci}: it abstains less on answerable questions (\V{cs.gen.G2H.falseabspct} against \V{cs.gen.G2.falseabspct}) and more of its answers are correct (\V{cs.gen.G2H.corrans} against \V{cs.gen.G2.corrans}).
IEEE:   On CS/AI it raises accuracy by \V{cs.boot.G2H-G2.acc} \V{cs.boot.G2H-G2.accci}: it abstains less on answerable questions (\V{cs.gen.G2H.falseabspct} against \V{cs.gen.G2.falseabspct}) and more of its answers are correct.
```

```text
full:   The gain rests on \V{sec.cs.G2H-G2.acc.win} questions only G2H got right against \V{sec.cs.G2H-G2.acc.loss} only G2 got right, and a paired permutation test, outside the corrected family, gives $p=\V{sec.cs.G2H-G2.acc.p}$; released-answer faithfulness does not change significantly (\V{cs.rel.G2H-G2} \V{cs.rel.G2H-G2ci}).
IEEE:   The gain rests on \V{sec.cs.G2H-G2.acc.win} questions only G2H got right against \V{sec.cs.G2H-G2.acc.loss} only G2 got right, and a paired permutation test, outside the corrected family, gives $p=\V{sec.cs.G2H-G2.acc.p}$; released-answer faithfulness does not change significantly.
```

```text
full:   G2H cites several passages in one sentence more often (consumer law: \V{cl.sent.G2H.multi} of \V{cl.sent.G2H.n} sentences, against \V{cl.sent.G2.multi} of \V{cl.sent.G2.n}), which a judge that requires a single entailing passage cannot credit; there its cited-sentence support changes by \V{cl.cit.G2H-G2} \V{cl.cit.G2H-G2ci}.
IEEE:   On consumer law G2H cites several passages in one sentence more often (\V{cl.sent.G2H.multi} of \V{cl.sent.G2H.n} sentences against \V{cl.sent.G2.multi} of \V{cl.sent.G2.n}), which a single-passage judge cannot credit; its cited-sentence support changes by \V{cl.cit.G2H-G2} \V{cl.cit.G2H-G2ci}.
```

```text
full:   On the provider's hardware it is much faster than the local model on the laptop (median \V{cl.gen.G2H.p50}\,s against \V{cl.gen.G2.p50}\,s).
IEEE:   Run on the provider's hardware, it is much faster than the local model on the laptop CPU (median \V{cl.gen.G2H.p50}\,s against \V{cl.gen.G2.p50}\,s on consumer law).
```

```text
full:   Faithfulness is lower at every stage (G2: \V{cs.gen.G2.faith} against \V{cl.gen.G2.faith}), largely because the small model leaves \V{cs.sent.G2.uncited} of its CS/AI sentences uncited; G4 then withholds \V{cs.gen.G4.falseabspct} of the answerable CS/AI questions (the guard filter alone, G3: \V{cs.gen.G3.falseabspct}).
IEEE:   On the textbooks, faithfulness is lower at every stage (G2: \V{cs.gen.G2.faith} against \V{cl.gen.G2.faith}), largely because the small model leaves \V{cs.sent.G2.uncited} of its CS/AI sentences uncited; G4 then withholds \V{cs.gen.G4.falseabspct} of the answerable CS/AI questions (the guard filter alone, G3: \V{cs.gen.G3.falseabspct}).
```

```text
full:   \caption{Accuracy of released answers against coverage when G2 and G4 also abstain below a top-1 retrieval-score threshold swept over the test scores (descriptive; points with at least five answered questions).
IEEE:   \caption{Accuracy of released answers against coverage (share of questions answered) when G2 and G4 also abstain below a top-1 retrieval-score threshold swept over the test scores (descriptive; points with at least five answered questions).
```

```text
full:   G5's retrieval-score threshold (\V{abs.thr}) was tuned on dev for the abstention F1 of the threshold alone (dev precision \V{abs.devp}, recall \V{abs.devr}), although G4 already refuses every unanswerable question.
IEEE:   G5 abstains before any LLM call when the top-1 dense cosine falls below a threshold (\V{abs.thr}) tuned on dev for the abstention F1 of the threshold alone, although G4 already refuses every unanswerable question.
```

```text
full:   On test it abstained before generation on \V{cl.gen.G5.lowretrievalscore} questions, raised false abstention from \V{cl.gen.G4.falseabspct} to \V{cl.gen.G5.falseabspct}, lowered released-answer faithfulness by \V{cl.rel.G5-G4} \V{cl.rel.G5-G4ci} and changed accuracy relative to G4 by \V{cl.boot.G5-G4.acc} \V{cl.boot.G5-G4.accci} (all \V{sec.cl.G5-G4.acc.loss} discordant questions favour G4; permutation $p=\V{sec.cl.G5-G4.acc.p}$).
IEEE:   On test it abstained before generation on \V{cl.gen.G5.lowretrievalscore} questions, raised false abstention from \V{cl.gen.G4.falseabspct} to \V{cl.gen.G5.falseabspct}, lowered released-answer faithfulness by \V{cl.rel.G5-G4} \V{cl.rel.G5-G4ci} and changed accuracy relative to G4 by \V{cl.boot.G5-G4.acc} \V{cl.boot.G5-G4.accci} (all \V{sec.cl.G5-G4.acc.loss} discordant questions favor G4; permutation $p=\V{sec.cl.G5-G4.acc.p}$).
```

```text
full:   In the descriptive sweep of Figure~\ref{fig:selective} (Appendix~\ref{app:tables}), at G4's coverage (share of questions answered, \V{cl.sel.G4.cov0}), G2 with a score threshold reaches an accuracy of released answers of \V{cl.sel.G2.atG4}, against \V{cl.sel.G4.acc0} for G4 (CS/AI: \V{cs.sel.G2.atG4} against \V{cs.sel.G4.acc0}); abstaining at random would keep G2's \V{cl.sel.G2.acc0}.
IEEE:   \ifshowselective In the descriptive sweep of Fig.~\ref{fig:selective}, at\else In a descriptive sweep of the threshold, at\fi{} G4's answer rate (\V{cl.sel.G4.cov0}), G2 with a score threshold reaches an accuracy of released answers of \V{cl.sel.G2.atG4}, against \V{cl.sel.G4.acc0} for G4; abstaining at random would keep G2's \V{cl.sel.G2.acc0}.
```

```text
full:   The verifier thus selects somewhat better than a retrieval-score rule at equal coverage, a descriptive comparison we did not test.
IEEE:   The verifier thus selects somewhat better than a retrieval-score rule at an equal answer rate, a descriptive comparison we did not test.
```

```text
full:   We sampled \V{err.n} G4 test failures (an answerable question answered incorrectly or withheld, or an unanswerable one answered), in proportion to the \V{cl.err.nfail} consumer-law and \V{cs.err.nfail} CS/AI failures, with seed \V{err.seed}.
IEEE:   We sampled \V{err.n} G4 test failures (an answerable question answered incorrectly or withheld, or an unanswerable one answered), \V{cl.err.nsample} on consumer law and \V{cs.err.nsample} on CS/AI in proportion to their failures.
```

```text
full:   Rule-based pre-labels from the records (gold provision in context, abstention reason, correctness of G2's identical first-round answer) were then checked against the question, gold answer, context and output, and the final labels were assigned with AI assistance; \V{err.agree} of \V{err.n} pre-labels were kept (Appendix~\ref{app:errors}).
IEEE:   Rule-based pre-labels were checked against each record, and the final labels were assigned with AI assistance (\V{err.agree} of \V{err.n} pre-labels kept).
```

```text
full:   The largest group in Table~\ref{tab:errors} (Appendix~\ref{app:errors}), \emph{evaluation artefacts} (\V{err.evalartifact}), are not system errors: correct answers that the NLI judge does not entail (code, a formula, a short noun phrase), one gold answer that contradicts its source (it says mediation applies to public-interest cases, which the Mediation Rules exclude) and one ambiguous question.
IEEE:   The largest group\ifshowerrors{} in Table~\ref{tab:errors}\fi, \emph{evaluation artifacts} (\V{err.evalartifact}), are not system errors: correct answers that the NLI judge does not entail (code, a formula, a short noun phrase), one gold answer that contradicts its source and one ambiguous question.
```

### `paper/ieee/sections/deployment.tex`

```text
full:   The public assistant is a static site on GitHub Pages plus a proxy on the Cloudflare Workers free plan; model calls use the provider's free API tier, so the app is free only within that tier's quotas.
IEEE:   The public assistant is a static site on GitHub Pages with a proxy on the Cloudflare Workers free plan, free only within the model provider's free-tier quotas.
```

```text
full:   (condensed from several sentences; closest: In the browser, a Web Worker embeds the question with bge-small-en-v1.5 (ONNX, half precision, Transformers.js) and searches the structural chunks of all \V{lib.collections} collections (\V{lib.passages} passages from \V{lib.docs} documents).)
IEEE:   A Web Worker in the browser embeds the question with bge-small-en-v1.5 and searches \V{lib.passages} int8 passage vectors (\V{lib.vecgz}\,MB gzip) in \V{web.embed.p50}\,ms and \V{web.search.p50}\,ms per question on the laptop (medians over \V{web.nq} dev questions).
```

```text
full:   (condensed from several sentences; closest: (iv) its ``verified'' stamp comes from the guards and critic and does not involve the NLI judge; and)
IEEE:   No answer-quality number in this paper measures the app: it retrieves with dense bge-small and a similarity gate only, three of its collections are unevaluated, its generator (\gptoss{}) was evaluated only without guards and critic, and its ``verified'' label comes from the guards and critic and does not involve the NLI judge.
```

### `paper/ieee/sections/limitations.tex`

```text
full:   The same small model that answers the questions also generated and filtered them, from one or two source provisions with those provisions as gold evidence.
IEEE:   The same small model that answers the questions also generated and filtered them, from one or two source provisions with those provisions as gold evidence; this may favor the structural chunker and push the generator comparison toward no difference.
```

```text
full:   No item was reviewed by a person: the error analysis found a wrong gold answer and an ambiguous question among \V{err.n} failures, and \V{cs.ev.test.passageref} of the \V{cs.ev.test.a} answerable CS/AI test questions refer to ``the passage'' or ``the text'', which a user never sees.
IEEE:   No item was reviewed by a person: the error analysis found a wrong gold answer and an ambiguous question, and \V{cs.ev.test.passageref} of the \V{cs.ev.test.a} answerable CS/AI test questions refer to ``the passage'' or ``the text'', which a user never sees.
```

```text
full:   The unanswerable questions are plainly out of scope (the retrieval check rejected none), so refusal rates and abstention F1 say little.
IEEE:   The unanswerable questions are plainly out of scope, so refusal rates say little.
```

```text
full:   Faithfulness and correctness rest on one NLI model with a fixed threshold that needs a single cited passage to entail a sentence.
IEEE:   Faithfulness and correctness rest on one NLI model with a fixed threshold that needs a single cited passage to entail a sentence; we did not validate it against human labels or a second judge, and sampling failures reveals only its false negatives.
```

```text
full:   The error categories were assigned with AI assistance in a single pass, without a second annotator or an agreement study, and are exclusive (one label per failure).
IEEE:   The error categories were assigned with AI assistance in a single pass without a second annotator.
```

```text
full:   Only one local and one hosted generator were tested; the hosted one also changes the context budget, output limit and reasoning, and was tested without guards and critic.
IEEE:   Only one local and one hosted generator were tested; the hosted one also changes the budgets and reasoning and was tested without guards and critic.
```

```text
full:   The primary family for multiple-comparison correction was fixed after the first draft and does not include the CS/AI generator comparison.
IEEE:   The primary family was fixed after the first draft and does not include the CS/AI generator comparison.
```

```text
full:   The test runs were made from working trees with uncommitted changes whose diffs were not recorded.
IEEE:   Quantized local inference and hosted APIs are not guaranteed to be bit-reproducible, and the test runs were made from working trees with uncommitted changes whose diffs were not recorded.
```

### `paper/ieee/sections/conclusion.tex`

```text
full:   Of \V{err.n} sampled failures, \V{err.evalartifact} were evaluation artefacts.
IEEE:   Of \V{err.n} sampled failures, \V{err.evalartifact} were evaluation artifacts.
```

