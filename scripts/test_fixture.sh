#!/usr/bin/env bash
# Gate G1 (SQL half): fixture regression for the frozen graded Test fixture.
#
# Starts a throwaway plain postgres:17 container, loads supabase/fixture/01_schema.sql and
# 02_seed.sql, then runs every query Q1..Q37 of 03_queries.sql on its own (in file order,
# because Q30-Q37 change data) and diffs psql's aligned output against the verified output
# in PROJECT_MASTER.md Appendix H. Exit status is non-zero if any query fails.
#
# Usage: scripts/test_fixture.sh [-v]     (-v prints the diff of every failing query)
# Needs: docker, uv (Python 3.12). The fixture files are only read, never modified.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURE="$ROOT/supabase/fixture"
MASTER="${MASTER_FILE:-$ROOT/PROJECT_MASTER.md}"   # override only for negative tests of the harness
CONTAINER="elp-fixture-test"
PORT=55432
IMAGE="postgres:17"
VERBOSE=0
[[ "${1:-}" == "-v" ]] && VERBOSE=1

WORK="$(mktemp -d "${TMPDIR:-/tmp}/elp-fixture.XXXXXX")"
cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

# ---------------------------------------------------------------------------------------
# 1. Expected outputs from Appendix H (one file per query: Q1.txt ... Q37.txt).
# ---------------------------------------------------------------------------------------
uv run --quiet --no-project --python 3.12 python -I "$ROOT/scripts/extract_expected.py" \
  "$MASTER" "$WORK/expected" Q

# ---------------------------------------------------------------------------------------
# 2. Throwaway PostgreSQL 17 (bound to localhost only, removed by the EXIT trap).
# ---------------------------------------------------------------------------------------
# Collation matters: Appendix H sorts 'NoSQL' before 'Normalization' (Q8, Q29), which is
# byte (C) order. Under a linguistic collation such as en_US.UTF-8 (the postgres image default,
# and what the local Supabase stack uses) those two rows swap. Default to C.UTF-8 to reproduce
# Appendix H; FIXTURE_LOCALE=en_US.UTF-8 shows the difference.
LOCALE="${FIXTURE_LOCALE:-C.UTF-8}"
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=fixture \
  -e POSTGRES_INITDB_ARGS="--locale=$LOCALE" \
  -p "127.0.0.1:${PORT}:5432" "$IMAGE" >/dev/null

# The official image restarts the server once after initdb, so wait for a real query.
for _ in $(seq 1 60); do
  if docker exec "$CONTAINER" psql -U postgres -tAc 'SELECT 1' >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$CONTAINER" psql -U postgres -tAc \
  "SELECT split_part(version(), ' on ', 1) || ', collation ' || datcollate FROM pg_database WHERE datname = 'postgres'" \
  | sed 's/^/server: /'

# psql reading SQL from stdin: -X ignores psqlrc, -q hides command tags (CREATE VIEW, UPDATE 1)
# so only result tables and errors remain, as in Appendix H.
psql_in() { docker exec -i "$CONTAINER" psql -X -q -U postgres -d postgres "$@"; }

echo "loading 01_schema.sql and 02_seed.sql"
# client_min_messages hides the harmless "table ... does not exist, skipping" NOTICEs of DROP IF EXISTS.
psql_in -v ON_ERROR_STOP=1 -c 'SET client_min_messages = warning' -f - < "$FIXTURE/01_schema.sql"
psql_in -v ON_ERROR_STOP=1 -f - < "$FIXTURE/02_seed.sql"

# ---------------------------------------------------------------------------------------
# 3. Split 03_queries.sql on the "-- Q<n>." markers (text before Q1 is only comments).
# ---------------------------------------------------------------------------------------
mkdir -p "$WORK/sql" "$WORK/actual"
awk -v dir="$WORK/sql" '
  /^-- Q[0-9]+\./ { match($0, /Q[0-9]+/); out = dir "/" substr($0, RSTART, RLENGTH) ".sql" }
  out { print > out }
' "$FIXTURE/03_queries.sql"

# Normalise: strip trailing whitespace and leading/trailing blank lines.
normalize() {
  sed -E 's/[[:space:]]+$//' "$1" | awk '
    NF { for (i = 0; i < blank; i++) print ""; blank = 0; started = 1; print; next }
    started { blank++ }'
}

# ---------------------------------------------------------------------------------------
# 4. Run each query and compare.
# ---------------------------------------------------------------------------------------
# Queries whose ORDER BY does not fix a total order (no ORDER BY, or ties on the sort key).
# PostgreSQL may legally return their rows in a different order, so for these a match on the
# same header and the same multiset of rows is also accepted (reported as PASS*).
UNORDERED=" Q2 Q4 Q7 Q9 Q11 Q16 Q18 Q19 Q20 Q21 Q22 Q23 Q25 Q26 Q28 Q31 "
# Queries that must raise an error (CHECK constraint, trigger).
EXPECT_ERROR=" Q34 Q36 "

pass=0; fail=0; failed=()
printf '\n%-5s %-7s %s\n' "query" "result" "note"
printf '%-5s %-7s %s\n' "-----" "-------" "----"
for n in $(seq 1 37); do
  q="Q$n"
  sqlf="$WORK/sql/$q.sql"; exp="$WORK/expected/$q.txt"; act="$WORK/actual/$q.txt"
  if [[ ! -f "$sqlf" || ! -f "$exp" ]]; then
    printf '%-5s %-7s %s\n' "$q" "FAIL" "missing query or expected block"; fail=$((fail+1)); failed+=("$q"); continue
  fi
  # stderr is merged so unexpected errors show up in the diff; drop the "psql:<stdin>:N: " prefix.
  psql_in < "$sqlf" 2>&1 | sed -E 's/^psql:<stdin>:[0-9]+: //' > "$act.raw" || true
  normalize "$act.raw" > "$act"
  normalize "$exp" > "$exp.norm"

  result="FAIL"; note=""
  if [[ "$EXPECT_ERROR" == *" $q "* ]]; then
    want="$(grep -m1 '^ERROR:' "$exp.norm" || true)"
    if cmp -s "$exp.norm" "$act"; then result="PASS"; note="expected error raised (exact text)"
    elif [[ -n "$want" ]] && grep -qxF "$want" "$act"; then result="PASS"; note="expected ERROR line matches; DETAIL/CONTEXT differ"
    else note="expected: $want"; fi
  elif [[ "$q" == "Q35" ]]; then
    # Appendix H shows the OneCompiler message; psql -q prints nothing for CREATE FUNCTION/TRIGGER.
    if [[ ! -s "$act" ]] && grep -q 'executed successfully' "$exp.norm"; then result="PASS"; note="DDL ran with no output"
    else note="unexpected output"; fi
  elif cmp -s "$exp.norm" "$act"; then
    result="PASS"
  elif [[ "$UNORDERED" == *" $q "* ]] && cmp -s <(sort "$exp.norm") <(sort "$act"); then
    result="PASS*"; note="same rows, different order (query has no total ORDER BY)"
  else
    note="output differs"
  fi

  if [[ "$result" == FAIL ]]; then
    fail=$((fail+1)); failed+=("$q")
  else
    pass=$((pass+1))
  fi
  printf '%-5s %-7s %s\n' "$q" "$result" "$note"
  if [[ "$result" == FAIL && $VERBOSE -eq 1 ]]; then
    diff -u --label "expected/$q" --label "actual/$q" "$exp.norm" "$act" | sed 's/^/      /' || true
  fi
done

echo
echo "SQL fixture regression: $pass passed, $fail failed (of 37)"
if (( fail > 0 )); then
  echo "failed: ${failed[*]}   (re-run with -v to see diffs)"
  exit 1
fi
