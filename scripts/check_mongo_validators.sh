#!/usr/bin/env bash
# Prove that mongo/validators.js accepts every document the frozen fixture writes, and
# rejects malformed ones, WITHOUT touching the real 'elp' database.
#
#   1. applies mongo/validators.js to a scratch database (default elp_validator_check);
#   2. runs the fixture's own data blocks M1, M2, M3 and the update blocks M15, M16, M17
#      (cut verbatim from mongo/04_mongo.js, which is only read) against that database;
#   3. tries writes that must FAIL (note without title, bad USN, version edit of a
#      note_versions doc to an invalid shape, commit without sha);
#   4. drops the scratch database.
#
# Usage:
#   MONGODB_URI=... scripts/check_mongo_validators.sh          # e.g. Atlas
#   scripts/check_mongo_validators.sh --local                  # docker container elp-mongo-local
# The URI is never printed.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRATCH="${SCRATCH_DB:-elp_validator_check}"
FIXTURE="$ROOT/mongo/04_mongo.js"

if [[ "${1:-}" == "--local" ]]; then
  URI="mongodb://127.0.0.1:57018/?directConnection=true"
else
  : "${MONGODB_URI:?set MONGODB_URI (e.g. set -a; . atlas-credentials.env; set +a)}"
  URI="$MONGODB_URI"
fi
[[ "$SCRATCH" == "elp" ]] && { echo "refusing to use the real 'elp' database as scratch" >&2; exit 2; }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/elp-validators.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

# Cut "// M<n>." blocks out of the fixture: from that comment up to the next "// M" or "// ===".
block() {
  awk -v n="$1" '
    $0 ~ "^// M" n "\\." { on = 1; print; next }
    on && (/^\/\/ M[0-9]+\./ || /^\/\/ =+/) { on = 0 }
    on { print }' "$FIXTURE"
}

{
  echo "var ELP_DB = '$SCRATCH';"
  cat "$ROOT/mongo/validators.js"
  echo "use $SCRATCH"
  echo "db.notes.deleteMany({}); db.github_events.deleteMany({}); db.portfolios.deleteMany({}); db.note_versions.deleteMany({});"
  for n in 1 2 3 15 16 17; do block "$n"; done
  cat <<'JS'
(function () {
  const out = { fixture_counts: {}, must_fail: {} };
  out.fixture_counts = {
    notes: db.notes.countDocuments(), github_events: db.github_events.countDocuments(),
    portfolios: db.portfolios.countDocuments()
  };
  function mustFail(label, fn) {
    try { fn(); out.must_fail[label] = 'ACCEPTED (bad)'; }
    catch (e) { out.must_fail[label] = (e.code === 121) ? 'rejected 121' : ('error ' + e.code); }
  }
  mustFail('note_without_title', () => db.notes.insertOne({ note_id: 'NX1', team_id: 'T01', author_usn: '1RV24CY047' }));
  mustFail('note_bad_usn', () => db.notes.insertOne({ note_id: 'NX2', team_id: 'T01', author_usn: 'nobody', title: 'x' }));
  mustFail('note_bad_status', () => db.notes.updateOne({ note_id: 'N01' }, { $set: { status: 'published' } }));
  mustFail('version_without_content', () => db.note_versions.insertOne({ _id: 'N01:9', note_id: 'N01', version: 9, author_usn: '1RV24CY047', created_at: new Date() }));
  mustFail('commit_without_sha', () => db.github_events.insertOne({ event_id: 'EX', team_id: 'T01', type: 'push', commits: [{ author_usn: '1RV24CY047' }] }));
  mustFail('portfolio_without_projects', () => db.portfolios.insertOne({ usn: '1RV24CY099', name: 'X' }));
  print('@@RESULT ' + JSON.stringify(out));
})();
JS
  echo "db.dropDatabase()"
  echo "print('@@DROPPED ' + !db.getMongo().getDBNames().includes('$SCRATCH'))"
} > "$WORK/check.js"

npx -y mongosh@latest "$URI" --quiet < "$WORK/check.js" > "$WORK/out.txt" 2>&1 || true

grep -E 'MongoServerError|MongoBulkWriteError|SyntaxError|ReferenceError|TypeError' "$WORK/out.txt" \
  && { echo "FAIL: errors while running fixture blocks against validators" >&2; exit 1; }
summary="$(grep -o '{"db".*' "$WORK/out.txt" | head -1)"
result="$(grep -o '@@RESULT .*' "$WORK/out.txt" | sed 's/^@@RESULT //')"
dropped="$(grep -o '@@DROPPED .*' "$WORK/out.txt" | sed 's/^@@DROPPED //')"
echo "validators on $SCRATCH: $summary"
echo "result: $result"
echo "scratch db dropped: $dropped"

python3 - "$result" "$dropped" <<'PY'
import json, sys
r = json.loads(sys.argv[1]); ok = True
want = {"notes": 6, "github_events": 3, "portfolios": 5}      # 7 notes, M17 deletes T02's draft
if r["fixture_counts"] != want:
    print("FAIL fixture counts", r["fixture_counts"], "expected", want); ok = False
for k, v in r["must_fail"].items():
    if v != "rejected 121":
        print("FAIL", k, v); ok = False
if sys.argv[2] != "true":
    print("FAIL scratch db still present"); ok = False
print("PASS" if ok else "FAILED")
sys.exit(0 if ok else 1)
PY
