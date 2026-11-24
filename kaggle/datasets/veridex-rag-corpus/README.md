# VeriDex RAG corpus

Seven redistributable documents and 157 evaluation questions for retrieval-augmented question
answering, exported from the [VeriDex](https://github.com/Swapnil007-Curious/VeriDex) research
pipeline. Every gold answer points to the exact structural nodes (rules, sub-rules, textbook
sections) that answer it, so you can score any chunking or retrieval method against the same
ground truth.

The [VeriDex notebook series](https://github.com/Swapnil007-Curious/VeriDex/tree/main/kaggle)
uses this dataset for chunking, retrieval, faithfulness, abstention and browser-index experiments.
Live app: https://swapnil007-curious.github.io/VeriDex/

## What is inside

| path | contents |
|---|---|
| `documents.csv` | one row per document: title, authors, edition, licence, source URL, SHA-256 of the source PDF |
| `text/<doc_id>.txt` | cleaned text of each document (running headers, page furniture and exercises removed) |
| `structure/nodes.jsonl` | the parsed hierarchy: one row per node (rule, sub-rule, clause, proviso, textbook section, code block) with `parent_id`, `level`, `heading` and character offsets into `text/<doc_id>.txt` |
| `chunks/<collection>/<chunker>.jsonl` | the chunks the VeriDex pipeline produced: `fixed_256`, `fixed_512`, `semantic` and `structural` for the consumer rules; `fixed_512` and `structural` for the textbooks. `text` is what gets embedded; `char_start`/`char_end` locate the chunk in the document |
| `questions/questions.jsonl` | 157 questions with `split` (dev or test), `type`, `answerable`, `gold_node_ids` and `gold_answer` |
| `questions/gold_passages.jsonl` | the text of every gold node, one row per (question, node) |
| `cached_answers/cs_ai_test_answers.jsonl` | answers recorded by the VeriDex pipeline for the 56 CS / AI test questions, from five systems (see below), with their citations, context passages and the NLI scores the pipeline recorded |
| `MANIFEST.json` | counts, and the size and SHA-256 of every file |

Node text is `text[char_start:char_end]` of its document. A chunk is relevant to a gold node when
it contains part of that node's own text (the part not inside a child node), or of a descendant
or a non-chapter ancestor of it. The notebooks implement this rule in a few lines.

## Collections

`consumer_rules` holds four Indian consumer-protection Rules: E-Commerce Rules 2020, Consumer
Disputes Redressal Commissions Rules 2020, Jurisdiction Rules 2021 and Mediation Rules 2020
(77 questions: 46 answerable, 31 unanswerable).

`cs_ai` holds selected chapters of three open textbooks: Dive into Deep Learning (multilayer
perceptrons, CNNs, RNNs, attention and transformers, optimization), Pro Git (getting started, Git
basics, branching) and Open Data Structures (lists, hash tables, trees, heaps, sorting, graphs)
(80 questions: 60 answerable, 20 unanswerable).

The VeriDex consumer-law collection also contains the Consumer Protection Act, 2019. It is not in
this dataset (see the licence notes), and the 46 questions whose gold passages lie in the Act were
removed. Numbers computed on this dataset are therefore not comparable with the consumer-law
numbers in the VeriDex paper.

Questions were drafted by a 3B language model (qwen2.5:3b) from source passages and kept only
when they passed automatic filters (format, copying, numbers, support by the source,
answerability, near duplicates). They were not individually reviewed by a person. One
unanswerable question (`origin: seed_example`) was written by hand while the tooling was built. The split is the repository's deterministic dev/test split
(30% dev), so the test questions here are the same test questions the pipeline was evaluated on.

## Cached answers

These are recorded outputs. The pipeline ran qwen2.5:3b locally and gpt-oss-120b through a hosted
API, so Kaggle cannot regenerate them. Each row names its system and generator:

| system | generator | retrieval | extra checks |
|---|---|---|---|
| G1 | qwen2.5:3b | fixed_512 chunks, dense bge-base | none |
| G2 | qwen2.5:3b | structural chunks, dense bge-small | none |
| G3 | qwen2.5:3b | as G2 | deterministic guards: an answer with an uncited sentence or an ungrounded number becomes an abstention |
| G4 | qwen2.5:3b | as G2 | guards plus a critic with one revision round |
| G2H | openai/gpt-oss-120b | as G2 | none |

`recorded_eval` holds what the pipeline measured with `cross-encoder/nli-deberta-v3-base`: per
sentence P(entailment) given its cited passages, faithfulness, and whether the answer entails
the gold answer.

## Licence notes

The documents keep their own licences. Use the dataset for non-commercial purposes only (Pro Git
is CC BY-NC-SA), and share adaptations of a document's text under that document's licence.

| document | authors / publisher | licence | source |
|---|---|---|---|
| Dive into Deep Learning (PyTorch edition) | Aston Zhang, Zachary C. Lipton, Mu Li, Alexander J. Smola | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) (book text); the code samples in the text are under the book's [modified MIT licence](https://github.com/d2l-ai/d2l-en/blob/master/LICENSE-SAMPLECODE) | https://d2l.ai/d2l-en.pdf |
| Pro Git, second edition | Scott Chacon, Ben Straub | [CC BY-NC-SA 3.0 Unported](https://creativecommons.org/licenses/by-nc-sa/3.0/) | https://git-scm.com/book/en/v2 |
| Open Data Structures (pseudocode edition) | Pat Morin | [CC BY 2.5 Canada](https://creativecommons.org/licenses/by/2.5/ca/) | https://opendatastructures.org/ |
| Consumer Protection (E-Commerce) Rules, 2020 | Government of India (Gazette of India) | Gazette notification: reproduction permitted by the Copyright Act, 1957, s. 52(1)(q)(i) | https://consumeraffairs.nic.in/acts-and-rules/consumer-protection |
| Consumer Protection (Consumer Disputes Redressal Commissions) Rules, 2020 | as above | as above | as above |
| Consumer Protection (Jurisdiction of the District Commission, the State Commission and the National Commission) Rules, 2021 | as above | as above | as above |
| Consumer Protection (Mediation) Rules, 2020 | as above | as above | as above |

The texts here are excerpts: selected chapters, cleaned of running headers, exercises and Hindi
text. They were changed in that way and split into passages; the originals are at the source
links. Pro Git is reproduced under CC BY-NC-SA 3.0 with this attribution: "Pro Git, second
edition, by Scott Chacon and Ben Straub, https://git-scm.com/book/en/v2". The Consumer Protection
Act, 2019 is left out because for an Act of a Legislature, s. 52(1)(q)(ii) of the Copyright Act
allows reproduction only together with commentary or other original matter.

Questions, gold answers and cached answers quote the documents; treat each row under the licence
of the document it quotes. The cached G1 to G4 answers were generated with qwen2.5:3b (Qwen
Research License, non-commercial) and G2H with gpt-oss-120b (Apache 2.0). The structure, chunk
boundaries and the export code come from the VeriDex repository (MIT).

## Citation

Swapnil Shukla. VeriDex: Structure-Aware Retrieval and Sentence-Level Verification for Question
Answering over Statutes and Textbooks. 2026. https://github.com/Swapnil007-Curious/VeriDex
