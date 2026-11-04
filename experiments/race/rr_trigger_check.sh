#!/usr/bin/env bash
# Day-1 check: does trg_team_capacity hold under each isolation level?
# Two sessions race for Team Beta (T02)'s last seat (3/4).
# A inserts and holds its transaction open; B's insert blocks on the trigger's
# FOR UPDATE lock; A commits; we see whether B is refused or over-admits.
set -u
C=${PGCONTAINER:-elp-pg17}
psqlc(){ docker exec -i "$C" psql -U postgres -X -q "$@"; }
for ISO in "READ COMMITTED" "REPEATABLE READ" "SERIALIZABLE"; do
  psqlc -c "DELETE FROM team_member WHERE team_id='T02' AND usn IN ('1RV24CY077','1RV24CY082');" >/dev/null
  ( printf "BEGIN ISOLATION LEVEL %s;\nINSERT INTO team_member VALUES ('T02','1RV24CY077','member','2026-11-04');\nSELECT pg_sleep(3);\nCOMMIT;\n" "$ISO" | psqlc >/dev/null 2>&1 ) &
  sleep 1
  OUT=$(printf "BEGIN ISOLATION LEVEL %s;\nINSERT INTO team_member VALUES ('T02','1RV24CY082','member','2026-11-04');\nCOMMIT;\n" "$ISO" | psqlc 2>&1)
  wait
  N=$(psqlc -tAc "SELECT count(*) FROM team_member WHERE team_id='T02';")
  printf '%-16s  T02 size after race = %s/4   session B: %s\n' "$ISO" "$N" "${OUT:-inserted OK}"
done
psqlc -c "DELETE FROM team_member WHERE team_id='T02' AND usn IN ('1RV24CY077','1RV24CY082');" >/dev/null
