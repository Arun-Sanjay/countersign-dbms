# Countersign API

*Every mark has a receipt.* This is the small FastAPI service of Countersign (Unified Experiential
Learning Platform, RVCE CD252IA). It handles the two jobs Postgres cannot do by itself:

- **Notes in MongoDB with immutable history.** `elp.notes` holds the current state of each note.
  `elp.note_versions` holds one append-only receipt per save: who wrote it, when, and a sha256
  of the content.
- **A cross-database consistency view.** It compares the push events in Mongo with the
  `contribution` rows in Postgres, per team and author.

The relational CRUD goes through supabase-js under RLS ("fat DB, thin API", `docs/PLAN.md` §5).

## How authorisation works

1. **Token.** The client sends `Authorization: Bearer <Supabase access token>`.
   - Asymmetric tokens (ES256/RS256/EdDSA, used by the local CLI stack and the live project) are
     checked offline against `/auth/v1/.well-known/jwks.json`, including audience
     `authenticated`, the issuer and the expiry.
   - Legacy HS256 tokens are checked by Supabase Auth itself (`GET /auth/v1/user`), because the
     API never holds the JWT secret.
2. **Who is calling.** The API reads `app_user` through PostgREST **with the caller's own
   token**. RLS lets a user read only their own profile row.
3. **What they may see.** The API reads `v_faculty_team_progress` as the caller. It is a
   `security_invoker` view filtered by `app.oversees_project() OR app.is_team_member()`, so RLS
   returns exactly the teams the caller belongs to (students) or teaches (faculty; admins see
   all). The API never uses a service key.
4. **Privacy tiers** (`docs/PLAN.md` §1):

   | Caller | What they see in a team's notes |
   |---|---|
   | Member (student in the team) | Every `final`, non-private note, plus their own drafts |
   | Staff (teaching faculty or admin) | `final` notes as metadata only. The text is withheld (`content: null`, `content_withheld: true`) unless the note is `submitted`. The receipts (version, author, hash, time) stay visible. |

## Endpoints

| Method | Path | What it does |
|---|---|---|
| GET | `/health` | Returns `{postgres, mongo}`, each `ok` or `error: …` (HTTP 503 on error). For Postgres it queries a table as anon and expects Postgres to answer 42501 (permission denied). That proves the DB is reachable and that anon is locked out. |
| GET | `/notes?team_id=T01` | The team's notes that the caller may see. Each note has `history.versions`, the number of `note_versions` receipts. |
| GET | `/notes/{note_id}/versions` | The note's history, newest first: `version_id` (`N01:3`), `author_usn`, `content_hash`, `created_at`, `backfilled`. Answers 404 if the caller may not see the note, so it does not reveal which team the note belongs to. |
| POST | `/notes` | Creates or updates a note as the caller (details below). |
| GET | `/consistency[?team_id=]` | For each visible team, per author: `mongo_commits` (from `github_events`) vs `postgres_github_contributions` (`contribution.source='github'`, read as the caller). Commits are matched by SHA. Status is `consistent`, `only_in_mongo`, `only_in_postgres` or `mismatch`. Only counts and SHAs are returned, never commit messages. A team with no rows says "no recorded evidence yet". |

### `POST /notes`

Body: `{note_id?, team_id, title, content, tags[], links?, status: draft|final, ai_assistance: none|assisted|generated, base_version?}`.

- Only a student who is a member of the team can write. `author_usn` is the caller's USN, taken
  from `app_user`.
- Without `note_id`, the API creates a new note (`N-xxxxxxxxxx`, version 1, response 201).
- With an existing `note_id`, only the note's author can save a new version (response 200).
- Every save runs as one multi-document transaction:
  1. insert `note_versions {_id: "<note_id>:<n>"}`;
  2. bump `notes.version` from n−1 to n.

  The unique `_id` makes each version number single-use. A stale `base_version`, or a
  concurrent save, gets a 409 `version_conflict`.

### Error codes

Errors have the shape `{"detail": {"code", "message"}}`. The `code` is a stable rule key, like
the DB's `DETAIL` keys:

| Status | Codes |
|---|---|
| 401 | `auth_required`, `invalid_token` |
| 403 | `profile_required`, `team_access_denied`, `student_required`, `note_author_required` |
| 404 | `team_not_found`, `note_not_found` |
| 409 | `version_conflict`, `note_team_mismatch` |
| 422 | `team_id`, `document_validation`, pydantic validation errors |
| 502 | `postgres_unavailable`, `postgres_error` |

## Configuration

Settings are read from the environment, then `api/.env` (git-ignored; see `.env.example`), then
the defaults.

| Variable | Default | Notes |
|---|---|---|
| `SUPABASE_TARGET` | `local` | `local` reads `API_URL`/`ANON_KEY` from `npx supabase status -o env`. `remote` reads `web/.env.remote`. |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | — | Override the target. Use the anon/publishable key only. |
| `MONGO_TARGET` | `atlas` | `atlas` uses `MONGODB_URI`, or reads it from `../atlas-credentials.env` at startup without printing it. `local` uses `mongodb://127.0.0.1:57018/?directConnection=true`. |
| `MONGO_DB` | `elp` | |
| `CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | |

## Run

```bash
cd api
uv sync                                                  # Python 3.12
uv run uvicorn app.main:app --reload --port 8000         # local Supabase + Atlas
SUPABASE_TARGET=remote uv run uvicorn app.main:app --port 8000   # live project + Atlas
MONGO_TARGET=local uv run uvicorn app.main:app --port 8000       # offline Mongo (see below)
```

Docs are served at `http://localhost:8000/docs`. Example call:

```bash
TOKEN=$(curl -s -X POST "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" \
  -H 'content-type: application/json' -d '{"email":"arun@example.edu","password":"Countersign@2026"}' | jq -r .access_token)
curl -s "localhost:8000/notes?team_id=T01" -H "Authorization: Bearer $TOKEN" | jq
```

## MongoDB scripts (repo root)

| Script | Purpose |
|---|---|
| `mongo/validators.js` | Adds `$jsonSchema` validators (strict, error) to `notes`, `note_versions`, `github_events` and `portfolios`. Reports existing documents that would fail (must be 0). Creates the indexes: unique `note_id`, `note_versions {note_id:1, version:-1}` unique, unique `event_id`, unique `portfolios.usn`. Backfills one `note_versions` snapshot per existing note. Idempotent. Run it again after `mongo/seed.js`, because seed.js drops the collections. |
| `mongo/portfolio_merge.js` | One aggregation: `notes` + `$unionWith` `note_versions`, `github_events` (unwound), `pg_portfolio_export` (optional) and the known `portfolios`, then `$group` per student and `$merge` into `elp.portfolios`, stamped with `generated_at`. A student with nothing recorded gets "no recorded evidence yet". |
| `uv run python -m app.export_pg` (in `api/`) | Optional. Signs in as the admin persona (RLS, no service key) and writes the relational half of each portfolio into `pg_portfolio_export`: name, semester, projects with skills, and claim counts. Marks are never exported. |
| `scripts/check_mongo_validators.sh [--local]` | Proves on a scratch database (`elp_validator_check`, dropped afterwards) that the validators accept the fixture's own M1, M2, M3 inserts and M15–M17 updates, and reject six malformed writes. |
| `scripts/mongo_local.sh [--fresh]` | Starts the docker container `elp-mongo-local` (mongo:8, port 57018) as a single-node replica set so transactions work, then loads seed, validators and portfolio merge. |

Apply to Atlas without printing the URI:

```bash
set -a; . ./atlas-credentials.env; set +a
npx -y mongosh@latest "$MONGODB_URI" --quiet < mongo/validators.js
npx -y mongosh@latest "$MONGODB_URI" --quiet < mongo/portfolio_merge.js
```

## Tests

```bash
cd api && uv run pytest -q                    # local Supabase personas + Atlas
MONGO_TARGET=local uv run pytest -q           # local Supabase + elp-mongo-local
```

The tests never write to `elp`. They seed a scratch database (`elp_api_test`) with the
fixture's M1 and M2 documents, apply `mongo/validators.js` to it, and drop it at the end. The
tests cover:

- auth required, and garbage, forged and wrong-secret HS256 tokens;
- forbidden teams for a teamless student, another team's student and another course's faculty,
  plus unknown or malformed team ids;
- the member and staff privacy tiers;
- create, update and history, including stale-version 409 and author-only edits;
- consistency for student, faculty and teamless callers, with no commit messages leaked.

Personas must exist (`scripts/create_personas.py --target local`).

## Known gaps

- `note_versions` is append-only by API contract. The validator stops malformed documents and
  the unique `_id` stops a version being written twice, but an Atlas user with write access
  could still edit a document. For production, connect with an Atlas user whose custom role has
  only `find` and `insert` on `note_versions` (Atlas UI). The prototype uses the atlasAdmin URI,
  locally only.
- The backfill snapshots each existing note at its current version number. N01 is at version 3,
  so its first receipt is `N01:3` and the next save is `N01:4`. Earlier versions were never
  captured, and the backfill does not invent them.
- Re-running `mongo/seed.js` on Atlas drops the validators. Re-run `validators.js` afterwards.
