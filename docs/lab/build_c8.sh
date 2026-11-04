#!/usr/bin/env bash
# Rebuild Component 8 (Forms, Security and Validation):
#   0. (optional, REGEN=1) regenerate the evidence tables from the LOCAL Supabase stack:
#        docs/lab/diagrams/c8/gen_c8.py  (read-only; see its header)
#   1. splice docs/lab/diagrams/c8/generated/*.md into the marked sections of the .md
#   2. Graphviz (docker image nshine/dot): diagrams/c8/c8_*.dot -> .svg and 200-dpi .png
#   3. C8_Forms_Security_Validation.md -> .pdf (A4, xelatex) and .docx (pandoc/latex image)
# RVCE cover block and contents via c2_rvce.lua, as in C2, C7, C9 and C11. Needs Docker and uv (and, for REGEN=1, uv, node and the local stack). Usage: docs/lab/build_c8.sh
# Screenshots (docs/lab/screenshots/c8_*.png) are taken separately; see the document, section 0.
set -euo pipefail
cd "$(dirname "$0")"
DOT_IMG=nshine/dot
PANDOC_IMG=pandoc/latex:latest
DOC=C8_Forms_Security_Validation

if [[ "${REGEN:-0}" == "1" ]]; then
  (cd ../.. && uv run -q --python 3.12 --no-project --with httpx python docs/lab/diagrams/c8/gen_c8.py)
fi

# 1. splice generated sections
python3 - "$DOC.md" <<'PY'
import re, sys
from pathlib import Path
p = Path(sys.argv[1])
s = p.read_text()
def fill(m):
    src = Path(m.group(1)).read_text().rstrip("\n")
    return f"<!-- BEGIN generated: {m.group(1)} -->\n\n{src}\n\n<!-- END generated -->"
s = re.sub(r"<!-- BEGIN generated: (\S+) -->.*?<!-- END generated -->", fill, s, flags=re.S)
p.write_text(s)
PY

# 2. diagrams
for f in diagrams/c8/c8_*.dot; do
  b=${f%.dot}
  docker run --rm --platform linux/amd64 -v "$PWD":/w -w /w "$DOT_IMG" dot -Tsvg "$f" -o "$b.svg"
  docker run --rm --platform linux/amd64 -v "$PWD":/w -w /w "$DOT_IMG" dot -Tpng -Gdpi=200 "$f" -o "$b.png"
done

# DejaVu fonts (the pandoc image ships only Latin Modern, which lacks some symbols)
FONTS=$(mktemp -d)
trap 'rm -rf "$FONTS"' EXIT
docker run --rm --platform linux/amd64 -v "$FONTS":/out --entrypoint sh "$DOT_IMG" \
  -c 'cp /usr/share/fonts/ttf-dejavu/DejaVuSerif*.ttf /usr/share/fonts/ttf-dejavu/DejaVuSans*.ttf /out/'

# Word style sheet: the C2 reference (Times New Roman, centred "Cover" style for the RVCE cover
# block of c2_rvce.lua) with this document's running head.
docker run --rm --platform linux/amd64 "$PANDOC_IMG" -o /dev/stdout --print-default-data-file reference.docx > "$FONTS/default.docx"
uv run -q --no-project --with python-docx python - "$FONTS/default.docx" "$FONTS/ref.docx" "Lab Component 8: Forms, Security and Validation" <<'PY2'
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

# 3. PDF and DOCX
docker run --rm --platform linux/amd64 -v "$PWD":/data -v "$FONTS":/fonts -w /data "$PANDOC_IMG" \
  "$DOC.md" -o "$DOC.pdf" --pdf-engine=xelatex --lua-filter=c2_rvce.lua --resource-path=. \
  -V papersize=a4 -V geometry:a4paper,margin=2cm -V fontsize=10pt \
  -V mainfont=DejaVuSerif.ttf \
  -V 'mainfontoptions=Path=/fonts/,BoldFont=DejaVuSerif-Bold.ttf,ItalicFont=DejaVuSerif-Italic.ttf,BoldItalicFont=DejaVuSerif-BoldItalic.ttf' \
  -V sansfont=DejaVuSans.ttf -V 'sansfontoptions=Path=/fonts/,BoldFont=DejaVuSans-Bold.ttf' \
  -V monofont=DejaVuSansMono.ttf -V 'monofontoptions=Path=/fonts/,BoldFont=DejaVuSansMono-Bold.ttf,Scale=0.82' \
  -V colorlinks=true -V linkcolor=black -V urlcolor=blue -H c8_pdf_header.tex

docker run --rm --platform linux/amd64 -v "$PWD":/data -v "$FONTS":/fonts -w /data "$PANDOC_IMG" \
  "$DOC.md" -o "$DOC.docx" --lua-filter=c2_rvce.lua --resource-path=. --reference-doc=/fonts/ref.docx
echo "built: $DOC.pdf $DOC.docx"
