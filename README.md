# Countersign

**Every mark has a receipt.**

Countersign is the working prototype of the **Unified Experiential Learning and Project
Intelligence Platform**. It is the DBMS lab mini project (CD252IA, Semester V, Department of CSE,
RV College of Engineering, Bengaluru) of S Arun Sanjay (1RV24CY047) and Sanvid Razdan
(1RV24CY051).

Today a faculty member signs the paper lab evaluation sheet on trust: one student often does most
of the work, and nothing records who built what. Countersign turns the rubric into the database
schema:

- every rubric cell links to the students' **claims** ("I wrote the ER diagram");
- each claim is backed by **evidence rows** (commits, artifact versions, notes, links);
- a **teammate countersigns** the claim (confirm or dispute), and only contested claims reach
  the faculty queue;
- marks are entered on the sheet, then locked for good.

GitHub pushes become evidence automatically. Every search and answer runs **as the signed-in
user**, so row-level security decides what each person can see: faculty see contribution metadata,
never a student's private notes.

The database is the product. PostgreSQL 17 on Supabase holds the relational core, row-level
security, the RPCs and pgvector. MongoDB holds the raw event log and the immutable note history.
FastAPI and React stay thin.

> Source of truth: [`PROJECT_MASTER.md`](PROJECT_MASTER.md) (vision, schema, seed, 62 verified
> queries, rubric). Approved plan: [`docs/PLAN.md`](docs/PLAN.md). Demo-day operations:
> [`docs/RUNBOOK.md`](docs/RUNBOOK.md).

## Contents

- [Screenshots](#screenshots)
- [Architecture](#architecture)
- [Repository map](#repository-map)
- [Quick start](#quick-start)
- [Demo personas](#demo-personas)
- [Tests](#tests)
- [Ingestion demo](#ingestion-demo)
- [Lab documents](#lab-documents)
- [Status](#status)
- [Safety rules](#safety-rules)
- [Credits](#credits)

## Screenshots

These screenshots were taken from the local stack with the demo seed (`docs/screenshots/`).

| | |
|:--|:--|
| ![Rubric sheet](docs/screenshots/faculty-02-sheet.png) | ![Contested claim drawer](docs/screenshots/faculty-03-drawer-contested.png) |
| **The paper lab sheet as live tables.** Faculty F01 sees the components of P06 (C1 to C11), the marks, the 120 → 30 + 10 + 10 = 50 reduction and the claim status behind each cell. | **Click a cell to see the claim, its evidence and the countersigns.** Here a teammate disputed the claim, so the cell is contested. The locked mark is final. |
| ![Team finder](docs/screenshots/review-12-arun-team-finder.png) | ![Show the SQL](docs/screenshots/review-22-arun-sql-algebra.png) |
| **Team and skills.** The teammate finder looks for complements, not clones: Missing = Required(P) − Mine, then students ranked by how many missing skills they cover (a partial division). The page also shows the skill gap (declared vs verified) and a recursive skill tree. | **Show the SQL.** Every data panel opens a drawer with the exact SQL from the migrations, its relational algebra, the RLS policies that apply and the syllabus units. |
| ![File a claim](docs/screenshots/review-18-arun-file-claim-dialog.png) | ![RLS for another course's faculty](docs/screenshots/faculty-12-rls-lakshmi.png) |
| **File a claim.** Pick a component and a kind of work, declare any AI assistance and cite evidence. The zod rules mirror the database CHECKs. | **Row-level security.** Faculty F02 does not teach P06, so `v_rubric_sheet` returns no rows for her. The page explains why. |

More: [`review-10-arun-hub.png`](docs/screenshots/review-10-arun-hub.png) (the semester hub) and
[`faculty-11-marks.png`](docs/screenshots/faculty-11-marks.png) (Lab CIE marks).

## Architecture

```mermaid
flowchart LR
  user["Browser<br/>student · faculty · admin"]
  gh["GitHub<br/>repository push"]

  subgraph app["Application"]
    direction TB
    web["web/<br/>React app<br/>publishable key only"]
    api["api/<br/>FastAPI + ingestion worker"]
  end

  subgraph sb["Supabase · countersign-dbms · ap-south-1"]
    direction TB
    ef["Edge Function<br/>github-webhook"]
    gw["Auth · PostgREST · Realtime"]
    pg[("PostgreSQL 17<br/>RLS on every table<br/>RPCs, triggers, views<br/>pgmq, pgvector")]
  end

  mongo[("MongoDB Atlas<br/>database elp<br/>raw events, notes,<br/>note versions")]

  user --> web
  web -- "queries as the user" --> gw
  gw --> pg
  web -- "Bearer JWT" --> api
  api -- "as the caller" --> gw
  api -- "service role:<br/>drain + project" --> pg
  api --> mongo
  gh -- "signed POST" --> ef
  ef -- "one transaction" --> pg
  gw -. "live toasts" .-> web
```

- **Fat database, thin API.** Business rules live in Postgres:
  - CHECKs and keys;
  - integrity triggers (team capacity v2, one team per project, membership required, marks ≤ max,
    lock finality, countersign rules);
  - `SECURITY INVOKER` RPCs;
  - `security_invoker` views.

  The browser holds only the publishable key, so every request runs as the signed-in user under
  RLS. See `supabase/migrations/0002`–`0004`.
- **The API never uses a service key for a user request.** It reads Postgres with the caller's
  JWT. The only service-role path is the ingestion worker, because the pipeline RPCs are
  service_role-only by design. See [`api/README.md`](api/README.md).
- **Ingestion is inbox → log → projection.** Every step is idempotent, so delivery can be
  at-least-once. Details: [`docs/INGESTION.md`](docs/INGESTION.md).

```mermaid
sequenceDiagram
  autonumber
  participant GH as GitHub
  participant EF as Edge Function<br/>github-webhook
  participant PG as PostgreSQL
  participant W as Worker<br/>(api/app/worker.py)
  participant M as MongoDB elp
  participant UI as Browser<br/>(faculty sheet)
  GH->>EF: POST push (X-Hub-Signature-256)
  EF->>PG: ingest_receive(): ingest_event row + pgmq.send, one transaction
  EF-->>GH: 202 Accepted (no Mongo, no projection here)
  W->>PG: ingest_read() oldest first
  W->>M: upsert github_events {_id: delivery_id}, e-mails hashed
  W->>PG: ingest_mark_raw() then project_push()
  Note over PG: artifact, artifact_version, contribution, chunks<br/>every INSERT has an idempotency key
  PG-->>UI: Realtime broadcast (ids and time only)
  W->>M: vault notes into notes + note_versions
```

## Repository map

```
.
├── PROJECT_MASTER.md          source of truth: vision, schema, seed, 37 SQL + 25 MongoDB verified queries, rubric
├── CLAUDE.md                  hard rules for coding agents (frozen fixture, secrets, which projects to touch)
├── docs/
│   ├── PLAN.md                approved plan: thesis, design problems, upgrades, phases
│   ├── PROTOTYPE_PLAN.md      test-gated prototype plan (gates G1–G9)
│   ├── INGESTION.md           GitHub push → inbox → raw log → projection; trust model; demo script
│   ├── FIXTURE_ON_SUPABASE.md why 03_queries.sql must never run on the cloud project
│   ├── RUNBOOK.md             demo day, keep-alive, backups, safe resets, secret rotation
│   ├── lab/                   graded lab documents (Markdown sources, PDF, DOCX, build scripts)
│   └── screenshots/           the screenshots above
├── supabase/
│   ├── migrations/            0001 core schema … 0006 ingest worker (all six applied to the live project)
│   ├── fixture/               FROZEN graded Test fixture: 01_schema, 02_seed, 03_queries (Q1–Q37)
│   ├── seed/                  demo.sql (Sanvid, P06 "CD252IA Lab 2026-27", T00, claims, marks), ingest.sql
│   ├── tests/                 pgTAP: constraints, RLS matrix, RPCs, abuse cases, ingest, worker
│   ├── functions/github-webhook/   Edge Function: HMAC check, then one RPC
│   └── config.toml            local stack config (sign-ups off, verify_jwt = false for the webhook)
├── mongo/                     04_mongo.js (FROZEN, M1–M25), seed.js, validators.js, portfolio_merge.js
├── api/                       FastAPI: /notes, /ask, /consistency, /ingest/*, /health; app/worker.py
├── web/                       Vite + React 19 + TypeScript + Tailwind v4 + shadcn/ui; e2e/ (Playwright)
├── ingest/                    replay fixtures (this repo's real git history + synthetic teams) and generator
├── experiments/race/          Component 10: "the last team slot" harness, analysis SQL, results
├── scripts/                   fixture tests, local reset, personas, webhook replay, Mongo helpers
└── .github/workflows/fixture.yml   CI for the frozen fixture (written locally, not pushed yet)
```

## Quick start

Requirements:

- Node 24 and npm;
- `uv` (Python 3.12);
- Docker Desktop (option B and most tests);
- `jq`.

The CLIs run through `npx` (`npx -y supabase@latest`, `npx -y mongosh@latest`), so nothing else
needs installing.

### A. Web app against the live project (fastest)

```bash
cd web
npm install
npm run dev:remote          # http://localhost:5173, against countersign-dbms
```

`dev:remote` reads `web/.env.remote`. The file is git-ignored, so a fresh clone must create it.
It holds two values, and both are publishable:

- `VITE_SUPABASE_URL=https://oowtsesgkhhbojjmmlgk.supabase.co`;
- `VITE_SUPABASE_ANON_KEY=` the **anon/publishable** key from Dashboard → Project Settings →
  API Keys. Never put the service_role or secret key here.

With an access token in `supabase/.env`, this writes the file without printing the key:

```bash
cd web
set -a; . ../supabase/.env; set +a
{ echo "VITE_SUPABASE_URL=https://$SUPABASE_PROJECT_REF.supabase.co"
  printf 'VITE_SUPABASE_ANON_KEY=%s\n' "$(curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/api-keys" \
    | jq -r '.[] | select(.name=="anon") | .api_key')"
} > .env.remote
```

Without the API, this already gives every relational page:

- hub, team finder, claims and countersigns;
- the rubric sheet, marks and the contested queue;
- the SQL drawer;
- search (`search_chunks` runs through PostgREST).

Notes, **Ask**, the trace sheet and the admin Ingestion panel need the API. Run it against the
live project plus Atlas. It reads `web/.env.remote` and `atlas-credentials.env`, and prints
neither:

```bash
cd api && uv sync
SUPABASE_TARGET=remote MONGO_TARGET=atlas uv run uvicorn app.main:app --port 8000
```

### B. Full local stack (offline, safe to break)

```bash
npx -y supabase@latest start                 # local Supabase (Postgres 17, Auth, REST, Realtime, Studio)
scripts/mongo_local.sh                       # docker elp-mongo-local (mongo:8, replica set) + seed + validators
scripts/reset_local.sh                       # db reset (migrations + fixture/demo/ingest seeds) + personas
                                             #   + clears the local Mongo pipeline documents
(cd api && uv sync && SUPABASE_TARGET=local MONGO_TARGET=local \
   uv run uvicorn app.main:app --port 8000)  # terminal 2: API on :8000
(cd web && npm install && npm run env:local && npm run dev)   # terminal 3: http://localhost:5173
```

- `npm run env:local` writes `web/.env.local` from `supabase status`; the key is never printed.
- The plain PG17 container `elp-pg17` (port 54329) must be stopped while the local Supabase stack
  runs.
- For the ingestion pipeline, see [Ingestion demo](#ingestion-demo).

## Demo personas

`scripts/create_personas.py` creates these logins, locally and on the live project. All use the
password **`Countersign@2026`**. The login page has one-click buttons for them; set
`VITE_SHOW_PERSONAS=false` to hide the buttons. Sign-ups are disabled, so these are the only
accounts.

| Login | Role | Identity | Use it to show |
|:--|:--|:--|:--|
| `arun@example.edu` | student | S Arun Sanjay, 1RV24CY047, lead of T00 *Countersign* | hub, team finder, filing a claim, private notes, "what my faculty sees" |
| `sanvid@example.edu` | student | Sanvid Razdan, 1RV24CY051, T00 | countersigning Arun's claim (confirm or dispute) |
| `nikhil@example.edu` | student | Nikhil Bhat, 1RV24CY077, no team in P01 | joining Team Beta (T02, 3 of 4); the "team is full" and "enrollment required" refusals. Not the teammate finder: he already holds every skill P01 requires, so his finder lists nobody |
| `meera@example.edu` | student | Meera Iyer, 1RV24CY033, in T01, T03 and T06 | "no recorded evidence yet"; team-only live activity |
| `ramesh@example.edu` | faculty | Dr. Ramesh Babu, F01, teaches CD252IA (P01, P06) | rubric sheet, contested queue, marks and locking, live toasts |
| `lakshmi@example.edu` | faculty | Dr. Lakshmi Prasad, F02, teaches AIML (P02), not CD252IA | RLS: P06 is invisible to her, and search finds nothing there |
| `admin@example.edu` | admin | college admin | the Directory page (`/admin`) with its Ingestion panel: inbox and consistency. **Sync now** works only if the API was started with the service key (otherwise 503 `worker_unconfigured`; run the worker instead) |

All names except S Arun Sanjay and Sanvid Razdan are fictional (fixture data). The persona
password is public by design. Read [`docs/RUNBOOK.md`](docs/RUNBOOK.md) §7 before deploying the
web app anywhere public.

## Tests

| Suite | Command | Where it runs | Result (5 Nov 2026) |
|:--|:--|:--|:--|
| pgTAP: constraint gallery, RLS matrix, RPCs, abuse cases, ingest, worker | `npx -y supabase@latest test db` | local Supabase stack, freshly reset (`scripts/reset_local.sh`) | **657** assertions pass (45 + 298 + 126 + 53 + 119 + 16) |
| Fixture regression, SQL (gate G1) | `scripts/test_fixture.sh [-v]` | throwaway `postgres:17` container, port 55432 | **37/37** Q1–Q37 match Appendix H |
| Fixture regression, MongoDB (gate G1) | `scripts/test_mongo_fixture.sh [-v]` | throwaway `mongo:8` container, port 57017 | **25/25** M1–M25 match Appendix H |
| Mongo validators | `scripts/check_mongo_validators.sh --local` | scratch database in `elp-mongo-local` | fixture writes accepted, 6 malformed writes rejected |
| API + worker | `cd api && MONGO_TARGET=local uv run pytest -q` | local stack + personas + `elp-mongo-local` | **47** pass |
| Web static checks | `cd web && npm run typecheck && npm run lint && npm run build` | local | clean |
| Web end-to-end (Playwright, installed Chrome) | `cd web && npm run e2e` | **local only** (resets the local DB first) | **38** pass across `e2e/01`–`10` |
| Race harness (Component 10) | see below | throwaway `elp-race-pg` container, port 55433 | 72,000 races; findings in `experiments/race/` |

Notes:

- **pgTAP and pytest** assume the seed state. Run `scripts/reset_local.sh` first, with no e2e run
  and no worker active at the same time.
- **`npm run e2e`** refuses to run unless `web/.env.local` points at localhost. It resets the
  local DB, re-creates the personas, clears the local Mongo pipeline documents, then starts Vite
  and, if `elp-mongo-local` is up, the API. Spec 10 sends a signed push through the local
  `github-webhook` function and the worker. Variants:
  - `E2E_API=0`: run without the API;
  - `E2E_SKIP_RESET=1`: skip the reset.

  Details: [`web/README.md`](web/README.md).
- **API tests with `MONGO_TARGET=atlas`** (the default) use a scratch database `elp_api_test` on
  Atlas and drop it afterwards. Prefer `MONGO_TARGET=local`.
- **CI.** `.github/workflows/fixture.yml` runs both fixture regressions on every push. It is not
  pushed yet: pushing a workflow file needs the `workflow` scope
  (`gh auth refresh -s workflow`).

**Race harness (Innovative Experiment).** The reported run is 1000 trials per cell, 14 minutes.
For a quick check that leaves the reported data alone, load a second database:

```bash
RACE_DB=race_verify experiments/race/setup.sh
RACE_DSN=postgresql://postgres:localdev@localhost:55433/race_verify \
  uv run --python 3.12 --with asyncpg experiments/race/harness.py --fresh --trials 5
docker exec -i elp-race-pg psql -U postgres -d race_verify -X < experiments/race/analysis_selftest.sql   # all PASS
experiments/race/demo_locks.sh S2 RR          # live wait-for graph (S1|S2|S3|S7 × RC|RR|SER)
docker rm -f elp-race-pg                      # clean up
```

`report.py` rewrites `experiments/race/results/`, so run it only to regenerate the reported
results. The full procedure is in [`experiments/race/README.md`](experiments/race/README.md). The
headline finding, in [`FINDINGS.md`](experiments/race/FINDINGS.md): *a correct-looking
lock-then-check trigger is only correct at READ COMMITTED*. Under REPEATABLE READ the fixture
trigger let a team end at 103/4. The product's capacity v2 trigger (write the parent row) holds at
every level.

## Ingestion demo

This runs locally and never touches the cloud. Full walk-through: [`docs/INGESTION.md`](docs/INGESTION.md) §5–6.

```bash
cp supabase/functions/.env.example supabase/functions/.env     # once; set GITHUB_WEBHOOK_SECRET
scripts/reset_local.sh
npx -y supabase@latest functions serve                         # terminal 1: the webhook
(cd api && SUPABASE_TARGET=local MONGO_TARGET=local \
   uv run uvicorn app.main:app --port 8000)                    # terminal 2: the API
(cd api && SUPABASE_TARGET=local MONGO_TARGET=local \
   uv run python -m app.worker --loop --interval 1)            # terminal 3: the worker
(cd web && npm run dev)                                        # terminal 4: the web app
uv run --python 3.12 python scripts/replay_webhooks.py         # 16 of 16 deliveries behave as expected
```

What the replay covers:

- **Normal pushes.** `ingest/fixtures/`: this repository's real history as T00 pushes, plus
  synthetic pushes for T01 and T03.
- **Edge cases:**
  - a redelivery and a replayed capture, both answered `duplicate: true`;
  - a wrong-secret signature and a tampered body, both answered 401;
  - a feature-branch push, which is ignored;
  - a commit by an unknown author;
  - a teammate's commit pushed by someone else, which is logged but not credited.

Then check the result:

1. As **admin**: on `/admin` (the Directory page), scroll to the **Ingestion** panel; the
   *Mongo ↔ Postgres consistency* table below it should say **all consistent**.
2. As **ramesh**: `/sheet/P01` shows the live feed (the **Live activity** panel below the sheet).
   Click the **underlined file name** of a GitHub item to open the trace sheet (the rest of the row
   is not a link): the Mongo raw event next to its Postgres rows.
3. As **meera**: `/search` finds the vault notes.

On the live project the same 16 deliveries were replayed once through the deployed Edge
Function. The result:

- 9 projected deliveries (plus 1 ignored);
- 29 GitHub contributions and 58 chunks in Postgres;
- the raw events, notes and `note_versions` in Atlas `elp`, which has `$jsonSchema` validators.

Replaying them again is a no-op (duplicates).

## Lab documents

Component numbers and marks follow the lab manual (`PROJECT_MASTER.md` §6.2).

| # | Component (raw marks) | Document | Build |
|:--|:--|:--|:--|
| 1 | Synopsis (5) | submitted earlier as DOCX/PDF; not in this repository (summary in `PROJECT_MASTER.md` §7) | – |
| 2 | Requirement Specification (5) | [`docs/lab/C2_SRS.md`](docs/lab/C2_SRS.md) · [PDF](docs/lab/C2_SRS.pdf) · [DOCX](docs/lab/C2_SRS.docx) | `docs/lab/build_c2.sh` |
| 3 | ER Diagram and Schema (10) | [`docs/lab/C3_ER.md`](docs/lab/C3_ER.md) · [PDF](docs/lab/C3_ER.pdf) · [DOCX](docs/lab/C3_ER.docx) | `FONTS=… sh docs/lab/build_c3.sh` |
| 4 | Test, SQL + NoSQL (20) | `supabase/fixture/` (Q1–Q37), `mongo/04_mongo.js` (M1–M25), `PROJECT_MASTER.md` Appendices C–E and H | `scripts/test_fixture.sh`, `scripts/test_mongo_fixture.sh` |
| 5 | DFD Level 0/1/2 (10) | [`docs/lab/C5_DFD.md`](docs/lab/C5_DFD.md) · [PDF](docs/lab/C5_DFD.pdf) · [DOCX](docs/lab/C5_DFD.docx) | `docs/lab/dfd/src/render.sh`, then `build_docs.sh` |
| 6 | Normalized tables (10) | [`docs/lab/C6_Normalization.md`](docs/lab/C6_Normalization.md) · [PDF](docs/lab/C6_Normalization.pdf) · [DOCX](docs/lab/C6_Normalization.docx) | `docs/lab/build_c6.sh` |
| 7 | Midterm Report (20) | [`docs/lab/C7_Midterm_Report.md`](docs/lab/C7_Midterm_Report.md) · [PDF](docs/lab/C7_Midterm_Report.pdf) · [DOCX](docs/lab/C7_Midterm_Report.docx) | `docs/lab/build_c7.sh` |
| 8 | Forms, Security and Validation (10) | [`docs/lab/C8_Forms_Security_Validation.md`](docs/lab/C8_Forms_Security_Validation.md) · [PDF](docs/lab/C8_Forms_Security_Validation.pdf) · [DOCX](docs/lab/C8_Forms_Security_Validation.docx) | `docs/lab/build_c8.sh` (`REGEN=1` re-reads the local stack) |
| 9 | Demo and Draft Report (30) | [`docs/lab/C9_Demo_and_Draft_Report.md`](docs/lab/C9_Demo_and_Draft_Report.md) · [PDF](docs/lab/C9_Demo_and_Draft_Report.pdf) · [DOCX](docs/lab/C9_Demo_and_Draft_Report.docx); its Part I is the authoritative demo script, and [`docs/RUNBOOK.md`](docs/RUNBOOK.md) §1 is the operator's side of it | `docs/lab/build_c9_c11.sh` |
| 10 | Innovative Experiment (10, not reduced) | [`docs/lab/C10_Innovative_Experiment.md`](docs/lab/C10_Innovative_Experiment.md) · [PDF](docs/lab/C10_Innovative_Experiment.pdf) · [DOCX](docs/lab/C10_Innovative_Experiment.docx); data in [`experiments/race/`](experiments/race/README.md) | `docs/lab/build_c10.sh` |
| 11 | CIE Demo and Final Report (10, not reduced) | [`docs/lab/C11_Final_Report.md`](docs/lab/C11_Final_Report.md) · [PDF](docs/lab/C11_Final_Report.pdf) · [DOCX](docs/lab/C11_Final_Report.docx) (skeleton; completed after the demo) | `docs/lab/build_c9_c11.sh` |

Every build script renders its figures with Graphviz and converts the Markdown with pandoc and
xelatex, all in Docker. The images are `nshine/dot` or `local/graphviz`, and `pandoc/latex`. C2
also needs Times New Roman from macOS; C3 needs a folder of DejaVu fonts.

## Status

As of 5 November 2026.

| Area | State |
|:--|:--|
| Live Supabase project `countersign-dbms` (ap-south-1, PG 17.11) | **Built.** Migrations 0001–0006 applied; fixture, demo and ingest seeds loaded; 7 personas; sign-ups disabled |
| Relational core, RLS, RPCs, triggers, views | **Built and tested** (pgTAP 657) |
| Frozen graded fixture | **Green.** Q1–Q37 37/37, M1–M25 25/25 |
| Web app (student, faculty, admin) | **Built** (e2e 38). Runs on localhost against either stack; no hosted deployment yet (needs `npx vercel login`) |
| FastAPI (notes with immutable versions, consistency, ingest drain/trace/status) | **Built** (pytest 47). Runs on a laptop; not hosted |
| GitHub ingestion: Edge Function, pgmq, worker, Mongo log, projection, Realtime | **Built and deployed.** 16 replayed deliveries → 9 projected, 29 contributions, 58 chunks on the live project |
| Real repository webhook on GitHub | **Pending.** No hook is configured on `Arun-Sanjay/countersign-dbms` yet (`ingest/README.md`, cloud setup step 4) |
| File text for real pushes (`GITHUB_FETCH_CONTENTS=1`) | **Built, untested against GitHub** (needs a `GITHUB_TOKEN`; the repository is private) |
| Search (`search_chunks`: keyword list + vector list, fused by RRF, as the caller) | **Built.** Keyword-only today |
| Embeddings (Voyage `voyage-4`, 1024 dims, HNSW) | **Built, unused.** Pending `VOYAGE_API_KEY`; 0 of 58 chunks embedded |
| `/ask` | **Extractive with citations** today. Generative answers with server-checked citations are built and unit-tested with stubs. Pending `ANTHROPIC_API_KEY` |
| Innovative Experiment (race harness, 72,000 races, precedence graphs in SQL) | **Done** (local Docker) |
| CI (`fixture.yml`) | **Written, not pushed** (needs the `workflow` scope) |
| Keep-alive for the free project | **Manual** (`docs/RUNBOOK.md` §3); no scheduled job yet |
| GitHub OAuth identity binding, limited Atlas app user | **Pending.** Identities are verified by an admin seed; the API uses the Atlas admin URI, locally only |
| Viva practice, audit hash chain, consent ledger, Yjs co-editing, Race Arena page | **Planned** (`docs/PLAN.md` §3, phases P4–P5) |

Open app issues found in the demo rehearsal, with repro and proposed fix: [`docs/KNOWN_ISSUES.md`](docs/KNOWN_ISSUES.md).

## Safety rules

- **Frozen fixture.** `supabase/fixture/*` and `mongo/04_mongo.js` are the graded Test fixture.
  Never edit them.
- **Never run `supabase/fixture/03_queries.sql` against the live project.** Q30–Q37 write data,
  and Q37 commits on its own (`docs/FIXTURE_ON_SUPABASE.md`).
- **Local-only tools.** `scripts/reset_local.sh`, `scripts/clear_local_pipeline.sh`,
  `npm run e2e` and `npx supabase test db` are local only. Never run
  `npx supabase db reset --linked` or `mongo/seed.js` against the cloud. The list and the safe
  ways to undo demo changes on the live project are in [`docs/RUNBOOK.md`](docs/RUNBOOK.md) §5.
- **Secrets.** Secrets live only in git-ignored files: `supabase/.env`,
  `supabase/functions/.env`, `api/.env`, `web/.env.*` and `atlas-credentials.env`. The browser
  only ever gets the publishable key.

## Credits

- **S Arun Sanjay** (1RV24CY047): product, database, backend, web app.
- **Sanvid Razdan** (1RV24CY051): documentation, diagrams and test runs; the viva owner of the
  RLS policies, the MongoDB validators and the experiment analysis (C7 §12, `docs/PLAN.md` §3).

Built for the Database Management Systems lab (CD252IA), Department of Computer Science and
Engineering, RV College of Engineering®, Bengaluru, 2026-27.

Built with Supabase (PostgreSQL 17, PostgREST, Auth, Realtime, Edge Functions, pgmq, pgvector),
MongoDB 8 / Atlas, FastAPI, React, Vite, Tailwind CSS, shadcn/ui and Playwright.
