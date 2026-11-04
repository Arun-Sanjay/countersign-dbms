#!/usr/bin/env bash
# Build Component 7 (Midterm Report): C7_Midterm_Report.md -> .pdf (xelatex) and .docx (pandoc).
# Same approach and styling as Component 2 (Times New Roman, RVCE cover via c2_rvce.lua, Word
# style sheet from c2_make_reference_docx.py) with the A3 / landscape figure pages of
# Component 3 (c7_layout.lua, c7_header.tex). Needs Docker and uv.
#   1. Figure 1 (Graphviz, docker image nshine/dot): diagrams/c7/c7_architecture.dot -> .svg/.png
#   2. pre-flight: printed size of the inline Graphviz figures (>= 8 pt) and body-font glyph
#      coverage (c2_check_figures.py)
#   3. Word reference document: the C2 style sheet with the C7 running header; its page is set
#      to A3 landscape so that pandoc does not shrink the A3 figures (last section reset below)
#   4. PDF and DOCX. The repository root is mounted, because Figure 13 is read from
#      experiments/race/results/ (read only; nothing there is copied or changed).
# Reused figures are not re-rendered here: Component 3 (build_c3.sh), Component 5
# (dfd/src/render.sh), Component 6 (build_c6.sh) and experiments/race/report.py own them.
# Usage: docs/lab/build_c7.sh
set -euo pipefail
cd "$(dirname "$0")"
LAB="$PWD"
ROOT="$(cd ../.. && pwd)"
DOT_IMG=nshine/dot
PANDOC_IMG=pandoc/latex:latest
TNR_DIR="${TNR_DIR:-/System/Library/Fonts/Supplemental}"
[[ -f "$TNR_DIR/Times New Roman.ttf" ]] || { echo "Times New Roman not found in $TNR_DIR" >&2; exit 2; }

# 1. diagram
for f in diagrams/c7/c7_*.dot; do
  b=$(basename "${f%.dot}")
  docker run --rm --platform linux/amd64 -v "$LAB":/w -w /w/diagrams/c7 "$DOT_IMG" dot -Tsvg "$b.dot" -o "$b.svg"
  docker run --rm --platform linux/amd64 -v "$LAB":/w -w /w/diagrams/c7 "$DOT_IMG" dot -Tpng -Gdpi=200 "$b.dot" -o "$b.png"
done

# 2. pre-flight: printed size of every figure's smallest text (written into Appendix B of the
#    report) and body-font glyph coverage. Fails if any figure's smallest text prints below 5.5 pt
#    or a body character is missing from Times New Roman.
uv run -q --no-project --with fonttools python - C7_Midterm_Report.md "$TNR_DIR/Times New Roman.ttf" <<'PY'
import re, struct, sys
from pathlib import Path
md_path, font = Path(sys.argv[1]), sys.argv[2]
text = md_path.read_text(encoding="utf-8")
PT_PER_MM = 72 / 25.4
PAGES = {"a4p": (210, 297, 12), "a4l": (297, 210, 12), "a3l": (420, 297, 10), None: (210, 297, 20)}
FOOTSKIP_MM, CAPTION_MM = 10.6, 22.0           # \footskip and the 4.2 baselines kept for the caption
def png(p):
    with open(p, "rb") as f:
        return struct.unpack(">II", f.read(24)[16:24])
def src_font(img):
    """(smallest font in points in the figure's source, source dpi, kind)"""
    p = Path(img)
    if "experiments/race" in img:
        return 9.0, 160, "matplotlib"                 # report.py: tick and cell labels 9 pt, dpi 160
    if "diagrams/c7/c7_rubric" in img or "diagrams/c7/c7_cell" in img:
        return None, None, "screenshot"
    dot = p.with_suffix(".dot")
    if "dfd/png/" in img:
        dot = Path("dfd/dot") / (p.stem + ".dot")
    t = dot.read_text(encoding="utf-8")
    sizes = [float(x) for x in re.findall(r'fontsize\s*=\s*"?([0-9.]+)', t)]
    sizes += [float(x) for x in re.findall(r'POINT-SIZE="([0-9.]+)"', t, re.I)]
    return (min(sizes) if sizes else 14.0), 200, "Graphviz"
rows, ok, page = [], True, None
for line in text.splitlines():
    m = re.match(r"^::: \{page=(\w+)\}", line)
    if m: page = m.group(1); continue
    if line.strip() == ":::": page = None; continue
    for m in re.finditer(r"!\[(Figure \d+)\.[^\]]*\]\(([^)]+\.png)\)(\{width=(\d+)%\})?", line):
        fig, img, pct = m.group(1), m.group(2), m.group(4)
        w, h = png(img)
        pw, ph, mg = PAGES[page]
        tw, th = pw - 2 * mg, ph - 2 * mg - (FOOTSKIP_MM + CAPTION_MM if page else CAPTION_MM)
        disp_w = tw * (int(pct) / 100 if pct else 1.0)
        fpt, dpi, kind = src_font(img)
        if kind == "screenshot":
            w, h = w / 2, h / 2                     # the screenshots are captured at device scale 2 (5 Nov 2026)
            disp_w = min(disp_w, th * w / h)
            pt = 14 * disp_w / w * PT_PER_MM        # 14 px UI body text at 1x
            small, note = f"{pt:.1f} pt (14 px body text)", f"{10 * disp_w / w * PT_PER_MM:.1f} pt at 10 px"
            minpt = 10 * disp_w / w * PT_PER_MM
        else:
            nat_w, nat_h = w / dpi * 25.4, h / dpi * 25.4
            k = min(disp_w / nat_w, th / nat_h)
            disp_w = nat_w * k
            minpt = fpt * k
            small, note = f"{fpt:g} pt in the {kind} source", f"{minpt:.1f} pt"
        where = {None: "A4 portrait, in the text", "a4p": "A4 portrait page", "a4l": "A4 landscape page", "a3l": "A3 landscape page"}[page]
        rows.append(f"| {fig} | {where} | {disp_w / 10:.1f} cm | {small} | {note} |")
        ok &= minpt >= 5.5
table = ["| Figure | Placed on | Printed width (PDF) | Smallest text | Smallest text as printed |",
         "|:--|:--|--:|:--|:--|"] + rows
a, b = "<!-- BEGIN generated: legibility -->", "<!-- END generated -->"
i = text.index(a) + len(a); j = text.index(b, i)
text = text[:i] + "\n" + "\n".join(table) + "\n" + text[j:]
md_path.write_text(text, encoding="utf-8")
print("\n".join(table))
from fontTools.ttLib import TTFont
cmap = TTFont(font).getBestCmap()
body = re.sub(r"```.*?```", " ", text, flags=re.S)
body = re.sub(r"`[^`]*`", " ", body)
body = re.sub(r"\$[^$\n]+\$", " ", body)
missing = sorted({c for c in body if ord(c) > 127 and ord(c) not in cmap})
if missing:
    ok = False
    print("glyphs missing from the body font:", " ".join(f"{c} (U+{ord(c):04X})" for c in missing))
else:
    print("glyph check: every non-ASCII body character is in the body font")
sys.exit(0 if ok else 1)
PY

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/fonts"
docker run --rm --platform linux/amd64 -v "$WORK/fonts":/out --entrypoint sh "$DOT_IMG" \
  -c 'cp /usr/share/fonts/ttf-dejavu/DejaVuSansMono*.ttf /usr/share/fonts/ttf-dejavu/DejaVuSans*.ttf /out/'
cp "$TNR_DIR"/Times\ New\ Roman*.ttf "$WORK/fonts/"

# 3. Word reference document
docker run --rm --platform linux/amd64 "$PANDOC_IMG" -o /dev/stdout --print-default-data-file reference.docx > "$WORK/default.docx"
uv run -q --no-project --with python-docx python c2_make_reference_docx.py "$WORK/default.docx" "$WORK/c7_reference.docx"
uv run -q --no-project --with python-docx python - "$WORK/c7_reference.docx" <<'PY'
import re, shutil, sys, zipfile
from docx import Document
path = sys.argv[1]
doc = Document(path)
for section in doc.sections:
    for p in section.header.paragraphs:
        for r in p.runs:
            r.text = r.text.replace("Lab Component 2: SRS", "Lab Component 7: Midterm Report")
doc.save(path)
# A3 landscape page in the reference (pandoc caps image widths at the reference text width)
A3L_SZ = '<w:pgSz w:w="23811" w:h="16838" w:orient="landscape"/>'
A3L_MAR = '<w:pgMar w:top="567" w:right="567" w:bottom="567" w:left="567" w:header="567" w:footer="567" w:gutter="0"/>'
tmp = path + ".tmp"
zin, zout = zipfile.ZipFile(path), zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED)
for item in zin.infolist():
    data = zin.read(item.filename)
    if item.filename == "word/document.xml":
        s = data.decode()
        i = s.rindex("<w:sectPr")
        j = s.index("</w:sectPr>", i)
        sect = re.sub(r"<w:pgSz[^>]*/>", A3L_SZ, s[i:j])
        sect = re.sub(r"<w:pgMar[^>]*/>", A3L_MAR, sect)
        data = (s[:i] + sect + s[j:]).encode()
    zout.writestr(item, data)
zout.close(); zin.close(); shutil.move(tmp, path)
PY
cp "$WORK/c7_reference.docx" "$LAB/.c7_reference.docx"

# 4. PDF and DOCX
docker run --rm --platform linux/amd64 -v "$ROOT":/repo -v "$WORK/fonts":/fonts:ro -w /repo/docs/lab "$PANDOC_IMG" \
  C7_Midterm_Report.md -o C7_Midterm_Report.pdf --pdf-engine=xelatex \
  --lua-filter=c2_rvce.lua --lua-filter=c7_layout.lua --resource-path=. \
  -V geometry:a4paper,margin=2cm -V fontsize=11pt -V linestretch=1.1 \
  -V mainfont="Times New Roman.ttf" \
  -V 'mainfontoptions=Path=/fonts/,BoldFont=Times New Roman Bold.ttf,ItalicFont=Times New Roman Italic.ttf,BoldItalicFont=Times New Roman Bold Italic.ttf' \
  -V sansfont=DejaVuSans.ttf -V 'sansfontoptions=Path=/fonts/,BoldFont=DejaVuSans-Bold.ttf' \
  -V monofont=DejaVuSansMono.ttf -V 'monofontoptions=Path=/fonts/,BoldFont=DejaVuSansMono-Bold.ttf,Scale=0.85' \
  -V colorlinks=true -V linkcolor=black -V urlcolor=blue -H c7_header.tex
docker run --rm --platform linux/amd64 -v "$ROOT":/repo -w /repo/docs/lab "$PANDOC_IMG" \
  C7_Midterm_Report.md -o C7_Midterm_Report.docx \
  --lua-filter=c2_rvce.lua --lua-filter=c7_layout.lua --resource-path=. --reference-doc=.c7_reference.docx
rm -f "$LAB/.c7_reference.docx"

# DOCX: last section back to A4 portrait (2.54 cm margins); every section break added by
# c7_layout.lua gets the running header and the page-number footer of the last section.
python3 - <<'PY'
import re, shutil, zipfile
path, tmp = "C7_Midterm_Report.docx", "C7_Midterm_Report.docx.tmp"
A4P_SZ = '<w:pgSz w:w="11906" w:h="16838"/>'
A4P_MAR = '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="567" w:footer="567" w:gutter="0"/>'
zin, zout = zipfile.ZipFile(path), zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED)
for item in zin.infolist():
    data = zin.read(item.filename)
    if item.filename == "word/document.xml":
        s = data.decode()
        i = s.rindex("<w:sectPr")
        j = s.index("</w:sectPr>", i)
        last = s[i:j]
        last = re.sub(r"<w:pgSz[^>]*/>", A4P_SZ, last)
        last = re.sub(r"<w:pgMar[^>]*/>", A4P_MAR, last)
        refs = "".join(re.findall(r"<w:(?:header|footer)Reference[^>]*/>", last))
        s = s[:i] + last + s[j:]
        s = re.sub(r"<w:sectPr>(?=<w:pgSz)", "<w:sectPr>" + refs, s)
        data = s.encode()
    zout.writestr(item, data)
zout.close(); zin.close(); shutil.move(tmp, path)
PY
echo "built: C7_Midterm_Report.pdf C7_Midterm_Report.docx"
