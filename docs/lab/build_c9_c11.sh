#!/usr/bin/env bash
# Build Component 9 (Demo and Draft Report) and Component 11 (Final Report):
#   1. diagrams (Graphviz, docker image nshine/dot): diagrams/c9/*.dot -> .svg and 200-dpi .png
#   2. screenshot crops: diagrams/c9/crop_screens.py (web/screenshots -> diagrams/c9/shots)
#   3. Appendix A of C11: c11/gen_schema_listing.py reads the LOCAL Supabase catalog (read only)
#      and the result is spliced into C11_Final_Report.md between the "generated" markers.
#      Skipped (the last listing is kept) when the local database container is not running.
#   4. pre-flight: figure legibility (>= 8 pt printed) and glyph coverage (c2_check_figures.py)
#   5. Word style sheets from c2_make_reference_docx.py, with each document's running head
#   6. Markdown -> PDF (xelatex) and DOCX (pandoc), RVCE cover and contents via c2_rvce.lua
# Same toolchain and styling as build_c2.sh (Times New Roman body, DejaVu Sans Mono code).
# Needs Docker and uv. Usage: docs/lab/build_c9_c11.sh
set -euo pipefail
cd "$(dirname "$0")"
LAB=$PWD
ROOT=$(cd ../.. && pwd)
DOT_IMG=nshine/dot
PANDOC_IMG=pandoc/latex:latest
DB_CONTAINER=${DB_CONTAINER:-supabase_db_countersign-dbms}
TNR_DIR="${TNR_DIR:-/System/Library/Fonts/Supplemental}"
[[ -f "$TNR_DIR/Times New Roman.ttf" ]] || { echo "Times New Roman not found in $TNR_DIR" >&2; exit 2; }

# 1. diagrams
for f in diagrams/c9/c9_fig*.dot; do
  b=$(basename "${f%.dot}")
  docker run --rm --platform linux/amd64 -v "$LAB/diagrams/c9":/w -w /w "$DOT_IMG" dot -Tsvg "$b.dot" -o "$b.svg"
  docker run --rm --platform linux/amd64 -v "$LAB/diagrams/c9":/w -w /w "$DOT_IMG" dot -Tpng -Gdpi=200 "$b.dot" -o "$b.png"
done

# 2. screenshot crops
uv run -q --no-project --with pillow python diagrams/c9/crop_screens.py "$ROOT"

# 3. schema listing (read-only catalog query) and splice into C11
if docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
  python3 c11/gen_schema_listing.py "$DB_CONTAINER"
else
  echo "note: $DB_CONTAINER is not running; keeping the existing c11/schema_listing.md"
fi
python3 - <<'PY'
s = open("C11_Final_Report.md").read()
a, b = "<!-- BEGIN generated: c11/schema_listing.md -->", "<!-- END generated -->"
i = s.index(a) + len(a)
j = s.index(b, i)
s = s[:i] + "\n" + open("c11/schema_listing.md").read().rstrip("\n") + "\n" + s[j:]
open("C11_Final_Report.md", "w").write(s)
PY

# 4. pre-flight checks
for md in C9_Demo_and_Draft_Report.md C11_Final_Report.md; do
  uv run -q --no-project --with fonttools python c2_check_figures.py "$md" "$TNR_DIR/Times New Roman.ttf"
done

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/fonts"
docker run --rm --platform linux/amd64 -v "$WORK/fonts":/out --entrypoint sh "$DOT_IMG" \
  -c 'cp /usr/share/fonts/ttf-dejavu/DejaVuSansMono*.ttf /usr/share/fonts/ttf-dejavu/DejaVuSans*.ttf /out/'
cp "$TNR_DIR"/Times\ New\ Roman*.ttf "$WORK/fonts/"
docker run --rm --platform linux/amd64 "$PANDOC_IMG" -o /dev/stdout --print-default-data-file reference.docx > "$WORK/default.docx"

build() {  # $1 = document stem, $2 = running head
  local stem=$1 head=$2
  # 5. Word reference document with this document's running head
  uv run -q --no-project --with python-docx python - "$WORK/default.docx" "$WORK/$stem.ref.docx" "$head" <<'PY'
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
PY
  { cat c9_c11_pdf_header.tex; printf '\\fancyhead[R]{\\footnotesize %s}\n' "$head"; } > "$WORK/$stem.header.tex"
  # 6. PDF and DOCX (the repository root is mounted so that ../../web/screenshots etc. resolve)
  docker run --rm --platform linux/amd64 -v "$ROOT":/repo -v "$WORK":/work -w /repo/docs/lab "$PANDOC_IMG" \
    "$stem.md" -o "$stem.pdf" --pdf-engine=xelatex --lua-filter=c2_rvce.lua --resource-path=. \
    -V geometry:a4paper,margin=2cm -V fontsize=11pt -V linestretch=1.1 \
    -V mainfont="Times New Roman.ttf" \
    -V 'mainfontoptions=Path=/work/fonts/,BoldFont=Times New Roman Bold.ttf,ItalicFont=Times New Roman Italic.ttf,BoldItalicFont=Times New Roman Bold Italic.ttf' \
    -V sansfont=DejaVuSans.ttf -V 'sansfontoptions=Path=/work/fonts/,BoldFont=DejaVuSans-Bold.ttf' \
    -V monofont=DejaVuSansMono.ttf -V 'monofontoptions=Path=/work/fonts/,BoldFont=DejaVuSansMono-Bold.ttf,Scale=0.85' \
    -V colorlinks=true -V linkcolor=black -V urlcolor=blue -H "/work/$stem.header.tex"
  docker run --rm --platform linux/amd64 -v "$ROOT":/repo -v "$WORK":/work -w /repo/docs/lab "$PANDOC_IMG" \
    "$stem.md" -o "$stem.docx" --lua-filter=c2_rvce.lua --resource-path=. --reference-doc="/work/$stem.ref.docx"
  echo "built: $stem.pdf $stem.docx"
}
build C9_Demo_and_Draft_Report "Lab Component 9: Demo and Draft Report"
build C11_Final_Report "Lab Component 11: Final Report"
