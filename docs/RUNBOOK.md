# Countersign runbook

This runbook covers demo day, keeping the free Supabase project awake, backups, undoing demo
changes on the live project, and rotating secrets. Read [`README.md`](../README.md) first for what
Countersign is and how to run it.

**Conventions:**

- Run every command from the repository root unless it starts with `cd`.
- The commands load secrets into environment variables with `set -a; . <file>; set +a` and never
  echo them. Do not add `set -x` or `echo $VAR` while a secret is loaded, and do not paste
  secret values into chat, issues or slides.

| Name | Value |
|:--|:--|
| Live project | `countersign-dbms`, ref `oowtsesgkhhbojjmmlgk`, AWS ap-south-1 (Mumbai), PostgreSQL 17.11, org "dbms lab" |
| Project URL | `https://oowtsesgkhhbojjmmlgk.supabase.co` |
| Session pooler (pg_dump, psql) | host `aws-0-ap-south-1.pooler.supabase.com`, port 5432, user `postgres.oowtsesgkhhbojjmmlgk`, database `postgres` |
| Webhook endpoint | `https://oowtsesgkhhbojjmmlgk.supabase.co/functions/v1/github-webhook` (a GET answers 405, which is correct) |
| MongoDB | Atlas, database `elp` (`github_events`, `notes`, `note_versions`, `portfolios`) |
| Personas | `arun`, `sanvid`, `nikhil`, `meera`, `ramesh`, `lakshmi` and `admin`, all `@example.edu`, password `Countersign@2026` |

**Secret files** (all git-ignored; you need them on the demo laptop):

| File | Holds | Used by |
|:--|:--|:--|
| `supabase/.env` | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF` | CLI, Management API, pg_dump, persona script |
| `atlas-credentials.env` | `MONGODB_URI` (Atlas admin user) and its parts | API, worker, mongodump, mongosh |
| `web/.env.remote` | project URL + **publishable** anon key (not secret, but git-ignored) | `npm run dev:remote`, `SUPABASE_TARGET=remote` in the API |
| `supabase/functions/.env` | `GITHUB_WEBHOOK_SECRET` | local `functions serve`, `scripts/replay_webhooks.py` |
| `api/.env` (optional) | API settings; never commit a key in it | API, worker |

Two helpers are used throughout. Paste them into the terminal once per session; they need
`supabase/.env` loaded. `sbq` is **read-only**: the Management API then runs the SQL as
`supabase_read_only_user` in a read-only transaction (checked 5 Nov 2026). `sbw` runs as
`postgres`, which bypasses RLS but **not** the integrity triggers. Use `sbw` only for the
recipes in §5.

```bash
set -a; . supabase/.env; set +a
sbq() { jq -n --arg q "$1" '{query:$q, read_only:true}' | curl -s -X POST \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H 'content-type: application/json' \
  "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" -d @- | jq -c '.[]?' ; }
sbw() { jq -n --arg q "$1" '{query:$q, read_only:false}' | curl -s -X POST \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H 'content-type: application/json' \
  "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" -d @- | jq -c . ; }
```

---

## 1. Demo day

**One script.** The authoritative run-of-show, pre-flight checklist and fallbacks for the demo are
**Component 9, Part I** ([`docs/lab/C9_Demo_and_Draft_Report.md`](lab/C9_Demo_and_Draft_Report.md)
§3 to §7). This section is the operator's side of it: how to bring the stacks up, what each step
writes, and how to recover. If the two ever disagree, C9 wins and this file is wrong.

### 1.1 Two days before

1. **Keep-alive.** Run the probe in §3 and make sure the project status is `ACTIVE_HEALTHY` (§2).
2. **Back up both databases** (§4) and record the baseline fingerprint (§5.1). Keep the files
   outside the repository.
3. **Rehearse without writing to the live project.** Run the whole C9 script once on the **local
   stack** (§1.3), where every step may write. Then rehearse on the **live project read-only**, as
   on 5 Nov 2026 (C9 §14): every persona signs in and every screen is opened, but the File a
   claim and Confirm dialogs are cancelled, no push is sent and no mark is entered. This keeps
   Sanvid's claim #5 pending for the demo. If a rehearsal did write to the live project, undo it
   with §5.2 and compare the fingerprint with the baseline.
4. **Rehearse the fallback.** Bring up the local stack (§1.3) once, so that the Docker images are
   pulled and `npm install` / `uv sync` have run. Venue Wi-Fi is not reliable.
5. **Check Atlas access from the venue network.** If the venue IP is not allowed, `/health` shows
   `mongo: error`. Atlas UI → Network Access lists the allowed IPs; add the venue IP or your
   hotspot's. College networks sometimes block SRV DNS; if they do, use the standard
   (non-SRV) connection string from Atlas → Connect.
6. **Charge the laptop.** Turn off sleep, notifications and auto-updates.

### 1.2 On the day: cloud setup (the primary track)

This is C9 §4 steps 3 to 5 on laptop 2 (laptop 1 runs only the web app, pointed at laptop 2's
API, so that the Atlas admin URI stays on one machine). Open four terminals.

```bash
# Terminal 1: pre-flight (read-only), see §2 for what "good" looks like
set -a; . supabase/.env; set +a
curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF" | jq -r .status      # ACTIVE_HEALTHY
```

```bash
# Terminal 2: web app against the live project, at http://localhost:5173
cd web && npm run dev:remote
# laptop 1 instead: VITE_API_URL=http://<laptop 2 IP>:8000 npm run dev:remote
```

```bash
# Terminal 3: API against the live project + Atlas, at http://<this laptop>:8000 (/docs for Swagger).
# No service key: every user request runs with the caller's own token. Consequence: the admin's
# "Sync now" (POST /ingest/drain) answers 503 worker_unconfigured; terminal 4 drains instead.
cd api && SUPABASE_TARGET=remote MONGO_TARGET=atlas \
  uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
```

```bash
# Terminal 4: ingestion worker against the live project. Required for the live push of C9 §3.5.
# The service key is fetched into this shell only: never written to a file, never echoed.
set -a; . supabase/.env; set +a
export SUPABASE_SERVICE_ROLE_KEY="$(curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/api-keys" \
  | jq -r '.[] | select(.name=="service_role") | .api_key')"
cd api && SUPABASE_TARGET=remote MONGO_TARGET=atlas uv run python -m app.worker --loop --interval 1 -v
```

The service key lives only in terminal 4 (and in a spare terminal if the C9 §5 fallback
`app.worker --once` is needed). This is the same rule as C8 B.10 and §6 below: never on disk.

**Final checks:**

- `curl -s localhost:8000/health` returns `{"postgres":"ok","mongo":"ok"}`.
- Log in as **admin**. On `/admin` (the **Directory** page), scroll to the **Ingestion** panel:
  *Queued* is 0, and the consistency panel below it says **all consistent**.

Use two Chrome profiles (C9 §2), so that a faculty member and a student can be signed in side by
side.

### 1.3 Fallback: the local stack (plan B, and for rehearsals that write)

Use the local stack if the venue network or the cloud fails, and for every rehearsal that files
claims, countersigns, enters marks or sends pushes. Every step of the C9 script works the same
there; the badge says *Local*. The live push then goes to the Edge Function served by
`functions serve` and the local worker.

```bash
docker ps --format '{{.Names}}' | grep -q '^elp-pg17$' && docker stop elp-pg17   # it conflicts with the stack
npx -y supabase@latest start
scripts/mongo_local.sh
scripts/reset_local.sh                     # LOCAL ONLY: db reset + personas + local Mongo pipeline docs
npx -y supabase@latest functions serve     # terminal A (reads supabase/functions/.env)
(cd api && SUPABASE_TARGET=local MONGO_TARGET=local uv run uvicorn app.main:app --port 8000)          # terminal B
(cd api && SUPABASE_TARGET=local MONGO_TARGET=local uv run python -m app.worker --loop --interval 1)  # terminal C
(cd web && npm run env:local && npm run dev)                                                           # terminal D
uv run --python 3.12 python scripts/replay_webhooks.py   # optional history: 16 of 16 deliveries as expected
```

- Always set **both** targets: `MONGO_TARGET` defaults to `atlas`, so a "local" API or worker
  without `MONGO_TARGET=local` would write raw events to Atlas.
- The web app's header chip says **Local** or **Cloud**. Glance at it before every login.
- For the live push, build a fresh push with C9 Appendix 1 and send it without `--url` (the local
  function). Alternatively run e2e spec 10 alone against the running local stack:

  ```bash
  cd web && E2E_SKIP_RESET=1 npx playwright test e2e/10-ingest-live.spec.ts
  ```

**Race demo (Component 10), in its own terminal:**

```bash
experiments/race/setup.sh                 # container elp-race-pg + database "race" (about 5 s)
experiments/race/demo_locks.sh S2 RR      # A holds the last seat; B and C wait; prints the wait-for graph
experiments/race/demo_locks.sh S7 RR      # the product trigger: the waiter gets 40001 instead of over-admitting
```

Show `experiments/race/results/over_admission_heatmap.png` and
`results/results.md` for the 72,000-race numbers. The live harness at 1000 trials takes 14
minutes; never run it live.

### 1.4 What the C9 run-of-show writes on the live project

The steps are in C9 §3; this table only adds what each one writes and how to undo it (§5.2).

| C9 step | Who / where | Writes on the live project | Undo |
|:--|:--|:--|:--|
| 3.1, 3.2 | ramesh → `/sheet/P06`, SQL drawer, `/marks/P06` | none | – |
| 3.3 | **arun** → `/projects/P06` → *File a claim* on **C3** with an artifact and a Link | one `claim` (the next id, 10 or higher) and two `claim_evidence` rows | delete the claim by id (cascades to its evidence) |
| 3.4 | **arun** → **Countersign queue** tab → *Confirm* Sanvid's claim #5; ramesh reloads the sheet (C3 cell: clock → tick) | one `countersign`; claim #5 becomes `confirmed` | delete the countersign (status re-derives to `pending`) |
| 3.5 | Terminal: the fresh signed push of C9 Appendix 1 to the **cloud** Edge Function; worker in terminal 4 | one `ingest_event`, artifact, `artifact_version`, contribution and chunks; one Atlas `github_events` document | **leave it** (genuine evidence; see §5.2) |
| 3.6 | Terminal `asuser …` calls; lakshmi on `/sheet/P06`; arun on `/faculty-view` | none (every attempt is refused) | – |
| 3.7 | Race terminal, local container `elp-race-pg` | none on the live project | – |
| §5 backups | sanvid confirms arun's new claim, if #5 was already confirmed | one `countersign` | as for 3.4 |

The Team Beta join (nikhil → T02, which writes `team_member`), marks entry and locking are **not**
in the C9 run; they are shown only if an examiner asks, and then preferably on the local stack.
Nikhil's teammate finder is not a demo step: he already holds every skill P01 requires, so it
lists nobody.

Keep these outside the live project: e2e runs, `npx supabase test db`, `03_queries.sql` and any
reset script. All of them are local only (§5.3).

### 1.5 After the demo

1. Run the fingerprint (§5.1) and compare it with the baseline.
2. Undo the demo writes you do not want to keep (§5.2).
3. Take a fresh backup (§4).
4. Stop the worker and API terminals; the service key disappears with the shell.

---

## 2. Health checks (all read-only)

```bash
set -a; . supabase/.env; set +a
# project status: ACTIVE_HEALTHY (paused projects show INACTIVE or PAUSED)
curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF" | jq '{name, region, status}'
# migrations applied: expect 20261104000001 .. 20261105000006
sbq "select version from supabase_migrations.schema_migrations order by 1"
# Edge Function deployed: github-webhook ACTIVE, verify_jwt false
curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/functions" | jq '[.[] | {slug, status, verify_jwt}]'
# sign-ups disabled: true
curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/config/auth" | jq .disable_signup
# anon is locked out: HTTP 401 with code 42501 ("permission denied for table course")
set -a; . web/.env.remote; set +a
curl -s -w ' HTTP %{http_code}\n' "$VITE_SUPABASE_URL/rest/v1/course?select=course_code&limit=1" \
  -H "apikey: $VITE_SUPABASE_ANON_KEY"
# the API sees both databases: {"postgres":"ok","mongo":"ok"}
curl -s localhost:8000/health
```

---

## 3. Keep-alive for the free Supabase project

On the free plan, Supabase **pauses a project after about a week without activity**. A paused
project means a dead demo. It can be restored from the dashboard (Project → *Restore*), which
takes a few minutes, but only within a limited window (90 days at the time of writing). Atlas can
also pause a free cluster after a long period with no connections. Check the current rules on
both dashboards; this runbook does not depend on the exact numbers.

**The probe.** It signs in as a persona and reads one row through PostgREST, so it is real API
and database activity. It also pings Atlas. The only thing it writes is the Auth session that any
login creates. Run it every two or three days, and the morning before the demo:

```bash
set -a; . web/.env.remote; . ./atlas-credentials.env; set +a
TOKEN=$(curl -s -X POST "$VITE_SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $VITE_SUPABASE_ANON_KEY" -H 'content-type: application/json' \
  -d '{"email":"meera@example.edu","password":"Countersign@2026"}' | jq -r .access_token)
curl -s -o /dev/null -w 'supabase rest: HTTP %{http_code}\n' \
  "$VITE_SUPABASE_URL/rest/v1/course?select=course_code&limit=1" \
  -H "apikey: $VITE_SUPABASE_ANON_KEY" -H "Authorization: Bearer $TOKEN"        # expect 200
npx -y mongosh@latest "$MONGODB_URI" --quiet --eval 'db.runCommand({ ping: 1 }).ok'   # expect 1
unset TOKEN
```

**Automating it.** No scheduled job exists yet. Pick one of these options:

- **Laptop cron (simplest).** Save the probe as `~/bin/countersign-keepalive.sh`, outside the
  repository. Add `cd /path/to/dbmsproject` at the top and `chmod +x` it. Then add to
  `crontab -e`:

  ```
  0 10 */2 * * /bin/bash -lc ~/bin/countersign-keepalive.sh >> ~/countersign-keepalive.log 2>&1
  ```

  It runs only while the laptop is awake.
- **GitHub Actions schedule.** This needs the `workflow` token scope
  (`gh auth refresh -s workflow`), the same blocker as `fixture.yml`. Keep the probe's URL and
  anon key in repository secrets, never in the YAML. Use the Supabase half only, so the Atlas
  URI never goes to GitHub. Add a matching workflow file under `.github/workflows/` in a
  separate change.

If the project is already paused, restore it in the dashboard. Then check status (§2), the
migrations (§2) and the fingerprint (§5.1).

---

## 4. Backups

Keep backups **outside the repository**: `backups/` is not in `.gitignore`, and a dump holds
every row, including names and e-mail addresses. The commands below write to
`~/countersign-backups/<date>/`. Both were run against the live project and Atlas on 5 November
2026, and both files were restored in throwaway containers (§4.3).

```bash
B=~/countersign-backups/$(date +%Y-%m-%d_%H%M); mkdir -p "$B"
```

### 4.1 PostgreSQL: pg_dump with the Docker `postgres:17` client

Back up the application schemas `public` (every table, view and RPC), `app` (RLS helper
functions) and `private` (private notes, trigger functions). This is not a full-cluster backup.

- **Not included: `auth`.** Personas are recreated by a script.
- **Not included: queue contents.** pgmq's queue tables belong to the extension, so pg_dump skips
  them. The queue is transient, and `ingest_event` plus the Mongo raw log hold the history.
- **Not included: Supabase-managed schemas.**

```bash
set -a; . supabase/.env; set +a
docker run --rm -e PGPASSWORD="$SUPABASE_DB_PASSWORD" -v "$B":/backup postgres:17 \
  pg_dump -h aws-0-ap-south-1.pooler.supabase.com -p 5432 -U "postgres.$SUPABASE_PROJECT_REF" \
  -d postgres -Fc -n public -n app -n private --no-owner --no-privileges \
  -f /backup/countersign.dump
docker run --rm -v "$B":/backup postgres:17 pg_restore -l /backup/countersign.dump | grep -c 'TABLE DATA'   # expect 30
```

- The password goes only into the container's environment and never onto the command line.
- The direct host `db.<ref>.supabase.co` is IPv6-only on the free plan, which is why the session
  pooler is used.

### 4.2 MongoDB: mongodump (the `mongo:8` image ships the database tools)

```bash
set -a; . ./atlas-credentials.env; set +a
docker run --rm -e MONGODB_URI -v "$B":/backup --entrypoint sh mongo:8 -c \
  'mongodump --uri="$MONGODB_URI" --db=elp --gzip --archive=/backup/elp.archive.gz 2>&1 \
   | sed -E "s#mongodb(\+srv)?://[^ ]*#<uri>#g"'
```

- The `sed` masks the URI in case a tool error message repeats it.
- The archive includes the `$jsonSchema` validators and the indexes, as collection options.

### 4.3 Verify a backup (restore drill)

Restore into **throwaway** containers. This never touches the live project, Atlas or your local
stack. The Postgres side uses the Supabase image, because the schema needs pgvector, pgmq and the
`auth` schema.

```bash
# PostgreSQL
docker run -d --name cs-restore-check -e POSTGRES_PASSWORD=localdev -v "$B":/backup \
  public.ecr.aws/supabase/postgres:17.11.0.011
sleep 20   # wait for the image's init scripts
docker exec cs-restore-check psql -U postgres -h localhost -q -c \
  "create extension if not exists vector with schema extensions; create extension if not exists pgmq;
   create schema app; create schema private;"
docker exec cs-restore-check pg_restore -U postgres -h localhost -d postgres --no-owner \
  -n public -n app -n private /backup/countersign.dump
docker exec cs-restore-check psql -U postgres -h localhost -c \
  "select (select count(*) from claim) claims, (select count(*) from contribution) contributions,
          (select count(*) from artifact_chunk) chunks, (select count(*) from ingest_event) deliveries"
docker rm -f cs-restore-check

# MongoDB
docker run -d --name cs-mongo-restore-check -v "$B":/backup mongo:8; sleep 5
docker exec cs-mongo-restore-check mongorestore --gzip --archive=/backup/elp.archive.gz --nsInclude='elp.*'
docker exec cs-mongo-restore-check mongosh --quiet --eval \
  'const d=db.getSiblingDB("elp"); printjson({events:d.github_events.countDocuments(), notes:d.notes.countDocuments(), versions:d.note_versions.countDocuments()})'
docker rm -f cs-mongo-restore-check
```

**What to expect.** One error is expected: the `app_user → auth.users` foreign key cannot be
created, because `auth.users` is not in the dump. Every row still loads.

**Results of the drill on 5 Nov 2026:**

- Postgres: 9 claims, 65 contributions, 58 chunks, 10 deliveries;
- Mongo: 12 events, 9 notes, 9 note versions;
- the notes validator was present after the restore.

### 4.4 Restoring for real

- **Postgres.** Restore into a **fresh** project or the local stack, never over the live project.
  - Apply the migrations first (`npx supabase db push`).
  - Then load data only, as `postgres`, with triggers disabled for the session. The integrity
    triggers would otherwise refuse, for example, marks on an already-locked milestone. Use
    `SET session_replication_role = replica` in the restoring session, the method in Supabase's
    restore guide. This path has **not** been rehearsed.
  - Skip `public.app_user`, then run `scripts/create_personas.py --target remote`, which re-creates
    the logins and their `app_user` rows.
- **Mongo.** `mongorestore --drop` into Atlas replaces the collections with the backup, then
  re-run `mongo/validators.js` (idempotent).
- **Only Postgres lost the projection?** Rebuild it from the Atlas raw log instead of restoring:
  `python -m app.worker --reproject-from-log` (§5.4).

---

## 5. Resetting demo data on the live project safely

**Rule: the live project is never reset wholesale for a demo.** Demo changes are undone row by
row, by id, with the recipes below. Each recipe uses the same database rules that the app uses:
`sbw` bypasses RLS, but the integrity triggers still fire. A full rebuild (§5.4) is a last
resort.

### 5.1 Baseline fingerprint (read-only)

```bash
sbq "select t, n from (values
  ('student',(select count(*) from public.student)), ('team_member',(select count(*) from public.team_member)),
  ('claim',(select count(*) from public.claim)), ('claim_evidence',(select count(*) from public.claim_evidence)),
  ('countersign',(select count(*) from public.countersign)), ('assessment',(select count(*) from public.assessment)),
  ('milestones_locked',(select count(*) from public.milestone where locked_at is not null)),
  ('submission',(select count(*) from public.submission)), ('artifact',(select count(*) from public.artifact)),
  ('artifact_version',(select count(*) from public.artifact_version)), ('contribution',(select count(*) from public.contribution)),
  ('artifact_chunk',(select count(*) from public.artifact_chunk)), ('ingest_event',(select count(*) from public.ingest_event)),
  ('private_note',(select count(*) from private.note)), ('app_user',(select count(*) from public.app_user))) v(t,n)"
```

The baseline below was read on 5 November 2026 at 02:00 IST, before any demo rehearsal.

| student | team_member | claim | claim_evidence | countersign | assessment | milestones_locked | submission |
|--:|--:|--:|--:|--:|--:|--:|--:|
| 13 | 24 | 9 | 12 | 8 | 10 | 1 (P06 C1) | 4 |

| artifact | artifact_version | contribution | artifact_chunk | ingest_event | private_note | app_user |
|--:|--:|--:|--:|--:|--:|--:|
| 45 | 39 | 65 | 58 | 10 | 2 | 7 |

The highest seeded `claim_id` is 9, so any claim with a higher id was filed after seeding.

**What changed since a time T** (read-only; set the timestamp to when the rehearsal started):

```bash
T='2026-11-05 09:00+05:30'
sbq "select 'claim' kind, claim_id::text id, usn, project_id||' C'||milestone_no what, status, created_at at time zone 'Asia/Kolkata' at from public.claim where created_at >= '$T'
     union all select 'countersign', claim_id::text, endorser_usn, verdict, null, signed_at at time zone 'Asia/Kolkata' from public.countersign where signed_at >= '$T'
     union all select 'assessment', project_id||' C'||milestone_no, usn, marks::text, assessed_by, assessed_at at time zone 'Asia/Kolkata' from public.assessment where assessed_at >= '$T'
     union all select 'lock', project_id||' C'||milestone_no, null, null, null, locked_at at time zone 'Asia/Kolkata' from public.milestone where locked_at >= '$T'
     union all select 'submission', submission_id::text, submitted_by, team_id||' '||project_id||' C'||milestone_no, null, submitted_at at time zone 'Asia/Kolkata' from public.submission where submitted_at >= '$T'
     union all select 'team_member', team_id, usn, role, null, joined_at::timestamp from public.team_member where joined_at >= ('$T'::timestamptz at time zone 'Asia/Kolkata')::date
     order by at"
```

### 5.2 Undo recipes (writes; run one at a time, check the result)

Each recipe is one transaction. **Replace the ids** with the ones the query above returned.
Re-run the fingerprint afterwards.

| Demo action | Undo | Notes |
|:--|:--|:--|
| A claim was filed (and maybe countersigned) | `sbw "delete from public.claim where claim_id = 10 and created_at >= '$T' returning claim_id, usn, status"` | Cascades to `claim_evidence`, `countersign` and `skill_evidence`. Refused if the component has been locked since, so unlock it first (row below). |
| Only a countersign (keep the claim) | `sbw "delete from public.countersign where claim_id = 7 and endorser_usn = '1RV24CY051' and signed_at >= '$T' returning *"` | The trigger re-derives the claim status (back to `pending`). |
| A mark was entered | `sbw "delete from public.assessment where usn = '1RV24CY047' and project_id = 'P06' and milestone_no = 5 and assessed_at >= '$T' returning *"` | Refused while the component is locked: unlock first. If an earlier mark was overwritten, re-enter the old value in the UI as ramesh (the baseline backup has it). |
| A component was locked | `sbw "update public.milestone set locked_at = null where project_id = 'P06' and milestone_no = 5 and locked_at >= '$T' returning project_id, milestone_no"` | The same as an admin unlocking. **Never** clear P06 C1: it is seed-locked (20 Sept 2026), and the time guard protects it. |
| A student joined a team | As that student, press **Leave** on `/team` (`leave_team`), or `sbw "delete from public.team_member where team_id = 'T02' and usn = '1RV24CY077' returning *"` | Refused once the student has recorded work in the team (claims, countersigns, contributions, marks): undo those first. |
| A milestone was submitted | `sbw "delete from public.submission where submission_id = 5 and submitted_at >= '$T' returning *"`, then set the artifacts it published back: `sbw "update public.artifact set visibility = 'team' where artifact_id in ('A2x') returning artifact_id"` | `submit_milestone` changes `team` → `submitted`. Only revert the artifacts that were `team` before; check them against the baseline backup. |
| A private note was saved | As the owner, delete it on `/notes` (Private notes) | Never touch other notes. |
| A note was saved through the API (Mongo `notes` + `note_versions`) | See the mongosh command below | The API contract makes `note_versions` append-only. Removing a rehearsal note is an admin clean-up of demo data, so say so if asked. |
| A real push was ingested (rows in `ingest_event`, `contribution`, `artifact_version`, chunks and Mongo `github_events`) | **Leave it.** It is genuine evidence, and the consistency panel stays green. | No script removes a delivery from both stores. Removing one side only makes `/consistency` report `only_in_mongo` or `only_in_postgres`. |

To remove a rehearsal note from Atlas:

```bash
set -a; . ./atlas-credentials.env; set +a
npx -y mongosh@latest "$MONGODB_URI" --quiet --eval \
  'const d=db.getSiblingDB("elp"); const id="N-xxxxxxxxxx";
   printjson({versions:d.note_versions.deleteMany({note_id:id}).deletedCount, notes:d.notes.deleteOne({note_id:id}).deletedCount})'
```

Persona passwords drifted, for example someone changed one: run
`uv run --python 3.12 --with httpx --with python-dotenv python scripts/create_personas.py --target remote`.
It is idempotent: it resets the seven passwords to the default and upserts their `app_user`
rows.

### 5.3 Which scripts are local-only

| Command | Scope | On the live project / Atlas |
|:--|:--|:--|
| `scripts/reset_local.sh` | `supabase db reset --local` + personas `--target local` + `clear_local_pipeline.sh` | **Local only.** Never point it at the cloud. |
| `scripts/clear_local_pipeline.sh` | deletes pipeline documents in the `elp-mongo-local` container | **Local only** (container-bound; it exits if the container is absent). |
| `scripts/mongo_local.sh` | starts and seeds `elp-mongo-local` | **Local only.** |
| `cd web && npm run e2e` | resets the local DB, writes claims, marks and locks | **Local only.** Global setup refuses a non-localhost `.env.local`. |
| `npx supabase test db` | pgTAP | **Local only.** Do not add `--linked`. |
| `scripts/test_fixture.sh`, `scripts/test_mongo_fixture.sh` | throwaway containers | Safe (never connect to the cloud). |
| `experiments/race/*` | throwaway `elp-race-pg` container | Safe (never connect to the cloud). |
| `supabase/fixture/03_queries.sql` | Q30–Q37 write; Q37 commits by itself | **Never on the live project** (`docs/FIXTURE_ON_SUPABASE.md`). Q1–Q29 are read-only. |
| `npx supabase db reset --linked` | drops and rebuilds the remote database | **Never for a demo.** Last resort only (§5.4). |
| `mongo/seed.js` | **drops** `notes`, `github_events` and `portfolios`, then reloads the fixture | **Never on Atlas.** It deletes the pipeline's raw log and the validators. |
| `mongo/validators.js`, `mongo/portfolio_merge.js` | idempotent | Safe on Atlas. |
| `scripts/create_personas.py --target remote` | creates or updates the 7 logins and `app_user` | Safe (idempotent); resets the persona passwords to the default. |
| `scripts/replay_webhooks.py --url <live function>` | the 16 fixture deliveries | Safe but pointless: every push is already in, so all are answered as duplicates. `--fresh` also adds one `ignored` row for the `issues` event. |
| `api`: `python -m app.worker --reproject-from-log` | rebuilds the Postgres projection from the Mongo raw log | Repair tool (§5.4). |

### 5.4 Last resort: rebuild the live project

Use this only when targeted undo is impossible. It has **not been rehearsed**. Take both backups
(§4) first, and expect about 30 minutes.

1. **Reset the database.** `set -a; . supabase/.env; set +a; npx -y supabase@latest db reset --linked`
   drops every user schema and re-applies `supabase/migrations/`. It asks for confirmation.
2. **Load the seeds if they are missing.** Run `sbq "select count(*) from public.student"`. If it
   returns 0, the seeds did not run; load them in order, each as one transaction:

   ```bash
   for f in supabase/fixture/02_seed.sql supabase/seed/demo.sql supabase/seed/ingest.sql; do
     docker run --rm -i -e PGPASSWORD="$SUPABASE_DB_PASSWORD" postgres:17 psql \
       -h aws-0-ap-south-1.pooler.supabase.com -p 5432 -U "postgres.$SUPABASE_PROJECT_REF" \
       -d postgres -v ON_ERROR_STOP=1 -1 < "$f"
   done
   ```

   `02_seed.sql` is only *read* here; the fixture stays frozen.
3. **Personas.** `uv run --python 3.12 --with httpx --with python-dotenv python scripts/create_personas.py --target remote`.
4. **Pipeline projection.** Rebuild it from the Atlas raw log. Export the service key as in §1.2,
   then run
   `cd api && SUPABASE_TARGET=remote MONGO_TARGET=atlas uv run python -m app.worker --reproject-from-log`.
   Expect 9 projected deliveries and `/consistency` all consistent.
5. **Remote-only settings.** Check them (§2): sign-ups disabled, the Edge Function still deployed,
   and its `GITHUB_WEBHOOK_SECRET` set (`npx supabase secrets list`; it shows names and digests
   only).
6. **Fingerprint.** Compare §5.1 with the baseline.

---

## 6. Rotating secrets

Rotate a secret **immediately** if it was printed, pasted, committed or shared. Then check git
history. If it was committed, rotating it is not enough: the old value stays in history, so treat
it as public forever.

| Secret | Lives in | How to rotate | Then update |
|:--|:--|:--|:--|
| Supabase personal access token | `supabase/.env` `SUPABASE_ACCESS_TOKEN` | Dashboard → Account → Access Tokens: generate a new token, then revoke the old one | `supabase/.env`; any CI secret holding it |
| Database password | `supabase/.env` `SUPABASE_DB_PASSWORD` | Dashboard → Project Settings → Database → *Reset database password* | `supabase/.env`; `INGEST_DB_URL` if you use it. The CLI picks it up from the env file |
| Legacy `service_role` key (a JWT) | never on disk: fetched into the shell (§1.2) or injected into the Edge Function | Rotating the legacy JWT secret (Dashboard → JWT Keys) replaces **both** legacy keys, anon and service_role, and signs everyone out | `web/.env.remote` (new anon key) and any hosted web build. The Edge Function's injected `SUPABASE_SERVICE_ROLE_KEY` is managed by the platform; check with a replay of `ping.json` |
| New secret API key (`sb_secret_…`) | not used by the code today | Dashboard → API Keys: create a new key, switch to it, delete the old one | Note: the worker's REST backend sends the key as a Bearer token, which suits the legacy JWT. With an `sb_secret_` key, use `INGEST_BACKEND=sql` + `INGEST_DB_URL`, or test first |
| GitHub webhook secret | `supabase/functions/.env`; the Edge Function secret; the GitHub hook (once configured) | `openssl rand -hex 32` into `supabase/functions/.env`, then `npx -y supabase@latest secrets set --env-file supabase/functions/.env --project-ref "$SUPABASE_PROJECT_REF"` (nothing on the command line) | The repository webhook's secret (GitHub → Settings → Webhooks), if one exists |
| Atlas database user password | `atlas-credentials.env` (`MONGODB_PASSWORD`, `MONGODB_URI`) | Atlas → Database Access → Edit → new password | `atlas-credentials.env`; restart the API and the worker |
| Persona password (a demo value, public in the repo) | `scripts/create_personas.py` default, `web/src/auth/personas.ts`, `web/e2e/helpers.ts` | `PERSONA_PASSWORD='…' uv run … scripts/create_personas.py --target remote` | The one-click persona buttons stop working on that deployment; type the password by hand |
| `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `GITHUB_TOKEN` (when added) | `api/.env` or the shell, **never** `web/` | Provider console: create a new key, revoke the old one | `api/.env`; restart the API and the worker |

**Also:**

- Turn on GitHub secret scanning and push protection for the repository.
- Before every commit, `git status` must not list any `*.env` file.
- `atlas-credentials.env` is an **admin** URI. The planned fix: give the API its own Atlas user
  with `readWrite@elp` only, and remove the admin URI from the demo laptop.

---

## 7. Public deployment and the demo personas

Anyone who reads this repository knows the persona password (`Countersign@2026`), and the admin
persona can unlock milestones and drain the queue. That is fine on `localhost`. Before the web
app is hosted on a public URL (Vercel is planned):

1. Build with `VITE_SHOW_PERSONAS=false`.
2. Rotate the persona password on the live project (§6).
3. Keep the API, and therefore the service key, off public hosting until its CORS origins and
   secrets are configured for it.

---

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|:--|:--|:--|
| Every request fails; the dashboard shows the project paused | no activity for about a week | Restore it in the dashboard; then run §2 and set up §3 |
| Login says invalid credentials for every persona | the password was rotated, or the personas are missing after a rebuild | `scripts/create_personas.py --target remote` |
| `/health` shows `mongo: error` | the venue IP is not on the Atlas access list, or SRV DNS is blocked | Atlas → Network Access: add the IP; or use the standard connection string |
| A push stays `queued`, no toast appears | no worker is running | Start terminal 4 (§1.2), or run `app.worker --once` in a shell with the service key. **Sync now** (admin Directory page → Ingestion panel) works only if the API itself was started with the service key; the §1.2 API was not, so it answers 503 `worker_unconfigured` |
| Ask / Notes say the API is unreachable | the API is not running on :8000, or it is the wrong target, or laptop 1 points at the wrong IP | Terminal 3 (§1.2); `VITE_API_URL` defaults to `http://localhost:8000`; on laptop 1 it must be `http://<laptop 2 IP>:8000` |
| `npx supabase start` fails on a port | `elp-pg17` or another stack is running | `docker stop elp-pg17`; `npx supabase stop --all` |
| The page shows **Local** when you meant the cloud | `npm run dev` instead of `npm run dev:remote` | Restart with `dev:remote` |
| Consistency panel shows `only_in_mongo` | the Postgres projection was lost or reset | `python -m app.worker --reproject-from-log` (§5.4 step 4) |
| A demo write is refused with "Milestone … is locked" | the component was locked (by design) | Pick an open component, or unlock it as admin (§5.2) |
