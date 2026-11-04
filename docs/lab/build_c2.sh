#!/usr/bin/env bash
# Rebuild Component 2 (SRS), revision 1.2:
#   1. diagrams (Graphviz, docker image nshine/dot): diagrams/c2_fig*.dot -> .svg and 200-dpi .png
#   2. pre-flight: figure legibility (>= 8 pt printed on A4) and body-font glyph coverage
#   3. Word style sheet c2_reference.docx (Times New Roman 12 pt, RVCE header, page numbers)
#   4. Markdown -> PDF (xelatex) and DOCX (pandoc), with the RVCE cover via c2_rvce.lua
# Needs Docker and uv. Body font: Times New Roman (macOS supplemental font, mounted read-only
# into the pandoc container); monospace: DejaVu Sans Mono (copied from the Graphviz image).
# Usage: docs/lab/build_c2.sh
set -euo pipefail
cd "$(dirname "$0")"
DOT_IMG=nshine/dot
PANDOC_IMG=pandoc/latex:latest
TNR_DIR="${TNR_DIR:-/System/Library/Fonts/Supplemental}"
[[ -f "$TNR_DIR/Times New Roman.ttf" ]] || { echo "Times New Roman not found in $TNR_DIR" >&2; exit 2; }

# 1. diagrams
for f in diagrams/c2_fig*.dot; do
  b=${f%.dot}
  docker run --rm --platform linux/amd64 -v "$PWD":/w -w /w/diagrams "$DOT_IMG" dot -Tsvg "${f#diagrams/}" -o "${b#diagrams/}.svg"
  docker run --rm --platform linux/amd64 -v "$PWD":/w -w /w/diagrams "$DOT_IMG" dot -Tpng -Gdpi=200 "${f#diagrams/}" -o "${b#diagrams/}.png"
done

# 2. pre-flight checks
uv run -q --no-project --with fonttools python c2_check_figures.py C2_SRS.md "$TNR_DIR/Times New Roman.ttf"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/fonts"
docker run --rm --platform linux/amd64 -v "$WORK/fonts":/out --entrypoint sh "$DOT_IMG" \
  -c 'cp /usr/share/fonts/ttf-dejavu/DejaVuSansMono*.ttf /usr/share/fonts/ttf-dejavu/DejaVuSans*.ttf /out/'
cp "$TNR_DIR"/Times\ New\ Roman*.ttf "$WORK/fonts/"

# 3. Word reference document
docker run --rm --platform linux/amd64 "$PANDOC_IMG" -o /dev/stdout --print-default-data-file reference.docx > "$WORK/default.docx"
uv run -q --no-project --with python-docx python c2_make_reference_docx.py "$WORK/default.docx" c2_reference.docx

# 4. PDF and DOCX
docker run --rm --platform linux/amd64 -v "$PWD":/data -v "$WORK/fonts":/fonts:ro -w /data "$PANDOC_IMG" \
  C2_SRS.md -o C2_SRS.pdf --pdf-engine=xelatex --lua-filter=c2_rvce.lua --resource-path=. \
  -V geometry:a4paper,margin=2cm -V fontsize=11pt -V linestretch=1.1 \
  -V mainfont="Times New Roman.ttf" \
  -V 'mainfontoptions=Path=/fonts/,BoldFont=Times New Roman Bold.ttf,ItalicFont=Times New Roman Italic.ttf,BoldItalicFont=Times New Roman Bold Italic.ttf' \
  -V sansfont=DejaVuSans.ttf -V 'sansfontoptions=Path=/fonts/,BoldFont=DejaVuSans-Bold.ttf' \
  -V monofont=DejaVuSansMono.ttf -V 'monofontoptions=Path=/fonts/,BoldFont=DejaVuSansMono-Bold.ttf,Scale=0.85' \
  -V colorlinks=true -V linkcolor=black -V urlcolor=blue -H c2_pdf_header.tex
docker run --rm --platform linux/amd64 -v "$PWD":/data -w /data "$PANDOC_IMG" \
  C2_SRS.md -o C2_SRS.docx --lua-filter=c2_rvce.lua --resource-path=. --reference-doc=c2_reference.docx
echo "built: C2_SRS.pdf C2_SRS.docx"
