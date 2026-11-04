# Known issues in the app (not fixed)

State: 5 November 2026, migrations 0001–0006, the web app and API as in the repository.

These came out of the read-only demo rehearsal on the live project (C9 §14) and the lab panel's
review of C7–C11. Each one was checked against the code before it was listed. **None is fixed
here:** this file records the repro and a proposed fix, so that the fix can be made as a normal
code change with its tests. Database defects that are already in the C2 known-defects register
(§3.8: D1, D2, D4–D10) are not repeated, except where the rehearsal added something.

Severity: **minor** = cosmetic or wording; **moderate** = misleads a user or blocks a demo step;
none is a security or integrity defect.

| # | Issue | Severity |
|--:|:--|:--|
| 1 | The trace sheet and the cell drawer render at 384 px, not their intended width | moderate (projector legibility) |
| 2 | `worker_unconfigured` names only `INGEST_DB_URL` | minor |
| 3 | The login subtitle is not the official title | minor |
| 4 | The consistency table hides why a row with unequal counts is still "consistent" | minor |
| 5 | The rubric sheet does not refresh after a teammate countersigns | minor |
| 6 | The rubric grid does not fit a 1440 px screen; the Live chip is below the fold | minor |
| 7 | A two-decimal mark is rounded, not refused, on a direct INSERT | minor (data layer) |

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

## 3. The login subtitle is not the official title

**Where:** `web/src/pages/LoginPage.tsx:180`; asserted by `web/e2e/01-login.spec.ts:7`.

**Repro:** open `/login`. The subtitle reads "Unified Experiential Learning Platform — RVCE
CD252IA" (`web/screenshots/rehearsal-00-login.png`). The official title (C2, PROJECT_MASTER) is
"Unified Experiential Learning and Project Intelligence Platform".

**Proposed fix:** change the text to "Unified Experiential Learning and Project Intelligence
Platform — RVCE CD252IA" in `LoginPage.tsx` **and** the expected string in `01-login.spec.ts`
(the test pins the current wording, so changing only the page breaks the e2e gate).

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

## 5. The rubric sheet does not refresh after a countersign

**Where:** `web/src/lib/query.ts:14` (`refetchOnWindowFocus: false`), and the Realtime broadcast
of migration 0005, which covers new contributions only.

**Repro:** faculty window on `/sheet/P06`; in a second browser profile Arun confirms claim #5.
Switch back to the faculty window: the C3 glyph for Sanvid is still the clock until Cmd+R
(C9 §3.4 step 4 and §5 tell the presenter to reload).

**Proposed fix (either):** (a) set `refetchOnWindowFocus: true` for the rubric-sheet and drawer
queries only (not globally, so that forms keep their state); or (b) broadcast a metadata-only
`claim_status` event to `project:<id>` from the claim-status trigger, as the contribution
trigger already does, and invalidate `v_rubric_sheet` on it. (b) needs a migration (0007) and a
pgTAP test in `05_ingest.sql` §G style; (a) is a one-line web change.

## 6. The grid does not fit a 1440 px screen; the Live chip is below the fold

**Where:** `web/src/pages/faculty/RubricSheetPage.tsx` (grid, `data-testid="rubric-grid"`).

**Repro:** `/sheet/P06` at 1440×900 with the sidebar open: C11 is cut off and Lab CIE /50 is off
screen; at 125 % zoom only C1–C8 fit (`rehearsal-55-F-sheet-zoom125.png`). The Live activity
panel and its chip are below the sheet (`rehearsal-31-F-sheet-P06-full.png`).

**Proposed fix:** make the student column sticky (`position: sticky; left: 0`) so that sideways
scrolling keeps the names, abbreviate the component sub-labels below 1600 px, and repeat the Live
chip in the page header next to *Enter marks*. Until then the C9 script says "scroll sideways"
and "scroll down to the Live activity panel".

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
