# VeriDex paper

Two versions of one paper describing the research pipeline and the deployment in this repository:

- `main.tex`, the full version (preprint; ACL two-column style, `acl.sty` and `acl_natbib.bst` from
  https://github.com/acl-org/acl-style-files), with the appendix;
- `ieee/main_ieee.tex`, the IEEE conference version (IEEEtran conference class, 6 pages including
  references), which cites the full version as its extended version.

Both use the same generated tables, number macros, figures and bibliography. Every number in the
text is a macro generated from the result files; nothing is typed by hand.

## Build

From the repository root (Windows PowerShell; the same commands work in a POSIX shell):

```powershell
.venv\Scripts\Activate.ps1
pip install -r paper/requirements.txt          # matplotlib, only needed for the figures
python scripts/paper_tables.py                 # tables/*.tex, tables/numbers.tex, data/*.csv|json, ieee/references_ieee.bib
python scripts/paper_figures.py                # figures/*.pdf
python scripts/paper_claims.py                 # CLAIMS.md (exit code 1 if any number disagrees with its source)
cd paper
tectonic main.tex                              # main.pdf (full version)
cd ieee
tectonic main_ieee.tex                         # main_ieee.pdf (IEEE version)
```

[Tectonic](https://tectonic-typesetting.github.io/) downloads the LaTeX packages it needs on first
use. Any TeX Live installation also works: `latexmk -pdf main.tex` (or pdflatex, bibtex, pdflatex
twice), and the same for `ieee/main_ieee.tex` from inside `ieee/`. To use Overleaf, upload the
`paper/` folder (with `tables/` and `figures/` already generated) and compile `main.tex` or
`ieee/main_ieee.tex`.

### Fitting the IEEE page limit

`ieee/main_ieee.tex` starts with switches for optional blocks (each comment gives its approximate
size): the selective-prediction figure, the error-category table, the table of Holm-corrected
tests, the deployment section and the cross-domain subsection. With the defaults the paper is 6
pages including references. For a longer limit, turn blocks on and, if there is room, input more of
the generated tables (`../tables/retrieval_test`, `generation_extra`, `pertype`, `filters`). For a
shorter one, turn blocks off. The section text is in `ieee/sections/*.tex`.

The browser latency numbers (`data/web_latency.json`) come from
`web-static/tests/perf/latency.spec.ts`:

```powershell
cd web-static
npx playwright test --config playwright.perf.config.ts
```

## The hosted generator on CS/AI (G2H)

The CS/AI G2H evaluation is complete (56 of 56 test questions, finished 2026-11-16 UTC; results in
`collections/cs_ai/results/tables/generation_test*.csv` and `generation_test_ablation.meta.json`).
`scripts/paper_tables.py` detects an incomplete run by itself: its table cells then read "pend.",
`\ifcsGtwoHready` is false and the setup and limitations sections switch wording. Its accuracy
comparison with G2 is not in the primary (Holm) family; `paper/data/secondary_tests.csv` holds its
uncorrected paired permutation test. To rerun it from scratch (it resumes from the cached calls and
stops with exit code 75 when the provider's daily quota runs out):

```powershell
$env:LLM_API_KEY = "..."
python scripts/eval_generation.py --split test --collection cs_ai --systems G2H
python scripts/paper_tables.py; python scripts/paper_figures.py; python scripts/paper_claims.py
cd paper; tectonic main.tex
```

## Layout

| path | content |
|---|---|
| `main.tex` | full version: preamble, title, section order |
| `macros.tex` | macros shared by both versions (`\V`, the pending-result switches, `\cmd`, `\gptoss`) |
| `sections/*.tex` | the text of the full version; `sections/acknowledgment.tex` is input by both versions |
| `ieee/main_ieee.tex`, `ieee/sections/*.tex` | the IEEE version; `ieee/IEEEtran.cls` (v1.8b) and `ieee/IEEEtran.bst` (v1.14) are the official IEEE files |
| `ieee/references_ieee.bib` | generated from `references.bib` for IEEEtran.bst (urls dropped where a venue or arXiv id exists, arXiv ids as `howpublished`, no editors, publisher, address or month for proceedings) |
| `tables/` | generated: one file per table, `numbers.tex` (the `\V{key}` macros), the prompts, error examples and commands of the appendix. Each table states `\TabCaption{label}{title}{notes}`; the full version prints one caption below the table, the IEEE version the title above and the notes below |
| `figures/` | generated vector figures (`retrieval_deltas_ieee.pdf` is the IEEE-column variant); Figure 1 is TikZ in `figures/pipeline.tex` |
| `data/` | inputs and snapshots used by the scripts: corpus statistics, derived bootstraps, selective-prediction curves, latency, the error-analysis sample and labels, `macro_sources.json` (key -> source file and field), `reference_verification.json` |
| `references.bib` | bibliography; each entry was checked against the ACL Anthology, Crossref or the arXiv API, except `shukla2026veridexext` (the full version itself, cited by the IEEE version) |
| `CLAIMS.md` | the claims audit (both versions) |
| `REVIEW.md` | independent reviews of the drafts, each followed by the revisions made |
| `EDITS.md` | the 2026-11-23 writing pass: every changed sentence (before/after) and how the IEEE text relates to the full text |

The scripts read the git-ignored per-question records and corpus reports when they are present and
otherwise fall back to the snapshots in `data/`, so the tables can be rebuilt on a fresh clone.

The error-analysis labels in `data/error_labels.csv` were assigned with AI assistance by reading
each sampled record (the paper says so in its error-analysis section and limitations); the author
should confirm them before submission.
