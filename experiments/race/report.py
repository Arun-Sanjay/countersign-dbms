"""Export the analysis views to CSV, draw the charts and write results/results.md.

Run after harness.py and analysis.sql (the views exp.v_* must exist):
  uv run --python 3.12 --with asyncpg --with matplotlib experiments/race/report.py
"""
from __future__ import annotations

import asyncio
import csv
import gzip
import os
from pathlib import Path

import asyncpg
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.colors import LinearSegmentedColormap  # noqa: E402

DSN = os.environ.get("RACE_DSN", "postgresql://postgres:localdev@localhost:55433/race")
OUT = Path(__file__).resolve().parent / "results"
STRATS = ["S1", "S2", "S3", "S4", "S6", "S7"]
STRAT_LABEL = {
    "S1": "S1 naive check-then-insert",
    "S2": "S2 fixture trigger (Q35)",
    "S3": "S3 conditional counter",
    "S4": "S4 S1 + retry on 40001",
    "S6": "S6 declarative seats",
    "S7": "S7 write-the-parent (v2)",
}
ISOS = ["READ COMMITTED", "REPEATABLE READ", "SERIALIZABLE"]
ISO_SHORT = {"READ COMMITTED": "RC", "REPEATABLE READ": "RR", "SERIALIZABLE": "SER"}
NS = [2, 8, 32, 100]

# reference palette (dataviz skill, light mode): categorical slots in fixed order
SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300"]
OUTCOME_COLOR = {"admitted": "#2a78d6", "refused": "#eb6834", "40001 abort": "#1baf7a"}
INK, INK2, GRID, SURFACE = "#0b0b0b", "#52514e", "#e4e3df", "#fcfcfb"
SEQ = LinearSegmentedColormap.from_list(
    "blue_seq", ["#f4f8fd", "#cde2fb", "#86b6ef", "#3987e5", "#1c5cab", "#0d366b"])

plt.rcParams.update({
    "figure.facecolor": SURFACE, "axes.facecolor": SURFACE, "savefig.facecolor": SURFACE,
    "axes.edgecolor": GRID, "axes.labelcolor": INK2, "xtick.color": INK2, "ytick.color": INK2,
    "text.color": INK, "font.size": 10, "axes.spines.top": False, "axes.spines.right": False,
    "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.8, "axes.axisbelow": True,
})


def write_csv(path: Path, rows: list[asyncpg.Record], gz: bool = False) -> None:
    opener = gzip.open if gz else open
    with opener(path, "wt", newline="") as f:
        w = csv.writer(f)
        if rows:
            w.writerow(rows[0].keys())
            w.writerows([list(r.values()) for r in rows])


def save(fig, name: str) -> None:
    for ext in ("svg", "png"):
        fig.savefig(OUT / f"{name}.{ext}", dpi=160, bbox_inches="tight")
    plt.close(fig)


def md_table(rows: list[dict], cols: list[str], header: list[str] | None = None) -> str:
    header = header or cols
    out = ["| " + " | ".join(header) + " |", "|" + "|".join("---" for _ in cols) + "|"]
    for r in rows:
        out.append("| " + " | ".join("" if r[c] is None else str(r[c]) for c in cols) + " |")
    return "\n".join(out)


async def main() -> None:
    OUT.mkdir(exist_ok=True)
    db = await asyncpg.connect(DSN)
    iso_order = "array_position(ARRAY['READ COMMITTED','REPEATABLE READ','SERIALIZABLE'], isolation)"

    cells = await db.fetch(f"SELECT * FROM exp.v_cell_summary ORDER BY strategy, {iso_order}, n_clients")
    write_csv(OUT / "cell_summary.csv", cells)

    excess = await db.fetch(f"""
        SELECT strategy, isolation, n_clients, avg(final_size - max_size) AS mean_excess,
               max(final_size - max_size) AS worst_excess, avg(over_admitted::int) AS over_rate
        FROM exp.experiment_run GROUP BY 1,2,3 ORDER BY strategy, {iso_order}, n_clients""")
    write_csv(OUT / "over_admission_by_cell.csv", excess)

    mix = await db.fetch(f"""
        SELECT r.strategy, r.isolation, r.n_clients,
               count(*) FILTER (WHERE a.outcome = 'admitted')              AS admitted,
               count(*) FILTER (WHERE a.outcome = 'refused')               AS refused,
               count(*) FILTER (WHERE a.outcome = 'serialization_failure') AS serialization_failure,
               count(*) FILTER (WHERE a.outcome = 'deadlock')              AS deadlock,
               count(*) FILTER (WHERE a.outcome = 'error')                 AS error,
               string_agg(DISTINCT a.sqlstate, ',')                        AS sqlstates
        FROM exp.experiment_run r JOIN exp.experiment_attempt a USING (run_id)
        GROUP BY 1,2,3 ORDER BY r.strategy, {iso_order.replace('isolation', 'r.isolation')}, r.n_clients""")
    write_csv(OUT / "outcome_mix.csv", mix)

    ser = await db.fetch(f"""
        SELECT strategy, isolation, count(*) AS runs,
               count(*) FILTER (WHERE verdict = 'conflict-serializable')     AS conflict_serializable,
               count(*) FILTER (WHERE verdict = 'NOT conflict-serializable') AS not_conflict_serializable,
               count(*) FILTER (WHERE over_admitted)                          AS over_admitted,
               count(*) FILTER (WHERE (cycle IS NOT NULL) = over_admitted)    AS verdict_matches_outcome,
               count(*) FILTER (WHERE cycle IS NULL AND cycle_incl_aborted IS NOT NULL) AS cycle_only_with_aborted,
               count(*) FILTER (WHERE cycle_broken_by_dbms)                   AS cycle_broken_by_dbms_abort
        FROM exp.v_run_serializability GROUP BY 1,2 ORDER BY strategy, {iso_order}""")
    write_csv(OUT / "serializability_n2.csv", ser)

    examples = await db.fetch("""
        SELECT DISTINCT ON (strategy, isolation) run_id, strategy, isolation,
               final_size || '/' || max_size AS size, logical_schedule, coalesce(edges, '(none)') AS edges,
               coalesce(cycle, equivalent_serial_order) AS cycle_or_serial_order, verdict,
               cycle_incl_aborted
        FROM exp.v_run_serializability ORDER BY strategy, isolation, trial_no""")
    write_csv(OUT / "schedule_examples_n2.csv", examples)

    runs = await db.fetch("SELECT * FROM exp.experiment_run ORDER BY run_id")
    write_csv(OUT / "experiment_run.csv.gz", runs, gz=True)
    meta = await db.fetchrow("""
        SELECT version() AS version, (SELECT count(*) FROM exp.experiment_run) AS runs,
               (SELECT count(*) FROM exp.experiment_attempt) AS attempts,
               (SELECT count(*) FROM exp.schedule_log) AS schedule_ops,
               (SELECT max(trial_no) FROM exp.experiment_run) AS trials,
               (SELECT count(*) FROM (SELECT DISTINCT strategy, isolation, n_clients
                                      FROM exp.experiment_run) c) AS cells,
               (SELECT min(started_at) FROM exp.experiment_run) AS first_run,
               (SELECT max(started_at) FROM exp.experiment_run) AS last_run""")
    await db.close()

    # ---------------- chart 1: mean over-admission heatmap ----------------
    grid = {(r["strategy"], r["isolation"], r["n_clients"]): float(r["mean_excess"]) for r in excess}
    cols = [(i, n) for i in ISOS for n in NS]
    data = [[grid.get((s, i, n), float("nan")) for (i, n) in cols] for s in STRATS]
    fig, ax = plt.subplots(figsize=(11, 4.2))
    im = ax.imshow([[min(v, 100) for v in row] for row in data], cmap=SEQ, aspect="auto", vmin=0, vmax=100)
    ax.grid(False)
    ax.set_yticks(range(len(STRATS)), [STRAT_LABEL[s] for s in STRATS])
    ax.set_xticks(range(len(cols)), [f"N={n}" for (_, n) in cols], fontsize=9)
    for k, iso in enumerate(ISOS):
        ax.text(k * 4 + 1.5, -0.85, iso, ha="center", va="bottom", fontsize=10, color=INK)
        if k:
            ax.axvline(k * 4 - 0.5, color=SURFACE, lw=4)
    for y, row in enumerate(data):
        for x, v in enumerate(row):
            label = "0" if v == 0 else (f"+{v:.0f}" if v >= 1 else f"+{v:.2f}")
            ax.text(x, y, label, ha="center", va="center", fontsize=9,
                    color="white" if v > 40 else INK)
    for sp in ax.spines.values():
        sp.set_visible(False)
    cb = fig.colorbar(im, ax=ax, fraction=0.025, pad=0.01)
    cb.set_label("members above max_size (mean per trial)", color=INK2)
    cb.outline.set_visible(False)
    ax.set_title("Over-admission of T02 (max 4, one free seat): mean extra members per race",
                 loc="left", fontsize=12, pad=26)
    save(fig, "over_admission_heatmap")

    # ---------------- chart 2: outcome mix, small multiples by isolation (N = 32) --------
    mixd = {(r["strategy"], r["isolation"], r["n_clients"]): r for r in mix}
    fig, axes = plt.subplots(1, 3, figsize=(12, 3.8), sharey=True)
    for ax, iso in zip(axes, ISOS):
        left = [0.0] * len(STRATS)
        for key, field in (("admitted", "admitted"), ("refused", "refused"),
                           ("40001 abort", "serialization_failure")):
            vals = []
            for s in STRATS:
                r = mixd[(s, iso, 32)]
                tot = r["admitted"] + r["refused"] + r["serialization_failure"] + r["deadlock"] + r["error"]
                vals.append(100.0 * r[field] / tot)
            ax.barh(range(len(STRATS)), vals, left=left, color=OUTCOME_COLOR[key], label=key,
                    height=0.62, edgecolor=SURFACE, linewidth=1.5)
            left = [a + b for a, b in zip(left, vals)]
        ax.set_title(iso, loc="left", fontsize=11)
        ax.set_xlim(0, 100)
        ax.set_xlabel("% of 32 attempts per race")
        ax.grid(axis="y", visible=False)
        ax.invert_yaxis()
    axes[0].set_yticks(range(len(STRATS)), [STRAT_LABEL[s] for s in STRATS])
    axes[0].legend(loc="upper left", bbox_to_anchor=(0, -0.2), ncol=3, frameon=False)
    fig.suptitle("How the 32 racers ended (N = 32): admitted / refused 'team full' / aborted with 40001",
                 x=0.01, ha="left", fontsize=12)
    fig.tight_layout()
    save(fig, "outcome_mix_n32")

    # ---------------- chart 3: p95 latency vs N, small multiples by isolation ------------
    cd = {(r["strategy"], r["isolation"], r["n_clients"]): r for r in cells}
    fig, axes = plt.subplots(1, 3, figsize=(12, 4.4), sharey=True)
    xs = list(range(len(NS)))
    for ax, iso in zip(axes, ISOS):
        for s, color in zip(STRATS, SERIES):
            ys = [float(cd[(s, iso, n)]["p95_ms"]) for n in NS]
            ax.plot(xs, ys, color=color, lw=2, marker="o", ms=5, label=STRAT_LABEL[s])
        ax.set_yscale("log")
        ax.set_xticks(xs, [str(n) for n in NS])
        ax.set_title(iso, loc="left", fontsize=11)
        ax.set_xlabel("N concurrent clients")
        ax.grid(axis="x", visible=False)
    axes[0].set_ylabel("p95 attempt latency (ms, log scale)")
    handles, labels = axes[0].get_legend_handles_labels()
    fig.legend(handles, labels, loc="lower center", ncol=3, frameon=False, bbox_to_anchor=(0.5, -0.02))
    fig.suptitle("Cost of correctness: p95 latency of an attempt (barrier release -> final outcome)",
                 x=0.01, ha="left", fontsize=12)
    fig.tight_layout(rect=(0, 0.12, 1, 1))
    save(fig, "latency_p95")

    # ---------------- results.md ----------------
    def pct(x):
        return f"{100 * float(x):.0f}%"

    over_rows = []
    for s in STRATS:
        row = {"strategy": STRAT_LABEL[s]}
        for iso in ISOS:
            rs = [r for r in excess if r["strategy"] == s and r["isolation"] == iso]
            rate = sum(float(r["over_rate"]) for r in rs) / len(rs)
            worst = max(int(r["worst_excess"]) for r in rs)
            row[ISO_SHORT[iso]] = f"{pct(rate)} (worst {4 + worst}/4)" if worst > 0 else "0% (4/4)"
        over_rows.append(row)

    cell_rows = [{
        "s": r["strategy"], "iso": ISO_SHORT[r["isolation"]], "n": r["n_clients"], "trials": r["trials"],
        "over": f'{r["over_admission_pct"]}%', "worst": r["worst_size"], "adm": r["mean_admitted"],
        "a40001": r["mean_aborts_40001"], "ref": r["mean_refused"], "retry": r["mean_retries"],
        "p50": r["p50_ms"], "p95": r["p95_ms"]} for r in cells]

    ser_rows = [{**dict(r), "isolation": ISO_SHORT[r["isolation"]]} for r in ser]
    ex_rows = [{**dict(r), "isolation": ISO_SHORT[r["isolation"]],
                "cycle_incl_aborted": r["cycle_incl_aborted"] or "-"} for r in examples]

    md = f"""# Component 10 results — the last team slot (generated by report.py)

Data: {meta['runs']:,} races ({meta['trials']} trials per cell, {meta['cells']} cells), {meta['attempts']:,} attempts,
{meta['schedule_ops']:,} logged schedule operations. {meta['version'].split(' on ')[0]},
Docker container `elp-race-pg` (default server settings except `max_connections=300`),
client asyncpg on the same machine. Runs from {meta['first_run']:%Y-%m-%d %H:%M} to {meta['last_run']:%H:%M} UTC.
Target: Team Beta (T02), `max_size` 4, 3 members, so exactly **one** seat is free.

{{CONCLUSIONS}}

## 1. Over-admission rate (all N pooled; worst final size in brackets)

{md_table(over_rows, ["strategy", "RC", "RR", "SER"], ["strategy", "READ COMMITTED", "REPEATABLE READ", "SERIALIZABLE"])}

![over-admission heatmap](over_admission_heatmap.svg)

## 2. Full matrix (per strategy x isolation x N)

`over` = share of races that ended above 4/4; `adm` = mean attempts admitted per race (1 is
correct); `40001` = mean serialization failures per race (S4 counts every retried one too);
`ref` = mean attempts refused "team is full"; latency = per attempt, barrier release to final
outcome, including retries, in ms.

{md_table(cell_rows, ["s","iso","n","trials","over","worst","adm","a40001","ref","retry","p50","p95"],
          ["strategy","iso","N","trials","over","worst","adm","40001","ref","retries","p50 ms","p95 ms"])}

![outcome mix](outcome_mix_n32.svg)

![latency](latency_p95.svg)

## 3. Conflict serializability of the N = 2 runs (LOGICAL client-recorded schedule)

Precedence graph built in SQL from `exp.schedule_log` (committed projection), cycles found
with `WITH RECURSIVE`. `cycle only with aborted` = runs whose graph *including aborted
transactions* has a cycle that the committed projection does not. `broken by DBMS abort` =
the subset where a transaction on that cycle was killed by the DBMS (40001), i.e. SSI broke
the cycle. The rest are RC losers that read the seat set twice (before and after the
winner's commit, a non-repeatable read) and then rolled back on their own after "no free
seat". **Consistency check, not independent evidence:** a correct race commits one
transaction, so its committed graph has one node and is acyclic by construction; see README
"Logical schedule". `analysis_selftest.sql` tests the graph SQL on non-trivial schedules.

{md_table(ser_rows, ["strategy","isolation","runs","conflict_serializable","not_conflict_serializable","over_admitted","verdict_matches_outcome","cycle_only_with_aborted","cycle_broken_by_dbms_abort"],
          ["strategy","iso","runs","CS","not CS","over-admitted","verdict = outcome","cycle only with aborted","broken by DBMS abort"])}

Example schedule per cell (first trial). Notation `r1(x)` = T1 reads x; `a1[40001]` = T1
aborted by the DBMS, `a1[refused]` = T1 rolled back after "team is full"; `members:T02` is the
predicate "members of T02" (what COUNT reads and INSERT changes).

{md_table(ex_rows, ["strategy","isolation","size","logical_schedule","edges","cycle_or_serial_order","cycle_incl_aborted"],
          ["strategy","iso","size","logical schedule","edges","cycle / serial order","cycle incl. aborted"])}

Files: `cell_summary.csv`, `over_admission_by_cell.csv`, `outcome_mix.csv`,
`serializability_n2.csv`, `schedule_examples_n2.csv`, `experiment_run.csv.gz`,
`analysis_output.txt` (psql output of analysis.sql), `analysis_selftest_output.txt`
(precedence-graph SQL on hand-solved schedules), `harness_log.txt`, `demo_locks_*.txt`.
"""
    conclusions_file = OUT / "conclusions.md"  # hand-written, kept across re-runs
    conclusions = conclusions_file.read_text() if conclusions_file.exists() else "## Headline\n\n(see FINDINGS.md)"
    (OUT / "results.md").write_text(md.replace("{CONCLUSIONS}", conclusions.strip()))
    print("wrote", OUT / "results.md")


if __name__ == "__main__":
    asyncio.run(main())
