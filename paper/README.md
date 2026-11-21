# VeriDex paper

LaTeX preprint (ACL two-column style, `acl.sty` and `acl_natbib.bst` from
https://github.com/acl-org/acl-style-files) describing the research pipeline and the deployment in
this repository. Every number in the text is a macro generated from the result files; nothing is
typed by hand.

## Build

From the repository root (Windows PowerShell; the same commands work in a POSIX shell):

```powershell
.venv\Scripts\Activate.ps1
pip install -r paper/requirements.txt          # matplotlib, only needed for the figures
python scripts/paper_tables.py                 # tables/*.tex, tables/numbers.tex, data/*.csv|json
python scripts/paper_figures.py                # figures/*.pdf
python scripts/paper_claims.py                 # CLAIMS.md (exit code 1 if any number disagrees with its source)
cd paper
tectonic main.tex                              # main.pdf
```

[Tectonic](https://tectonic-typesetting.github.io/) downloads the LaTeX packages it needs on first
use. Any TeX Live installation also works: `latexmk -pdf main.tex` (or pdflatex, bibtex, pdflatex
twice). To use Overleaf, upload the `paper/` folder (with `tables/` and `figures/` already
generated) and compile `main.tex`.

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
| `main.tex` | preamble, title, section order |
| `sections/*.tex` | the text |
| `tables/` | generated: one file per table, `numbers.tex` (the `\V{key}` macros), the prompts, error examples and commands of the appendix |
| `figures/` | generated vector figures (Figure 1 is TikZ in `sections/system.tex`) |
| `data/` | inputs and snapshots used by the scripts: corpus statistics, derived bootstraps, selective-prediction curves, latency, the error-analysis sample and labels, `macro_sources.json` (key -> source file and field), `reference_verification.json` |
| `references.bib` | bibliography; each entry was checked against the ACL Anthology, Crossref or the arXiv API |
| `CLAIMS.md` | the claims audit |
| `REVIEW.md` | two independent reviews of the drafts, each followed by the revisions made |

The scripts read the git-ignored per-question records and corpus reports when they are present and
otherwise fall back to the snapshots in `data/`, so the tables can be rebuilt on a fresh clone.

The error-analysis labels in `data/error_labels.csv` were assigned with AI assistance by reading
each sampled record (the paper says so in its error-analysis section and limitations); the author
should confirm them before submission.
