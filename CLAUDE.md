# CLAUDE.md — DBMS EL Platform (CD252IA, RVCE)

Source of truth: `PROJECT_MASTER.md` (vision, schema, seed, verified queries, rubric). Approved plan: `docs/PLAN.md`.

## Hard rules
- PostgreSQL syntax only (Supabase, PG17). Vectors stay in pgvector; no separate vector DB; no LangChain. Retrieval is explicit SQL.
- MongoDB stays a real component (raw events, notes + immutable versions, portfolios).
- `supabase/fixture/` (01_schema, 02_seed, 03_queries) and `mongo/04_mongo.js` are the **frozen graded Test fixture**. Never edit them; Q1–Q37 / M1–M25 outputs must keep matching Appendix H. New schema changes go in migrations as append-only columns/constraints; new real data (P06, T00, Sanvid) goes in a separate demo seed.
- Faculty views expose metadata only. Enforce with RLS + `security_invoker` views; the AI layer queries as the requesting user, never with service_role.
- Never touch the Supabase project "Teron" or any project other than this one. Never delete the paused Tokyo project.
- Secrets: never commit `*.env`; never print secret values. Never read values from `atlas-credentials.env` into chat.
- No Teron/Metacognisync code or branding.

## Local
- Local PG17: `docker start elp-pg17` (port 54329, password `localdev`). Race check: `experiments/race/rr_trigger_check.sh`.
- Python via `uv` (3.12), Node 24. Tools via npx: `npx supabase`, `npx mongosh`, `npx vercel`.

## Cloud
- Supabase: org "dbms lab" (mzbudtauwftenatrsuyy), project `countersign-dbms`, ref `oowtsesgkhhbojjmmlgk`, ap-south-1, PG 17.11.
  Secrets in `supabase/.env` (SUPABASE_ACCESS_TOKEN, SUPABASE_DB_PASSWORD, SUPABASE_PROJECT_REF) — git-ignored.
  Apply: `set -a; . supabase/.env; set +a; npx supabase db push --remote --yes`. Ad-hoc SQL: Management API `POST /v1/projects/$REF/database/query`.
  The claude.ai Supabase MCP is NOT authorized for this org — use the CLI/API with the token instead (and never touch Teron).
- MongoDB Atlas: MongoDB 8.0, database `elp`, URI in `atlas-credentials.env` (atlasAdmin user — setup only, never in app env).
  Seed: `npx mongosh "$MONGODB_URI" --quiet < mongo/seed.js`.
