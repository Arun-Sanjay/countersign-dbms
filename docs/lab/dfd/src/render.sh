#!/usr/bin/env bash
# Regenerate the DFD sources and render SVG + PNG (200 dpi) with Graphviz in Docker.
# Usage: bash docs/lab/dfd/src/render.sh   (from anywhere)
# Image: GRAPHVIZ_IMAGE (default local/graphviz, Graphviz 9.0; nshine/dot also works).
set -euo pipefail
DFD="$(cd "$(dirname "$0")/.." && pwd)"
IMG="${GRAPHVIZ_IMAGE:-local/graphviz}"
python3 "$DFD/src/dfd_model.py"
rm -f "$DFD"/svg/*.svg "$DFD"/png/*.png
mkdir -p "$DFD/svg" "$DFD/png"
for f in "$DFD"/dot/*.dot; do
  b="$(basename "$f" .dot)"
  docker run --rm -v "$DFD":/w -w /w "$IMG" sh -c \
    "dot -Tsvg dot/$b.dot -o svg/$b.svg && dot -Tpng -Gdpi=200 dot/$b.dot -o png/$b.png"
  echo "rendered $b"
done
