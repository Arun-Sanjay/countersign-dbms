#!/usr/bin/env bash
# Reset the whole LOCAL world so Postgres and MongoDB agree (before a rehearsal or the demo):
#   1. npx supabase db reset --local      migrations + seeds (fixture, demo, ingest)
#   2. scripts/create_personas.py         the 7 demo logins
#   3. scripts/clear_local_pipeline.sh    the worker's raw log and mirrored notes in the
#                                         local Mongo container (Postgres no longer has them)
# Never touches the cloud project or Atlas.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
npx -y supabase@latest db reset --local
uv run --python 3.12 --with httpx --with python-dotenv python scripts/create_personas.py --target local
scripts/clear_local_pipeline.sh
echo "local reset done: Postgres re-seeded, personas created, local Mongo pipeline documents cleared"
