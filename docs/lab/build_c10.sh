#!/usr/bin/env bash
# Rebuild Component 10 (Innovative Experiment): Graphviz diagrams -> SVG/PNG, then
# C10_Innovative_Experiment.md -> .pdf (A4, xelatex) and .docx (pandoc).
# RVCE cover block and contents via c2_rvce.lua, as in C2, C7, C9 and C11. Needs Docker and uv. Usage: docs/lab/build_c10.sh
# The three charts are not redrawn here: they are read from experiments/race/results/
# (written by experiments/race/report.py), so the repository root is mounted and pandoc runs
# in docs/lab. Same images, fonts and options as build_c6.sh.
set -euo pipefail
cd "$(dirname "$0")"
LAB="$PWD"
ROOT="$(cd ../.. && pwd)"
DOT_IMG=nshine/dot
PANDOC_IMG=pandoc/latex:latest

for f in diagrams/c10/c10_*.dot; do
  b=${f%.dot}
  docker run --rm --platform linux/amd64 -v "$LAB":/w -w /w "$DOT_IMG" dot -Tsvg "$f" -o "$b.svg"
  docker run --rm --platform linux/amd64 -v "$LAB":/w -w /w "$DOT_IMG" dot -Tpng -Gdpi=200 "$f" -o "$b.png"
done

# DejaVu fonts (the pandoc image ships only Latin Modern, which lacks some symbols)
FONTS=$(mktemp -d)
trap 'rm -rf "$FONTS"' EXIT
docker run --rm --platform linux/amd64 -v "$FONTS":/out --entrypoint sh "$DOT_IMG" \
  -c 'cp /usr/share/fonts/ttf-dejavu/DejaVuSerif*.ttf /usr/share/fonts/ttf-dejavu/DejaVuSans*.ttf /out/'

# Word style sheet: the C2 reference (Times New Roman, centred "Cover" style for the RVCE cover
# block of c2_rvce.lua) with this document's running head.
docker run --rm --platform linux/amd64 "$PANDOC_IMG" -o /dev/stdout --print-default-data-file reference.docx > "$FONTS/default.docx"
uv run -q --no-project --with python-docx python - "$FONTS/default.docx" "$FONTS/ref.docx" "Lab Component 10: Innovative Experiment" <<'PY2'
import sys
sys.path.insert(0, ".")
import c2_make_reference_docx as m
from docx import Document
src, dst, head = sys.argv[1:4]
m.main(src, dst)
doc = Document(dst)
for section in doc.sections:
    p = section.header.paragraphs[0]
    for r in p.runs[1:]:
        r.text = ""
    p.runs[0].text = "RV College of Engineering, Bengaluru · Dept. of CSE · CD252IA Database Management Systems · " + head
doc.save(dst)
PY2

docker run --rm --platform linux/amd64 -v "$ROOT":/data -v "$FONTS":/fonts -w /data/docs/lab "$PANDOC_IMG" \
  C10_Innovative_Experiment.md -o C10_Innovative_Experiment.pdf --pdf-engine=xelatex \
  --lua-filter=c2_rvce.lua --resource-path=. \
  -V papersize=a4 -V geometry:a4paper,margin=2cm -V fontsize=10pt \
  -V mainfont=DejaVuSerif.ttf \
  -V 'mainfontoptions=Path=/fonts/,BoldFont=DejaVuSerif-Bold.ttf,ItalicFont=DejaVuSerif-Italic.ttf,BoldItalicFont=DejaVuSerif-BoldItalic.ttf' \
  -V sansfont=DejaVuSans.ttf -V 'sansfontoptions=Path=/fonts/,BoldFont=DejaVuSans-Bold.ttf' \
  -V monofont=DejaVuSansMono.ttf -V 'monofontoptions=Path=/fonts/,BoldFont=DejaVuSansMono-Bold.ttf,Scale=0.82' \
  -V colorlinks=true -V linkcolor=black -V urlcolor=blue -H c10_pdf_header.tex

docker run --rm --platform linux/amd64 -v "$ROOT":/data -v "$FONTS":/fonts -w /data/docs/lab "$PANDOC_IMG" \
  C10_Innovative_Experiment.md -o C10_Innovative_Experiment.docx --lua-filter=c2_rvce.lua --resource-path=. \
  --reference-doc=/fonts/ref.docx
echo "built: C10_Innovative_Experiment.pdf C10_Innovative_Experiment.docx"
