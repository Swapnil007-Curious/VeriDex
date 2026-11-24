"""Replace the YOUR_KAGGLE_USERNAME placeholder with a Kaggle username before publishing.

Usage (repository root):

    python kaggle/tools/set_kaggle_owner.py <kaggle-username>

Rewrites the dataset metadata, every kernel-metadata.json, the dataset README and the links in
the notebooks. Running it again with another username first needs a fresh checkout of those
files, because the placeholder is gone after the first run.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

PLACEHOLDER = "YOUR_KAGGLE_USERNAME"
ROOT = Path(__file__).resolve().parents[1]
TARGETS = [
    *ROOT.glob("datasets/*/dataset-metadata.json"),
    *ROOT.glob("datasets/*/README.md"),
    *ROOT.glob("notebooks/*/*/kernel-metadata.json"),
    *ROOT.glob("notebooks/*/*/notebook.ipynb"),
]


def main() -> None:
    if len(sys.argv) != 2 or not re.fullmatch(r"[A-Za-z0-9_-]{3,40}", sys.argv[1]):
        sys.exit("usage: python kaggle/tools/set_kaggle_owner.py <kaggle-username>")
    owner = sys.argv[1]
    changed = 0
    for path in TARGETS:
        text = path.read_text(encoding="utf-8")
        if PLACEHOLDER in text:
            path.write_text(text.replace(PLACEHOLDER, owner), encoding="utf-8", newline="\n")
            changed += 1
            print(f"updated {path.relative_to(ROOT)}")
    print(f"{changed} files updated")


if __name__ == "__main__":
    main()
