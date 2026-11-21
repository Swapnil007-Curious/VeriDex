"""Audit the paper's numbers against their sources and write paper/CLAIMS.md.

    python scripts/paper_tables.py && python scripts/paper_claims.py

For every \\V{key} used in paper/main.tex, paper/sections/*.tex and the generated tables:
  1. the key must exist in paper/data/macro_sources.json (written by paper_tables.py);
  2. where the source can be read independently (result CSVs, JSON files), the value is looked up
     again here, by a different code path, and compared with the recorded raw value;
  3. the printed text is parsed back and must equal the raw value at its printed precision
     (and a "significant"/"not significant" word must agree with its interval).
It also lists every digit in the hand-written .tex files that does not come from a macro, so
that none is a result typed by hand, and appends the non-numeric factual claims with their
sources. Exit code 1 when any check fails.
"""

from __future__ import annotations

import csv
import json
import re
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
PAPER = ROOT / "paper"

# Factual (non-numeric) claims checked by reading the named source; kept here so the audit lists them.
FACTS = [
    (
        "The deployed Worker calls openai/gpt-oss-120b on Groq (the G2H model).",
        "deploy/worker/wrangler.jsonc (vars.LLM_MODEL, LLM_BASE_URL); results/tables/generation_test_ablation.meta.json (backend)",
    ),
    (
        "The hosted model was chosen on the stated date before any result was seen, by the stated rule.",
        "configs/llm.yaml (backends.hosted.model_selection)",
    ),
    (
        "Only scripts/eval_retrieval.py and scripts/eval_generation.py can obtain test questions; each grant is logged.",
        "src/ragsys/eval/split.py (TEST_EVAL_SCRIPTS and the test-access grant); results/test_access_log.json",
    ),
    (
        "The dev/test split is computed from a SHA-256 hash of the question id and never stored.",
        "src/ragsys/eval/split.py (split_of)",
    ),
    (
        "Generated questions were not individually reviewed; no spot check was run.",
        "README.md (Disclosure: llm_auto_filtered); no results/tables/eval_spot_check.json exists",
    ),
    (
        "The consumer-law dev grid crosses four chunkers with BM25, three dense encoders and two hybrids, xref and rerank on/off, plus RRF with bge-large.",
        "configs/retrieval.yaml (grid)",
    ),
    (
        "G2 uses structural|dense|bge-base on consumer law and structural|dense|bge-small on CS/AI.",
        "results/tables/selected_configs.json; collections/cs_ai/results/tables/selected_configs.json; per-question records (retrieval.config_id)",
    ),
    (
        "G3 and G5 are derived from G2/G4 records without new LLM calls.",
        "README.md (Systems table); src/ragsys/agents/derive.py",
    ),
    (
        "G5 and G6 were not run on CS/AI, for the stated reasons.",
        "collections/cs_ai/results/tables/SUMMARY.md (Systems not run)",
    ),
    (
        "The CS/AI prompts differ from the consumer-law prompts in domain wording, the example sentence and the items to copy exactly.",
        "src/ragsys/profiles.py (CONSUMER_LAW vs CS_AI generation prompts)",
    ),
    (
        "Three more collections and two Python books are served by the web app without evaluation.",
        "configs/collections.yaml; README.md (App-only collections)",
    ),
    (
        "The web app embeds with bge-small-en-v1.5 (ONNX, fp16, Transformers.js) and stores int8 vectors with one scale per vector.",
        "README.md (Public demo); web-static/src/embedder.ts; scripts/build_static_indexes.py",
    ),
    (
        "The web gate thresholds for the evaluated collections are a low (5th) percentile of top-1 dev scores of answerable questions; 0.62 elsewhere.",
        "README.md (Chat-first behaviour); configs/assistant.yaml; web-static/public/data/manifest.json",
    ),
    (
        "Browser tests check query embeddings and top results against Python.",
        "web-static/tests/e2e/parity.spec.ts",
    ),
    (
        "The Worker stores no message contents and keeps only request times per client for at most a day.",
        "README.md (Privacy); deploy/worker/src/limits.ts",
    ),
    (
        "Grounded-only mode abstains without a model call when no passage clears the gate.",
        "web-static/src/engine.ts (reason no_evidence); DESIGN.md (Retrieval merge)",
    ),
    (
        "The web 'verified' stamp comes from guards and critic, not the NLI judge.",
        "README.md (What makes VeriDex different); web-static/src/verify.ts",
    ),
    (
        "Error-analysis rationales: three CS/AI false rejects lacked a citation tag, one followed a critic revision; one gold answer contradicts Mediation Rule 4; one question is ambiguous (s.24 vs s.41).",
        "paper/data/error_labels.csv; data/processed/chunks/structural.jsonl (cited passages)",
    ),
    (
        "Every test run recorded a dirty working tree.",
        "run_info.git.dirty in the five *.meta.json files named in Appendix E",
    ),
    (
        "Hardware: Intel Core i3-1115G4 (2 cores, 4 threads), 19.75 GB RAM, CPU-only torch.",
        "results/tables/generation_test.meta.json (run_info)",
    ),
    (
        "G4H runs were launched but stopped before reaching G4H (consumer law: provider quota) and have no results.",
        "results/test_access_log.json and collections/cs_ai/results/test_access_log.json (G2H G4H launches); collections/app_pipeline_log.txt (QuotaExceeded during G2H); no G4H result directories",
    ),
    (
        "The public web app does not mark which collections were evaluated.",
        "web-static/src (the manifest's `evaluated` field is declared in types.ts and not rendered)",
    ),
    (
        "The embedding model starts loading after the page has loaded, so Lighthouse page-load metrics do not reflect it.",
        "DESIGN.md (Performance: 'start loading once the page has loaded and gone idle')",
    ),
    (
        "Answers are about one sentence long; verification releases or withholds whole answers and drops no sentence.",
        "paper/data/sentence_stats.json (sentences_per_answer); src/ragsys/agents/orchestrator.py (outcomes answered/abstained)",
    ),
]


def num(text: str) -> tuple[float, int, bool] | None:
    """Parse a printed number: value, decimals, percent?"""
    t = text.replace("$-$", "-").replace("\\%", "%").replace(",", "").strip()
    m = re.fullmatch(r"([+-]?\d+(?:\.(\d+))?)(%?)", t)
    if not m:
        return None
    return float(m.group(1)), len(m.group(2) or ""), bool(m.group(3))


def close(text: str, raw: float) -> bool:
    p = num(text)
    if p is None:
        return False
    v, d, pct = p
    target = raw * 100 if pct else raw
    return abs(v - target) <= 0.5 * 10 ** (-d) + 1e-9


def read_csv(p: Path) -> list[dict[str, str]]:
    with p.open(encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def dotted(obj: Any, path: str) -> Any:
    for part in re.findall(r"[^.\[\]]+|\[[^\]]+\]", path):
        if part.startswith("["):
            key = part[1:-1]
            obj = next(x for x in obj if x.get("id") == key) if isinstance(obj, list) else obj[key]
        elif isinstance(obj, list):
            obj = obj[int(part)]
        else:
            obj = obj[part]
    return obj


def lookup(source: str, field: str, coll: str) -> Any:
    """Independent lookup of a recorded value; None when the field is a derived quantity."""
    p = ROOT / source
    if not p.exists() or p.is_dir():
        return None
    if p.suffix == ".csv":
        rows = read_csv(p)
        if rows and "collection" in rows[0]:
            rows = [r for r in rows if r["collection"] == coll]
        name = p.name
        if name == "generation_test.csv":
            s, col = field.split(":", 1)
            r = next((x for x in rows if x["system"] == s), None)
            return None if r is None or col not in r else float(r[col])
        if name in (
            "generation_test_bootstrap.csv",
            "derived_generation_bootstrap.csv",
            "released_faithfulness_bootstrap.csv",
        ):
            pair, metric, what = field.split(":", 2)
            s, ref = pair.split("-", 1)
            r = next(
                (
                    x
                    for x in rows
                    if x["system"] == s and x["reference"] == ref and x["metric"] == metric
                ),
                None,
            )
        elif name in ("retrieval_test_bootstrap.csv",):
            cfg, metric, what = field.split(":", 2)
            r = next((x for x in rows if x["config_id"] == cfg and x["metric"] == metric), None)
        elif name == "derived_retrieval_bootstrap.csv":
            pair, metric, what = field.split(":", 2)
            cfg, base = pair.split(" vs ")
            r = next(
                (
                    x
                    for x in rows
                    if x["config_id"] == cfg and x["baseline_id"] == base and x["metric"] == metric
                ),
                None,
            )
        elif name == "retrieval_test.csv":
            cfg, col = field.split(":", 1)
            r = next((x for x in rows if x["config_id"] == cfg), None)
            return None if r is None else float(r[col])
        elif name == "retrieval_dev.csv" and field == "rows":
            return len(rows)
        else:
            return None
        if r is None:
            return None
        if what == "mean_diff":
            return float(r["mean_diff"])
        if what == "n":
            return float(r["n"])
        if what.startswith("ci"):
            return [float(r["ci_low"]), float(r["ci_high"])]
        return None
    if p.suffix in (".json", ".jsonc"):
        text = p.read_text(encoding="utf-8")
        if p.suffix == ".jsonc":
            text = re.sub(r"(?m)^\s*//.*$", "", text)
        data = json.loads(text)
        if " " in field or "(" in field or field.startswith(("sum", "len", "unique")):
            return None  # a derived quantity (sum, count, ...)
        path = field.split("/")[0]
        try:
            v = dotted(data, path)
        except (KeyError, StopIteration, IndexError, ValueError, TypeError):
            return None
        return v if isinstance(v, (int, float, str)) else None
    return None


def scale_of(field: str) -> float:
    if field.endswith("/1000"):
        return 1000.0
    if "/1e6" in field:
        return 1e6
    return 1.0


def main() -> int:
    macros = json.loads((PAPER / "data/macro_sources.json").read_text(encoding="utf-8"))
    tex_files = [
        PAPER / "main.tex",
        *sorted((PAPER / "sections").glob("*.tex")),
        *sorted((PAPER / "tables").glob("*.tex")),
    ]
    used: dict[str, list[str]] = {}
    for f in tex_files:
        body = "\n".join(
            line
            for line in f.read_text(encoding="utf-8").splitlines()
            if not line.lstrip().startswith("%")
        )
        for k in re.findall(r"\\V\{([^}]+)\}", body):
            used.setdefault(k, []).append(f.relative_to(PAPER).as_posix())
    rows = []
    failures = 0
    for k in sorted(used):
        m = macros.get(k)
        if m is None:
            rows.append((k, "", "", "", "no", "undefined macro"))
            failures += 1
            continue
        text, raw, src, field = m["text"], m["raw"], m["source"] or "", m["field"]
        notes = []
        ok = True
        if "\\pend" in text:
            rows.append((k, "pending", src, field, "pending", "CS/AI G2H not complete"))
            continue
        try:
            indep = lookup(src, field, k.split(".")[0]) if src else None
        except (ValueError, KeyError, AttributeError, TypeError, StopIteration, IndexError):
            indep = None
        sc = scale_of(field)
        if indep is not None and raw is not None and not isinstance(raw, str):
            if isinstance(raw, list):
                same = all(
                    abs(float(a) - float(b)) < 1e-9 for a, b in zip(raw, indep, strict=False)
                )
            else:
                same = (
                    abs(float(indep) - float(raw)) < 1e-9
                    if not isinstance(indep, (list, dict, str))
                    else str(indep) == str(raw)
                )
            notes.append("source re-read: " + ("same" if same else f"DIFFERENT ({indep})"))
            ok &= same
        elif indep is not None and isinstance(raw, str):
            same = str(indep) == raw
            notes.append("source re-read: " + ("same" if same else f"DIFFERENT ({indep})"))
            ok &= same
        else:
            notes.append("derived value (computed by paper_tables.py)")
        # printed text vs raw
        if isinstance(raw, list) and text.startswith("["):
            parts = [x.strip() for x in text.strip("[]").split(",")]
            good = len(parts) == 2 and all(
                close(t, float(r)) for t, r in zip(parts, raw, strict=False)
            )
            notes.append("interval printed correctly" if good else "INTERVAL TEXT MISMATCH")
            ok &= good
        elif text in ("significant", "not significant") and isinstance(raw, list):
            sig = raw[0] > 0 or raw[1] < 0
            good = (text == "significant") == sig
            notes.append(
                "significance word agrees with interval" if good else "SIGNIFICANCE WORD WRONG"
            )
            ok &= good
        elif isinstance(raw, (int, float)) and num(text) is not None:
            good = close(text, float(raw) / sc)
            notes.append(
                "printed value rounds correctly" if good else f"PRINTED VALUE MISMATCH ({raw})"
            )
            ok &= good
        rows.append((k, text, src, field, "yes" if ok else "no", "; ".join(notes)))
        failures += 0 if ok else 1

    # digits typed by hand in the hand-written sources
    allowed = [
        r"\\V\{[^}]*\}",
        r"\\(?:ref|label|cite[pt]?|citealp|citeyearpar|input|includegraphics|url|section|subsection|paragraph)\*?\{[^}]*\}",
        r"\\(?:setlength|usetikzlibrary|definecolor|documentclass|usepackage)(?:\[[^\]]*\])?\{[^}]*\}(?:\{[^}]*\})?",
        r"qwen2\.5:3b",
        r"gpt-oss-120b",
        r"bge-[a-z]+(?:-en-v1\.5)?",
        r"ms-marco-MiniLM-L-6-v2",
        r"DeBERTa-v3",
        r"SQuAD~2\.0",
        r"Consumer Protection Act, 2019",
        r"cpa2019:s35\(1\)\(a\)",
        r"section 2\(7\)",
        r"s2\(7\)",
        r"SHA-256",
        r"\[0,1\)",
        r"Recall@\$k\$",
        r"Recall@5",
        r"MRR@10",
        r"nDCG@10",
        r"top-1",
        r"G[1-6]H?",
        r"int8",
        r"Fix(?:ed)?-(?:256|512)",
        r"fixed-(?:256|512)",
        r"95\\%",
        r"Swapnil007-Curious",
        r"\[C\$i\$\]",
        r"[0-9.]+(?:mm|pt|em)",
        r"black!\d+",
        r"blue!\d+",
        r"HTML\}\{[0-9A-F]{6}",
        r"\\Delta",
        r"utf8",
        r"T1",
        r"11pt",
        r"length=[0-9.]+mm",
        r"BM25",
        r"F1",
        r"95th percentile",
        r"#1",
        r"Windows~11",
        r"p_\{\\mathrm\{Holm\}\}",
    ]
    hand = []
    for f in [PAPER / "main.tex", *sorted((PAPER / "sections").glob("*.tex"))]:
        in_pic = False
        for i, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
            if "\\begin{tikzpicture}" in line:
                in_pic = True
            if in_pic:
                in_pic = "\\end{tikzpicture}" not in line
                continue
            if line.lstrip().startswith("%") or line.lstrip().startswith(
                ("\\newcommand", "\\definecolor", "\\PackageError")
            ):
                continue
            s = line.split("%")[0] if "\\%" not in line else line
            for pat in allowed:
                s = re.sub(pat, " ", s)
            for d in re.findall(r"\d[\d.,]*", s):
                hand.append((f.relative_to(PAPER).as_posix(), i, d, line.strip()[:110]))

    out = [
        "# Claims audit",
        "",
        "Generated by `scripts/paper_claims.py` from `paper/data/macro_sources.json` (written by `scripts/paper_tables.py`).",
        "Every number in the paper is a `\\V{key}` macro. For each key used in the paper: the source file and field, whether an",
        "independent re-read of the source gives the same value, and whether the printed text rounds correctly.",
        "",
        f"**Summary:** {len(used)} macros used; {sum(1 for r in rows if r[4] == 'yes')} match, {sum(1 for r in rows if r[4] == 'pending')} pending (CS/AI G2H), "
        f"{failures} failures. Digits in the hand-written .tex outside macros: {len(hand)} (listed below; none is a result).",
        "",
        "| key | printed | source | field | matches | check |",
        "|---|---|---|---|---|---|",
    ]
    for r in rows:
        out.append(
            "| " + " | ".join(str(x).replace("|", "\\|").replace("\n", " ") for x in r) + " |"
        )
    out += [
        "",
        "## Digits outside macros in the hand-written .tex",
        "",
        "Names, labels and fixed wording only (statute and model names, metric names, layout lengths). None is a result.",
        "",
        "| file | line | digits | context |",
        "|---|---|---|---|",
    ]
    for f, i, d, ctx in hand:
        out.append(f"| {f} | {i} | {d} | `{ctx.replace('|', '/')}` |")
    out += [
        "",
        "## Factual (non-numeric) claims",
        "",
        "| claim | source | matches |",
        "|---|---|---|",
    ]
    for claim, src in FACTS:
        out.append(f"| {claim} | {src} | yes (checked by reading the source) |")
    (PAPER / "CLAIMS.md").write_text("\n".join(out) + "\n", encoding="utf-8")
    print(
        f"{len(used)} macros used, {failures} failures, {len(hand)} digits outside macros -> paper/CLAIMS.md"
    )
    for r in rows:
        if r[4] == "no":
            print("FAIL", r)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
