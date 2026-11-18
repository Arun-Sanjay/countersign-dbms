# Prototype execution plan (autonomous, test-gated)

Goal: a **working basic prototype** of Countersign: the database-driven core running on the live
Supabase project and MongoDB Atlas, with a React web app that can be logged into as student,
faculty or admin personas. Every stage is tested before it is pushed. Built autonomously; Arun is
pinged only where a step needs his browser or accounts.

Out of prototype scope (later phases from `docs/PLAN.md`):
- GitHub webhook ingestion (built later)
- RAG and embeddings (search built later; embeddings not in use)
- viva engine
- Yjs co-editing
- Race Arena UI (the race *finding* already exists; the page `/race` was built later)
- deployment hardening

## 0. Ground rules
- The graded fixture (`supabase/fixture/*`, `mongo/04_mongo.js`) is frozen. Its regression must stay green.
- The migrations are append-only. Remote pushes happen only after the local Supabase stack passes all tests.
- Secrets live only in git-ignored `*.env` files.
- Commits use Arun's identity with no co-author trailer, one per completed stage, pushed immediately.

## 1. Database layer (migrations)

### `0002_app_core`: entities
| Area | Objects |
|---|---|
| Identity | `app_user(user_id → auth.users, role student\|faculty\|admin, usn?, faculty_id?)` with a role-consistency CHECK |
| Term | `academic_term`, `course_offering(course_code, term_id, section, faculty_id)`, `enrollment(usn, offering_id)`; `project.offering_id` |
| Team | `UNIQUE(team_id, project_id)`; `topic_title`, `abstract` |
| Artifact | composite FK `(team_id, project_id) → team`; `visibility private\|team\|submitted`; `owner_usn`; `external_ref` |
| Versions | weak entity `artifact_version(artifact_id, version_no, created_by, content_hash, mongo_ref, ai_assistance)` |
| Contribution | identity default; `source`, `source_ref`, `occurred_at timestamptz`, `ai_assisted`; partial UNIQUE idempotency key |
| Assessment | `milestone.counts_in_reduced`, `milestone.locked_at`; `submission`, `submission_artifact`, `assessment(usn, project_id, milestone_no, marks, assessed_by …)` at component grain |
| Claims | `claim`, weak `claim_evidence`, `countersign` |
| Skills | `skill_evidence`, `course_skill`, `project_skill.min_level` |
| Privacy | `private.note` (schema not exposed through the API) |
| FK actions | history moves to RESTRICT (contribution.usn, artifact_chunk.author_usn, course→project) |

### Integrity triggers (each one gets a failing test in the constraint gallery)
- **Team capacity v2: "serialize by writing the parent row".** `UPDATE team SET max_size = max_size … RETURNING` and then count. Under REPEATABLE READ the concurrent writer gets 40001 instead of over-admitting. Fires on `INSERT OR UPDATE OF team_id`.
- One team per project per student, using the same write-lock on the `student` row.
- A contributor, claimant, chunk author or assessed student must be a member of the team.
- `assessment.marks ≤ milestone.max_marks`, and no edits once `locked_at` is set.
- A countersigner must be a teammate of the claimant and not the claimant. A dispute sets the claim to *contested*; a confirm with no dispute sets it to *confirmed*.

### `0003_security`: row-level security
- **Helpers:** `current_usn()`, `current_faculty_id()`, `is_admin()`, `is_team_member()`, `teaches_project()`. All are `SECURITY DEFINER` with `search_path = ''`.
- **Policies per role:**
  - **Directory tables:** readable by any authenticated user.
  - **Team content:** students see their own team's content and never another student's `private` items.
  - **Faculty:** see metadata and *submitted* content only for the projects they teach.
  - **Marks:** written by faculty only; a student reads only their own marks.
  - **Private notes:** owner only.
- **Views**, all `security_invoker`:
  - `v_lab_cie_marks`: 120 raw → 30, plus 10, plus 10, giving 50.
  - `v_rubric_sheet`
  - `v_contested_claims`
  - `v_faculty_team_progress`
  - `v_semester_hub`
  - `v_what_faculty_sees`

### `0004_rpc`: functions (SECURITY INVOKER, returning JSON)
- **Team:** `join_team`, `leave_team`
- **Submission:** `submit_milestone`
- **Claims:** `file_claim`, `add_claim_evidence`, `countersign_claim`
- **Marks:** `record_assessment`
- **Skills:** `find_teammates` (complementary: StudentSkill ÷ (Required − Mine), ranked by partial coverage), `skill_gap`, `skill_subtree` (recursive CTE)
- **Hub:** `semester_hub`

### Demo seed: `supabase/seed/demo.sql` (never touches fixture rows)
- **Students:** none added; the fixture's 12 students (S Arun Sanjay is the only real one) are used.
- **Term and courses:** term `2026-ODD`, with offerings and enrollments.
- **Project:** **P06 "CD252IA Lab 2026-27"** with 11 milestones (milestone_no = component number; C10 and C11 have `counts_in_reduced = false`).
- **Team:** **T00 "Countersign"**: Arun (lead), a solo team.
- **Claims and marks:**
  - real claims and evidence for C1 (Synopsis), C3 (ER diagram v2) and C4 (Test); T00 is solo, so they stay pending (no teammate to countersign) and rest on their evidence and the faculty review;
  - on the seeded team T06: one contested claim, confirmed claims, and one pending C4 claim by 1RV24CY011 waiting for Meera's countersign;
  - sample marks for C1 and C4.
- **Personas:** created by `scripts/create_personas.py` through the Auth Admin API, using the service key fetched with the access token. Emails are `@example.edu`:
  - arun, nikhil (has no team), meera (the teammate countersign persona, T06);
  - ramesh, faculty F01 (teaches CD252IA);
  - admin.

## 2. Test gates (all must pass before the remote push)
| Gate | How |
|---|---|
| G1 Fixture regression | `scripts/test_fixture.sh`: a fresh plain PG17 container runs 01/02/03; Q1–Q37 outputs are diffed against master Appendix H. Mongo: `04_mongo.js` runs on a local `mongo:8` container with key results spot-checked |
| G2 Migrations | Local Supabase stack (`npx supabase start` / `db reset`) applies 0001–0004, the fixture seed and the demo seed cleanly |
| G3 Security | pgTAP `supabase/tests/*.sql`: RLS matrix (persona × table × expected visibility), private notes invisible to faculty and teammates, anon sees nothing |
| G4 Constraint gallery | pgTAP: every rule's violating statement raises the expected error |
| G5 Concurrency | `experiments/race/` script against the local stack: capacity v2 never exceeds max_size under RC, RR or SERIALIZABLE |
| G6 RPCs | pgTAP: happy path plus permission-denied path for each RPC |
| G7 Advisors | Supabase security/performance lints on the remote project: no errors |
| G8 Web | `tsc`, lint and `vite build` clean; Playwright smoke test logs in as each persona and walks each core flow |
| G9 Review | Independent adversarial reviewers (schema/normalization, RLS/security, concurrency, Supabase correctness, fixture compatibility); confirmed findings are fixed and gates re-run |

## 3. Application layer
- **`web/`**: Vite, React, TypeScript, Tailwind, supabase-js, react-router, zod, react-hook-form.
  - Pages:
    - login with persona switcher;
    - student hub;
    - team (join, teammate finder, skill gap, skill tree);
    - project (milestones, artifacts, claims with evidence, countersign queue, submit);
    - private notes and "what my faculty sees";
    - faculty rubric sheet (looks like the paper sheet, marks entry, cell drawer → claims → evidence → countersigns);
    - contested queue;
    - `lab_cie_marks`.
  - **Show-the-SQL drawer** on every data panel: a static registry of SQL, relational algebra and the policies applied.
  - Forms: zod rules mirror the DB CHECKs, and SQLSTATE errors map to field errors.
- **`api/`** (FastAPI, uv, Python 3.12, minimal):
  - verifies the Supabase JWT;
  - `GET /notes?team_id` reads Mongo `elp.notes`, after checking membership through Postgres *as the user*;
  - `GET /consistency` compares per-team counts between Mongo and Postgres;
  - `GET /health`.
- **Mongo**: `$jsonSchema` validators plus the immutable `note_versions` collection. M1–M25 must still pass.

## 4. Execution order (workflows)
1. **DB workflow:**
   - author the migrations and seed, and build the fixture-regression harness, in parallel;
   - adversarial review panel;
   - fix and re-test;
   - then push to the remote, create personas, run advisors, commit.
2. **App workflow:**
   - web and api built in parallel against the live DB;
   - Playwright e2e tester;
   - fix loop;
   - commit.
3. Final report with run instructions and remaining gaps.

## 5. Where Arun is needed (ping points)
- Deploying the web app to Vercel needs `npx vercel login` (browser). The prototype runs locally until then.
- A limited Atlas user for production (Atlas UI or a Service Account). The prototype uses the admin URI locally only.
- Anthropic and Voyage keys: not needed for the prototype (RAG is a later phase).
