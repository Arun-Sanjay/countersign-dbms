# Known issues in the app (all fixed)

State: 19 November 2026. Issues 1–7 were found with migrations 0001–0006; issues 8 and 9 were
found later in the API. **All nine are fixed** (web app, API and migration
`20261105000007_strict_marks.sql`), each with its test. Migration 0007 is applied to the local
stack and to the live project (pushed 5 Nov 2026; all seven migrations 0001–0007 verified live on
19 Nov 2026; the live `assessment` table carries the one-decimal CHECK). The web fixes reach the demo laptop with
the next `npm run dev:remote` / build.

These came out of the read-only demo rehearsal on the live project (C9 §14) and the lab panel's
review of C7–C11. Each one was checked against the code before it was listed. Each section keeps
the original repro and cause, then a **Fixed** paragraph that can be used as the commit
description. Database defects that are already in the C2 known-defects register (§3.8: D1, D2,
D4–D10) are not repeated, except where the rehearsal added something.

Verified on 19 November 2026 (local stack, after `scripts/reset_local.sh`, with the current
solo-team demo seed): pgTAP 710/710 in 7 files (`npx -y supabase@latest test db`), API pytest
66/66 (`SUPABASE_TARGET=local MONGO_TARGET=local`, race lab `elp-race-pg` up; without it 65 pass
and 1 is skipped), web typecheck and lint clean, and e2e 44/44 across `e2e/01`–`11` (including
the race arena's `e2e/11`).

Severity: **minor** = cosmetic or wording; **moderate** = misleads a user or blocks a demo step;
none is a security or integrity defect.

| # | Issue | Severity | Status |
|--:|:--|:--|:--|
| 1 | The trace sheet and the cell drawer render at 384 px, not their intended width | moderate (projector legibility) | **fixed** (e2e 05, 10) |
| 2 | `worker_unconfigured` names only `INGEST_DB_URL` | minor | **fixed** (pytest) |
| 3 | The login subtitle is not the official title | minor | **fixed** (e2e 01) |
| 4 | The consistency table hides why a row with unequal counts is still "consistent" | minor | **fixed** (e2e 10) |
| 5 | The rubric sheet does not refresh after a teammate countersigns | minor | **fixed** (e2e 03) |
| 6 | The rubric grid does not fit a 1440 px screen; the Live chip is below the fold | minor | **fixed** (e2e 05) |
| 7 | A two-decimal mark is rounded, not refused, on a direct INSERT | minor (data layer) | **fixed** (migration 0007, pgTAP 01 + 07) |
| 8 | `python -m app.worker --loop` exits on the first Postgres or Mongo outage | moderate (blocks live ingestion) | **fixed** (pytest `test_worker.py`) |
| 9 | A `POST /race/run` refused as busy (409) still resets the race lab | moderate (spoils a running race) | **fixed** (pytest `test_race.py`) |

Not app bugs (recorded so nobody "fixes" them): the anonymous 42501 error carries PostgREST's
hint "GRANT SELECT ON public.assessment TO anon" (that is PostgREST's generic advice; `anon`
has no privilege by design, C8 B.5); Nikhil's teammate finder lists nobody (he already holds
every skill P01 requires: seed data, not a defect); the Ingestion section is a panel on the admin
Directory page, not a tab (a naming point, now stated correctly in the documents).

---

## 1. The trace sheet and the cell drawer are 384 px wide

**Where:** `web/src/components/activity/TraceSheet.tsx:116` (`className="w-full overflow-y-auto sm:max-w-2xl"`)
and `web/src/pages/faculty/components/ClaimDrawer.tsx:82` (`... sm:max-w-xl`).

**Repro:** as ramesh on `/sheet/P06`, open the trace sheet from an underlined file name in the
Live activity panel (or click Aditi Rao's C1 cell for the drawer) at 1440×900. The sheet is about
384 px wide; delivery ids, repository names and timestamps wrap into 7 to 10 lines each
(`web/screenshots/rehearsal-35-F-trace-sheet.png`, `rehearsal-34-F-aditi-c1-drawer.png`).

**Cause:** the shadcn `SheetContent` base class contains `data-[side=right]:sm:max-w-sm`
(`web/src/components/ui/sheet.tsx:65`). An attribute-variant utility is more specific than the
plain `sm:max-w-2xl` / `sm:max-w-xl` passed in, so `max-w-sm` (24 rem = 384 px) wins.
`SqlSheet.tsx:48` avoids this by writing `data-[side=right]:sm:max-w-2xl`, which is why the SQL
drawer is wide and these two are not.

**Proposed fix:** use the same variant prefix as `SqlSheet`:
`className="w-full overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-2xl"` in
`TraceSheet`, and `data-[side=right]:sm:max-w-xl` in `ClaimDrawer`. In the trace sheet, also let
the two key–value cards stack (one column) below about 640 px and give the value column
`break-all` only for ids. Check: e2e 05 and 10 still pass; screenshot at 1440 px.

**Fixed.** Fix the trace sheet and the cell drawer width (384 px -> 768 / 576 px). Both now use
the variant prefix that `SqlSheet` uses, so they beat the base class
`data-[side=right]:sm:max-w-sm`: `TraceSheet` is
`data-[side=right]:w-full data-[side=right]:sm:max-w-2xl data-[side=right]:xl:max-w-3xl` (768 px
at 1440 px, more room for delivery ids on the projector) and `ClaimDrawer` is
`data-[side=right]:w-full data-[side=right]:sm:max-w-xl`. In the trace sheet the two key–value
cards sit side by side only when the sheet itself is at least 40 rem wide (a container query,
`@container` + `@min-[40rem]:grid-cols-2`), and `Kv` breaks anywhere (`break-all`) only for ids
(`_id`, `delivery_id`, `mongo_id`); other values wrap between words. Tests: e2e 05 asserts the
drawer is wider than 560 px at 1440 px, e2e 10 that the trace sheet is wider than 700 px.

## 2. `worker_unconfigured` names only `INGEST_DB_URL`

**Where:** `api/app/worker.py:318-330` (`make_store`).

**Repro:** start the API against the cloud without a service key
(`SUPABASE_TARGET=remote MONGO_TARGET=atlas uv run uvicorn app.main:app`), sign in as admin and
press **Sync now** on the Ingestion panel. Answer: HTTP 503 `worker_unconfigured`, "Sync failed
INGEST_DB_URL is not configured" (`web/screenshots/rehearsal-70-admin-sync-now-no-service-key.png`).

**Cause:** with no service key, `make_store` falls back to the SQL backend and then reports only
that backend's missing setting, although setting `SUPABASE_SERVICE_ROLE_KEY` would also work (and
is the documented path, `api/app/config.py` header).

**Proposed fix:** when neither credential is set (and `INGEST_BACKEND` was not given
explicitly), raise `ConfigError("the worker needs SUPABASE_SERVICE_ROLE_KEY (REST backend) or
INGEST_DB_URL (SQL backend); neither is configured")`. Keep the backend-specific message when
`INGEST_BACKEND` is set. Add a `test_worker.py` case for the message.

**Fixed.** Name both worker credentials in `worker_unconfigured`. `make_store` (`api/app/worker.py`)
now raises "the worker needs SUPABASE_SERVICE_ROLE_KEY (REST backend) or INGEST_DB_URL (SQL
backend); neither is configured" when no backend was chosen (`--backend` / `INGEST_BACKEND`) and
neither credential is set. With a backend chosen it keeps that backend's own message
("INGEST_DB_URL is not configured", "SUPABASE_SERVICE_ROLE_KEY is not configured"). Tests
(`api/tests/test_worker.py`): `test_make_store_without_credentials_names_both_settings` covers
the default, `sql`, `rest` and `INGEST_BACKEND=sql`; `test_drain_without_credentials_is_503_naming_both`
checks `POST /ingest/drain` as admin answers 503 `worker_unconfigured` naming both settings.

## 3. The login subtitle is not the official title

**Where:** `web/src/pages/LoginPage.tsx:180`; asserted by `web/e2e/01-login.spec.ts:7`.

**Repro:** open `/login`. The subtitle reads "Unified Experiential Learning Platform — RVCE
CD252IA" (`web/screenshots/rehearsal-00-login.png`). The official title (C2, PROJECT_MASTER) is
"Unified Experiential Learning and Project Intelligence Platform".

**Proposed fix:** change the text to "Unified Experiential Learning and Project Intelligence
Platform — RVCE CD252IA" in `LoginPage.tsx` **and** the expected string in `01-login.spec.ts`
(the test pins the current wording, so changing only the page breaks the e2e gate).

**Fixed.** Use the official title on the login page. The subtitle now reads "Unified Experiential
Learning and Project Intelligence Platform — RVCE CD252IA" (`LoginPage.tsx`), and e2e 01 expects
that string. The same title is used in the smoke test (`web/scripts/smoke.mjs`, which pinned the
old wording too), the page `<meta name="description">` (`web/index.html`), the FastAPI
description (`api/app/main.py`) and `web/README.md`.

## 4. The consistency table hides why "6 · 6 · matched 5" is consistent

**Where:** `web/src/pages/admin/IngestionPanel.tsx` (columns *Mongo commits*, *Postgres commits*).

**Repro:** as admin on the live project, the Mongo ↔ Postgres consistency row for T00 /
1RV24CY047 reads Mongo 6, Postgres 6, matched 5, status *consistent*
(`web/screenshots/rehearsal-54-admin-consistency.png`).

**Cause:** the API returns why the counts differ (`api/app/consistency.py`): one Mongo commit
touched only untracked paths (`not_projected`, by design) and one Postgres GitHub row has a
`source_ref` that is not a full SHA (a seeded row, `outside_pipeline.postgres_contributions`).
The panel shows the Mongo-side `outside_pipeline.mongo_commits` ("n fixture") but neither
`not_projected` nor `outside_pipeline.postgres_contributions`, so the row looks wrong.

**Proposed fix:** under *Mongo commits* show "n not projected (untracked files)" when
`not_projected` is non-empty, with the short SHAs in the tooltip; under *Postgres commits* show
"n outside pipeline" from `outside_pipeline.postgres_contributions`. The viva answer meanwhile is
`docs/VIVA_PREP.md` B28 and C9 §6.

**Fixed.** Show why unequal commit counts can still be consistent (admin consistency table). Under
*Mongo commits*, `IngestionPanel.tsx` now adds "n not projected (untracked files)" when
`not_projected` is non-empty, with the short SHAs in its tooltip
(`data-testid="consistency-not-projected"`), next to the existing "n fixture" line. Under
*Postgres commits* it adds "n outside pipeline" from `outside_pipeline.postgres_contributions`
(contribution rows whose `source_ref` is not a full SHA; tooltip says they are reported, not
compared; `data-testid="consistency-pg-outside"`). With the rehearsal's data, the T00 / 1RV24CY047
row would read Mongo 6 with "1 not projected", Postgres 6 with "1 outside pipeline", matched 5,
consistent (not re-checked on the live project, which this change did not touch). No API change;
the API already returned both fields. Test: a new last case in e2e 10 signs in as admin and
checks the "n outside pipeline" line (with its tooltip) for the demo seed's hand-entered T00
rows, and that the "n fixture" line is still there. The local seed has no commit that touched
only untracked files, so the "not projected" line is checked by type and review, not by e2e.

## 5. The rubric sheet does not refresh after a countersign

**Where:** `web/src/lib/query.ts:14` (`refetchOnWindowFocus: false`), and the Realtime broadcast
of migration 0005, which covers new contributions only.

**Repro (before the fix):** faculty window on `/sheet/P06`; in a second browser profile a
teammate confirms a pending claim. Switch back to the faculty window: the cell's glyph is still
the clock until a manual reload (C9 §3.4 step 4 and §5 told the presenter to reload).

**Proposed fix (either):** (a) set `refetchOnWindowFocus: true` for the rubric-sheet and drawer
queries only (not globally, so that forms keep their state); or (b) broadcast a metadata-only
`claim_status` event to `project:<id>` from the claim-status trigger, as the contribution
trigger already does, and invalidate `v_rubric_sheet` on it. (b) needs a migration (0007) and a
pgTAP test in `05_ingest.sql` §G style; (a) is a one-line web change.

**Fixed (a, made reliable).** Refresh the rubric sheet and its drawer when the faculty window
comes back. `useRubricSheet` and `useCellClaims` (`web/src/data/faculty.ts`) set
`refetchOnWindowFocus: 'always'`: `true` alone would not refetch within the 30 s `staleTime`,
which is exactly the demo's timing. The global default stays `false`, so forms keep their state.
TanStack Query only listens to `visibilitychange`, which does not fire when the presenter
switches between two visible browser windows, so `web/src/lib/query.ts` also hands the window
`focus` event to `focusManager`. Test: e2e 03 (`03-meera-countersign.spec.ts`) opens ramesh's
`/sheet/P06` in a second browser context before meera confirms Aditi Rao's (1RV24CY011) pending
C4 claim on T06, checks that the cell says "1 pending", fires a window focus and expects no
pending claim left, without a reload. The sheet now refetches on window focus, so the presenter
never reloads. Option (b), a `claim_status` broadcast, is not needed for the demo and was not built.

## 6. The grid does not fit a 1440 px screen; the Live chip is below the fold

**Where:** `web/src/pages/faculty/RubricSheetPage.tsx` (grid, `data-testid="rubric-grid"`).

**Repro:** `/sheet/P06` at 1440×900 with the sidebar open: C11 is cut off and Lab CIE /50 is off
screen; at 125 % zoom only C1–C8 fit (`rehearsal-55-F-sheet-zoom125.png`). The Live activity
panel and its chip are below the sheet (`rehearsal-31-F-sheet-P06-full.png`).

**Proposed fix:** make the student column sticky (`position: sticky; left: 0`) so that sideways
scrolling keeps the names, abbreviate the component sub-labels below 1600 px, and repeat the Live
chip in the page header next to *Enter marks*. Until then the C9 script says "scroll sideways"
and "scroll down to the Live activity panel".

**Fixed.** Fit the rubric grid on a 1440 px screen and put the Live chip in the header. The
Sl. No. and Student columns were already sticky (`sticky left-0` / `left-10`), so sideways
scrolling at 125 % zoom keeps the names. Below 1600 px (`min-[1600px]:` restores the wide layout)
the component columns are 3.75 rem instead of 4.6 rem, the student column 11 rem instead of
13 rem, and the component sub-labels use a tighter abbreviation set (`ABBREV_COMPACT`: "Diag.",
"Tab.", "Mid.", "Rep." on top of the existing "Req. Spec." etc.; the full title stays in the
tooltip and for screen readers). `RubricSheetPage` now holds the Realtime subscription
(`useProjectLive`) itself and passes it to `LiveActivityFeed`, so the same status appears twice:
on the panel and as a chip in the page header next to *Enter marks*
(`data-testid="live-status-header"`; clicking it scrolls to the panel). The page is keyed by
project id, so the drawer, entry mode and subscription start fresh on a project switch. Test:
e2e 05 asserts at 1440 × 1000 with the sidebar open that the grid has no horizontal overflow,
the Lab CIE /50 header is in the viewport, and the header chip is in the viewport. The C9 script
no longer needs "scroll sideways" at 100 % zoom.

## 7. A two-decimal mark is rounded on a direct INSERT

**Where:** `assessment.marks NUMERIC(4,1)` (migration 0002), found while writing C8 (C8 B.10).

**Repro (local stack, inside a rolled-back transaction):** as the teaching faculty, a direct
`INSERT INTO assessment (...) VALUES (..., 4.25, ...)` is stored as 4.3. The web form (zod) and
`record_assessment()` refuse 4.25; only the direct table path rounds.

**Proposed fix:** the value is rounded when it is cast to the column type, before any CHECK or
`BEFORE` trigger sees it, so neither can catch it on the current column. In migration 0007,
change the column to `NUMERIC(5,2)` (or unconstrained `NUMERIC`) and add
`CHECK (marks = round(marks, 1))`, with a gallery row in `01_constraints.sql`. PostgreSQL
refuses to change the type of a column that views depend on, so the same migration must drop and
recreate the views that read `assessment.marks` (`v_rubric_sheet`, `v_lab_cie_marks` and any
other dependant). The graded fixture does not use this column (it was added in
0002), so Q1–Q37 are unaffected.

**Fixed.** Refuse, never round, a mark with a second decimal (migration
`20261105000007_strict_marks.sql`). `assessment.marks` becomes unconstrained `NUMERIC`, so the
value reaches the checks exactly as sent, with two named CHECKs: `assessment_marks_one_decimal`
`CHECK (marks = round(marks, 1))` and `assessment_marks_precision` `CHECK (marks < 1000)` (the
range NUMERIC(4,1) implied; it also stops NaN and Infinity). `NUMERIC(5,2)` was not used because
it would still round 4.001 to 4.00 and accept it. A small BEFORE trigger,
`trg_assessment_canonical_marks` (`private.canonical_marks()`), stores an accepted mark at scale 1
(8 -> 8.0, 8.50 -> 8.5) as NUMERIC(4,1) did, so stored values, the trigger message "Marks 11.0
exceed the maximum …" and `v_what_faculty_sees` labels read exactly as before; it fires before
`trg_assessment_check` (name order) and never changes a value. The three dependent views
(`v_lab_cie_marks`, `v_rubric_sheet`, `v_what_faculty_sees`) are dropped and re-created in the
migration with the same text, `security_invoker = true` and the same grants (`REVOKE ALL … FROM
PUBLIC, anon, authenticated; GRANT SELECT … TO authenticated`); a before/after catalog snapshot
matched except `v_rubric_sheet.marks`, now `numeric` instead of `numeric(4,1)`. Tests: a gallery
row in `supabase/tests/01_constraints.sql` (4.25 refused) and `supabase/tests/07_strict_marks.sql`
(43 assertions: the table owner, teaching faculty and admin under RLS, the PostgREST upsert shape,
`record_assessment()`, the CHECKs alone with the triggers disabled, scale 1 storage, the
re-created views' options, grants and output). Web: `lib/errors.ts` maps both constraint names to
a field error on *marks*; `npm run sql:extract` picked up the re-created views, the new function
and trigger, and the "Record marks" SQL panel lists them; `npm run types:gen` produced no change.

## 8. The worker's `--loop` exits on the first outage

**Where:** `api/app/worker.py` (`--loop`), `Worker.recover_followups`, `SqlStore`.

**Repro (before the fix):** run `python -m app.worker --loop --interval 1`, then stop the local
Postgres or Mongo for a few seconds. The drain raises `StoreError` or a pymongo error and the
process ends, so pushes stay `queued` until someone restarts the worker. `recover_followups`
also raised when Mongo was down.

**Fixed.** A new `run_loop` catches `StoreError` (Postgres) and `PyMongoError` (Mongo) on each
pass, logs one JSON line `{event: drain_failed, error, retry_in_s}` to stderr (Mongo URIs are
masked), and retries after a backoff of 1 s doubling to 30 s (`LOOP_BACKOFF_MIN`,
`LOOP_BACKOFF_MAX`). The first good drain logs `drain_recovered` and resets the backoff. Any
other exception still ends the process, so real bugs are not hidden. `recover_followups` counts
an error, records `mongo_error` and ends that pass. A store built with `SqlStore.connect()`
reopens a closed connection on next use. `--once` exit codes are unchanged (0 ok, 1 failed
messages or `StoreError`, 2 configuration). Still true: if Postgres is unreachable when `--loop`
starts, the worker exits with code 2; only drains after startup are retried. Tests (all in
`api/tests/test_worker.py`): `test_loop_backs_off_on_postgres_and_mongo_outages_and_keeps_going`,
`test_loop_does_not_hide_bugs`, `test_recover_followups_stops_quietly_when_mongo_is_down`,
`test_sql_store_reopens_a_connection_lost_in_an_outage`.

## 9. A busy `POST /race/run` resets someone else's race

**Where:** `api/app/race.py` (`run_race`).

**Repro (before the fix):** start a live race on the Race arena page (`/race`), and send a second
`POST /race/run` while it runs. The second request is refused with 409 `race_busy`, but its
clean-up still ran `reset_t02` and `use_strategy('S1')`, which reset the lab under the first race.

**Fixed.** `run_race` sets an `owns_lab` flag only after the readiness and busy checks pass, and
the final reset (`reset_t02`, `use_strategy('S1')`) runs only when the flag is set. A request
refused with 409, or one that finds schema `exp` missing, runs no statement on the lab. Tests
(`api/tests/test_race.py`): `test_a_busy_request_never_resets_the_lab` (fails on the old code)
and `test_the_owner_resets_the_lab_before_and_after`.
