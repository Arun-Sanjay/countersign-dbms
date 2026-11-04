#!/usr/bin/env bash
# Local MongoDB for offline development (MONGO_TARGET=local in api/.env).
#
# Starts docker container elp-mongo-local (mongo:8) on 127.0.0.1:57018 as a single-node
# replica set (so the API's note saves run as multi-document transactions, as on Atlas),
# then loads mongo/seed.js, mongo/validators.js and mongo/portfolio_merge.js into 'elp'.
# Idempotent: re-running re-seeds the data (seed.js drops and reloads the collections).
#
# Usage: scripts/mongo_local.sh [--fresh]     (--fresh also recreates the container)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NAME="elp-mongo-local"
PORT=57018

if [[ "${1:-}" == "--fresh" ]]; then docker rm -f "$NAME" >/dev/null 2>&1 || true; fi

if ! docker ps --format '{{.Names}}' | grep -qx "$NAME"; then
  if docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
    docker start "$NAME" >/dev/null
  else
    docker run -d --name "$NAME" -p "127.0.0.1:${PORT}:27017" mongo:8 --replSet rs0 --bind_ip_all >/dev/null
  fi
fi

sh_in() { docker exec -i "$NAME" mongosh --quiet "$@"; }
for _ in $(seq 1 60); do sh_in --eval 'db.runCommand({ ping: 1 }).ok' >/dev/null 2>&1 && break; sleep 1; done
sh_in --eval 'try { rs.status().ok } catch (e) { rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "localhost:27017" }] }).ok }' >/dev/null
for _ in $(seq 1 30); do [[ "$(sh_in --eval 'db.hello().isWritablePrimary')" == "true" ]] && break; sleep 1; done

# A re-seed resets the local world: history of notes that seed.js just dropped goes too.
sh_in --eval 'db.getSiblingDB("elp").note_versions.drop()' >/dev/null
sh_in < "$ROOT/mongo/seed.js"           | grep -o '{"notes".*' || true
sh_in < "$ROOT/mongo/validators.js"     | grep -o '{"db".*'
sh_in < "$ROOT/mongo/portfolio_merge.js" | grep -o '{"db".*'
echo "local mongo ready: mongodb://127.0.0.1:${PORT}/?directConnection=true (db elp)"
