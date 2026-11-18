# MASTER FILE — Unified Experiential Learning and Project Intelligence Platform

> **For the coding agent (Claude Code):** this file is the single source of truth for this project. It contains every decision, the full database schema, sample data, all tested SQL and MongoDB queries, the course requirements it must satisfy, and what is still to be built. Read it fully before writing code. Sections marked **[DECIDED]** are settled; **[PROPOSED]** are recommendations not yet confirmed by the author; **[OPEN]** need a decision.

---

## 0. Quick facts

| Item | Value |
|---|---|
| **Project title** | Unified Experiential Learning and Project Intelligence Platform (short: *Unified Experiential Learning Platform*) — descriptive working title; the author may rename it |
| **Course** | Database Management Systems (CD252IA), Semester V, RV College of Engineering (RVCE), Bengaluru — Dept. of CSE |
| **Course format** | Theory + Lab. Credits L:T:P = 3:0:1. 45L + 30P hours. CIE 100+50, SEE 100+50 |
| **Team** | S Arun Sanjay (USN **1RV24CY047**), solo project |
| **Type** | Open-ended DBMS lab mini project. The database is the product; the evaluators grade the data layer |
| **Target user (product)** | Colleges (B2B). The college mandates it, like the SAP results portal — students use it because submissions/marks go through it |
| **Core stack [DECIDED]** | PostgreSQL 17 on **Supabase** (relational + pgvector) · **MongoDB 8** (NoSQL) · **FastAPI** (Python) · **React + TypeScript + Tailwind** · **Claude API** · **Voyage AI** embeddings · GitHub App + webhooks · Obsidian (via Obsidian Git plugin) · Tiptap + Yjs (Hocuspocus) |
| **Status (as of 19 Nov 2026)** | Synopsis (C1) and Test (C4) done; the 62 fixture queries (37 SQL + 25 MongoDB) still match Appendix H (37/37, 25/25). Working prototype **Countersign** built: migrations 0001–0007 all live on Supabase `countersign-dbms` (0007 = strict marks: one-decimal CHECK, the NUMERIC(4,1) rounding gap closed); web app (student, faculty, admin, Race arena `/race`); FastAPI; GitHub ingestion (Edge Function → pgmq → worker → Mongo log → Postgres projection); keyword search with citations. Tests: pgTAP 710, API pytest 66, e2e 44. Demo seed: solo team T00 (Arun) on P06; the countersign flow is shown on fixture team T06. Not built: viva practice, hash-chained audit log, consent ledger, EXPLAIN bench, embeddings in use, hosting. Current detail: `README.md` § Status. (On 4 Nov 2026: synopsis, schema, seed and queries done; application code not started.) |

---

## 1. The problem

Every RVCE course has an Experiential Learning (EL) / mini project (DBMS, AIML, OS, ADLD, …). Today:

1. **Work is scattered** — WhatsApp groups, Google Drive folders, Google Classroom submissions, personal GitHub accounts. No centralized, structured record.
2. **Faculty can't see individual contribution** — team projects are graded with paper rubrics and end-of-semester demos; they sign rubric boxes on trust. One person often does most of the work; now they also can't tell human work from AI-generated work.
3. **Team formation is network-based** — no way to find teammates by verified skills or interests.
4. **Projects are siloed per course** — students rarely connect DBMS + OS + AIML + ADLD concepts into one serious project; nobody shows them how engineering connects.
5. **Projects are forgotten** — once a semester ends, no record of what a student built is retained (Arun: "I made projects in my first year that I don't even remember").
6. **Skills on resumes are self-declared** — no evidence linking a claimed skill to actual work.

**Emotional hook for evaluators:** faculty live problem #2 *while grading this very project*. The demo is meta.

---

## 2. The solution (product vision) [DECIDED]

**One platform for all student projects — "like GitHub, but streamlined for college projects."** The system of record for everything a student builds at college.

### 2.1 Pillars

| Pillar | What it does |
|---|---|
| **Semester hub / dashboard** | Each semester, a student sees every EL project they must complete, with milestones and deadlines mapped to the course rubric |
| **Team formation** | Find teammates inside the platform by skills and interests (relational DIVISION query) |
| **Work layer** | GitHub for code, Obsidian for thinking/research/notes, in-platform editor for reports. Real work happens here, so contribution is captured where it happens |
| **Teacher view** | Teachers post project details (rubric, milestones). They see live who is doing what — **contribution metadata only**, not private content |
| **Skill graph** | Every project updates the student's skills, derived from evidence (actual artifacts), not self-declared |
| **Cross-course synthesis** | AI sees all a student's courses + past work and proposes projects that tie them together; finds skill gaps to build toward |
| **Lifetime portfolio** | Like results stored in SAP: every project stored permanently, exported at graduation for internships and jobs |
| **AI assistant (RAG)** | Answers questions like "who built the ER diagram?", "what skills am I missing?", "which teammates fit this project?" — every answer cited to database rows |

### 2.2 The novel twists (what makes it non-generic)

- **Every RAG chunk knows its author.** Normal RAG uses anonymous chunks. Here each chunk is a database row with `author`, `version`, `timestamp`, `milestone`, `permission`. Retrieval = SQL filter + vector search in one query. Enables "what did Ravi write about normalization?", "what did the report say before the midterm?", and permission-safe answers.
- **Skills derived from evidence, not declared.** "Knows PostgreSQL concurrency" is backed by the actual project, code and notes.
- **Cross-course synthesis.** Courses are taught as silos; the AI proposes the project that connects them.
- **Contribution is computed, not reported** (design principle). Prefer progress derived from the work itself (commits, edits, versions) over a separate "update progress" chore. Where students do make claims, pair them with evidence.

### 2.3 Privacy model [DECIDED]
"Like every app has private information the company can't see."
- **Teachers see metadata**: who contributed, when, how much, to which rubric component.
- **Teachers do not see content** of private notes unless the student publishes it.
- Personal notes live in a **private vault** that is never pushed to the team repo.
- Enforced in the database: role-based views + **row-level security (RLS)** + separate private schema. The AI inherits the same rules (it can only retrieve what the requesting user may see).

### 2.4 Adoption model [DECIDED]
B2B for colleges. The college enforces it (submissions/marks only count if done through the platform), so every student has a profile — valuable for internships/jobs. A consumer version could exist separately later; this project targets colleges.

### 2.5 Scope note
Arun's instruction: **do not reduce or argue scope** — treat everything as buildable; scope is the team's call.

---

## 3. Feature backlog (from brainstorming) [PROPOSED unless noted]

Core (must exist for the DBMS demo):
- Student / faculty / course / project / team / milestone / artifact / contribution / skill management (CRUD + forms with validation)
- Semester dashboard per student
- Teammate finder (DIVISION) and skill-gap (SET DIFFERENCE)
- Faculty progress view (rubric-wise, metadata only)
- Team join with capacity limit (trigger + row lock; the concurrency demo)
- GitHub webhook ingestion → contributions
- Obsidian notes (via team repo) ingestion
- RAG assistant with cited answers, permission-filtered
- Portfolio view / export per student

Extended ideas explored (optional, good for "future scope" or extra marks):
- **Claims + evidence + endorsements ("Tribunal")**: student logs a claim under a predefined contribution type (Research, Code, Design, Documentation, Review), attaches evidence, teammates confirm/dispute; teacher sees only contested claims.
- **Work signature**: shape of contribution over time (steady work vs last-night spike), anomalies flagged.
- **Rubric-native teacher view**: the teacher's paper rubric rendered as the UI; click a rubric row → who built it, how it evolved; 120→30 reduction computed.
- **Viva engine**: AI generates viva questions from a student's own claimed contributions.
- **Catch-up brief**: on opening the app, summary of what teammates changed since last visit.
- **Rubric gap check**: "What's missing for full marks in the Synopsis?" compares team work against rubric text.
- **Overlap alert**: two teammates researching the same thing.
- **Project genealogy**: detect recycled senior projects across years.
- **LOR memory**: grounded recommendation-letter drafting from verified records.
- **Recruiter query**: e.g. "students who built concurrent systems in two or more courses".

---

## 4. Technology stack and architecture

### 4.1 Stack [DECIDED] with rationale

| Layer | Choice | Why |
|---|---|---|
| Relational core | **PostgreSQL 17 on Supabase** | Auth, RLS, Realtime, Storage and pgvector in one DB; covers syllabus Units III–IV |
| Vector search | **pgvector (HNSW)** inside the same Postgres | Right default under ~10M vectors; filtering by permissions/dates is a SQL join — exactly "every chunk knows its author" |
| Hybrid search | Postgres full-text (`tsvector`) + pgvector combined in one SQL query (e.g. reciprocal rank fusion) | Keyword + semantic with no extra service |
| NoSQL | **MongoDB 8** (Atlas free M0 for the cloud demo) | Required by syllabus Unit V and the lab Test's NoSQL execution marks. Holds raw GitHub events, Obsidian notes, version history, per-student portfolio aggregates |
| Obsidian integration | Each team's Obsidian vault lives in the team's **GitHub repo** via the **Obsidian Git** plugin (by Vinzent) | One GitHub integration captures code *and* notes with per-commit authorship. Private notes stay in a separate personal vault |
| GitHub integration | **GitHub App + webhooks** (push, PR) | Every push is an event → stored raw in MongoDB → normalized into Postgres contribution rows |
| In-platform co-editing | **Tiptap + Yjs**, open-source **Hocuspocus** server | Google-Docs-style live editing with traceable per-student edits |
| Live updates | **Supabase Realtime** | Live faculty dashboard |
| Embeddings | **Voyage `voyage-3-large`** via API (alt: **BGE-M3** self-hosted, free) | Strong for technical text/code. Keep **1024 dims** — pgvector HNSW on `vector` supports at most 2000 dims |
| LLM | **Claude** — Sonnet for answers / viva questions, Haiku for cheap skill tagging/extraction | |
| Backend | **FastAPI (Python)** | Best ecosystem for embeddings/RAG |
| Background jobs | **Supabase Queues** (pgmq, inside Postgres) | Keeps the pipeline DB-centric |
| Frontend | **React + TypeScript + Tailwind** (Arun's usual stack; Vite suggested) | |
| Auth | **Supabase Auth** [PROPOSED: Google OAuth restricted to the college domain, if RVCE uses Google Workspace — unconfirmed] | |
| Deploy [PROPOSED] | Supabase cloud, MongoDB Atlas M0, FastAPI on Render/Railway/Fly, frontend on Vercel | |

### 4.2 Rejected alternatives (do not reintroduce without discussion)

| Rejected | Reason |
|---|---|
| Pinecone / Qdrant (separate vector DB) | Breaks the "AI only sees what you may see" story — permissions would have to be copied out of Postgres |
| LangChain (or heavy RAG framework) | Retrieval *is* the project; write it as visible SQL. A framework hides the graded database work |
| Neo4j / Apache AGE for the skill graph (v1) | A `parent_skill_id` self-reference + recursive CTEs demonstrates the syllabus better and runs on Supabase. Graph DB = future scope |
| Obsidian Headless (CLI sync) | Open beta, appears to need paid Obsidian Sync. Fallback only |
| ElectricSQL / local-first sync engine | Not needed for v1 |
| MySQL | Queries are PostgreSQL. MySQL silently ignores inline column `REFERENCES`, trigger syntax differs, no `NULLS FIRST` |
| JSONB-in-Postgres as the "NoSQL" | Rubric has a separate NoSQL execution row; synopsis promises MongoDB; viva risk. JSONB may appear only as an extra comparison point |
| Putting Teron (Arun's commercial product) into this project | IP/ownership confusion in a graded team project |

### 4.3 Data flow [DECIDED design]

```
GitHub push / Obsidian vault commit (team repo)
        │  GitHub App webhook
        ▼
FastAPI ingest endpoint ──► MongoDB: github_events (raw), notes (markdown + frontmatter)
        │  enqueue job (Supabase Queues / pgmq)
        ▼
Worker: normalize ──► PostgreSQL: ARTIFACT, CONTRIBUTION rows (linked by artifact_id)
        │            chunk + embed (Voyage) ──► ARTIFACT_CHUNK (content, author, version, embedding)
        ▼
RAG query: SQL filters (team, author, time range, permission via RLS)
           + hybrid ranking (tsvector + pgvector) in ONE SQL query
           ──► Claude generates answer, every sentence cited to rows
        │
Supabase Realtime ──► live faculty dashboard
```

Integration rule: contribution/evaluation data stays in PostgreSQL; raw content and history stay in MongoDB; linked through shared `artifact_id` (and `usn`, `team_id`).

### 4.4 Roles
- **Student** — sees own data, own teams' shared work; private vault visible only to self.
- **Faculty** — sees courses they handle; contribution metadata per team/student; no private content.
- **College admin** — manages courses, faculty, semesters.
- **Recruiter** [future] — portfolio views the student chooses to share.

---

## 5. Relational database design

### 5.1 Tables (13) [DECIDED, implemented and tested]

| # | Table | Attributes |
|---|---|---|
| 1 | STUDENT | usn PK, name, email UNIQUE, department, section, semester CHECK 1–8, joined_at |
| 2 | FACULTY | faculty_id PK, name, email UNIQUE, department, designation |
| 3 | COURSE | course_code PK, title, semester, credits CHECK > 0, faculty_id FK → FACULTY (ON DELETE SET NULL) |
| 4 | PROJECT | project_id PK, course_code FK → COURSE, title, description, start_date, end_date (CHECK end > start), status CHECK in (planned, active, completed) |
| 5 | TEAM | team_id PK, project_id FK → PROJECT, team_name, max_size CHECK 1–6, created_at |
| 6 | MILESTONE (weak entity of PROJECT) | project_id FK, milestone_no, title, max_marks CHECK > 0, deadline; PK (project_id, milestone_no) |
| 7 | ARTIFACT | artifact_id PK, team_id FK → TEAM, (project_id, milestone_no) FK → MILESTONE, title, type CHECK in (code, note, report, diagram, slides), source CHECK in (github, obsidian, editor), created_at |
| 8 | CONTRIBUTION | contribution_id PK, usn FK → STUDENT, artifact_id FK → ARTIFACT, contribution_type CHECK in (research, design, code, documentation, review), description, created_at |
| 9 | SKILL | skill_id PK, name UNIQUE, category, parent_skill_id FK → SKILL (recursive) |
| 10 | TEAM_MEMBER (M:N) | team_id FK, usn FK, role (default 'member'), joined_at; PK (team_id, usn) |
| 11 | STUDENT_SKILL (M:N) | usn FK, skill_id FK, level CHECK 1–5; PK (usn, skill_id) |
| 12 | PROJECT_SKILL (M:N) | project_id FK, skill_id FK; PK (project_id, skill_id) |
| 13 | ARTIFACT_CHUNK | chunk_id PK, artifact_id FK → ARTIFACT, version_no, author_usn FK → STUDENT, content, created_at; **in Supabase also `embedding VECTOR(1024)`** (omitted in the local test schema) |

Full DDL: **Appendix A**.

### 5.2 Relationships (cardinality)

- FACULTY → COURSE — 1:N
- COURSE → PROJECT — 1:N
- PROJECT → TEAM — 1:N
- STUDENT ↔ TEAM (TEAM_MEMBER) — M:N, bounded by max_size
- STUDENT ↔ SKILL (STUDENT_SKILL) — M:N with evidence-derived level
- PROJECT ↔ SKILL (PROJECT_SKILL) — M:N (required skills)
- STUDENT ↔ ARTIFACT (CONTRIBUTION) — M:N
- ARTIFACT → ARTIFACT_CHUNK — 1:N (each chunk records version + author)
- SKILL → SKILL (prerequisite / parent) — recursive 1:N
- PROJECT → MILESTONE — identifying relationship; MILESTONE is a **weak entity** identified by (project_id, milestone_no)

ER diagram guidance (for Component 3): strict Elmasri/Chen notation — double rectangle/diamond for weak entity, double lines for total participation, (min,max) on every edge, composite (name), multivalued (interests), derived (skill level, response metrics) attributes. Include at least one **ternary** relationship (e.g. Student–Artifact–Milestone via CONTRIBUTION, or Student–Milestone–ContributionType) and the **recursive** SKILL relationship. Be ready to justify every cardinality in the viva.

### 5.3 Relational-algebra definitions of the headline features (use in report/viva)

- **Teammate finder** = StudentSkill ÷ RequiredSkill (DIVISION)
- **Skill gap** = RequiredSkill − StudentSkill (SET DIFFERENCE)
- **Cross-course synthesis** = concepts(DBMS project) ∩ concepts(OS project) (INTERSECTION)
- **Who built what** = Student ⋈ Contribution ⋈ Artifact (JOIN)

### 5.4 Constraints and triggers
- CHECKs: team size 1–6, semester 1–8, credits > 0, end_date > start_date, enumerated status/type/source/contribution_type, level 1–5.
- FKs with `ON DELETE CASCADE` (dependents) / `SET NULL` (course.faculty_id).
- Trigger `trg_team_capacity` (BEFORE INSERT on team_member) → `check_team_capacity()` raises `Team % is full (% / %)`; locks the team row `FOR UPDATE`.
- Views: `faculty_team_progress` (metadata only), `student_portfolio`, `team_progress`.

### 5.5 MongoDB collections [DECIDED, tested]

| Collection | Document shape |
|---|---|
| `notes` | note_id, team_id, author_usn, title, tags[], links[], status (draft/final), version, content, created_at |
| `github_events` | event_id, team_id, repo, type ("push"), pushed_at, commits[ {sha, author_usn, message, files_changed, additions} ] |
| `portfolios` | usn, name, semester, projects[ {course, title, role, status, skills[]} ] — one aggregate per student |

Indexes: compound `{team_id: 1, created_at: -1}` on notes; text index `{title: "text", content: "text"}`.
Future: key-value presence/session data; shard by college (B2B tenancy = natural sharding key); master-slave replication for read-heavy days.

### 5.6 Sample data (for tests/demo)
12 students, 4 faculty, 4 courses, 5 projects, 5 teams, 19 team memberships, 13 milestones, 14 skills, 46 student-skill rows, 12 project-skill rows, 12 artifacts, 28 contributions, 7 chunks. **All names except S Arun Sanjay are fictional.** Designed so queries return meaningful results: Team Alpha (T01) is full (4/4), Team Beta (T02) has 1 free slot, Nikhil Bhat and Ananya Gowda have no team, Meera (T01) and Vikram (T02) are "ghost members", Arun/Aditi/Rahul/Nikhil have all P01 skills, P05 has no team.
Full data: **Appendix B** (SQL) and **Appendix E** (MongoDB).

---

## 6. Course requirements the project must satisfy

### 6.1 Syllabus (CD252IA) and where each unit lives

| Unit | Syllabus | Where it appears |
|---|---|---|
| I | DB approach, data models, three-schema architecture, data independence; ER model, entities, attributes, keys, relationships, structural constraints, weak entities | Problem statement = scattered files vs one DB; external schemas = role views (student/faculty/admin/recruiter), conceptual = unified schema, internal = Postgres + vector + Mongo; weak entity MILESTONE (also candidate: ArtifactVersion, Submission) |
| II | ER→relational mapping, relational model constraints, update ops & constraint violations, relational algebra (SELECT, PROJECT, set ops, JOIN, DIVISION) | 7-step mapping shown in report; cascade/restrict/set-null decisions (e.g. student leaves team mid-project); RA definitions in §5.3 |
| III | SQL DDL, constraints, queries, insert/delete/update, complex queries; FDs, inference rules, minimal cover, 1NF/2NF/3NF/BCNF, decomposition properties | Views, triggers, nested/correlated queries; **normalization walkthrough starting from the paper marks sheet** (Appendix F) as the unnormalized relation → 1NF → 2NF → 3NF → BCNF; prove lossless join + dependency preservation |
| IV | Transactions, states, ACID, schedules, serializability, conflict-serializability testing; 2PL, lock types, lock tables | Atomic milestone submission; **last-team-slot race** (Innovative Experiment); precedence graph for the team-join schedule; shared locks for dashboard reads, exclusive for submissions/marks |
| V | NoSQL aggregate model, key-value, document; sharding, master-slave, peer-to-peer replication; Big Data types; Hadoop, MapReduce | Portfolio aggregate; Obsidian notes as documents; presence as key-value; shard by college; Obsidian/Git sync as peer-to-peer analogy; structured/semi-structured/unstructured all present; MapReduce/aggregation for cohort skill analytics |

### 6.2 Lab components and marks

| # | Submission | Raw marks |
|---|---|---|
| 1 | Synopsis | 5 |
| 2 | Requirement Specification | 5 |
| 3 | ER Diagram | 10 |
| 4 | Test (SQL + NoSQL) | 20 |
| 5 | DFD (Level 0, 1, 2) | 10 |
| 6 | Normalized tables (up to 3NF) | 10 |
| 7 | Midterm Report | 20 |
| 8 | Design of Forms, Security & Validation | 10 |
| 9 | Demo & Draft Report | 30 |
| | **Total 120 → reduced to 30** (1 raw mark = 0.25) | |
| 10 | Innovative Experiment | 10 (not reduced) |
| 11 | CIE Project Demo & Final Report Submission | 10 (not reduced) |
| | **Lab CIE = 30 + 10 + 10 = 50** | |

### 6.3 Rubric details (from the lab manual)

**Component 1 — Synopsis (5):** Literature survey & study of existing system (2: comprehensive review + identifies limitations of existing literature) · Problem statement (2: defined clearly) · File submission (1: on time with required documents).

**Component 2 — Requirement Specification (5):** Software & hardware requirements (2: correct and complete, logical sequence) · Functional & non-functional requirements (2: all listed correctly and completely) · File maintenance & updation (1).

**Component 3 — ER Diagram and Schema (10 = 6 + 4 viva):** Understanding of ER notations & requirements (2) · Execution: build ER per all requirements, convert to relational schema correctly (2) · Documentation: complete ER diagram (2). Viva: conceptual understanding of notations (2) · use of strategies — insightful use of entities/concepts to derive relationships (1) · communication of ideas (1).

**Component 4 — Test (20 = 5 + 10 + 5):** Write-up (5): correct queries written **simply and optimally** (≤5 >3); correct but complex structure (≤3 ≥1); improper results (0). Execution of SQL (10): executes and obtains relevant results. Execution of NoSQL (5): same. **Format:** students are given a blank sheet and write their *own* queries on their *own project schema*, then execute them.

### 6.4 Remaining deliverables [OPEN — to be produced]
- Component 2 SRS (synopsis already contains SW/HW + FR + NFR; may need a standalone doc)
- Component 3 ER diagram + relational mapping
- Component 5 DFD Level 0/1/2 (Level 0: Platform ↔ Student, Faculty, College Admin, GitHub, Obsidian)
- Component 6 Normalized tables (walkthrough from Appendix F)
- Component 7 Midterm report (≈ synopsis + SRS + ER + DFD + normalization)
- Component 8 Forms, security (RBAC, RLS, private schema), validation
- Component 9 Demo + draft report
- Component 10 Innovative Experiment (see §8)
- Component 11 Final demo + report

---

## 7. Synopsis (as submitted) — content summary

File: `DBMS_Synopsis.docx` / `.pdf` (built from a classmate's template, exact RVCE format). Header: "RV College of Engineering®, Bengaluru – 59 / Department of Computer Science and Engineering / DATABASE MANAGEMENT SYSTEMS (CD252IA) / Synopsis". Table: TITLE + TEAM (USN, Name): 1RV24CY047 S Arun Sanjay.

Sections:
1. **Introduction** — DB-driven EL platform, single system of record across courses/semesters; Supabase (PostgreSQL) for structured entities, MongoDB for notes/GitHub events/version history; RAG layer where every chunk carries author, version, timestamp, permission; relational filters + hybrid search (Postgres FTS + pgvector) in one SQL query; answers by Claude API; RLS-restricted, traceable.
2. **Existing System** — scattered WhatsApp/Drive/Classroom/GitHub; paper rubrics, no individual contribution visibility; network-based team formation; siloed projects, no record retained; self-declared skills.
3. **Proposed System** — hybrid Supabase–MongoDB with pgvector RAG; normalized tables; semester dashboard mapped to rubric; GitHub App captures code + Obsidian notes (vault in team repo) with per-commit authorship, private vault, metadata-only faculty view; real-time co-editing (Tiptap + Yjs) and live dashboard (Supabase Realtime); evidence-backed skill graph (teammate matching, gap analysis, cross-course suggestions); permanent portfolio. **Difference:** every project is a structured, queryable, traceable record from first note to final demo; provenance + RAG as the foundation.
4. **Relational Database Structure** — 10 core tables listed (STUDENT, FACULTY, COURSE, PROJECT, TEAM, MILESTONE, ARTIFACT, CONTRIBUTION, SKILL with parent_skill_id, ARTIFACT_CHUNK with embedding VECTOR(1024)); relationships as §5.2 (junction tables described as relationships).
5. **RDBMS and NoSQL Integration** — RDBMS: Supabase with RLS + pgvector (HNSW). NoSQL: MongoDB 8 for notes, raw webhook events, version history, per-student portfolio. Integration: FastAPI; webhook events stored raw in Mongo, processed by Supabase Queues into CONTRIBUTION and ARTIFACT_CHUNK rows linked by artifact_id; RAG applies relational filters + hybrid ranking in one query; answers cite records.
6. **Societal Concern** — fairness and visibility in team EL; teammates by verified skills not networks; permanent evidence-backed portfolio; cross-course learning; privacy-by-design; responsible use of student data and AI.
7. **Requirement Specification**
   - OS: Windows / Linux / macOS
   - Software: PostgreSQL 17 (Supabase) with pgvector, MongoDB 8, FastAPI (Python), React with TypeScript and Tailwind CSS, Tiptap with Yjs, Claude API, Voyage AI embeddings, GitHub App and webhooks, Obsidian with the Obsidian Git plugin, Web Browser
   - Hardware: Intel i3/AMD equivalent, 8 GB RAM, 20 GB storage, Internet connection
   - **FR1** Manage student, faculty, course and semester records. **FR2** Faculty create EL projects with milestones, deadlines, rubric marks. **FR3** Semester dashboard of all EL projects per student. **FR4** Team formation with skill-based teammate recommendations. **FR5** Integrate GitHub repos and Obsidian vaults to capture code, notes, documents as artifacts. **FR6** Record and attribute every contribution with full version history. **FR7** Faculty live rubric-wise view of team progress and individual contributions. **FR8** Build/update each student's skill graph from evidence; identify gaps. **FR9** RAG assistant with cited sources, restricted by permissions. **FR10** Permanent portfolio, exportable at graduation. **FR11** Structured data in PostgreSQL; unstructured notes/events/history in MongoDB.
   - **NFR** Performance (fast dashboard + retrieval) · Security & Privacy (RBAC + RLS; private notes never visible to faculty/teammates) · Reliability (atomic milestone submissions) · Concurrency (simultaneous edits and team-join requests) · Scalability (multiple departments, colleges, years) · Usability (unified interface) · Explainability (AI answers cite exact records).

---

## 8. Innovative Experiment (Component 10) [PROPOSED, partially implemented]

**"The last team slot" concurrency race.**
1. Two (or N) students accept the last free seat of a team (e.g. Team Beta T02, 3/4) at the same instant.
2. **Run 1 (no locking / naive check-then-insert):** both read 3/4, both insert → team becomes 5/4 (lost update / phantom). Show it live.
3. **Run 2 (correct):** `SELECT ... FOR UPDATE` on the team row (strict 2PL) and/or the `trg_team_capacity` trigger → exactly one succeeds, the other gets "Team T02 is full".
4. Show the lock table (`pg_locks`), compare isolation levels (Read Committed vs Serializable) with measured conflict rates under a load generator.
5. Draw the schedule's precedence graph and test conflict serializability (Unit IV).

Already implemented: trigger `check_team_capacity()` + Q35–Q37 in Appendix C. Still to build: the load generator + live visualization.

---

## 9. Component 4 (Test) — what was prepared and executed

### 9.1 Execution environments used [DECIDED]
- **SQL:** Supabase project ("dbms lab", owner Arun-Sanjay's Project) → **SQL Editor** → New query → paste → Run (Cmd+Enter). Highlight a single query to run only it. Tables created **without RLS** for the demo (RLS added deliberately later for Component 8). `\dt` / `DESCRIBE` don't work there — use `information_schema` (Appendix G).
- **NoSQL:** **OneCompiler → MongoDB** (onecompiler.com). Each Run starts from an empty DB and executes the whole editor, so the data block stays at the top and the query goes below it. (MongoDB Atlas onboarding was started as an alternative; Compass / MongoDB for VS Code playgrounds are other options — in playgrounds use `use('elp')`.)
- Offline backups: Postgres.app; `brew install mongodb-community`.

### 9.2 Arun's chosen Test queries (in his order) — SQL
Order executed and shown to faculty: **2, 8, 5, 3, 6** (numbering from the short "What to Write" sheet; #1 there is DDL).

| # | Question | Concept | Expected result |
|---|---|---|---|
| 2 | Members of every DBMS (P01) team | 3-table JOIN | 7 rows (Alpha 4, Beta 3) |
| 8 | Skills P01 needs that Karthik (1RV24CY024) lacks | EXCEPT | S06, S04 |
| 5 | Students with above-average contributions | nested subquery in HAVING | 5 rows: 047 (8), 011 (5), three with 3 |
| 3 | Students not in any team | LEFT JOIN + IS NULL | Nikhil Bhat, Ananya Gowda |
| 6 | Team members who contributed nothing to their own team | correlated NOT EXISTS | T01 Meera Iyer, T02 Vikram Shetty |

(Other sheet items: #1 DDL, #4 GROUP BY/HAVING teams > 4 contributions, #7 DIVISION teammate finder, #9 VIEW team_progress, #10 UPDATE/DELETE.)

### 9.3 NoSQL Test queries (M1–M5)
M1 `insertOne` note N08 · M2 `find` T01 notes after 2026-10-01, projection + sort · M3 `updateOne` N03 with `$set`, `$inc`, `$push` · M4 `aggregate` `$unwind` `$group` `$sort` commits/lines per author · M5 `aggregate` `$match` `$lookup` `$unwind` `$project` notes + author name. (On OneCompiler each runs on fresh data, so M5 returns 3 final notes, not 4.)

Full text of all queries and their verified outputs: **Appendix C, D, E**.

### 9.4 Viva prep answered
- **Query** = a statement asking the DB to retrieve or manipulate data.
- **SQL classes:** DDL (CREATE, ALTER, DROP, TRUNCATE, RENAME) · DML (INSERT, UPDATE, DELETE) · DQL (SELECT; some books put it in DML) · DCL (GRANT, REVOKE) · TCL (COMMIT, ROLLBACK, SAVEPOINT). DELETE vs TRUNCATE vs DROP.
- MongoDB: collection = table, document = row, field = column; `find(filter, projection)`, `$gt`, sort 1/-1; update operators `$set` `$inc` `$push` `$pull`; aggregation pipeline stages `$match` `$unwind` `$group` `$sort` `$lookup` `$project`.

---

## 10. Files produced so far

| File | What it is |
|---|---|
| `DBMS_Synopsis.docx` / `DBMS_Synopsis.pdf` | Synopsis in RVCE template format (5 pages) |
| `dbms_test/01_schema.sql` | Full PostgreSQL DDL (13 tables) — Appendix A |
| `dbms_test/02_seed.sql` | Sample data — Appendix B |
| `dbms_test/03_queries.sql` | 37 SQL queries Q1–Q37 incl. views, recursive CTE, trigger, transaction — Appendix C |
| `dbms_test/04_mongo.js` | MongoDB collections + 25 queries M1–M25 (mongosh) — Appendix E |
| `1_setup_supabase.sql` | 01 + 02 combined for one paste in Supabase |
| `2_component4_queries.sql` | Short-sheet SQL queries 2–10 |
| `DBMS_Test_Queries_S_Arun_Sanjay.pdf` | 22-page study sheet: every query + verified output + pattern table |
| `Component4_What_to_Write.pdf` | 5-page short sheet: 10 SQL + 5 MongoDB queries with outputs |
| `My_Component4_Queries.md` | Arun's 5 SQL queries in his order with outputs |
| `My_Component4_NoSQL_OneCompiler.md` | Step-by-step OneCompiler MongoDB run guide |
| `Supabase_View_Commands.md` | Commands to inspect tables/columns/constraints/counts in Supabase |

All SQL was executed on PostgreSQL 16; all MongoDB on MongoDB 8.2 (mongosh). Q34 and Q36 are **intended** to fail (prove CHECK and trigger).

---

## 11. Guidance for the coding agent

### 11.1 Hard rules
- PostgreSQL syntax only (Supabase). Never MySQL.
- Keep vectors in Postgres (pgvector). Do not add a separate vector DB.
- Write retrieval as explicit SQL (hybrid FTS + vector + relational filters). No LangChain.
- MongoDB must remain a real component (raw events, notes, portfolios).
- Faculty-facing views expose contribution **metadata**, never private note content. Enforce with RLS + views, and make the AI layer use the requesting user's permissions.
- Embedding dimension 1024 (HNSW limit 2000 for `vector`).
- Keep the database visibly central — evaluators grade the data layer; the AI sits on top of a strong schema.
- Don't put Teron/Metacognisync code or branding in this project.

### 11.2 Suggested repo layout [PROPOSED]
```
/db
  /migrations        # Supabase migrations: schema (Appendix A) + RLS policies + pgvector + views + triggers
  /seed              # Appendix B
  /queries           # Appendix C (graded SQL), kept runnable
/mongo
  seed.js            # Appendix E data block
  queries.js
/api                 # FastAPI
  routers/ students, faculty, courses, projects, teams, milestones, artifacts, contributions, skills, rag, webhooks
  workers/ ingest (pgmq consumer), embed (Voyage), skill_tagger (Claude Haiku)
/web                 # React + TS + Tailwind (Vite)
  student dashboard, team finder, project workspace (Tiptap+Yjs), faculty rubric view, portfolio, RAG chat
/experiments
  team_slot_race/    # Innovative Experiment load generator + results
/docs                # ER, DFD, normalization, reports
```

### 11.3 Suggested build order [PROPOSED]
1. Supabase project: run Appendix A + B; add `embedding VECTOR(1024)` + HNSW index + tsvector column on `artifact_chunk`.
2. RLS policies: student (own rows/teams), faculty (their courses; metadata views), admin.
3. MongoDB Atlas: Appendix E collections + indexes.
4. FastAPI CRUD + forms with validation (Component 8).
5. GitHub App webhook → Mongo raw → pgmq → contribution/artifact rows.
6. Obsidian vault-in-repo ingestion (markdown + frontmatter → `notes`).
7. Chunking + Voyage embeddings → `artifact_chunk`; hybrid retrieval SQL function; Claude answer with row citations.
8. React UI: student dashboard, team finder (DIVISION), skill gap (EXCEPT), faculty rubric view (Realtime), portfolio export.
9. Tiptap + Yjs co-editing with per-user attribution.
10. Innovative Experiment harness.

### 11.4 Open decisions [OPEN]
- Final product name.
- ~~Whether to add real classmates to seed data.~~ Decided: no. The project is solo; the demo seed adds no student, and T00 has Arun as its only member.
- RVCE email domain / Google Workspace for OAuth.
- MongoDB host for final demo: Atlas vs OneCompiler (Test used OneCompiler).
- Which extended features (Tribunal, viva engine, work signature, rubric-native view) go into the final demo vs future scope.

---

## 12. Decision history (context)
- First choice was building on Arun's earlier AnywhereAmbulance / DispatchPulse ambulance-dispatch work — **dropped** (worked on it too long; wanted something new).
- Not based on his SIH entry (LISTEN).
- Brainstormed many alternatives (Tatkal booking engine, order-book exchange, elective allocation, kidney exchange, DB red-team arena, etc.) and a 25-problem research report (PM-JAY, undertrials, blood expiry…) — rejected as generic or lacking evaluator connection.
- Selection criteria Arun set: real-world use · emotional connection for faculty (not tragic) · a novel approach in at least one aspect · not generic.
- Idea evolved: "who actually did the work?" (provenance) → students work inside the platform (database + Obsidian + software, "like GitHub but streamlined") → RAG with author-aware chunks → full unified EL platform with skill graph, cross-course synthesis and lifetime portfolio (final).

---

# APPENDICES

## Appendix A — PostgreSQL schema (`01_schema.sql`, tested on PostgreSQL 16)

```sql
-- =====================================================================
--  Unified Experiential Learning Platform : RELATIONAL SCHEMA
--  DBMS Lab (CD252IA) | S Arun Sanjay | 1RV24CY047
--  Target: PostgreSQL 16+ (Supabase). Run in order: 01_schema -> 02_seed -> 03_queries
-- =====================================================================

DROP TABLE IF EXISTS artifact_chunk, contribution, artifact, milestone,
                     project_skill, student_skill, skill, team_member,
                     team, project, course, faculty, student CASCADE;

-- ---------- Strong entities ----------
CREATE TABLE student (
    usn         VARCHAR(10)  PRIMARY KEY,
    name        VARCHAR(60)  NOT NULL,
    email       VARCHAR(80)  NOT NULL UNIQUE,
    department  VARCHAR(10)  NOT NULL,
    section     CHAR(1)      NOT NULL,
    semester    INT          NOT NULL CHECK (semester BETWEEN 1 AND 8),
    joined_at   DATE         NOT NULL
);

CREATE TABLE faculty (
    faculty_id  VARCHAR(6)   PRIMARY KEY,
    name        VARCHAR(60)  NOT NULL,
    email       VARCHAR(80)  NOT NULL UNIQUE,
    department  VARCHAR(10)  NOT NULL,
    designation VARCHAR(30)  NOT NULL
);

CREATE TABLE course (
    course_code VARCHAR(10)  PRIMARY KEY,
    title       VARCHAR(80)  NOT NULL,
    semester    INT          NOT NULL CHECK (semester BETWEEN 1 AND 8),
    credits     INT          NOT NULL CHECK (credits > 0),
    faculty_id  VARCHAR(6)   REFERENCES faculty(faculty_id) ON DELETE SET NULL
);

CREATE TABLE project (
    project_id  VARCHAR(5)   PRIMARY KEY,
    course_code VARCHAR(10)  NOT NULL REFERENCES course(course_code) ON DELETE CASCADE,
    title       VARCHAR(80)  NOT NULL,
    description TEXT,
    start_date  DATE         NOT NULL,
    end_date    DATE         NOT NULL,
    status      VARCHAR(10)  NOT NULL DEFAULT 'active'
                CHECK (status IN ('planned', 'active', 'completed')),
    CHECK (end_date > start_date)
);

CREATE TABLE team (
    team_id     VARCHAR(5)   PRIMARY KEY,
    project_id  VARCHAR(5)   NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
    team_name   VARCHAR(40)  NOT NULL,
    max_size    INT          NOT NULL CHECK (max_size BETWEEN 1 AND 6),
    created_at  DATE         NOT NULL
);

CREATE TABLE skill (
    skill_id        VARCHAR(5)  PRIMARY KEY,
    name            VARCHAR(40) NOT NULL UNIQUE,
    category        VARCHAR(20) NOT NULL,
    parent_skill_id VARCHAR(5)  REFERENCES skill(skill_id)       -- recursive relationship
);

-- ---------- Weak entity: MILESTONE (identified by owner PROJECT) ----------
CREATE TABLE milestone (
    project_id   VARCHAR(5)  REFERENCES project(project_id) ON DELETE CASCADE,
    milestone_no INT         CHECK (milestone_no > 0),
    title        VARCHAR(60) NOT NULL,
    max_marks    INT         NOT NULL CHECK (max_marks > 0),
    deadline     DATE        NOT NULL,
    PRIMARY KEY (project_id, milestone_no)
);

CREATE TABLE artifact (
    artifact_id  VARCHAR(5)  PRIMARY KEY,
    team_id      VARCHAR(5)  NOT NULL REFERENCES team(team_id) ON DELETE CASCADE,
    project_id   VARCHAR(5)  NOT NULL,
    milestone_no INT         NOT NULL,
    title        VARCHAR(60) NOT NULL,
    type         VARCHAR(10) NOT NULL CHECK (type IN ('code', 'note', 'report', 'diagram', 'slides')),
    source       VARCHAR(10) NOT NULL CHECK (source IN ('github', 'obsidian', 'editor')),
    created_at   DATE        NOT NULL,
    FOREIGN KEY (project_id, milestone_no) REFERENCES milestone(project_id, milestone_no)
);

-- ---------- M:N relationships ----------
CREATE TABLE team_member (                       -- STUDENT <-> TEAM
    team_id   VARCHAR(5)  REFERENCES team(team_id) ON DELETE CASCADE,
    usn       VARCHAR(10) REFERENCES student(usn)  ON DELETE CASCADE,
    role      VARCHAR(20) NOT NULL DEFAULT 'member',
    joined_at DATE        NOT NULL,
    PRIMARY KEY (team_id, usn)
);

CREATE TABLE student_skill (                     -- STUDENT <-> SKILL
    usn      VARCHAR(10) REFERENCES student(usn) ON DELETE CASCADE,
    skill_id VARCHAR(5)  REFERENCES skill(skill_id),
    level    INT         NOT NULL CHECK (level BETWEEN 1 AND 5),
    PRIMARY KEY (usn, skill_id)
);

CREATE TABLE project_skill (                     -- PROJECT <-> SKILL (required)
    project_id VARCHAR(5) REFERENCES project(project_id) ON DELETE CASCADE,
    skill_id   VARCHAR(5) REFERENCES skill(skill_id),
    PRIMARY KEY (project_id, skill_id)
);

CREATE TABLE contribution (                      -- STUDENT <-> ARTIFACT
    contribution_id   INT          PRIMARY KEY,
    usn               VARCHAR(10)  NOT NULL REFERENCES student(usn) ON DELETE CASCADE,
    artifact_id       VARCHAR(5)   NOT NULL REFERENCES artifact(artifact_id) ON DELETE CASCADE,
    contribution_type VARCHAR(15)  NOT NULL
        CHECK (contribution_type IN ('research', 'design', 'code', 'documentation', 'review')),
    description       VARCHAR(120),
    created_at        DATE         NOT NULL
);

-- In Supabase this table also has:  embedding VECTOR(1024)  (pgvector) for RAG search.
CREATE TABLE artifact_chunk (
    chunk_id    INT          PRIMARY KEY,
    artifact_id VARCHAR(5)   NOT NULL REFERENCES artifact(artifact_id) ON DELETE CASCADE,
    version_no  INT          NOT NULL CHECK (version_no > 0),
    author_usn  VARCHAR(10)  NOT NULL REFERENCES student(usn),
    content     TEXT         NOT NULL,
    created_at  DATE         NOT NULL
);
```

## Appendix B — Sample data (`02_seed.sql`)

```sql
-- =====================================================================
--  Unified Experiential Learning Platform : SAMPLE DATA
--  (Names other than the author's are fictional sample data.)
-- =====================================================================

INSERT INTO student VALUES
('1RV24CY047', 'S Arun Sanjay',  'arun.cy24@rvce.edu.in',    'CSE', 'A', 5, '2024-09-01'),
('1RV24CY011', 'Aditi Rao',      'aditi.cy24@rvce.edu.in',   'CSE', 'A', 5, '2024-09-01'),
('1RV24CY024', 'Karthik M',      'karthik.cy24@rvce.edu.in', 'CSE', 'A', 5, '2024-09-01'),
('1RV24CY033', 'Meera Iyer',     'meera.cy24@rvce.edu.in',   'CSE', 'A', 5, '2024-09-01'),
('1RV24CY041', 'Rahul Nair',     'rahul.cy24@rvce.edu.in',   'CSE', 'A', 5, '2024-09-01'),
('1RV24CY052', 'Sneha Patil',    'sneha.cy24@rvce.edu.in',   'CSE', 'B', 5, '2024-09-01'),
('1RV24CY058', 'Vikram Shetty',  'vikram.cy24@rvce.edu.in',  'CSE', 'B', 5, '2024-09-01'),
('1RV24CY063', 'Priya Menon',    'priya.cy24@rvce.edu.in',   'CSE', 'B', 5, '2024-09-01'),
('1RV24CY066', 'Rohan Kulkarni', 'rohan.cy24@rvce.edu.in',   'CSE', 'B', 5, '2024-09-01'),
('1RV24CY071', 'Divya Hegde',    'divya.cy24@rvce.edu.in',   'CSE', 'B', 5, '2024-09-01'),
('1RV24CY077', 'Nikhil Bhat',    'nikhil.cy24@rvce.edu.in',  'CSE', 'B', 5, '2024-09-01'),
('1RV24CY082', 'Ananya Gowda',   'ananya.cy24@rvce.edu.in',  'CSE', 'A', 5, '2024-09-01');

INSERT INTO faculty VALUES
('F01', 'Dr. Ramesh Babu',    'ramesh@rvce.edu.in',  'CSE', 'Professor'),
('F02', 'Dr. Lakshmi Prasad', 'lakshmi@rvce.edu.in', 'CSE', 'Associate Professor'),
('F03', 'Prof. Kavitha S',    'kavitha@rvce.edu.in', 'CSE', 'Assistant Professor'),
('F04', 'Prof. Suresh N',     'suresh@rvce.edu.in',  'CSE', 'Assistant Professor');

INSERT INTO course VALUES
('CD252IA', 'Database Management Systems',                   5, 4, 'F01'),
('CD253IA', 'Artificial Intelligence and Machine Learning',  5, 4, 'F02'),
('CD254TA', 'Operating Systems',                             5, 3, 'F03'),
('CD243AI', 'Analog and Digital Logic Design',               4, 4, 'F04');

INSERT INTO project VALUES
('P01', 'CD252IA', 'DBMS Mini Project',          'Open-ended database mini project',      '2026-09-15', '2026-12-15', 'active'),
('P02', 'CD253IA', 'AIML Experiential Learning', 'Applied ML project with a trained model', '2026-09-20', '2026-12-20', 'active'),
('P03', 'CD254TA', 'OS Mini Project',            'CPU scheduling simulator',              '2026-10-01', '2026-12-10', 'active'),
('P04', 'CD243AI', 'ADLD Hardware Project',      'Digital logic hardware build',          '2026-02-01', '2026-05-15', 'completed'),
('P05', 'CD252IA', 'DBMS Innovative Experiment', 'Concurrency control experiment',        '2026-11-01', '2026-12-15', 'planned');

INSERT INTO team VALUES
('T01', 'P01', 'Team Alpha',   4, '2026-09-18'),
('T02', 'P01', 'Team Beta',    4, '2026-09-19'),
('T03', 'P02', 'Team Gamma',   5, '2026-09-22'),
('T04', 'P03', 'Team Delta',   4, '2026-10-03'),
('T05', 'P04', 'Team Epsilon', 4, '2026-02-03');

INSERT INTO team_member VALUES
('T01', '1RV24CY047', 'lead',   '2026-09-18'),
('T01', '1RV24CY011', 'member', '2026-09-18'),
('T01', '1RV24CY024', 'member', '2026-09-18'),
('T01', '1RV24CY033', 'member', '2026-09-19'),
('T02', '1RV24CY041', 'lead',   '2026-09-19'),
('T02', '1RV24CY052', 'member', '2026-09-19'),
('T02', '1RV24CY058', 'member', '2026-09-20'),
('T03', '1RV24CY063', 'lead',   '2026-09-22'),
('T03', '1RV24CY047', 'member', '2026-09-22'),
('T03', '1RV24CY066', 'member', '2026-09-22'),
('T03', '1RV24CY071', 'member', '2026-09-23'),
('T03', '1RV24CY033', 'member', '2026-09-23'),
('T04', '1RV24CY024', 'lead',   '2026-10-03'),
('T04', '1RV24CY058', 'member', '2026-10-03'),
('T04', '1RV24CY071', 'member', '2026-10-04'),
('T05', '1RV24CY047', 'lead',   '2026-02-03'),
('T05', '1RV24CY011', 'member', '2026-02-03'),
('T05', '1RV24CY041', 'member', '2026-02-03'),
('T05', '1RV24CY063', 'member', '2026-02-04');

INSERT INTO skill VALUES
('S01', 'Databases',        'Core',      NULL),
('S02', 'SQL',              'Core',      'S01'),
('S03', 'NoSQL',            'Core',      'S01'),
('S04', 'Normalization',    'Core',      'S01'),
('S05', 'Transactions',     'Core',      'S02'),
('S06', 'MongoDB',          'Tool',      'S03'),
('S07', 'Programming',      'Core',      NULL),
('S08', 'Python',           'Language',  'S07'),
('S09', 'JavaScript',       'Language',  'S07'),
('S10', 'Machine Learning', 'AI',        NULL),
('S11', 'Deep Learning',    'AI',        'S10'),
('S12', 'Operating Systems','Systems',   NULL),
('S13', 'Digital Logic',    'Hardware',  NULL),
('S14', 'React',            'Framework', 'S09');

INSERT INTO student_skill VALUES
('1RV24CY047','S02',5),('1RV24CY047','S04',4),('1RV24CY047','S05',4),('1RV24CY047','S06',4),
('1RV24CY047','S08',5),('1RV24CY047','S09',4),('1RV24CY047','S10',4),('1RV24CY047','S11',3),
('1RV24CY047','S13',3),('1RV24CY047','S14',4),
('1RV24CY011','S02',4),('1RV24CY011','S04',3),('1RV24CY011','S06',3),('1RV24CY011','S08',4),
('1RV24CY024','S02',3),('1RV24CY024','S08',4),('1RV24CY024','S12',4),
('1RV24CY033','S04',2),('1RV24CY033','S08',3),('1RV24CY033','S10',4),('1RV24CY033','S11',3),
('1RV24CY041','S02',4),('1RV24CY041','S04',4),('1RV24CY041','S06',2),('1RV24CY041','S08',3),('1RV24CY041','S13',3),
('1RV24CY052','S02',3),('1RV24CY052','S09',4),('1RV24CY052','S14',3),
('1RV24CY058','S12',3),('1RV24CY058','S13',4),
('1RV24CY063','S08',5),('1RV24CY063','S10',5),('1RV24CY063','S11',4),('1RV24CY063','S13',3),
('1RV24CY066','S08',4),('1RV24CY066','S10',3),
('1RV24CY071','S08',3),('1RV24CY071','S10',3),('1RV24CY071','S12',4),
('1RV24CY077','S02',4),('1RV24CY077','S04',3),('1RV24CY077','S06',4),('1RV24CY077','S08',3),
('1RV24CY082','S09',3),('1RV24CY082','S14',4);

INSERT INTO project_skill VALUES
('P01','S02'),('P01','S04'),('P01','S06'),('P01','S08'),
('P02','S08'),('P02','S10'),('P02','S11'),
('P03','S08'),('P03','S12'),
('P04','S13'),
('P05','S02'),('P05','S05');

INSERT INTO milestone VALUES
('P01', 1, 'Synopsis',                  5, '2026-10-20'),
('P01', 2, 'Requirement Specification', 5, '2026-10-27'),
('P01', 3, 'ER Diagram',               10, '2026-11-05'),
('P01', 4, 'DFD',                      10, '2026-11-15'),
('P01', 5, 'Normalized Tables',        10, '2026-11-25'),
('P02', 1, 'Proposal',                 10, '2026-10-15'),
('P02', 2, 'Model Training',           20, '2026-11-20'),
('P02', 3, 'Final Report',             20, '2026-12-15'),
('P03', 1, 'Design Document',          10, '2026-10-30'),
('P03', 2, 'Implementation',           20, '2026-12-01'),
('P04', 1, 'Circuit Design',           15, '2026-03-15'),
('P04', 2, 'Final Demo',               15, '2026-05-10'),
('P05', 1, 'Experiment Plan',          10, '2026-11-20');

INSERT INTO artifact VALUES
('A01', 'T01', 'P01', 1, 'Synopsis draft',          'report',  'editor',   '2026-10-12'),
('A02', 'T01', 'P01', 1, 'Literature survey notes', 'note',    'obsidian', '2026-10-08'),
('A03', 'T01', 'P01', 2, 'SRS document',            'report',  'editor',   '2026-10-22'),
('A04', 'T01', 'P01', 3, 'ER diagram',              'diagram', 'editor',   '2026-10-30'),
('A05', 'T01', 'P01', 3, 'Schema DDL',              'code',    'github',   '2026-11-01'),
('A06', 'T02', 'P01', 1, 'Synopsis',                'report',  'editor',   '2026-10-15'),
('A07', 'T02', 'P01', 2, 'Requirements notes',      'note',    'obsidian', '2026-10-25'),
('A08', 'T03', 'P02', 1, 'Project proposal',        'report',  'editor',   '2026-10-10'),
('A09', 'T03', 'P02', 2, 'Training pipeline',       'code',    'github',   '2026-11-02'),
('A10', 'T04', 'P03', 1, 'Scheduler design',        'diagram', 'editor',   '2026-10-25'),
('A11', 'T05', 'P04', 1, 'Circuit schematic',       'diagram', 'editor',   '2026-03-10'),
('A12', 'T05', 'P04', 2, 'Demo slides',             'slides',  'editor',   '2026-05-08');

INSERT INTO contribution VALUES
( 1, '1RV24CY047', 'A01', 'documentation', 'Wrote introduction and proposed system',   '2026-10-10'),
( 2, '1RV24CY011', 'A01', 'research',      'Wrote existing system survey',             '2026-10-11'),
( 3, '1RV24CY047', 'A02', 'research',      'Surveyed data provenance papers',          '2026-10-06'),
( 4, '1RV24CY011', 'A02', 'research',      'Surveyed existing EL tools',               '2026-10-07'),
( 5, '1RV24CY047', 'A03', 'documentation', 'Functional requirements',                  '2026-10-20'),
( 6, '1RV24CY011', 'A03', 'documentation', 'Non-functional requirements',              '2026-10-21'),
( 7, '1RV24CY047', 'A04', 'design',        'Entities and relationships',               '2026-10-28'),
( 8, '1RV24CY011', 'A04', 'review',        'Reviewed cardinalities',                   '2026-10-29'),
( 9, '1RV24CY024', 'A04', 'design',        'Added weak entity MILESTONE',              '2026-10-30'),
(10, '1RV24CY047', 'A05', 'code',          'CREATE TABLE scripts',                     '2026-10-31'),
(11, '1RV24CY024', 'A05', 'code',          'Constraints and foreign keys',             '2026-11-01'),
(12, '1RV24CY041', 'A06', 'documentation', 'Full synopsis',                            '2026-10-14'),
(13, '1RV24CY052', 'A06', 'review',        'Proofread synopsis',                       '2026-10-15'),
(14, '1RV24CY041', 'A07', 'research',      'Requirement gathering notes',              '2026-10-24'),
(15, '1RV24CY063', 'A08', 'documentation', 'Proposal write-up',                        '2026-10-09'),
(16, '1RV24CY071', 'A08', 'research',      'Dataset survey',                           '2026-10-08'),
(17, '1RV24CY033', 'A08', 'research',      'Baseline model survey',                    '2026-10-08'),
(18, '1RV24CY063', 'A09', 'code',          'Data loader and model',                    '2026-10-30'),
(19, '1RV24CY066', 'A09', 'code',          'Training loop and early stopping',         '2026-11-01'),
(20, '1RV24CY047', 'A09', 'review',        'Code review of training loop',             '2026-11-02'),
(21, '1RV24CY024', 'A10', 'design',        'Scheduler state diagram',                  '2026-10-23'),
(22, '1RV24CY058', 'A10', 'design',        'Queue design',                             '2026-10-24'),
(23, '1RV24CY071', 'A10', 'review',        'Reviewed design',                          '2026-10-25'),
(24, '1RV24CY047', 'A11', 'design',        'Counter circuit',                          '2026-03-08'),
(25, '1RV24CY011', 'A11', 'design',        'Decoder circuit',                          '2026-03-09'),
(26, '1RV24CY063', 'A11', 'review',        'Verified truth tables',                    '2026-03-10'),
(27, '1RV24CY047', 'A12', 'documentation', 'Demo slides',                              '2026-05-07'),
(28, '1RV24CY041', 'A12', 'documentation', 'Results slides',                           '2026-05-08');

INSERT INTO artifact_chunk VALUES
(1, 'A01', 1, '1RV24CY047', 'The platform unifies every experiential learning project into one system of record.', '2026-10-10'),
(2, 'A01', 2, '1RV24CY011', 'Existing EL work is scattered across WhatsApp groups, Drive and personal GitHub accounts.', '2026-10-11'),
(3, 'A02', 1, '1RV24CY047', 'Data provenance research tracks where each record came from and who changed it.', '2026-10-06'),
(4, 'A04', 1, '1RV24CY047', 'TEAM_MEMBER resolves the many-to-many relationship between STUDENT and TEAM.', '2026-10-28'),
(5, 'A04', 2, '1RV24CY024', 'MILESTONE is a weak entity identified by project_id and milestone_no.', '2026-10-30'),
(6, 'A05', 1, '1RV24CY024', 'Foreign keys use ON DELETE CASCADE for dependent rows.', '2026-11-01'),
(7, 'A09', 1, '1RV24CY066', 'Training loop uses early stopping on validation loss.', '2026-11-01');
```

## Appendix C — All 37 SQL queries (`03_queries.sql`)

Run after A and B, in order (Q30–Q37 modify data; Q34 and Q36 are meant to fail).

```sql
-- =====================================================================
--  Unified Experiential Learning Platform : SQL TEST QUERIES (Unit III)
--  Run after 01_schema.sql and 02_seed.sql. Each query starts with "-- Q".
-- =====================================================================

-- ===================== A. BASIC RETRIEVAL =====================

-- Q1. List all Section A students of Semester 5 in alphabetical order.
SELECT usn, name, email
FROM student
WHERE section = 'A' AND semester = 5
ORDER BY name;

-- Q2. Find all projects whose title contains the word 'DBMS'.
SELECT project_id, title, status
FROM project
WHERE title LIKE '%DBMS%';

-- Q3. List milestones due between 1 Nov 2026 and 30 Nov 2026, earliest first.
SELECT project_id, milestone_no, title, deadline
FROM milestone
WHERE deadline BETWEEN '2026-11-01' AND '2026-11-30'
ORDER BY deadline;

-- Q4. List the distinct types of artifacts submitted from GitHub or Obsidian.
SELECT DISTINCT type, source
FROM artifact
WHERE source IN ('github', 'obsidian');

-- ===================== B. JOINS =====================

-- Q5. Show every team with its project title and the course it belongs to.
SELECT t.team_id, t.team_name, p.title AS project, c.title AS course
FROM team t
JOIN project p ON t.project_id = p.project_id
JOIN course  c ON p.course_code = c.course_code
ORDER BY t.team_id;

-- Q6. List the members of every DBMS (CD252IA) project team with their role.
SELECT t.team_name, s.usn, s.name, tm.role
FROM team_member tm
JOIN team    t ON tm.team_id = t.team_id
JOIN project p ON t.project_id = p.project_id
JOIN student s ON tm.usn = s.usn
WHERE p.course_code = 'CD252IA'
ORDER BY t.team_name, tm.role, s.name;

-- Q7. (Outer join) Find students who are not part of any team.
SELECT s.usn, s.name
FROM student s
LEFT JOIN team_member tm ON s.usn = tm.usn
WHERE tm.usn IS NULL;

-- Q8. (Self join) Show every skill with the name of its parent skill.
SELECT child.name AS skill, parent.name AS parent_skill
FROM skill child
LEFT JOIN skill parent ON child.parent_skill_id = parent.skill_id
ORDER BY parent.name NULLS FIRST, child.name;

-- Q9. Show which faculty member handles each active project.
SELECT p.title AS project, f.name AS faculty, f.designation
FROM project p
JOIN course  c ON p.course_code = c.course_code
JOIN faculty f ON c.faculty_id = f.faculty_id
WHERE p.status = 'active';

-- ===================== C. AGGREGATES, GROUP BY, HAVING =====================

-- Q10. Count the contributions made by each student, highest first.
SELECT s.name, COUNT(c.contribution_id) AS contributions
FROM student s
LEFT JOIN contribution c ON s.usn = c.usn
GROUP BY s.usn, s.name
ORDER BY contributions DESC, s.name;

-- Q11. Show contributions per student within Team Alpha (T01) only.
SELECT s.name, COUNT(*) AS contributions
FROM contribution c
JOIN artifact a ON c.artifact_id = a.artifact_id
JOIN student  s ON c.usn = s.usn
WHERE a.team_id = 'T01'
GROUP BY s.name
ORDER BY contributions DESC;

-- Q12. Find teams that have more than 4 contributions in total.
SELECT a.team_id, COUNT(*) AS total_contributions
FROM contribution c
JOIN artifact a ON c.artifact_id = a.artifact_id
GROUP BY a.team_id
HAVING COUNT(*) > 4
ORDER BY total_contributions DESC;

-- Q13. Show the total marks available in each project (sum of milestone marks).
SELECT p.title, COUNT(m.milestone_no) AS milestones, SUM(m.max_marks) AS total_marks
FROM project p
JOIN milestone m ON p.project_id = m.project_id
GROUP BY p.project_id, p.title
ORDER BY total_marks DESC;

-- Q14. Show the number of members and free slots in each team.
SELECT t.team_name, t.max_size, COUNT(tm.usn) AS members,
       t.max_size - COUNT(tm.usn) AS free_slots
FROM team t
LEFT JOIN team_member tm ON t.team_id = tm.team_id
GROUP BY t.team_id, t.team_name, t.max_size
ORDER BY t.team_id;

-- Q15. Count contributions of each type (research, design, code, ...).
SELECT contribution_type, COUNT(*) AS total
FROM contribution
GROUP BY contribution_type
ORDER BY total DESC;

-- ===================== D. NESTED AND CORRELATED QUERIES =====================

-- Q16. Find students whose contribution count is above the average.
SELECT s.name, COUNT(*) AS contributions
FROM contribution c
JOIN student s ON c.usn = s.usn
GROUP BY s.usn, s.name
HAVING COUNT(*) > (
    SELECT AVG(cnt) FROM (SELECT COUNT(*) AS cnt FROM contribution GROUP BY usn) AS x
)
ORDER BY contributions DESC;

-- Q17. (Ghost members) Find team members who have made NO contribution to their own team's work.
SELECT t.team_name, s.name
FROM team_member tm
JOIN team    t ON tm.team_id = t.team_id
JOIN student s ON tm.usn = s.usn
WHERE NOT EXISTS (
    SELECT 1
    FROM contribution c
    JOIN artifact a ON c.artifact_id = a.artifact_id
    WHERE c.usn = tm.usn AND a.team_id = tm.team_id
);

-- Q18. (Correlated) Find the top contributor in each team.
SELECT a.team_id, c.usn, COUNT(*) AS contributions
FROM contribution c
JOIN artifact a ON c.artifact_id = a.artifact_id
GROUP BY a.team_id, c.usn
HAVING COUNT(*) >= ALL (
    SELECT COUNT(*)
    FROM contribution c2
    JOIN artifact a2 ON c2.artifact_id = a2.artifact_id
    WHERE a2.team_id = a.team_id
    GROUP BY c2.usn
)
ORDER BY a.team_id;

-- Q19. Find projects that have no team registered yet.
SELECT project_id, title
FROM project
WHERE project_id NOT IN (SELECT project_id FROM team);

-- Q20. Find milestones of the DBMS project (P01) for which Team Alpha has not submitted any artifact.
SELECT m.milestone_no, m.title, m.deadline
FROM milestone m
WHERE m.project_id = 'P01'
  AND NOT EXISTS (
      SELECT 1 FROM artifact a
      WHERE a.team_id = 'T01'
        AND a.project_id = m.project_id
        AND a.milestone_no = m.milestone_no
  );

-- ===================== E. DIVISION (the "ALL" queries) =====================

-- Q21. (Teammate finder) Find students who have ALL the skills required by the DBMS project P01.
SELECT s.usn, s.name
FROM student s
WHERE NOT EXISTS (
    SELECT ps.skill_id
    FROM project_skill ps
    WHERE ps.project_id = 'P01'
      AND NOT EXISTS (
          SELECT 1 FROM student_skill ss
          WHERE ss.usn = s.usn AND ss.skill_id = ps.skill_id
      )
);

-- Q22. Same as Q21, but only students who are NOT yet in any P01 team (available teammates).
SELECT s.usn, s.name
FROM student s
WHERE NOT EXISTS (
    SELECT ps.skill_id FROM project_skill ps
    WHERE ps.project_id = 'P01'
      AND NOT EXISTS (SELECT 1 FROM student_skill ss
                      WHERE ss.usn = s.usn AND ss.skill_id = ps.skill_id)
)
AND s.usn NOT IN (
    SELECT tm.usn FROM team_member tm JOIN team t ON tm.team_id = t.team_id
    WHERE t.project_id = 'P01'
);

-- Q23. Find Team Alpha members who contributed to EVERY artifact of Team Alpha.
SELECT s.usn, s.name
FROM team_member tm
JOIN student s ON tm.usn = s.usn
WHERE tm.team_id = 'T01'
  AND NOT EXISTS (
      SELECT a.artifact_id FROM artifact a
      WHERE a.team_id = 'T01'
        AND NOT EXISTS (SELECT 1 FROM contribution c
                        WHERE c.artifact_id = a.artifact_id AND c.usn = tm.usn)
  );

-- ===================== F. SET OPERATIONS =====================

-- Q24. (UNION) List the email addresses of everyone on the platform, students and faculty.
SELECT name, email, 'student' AS role FROM student
UNION
SELECT name, email, 'faculty' AS role FROM faculty
ORDER BY role, name;

-- Q25. (INTERSECT) Find skills shared by S Arun Sanjay and Karthik M.
SELECT sk.name FROM student_skill ss JOIN skill sk ON ss.skill_id = sk.skill_id
WHERE ss.usn = '1RV24CY047'
INTERSECT
SELECT sk.name FROM student_skill ss JOIN skill sk ON ss.skill_id = sk.skill_id
WHERE ss.usn = '1RV24CY024';

-- Q26. (EXCEPT, skill gap) Which skills required by P01 does Karthik M not have yet?
SELECT sk.name FROM project_skill ps JOIN skill sk ON ps.skill_id = sk.skill_id
WHERE ps.project_id = 'P01'
EXCEPT
SELECT sk.name FROM student_skill ss JOIN skill sk ON ss.skill_id = sk.skill_id
WHERE ss.usn = '1RV24CY024';

-- ===================== G. VIEWS =====================

-- Q27. Create a faculty view of team progress (metadata only, no artifact content).
CREATE OR REPLACE VIEW faculty_team_progress AS
SELECT t.team_id, t.team_name, p.title AS project,
       COUNT(DISTINCT a.milestone_no) AS milestones_started,
       COUNT(DISTINCT a.artifact_id)  AS artifacts,
       COUNT(c.contribution_id)       AS contributions
FROM team t
JOIN project p ON t.project_id = p.project_id
LEFT JOIN artifact a     ON a.team_id = t.team_id
LEFT JOIN contribution c ON c.artifact_id = a.artifact_id
GROUP BY t.team_id, t.team_name, p.title;

SELECT * FROM faculty_team_progress ORDER BY team_id;

-- Q28. Create a portfolio view listing every project a student has worked on, across semesters.
CREATE OR REPLACE VIEW student_portfolio AS
SELECT s.usn, s.name, c.course_code, p.title AS project, t.team_name, tm.role, p.status
FROM student s
JOIN team_member tm ON s.usn = tm.usn
JOIN team t         ON tm.team_id = t.team_id
JOIN project p      ON t.project_id = p.project_id
JOIN course c       ON p.course_code = c.course_code;

SELECT course_code, project, team_name, role, status
FROM student_portfolio
WHERE usn = '1RV24CY047';

-- ===================== H. RECURSIVE QUERY (skill graph) =====================

-- Q29. List every skill that falls under 'Databases', at any depth.
WITH RECURSIVE sub_skills AS (
    SELECT skill_id, name, 0 AS depth FROM skill WHERE name = 'Databases'
    UNION ALL
    SELECT s.skill_id, s.name, ss.depth + 1
    FROM skill s
    JOIN sub_skills ss ON s.parent_skill_id = ss.skill_id
)
SELECT name, depth FROM sub_skills ORDER BY depth, name;

-- ===================== I. DDL AND DML =====================

-- Q30. Add a column to store each team's GitHub repository (must be unique).
ALTER TABLE team ADD COLUMN github_repo VARCHAR(100) UNIQUE;
UPDATE team SET github_repo = 'github.com/rvce-el/team-alpha' WHERE team_id = 'T01';
SELECT team_id, team_name, github_repo FROM team WHERE github_repo IS NOT NULL;

-- Q31. Register a new student and give them a skill.
INSERT INTO student VALUES ('1RV24CY090', 'Tanvi Joshi', 'tanvi.cy24@rvce.edu.in', 'CSE', 'A', 5, '2024-09-01');
INSERT INTO student_skill VALUES ('1RV24CY090', 'S02', 3);
SELECT s.name, sk.name AS skill, ss.level
FROM student_skill ss JOIN student s ON ss.usn = s.usn JOIN skill sk ON ss.skill_id = sk.skill_id
WHERE s.usn = '1RV24CY090';

-- Q32. Activate every planned project whose start date has arrived (as of 1 Nov 2026).
UPDATE project SET status = 'active'
WHERE status = 'planned' AND start_date <= '2026-11-01';
SELECT project_id, title, end_date, status FROM project ORDER BY project_id;

-- Q33. Remove the planned project P05 (its milestones are deleted automatically by ON DELETE CASCADE).
DELETE FROM project WHERE project_id = 'P05';
SELECT COUNT(*) AS p05_milestones_left FROM milestone WHERE project_id = 'P05';

-- Q34. Try to violate a CHECK constraint: a team with max_size 10 must be rejected.
-- Expected: ERROR  new row for relation "team" violates check constraint "team_max_size_check"
INSERT INTO team VALUES ('T99', 'P01', 'Team Overflow', 10, '2026-10-15', NULL);

-- ===================== J. TRIGGER AND TRANSACTION (Unit IV link) =====================

-- Q35. Create a trigger that stops a student from joining a team that is already full.
CREATE OR REPLACE FUNCTION check_team_capacity() RETURNS TRIGGER AS $$
DECLARE
    current_size INT;
    capacity     INT;
BEGIN
    SELECT max_size INTO capacity FROM team WHERE team_id = NEW.team_id FOR UPDATE;
    SELECT COUNT(*) INTO current_size FROM team_member WHERE team_id = NEW.team_id;
    IF current_size >= capacity THEN
        RAISE EXCEPTION 'Team % is full (% / %)', NEW.team_id, current_size, capacity;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_team_capacity
BEFORE INSERT ON team_member
FOR EACH ROW EXECUTE FUNCTION check_team_capacity();

-- Q36. Test the trigger: Team Alpha (T01) is full (4/4), so this insert must fail.
-- Expected: ERROR  Team T01 is full (4 / 4)
INSERT INTO team_member VALUES ('T01', '1RV24CY077', 'member', '2026-10-15');

-- Q37. Join the last free slot of Team Beta (T02) safely inside a transaction.
--      FOR UPDATE locks the team row, so two students cannot take the same last slot.
BEGIN;
SELECT team_id, max_size FROM team WHERE team_id = 'T02' FOR UPDATE;
INSERT INTO team_member VALUES ('T02', '1RV24CY077', 'member', '2026-10-15');
COMMIT;
SELECT t.team_name, COUNT(*) AS members, t.max_size
FROM team t JOIN team_member tm ON t.team_id = tm.team_id
WHERE t.team_id = 'T02' GROUP BY t.team_name, t.max_size;
```

## Appendix D — Component 4 short sheet ("What to Write") — SQL items 1–10

Arun's executed order: **2, 8, 5, 3, 6**.

### 1. Create tables with constraints (DDL)  — *Primary key, foreign keys with cascade, CHECK, UNIQUE, composite key*
```sql
CREATE TABLE student (
    usn      VARCHAR(10) PRIMARY KEY,
    name     VARCHAR(60) NOT NULL,
    email    VARCHAR(80) NOT NULL UNIQUE,
    section  CHAR(1)     NOT NULL,
    semester INT         NOT NULL CHECK (semester BETWEEN 1 AND 8)
);

CREATE TABLE team_member (
    team_id VARCHAR(5)  REFERENCES team(team_id) ON DELETE CASCADE,
    usn     VARCHAR(10) REFERENCES student(usn)  ON DELETE CASCADE,
    role    VARCHAR(20) NOT NULL DEFAULT 'member',
    PRIMARY KEY (team_id, usn)
);
```

### 2. List the members of every DBMS project team  — *JOIN*
```sql
SELECT t.team_name, s.name, tm.role
FROM team_member tm
JOIN team t    ON tm.team_id = t.team_id
JOIN student s ON tm.usn = s.usn
WHERE t.project_id = 'P01'
ORDER BY t.team_name, s.name;
```

### 3. Find students who are not in any team  — *LEFT OUTER JOIN + IS NULL*
```sql
SELECT s.usn, s.name
FROM student s
LEFT JOIN team_member tm ON s.usn = tm.usn
WHERE tm.usn IS NULL;
```

### 4. Find teams with more than 4 contributions  — *GROUP BY + HAVING*
```sql
SELECT a.team_id, COUNT(*) AS contributions
FROM contribution c
JOIN artifact a ON c.artifact_id = a.artifact_id
GROUP BY a.team_id
HAVING COUNT(*) > 4
ORDER BY contributions DESC;
```

### 5. Find students who contributed more than the average student  — *Nested subquery*
```sql
SELECT usn, COUNT(*) AS contributions
FROM contribution
GROUP BY usn
HAVING COUNT(*) > (SELECT AVG(cnt)
                   FROM (SELECT COUNT(*) AS cnt FROM contribution GROUP BY usn) x)
ORDER BY contributions DESC;
```

### 6. Find team members who contributed nothing to their own team ("ghost members")  — *Correlated NOT EXISTS*
```sql
SELECT tm.team_id, s.name
FROM team_member tm
JOIN student s ON tm.usn = s.usn
WHERE NOT EXISTS (
    SELECT 1
    FROM contribution c
    JOIN artifact a ON c.artifact_id = a.artifact_id
    WHERE c.usn = tm.usn AND a.team_id = tm.team_id
);
```

### 7. Teammate finder: students who have ALL the skills project P01 needs  — *Division (double NOT EXISTS)*
```sql
SELECT s.usn, s.name
FROM student s
WHERE NOT EXISTS (
    SELECT * FROM project_skill ps
    WHERE ps.project_id = 'P01'
      AND NOT EXISTS (
          SELECT * FROM student_skill ss
          WHERE ss.usn = s.usn AND ss.skill_id = ps.skill_id
      )
);
```

### 8. Skill gap: skills P01 needs that Karthik (1RV24CY024) does not have  — *EXCEPT (set difference)*
```sql
SELECT skill_id FROM project_skill WHERE project_id = 'P01'
EXCEPT
SELECT skill_id FROM student_skill WHERE usn = '1RV24CY024';
```

### 9. Create a faculty view of each team's progress  — *VIEW*
```sql
CREATE VIEW team_progress AS
SELECT t.team_name, COUNT(c.contribution_id) AS contributions
FROM team t
LEFT JOIN artifact a     ON a.team_id = t.team_id
LEFT JOIN contribution c ON c.artifact_id = a.artifact_id
GROUP BY t.team_name;

SELECT * FROM team_progress ORDER BY contributions DESC;
```

### 10. Update and delete  — *UPDATE, DELETE (cascade removes P05's milestones)*
```sql
UPDATE team SET max_size = 5 WHERE team_id = 'T02';

DELETE FROM project WHERE project_id = 'P05';
```

## Appendix E — MongoDB (`04_mongo.js`, mongosh, tested on MongoDB 8.2)

```javascript
// =====================================================================
//  Unified Experiential Learning Platform : NoSQL TEST QUERIES (Unit V)
//  MongoDB 8 / mongosh. Run:  mongosh < 04_mongo.js   (or paste query by query)
//  Collections:
//    notes          - Obsidian research notes (markdown + frontmatter)
//    github_events  - raw GitHub push events (one document per push)
//    portfolios     - one aggregate document per student (all projects)
// =====================================================================

use elp

db.notes.drop()
db.github_events.drop()
db.portfolios.drop()

// M1. Insert Obsidian notes for the teams (insertMany).
db.notes.insertMany([
  { note_id: "N01", team_id: "T01", author_usn: "1RV24CY047", title: "Synopsis outline",
    tags: ["synopsis", "planning"], links: ["Literature survey"], status: "final", version: 3,
    content: "Problem statement and proposed system for the unified EL platform.",
    created_at: ISODate("2026-10-09") },
  { note_id: "N02", team_id: "T01", author_usn: "1RV24CY011", title: "Literature survey",
    tags: ["research", "provenance"], links: ["Synopsis outline"], status: "final", version: 2,
    content: "Data provenance research tracks who changed each record and when.",
    created_at: ISODate("2026-10-07") },
  { note_id: "N03", team_id: "T01", author_usn: "1RV24CY024", title: "ER diagram decisions",
    tags: ["er-diagram", "design", "todo"], links: ["Normalization plan"], status: "draft", version: 1,
    content: "MILESTONE is a weak entity of PROJECT. TEAM_MEMBER resolves M:N.",
    created_at: ISODate("2026-10-29") },
  { note_id: "N04", team_id: "T01", author_usn: "1RV24CY047", title: "Normalization plan",
    tags: ["normalization", "design"], status: "draft", version: 1,
    content: "Start from the paper marks sheet and normalize up to BCNF.",
    created_at: ISODate("2026-11-02") },
  { note_id: "N05", team_id: "T02", author_usn: "1RV24CY041", title: "Requirements notes",
    tags: ["requirements", "todo"], links: [], status: "final", version: 2,
    content: "Functional and non functional requirements gathered from faculty.",
    created_at: ISODate("2026-10-24") },
  { note_id: "N06", team_id: "T02", author_usn: "1RV24CY052", title: "Synopsis review",
    tags: ["synopsis", "review"], status: "draft", version: 1,
    content: "Comments on the synopsis draft.",
    created_at: ISODate("2026-10-15") },
  { note_id: "N07", team_id: "T03", author_usn: "1RV24CY063", title: "Model baseline",
    tags: ["ml", "research"], links: ["Dataset survey"], status: "final", version: 4,
    content: "Baseline model and evaluation metrics.",
    created_at: ISODate("2026-10-20") }
])

// M2. Insert raw GitHub push events (embedded array of commits).
db.github_events.insertMany([
  { event_id: "E01", team_id: "T01", repo: "rvce-el/team-alpha", type: "push", pushed_at: ISODate("2026-10-31"),
    commits: [ { sha: "a1f3", author_usn: "1RV24CY047", message: "Add CREATE TABLE scripts", files_changed: 4, additions: 210 },
               { sha: "b7c2", author_usn: "1RV24CY024", message: "Add foreign keys",          files_changed: 2, additions: 45 } ] },
  { event_id: "E02", team_id: "T01", repo: "rvce-el/team-alpha", type: "push", pushed_at: ISODate("2026-11-01"),
    commits: [ { sha: "c9d1", author_usn: "1RV24CY024", message: "Add CHECK constraints",     files_changed: 1, additions: 30 },
               { sha: "d4e8", author_usn: "1RV24CY047", message: "Seed sample data",          files_changed: 2, additions: 160 },
               { sha: "e2a9", author_usn: "1RV24CY011", message: "Update ER diagram notes",   files_changed: 1, additions: 25 } ] },
  { event_id: "E03", team_id: "T03", repo: "rvce-el/team-gamma", type: "push", pushed_at: ISODate("2026-11-02"),
    commits: [ { sha: "f1b4", author_usn: "1RV24CY063", message: "Data loader",               files_changed: 3, additions: 120 },
               { sha: "a8c3", author_usn: "1RV24CY066", message: "Training loop",             files_changed: 2, additions: 95 } ] }
])

// M3. Insert one aggregate portfolio document per student (embedded projects + skills).
db.portfolios.insertMany([
  { usn: "1RV24CY047", name: "S Arun Sanjay", semester: 5,
    projects: [ { course: "CD252IA", title: "DBMS Mini Project",          role: "lead",   status: "active",    skills: ["SQL", "MongoDB", "Python"] },
                { course: "CD253IA", title: "AIML Experiential Learning", role: "member", status: "active",    skills: ["Python", "Machine Learning"] },
                { course: "CD243AI", title: "ADLD Hardware Project",      role: "lead",   status: "completed", skills: ["Digital Logic"] } ] },
  { usn: "1RV24CY011", name: "Aditi Rao", semester: 5,
    projects: [ { course: "CD252IA", title: "DBMS Mini Project",     role: "member", status: "active",    skills: ["SQL", "Normalization"] },
                { course: "CD243AI", title: "ADLD Hardware Project", role: "member", status: "completed", skills: ["Digital Logic"] } ] },
  { usn: "1RV24CY024", name: "Karthik M", semester: 5,
    projects: [ { course: "CD252IA", title: "DBMS Mini Project", role: "member", status: "active", skills: ["SQL"] },
                { course: "CD254TA", title: "OS Mini Project",   role: "lead",   status: "active", skills: ["Operating Systems", "Python"] } ] },
  { usn: "1RV24CY063", name: "Priya Menon", semester: 5,
    projects: [ { course: "CD253IA", title: "AIML Experiential Learning", role: "lead", status: "active", skills: ["Python", "Machine Learning", "Deep Learning"] } ] },
  { usn: "1RV24CY077", name: "Nikhil Bhat", semester: 5, projects: [] }
])

// ===================== A. FIND, OPERATORS, PROJECTION =====================

// M4. Find all notes written by S Arun Sanjay.
db.notes.find({ author_usn: "1RV24CY047" }, { _id: 0, title: 1, status: 1 })

// M5. Find notes tagged "design" (matching a value inside an array).
db.notes.find({ tags: "design" }, { _id: 0, title: 1, tags: 1 })

// M6. Show the 3 most recent notes: title and date only, newest first.
db.notes.find({}, { _id: 0, title: 1, created_at: 1 }).sort({ created_at: -1 }).limit(3)

// M7. Final notes of Team Alpha (T01) created after 1 Oct 2026 ($and, $gt).
db.notes.find({ $and: [ { team_id: "T01" }, { status: "final" }, { created_at: { $gt: ISODate("2026-10-01") } } ] },
              { _id: 0, title: 1, created_at: 1 })

// M8. Notes whose title contains "synopsis", ignoring case ($regex).
db.notes.find({ title: { $regex: "synopsis", $options: "i" } }, { _id: 0, team_id: 1, title: 1 })

// M9. Notes that are either tagged "normalization" or written by Karthik M ($or).
db.notes.find({ $or: [ { tags: "normalization" }, { author_usn: "1RV24CY024" } ] }, { _id: 0, title: 1, author_usn: 1 })

// M10. Notes with version 2 or more that belong to Team Alpha or Team Gamma ($gte, $in).
db.notes.find({ version: { $gte: 2 }, team_id: { $in: ["T01", "T03"] } }, { _id: 0, team_id: 1, title: 1, version: 1 })

// M11. Notes that have no "links" field at all ($exists).
db.notes.find({ links: { $exists: false } }, { _id: 0, title: 1 })

// M12. Portfolios of students who worked on a DBMS (CD252IA) project (dot notation into an array).
db.portfolios.find({ "projects.course": "CD252IA" }, { _id: 0, usn: 1, name: 1 })

// M13. Push events containing a commit by Arun that changed 3 or more files ($elemMatch).
db.github_events.find({ commits: { $elemMatch: { author_usn: "1RV24CY047", files_changed: { $gte: 3 } } } },
                      { _id: 0, event_id: 1, repo: 1 })

// M14. Count the notes of Team Alpha, and list the distinct tags used anywhere.
db.notes.countDocuments({ team_id: "T01" })
db.notes.distinct("tags")

// ===================== B. UPDATE AND DELETE =====================

// M15. Finalise the ER diagram note: set status, increase version, add a tag ($set, $inc, $push).
db.notes.updateOne({ note_id: "N03" }, { $set: { status: "final" }, $inc: { version: 1 }, $push: { tags: "reviewed" } })
db.notes.find({ note_id: "N03" }, { _id: 0, title: 1, status: 1, version: 1, tags: 1 })

// M16. Remove the "todo" tag from every note ($pull with updateMany).
db.notes.updateMany({ tags: "todo" }, { $pull: { tags: "todo" } })

// M17. Delete all draft notes of Team Beta (T02).
db.notes.deleteMany({ team_id: "T02", status: "draft" })
db.notes.countDocuments()

// ===================== C. AGGREGATION PIPELINE =====================

// M18. Total commits and lines added by each student across all pushes ($unwind, $group, $sort).
db.github_events.aggregate([
  { $unwind: "$commits" },
  { $group: { _id: "$commits.author_usn", commits: { $sum: 1 }, lines_added: { $sum: "$commits.additions" } } },
  { $sort: { lines_added: -1 } }
])

// M19. Number of notes and average version per team ($group, $avg, $round).
db.notes.aggregate([
  { $group: { _id: "$team_id", notes: { $sum: 1 }, avg_version: { $avg: "$version" } } },
  { $project: { notes: 1, avg_version: { $round: ["$avg_version", 1] } } },
  { $sort: { _id: 1 } }
])

// M20. Top 3 most used tags across all notes.
db.notes.aggregate([
  { $unwind: "$tags" },
  { $group: { _id: "$tags", uses: { $sum: 1 } } },
  { $sort: { uses: -1, _id: 1 } },
  { $limit: 3 }
])

// M21. Show each final note with its author's name, joined from portfolios ($lookup).
db.notes.aggregate([
  { $match: { status: "final" } },
  { $lookup: { from: "portfolios", localField: "author_usn", foreignField: "usn", as: "author" } },
  { $unwind: "$author" },
  { $project: { _id: 0, title: 1, author: "$author.name" } }
])

// M22. Skill frequency across all student portfolios (double $unwind), for cohort skill analytics.
db.portfolios.aggregate([
  { $unwind: "$projects" },
  { $unwind: "$projects.skills" },
  { $group: { _id: "$projects.skills", students: { $addToSet: "$usn" } } },
  { $project: { skill: "$_id", _id: 0, students: { $size: "$students" } } },
  { $sort: { students: -1, skill: 1 } }
])

// M23. Number of projects per student, including students with none ($size).
db.portfolios.aggregate([
  { $project: { _id: 0, name: 1, project_count: { $size: "$projects" } } },
  { $sort: { project_count: -1 } }
])

// ===================== D. INDEXES =====================

// M24. Create a compound index for "notes of a team, newest first", and a text index for search.
db.notes.createIndex({ team_id: 1, created_at: -1 })
db.notes.createIndex({ title: "text", content: "text" })

// M25. Full-text search for notes about "provenance" using the text index.
db.notes.find({ $text: { $search: "provenance" } }, { _id: 0, title: 1 })
```

### E.1 Short-sheet MongoDB queries M1–M5 (OneCompiler) with outputs on fresh data

**M1. Insert a research note** — *insertOne*
```javascript
db.notes.insertOne({
  note_id: "N08", team_id: "T01", author_usn: "1RV24CY047",
  title: "DFD level 0", tags: ["dfd", "design"],
  status: "draft", version: 1, created_at: ISODate("2026-11-10")
})
```
Output:
```
{
  acknowledged: true,
  insertedId: ObjectId('...')
}
```

**M2. Team Alpha's notes after 1 Oct 2026, newest first, title and status only** — *find + operator + projection + sort*
```javascript
db.notes.find(
  { team_id: "T01", created_at: { $gt: ISODate("2026-10-01") } },
  { _id: 0, title: 1, status: 1 }
).sort({ created_at: -1 })
```
Output:
```
[
  { title: 'Normalization plan', status: 'draft' },
  { title: 'ER diagram decisions', status: 'draft' },
  { title: 'Synopsis outline', status: 'final' },
  { title: 'Literature survey', status: 'final' }
]
```

**M3. Finalise a note: change status, bump version, add a tag** — *updateOne with $set, $inc, $push*
```javascript
db.notes.updateOne(
  { note_id: "N03" },
  { $set: { status: "final" }, $inc: { version: 1 }, $push: { tags: "reviewed" } }
)
```
Output:
```
{
  acknowledged: true,
  insertedId: null,
  matchedCount: 1,
  modifiedCount: 1,
  upsertedCount: 0
}
```

**M4. Commits and lines added by each student** — *aggregate: $unwind, $group, $sort*
```javascript
db.github_events.aggregate([
  { $unwind: "$commits" },
  { $group: { _id: "$commits.author_usn",
              commits: { $sum: 1 },
              lines_added: { $sum: "$commits.additions" } } },
  { $sort: { lines_added: -1 } }
])
```
Output:
```
[
  { _id: '1RV24CY047', commits: 2, lines_added: 370 },
  { _id: '1RV24CY063', commits: 1, lines_added: 120 },
  { _id: '1RV24CY066', commits: 1, lines_added: 95 },
  { _id: '1RV24CY024', commits: 2, lines_added: 75 },
  { _id: '1RV24CY011', commits: 1, lines_added: 25 }
]
```

**M5. Show each final note with its author's name** — *aggregate: $lookup (join two collections)*
```javascript
db.notes.aggregate([
  { $match: { status: "final" } },
  { $lookup: { from: "portfolios", localField: "author_usn",
               foreignField: "usn", as: "author" } },
  { $unwind: "$author" },
  { $project: { _id: 0, title: 1, author: "$author.name" } }
])
```
Output:
```
[
  { title: 'Synopsis outline', author: 'S Arun Sanjay' },
  { title: 'Literature survey', author: 'Aditi Rao' },
  { title: 'Model baseline', author: 'Priya Menon' }
]
```

## Appendix F — Normalization starting point (the paper marks sheet)

The RVCE lab evaluation sheet is the unnormalized relation to normalize (Component 6). Its fields:

- Header (once per sheet): **Student Name, USN, Section, Mini Project Title**
- Repeating group (one row per submission): **Sl. No., Submission (with max marks), Marks, Signature of Lab Faculty**
- Submissions: Synopsis (5), Requirement Specification (5), ER Diagram (10), Test (20), DFD Level 0/1/2 (10), Normalized tables up to 3NF (10), Midterm Report (20), Design of Forms, Security & Validation (10), Demo & Draft Report (30); "Total 120 reduced to 30"; Innovative Experiment (10); CIE Project Demo & Final Report Submission (10); "Lab CIE Marks (30+10+10)"

Plan: UNF (repeating submission group) → 1NF (one row per USN × submission) → 2NF (separate student and project-title facts that depend on part of the key; submission max marks depend only on the submission) → 3NF (remove transitive dependencies, e.g. section/team facts) → BCNF; derive totals (120→30, 50) as computed values or views rather than stored columns; prove lossless join and dependency preservation.

## Appendix G — Supabase inspection commands

```sql
-- all rows of a table
SELECT * FROM student;

-- list tables
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' ORDER BY table_name;

-- columns of a table (DESCRIBE)
SELECT column_name, data_type, is_nullable
FROM information_schema.columns WHERE table_name = 'student';

-- constraints of a table
SELECT constraint_name, constraint_type
FROM information_schema.table_constraints WHERE table_name = 'team_member';
```

Expected row counts after Appendix B: student 12, faculty 4, course 4, project 5, team 5, team_member 19, skill 14, student_skill 46, project_skill 12, milestone 13, artifact 12, contribution 28, artifact_chunk 7.
Supabase UI: sidebar grid icon = Table Editor; Database → Schema Visualizer = live ER view.

## Appendix H — Verified outputs of every query in Appendix C and E

Produced by executing the files in order on PostgreSQL 16 and MongoDB 8.2.

**Q1. List all Section A students of Semester 5 in alphabetical order.**
```
    usn     |     name      |          email           
------------+---------------+--------------------------
 1RV24CY011 | Aditi Rao     | aditi.cy24@rvce.edu.in
 1RV24CY082 | Ananya Gowda  | ananya.cy24@rvce.edu.in
 1RV24CY024 | Karthik M     | karthik.cy24@rvce.edu.in
 1RV24CY033 | Meera Iyer    | meera.cy24@rvce.edu.in
 1RV24CY041 | Rahul Nair    | rahul.cy24@rvce.edu.in
 1RV24CY047 | S Arun Sanjay | arun.cy24@rvce.edu.in
(6 rows)
```

**Q2. Find all projects whose title contains the word 'DBMS'.**
```
 project_id |           title            | status  
------------+----------------------------+---------
 P01        | DBMS Mini Project          | active
 P05        | DBMS Innovative Experiment | planned
(2 rows)
```

**Q3. List milestones due between 1 Nov 2026 and 30 Nov 2026, earliest first.**
```
 project_id | milestone_no |       title       |  deadline  
------------+--------------+-------------------+------------
 P01        |            3 | ER Diagram        | 2026-11-05
 P01        |            4 | DFD               | 2026-11-15
 P02        |            2 | Model Training    | 2026-11-20
 P05        |            1 | Experiment Plan   | 2026-11-20
 P01        |            5 | Normalized Tables | 2026-11-25
(5 rows)
```

**Q4. List the distinct types of artifacts submitted from GitHub or Obsidian.**
```
 type |  source  
------+----------
 code | github
 note | obsidian
(2 rows)
```

**Q5. Show every team with its project title and the course it belongs to.**
```
 team_id |  team_name   |          project           |                    course                    
---------+--------------+----------------------------+----------------------------------------------
 T01     | Team Alpha   | DBMS Mini Project          | Database Management Systems
 T02     | Team Beta    | DBMS Mini Project          | Database Management Systems
 T03     | Team Gamma   | AIML Experiential Learning | Artificial Intelligence and Machine Learning
 T04     | Team Delta   | OS Mini Project            | Operating Systems
 T05     | Team Epsilon | ADLD Hardware Project      | Analog and Digital Logic Design
(5 rows)
```

**Q6. List the members of every DBMS (CD252IA) project team with their role.**
```
 team_name  |    usn     |     name      |  role  
------------+------------+---------------+--------
 Team Alpha | 1RV24CY047 | S Arun Sanjay | lead
 Team Alpha | 1RV24CY011 | Aditi Rao     | member
 Team Alpha | 1RV24CY024 | Karthik M     | member
 Team Alpha | 1RV24CY033 | Meera Iyer    | member
 Team Beta  | 1RV24CY041 | Rahul Nair    | lead
 Team Beta  | 1RV24CY052 | Sneha Patil   | member
 Team Beta  | 1RV24CY058 | Vikram Shetty | member
(7 rows)
```

**Q7. (Outer join) Find students who are not part of any team.**
```
    usn     |     name     
------------+--------------
 1RV24CY077 | Nikhil Bhat
 1RV24CY082 | Ananya Gowda
(2 rows)
```

**Q8. (Self join) Show every skill with the name of its parent skill.**
```
       skill       |   parent_skill   
-------------------+------------------
 Databases         | 
 Digital Logic     | 
 Machine Learning  | 
 Operating Systems | 
 Programming       | 
 NoSQL             | Databases
 Normalization     | Databases
 SQL               | Databases
 React             | JavaScript
 Deep Learning     | Machine Learning
 MongoDB           | NoSQL
 JavaScript        | Programming
 Python            | Programming
 Transactions      | SQL
(14 rows)
```

**Q9. Show which faculty member handles each active project.**
```
          project           |      faculty       |     designation     
----------------------------+--------------------+---------------------
 DBMS Mini Project          | Dr. Ramesh Babu    | Professor
 AIML Experiential Learning | Dr. Lakshmi Prasad | Associate Professor
 OS Mini Project            | Prof. Kavitha S    | Assistant Professor
(3 rows)
```

**Q10. Count the contributions made by each student, highest first.**
```
      name      | contributions 
----------------+---------------
 S Arun Sanjay  |             8
 Aditi Rao      |             5
 Karthik M      |             3
 Priya Menon    |             3
 Rahul Nair     |             3
 Divya Hegde    |             2
 Meera Iyer     |             1
 Rohan Kulkarni |             1
 Sneha Patil    |             1
 Vikram Shetty  |             1
 Ananya Gowda   |             0
 Nikhil Bhat    |             0
(12 rows)
```

**Q11. Show contributions per student within Team Alpha (T01) only.**
```
     name      | contributions 
---------------+---------------
 S Arun Sanjay |             5
 Aditi Rao     |             4
 Karthik M     |             2
(3 rows)
```

**Q12. Find teams that have more than 4 contributions in total.**
```
 team_id | total_contributions 
---------+---------------------
 T01     |                  11
 T03     |                   6
 T05     |                   5
(3 rows)
```

**Q13. Show the total marks available in each project (sum of milestone marks).**
```
           title            | milestones | total_marks 
----------------------------+------------+-------------
 AIML Experiential Learning |          3 |          50
 DBMS Mini Project          |          5 |          40
 OS Mini Project            |          2 |          30
 ADLD Hardware Project      |          2 |          30
 DBMS Innovative Experiment |          1 |          10
(5 rows)
```

**Q14. Show the number of members and free slots in each team.**
```
  team_name   | max_size | members | free_slots 
--------------+----------+---------+------------
 Team Alpha   |        4 |       4 |          0
 Team Beta    |        4 |       3 |          1
 Team Gamma   |        5 |       5 |          0
 Team Delta   |        4 |       3 |          1
 Team Epsilon |        4 |       4 |          0
(5 rows)
```

**Q15. Count contributions of each type (research, design, code, ...).**
```
 contribution_type | total 
-------------------+-------
 documentation     |     7
 research          |     6
 design            |     6
 review            |     5
 code              |     4
(5 rows)
```

**Q16. Find students whose contribution count is above the average.**
```
     name      | contributions 
---------------+---------------
 S Arun Sanjay |             8
 Aditi Rao     |             5
 Priya Menon   |             3
 Karthik M     |             3
 Rahul Nair    |             3
(5 rows)
```

**Q17. (Ghost members) Find team members who have made NO contribution to their own team's work.**
```
 team_name  |     name      
------------+---------------
 Team Alpha | Meera Iyer
 Team Beta  | Vikram Shetty
(2 rows)
```

**Q18. (Correlated) Find the top contributor in each team.**
```
 team_id |    usn     | contributions 
---------+------------+---------------
 T01     | 1RV24CY047 |             5
 T02     | 1RV24CY041 |             2
 T03     | 1RV24CY063 |             2
 T04     | 1RV24CY024 |             1
 T04     | 1RV24CY058 |             1
 T04     | 1RV24CY071 |             1
 T05     | 1RV24CY047 |             2
(7 rows)
```

**Q19. Find projects that have no team registered yet.**
```
 project_id |           title            
------------+----------------------------
 P05        | DBMS Innovative Experiment
(1 row)
```

**Q20. Find milestones of the DBMS project (P01) for which Team Alpha has not submitted any artifact.**
```
 milestone_no |       title       |  deadline  
--------------+-------------------+------------
            4 | DFD               | 2026-11-15
            5 | Normalized Tables | 2026-11-25
(2 rows)
```

**Q21. (Teammate finder) Find students who have ALL the skills required by the DBMS project P01.**
```
    usn     |     name      
------------+---------------
 1RV24CY047 | S Arun Sanjay
 1RV24CY011 | Aditi Rao
 1RV24CY041 | Rahul Nair
 1RV24CY077 | Nikhil Bhat
(4 rows)
```

**Q22. Same as Q21, but only students who are NOT yet in any P01 team (available teammates).**
```
    usn     |    name     
------------+-------------
 1RV24CY077 | Nikhil Bhat
(1 row)
```

**Q23. Find Team Alpha members who contributed to EVERY artifact of Team Alpha.**
```
    usn     |     name      
------------+---------------
 1RV24CY047 | S Arun Sanjay
(1 row)
```

**Q24. (UNION) List the email addresses of everyone on the platform, students and faculty.**
```
        name        |          email           |  role   
--------------------+--------------------------+---------
 Dr. Lakshmi Prasad | lakshmi@rvce.edu.in      | faculty
 Dr. Ramesh Babu    | ramesh@rvce.edu.in       | faculty
 Prof. Kavitha S    | kavitha@rvce.edu.in      | faculty
 Prof. Suresh N     | suresh@rvce.edu.in       | faculty
 Aditi Rao          | aditi.cy24@rvce.edu.in   | student
 Ananya Gowda       | ananya.cy24@rvce.edu.in  | student
 Divya Hegde        | divya.cy24@rvce.edu.in   | student
 Karthik M          | karthik.cy24@rvce.edu.in | student
 Meera Iyer         | meera.cy24@rvce.edu.in   | student
 Nikhil Bhat        | nikhil.cy24@rvce.edu.in  | student
 Priya Menon        | priya.cy24@rvce.edu.in   | student
 Rahul Nair         | rahul.cy24@rvce.edu.in   | student
 Rohan Kulkarni     | rohan.cy24@rvce.edu.in   | student
 S Arun Sanjay      | arun.cy24@rvce.edu.in    | student
 Sneha Patil        | sneha.cy24@rvce.edu.in   | student
 Vikram Shetty      | vikram.cy24@rvce.edu.in  | student
(16 rows)
```

**Q25. (INTERSECT) Find skills shared by S Arun Sanjay and Karthik M.**
```
  name  
--------
 Python
 SQL
(2 rows)
```

**Q26. (EXCEPT, skill gap) Which skills required by P01 does Karthik M not have yet?**
```
     name      
---------------
 Normalization
 MongoDB
(2 rows)
```

**Q27. Create a faculty view of team progress (metadata only, no artifact content).**
```
 team_id |  team_name   |          project           | milestones_started | artifacts | contributions 
---------+--------------+----------------------------+--------------------+-----------+---------------
 T01     | Team Alpha   | DBMS Mini Project          |                  3 |         5 |            11
 T02     | Team Beta    | DBMS Mini Project          |                  2 |         2 |             3
 T03     | Team Gamma   | AIML Experiential Learning |                  2 |         2 |             6
 T04     | Team Delta   | OS Mini Project            |                  1 |         1 |             3
 T05     | Team Epsilon | ADLD Hardware Project      |                  2 |         2 |             5
(5 rows)
```

**Q28. Create a portfolio view listing every project a student has worked on, across semesters.**
```
 course_code |          project           |  team_name   |  role  |  status   
-------------+----------------------------+--------------+--------+-----------
 CD252IA     | DBMS Mini Project          | Team Alpha   | lead   | active
 CD253IA     | AIML Experiential Learning | Team Gamma   | member | active
 CD243AI     | ADLD Hardware Project      | Team Epsilon | lead   | completed
(3 rows)
```

**Q29. List every skill that falls under 'Databases', at any depth.**
```
     name      | depth 
---------------+-------
 Databases     |     0
 NoSQL         |     1
 Normalization |     1
 SQL           |     1
 MongoDB       |     2
 Transactions  |     2
(6 rows)
```

**Q30. Add a column to store each team's GitHub repository (must be unique).**
```
 team_id | team_name  |          github_repo          
---------+------------+-------------------------------
 T01     | Team Alpha | github.com/rvce-el/team-alpha
(1 row)
```

**Q31. Register a new student and give them a skill.**
```
    name     | skill | level 
-------------+-------+-------
 Tanvi Joshi | SQL   |     3
(1 row)
```

**Q32. Activate every planned project whose start date has arrived (as of 1 Nov 2026).**
```
 project_id |           title            |  end_date  |  status   
------------+----------------------------+------------+-----------
 P01        | DBMS Mini Project          | 2026-12-15 | active
 P02        | AIML Experiential Learning | 2026-12-20 | active
 P03        | OS Mini Project            | 2026-12-10 | active
 P04        | ADLD Hardware Project      | 2026-05-15 | completed
 P05        | DBMS Innovative Experiment | 2026-12-15 | active
(5 rows)
```

**Q33. Remove the planned project P05 (its milestones are deleted automatically by ON DELETE CASCADE).**
```
 p05_milestones_left 
---------------------
                   0
(1 row)
```

**Q34. Try to violate a CHECK constraint: a team with max_size 10 must be rejected.**
```
ERROR:  new row for relation "team" violates check constraint "team_max_size_check"
DETAIL:  Failing row contains (T99, P01, Team Overflow, 10, 2026-10-15, null).
```

**Q35. Create a trigger that stops a student from joining a team that is already full.**
```
Statement executed successfully (no rows returned).
```

**Q36. Test the trigger: Team Alpha (T01) is full (4/4), so this insert must fail.**
```
ERROR:  Team T01 is full (4 / 4)
CONTEXT:  PL/pgSQL function check_team_capacity() line 9 at RAISE
```

**Q37. Join the last free slot of Team Beta (T02) safely inside a transaction.**
```
 team_id | max_size 
---------+----------
 T02     |        4
(1 row)

 team_name | members | max_size 
-----------+---------+----------
 Team Beta |       4 |        4
(1 row)
```

**M1. Insert Obsidian notes for the teams (insertMany).**
```
{ acknowledged: true, insertedCount: 7 }
```

**M2. Insert raw GitHub push events (embedded array of commits).**
```
{ acknowledged: true, insertedCount: 3 }
```

**M3. Insert one aggregate portfolio document per student (embedded projects + skills).**
```
{ acknowledged: true, insertedCount: 5 }
```

**M4. Find all notes written by S Arun Sanjay.**
```
[
  { title: 'Synopsis outline', status: 'final' },
  { title: 'Normalization plan', status: 'draft' }
]
```

**M5. Find notes tagged "design" (matching a value inside an array).**
```
[
  {
    title: 'ER diagram decisions',
    tags: [ 'er-diagram', 'design', 'todo' ]
  },
  { title: 'Normalization plan', tags: [ 'normalization', 'design' ] }
]
```

**M6. Show the 3 most recent notes: title and date only, newest first.**
```
[
  {
    title: 'Normalization plan',
    created_at: ISODate('2026-11-02T00:00:00.000Z')
  },
  {
    title: 'ER diagram decisions',
    created_at: ISODate('2026-10-29T00:00:00.000Z')
  },
  {
    title: 'Requirements notes',
    created_at: ISODate('2026-10-24T00:00:00.000Z')
  }
]
```

**M7. Final notes of Team Alpha (T01) created after 1 Oct 2026 ($and, $gt).**
```
[
  {
    title: 'Synopsis outline',
    created_at: ISODate('2026-10-09T00:00:00.000Z')
  },
  {
    title: 'Literature survey',
    created_at: ISODate('2026-10-07T00:00:00.000Z')
  }
]
```

**M8. Notes whose title contains "synopsis", ignoring case ($regex).**
```
[
  { team_id: 'T01', title: 'Synopsis outline' },
  { team_id: 'T02', title: 'Synopsis review' }
]
```

**M9. Notes that are either tagged "normalization" or written by Karthik M ($or).**
```
[
  { author_usn: '1RV24CY024', title: 'ER diagram decisions' },
  { author_usn: '1RV24CY047', title: 'Normalization plan' }
]
```

**M10. Notes with version 2 or more that belong to Team Alpha or Team Gamma ($gte, $in).**
```
[
  { team_id: 'T01', title: 'Synopsis outline', version: 3 },
  { team_id: 'T01', title: 'Literature survey', version: 2 },
  { team_id: 'T03', title: 'Model baseline', version: 4 }
]
```

**M11. Notes that have no "links" field at all ($exists).**
```
[ { title: 'Normalization plan' }, { title: 'Synopsis review' } ]
```

**M12. Portfolios of students who worked on a DBMS (CD252IA) project (dot notation into an array).**
```
[
  { usn: '1RV24CY047', name: 'S Arun Sanjay' },
  { usn: '1RV24CY011', name: 'Aditi Rao' },
  { usn: '1RV24CY024', name: 'Karthik M' }
]
```

**M13. Push events containing a commit by Arun that changed 3 or more files ($elemMatch).**
```
[ { event_id: 'E01', repo: 'rvce-el/team-alpha' } ]
```

**M14. Count the notes of Team Alpha, and list the distinct tags used anywhere.**
```
4
[
  'design',       'er-diagram',
  'ml',           'normalization',
  'planning',     'provenance',
  'requirements', 'research',
  'review',       'synopsis',
  'todo'
]
```

**M15. Finalise the ER diagram note: set status, increase version, add a tag ($set, $inc, $push).**
```
{
  acknowledged: true,
  insertedId: null,
  matchedCount: 1,
  modifiedCount: 1,
  upsertedCount: 0
}
[
  {
    title: 'ER diagram decisions',
    tags: [ 'er-diagram', 'design', 'todo', 'reviewed' ],
    status: 'final',
    version: 2
  }
]
```

**M16. Remove the "todo" tag from every note ($pull with updateMany).**
```
{
  acknowledged: true,
  insertedId: null,
  matchedCount: 2,
  modifiedCount: 2,
  upsertedCount: 0
}
```

**M17. Delete all draft notes of Team Beta (T02).**
```
{ acknowledged: true, deletedCount: 1 }
6
```

**M18. Total commits and lines added by each student across all pushes ($unwind, $group, $sort).**
```
[
  { _id: '1RV24CY047', commits: 2, lines_added: 370 },
  { _id: '1RV24CY063', commits: 1, lines_added: 120 },
  { _id: '1RV24CY066', commits: 1, lines_added: 95 },
  { _id: '1RV24CY024', commits: 2, lines_added: 75 },
  { _id: '1RV24CY011', commits: 1, lines_added: 25 }
]
```

**M19. Number of notes and average version per team ($group, $avg, $round).**
```
[
  { _id: 'T01', notes: 4, avg_version: 2 },
  { _id: 'T02', notes: 1, avg_version: 2 },
  { _id: 'T03', notes: 1, avg_version: 4 }
]
```

**M20. Top 3 most used tags across all notes.**
```
[
  { _id: 'design', uses: 2 },
  { _id: 'research', uses: 2 },
  { _id: 'er-diagram', uses: 1 }
]
```

**M21. Show each final note with its author's name, joined from portfolios ($lookup).**
```
[
  { title: 'Synopsis outline', author: 'S Arun Sanjay' },
  { title: 'Literature survey', author: 'Aditi Rao' },
  { title: 'ER diagram decisions', author: 'Karthik M' },
  { title: 'Model baseline', author: 'Priya Menon' }
]
```

**M22. Skill frequency across all student portfolios (double $unwind), for cohort skill analytics.**
```
[
  { skill: 'Python', students: 3 },
  { skill: 'SQL', students: 3 },
  { skill: 'Digital Logic', students: 2 },
  { skill: 'Machine Learning', students: 2 },
  { skill: 'Deep Learning', students: 1 },
  { skill: 'MongoDB', students: 1 },
  { skill: 'Normalization', students: 1 },
  { skill: 'Operating Systems', students: 1 }
]
```

**M23. Number of projects per student, including students with none ($size).**
```
[
  { name: 'S Arun Sanjay', project_count: 3 },
  { name: 'Aditi Rao', project_count: 2 },
  { name: 'Karthik M', project_count: 2 },
  { name: 'Priya Menon', project_count: 1 },
  { name: 'Nikhil Bhat', project_count: 0 }
]
```

**M24. Create a compound index for "notes of a team, newest first", and a text index for search.**
```
team_id_1_created_at_-1
title_text_content_text
```

**M25. Full-text search for notes about "provenance" using the text index.**
```
[ { title: 'Literature survey' } ]
```
