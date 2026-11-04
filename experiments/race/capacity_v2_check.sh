#!/usr/bin/env bash
# Gate G5: does trg_team_capacity_v2 ("serialize by writing the parent row") hold under
# READ COMMITTED, REPEATABLE READ and SERIALIZABLE?  Adapted from rr_trigger_check.sh
# (left unchanged; it tests the fixture's Q35 trigger on plain PG17).
#
# Race 1 (pair):  two sessions race for Team Beta T02's last seat (3/4). A inserts and
#                 holds its transaction; B's insert blocks on the trigger's UPDATE of the
#                 team row; A commits; B resumes.
# Race 2 (burst): N sessions start at once for Team Sigma T06's last seat (3/4).
# Pass = team size never exceeds max_size. Expected loser outcome:
#   RC -> "Team .. is full" (23514);  RR / SERIALIZABLE -> 40001 (retry would then see full).
#
# Usage: experiments/race/capacity_v2_check.sh        (local Supabase stack)
#   PGCONTAINER=<docker container>  PGUSER=postgres  PGDATABASE=postgres  BURST=8
set -u
C=${PGCONTAINER:-supabase_db_countersign-dbms}
U=${PGUSER:-postgres}
D=${PGDATABASE:-postgres}
BURST=${BURST:-8}
psqlc(){ docker exec -i "$C" psql -U "$U" -d "$D" -X -q -v VERBOSITY=verbose "$@"; }
sqlstate(){ grep -oE 'ERROR: +[0-9A-Z]{5}: .*' | head -1 | sed -E 's/ERROR: +//'; }

# Candidates not yet in any team of the project (so only the capacity rule can refuse them).
PAIR=(1RV24CY077 1RV24CY082)                                   # P01: Nikhil, Ananya
BURSTERS=(1RV24CY041 1RV24CY052 1RV24CY058 1RV24CY063 1RV24CY066 1RV24CY071 1RV24CY077 1RV24CY082)
BURSTERS=("${BURSTERS[@]:0:$BURST}")

in_list(){ local IFS=,; printf "'%s'" "$1"; shift; for x in "$@"; do printf ",'%s'" "$x"; done; }
cleanup(){
  psqlc -c "DELETE FROM team_member WHERE team_id='T02' AND usn IN ($(in_list "${PAIR[@]}"));
            DELETE FROM team_member WHERE team_id='T06' AND usn IN ($(in_list "${BURSTERS[@]}"));" >/dev/null
}
# T06 belongs to P06, whose teams admit only students enrolled in its offering (section A).
# Temporarily enroll the section-B bursters so that capacity is the only rule that can
# refuse them; the marker date identifies these rows for removal at the end.
MARK_DATE=1900-01-01
psqlc -c "INSERT INTO enrollment (usn, offering_id, enrolled_on)
          SELECT u, p.offering_id, '$MARK_DATE' FROM project p, unnest(ARRAY[$(in_list "${BURSTERS[@]}")]) AS u
          WHERE p.project_id = 'P06' ON CONFLICT DO NOTHING;" >/dev/null
unenroll(){ psqlc -c "DELETE FROM enrollment WHERE enrolled_on = '$MARK_DATE';" >/dev/null; }

echo "container=$C  triggers on team_member:" \
     "$(psqlc -tAc "SELECT string_agg(tgname, ', ' ORDER BY tgname) FROM pg_trigger WHERE tgrelid='team_member'::regclass AND NOT tgisinternal;")"
cleanup
FAIL=0

echo; echo "== Race 1: pair race for T02's last seat (3/4) =="
for ISO in "READ COMMITTED" "REPEATABLE READ" "SERIALIZABLE"; do
  cleanup
  ( printf "BEGIN ISOLATION LEVEL %s;\nINSERT INTO team_member (team_id, usn, joined_at) VALUES ('T02','%s','2026-11-04');\nSELECT pg_sleep(3);\nCOMMIT;\n" "$ISO" "${PAIR[0]}" | psqlc >/dev/null 2>&1 ) &
  sleep 1
  OUT=$(printf "BEGIN ISOLATION LEVEL %s;\nINSERT INTO team_member (team_id, usn, joined_at) VALUES ('T02','%s','2026-11-04');\nCOMMIT;\n" "$ISO" "${PAIR[1]}" | psqlc 2>&1 | sqlstate)
  wait
  N=$(psqlc -tAc "SELECT count(*) FROM team_member WHERE team_id='T02';")
  [ "$N" -le 4 ] || FAIL=1
  printf '%-16s  T02 size = %s/4   session B: %s\n' "$ISO" "$N" "${OUT:-inserted OK}"
done

echo; echo "== Race 2: burst of ${#BURSTERS[@]} sessions for T06's last seat (3/4) =="
TMP=$(mktemp -d)
for ISO in "READ COMMITTED" "REPEATABLE READ" "SERIALIZABLE"; do
  cleanup
  for U2 in "${BURSTERS[@]}"; do
    ( printf "BEGIN ISOLATION LEVEL %s;\nINSERT INTO team_member (team_id, usn, joined_at) VALUES ('T06','%s','2026-11-04');\nSELECT pg_sleep(1);\nCOMMIT;\n" "$ISO" "$U2" \
        | psqlc 2>&1 | sqlstate > "$TMP/$U2" ) &
  done
  wait
  N=$(psqlc -tAc "SELECT count(*) FROM team_member WHERE team_id='T06';")
  [ "$N" -le 4 ] || FAIL=1
  OK=0; FULL=0; SER=0; OTHER=0
  for U2 in "${BURSTERS[@]}"; do
    R=$(cat "$TMP/$U2")
    case "$R" in
      "")      OK=$((OK+1)) ;;
      23514*)  FULL=$((FULL+1)) ;;
      40001*)  SER=$((SER+1)) ;;
      *)       OTHER=$((OTHER+1)); echo "   $U2: $R" ;;
    esac
  done
  printf '%-16s  T06 size = %s/4   admitted=%s  refused-full(23514)=%s  serialization-failure(40001)=%s  other=%s\n' \
         "$ISO" "$N" "$OK" "$FULL" "$SER" "$OTHER"
done
rm -rf "$TMP"
cleanup
unenroll

echo
if [ "$FAIL" -eq 0 ]; then echo "PASS: capacity v2 never exceeded max_size"; else echo "FAIL: over-admission observed"; fi
exit "$FAIL"
