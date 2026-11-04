"""Compare a mongosh transcript of mongo/04_mongo.js with Appendix H (M1..M25).

The transcript comes from piping the script, with a print("@@M<n>") marker inserted before
each "// M<n>." comment, into mongosh. This script:
  1. strips REPL noise (the "elp> " prompt and "| " continuation markers),
  2. splits the transcript on the markers,
  3. compares each block with the expected output, ignoring whitespace and line wrapping,
  4. fails on any shell/server error anywhere in the transcript.

M1..M3 are a known format difference: Appendix H shows the older
"{ acknowledged: true, insertedCount: N }" form, mongosh 2.x prints the insertedIds map.
For these the number of inserted ObjectIds must equal N.

Usage:  python -I scripts/check_mongo_output.py TRANSCRIPT EXPECTED_DIR
Exit status 1 if any check fails. Standard library only.
"""

import re
import sys
from pathlib import Path

PROMPT = re.compile(r"^(?:[\w-]+> )?(?:\| )*")
MARKER = re.compile(r"^@@(M\d+)$")
ERRORS = re.compile(r"MongoServerError|Mongosh\w*Error|SyntaxError|ReferenceError|TypeError|Uncaught")


def clean(lines: list[str]) -> list[str]:
    out = []
    for line in lines:
        line = PROMPT.sub("", line).rstrip()
        if line:
            out.append(line)
    return out


def squash(text: str) -> str:
    # Whitespace and line breaks depend on mongosh's pretty-printer width, not on the data.
    return re.sub(r"\s+", "", text)


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    transcript = Path(sys.argv[1]).read_text(encoding="utf-8").splitlines()
    expected_dir = Path(sys.argv[2])

    blocks: dict[str, list[str]] = {"prelude": []}
    current = "prelude"
    for line in clean(transcript):
        m = MARKER.match(line)
        if m:
            current = m.group(1)
            blocks[current] = []
        else:
            blocks[current].append(line)

    failures = passes = 0
    print(f"{'query':<7} {'result':<7} note")
    print(f"{'-----':<7} {'-------':<7} ----")

    prelude_err = [l for l in blocks["prelude"] if ERRORS.search(l)]
    if prelude_err:
        failures += 1
        print(f"{'setup':<7} {'FAIL':<7} {prelude_err[0]}")

    for n in range(1, 26):
        key = f"M{n}"
        exp_file = expected_dir / f"{key}.txt"
        if key not in blocks or not exp_file.exists():
            failures += 1
            print(f"{key:<7} {'FAIL':<7} missing output block or expected block")
            continue
        actual = "\n".join(blocks[key])
        expected = exp_file.read_text(encoding="utf-8").strip()
        result, note = "FAIL", ""

        err = next((l for l in blocks[key] if ERRORS.search(l)), None)
        ins = re.fullmatch(r"\{\s*acknowledged:\s*true,\s*insertedCount:\s*(\d+)\s*\}", expected)
        if err:
            note = f"error: {err}"
        elif squash(actual) == squash(expected):
            result = "PASS"
        elif ins:
            # insertMany: count the ObjectIds inside insertedIds.
            want = int(ins.group(1))
            got = len(re.findall(r"ObjectId\(", actual))
            if "acknowledged: true" in actual and got == want:
                result, note = "PASS", f"insertedIds has {got} ids (Appendix H shows legacy insertedCount form)"
            else:
                note = f"expected {want} inserted ids, got {got}"
        else:
            note = "output differs"

        if result == "FAIL":
            failures += 1
        else:
            passes += 1
        print(f"{key:<7} {result:<7} {note}")
        if result == "FAIL" and not err:
            print("        expected: " + squash(expected)[:300])
            print("        actual:   " + squash(actual)[:300])

    print()
    print(f"Mongo fixture regression: {passes} passed, {failures} failed (M1..M25 plus setup)")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
