# Ingestion: GitHub webhook to inbox, raw log, then projection

This folder holds the replay fixtures and their generator. The database half lives in
`supabase/migrations/20261105000005_ingest.sql` and the inbox in
`supabase/functions/github-webhook/`. The design comes from `docs/PLAN.md` §2 item 8 and §5.
The whole pipeline (trust model, consistency contract, how to run it locally, the demo script)
is described in **`docs/INGESTION.md`**; this file is the reference for the SQL side and the
fixtures.

```
GitHub ──POST──▶ Edge Function github-webhook        verifies X-Hub-Signature-256 (HMAC, constant time)
                   │ supabase-js, service_role
                   ▼
1 INBOX       ingest_receive()      one transaction: INSERT ingest_event (delivery_id PK,
                                    ON CONFLICT DO NOTHING) + pgmq.send('github_ingest')
2 LOG         worker: ingest_read() → upsert Mongo elp.github_events {_id: delivery_id}
              → ingest_mark_raw(delivery_id, mongo_id)
3 PROJECTION  worker: project_push(delivery_id, payload, mongo_id)
              → artifact / artifact_version / contribution / artifact_chunk, every INSERT
                ON CONFLICT DO NOTHING on an idempotency key; the queue message is archived
4 FOLLOW-UPS  worker: vault notes → Mongo notes/note_versions, optional embeddings;
              ingest_event.followups_at (a crash before it is repaired by the next drain)
5 REALTIME    trigger on contribution INSERT → realtime.send to private topics team:<id>
              (members) and project:<id> (staff only); metadata only, never for a private
              artifact; RLS on realtime.messages decides who may listen
```

Each step is idempotent, so any step can be retried safely:

| Step | Idempotency key | What a retry or redelivery does |
|---|---|---|
| inbox | `ingest_event.delivery_id` (X-GitHub-Delivery) | returns `duplicate: true`. It adds no row and no queue message. A redelivery of a push that was ignored (repository not registered yet) or dead-lettered is queued again (`requeued: true`). |
| inbox (push) | `(repo_full_name, push_ref, push_after)` | the same signed body re-sent under a NEW delivery id (headers are not signed): `duplicate: true, duplicate_of`. |
| raw log | Mongo `_id = delivery_id` | the upsert overwrites the same document |
| artifact | `(team_id, external_ref = path)` where the source is github or obsidian | finds the existing artifact |
| version | `(artifact_id, source_ref = commit SHA)` | none |
| contribution | `(source, source_ref, usn, artifact_id)` | none |
| chunk | `(artifact_id, version_no, chunk_no)` | none |

## RPCs (service_role only, `SECURITY DEFINER`, `search_path = ''`)

| Function | Returns | Used by |
|---|---|---|
| `ingest_receive(p_delivery_id, p_event_type, p_payload)` | `{delivery_id, status, duplicate, msg_id, team_id, note[, requeued, duplicate_of]}` | Edge Function, `worker --reproject-from-log` |
| `ingest_read(p_qty = 10, p_vt = 60)` | rows `(msg_id, read_ct, delivery_id, event_type, team_id, payload, commit_authors)` | worker |
| `ingest_mark_raw(p_delivery_id, p_mongo_id)` | `{delivery_id, status, mongo_id}` | worker |
| `project_push(p_delivery_id, p_payload, p_mongo_id)` | `{status, actor_usn, commits, skipped_commits, unverified_commits, artifacts_created, versions, contributions, chunks, warnings[]}` | worker |
| `ingest_fail(p_delivery_id, p_error, p_max_attempts = 5)` (migration 0006) | `{status, attempts, dead_letter, changed}` | worker, for a failure before `project_push` (e.g. Mongo down) |

`ingest_read` returns the oldest messages first. `commit_authors` maps each commit SHA to the
USN it is **credited** to (`private.ingest_credit`: the verified pusher's own commit, pusher on
the team), or null. The worker can then write `github_events.commits[].author_usn` (the Mongo
validator requires a USN) without its own identity lookup, and the log's attributed commits
are exactly the ones Postgres credits. Every other commit (unknown author, someone else's
commit, non-member) goes to `unattributed_commits[]` (name and login only) next to the
`payload`, which is kept with every e-mail address replaced by its sha256 (`email_sha256`).

**Worker** (`api/app/worker.py`; details in `api/README.md`, "Ingestion worker"):

```bash
cd api && MONGO_TARGET=local uv run python -m app.worker --once     # or --loop; admins: POST /ingest/drain
```

1. `rows = ingest_read(10, 60)`
2. For each row, upsert `{_id: delivery_id, event_id: delivery_id, delivery_id, team_id, repo, type: 'push', pushed_at, commits: [...], unattributed_commits: [...], payload}` into Mongo.
3. Call `ingest_mark_raw(delivery_id, delivery_id)`.
4. Call `project_push(delivery_id, payload, delivery_id)`.
5. On success:
   - mirror the vault markdown into Mongo `notes` + `note_versions`;
   - optionally embed the new chunks (`VOYAGE_API_KEY`).

Delivery is at-least-once, and every step is idempotent.

- If `project_push` answers `status: failed`, the message becomes visible again after `p_vt`
  seconds and is retried.
- If the worker fails before that (Mongo unreachable), it calls `ingest_fail`, which counts
  the attempt in the same way.
- After 5 attempts the message is archived as a dead letter, and `ingest_event.error` holds the
  SQLSTATE and message.

**Statuses** (`ingest_event.status`):

- `queued` → `raw_stored` → `projected`;
- `failed` (retryable);
- `ignored`: not a push, an unregistered repository, a branch other than the default branch, a branch deletion, or a push with no commits. Ignored events are never queued.

## Projection rules (`project_push`)

- **Who pushed (authenticated).** `payload.sender` is the only identity GitHub authenticates.
  `private.ingest_actor` maps it to a USN through a **verified** `student_identity` (`verified_at`
  set), matching the numeric GitHub id when the identity records one, else the login.
- **Who the commit claims to be by (not authenticated).** The commit author resolves to a USN
  in this order (`private.resolve_author`):
  1. `author.username` → provider `github`;
  2. `author.email` → provider `email` (or `author.email_sha256`, the raw log's scrubbed form);
  3. a GitHub no-reply e-mail `<id>+<login>@users.noreply.github.com` → that login.
- **Credit.** A commit is credited only when its author USN **equals the verified pusher's**
  and that student is a member of the repo's team. Otherwise the whole commit is skipped with a
  warning in `ingest_event.error`: *unknown author*, *authored as X but pushed by Y;
  unverified* (anyone can write `git commit --author`), or *not a member of team T*. Warnings
  name a login or `email#<8 hex of sha256>`, never an address. The event still ends as
  `projected`.
- **Self-declared fields.** The commit timestamp (`occurred_at`) and the `AI-Assisted:` trailer
  are written by the author and are kept as declarations. Milestones use the server receive
  time (`ingest_event.received_at`), not the commit time.
- **Which paths.** Added and modified paths are tracked, inside the repository's
  `team_repo.track_paths` allow-list when it has one (T00, this repository: `docs/`, `shared/`,
  `vault/`, `supabase/`, `mongo/`, the root README and PROJECT_MASTER.md; not `web/` or `api/`).
  A removed path counts only if its artifact already exists. The artifact type comes from the path:

  | Path | Type | Source |
  |---|---|---|
  | `.dot` `.svg` `.drawio` `.mmd` `.puml` | diagram | github |
  | `.md` under `shared/` or `vault/` (Obsidian vault) | note | obsidian |
  | `docs/` (`.md` `.pdf` `.docx` `.txt` `.tex`) | report | github |
  | `.pptx` `.odp` `.key` | slides | github |
  | `.sql` `.py` `.ts` `.tsx` `.js` `.jsx` `.mjs` `.cjs` `.sh` `.css` `.html` | code | github |
  | any other `.md` | report | github |
  | anything else | not tracked | |

- **Milestone of a new artifact.** An existing artifact keeps its milestone. For a new one,
  rules are tried in order on the day the server RECEIVED the push, in Asia/Kolkata
  (`private.ingest_milestone`; a backdated commit cannot reach an earlier milestone):
  1. `team_repo.default_milestone_no`, if it is set and not locked. T00 uses 9, *Demo and Draft Report*.
  2. Otherwise, the project's next open milestone by deadline: the unlocked milestone with the earliest `deadline >= receive day`.
  3. Otherwise, the unlocked milestone with the latest deadline, when every deadline has passed.
  4. Otherwise, nothing is filed and a warning is recorded, because every milestone is locked.
- **Rows written:**
  - one `artifact_version` per (artifact, commit), with `created_by` = the author, `created_at` = commit time and `mongo_ref` = the Mongo id. `version_no` counts receipts in projection order; the "latest" text is the version with the newest `created_at` (search, note sync), so a push that arrives late never makes older text current;
  - one `contribution` per (commit, author, artifact), with:
    - `source = 'github'`, `source_ref` = SHA;
    - `occurred_at` = commit timestamp (self-declared), `created_at` = server receive day;
    - `description` = first line of the message;
    - `contribution_type` derived from the artifact type.
- **AI assistance.** It is **declared** with a trailer line `AI-Assisted: yes` (or `true`).
  That sets `contribution.ai_assisted` and `artifact_version.ai_assistance = 'assisted'`. A
  `Co-Authored-By:` line alone does **not** set it.
- **Markdown bodies.** Push payloads carry paths, not file contents. The worker fills
  `commits[i].x_contents = {"<path>": "<text at that commit>"}` from the GitHub contents API
  when `GITHUB_FETCH_CONTENTS=1` (with `GITHUB_TOKEN` for a private repository); the replay
  fixtures carry it inline. Markdown
  bodies are split by `private.chunk_markdown`: paragraphs packed up to 1200 characters, and a
  heading starts a new chunk. The chunks go into `artifact_chunk` with team visibility,
  `chunk_no`, `version_no` and `content_hash` (sha256). Without `x_contents`, versions get
  `content_hash` NULL and no chunks.
- **Atomic.** The projection runs in a sub-transaction. On error, nothing of it is kept and the
  event becomes `failed`.

## Retrieval: `search_chunks` (SECURITY INVOKER)

```sql
select * from search_chunks('weak entity milestone', p_team_id => 'T01', p_limit => 5);
select * from search_chunks('...', p_query_embedding => '[...1024 floats...]'::extensions.vector);
```

It runs as the caller, so RLS on `artifact_chunk` and `artifact` decides what can be found:

- a student finds their own teams' chunks, and never a teammate's private chunk;
- faculty find only *submitted* text of the projects they teach.

The ranking is reciprocal rank fusion in one SQL statement:

`score = Σ 1/(60 + rank)` over the `ts_rank_cd` keyword list (GIN) and the cosine-distance
list (HNSW). The cosine list is used only when a query embedding is supplied.

The keyword list matches chunks holding ANY query word (`websearch_to_tsquery` with its ANDs
turned into ORs) and ranks them by Σ idf(word)² over the words they hold (BM25 idf over the
candidates), so a rare word outweighs several common ones. Only the latest snapshot (newest
commit time) of each projected artifact is searched; hand-entered chunks are all searched.
Without embeddings (no `VOYAGE_API_KEY`), retrieval is keyword-only and still ranked. Each result carries
`snippet` (`ts_headline`), `score`, `rank_fts` and `rank_vec`.

## Fixtures and replay

```bash
uv run --python 3.12 python ingest/build_fixtures.py --until c6e8064   # rebuild (deterministic; the
                                                                       # T00 history ends at c6e8064)
npx -y supabase@latest functions serve                          # local function, loads supabase/functions/.env
uv run --python 3.12 python scripts/replay_webhooks.py          # sign + POST every manifest row, check responses
(cd api && MONGO_TARGET=local uv run python -m app.worker --once)   # drain: raw log + projection + notes
uv run --python 3.12 python scripts/replay_webhooks.py --fresh  # new delivery ids, same pushes: duplicate=true
```

| File | What it is |
|---|---|
| `t00_push_01..05.json` | This repo's real `git log` on main as pushes to `Arun-Sanjay/countersign-dbms`: real SHAs, tree ids, messages, timestamps and files. Commits less than 10 minutes apart form one push. Markdown files of 40 kB or less carry their text. |
| `t01_push_01.json` | T01 (`rvce-el/team-alpha`), pushed by Karthik: FK/CHECK schema work with `AI-Assisted: yes`. |
| `t01_push_01b.json` | T01, pushed by Aditi: her vault note `shared/Literature survey.md`; the commit carries only her college e-mail, so the author is matched by e-mail and the pusher by GitHub id. |
| `t01_push_02.json` | T01, pushed by Meera: her `shared/ER diagram decisions.md` and `docs/er-diagram.drawio`, an **unknown author**'s commit (skipped, with a warning), and her seed script with `Co-Authored-By` only (not AI-assisted). |
| `t01_push_feature_branch.json` | a push to `feature/normalization`, logged as ignored |
| `t03_push_01.json` | T03 (`rvce-el/team-gamma`), pushed by Priya: her data loader, and Rohan's AI-assisted training loop, which is logged but **not credited** (pushed by someone else: unverified) |
| `ping.json`, `issues.json` | the webhook ping (200) and a non-push event (202, ignored) |
| `manifest.json` | the replay order: delivery ids (UUIDv5), signing mode and expected response |

The manifest also replays:

- a **redelivery**: the same `X-GitHub-Delivery` twice gives `duplicate: true`;
- a **replayed capture**: the same signed body under a new `X-GitHub-Delivery` gives `duplicate: true` (same push);
- a **wrong-secret** signature, which gives 401;
- a **tampered body** (valid signature of the original bytes), which also gives 401.

The secret is read from `$GITHUB_WEBHOOK_SECRET` or `supabase/functions/.env` and is never printed.

**Cloud setup (lead only).**

1. Run `npx supabase secrets set GITHUB_WEBHOOK_SECRET=...`.
2. Deploy `github-webhook`. Its `verify_jwt = false` setting is in `config.toml`.
3. Run `supabase/seed/ingest.sql` once. It is idempotent.
4. Add the repository webhook: content type `application/json`, the same secret, push events.
5. Push migration `20261105000006_ingest_worker.sql` (adds `ingest_fail`).
6. Run the worker against the cloud. It needs `SUPABASE_TARGET=remote` and one of these, set
   in the environment and never committed:
   - `SUPABASE_SERVICE_ROLE_KEY`;
   - `INGEST_DB_URL` with `INGEST_BACKEND=sql`.

   Its Mongo target is `MONGO_TARGET=atlas`.
