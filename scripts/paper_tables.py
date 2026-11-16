"""Build the paper's tables and number macros from the result files.

    python scripts/paper_tables.py

Writes ``paper/tables/*.tex`` (booktabs) and ``paper/tables/numbers.tex``: every number quoted in
the paper is a macro, used in the text as ``\\V{key}``. ``paper/data/macro_sources.json`` maps each
key to its value, source file and field; ``scripts/paper_claims.py`` audits the paper against it.

Inputs
  * tracked: the result tables in ``results/tables/`` and ``collections/cs_ai/results/tables/``,
    the configs, ``web-static/public/data/manifest.json``, ``docs/lighthouse.json``,
    ``deploy/worker/wrangler.jsonc`` and ``paper/data/web_latency.json`` (written by
    ``web-static/tests/perf/latency.spec.ts``);
  * git-ignored, used when present: per-question records (``results/generation``,
    ``results/retrieval`` and the cs_ai equivalents) and the corpus reports in the processed
    directories. Everything derived from them is snapshotted to ``paper/data/`` so the script also
    runs on a fresh clone (it then reads the snapshots and says so).

The hosted-generator ablation G2H on the CS/AI test split may be incomplete: its cells and macros
then read "pending", and ``\\ifcsGtwoHready`` is false. Rerun this script after
``scripts/eval_generation.py --split test --collection cs_ai --systems G2H`` has finished.

Derived statistics use the pipeline's own paired bootstrap (``ragsys.eval.metrics``) with the
resample count and seed of ``configs/retrieval.yaml``; the script first reproduces the bootstrap
rows already in the result tables and stops if they differ.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import random
import re
import statistics
import sys
from collections import Counter, defaultdict
from collections.abc import Callable
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from ragsys.eval.metrics import paired_bootstrap  # noqa: E402
from ragsys.eval.split import DEV_FRACTION  # noqa: E402

PAPER = ROOT / "paper"
TABLES = PAPER / "tables"
DATA = PAPER / "data"

COLLS: dict[str, dict[str, Any]] = {
    "cl": {
        "name": "consumer_law",
        "label": "Consumer law",
        "results": ROOT / "results",
        "processed": ROOT / "data/processed",
        "questions": ROOT / "data/eval/questions.jsonl",
        "gen_config": ROOT / "configs/generation.yaml",
    },
    "cs": {
        "name": "cs_ai",
        "label": "CS/AI",
        "results": ROOT / "collections/cs_ai/results",
        "processed": ROOT / "collections/cs_ai/processed",
        "questions": ROOT / "collections/cs_ai/eval/questions.jsonl",
        "gen_config": ROOT / "configs/collections/cs_ai/generation.yaml",
    },
}
APP_COLLS = {  # served by the web app, not evaluated
    "il": ("indian_law", ROOT / "collections/indian_law/processed", "Indian law"),
    "hb": ("human_biology", ROOT / "collections/human_biology/processed", "Human biology"),
    "pc": (
        "physics_chemistry",
        ROOT / "collections/physics_chemistry/processed",
        "Physics \\& chem.",
    ),
    "csapp": ("cs_ai", ROOT / "collections/cs_ai/processed_app", "CS/AI (app)"),
}
SYSTEMS = ["G1", "G2", "G3", "G4", "G5", "G6", "G2H"]
SHORT_LABEL = {"cl": "Cons.\\ law", "cs": "CS/AI"}
SLUG = {
    "fixed_512|dense|bge-base": "naive",
    "fixed_512|bm25": "bm25",
    "structural|dense|bge-base": "struct-b",
    "structural|dense|bge-small": "struct-s",
    "fixed_512|dense|bge-small": "f512-s",
    "fixed_512|dense|bge-small|rerank-minilm": "f512-s-rr",
    "fixed_256|hybrid_linear|bge-base|a0.5|rerank-minilm": "f256-hyb-rr",
    "semantic|hybrid_linear|bge-base|a0.5|rerank-minilm": "sem-hyb-rr",
}
BOOT_METRIC = {
    "overall_accuracy": "acc",
    "faithfulness": "faith",
    "correct_refusal_rate": "refusal",
}
PEND = r"\pend{}"
PENDC = r"\pendc{}"  # short marker for table cells
ERROR_SAMPLE_SIZE = 20
ERROR_SEED = 42
ERROR_CATEGORIES = [
    ("retrieval_miss", "Retrieval miss"),
    ("chunk_boundary", "Chunk boundary"),
    ("synthesis_error", "Synthesis error"),
    ("verifier_false_reject", "Verifier false reject"),
    ("verifier_false_accept", "Verifier false accept"),
    ("eval_artifact", "Evaluation artefact"),
]
ERROR_EXAMPLES = [("cl", "q011"), ("cs", "q035")]  # shown in Section 5.5
RELEASED_PAIRS = {
    "cl": [
        ("G2", "G1"),
        ("G3", "G2"),
        ("G4", "G2"),
        ("G4", "G1"),
        ("G4", "G3"),
        ("G5", "G4"),
        ("G6", "G4"),
        ("G2H", "G2"),
    ],
    "cs": [("G2", "G1"), ("G3", "G2"), ("G4", "G2"), ("G4", "G1"), ("G4", "G3"), ("G2H", "G2")],
}


# ----------------------------------------------------------------------------- helpers


def rel(p: Path | str | None) -> str | None:
    if p is None:
        return None
    p = Path(p)
    try:
        return p.resolve().relative_to(ROOT).as_posix()
    except ValueError:
        return p.as_posix()


def read_csv(p: Path) -> list[dict[str, str]]:
    with p.open(encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def read_jsonl(p: Path) -> list[dict[str, Any]]:
    with p.open(encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def write_csv(p: Path, rows: list[dict[str, Any]]) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    keys: list[str] = []
    for r in rows:
        for k in r:
            if k not in keys:
                keys.append(k)
    with p.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=keys, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)


def fl(x: Any) -> float:
    return float("nan") if x in (None, "") else float(x)


def fnum(x: Any, d: int = 3) -> str:
    v = fl(x)
    if math.isnan(v):
        return "--"
    v = round(v, d)
    if v == 0:
        v = 0.0
    return ("$-$" if v < 0 else "") + f"{abs(v):.{d}f}"


def fsigned(x: Any, d: int = 3) -> str:
    v = round(fl(x), d)
    if v == 0:
        return f"{0:.{d}f}"
    return ("+" if v > 0 else "$-$") + f"{abs(v):.{d}f}"


def fci(lo: Any, hi: Any, d: int = 3) -> str:
    return f"[{fnum(lo, d)}, {fnum(hi, d)}]"


def sigword(lo: Any, hi: Any) -> str:
    return "significant" if (fl(lo) > 0 or fl(hi) < 0) else "not significant"


def fint(x: Any) -> str:
    return f"{round(fl(x)):,}"


def fpct(x: Any, d: int = 0) -> str:
    return f"{100 * fl(x):.{d}f}\\%"


def tex_escape(s: str) -> str:
    out = []
    for ch in s:
        if ch in "&%$#_{}":
            out.append("\\" + ch)
        elif ch == "~":
            out.append(r"\textasciitilde{}")
        elif ch == "^":
            out.append(r"\textasciicircum{}")
        elif ch == "\\":
            out.append(r"\textbackslash{}")
        else:
            out.append(ch)
    return "".join(out)


class Numbers:
    """Registry of the macros quoted in the paper: key -> text, source, field."""

    def __init__(self) -> None:
        self.items: dict[str, dict[str, Any]] = {}

    def put(
        self, key: str, text: str, source: Path | str | None, field: str, raw: Any = None
    ) -> str:
        if not re.fullmatch(r"[A-Za-z0-9.\-]+", key):
            raise SystemExit(f"bad number key {key!r}")
        if key in self.items:
            raise SystemExit(f"duplicate number key {key}")
        if isinstance(raw, float) and math.isnan(raw):
            raw = None
        self.items[key] = {"text": text, "source": rel(source), "field": field, "raw": raw}
        return text

    def write(self, path: Path, flags: dict[str, bool]) -> None:
        lines = [
            "% Generated by scripts/paper_tables.py -- do not edit by hand.",
            "% Each number quoted in the paper is \\V{key}; sources: paper/data/macro_sources.json.",
        ]
        for flag, value in flags.items():
            lines.append(f"\\{flag}{'true' if value else 'false'}")
        for k in sorted(self.items):
            lines.append(
                f"\\expandafter\\newcommand\\csname v@{k}\\endcsname{{{self.items[k]['text']}}}"
            )
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def local_or_snapshot(name: str, compute: Callable[[], Any], notes: list[str]) -> Any:
    """Compute from the git-ignored records; fall back to (and otherwise refresh) the snapshot."""
    snap = DATA / name
    try:
        value = compute()
    except FileNotFoundError as e:
        if not snap.exists():
            raise SystemExit(
                f"{name}: local inputs missing ({e}) and no snapshot in paper/data/"
            ) from e
        notes.append(f"{name}: local inputs missing, read the snapshot paper/data/{name}")
        if name.endswith(".json"):
            return json.loads(snap.read_text(encoding="utf-8"))
        return read_csv(snap)
    if name.endswith(".json"):
        snap.write_text(json.dumps(value, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    else:
        write_csv(snap, value)
    return value


def write_table(name: str, body: str) -> None:
    (TABLES / name).write_text(
        "% Generated by scripts/paper_tables.py -- do not edit by hand.\n" + body, encoding="utf-8"
    )


def cfg_label(cid: str) -> str:
    parts = cid.split("|")
    chunk = {
        "fixed_256": "Fixed-256",
        "fixed_512": "Fixed-512",
        "semantic": "Semantic",
        "structural": "Structural",
    }[parts[0]]
    ret = {
        "bm25": "BM25",
        "dense": "dense",
        "hybrid_rrf": "hybrid RRF",
        "hybrid_linear": "hybrid linear",
    }[parts[1]]
    model = next((p for p in parts if p.startswith("bge-")), None)
    s = f"{chunk}, {ret}"
    if model:
        s += f" ({model.replace('bge-', 'bge-')})"
    if "xref" in parts:
        s += ", xref"
    if any(p.startswith("rerank") for p in parts):
        s += " + rerank"
    return s


def cfg_short(cid: str) -> str:
    """Compact configuration label, as in the figures (``Struct., dense-b``)."""
    parts = cid.split("|")
    chunk = {
        "fixed_256": "Fix-256",
        "fixed_512": "Fix-512",
        "semantic": "Semantic",
        "structural": "Struct.",
    }[parts[0]]
    ret = {"bm25": "BM25", "dense": "dense", "hybrid_rrf": "RRF", "hybrid_linear": "linear"}[
        parts[1]
    ]
    model = next((p.replace("bge-", "")[0] for p in parts if p.startswith("bge-")), None)
    s = f"{chunk}, {ret}" + (f"-{model}" if model else "")
    if any(p.startswith("rerank") for p in parts):
        s += ", rr"
    return s


# ----------------------------------------------------------------------------- sections


def corpus_stats() -> dict[str, Any]:
    def one(processed: Path) -> dict[str, Any]:
        sr = json.loads((processed / "structure/structure_report.json").read_text(encoding="utf-8"))
        cr = json.loads((processed / "chunks/chunk_report.json").read_text(encoding="utf-8"))
        docs = sr["documents"]
        docs = list(docs.values()) if isinstance(docs, dict) else docs
        pages = sum(int(d.get("pages_kept", d.get("pages", 0))) for d in docs)
        chunkers = {}
        for name, c in cr["chunkers"].items():
            chunkers[name] = {
                "count": c["count"],
                "tokens_mean": c.get("tokens", {}).get("mean"),
                "tokens_median": c.get("tokens", {}).get("median"),
                "fraction_sections_split": c.get("fraction_sections_split"),
                "chunks_crossing_section_boundaries": c.get("chunks_crossing_section_boundaries"),
            }
        return {
            "documents": len(docs),
            "doc_ids": [d["doc_id"] for d in docs],
            "pages": pages,
            "nodes": sr["totals"]["nodes"],
            "xrefs_total": sr["totals"]["xrefs"]["total"],
            "xrefs_resolved": sr["totals"]["xrefs"]["resolved_to_node"],
            "chunkers": chunkers,
            "sources": {
                "structure": rel(processed / "structure/structure_report.json"),
                "chunks": rel(processed / "chunks/chunk_report.json"),
            },
        }

    out = {c: one(COLLS[c]["processed"]) for c in COLLS}
    for k, (_, processed, _) in APP_COLLS.items():
        out[k] = one(processed)
    return out


def gen_rows(c: str) -> tuple[Path, dict[str, dict[str, str]]]:
    p = COLLS[c]["results"] / "tables/generation_test.csv"
    return p, {r["system"]: r for r in read_csv(p)}


def eval_records(c: str, system: str) -> list[dict[str, Any]]:
    p = COLLS[c]["results"] / f"generation/test/{system}/eval.jsonl"
    if not p.exists():
        raise FileNotFoundError(p)
    return read_jsonl(p)


def pq_records(c: str, system: str) -> list[dict[str, Any]]:
    p = COLLS[c]["results"] / f"generation/test/{system}/per_question.jsonl"
    if not p.exists():
        raise FileNotFoundError(p)
    return read_jsonl(p)


def boot_pair(
    mine: dict[str, dict[str, Any]], base: dict[str, dict[str, Any]], n_res: int, seed: int
) -> dict[str, dict[str, Any]]:
    """The bootstrap rows of ragsys.eval.answers.bootstrap_rows for one system pair."""
    common = [q for q in mine if q in base]
    out = {}
    for metric in ("overall_accuracy", "faithfulness", "correct_refusal_rate"):
        if metric == "overall_accuracy":
            qs = common
            a = [float(mine[q]["accurate"]) for q in qs]
            b = [float(base[q]["accurate"]) for q in qs]
        elif metric == "faithfulness":
            qs = [q for q in common if mine[q]["answered"] and base[q]["answered"]]
            a = [float(mine[q]["faithfulness"]) for q in qs]
            b = [float(base[q]["faithfulness"]) for q in qs]
        else:
            qs = [q for q in common if not mine[q]["answerable"]]
            a = [float(mine[q]["abstained"]) for q in qs]
            b = [float(base[q]["abstained"]) for q in qs]
        out[metric] = paired_bootstrap(a, b, n_resamples=n_res, seed=seed)
    return out


DERIVED_PAIRS = {
    "cl": [("G4", "G2"), ("G3", "G2"), ("G4", "G3"), ("G5", "G4"), ("G6", "G4")],
    "cs": [("G4", "G2"), ("G3", "G2"), ("G4", "G3")],
}


def derived_generation_bootstrap(n_res: int, seed: int) -> list[dict[str, Any]]:
    rows = []
    for c, pairs in DERIVED_PAIRS.items():
        loaded = {
            s: {r["qid"]: r for r in eval_records(c, s)}
            for s in {"G1", "G2", *(x for p in pairs for x in p)}
        }
        recs = loaded.__getitem__

        # reproduce a bootstrap row of the result table first
        ref = {
            (r["system"], r["reference"], r["metric"]): r
            for r in read_csv(COLLS[c]["results"] / "tables/generation_test_bootstrap.csv")
        }
        check = boot_pair(recs("G2"), recs("G1"), n_res, seed)
        for metric, res in check.items():
            r = ref[("G2", "G1", metric)]
            for k in ("mean_diff", "ci_low", "ci_high"):
                if abs(float(r[k]) - float(res[k])) > 1e-4:
                    raise SystemExit(
                        f"bootstrap reproduction failed for {c} G2-G1 {metric} {k}: {r[k]} vs {res[k]}"
                    )
        for s, b in pairs:
            for metric, res in boot_pair(recs(s), recs(b), n_res, seed).items():
                rows.append(
                    {
                        "collection": c,
                        "system": s,
                        "reference": b,
                        "metric": metric,
                        **res,
                        "n_resamples": n_res,
                        "seed": seed,
                    }
                )
    return rows


def _answered_and_faith(recs: dict[str, dict[str, Any]], qs: list[str]) -> tuple[Any, Any]:
    import numpy as np

    ans = np.array([1.0 if recs[q]["answered"] else 0.0 for q in qs])
    fa = np.array([float(recs[q]["faithfulness"]) if recs[q]["answered"] else 0.0 for q in qs])
    return ans, fa


def released_faithfulness_bootstrap(n_res: int, seed: int) -> list[dict[str, Any]]:
    """Faithfulness of the answers each system releases (mean over its own answered questions),
    system minus reference, with a percentile interval from resampling questions (same resample
    count and seed as the pipeline). Unlike the pipeline's paired comparison, which uses only the
    questions both systems answered, this credits a system for withholding unsupported answers."""
    import numpy as np

    rows = []
    for c, pairs in RELEASED_PAIRS.items():
        recs = {}
        for s in {x for p in pairs for x in p}:
            try:
                recs[s] = {r["qid"]: r for r in eval_records(c, s)}
            except FileNotFoundError:
                if s != "G2H":
                    raise
        if "G2H" in recs and len(recs["G2H"]) < len(recs["G2"]):
            del recs["G2H"]  # the hosted ablation is incomplete on this collection
        for s, b in pairs:
            if s not in recs or b not in recs:
                continue
            qs = sorted(set(recs[s]) & set(recs[b]))
            a_s, f_s = _answered_and_faith(recs[s], qs)
            a_b, f_b = _answered_and_faith(recs[b], qs)
            point = f_s.sum() / a_s.sum() - f_b.sum() / a_b.sum()
            rng = np.random.default_rng(seed)
            idx = rng.integers(0, len(qs), size=(n_res, len(qs)))
            with np.errstate(invalid="ignore", divide="ignore"):
                diff = f_s[idx].sum(1) / a_s[idx].sum(1) - f_b[idx].sum(1) / a_b[idx].sum(1)
            diff = diff[np.isfinite(diff)]
            rows.append(
                {
                    "collection": c,
                    "system": s,
                    "reference": b,
                    "metric": "released_faithfulness",
                    "n": len(qs),
                    "n_answered_system": int(a_s.sum()),
                    "n_answered_reference": int(a_b.sum()),
                    "mean_diff": float(point),
                    "ci_low": float(np.percentile(diff, 2.5)),
                    "ci_high": float(np.percentile(diff, 97.5)),
                    "n_resamples": n_res,
                    "seed": seed,
                }
            )
    return rows


def retrieval_records(c: str, config_id: str) -> list[dict[str, Any]]:
    p = COLLS[c]["results"] / "retrieval/test" / config_id.replace("|", "__") / "per_query.jsonl"
    if not p.exists():
        raise FileNotFoundError(p)
    return read_jsonl(p)


DERIVED_RET = {"cs": [("structural|dense|bge-small", "fixed_512|dense|bge-small")]}


def derived_retrieval_bootstrap(n_res: int, seed: int) -> list[dict[str, Any]]:
    rows = []
    # reproduce one row of the consumer-law table first
    ref = {
        (r["config_id"], r["metric"]): r
        for r in read_csv(COLLS["cl"]["results"] / "tables/retrieval_test_bootstrap.csv")
    }
    a = {
        r["qid"]: r for r in retrieval_records("cl", "structural|dense|bge-base") if r["answerable"]
    }
    b = {
        r["qid"]: r for r in retrieval_records("cl", "fixed_512|dense|bge-base") if r["answerable"]
    }
    qs = sorted(a)
    for metric in ("recall@5", "coverage@1024"):
        res = paired_bootstrap(
            [a[q]["metrics"][metric] for q in qs],
            [b[q]["metrics"][metric] for q in qs],
            n_res,
            seed,
        )
        r = ref[("structural|dense|bge-base", metric)]
        if (
            abs(float(r["mean_diff"]) - res["mean_diff"]) > 1e-4
            or abs(float(r["ci_low"]) - res["ci_low"]) > 1e-4
        ):
            raise SystemExit(f"retrieval bootstrap reproduction failed ({metric}): {r} vs {res}")
    for c, pairs in DERIVED_RET.items():
        for x, y in pairs:
            a = {r["qid"]: r for r in retrieval_records(c, x) if r["answerable"]}
            b = {r["qid"]: r for r in retrieval_records(c, y) if r["answerable"]}
            qs = sorted(a)
            for metric in ("recall@5", "coverage@1024"):
                res = paired_bootstrap(
                    [a[q]["metrics"][metric] for q in qs],
                    [b[q]["metrics"][metric] for q in qs],
                    n_res,
                    seed,
                )
                rows.append(
                    {
                        "collection": c,
                        "config_id": x,
                        "baseline_id": y,
                        "metric": metric,
                        **res,
                        "n_resamples": n_res,
                        "seed": seed,
                    }
                )
    return rows


def selective_curves() -> list[dict[str, Any]]:
    rows = []
    for c in COLLS:
        for s in ("G2", "G4"):
            ev = {r["qid"]: r for r in eval_records(c, s)}
            pq = {r["qid"]: r for r in pq_records(c, s)}
            n = len(ev)
            scores = {q: float(pq[q]["retrieval"]["abstention_score"]) for q in ev}
            for t in [-math.inf, *sorted(set(scores.values()))]:
                ans = [q for q in ev if ev[q]["answered"] and scores[q] >= t]
                acc_overall = (
                    sum(
                        1
                        for q in ev
                        if (q in ans and ev[q]["accurate"])
                        or (q not in ans and not ev[q]["answerable"])
                    )
                    / n
                )
                rows.append(
                    {
                        "collection": c,
                        "system": s,
                        "threshold": "" if t == -math.inf else round(t, 6),
                        "n": n,
                        "n_answered": len(ans),
                        "coverage": len(ans) / n,
                        "accuracy_answered": (sum(ev[q]["accurate"] for q in ans) / len(ans))
                        if ans
                        else "",
                        "overall_accuracy": acc_overall,
                    }
                )
    return rows


def research_latency() -> dict[str, Any]:
    out: dict[str, Any] = {}
    for c in COLLS:
        for s in ("G2", "G4", "G2H"):
            try:
                pq = pq_records(c, s)
            except FileNotFoundError:
                if s == "G2H":
                    continue
                raise
            if s == "G2H" and len(pq) < len(pq_records(c, "G2")):
                continue  # incomplete ablation
            stage: dict[str, list[float]] = defaultdict(list)
            for r in pq:
                acc = Counter()
                for st in r["steps"]:
                    acc[st["name"]] += float(st.get("ms") or 0.0)
                stage["retrieval"].append(acc["retrieval"])
                stage["synthesis"].append(acc["synthesis"])
                stage["critic"].append(acc["critic"])
                stage["e2e"].append(float(r["cost"]["e2e_ms"]))
            out[f"{c}.{s}"] = {
                "n": len(pq),
                **{f"{k}_mean_ms": statistics.mean(v) for k, v in stage.items()},
                **{f"{k}_median_ms": statistics.median(v) for k, v in stage.items()},
            }
    return out


def gold_relevance(c: str, config_id: str) -> dict[str, dict[str, set[str]]]:
    """qid -> chunk_id -> gold nodes it is relevant to (from the retrieval test records)."""
    out = {}
    for r in retrieval_records(c, config_id):
        out[r["qid"]] = {x["chunk_id"]: set(x.get("relevant_to") or []) for x in r["ranked"]}
    return out


def error_sample() -> list[dict[str, Any]]:
    fails: dict[str, list[str]] = {}
    ev: dict[str, dict[str, dict[str, Any]]] = {}
    for c in COLLS:
        ev[c] = {r["qid"]: r for r in eval_records(c, "G4")}
        fails[c] = sorted(q for q, r in ev[c].items() if not r["accurate"])
    total = sum(len(v) for v in fails.values())
    quota = {c: round(ERROR_SAMPLE_SIZE * len(fails[c]) / total) for c in COLLS}
    rng = random.Random(ERROR_SEED)
    rows = []
    for c in COLLS:
        pq = {r["qid"]: r for r in pq_records(c, "G4")}
        g2 = {r["qid"]: r for r in eval_records(c, "G2")}
        questions = {q["id"]: q for q in read_jsonl(COLLS[c]["questions"])}
        cfg = next(iter(pq.values()))["retrieval"]["config_id"]
        rel_map = gold_relevance(c, cfg)
        for q in rng.sample(fails[c], quota[c]):
            r, e = pq[q], ev[c][q]
            golds = list(r["gold_node_ids"])
            ranked = rel_map.get(q, {})
            ctx_ids = [p["chunk_id"] for p in r["context"]]
            covered = (
                set().union(*[ranked.get(cid, set()) for cid in ctx_ids]) if ctx_ids else set()
            )
            ranks = [i + 1 for i, cid in enumerate(ranked) if ranked[cid]]
            first_rank = ranks[0] if ranks else None
            critic = None
            for rd in r.get("rounds", []):
                if rd.get("critic"):
                    critic = (
                        rd["critic"].get("verdict") if isinstance(rd["critic"], dict) else None
                    ) or critic
            if not e["answerable"]:
                auto = "verifier_false_accept"
            elif not covered:
                auto = "retrieval_miss"
            elif len(covered) < len(golds):
                auto = "chunk_boundary"
            elif (
                r["outcome"] == "abstained"
                and r["reason"] in ("guard_fail", "critic_abstain")
                and g2[q]["accurate"]
            ):
                auto = "verifier_false_reject"
            elif r["outcome"] == "answered" and e.get("any_unsupported"):
                auto = "verifier_false_accept"
            else:
                auto = "synthesis_error"
            rows.append(
                {
                    "collection": c,
                    "qid": q,
                    "type": r["type"],
                    "outcome": r["outcome"],
                    "reason": r["reason"] or "",
                    "n_gold": len(golds),
                    "n_gold_in_context": len(covered),
                    "first_relevant_rank": first_rank if first_rank is not None else "",
                    "faithfulness": e.get("faithfulness") if e.get("answered") else "",
                    "p_correct": e.get("p_correct", ""),
                    "g2_accurate": g2[q]["accurate"],
                    "critic_verdict_last": critic or "",
                    "guard_reasons": "; ".join(r["guards"]["reasons"]) if r.get("guards") else "",
                    "auto_category": auto,
                    "question": r["question"],
                    "gold_answer": questions[q]["gold_answer"],
                    "answer": r["answer"],
                    "withheld_answer": r.get("withheld_answer")
                    or next(
                        (
                            (rd.get("synth") or {}).get("answer", "")
                            for rd in r.get("rounds", [])
                            if (rd.get("synth") or {}).get("answer")
                        ),
                        "",
                    ),
                }
            )
    return rows


SENTENCE_SYSTEMS = ["G1", "G2", "G3", "G4", "G5", "G6", "G2H"]
CITED_PAIRS = {
    "cl": [("G2", "G1"), ("G3", "G2"), ("G4", "G2"), ("G4", "G3"), ("G2H", "G2")],
    "cs": [("G2", "G1"), ("G3", "G2"), ("G4", "G2"), ("G4", "G3"), ("G2H", "G2")],
}
N_PERM = 10000  # paired permutation tests of the primary family


def _complete_records(c: str, s: str) -> dict[str, dict[str, Any]] | None:
    try:
        recs = {r["qid"]: r for r in eval_records(c, s)}
    except FileNotFoundError:
        return None
    if s == "G2H" and len(recs) < len(eval_records(c, "G2")):
        return None
    return recs


def _sentence_arrays(recs: dict[str, dict[str, Any]], qs: list[str]) -> tuple[Any, Any]:
    """Per question: number of cited sentences and number of those the NLI judge supports
    (released answers only; a sentence without citation labels is not counted)."""
    import numpy as np

    cited = np.zeros(len(qs))
    sup = np.zeros(len(qs))
    for i, q in enumerate(qs):
        r = recs[q]
        if not r["answered"]:
            continue
        for se in r["sentences"]:
            if se["labels"]:
                cited[i] += 1
                sup[i] += 1.0 if se["supported"] else 0.0
    return cited, sup


def sentence_stats(n_res: int, seed: int) -> dict[str, Any]:
    """Faithfulness split into citation-format failures and NLI support of cited sentences,
    answer length, released wrong answers; bootstrap of cited-sentence support differences."""
    import numpy as np

    rows, boots = [], []
    for c in COLLS:
        recs = {s: _complete_records(c, s) for s in SENTENCE_SYSTEMS}
        for s, rr in recs.items():
            if rr is None:
                continue
            answered = [r for r in rr.values() if r["answered"]]
            sents = [se for r in answered for se in r["sentences"]]
            cited = [se for se in sents if se["labels"]]
            rows.append(
                {
                    "collection": c,
                    "system": s,
                    "answers": len(answered),
                    "sentences": len(sents),
                    "sentences_per_answer": len(sents) / len(answered) if answered else "",
                    "uncited_share": (len(sents) - len(cited)) / len(sents) if sents else "",
                    "cited_support": sum(1 for se in cited if se["supported"]) / len(cited)
                    if cited
                    else "",
                    "multi_cited": sum(1 for se in cited if len(se["labels"]) > 1),
                    "wrong_released": sum(1 for r in answered if not r["accurate"]),
                    "correct_released": sum(1 for r in answered if r["accurate"]),
                }
            )
        for s, b in CITED_PAIRS[c]:
            if recs.get(s) is None or recs.get(b) is None:
                continue
            qs = sorted(set(recs[s]) & set(recs[b]))
            cs_, ss_ = _sentence_arrays(recs[s], qs)
            cb_, sb_ = _sentence_arrays(recs[b], qs)
            point = ss_.sum() / cs_.sum() - sb_.sum() / cb_.sum()
            rng = np.random.default_rng(seed)
            idx = rng.integers(0, len(qs), size=(n_res, len(qs)))
            with np.errstate(invalid="ignore", divide="ignore"):
                diff = ss_[idx].sum(1) / cs_[idx].sum(1) - sb_[idx].sum(1) / cb_[idx].sum(1)
            diff = diff[np.isfinite(diff)]
            boots.append(
                {
                    "collection": c,
                    "system": s,
                    "reference": b,
                    "metric": "cited_support",
                    "n": len(qs),
                    "mean_diff": float(point),
                    "ci_low": float(np.percentile(diff, 2.5)),
                    "ci_high": float(np.percentile(diff, 97.5)),
                    "n_resamples": n_res,
                    "seed": seed,
                }
            )
    return {"systems": rows, "bootstrap": boots}


def _perm_p(stat: Callable[[Any], float], swap_n: int, seed: int) -> tuple[float, float]:
    """Two-sided paired permutation test: stat(mask) with mask[i] = swap the pair of question i."""
    import numpy as np

    rng = np.random.default_rng(seed)
    obs = stat(np.zeros(swap_n, dtype=bool))
    hits = 0
    for _ in range(N_PERM):
        if abs(stat(rng.random(swap_n) < 0.5)) >= abs(obs) - 1e-12:
            hits += 1
    return obs, (hits + 1) / (N_PERM + 1)


def primary_tests(seed: int) -> list[dict[str, Any]]:
    """The primary family, declared after the first draft as a robustness check: paired
    permutation tests with Holm's correction."""
    import numpy as np

    out = []
    for c in COLLS:
        cfg = {"cl": "structural|dense|bge-base", "cs": "structural|dense|bge-small"}[c]
        a = {r["qid"]: r for r in retrieval_records(c, cfg) if r["answerable"]}
        b = {
            r["qid"]: r for r in retrieval_records(c, "fixed_512|dense|bge-base") if r["answerable"]
        }
        qs = sorted(a)
        d = np.array(
            [a[q]["metrics"]["coverage@1024"] - b[q]["metrics"]["coverage@1024"] for q in qs]
        )
        obs, p = _perm_p(lambda m, d=d: float(np.where(m, -d, d).mean()), len(qs), seed)
        out.append(
            {
                "id": f"{c}.cov",
                "collection": c,
                "comparison": "structural vs naive retrieval",
                "metric": "coverage@1024",
                "diff": obs,
                "p": p,
                "n": len(qs),
                "discordant": "",
            }
        )
    for c in COLLS:
        recs = {s: _complete_records(c, s) for s in ("G2", "G4", "G2H")}
        pairs = [("G4", "G2", "rel"), ("G4", "G2", "acc")] + (
            [("G2H", "G2", "acc")] if c == "cl" else []
        )
        for s, ref, kind in pairs:
            if recs.get(s) is None:
                continue
            qs = sorted(set(recs[s]) & set(recs[ref]))
            if kind == "acc":
                x = np.array([float(recs[s][q]["accurate"]) for q in qs])
                y = np.array([float(recs[ref][q]["accurate"]) for q in qs])
                dd = x - y
                obs, p = _perm_p(lambda m, dd=dd: float(np.where(m, -dd, dd).mean()), len(qs), seed)
                disc = f"{int(((x == 1) & (y == 0)).sum())}/{int(((x == 0) & (y == 1)).sum())}"
                metric = "overall_accuracy"
            else:
                a_s, f_s = _answered_and_faith(recs[s], qs)
                a_b, f_b = _answered_and_faith(recs[ref], qs)

                def stat(m: Any, a_s=a_s, f_s=f_s, a_b=a_b, f_b=f_b) -> float:
                    as_, fs_ = np.where(m, a_b, a_s), np.where(m, f_b, f_s)
                    ab_, fb_ = np.where(m, a_s, a_b), np.where(m, f_s, f_b)
                    return float(fs_.sum() / as_.sum() - fb_.sum() / ab_.sum())

                obs, p = _perm_p(stat, len(qs), seed)
                disc = ""
                metric = "released_faithfulness"
            out.append(
                {
                    "id": f"{c}.{s}-{ref}.{kind}",
                    "collection": c,
                    "comparison": f"{s}-{ref}",
                    "metric": metric,
                    "diff": obs,
                    "p": p,
                    "n": len(qs),
                    "discordant": disc,
                }
            )
    # Holm
    order = sorted(range(len(out)), key=lambda i: out[i]["p"])
    m = len(out)
    running = 0.0
    for rank, i in enumerate(order):
        running = max(running, min(1.0, (m - rank) * out[i]["p"]))
        out[i]["p_holm"] = running
    for r in out:
        r["n_permutations"] = N_PERM
        r["seed"] = seed
    return out


class _StrictJudge:
    """Relevance without the ancestor rule: a chunk counts only if it covers the gold node's
    own text or a descendant's."""

    def __init__(self, processed: Path, chunker: str) -> None:
        from ragsys.eval.relevance import RelevanceJudge
        from ragsys.ingest.pipeline import load_nodes
        from ragsys.retrieval.corpus import NodeGraph, load_chunks

        graph = NodeGraph(load_nodes(processed / "structure" / "nodes.jsonl"))
        self.judge = RelevanceJudge(graph, load_chunks(processed, chunker))
        self.graph = graph

    def relevant(self, chunk_id: str, golds: list[str], strict: bool) -> set[str]:
        cov = self.judge.covered_nodes(chunk_id)
        out = set()
        for g in golds:
            if g not in self.graph:
                continue
            match = ({g} | self.graph.descendants(g)) if strict else self.judge.matching_nodes(g)
            if cov & match:
                out.add(g)
        return out


def strict_coverage(n_res: int, seed: int) -> list[dict[str, Any]]:
    from ragsys.eval.metrics import budget_coverage

    rows = []
    for c in COLLS:
        cfg = {"cl": "structural|dense|bge-base", "cs": "structural|dense|bge-small"}[c]
        vals: dict[str, dict[str, dict[str, float]]] = {}
        for cid in (cfg, "fixed_512|dense|bge-base"):
            judge = _StrictJudge(COLLS[c]["processed"], cid.split("|")[0])
            vals[cid] = {}
            for r in retrieval_records(c, cid):
                if not r["answerable"]:
                    continue
                ids = [x["chunk_id"] for x in r["ranked"]]
                toks = [int(x["n_tokens"]) for x in r["ranked"]]
                g = list(r["gold_node_ids"])
                lenient = budget_coverage([judge.relevant(i, g, False) for i in ids], toks, g, 1024)
                if abs(lenient - r["metrics"]["coverage@1024"]) > 1e-9:
                    raise SystemExit(
                        f"lenient coverage recomputation differs for {c} {cid} {r['qid']}"
                    )
                vals[cid][r["qid"]] = {
                    "lenient": lenient,
                    "strict": budget_coverage(
                        [judge.relevant(i, g, True) for i in ids], toks, g, 1024
                    ),
                }
        qs = sorted(vals[cfg])
        for kind in ("lenient", "strict"):
            x = [vals[cfg][q][kind] for q in qs]
            y = [vals["fixed_512|dense|bge-base"][q][kind] for q in qs]
            res = paired_bootstrap(x, y, n_res, seed)
            rows.append(
                {
                    "collection": c,
                    "relevance": kind,
                    "structural": statistics.mean(x),
                    "naive": statistics.mean(y),
                    **res,
                    "n_resamples": n_res,
                    "seed": seed,
                }
            )
    return rows


def coverage_vs_correct() -> list[dict[str, Any]]:
    """Correctness of answerable questions by whether every gold provision was in the context."""
    rows = []
    for c in COLLS:
        for s in ("G1", "G2"):
            pq = {r["qid"]: r for r in pq_records(c, s)}
            ev = {r["qid"]: r for r in eval_records(c, s)}
            cfg = next(iter(pq.values()))["retrieval"]["config_id"]
            rel_map = gold_relevance(c, cfg)
            groups: dict[str, list[float]] = {"all_gold": [], "not_all_gold": []}
            for q, r in pq.items():
                if not r["answerable"]:
                    continue
                covered = (
                    set().union(
                        *[rel_map.get(q, {}).get(p["chunk_id"], set()) for p in r["context"]]
                    )
                    if r["context"]
                    else set()
                )
                key = "all_gold" if len(covered) >= len(r["gold_node_ids"]) else "not_all_gold"
                groups[key].append(1.0 if ev[q]["accurate"] else 0.0)
            for k, v in groups.items():
                rows.append(
                    {
                        "collection": c,
                        "system": s,
                        "group": k,
                        "n": len(v),
                        "correct_rate": statistics.mean(v) if v else "",
                    }
                )
    return rows


# ----------------------------------------------------------------------------- main


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.parse_args()
    TABLES.mkdir(parents=True, exist_ok=True)
    DATA.mkdir(parents=True, exist_ok=True)
    N = Numbers()
    notes: list[str] = []

    rcfg_path = ROOT / "configs/retrieval.yaml"
    rcfg = yaml.safe_load(rcfg_path.read_text(encoding="utf-8"))
    n_res, seed = int(rcfg["eval"]["bootstrap_resamples"]), int(rcfg["eval"]["seed"])

    # ---------------------------------------------------------------- corpus
    cs_stats = local_or_snapshot("corpus_stats.json", corpus_stats, notes)
    snap = DATA / "corpus_stats.json"
    for c, st in cs_stats.items():
        N.put(f"{c}.docs", fint(st["documents"]), snap, f"{c}.documents", st["documents"])
        N.put(f"{c}.pages", fint(st["pages"]), snap, f"{c}.pages", st["pages"])
        N.put(f"{c}.nodes", fint(st["nodes"]), snap, f"{c}.nodes", st["nodes"])
        N.put(
            f"{c}.xrefs",
            fint(st["xrefs_resolved"]),
            snap,
            f"{c}.xrefs_resolved",
            st["xrefs_resolved"],
        )
        for ch, v in st["chunkers"].items():
            k = ch.replace("_", "")
            N.put(f"{c}.chunks.{k}", fint(v["count"]), snap, f"{c}.chunkers.{ch}.count", v["count"])
            if v.get("tokens_mean") is not None:
                N.put(
                    f"{c}.tok.{k}",
                    fint(v["tokens_mean"]),
                    snap,
                    f"{c}.chunkers.{ch}.tokens_mean",
                    v["tokens_mean"],
                )
            if v.get("fraction_sections_split") is not None:
                N.put(
                    f"{c}.split.{k}",
                    fpct(v["fraction_sections_split"]),
                    snap,
                    f"{c}.chunkers.{ch}.fraction_sections_split",
                    v["fraction_sections_split"],
                )

    man_path = ROOT / "web-static/public/data/manifest.json"
    man = json.loads(man_path.read_text(encoding="utf-8"))
    man_by = {m["id"]: m for m in man["collections"]}
    lib_docs = sorted({s["doc_id"] for m in man["collections"] for s in m["sources"]})
    total_passages = sum(m["count"] for m in man["collections"])
    vec_gz = sum(m["files"]["vectors"]["gzip_bytes"] for m in man["collections"])
    vec_raw = sum(m["files"]["vectors"]["bytes"] for m in man["collections"])
    txt_gz = sum(m["files"]["passages"]["gzip_bytes"] for m in man["collections"])
    N.put(
        "lib.passages", fint(total_passages), man_path, "sum(collections[].count)", total_passages
    )
    N.put(
        "lib.docs",
        fint(len(lib_docs)),
        man_path,
        "unique collections[].sources[].doc_id",
        len(lib_docs),
    )
    N.put(
        "lib.collections",
        fint(len(man["collections"])),
        man_path,
        "len(collections)",
        len(man["collections"]),
    )
    N.put(
        "lib.dim",
        fint(man["collections"][0]["dim"]),
        man_path,
        "collections[0].dim",
        man["collections"][0]["dim"],
    )
    N.put(
        "lib.vecgz",
        f"{vec_gz / 1e6:.2f}",
        man_path,
        "sum(files.vectors.gzip_bytes)/1e6 (MB)",
        vec_gz,
    )
    N.put(
        "lib.vecraw", f"{vec_raw / 1e6:.2f}", man_path, "sum(files.vectors.bytes)/1e6 (MB)", vec_raw
    )
    N.put(
        "lib.txtgz",
        f"{txt_gz / 1e6:.2f}",
        man_path,
        "sum(files.passages.gzip_bytes)/1e6 (MB)",
        txt_gz,
    )
    for cid, m in man_by.items():
        key = {
            "consumer_law": "cl",
            "cs_ai": "csapp",
            "indian_law": "il",
            "human_biology": "hb",
            "physics_chemistry": "pc",
        }[cid]
        N.put(
            f"lib.{key}.passages",
            fint(m["count"]),
            man_path,
            f"collections[{cid}].count",
            m["count"],
        )
        N.put(
            f"lib.{key}.thr",
            fnum(m["threshold"], 2),
            man_path,
            f"collections[{cid}].threshold",
            m["threshold"],
        )

    # corpus table
    lines = [
        "\\begin{table}[t]\n\\centering\\footnotesize\\setlength{\\tabcolsep}{2pt}",
        "\\begin{tabular}{@{}lrrrrrr@{}}\n\\toprule",
        " & & & \\multicolumn{2}{c}{Chunks} & \\multicolumn{2}{c}{Test Q.} \\\\ \\cmidrule(lr){4-5}\\cmidrule(l){6-7}",
        "Collection & Docs & Pages & Struct. & Fix-512 & Ans. & Unans. \\\\ \\midrule",
    ]
    con = {}
    for c in COLLS:
        con[c] = json.loads(
            (COLLS[c]["results"] / "tables/eval_construction.json").read_text(encoding="utf-8")
        )
    for c in COLLS:
        st = cs_stats[c]
        sp = con[c]["final_counts"]["whole_file"]["by_split"]
        lines.append(
            f"{COLLS[c]['label']} & {fint(st['documents'])} & {fint(st['pages'])} & {fint(st['chunkers']['structural']['count'])} & "
            f"{fint(st['chunkers']['fixed_512']['count'])} & {sp['test']['answerable']} & {sp['test']['unanswerable']} \\\\"
        )
    lines.append(
        "\\midrule\n\\multicolumn{7}{@{}l}{\\emph{Served by the web app only (not evaluated)}} \\\\"
    )
    for k in ("csapp", "il", "hb", "pc"):
        st = cs_stats[k]
        lines.append(
            f"{APP_COLLS[k][2]} & {fint(st['documents'])} & {fint(st['pages'])} & {fint(st['chunkers']['structural']['count'])} & -- & -- & -- \\\\"
        )
    lines += [
        "\\bottomrule\n\\end{tabular}",
        "\\caption{Collections. Pages are PDF pages kept after cleaning (selected chapters for textbooks). "
        "Struct.\\ = structural chunks; Fix-512 = fixed windows. The web app serves the structural chunks of the consumer-law row and of the app rows. "
        "Test questions are answerable (Ans.) or unanswerable (Unans.).}",
        "\\label{tab:corpus}\n\\end{table}\n",
    ]
    write_table("corpus.tex", "\n".join(lines))

    # ---------------------------------------------------------------- evaluation sets
    for c in COLLS:
        p = COLLS[c]["results"] / "tables/eval_construction.json"
        d = con[c]
        a, u = d["answerable"], d["unanswerable"]
        N.put(f"{c}.ev.model", tex_escape(d["model"]), p, "model", d["model"])
        N.put(f"{c}.ev.acand", fint(a["drafted"]), p, "answerable.drafted", a["drafted"])
        N.put(f"{c}.ev.asurv", fint(a["survivors"]), p, "answerable.survivors", a["survivors"])
        N.put(
            f"{c}.ev.asel",
            fint(a["selection"]["selected"]),
            p,
            "answerable.selection.selected",
            a["selection"]["selected"],
        )
        ucand = sum(u["candidates_generated"].values())
        N.put(f"{c}.ev.ucand", fint(ucand), p, "sum(unanswerable.candidates_generated)", ucand)
        N.put(f"{c}.ev.usurv", fint(u["survivors"]), p, "unanswerable.survivors", u["survivors"])
        N.put(
            f"{c}.ev.usel",
            fint(u["selection"]["selected"]),
            p,
            "unanswerable.selection.selected",
            u["selection"]["selected"],
        )
        N.put(
            f"{c}.ev.human",
            fint(d["kept_existing_items"]),
            p,
            "kept_existing_items",
            d["kept_existing_items"],
        )
        wf = d["final_counts"]["whole_file"]
        N.put(f"{c}.ev.total", fint(wf["total"]), p, "final_counts.whole_file.total", wf["total"])
        newc = d["final_counts"]["new_items"]["by_split"]
        seed_test = sum(wf["by_split"]["test"].values()) - sum(newc["test"].values())
        seed_dev = sum(wf["by_split"]["dev"].values()) - sum(newc["dev"].values())
        N.put(f"{c}.ev.seedtest", str(seed_test), p, "whole_file minus new_items, test", seed_test)
        N.put(f"{c}.ev.seeddev", str(seed_dev), p, "whole_file minus new_items, dev", seed_dev)
        rc = next((f for f in u["filters"] if f["name"] == "retrieval_check"), None)
        if rc is not None:
            N.put(
                f"{c}.ev.rcheckin",
                str(rc["in"]),
                p,
                "unanswerable.filters[retrieval_check].in",
                rc["in"],
            )
            N.put(
                f"{c}.ev.rcheckfail",
                str(rc["fail"]),
                p,
                "unanswerable.filters[retrieval_check].fail",
                rc["fail"],
            )
        for sp in ("dev", "test"):
            for kind, short in (("answerable", "a"), ("unanswerable", "u")):
                v = wf["by_split"][sp][kind]
                N.put(
                    f"{c}.ev.{sp}.{short}",
                    fint(v),
                    p,
                    f"final_counts.whole_file.by_split.{sp}.{kind}",
                    v,
                )
            tot = wf["by_split"][sp]["answerable"] + wf["by_split"][sp]["unanswerable"]
            N.put(
                f"{c}.ev.{sp}.n", fint(tot), p, f"final_counts.whole_file.by_split.{sp} (sum)", tot
            )
        N.put(
            f"{c}.ev.overlap",
            fnum(a["mean_lexical_overlap"]["selected"], 2),
            p,
            "answerable.mean_lexical_overlap.selected",
            a["mean_lexical_overlap"]["selected"],
        )
        calls = d["llm_calls"]["calls"]
        N.put(f"{c}.ev.calls", fint(calls), p, "llm_calls.calls", calls)
        hours = d["generation_wall_time_s"] / 3600
        N.put(
            f"{c}.ev.hours",
            f"{hours:.1f}",
            p,
            "generation_wall_time_s/3600",
            d["generation_wall_time_s"],
        )
    th = con["cl"]["thresholds"]
    pth = COLLS["cl"]["results"] / "tables/eval_construction.json"
    N.put(
        "ev.qwords.lo",
        str(th["question_words"][0]),
        pth,
        "thresholds.question_words[0]",
        th["question_words"][0],
    )
    N.put(
        "ev.qwords.hi",
        str(th["question_words"][1]),
        pth,
        "thresholds.question_words[1]",
        th["question_words"][1],
    )
    N.put(
        "ev.answords",
        str(th["max_answer_words"]),
        pth,
        "thresholds.max_answer_words",
        th["max_answer_words"],
    )
    N.put(
        "ev.copy", fnum(th["copy_overlap"], 1), pth, "thresholds.copy_overlap", th["copy_overlap"]
    )
    N.put(
        "ev.dup",
        fnum(th["near_duplicate_cosine"], 2),
        pth,
        "thresholds.near_duplicate_cosine",
        th["near_duplicate_cosine"],
    )
    N.put(
        "ev.rcheck",
        str(th["retrieval_check_k"]),
        pth,
        "thresholds.retrieval_check_k",
        th["retrieval_check_k"],
    )
    N.put("ev.seed", str(con["cl"]["seed"]), pth, "seed", con["cl"]["seed"])
    llm_cfg = yaml.safe_load((ROOT / "configs/llm.yaml").read_text(encoding="utf-8"))
    N.put(
        "ev.temp",
        fnum(llm_cfg["backends"]["local"]["temperature"], 1),
        ROOT / "configs/llm.yaml",
        "backends.local.temperature",
        llm_cfg["backends"]["local"]["temperature"],
    )
    N.put(
        "split.dev",
        fnum(DEV_FRACTION, 2),
        ROOT / "src/ragsys/eval/split.py",
        "DEV_FRACTION",
        DEV_FRACTION,
    )
    N.put(
        "split.devpct",
        fpct(DEV_FRACTION),
        ROOT / "src/ragsys/eval/split.py",
        "DEV_FRACTION",
        DEV_FRACTION,
    )
    N.put(
        "cs.ev.xrefpairs",
        str(con["cs"]["cross_reference_decision"]["resolved_reference_pairs"]),
        COLLS["cs"]["results"] / "tables/eval_construction.json",
        "cross_reference_decision.resolved_reference_pairs",
        con["cs"]["cross_reference_decision"]["resolved_reference_pairs"],
    )

    # filter table (appendix)
    lines = [
        "\\begin{table}[t]\n\\centering\\footnotesize\\setlength{\\tabcolsep}{4pt}",
        "\\begin{tabular}{@{}lrrrr@{}}\n\\toprule",
        " & \\multicolumn{2}{c}{Consumer law} & \\multicolumn{2}{c}{CS/AI} \\\\ \\cmidrule(lr){2-3}\\cmidrule(l){4-5}",
        "Filter & In & Pass & In & Pass \\\\ \\midrule",
        "\\multicolumn{5}{@{}l}{\\emph{Answerable candidates}} \\\\",
    ]
    for kind in ("answerable", "unanswerable"):
        if kind == "unanswerable":
            lines.append("\\multicolumn{5}{@{}l}{\\emph{Unanswerable candidates}} \\\\")
        fa = {f["name"]: f for f in con["cl"][kind]["filters"]}
        fb = {f["name"]: f for f in con["cs"][kind]["filters"]}
        for name in list(fa) + [n for n in fb if n not in fa]:
            x, y = fa.get(name), fb.get(name)
            lines.append(
                f"\\texttt{{{tex_escape(name)}}} & {x['in'] if x else '--'} & {x['pass'] if x else '--'} & {y['in'] if y else '--'} & {y['pass'] if y else '--'} \\\\"
            )
    lines += [
        "\\bottomrule\n\\end{tabular}",
        "\\caption{Automatic filters of the evaluation-set construction, in order (from \\texttt{eval\\_construction.json}). "
        "In = candidates entering the filter; Pass = candidates kept.}",
        "\\label{tab:filters}\n\\end{table}\n",
    ]
    write_table("filters.tex", "\n".join(lines))

    # ---------------------------------------------------------------- retrieval (test)
    ret_rows: dict[str, list[dict[str, str]]] = {}
    ret_boot: dict[str, dict[tuple[str, str], dict[str, str]]] = {}
    for c in COLLS:
        p = COLLS[c]["results"] / "tables/retrieval_test.csv"
        pb = COLLS[c]["results"] / "tables/retrieval_test_bootstrap.csv"
        ret_rows[c] = read_csv(p)
        ret_boot[c] = {(r["config_id"], r["metric"]): r for r in read_csv(pb)}
        N.put(
            f"{c}.ret.nans",
            fint(ret_rows[c][0]["n_answerable"]),
            p,
            "n_answerable",
            ret_rows[c][0]["n_answerable"],
        )
        for r in ret_rows[c]:
            s = SLUG[r["config_id"]]
            for col, k in (
                ("recall@1", "r1"),
                ("recall@5", "r5"),
                ("recall@10", "r10"),
                ("mrr@10", "mrr"),
                ("ndcg@10", "ndcg"),
                ("coverage@512", "cov512"),
                ("coverage@1024", "cov1024"),
                ("coverage@2048", "cov2048"),
                ("auroc_top1_first_stage", "auroc"),
            ):
                if r.get(col):
                    N.put(
                        f"{c}.ret.{s}.{k}", fnum(r[col]), p, f"{r['config_id']}:{col}", fl(r[col])
                    )
            N.put(
                f"{c}.ret.{s}.lat",
                fint(r["latency_total_p50_ms"]),
                p,
                f"{r['config_id']}:latency_total_p50_ms",
                fl(r["latency_total_p50_ms"]),
            )
            for metric, k in (("recall@5", "dr5"), ("coverage@1024", "dcov")):
                b = ret_boot[c].get((r["config_id"], metric))
                if b:
                    N.put(
                        f"{c}.ret.{s}.{k}",
                        fsigned(b["mean_diff"]),
                        pb,
                        f"{r['config_id']}:{metric}:mean_diff",
                        fl(b["mean_diff"]),
                    )
                    N.put(
                        f"{c}.ret.{s}.{k}ci",
                        fci(b["ci_low"], b["ci_high"]),
                        pb,
                        f"{r['config_id']}:{metric}:ci_low,ci_high",
                        [fl(b["ci_low"]), fl(b["ci_high"])],
                    )
                    N.put(
                        f"{c}.ret.{s}.{k}sig",
                        sigword(b["ci_low"], b["ci_high"]),
                        pb,
                        f"{r['config_id']}:{metric}:ci excludes 0",
                        [fl(b["ci_low"]), fl(b["ci_high"])],
                    )
    N.put("boot.n", fint(n_res), rcfg_path, "eval.bootstrap_resamples", n_res)
    N.put("boot.seed", str(seed), rcfg_path, "eval.seed", seed)

    dret = local_or_snapshot(
        "derived_retrieval_bootstrap.csv", lambda: derived_retrieval_bootstrap(n_res, seed), notes
    )
    pdr = DATA / "derived_retrieval_bootstrap.csv"
    for r in dret:
        k = f"{r['collection']}.dret.{SLUG[r['config_id']]}-{SLUG[r['baseline_id']]}.{'dr5' if r['metric'] == 'recall@5' else 'dcov'}"
        N.put(
            k,
            fsigned(r["mean_diff"]),
            pdr,
            f"{r['config_id']} vs {r['baseline_id']}:{r['metric']}:mean_diff",
            fl(r["mean_diff"]),
        )
        N.put(
            k + "ci",
            fci(r["ci_low"], r["ci_high"]),
            pdr,
            f"{r['config_id']} vs {r['baseline_id']}:{r['metric']}:ci",
            [fl(r["ci_low"]), fl(r["ci_high"])],
        )
        N.put(
            k + "sig",
            sigword(r["ci_low"], r["ci_high"]),
            pdr,
            f"{r['config_id']} vs {r['baseline_id']}:{r['metric']}:ci excludes 0",
            [fl(r["ci_low"]), fl(r["ci_high"])],
        )

    sel = {
        c: json.loads(
            (COLLS[c]["results"] / "tables/selected_configs.json").read_text(encoding="utf-8")
        )
        for c in COLLS
    }
    rcols = ("recall@5", "mrr@10", "ndcg@10", "coverage@512", "coverage@1024", "coverage@2048")
    lines = [
        "\\begin{table*}[t]\n\\centering\\footnotesize\\setlength{\\tabcolsep}{2.6pt}",
        "\\begin{tabular}{@{}lllrrrrrrr@{}}\n\\toprule",
        "Coll. & Configuration & Role & R@5 & MRR@10 & nDCG@10 & Cov@512 & Cov@1024 & Cov@2048 & p50 ms \\\\ \\midrule",
    ]
    for ci_, c in enumerate(COLLS):
        roles = {s["config_id"]: s["roles"] for s in sel[c]["selected"]}
        rows = ret_rows[c]
        best = {col: max(fl(r[col]) for r in rows) for col in rcols}
        for i, r in enumerate(rows):
            role = roles.get(r["config_id"], [])
            rl = (
                "naive"
                if "baseline_naive_rag" in role
                else (
                    "BM25"
                    if "baseline_bm25" in role
                    else (
                        "best overall"
                        if "best_overall" in role
                        else "best "
                        + cfg_short(role[0].replace("best_", "") + "|bm25").split(",")[0]
                    )
                )
            )
            cells = []
            for col in rcols:
                v = fnum(r[col])
                cells.append(f"\\textbf{{{v}}}" if abs(fl(r[col]) - best[col]) < 1e-9 else v)
            lines.append(
                f"{SHORT_LABEL[c] if i == 0 else ''} & {tex_escape(cfg_short(r['config_id']))} & {rl} & {' & '.join(cells)} & {fint(r['latency_total_p50_ms']) if fl(r['latency_total_p50_ms']) >= 1 else '$<$1'} \\\\"
            )
        if ci_ == 0:
            lines.append("\\midrule")
    lines += [
        "\\bottomrule\n\\end{tabular}",
        "\\caption{Retrieval on the test split (answerable questions: \\V{cl.ret.nans} consumer law, \\V{cs.ret.nans} CS/AI). "
        "Configuration: chunker, retriever (dense, BM25 or hybrid with linear fusion) with encoder size (s/b = bge-small/base), rr = MiniLM reranking. "
        "R@5 = Recall@5, Cov@$b$ = token-budget coverage at $b$ tokens. Configurations were chosen on dev by Cov@1024 (best overall and best per chunker) plus two fixed baselines; "
        "bold = best in the collection. p50 ms = median retrieval latency on the laptop CPU.}",
        "\\label{tab:retrieval}\n\\end{table*}\n",
    ]
    write_table("retrieval_test.tex", "\n".join(lines))

    # figure data for the retrieval deltas
    fig_rows = []
    for c in COLLS:
        for r in ret_rows[c]:
            for metric in ("recall@5", "coverage@1024"):
                b = ret_boot[c].get((r["config_id"], metric))
                if b:
                    fig_rows.append(
                        {
                            "collection": c,
                            "config_id": r["config_id"],
                            "label": cfg_label(r["config_id"]),
                            "metric": metric,
                            "mean_diff": b["mean_diff"],
                            "ci_low": b["ci_low"],
                            "ci_high": b["ci_high"],
                        }
                    )
    write_csv(DATA / "fig_retrieval_deltas.csv", fig_rows)

    # ---------------------------------------------------------------- generation (test)
    gen: dict[str, dict[str, dict[str, str]]] = {}
    gen_path: dict[str, Path] = {}
    for c in COLLS:
        gen_path[c], gen[c] = gen_rows(c)
    cs_g2h_ready = "G2H" in gen["cs"]
    metrics_map = [
        ("answered_rate", "answered", fnum),
        ("faithfulness", "faith", fnum),
        ("overall_accuracy", "acc", fnum),
        ("correct_rate_answered", "corrans", fnum),
        ("correct_rate_answerable", "corrall", fnum),
        ("correct_and_faithful_rate", "cf", fnum),
        ("citation_precision", "citp", fnum),
        ("citation_recall", "citr", fnum),
        ("correct_refusal_rate", "refusal", fnum),
        ("false_abstention_rate", "falseabs", fnum),
        ("abstention_precision", "absp", fnum),
        ("abstention_recall", "absr", fnum),
        ("abstention_f1", "absf1", fnum),
        ("llm_calls_mean", "calls", lambda x: fnum(x, 2)),
        ("answers_with_unsupported_share", "unsupshare", fnum),
    ]
    for c in COLLS:
        for s in SYSTEMS:
            r = gen[c].get(s)
            if r is None and not (c == "cs" and s == "G2H"):
                continue
            for col, k, f in metrics_map:
                if r is None:
                    N.put(f"{c}.gen.{s}.{k}", PEND, gen_path[c], f"{s}:{col} (pending)")
                else:
                    N.put(f"{c}.gen.{s}.{k}", f(r[col]), gen_path[c], f"{s}:{col}", fl(r[col]))
            if r is None:
                for k in ("p50", "p95", "falseabspct", "refusaln", "nanswered", "ptok"):
                    N.put(f"{c}.gen.{s}.{k}", PEND, gen_path[c], f"{s} (pending)")
                continue
            N.put(
                f"{c}.gen.{s}.p50",
                f"{fl(r['latency_p50_ms']) / 1000:.1f}",
                gen_path[c],
                f"{s}:latency_p50_ms/1000",
                fl(r["latency_p50_ms"]),
            )
            N.put(
                f"{c}.gen.{s}.p95",
                f"{fl(r['latency_p95_ms']) / 1000:.1f}",
                gen_path[c],
                f"{s}:latency_p95_ms/1000",
                fl(r["latency_p95_ms"]),
            )
            N.put(
                f"{c}.gen.{s}.falseabspct",
                fpct(r["false_abstention_rate"]),
                gen_path[c],
                f"{s}:false_abstention_rate",
                fl(r["false_abstention_rate"]),
            )
            nref = round(fl(r["correct_refusal_rate"]) * fl(r["n_unanswerable"]))
            N.put(
                f"{c}.gen.{s}.refusaln",
                str(nref),
                gen_path[c],
                f"{s}:correct_refusal_rate*n_unanswerable",
                nref,
            )
            N.put(
                f"{c}.gen.{s}.nanswered",
                fint(r["n_answered"]),
                gen_path[c],
                f"{s}:n_answered",
                fl(r["n_answered"]),
            )
            N.put(
                f"{c}.gen.{s}.ptok",
                fint(r["prompt_tokens_mean"]),
                gen_path[c],
                f"{s}:prompt_tokens_mean",
                fl(r["prompt_tokens_mean"]),
            )
            for col in (
                "abstained_synth_abstain",
                "abstained_guard_fail",
                "abstained_critic_abstain",
                "abstained_low_retrieval_score",
            ):
                N.put(
                    f"{c}.gen.{s}.{col.replace('abstained_', '').replace('_', '')}",
                    fint(r[col]),
                    gen_path[c],
                    f"{s}:{col}",
                    fl(r[col]),
                )
        n0 = next(iter(gen[c].values()))
        for col, k in (
            ("n_questions", "n"),
            ("n_answerable", "nans"),
            ("n_unanswerable", "nunans"),
        ):
            N.put(f"{c}.gen.{k}", fint(n0[col]), gen_path[c], f"G1:{col}", fl(n0[col]))

    # tracked bootstrap rows
    for c in COLLS:
        pb = COLLS[c]["results"] / "tables/generation_test_bootstrap.csv"
        for r in read_csv(pb):
            k = f"{c}.boot.{r['system']}-{r['reference']}.{BOOT_METRIC[r['metric']]}"
            N.put(
                k,
                fsigned(r["mean_diff"]),
                pb,
                f"{r['system']}-{r['reference']}:{r['metric']}:mean_diff",
                fl(r["mean_diff"]),
            )
            N.put(
                k + "ci",
                fci(r["ci_low"], r["ci_high"]),
                pb,
                f"{r['system']}-{r['reference']}:{r['metric']}:ci",
                [fl(r["ci_low"]), fl(r["ci_high"])],
            )
            N.put(
                k + "sig",
                sigword(r["ci_low"], r["ci_high"]),
                pb,
                f"{r['system']}-{r['reference']}:{r['metric']}:ci excludes 0",
                [fl(r["ci_low"]), fl(r["ci_high"])],
            )
            N.put(
                k + "n",
                fint(r["n"]),
                pb,
                f"{r['system']}-{r['reference']}:{r['metric']}:n",
                fl(r["n"]),
            )
        if c == "cs" and not cs_g2h_ready:
            for ref in ("G1", "G2"):
                for m in ("acc", "faith", "refusal"):
                    k = f"cs.boot.G2H-{ref}.{m}"
                    for suf in ("", "ci", "sig", "n"):
                        N.put(k + suf, PEND, pb, f"G2H-{ref}:{m} (pending)")

    dgen = local_or_snapshot(
        "derived_generation_bootstrap.csv", lambda: derived_generation_bootstrap(n_res, seed), notes
    )
    pdg = DATA / "derived_generation_bootstrap.csv"
    for r in dgen:
        k = f"{r['collection']}.boot.{r['system']}-{r['reference']}.{BOOT_METRIC[r['metric']]}"
        N.put(
            k,
            fsigned(r["mean_diff"]),
            pdg,
            f"{r['system']}-{r['reference']}:{r['metric']}:mean_diff",
            fl(r["mean_diff"]),
        )
        N.put(
            k + "ci",
            fci(r["ci_low"], r["ci_high"]),
            pdg,
            f"{r['system']}-{r['reference']}:{r['metric']}:ci",
            [fl(r["ci_low"]), fl(r["ci_high"])],
        )
        N.put(
            k + "sig",
            sigword(r["ci_low"], r["ci_high"]),
            pdg,
            f"{r['system']}-{r['reference']}:{r['metric']}:ci excludes 0",
            [fl(r["ci_low"]), fl(r["ci_high"])],
        )
        N.put(
            k + "n",
            fint(r["n"]),
            pdg,
            f"{r['system']}-{r['reference']}:{r['metric']}:n",
            fl(r["n"]),
        )

    rel_rows = local_or_snapshot(
        "released_faithfulness_bootstrap.csv",
        lambda: released_faithfulness_bootstrap(n_res, seed),
        notes,
    )
    prf = DATA / "released_faithfulness_bootstrap.csv"
    released: dict[tuple[str, str, str], dict[str, Any]] = {}
    for r in rel_rows:
        released[(r["collection"], r["system"], r["reference"])] = r
        k = f"{r['collection']}.rel.{r['system']}-{r['reference']}"
        N.put(
            k,
            fsigned(r["mean_diff"]),
            prf,
            f"{r['system']}-{r['reference']}:released_faithfulness:mean_diff",
            fl(r["mean_diff"]),
        )
        N.put(
            k + "ci",
            fci(r["ci_low"], r["ci_high"]),
            prf,
            f"{r['system']}-{r['reference']}:released_faithfulness:ci",
            [fl(r["ci_low"]), fl(r["ci_high"])],
        )
        N.put(
            k + "sig",
            sigword(r["ci_low"], r["ci_high"]),
            prf,
            f"{r['system']}-{r['reference']}:released_faithfulness:ci excludes 0",
            [fl(r["ci_low"]), fl(r["ci_high"])],
        )
        # the point estimate must equal the difference of the table's faithfulness values
        tab = fl(gen[r["collection"]][r["system"]]["faithfulness"]) - fl(
            gen[r["collection"]][r["reference"]]["faithfulness"]
        )
        if abs(tab - fl(r["mean_diff"])) > 1e-3:
            raise SystemExit(
                f"released faithfulness {k}: {r['mean_diff']} differs from the table difference {tab}"
            )

    # ---------------------------------------------------------------- re-analyses after the review
    ss = local_or_snapshot("sentence_stats.json", lambda: sentence_stats(n_res, seed), notes)
    pss = DATA / "sentence_stats.json"
    sent: dict[tuple[str, str], dict[str, Any]] = {}
    for r in ss["systems"]:
        c, s = r["collection"], r["system"]
        sent[(c, s)] = r
        N.put(
            f"{c}.sent.{s}.perans",
            f"{fl(r['sentences_per_answer']):.2f}",
            pss,
            f"systems[{c},{s}].sentences_per_answer",
            fl(r["sentences_per_answer"]),
        )
        N.put(
            f"{c}.sent.{s}.uncited",
            fnum(r["uncited_share"]),
            pss,
            f"systems[{c},{s}].uncited_share",
            fl(r["uncited_share"]),
        )
        N.put(
            f"{c}.sent.{s}.citedsup",
            fnum(r["cited_support"]),
            pss,
            f"systems[{c},{s}].cited_support",
            fl(r["cited_support"]),
        )
        N.put(
            f"{c}.sent.{s}.wrong",
            str(r["wrong_released"]),
            pss,
            f"systems[{c},{s}].wrong_released",
            r["wrong_released"],
        )
        N.put(
            f"{c}.sent.{s}.correct",
            str(r["correct_released"]),
            pss,
            f"systems[{c},{s}].correct_released",
            r["correct_released"],
        )
        N.put(
            f"{c}.sent.{s}.multi",
            str(r["multi_cited"]),
            pss,
            f"systems[{c},{s}].multi_cited",
            r["multi_cited"],
        )
        N.put(
            f"{c}.sent.{s}.n",
            str(r["sentences"]),
            pss,
            f"systems[{c},{s}].sentences",
            r["sentences"],
        )
    cited_boot: dict[tuple[str, str, str], dict[str, Any]] = {}
    for r in ss["bootstrap"]:
        cited_boot[(r["collection"], r["system"], r["reference"])] = r
        k = f"{r['collection']}.cit.{r['system']}-{r['reference']}"
        N.put(
            k,
            fsigned(r["mean_diff"]),
            pss,
            f"bootstrap[{r['collection']},{r['system']}-{r['reference']}].mean_diff",
            fl(r["mean_diff"]),
        )
        N.put(
            k + "ci",
            fci(r["ci_low"], r["ci_high"]),
            pss,
            f"bootstrap[{r['collection']},{r['system']}-{r['reference']}].ci",
            [fl(r["ci_low"]), fl(r["ci_high"])],
        )
        N.put(
            k + "sig",
            sigword(r["ci_low"], r["ci_high"]),
            pss,
            f"bootstrap[{r['collection']},{r['system']}-{r['reference']}]: ci excludes 0",
            [fl(r["ci_low"]), fl(r["ci_high"])],
        )
    if not cs_g2h_ready:
        for suf in ("", "ci", "sig"):
            N.put(f"cs.cit.G2H-G2{suf}", PEND, pss, "cs G2H (pending)")
            N.put(f"cs.rel.G2H-G2{suf}", PEND, prf, "cs G2H (pending)")
        for k in ("perans", "uncited", "citedsup", "wrong", "correct", "multi", "n"):
            N.put(f"cs.sent.G2H.{k}", PEND, pss, "cs G2H (pending)")

    prim = local_or_snapshot("primary_tests.csv", lambda: primary_tests(seed), notes)
    ppt = DATA / "primary_tests.csv"
    N.put("prim.m", str(len(prim)), ppt, "rows", len(prim))
    N.put("prim.nperm", fint(N_PERM), Path(__file__), "N_PERM", N_PERM)
    for r in prim:
        pid = r["id"]
        N.put(f"prim.{pid}.p", f"{fl(r['p']):.4f}", ppt, f"{pid}: p", fl(r["p"]))
        N.put(f"prim.{pid}.pholm", f"{fl(r['p_holm']):.4f}", ppt, f"{pid}: p_holm", fl(r["p_holm"]))
        N.put(
            f"prim.{pid}.holmsig",
            "significant" if fl(r["p_holm"]) < 0.05 else "not significant",
            ppt,
            f"{pid}: p_holm < 0.05",
            fl(r["p_holm"]),
        )
        if r["discordant"]:
            win, loss = r["discordant"].split("/")
            N.put(
                f"prim.{pid}.win",
                win,
                ppt,
                f"{pid}: discordant (system right, reference wrong)",
                None,
            )
            N.put(
                f"prim.{pid}.loss",
                loss,
                ppt,
                f"{pid}: discordant (system wrong, reference right)",
                None,
            )
    names = {
        "cov": "coverage@1024, structural $-$ naive",
        "G4-G2.rel": "released faithfulness, G4 $-$ G2",
        "G4-G2.acc": "overall accuracy, G4 $-$ G2",
        "G2H-G2.acc": "overall accuracy, G2H $-$ G2",
    }
    lines = [
        "\\begin{table*}[t]\n\\centering\\footnotesize\\setlength{\\tabcolsep}{5pt}",
        "\\begin{tabular}{@{}llrrrr@{}}\n\\toprule",
        "Coll. & Comparison & $\\Delta$ & $p$ & $p_{\\mathrm{Holm}}$ & Discord. \\\\ \\midrule",
    ]
    for r in prim:
        key = r["id"].split(".", 1)[1]
        lines.append(
            f"{SHORT_LABEL[r['collection']]} & {names[key]} & {fsigned(r['diff'])} & {fl(r['p']):.4f} & {fl(r['p_holm']):.4f} & {r['discordant'] or '--'} \\\\"
        )
    lines += [
        "\\bottomrule\n\\end{tabular}",
        f"\\caption{{Primary comparisons with paired permutation tests ({fint(N_PERM)} permutations) and Holm's correction across the {len(prim)} tests. "
        "This family was fixed after the first draft, as a robustness check of the bootstrap intervals. Discord.\\ = questions only the first system got right / only the second.}",
        "\\label{tab:primary}\n\\end{table*}\n",
    ]
    write_table("primary.tex", "\n".join(lines))

    sc = local_or_snapshot("strict_coverage.csv", lambda: strict_coverage(n_res, seed), notes)
    psc = DATA / "strict_coverage.csv"
    for r in sc:
        k = f"{r['collection']}.strict.{r['relevance']}"
        N.put(
            k + ".struct",
            fnum(r["structural"]),
            psc,
            f"{r['collection']},{r['relevance']}: structural",
            fl(r["structural"]),
        )
        N.put(
            k + ".naive",
            fnum(r["naive"]),
            psc,
            f"{r['collection']},{r['relevance']}: naive",
            fl(r["naive"]),
        )
        N.put(
            k + ".d",
            fsigned(r["mean_diff"]),
            psc,
            f"{r['collection']},{r['relevance']}: mean_diff",
            fl(r["mean_diff"]),
        )
        N.put(
            k + ".dci",
            fci(r["ci_low"], r["ci_high"]),
            psc,
            f"{r['collection']},{r['relevance']}: ci",
            [fl(r["ci_low"]), fl(r["ci_high"])],
        )
        N.put(
            k + ".dsig",
            sigword(r["ci_low"], r["ci_high"]),
            psc,
            f"{r['collection']},{r['relevance']}: ci excludes 0",
            [fl(r["ci_low"]), fl(r["ci_high"])],
        )

    cc = local_or_snapshot("coverage_correct.csv", coverage_vs_correct, notes)
    pcc = DATA / "coverage_correct.csv"
    for r in cc:
        k = f"{r['collection']}.cc.{r['system']}.{'all' if r['group'] == 'all_gold' else 'part'}"
        N.put(
            k,
            fnum(r["correct_rate"]),
            pcc,
            f"{r['collection']},{r['system']},{r['group']}: correct_rate",
            fl(r["correct_rate"]),
        )
        N.put(
            k + ".n",
            str(r["n"]),
            pcc,
            f"{r['collection']},{r['system']},{r['group']}: n",
            int(r["n"]),
        )

    # per-type correctness (appendix)
    lines = [
        "\\begin{table}[t]\n\\centering\\footnotesize\\setlength{\\tabcolsep}{2.5pt}",
        "\\begin{tabular}{@{}llrrrrr@{}}\n\\toprule",
        "Coll. & Type & $n$ & G1 & G2 & G4 & G2H \\\\ \\midrule",
    ]
    for ci_, c in enumerate(COLLS):
        bt = read_csv(COLLS[c]["results"] / "tables/generation_test_by_type.csv")
        types = sorted({r["type"] for r in bt if r["type"] != "unanswerable"})
        for i, t in enumerate(types):
            cells = []
            n_t = ""
            for s in ("G1", "G2", "G4", "G2H"):
                r = next((x for x in bt if x["system"] == s and x["type"] == t), None)
                cells.append(
                    PENDC
                    if r is None and c == "cs" and s == "G2H"
                    else ("--" if r is None else fnum(r["correct_rate_answerable"]))
                )
                if r is not None:
                    n_t = r["n_answerable"]
            lines.append(
                f"{SHORT_LABEL[c] if i == 0 else ''} & {t.replace('_', '-')} & {n_t} & {' & '.join(cells)} \\\\"
            )
        if ci_ == 0:
            lines.append("\\midrule")
    lines += [
        "\\bottomrule\n\\end{tabular}",
        "\\caption{Share of answerable test questions answered correctly, by question type (from the pipeline's by-type tables). Types: definition, factual, procedural, numeric, "
        "cross-reference (the answer needs a provision the source refers to) and multi-section (the answer needs two provisions). Cells are small; read them as descriptive.}",
        "\\label{tab:pertype}\n\\end{table}\n",
    ]
    write_table("pertype.tex", "\n".join(lines))

    # generation table
    def gcell(c: str, s: str, col: str) -> str:
        if col in ("uncited_share", "cited_support", "wrong_released"):
            r2 = sent.get((c, s))
            if r2 is None:
                return PENDC
            return str(r2[col]) if col == "wrong_released" else fnum(r2[col])
        r = gen[c].get(s)
        if r is None:
            return PENDC
        return fnum(r[col]) if col != "llm_calls_mean" else fnum(r[col], 2)

    cols = [
        ("answered_rate", "Ans."),
        ("faithfulness", "Faith."),
        ("uncited_share", "Uncit."),
        ("cited_support", "Sup."),
        ("correct_rate_answered", "Corr."),
        ("overall_accuracy", "Overall"),
        ("wrong_released", "Wrong"),
        ("correct_refusal_rate", "Refusal"),
        ("false_abstention_rate", r"F.\,abst."),
        ("llm_calls_mean", "Calls"),
    ]
    lines = [
        "\\begin{table*}[t]\n\\centering\\footnotesize\\setlength{\\tabcolsep}{3.6pt}",
        "\\begin{tabular}{@{}ll" + "r" * len(cols) + "r@{}}\n\\toprule",
        "Coll. & Sys. & " + " & ".join(h for _, h in cols) + " & p50 s \\\\ \\midrule",
    ]
    for ci_, c in enumerate(COLLS):
        systems = [s for s in SYSTEMS if s in gen[c] or (c == "cs" and s == "G2H")]
        for i, s in enumerate(systems):
            r = gen[c].get(s)
            p50 = PENDC if r is None else f"{fl(r['latency_p50_ms']) / 1000:.1f}"
            lines.append(
                f"{COLLS[c]['label'] if i == 0 else ''} & {s} & "
                + " & ".join(gcell(c, s, col) for col, _ in cols)
                + f" & {p50} \\\\"
            )
        if ci_ == 0:
            lines.append("\\midrule")
    lines += [
        "\\bottomrule\n\\end{tabular}",
        "\\caption{Answer quality on the test split. G1 naive RAG (Fix-512, dense-b); G2 dev-best structural retrieval; G3 = G2 + guards; G4 = G2 + guards + critic; "
        "G5 = G4 + dev-tuned score threshold; G6 = Fix-256 hybrid with reranking, guards and critic; G2H = G2 with gpt-oss-120b (others: qwen2.5:3b). "
        "Ans.\\ = share answered; Faith.\\ = released-answer faithfulness, split into Uncit.\\ (share of released sentences without a citation) and Sup.\\ (NLI support of cited sentences); "
        "Corr.\\ = correct among answered answerable questions; Wrong = released answers judged incorrect; F.\\,abst.\\ = false abstention; Calls above one are JSON-repair retries; "
        "p50 s = median latency. Metrics: \\S\\ref{sec:setup}; citation precision and recall: Table~\\ref{tab:genextra}.}",
        "\\label{tab:generation}\n\\end{table*}\n",
    ]
    write_table("generation_test.tex", "\n".join(lines))

    # further answer metrics (appendix)
    xcols = [
        ("citation_precision", "Cit.\\,P"),
        ("citation_recall", "Cit.\\,R"),
        ("correct_and_faithful_rate", "Corr.\\,\\&\\,faith."),
        ("answers_with_unsupported_share", "Unsup.\\,ans."),
        ("abstention_precision", "Abst.\\,P"),
        ("abstention_recall", "Abst.\\,R"),
        ("abstention_f1", "Abst.\\,F1"),
        ("prompt_tokens_mean", "Prompt tok."),
    ]
    lines = [
        "\\begin{table*}[t]\n\\centering\\footnotesize\\setlength{\\tabcolsep}{4pt}",
        "\\begin{tabular}{@{}ll" + "r" * len(xcols) + "@{}}\n\\toprule",
        "Coll. & Sys. & " + " & ".join(h for _, h in xcols) + " \\\\ \\midrule",
    ]
    for ci_, c in enumerate(COLLS):
        systems = [s for s in SYSTEMS if s in gen[c] or (c == "cs" and s == "G2H")]
        for i, s in enumerate(systems):
            r = gen[c].get(s)
            cells = [
                PENDC
                if r is None
                else (fint(r[col]) if col == "prompt_tokens_mean" else fnum(r[col]))
                for col, _ in xcols
            ]
            lines.append(
                f"{SHORT_LABEL[c] if i == 0 else ''} & {s} & " + " & ".join(cells) + " \\\\"
            )
        if ci_ == 0:
            lines.append("\\midrule")
    lines += [
        "\\bottomrule\n\\end{tabular}",
        "\\caption{Further answer metrics on the test split. Citation precision = share of cited passages relevant to a gold provision (retrieval relevance, not NLI); "
        "citation recall = share of gold provisions covered by the cited passages (both over answered answerable questions). Corr.\\,\\&\\,faith.\\ = correct with every sentence supported "
        "(over answerable questions); Unsup.\\,ans.\\ = share of released answers with at least one unsupported sentence; Abst.\\,P/R/F1 = abstention precision, recall and F1 with "
        "unanswerable as the positive class; Prompt tok.\\ = mean prompt tokens per question.}",
        "\\label{tab:genextra}\n\\end{table*}\n",
    ]
    write_table("generation_extra.tex", "\n".join(lines))

    # bootstrap table (key comparisons)
    boot_all: dict[tuple[str, str, str, str], dict[str, Any]] = {}
    for c in COLLS:
        for r in read_csv(COLLS[c]["results"] / "tables/generation_test_bootstrap.csv"):
            boot_all[(c, r["system"], r["reference"], r["metric"])] = r
    for r in dgen:
        boot_all[(r["collection"], r["system"], r["reference"], r["metric"])] = r
    comps = [
        ("G2", "G1", "retrieval"),
        ("G4", "G1", "full vs naive"),
        ("G3", "G2", "guards"),
        ("G4", "G3", "critic loop"),
        ("G4", "G2", "guards + critic"),
        ("G5", "G4", "threshold"),
        ("G6", "G4", "retrieval"),
        ("G2H", "G2", "generator"),
    ]
    lines = [
        "\\begin{table*}[t]\n\\centering\\footnotesize\\setlength{\\tabcolsep}{1.8pt}",
        "\\begin{tabular}{@{}lllrrrrr@{}}\n\\toprule",
        " & & & \\multicolumn{3}{c}{$\\Delta$ Faithfulness} & & \\\\ \\cmidrule(lr){4-6}",
        "Coll. & Comparison & Isolates & Both answered & $n$ & Released & $\\Delta$ Accuracy & $\\Delta$ Refusal \\\\ \\midrule",
    ]

    def two_line(r: dict[str, Any]) -> str:
        top, bottom = fsigned(r["mean_diff"]), fci(r["ci_low"], r["ci_high"])
        if fl(r["ci_low"]) > 0 or fl(r["ci_high"]) < 0:
            top, bottom = f"\\textbf{{{top}}}", f"\\textbf{{{bottom}}}"
        return f"\\makecell[r]{{{top}\\\\{{{bottom}}}}}"

    def rcell(c: str, s: str, ref: str) -> str:
        r = released.get((c, s, ref))
        if r is None:
            return PENDC if (c == "cs" and s == "G2H") else "--"
        return two_line(r)

    def bcell(c: str, s: str, ref: str, metric: str) -> str:
        r = boot_all.get((c, s, ref, metric))
        if r is None:
            return PENDC if (c == "cs" and s == "G2H") else "--"
        return two_line(r)

    def ncell(c: str, s: str, ref: str) -> str:
        r = boot_all.get((c, s, ref, "faithfulness"))
        return fint(r["n"]) if r is not None else PENDC

    for ci_, c in enumerate(COLLS):
        first = True
        for s, ref, what in comps:
            if not ((c, s, ref, "faithfulness") in boot_all or (c == "cs" and s == "G2H")):
                continue
            lines.append(
                f"{COLLS[c]['label'] if first else ''} & {s}$-${ref} & {what} & {bcell(c, s, ref, 'faithfulness')} & {ncell(c, s, ref)} & {rcell(c, s, ref)} & {bcell(c, s, ref, 'overall_accuracy')} & {bcell(c, s, ref, 'correct_refusal_rate')} \\\\[2pt]"
            )
            first = False
        if ci_ == 0:
            lines.append("\\midrule")
    lines += [
        "\\bottomrule\n\\end{tabular}",
        "\\caption{Paired bootstrap differences on the test split (\\V{boot.n} resamples, seed \\V{boot.seed}, 95\\% percentile intervals). "
        "``Answered by both'' compares faithfulness on the $n$ questions both systems answered (the pipeline's paired test); ``Released answers'' compares each system's "
        "faithfulness over the answers it releases, resampling questions, so withholding an unsupported answer counts. Overall accuracy is compared on all questions, "
        "correct refusal on the unanswerable questions. Bold = interval excludes 0. Paired rows against G1, and G2H$-$G2, come from the pipeline's result tables; "
        "the others were computed from the same per-question records (\\texttt{scripts/paper\\_tables.py}).}",
        "\\label{tab:bootstrap-full}\n\\end{table*}\n",
    ]
    write_table("bootstrap.tex", "\n".join(lines))

    # compact version for the main text
    compact = [
        ("G2", "G1", "retrieval"),
        ("G3", "G2", "guards"),
        ("G4", "G2", "guards + critic"),
        ("G4", "G3", "critic loop"),
        ("G5", "G4", "threshold"),
        ("G2H", "G2", "generator, budget"),
    ]

    def ccell(c: str, s: str, ref: str) -> str:
        r = cited_boot.get((c, s, ref))
        if r is None:
            return PENDC if (c == "cs" and s == "G2H") else "--"
        return two_line(r)

    lines = [
        "\\begin{table}[t]\n\\centering\\scriptsize\\setlength{\\tabcolsep}{2.2pt}",
        "\\begin{tabular}{@{}lrrr@{}}\n\\toprule",
        "\\makecell[l]{Comparison\\\\(isolates)} & \\makecell[r]{$\\Delta$ Released\\\\faithfulness} & \\makecell[r]{$\\Delta$ Support of\\\\cited sentences} & \\makecell[r]{$\\Delta$ Overall\\\\accuracy} \\\\ \\midrule",
    ]
    for ci_, c in enumerate(COLLS):
        lines.append(f"\\multicolumn{{4}}{{@{{}}l}}{{\\emph{{{COLLS[c]['label']}}}}} \\\\")
        for s, ref, what in compact:
            if not ((c, s, ref, "faithfulness") in boot_all or (c == "cs" and s == "G2H")):
                continue
            lines.append(
                f"\\makecell[l]{{{s}$-${ref}\\\\{{{what}}}}} & {rcell(c, s, ref)} & {ccell(c, s, ref)} & {bcell(c, s, ref, 'overall_accuracy')} \\\\[1pt]"
            )
        if ci_ == 0:
            lines.append("\\midrule")
    lines += [
        "\\bottomrule\n\\end{tabular}",
        "\\caption{Main paired differences on the test split with 95\\% bootstrap intervals (\\V{boot.n} resamples over questions). "
        "Released faithfulness = faithfulness over the answers each system releases (uncited sentences count as unsupported); support of cited sentences = NLI support among "
        "released sentences that carry a citation. Bold = interval excludes 0; an interval with a bound at 0.000 counts as including 0. "
        "Table~\\ref{tab:bootstrap-full} adds faithfulness on jointly answered questions, correct refusal and further pairs.}",
        "\\label{tab:bootstrap}\n\\end{table}\n",
    ]
    write_table("bootstrap_compact.tex", "\n".join(lines))

    # ---------------------------------------------------------------- generation settings and abstention
    gmeta_p = COLLS["cl"]["results"] / "tables/generation_test.meta.json"
    gmeta = json.loads(gmeta_p.read_text(encoding="utf-8"))
    st = gmeta["settings"]
    N.put(
        "gen.budget",
        fint(st["context"]["budget_tokens"]),
        gmeta_p,
        "settings.context.budget_tokens",
        st["context"]["budget_tokens"],
    )
    N.put(
        "gen.revbudget",
        fint(st["context"]["revision_budget_tokens"]),
        gmeta_p,
        "settings.context.revision_budget_tokens",
        st["context"]["revision_budget_tokens"],
    )
    N.put(
        "gen.maxsynth",
        str(st["loop"]["max_synth_calls"]),
        gmeta_p,
        "settings.loop.max_synth_calls",
        st["loop"]["max_synth_calls"],
    )
    N.put(
        "gen.maxcritic",
        str(st["loop"]["max_critic_calls"]),
        gmeta_p,
        "settings.loop.max_critic_calls",
        st["loop"]["max_critic_calls"],
    )
    N.put(
        "gen.temp",
        fnum(st["llm_overrides"]["temperature"], 1),
        gmeta_p,
        "settings.llm_overrides.temperature",
        st["llm_overrides"]["temperature"],
    )
    N.put(
        "gen.maxtok",
        fint(st["llm_overrides"]["max_tokens"]),
        gmeta_p,
        "settings.llm_overrides.max_tokens",
        st["llm_overrides"]["max_tokens"],
    )
    N.put(
        "gen.ctxwin",
        fint(st["llm_context_window"]),
        gmeta_p,
        "settings.llm_context_window",
        st["llm_context_window"],
    )
    nli = gmeta["nli"]
    N.put("nli.model", tex_escape(nli["model"]), gmeta_p, "nli.model", nli["model"])
    N.put(
        "nli.thr",
        fnum(nli["entailment_threshold"], 1),
        gmeta_p,
        "nli.entailment_threshold",
        nli["entailment_threshold"],
    )
    N.put("nli.win", fint(nli["window_tokens"]), gmeta_p, "nli.window_tokens", nli["window_tokens"])
    N.put(
        "nli.stride", fint(nli["window_stride"]), gmeta_p, "nli.window_stride", nli["window_stride"]
    )
    ab = gmeta["abstention_threshold"]
    N.put(
        "abs.thr", fnum(ab["threshold"]), gmeta_p, "abstention_threshold.threshold", ab["threshold"]
    )
    N.put(
        "abs.devp",
        fnum(ab["dev"]["precision"]),
        gmeta_p,
        "abstention_threshold.dev.precision",
        ab["dev"]["precision"],
    )
    N.put(
        "abs.devr",
        fnum(ab["dev"]["recall"]),
        gmeta_p,
        "abstention_threshold.dev.recall",
        ab["dev"]["recall"],
    )
    N.put(
        "abs.devf1", fnum(ab["dev"]["f1"]), gmeta_p, "abstention_threshold.dev.f1", ab["dev"]["f1"]
    )
    N.put("abs.devn", fint(ab["n"]), gmeta_p, "abstention_threshold.n", ab["n"])
    N.put(
        "abs.devu",
        fint(ab["n_unanswerable"]),
        gmeta_p,
        "abstention_threshold.n_unanswerable",
        ab["n_unanswerable"],
    )
    N.put(
        "abs.devabst",
        fint(ab["dev"]["n_abstained"]),
        gmeta_p,
        "abstention_threshold.dev.n_abstained",
        ab["dev"]["n_abstained"],
    )

    ab_meta_p = COLLS["cl"]["results"] / "tables/generation_test_ablation.meta.json"
    abm = json.loads(ab_meta_p.read_text(encoding="utf-8"))
    ctx_h = abm["context"]["G2H"]
    llm_h = abm["llm"]["G2H"]
    N.put(
        "h.model",
        tex_escape(abm["backend"]["model"].split("/")[-1]),
        ab_meta_p,
        "backend.model",
        abm["backend"]["model"],
    )
    N.put(
        "h.provider",
        tex_escape(abm["backend"]["provider"]),
        ab_meta_p,
        "backend.provider",
        abm["backend"]["provider"],
    )
    N.put(
        "h.date",
        abm["backend"]["model_selected_on"],
        ab_meta_p,
        "backend.model_selected_on",
        abm["backend"]["model_selected_on"],
    )
    N.put(
        "h.budget",
        fint(ctx_h["budget_tokens"]),
        ab_meta_p,
        "context.G2H.budget_tokens",
        ctx_h["budget_tokens"],
    )
    N.put(
        "h.revbudget",
        fint(ctx_h["revision_budget_tokens"]),
        ab_meta_p,
        "context.G2H.revision_budget_tokens",
        ctx_h["revision_budget_tokens"],
    )
    N.put(
        "h.temp",
        fnum(llm_h["temperature"], 1),
        ab_meta_p,
        "llm.G2H.temperature",
        llm_h["temperature"],
    )
    N.put(
        "h.maxtok", fint(llm_h["max_tokens"]), ab_meta_p, "llm.G2H.max_tokens", llm_h["max_tokens"]
    )
    N.put(
        "h.effort",
        llm_h["extra_body"]["reasoning_effort"],
        ab_meta_p,
        "llm.G2H.extra_body.reasoning_effort",
        llm_h["extra_body"]["reasoning_effort"],
    )
    cost = abm["cost"]["G2H"]
    N.put(
        "h.apip50",
        fint(cost["api_latency_ms_p50"]),
        ab_meta_p,
        "cost.G2H.api_latency_ms_p50",
        cost["api_latency_ms_p50"],
    )
    N.put(
        "h.apip95",
        fint(cost["api_latency_ms_p95"]),
        ab_meta_p,
        "cost.G2H.api_latency_ms_p95",
        cost["api_latency_ms_p95"],
    )
    N.put(
        "h.apimean",
        fint(cost["api_latency_ms_mean"]),
        ab_meta_p,
        "cost.G2H.api_latency_ms_mean",
        cost["api_latency_ms_mean"],
    )
    N.put("h.calls", fint(cost["llm_calls"]), ab_meta_p, "cost.G2H.llm_calls", cost["llm_calls"])
    ptk = cost["prompt_tokens"] / cost["llm_calls"]
    ctk = cost["completion_tokens"] / cost["llm_calls"]
    N.put("h.ptok", fint(ptk), ab_meta_p, "cost.G2H.prompt_tokens/llm_calls", ptk)
    N.put("h.ctok", fint(ctk), ab_meta_p, "cost.G2H.completion_tokens/llm_calls", ctk)

    # CS/AI G2H progress and the cost of finishing it
    cs_g2h_pq = COLLS["cs"]["results"] / "generation/test/G2H/per_question.jsonl"
    done = len(read_jsonl(cs_g2h_pq)) if cs_g2h_pq.exists() else None
    if done is not None:
        N.put("cs.g2h.done", str(done), cs_g2h_pq, "lines", done)
    llm_yaml = ROOT / "configs/llm.yaml"
    N.put(
        "h.tpd",
        fint(llm_cfg["backends"]["hosted"]["tokens_per_day"]),
        llm_yaml,
        "backends.hosted.tokens_per_day",
        llm_cfg["backends"]["hosted"]["tokens_per_day"],
    )

    # selective-prediction curves
    curve = local_or_snapshot("selective_curve.csv", selective_curves, notes)
    pcur = DATA / "selective_curve.csv"
    g4 = [
        r
        for r in curve
        if r["collection"] == "cl" and r["system"] == "G4" and r["threshold"] not in ("", None)
    ]
    t = float(ab["threshold"])
    at = [r for r in g4 if float(r["threshold"]) >= t - 1e-9]
    if at:
        pt = min(at, key=lambda r: float(r["threshold"]))
        N.put(
            "sel.g5cov",
            fnum(pt["coverage"]),
            pcur,
            "cl G4 at the dev threshold: coverage",
            fl(pt["coverage"]),
        )
        N.put(
            "sel.g5acc",
            fnum(pt["accuracy_answered"]),
            pcur,
            "cl G4 at the dev threshold: accuracy_answered",
            fl(pt["accuracy_answered"]),
        )
    for c in COLLS:
        for s in ("G2", "G4"):
            full = next(
                r
                for r in curve
                if r["collection"] == c and r["system"] == s and r["threshold"] in ("", None)
            )
            N.put(
                f"{c}.sel.{s}.acc0",
                fnum(full["accuracy_answered"]),
                pcur,
                f"{c} {s} no threshold: accuracy_answered",
                fl(full["accuracy_answered"]),
            )
            pts = [
                r
                for r in curve
                if r["collection"] == c
                and r["system"] == s
                and r["accuracy_answered"] not in ("", None)
            ]
            half = [r for r in pts if fl(r["coverage"]) >= 0.5 * fl(full["coverage"])]
            if half:
                best = max(half, key=lambda r: fl(r["accuracy_answered"]))
                N.put(
                    f"{c}.sel.{s}.besthalf",
                    fnum(best["accuracy_answered"]),
                    pcur,
                    f"{c} {s}: max accuracy_answered at >= half the unthresholded coverage",
                    fl(best["accuracy_answered"]),
                )
        # matched coverage: G2 with a score threshold at (the first point not below) G4's coverage
        g4full = next(
            r
            for r in curve
            if r["collection"] == c and r["system"] == "G4" and r["threshold"] in ("", None)
        )
        g2pts = sorted(
            (
                r
                for r in curve
                if r["collection"] == c
                and r["system"] == "G2"
                and r["accuracy_answered"] not in ("", None)
            ),
            key=lambda r: fl(r["coverage"]),
        )
        match = next((r for r in g2pts if fl(r["coverage"]) >= fl(g4full["coverage"]) - 1e-9), None)
        if match is not None:
            N.put(
                f"{c}.sel.G2.atG4",
                fnum(match["accuracy_answered"]),
                pcur,
                f"{c} G2 at the first threshold whose coverage >= G4's: accuracy_answered",
                fl(match["accuracy_answered"]),
            )
            N.put(
                f"{c}.sel.G2.atG4cov",
                fnum(match["coverage"]),
                pcur,
                f"{c} G2 at that threshold: coverage",
                fl(match["coverage"]),
            )
        N.put(
            f"{c}.sel.G4.cov0",
            fnum(g4full["coverage"]),
            pcur,
            f"{c} G4 no threshold: coverage",
            fl(g4full["coverage"]),
        )

    # ---------------------------------------------------------------- latency
    rl = local_or_snapshot("research_latency.json", research_latency, notes)
    prl = DATA / "research_latency.json"
    for key, v in rl.items():
        c, s = key.split(".")
        N.put(
            f"{c}.lat.{s}.ret",
            fint(v["retrieval_mean_ms"]),
            prl,
            f"{key}.retrieval_mean_ms",
            v["retrieval_mean_ms"],
        )
        N.put(
            f"{c}.lat.{s}.synth",
            f"{v['synthesis_mean_ms'] / 1000:.1f}",
            prl,
            f"{key}.synthesis_mean_ms/1000",
            v["synthesis_mean_ms"],
        )
        N.put(
            f"{c}.lat.{s}.critic",
            f"{v['critic_mean_ms'] / 1000:.1f}",
            prl,
            f"{key}.critic_mean_ms/1000",
            v["critic_mean_ms"],
        )
        N.put(
            f"{c}.lat.{s}.e2e",
            f"{v['e2e_mean_ms'] / 1000:.1f}",
            prl,
            f"{key}.e2e_mean_ms/1000",
            v["e2e_mean_ms"],
        )

    wl_p = DATA / "web_latency.json"
    wl = json.loads(wl_p.read_text(encoding="utf-8"))
    N.put(
        "web.cold",
        f"{wl['cold_load_ms'] / 1000:.1f}",
        wl_p,
        "cold_load_ms/1000",
        wl["cold_load_ms"],
    )
    N.put(
        "web.warm",
        f"{wl['warm_load_ms'] / 1000:.1f}",
        wl_p,
        "warm_load_ms/1000",
        wl["warm_load_ms"],
    )
    N.put(
        "web.coldmb",
        f"{wl['cold_load_bytes_received'] / 1e6:.0f}",
        wl_p,
        "cold_load_bytes_received/1e6",
        wl["cold_load_bytes_received"],
    )
    N.put("web.nq", fint(wl["n_questions"]), wl_p, "n_questions", wl["n_questions"])
    for st_ in ("embed", "search", "embed_plus_search"):
        k = st_.replace("_plus_", "")
        for q in ("p50", "p95", "mean"):
            N.put(
                f"web.{k}.{q}", fint(wl[f"{st_}_ms"][q]), wl_p, f"{st_}_ms.{q}", wl[f"{st_}_ms"][q]
            )
    N.put("web.browser", tex_escape(wl["browser"].split(" (")[0]), wl_p, "browser", wl["browser"])

    lh_p = ROOT / "docs/lighthouse.json"
    lh = json.loads(lh_p.read_text(encoding="utf-8"))
    for cat, k in (
        ("Performance", "perf"),
        ("Accessibility", "a11y"),
        ("Best Practices", "bp"),
        ("SEO", "seo"),
    ):
        N.put(f"lh.{k}", str(lh["scores"][cat]), lh_p, f"scores.{cat}", lh["scores"][cat])
    for met, k in (
        ("First Contentful Paint", "fcp"),
        ("Largest Contentful Paint", "lcp"),
        ("Total Blocking Time", "tbt"),
        ("Cumulative Layout Shift", "cls"),
        ("Speed Index", "si"),
    ):
        N.put(f"lh.{k}", tex_escape(lh["metrics"][met]), lh_p, f"metrics.{met}", lh["metrics"][met])
    N.put("lh.version", lh["lighthouseVersion"], lh_p, "lighthouseVersion", lh["lighthouseVersion"])

    wr_p = ROOT / "deploy/worker/wrangler.jsonc"
    wr = json.loads(re.sub(r"(?m)^\s*//.*$", "", wr_p.read_text(encoding="utf-8")))
    for var, k in (
        ("LIMIT_PER_10MIN", "per10"),
        ("LIMIT_PER_DAY", "perday"),
        ("GLOBAL_PER_DAY", "global"),
        ("MAX_OUTPUT_TOKENS", "maxout"),
    ):
        N.put(f"wk.{k}", fint(wr["vars"][var]), wr_p, f"vars.{var}", wr["vars"][var])
    N.put(
        "wk.model",
        tex_escape(wr["vars"]["LLM_MODEL"].split("/")[-1]),
        wr_p,
        "vars.LLM_MODEL",
        wr["vars"]["LLM_MODEL"],
    )
    cs_ground = man_by["cs_ai"]["grounded"]
    N.put(
        "web.budget",
        fint(cs_ground["budget_tokens"]),
        man_path,
        "collections[cs_ai].grounded.budget_tokens",
        cs_ground["budget_tokens"],
    )
    N.put(
        "web.revbudget",
        fint(cs_ground["revision_budget_tokens"]),
        man_path,
        "collections[cs_ai].grounded.revision_budget_tokens",
        cs_ground["revision_budget_tokens"],
    )

    # deployment table
    lines = [
        "\\begin{table}[t]\n\\centering\\footnotesize\\setlength{\\tabcolsep}{2pt}",
        "\\begin{tabular}{@{}lr@{}}\n\\toprule",
        "Quantity & Value \\\\ \\midrule",
        f"Passages in the library ({len(man['collections'])} collections) & {fint(total_passages)} \\\\",
        f"int8 vectors (gzip) & {vec_gz / 1e6:.2f} MB \\\\",
        f"Passage text (gzip) & {txt_gz / 1e6:.2f} MB \\\\",
        f"Cold load: bytes received (uncompressed) & {wl['cold_load_bytes_received'] / 1e6:.0f} MB \\\\",
        f"Cold load to ready, localhost & {wl['cold_load_ms'] / 1000:.1f} s \\\\",
        f"Warm load to ready (Cache API) & {wl['warm_load_ms'] / 1000:.1f} s \\\\",
        f"Query embedding, p50 / p95 & {fint(wl['embed_ms']['p50'])} / {fint(wl['embed_ms']['p95'])} ms \\\\",
        f"int8 search, all indexes, p50 / p95 & {fint(wl['search_ms']['p50'])} / {fint(wl['search_ms']['p95'])} ms \\\\",
        f"Hosted LLM call, p50 / p95 (API) & {fint(cost['api_latency_ms_p50'])} / {fint(cost['api_latency_ms_p95'])} ms \\\\",
        f"Lighthouse mobile: P / A / BP / SEO & {lh['scores']['Performance']}/{lh['scores']['Accessibility']}/{lh['scores']['Best Practices']}/{lh['scores']['SEO']} \\\\",
        "\\bottomrule\n\\end{tabular}",
        "\\caption{Deployment measurements. Browser stages: Chromium (Playwright, headless) on the laptop of Appendix~\\ref{app:repro}, "
        "\\V{web.nq} dev questions, local static server without throttling. LLM call: API latency of the \\V{h.calls} hosted calls of the G2H evaluation "
        "(same model and provider as the Worker, called directly).}",
        "\\label{tab:deploy}\n\\end{table}\n",
    ]
    write_table("deploy.tex", "\n".join(lines))

    # ---------------------------------------------------------------- hyperparameters (appendix)
    ccfg_p = ROOT / "configs/chunking.yaml"
    ccfg = yaml.safe_load(ccfg_p.read_text(encoding="utf-8"))
    fx = {f["name"]: f for f in ccfg["fixed"]}
    for name in ("fixed_256", "fixed_512"):
        N.put(
            f"ch.{name.replace('_', '')}.ov",
            str(fx[name]["overlap"]),
            ccfg_p,
            f"fixed[{name}].overlap",
            fx[name]["overlap"],
        )
        N.put(
            f"ch.{name.replace('_', '')}.size",
            str(fx[name]["size"]),
            ccfg_p,
            f"fixed[{name}].size",
            fx[name]["size"],
        )
    N.put(
        "ret.budgets",
        ", ".join(str(b) for b in rcfg["eval"]["budgets"]),
        rcfg_path,
        "eval.budgets",
        rcfg["eval"]["budgets"],
    )
    N.put(
        "ret.ks",
        ", ".join(str(k) for k in rcfg["eval"]["ks"]),
        rcfg_path,
        "eval.ks",
        rcfg["eval"]["ks"],
    )
    N.put(
        "ch.struct.max",
        str(ccfg["structural"]["max_tokens"]),
        ccfg_p,
        "structural.max_tokens",
        ccfg["structural"]["max_tokens"],
    )
    N.put(
        "ch.struct.min",
        str(ccfg["structural"]["min_tokens"]),
        ccfg_p,
        "structural.min_tokens",
        ccfg["structural"]["min_tokens"],
    )
    N.put(
        "ch.sem.pct",
        f"{ccfg['semantic']['breakpoint_percentile']:.0f}",
        ccfg_p,
        "semantic.breakpoint_percentile",
        ccfg["semantic"]["breakpoint_percentile"],
    )
    N.put(
        "ch.sem.min",
        str(ccfg["semantic"]["min_tokens"]),
        ccfg_p,
        "semantic.min_tokens",
        ccfg["semantic"]["min_tokens"],
    )
    N.put(
        "ch.sem.max",
        str(ccfg["semantic"]["max_tokens"]),
        ccfg_p,
        "semantic.max_tokens",
        ccfg["semantic"]["max_tokens"],
    )
    d = rcfg["defaults"]
    for k_, key in (
        ("first_stage_k", "fsk"),
        ("final_k", "finalk"),
        ("rrf_k", "rrfk"),
        ("rerank_n", "rerankn"),
        ("xref_top_m", "xrefm"),
        ("xref_max_added", "xrefmax"),
    ):
        N.put(f"ret.{key}", str(d[k_]), rcfg_path, f"defaults.{k_}", d[k_])
    N.put("ret.alpha", fnum(d["alpha"], 1), rcfg_path, "defaults.alpha", d["alpha"])
    N.put("ret.k1", fnum(d["bm25_k1"], 1), rcfg_path, "defaults.bm25_k1", d["bm25_k1"])
    N.put("ret.b", fnum(d["bm25_b"], 2), rcfg_path, "defaults.bm25_b", d["bm25_b"])
    dev_cl = read_csv(COLLS["cl"]["results"] / "tables/retrieval_dev.csv")
    dev_cs = read_csv(COLLS["cs"]["results"] / "tables/retrieval_dev.csv")
    N.put(
        "cl.grid.n",
        str(len(dev_cl)),
        COLLS["cl"]["results"] / "tables/retrieval_dev.csv",
        "rows",
        len(dev_cl),
    )
    N.put(
        "cs.grid.n",
        str(len(dev_cs)),
        COLLS["cs"]["results"] / "tables/retrieval_dev.csv",
        "rows",
        len(dev_cs),
    )
    lines = [
        "\\begin{table}[t]\n\\centering\\footnotesize\\setlength{\\tabcolsep}{2pt}",
        "\\begin{tabular}{@{}lr@{}}\n\\toprule",
        "Setting & Value \\\\ \\midrule",
        "\\multicolumn{2}{@{}l}{\\emph{Chunking}} \\\\",
        f"Fixed windows: size / overlap (tokens) & {fx['fixed_256']['size']} / {fx['fixed_256']['overlap']}, {fx['fixed_512']['size']} / {fx['fixed_512']['overlap']} \\\\",
        f"Structural: split above / merge below & {ccfg['structural']['max_tokens']} / {ccfg['structural']['min_tokens']} \\\\",
        f"Semantic: percentile; limits & {ccfg['semantic']['breakpoint_percentile']:.0f}; {ccfg['semantic']['min_tokens']}--{ccfg['semantic']['max_tokens']} \\\\",
        "\\multicolumn{2}{@{}l}{\\emph{Retrieval}} \\\\",
        f"BM25 $k_1$ / $b$ & {d['bm25_k1']} / {d['bm25_b']} \\\\",
        f"RRF $k$; linear fusion $\\alpha$ & {d['rrf_k']}; {d['alpha']} \\\\",
        f"Depth: first stage; rerank; final & {d['first_stage_k']}; {d['rerank_n']}; {d['final_k']} \\\\",
        f"Xref expansion: sources / added &{d['xref_top_m']} / {d['xref_max_added']} \\\\",
        f"Dev grid size (consumer law / CS/AI) & {len(dev_cl)} / {len(dev_cs)} \\\\",
        "\\multicolumn{2}{@{}l}{\\emph{Generation}} \\\\",
        f"Budget, local: round 1 / revision & {st['context']['budget_tokens']} / {st['context']['revision_budget_tokens']} \\\\",
        f"Budget, hosted: round 1 / revision & {ctx_h['budget_tokens']} / {ctx_h['revision_budget_tokens']} \\\\",
        f"Max synthesizer / critic calls & {st['loop']['max_synth_calls']} / {st['loop']['max_critic_calls']} \\\\",
        f"Local: temp.; max tokens; context & {st['llm_overrides']['temperature']}; {st['llm_overrides']['max_tokens']}; {st['llm_context_window']} \\\\",
        f"Hosted: temp.; max tokens; reasoning & {llm_h['temperature']}; {llm_h['max_tokens']}; {llm_h['extra_body']['reasoning_effort']} \\\\",
        f"Score threshold (G5, tuned on dev) & {ab['threshold']:.3f} \\\\",
        "\\multicolumn{2}{@{}l}{\\emph{Evaluation}} \\\\",
        f"NLI entailment threshold; window / stride & {nli['entailment_threshold']}; {nli['window_tokens']} / {nli['window_stride']} \\\\",
        f"Bootstrap resamples; seed & {n_res}; {seed} \\\\",
        f"Dev share of the hash split & {DEV_FRACTION:.2f} \\\\",
        "\\bottomrule\n\\end{tabular}",
        "\\caption{Hyperparameters (from \\texttt{configs/} and the result metadata).}",
        "\\label{tab:hparams}\n\\end{table}\n",
    ]
    write_table("hparams.tex", "\n".join(lines))

    # dev-grid factor means (appendix; dev split, used for selection only)
    def factor(row: dict[str, str]) -> dict[str, str]:
        cid = row["config_id"].split("|")
        return {
            "Chunker": {
                "fixed_256": "Fixed-256",
                "fixed_512": "Fixed-512",
                "semantic": "Semantic",
                "structural": "Structural",
            }[cid[0]],
            "Retriever": {
                "bm25": "BM25",
                "dense": "Dense",
                "hybrid_rrf": "Hybrid RRF",
                "hybrid_linear": "Hybrid linear",
            }[cid[1]],
            "Encoder": next((p for p in cid if p.startswith("bge-")), "none (BM25)"),
            "Xref expansion": "on" if "xref" in cid else "off",
            "Reranking": "on" if any(p.startswith("rerank") for p in cid) else "off",
        }

    lines = [
        "\\begin{table}[t]\n\\centering\\footnotesize\\setlength{\\tabcolsep}{3pt}",
        "\\begin{tabular}{@{}llrrr@{}}\n\\toprule",
        "Factor & Level & Configs & R@5 & Cov@1024 \\\\ \\midrule",
    ]
    groups: dict[tuple[str, str], list[dict[str, str]]] = defaultdict(list)
    for r in dev_cl:
        for f_, lv in factor(r).items():
            groups[(f_, lv)].append(r)
    last = None
    for (f_, lv), rows in sorted(
        groups.items(),
        key=lambda kv: (
            ["Chunker", "Retriever", "Encoder", "Xref expansion", "Reranking"].index(kv[0][0]),
            kv[0][1],
        ),
    ):
        lines.append(
            f"{f_ if f_ != last else ''} & {lv} & {len(rows)} & {fnum(statistics.mean(fl(r['recall@5']) for r in rows))} & {fnum(statistics.mean(fl(r['coverage@1024']) for r in rows))} \\\\"
        )
        last = f_
    lines += [
        "\\bottomrule\n\\end{tabular}",
        f"\\caption{{Consumer-law \\emph{{dev}} grid ({len(dev_cl)} configurations, {con['cl']['final_counts']['whole_file']['by_split']['dev']['answerable']} answerable dev questions): mean metric per factor level, "
        "averaged over all configurations with that level. The grid is unbalanced (the hybrids use bge-base, so it appears in more configurations than the other encoders), "
        "so these marginal means are confounded with the other factors. Used only to choose the test configurations; no test claims rest on it.}",
        "\\label{tab:devgrid}\n\\end{table}\n",
    ]
    write_table("devgrid.tex", "\n".join(lines))

    # ---------------------------------------------------------------- error analysis
    sample = local_or_snapshot("error_sample.csv", error_sample, notes)
    psamp = DATA / "error_sample.csv"
    labels_p = DATA / "error_labels.csv"
    labels = (
        {(r["collection"], r["qid"]): r for r in read_csv(labels_p)} if labels_p.exists() else {}
    )
    if labels and set(labels) != {(r["collection"], r["qid"]) for r in sample}:
        raise SystemExit("paper/data/error_labels.csv does not match the current error sample")
    nf = local_or_snapshot(
        "error_counts.json",
        lambda: {c: sum(1 for r in eval_records(c, "G4") if not r["accurate"]) for c in COLLS},
        notes,
    )
    for c in COLLS:
        N.put(
            f"{c}.err.nfail",
            str(nf[c]),
            DATA / "error_counts.json",
            f"{c}: G4 test records with accurate == false",
            nf[c],
        )
        N.put(
            f"{c}.err.nsample",
            str(sum(1 for r in sample if r["collection"] == c)),
            psamp,
            f"rows with collection == {c}",
            None,
        )
    N.put("err.n", str(len(sample)), psamp, "rows", len(sample))
    N.put("err.seed", str(ERROR_SEED), Path(__file__), "ERROR_SEED", ERROR_SEED)
    cat_of = {
        (r["collection"], r["qid"]): (
            labels[(r["collection"], r["qid"])]["category"] if labels else r["auto_category"]
        )
        for r in sample
    }
    agree = sum(
        1
        for r in sample
        if labels and labels[(r["collection"], r["qid"])]["category"] == r["auto_category"]
    )
    if labels:
        N.put("err.agree", str(agree), labels_p, "category == auto_category", agree)
    lines = [
        "\\begin{table}[t]\n\\centering\\footnotesize\\setlength{\\tabcolsep}{4pt}",
        "\\begin{tabular}{@{}lrrr@{}}\n\\toprule",
        "Category & Cons.\\ law & CS/AI & Total \\\\ \\midrule",
    ]
    for cat, label in ERROR_CATEGORIES:
        a = sum(1 for (c, _), v in cat_of.items() if c == "cl" and v == cat)
        b = sum(1 for (c, _), v in cat_of.items() if c == "cs" and v == cat)
        N.put(
            f"err.{cat.replace('_', '')}",
            str(a + b),
            labels_p if labels else psamp,
            f"count category == {cat}",
            a + b,
        )
        lines.append(f"{label} & {a} & {b} & {a + b} \\\\")
    lines.append(
        f"\\midrule\nSampled failures & {sum(1 for r in sample if r['collection'] == 'cl')} & {sum(1 for r in sample if r['collection'] == 'cs')} & {len(sample)} \\\\"
    )
    lines += [
        "\\bottomrule\n\\end{tabular}",
        f"\\caption{{Error categories of {len(sample)} G4 test failures (of \\V{{cl.err.nfail}} consumer-law and \\V{{cs.err.nfail}} CS/AI failures), "
        f"sampled with seed \\V{{err.seed}} in proportion to the failures per collection.}}",
        "\\label{tab:errors}\n\\end{table}\n",
    ]
    write_table("errors.tex", "\n".join(lines))

    # three short real examples, quoted from the records
    by_key = {(r["collection"], r["qid"]): r for r in sample}
    label_of = dict(ERROR_CATEGORIES)
    ex = [
        "% Generated by scripts/paper_tables.py from paper/data/error_sample.csv -- do not edit by hand.",
        "\\begin{itemize}",
    ]
    for c, q in ERROR_EXAMPLES:
        r = by_key[(c, q)]
        cat = cat_of[(c, q)]
        shown = r["answer"] or r["withheld_answer"]
        what = "Answer" if r["answer"] else "Withheld answer"
        ex.append(
            f"\\item \\emph{{{label_of[cat]}}} ({COLLS[c]['label']}). Q: ``{tex_escape(r['question'])}'' "
            f"{what}: ``{tex_escape(shown)}'' Gold: ``{tex_escape(r['gold_answer'])}''"
        )
    ex.append("\\end{itemize}")
    (TABLES / "error_examples.tex").write_text("\n".join(ex) + "\n", encoding="utf-8")

    # ---------------------------------------------------------------- reproducibility and prompts
    import subprocess

    head = subprocess.run(
        ["git", "rev-parse", "--short", "HEAD"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    N.put(
        "repro.head",
        head,
        ROOT / ".git",
        "git rev-parse --short HEAD (when the tables were built)",
        head,
    )
    runs = {
        "cl.ret": COLLS["cl"]["results"] / "tables/retrieval_test.meta.json",
        "cl.gen": COLLS["cl"]["results"] / "tables/generation_test.meta.json",
        "cl.g2h": ab_meta_p,
        "cs.ret": COLLS["cs"]["results"] / "tables/retrieval_test.meta.json",
        "cs.gen": COLLS["cs"]["results"] / "tables/generation_test.meta.json",
    }
    for k, p in runs.items():
        ri = json.loads(p.read_text(encoding="utf-8"))["run_info"]
        N.put(
            f"repro.{k}", ri["git"]["commit"][:7], p, "run_info.git.commit[:7]", ri["git"]["commit"]
        )
    ri = gmeta["run_info"]
    N.put(
        "hw.cpu",
        tex_escape(
            ri["cpu_model"]
            .replace("11th Gen Intel(R) Core(TM) ", "Intel Core ")
            .replace(" @ ", ", ")
        ),
        gmeta_p,
        "run_info.cpu_model",
        ri["cpu_model"],
    )
    N.put(
        "hw.cores",
        str(ri["cpu_count_physical"]),
        gmeta_p,
        "run_info.cpu_count_physical",
        ri["cpu_count_physical"],
    )
    N.put(
        "hw.threads",
        str(ri["cpu_count_logical"]),
        gmeta_p,
        "run_info.cpu_count_logical",
        ri["cpu_count_logical"],
    )
    N.put(
        "hw.ram", f"{ri['ram_total_gb']:.2f}", gmeta_p, "run_info.ram_total_gb", ri["ram_total_gb"]
    )
    N.put("hw.python", ri["python"], gmeta_p, "run_info.python", ri["python"])
    N.put(
        "hw.torch",
        tex_escape(ri["packages"]["torch"]),
        gmeta_p,
        "run_info.packages.torch",
        ri["packages"]["torch"],
    )
    N.put(
        "hw.st",
        ri["packages"]["sentence-transformers"],
        gmeta_p,
        "run_info.packages.sentence-transformers",
        ri["packages"]["sentence-transformers"],
    )
    N.put("hw.os", tex_escape(ri["os"]), gmeta_p, "run_info.os", ri["os"])

    from ragsys.profiles import CONSUMER_LAW, CS_AI

    g = CONSUMER_LAW.generation
    gc = CS_AI.generation
    prompts_cs = [
        f"\\paragraph{{CS/AI synthesizer system prompt ({tex_escape(gc.synth_version)}).}}",
        "\\begin{promptbox}\n" + gc.synth_system.strip() + "\n\\end{promptbox}",
        f"\\paragraph{{CS/AI critic system prompt ({tex_escape(gc.critic_version)}).}}",
        "\\begin{promptbox}\n" + gc.critic_system.strip() + "\n\\end{promptbox}",
    ]
    prompts = [
        "% Generated by scripts/paper_tables.py from src/ragsys/profiles.py (consumer_law profile) -- do not edit by hand.",
        f"\\paragraph{{Synthesizer system prompt ({tex_escape(g.synth_version)}).}}",
        "\\begin{promptbox}\n" + g.synth_system.strip() + "\n\\end{promptbox}",
        f"\\paragraph{{Critic system prompt ({tex_escape(g.critic_version)}).}}",
        "\\begin{promptbox}\n" + g.critic_system.strip() + "\n\\end{promptbox}",
    ]
    (TABLES / "prompts.tex").write_text("\n".join(prompts + prompts_cs) + "\n", encoding="utf-8")
    torch_pin = next(
        line.split("==")[1].strip()
        for line in (ROOT / "requirements.txt").read_text(encoding="utf-8").splitlines()
        if line.startswith("torch==")
    )
    commands = [
        "# setup (Windows 11, PowerShell; Python " + ri["python"].rsplit(".", 1)[0] + ", CPU only)",
        f"py -{ri['python'].rsplit('.', 1)[0]} -m venv .venv; .venv\\Scripts\\Activate.ps1",
        f"pip install torch=={torch_pin} --index-url https://download.pytorch.org/whl/cpu",
        "pip install -r requirements-dev.txt; pip install -e .",
        "ollama pull qwen2.5:3b        # keep Ollama running",
        "# consumer law: corpus, indexes, evaluation set",
        "python scripts/ingest.py; python scripts/chunk.py --chunker all",
        "python scripts/build_index.py --chunker all --models bge-small bge-base bge-large",
        "python scripts/build_auto_eval.py; python scripts/validate_eval.py",
        "# retrieval: dev grid, selection, one test run",
        "python scripts/run_retrieval_grid.py --split dev; python scripts/select_configs.py",
        "python scripts/eval_retrieval.py --split test --configs-from results/tables/selected_configs.json",
        "# generation: dev runs, threshold, derived systems, one test run",
        "python scripts/run_generation.py --split dev --systems G1 G2 G4 G6",
        "python scripts/tune_abstention.py; python scripts/derive_systems.py --split dev",
        "python scripts/eval_generation.py --split test --systems G1 G2 G3 G4 G5 G6",
        "# CS/AI: the same steps for the collection",
        "python scripts/run_collection_pipeline.py --collection cs_ai",
        "# hosted ablation (needs LLM_API_KEY)",
        "python scripts/eval_generation.py --split test --collection consumer_law --systems G2H",
        "python scripts/eval_generation.py --split test --collection cs_ai --systems G2H",
        "# browser latency, tables, figures, PDF",
        "cd web-static; npx playwright test --config playwright.perf.config.ts; cd ..",
        "python scripts/paper_tables.py; python scripts/paper_figures.py",
        "cd paper; tectonic main.tex",
    ]
    (TABLES / "repro_commands.tex").write_text(
        "% Generated by scripts/paper_tables.py -- do not edit by hand.\n\\begin{promptbox}\n"
        + "\n".join(commands)
        + "\n\\end{promptbox}\n",
        encoding="utf-8",
    )

    # ---------------------------------------------------------------- write
    N.write(TABLES / "numbers.tex", {"csGtwoHready": cs_g2h_ready})
    (DATA / "macro_sources.json").write_text(
        json.dumps(N.items, indent=1, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(
        f"wrote {len(N.items)} number macros and {len(list(TABLES.glob('*.tex'))) - 1} tables to {rel(TABLES)}"
    )
    print(
        f"CS/AI G2H ablation: {'complete' if cs_g2h_ready else f'pending ({done} of the test questions answered)'}"
    )
    for n_ in notes:
        print("note:", n_)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
