#!/usr/bin/env bash
# Gate G1 (MongoDB half): fixture regression for mongo/04_mongo.js.
#
# Starts a throwaway mongo:8 container, pipes 04_mongo.js into mongosh (the way the file says
# to run it: mongosh < 04_mongo.js) and compares the output of M1..M25 with PROJECT_MASTER.md
# Appendix H. A copy of the script with print("@@M<n>") markers added is what gets executed;
# the fixture file itself is only read.
#
# Usage: scripts/test_mongo_fixture.sh [-v]   (-v also prints the raw mongosh transcript)
# Needs: docker, uv (Python 3.12); falls back to npx mongosh if the image has no mongosh.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MASTER="${MASTER_FILE:-$ROOT/PROJECT_MASTER.md}"   # override only for negative tests of the harness
SCRIPT="$ROOT/mongo/04_mongo.js"
CONTAINER="elp-mongo-fixture-test"
PORT=57017
IMAGE="mongo:8"
VERBOSE=0
[[ "${1:-}" == "-v" ]] && VERBOSE=1

WORK="$(mktemp -d "${TMPDIR:-/tmp}/elp-mongo.XXXXXX")"
cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

uv run --quiet --no-project --python 3.12 python -I "$ROOT/scripts/extract_expected.py" \
  "$MASTER" "$WORK/expected" M

docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER" -p "127.0.0.1:${PORT}:27017" "$IMAGE" >/dev/null

if docker exec "$CONTAINER" sh -c 'command -v mongosh' >/dev/null 2>&1; then
  mongosh_in() { docker exec -i "$CONTAINER" mongosh --quiet "$@"; }
else
  mongosh_in() { npx -y "${MONGOSH_NPX:-mongosh@2.14.1}" --quiet "mongodb://127.0.0.1:${PORT}" "$@"; }
fi

for _ in $(seq 1 60); do
  if mongosh_in --eval 'db.runCommand({ ping: 1 }).ok' >/dev/null 2>&1; then break; fi
  sleep 1
done
echo "server: MongoDB $(mongosh_in --eval 'db.version()'), mongosh $(mongosh_in --version 2>/dev/null || echo '?')"

# Insert a marker line before every "// M<n>." comment so the transcript can be split per query.
awk '/^\/\/ M[0-9]+\./ { match($0, /M[0-9]+/); print "print(\"@@" substr($0, RSTART, RLENGTH) "\")" } { print }' \
  "$SCRIPT" > "$WORK/04_mongo_marked.js"

mongosh_in < "$WORK/04_mongo_marked.js" > "$WORK/transcript.txt" 2>&1 || true
if (( VERBOSE )); then sed 's/^/  | /' "$WORK/transcript.txt"; fi

echo
uv run --quiet --no-project --python 3.12 python -I "$ROOT/scripts/check_mongo_output.py" \
  "$WORK/transcript.txt" "$WORK/expected"
