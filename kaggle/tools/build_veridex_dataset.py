"""Build the public Kaggle dataset ``veridex-rag-corpus`` from the local processed corpora.

Usage (repository root, project virtual environment):

    python kaggle/tools/build_veridex_dataset.py [--out kaggle/datasets/veridex-rag-corpus]

Only documents whose licence clearly allows redistribution are exported:

* consumer_rules: the four Consumer Protection Rules (Gazette of India notifications, which the
  Copyright Act, 1957, s. 52(1)(q)(i) allows to be reproduced). The Consumer Protection Act, 2019
  itself is left out: for an Act of a Legislature, s. 52(1)(q)(ii) requires commentary or other
  original matter alongside it (see THIRD_PARTY.md, "Open licence questions").
* cs_ai: the three evaluated textbooks (Dive into Deep Learning, CC BY-SA 4.0; Pro Git,
  CC BY-NC-SA 3.0; Open Data Structures, CC BY 2.5 Canada).

Questions are kept when every gold node lies in an exported document (unanswerable questions are
always kept). The dev/test split is the repository's deterministic split (``split_of``).
Cached answers are the recorded CS / AI test answers of systems G1, G2, G3, G4 and G2H; their
contexts only reference exported chunks.

The output is deterministic for the same inputs (no timestamps), so rebuilding shows a clean diff.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import shutil
from pathlib import Path
from typing import Any

from ragsys.eval.split import split_of

REPO = Path(__file__).resolve().parents[2]
DEFAULT_OUT = REPO / "kaggle" / "datasets" / "veridex-rag-corpus"

RULES_LICENCE = (
    "Gazette of India notification; reproduction permitted by the Copyright Act, 1957, "
    "s. 52(1)(q)(i)"
)
RULES_LICENCE_URL = ""  # statutory permission; there is no licence page to link

COLLECTIONS: dict[str, dict[str, Any]] = {
    "consumer_rules": {
        "processed": REPO / "data" / "processed",
        "questions": REPO / "data" / "eval" / "questions.jsonl",
        "sources": REPO / "data" / "raw" / "SOURCES.csv",
        "docs": ["ecom2020", "commissions2020", "jurisdiction2021", "mediation2020"],
        "excluded_docs": {"cpa2019": "Act of Parliament: s. 52(1)(q)(ii) needs commentary"},
        "chunkers": ["fixed_256", "fixed_512", "semantic", "structural"],
    },
    "cs_ai": {
        "processed": REPO / "collections" / "cs_ai" / "processed",
        "questions": REPO / "collections" / "cs_ai" / "eval" / "questions.jsonl",
        "sources": REPO / "collections" / "cs_ai" / "raw" / "SOURCES.csv",
        "docs": ["d2l", "progit", "ods"],
        "excluded_docs": {},
        "chunkers": ["fixed_512", "structural"],
    },
}

CACHED_RESULTS = REPO / "collections" / "cs_ai" / "results"
CACHED_SYSTEMS = ["G1", "G2", "G3", "G4", "G2H"]
GENERATORS = {
    "G1": "qwen2.5:3b (local, Ollama)",
    "G2": "qwen2.5:3b (local, Ollama)",
    "G3": "qwen2.5:3b (local, Ollama)",
    "G4": "qwen2.5:3b (local, Ollama)",
    "G2H": "openai/gpt-oss-120b (hosted)",
}

NODE_FIELDS = [
    "doc_id", "doc_title", "doc_type", "node_id", "level", "number", "heading", "parent_id",
    "children", "page_start", "page_end", "char_start", "char_end", "defined_term", "order",
]  # fmt: skip
CHUNK_FIELDS = [
    "chunk_id", "chunker", "doc_id", "text", "node_ids", "primary_node_id", "section_ids",
    "heading_path", "page_start", "page_end", "char_start", "char_end", "n_tokens",
]  # fmt: skip
QUESTION_FIELDS = ["question", "type", "answerable", "gold_node_ids", "gold_answer", "difficulty"]


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    with path.open(encoding="utf-8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False, sort_keys=False) + "\n")


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def source_rows(collection: str, cfg: dict[str, Any]) -> dict[str, dict[str, str]]:
    with cfg["sources"].open(encoding="utf-8", newline="") as fh:
        rows = {r["doc_id"]: r for r in csv.DictReader(fh)}
    out = {}
    for doc_id in cfg["docs"]:
        r = rows[doc_id]
        if collection == "consumer_rules":
            out[doc_id] = {
                "title": r["official_title"],
                "authors": "Government of India (Gazette of India)",
                "edition": "as notified in the Gazette of India",
                "licence": RULES_LICENCE,
                "licence_url": RULES_LICENCE_URL,
                "source_url": r["source_url"],
                "source_sha256": r["sha256"],
            }
        else:
            out[doc_id] = {
                "title": r["title"],
                "authors": r["authors"],
                "edition": r["edition"],
                "licence": r["licence"],
                "licence_url": r["licence_url"],
                "source_url": r["source_url"],
                "source_sha256": r["sha256"],
            }
    return out


def build(out: Path) -> dict[str, Any]:
    if out.exists():
        for sub in ("text", "structure", "chunks", "questions", "cached_answers"):
            shutil.rmtree(out / sub, ignore_errors=True)
    out.mkdir(parents=True, exist_ok=True)

    documents: list[dict[str, Any]] = []
    all_nodes: list[dict[str, Any]] = []
    questions: list[dict[str, Any]] = []
    gold_rows: list[dict[str, Any]] = []
    counts: dict[str, Any] = {}
    shipped_chunks: set[str] = set()

    for collection, cfg in COLLECTIONS.items():
        docs = set(cfg["docs"])
        texts: dict[str, str] = {}
        meta = source_rows(collection, cfg)
        for doc_id in cfg["docs"]:
            text = (cfg["processed"] / "clean" / f"{doc_id}.txt").read_text(encoding="utf-8")
            texts[doc_id] = text
            (out / "text").mkdir(parents=True, exist_ok=True)
            (out / "text" / f"{doc_id}.txt").write_text(text, encoding="utf-8", newline="\n")
            documents.append({"doc_id": doc_id, "collection": collection, **meta[doc_id],
                              "n_chars": len(text)})  # fmt: skip

        nodes = [n for n in read_jsonl(cfg["processed"] / "structure" / "nodes.jsonl")
                 if n["doc_id"] in docs]  # fmt: skip
        node_ids = set()
        for n in nodes:
            assert texts[n["doc_id"]][n["char_start"] : n["char_end"]] == n["text"], n["node_id"]
            node_ids.add(n["node_id"])
            all_nodes.append({"collection": collection, **{k: n[k] for k in NODE_FIELDS}})
        node_by_id = {n["node_id"]: n for n in nodes}

        n_chunks = {}
        for chunker in cfg["chunkers"]:
            rows = []
            for c in read_jsonl(cfg["processed"] / "chunks" / f"{chunker}.jsonl"):
                if c["doc_id"] not in docs:
                    continue
                display = texts[c["doc_id"]][c["char_start"] : c["char_end"]]
                assert c["display_text"] == display and c["text"].endswith(display), c["chunk_id"]
                rows.append({k: c[k] for k in CHUNK_FIELDS})
                shipped_chunks.add(c["chunk_id"])
            write_jsonl(out / "chunks" / collection / f"{chunker}.jsonl", rows)
            n_chunks[chunker] = len(rows)

        kept = dropped = 0
        for q in read_jsonl(cfg["questions"]):
            golds = q["gold_node_ids"]
            if any(g.split(":", 1)[0] not in docs for g in golds):
                dropped += 1
                continue
            assert all(g in node_ids for g in golds), q["id"]
            kept += 1
            questions.append({
                "uid": f"{collection}/{q['id']}", "collection": collection, "qid": q["id"],
                "split": split_of(q["id"]), **{k: q[k] for k in QUESTION_FIELDS},
                "origin": q.get("origin") or "seed_example",
            })  # fmt: skip
            for g in golds:
                n = node_by_id[g]
                gold_rows.append({
                    "uid": f"{collection}/{q['id']}", "node_id": g, "doc_id": n["doc_id"],
                    "level": n["level"], "heading": n["heading"], "text": n["text"],
                })  # fmt: skip
        counts[collection] = {
            "documents": len(cfg["docs"]),
            "excluded_documents": cfg["excluded_docs"],
            "nodes": len(nodes),
            "chunks": n_chunks,
            "questions_kept": kept,
            "questions_dropped_gold_outside_export": dropped,
        }

    write_jsonl(out / "structure" / "nodes.jsonl", all_nodes)
    write_jsonl(out / "questions" / "questions.jsonl", questions)
    write_jsonl(out / "questions" / "gold_passages.jsonl", gold_rows)
    with (out / "documents.csv").open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(documents[0]), lineterminator="\n")
        w.writeheader()
        w.writerows(documents)

    # cached answers (CS / AI test split), with the evaluation the repository recorded
    q_ids = {q["qid"] for q in questions if q["collection"] == "cs_ai"}
    gen_meta = json.loads((CACHED_RESULTS / "tables" / "generation_test.meta.json").read_text("utf-8"))
    abl_meta = json.loads(
        (CACHED_RESULTS / "tables" / "generation_test_ablation.meta.json").read_text("utf-8")
    )
    descriptions = {k: v["description"] for k, v in gen_meta["systems"].items()}
    descriptions.update({k: v["description"] for k, v in abl_meta["systems"].items()})
    cached = []
    for system in CACHED_SYSTEMS:
        folder = CACHED_RESULTS / "generation" / "test" / system
        evals = {r["qid"]: r for r in read_jsonl(folder / "eval.jsonl")}
        for r in read_jsonl(folder / "per_question.jsonl"):
            assert r["qid"] in q_ids, r["qid"]
            ctx = [{"label": c["label"], "chunk_id": c["chunk_id"], "rank": c["rank"]}
                   for c in r.get("context", [])]  # fmt: skip
            assert all(c["chunk_id"] in shipped_chunks for c in ctx), (system, r["qid"])
            e = evals[r["qid"]]
            cached.append({
                "uid": f"cs_ai/{r['qid']}", "qid": r["qid"], "split": r["split"],
                "system": system, "system_description": descriptions[system],
                "generator": GENERATORS[system],
                "retrieval_config": r["retrieval"]["config_id"],
                "top1_dense_score": r["retrieval"]["abstention_score"],
                "outcome": r["outcome"], "reason": r.get("reason"),
                "answer": r.get("answer", ""), "citations": r.get("citations", []),
                "context": ctx,
                "recorded_eval": {
                    "nli_model": "cross-encoder/nli-deberta-v3-base",
                    "sentences": e.get("sentences", []),
                    "faithfulness": e.get("faithfulness"),
                    "p_correct": e.get("p_correct"),
                    "correct": e.get("correct"),
                },
            })  # fmt: skip
    write_jsonl(out / "cached_answers" / "cs_ai_test_answers.jsonl", cached)
    counts["cached_answers"] = {s: sum(1 for c in cached if c["system"] == s) for s in CACHED_SYSTEMS}

    files = sorted(
        p for p in out.rglob("*")
        if p.is_file() and p.name not in ("MANIFEST.json", "dataset-metadata.json")
    )  # fmt: skip
    manifest = {
        "dataset": "veridex-rag-corpus",
        "version": 1,
        "built_from": "https://github.com/Swapnil007-Curious/VeriDex",
        "counts": counts,
        "files": {p.relative_to(out).as_posix(): {"bytes": p.stat().st_size,
                                                    "sha256": sha256_file(p)} for p in files},
    }  # fmt: skip
    (out / "MANIFEST.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n"
    )
    return manifest


def write_metadata(out: Path, owner: str) -> None:
    """Kaggle ``dataset-metadata.json``; the description is the dataset README."""
    meta = {
        "title": "VeriDex RAG corpus",
        "subtitle": "Consumer rules and CS textbooks with gold passages for RAG evaluation",
        "id": f"{owner}/veridex-rag-corpus",
        "isPrivate": True,
        "licenses": [{"name": "other"}],
        "keywords": ["nlp", "text", "law", "computer science", "information retrieval"],
        "description": (out / "README.md").read_text(encoding="utf-8"),
    }
    (out / "dataset-metadata.json").write_text(
        json.dumps(meta, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n"
    )


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--owner", default="YOUR_KAGGLE_USERNAME", help="Kaggle username")
    args = ap.parse_args()
    manifest = build(args.out)
    write_metadata(args.out, args.owner)
    print(json.dumps(manifest["counts"], indent=2))
    total = sum(f["bytes"] for f in manifest["files"].values())
    print(f"{len(manifest['files'])} files, {total / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
