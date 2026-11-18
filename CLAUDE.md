# CLAUDE.md — DBMS EL Platform (CD252IA, RVCE)

Source of truth: `PROJECT_MASTER.md` (vision, schema, seed, verified queries, rubric). Approved plan: `docs/PLAN.md`.

## Hard rules
- PostgreSQL syntax only (Supabase, PG17). Vectors stay in pgvector; no separate vector DB; no LangChain. Retrieval is explicit SQL.
- MongoDB stays a real component (raw events, notes + immutable versions, portfolios).
- `supabase/fixture/` (01_schema, 02_seed, 03_queries) and `mongo/04_mongo.js` are the **frozen graded Test fixture**. Never edit them; Q1–Q37 / M1–M25 outputs must keep matching Appendix H. New schema changes go in migrations as append-only columns/constraints; new real data (P06, T00) goes in a separate demo seed.
- Faculty views expose metadata only. Enforce with RLS + `security_invoker` views; the AI layer queries as the requesting user, never with service_role.
- Never touch the Supabase project "Teron" or any project other than this one. Never delete the paused Tokyo project.
- Secrets: never commit `*.env`; never print secret values. Never read values from `atlas-credentials.env` into chat.
- No Teron/Metacognisync code or branding.

## Local
- Local plain PG17 `elp-pg17` (port 54329, password `localdev`) is only for `experiments/race/rr_trigger_check.sh`; stop it while the local Supabase stack runs. Fixture regressions use throwaway containers (`scripts/test_fixture.sh`, `scripts/test_mongo_fixture.sh`); the race lab is `elp-race-pg` (port 55433, `experiments/race/setup.sh`); local Mongo is `elp-mongo-local` (`scripts/mongo_local.sh`).
- Python via `uv` (3.12), Node 24. Tools via npx: `npx supabase`, `npx -y mongosh@2.14.1` (2.14.2 is broken), `npx vercel`. Always set `MONGO_TARGET=local` for local API/worker/tests (it defaults to Atlas).

## Cloud
- Supabase: org "dbms lab" (mzbudtauwftenatrsuyy), project `countersign-dbms`, ref `oowtsesgkhhbojjmmlgk`, ap-south-1, PG 17.11.
  Secrets in `supabase/.env` (SUPABASE_ACCESS_TOKEN, SUPABASE_DB_PASSWORD, SUPABASE_PROJECT_REF) — git-ignored.
  Apply: `set -a; . supabase/.env; set +a; npx supabase db push --remote --yes`. Ad-hoc SQL: Management API `POST /v1/projects/$REF/database/query`.
  The claude.ai Supabase MCP is NOT authorized for this org — use the CLI/API with the token instead (and never touch Teron).
- MongoDB Atlas: MongoDB 8.0, database `elp`, URI in `atlas-credentials.env` (atlasAdmin user — setup only, never in app env).
  `mongo/seed.js` is for local/throwaway Mongo ONLY: it drops `notes`, `github_events`, `portfolios` and their validators. Never run it on Atlas. On Atlas run only `mongo/validators.js` and `mongo/portfolio_merge.js` (idempotent); see docs/RUNBOOK.md §5.3.
