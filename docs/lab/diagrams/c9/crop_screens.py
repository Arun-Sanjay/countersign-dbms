"""Crop the web-app screenshots used in C9/C11 to the panel that matters, so their text
prints larger (run by build_c9_c11.sh). Sources are read only; crops go to shots/.
The sources are named below with where they were taken (local stack or the read-only cloud rehearsal).
Usage: python crop_screens.py <repo root>"""
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(sys.argv[1])
OUT = Path(__file__).resolve().parent / "shots"
CROPS = {  # name: (source, (left, top, right, bottom) in source pixels, scale)
    # recaptured on the LOCAL stack on 5 Nov 2026 at device scale 2 (current UI); halved here
    "sheet":       ("docs/lab/screenshots/r5nov_sheet_P06_panel_2x.png", (0, 0, 3072, 1186), 0.5),
    "drawer":      ("docs/lab/screenshots/r5nov_drawer_aditi_c1_2x.png", (0, 0, 768, 1510), 1),
    "countersign": ("docs/lab/screenshots/r5nov_queue_arun_2x.png",      (590, 140, 2810, 1660), 0.5),
    # earlier LOCAL runs (review and e2e)
    "claim":       ("web/screenshots/review-18-arun-file-claim-dialog.png",   (383, 178, 1057, 722), 1),
    "sqldrawer":   ("web/screenshots/review-22-arun-sql-algebra.png",  (770, 0, 1440, 380), 1),
    "rls":         ("web/screenshots/faculty-12-rls-lakshmi.png",      (290, 70, 1400, 665), 1),
    "finder":      ("web/screenshots/review-12-arun-team-finder.png",  (290, 200, 1400, 1190), 1),
    "marks":       ("web/screenshots/faculty-11-marks.png",            (290, 70, 1400, 965), 1),
    "admin":       ("web/screenshots/faculty-13-admin.png",            (250, 60, 1440, 960), 1),
    # the read-only rehearsal on the LIVE project, 5 Nov 2026 (badge "Cloud")
    "trace":       ("web/screenshots/rehearsal-35-F-trace-sheet.png",  (1057, 0, 1440, 900), 1),
    "search":      ("web/screenshots/rehearsal-35-S-ask.png",          (300, 365, 1400, 900), 1),
    "ingestion":   ("web/screenshots/rehearsal-42-admin-ingestion.png", (300, 365, 1400, 900), 1),
    "consistency": ("web/screenshots/rehearsal-54-admin-consistency.png", (300, 420, 1400, 900), 1),
}
OUT.mkdir(exist_ok=True)
for name, (src, box, scale) in CROPS.items():
    im = Image.open(ROOT / src).crop(box)
    if scale != 1:
        im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
    im.save(OUT / f"{name}.png", optimize=True)
    print(f"{name:12} {src} -> {im.width}x{im.height}")
