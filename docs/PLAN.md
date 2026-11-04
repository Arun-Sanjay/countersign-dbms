# Plan — DBMS EL Platform (CD252IA): sharpened idea, upgrades, build plan, access checklist

## Context
`PROJECT_MASTER.md` is the source of truth (vision, 13-table schema, seed, 37 SQL + 25 Mongo verified queries, rubric, open items). Synopsis + Component 4 (Test) are done; **no application code exists**. Arun asked for: a full plan using the whole master file, an improved idea, the biggest problems (idea + design), the best upgrades, and an exact list of what to hand over (esp. MongoDB) so Claude can run the project end-to-end.

This plan merges 6 independent critiques (idea, grading, schema, architecture, privacy, demo) + a synthesis + a skeptic pass.
Constraints from Arun: **new Supabase project in Mumbai**, **2+ months runway**, **Arun builds with Claude; Sanvid does docs/diagrams/testing**, **AI budget < $10**.

Facts found in this session:
- Repo dir only has `PROJECT_MASTER.md` + `atlas-credentials.env` (no `.gitignore`, not a git repo). The `dbms_test/*.sql`, Synopsis DOCX etc. listed in §10 are **not in the folder**.
- The Test's Supabase project ("Arun-Sanjay's Project", Tokyo) is **paused**. Only **Teron** is active, and the Supabase MCP can reach Teron and all 17 projects. That's a risk.
- Local: node 24, uv, docker, gh, git. **Missing:** supabase CLI, mongosh, atlas CLI, vercel CLI; python3 is 3.9 (use `uv python install 3.12`).

---

## 1. The idea: what to change

**Sharpened thesis.** "Every mark has a receipt." Today a faculty member signs the paper lab sheet ("Signature of Lab Faculty") on trust. The platform makes **the rubric the schema**:
- every component cell links to student **claims**;
- each claim is backed by **evidence rows** (commits, document/note versions, files);
- **teammates countersign** each claim;
- the student **defends it in a viva generated from their own claimed work**.

Everything else hangs off trustworthy contribution rows: the semester hub, skill graph, permission-aware RAG and portfolio.
- Pitch: *"We don't detect AI. We make every mark traceable and every claim defensible."*
- Meta hook: the evaluators grade this very project on that sheet, and the platform normalizes the sheet to BCNF and rebuilds it as live tables.
- Keep the official long title on RVCE documents. Use a short product name only, e.g. **Countersign** / Attest / Provenance (check for name collisions).

**Problems with the idea itself (ranked):**
1. **No single thesis.** 8 equal pillars plus 10 extras reads as "a dashboard with AI". Re-tier the features (none are deleted):
   - **Core:** rubric view, claims + evidence + countersign, viva practice, RLS privacy.
   - **Supporting:** evidence-derived skills, teammate finder, RAG, semester hub, portfolio.
   - **Stretch (Phase 5):** live co-editing, cross-course LLM synthesis, genealogy, work signature, LOR, recruiter, catch-up brief.
2. **"Contribution computed from commits" is gameable and spoofable.** Git author email is self-asserted, line counts reward commit spam, and pair programming, whiteboard ER work and hardware (ADLD) leave no commits.
   - The **claim** becomes the unit of contribution; commits and versions are *evidence*.
   - Identity is bound through GitHub OAuth (Supabase Auth GitHub provider → `auth.identities`), not the commit email.
   - No leaderboards for faculty.
3. **The problem statement implies AI-work detection.** That is unreliable and biased against non-native writers, and you build with Claude Code yourselves.
   - Make detection an explicit SRS non-goal.
   - Replace it with a declared `ai_assistance` per claim, neutral version history, and a **student-facing viva practice**.
   - Faculty must NOT see "AI-assisted plus low viva score", or students stop declaring.
4. **"All real work happens in the platform" is false.** Reports live in Docs/Word, diagrams in draw.io, chat in WhatsApp.
   - The mandatory touchpoint becomes the **milestone submission + per-component claims**.
   - GitHub, Obsidian and the editor become optional evidence sources, plus URL/file evidence (a Docs revision link, a draw.io export).
5. **"Evidence-derived skills" is self-declared in the actual schema.** `student_skill.level` is hand-seeded.
   - Add `skill_evidence` and a materialized *verified* level next to the *declared* level ("Declared 4 · Verified 2").
6. **No named competitors.** Add a comparison table to the SRS and Midterm covering GitHub Classroom, GitHub Insights, Google Classroom/Moodle, CATME, WebPA and this project.
7. **The privacy model contradicts itself and slides into surveillance.**
   - "Faculty see metadata only" breaks grading of submitted work. Use 3 tiers: `private | team | submitted`.
   - Rename "ghost member" in the product to **"no recorded evidence yet"**. It opens the claim flow; it is never a verdict.
   - Add a "what my faculty sees" preview page.
   - DPDP Act 2023: add a consent ledger for non-grading uses, and make erasure a procedure, not a cascade.
8. **Weak pillars:**
   - The DIVISION teammate finder returns *clones* of you. Use **StudentSkill ÷ (Required(P) − MySkills)** to find *complements*.
   - Cross-course synthesis has no data behind it. Add a `course_skill` table and do it as a pure-SQL INTERSECT first, with LLM suggestions later.
   - Questions SQL already answers go to whitelisted SQL templates that show their SQL, not to the LLM.

## 2. Problems in design, schema and architecture (ranked)
1. **No assessment model.** Nothing stores components, submissions or marks, so the normalization of the marks sheet (C6) ends in tables that don't exist.
   - Add `submission`, `submission_artifact` and `assessment` at **component grain** (`usn, project, milestone_no, marks, assessed_by`), as the paper sheet does.
   - Criterion scores become an optional child table.
   - View `lab_cie_marks` computes 120→30 + 10 + 10 = 50; it is derived, never stored, and needs the rounding rule confirmed.
2. **Security isn't real yet:**
   - RLS is off.
   - Views run as owner (definer), so they bypass RLS.
   - A service-role backend bypasses RLS, which breaks "the AI only sees what you may see".
   - Realtime `postgres_changes` would leak content.
   - There is no `auth.users` → usn mapping.
   - The secrets file has no `.gitignore`.

   Fixes:
   - RLS default-deny on every table.
   - An `app_user` mapping table, plus helper functions (`current_usn()`, `is_team_member()`, `teaches_project()`).
   - `security_invoker` views and a `private` schema for notes.
   - RAG runs as the requesting user.
   - Realtime via `realtime.broadcast_changes()` with metadata-only payloads, plus RLS on `realtime.messages`.
3. **Integrity holes an examiner can INSERT live:**
   - a student can join 2 teams of the same project;
   - a T03 artifact can be filed under a P01 milestone;
   - a contributor or chunk author need not be a team member;
   - the capacity trigger only fires on INSERT (UPDATE bypasses it).

   Fixes:
   - Triggers for one-team-per-project and membership-required.
   - Capacity check on `INSERT OR UPDATE`.
   - `UNIQUE(team_id, project_id)` plus a composite FK on artifact, documented in C6 as a *deliberate, justified* denormalization.
   - A **constraint-violation gallery**: one failing INSERT per rule.
   - Do NOT add `team_member.project_id`; it would be a second 3NF violation.
4. **The capacity trigger likely over-admits under REPEATABLE READ.** The snapshot is taken before the lock wait, and the team row is locked but never updated, so no 40001 is raised. The Q37 pattern has the same flaw.
   - Verify on day 1. If it reproduces, it is the **headline finding of the Innovative Experiment**.
   - Fix the terminology in the docs: "lost update" should be *write skew / phantom*; "shared locks for dashboard reads" is wrong under MVCC.
5. **Contribution model is test-grade, not ingest-grade.** It has `DATE` columns, hand-typed IDs, no idempotency key (so GitHub redeliveries duplicate rows), no version entity, and Mongo M3 overwrites notes in place.
   - Use `timestamptz` and identity IDs.
   - Add `source`, `source_ref` and `UNIQUE(...)` with `ON CONFLICT DO NOTHING`.
   - Add a weak entity `artifact_version`, and an immutable Mongo `note_versions` collection.
6. **No term, offering or enrollment.** `student.semester` goes stale, `course.faculty_id` means one teacher forever, and FR3 can't be computed for students without a team.
   - Add `academic_term`, `course_offering` and `enrollment`.
   - This also gives the textbook 3NF-not-BCNF example for C6.
7. **Delete semantics destroy the "permanent record".** Deleting a course cascades to contributions.
   - Write an FK-action matrix: CASCADE only for existence-dependent rows, RESTRICT for history, plus soft delete.
8. **No consistency contract between Mongo and Postgres** (a dual write).
   - Use **inbox → log → projection**:
     1. The webhook calls one Postgres RPC `ingest_receive()` that inserts into `ingest_event` and `pgmq.send` in one transaction.
     2. A worker upserts the raw event into Mongo (`_id = delivery_id`).
     3. The worker projects it into Postgres with `ON CONFLICT`.
   - A consistency page diffs counts between the two databases.
   - Also fix the §9.3 explanation of M5: `$unwind` drops N05 because Rahul has no portfolio.
9. **The risky integrations come first in §11.3 but earn the fewest marks** (GitHub App, Hocuspocus, Obsidian, RAG). Reorder the build so the database-driven product is demoable first.
   - Each integration gets a replay/fixture fallback.
   - Hocuspocus moves to stretch; the default editor uses versioned saves with optimistic locking.
   - **Drop the GitHub App.** Use a plain repo webhook plus GitHub OAuth for identity.
10. **Infrastructure:**
   - Supabase free plan: 500 MB limit, projects pause when idle, the session pooler caps clients (~15).
   - Atlas M0: no MapReduce (it is deprecated), and change streams are limited.
   - Free hosts sleep.

   Fixes:
   - Run the big experiment matrix and the EXPLAIN bench on **local Docker PG17**; keep the cloud bench to about 300k rows.
   - Show MapReduce as an aggregation pipeline.
   - Keep-alive cron.

**Grade guardrail.** `02_seed.sql` is frozen as `fixture_v1`, and CI re-runs Q1–Q37 and M1–M25 against Appendix H outputs. New real data goes in `02b_demo_seed.sql`, never inside fixture P01:
- a new project **P06 "CD252IA Lab 2026-27"** with 11 milestones, where milestone_no = component number;
- team T00 (Arun + Sanvid);
- Sanvid added as a student;
- synthetic `@example.edu` auth emails.

## 3. Best upgrades (tiered: MUST ≤ 5)
| # | Upgrade | Tier | Wins |
|---|---|---|---|
| 1 | Sharpened thesis, comparison table, non-goals, FR→table→query traceability | MUST | C2, C7, C9 |
| 2 | **Assessment layer**:<br>• `submit_milestone()` as one plpgsql transaction (freeze versions, audit, SAVEPOINT demo)<br>• `locked_at`<br>• marks ≤ max trigger<br>• `lab_cie_marks`<br>• faculty grid that looks like the paper sheet; each cell opens claims → evidence → countersign | MUST | C6, C8, C9, C11 |
| 3 | **Claims + evidence + countersign**, exactly 3 tables:<br>• `claim`<br>• `claim_evidence` (weak entity)<br>• `countersign` (trigger: the endorser must be a teammate and not the claimant; a cross-table rule a CHECK can't express)<br>• `contested_claims` view as the faculty queue | MUST | C3 (real ternary + 2nd weak entity), C8, C9 |
| 4 | **C8 security pack**:<br>• RLS via `app_user`<br>• security_invoker views<br>• `private.note`<br>• pgTAP RLS matrix (persona × table × expected rows, green/red grid)<br>• Supabase advisors at zero<br>• 3-layer validation (zod → Pydantic → CHECK)<br>• `constraint_message` friendly errors<br>• Mongo `$jsonSchema`<br>• forms catalogue doc<br>• live "try to break it" segment | MUST | C8 entirely |
| 5 | **Innovative Experiment v2**: "declarative vs procedural integrity under concurrency"<br>• Strategies: S1 naive, S2 current trigger, S3 conditional `UPDATE … WHERE count<max`, S4 SERIALIZABLE + retry, S6 `team_seat` UNIQUE<br>• Each strategy × RC/RR/SER × N = 2/8/32/100 async clients behind a barrier (local Docker)<br>• Results persisted in `experiment_run/attempt/schedule_log`<br>• **Recursive CTE builds the precedence graph and detects cycles** (labelled "logical client-recorded schedule")<br>• Live `pg_locks` ⋈ `pg_blocking_pids()` panel and a "Race Arena" page | MUST | C10 (unreduced 10), Unit IV |
| 6 | Normalization dossier:<br>• marks sheet UNF→BCNF in depth (FDs, minimal cover, chase-tableau lossless proof, dependency preservation)<br>• a per-table FD/key table for *every* final table<br>• ENROLLMENT 3NF-not-BCNF case | SHOULD (Sanvid) | C6, C7 |
| 7 | Fat DB, thin API:<br>• logic in SECURITY INVOKER RPCs (`join_team`, `submit_milestone`, `find_teammates`, `skill_gap`, `skill_subtree`, `search_chunks`)<br>• **Show-the-SQL drawer** (static registry: SQL + relational algebra + RLS policies applied)<br>• EXPLAIN before/after an index on the bench data | SHOULD | C9, Unit III |
| 8 | Evidence-derived skills:<br>• `skill_evidence`<br>• MV with REFRESH CONCURRENTLY<br>• WITH RECURSIVE skill rollup<br>• `project_skill.min_level`<br>• `course_skill` INTERSECT<br>• complementary teammate finder | SHOULD | C9, Unit II RA |
| 9 | Ingestion + **dogfooding**:<br>• repo webhook → Edge Function → `ingest_receive` RPC → pgmq → worker → Mongo log → Postgres projection<br>• replay fixtures<br>• consistency page<br>• run *your own repo* through it: you and Sanvid file real C1–C11 claims, `Co-Authored-By: Claude` trailers set `ai_assisted`, and you countersign each other | SHOULD | C9, C11, Unit V, makes the meta hook literal |
| 10 | Permission-aware assistant:<br>• SQL-template intents<br>• `search_chunks()` = RRF over `ts_rank` + HNSW in one SQL statement, with Claude citations mapped to chunk_id and a server check that cited ⊆ retrieved<br>• `ai_query_log`<br>• demo: same question as Arun / Sanvid / faculty gives 3 different row sets<br>• viva practice built from confirmed claims<br>• prompt-injection test notes | SHOULD | C9, C11 |
| 11 | Trust ledger:<br>• hash-chained `audit_log` (pgcrypto, verified in one LAG query; demo: tamper with a mark → verify shows the break)<br>• consent records<br>• "what my faculty sees" preview | SHOULD | C8, C11 |
| 12 | Stretch:<br>• Yjs co-editing<br>• genealogy (pgvector kNN over past abstracts)<br>• LLM cross-course suggestions<br>• work signature (student-only)<br>• local sharded/replica-set Mongo lab for Unit V<br>• time-travel membership | STRETCH | extra |

**Ownership for the viva.** Even if Arun builds most of it, Sanvid must own at least one graded database object end to end, e.g. **RLS policies + Mongo validators + experiment analysis**, besides ER, DFD, normalization and reports. Both of you should be able to hand-write the core SQL.

## 4. Revised data model (summary)
- **Keep all 13 tables.** Changes are append-only columns and constraints, so Q1–Q37 still run on the frozen fixture.
- **C3 core ER (≤ 20 entities):** the 13 existing tables plus `academic_term`, `course_offering`, `enrollment`, `app_user`, `artifact_version`, `submission`, `assessment`, `claim`, `claim_evidence`, `countersign`.
- **Physical-schema appendix (kept out of the ER):** `ingest_event`, `team_repo`, `skill_evidence`, `course_skill`, `private.note`, `audit_log`, `consent_record`, `constraint_message`, `ai_query_log`, `viva_*`, `experiment_*`, `team_seat`, `bench.*`.
- **`artifact_chunk`:** add `embedding vector(1024)`, `embedding_model`, `content_hash`, `tsv` GENERATED, GIN + HNSW indexes, `visibility`.
- **Mongo database `elp`:**
  - `github_events`: immutable, `_id = delivery_id`, shard-key-ready `{college_id, team_id}`.
  - `notes`: the current shape, so M1–M5 still pass; add `artifact_id`, `visibility`.
  - `note_versions` / `doc_versions`: immutable.
  - `portfolios`: built by `$merge`, stamped `generated_at`, covers all students.
  - `presence`: TTL.
  - All collections get `$jsonSchema` validators and indexes.

## 5. Architecture decisions
- **Stays:** Supabase Postgres 17 + pgvector, MongoDB Atlas, FastAPI, React + TS + Tailwind (Vite), Claude, Voyage, no LangChain, no separate vector DB.
- **Changes:**
  - **Fat DB / thin API.** CRUD goes through supabase-js under RLS.
  - FastAPI shrinks to: the pgmq worker, Mongo endpoints, `/rag/ask`, and the experiment runner.
  - The webhook inbox is a **Supabase Edge Function** (never asleep).
- **Hosting at ≤ $10:**
  - Web and FastAPI both on **Vercel** (Python functions don't sleep).
  - The worker is triggered by `pg_cron` + `pg_net`.
  - Atlas M0 on AWS Mumbai.
  - A `docker-compose` local stack (`supabase start` + `mongo:8`) as the offline plan B.
  - GitHub Actions for CI and a keep-alive cron.
- **AI at < $10:**
  - Haiku for tagging; Sonnet only for final answers and viva questions.
  - Embed once with **voyage-4 at 1024 dims**, cache the vectors to CSV and store `embedding_model`.
  - Fallback chain: cached answers → FTS-only.
  - Confirm current model IDs at build time.

## 6. Phased build (each phase ends in a tagged, demoable release)
Re-map these windows once you give the real component dates.
| Phase | Window | Deliverable | Feeds |
|---|---|---|---|
| **P0 Foundation** | wk 1–2 | • `.gitignore` → git repo → CLAUDE.md<br>• Supabase project (Mumbai)<br>• migrations 0001 (Appendix A, RLS on) + 0002 (app-ready)<br>• fixture + demo seeds; CI regression of the 62 queries<br>• Atlas `elp` seeded with validators<br>• **RR trigger test on local PG17**<br>• ER v2 + 7-step mapping table | C2, C3 |
| **P1 Security + forms** | wk 3–4 | • auth personas + "Login as" switcher<br>• RLS helpers/policies, `private.note`, RPCs<br>• React forms with SQLSTATE→field errors<br>• pgTAP RLS matrix + constraint gallery<br>• deployed to Vercel | C8, C5 DFD, C6 |
| **P2 Core product + experiment** | wk 5–6 | • rubric sheet, `submit_milestone`, claims/countersign, `lab_cie_marks`<br>• semester hub, teammate finder, skill gap/tree<br>• Show-the-SQL drawer, Realtime broadcast<br>• **Race Arena + harness**, bench + EXPLAIN | C7, C10 |
| **P3 Ingestion** | wk 7 | • fixtures/replay first, then the live webhook pipeline<br>• Obsidian `shared/**` markdown<br>• consistency page; dogfooding on | C9 |
| **P4 Intelligence** | wk 8 | • chunk + embed, `search_chunks`, `/rag/ask` with citations<br>• viva practice, skill_evidence MV<br>• portfolio `$merge` + export<br>• audit chain, consent | C9 |
| **P5 Polish + stretch** | wk 9+ | • stretch items, `reset_demo()`, `/health`<br>• recorded MP4 of every live moment, pre-flight checklist<br>• final report | C11 |

**Repo layout:**
- `supabase/` (migrations, seed/fixture_v1, seed/demo, tests/pgTAP, functions/)
- `mongo/` (seed, validators, queries)
- `api/` (FastAPI)
- `web/` (Vite)
- `experiments/race/`
- `bench/`
- `docs/` (SRS, ER, DFD, normalization, forms catalogue, reports)
- `scripts/` (backup `pg_dump`/`mongodump`, replay, reset)

**12-minute demo arc:**
1. Hold up the paper sheet.
2. Rubric grid → claims → evidence → countersign.
3. Live commit → faculty toast; follow the Postgres row ↔ Mongo document link.
4. Assistant with citations, then a permission-denied moment.
5. **Race Arena**, with the RR over-admission as the headline.
6. EXPLAIN before/after an index.
7. Sheet normalized to BCNF → live tables.
8. Viva practice.
9. Teammate finder and skills.
10. Evaluator enters marks; audit-chain verify.

## 7. Verification
- CI: fixture outputs diffed against Appendix H for Q1–Q37 and M1–M25.
- pgTAP: RLS matrix and constraint gallery (`npx supabase test db`).
- Supabase `get_advisors`: security and performance at zero.
- Experiment: 1,000 trials per cell, results stored and charted.
- End-to-end: replayed webhook → Mongo doc → Postgres rows → dashboard toast.
- RAG: permission test across 3 personas, and the prompt-injection set.
- Before each milestone: `pg_dump` + `mongodump`, and a full run-through of the demo checklist.

---

## 8. What I need from you (complete checklist)

### MongoDB Atlas (most important)
1. **Tell me (don't make me read it from the env file):** cluster tier (M0?), cloud + region (ideally AWS Mumbai), cluster name, and the role of the existing DB user (if it's `atlasAdmin`, it stays out of app env files).
2. **Ideally a dedicated Atlas project for this work.** Send its **Org ID** and **Project ID** (Atlas UI → Project Settings).
3. **Programmatic access for me.** Organization → Access Manager → **Service Accounts** → create one. Then:
   - give it **Project Owner on this project only**;
   - send the **Client ID + Client Secret**;
   - add my IP to its API access list (or tell me if the org doesn't require one).

   This lets me manage users, network access, indexes and validators via `atlas` CLI and the MongoDB MCP.
4. **Database users.** Either let me create them with the service account, or create them yourself:
   - `elp_app`: `readWrite@elp` only, used by the app;
   - `elp_admin`: `readWrite@elp` + `dbAdmin@elp`, for migrations, validators and indexes.
5. **Network Access.** Add your current IP. Then decide: `0.0.0.0/0` with strong users (needed for Vercel/Edge Functions, which have no static IP) or an IP list. Also test from the college Wi-Fi or your hotspot.
6. **Connection strings.** The SRV URI, plus the **standard non-SRV string** as a fallback (college networks often block SRV DNS).
7. **Approvals:**
   - I use `npx mongosh` and `npx -y mongodb-mcp-server`, so no brew install is needed;
   - optionally `brew install mongodb-atlas-cli`;
   - optionally add the MongoDB MCP server to your Claude config;
   - optionally enable M0 backups/snapshots if available.
   - Note: the Atlas Data API has reached end of life, so I won't use it.

### Supabase
1. **Approval to create the new project** (`countersign-dbms`, region ap-south-1). Recommended: create it in a **new free organization** so Teron is isolated and Sanvid can join without seeing your other projects. Tokyo stays paused and is never deleted.
2. **Scope the Supabase MCP** to the new project. Add `?project_ref=<new-ref>` to its URL; only you can edit the MCP config.
3. **DB password.** Set or reset it in the dashboard (the MCP can't return one). Send the **pooler connection strings**: session (port 5432) and transaction (port 6543).
4. **The secret / service_role key**, for `api/.env` only. I can fetch the publishable key myself.
5. **Personal Access Token** (Account → Access Tokens) as `SUPABASE_ACCESS_TOKEN`, or run `! npx supabase login` yourself. That's all I need for the CLI.
6. Whether the project uses **asymmetric JWT signing keys**, so I can verify against the JWKS endpoint. Otherwise I need the legacy JWT secret.

### GitHub
1. Repo owner (personal account or a new org) and visibility (private recommended).
2. Run `! gh auth refresh -s repo,workflow,admin:repo_hook`.
3. Sanvid's GitHub username and the commit emails for both of you. The emails must be verified on GitHub.
4. A **GitHub OAuth App** client ID + secret, for Supabase Auth GitHub login and identity binding. There is no GitHub App.
5. Turn on secret scanning and push protection.

### AI and hosting
1. `ANTHROPIC_API_KEY` with a spend cap of about $8.
2. `VOYAGE_API_KEY`, plus your free-tier token allowance from the Voyage dashboard.
3. Vercel: run `! npx vercel login`, or give me a `VERCEL_TOKEN`.
4. Approve `uv python install 3.12` and keeping Docker Desktop running.

### College and course details
1. Real dates for C2, C3 and C5–C11.
2. The lab-manual sub-rubrics for C5–C11.
3. A **scan/photo of the actual marks sheet**.
4. The RVCE report templates, and copy the existing files into the repo: the Synopsis DOCX/PDF and the `dbms_test/*.sql` files.
5. The required ER notation.
6. The 120→30 rounding rule.
7. Whether marks are per student or per team.
8. Whether AI-tool use must be declared, and whether the demo must run on the cloud.
9. Whether `@rvce.edu.in` is on Google Workspace.
10. Demo setup: projectors, Wi-Fi.
11. Sanvid's section, email and **consent to dogfood real data**.

### Security, today
Confirm `atlas-credentials.env` has never been shared or committed. If it has, rotate the Atlas password. I'll add `.gitignore` (`*.env`, `*.env.*`, `!*.env.example`) **before** `git init`, and move the secrets to `api/.env`.

## 9. Decisions you still own (defaults I'll use if you don't answer)
- **Product name:** default Countersign, as the product name only.
- **Re-tiering:** default as in §1.
- **Mark grain:** default per student, at component grain.
- **Dogfood with real data and honest `ai_assistance`:** default yes.
- **Private vault:** default stored in-platform (`private.note`).
- **Innovative Experiment scope:** default concurrency only; the audit ledger goes into C8/C11.
