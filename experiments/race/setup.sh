#!/usr/bin/env bash
# Start the throwaway PostgreSQL 17 container for the Component 10 experiment and load:
#   fixture 01_schema + 02_seed (verbatim) + Q35 block of 03_queries (verbatim) + schema.sql.
# The fixture files are only READ (concatenated at runtime), never copied or edited.
# Usage: experiments/race/setup.sh            # create container if needed, (re)load database "race"
#        (WARNING: drops that database, including exp.* results; RACE_DB=other to use another name)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
C=${RACE_CONTAINER:-elp-race-pg}
PORT=${RACE_PORT:-55433}
DB=${RACE_DB:-race}

if ! docker ps -a --format '{{.Names}}' | grep -qx "$C"; then
  docker run -d --name "$C" -e POSTGRES_PASSWORD=localdev -p "$PORT:5432" postgres:17 \
    -c max_connections=300 >/dev/null
fi
docker start "$C" >/dev/null
until docker exec "$C" pg_isready -U postgres -q; do sleep 0.5; done

docker exec "$C" psql -U postgres -X -q -c "DROP DATABASE IF EXISTS $DB WITH (FORCE);" -c "CREATE DATABASE $DB;"

{
  echo "\\set ON_ERROR_STOP on"
  echo "SET client_min_messages = warning;"
  cat "$ROOT/supabase/fixture/01_schema.sql"
  cat "$ROOT/supabase/fixture/02_seed.sql"
  # Q35 = check_team_capacity() + trg_team_capacity, exactly as in the fixture.
  sed -n '/^-- Q35\./,/^-- Q36\./p' "$ROOT/supabase/fixture/03_queries.sql" | sed '$d'
  cat "$HERE/schema.sql"
} | docker exec -i "$C" psql -U postgres -d "$DB" -X -q

docker exec "$C" psql -U postgres -d "$DB" -X -tA -c "
  SELECT 'T02 = ' || count(*) || '/' || max(t.max_size) || ', racers = ' ||
         (SELECT count(*) FROM student WHERE usn LIKE '1RV99%')
  FROM team t JOIN team_member m USING (team_id) WHERE t.team_id = 'T02';"
