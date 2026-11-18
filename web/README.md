# Countersign web

*Every mark has a receipt.* This is the React front end for the Unified Experiential Learning and Project Intelligence Platform (RVCE CD252IA).

Stack: Vite 8, React 19, TypeScript (strict), Tailwind v4, shadcn/ui (radix-nova, Geist), react-router 8, TanStack Query, supabase-js, zod and react-hook-form, plus lucide, sonner and prism-react-renderer.

The browser only ever holds the **publishable (anon) key**. Every query runs as the signed-in user, so the RLS policies, `security_invoker` views and SECURITY INVOKER RPCs in `supabase/migrations` decide what each user sees.

## Run

```bash
cd web
npm install

# LOCAL (default): needs the local Supabase stack (npx supabase start, from the repo root)
npm run env:local     # writes .env.local from `supabase status` (key is never printed)
npm run dev           # http://localhost:5173

# CLOUD demo: reads .env.remote (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY of countersign-dbms)
npm run dev:remote
npm run build:remote  # production bundle pointed at the cloud project
```

Vite env modes: `vite` (mode `development`) loads `.env.local`. `vite --mode remote` also loads `.env.remote`, and a mode file wins over `.env.local`, so both keys come from the cloud file. A plain `npm run build` (mode `production`) uses `.env.local`. For a cloud build, use `build:remote`.

| Script | What it does |
|---|---|
| `dev` / `dev:remote` | dev server against the local stack / the cloud project |
| `build` / `build:remote` | `tsc -b` + `vite build` |
| `typecheck` | `tsc -b` (strict, `noUncheckedIndexedAccess`) |
| `lint` | `oxlint --max-warnings 0` |
| `smoke` | Chrome smoke test of the running dev server (see below) |
| `env:local` | regenerate `.env.local` from `supabase status` |
| `sql:extract` | regenerate `src/sql/sources.generated.ts` from the migrations |
| `race:results` | regenerate `src/data/race-results.json` (Race arena data: aggregates + verbatim SQL) from `experiments/race`; also run by `build` / `build:remote` (`--if-present` keeps the committed file when `experiments/` is absent) |
| `types:gen` | regenerate `src/data/database.types.ts` from the local DB (`supabase gen types`) |

**Personas.** These are created by `scripts/create_personas.py` (repo root). All use the password `Countersign@2026`.

- Students: `arun@example.edu` (solo team T00), `nikhil@`, `meera@` (T06: a teammate's C4 claim waits for her countersign)
- Faculty: `ramesh@` (F01, teaches CD252IA) and `lakshmi@` (F02)
- Admin: `admin@`

The login page has one-click buttons for each. Set `VITE_SHOW_PERSONAS=false` to hide them.

If the local DB was reset, re-create the personas:
`uv run --python 3.12 --with httpx --with python-dotenv python scripts/create_personas.py --target local`.

**Smoke test.** Start `npm run dev`, then run `npm run smoke`. It uses `playwright-core` with the installed Google Chrome, so no browser download is needed. The test logs in as arun, ramesh and admin, opens the SQL sheet, checks the role guard and the wrong-password mapping, and writes screenshots to `test-results/`.

**End-to-end suite (`e2e/`, Playwright Test, installed Chrome).** LOCAL stack only.

```bash
npm run e2e              # resets the local DB (supabase db reset) + personas, starts Vite on :5173
                         # and the FastAPI on :8000 when the elp-mongo-local container is up, runs e2e/01..11
E2E_API=0 npm run e2e    # without the API (the /notes spec then checks the offline state)
E2E_SKIP_RESET=1 npm run e2e   # skip the reset (specs assume the seed state)
npm run e2e:typecheck    # tsc for the e2e code
npm run e2e:report       # open the HTML report (playwright-report/)
```

The specs run in file order with one worker because they share the database: 02 files arun's C3 claim (T00 is a solo team, so it stays pending: no teammate to countersign), 03 has meera confirm Aditi's seeded pending C4 claim on T06 and checks the solo-team wording for arun (his page and ramesh's claim drawer), 05 records a mark on C2 and locks C2. 10 builds a fresh push (random SHAs, a unique word in a new vault note), signs and POSTs it with `scripts/replay_webhooks.py` to the local `github-webhook` function (started with `supabase functions serve` if it is not running), drains the queue with `uv run python -m app.worker --once`, requires BOTH halves (ingest_event projected with a mongo_id, and the raw event in the local Mongo `elp.github_events`), and checks the live toast and feed on ramesh's `/sheet/P01`, the trace sheet behind the feed item, that meera's search and Activity tab find the note, and that lakshmi finds nothing in P06. A broken Edge Function or worker FAILS the spec; only with `E2E_ALLOW_FALLBACK=1` may it call `ingest_receive` / `project_push` over PostgREST with the local service key instead (`e2e/ingest.ts`; the key is never printed). `E2E_INGEST_WORKER=0` skips the worker (it drains the whole queue) and also needs `E2E_ALLOW_FALLBACK=1`. globalSetup refuses to run unless `.env.local` points at 127.0.0.1/localhost; after the reset it also clears the worker's documents in the LOCAL Mongo container (`scripts/clear_local_pipeline.sh`), so the admin consistency panel compares like with like.

## Layout

```
src/
  App.tsx, routes.tsx       providers; route map (lazy page chunks, guards)
  auth/                     AuthProvider (session + app_user profile), guards, personas
  components/               PageHeader, StatCard, DataTable, StatusBadge, EmptyState,
                            ConfirmDialog, FormField, Panel, ErrorState, Skeletons
  components/sql/           SqlButton ("</> SQL" pill), SqlSheet (drawer), SqlCode (highlighter)
  components/layout/        AppShell, AppSidebar (role-aware), PublicShell, ThemeToggle, Logo
  components/ui/            shadcn primitives (generated; do not hand-edit)
  data/                     database.types.ts (generated), types.ts (RPC jsonb shapes),
                            rpc.ts, keys.ts, hub.ts + one file per area (team, projects, notes,
                            facultyView, faculty, admin)
  lib/                      env, supabase client, errors (DB -> friendly), notify (toasts,
                            form errors), rules (zod mirrors of the CHECKs), format, query
  sql/                      registry.ts (panel id -> SQL/algebra/RLS/concepts),
                            sources.generated.ts (verbatim from supabase/migrations)
  pages/                    LoginPage, AboutPage, NotFoundPage
  pages/student/            HubPage /hub, TeamPage /team, ProjectPage /projects/:projectId,
                            NotesPage /notes, FacultyViewPage /faculty-view
  pages/faculty/            RubricSheetPage /sheet/:projectId, ContestedPage /contested,
                            MarksPage /marks/:projectId   (admins can open these too)
  pages/admin/              AdminPage /admin (+ IngestionPanel: ingest_event, Sync now, consistency)
  pages/shared/             SearchPage /search (search_chunks + POST /ask; students, faculty, admins)
  pages/race/               RacePage /race: the Innovative Experiment (every role; live races faculty/admins)
  components/activity/      LiveActivityPanel: Realtime broadcast (team:<id> students, project:<id> staff) + recent feed;
                            TraceSheet: one push, Mongo raw event next to its Postgres rows (GET /ingest/trace)
```

## Search, live activity, ingestion

- **`/search`** calls `search_chunks()` as the signed-in user. Filters are team, author and since. Each result card shows the artifact, version, author, time and a highlighted snippet, plus the score breakdown: FTS rank, vector rank and RRF = Σ 1/(60 + rank). **Ask** posts to the API's `POST /ask` (`VITE_API_URL`, default `http://localhost:8000`). The answer's `[n]` markers link to the cited result cards. When the API is down or has no `/ask`, the page says so and search keeps working.
- **Live activity.** On `/sheet/:projectId`, staff subscribe to the private Realtime channel `project:<id>` (teaching faculty and admins only); RLS on `realtime.messages` decides who may join. Each new contribution shows a toast `New evidence: <usn> · <artifact> · <source>` and a feed entry, and the page refreshes its sheet, progress and evidence queries. Clicking a GitHub feed item opens the **trace sheet**: the Mongo raw event and the Postgres rows of that push side by side, with the queries that ran. The student project page subscribes to `team:<id>` for the student's own team only (another team's activity never reaches a student, the same rows RLS hides): toasts appear on every tab, and the feed and GitHub commit timeline are on the **Activity** tab. Admin inbox rows open the same trace sheet. The sheet header repeats the Live status chip (click it to jump to the panel). A countersign is not broadcast, so the rubric sheet and the cell drawer refetch whenever the window regains focus (`refetchOnWindowFocus: 'always'` on those two queries only; `lib/query.ts` also listens to the window `focus` event, because `visibilitychange` does not fire when switching between two visible windows).
- **`/race` (Race arena).** Component 10 in the app: the over-admission heatmap (strategy × isolation × N, hover/click for the outcome mix), p95 latency (SVG chart with a table view), the six strategies with their SQL, and two N = 2 precedence graphs (cyclic S2/RR, acyclic S2/RC) drawn by `src/lib/precedence.ts`. Data: `src/data/race-results.json` (`npm run race:results`). **Run a live race** posts to `POST /race/run` (faculty and admins) and animates each client's outcome; with the race lab down it shows *Race lab offline* and `experiments/race/setup.sh`. Spec: `e2e/11-race.spec.ts` (mocks the API, so it needs neither the API nor the container).
- **Admin → Ingestion.** The `ingest_event` table with status chips. **Sync now** calls `POST /ingest/drain`. The consistency table comes from `GET /consistency`.

## Conventions for page owners

- **Data.** Put hooks in `src/data/<area>.ts`.
  - Call RPCs with `rpc<T>('name', { p_… })`. Errors come back already mapped.
  - In `useQuery`, throw `{ error }` with `throwIfError(error)`.
- **Errors.**
  - Mutations: `onError: (e) => applyServerError(e, form.setError, ['statement', …])` puts the DB's message on the right field. Without a form, use `toastError(e)`.
  - `lib/errors.ts` maps every DETAIL rule key from 0002–0004 (team_capacity, one_team_per_project, milestone_locked, countersign_stale_revision, assessment_marks_le_max …) and the SQLSTATE fallbacks.
- **Forms.** Use `FormField` with shadcn inputs, plus the zod schemas in `lib/rules.ts`. They mirror the DB CHECKs: three layers (zod, then the RPC pre-check, then the CHECK or trigger).
- **Show the SQL.**
  - Wrap data in `<Panel title=… sqlId="team.finder">`, or drop `<SqlButton panelId=… />` anywhere.
  - To add a panel, add an entry in `src/sql/registry.ts` using `fn()`, `view()` or `client()`. Unknown view, function, policy or trigger names are type errors.
  - After a migration changes, run `npm run sql:extract`.
- **States.**
  - Loading: `DataTable loading`, `PanelSkeleton` or `StatGridSkeleton`.
  - Empty: `EmptyState`.
  - Failed: `ErrorState`.
  - Status chips: `StatusBadge` (pending, confirmed, contested, withdrawn, submitted, locked, private, team, no_evidence).
- **Wording.** A student with no claims has "no recorded evidence yet". It is never a verdict, and never "ghost".
- **Stubs.** Replace `StubNotice` on your page with real panels.
