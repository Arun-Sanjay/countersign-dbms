#!/usr/bin/env bash
# Two-session races for the review-round-1 integrity fixes (local Supabase stack).
#
# Race 1 "mark, then leave": A records a mark for Ananya and holds its transaction;
#        B deletes Ananya's T06 membership. Write skew if both commit (a mark for a
#        student in no P06 team). Expected: B waits; RC -> 55000 has-history, RR/SER -> 40001.
# Race 2 "leave, then mark": the same two statements in the other order. Expected: A waits;
#        RC -> 23514 not-in-any-team, RR/SER -> 40001.
# Race 3 "edit vs countersign": A edits Aditi's pending T06 claim and holds; B (her teammate
#        Meera) countersigns it with the revision it read before the edit. Expected: B waits; RC -> 55000 stale
#        revision, RR/SER -> 40001. Never: a confirm attached to text B did not read.
# Pass = every invariant query returns 0 after every race, at every isolation level.
#
# Usage: experiments/race/membership_skew_check.sh   (PGCONTAINER=... to override)
set -u
C=${PGCONTAINER:-supabase_db_countersign-dbms}
psqlc(){ docker exec -i "$C" psql -U postgres -d postgres -X -q -v VERBOSITY=verbose "$@"; }
sqlstate(){ grep -oE 'ERROR: +[0-9A-Z]{5}: .*' | head -1 | sed -E 's/ERROR: +//'; }
STUDENT=1RV24CY082        # Ananya: section A, enrolled in P06's offering, in no P06 team

setup_member(){ psqlc -c "INSERT INTO team_member (team_id, usn) VALUES ('T06', '$STUDENT') ON CONFLICT DO NOTHING;" >/dev/null; }
cleanup_member(){
  psqlc -c "DELETE FROM assessment WHERE usn = '$STUDENT' AND project_id = 'P06' AND milestone_no = 2;
            DELETE FROM team_member WHERE team_id = 'T06' AND usn = '$STUDENT';" >/dev/null
}
# a mark (or claim) whose student is in no team of the project = the invariant broken
skew_count(){ psqlc -tAc "SELECT count(*) FROM assessment a WHERE NOT EXISTS (
    SELECT 1 FROM team_member tm JOIN team t ON t.team_id = tm.team_id
    WHERE tm.usn = a.usn AND t.project_id = a.project_id);"; }
MARK="INSERT INTO assessment (usn, project_id, milestone_no, marks, assessed_by) VALUES ('$STUDENT', 'P06', 2, 4.0, 'F01');"
LEAVE="DELETE FROM team_member WHERE team_id = 'T06' AND usn = '$STUDENT';"

FAIL=0
race(){   # $1 iso, $2 first stmt (held 3 s), $3 second stmt, $4 label
  ( printf "BEGIN ISOLATION LEVEL %s;\n%s\nSELECT pg_sleep(3);\nCOMMIT;\n" "$1" "$2" | psqlc >/dev/null 2>&1 ) &
  sleep 1
  OUT=$(printf "BEGIN ISOLATION LEVEL %s;\n%s\nCOMMIT;\n" "$1" "$3" | psqlc 2>&1 | sqlstate)
  wait
}

for N in 1 2; do
  if [ "$N" = 1 ]; then FIRST=$MARK; SECOND=$LEAVE; echo "== Race 1: mark, then leave =="
  else FIRST=$LEAVE; SECOND=$MARK; echo; echo "== Race 2: leave, then mark =="; fi
  for ISO in "READ COMMITTED" "REPEATABLE READ" "SERIALIZABLE"; do
    cleanup_member; setup_member
    race "$ISO" "$FIRST" "$SECOND"
    BAD=$(skew_count)
    [ "$BAD" -eq 0 ] || FAIL=1
    [ -n "$OUT" ] || FAIL=1          # the second session must be refused, never both commit
    printf '%-16s  second session: %-70.70s  marks without membership = %s\n' "$ISO" "${OUT:-COMMITTED (bad)}" "$BAD"
  done
done
cleanup_member

echo; echo "== Race 3: edit vs countersign (claim revision) =="
for ISO in "READ COMMITTED" "REPEATABLE READ" "SERIALIZABLE"; do
  CID=$(psqlc -tAc "INSERT INTO claim (usn, team_id, project_id, milestone_no, statement)
                    VALUES ('1RV24CY011', 'T06', 'P06', 5, 'Drew the level-0 DFD (race test).') RETURNING claim_id;" | head -1)
  REV=$(psqlc -tAc "SELECT revision FROM claim WHERE claim_id = $CID;")     # what B 'read'
  race "$ISO" \
       "UPDATE claim SET statement = 'I designed the WHOLE schema myself (race test).' WHERE claim_id = $CID;" \
       "INSERT INTO countersign (claim_id, endorser_usn, verdict, claim_revision) VALUES ($CID, '1RV24CY033', 'confirm', $REV);"
  BAD=$(psqlc -tAc "SELECT count(*) FROM countersign cs JOIN claim c USING (claim_id) WHERE cs.claim_revision <> c.revision;")
  [ "$BAD" -eq 0 ] || FAIL=1
  [ -n "$OUT" ] || FAIL=1
  printf '%-16s  countersign: %-70.70s  stale signatures = %s\n' "$ISO" "${OUT:-COMMITTED (bad)}" "$BAD"
  psqlc -c "DELETE FROM claim WHERE claim_id = $CID;" >/dev/null
done

echo
if [ "$FAIL" -eq 0 ]; then echo "PASS: no write skew, no stale countersign"; else echo "FAIL"; fi
exit "$FAIL"
