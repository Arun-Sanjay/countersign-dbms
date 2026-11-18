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
    # recaptured on the LOCAL stack on 19 Nov 2026 (solo-team demo seed) at device scale 2; halved here
    "sheet":       ("docs/lab/screenshots/r19nov_sheet_P06_panel_2x.png", (0, 0, 3072, 1082), 0.5),
    "countersign": ("docs/lab/screenshots/r19nov_queue_meera_2x.png",     (590, 140, 2810, 1660), 0.5),
    # recaptured on the LOCAL stack on 5 Nov 2026 at device scale 2 (current UI)
    "drawer":      ("docs/lab/screenshots/r5nov_drawer_aditi_c1_2x.png", (0, 0, 768, 1510), 1),
    # earlier LOCAL runs (review and e2e)
    "claim":       ("web/screenshots/review-18-arun-file-claim-dialog.png",   (383, 178, 1057, 722), 1),
    "sqldrawer":   ("web/screenshots/review-22-arun-sql-algebra.png",  (770, 0, 1440, 380), 1),
    "rls":         ("web/screenshots/faculty-12-rls-lakshmi.png",      (290, 70, 1400, 665), 1),
    "finder":      ("docs/lab/screenshots/r19nov_arun_team_finder.png", (290, 200, 1400, 1190), 1),  # 19 Nov, local
    "marks":       ("web/screenshots/faculty-11-marks.png",            (290, 70, 1400, 965), 1),
    "admin":       ("docs/lab/screenshots/r19nov_admin_full.png",       (300, 1615, 1400, 2680), 1),  # 19 Nov, local: row counts + personas
    # LOCAL stack, 19 Nov 2026, after scripts/replay_webhooks.py (solo-team demo seed)
    "search":      ("docs/lab/screenshots/r19nov_arun_search_ask.png",   (300, 365, 1400, 900), 1),
    "consistency": ("docs/lab/screenshots/r19nov_admin_consistency.png", (300, 420, 1400, 900), 1),
    # the read-only rehearsal on the LIVE project, 5 Nov 2026 (badge "Cloud")
    "trace":       ("web/screenshots/rehearsal-35-F-trace-sheet.png",  (1057, 0, 1440, 900), 1),
    "ingestion":   ("web/screenshots/rehearsal-42-admin-ingestion.png", (300, 365, 1400, 900), 1),
}
OUT.mkdir(exist_ok=True)
for name, (src, box, scale) in CROPS.items():
    im = Image.open(ROOT / src).crop(box)
    if scale != 1:
        im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
    im.save(OUT / f"{name}.png", optimize=True)
    print(f"{name:12} {src} -> {im.width}x{im.height}")
