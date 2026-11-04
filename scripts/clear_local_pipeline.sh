#!/usr/bin/env bash
# Remove the ingestion pipeline's documents from the LOCAL Mongo container (never Atlas):
#   elp.github_events with a delivery_id (raw log written by the worker; the fixture's M2
#   events have no delivery_id and stay), and the vault notes it mirrored (note_id NG-*)
#   with their note_versions. Run it whenever Postgres is reset, so the raw log and the
#   projection describe the same pushes again (the admin consistency panel compares them).
#
# Usage: scripts/clear_local_pipeline.sh            (the container must be running:
#                                                    scripts/mongo_local.sh starts it)
set -euo pipefail
NAME="elp-mongo-local"
DB="${MONGO_DB:-elp}"
if ! docker ps --format '{{.Names}}' | grep -qx "$NAME"; then
  echo "clear_local_pipeline: container $NAME is not running; nothing cleared" >&2
  exit 0
fi
docker exec -i "$NAME" mongosh --quiet --eval "
  const d = db.getSiblingDB('$DB');
  printjson({ db: '$DB',
    github_events: d.github_events.deleteMany({ delivery_id: { \$exists: true } }).deletedCount,
    notes: d.notes.deleteMany({ note_id: /^NG-/ }).deletedCount,
    note_versions: d.note_versions.deleteMany({ note_id: /^NG-/ }).deletedCount });"
