"""Draw the paper's figures (vector PDF) from the data written by scripts/paper_tables.py.

    python scripts/paper_tables.py && python scripts/paper_figures.py

Writes paper/figures/{retrieval_deltas,selective,latency}.pdf at single-column width, plus
retrieval_deltas_ieee.pdf, a shorter variant for the IEEE column. Palette: the
first three slots of a categorical palette validated for colour-vision deficiency on all pairs
(blue #2a78d6, orange #eb6834, aqua #1baf7a); every series also carries a hatch or marker so the
figures stay readable in grayscale print. The architecture diagram (Figure 1) is TikZ inside the
paper.
"""

from __future__ import annotations

import csv
import json
import math
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Patch

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "paper/data"
FIG = ROOT / "paper/figures"
BLUE, ORANGE, AQUA = "#2a78d6", "#eb6834", "#1baf7a"
INK, MUTED, GRID = "#0b0b0b", "#52514e", "#dcdbd7"
COLW = 3.15  # inches, ACL single column
IEEE_COLW = 3.5  # inches, IEEE conference single column

plt.rcParams.update(
    {
        "font.family": "DejaVu Sans",
        "font.size": 7,
        "axes.labelsize": 7,
        "axes.titlesize": 7.5,
        "xtick.labelsize": 6.5,
        "ytick.labelsize": 6.5,
        "legend.fontsize": 6.5,
        "axes.edgecolor": MUTED,
        "axes.labelcolor": INK,
        "xtick.color": MUTED,
        "ytick.color": MUTED,
        "axes.linewidth": 0.6,
        "xtick.major.width": 0.6,
        "ytick.major.width": 0.6,
        "pdf.fonttype": 42,
        "hatch.linewidth": 0.5,
        "axes.spines.top": False,
        "axes.spines.right": False,
    }
)

LABEL = {"cl": "Consumer law", "cs": "CS/AI"}
MIN_ANSWERED = 5  # selective curves: points with at least this many answered questions


def read_csv(p: Path) -> list[dict[str, str]]:
    with p.open(encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def short_cfg(cid: str) -> str:
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


def retrieval_deltas(
    name: str = "retrieval_deltas.pdf", width: float = COLW, row_h: float = 0.42
) -> None:
    """Paired retrieval differences to naive RAG; row_h is the height per configuration in inches."""
    rows = read_csv(DATA / "fig_retrieval_deltas.csv")
    colls = ["cl", "cs"]
    cfgs = {c: [] for c in colls}
    for r in rows:
        if r["config_id"] not in cfgs[r["collection"]]:
            cfgs[r["collection"]].append(r["config_id"])
    heights = [len(cfgs[c]) for c in colls]
    fig, axes = plt.subplots(
        2,
        1,
        figsize=(width, row_h * sum(heights) + 0.75),
        sharex=True,
        gridspec_kw={"height_ratios": heights, "hspace": 0.32 if row_h >= 0.4 else 0.6},
    )
    styles = {
        "recall@5": (BLUE, "", "Recall@5"),
        "coverage@1024": (ORANGE, "/////", "Coverage@1024"),
    }
    for ax, c in zip(axes, colls, strict=False):
        order = cfgs[c][::-1]
        for j, metric in enumerate(("recall@5", "coverage@1024")):
            color, hatch, _ = styles[metric]
            for i, cid in enumerate(order):
                r = next(
                    x
                    for x in rows
                    if x["collection"] == c and x["config_id"] == cid and x["metric"] == metric
                )
                y = i + (0.19 if j == 0 else -0.19)
                m, lo, hi = float(r["mean_diff"]), float(r["ci_low"]), float(r["ci_high"])
                ax.barh(
                    y,
                    m,
                    height=0.34,
                    color=color,
                    hatch=hatch,
                    edgecolor="white",
                    linewidth=0.6,
                    zorder=2,
                )
                ax.errorbar(
                    m,
                    y,
                    xerr=[[m - lo], [hi - m]],
                    fmt="none",
                    ecolor=INK,
                    elinewidth=0.7,
                    capsize=1.6,
                    zorder=3,
                )
        ax.axvline(0, color=INK, linewidth=0.7, zorder=1)
        ax.set_yticks(range(len(order)), [short_cfg(x) for x in order])
        ax.tick_params(axis="y", length=0)
        ax.set_title(LABEL[c], loc="left", color=INK, pad=3)
        ax.grid(axis="x", color=GRID, linewidth=0.5, zorder=0)
        ax.set_ylim(-0.6, len(order) - 0.4)
        ax.tick_params(axis="x", labelbottom=True)
    axes[-1].set_xlabel("Difference to naive RAG on test\n(mean, 95% bootstrap interval)")
    handles = [
        Patch(facecolor=styles[m][0], hatch=styles[m][1], edgecolor="white", label=styles[m][2])
        for m in ("recall@5", "coverage@1024")
    ]
    if row_h >= 0.4:
        fig.legend(
            handles=handles, loc="lower center", ncol=2, frameon=False, bbox_to_anchor=(0.5, -0.01)
        )
        fig.subplots_adjust(left=0.30, right=0.97, top=0.95, bottom=0.2)
    else:  # short variant: the legend goes into the empty right part of the CS/AI panel
        axes[-1].legend(handles=handles, loc="center right", frameon=False)
        fig.subplots_adjust(left=0.30, right=0.97, top=0.95, bottom=0.17)
    fig.savefig(FIG / name, bbox_inches="tight", pad_inches=0.02)
    plt.close(fig)


def selective() -> None:
    rows = read_csv(DATA / "selective_curve.csv")
    gmeta = json.loads(
        (ROOT / "results/tables/generation_test.meta.json").read_text(encoding="utf-8")
    )
    thr = float(gmeta["abstention_threshold"]["threshold"])
    fig, axes = plt.subplots(1, 2, figsize=(COLW, 1.75), sharey=True)
    style = {
        "G2": (BLUE, "-", "o", "G2 (no verification)"),
        "G4": (ORANGE, "--", "s", "G4 (guards + critic)"),
    }
    for ax, c in zip(axes, ("cl", "cs"), strict=False):
        for s in ("G2", "G4"):
            pts = [
                r
                for r in rows
                if r["collection"] == c
                and r["system"] == s
                and r["accuracy_answered"] not in ("", None)
                and int(r["n_answered"]) >= MIN_ANSWERED
            ]
            pts.sort(key=lambda r: float(r["coverage"]))
            xs = [float(r["coverage"]) for r in pts]
            ys = [float(r["accuracy_answered"]) for r in pts]
            color, ls, mk, lab = style[s]
            ax.plot(
                xs,
                ys,
                color=color,
                linestyle=ls,
                linewidth=1.1,
                drawstyle="steps-post",
                label=lab,
                zorder=2,
            )
            ax.plot(
                xs[-1:],
                ys[-1:],
                marker=mk,
                color=color,
                markersize=4,
                markeredgecolor="white",
                markeredgewidth=0.6,
                zorder=3,
                linestyle="none",
            )
        if c == "cl":
            g4 = [
                r
                for r in rows
                if r["collection"] == "cl"
                and r["system"] == "G4"
                and r["threshold"] not in ("", None)
                and float(r["threshold"]) >= thr - 1e-9
            ]
            p = min(g4, key=lambda r: float(r["threshold"]))
            ax.plot(
                [float(p["coverage"])],
                [float(p["accuracy_answered"])],
                marker="*",
                color=INK,
                markersize=7,
                zorder=4,
                linestyle="none",
            )
            ax.annotate(
                "G5: dev-tuned\nthreshold",
                (float(p["coverage"]), float(p["accuracy_answered"])),
                xytext=(-2, -26),
                textcoords="offset points",
                fontsize=6,
                color=INK,
                ha="center",
                arrowprops={"arrowstyle": "-", "color": MUTED, "linewidth": 0.5},
            )
        ax.set_title(LABEL[c], loc="left", color=INK, pad=3)
        ax.set_xlim(0, 1)
        ax.set_ylim(0, 1)
        ax.grid(color=GRID, linewidth=0.5, zorder=0)
        ax.set_xlabel("Coverage (share answered)")
        ax.set_xticks([0, 0.25, 0.5, 0.75, 1.0], ["0", ".25", ".5", ".75", "1"])
    axes[0].set_ylabel("Accuracy of\nreleased answers")
    from matplotlib.lines import Line2D

    handles, labels = axes[1].get_legend_handles_labels()
    handles.append(Line2D([], [], marker="o", color=MUTED, linestyle="none", markersize=4))
    labels.append("marker: no threshold")
    axes[1].legend(handles, labels, loc="upper right", frameon=False, handlelength=2.2, fontsize=6)
    fig.subplots_adjust(left=0.13, right=0.98, top=0.9, bottom=0.22, wspace=0.12)
    fig.savefig(FIG / "selective.pdf", bbox_inches="tight", pad_inches=0.02)
    plt.close(fig)


def latency() -> None:
    web = json.loads((DATA / "web_latency.json").read_text(encoding="utf-8"))
    rl = json.loads((DATA / "research_latency.json").read_text(encoding="utf-8"))
    ab = json.loads(
        (ROOT / "results/tables/generation_test_ablation.meta.json").read_text(encoding="utf-8")
    )
    llm_mean = float(ab["cost"]["G2H"]["api_latency_ms_mean"])
    seg = {
        "ret": (BLUE, "", "Retrieval"),
        "syn": (AQUA, "....", "Synthesizer LLM"),
        "cri": (ORANGE, "/////", "Critic LLM"),
    }

    fig, (a1, a2) = plt.subplots(
        2, 1, figsize=(COLW, 2.5), gridspec_kw={"height_ratios": [2, 4], "hspace": 0.7}
    )

    def bars(
        ax: plt.Axes, items: list[tuple[str, dict[str, float]]], scale: float, unit: str
    ) -> None:
        for i, (_label, parts) in enumerate(items[::-1]):
            left = 0.0
            for k in ("ret", "syn", "cri"):
                v = parts.get(k, 0.0) / scale
                if v <= 0:
                    continue
                color, hatch, _ = seg[k]
                ax.barh(
                    i,
                    v,
                    left=left,
                    height=0.55,
                    color=color,
                    hatch=hatch,
                    edgecolor="white",
                    linewidth=0.8,
                    zorder=2,
                )
                left += v
            ax.text(
                left,
                i,
                f"  {left:.1f} {unit}" if unit == "s" else f"  {left:,.0f} {unit}",
                va="center",
                ha="left",
                fontsize=6.3,
                color=INK,
            )
        ax.set_yticks(range(len(items)), [x[0] for x in items[::-1]])
        ax.tick_params(axis="y", length=0)
        ax.grid(axis="x", color=GRID, linewidth=0.5, zorder=0)
        ax.set_xlim(0, max(sum(p.values()) for _, p in items) / scale * 1.28)

    bars(
        a1,
        [
            (
                "Web app, estimate\n(browser + API)",
                {"ret": web["embed_plus_search_ms"]["mean"], "syn": llm_mean},
            ),
            (
                "Research G2H\n(hosted LLM)",
                {
                    "ret": rl["cl.G2H"]["retrieval_mean_ms"],
                    "syn": rl["cl.G2H"]["synthesis_mean_ms"],
                },
            ),
        ],
        1.0,
        "ms",
    )
    a1.set_title("(a) Hosted LLM: mean ms per question", loc="left", color=INK, pad=3)
    items = []
    for c in ("cl", "cs"):
        for s in ("G2", "G4"):
            v = rl[f"{c}.{s}"]
            items.append(
                (
                    f"{s}, {LABEL[c]}",
                    {
                        "ret": v["retrieval_mean_ms"],
                        "syn": v["synthesis_mean_ms"],
                        "cri": v["critic_mean_ms"],
                    },
                )
            )
    bars(a2, items, 1000.0, "s")
    a2.set_title("(b) Local qwen2.5:3b on CPU: mean s per question", loc="left", color=INK, pad=3)
    handles = [
        Patch(facecolor=seg[k][0], hatch=seg[k][1], edgecolor="white", label=seg[k][2])
        for k in ("ret", "syn", "cri")
    ]
    fig.legend(
        handles=handles, loc="lower center", ncol=3, frameon=False, bbox_to_anchor=(0.5, -0.01)
    )
    fig.subplots_adjust(left=0.29, right=0.97, top=0.93, bottom=0.19)
    fig.savefig(FIG / "latency.pdf", bbox_inches="tight", pad_inches=0.02)
    plt.close(fig)
    assert not math.isnan(llm_mean)


def main() -> int:
    FIG.mkdir(parents=True, exist_ok=True)
    retrieval_deltas()
    retrieval_deltas("retrieval_deltas_ieee.pdf", width=IEEE_COLW, row_h=0.22)
    selective()
    latency()
    print("wrote", ", ".join(p.name for p in sorted(FIG.glob("*.pdf"))))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
