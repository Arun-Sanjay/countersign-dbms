#!/usr/bin/env bash
# Rebuild Component 6 (Normalization): Graphviz diagrams -> SVG/PNG, then
# C6_Normalization.md -> C6_Normalization.pdf (A4, xelatex) and C6_Normalization.docx (pandoc).
# Needs Docker. Usage: docs/lab/build_c6.sh
# Both the PDF and the DOCX embed the 200-dpi PNG figures (each is scaled to the text width,
# which keeps node text at 8 pt or more in print); the SVGs are kept as vector sources.
set -euo pipefail
cd "$(dirname "$0")"
DOT_IMG=nshine/dot
PANDOC_IMG=pandoc/latex:latest

for f in diagrams/c6/c6_*.dot; do
  b=${f%.dot}
  docker run --rm --platform linux/amd64 -v "$PWD":/w -w /w "$DOT_IMG" dot -Tsvg "$f" -o "$b.svg"
  docker run --rm --platform linux/amd64 -v "$PWD":/w -w /w "$DOT_IMG" dot -Tpng -Gdpi=200 "$f" -o "$b.png"
done

# DejaVu fonts (the pandoc image ships only Latin Modern, which lacks some symbols)
FONTS=$(mktemp -d)
trap 'rm -rf "$FONTS"' EXIT
docker run --rm --platform linux/amd64 -v "$FONTS":/out --entrypoint sh "$DOT_IMG" \
  -c 'cp /usr/share/fonts/ttf-dejavu/DejaVuSerif*.ttf /usr/share/fonts/ttf-dejavu/DejaVuSans*.ttf /out/'

docker run --rm --platform linux/amd64 -v "$PWD":/data -v "$FONTS":/fonts -w /data "$PANDOC_IMG" \
  C6_Normalization.md -o C6_Normalization.pdf --pdf-engine=xelatex --toc --toc-depth=2 --resource-path=. \
  -V papersize=a4 -V geometry:a4paper,margin=2cm -V fontsize=10pt \
  -V mainfont=DejaVuSerif.ttf \
  -V 'mainfontoptions=Path=/fonts/,BoldFont=DejaVuSerif-Bold.ttf,ItalicFont=DejaVuSerif-Italic.ttf,BoldItalicFont=DejaVuSerif-BoldItalic.ttf' \
  -V sansfont=DejaVuSans.ttf -V 'sansfontoptions=Path=/fonts/,BoldFont=DejaVuSans-Bold.ttf' \
  -V monofont=DejaVuSansMono.ttf -V 'monofontoptions=Path=/fonts/,BoldFont=DejaVuSansMono-Bold.ttf,Scale=0.82' \
  -V colorlinks=true -V linkcolor=black -V urlcolor=blue -H c6_pdf_header.tex

docker run --rm --platform linux/amd64 -v "$PWD":/data -w /data "$PANDOC_IMG" \
  C6_Normalization.md -o C6_Normalization.docx --toc --toc-depth=2 --resource-path=.
echo "built: C6_Normalization.pdf C6_Normalization.docx"
