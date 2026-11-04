#!/bin/sh
# Build Component 3: figures (Graphviz) -> C3_ER.pdf and C3_ER.docx (pandoc). Needs Docker.
#   FONTS=/path/to/dir/with/DejaVu*.ttf sh docs/lab/build_c3.sh
# Images: local/graphviz (alpine 3.20 + graphviz 9.0 + DejaVu fonts + python3), pandoc/latex.
# Page layout (A4 portrait text; figures on A4 portrait, A4 landscape or A3 landscape pages,
# real landscape/A3 sections in the DOCX) is done by c3_layout.lua.
set -e
cd "$(dirname "$0")"
: "${FONTS:?set FONTS to a directory containing DejaVu*.ttf}"
IMG=pandoc/latex:latest

docker run --rm -v "$PWD/diagrams/c3":/w -w /w local/graphviz sh render.sh

# refresh the generated sections of C3_ER.md (FK key table, relation listing)
python3 - <<'PY'
s = open("C3_ER.md").read()
for name in ("fk_key.md", "relations_listing.md"):
    a, b = f"<!-- BEGIN generated: diagrams/c3/{name} -->", "<!-- END generated -->"
    i = s.index(a) + len(a)
    j = s.index(b, i)
    s = s[:i] + "\n" + open(f"diagrams/c3/{name}").read().rstrip("\n") + "\n" + s[j:]
open("C3_ER.md", "w").write(s)
PY

# reference.docx: pandoc's default with an A3 landscape page (10 mm margins), so that pandoc
# does not shrink the A3 figures to a portrait text width; the document's own last section is
# set back to A4 portrait (20 mm) after conversion, below.
docker run --rm -v "$PWD":/w -w /w "$IMG" -o .c3_ref.docx --print-default-data-file reference.docx
python3 - <<'PY'
import re, zipfile, shutil
def rewrite(path, fn):
    tmp = path + ".tmp"
    zin = zipfile.ZipFile(path)
    zout = zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED)
    for item in zin.infolist():
        data = zin.read(item.filename)
        if item.filename == "word/document.xml":
            data = fn(data.decode()).encode()
        zout.writestr(item, data)
    zout.close()
    zin.close()
    shutil.move(tmp, path)
A3L = ('<w:pgSz w:w="23811" w:h="16838" w:orient="landscape"/>'
       '<w:pgMar w:top="567" w:right="567" w:bottom="567" w:left="567" w:header="567" w:footer="567" w:gutter="0"/>')
rewrite(".c3_ref.docx", lambda s: re.sub(r"(</w:sectPr>)(?![\s\S]*</w:sectPr>)", A3L + r"\1", s))
PY

docker run --rm -v "$PWD":/w -w /w "$IMG" C3_ER.md -o C3_ER.docx --toc --toc-depth=2 \
  --lua-filter=c3_layout.lua --reference-doc=.c3_ref.docx --resource-path=.
# last section of the DOCX: A4 portrait, 20 mm margins
python3 - <<'PY'
import re, zipfile, shutil
path, tmp = "C3_ER.docx", "C3_ER.docx.tmp"
A4P = ('<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
       '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/>'
       '<w:pgNumType/></w:sectPr>')
zin = zipfile.ZipFile(path)
zout = zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED)
for item in zin.infolist():
    data = zin.read(item.filename)
    if item.filename == "word/document.xml":
        s = data.decode()
        i = s.rindex("<w:sectPr>")
        j = s.index("</w:sectPr>", i) + len("</w:sectPr>")
        s = s[:i] + A4P + s[j:]
        data = s.encode()
    zout.writestr(item, data)
zout.close()
zin.close()
shutil.move(tmp, path)
PY

docker run --rm -v "$PWD":/w -v "$FONTS":/fonts -w /w "$IMG" C3_ER.md -o C3_ER.pdf \
  --pdf-engine=xelatex --toc --toc-depth=2 --lua-filter=c3_layout.lua --resource-path=. \
  -H c3_header.tex \
  -V geometry:a4paper,margin=20mm -V fontsize=10pt -V colorlinks=true -V linkcolor=black -V urlcolor=blue \
  -V mainfont=DejaVuSerif -V 'mainfontoptions=Path=/fonts/,Extension=.ttf,UprightFont=*,BoldFont=*-Bold,ItalicFont=*-Italic,BoldItalicFont=*-BoldItalic' \
  -V sansfont=DejaVuSans -V 'sansfontoptions=Path=/fonts/,Extension=.ttf,UprightFont=*,BoldFont=*-Bold,ItalicFont=*-Oblique,BoldItalicFont=*-BoldOblique' \
  -V monofont=DejaVuSansMono -V 'monofontoptions=Path=/fonts/,Extension=.ttf,UprightFont=*,BoldFont=*-Bold,ItalicFont=*-Oblique,BoldItalicFont=*-BoldOblique,Scale=0.85'
rm -f .c3_ref.docx
ls -la C3_ER.docx C3_ER.pdf
