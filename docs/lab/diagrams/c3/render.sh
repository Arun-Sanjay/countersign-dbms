#!/bin/sh
# Rebuild every Component 3 figure. Run inside the graphviz container from this folder:
#   docker run --rm -v "$PWD":/w -w /w local/graphviz sh render.sh
# (local/graphviz = alpine:3.20 + graphviz 9.0 + DejaVu fonts + python3)
# Outputs per figure: .dot (source), .svg, .png (200 dpi), .pdf (vector, used by the PDF build)
# and docx/<name>.png (lower resolution, about 220 dpi at the size printed in the DOCX).
set -e
cd "$(dirname "$0")"
python3 -B gen_er.py               # ER figures from er_model.py + er_layouts.py (prints a QA report)
python3 -B gen_schema.py measure   # relational schema: measure table sizes ...
dot -Tjson schema_measure.dot > schema_sizes.json
python3 -B gen_schema.py           # ... then pin them on a grid; also writes fk_key.md
python3 -B gen_relations.py        # relations_listing.md from schema_introspection.json
mkdir -p docx
out() {  # engine file docx-dpi
  b="${2%.dot}"
  $1 -Tsvg "$2" -o "$b.svg"
  $1 -Tpng -Gdpi=200 "$2" -o "$b.png"
  $1 -Tpdf "$2" -o "$b.pdf"
  $1 -Tpng -Gdpi="$3" "$2" -o "docx/$b.png"
}
out "neato -n2" er_legend.dot 120
out "neato -n2" er_core_overview.dot 105
for f in er_va_academic er_vb_students er_vc_work er_vd_assessment er_ve_claims; do
  out "neato -n2" "$f.dot" 110
done
out dot er_refinement_skills.dot 170
out "neato -n2" schema_part1.dot 140
out "neato -n2" schema_part2.dot 135
rm -f schema_measure.dot
# natural size of every figure (inches), read by ../../c3_layout.lua to size the DOCX images
python3 - <<'PY'
import re, glob
with open("fig_sizes.txt", "w") as out:
    for f in sorted(glob.glob("*.svg")):
        m = re.search(r'width="([\d.]+)pt" height="([\d.]+)pt"', open(f).read())
        out.write(f"{f[:-4]} {float(m.group(1))/72:.3f} {float(m.group(2))/72:.3f}\n")
PY
