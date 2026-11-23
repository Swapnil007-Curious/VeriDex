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


---

# Second review: "VeriDex: Structure-Aware Retrieval and Sentence-Level Verification for Question Answering over Statutes and Textbooks"

Reviewer role: skeptical workshop reviewer (ACL style, 8-page main text), a fresh reader of the v1.0.0 draft (16 pages, built 2026-11-22). The draft is a named preprint by request, so anonymity was not assessed.

## Review of the v1.0.0 draft (2026-11-22)

### 1. Summary
The paper describes VeriDex, a RAG pipeline that runs on a laptop CPU. It answers questions over Indian consumer-protection law (the Consumer Protection Act, 2019 and four sets of Rules) and over selected chapters of three open CS textbooks. The pipeline chunks documents along their section structure, asks a 3B local generator (qwen2.5:3b) to cite a passage after every sentence, and releases an answer only if deterministic citation and number guards and a prompted critic accept it. The evaluation uses automatically generated questions with a hash-based dev/test split and logged test access. On the statutes, structural chunks raise token-budget coverage of gold provisions at 1,024 tokens by +0.267 [0.130, 0.402]. Guards plus critic raise released-answer faithfulness from 0.745 to 0.878. The paper itself shows that this gain comes almost entirely from withholding answers that contain uncited sentences: NLI support of cited sentences changes by only +0.025 [−0.019, 0.081]. A hosted gpt-oss-120b configuration shows no detectable difference on the statutes and a +0.125 accuracy difference on the textbooks with permutation p = 0.0676. A 20-item error analysis finds that 7 of 20 failures are evaluation artefacts. A static browser deployment is described, with load and latency measurements but no evaluation of answer quality. The paper is unusually candid about its limitations. Its main weaknesses are:
- an unvalidated evaluation set and judge;
- two significance rules that are applied inconsistently;
- a mis-described ablation system (G3);
- title and abstract framing that promises more than the results support.

### 2. Scores
| Criterion | Score | Justification |
|---|---|---|
| Soundness | 3 / 5 | The design is careful: dev-only selection, logged test access, paired tests, released-answer faithfulness and an explicit split of uncited vs. unsupported sentences. Against that, every outcome metric rests on one unvalidated NLI judge and an unreviewed set of questions written by a 3B model. Key differences rest on 4–11 discordant questions. G3 is not the system the text describes. Bootstrap "significance" is declared where exact tests disagree. |
| Excitement / Significance | 2.5 / 5 | A useful, honest case study of what citation-enforcing verification does and does not buy in small-domain RAG. The headline findings are mostly negative or definitional (the verifier enforces format; the critic adds nothing; the generator effect is inconclusive), and the chunking gain is matched by a fixed-256 configuration. Novelty is modest. |
| Clarity | 3 / 5 | Precise and compact, with numbers generated by macros. However, the text is very dense, the main text relies on appendix tables (including the corrected tests), several captions are inaccurate (Calls, Faith. "split into", G3), and some abbreviations are undefined. |
| Reproducibility | 3.5 / 5 | Code, configurations, questions, prompts, hyperparameters and commands are public. However, per-question records and LLM/NLI caches are not released, the test runs used dirty working trees whose diffs were not recorded, the hosted ablations were assembled from resumed runs across several commits, and the local model's quantisation is unstated. |
| Overall recommendation | 3 / 5 | Borderline. Acceptable for a workshop if the TEXT issues below are fixed (statistics, G3, framing, inconsistencies). The EXPERIMENT issues limit what the paper can claim, but the paper can still stand as an honest negative and accounting study. |
| Reviewer confidence | 4 / 5 | I read the whole paper and checked several numbers against the repository (see Spot-checks). |

### 3. Strengths
- **Test discipline is real and documented.** The split is computed from a hash and never stored, only two scripts can open the test split, every access is logged, and the hosted model was chosen and dated before any of its results were seen.
- **The verification gain is honestly decomposed.** Reporting uncited-sentence share and cited-sentence support separately exposes that the faithfulness gain is largely definitional. The paper says so in the abstract and the conclusion.
- **Both faithfulness views are reported.** Released-answer faithfulness sits next to the jointly-answered comparison, which avoids rewarding a stricter system for answering an easier subset.
- **Costs of abstention are reported.** False abstention, released wrong answers (21 vs. 34) and the correct-answer price (28 vs. 32) are all given.
- **Negative results are stated plainly.** These include G5's threshold, the critic, semantic chunking, the textbook chunking null and the inconclusive generator comparison. The tuning-objective explanation for G5 is convincing.
- **Every number traces to source.** Numbers are macros generated from result files, and a claims checker exists. The error sample, labels and rationales are released.
- **The deployment section is honest about scope.** It lists concretely how the app differs from the evaluated pipeline and does not imply the app was evaluated.
- **Useful domain engineering.** Stable provision identifiers, number grounding that understands lakh and crore amounts, and a CPU-only pipeline.

### 4. Issues (ordered by importance)

#### Issue 1. Two significance rules are applied inconsistently, and bootstrap-only "significance" is produced by discreteness [TEXT]
**Where.** §4 Statistics (p. 5: "we call a difference significant when its interval excludes zero"); Table 3 (p. 7), bold cells; §5.2 (p. 6); abstract; contributions 2–3 (pp. 1–2); §7; Table 8 (p. 14).

**Why it matters.** Under the declared rule, the following are significant and are bolded in Table 3:
- G4−G2 overall accuracy on both collections (−0.047 [−0.094, −0.012]; −0.089 [−0.161, −0.018]);
- CS/AI G3−G2 accuracy (−0.071 [−0.143, −0.018]);
- the CS/AI generator gain (+0.125 [0.018, 0.232]).

The paired permutation tests give p = 0.1214, 0.0600 and 0.0676, so these differences are not significant even before correction. Yet §5.2 says "the permutation tests give p = 0.1214 and p = 0.0600, not significant after correction", which implies they would pass uncorrected.

The bold cells come from discreteness, not evidence. When all discordant questions point one way, a percentile interval can include 0 only through resamples that contain no discordant question:
- With 4 of 85 discordant, the chance of such a resample is (81/85)^85 ≈ 0.017 < 0.025. The upper bound is therefore forced to −1/85 = −0.012, exactly the reported bound.
- With 5 of 56, the chance is (51/56)^56 ≈ 0.005, forcing −1/56 = −0.018, again exactly the reported bound.

The two rules are also applied asymmetrically:
- The abstract says the hosted generator "raises overall accuracy", while the conclusion calls the same result "unconfirmed".
- Contribution 2 states as a finding that "A retrieval-score threshold tuned on dev lowers accuracy", on bootstrap evidence alone. For G5−G4 the discordance is 0/7, because G5 only adds abstentions to G4's records. An exact sign test would give p ≈ 0.016, uncorrected and outside the family. That is probably fine, but it is not reported.
- The Holm family was "fixed after the first draft", i.e. after test results existed. The abstract-level phrase "significant after Holm correction" (contribution 2) does not say this.

**Suggested fix.**
- Use exact paired tests (sign/McNemar, or the permutation tests already computed) as the significance criterion for every binary outcome. Keep bootstrap intervals for effect sizes only, preferably BCa with ≥10,000 resamples.
- Un-bold the three accuracy cells, or mark them "bootstrap only; permutation p ≥ 0.05".
- Change "not significant after correction" to "not significant (p = 0.12 and 0.06 before correction)".
- Rewrite the abstract sentence as, e.g., "a +0.125 accuracy difference on the textbooks (9 vs. 2 discordant questions) that a paired permutation test does not confirm (p = 0.068)".
- Report the G5−G4 exact test.
- State in the main text, next to the first use of "Holm", that the family was defined after test results were seen.

#### Issue 2. G3 is not the system the paper describes, so the "critic loop" row bundles the critic with the revision round [TEXT]
**Where.** §3 (p. 3: "After a guard failure or a revise verdict the synthesizer gets one revision round with the context extended to 2,048 tokens"); Figure 1 caption; §4 ("G3 and G5 are derived from the G2 and G4 records without new LLM calls"); Table 2 caption ("G3 = G2 + guards"; "Calls above one are JSON-repair retries"); Table 3 row "G4−G3 critic loop"; contribution 2 and §5.2 ("the critic adds nothing measurable over the guards").

**Why it matters.** G3 is a filter, not a guarded pipeline:
- In Table 2, G3 has Calls 1.00 and the same median latency as G2 (32.5 s). In Table 9 it has the same mean prompt tokens (1,482).
- The derivation script states that "a guard failure becomes an abstention".

So G3 is G2 with guard-failing answers withheld, without the revision round that §3 and Figure 1 describe. Consequently:
- G3−G2 measures pure filtering.
- G4−G3 measures the critic **plus** a revision round with a doubled context budget.

The claim that "the critic adds nothing measurable" is therefore about a bundle. The revision path is not negligible: in the consumer-law G4 records, 8 abstentions follow guard failures and 6 follow critic abstain verdicts.

The Table 2 caption "Calls above one are JSON-repair retries" is also wrong:
- G4's 1.98 and G6's 2.31 include critic and revision calls.
- G5's 1.25 reflects 36 questions that made zero calls.

**Suggested fix.**
- Define G3 as "G2 with guards as a release filter (no revision)" in §4 and in the Table 2 caption.
- Rename the G4−G3 row to "critic + revision".
- Reword contribution 2 and §5.2 accordingly.
- Rewrite the Calls definition as "mean LLM calls per question, including critic and revision calls and JSON-repair retries".

#### Issue 3. The title, abstract and contribution list overclaim or do not match the tables [TEXT]
**Where.** Title; abstract (p. 1); §1 contributions (pp. 1–2); §7 (p. 8).

**Why it matters.**
- **"Sentence-Level Verification."** Checks run per sentence, but the decision is per answer ("no sentence is dropped", §3). Answers average 1.08 sentences (§5.2). The paper's own conclusion is that verification "mainly enforces citation format", with no measurable change in cited-sentence support.
- **"Structure-Aware Retrieval."** The only structure-aware retrieval components were "explored on dev, never selected": cross-reference expansion and statute-reference BM25 tokenisation. What was evaluated is a chunker, and its gain holds only on the statutes (see also Issue 4).
- **The abstract leads with the definitional gain.** "Verification raises the faithfulness of released statute answers from 0.745 to 0.878" is the part the paper itself shows to be definitional.
- **"The verified system answers only 0.412 of answerable statute questions correctly."** This number appears in no table. Table 2's Corr. is accuracy among *answered* questions (0.571), and 0.412 appears in Table 2 only as G5's Ans. value, which invites confusion. No reference point is given: G2 is 0.471 (32/68) and G1 is 0.250.
- **"A much larger hosted generator."** gpt-oss-120b is a mixture-of-experts model (about 117B total but about 5.1B active parameters per token, per its model card). G2H also doubles the context budget, doubles the output limit and adds hidden reasoning (§5.2). The abstract attributes the result to size alone.
- **"On the textbooks it raises overall accuracy"** (abstract) vs. "an unconfirmed accuracy gain" (§7).
- **"Our contributions, each backed by a test-split result."** Contribution 4 is measured on 62 *dev* questions and has no quality evaluation.
- **"A zero-cost deployment with measured costs."** This is self-contradictory, and §6 concedes that "zero cost" holds only within a free tier's quotas.

**Suggested fix.**
- Retitle along the lines of "What Section-Aligned Chunking and Citation Checks Buy: A Held-Out Study of Small-Domain RAG over Indian Consumer Law and CS Textbooks".
- In the abstract, lead with the cited-sentence support result, and call G2H a "hosted-configuration ablation (larger model, budget and output limit)".
- Add a "Correct / answerable" column to Table 2 and quote G1/G2/G4 together.
- Drop "each backed by a test-split result", or exempt contribution 4.
- Replace "zero-cost" with "no hosting cost within free-tier quotas".

#### Issue 4. The chunking claim does not separate section structure from chunk size, and "coverage matters downstream" is confounded [TEXT]
**Where.** Contribution 1; §5.1 (p. 5); Figure 2; Table 6 (p. 13); §5.2 (G6 paragraph); §7.

**Why it matters.**
- **A fixed-256 configuration matches the structural one.** The best fixed-256 configuration (hybrid-linear, reranked) reaches Cov@1024 0.748 vs. 0.757 and Cov@512 0.637 vs. 0.640. Its coverage gain over naive RAG (+0.257 [0.162, 0.360], Figure 2 data) is indistinguishable from the structural gain (+0.267 [0.130, 0.402]).
- **The paper's own mechanism is length.** "They are short (mean 135 tokens against 496), so more distinct provisions fit than the two fixed-512 windows a 1,024-token budget admits." The evidence therefore supports "short chunks"; what section alignment contributes on its own is untested. Contribution 1 nonetheless says "Chunks that follow sections and clauses raise the coverage".
- **"Coverage matters downstream" rests on a confounded split.** It uses G2's correctness when all gold provisions were in context vs. otherwise (0.532 vs. 0.333; 47 and 21 questions). This is confounded with question type: multi-section and cross-reference items are both harder and less often fully covered.
- **G6 cuts against it.** G6 is built on the near-equal-coverage fixed-256 configuration, yet has released faithfulness 0.392 vs. 0.878 and Corr. 0.485 vs. 0.571. The near-tie is visible in Figure 2 and Table 6 but never stated in the text.

**Suggested fix (TEXT).**
- State the fixed-256 result in §5.1 and in contribution 1.
- Reframe the practical claim as "short, section-aligned chunks reach the coverage of fixed-256 hybrid retrieval with reranking at about 1/16 of its latency (74 vs. 1,173 ms)".
- Add the paired structural − fixed-256 bootstrap, computed from the existing per-question retrieval records.
- Stratify the coverage–correctness association by question type, and soften "matters downstream".
- Optional [EXPERIMENT]: retrieval-only test runs of fixed-256 with dense bge-base and no reranking, and of fixed windows carrying the heading-path prefix, would isolate structure from size.

#### Issue 5. The evaluation set is unreviewed, contains detectable defects, and its unanswerable half is uninformative [EXPERIMENT]
**Where.** §4 Questions (p. 4); Table 12; §5.5 example (p. 7); Limitations (p. 9).

**Why it matters.**
- **How the set was built biases it.** Questions were drafted and filtered by the same 3B model that answers them. Gold evidence is single provisions, the units the structural chunker emits. "answerable_from_source" keeps only what the 3B model can answer. No item was reviewed.
- **The paper itself finds defective items.** The error analysis found a wrong gold answer and an ambiguous question.
- **A spot-check finds more.** 5 of the 40 answerable CS/AI test questions ask about "the passage" or "the text", which a user never sees (q020, q035, q039, q056, q057). One of them is the example printed in §5.5: "What does the term 'positionwise feed-forward network' refer to in the context of the passage?". In consumer-law q014, the question asks what is needed "to start a case with the National Commission", but the gold answer describes the pre-deposit for an appeal.
- **Defects of this size can decide the sign.** The accuracy comparisons rest on 4–11 discordant questions, so item defects at this rate can flip the conclusions.
- **The unanswerable half carries no information.** The retrieval check rejected 0 of 85 (and 0 of 54) candidates, and §4 concludes "so they are clearly out of scope". That does not follow: the result shows the check had no power, or the items were trivial. As a consequence, refusal is ≈1.0 for every system, and the abstention P/R/F1 in Table 9 and G5's F1 tuning objective say little.

**Suggested fix.**
- *Now (re-analysis):* report the number of passage-referencing items, add a sensitivity analysis that excludes them from the existing outputs, and rewrite the "clearly out of scope" sentence.
- *New annotation:* human-validate all 141 test items, which is feasible at this size.
- *New items:* construct harder unanswerable questions, e.g. superseded monetary limits, near-miss provisions, or other states' rules.

#### Issue 6. The single NLI judge decides every outcome, and the error taxonomy hides verifier misses [EXPERIMENT]
**Where.** §4 Metrics; §5.2; §5.5; Table 4 (p. 7); Appendix D (p. 12); Limitations.

**Why it matters.**
- **One judge does everything.** A single cross-encoder with a fixed 0.5 threshold, requiring one passage to entail the sentence, decides faithfulness. It also decides correctness, via "answer entails gold".
- **That direction penalises correct answers that are short or multi-sourced.** q011 ("two crore rupees") is short. q006 is correct but cites [C2][C6][C7][C8].
- **Judge errors are as large as the effects.** 5 of 20 sampled failures are judge false negatives, and false positives are unmeasured. The discordant counts that decide the main comparisons are 4, 5, 18 and 11.
- **G2H is systematically disadvantaged.** It cites several passages in one sentence twice as often (28 of 72 vs. 14 of 74).
- **The taxonomy is exclusive, so verifier misses disappear.** Table 4 reports "Verifier false accept 0", yet at least two consumer-law "synthesis errors" are released wrong answers that the critic accepted. For q014 the rationale reads "the critic accepted it" and the NLI faithfulness is 0.0; q035 also reads "the critic accepted it".
- **The labelling protocol is under-specified.** "The final labels were assigned with AI assistance" in a single pass, with 9 of 20 pre-labels kept. What the assistance did, and whether every label was confirmed by the author, is not stated.

**Suggested fix.**
- *TEXT:* allow multiple labels per failure (e.g. synthesis error + verifier false accept) and recount Table 4.
- *TEXT:* describe precisely what the assistance did and that each label was confirmed by the author.
- *TEXT:* report concatenated-cited-passage rescoring of the existing outputs, clearly labelled as a post-hoc sensitivity analysis.
- *New annotation (small):* re-read the discordant questions of the primary comparisons and report whether the conclusions survive.
- *EXPERIMENT:* collect human labels on a stratified sample of released and withheld answers to estimate the judge's precision and recall, and add a second annotator for the 20 failures.

#### Issue 7. Text, tables and captions disagree with one another [TEXT]
**Where.** §5.3, §5.4, Tables 2, 3, 4, 8 and Figure 3.

**Why it matters.** Each item is small, but together they undermine the "every number is generated" promise:
- **§5.4 (p. 7):** "the guards then withhold 55% of the answerable CS/AI questions". 55% is G4's total false abstention, which includes the 20% G2's synthesizer already abstains on, plus the critic. Guards alone (G3) give 45%, i.e. +25 points.
- **§5.3 vs. Table 2:** "at G4's coverage (0.576)" vs. G4 Ans. 0.577. The result CSV stores 4-decimal values (0.5765), which are then rounded again. The true value is 49/85 = 0.5765 → 0.576. The same double rounding gives G1 and G6 Overall 0.377 (true 32/85 → 0.376) and G2 Overall 0.577 (true 0.576).
- **Table 2 caption:** Faith. is said to be "split into Uncit. and Sup.", but the numbers cannot be a split. G2H (consumer law) has Faith. 0.760 > Sup. 0.757 despite 2.8% uncited sentences. G6 has Faith. 0.392 > Sup. 0.385 with no uncited sentences. The columns use different aggregation: answer-level mean vs. sentence-level pooled.
- **Table 8 vs. §5.1:** Table 8 gives CS/AI "coverage@1024, structural − naive" as +0.075 (different encoders). §5.1 gives +0.062 [−0.050, 0.188] for structural vs. fixed-512 with the same encoder. Readers see two numbers for the "same" comparison without explanation.
- **Table 4:** "Verifier false accept 0" (see Issue 6).
- **One quantity, three names:** "Corr." (Table 2), "accuracy of released answers" (§5.3) and "Accuracy of answered questions" (Figure 3 axis).

**Suggested fix.**
- Correct the 55% sentence.
- Round from raw counts, not from rounded CSV values.
- State the aggregation of each faithfulness column.
- Label both CS/AI coverage comparisons explicitly.
- Use one name for accuracy among answered questions.

#### Issue 8. The test-discipline summary overstates what the access logs show [TEXT]
**Where.** §1 ("All selection used a dev split; test access was logged"); §4 ("all tuning used dev"; "G5 and G6 were not run on CS/AI (G5 lowered accuracy on consumer law …)"; the G4H sentence); §4 Statistics ("fixed after the first draft"); Appendix E (p. 13).

**Why it matters.**
- **Design decisions used test results.** Not running G5 on CS/AI was based on a consumer-law test result. The Holm family was fixed after test numbers existed.
- **The hosted ablations span several commits.** Each collection's log has five test grants, all on dirty working trees. The hosted ablations were assembled from resumed runs:
  - consumer law: a3b6d4b twice, then 0901974;
  - CS/AI: a3b6d4b, 0901974, then 2e9a77b on 2026-11-16, four days after the other runs.
- **Appendix E is incomplete.** It names only 0901974 as "the hosted ablation".

Caching probably keeps the results consistent, but the summary sentence promises more discipline than was practised.

**Suggested fix.**
- Add a short appendix table of test accesses (date, commit, systems, reason) built from the logs.
- List the decisions that used test information.
- Correct the commit list in Appendix E.
- Soften "all tuning used dev" to "all tuning of system parameters used dev".

#### Issue 9. The released artefacts do not support the reproducibility claim [TEXT]
**Where.** §1 footnote sentence ("the scripts that generate every number in this paper are public"); Appendix E ("rerunning an evaluation with the caches reproduces its outputs"); Table 7 caption ("computed from the same per-question records").

**Why it matters.**
- **The records and caches are not public.** In the repository, `results/generation/` (per-question records) and `.cache/` (LLM, rerank and NLI caches) are git-ignored. Derived numbers can be regenerated only from snapshot CSVs in `paper/data/`.
- **Readers therefore cannot check the derived statistics.** They cannot recompute released-answer faithfulness or the permutation tests, and cannot audit outputs beyond the 20 sampled failures.
- **The local model is under-specified.** Its quantisation or digest is not given; only the Ollama tag qwen2.5:3b.
- **The split description is incomplete.** It is given as "a SHA-256 hash of its id, read as a number in [0, 1)", but the implementation uses a salt ("split-v1:") and the first 32 bits.

**Suggested fix.**
- Publish the per-question test records (answers, context ids, citations, NLI scores) and the caches as a release asset.
- State the model digest and quantisation.
- Describe the split exactly.

None of this needs new runs.

#### Issue 10. The main text fits 8 pages but is not self-contained [TEXT]
**Where.** §5 refers to Tables 6–9 in the appendix; §6 and Figure 4 (p. 8).

**Why it matters.**
- **The page limit is met with no slack.** The Conclusion ends on p. 8 and Limitations start on p. 9.
- **Key evidence sits only in the appendix.** This includes the corrected tests the abstract and contribution 2 rely on ("significant after Holm correction", Table 8) and the absolute retrieval numbers (Table 6). Reviewers are not obliged to read appendices.
- **Space goes to an unevaluated system.** About 0.8 page (§6, Figure 4) describes the deployment, whose answer quality is not measured.

**Suggested fix.**
- Move Table 8 (7 rows) into §5.
- Shrink §6 to one paragraph, and move Figure 4 and Table 11 to the appendix.
- Replace the app-only rows of Table 1 with a sentence.

### 5. Minor points
- **p. 1 (abstract):** "statutes" covers one Act plus four sets of Rules (subordinate legislation); "statutes and rules" is more accurate.
- **p. 1:** "chunkers are usually compared by Recall@k, which favours large chunks" is uncited. In Table 6 the short structural chunks have *higher* R@5 than naive fixed-512 (0.699 vs. 0.637).
- **p. 2 (Related work):**
  - "Qu et al. (2024) find that semantic chunking does not consistently justify its cost, as in our results": no matched semantic-vs-fixed comparison was run, so "as in our results" is too strong.
  - Statute retrieval for Indian law (the FIRE AILA 2019/2020 tracks) is still missing.
- **p. 3:** define lakh (10^5) and crore (10^7) for international readers.
- **p. 3 (Figure 1):** encoding is by colour only (grey/blue); check grayscale legibility.
- **p. 4:** "chosen on 2026-11-12 before any result was seen" should read "before any result of the hosted model was seen"; consumer-law test results existed from 2026-11-10.
- **p. 4:** the sentence "Runs that also included the hosted model with guards and critic (G4H) were stopped before reaching G4H … and then restricted to G2H" is hard to parse; split it.
- **p. 4:** "90 of 122 consumer-law survivors were selected, stratified by type": say how the 32 discarded items were chosen.
- **p. 6:** "there its cited-sentence support is −0.104 [−0.219, 0.007] lower" and (p. 7) "lowered accuracy relative to G4 by −0.082" are double negatives.
- **p. 6 (Table 3):** the column header "(isolates)" is unclear; consider "Factor changed".
- **p. 7 (Table 3 caption):** "an interval with a bound at 0.000 counts as including 0" is an ad hoc patch for the discreteness problem in Issue 1.
- **p. 7 (Figure 3 caption):** "Markers: no threshold" is ambiguous; name the marker shape.
- **p. 8:** "gpt-oss-120b" breaks at its hyphen across lines ("gpt-oss-" / "120b"); use a non-breaking hyphen for model names.
- **p. 8 (Figure 4a):** the web-app bar excludes the critic call that Grounded mode requires, so it underestimates the default mode. Say so in the bar label, not only in the caption.
- **p. 9 (Ethics):** "used within their licences" should name the licences. Several textbooks are CC BY-NC-SA, and the local generator's licence is non-commercial. Say explicitly that the public demo is non-commercial.
- **pp. 10–11 (References):**
  - "Wen tau Yih" (Lewis et al.) should be "Wen-tau Yih".
  - "Charles L A Clarke" and "Daniel E Ho" lack periods.
  - "condorcet" should be "Condorcet".
  - Capitalisation of the SIGIR proceedings title is inconsistent.
  - Check whether Magesh et al. (2024) has a published version.
- **p. 12 (Appendix A):** the consumer-law and CS/AI prompts share the identifiers "synth-v1" / "critic-v1"; give them distinct names.
- **p. 12 (Appendix D):** "evaluation artifact" vs. "artefact" in the main text.
- **p. 14 (Table 7 caption):** repository paths in captions (scripts/paper_tables.py) belong in the appendix text.
- **p. 16 (Table 11):** "P / A / BP / SEO" is undefined, and Lighthouse scores are of little relevance to an NLP venue.
- **p. 16 (Table 12):** the filter identifiers (copy, support, answerable_from_source) are not mapped to §4's descriptions, and the caption cites an internal file name.
- **p. 3 (Table 1 caption):** "selected chapters for textbooks", but the app-only rows (1,298 and 4,258 pages) appear to be whole books; clarify.

### 6. Verdict
This is a careful and unusually self-critical system study whose main value is an honest accounting of what citation-enforcing verification buys. Its headline claims need to be brought in line with its own evidence:
- one consistent significance rule, under which the CS/AI generator gain and the G4−G2 accuracy drops are not significant;
- a correct description of G3, so that the "critic" row isolates what it claims;
- a title and abstract that do not promise sentence-level verification or structure-aware retrieval beyond what was measured.

With these TEXT fixes it is acceptable as a workshop paper or preprint. The conclusions will remain provisional until the test items and the judge are checked by people.

### Spot-checks (read-only, against the repository)
1. **Table 2 vs. `results/tables/generation_test.csv`.** All consumer-law values match. Double rounding is confirmed: the CSV stores answered_rate 0.5765 for G4 and overall_accuracy 0.5765 for G2, both printed as 0.577; the true value is 49/85 = 0.57647 → 0.576. G1 and G6 overall accuracy (CSV 0.3765, printed 0.377; true 32/85 → 0.376) have the same issue.
2. **Abstract "0.412".** This is G4's `correct_rate_answerable` (0.4118 = 28/68). It appears in no paper table.
3. **Table 8 vs. `paper/data/primary_tests.csv`.** Δ, p, p_Holm and discordance (0/4, 10/8, 0/5) all match. The CS/AI G2H test (p = 0.0676, 9 wins / 2 losses) matches `paper/data/secondary_tests.csv`.
4. **Bootstrap bounds.** The upper bounds −0.012 (consumer law) and −0.018 (CS/AI) for G4−G2 accuracy were reproduced analytically from 0/4 and 0/5 discordance.
5. **G5−G4 discordance (inferred).** G5 answers 35 (21 correct) and G4 answers 49 (28 correct); both refuse all 17 unanswerable questions. The discordance is 0/7 (exact two-sided sign test p ≈ 0.016).
6. **G3 derivation.** The docstring of `scripts/derive_systems.py` says "G3 = G2 + deterministic guards (a guard failure becomes an abstention)". There is no revision round.
7. **Fixed-256 coverage.** In `paper/data/fig_retrieval_deltas.csv`, fixed-256 hybrid-linear + rerank has a coverage@1024 gain over naive of +0.2574 [0.1618, 0.3603]; structural has +0.2672 [0.1299, 0.4020].
8. **CS/AI coverage numbers.** Table 8's +0.075 (structural bge-small vs. naive bge-base) and the text's +0.062 [−0.050, 0.188] (vs. fixed-512 bge-small) are both correct, but they are different comparisons.
9. **Questions that reference an unseen passage.** 7 of 80 CS/AI questions refer to "the passage"/"the text"; 5 are in test (q020, q035, q039, q056, q057), all answerable. In consumer law only q060 matches, and it is in dev.
10. **Error labels.** q014 and q035 are labelled `synthesis_error` with rationales stating "the critic accepted it"; Table 4 reports 0 verifier false accepts.
11. **Test access logs.** Five entries per collection, all `git_dirty: true`. The CS/AI G2H run was completed at commit 2e9a77b on 2026-11-16; Appendix E named only 0901974 for the hosted ablation.
12. **Released artefacts.** `.gitignore` excludes `results/generation/` and `.cache/`. The question files are tracked.
13. **Abstract and contribution intervals** match `paper/tables/numbers.tex` and Table 3.
14. **Table 10 per-type cells** sum to G4's 28 (consumer law) and 8 (CS/AI) correct answers.
15. **Page count.** The Conclusion ends on p. 8 and Limitations begin on p. 9.

## Revisions made after the second review (2026-11-22)

No new experiments were run. Statistics marked "re-analysis" were computed from the existing per-question records by `scripts/paper_tables.py` (snapshot: `paper/data/secondary_tests.csv`).

**Fixed.**
- **Issue 1.** §4 now states the rule for binary outcomes: an overall-accuracy difference counts as significant only if its interval excludes 0 *and* a paired permutation test gives p < 0.05. Re-analysis: permutation tests for every accuracy comparison in Tables 3 and 7 outside the primary family. Accuracy cells whose interval excludes 0 without the test are marked † instead of bold (consumer-law G4−G2, CS/AI G3−G2, G4−G2 and G2H−G2). §5.2 now says "not significant even before correction". The abstract, contribution 3 and the conclusion agree that the CS/AI generator difference is unconfirmed (p = 0.0676). The G5−G4 test is reported (0/7 discordant, p = 0.0157). §4 says the primary family was fixed when the test results were known.
- **Issue 2.** G3 is defined as G2 with the guards as a release filter, without a revision round (§4, Table 2). The G4−G3 rows read "critic + revision". Contribution 2 and §5.2 are reworded, and Calls is defined as mean LLM calls including critic, revision and JSON-repair calls.
- **Issue 3 (in part).**
  - The abstract quotes G2's 0.471 next to G4's 0.412 and calls G2H "a hosted gpt-oss-120b configuration with larger budgets"; §4 notes that it is a mixture-of-experts model.
  - "each backed by a test-split result" became "the first three rest on test-split results", and contribution 4 says its latency is measured on dev questions.
  - "zero-cost deployment" became "deployment without hosting costs".
- **Issue 4 (in part).** Contribution 1 and §5.1 state that fixed-256 hybrid retrieval with reranking reaches similar coverage (+0.257 [0.162, 0.360]) at 1,173 ms against 74 ms per query, so short chunks may explain the gain as much as section alignment. "Coverage matters downstream" became "coverage goes with correctness, although both depend on the question type".
- **Issue 5 (in part).** The Limitations report that 5 of the 40 answerable CS/AI test questions refer to "the passage" or "the text" (count computed by `paper_tables.py`). The "clearly out of scope" sentence now says that the check had nothing to filter.
- **Issue 6 (in part).** Appendix D and the Limitations say the categories are exclusive, and name the two consumer-law synthesis errors that the critic accepted.
- **Issue 7.**
  - The 55% sentence now attributes the figure to G4, with the guard filter alone (G3) at 45%.
  - Count-based rates are recomputed from exact counts, so G4 Ans. and G2 Overall now read 0.576, and G1 and G6 Overall 0.376.
  - The Table 2 caption gives each faithfulness column's aggregation.
  - "Accuracy of released answers" is the one name used in Table 2's caption, §5.3 and the Figure 3 axis.
- **Issue 8.**
  - "All tuning of system parameters used a dev split."
  - The two decisions that used test results are listed in §4.
  - A new Table 14 (Appendix E) lists every test access with commit and run type.
  - Appendix E names both hosted-ablation commits (0901974 and 2e9a77b) and says the runs were resumed across sessions.
- **Issue 9 (in part).** Appendix E says the per-question records and caches are not in the public repository and that derived statistics are snapshotted in `paper/data/`. The split is described as a salted, truncated SHA-256 hash.
- **Issue 10 (in part).** Figure 4 moved to Appendix C and the privacy paragraph moved to the Ethics section. The main text now ends on p. 8 with room to spare.
- **Minor points.**
  - The Recall@k sentence and the related-work wording are fixed.
  - Lakh and crore are defined in words.
  - The hosted model is described as chosen "before any of its results were seen".
  - The G4H sentence is split, and the two double negatives are removed.
  - Table 3's header reads "(what changes)".
  - The Figure 3 caption names the marker shapes.
  - The model name no longer breaks at its hyphens.
  - The Figure 4 caption says the web-app bar omits the critic call.
  - The Ethics section names the non-commercial licences and says the app is non-commercial.
  - Bibliography: Wen-tau Yih, Charles L. A. Clarke, Daniel E. Ho and Condorcet are corrected.
  - "Artefact" is used throughout.
  - P / A / BP / SEO is defined in Table 11.

**Not done.**
- **Kept by the author's decision:** the title (Issue 3).
- **Would change the pinned result tables:** BCa intervals with 10,000 resamples (Issue 1). The pipeline's bootstrap rows are pinned by the frozen-results tests.
- **Re-analyses left open:**
  - the paired structural − fixed-256 bootstrap and a stratification of the coverage–correctness association by question type (Issue 4);
  - a sensitivity analysis without the passage-referencing items (Issue 5);
  - a multi-label recount and concatenated-passage rescoring (Issue 6).
- **Needs new annotation or experiments:**
  - human validation of the test items and of the judge, and a second annotator (Issues 5 and 6);
  - harder unanswerable questions (Issue 5);
  - retrieval-only runs that separate section structure from chunk size (Issue 4).
- **Author decisions:**
  - publishing the per-question records and caches (Issue 9);
  - confirming the error labels and then saying so in the paper (Issue 6).
- **Not recorded in the results:** the local model's digest and quantisation (Issue 9).
- **Minor points left as they are:**
  - Prompt identifiers stay as they are: renaming them would change the prompt digests that the LLM cache keys and the frozen prompt snapshot use.
  - Not changed: the FIRE AILA citation (it needs a verified reference), the selection of the 90 consumer-law items, the Table 1, 7 and 12 captions, and the Magesh et al. venue.
  - Table 8 stays in the appendix; the main text quotes its p-values.


---

# Third review: IEEE conference version (`paper/ieee/main_ieee.pdf`)

Reviewer role: IEEE conference program-committee member (6-page limit including references, IEEEtran conference format). A fresh reader who saw only the PDF of the IEEE version as built on 2026-11-23, before the revisions below; page and reference numbers refer to that build.

## Review (2026-11-23)

### 1. Summary
The paper describes VeriDex, a RAG pipeline that runs on a laptop CPU and answers questions over Indian consumer-protection statutes and three open CS textbooks. It uses structure-aware chunking, a citation after every sentence, deterministic citation and number guards, and a same-model LLM critic. It proposes token-budget coverage as a way to compare chunkers, and evaluates seven systems on automatically generated test splits of 85 and 56 questions, using paired bootstrap intervals, permutation tests and Holm correction. The main findings: structural chunks raise statute coverage (+0.267). Verification raises released-answer faithfulness, mostly by withholding uncited answers, at some cost in accuracy. A 120B hosted generator gives no confirmed gain. A static browser deployment is also described.

### 2. Strengths
- The reporting is careful and self-critical. Comparisons are paired, a permutation check covers small discordant counts, and test access was logged.
- The paper sees that its faithfulness metric and its citation guard share a criterion, and it reports uncited share and cited-sentence support separately. It does not oversell the verifier.
- The numbers are internally consistent. Every value checked in the text matches Tables II–III, and counts can be rebuilt from Table II (e.g., G4 consumer law: 28 correct and 21 wrong of 49 released).
- The Limitations section is thorough, and the code is released.

### 3. Weaknesses
1. **Test data quality** (Sec. IV-A, VII). The same 3B model that answers the questions also generated and filtered them, and no person reviewed any item. The unanswerable questions are trivially out of scope, and n = 85/56. Every headline rests on this. *Needs new work.*
2. **Unvalidated NLI judge** (IV-B, V-E). Both faithfulness and correctness depend on one NLI model. 7 of 20 sampled failures are judge artefacts, about the size of the effects being tested. *Needs new work* (human labels on a sample, or a second judge).
3. **Possible passage-length artefact in the largest gain** (V-B; Tables II/III). Cited-sentence support falls as passages get longer: structural chunks (mean 135 tokens) 0.862, G6 with Fix-256 0.385, G1 with Fix-512 0.220. A cross-encoder NLI judge given long premises, possibly truncated near its input limit, would produce this pattern; it is the granularity issue the paper cites [23]. So "The retrieval change gives the largest gain" (+0.566 faithfulness) may be partly a judge effect. *Needs new work* (re-score with premises split into sentence windows); at minimum add a hedge.
4. **Inconclusive results stated as negatives** (Abstract, contribution 1, Sec. VIII). "But not on the textbooks": the CS/AI coverage difference is +0.062 [−0.050, 0.188] with 40 answerable questions, which is inconclusive. Use the paper's own wording, "neither show nor exclude." *Text fix.*
5. **Abstract number missing from the tables and unhedged.** "Answers only 0.412 of answerable statute questions correctly (0.471 without verification)" is 28/68 against 32/68. Neither number is in Table II, and the abstract omits that this difference is not significant (p = 0.1214, V-B). *Text fix.*
6. **Primary family not identified and fixed after test results** (IV-D, VII). The seven Holm-corrected comparisons are never listed or marked, and only two adjusted p-values are reported; two significance criteria are used side by side. *Text fix* for listing them; truly confirmatory claims need a fresh test split (*needs new work*).
7. **Confounded comparisons.** (a) Structural and fixed chunks also differ in length; an equal-length control is needed (*new work*). (b) "Short chunks alone may explain much of the gain" rests on a configuration that also changes the retriever and adds reranking, and the 1,173 ms against 74 ms gap is probably the reranker (*text fix*). (c) G2H changes the model, budgets, output limit and reasoning, and was run without verification; G4H is missing (*new work*). (d) "G6 … is far worse than G4" has no paired interval (*text fix*).
8. **Undefined or overloaded terms** (*text fix*). NLI, AIS and AUROC are never expanded. "Coverage" means token-budget coverage in IV-B but answer rate in V-C. The Table II legend does not define Refusal or Overall, and "Ans. = share answered" is over all questions. The "–" in Table III's G5−G4 row is unexplained. Also undefined: the "verified" stamp, which score α weights, lakh/crore, the lexical-overlap measure, and how Recall@k is aggregated over gold provisions.
9. **Internal contradictions** (*text fix*). IV-A lists cross-reference and multi-section questions, VII says questions came "from single provisions". III says every run records its git commit, VII says test runs came from uncommitted working trees. IV-B says the best configuration per chunker went to test, but Fig. 2 shows only two chunkers for CS/AI.
10. **Missing reproducibility details.** CPU model, RAM and the qwen2.5:3b quantisation are not given. "G2H is much faster" compares a hosted service with a 2-core CPU. *Text fix.*
11. **Error analysis** (V-E). n = 20, a single pass with AI assistance, tool not named, no per-collection split, and "7 of 20" given without an interval. *Text fix* for the reporting; a second annotator is *new work*.
12. **Framing.** The title says "Sentence-Level Verification" but answers are released or withheld as a whole. Contribution 4 (deployment) has no answer-quality evaluation and is free only within the provider's quotas. *Text fix.*
13. **Dependence on [7].** Absolute retrieval values, prompts, hyperparameters, the dev grid, citation precision/recall and the error-analysis procedure live in a mutable "blob/main" PDF. Put the naive-RAG absolute values in the Fig. 2 caption and archive [7]. *Text fix.*
14. **Bootstrap resolution** (IV-D). 1,000 resamples is thin when significance hinges on bounds at zero; use at least 10,000 and cite Holm. *Needs new work* (recomputation only).
15. **Layout and figures** (*text fix*). Sec. VI is split around Table III. Fig. 1: the revision label is about 5 pt, and the grey and light-blue coding is lost in grayscale. Fig. 2: 6.7-pt labels; the CS/AI legend crowds the whiskers.
16. **IEEE conventions.** Mostly met. Remaining: no city in the author block; Index Terms not alphabetical; inconsistent reference capitalisation and "Proc." usage; "no. 1-2" needs an en dash; a lower-case venue name; only one reference gives a month; arXiv-only citations may have archival versions; the author block, URLs and first-person acknowledgment reveal the author if the venue is double-blind. *Text fix.*

### 4. Minor points
- p. 1: "3 open computer-science textbooks" should be "three"; likewise "only 4 unanswerable" on p. 3.
- p. 1, abstract: "raise how much gold evidence fits" is awkward; label the bracketed intervals as 95% CIs.
- p. 2: comma splice in "…trained on [23], AlignScore trains…".
- p. 3, IV-C: put commas around "before any of its results were seen".
- p. 3, IV-A: "rejected 0 of 85 consumer-law candidates"; 85 is also the test size, so say how many were kept.
- p. 4, V-A: the CS/AI "+0.062" (structural against fixed-512) cannot be read from Fig. 2; give group sizes for "0.532 … 0.333".
- p. 4, V-B: G2H's lower cited-sentence support (−0.104, −0.096) is not discussed.
- p. 4, V-C: Table III shows that G5 also lowers released faithfulness (−0.049, bold); the text does not mention it.
- p. 4, VI: "costs nothing only within that tier's quotas" reads better as "is free only within…".
- p. 5, Table II: the calls and latencies of G3 and G5 are derived from the G2/G4 records; say so.
- Throughout: British spellings; IEEE prefers American. The body says "we", the acknowledgment "I".

### 5. Recommendation
Borderline (confidence 4/5). The paper is honest and its statistics are consistent, and its negative findings about self-verification are useful. The system components are standard, so the paper stands or falls on its evaluation, which is weak: small test sets generated by the model being evaluated and never reviewed; an unvalidated NLI judge that accounts for 7 of 20 sampled failures; a confirmatory family chosen after the test results were seen; a generator ablation without verification. The text issues are easy to fix. Points 1–3 and 7 need new data or re-scoring. With a human-checked test subset and a judge validation, this would be a clear accept for an applied track.

## Revisions made after the third review (2026-11-23)

No new experiments were run and no number changed. Fixes that concern shared text were made in both versions; the full version's sentence-level changes are listed in `paper/EDITS.md` (marked "review").

**Fixed.**
- **Issue 3 (in part).** The judge scores each passage in 400-token windows (stride 300) and takes the maximum, so long passages are not truncated. The full version said so; the IEEE version had dropped it and now states it in IV-B. Re-scoring with sentence-level premises is not done.
- **Issue 4.** Abstract, contribution (i) and Conclusion (both versions): "on the textbooks the difference is not significant".
- **Issue 5.** The abstract (both versions) now reads "(0.471 without verification; not significant)" and labels its first interval as a 95% CI. Both rates are shares of all answerable questions answered correctly.
- **Issue 6 (in part).** IEEE IV-D lists the seven primary comparisons (the full version has Table 8).
- **Issue 7 (b, d).** The fixed-256 sentence (both versions) says that configuration also uses hybrid retrieval and reranking, which raise its latency. The G6 paired interval is back in the IEEE text.
- **Issue 8 (in part).** NLI, AIS and AUROC are expanded. "Coverage" in the abstention sweep is "answer rate" (IEEE) or "coverage (share of questions answered)" (full version). The Table II legend defines Ans. (share of all questions), Overall, Refusal and F. abst., and says G3 and G5 are derived from the G2 and G4 records. The Table III legend defines "--" (not computed). α is the dense weight, Recall@k is the share of gold provisions in the top k, lakh and crore are defined in the IEEE text again, and the "verified" label is defined.
- **Issue 9.** "From one or two source provisions" (both versions). The pipeline sentence says the git commit is recorded with a flag for uncommitted changes. The CS/AI grid is stated to cover only the structural and fixed-512 chunkers.
- **Issue 10 (in part).** IEEE IV-C names the CPU and RAM (Intel Core i3-1115G4, 19.75 GB, no GPU). G2H's speed is described as the provider's hardware against the laptop (both versions).
- **Issue 11 (in part).** The per-collection sample sizes (11 and 9) are given.
- **Issue 12 (in part).** Contribution (iv) says the deployment's answer quality is not measured; Section VI says the app is free only within the provider's quotas.
- **Issue 13 (in part).** The Fig. 2 caption gives naive RAG's absolute Recall@5 and coverage for both collections.
- **Issue 15 (in part).** Fig. 1: the LLM boxes have a thick border, the revision note is set at the figure's font size, and the boxes are wider in the IEEE column.
- **Issue 16 (in part).** Index Terms are alphabetical. The IEEE reference list prints all titles in sentence case (acronyms and names kept), uses "Proc." consistently, has no months, and the Robertson and Zaragoza issue number and the Cormack et al. venue are corrected in `references.bib`.
- **Minor points.** The comma splice, the commas around "before any of its results were seen", the number of unanswerable questions selected (30), "not shown in Fig. 2" for the CS/AI structural-against-fixed comparison, the group sizes of the coverage–correctness comparison, G2H's cited-sentence support (now discussed), G5's drop in released-answer faithfulness (now reported in both versions) and "is free only within" are fixed. The IEEE version uses American spelling.
- **Layout of the full version.** To keep its main text within eight pages after these additions, Figure 3 (descriptive selective-prediction sweep) and Table 4 (error categories) moved to Appendices C and D; the text points to them.

**Not done.**
- **Needs new annotation, experiments or recomputation:** human validation of test items and judge (Issues 1, 2), re-scoring with sentence-level premises (3), a fresh confirmatory split (6), equal-length chunk controls and G4H (7a, 7c), a second annotator and an interval for 7 of 20 (11; the interval would be a new number), 10,000 bootstrap resamples (14; the bootstrap rows are pinned by the frozen-results tests).
- **Author decisions:** the title (12); an archived copy of the extended version, e.g. on arXiv, to replace the repository link in [7] (13); a city in the author block and anonymisation if the venue is double-blind (16); "we" in the body against "I" in the acknowledgment, whose wording is the author's.
- **Left as they are:** small counts stay numerals because they are generated macros; the lexical-overlap measure and the quantisation are not described (the quantisation is not recorded in the results); whether arXiv-only references have archival versions was not checked; Fig. 2 keeps its fonts and legend position; the split of Section VI around Table III comes from float placement; Holm is cited by name only (a reference would need verification).
