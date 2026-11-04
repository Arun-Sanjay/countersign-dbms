# Countersign API

*Every mark has a receipt.* This is the small FastAPI service of Countersign (Unified Experiential
Learning Platform, RVCE CD252IA). It handles the jobs Postgres cannot do by itself:

- **Notes in MongoDB with immutable history.** `elp.notes` holds the current state of each note.
  `elp.note_versions` holds one append-only receipt per save: who wrote it, when, and a sha256
  of the content.
- **The ingestion worker** (`app/worker.py`). It drains the pgmq queue `github_ingest`: raw push
  into Mongo `github_events` (`_id` = delivery id), then the Postgres projection, then vault notes
  into `notes` + `note_versions`. See "Ingestion worker" below.
- **A cross-database consistency view.** It checks that every commit in the Mongo raw log was
  projected into Postgres `contribution` rows, and the reverse, per team and author.
- **`/ask`.** A permission-aware answer over the project evidence, retrieved as the caller,
  with citations mapped to `chunk_id`s.

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
   all). User requests never use a service key. The one service-role path is the ingestion
   worker (`POST /ingest/drain` after an admin check, or the CLI), because the pipeline RPCs
   are service_role-only by design.
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
| GET | `/consistency[?team_id=]` | For each visible team, per author: the Mongo raw log vs the Postgres projection, matched by full commit SHA (details below). Only counts and SHAs are returned, never commit messages. A team with no rows says "no recorded evidence yet". |
| POST | `/ingest/drain` | **Admin only** (`403 admin_required` otherwise). Body `{max_messages?: 1..500, vt?: 5..3600}`. Drains the queue now (the demo's "sync now" button) and returns `{processed, projected, duplicates, ignored, failed, dead_letters, contributions, note_versions, queue_empty, outcomes[]}`. `503 worker_unconfigured` when neither a service key nor `INGEST_DB_URL` is set. |
| GET | `/ingest/trace?delivery_id=` or `?contribution_id=` | **Admins and teaching faculty** (`403 staff_only` for students; `404` when RLS on `ingest_event` hides the delivery). One push side by side: the Mongo `github_events` document (ref, before/after, sender, logged_at, per commit the SHA, credited USN, paths, commit time; no messages, no file text, no e-mail) and the Postgres `ingest_event`, `contribution` and `artifact_version` rows it produced, matched by SHA, plus the exact queries (`queries`). Backs the drill-down sheet in the web app. |
| GET | `/ingest/status` | Admins and teaching faculty: deliveries by status (as the caller, RLS) and `waiting` / `oldest_waiting`: how many are still queued, raw_stored or failed. Non-zero with nothing moving means no worker is running. |
| POST | `/race/run` | **Faculty and admins** (`403 staff_only` for students). Body `{strategy: S1\|S2\|S3\|S4\|S6\|S7, isolation: RC\|RR\|SER, n: 2..100}`. Runs ONE race of the Innovative Experiment against the race lab (`elp-race-pg`, port 55433, `RACE_DSN`), using `experiments/race/harness.py` itself (`app/race.py`), never the product database. Returns `{admitted, refused, aborted, errors, aborts_40001, retries, final_size, max_size, over_admitted, duration_ms, clients[], schedule (N = 2 only), lab}`. Writes nothing to the reported `exp.*` results; T02 is reset to 3/4 afterwards. `503 race_lab_offline` (with the start command `experiments/race/setup.sh`) when the container is down or not loaded; `409 race_busy` during another race or a harness run. |
| POST | `/ask` | Body `{question, team_id?, author_usn?, since?: YYYY-MM-DD, limit?: 1..10 (default 5)}`. Retrieval by `search_chunks` **as the caller** (RLS) with the same filters, then an answer with numbered citations (details below). `team_id` outside the caller's teams gives 403 like every team endpoint. |

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

### `GET /consistency`

The contract is "every credited commit in the raw log is projected" (`docs/PLAN.md` §2 item 8;
`docs/INGESTION.md`). The unit on both sides is the **commit**: `mongo_commits` against
`postgres_commits` (distinct SHAs); `postgres_github_contributions` counts rows (one per
commit, author and artifact, i.e. per tracked file) for reference. Postgres is read page by page
(`max_rows` is 1000). Only `commits[]` (credited: the verified pusher's own) is compared;
`unattributed_commits[]` never expects a row. Per author:

| Field | Meaning |
|---|---|
| `matched` | commits present in the log and as `contribution.source_ref` |
| `only_in_mongo` | commits in the log that touched a tracked path but have no row: projection pending or lost |
| `only_in_postgres` | a full SHA in Postgres with no raw event in the log |
| `not_projected` | commits in the log that touched only untracked files (e.g. `package.json`, or a path outside the repo's `team_repo.track_paths`). No row is expected, so they are not a discrepancy. Uses `app/ingest_rules.artifact_type` + `path_allowed`, mirrors of the SQL rules, with a test that compares the two. |
| `outside_pipeline` | `{mongo_commits, postgres_contributions}`: evidence that never went through the pipeline. Mongo events without a `delivery_id` (the fixture's M2 pushes) and Postgres rows whose `source_ref` is not a 40-hex SHA (hand-entered or demo rows). Reported, not compared. |
| `status` | `consistent`, `only_in_mongo`, `only_in_postgres`, `mismatch`, or `outside_pipeline` when only such evidence exists |

Each team also gets `matched_commits` and a `status`: `consistent`, `inconsistent`, `outside_pipeline_only` or `no_evidence`. It gets `pipeline_events` too, the `ingest_event` counts by status, which RLS shows only to admins and teaching faculty. `consistent` means no author has a discrepancy.

After the replay (`scripts/replay_webhooks.py`, then `python -m app.worker --once`), T00, T01 and T03 are all `consistent`. The demo's hand-entered T00 rows (`3f9c2ab`, `8d41e07`) are listed under `outside_pipeline`.

### `POST /ask`

1. **Retrieve as the caller.** `search_chunks` runs through PostgREST with the user's JWT and
   ranks by RRF. The chunk text is fetched the same way, so RLS decides every candidate:
   - faculty see only the *submitted* text of the projects they teach;
   - students see their teams' text, but never a teammate's private chunk.

   If `VOYAGE_API_KEY` is set, the question is also embedded and the vector list is fused in
   (`retrieval: "hybrid"`). Otherwise the search is keyword-only.
2. **Answer.**
   - **Without `ANTHROPIC_API_KEY` (`mode: "extractive"`).** The answer quotes the
     best-matching whole sentence of each of the top 3 chunks, each followed by `[n]`. Nothing
     is generated.
   - **With `ANTHROPIC_API_KEY` (`mode: "generative"`).** The model is `ANTHROPIC_MODEL`
     (default `claude-haiku-4-5`). Each chunk is sent as one document with Claude citations
     enabled, and the system prompt treats chunk text as untrusted data. Every returned
     citation is checked on the server and kept only if both hold:
     - its document index is one of the retrieved chunks (cited ⊆ retrieved);
     - its quoted text occurs in that chunk.

     Only text blocks backed by at least one surviving citation are kept: a sentence with no
     verified citation (for example an instruction planted in a note that the model repeated)
     is dropped and counted in `citation_check.uncited_dropped`. If no citation survives, or the
     model refuses or is unreachable, the endpoint falls back to the extractive answer and says
     so in `notes`.
   - **Markers.** The only `[n]` in `answer` are the server's own citation markers: a `[2]`
     inside quoted note text or model text is rewritten to `［2］` (full-width brackets), so it
     can never link to a different source. `answer_parts` carries the same answer as
     structured spans `[{text, cites}]`.
3. **Response.** `{mode, model, retrieval, answer, answer_parts, filters, citations[{marker,
   chunk_id, artifact_id, artifact_title, version_no, author_usn, team_id, project_id,
   visibility, snippet, ...}], retrieved[{chunk_id, score, rank_fts, rank_vec}],
   citation_check{cited_subset_of_retrieved, cited, retrieved, dropped_unverified,
   uncited_dropped}, notes, logged}`.
   `logged` is true only if a table `ai_query_log` exists and accepted the row; no such table
   exists yet, so it is skipped quietly.

## Ingestion worker

```bash
cd api
MONGO_TARGET=local uv run python -m app.worker --once        # drain until empty, print a summary
MONGO_TARGET=local uv run python -m app.worker --loop -v     # keep draining, one JSON line per message
uv run python -m app.worker --resync-notes                   # rebuild vault notes from the raw log
uv run python -m app.worker --reproject-from-log             # rebuild the Postgres projection from the raw log
uv run python -m app.worker --embed-missing                  # embed chunks lacking a vector (VOYAGE_API_KEY)
```

Options: `--max N` (messages per drain), `--batch 5` (clamped so batch × 12 s stays under the
visibility timeout), `--vt 60` (visibility timeout in seconds), and `--backend rest|sql`.

**Per drain:** first the follow-up pass (step 5 below for projected events whose
`ingest_event.followups_at` is still NULL, i.e. a crash or a lost response between steps 4 and
5), then messages oldest first. Once a team's message fails, that team's later messages in the
same drain are `deferred` (left in the queue), so a team's pushes are projected in order.

**Per message:**

0. A message read more than 15 times without finishing (a worker killed mid-message, again and
   again) is dead-lettered before any work.
1. `ingest_read` (pgmq read with a visibility timeout, oldest first).
   Optional: with `GITHUB_FETCH_CONTENTS=1` the worker fetches each added/modified `.md` file at
   its commit from the GitHub contents API into `commits[i].x_contents` (real pushes carry
   paths only; `GITHUB_TOKEN` for a private repository). Off, a real push still gives
   versions and contributions, but no chunks and no Mongo note.
2. Upsert the raw push into Mongo `github_events`:
   - `_id` = `event_id` = the delivery id;
   - the `payload` with every e-mail address replaced by `email_sha256` (GitHub no-reply
     addresses are kept; `private.resolve_author` matches the hash, so a replay still resolves);
   - `commits[]` with `author_usn`, only for commits Postgres credits (the verified pusher's own);
   - `unattributed_commits[]` for every other commit, with name and login only.
3. `ingest_mark_raw`.
4. `project_push`.
5. On success, two follow-ups, then `ingest_event.followups_at`:
   - **Vault notes.** Every `shared/**.md` / `vault/**.md` body in the push becomes an
     immutable `note_versions` receipt plus the current `notes` document, in one Mongo
     transaction like `POST /notes`:
     - note id `NG-<sha1(team:path)[:12]>`, status `final`, visibility `team`;
     - tags come from front matter and `#tags`, links from `[[wiki-links]]`;
     - `source_ref` is the commit SHA, and `artifact_id` / `artifact_version_no` point at the
       Postgres version.

     A version is written only for commits that Postgres projected. The note shows the version
     with the newest COMMIT time: a push that arrives late is kept as a receipt but never puts
     older text back.
   - **Embeddings.** Only when `VOYAGE_API_KEY` is set (voyage-4, 1024 dims,
     `embedding_model` stored).

**At-least-once delivery.** A message is archived only by a successful `project_push` (or as a
dead letter). After a crash, or any failure, it reappears after `vt` seconds and is processed
again. Every step is idempotent, so a second run changes nothing:

| Step | Idempotency |
|---|---|
| raw log | Mongo `_id` = delivery id |
| status | `ingest_mark_raw` |
| projection | `project_push` treats a finished delivery as a no-op and uses its `ON CONFLICT` keys |
| notes | keyed by (note, commit SHA) |
| embeddings | only `embedding IS NULL` |

**Failures.**

- `project_push` counts its own attempts.
- A failure before it, such as Mongo being down, is recorded by `ingest_fail` (migration 0006):
  `attempts + 1`, status `failed`, and the error text, which never contains the Mongo URI.
- After 5 attempts the message is archived as a dead letter (`pgmq.a_github_ingest`).

**Postgres access.** The pipeline RPCs are service_role-only, so the worker uses one of:

- `RestStore`: PostgREST with `SUPABASE_SERVICE_ROLE_KEY`;
- `SqlStore`: psycopg on `INGEST_DB_URL`, each call `SET LOCAL ROLE service_role`.

For the local stack, both values come from `supabase status`. The default is `rest` when a
service key is available.

### Error codes

Errors have the shape `{"detail": {"code", "message"}}`. The `code` is a stable rule key, like
the DB's `DETAIL` keys:

| Status | Codes |
|---|---|
| 401 | `auth_required`, `invalid_token` |
| 403 | `profile_required`, `team_access_denied`, `student_required`, `note_author_required`, `admin_required`, `staff_only`, `permission_denied` |
| 404 | `team_not_found`, `note_not_found` |
| 409 | `version_conflict`, `note_team_mismatch`, `race_busy` |
| 422 | `team_id`, `document_validation`, pydantic validation errors |
| 502 | `postgres_unavailable`, `postgres_error`, `race_error` |
| 503 | `worker_unconfigured`, `race_lab_offline` |

## Configuration

Settings are read from the environment, then `api/.env` (git-ignored; see `.env.example`), then
the defaults.

| Variable | Default | Notes |
|---|---|---|
| `SUPABASE_TARGET` | `local` | `local` reads `API_URL`/`ANON_KEY` from `npx supabase status -o env`. `remote` reads `web/.env.remote`. |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | — | Override the target. Use the anon/publishable key only. |
| `MONGO_TARGET` | `atlas` | `atlas` uses `MONGODB_URI`, or reads it from `../atlas-credentials.env` at startup without printing it. `local` uses `mongodb://127.0.0.1:57018/?directConnection=true`. |
| `MONGO_DB` | `elp` | |
| `RACE_DSN` | `postgresql://postgres:localdev@localhost:55433/race` | `POST /race/run` only: the throwaway race-lab container from `experiments/race/setup.sh` (its documented local password). Never returned; errors name only host:port/database. |
| `CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | |
| `INGEST_BACKEND` | `rest` if a service key is set, else `sql` | How the worker reaches the pipeline RPCs. |
| `SUPABASE_SERVICE_ROLE_KEY` | local: from `supabase status` | **Worker only.** Never used for a user request, never printed. Remote: set it in the environment. |
| `INGEST_DB_URL` | local: `DB_URL` from `supabase status` | Worker only. A Postgres URL, used instead of the service key with `INGEST_BACKEND=sql`. |
| `VOYAGE_API_KEY`, `VOYAGE_MODEL` | unset, `voyage-4` | Optional. Enables embeddings and hybrid retrieval. |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | unset, `claude-haiku-4-5` | Optional. Enables generative `/ask` answers; without it they are extractive. |
| `GITHUB_FETCH_CONTENTS`, `GITHUB_TOKEN`, `GITHUB_API_URL` | off, unset, `https://api.github.com` | Worker only. `GITHUB_FETCH_CONTENTS=1` fetches pushed markdown from the contents API (the token authenticates it; needed for private repositories). An ambient `GITHUB_TOKEN` alone does not turn it on. |

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
- consistency for student, faculty and teamless callers, with no commit messages leaked;
- `tests/test_race.py`: `/race/run` needs a token (401) and a staff role (403 for students), validates the body (no S5, N 2..100), answers 503 `race_lab_offline` with the start command when nothing listens (RACE_DSN pointed at a closed port; the password is never echoed), and, when `elp-race-pg` is up, runs real races whose counts add up (skipped otherwise).
- `tests/test_worker.py`:
  - **worker idempotency.** One message is processed twice and the raw log is replayed into
    the notes, with no new rows on either side.
  - **Mongo failure.** The attempt is counted, the message stays hidden for `vt`, and the
    retry projects it.
  - **Projection failure.** Five attempts end in a dead letter, with nothing half-projected.
  - **Path rule.** The Python mirror of the path rule is compared against the SQL function.
  - **Consistency classification** on a crafted log.
  - **`/ingest/drain`.** No token gives 401, a student or faculty member gets 403, an admin
    gets 200.
  - **`/ask` permissions.** F02 gets no P06 chunks; F01 gets only submitted P06 text; each
    student's results stay inside their own teams; cited ⊆ retrieved.
  - **Answers without network.** The extractive answer, and generative citation checking
    with a stub client.

  The worker tests run their Postgres side inside one transaction that is always rolled back,
  so they leave no rows behind. `test_drain_as_admin` uses the real queue: anything queued at
  that moment is projected, and its raw events go to the scratch Mongo database.

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
