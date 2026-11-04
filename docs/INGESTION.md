# Ingestion: GitHub push → inbox → raw log → projection

How a `git push` becomes evidence in Countersign. This is the `docs/PLAN.md` §2 item 8 contract,
**inbox → log → projection**, and the §5 architecture as it is built. Reference material for
each part:

| Part | Where |
|---|---|
| Inbox, projection, search, Realtime (SQL) | `supabase/migrations/20261105000005_ingest.sql`, `…0006_ingest_worker.sql` |
| Webhook receiver | `supabase/functions/github-webhook/index.ts` |
| Worker, `/ask`, `/consistency`, `/ingest/*` | `api/app/worker.py`, `ask.py`, `consistency.py`, `trace.py`, `api/README.md` |
| Replay fixtures | `ingest/` (`ingest/README.md`) |
| Tests | `supabase/tests/05_ingest.sql`, `06_ingest_worker.sql`, `api/tests/test_worker.py`, `web/e2e/10-ingest-live.spec.ts` |

## 1. Architecture

```
GitHub ──POST (HMAC X-Hub-Signature-256)──▶ Edge Function github-webhook
                                              │ verifies the signature over the raw body
                                              │ (constant time), then ONE rpc as service_role
                                              ▼
 1 INBOX        public.ingest_receive()      ONE transaction:
                                               INSERT ingest_event (delivery_id PK)
                                               + pgmq.send('github_ingest', {delivery_id, payload})
                                             answers 202 in ~150 ms; no Mongo, no projection here
                                              │
                    (python -m app.worker --loop, or an admin's "Sync now" = POST /ingest/drain)
                                              ▼
 0 CONTENTS     optional: fetch pushed .md files at their commit (GITHUB_FETCH_CONTENTS=1)
 2 LOG          ingest_read() (oldest first) → upsert Mongo elp.github_events {_id: delivery_id}
                (e-mails replaced by sha256) → ingest_mark_raw(delivery_id, mongo_id)
 3 PROJECTION   project_push(delivery_id, payload, mongo_id): artifact, artifact_version,
                contribution, artifact_chunk; every INSERT ON CONFLICT DO NOTHING on an
                idempotency key; on success the queue message is archived
 4 FOLLOW-UPS   vault notes (shared/**.md) → Mongo notes + immutable note_versions;
                optional embeddings (VOYAGE_API_KEY); then ingest_event.followups_at
 5 REALTIME     AFTER INSERT trigger on contribution → realtime.send, metadata only, to the
                private topics team:<team_id> (members) and project:<id> (staff)
```

Why this shape:

- **The inbox is one transaction.** The `ingest_event` row and the queue message commit or roll
  back together, so there is never an event without a message or a message without an event.
- **The receiver does nothing slow.** GitHub times out after 10 s; the Edge Function only
  verifies and enqueues. Mongo and the projection happen in the worker.
- **Postgres is the source of truth for marks; Mongo is the raw log.** Mongo keeps every
  payload as received (minus e-mail addresses); Postgres keeps the relational projection that
  RLS, the rubric sheet and search use.
- **Every step is idempotent**, so delivery can be at-least-once:

| Step | Key | A retry or a redelivery |
|---|---|---|
| inbox | `ingest_event.delivery_id` (X-GitHub-Delivery) | `duplicate: true`, nothing stored |
| inbox, same push | `(repo_full_name, push_ref, push_after)` | `duplicate: true, duplicate_of`; a captured body re-sent under a new delivery id is a no-op |
| raw log | Mongo `_id = delivery_id` | the same document is rewritten |
| artifact | `(team_id, external_ref = path)` | the existing artifact is found |
| version | `(artifact_id, source_ref = commit SHA)` | nothing new |
| contribution | `(source, source_ref, usn, artifact_id)` | nothing new |
| chunk | `(artifact_id, version_no, chunk_no)` | nothing new |
| note version | Mongo `(note_id, source_ref = commit SHA)` | nothing new |

### Statuses and failure handling (`ingest_event.status`)

`queued` → `raw_stored` → `projected`; `failed` (retried); `ignored` (never queued: not a push,
an unregistered repository, a non-default branch, a branch deletion, no commits).

| What goes wrong | What happens |
|---|---|
| Mongo is down while logging | `ingest_fail`: attempts + 1, status `failed`; the message reappears after the visibility timeout (60 s) |
| The projection raises (bad data) | the sub-transaction rolls back: nothing half-projected; attempts + 1; retried |
| 5 failed attempts | the message is archived as a **dead letter** (`pgmq.a_github_ingest`), the error is kept |
| The worker is killed while holding a message, again and again | after 15 reads without finishing, the message is dead-lettered before any work |
| The worker dies after `project_push` committed (or its response is lost) | `followups_at` stays NULL; the next drain re-runs the follow-ups from the Mongo raw log |
| A team's push fails | that team's later pushes in the same drain wait (`deferred`), so a team's pushes are projected in order |
| Pushes arrive out of order anyway | `version_no` counts receipts; the *current* text is the version with the newest commit time (search and the Mongo note both use it), so late older text never becomes current |
| A push arrived before its repository was registered, or was dead-lettered | GitHub **Redeliver** (same delivery id) queues it again in the same transaction (`requeued: true`) |

## 2. Trust model: who gets credit

GitHub authenticates exactly one identity in a push: the **pusher** (`payload.sender`: login and
numeric id). Everything inside a commit (author name and e-mail, author date, the message and its
trailers) is written by whoever made the commit and can be set freely (`git commit --author`,
`GIT_AUTHOR_DATE`).

So:

1. `private.ingest_actor` maps the sender to a USN through a **verified** `student_identity`
   (`verified_at` set by an admin; GitHub OAuth later). When the identity records a GitHub user
   id, the sender's id must match it, so a renamed or recycled login does not inherit credit.
2. `private.resolve_author` maps each commit's claimed author (login, e-mail, or GitHub no-reply
   address) to a USN.
3. A commit is **credited** (version + contribution) only if the claimed author **is** the
   verified pusher and is a member of the repository's team (`private.ingest_credit`).
4. Every other commit is still **logged** in Mongo (`unattributed_commits`), and listed in
   `ingest_event.error` as *unknown author*, *authored as X but pushed by Y; unverified, not
   credited*, or *not a member of team T*. The warnings name a login or `email#<hash>`, never an
   e-mail address, because faculty can read that column.

Consequence for teams: a student's commits count when **that student pushes them**. A teammate
who merges someone else's branch does not earn credit for it, and does not give credit for it
either. The demo fixtures show both cases (`ingest/README.md`).

Self-declared values are kept, and labelled as such:

- `contribution.occurred_at` and `artifact_version.created_at` are the commit time (author's
  clock). **Milestone choice uses the server receive time** (`ingest_event.received_at`), so a
  backdated commit cannot be filed under an earlier, already-assessed component.
- `ai_assisted` comes only from an `AI-Assisted: yes` trailer: a declaration by the author, never
  detected. A `Co-Authored-By:` line alone does not set it.

Other privacy rules:

- The Mongo raw log replaces every e-mail address in the payload with its sha256
  (`email_sha256`). `resolve_author` matches that hash, so a replay from the log still resolves
  e-mail-only identities. GitHub no-reply addresses are public pseudonyms and are kept.
- Realtime broadcasts carry ids and a time only, never text, and none for a private artifact.
  Students hear only `team:<their team>`; `project:<id>` is for the project's staff.
- `/ingest/trace` and `/consistency` return metadata (SHAs, USNs, paths, counts), never commit
  messages or file contents.

## 3. Search and Ask

`search_chunks()` is a `SECURITY INVOKER` SQL function, so the caller's RLS filters every
candidate:

- **Scope.** Projected chunks are whole-file snapshots, one set per commit. Only the newest
  snapshot (by commit time) of each artifact is searched, so text that a later commit removed is
  not found, and a paragraph kept across versions is returned once. Hand-entered chunks (fixture
  and demo) are fragments and are all searched.
- **Keyword list.** A chunk matches if it holds ANY query word. Chunks are ranked by
  Σ idf(word)² over the words they hold, with the BM25 idf over the candidates, so one rare word
  ("provenance") outweighs several common ones ("team", "project"). Without this, a natural
  question buried the relevant note at rank 15. Now the two relevant notes are ranks 1 and 2.
- **Vector list.** Used only when a query embedding is passed (`VOYAGE_API_KEY`).
  `hnsw.iterative_scan = relaxed_order` keeps it full even though RLS filters after the index.
- **Fusion.** Reciprocal rank fusion, score = Σ 1/(60 + rank), in the same statement.

`POST /ask` retrieves with `search_chunks` as the caller (same team, author and since filters as
the search page), fetches the chunk text as the caller, and answers:

- **No `ANTHROPIC_API_KEY` (the default).** An extractive answer: the best-matching sentence of
  each of the top 3 chunks, each cited. Nothing is generated.
- **With the key.** Claude, with each chunk as a citable document. Every citation is checked on
  the server: it must point at a retrieved chunk, and its quote must be in that chunk. Text with
  no verified citation is **dropped** (`citation_check.uncited_dropped`), so an instruction
  planted in a note cannot reach the user by riding next to one real citation.
- **Markers.** The only `[n]` in an answer are the server's markers; a `[2]` inside note text
  is shown as `［2］`.

## 4. The consistency contract

`GET /consistency` checks the promise *every credited commit in the raw log is in the
projection, and nothing in the projection lacks a raw event*, per team and author, by full commit
SHA:

| Term | Meaning |
|---|---|
| credited commit | in `github_events.commits[]` (the verified pusher's own commit, pusher on the team) |
| expected | a credited commit that touched a tracked path (artifact type and `team_repo.track_paths`) |
| `matched` | expected and present as `contribution.source_ref` |
| `not_projected` | credited, but touched only untracked files: no row by design |
| `only_in_mongo` | expected but missing in Postgres: projection pending, lost, or Postgres was reset |
| `only_in_postgres` | a full SHA in Postgres with no raw event: Mongo was reset, or a row was written outside the pipeline |
| `outside_pipeline` | Mongo events without a `delivery_id` (the graded fixture's M2 pushes) and Postgres rows with a short `source_ref` (hand-entered demo rows): reported, not compared |

Both sides count **commits** (`mongo_commits` vs `postgres_commits`); `postgres_github_contributions`
counts rows (one per commit, author and artifact) and is shown as a secondary number. Postgres is
read page by page.

**Repair.**

- Postgres lost the projection (a reset, a restore): `python -m app.worker --reproject-from-log`
  feeds every raw event that is not projected back through `ingest_receive` (same delivery id,
  original receive time) and drains. The result is identical to the live run (checked: 9
  deliveries, 27 contributions, all consistent).
- The reverse is impossible by design: `ingest_event` stores no payload. If Mongo lost the log,
  clear the projection and replay the webhooks.
- Mongo notes out of step: `python -m app.worker --resync-notes`.

**Keep the stores in step locally.** A Postgres reset without a Mongo reset makes every earlier
push `only_in_mongo`. Use `scripts/reset_local.sh` (db reset, personas, and
`scripts/clear_local_pipeline.sh`), which the e2e global setup also runs.

## 5. Run it locally

Prerequisites: the local Supabase stack (`npx -y supabase@latest start`) and the local Mongo
container (`scripts/mongo_local.sh`). Never point any of this at Atlas or the cloud project.

```bash
scripts/reset_local.sh                                    # Postgres + personas + local Mongo pipeline docs
npx -y supabase@latest functions serve                    # terminal 1: the webhook (reads supabase/functions/.env)
(cd api && SUPABASE_TARGET=local MONGO_TARGET=local \
   uv run uvicorn app.main:app --port 8000)               # terminal 2: the API
(cd api && SUPABASE_TARGET=local MONGO_TARGET=local \
   uv run python -m app.worker --loop --interval 1)       # terminal 3: the worker
(cd web && npm run dev)                                   # terminal 4: the web app

uv run --python 3.12 python scripts/replay_webhooks.py    # 16 of 16 deliveries behave as expected
```

What to expect after the replay:

- 9 deliveries projected, 1 ignored (feature branch), 27 contributions, 2 Mongo notes;
- warnings: an unknown author (T01), and Rohan's commit pushed by Priya, unverified (T03);
- T00 has 18 artifacts: `docs/`, `supabase/`, `mongo/`, not the `web/` source tree;
- `/consistency` reports `all_consistent: true`.

Tests:

```bash
npx -y supabase@latest test db                            # pgTAP (on a freshly reset DB; 657 tests)
scripts/test_fixture.sh                                   # Q1–Q37 vs Appendix H
(cd api && MONGO_TARGET=local uv run pytest -q)           # API + worker (with an empty queue)
(cd web && npm run typecheck && npm run lint && npm run build && npm run e2e)
```

`npx supabase test db` assumes the seed state. Pipeline traffic (a replay, e2e spec 10) no longer
breaks it, but other e2e specs change seed data (a student joins a team, a mark is locked), so
reset before a gate run, with no e2e and no worker running at the same time.

## 6. Demo script: the live moment

**Before presenting** (5 minutes):

1. `scripts/reset_local.sh`, then start the four processes from §5. On the cloud stack instead:
   the worker MUST run with `SUPABASE_TARGET=remote`, the service key (or `INGEST_DB_URL`) and
   `MONGO_TARGET=atlas`, all from the environment, never committed:
   `python -m app.worker --loop --interval 1`. Without a running worker, a push stays `queued`
   and no toast appears (only an admin's **Sync now** would drain it).
2. Health check: `GET /ingest/status` as an admin (or the admin Ingestion panel) shows
   `waiting: 0`. A non-zero `waiting` that does not move means no worker is running.
3. Optional replay of the fixtures so the pages have history: `scripts/replay_webhooks.py`.

**The moment** (2 windows side by side):

1. Left: log in as **ramesh** (faculty F01) → `/sheet/P01`. The Live activity chip says **Live**
   (joined `project:P01`; RLS on `realtime.messages` allowed it).
2. Right: log in as **meera** (student, T01) → `/projects/P01?tab=activity`. Her channel is
   `team:T01`; she never hears another team's work.
3. Push. Choose one and say which:
   - **Scripted push (recommended, works offline):** a signed push of a new vault note through
     the real Edge Function, exactly what e2e spec 10 builds (`web/e2e/ingest.ts`, `buildPush`
     + `deliver`). Tell the examiner it is a signed replay of a GitHub payload, so it carries the
     note text inline (`x_contents`).
   - **Real `git push`** to a registered repository: needs the cloud webhook, the worker running
     with `GITHUB_FETCH_CONTENTS=1` and a `GITHUB_TOKEN` (the repo is private), and the pusher's
     verified identity. Without the fetch flag the push still produces the version, the
     contribution, the toast and the feed row, but **no searchable text**, because GitHub push
     payloads list paths, not file contents.
4. Within about a second (webhook ~150 ms, worker poll 1 s, broadcast ~100 ms): a toast
   `New evidence: 1RV24CY033 · <note> · github` on ramesh's sheet and on meera's page, a new
   feed row, and the sheet's progress refreshes. Point out that the faculty page shows ids and
   times only, never the note text.
5. **Drill down.** Ramesh clicks the feed item → the trace sheet: the Mongo raw event
   (`_id` = delivery id, sender, per-commit SHA, credited USN, paths) next to the Postgres rows
   (the `ingest_event`, the contribution, the `artifact_version` whose `mongo_ref` is the
   delivery id). Open **Show the SQL / Mongo query that ran**.
6. **Search and Ask.** Meera searches the note's unique word on `/search`: the new chunk is
   found (keyword rank, RRF score), with `search_chunks` in the SQL drawer. Ask a question: the
   answer quotes it with a citation. Then log in as **lakshmi** (faculty of another course):
   the same search returns nothing (RLS).
7. **Consistency.** As **admin**: `/admin` → Ingestion → the inbox row for the push (click it:
   the same trace sheet) and *Mongo ↔ Postgres consistency*: **all consistent**, counted in
   commits on both sides.

**Questions to expect, and where the answer is:**

- *"What if GitHub sends the same delivery twice?"* The inbox key; replay shows `duplicate: true`.
- *"What if someone replays a captured request?"* The signature covers the body only, so the push
  key `(repo, ref, after)` makes it a duplicate (`t01-push-01-replayed` in the manifest).
- *"Can a student claim a teammate's work with `git commit --author`?"* No: the commit is credited
  only to the authenticated pusher (§2); `05_ingest.sql` has the spoofing test.
- *"Rebuild Postgres from Mongo?"* `python -m app.worker --reproject-from-log` (§4).
- *"What if the worker crashes mid-way?"* §1 failure table; `api/tests/test_worker.py` covers each case.

## 7. Known limits

- **Real pushes and file text.** Searchable text from a real push needs
  `GITHUB_FETCH_CONTENTS=1` (+ `GITHUB_TOKEN` for a private repository). It is off by default and
  was tested with a mocked GitHub API only (no token was available).
- **Optional AI providers.** `VOYAGE_API_KEY` (embeddings) and `ANTHROPIC_API_KEY` (generative
  answers) were never exercised against the real services; both paths are unit-tested with stubs.
  Without them everything works: keyword search and extractive, cited answers.
- **Identity verification is administrative.** `verified_at` is stamped by an admin (seeded for
  the demo); GitHub OAuth would stamp it for real. Sanvid's login is a placeholder and stays
  unverified.
- **Version numbers are receipt numbers.** `version_no` follows projection order; "latest" means
  newest commit time. A commit time is self-declared, so an author can reorder their *own*
  versions, but not move them across milestones.
- **One worker is enough.** Two concurrent drains are safe (row locks, idempotent keys) but can
  each defer the other's team.
