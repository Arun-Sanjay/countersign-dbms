#!/usr/bin/env bash
# Assemble docs/lab/C5_DFD.md from the template + generated tables, then convert it to DOCX and
# PDF with pandoc in Docker (pandoc/latex, xelatex). Run render.sh first.
# Two passes: the second pass includes the legibility table measured on the first PDF
# (needs pdfimages from poppler on the host). RVCE cover block and contents via ../../c2_rvce.lua,
# as in C2, C7, C9 and C11 (needs uv for the Word style sheet).
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
# Word style sheet: the C2 reference (centred "Cover" style for the RVCE cover block of
# c2_rvce.lua) with this document's running head; removed again at the end.
REF="$LAB/.c5_reference.docx"
docker run --rm --platform linux/amd64 pandoc/latex:latest -o /dev/stdout --print-default-data-file reference.docx > "$LAB/.c5_default.docx"
(cd "$LAB" && uv run -q --no-project --with python-docx python - .c5_default.docx .c5_reference.docx <<'PY2'
import sys
sys.path.insert(0, ".")
import c2_make_reference_docx as m
from docx import Document
src, dst = sys.argv[1:3]
m.main(src, dst)
doc = Document(dst)
for section in doc.sections:
    p = section.header.paragraphs[0]
    for r in p.runs[1:]:
        r.text = ""
    p.runs[0].text = "RV College of Engineering, Bengaluru · Dept. of CSE · CD252IA Database Management Systems · Lab Component 5: DFD"
doc.save(dst)
PY2
)
rm -f "$LAB/.c5_default.docx"
run_pandoc() {
  docker run --rm --platform linux/amd64 -v "$LAB":/w -w /w pandoc/latex:latest "$@"
}
pdf() {
  run_pandoc C5_DFD.md -o C5_DFD.pdf --resource-path=. --pdf-engine=xelatex --lua-filter=c2_rvce.lua \
    -H dfd/src/c5_header.tex -V geometry:a4paper,margin=1.7cm -V fontsize=10pt \
    -V colorlinks=true -V linkcolor=blue
}
assemble
pdf
python3 "$LAB/dfd/src/legibility.py" "$LAB/C5_DFD.md" "$LAB/C5_DFD.pdf"
assemble
pdf
run_pandoc C5_DFD.md -o C5_DFD.docx --resource-path=. --lua-filter=c2_rvce.lua --reference-doc=.c5_reference.docx
rm -f "$REF"
python3 "$LAB/dfd/src/legibility.py" "$LAB/C5_DFD.md" "$LAB/C5_DFD.pdf"
echo "wrote C5_DFD.docx and C5_DFD.pdf"
