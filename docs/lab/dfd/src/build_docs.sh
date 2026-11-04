#!/usr/bin/env bash
# Assemble docs/lab/C5_DFD.md from the template + generated tables, then convert it to DOCX and
# PDF with pandoc in Docker (pandoc/latex, xelatex). Run render.sh first.
# Two passes: the second pass includes the legibility table measured on the first PDF
# (needs pdfimages from poppler on the host).
set -euo pipefail
LAB="$(cd "$(dirname "$0")/../.." && pwd)"
GEN="$LAB/dfd/generated"
[ -f "$GEN/legibility.md" ] || echo "_(measured after the first build)_" > "$GEN/legibility.md"

assemble() {
python3 - "$LAB" <<'PY'
import os, re, sys
lab = sys.argv[1]
src = os.path.join(lab, "dfd", "src", "C5_DFD.template.md")
gen = os.path.join(lab, "dfd", "generated")
text = open(src).read()
def sub(m):
    return open(os.path.join(gen, m.group(1) + ".md")).read().rstrip("\n")
text = re.sub(r"<!--GEN:([a-z0-9_]+)-->", sub, text)
assert "<!--GEN:" not in text
open(os.path.join(lab, "C5_DFD.md"), "w").write(text)
print("wrote C5_DFD.md")
PY
}
run_pandoc() {
  docker run --rm --platform linux/amd64 -v "$LAB":/w -w /w pandoc/latex:latest "$@"
}
pdf() {
  run_pandoc C5_DFD.md -o C5_DFD.pdf --resource-path=. --pdf-engine=xelatex --toc --toc-depth=2 \
    -H dfd/src/c5_header.tex -V geometry:a4paper,margin=1.7cm -V fontsize=10pt \
    -V colorlinks=true -V linkcolor=blue
}
assemble
pdf
python3 "$LAB/dfd/src/legibility.py" "$LAB/C5_DFD.md" "$LAB/C5_DFD.pdf"
assemble
pdf
run_pandoc C5_DFD.md -o C5_DFD.docx --resource-path=. --toc --toc-depth=2
python3 "$LAB/dfd/src/legibility.py" "$LAB/C5_DFD.md" "$LAB/C5_DFD.pdf"
echo "wrote C5_DFD.docx and C5_DFD.pdf"
