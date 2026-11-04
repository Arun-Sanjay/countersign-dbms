# Countersign web

*Every mark has a receipt.* This is the React front end for the Unified Experiential Learning Platform (RVCE CD252IA).

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
| `types:gen` | regenerate `src/data/database.types.ts` from the local DB (`supabase gen types`) |

**Personas.** These are created by `scripts/create_personas.py` (repo root). All use the password `Countersign@2026`.

- Students: `arun@example.edu`, `sanvid@`, `nikhil@`, `meera@`
- Faculty: `ramesh@` (F01, teaches CD252IA) and `lakshmi@` (F02)
- Admin: `admin@`

The login page has one-click buttons for each. Set `VITE_SHOW_PERSONAS=false` to hide them.

If the local DB was reset, re-create the personas:
`uv run --python 3.12 --with httpx --with python-dotenv python scripts/create_personas.py --target local`.

**Smoke test.** Start `npm run dev`, then run `npm run smoke`. It uses `playwright-core` with the installed Google Chrome, so no browser download is needed. The test logs in as arun, ramesh and admin, opens the SQL sheet, checks the role guard and the wrong-password mapping, and writes screenshots to `test-results/`.

**End-to-end suite (`e2e/`, Playwright Test, installed Chrome).** LOCAL stack only.

```bash
npm run e2e              # resets the local DB (supabase db reset) + personas, starts Vite on :5173
                         # and the FastAPI on :8000 when the elp-mongo-local container is up, runs e2e/01..09
E2E_API=0 npm run e2e    # without the API (the /notes spec then checks the offline state)
E2E_SKIP_RESET=1 npm run e2e   # skip the reset (specs assume the seed state)
npm run e2e:typecheck    # tsc for the e2e code
npm run e2e:report       # open the HTML report (playwright-report/)
```

The specs run in file order with one worker because they share the database: 02 files arun's C3 claim, 03 has sanvid confirm it, 05 records a mark on C2 and locks C2. globalSetup refuses to run unless `.env.local` points at 127.0.0.1/localhost.

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
  pages/admin/              AdminPage /admin
```

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
