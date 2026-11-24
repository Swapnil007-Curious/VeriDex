"""Execute a notebook of the series locally with Kaggle-style inputs, in place.

Usage (repository root):

    python kaggle/tools/run_notebook.py kaggle/notebooks/veridex/02-retrieval-ablation/notebook.ipynb [--fast]

The notebooks look for the dataset under /kaggle/input and write to /kaggle/working. Locally this
script points them elsewhere through environment variables that the notebooks read:
VERIDEX_DATA_DIR (the dataset folder in this repository), VERIDEX_WORK_DIR (a fresh temporary
folder) and VERIDEX_FAST ("1" with --fast: notebook 4 then generates a small subset with a 0.5B
model, for machines without a GPU). After the run, local paths are scrubbed from the outputs, the
notebook is written back and the cover.png it produced is copied next to it.

Needs nbclient, ipykernel and pandas next to the notebooks' own requirements (torch,
sentence-transformers, transformers, matplotlib, scipy, onnxruntime).
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import sys
import tempfile
import time
from pathlib import Path

import nbformat
from nbclient import NotebookClient

KAGGLE = Path(__file__).resolve().parents[1]
DATASET = KAGGLE / "datasets" / "veridex-rag-corpus"
LOCAL_PATHS = [
    re.compile(r"[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s'\"]+", re.I),
    re.compile(r"/(?:home|Users|c/Users)/[^/\s'\"]+", re.I),
    re.compile(r"AppData[\\/]+Local[\\/]+Temp", re.I),
]


def scrub(nb: nbformat.NotebookNode, extra: list[str]) -> int:
    """Replace local paths in every text output with <local>; returns the number of replacements."""
    patterns = LOCAL_PATHS + [re.compile(re.escape(x), re.I) for x in extra if x]
    total = 0

    def clean(text: str) -> str:
        nonlocal total
        for pat in patterns:
            text, k = pat.subn("<local>", text)
            total += k
        return text

    for cell in nb.cells:
        for out in cell.get("outputs", []):
            if isinstance(out.get("text"), str):
                out["text"] = clean(out["text"])
            for key, val in list(out.get("data", {}).items()):
                if key.startswith("text/") and isinstance(val, str):
                    out["data"][key] = clean(val)
            if out.get("output_type") == "error":
                out["traceback"] = [clean(t) for t in out.get("traceback", [])]
    return total


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    ap.add_argument("notebook", type=Path)
    ap.add_argument("--fast", action="store_true", help="smoke-test mode (only notebook 4 uses it)")
    ap.add_argument("--timeout", type=int, default=7200, help="seconds allowed per cell")
    args = ap.parse_args()

    nb_path = args.notebook.resolve()
    work = Path(tempfile.mkdtemp(prefix="veridex-work-"))
    os.environ.update({"VERIDEX_DATA_DIR": str(DATASET), "VERIDEX_WORK_DIR": str(work),
                       "VERIDEX_FAST": "1" if args.fast else "0", "PYTHONWARNINGS": "ignore",
                       "HF_HUB_DISABLE_PROGRESS_BARS": "1", "TQDM_DISABLE": "1"})
    nb = nbformat.read(str(nb_path), as_version=4)
    client = NotebookClient(nb, timeout=args.timeout, kernel_name="python3",
                            resources={"metadata": {"path": str(work)}})
    t0 = time.time()
    error = None
    try:
        client.execute()
    except Exception as exc:  # keep the partial outputs for debugging
        error = f"{type(exc).__name__}: {str(exc)[:2000]}"
    seconds = time.time() - t0
    n = scrub(nb, [str(KAGGLE.parent), str(work)])
    nb.metadata.pop("widgets", None)
    nbformat.validate(nb)
    nbformat.write(nb, str(nb_path))
    if (work / "cover.png").exists():
        shutil.copy2(work / "cover.png", nb_path.parent / "cover.png")
    shutil.rmtree(work, ignore_errors=True)
    print(f"{nb_path.parent.name}: {seconds / 60:.1f} min, {n} local paths scrubbed, fast={args.fast}")
    if error:
        print("ERROR:", error)
        sys.exit(1)


if __name__ == "__main__":
    main()
