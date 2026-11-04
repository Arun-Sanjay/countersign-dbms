#!/usr/bin/env bash
# Live lock-graph demo for the "last team slot" race.
#   Session race-A joins T02 (3/4) and holds its transaction open for HOLD seconds.
#   Sessions race-B and race-C try to join T02 a moment later and block.
#   While they wait, live_locks.sql prints the wait-for graph and the lock table.
# Usage: experiments/race/demo_locks.sh [S1|S2|S3|S7] [RC|RR|SER]     (default: S2 RC)
#   S2 = fixture trigger (FOR UPDATE on the team row), S7 = v2 (writes the team row),
#   S3 = conditional counter UPDATE (application statement, no trigger),
#   S1 = naive conditional INSERT (count < max, no lock): nobody blocks; at SER section 3
#        shows the SIREAD (predicate) locks and SSI aborts the pivot at commit.
# Do not run while harness.py is running (it switches the active strategy).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
C=${RACE_CONTAINER:-elp-race-pg}
STRAT=${1:-S2}
case "$STRAT" in S1|S2|S3|S7) ;; *) echo "strategy must be S1, S2, S3 or S7" >&2; exit 2 ;; esac
case "${2:-RC}" in
  RC) ISO="READ COMMITTED" ;; RR) ISO="REPEATABLE READ" ;; SER) ISO="SERIALIZABLE" ;;
  *) echo "isolation must be RC, RR or SER" >&2; exit 2 ;;
esac
HOLD=${HOLD:-4}
q(){ docker exec -i -e PGOPTIONS="-c client_min_messages=warning" "$C" psql -U postgres -d race -X -q -v ON_ERROR_STOP=1 "$@"; }

if [ "$(q -tAc "SELECT count(*) FROM pg_stat_activity WHERE application_name LIKE 'race-c%'")" != "0" ]; then
  echo "harness.py seems to be running (race-c* sessions found); try again later." >&2; exit 1
fi

q -c "SELECT exp.reset_t02(); SELECT exp.use_strategy('$STRAT');" >/dev/null

session(){  # $1 = app name, $2 = usn, $3 = seconds to hold before COMMIT
  local body
  if [ "$STRAT" = "S3" ]; then
    body="WITH c AS (UPDATE exp.team_counter SET member_count = member_count + 1
                     WHERE team_id = 'T02' AND member_count < max_size RETURNING 1)
          INSERT INTO team_member (team_id, usn, role, joined_at)
          SELECT 'T02', '$2', 'member', current_date FROM c;"
  elif [ "$STRAT" = "S1" ]; then
    # naive check-then-insert, no lock: insert only if the count this transaction sees is < max
    body="INSERT INTO team_member (team_id, usn, role, joined_at)
          SELECT 'T02', '$2', 'member', current_date
          WHERE (SELECT count(*) FROM team_member WHERE team_id = 'T02')
              < (SELECT max_size FROM team WHERE team_id = 'T02')
          RETURNING usn AS joined;"
  else
    body="INSERT INTO team_member (team_id, usn, role, joined_at) VALUES ('T02', '$2', 'member', current_date);"
  fi
  printf '\\set ON_ERROR_STOP on\nBEGIN ISOLATION LEVEL %s;\n%s\n\\o /dev/null\nSELECT pg_sleep(%s);\n\\o\nCOMMIT;\n' "$ISO" "$body" "$3" |
    docker exec -i -e PGAPPNAME="$1" "$C" psql -U postgres -d race -X -q 2>&1 | sed "s/^/  [$1] /"
  echo "  [$1] done"
}

echo "== Strategy $STRAT, $ISO: race-A takes T02's last seat and holds for ${HOLD}s =="
session race-A 1RV99XX001 "$HOLD" &
sleep 0.7
session race-B 1RV99XX002 0 &
sleep 0.3
session race-C 1RV99XX003 0 &
sleep 1
q < "$HERE/live_locks.sql"
wait
echo
q -tAc "SELECT 'T02 after the race: ' || count(*) || '/4  (' || string_agg(usn, ', ' ORDER BY usn) FILTER (WHERE usn LIKE '1RV99%') || ' admitted)'
        FROM team_member WHERE team_id = 'T02';"
q -c "SELECT exp.reset_t02(); SELECT exp.use_strategy('S1');" >/dev/null
