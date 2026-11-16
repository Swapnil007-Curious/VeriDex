# Veridex paper

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

## Pending result: the hosted generator on CS/AI (G2H)

The CS/AI G2H evaluation is incomplete (4 of 56 test questions). Until it finishes, its table cells
read "pend." and the sentences that depend on it are printed in colour (`\pending{...}` in
`sections/results.tex`; the setup and limitations sections switch wording through
`\ifcsGtwoHready`). To finish it (about 52 hosted calls, roughly 130k tokens, within one day's free
quota) and refresh the paper:

```powershell
$env:LLM_API_KEY = "..."
python scripts/eval_generation.py --split test --collection cs_ai --systems G2H
python scripts/paper_tables.py; python scripts/paper_figures.py; python scripts/paper_claims.py
cd paper; tectonic main.tex
```

The run resumes from the cached calls; if the provider's daily quota runs out it stops with exit
code 75, and the same command continues it the next day.

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
| `REVIEW.md` | an independent review of the draft |

The scripts read the git-ignored per-question records and corpus reports when they are present and
otherwise fall back to the snapshots in `data/`, so the tables can be rebuilt on a fresh clone.

The error-analysis labels in `data/error_labels.csv` were assigned by reading each sampled record;
the author should confirm them before submission.
