"""Extract the verified outputs of Appendix H in PROJECT_MASTER.md.

Each query in Appendix H looks like:

    **Q12. Find teams that have more than 4 contributions in total.**
    ```
    <expected output>
    ```

Usage:  python -I scripts/extract_expected.py PROJECT_MASTER.md OUT_DIR [Q|M]
Writes OUT_DIR/Q1.txt ... OUT_DIR/Q37.txt and OUT_DIR/M1.txt ... OUT_DIR/M25.txt
(or only one family if the third argument is given). Standard library only.
"""

import re
import sys
from pathlib import Path

HEADING = re.compile(r"^\*\*([QM])(\d+)\.")


def extract(master_text: str) -> dict[str, str]:
    lines = master_text.splitlines()
    try:
        start = next(i for i, l in enumerate(lines) if l.startswith("## Appendix H"))
    except StopIteration:
        sys.exit("Appendix H not found in master file")

    blocks: dict[str, str] = {}
    i = start
    while i < len(lines):
        m = HEADING.match(lines[i])
        if not m:
            i += 1
            continue
        key = f"{m.group(1)}{m.group(2)}"
        # Find the opening fence after the heading, then collect until the closing fence.
        j = i + 1
        while j < len(lines) and not lines[j].startswith("```"):
            j += 1
        k = j + 1
        body = []
        while k < len(lines) and not lines[k].startswith("```"):
            body.append(lines[k])
            k += 1
        if key in blocks:
            sys.exit(f"duplicate heading {key} in Appendix H")
        blocks[key] = "\n".join(body)
        i = k + 1
    return blocks


def main() -> None:
    if len(sys.argv) not in (3, 4):
        sys.exit(__doc__)
    master, out_dir = Path(sys.argv[1]), Path(sys.argv[2])
    family = sys.argv[3] if len(sys.argv) == 4 else None
    blocks = extract(master.read_text(encoding="utf-8"))
    out_dir.mkdir(parents=True, exist_ok=True)
    n = 0
    for key, body in blocks.items():
        if family and not key.startswith(family):
            continue
        (out_dir / f"{key}.txt").write_text(body + "\n", encoding="utf-8")
        n += 1
    print(f"extracted {n} expected blocks into {out_dir}")


if __name__ == "__main__":
    main()
