# Review: "Veridex: Hybrid Retrieval with Sentence-Level Verification for Trustworthy Question Answering over Statutes and Textbooks"

Reviewer role: skeptical workshop reviewer (ACL style, 8-page main text). I read the whole PDF (14 pages) and spot-checked a few claims against the per-question records and result tables in the repository. Where a point relies on those records rather than on the PDF, I say so.

---

## 1. Summary of the paper

The paper presents Veridex, a CPU-only RAG pipeline over Indian consumer-protection law (the Consumer Protection Act 2019 and four sets of Rules) and over chapters of three open CS textbooks. It parses document structure into section-level chunks, compares chunkers and retrievers on a dev grid, and generates answers with qwen2.5:3b. Each sentence must carry a citation, deterministic citation and number guards and a same-model critic check the answer, and the system abstains when they reject it. On automatically generated, hash-split test sets (85 and 56 questions), structural chunks raise token-budget coverage on the statutes (+0.267) but not on the textbooks. Guards plus critic raise released-answer faithfulness (NLI-judged) on the statutes (+0.133) and lower overall accuracy on both collections. A hosted gpt-oss-120b shows no significant difference on the statutes. An author-annotated error analysis of 20 failures finds 7 evaluation artefacts. A static browser deployment is described and its latency measured; the paper says its answer quality was not evaluated.

## 2. Scores

| Criterion | Score | Justification |
|---|---|---|
| Soundness | 2.5 / 5 | Test discipline and confidence intervals are better than usual. But the main faithfulness metric partly scores the guards' own criterion, the NLI judge is unvalidated, the generated test set favours the proposed configuration, and the generator ablation is confounded. |
| Excitement / Significance | 2.5 / 5 | Indian consumer law is an under-served domain and the honest, mostly negative findings are useful to practitioners. The main conclusions (filters trade coverage for precision; small chunks fit more evidence into a fixed budget) are expected, and they rest on one small model and two small sets. |
| Clarity | 3.5 / 5 | Precise, well organised and candid. However, key terms are undefined (citation precision/recall, question types), text and tables use different faithfulness measures, and Figure 4(a) presents a composed estimate as a measurement. |
| Reproducibility | 4 / 5 | Code, configs, caches, commits, commands and hardware are all given. Every test run was made from a dirty working tree, and the hosted results depend on a free third-party API. |
| Overall recommendation | 2.5 / 5 | Borderline. A careful, honest engineering study, but the central verification and generator claims need the metric re-analysis (issues 1, 4, 5) and some human validation (issue 2) before they can be relied on. |
| Reviewer confidence | 4 / 5 | I read the paper closely and checked a few numbers against the released records. I did not rerun anything. |

## 3. Strengths

- **Test discipline.** The dev/test split is computed from a hash, test access is logged, all selection is done on dev, and the hosted model was chosen and dated before its results were seen. This is rare in system papers.
- **Uncertainty is reported.** Paired bootstrap intervals are given for almost every comparison. Null and negative results (semantic chunking, BM25, the G5 threshold, CS/AI chunking) are stated plainly, and the lack of multiple-comparison correction is disclosed.
- **Awareness of the selection bias in faithfulness.** The authors notice that comparing faithfulness only on jointly answered questions favours a stricter system, and add released-answer faithfulness. Refusal and false abstention are reported separately.
- **Token-budget coverage.** Measuring retrieval by what fits into the generator's budget is a sensible complement to Recall@k when chunk sizes differ (but see issue 8 on prior work).
- **Costs are reported.** LLM calls, latency by stage, and the deployment's download size and per-query browser cost are given.
- **Error analysis is released.** The sample, rule-based pre-labels, final labels and rationales are released. The paper candidly reports a wrong gold answer and judge failures.
- **The gap to the deployment is disclosed.** Section 6 lists six concrete differences between the app and the evaluated pipeline instead of implying that the app was evaluated.
- **Useful engineering for the domain.** The statute parser with stable provision identifiers and resolved cross-references, number grounding that understands lakh and crore, and a pipeline that runs on a laptop CPU are all practical.

## 4. Top 10 issues (ordered by importance)

### Issue 1. The faithfulness metric partly scores the guards' own criterion and is biased by how the judge is built [TEXT]

**Where.** §4 Metrics (p. 4: "uncited sentences are unsupported"; a sentence must be "entailed by some cited passage"); §3 Agents and abstention (the citation-validity guard); §5.2 "Verification works as a filter" and "Retrieval is the largest single gain"; Tables 2, 3 and 7; the abstract.

**Why it matters.**
- *Shared criterion.* The citation-validity guard rejects any answer that has a sentence without a citation tag. The metric scores every uncited sentence as unsupported. G3 and G4 therefore remove, by construction, exactly the answers the metric penalises most, so part of the +0.121 / +0.133 / +0.142 gains is definitional. It does not show that the verifier detects unsupported content.
- *Spot check of the per-sentence records* (`results/generation/test/*/eval.jsonl` and the CS/AI equivalents):
  - G2 has 9 of 74 uncited sentences on consumer law and 21 of 47 on CS/AI. G4 has none.
  - Counting only cited sentences, G2's sentence-level support is 0.86 on consumer law and 0.46 on CS/AI, against 0.89 and 0.44 for G4.
  - So on CS/AI the whole verification gain, and on consumer law most of it, comes from removing answers with uncited sentences.
  - The near-zero G1 faithfulness on CS/AI (0.011) is also mostly uncited sentences (28 of 45).
- *Per-passage judging.* A sentence counts as supported only if a single cited passage entails it (maximum over passages and over 400-token windows). Sentences that combine two passages cannot get credit. Passages longer than one window are split: fixed-512 chunks are about 511 tokens, while structural chunks average 135 tokens and fit in one window. This can inflate the G2−G1 faithfulness gain (+0.572), which is labelled "retrieval", and penalise generators that synthesise across passages. In the records, G2H writes 28 of 72 sentences with more than one citation, supported at 0.61, against 14 of 74 at 0.93 for G2.

**Suggested fix.** All of the following re-uses existing outputs.
- Report faithfulness in two parts for every system: (a) citation-format failures (the share of uncited sentences) and (b) NLI support of cited sentences.
- State the verification claim on (b).
- Rescore with the concatenation of all cited passages as the premise, without splitting a passage across windows (or with a long-input consistency model such as AlignScore).
- Re-report G2−G1, G3/G4−G2 and G2H−G2 under the revised judge.

### Issue 2. Neither the faithfulness judge nor the correctness judge is validated, and the error analysis can only find one kind of judge error [NEW-EXP]

**Where.** §4 Metrics; §5.5; Table 4; Appendix D; Limitations ("The NLI judge", "One annotator"); the abstract ("7 are artefacts of the automatic evaluation").

**Why it matters.**
- *One judge for everything.* Every answer-level conclusion rests on one off-the-shelf NLI cross-encoder with a fixed 0.5 threshold. It is used for faithfulness (passage entails sentence) and for correctness (answer entails a gold answer that a 3B model generated).
- *Direction of the correctness test.* With premise = answer and hypothesis = gold, short correct answers fail ("two crore rupees"), and so does any answer when the gold answer carries extra detail.
- *The noise is large and probably not uniform.* 7 of 20 sampled failures (5 of 11 on consumer law) are judge or label artefacts. Answer length, style and number of citations differ between systems and generators, so the noise likely affects some systems more than others. That would bias the comparisons, not only the absolute levels.
- *Only false negatives can be found.* The sample contains only failures, so it can find judge false negatives but never judge false positives (wrong answers counted as correct, unsupported sentences counted as entailed). The "verifier false accept" category is itself defined by the NLI judge (Appendix D), so it cannot detect judge errors.
- *One annotator.* The single annotator is presumably the system's author, and there is no agreement study.

**Suggested fix.**
- Have two annotators label a stratified sample, for example 150 answers covering G1, G2, G4 and G2H, both collections, and both judged-correct and judged-incorrect items.
- Label correctness and per-sentence support. Report Cohen's κ and the judge's precision and recall against the human labels, per system.
- Re-estimate the key differences with the human labels, or with a judge calibrated on them.
- Add a judge from a different model family (an LLM judge or AlignScore) and report its agreement.
- Rephrase the abstract claim to "judged by one annotator".

### Issue 3. The generated test set favours the proposed configuration and the local model, and the refusal metrics carry no information [NEW-EXP]

**Where.** §4 Questions and Split (pp. 3–4); Table 9; Table 2 (Refusal, Overall); §5.3 (AUROC); Limitations.

**Why it matters.**
- **(a) Construction favours the structural chunker and the 3B model.** Answerable questions were drafted by qwen2.5:3b from single provisions, with that provision as the gold evidence. They were kept only if the same model could answer from the source. This matches the questions to exactly the units the structural chunker produces, which favours the chunking claim. It also keeps only what the 3B model can do, which pushes the generator comparison towards "no difference".
- **(b) No item was reviewed,** yet 20 failures already contained a wrong gold answer and an ambiguous question.
- **(c) The unanswerable questions are trivially out of scope.**
  - Table 9 shows that the retrieval_check filter rejected none of the 85 consumer-law and 54 CS/AI candidates.
  - Every system refuses nearly all of them (G2 and G4: 1.000; G1: 0.882 and 1.000).
  - So 17 of 85 and 16 of 56 test questions (20% and 29%) are free points. They inflate "overall accuracy" and the AUROC of 0.932 / 0.866.
  - Behind G4's overall accuracy of 0.529, it answers correctly only 28 of 68 answerable consumer-law questions (41%) and 8 of 40 CS/AI questions (20%).
- **(d) Question types are never defined.** The sets are "stratified by type", but the types are not described anywhere. The repository shows cross-reference, definition, factual, multi-section, numeric and procedural questions. No per-type results are given, although multi-section questions are where structural chunks should do worst.

**Suggested fix.**
- *New experiment:* have a human (ideally someone with legal training) review all consumer-law test items.
- *New experiment:* add 30–50 human-written questions, including multi-provision questions and hard unanswerable ones (false-premise or near-miss questions for which retrieval does find related passages).
- *Re-analysis of existing results:* make accuracy on answerable questions the primary accuracy number, report refusal separately, and add a per-type results table.

### Issue 4. What verification buys is mis-attributed: the critic adds nothing measurable, and there is no matched-coverage baseline [TEXT]

**Where.** Abstract; §1 contribution 2; §5.2 "Verification works as a filter"; §5.3; Figure 3; Table 3; Table 7 (the G4−G3 "Released" cell is "–").

**Why it matters.**
- **(a) The critic shows no effect.**
  - The abstract credits "citation and number checks and a critic model", but the guards alone (G3) give +0.121 of the +0.133.
  - Released faithfulness from G3 to G4 is 0.866 → 0.878 on consumer law and 0.455 → 0.444 on CS/AI. The one cell that measures the critic's effect on faithfulness is empty in Table 7.
  - The critic roughly doubles LLM calls (1.98 against 1.00) and adds about 10 s of median latency.
- **(b) No matched-coverage baseline.** Any filter that correlates with the metric raises released faithfulness. The relevant question is whether the verifier does better than a cheap abstention rule at the same coverage. Figure 3 already contains this comparison, but the paper neither states nor tests it:
  - Consumer law: at G4's coverage (0.58), G2 plus the retrieval-score threshold reaches about 0.52, against 0.571 for G4.
  - CS/AI: at G4's coverage (0.32), the two are about the same (≈0.41 against 0.44).
- **(c) The metric decides the headline.** "Overall accuracy" counts a withheld answer the same as a wrong one, so "verification lowers accuracy" largely follows from the metric. The same records show that G4 releases 21 incorrect consumer-law answers against 34 for G2, at the cost of net 4 fewer correct answers (both by the NLI judge). The paper itself argues that a wrong time limit is the costly error in statute QA.
- **(d) G5's tuning objective explains its failure.** G5's threshold was tuned to maximise the abstention F1 of the threshold alone, although G4 already refuses every unanswerable test question. The objective, rather than a failure to "transfer", explains why G5 hurts. The sentence "G5's operating point lies on that curve" is true by construction, because G5 is G4 plus a threshold.

**Suggested fix.**
- Fill in G4−G3 released faithfulness with its interval, and state plainly that the critic loop has no measurable effect.
- Report risk–coverage curves (with area under the curve) for faithfulness and accuracy, with bootstrap intervals, comparing G2 plus threshold with G3 and G4 at matched coverage. Add random abstention at matched coverage as a floor.
- Report the number of wrong answers released, and a cost-weighted score (+1 correct, 0 abstain, −c wrong, for c = 1 and 2).
- Re-tune G5's threshold on dev for the end-to-end accuracy of G4 plus threshold. No new LLM calls are needed, because G5 is derived from the G4 records.

### Issue 5. Statistics: many uncorrected tests, very small n, and "not significant" read as "no change" [TEXT]

**Where.** §4 Statistics; §§5.1–5.3; Figure 2; Tables 3 and 7; the §5.2 heading "A larger generator does not change the picture"; the abstract and conclusion.

**Why it matters.**
- *Multiple comparisons.* The paper reports more than 40 intervals: 14 in Figure 2 and about 45 cells in Table 7. They use 1,000 percentile resamples and no correction. Several headline intervals lie close to zero (accuracy −0.047 [−0.094, −0.012]; CS/AI −0.089 [−0.161, −0.018]). They may not survive a Holm correction even across the ten main comparisons of Table 3.
- *Very few discordant items.* Some comparisons hinge on one to three questions. CS/AI G4−G3 accuracy is −0.018, i.e. 1 of 56 questions. The both-answered comparisons have n = 15 and 18. Percentile bootstrap intervals are unreliable in this regime, and boundary intervals such as [−0.054, 0.000] are ambiguous under the "excludes zero" rule.
- *Absence of evidence read as evidence of absence.* The generator claim treats a non-significant result as no effect. The accuracy interval [−0.071, +0.129] is compatible with a 13-point gain, and G2H answers 53% of answerable questions correctly against 47% for G2.
- *Different faithfulness measures for the same comparison.*
  - G2−G1: the text gives +0.572 (both answered); Table 3 gives +0.566 (released).
  - G2H−G2: the text gives −0.003; Table 3 gives +0.015.
  - G6−G4: the text gives −0.481, which appears in no table. §5.2 says "all comparisons: Table 7", but G6−G4 is missing there.

**Suggested fix.**
- Declare a small family of primary comparisons, for example: coverage, structural against naive; G4−G2 released faithfulness; G4−G2 accuracy; G2H−G2. Apply Holm within that family.
- For binary outcomes, give exact McNemar p-values and the number of discordant questions.
- Use at least 10,000 resamples, with BCa intervals.
- For "no difference" claims, give the minimum detectable effect or an equivalence test, and describe the result as inconclusive.
- Use one faithfulness measure consistently in the text and in Table 3, and add G6−G4 to Table 7.

### Issue 6. The generator-scale ablation is confounded and overclaimed [NEW-EXP]

**Where.** §4 Generators and systems; §5.2; Table 2 (G2H row); Table 5 (budgets); Table 3 ("isolates: generator"); the abstract; the conclusion; §6 difference (iii).

**Why it matters.**
- *More than the generator changes.* Besides the model, G2H changes the context budget (2,048 against 1,024 in round 1), the output limit (1,024 against 512 tokens), and adds hidden reasoning. Table 3 nevertheless labels the row "isolates: generator".
- *The evaluation leans towards the small model.* The test set was filtered for what qwen2.5:3b can answer and is judged against gold answers it wrote (issue 3). The judge also penalises the multi-passage sentences that G2H writes more often (issue 1).
- *Narrow coverage.* Only one hosted model was tested, and only without guards and critic, although the deployed app runs the hosted model with guards and critic.
- *An unreported run.* The repository's test-access log (`results/test_access_log.json`) records two launches of "G2H G4H" on the consumer-law test split (2026-11-12, commit a3b6d4b) before the reported G2H-only run. The paper never mentions G4H.

**Suggested fix.**
- Make the row isolate the generator: run G2H with the local budgets and output limit, or run G2 with the hosted budgets (the local model has a 4,096-token window).
- Run and report G4H, which is the deployed configuration, or explain why the launched G4H runs were abandoned.
- Ideally add a mid-size open model (7–8B) so the paper shows a trend rather than one point.
- Rephrase the claim as "we could not detect a difference on 85 statute questions".

### Issue 7. The title, abstract and system description promise more than was evaluated [TEXT]

**Where.** Title; abstract; §1; Figure 1; §3; Table 2 caption; Table 6.

**Why it matters.**
- **(a) "Hybrid retrieval".** The retriever selected on dev and the deployed retriever are dense-only on both collections (structural chunks with bge-base or bge-small). The only hybrid system tested end to end, G6, is the worst system in Table 2.
- **(b) Cross-references.** Cross-reference resolution and expansion (232 resolved references; Figure 1; §3) are not part of any evaluated or deployed system. On average they lowered dev metrics (Table 10).
- **(c) "Sentence-level verification".** Answers are about one sentence long: a spot check finds 74 sentences over 66 G2 consumer-law answers, and 1.08 sentences per G4 answer. The decision is to release or withhold the whole answer; no sentence is ever removed.
- **(d) "Trustworthy".**
  - G4 answers 41% and 20% of answerable questions correctly and withholds 28% and 55% of them.
  - Its released answers have faithfulness 0.878 and 0.444, under a judge the authors themselves find unreliable.
- **(e) Unqualified generator claim.** The abstract's "a much larger hosted generator changes neither significantly" is not restricted to the statutes, although the CS/AI run is pending.

**Suggested fix.**
- Retitle around what is shown, for example: "Structure-aware chunking and answer-level verification for small-model RAG over Indian consumer law: a held-out evaluation".
- Drop "hybrid" and "trustworthy".
- Describe cross-reference expansion as explored but not selected.
- Describe the verifier as citation and number guards with answer-level abstention, and report answer length.
- Restrict the generator claim to the statutes.
- Give absolute numbers in the abstract (correct on answerable questions, coverage), not only differences.

### Issue 8. The chunking claim is narrower than presented, and coverage@1024 does not predict downstream quality [NEW-EXP]

**Where.** §5.1; Figure 2; Table 6; §5.2 (G6); Table 10; §4 Metrics (the relevance definition); §2.

**Why it matters.**
- *What the significant result compares.* The only significant coverage result compares structural chunks with fixed-512 windows at a 1,024-token budget. Fixed-512 can contribute at most two chunks there, so it is close to a Recall@2 against Recall@7 comparison.
- *Coverage does not predict generation quality.* A fixed-256 configuration almost matches structural coverage (0.748 against 0.757, Table 6). Yet the end-to-end system built on it (G6) has faithfulness 0.392 against 0.878. So the metric the paper promotes does not track what the generator does with its context.
- *No single-factor test.* G6 differs from G4 in chunker, fusion and reranking at the same time, and no test compares structural chunks with fixed-256 chunks under the same retriever.
- *Heading-path prefix.* The structural chunker prepends the heading path to the embedded text (§3), so the claim "this isolates the chunker" also includes a document-expansion effect.
- *Lenient relevance.* A chunk counts as relevant when it contains part of an ancestor below chapter level. This credits sibling sub-sections and may favour structure-aligned chunks; its effect is not measured.
- *Prior work.* Chen et al. (2024), cited only for propositions, already compare retrieval granularities under a fixed budget of retrieved words, so the budget-normalised view is not new.

**Suggested fix.**
- *New experiment (cheap, no LLM):* add retrieval-only test runs for fixed-256 with dense bge-base, and for fixed windows with the heading-path prefix.
- *Re-analysis:* report coverage under a strict relevance definition (the gold node's own text must be present) next to the lenient one.
- *Re-analysis:* report the per-question correlation between coverage and answer correctness or faithfulness across systems.
- Position the coverage metric relative to Chen et al. (2024).

### Issue 9. The deployment is listed as a contribution, but its quality is unmeasured and its latency figure is partly synthetic [NEW-EXP]

**Where.** §1 contribution 4; §3 (Chat and Grounded-only modes); §6; Figure 4(a); Table 8; Ethics.

**Why it matters.**
- *What separates the app from the evaluated pipeline* (§6 lists six differences):
  - int8 bge-small retrieval over 14,064 passages from five collections; retrieving across collections adds distractors;
  - a per-collection gate, which is a G5-like pre-generation threshold of the kind §5.3 found harmful;
  - the hosted generator combined with guards and critic, which was never evaluated;
  - a Chat mode;
  - unevaluated law and health collections served to the public.
- *Figure 4(a) is not a measurement of the app.* Its "web app" bar adds the G2H API latency on 85 consumer-law test questions to browser retrieval time on 62 dev questions. It also omits the critic calls that Grounded-only mode makes.
- *Load cost.* The cold load is 88 MB and was measured on localhost only.

**Suggested fix.**
- Evaluate the deployed pipeline (browser retriever over all collections, gate, hosted generator, guards and critic) on the existing consumer-law and CS/AI test splits. This can be done through the TypeScript port in headless Chromium or with an equivalent Python configuration.
- Measure end-to-end latency of the live site over a throttled network.
- If that is out of scope, move the deployment to an appendix or demo note, remove it from the contributions, and label Figure 4(a) as an estimate.

### Issue 10. Related work misses directly relevant lines of research [TEXT]

**Where.** §2.

**Why it matters.** Several missing threads bear directly on the paper's novelty claims and on its design choices (judge, critic, test-set construction).

**Suggested fix.** Add and discuss:
- **(i) Indian legal NLP and IR.** Statute retrieval in the FIRE AILA 2019/2020 tracks, and IL-TUR (Joshi et al., ACL 2024). Both are needed before claiming novelty for Indian statutes.
- **(ii) Budget-normalised granularity evaluation and chunking studies.** Chen et al. (2024)'s fixed-word-budget evaluation, and Qu et al. (2024), "Is semantic chunking worth the computational cost?", whose finding matches the paper's null result for the semantic chunker.
- **(iii) Factual-consistency and attribution evaluators beyond SummaC and ALCE.** TRUE (Honovich et al., 2022), AlignScore (Zha et al., 2023), AttrScore (Yue et al., 2023), AttributionBench (Li et al., 2024) and FActScore (Min et al., 2023). They inform the judge design discussed in issues 1–2.
- **(iv) Weak same-model self-critique.** Huang et al. (ICLR 2024), "Large language models cannot self-correct reasoning yet", which helps explain the null critic result.
- **(v) Synthetic RAG evaluation sets and their biases.** ARES (Saad-Falcon et al., NAACL 2024) and RAGAS test-set generation.
- **(vi) Abstention in LLM QA.** For example, Feng et al. (ACL 2024), "Don't hallucinate, abstain".

For each line, say what is already known and how Veridex differs.

## 5. Minor comments

**Must fix before submission (anonymity and placeholders).** The PDF names the author ("Swapnil TODO"), affiliation and country, links a personal GitHub account, and gives the project codename. That breaks double-blind review and risks desk rejection. The author block and the Acknowledgments still contain placeholders ("TODO", "AI assistance disclosure: TODO-AUTHOR-WRITES-THIS"). Anonymise the repository link (for example with an anonymous mirror) and complete the AI-assistance disclosure that ACL requires.

**Handling of the pending CS/AI G2H run.** The handling is mostly clear: the PEND. cells, the orange text, and the statements in §4 and Limitations agree. Three things are confusing:
- The orange sentence in §5.2 reads like an unfilled template ("are PENDING PENDING in faithfulness (PENDING) and PENDING PENDING in accuracy (PENDING)"). Replace it with one bracketed note until the run finishes.
- "4 of 56 test questions" (§4) will go stale; give the date or drop the count.
- The abstract's generator claim should say "on the statutes" (issue 7e).

**Definitions and description.**
- Citation precision and citation recall are reported in Table 2 but never defined. The code defines them through retrieval relevance to the gold provisions, not through NLI; say so, because they can disagree sharply with faithfulness (CS/AI G1: citation precision 0.500, faithfulness 0.011).
- Table 2's "Faith." column is released-answer faithfulness. Label it that way so readers can link it to Table 3.
- G1's Calls value of 1.05 is above 1 for a single-call system. Explain it (retries after JSON parse failures?).
- §4 does not say that CS/AI started from 140 answerable candidates, not 200 (Table 9). Also say which split the 3 hand-written seed items fell into.
- Figure 1 shows neither the G5 pre-generation threshold nor the app's gate. Its legend says "Grey: offline ingestion", but the Abstain box is also grey.

**Wording and claims.**
- §5.4 opens with "Every effect is weaker on the textbooks". The guards' released-faithfulness gain is larger on CS/AI (+0.142 against +0.121), and the accuracy cost is also larger. Rephrase.
- In §5.4, attributing the CS/AI judge failures to code and formulas rests on 4 items; mark it as a hypothesis.
- Spelling is inconsistent: "artefacts" in the abstract and Conclusion, "artifacts" in §5.5 and Table 4.
- §3 "Agents and abstention" and the codename "agentic-rag" suggest an agentic system. The pipeline is a fixed sequence with one revision round, so "Generation and verification" would describe it better.
- §4's account of how the hosted model was chosen ("the intended rule ... found none") is clunky. Move the history to the appendix and keep the rule.
- The privacy paragraph says "neither stores or logs message contents". The authors can only vouch for their own Worker; for the provider, cite its data policy. The grammar should be "neither ... nor".
- Lighthouse mobile performance of 93 sits oddly next to an 88 MB cold load. State that Lighthouse does not include the worker's model download.
- "Zero-cost" depends on a third-party free API tier capped at 800 requests per day. Mention this in §6 and in Limitations.

**Figures and tables.**
- Figure 2: the consumer-law panel has no x-axis tick labels, the tick labels are small, and the page has a large blank area below the caption. Print the point estimates next to the bars.
- Figure 3: change the y-axis label to "Accuracy of answered questions" and explain the square and circle markers in a legend, not only in the caption. Drop the sentence about G5 lying on the curve (it is true by construction).
- Figure 4 and Table 2 mix means and medians: G4 on consumer law is 42.3 s as a median and 53.2 s as a mean. Label each one clearly. Mark Figure 4(a)'s "Web app" bar as composed (issue 9).
- Table 3: state the bold rule for intervals with a bound at exactly 0.000, such as G3−G2 accuracy [−0.082, 0.000].
- Table 6: BM25 latency is shown as "0" ms; write "<1".
- Table 7: fill in the "–" cells for G4−G3 released faithfulness.
- Table 10: the grid is unbalanced (for example, 48 bge-base against 16 bge-small configurations), so the marginal means are confounded with the other factors. Say so in the caption, or show per-chunker rows.

**Appendix and references.**
- Appendix A shows only the consumer-law prompts. Add the CS/AI prompts, at least as a diff.
- Appendix E says "Windows 10 (10.0.26200)", while the setup block says Windows 11; build 26200 is Windows 11. Also, every test run was made from a dirty working tree. Release the recorded diffs next to the commits.
- Several references cite arXiv versions of peer-reviewed papers: Self-RAG (ICLR 2024), DeBERTaV3 (ICLR 2023), Lewis et al. (NeurIPS 2020), Geifman & El-Yaniv (NeurIPS 2017), MiniLM (NeurIPS 2020).
- Many entries print the arXiv identifier twice ("arXiv preprint arXiv:… Preprint, arXiv:…").
- Capitalisation is lost in titles ("Self-rag", "Inpars", "Debertav3", "Minilm", "Bm25", "ai legal", "bert", "nlp", "chinese"). Protect it with braces in the .bib file.

**Ethics section.** State explicitly that the publicly served "Indian law" and "Human biology" collections have no quality evaluation, next to the not-advice notice.

**Page limit.** The main text ends on page 8 and appears to comply with the limit.

---

## Revisions made after this review

Every [TEXT] issue was addressed using only existing outputs (re-analysis and rewriting). The
[NEW-EXP] items that need new runs or annotation are listed under "Not done". All new numbers
come from `scripts/paper_tables.py` (snapshots in `paper/data/`).

**Issue 1 (shared criterion): fixed.**
- Faithfulness is now reported in two parts in Table 2: the share of uncited sentences, and NLI
  support of cited sentences. Table 3 bootstraps the cited-sentence support.
- The verification claim in the abstract, the introduction, §5.2 and the conclusion is restated
  on this basis. The released-faithfulness gain comes from withholding answers with uncited
  sentences; cited-sentence support G4−G2 is +0.025 [−0.019, 0.081] on consumer law, so not
  significant.
- The single-passage limitation of the judge, and the multi-citation sentences of G2H, are now
  discussed (§5.2, Limitations).
- Not done: rescoring with concatenated cited passages or with AlignScore. That would change the
  evaluation protocol after the test results are known; it is listed under future work.

**Issue 4 (what verification buys): fixed in text and re-analysis.**
- G4−G3 released and cited faithfulness are now filled in, and the paper states that the critic
  adds nothing measurable.
- Added the number of released wrong answers (G4: 21, G2: 34 on consumer law), and a
  matched-coverage comparison with G2 plus a score threshold, labelled descriptive (§5.3).
- G5's failure is now attributed to its tuning objective.
- The "lies on the curve" claim is now stated as true by construction.
- Not done: re-tuning G5 for end-to-end accuracy (a new test-evaluated variant), and
  risk–coverage AUCs with intervals.

**Issue 5 (statistics): fixed.**
- Added a seven-test primary family with paired permutation tests (10,000 permutations) and Holm
  correction (Table 8), plus discordant counts.
- With these tests the G4−G2 accuracy drops are not significant (consumer law p = 0.12, CS/AI
  p = 0.06, before correction; 4 and 5 discordant questions). The text now says so.
- The generator result is now called inconclusive.
- One faithfulness measure (released) is used consistently in the text and Table 3.
- G6−G4 was added to Table 7, and the 0.000-bound rule is stated.
- Not done: BCa intervals with 10,000 resamples for every interval.

**Issue 7 (overclaiming): partly fixed.**
- Cross-reference expansion is now described as explored but never selected.
- Verification is described as answer-level release or withhold, with answer length reported.
- The generator claim is restricted to the statutes, and the abstract gives an absolute number
  (G4 answers 0.412 of answerable statute questions correctly).
- **The title still says "Hybrid ... Trustworthy".** It is the author's placeholder and is left
  for the author to decide.

**Issue 8 (chunking claim): partly fixed by re-analysis.**
- Coverage under strict relevance: +0.370 [0.243, 0.498] on consumer law, so the lenient rule
  does not favour structural chunks.
- Added correctness by whether every gold provision was in context: G2 0.532 vs 0.333.
- The text notes the heading-path prefix, and that a 1,024-token budget fits only two fixed-512
  windows.
- Positioned the metric relative to Chen et al. (2024).
- Not done: new retrieval-only test runs (fixed-256 dense; fixed windows with the heading-path
  prefix).

**Issue 9 (deployment): partly fixed.**
- Figure 4(a) is labelled as a composed estimate, and the Lighthouse scope is stated.
- The free-tier dependence of "zero cost" is stated in §6 and in Limitations.
- The contribution is reworded to say that the deployment's answer quality is not measured.
- Not done: evaluating the deployed pipeline and measuring latency over a throttled network.

**Issue 10 (related work): fixed.**
- Added IL-TUR, Qu et al. (2024), AlignScore, ARES, Huang et al. (2024) and Feng et al. (2024),
  all verified.
- The citation count stays at 35 by dropping four marginal citations.

**Minor comments: fixed.**
- The pending §5.2 sentence is now one bracketed note.
- Citation precision and recall are now defined.
- Calls above one are explained, and the CS/AI candidate count and the split of the seed items
  are given.
- Figure 1 legend: Abstain is dashed, and G5's threshold and the app gate are mentioned.
- §5.4 is reworded, with the code/formula point marked as a hypothesis.
- Spelling is now "artefact" throughout, and §3 "Agents" is renamed.
- The hosted-model choice is simplified, and "neither ... nor" is fixed.
- Figure 2 now has tick labels on both panels. Figure 3 has a new y-label and a marker legend,
  and the mean/median labels are fixed.
- "<1" ms in Table 6, and the dev-grid caption notes the unbalanced grid.
- The CS/AI prompts are added, Windows 11 is noted, and it is stated that the dirty-tree diffs
  were not saved.
- References now use peer-reviewed venues where confirmed (NeurIPS 2020: Lewis, MiniLM; ICLR:
  Self-RAG, DeBERTaV3, Huang). Duplicate arXiv identifiers are removed, and capitalisation is
  protected.
- The ethics section now states that the unevaluated public collections are not marked as such in
  the app.
- The G4H launches are explained (§4).

**Not done: needs new experiments, annotation or an author decision.**
- **Issue 2:** human validation of the judge (two annotators, κ, judge precision and recall), and
  a second judge family.
- **Issue 3:** a human review of the test items; human-written multi-provision and hard
  unanswerable questions.
- **Issue 6:** a generator ablation with matched budgets, G4H, and a mid-size model.
- **Issue 8:** new retrieval-only test configurations.
- **Issue 9:** an end-to-end evaluation of the deployed pipeline.
- **Author decisions:** the title, and anonymisation. The draft is a named preprint by request;
  anonymise it before any double-blind submission.
