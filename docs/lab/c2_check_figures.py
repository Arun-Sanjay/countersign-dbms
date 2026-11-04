"""Pre-flight checks for the C2 SRS build (run by build_c2.sh; exits non-zero on failure).

1. Figure legibility: for every ![..](diagrams/X.png){width=N%} in C2_SRS.md, the smallest
   font in X.dot (graph/node/edge fontsize, HTML POINT-SIZE) is converted to its printed size:
       printed_pt = font_pt * display_width_in / natural_width_in,
   natural_width_in = PNG pixels / 200 dpi, display_width = N% of the text width
   (PDF: A4 minus 2 x 2.0 cm margins = 17.0 cm; DOCX: A4 minus 2 x 2.54 cm = 15.92 cm).
   Fails if any figure prints below 8 pt or is taller than 22 cm.
2. Glyph coverage: every non-ASCII character of the body text (outside `code` and $math$)
   must exist in the body font (Times New Roman), so nothing silently drops out of the PDF.
Usage: python3 c2_check_figures.py C2_SRS.md "/path/to/Times New Roman.ttf"
"""
import re
import struct
import sys
from pathlib import Path

MIN_PT, MAX_H_CM, DPI = 8.0, 22.0, 200
TEXT_W_CM = {"pdf": 17.0, "docx": 15.92}


def png_size(p):
    with open(p, "rb") as f:
        head = f.read(24)
    return struct.unpack(">II", head[16:24])


def min_font(dot_text):
    sizes = [float(x) for x in re.findall(r'fontsize\s*=\s*"?([0-9.]+)', dot_text)]
    sizes += [float(x) for x in re.findall(r'POINT-SIZE="([0-9.]+)"', dot_text, re.I)]
    return min(sizes) if sizes else 14.0          # Graphviz default is 14 pt


def main(md_path, font_path):
    md = Path(md_path)
    text = md.read_text(encoding="utf-8")
    ok = True
    print(f"{'figure':34} {'px':>11} {'width':>6} {'min font':>8} {'PDF pt':>7} {'DOCX pt':>7} {'height cm':>9}")
    for m in re.finditer(r'!\[.*?\]\((diagrams/[^)]+\.png)\)\{width=(\d+)%\}', text):
        png, pct = md.parent / m.group(1), int(m.group(2)) / 100
        dot = png.with_suffix(".dot")
        w, h = png_size(png)
        f = min_font(dot.read_text(encoding="utf-8")) if dot.exists() else 14.0
        nat_w_cm = w / DPI * 2.54
        res = {}
        for k, tw in TEXT_W_CM.items():
            disp = tw * pct
            res[k] = f * disp / nat_w_cm
        height_cm = h / DPI * 2.54 * (TEXT_W_CM["pdf"] * pct / nat_w_cm)
        flag = "" if min(res.values()) >= MIN_PT and height_cm <= MAX_H_CM else "  <-- FAIL"
        ok &= flag == ""
        print(f"{png.name:34} {w:>5}x{h:<5} {pct:>6.0%} {f:>8.1f} {res['pdf']:>7.1f} {res['docx']:>7.1f} {height_cm:>9.1f}{flag}")

    try:
        from fontTools.ttLib import TTFont
    except ImportError:
        print("glyph check skipped (fontTools not installed)")
        return 0 if ok else 1
    cmap = TTFont(font_path).getBestCmap()
    body = re.sub(r"```.*?```", " ", text, flags=re.S)
    body = re.sub(r"`[^`]*`", " ", body)
    body = re.sub(r"\$[^$\n]+\$", " ", body)
    missing = sorted({c for c in body if ord(c) > 127 and ord(c) not in cmap})
    if missing:
        ok = False
        print("glyphs missing from the body font:", " ".join(f"{c} (U+{ord(c):04X})" for c in missing))
    else:
        print("glyph check: every non-ASCII body character is in the body font")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))
