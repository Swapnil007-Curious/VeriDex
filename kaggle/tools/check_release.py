"""Pre-publication checks for the Kaggle notebooks and dataset.

Usage (repository root):  python kaggle/tools/check_release.py

Checks, failing with a non-zero exit code on any problem:

* every notebook validates with nbformat, has no error outputs and has kernel-metadata.json and a
  1280 x 720 cover.png next to it;
* no local paths, user names, e-mail addresses or credential-like strings in notebooks (sources
  and outputs), kernel metadata or dataset files;
* the dataset holds only documents whose licence is cleared for redistribution, and nothing from
  the excluded Consumer Protection Act, 2019;
* markdown (cells and rendered outputs) follows the series style: no em or en dashes, no emojis,
  none of the avoided words.
"""

from __future__ import annotations

import csv
import json
import re
import sys
from pathlib import Path

import nbformat

ROOT = Path(__file__).resolve().parents[1]
DATASET = ROOT / "datasets" / "veridex-rag-corpus"
CLEARED_DOCS = {"ecom2020", "commissions2020", "jurisdiction2021", "mediation2020", "d2l", "progit", "ods"}
EXCLUDED_DOCS = {"cpa2019"}

LEAK_PATTERNS = {
    "windows user path": re.compile(r"[A-Za-z]:[\\/]{1,2}Users[\\/]{1,2}\w+", re.I),
    "posix home path": re.compile(r"/(?:home|Users|c/Users)/[A-Za-z0-9_.-]+/", re.I),
    "temp folder": re.compile(r"AppData[\\/]+Local", re.I),
    "e-mail address": re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),
    "groq key": re.compile(r"gsk_[A-Za-z0-9]{20,}"),
    "hugging face token": re.compile(r"hf_[A-Za-z0-9]{30,}"),
    "openai-style key": re.compile(r"\bsk-[A-Za-z0-9]{20,}"),
    "github token": re.compile(r"gh[pousr]_[A-Za-z0-9]{30,}"),
    "aws key": re.compile(r"AKIA[0-9A-Z]{16}"),
    "kaggle key": re.compile(r"KAGGLE_KEY|\"key\"\s*:\s*\"[0-9a-f]{32}\""),
}
ALLOWED_EMAIL_CONTEXT = re.compile(r"git@github\.com")
STYLE_WORDS = re.compile(
    r"\b(?:delve|crucial|pivotal|showcase|leverage|utili[sz]e|landscape|tapestry|testament|seamless(?:ly)?|"
    r"unlock|game-changer|meticulous(?:ly)?|furthermore|additionally)\b", re.I)
ROBUST = re.compile(r"\brobust\b", re.I)
DASHES = re.compile(r"[–—]")
EMOJI = re.compile("[\U0001F300-\U0001FAFF☀-➿]")


def leaks(text: str) -> list:
    found = []
    for name, pat in LEAK_PATTERNS.items():
        for m in pat.finditer(text):
            if name == "e-mail address" and ALLOWED_EMAIL_CONTEXT.search(m.group(0)):
                continue
            found.append(f"{name}: {m.group(0)[:60]}")
    return found


def style_problems(md: str) -> list:
    md = re.sub(r"`[^`]*`", "", md)  # code spans may quote data
    out = [f"avoided word '{m.group(0)}'" for m in STYLE_WORDS.finditer(md)]
    out += [f"figurative 'robust'" for _ in ROBUST.finditer(md)]
    out += [f"dash in: ...{md[max(0, m.start() - 30):m.end() + 30]!r}..." for m in DASHES.finditer(md)]
    out += ["emoji" for _ in EMOJI.finditer(md)]
    return out


def check_notebook(folder: Path) -> list:
    problems = []
    nb_path, meta_path, cover = folder / "notebook.ipynb", folder / "kernel-metadata.json", folder / "cover.png"
    for p in (nb_path, meta_path, cover):
        if not p.exists():
            problems.append(f"missing {p.name}")
    if problems:
        return problems
    nb = nbformat.read(str(nb_path), as_version=4)
    try:
        nbformat.validate(nb)
    except nbformat.ValidationError as exc:
        problems.append(f"nbformat: {exc}")
    for i, cell in enumerate(nb.cells):
        problems += [f"cell {i} source {x}" for x in leaks(cell.source)]
        if cell.cell_type == "markdown":
            problems += [f"cell {i} markdown {x}" for x in style_problems(cell.source)]
        for out in cell.get("outputs", []):
            if out.get("output_type") == "error":
                problems.append(f"cell {i} has an error output: {out.get('ename')}")
            blob = out.get("text", "") + "".join(v for k, v in out.get("data", {}).items() if k.startswith("text/") and isinstance(v, str))
            problems += [f"cell {i} output {x}" for x in leaks(blob)]
            md = out.get("data", {}).get("text/markdown")
            if isinstance(md, str):
                problems += [f"cell {i} rendered markdown {x}" for x in style_problems(md)]
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    for key in ("id", "title", "code_file", "language", "kernel_type", "is_private", "enable_gpu", "enable_internet", "dataset_sources"):
        if key not in meta:
            problems.append(f"kernel-metadata.json lacks {key}")
    if str(meta.get("is_private")).lower() != "true":
        problems.append("kernel is not private")
    if not any(s.endswith("/veridex-rag-corpus") for s in meta.get("dataset_sources", [])):
        problems.append("kernel does not list the veridex-rag-corpus dataset")
    problems += [f"kernel-metadata {x}" for x in leaks(meta_path.read_text(encoding="utf-8"))]
    try:
        from PIL import Image

        with Image.open(cover) as im:
            if im.size != (1280, 720):
                problems.append(f"cover.png is {im.size}, expected (1280, 720)")
    except ImportError:
        pass
    return problems


def check_dataset() -> list:
    problems = []
    with (DATASET / "documents.csv").open(encoding="utf-8", newline="") as fh:
        docs = {r["doc_id"]: r for r in csv.DictReader(fh)}
    if set(docs) - CLEARED_DOCS:
        problems.append(f"documents without a cleared licence: {sorted(set(docs) - CLEARED_DOCS)}")
    for d, r in docs.items():
        if not r["licence"] or not r["source_url"]:
            problems.append(f"{d}: licence or source missing")
    files = [p for p in DATASET.rglob("*") if p.is_file()]
    if any(p.stem in EXCLUDED_DOCS for p in files):
        problems.append("an excluded document has its own file")
    # Example e-mail addresses and home paths printed in the books themselves (Pro Git's sample
    # commits, for instance) are licensed document text, not leaks: a match is allowed when the same
    # string occurs in one of the shipped source texts. JSON rows are decoded first, so an escaped
    # newline cannot glue an "n" onto a match ("\n@d2l.add_to_class").
    quoted = {x for p in (DATASET / "text").glob("*.txt") for x in leaks(p.read_text(encoding="utf-8"))}
    n_quoted = 0
    for p in files:
        if p.suffix in (".jsonl", ".json", ".csv", ".md", ".txt"):
            text = p.read_text(encoding="utf-8")
            if p.suffix == ".jsonl":
                plain = "\n".join(s for line in text.splitlines() for s in _strings(json.loads(line)))
            else:
                plain = text
            found = leaks(plain)
            n_quoted += sum(x in quoted for x in found)
            problems += [f"{p.relative_to(DATASET)}: {x}" for x in found if x not in quoted]
            if p.suffix == ".jsonl":
                for line in text.splitlines():
                    row = json.loads(line)
                    ids = [row.get("doc_id"), row.get("chunk_id", ""), *(row.get("gold_node_ids") or [])]
                    ids += [c.get("chunk_id", "") for c in row.get("context", [])]
                    if any(x and any(e in str(x).split(":")[:2] for e in EXCLUDED_DOCS) for x in ids):
                        problems.append(f"{p.relative_to(DATASET)}: row references an excluded document")
                        break
    print(f"dataset: {n_quoted} leak-pattern matches quote the source documents (allowed)")
    return problems


def _strings(value) -> list:
    """Every string inside a decoded JSON value."""
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        return [s for v in value.values() for s in _strings(v)]
    if isinstance(value, list):
        return [s for v in value for s in _strings(v)]
    return []


def main() -> None:
    report = {}
    for folder in sorted(ROOT.glob("notebooks/*/*/")):
        if folder.is_dir():
            report[str(folder.relative_to(ROOT))] = check_notebook(folder)
    report["datasets/veridex-rag-corpus"] = check_dataset()
    for path in [p for p in ROOT.glob("tools/*.py") if p.name != Path(__file__).name] + list(ROOT.glob("*.md")):
        report.setdefault(str(path.relative_to(ROOT)), []).extend(
            x for x in leaks(path.read_text(encoding="utf-8")) if not x.startswith(("posix home path", "windows user path")))
    bad = 0
    for name, probs in report.items():
        status = "ok" if not probs else f"{len(probs)} problem(s)"
        print(f"{name}: {status}")
        for p in probs[:25]:
            print(f"    {p}")
        bad += len(probs)
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
