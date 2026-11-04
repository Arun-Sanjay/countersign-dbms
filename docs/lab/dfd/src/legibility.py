#!/usr/bin/env python3
"""Measure the printed size of the diagram text in the built PDF.

Every PNG is rendered at 200 dpi, so a font of F points in the diagram measures
F x 200 / x_ppi points on paper, where x_ppi is the resolution at which LaTeX placed the image
(reported by `pdfimages -list`). Writes ../generated/legibility.md.

Usage: python3 legibility.py <C5_DFD.md> <C5_DFD.pdf>
"""
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dfd_model import EDGE_FONT, NODE_FONT  # noqa: E402

RENDER_DPI = 200
MIN_EDGE_PT = 7.0


def main(md_path, pdf_path):
    figs = re.findall(r"\]\((dfd/png/[a-z0-9_]+\.png)\)", open(md_path).read())
    out = subprocess.run(["pdfimages", "-list", pdf_path], capture_output=True, text=True, check=True).stdout
    rows = []
    for line in out.splitlines()[2:]:
        f = line.split()
        if len(f) > 13 and f[2] == "image":
            rows.append((int(f[0]), int(f[3]), int(f[4]), float(f[12])))
    if len(rows) != len(figs):
        sys.exit(f"legibility: {len(figs)} figures in the Markdown but {len(rows)} images in the PDF")
    table = ["| Diagram | PDF page | Pixels (200 dpi) | Placed at (ppi) | Edge labels in print (pt) | Node text in print (pt) | Result |",
             "|--|--|--|--|--|--|--|"]
    worst = 99.0
    for fig, (page, w, h, ppi) in zip(figs, rows):
        e = EDGE_FONT * RENDER_DPI / ppi
        n = NODE_FONT * RENDER_DPI / ppi
        worst = min(worst, e)
        table.append(f"| `{os.path.basename(fig)}` | {page} | {w} x {h} | {ppi:.0f} | {e:.1f} | {n:.1f} | "
                     f"{'PASS' if e >= MIN_EDGE_PT else 'FAIL'} |")
    gen = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "generated", "legibility.md")
    with open(gen, "w") as fh:
        fh.write("\n".join(table) + "\n")
    print(f"legibility: {len(rows)} diagrams, smallest edge label in print {worst:.1f} pt")
    if worst < MIN_EDGE_PT:
        sys.exit(1)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
