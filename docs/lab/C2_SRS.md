---
title-meta: "Software Requirements Specification: Unified Experiential Learning and Project Intelligence Platform (Countersign)"
author-meta: "S Arun Sanjay (1RV24CY047)"
subject: "CD252IA Database Management Systems, Lab Component 2"
lang: en-GB
---

::: cover
**RV College of Engineering®, Bengaluru – 59**

**Department of Computer Science and Engineering**

**DATABASE MANAGEMENT SYSTEMS (CD252IA)**

**Lab Component 2: Requirement Specification**

&nbsp;

**SOFTWARE REQUIREMENTS SPECIFICATION**

**Unified Experiential Learning and Project Intelligence Platform**

(product name: Countersign)

&nbsp;

| USN | Name |
|:--|:--|
| 1RV24CY047 | S Arun Sanjay |

&nbsp;

Version 1.3, 19 November 2026

Requirement status frozen as of 19 November 2026 (see §1.5)
:::

::: toc
:::

# Document control

| | |
|:--|:----------|
| **Institution** | RV College of Engineering, Bengaluru 560059. Department of Computer Science and Engineering |
| **Course** | Database Management Systems (CD252IA), Semester V. Lab Component 2: Requirement Specification (5 marks) |
| **Official title** | Unified Experiential Learning and Project Intelligence Platform |
| **Product name** | Countersign |
| **Author** | S Arun Sanjay (1RV24CY047), sole author: Countersign is a solo project |
| **Standard** | ISO/IEC/IEEE 29148:2018, *Systems and software engineering: Life cycle processes: Requirements engineering* (SRS content). IEEE Std 830-1998, which 29148 superseded, is kept only as the source of the familiar section layout (1 Introduction, 2 Overall description, 3 Specific requirements). |
| **Format** | RVCE report conventions as used in the Synopsis (Component 1): the RVCE header block on the cover, the official title, team table by USN, A4. The official RVCE template file is not in the repository (open item in `docs/PLAN.md` §8), so the body styles (Times New Roman, 11 pt PDF / 12 pt DOCX) follow the Synopsis as far as it is known. |

**Revision history**

| Version | Date | Author(s) | Change |
|:--|:--|:--|:----------|
| 0.1 | Oct 2026 | S Arun Sanjay | Requirements as stated in the Synopsis (Component 1): FR1–FR11, seven NFR headings, software and hardware list. |
| 1.0 | 4 Nov 2026 | S Arun Sanjay | Requirements refined to the built data layer (migrations 0001–0004). Added: comparison with existing systems, explicit non-goals, privacy tiers, sub-requirements FRx.y, FR → database object → test traceability, measurable NFR targets, versioned software and hardware requirements. |
| 1.1 | 4 Nov 2026 | S Arun Sanjay | Examiner review (21 items, Appendix B). Corrected: data independence and the three-schema table; FK delete actions (FR10); faculty and administrator privileges (U2, U3, C6, FR7, §3.4); claim and visibility state machines; performance figures; verification claims. Re-derived every status against the repository and re-ran every test suite (§4). Recorded the Synopsis requirements that were deferred or descoped (§2.8). Redrawn Figures 1–5 (Figure 2 split into 2a and 2b) for legibility. Added the known-defects register (§3.8). |
| 1.2 | 5 Nov 2026 | S Arun Sanjay | Statuses re-derived after migrations 0005 (ingest inbox, hybrid search, Realtime broadcast, two FK indexes) and 0006 (worker failure bookkeeping), the Edge Function `github-webhook`, the ingest worker and `POST /ask`. Now **Implemented**: FR5 (GitHub and Obsidian ingestion, FR5.5), FR7.9 (live notices through Realtime), FR9.3 and FR9.4 (permission-safe keyword/hybrid retrieval and extractive cited answers), FR10.2 (portfolio rebuild), FR11 (immutable `note_versions`, consistency report at commit level). Still planned: model-written answers and embeddings (no Anthropic or Voyage key yet), the student-facing portfolio export, verified-skill derivation. Traceability (§3.3) extended with the new tables, functions and test files `05_ingest.sql` and `06_ingest_worker.sql`; §4 re-run summary; D3 closed; Figures 1, 2a, 2b and 3 redrawn. Change list: Appendix C. |
| 1.3 | 19 Nov 2026 | S Arun Sanjay | The project is now a solo project: the author list and the demo data (team T00 has one member) were updated. Migration 0007 (strict marks) added: FR7.3 holds on every write path. The test gates of §4 re-run on 19 Nov 2026 (710 pgTAP assertions in 7 files, 66 API tests, 44 e2e tests); migrations 0001–0007 verified as applied on the cloud project. §2.4 updated (race arena page, resilient worker loop). Change list: Appendix D. |

# 1. Introduction

## 1.1 Purpose

This document specifies the requirements of **Countersign**, the database system behind the *Unified Experiential Learning and Project Intelligence Platform*. It states what the system shall do (functional requirements), how well it shall do it (non-functional requirements), and the software and hardware it needs. Every functional requirement is traced to the database objects that implement it and to the automated test that verifies it.

The intended readers are:

- the lab evaluators of CD252IA, who assess this document as Component 2;
- the two team members, who use it as the acceptance baseline for Components 3 to 11.

## 1.2 Scope

Every Experiential Learning (EL) course at RVCE ends in a team project. The project is assessed on a paper marks sheet (Appendix F of the project master file) that the faculty signs **on trust**. Faculty cannot see which student did which part of the work.

Countersign replaces that trust with records. Its thesis is **"every mark has a receipt"**:

1. The rubric is the schema. Each component of the lab marks sheet (Synopsis, Requirement Specification, ER Diagram, and so on) is a row of `milestone`, and each mark is a row of `assessment` at the grain *student × component*.
2. A student files a **claim** ("I designed the ER diagram") against a component.
3. The claim is backed by **evidence** rows: a recorded contribution, a frozen artifact version, a commit SHA, a URL or a file path.
4. A teammate **countersigns** the claim (confirm or dispute). A disputed claim is surfaced to the faculty.
5. The faculty reads the rubric sheet. Behind every cell it can follow claims → evidence → countersigns. This requires the faculty to read claim statements, evidence pointers and dispute comments; §3.4.1 states exactly what the faculty can read.

Around this core, the system provides a semester hub, team formation by complementary skills, an evidence-backed skill profile, permission-aware retrieval over project text, and a lifetime portfolio.

**Benefits.** Individual contribution becomes visible and verifiable. Students are protected by privacy tiers. The marks computation (120 raw → 30, plus 10 and 10, giving 50) is derived by a view rather than typed by hand.

**What the product is not** is stated in §2.7 (non-goals).

## 1.3 Definitions, acronyms and abbreviations

| Term | Meaning in this document |
|:--|:----------|
| Artifact | A unit of project work (code, note, report, diagram, slides) owned by a team and filed under one component. Table `artifact`; its `source` is `github`, `obsidian` or `editor`. |
| Artifact version | An immutable, numbered state of an artifact. Weak entity `artifact_version`, identified by (artifact_id, version_no). |
| Assessment | The mark given to one student for one component. Table `assessment`, key (usn, project_id, milestone_no). |
| Delivery id | GitHub's `X-GitHub-Delivery` header: one id per webhook delivery. The key of the inbox (`ingest_event.delivery_id`) and of the raw log (`github_events._id`). |
| Edge Function | A serverless function run by Supabase (Deno). `github-webhook` verifies the HMAC signature of a push and calls `ingest_receive()`. |
| CIE | Continuous Internal Evaluation. Lab CIE = reduced 30 + Innovative Experiment 10 + Final demo 10 = 50. |
| Claim | A student's statement of work done for one component. Table `claim`. |
| Component | One row of the lab marks sheet (C1–C11). Stored as a `milestone` of the lab project P06. |
| Contribution | A recorded act of work by one student on one artifact. Table `contribution`; its `source` is `manual`, `github`, `obsidian` or `editor`. |
| Countersign | A teammate's verdict (`confirm` / `dispute`) on a claim. Table `countersign`. |
| Evidence | A typed pointer that supports a claim. Weak entity `claim_evidence`, identified by (claim_id, evidence_no). |
| Fixture | The frozen schema, data and 37 SQL + 25 MongoDB queries used in Component 4 (Test). Never modified. |
| Inbox → log → projection | The ingestion contract: the inbox row and queue message are written in one transaction; the raw event is logged in MongoDB; the relational projection is written idempotently in PostgreSQL (`docs/INGESTION.md`). |
| Lock | Setting `milestone.locked_at`. While it is set, the component's marks, claims, evidence, countersigns and submissions cannot change. Only an administrator can clear it (§3.2, FR7.4). |
| MVCC | Multiversion concurrency control (PostgreSQL's concurrency model). |
| OCC | Optimistic concurrency control. Here, a countersign carries the claim revision the signer read. |
| Persona | A test identity (student, faculty, admin, anonymous) used in automated tests. |
| pgTAP | Unit-testing framework for PostgreSQL; tests in `supabase/tests/*.sql`. |
| pgvector, HNSW | PostgreSQL vector type and its approximate nearest-neighbour index (Hierarchical Navigable Small World). |
| pgmq | Supabase Queues: a message queue implemented as PostgreSQL tables (extension `pgmq`), so a queue message commits or rolls back with the transaction that sends it. |
| PostgREST | The HTTP layer that exposes tables, views and functions (`/rest/v1/rpc/<name>`). |
| RAG | Retrieval-augmented generation: an LLM answers from retrieved database rows and cites them. |
| Realtime broadcast | A Supabase Realtime message sent from the database (`realtime.send`) on a private channel; who may join is decided by an RLS policy on `realtime.messages`. |
| RC, RR, SER | Isolation levels READ COMMITTED, REPEATABLE READ, SERIALIZABLE. |
| RRF | Reciprocal rank fusion: score(d) = Σ 1 / (60 + rank_r(d)) over the keyword and vector rankings. |
| RLS | Row-level security: per-row access predicates (policies) enforced by PostgreSQL. |
| RPC | A PostgreSQL function called over HTTP through PostgREST. |
| `security_invoker` view | A view that runs with the caller's privileges, so RLS of the base tables applies. A default view runs as its owner and bypasses RLS. |
| SECURITY DEFINER | A function that runs with its owner's privileges. Used only for integrity triggers, RLS helper functions and the private-note RPCs. |
| SQLSTATE | The five-character standard error code (e.g. 23514 check_violation, 40001 serialization_failure). |
| Submission | A team's frozen hand-in for one component; records the exact artifact versions submitted. |
| USN | University Seat Number, the student identifier. |
| Visibility tier | `private`, `team` or `submitted`: who may read an artifact or text chunk (§3.4). |
| Write skew | An anomaly in which two transactions each read an overlapping set, then write disjoint rows, jointly violating an invariant. |

## 1.4 References

1. ISO/IEC/IEEE 29148:2018, *Systems and software engineering: Life cycle processes: Requirements engineering*. (Supersedes IEEE Std 830-1998, *IEEE Recommended Practice for Software Requirements Specifications*.)
2. R. Elmasri and S. B. Navathe, *Fundamentals of Database Systems*, 7th ed., Pearson. Ch. 2 (three-schema architecture, data independence), Ch. 3 and 9 (ER model and mapping), Ch. 5–8 (relational model, algebra, SQL), Ch. 14–15 (normalization), Ch. 20–21 (transactions, concurrency control).
3. PostgreSQL 17 Documentation: Row Security Policies; Transaction Isolation; Explicit Locking.
4. Supabase Documentation: Row Level Security; Database Functions; Testing (pgTAP); Database Advisors.
5. Team documents: *DBMS Synopsis* (Component 1); `PROJECT_MASTER.md` (vision, fixture schema, marks sheet); `docs/PLAN.md` (sharpened thesis, comparison, non-goals, privacy tiers, tiering).
6. Implementation (repository paths):
    - migrations `supabase/migrations/20261104000001_core_schema.sql` to `20261105000006_ingest_worker.sql`;
    - fixture `supabase/fixture/01_schema.sql`; demo seed `supabase/seed/demo.sql`; ingest seed `supabase/seed/ingest.sql`;
    - Edge Function `supabase/functions/github-webhook/index.ts`; worker and answer service `api/app/worker.py`, `api/app/ask.py`; replay fixtures `ingest/`; ingestion contract `docs/INGESTION.md`;
    - tests `supabase/tests/01_constraints.sql` to `06_ingest_worker.sql`; `api/tests/test_api.py`, `api/tests/test_worker.py`; `web/e2e/*.spec.ts`;
    - MongoDB `mongo/validators.js`, `mongo/portfolio_merge.js`, `scripts/check_mongo_validators.sh`;
    - concurrency findings `experiments/race/FINDINGS.md` and `experiments/race/results/results.md`.
7. Digital Personal Data Protection Act, 2023 (India).
8. Vendor documentation used for §2.1.1 (product behaviour as documented, not independently tested): GitHub Docs, *GitHub Classroom* (individual and group assignments); GitHub Docs, *Viewing a repository's contributors*; Moodle Docs, *Assignment settings* (group submissions) and *Workshop activity*; Google for Education Help, *Google Classroom* (assignments); CATME (catme.org), *Team-Maker* and *Peer Evaluation*; WebPA (Loughborough University), *Online peer assessment*.

## 1.5 Overview and status convention

- Section 2 describes the product in context: its users, environment, constraints, assumptions, existing systems, non-goals, and the disposition of every Synopsis requirement that was not built as stated.
- Section 3 states the specific requirements: external interfaces; functional requirements FR1–FR11 with their traceability matrix; privacy tiers and the exact faculty projection; non-functional requirements with measurable targets; software and hardware requirements; and the known-defects register.
- Section 4 lists how each requirement class is verified, with the result of each run.

Requirements use **shall** for mandatory behaviour and **should** for desirable behaviour.

**Status freeze.** Every status in this document describes the repository and the live project as they stood on **19 November 2026**: migrations 0001–0007 (no later migration exists; all seven are applied on the cloud project, verified 19 Nov 2026), the Edge Function `github-webhook`, `mongo/`, `api/`, `web/src/`, `ingest/` and `scripts/` as present on that date. The test totals of §4 are the recorded runs of that day. Where a statement rests on an earlier check (the Supabase advisors and the cloud pipeline counts of 5 Nov 2026, the full race harness run of 4 Nov 2026), it says so. Each requirement carries one status:

| Status | Meaning |
|:--|:----------|
| **Implemented** | Built, and covered by an automated test (or, where stated, a scripted check) that was run and passed (§4). |
| **Built, not verified** | The code exists, but no automated test covers it yet. Not counted as implemented. |
| **Partial** | Some sub-requirements are Implemented; the others are Built, not verified, or Planned. The sub-requirements say which. |
| **Built, not configured** | The code exists and is unit-tested with stubs, but depends on an external service whose credentials have not been issued; it has never run against that service. Not counted as implemented. |
| **Planned** | Specified; not built. |
| **Stretch** / **Descoped** | Deferred to the stretch phase / removed from scope, with a reason (§2.8). |

# 2. Overall description

## 2.1 Product perspective

Countersign is a new, self-contained system. It sits beside (not inside) the institution's existing tools.

- It does not replace the learning management system or the results portal.
- It is the **system of record for project work and its assessment evidence**.

![Figure 1. Product perspective (system context), revision 1.2. Solid elements and lines are built and were exercised by a recorded test run; the dashed element (AI model services) is specified but not configured; the dotted line is a link by shared keys, not a network call.](diagrams/c2_fig1_context.png){width=100%}

The relational part of the design follows the **three-schema architecture** (Elmasri & Navathe, Ch. 2):

| Level | Realisation in Countersign |
|:--|:----------|
| External level (external schemas) | Six role-specific views, each a `security_invoker` view whose rows are further filtered per user by RLS: `v_semester_hub` (student), `v_what_faculty_sees` (student), `v_rubric_sheet`, `v_faculty_team_progress`, `v_contested_claims`, `v_lab_cie_marks`. |
| External interfaces (not schemas) | The 16 RPCs of migration 0004 and `search_chunks()` of migration 0005 (plus 5 pipeline RPCs callable only by the service role). They are *operations* on the conceptual schema, comparable to application programs, not user views of it. |
| Conceptual level | One relational schema: 29 tables in schema `public` (26 after 0004, plus `student_identity`, `team_repo` and `ingest_event` from 0005), plus `private.note`, with their keys, foreign keys, CHECK constraints and integrity triggers. The conceptual ER model is Component 3. |
| Internal level | PostgreSQL 17 storage structures: heap files, TOAST storage of long values, B-tree indexes on every foreign-key column (composite where the key is composite), partial UNIQUE indexes that serve as idempotency keys, a GIN index on `artifact_chunk.tsv` (full-text), an HNSW index on `artifact_chunk.embedding` (vector), and the pgmq queue tables. |

MongoDB (database `elp`) is **not** a level of this architecture. It is a second store with its own (document) data model, linked to the relational schema only by shared key values (FR11).

**Logical data independence** is the capacity to change the conceptual schema without having to change the external schemas or the application programs (Elmasri & Navathe, §2.2). Worked example from this project: migration 0002 changed the conceptual schema of the 13 fixture tables by appending columns (`artifact.visibility`, `owner_usn`, `external_ref`; `contribution.source`, `source_ref`, `occurred_at`, `ai_assisted`; `milestone.cie_part`, `locked_at`; `artifact_chunk.embedding`, `visibility`, `tsv`) and by adding 13 new tables in `public` (plus `private.note`). The application programs written against the original schema, the 37 SQL queries Q1–Q37 of the Test, were not changed, and on 4 Nov 2026 they still produced the verified outputs of Appendix H (gate G1, 37/37). The same held again, re-confirmed on 5 Nov 2026, for migration 0005, which appended `artifact_version.source_ref` and `artifact_chunk.chunk_no` and added three tables: Q1–Q37, the six `v_*` views and the 16 RPC signatures were unchanged, because each of them names the columns it uses.

**Physical data independence** is the capacity to change the internal schema without having to change the conceptual schema (Elmasri & Navathe, §2.2). Worked example: migration 0002 added 38 B-tree indexes, chiefly on foreign-key columns (§10), and the GIN and HNSW indexes on `artifact_chunk` (§9). Migration 0005 §4 replaced the two single-column indexes of `skill_evidence` by composite ones on `(claim_id, usn)` and `(contribution_id, usn)`, so that each composite foreign key has an index on its leading columns. No relation, attribute or constraint of the conceptual schema changed, and therefore neither did any view, RPC or query; only the access paths chosen by the optimizer changed.

### 2.1.1 Relation to existing systems

The cells describe each product's documented, default behaviour (reference 8); configurations and plug-ins can differ.

| Capability | GitHub Classroom | GitHub Insights (Contributors) | Google Classroom / Moodle | CATME | WebPA | **Countersign** |
|:--|:--|:--|:--|:--|:--|:--|
| Unit of record | A repository per student or per team | Commits per author | A submission per assignment (Moodle also supports group submissions) | A peer-evaluation survey | A peer-assessment score sheet | A claim per student per rubric component |
| Individual attribution | Git history of the repository; in group assignments students create or join teams | Commit and line counts, attributed through the commit author e-mail, which is self-asserted | A group submission is typically graded as one; Moodle allows a teacher to override an individual student's grade | Peer ratings | Peer scores weight a group mark into individual marks | Claim + typed evidence + teammate countersign |
| Non-code work (reports, ER, slides) | Only if committed as files | Only as commits | Uploaded as files, not attributed to a team member by default | Indirect (ratings) | Indirect (scores) | Yes: version, URL and file evidence |
| Peer verification | Not built in | Not built in | Moodle Workshop peer-grades submissions, not contributions | Yes, behavioural ratings | Yes, numerical ratings | Yes, bound to one claim and one claim revision |
| Rubric / marks sheet as data | Autograding tests | Not built in | Rubrics attached to assignment grades | Not built in | Group mark → individual marks | Rubric = schema; 120 → 30 + 10 + 10 = 50 computed by a view |
| Evidence linked to each mark | Not by default | Not built in | Not by default | Not built in | Not built in | Yes (rubric cell → claims → evidence) |
| Privacy enforced in the database | Repository visibility | Repository visibility | Course roles | The instructor sees all ratings | The tutor sees all scores | `private` / `team` / `submitted`, enforced by RLS |
| Team formation | Students create or join teams in group assignments | Not built in | Groups made by the teacher (Moodle also allows self-selection plug-ins) | Team-Maker (survey criteria) | Not built in | Complementary-skill finder (relational division) |
| Permission-aware assistant | Not built in | Not built in | Not built in by default | Not built in | Not built in | Retrieval runs as the requesting user (FR9); cited answers |

Countersign borrows peer verification from CATME and WebPA, but attaches it to *specific, evidenced claims* rather than to general ratings. It borrows submission and rubric handling from learning management systems, but stores the rubric at component grain so that marks are derivable and auditable.

## 2.2 Product functions (summary)

1. Maintain academic records: students, faculty, courses, terms, offerings and enrolments (FR1).
2. Define projects whose milestones are the rubric components (FR2).
3. Give each student a semester hub of their projects, teams, next deadlines and claim counts (FR3).
4. Form teams under capacity and enrolment rules; suggest complementary teammates (FR4).
5. Record artifacts, versions, contributions and notes, from the editor and from GitHub pushes and Obsidian vault notes (FR5).
6. File claims with evidence; collect teammate countersigns (FR6).
7. Freeze submissions, record marks, lock components, and compute the lab CIE (FR7).
8. Maintain declared and verified skill levels; report skill gaps; navigate the skill hierarchy (FR8).
9. Answer questions over project text with citations, under the asker's permissions (FR9).
10. Retain every project permanently and build an exportable portfolio (FR10).
11. Store structured data in PostgreSQL and semi-structured data in MongoDB, linked by shared keys (FR11).

The use cases are shown in UML notation in Figures 2a (student) and 2b (faculty, administrator and the external systems). A use case may appear in both diagrams.

![Figure 2a. UML use-case diagram: primary actor Student; secondary actors Voyage AI and Anthropic Claude API for FR9 (dashed associations: planned, no API keys yet). Solid ellipse = built; dashed ellipse = specified, not built.](diagrams/c2_fig2a_usecase_student.png){width=90%}

![Figure 2b. UML use-case diagram: primary actors Faculty and Administrator; secondary actors GitHub, Obsidian, Voyage AI and Anthropic Claude API (the last two with dashed, planned associations). The Administrator is not associated with "Record marks" (FR7.3).](diagrams/c2_fig2b_usecase_staff.png){width=90%}

## 2.3 User classes and characteristics

| ID | User class | Characteristics | Privileges (enforced by RLS, column grants and triggers) |
|:--|:--|:----------|:----------|
| U1 | Student | Semester-V undergraduate; frequent use around deadlines; mobile or laptop browser. | Reads the directory (students, courses, projects, teams, skills). Reads and writes their own team's content. Reads only their own marks. Their `private` items and private notes are visible to no one else. |
| U2 | Faculty | Teaches one or more course offerings; uses the system at assessment time. | For the projects they teach, reads the full rows of claims, evidence, countersigns, contributions, non-private artifacts and versions, submissions and marks; reads chunk text only once it is `submitted` (exact projection: §3.4.1). Records marks for those projects only, in their own name. May lock a component but not otherwise edit it, and cannot unlock it. Never sees `private` items or private notes. |
| U3 | College administrator | Maintains academic records; few users. | Everything U2 can read, on every project; all `app_user` and `enrollment` rows. Writes the directory tables, terms, offerings, enrolments, projects, components and `app_user`. **Beyond faculty**, only an administrator can: unlock a component (set `locked_at` back to NULL); delete marks (of an unlocked component); write `skill_evidence` (verified skill levels); insert, move or delete other students' `team_member` rows, with any role (still subject to the capacity, one-team-per-project, one-lead and history rules). An administrator has no `faculty_id`, so cannot record marks through `record_assessment` (42501 `faculty_required`); a direct INSERT into `assessment` by an administrator may name any faculty member in `assessed_by` (defect D2, §3.8). |
| X1 | Anonymous (not signed in) | Any HTTP client. | **No** table, view or function privilege at all. |
| X2 | External systems | GitHub (signed push webhooks; OAuth identity planned), Voyage AI (embeddings), Anthropic Claude API (answers). | GitHub reaches only the Edge Function, which verifies the HMAC signature before calling `ingest_receive()`; it has no database credentials. Voyage AI and Anthropic are optional and not configured (no keys); they would be called only by the service layer, with rows the caller may read. |

Identity mapping: a login (`auth.users`) has exactly one `app_user` row.

- The row's role is `student`, `faculty` or `admin`.
- A student carries a USN, faculty carries a faculty_id, and an admin carries neither (CHECK `app_user_role_consistency`).
- Self sign-up is disabled. A login without an `app_user` row reads nothing.

## 2.4 Operating environment

![Figure 3. Operating environment, revision 1.2. Solid elements are running and were exercised by a recorded test run; dashed elements are planned and not set up. The local verification environment (Docker) is listed in the last row of the table below rather than drawn.](diagrams/c2_fig3_deployment.png){width=100%}

| Tier | Environment | Status (19 Nov 2026) |
|:--|:----------|:--|
| Client | Any evergreen browser (Chrome, Edge, Firefox, Safari; current and previous major version) on Windows, Linux, macOS, Android or iOS. | Chrome on macOS exercised by Playwright (G8). Other browsers and mobile: not yet tested. |
| Web application | Single-page application in React 19.3 and TypeScript 7.0, built with Vite 8.3, styled with Tailwind CSS 4.3 and shadcn/ui. Uses `supabase-js` with the publishable key only. Pages: login, semester hub, team, project, notes, "what my faculty sees", rubric sheet (refetched when the window regains focus), contested queue, marks, faculty home, admin, and the race arena (`/race`), which replays the 72,000 recorded races of `experiments/race/` and runs single live races through `POST /race/run`. | Built; served locally by the Vite server. Static hosting on Vercel: **planned, not set up**. |
| Database server | Supabase-managed PostgreSQL 17.11, project `countersign-dbms`, region ap-south-1 (Mumbai). Data API: PostgREST. Authentication: Supabase Auth (JWT; self sign-up disabled). Realtime (private broadcast channels). Extensions: `vector` (pgvector), `pgmq` (Supabase Queues). Edge Function `github-webhook`. | **Verified 5 Nov 2026** through the Supabase Management API: status ACTIVE_HEALTHY, PostgreSQL 17.11, migrations 20261104000001–…0006 applied, Edge Function `github-webhook` ACTIVE; the demo personas exist; 16 replayed webhook deliveries produced 9 projected pushes (1 ignored, the rest duplicates), 29 GitHub contributions and 58 text chunks (gate G7). **Re-verified 19 Nov 2026**: migrations 0001–0007 all applied. |
| Document store | MongoDB 8.0 on MongoDB Atlas, database `elp`. | Atlas: `$jsonSchema` validators applied; `notes` and `note_versions` populated (the replayed vault notes). MongoDB tests run on local `mongo:8` containers. |
| Service layer | FastAPI on Python 3.12 (`api/`): team notes with immutable `note_versions` (`notes.py`), the cross-store consistency report (`consistency.py`), `POST /ask` (`ask.py`), the ingest status and trace (`trace.py`), the relational half of the portfolio (`export_pg.py`), the race arena endpoint `POST /race/run` (`race.py`), and the ingest worker (`worker.py`; with `--loop` it survives PostgreSQL and MongoDB outages: a failed drain is logged and retried with a back-off of 1 s doubling to 30 s). User requests read PostgreSQL only through PostgREST with the caller's JWT; only the worker uses the service role, for the five service-role-only pipeline RPCs. | Built; runs locally under uvicorn, pointed at the local stack or at the cloud project; 66 pytest tests pass (G9). Cloud hosting: **planned** (PLAN §5 proposes Vercel Python functions). |
| Verification environment | Docker Desktop: the Supabase CLI local stack (migrations, pgTAP, Edge Function served locally, Playwright e2e); disposable `supabase/postgres:17.11` and `postgres:17` containers (fixture regression, race harness); `mongo:8` containers (MongoDB regression, validators, API and worker tests, portfolio rebuild). | In use (§4). |

## 2.5 Design and implementation constraints

| ID | Constraint | Source |
|:--|:----------|:--|
| C1 | The Component 4 fixture (`supabase/fixture/01_schema.sql`, `02_seed.sql`, `03_queries.sql`, `mongo/04_mongo.js`) is frozen. Q1–Q37 and M1–M25 shall keep producing the verified outputs. | Course (graded artifact) |
| C2 | Schema evolution is **append-only**: later migrations add tables, columns, constraints and indexes, and never drop or rename a fixture column. | C1 |
| C3 | PostgreSQL syntax only (no MySQL). | Team decision |
| C4 | Vectors stay in PostgreSQL (pgvector): no separate vector database, no LangChain. Retrieval is explicit SQL. | Thesis: permissions must apply to retrieval |
| C5 | MongoDB is a real component (raw events, notes and their versions, portfolios), not JSONB inside PostgreSQL. | Syllabus Unit V; lab Test NoSQL marks |
| C6 | Faculty and administrators never read `private` items, private notes, or chunk text that is not `submitted`. The faculty dashboard view `v_faculty_team_progress` exposes metadata only (counts and timestamps). The base-table policies deliberately let the teaching faculty read claim statements, evidence pointers, contribution descriptions, artifact links and dispute comments, because grading requires following claims → evidence → countersigns (§1.2, item 5); the exact projection is §3.4.1. All of this is enforced by RLS and `security_invoker` views. The AI layer shall query **as the requesting user**, never with the service role. | Privacy model (refined in §3.4) |
| C7 | Free tiers: Supabase (500 MB database, project pauses when idle) and Atlas shared tier (512 MB). Large experiments run on local Docker. | Budget |
| C8 | AI spend under USD 10 for the whole project. | Budget |
| C9 | Secrets live only in git-ignored `*.env` files and are never committed or printed. | Security |
| C10 | Personal data handling follows the DPDP Act 2023: purpose limitation, consent for non-grading uses, and erasure as a procedure. | Law |
| C11 | Documents follow the RVCE report format; the official title is used on all submissions. This document applies it as described under *Format* in the document control table. | Course |

## 2.6 Assumptions and dependencies

| ID | Assumption or dependency |
|:--|:----------|
| A1 | The college mandates the platform for component submission, so every student has an account. |
| A2 | Marks are awarded **per student at component grain**, as on the paper sheet. |
| A3 | **Rounding rule (to be confirmed with the course faculty):** the reduced mark is `round(raw × 30 / 120, 1)` (one decimal, half away from zero), and the /50 total adds the rounded value. |
| A4 | In the lab project P06, `milestone_no` equals the component number. C10 and C11 are out of 10 and are not reduced. |
| A5 | Accounts are provisioned by the administrator (sign-up disabled). Students later bind a GitHub identity through OAuth for commit attribution. |
| A6 | Each course offering (course × term × section) has exactly one teaching faculty member. |
| D1 | Availability of Supabase and MongoDB Atlas (and, once set up, Vercel). A local Docker stack is the offline fallback. |
| D2 | GitHub webhooks, Voyage AI and the Anthropic API for FR5 ingestion and FR9. Each shall have a replay or fixture fallback: signed replay fixtures in `ingest/` (`scripts/replay_webhooks.py`); keyword-only retrieval and extractive answers when no AI key is set. |

## 2.7 Non-goals (explicitly out of scope)

| ID | Non-goal | Reason |
|:--|:----------|:----------|
| NG1 | **Detecting AI-generated text.** | Detectors are unreliable and biased against non-native writers. Instead, each claim and version carries a declared `ai_assistance` (`none` / `assisted` / `generated`), version history is kept neutrally, and viva practice is student-facing. |
| NG2 | **Replacing WhatsApp, Google Docs, draw.io or other communication and authoring tools.** | Students keep their tools. The mandatory touchpoint is the component submission and its claims. External work enters as URL or file evidence (`claim_evidence.kind`). |
| NG3 | Automatic grading. | Marks remain the faculty's judgement (`assessment.assessed_by`); the system only computes totals. |
| NG4 | Leaderboards or contribution rankings for faculty. | Counts reward commit spam and discourage collaboration. "No recorded evidence yet" opens the claim flow; it is never a verdict. |
| NG5 | Activity surveillance (keystrokes, screen time, location). | Disproportionate under the DPDP Act; not needed for the thesis. |
| NG6 | Replacing the learning management system or the results portal. | Countersign holds evidence of project work, not course content or final grades. |

## 2.8 Disposition of Synopsis requirements not built as stated

The Synopsis (Component 1) named the following technologies and requirements. Each is recorded here so that no requirement disappears silently between versions.

| Synopsis item | Disposition | Reason and where it now lives |
|:--|:--|:----------|
| Tiptap + Yjs real-time co-editing (Hocuspocus server) | **Stretch** | `docs/PLAN.md` §1 re-tiers live co-editing to Stretch (Phase 5) and §2.9 moves Hocuspocus to stretch: it is a risky integration that earns few marks. The default editor saves numbered versions with optimistic locking instead (FR5.6). |
| Supabase Realtime for the live faculty dashboard | **Built** (FR7.9) | `postgres_changes` would push row content past the privacy tiers, so a trigger on `contribution` sends a metadata-only broadcast with `realtime.send` to private topics `team:<id>` and `project:<id>`; an RLS policy on `realtime.messages` decides who may join (migration 0005 §8). |
| Supabase Queues (pgmq) for ingestion | **Built** (FR5.5) | Inbox → log → projection: `ingest_receive()` writes the inbox row and enqueues in one transaction; the worker drains the queue (migration 0005, `api/app/worker.py`). |
| NFR "Concurrency: simultaneous edits" | **Refined** | Concurrent saves of one note are serialised by optimistic concurrency: a save based on a stale version is refused with HTTP 409 `version_conflict` (tested: `test_concurrent_saves_from_one_base_have_one_winner`). Simultaneous character-level co-editing goes with Tiptap + Yjs to Stretch. Concurrent team joins remain NFR-CON-1. |
| GitHub App and webhooks | **Descoped → replaced, built** | A plain repository webhook received by an Edge Function (FR5.5, built). Identity is bound by an administrator-verified `student_identity`; GitHub OAuth binding is planned. An App adds installation management without adding evidence. |
| Obsidian with the Obsidian Git plugin | **Built** (FR5.5) | Notes under `shared/**` (or `vault/**`) of the team repository arrive with a push and are ingested as note artifacts, chunks, and MongoDB `notes` + `note_versions`. |
| Claude API answers and Voyage AI embeddings | **Built, not configured** (FR9) | The code paths exist and are unit-tested with stubs; no API key has been issued yet, so answers are extractive and retrieval is keyword-only (FR9.5). |
| "Metadata-only faculty view" | **Refined** | Contradicted grading of submitted work; replaced by the three tiers of §3.4. |
| React with TypeScript **and Tailwind CSS** | **Built** | Tailwind CSS 4.3 with shadcn/ui (`web/package.json`); listed in §3.6. |
| OS list Windows / Linux / macOS | **Extended** | The client tier adds Android and iOS browsers (§2.4); the development tier keeps the Synopsis list. |

# 3. Specific requirements

## 3.1 External interface requirements

### 3.1.1 User interfaces

| ID | Requirement | Status |
|:--|:----------|:--|
| UI-1 | The rubric sheet shall render one row per student and one column per component, mirroring the paper marks sheet. Each cell opens that student's claims → evidence → countersigns for the component. | Implemented (`web/e2e/05-ramesh-sheet.spec.ts`) |
| UI-2 | Every form shall validate input with the same rules as the database CHECK constraints. Every database error shall be shown against the field it concerns, using the stable rule key in the error DETAIL. | Partial: marks form verified (spec 05: the form and the database both refuse a mark above the maximum); other forms built, not verified. |
| UI-3 | Each data panel should offer a "Show the SQL" drawer listing the query, its relational-algebra form and the RLS policies applied. | Partial: the drawer with real SQL is verified (spec 08; `search_chunks` in the search drawer, spec 10); the relational-algebra and policy parts are built, not verified. |
| UI-5 | Staff and team members shall see new evidence appear live (a notice and a feed row) without reloading, and staff shall be able to open the trace of a push (MongoDB raw event beside the PostgreSQL rows). | Implemented (`web/e2e/10-ingest-live.spec.ts`) |
| UI-4 | A student shall be able to open a "what my faculty sees" page (FR7.8). | Implemented (spec 07: a private note does not appear there) |

### 3.1.2 Software interfaces

| Interface | Protocol and format | Direction | Status |
|:--|:----------|:--|:--|
| Data API (PostgREST) | HTTPS, JSON. Tables and views at `/rest/v1/<relation>`; functions at `/rest/v1/rpc/<name>`; every RPC returns `jsonb`. Errors carry `code` (SQLSTATE) and `details` (rule key). | Web, service ↔ PostgreSQL | Implemented |
| Supabase Auth | E-mail login (GitHub OAuth planned); issues a JWT whose `sub` is `auth.uid()`. | Web ↔ Auth | Implemented |
| Countersign API (FastAPI) | HTTPS, JSON: `GET /health`, `GET /notes`, `GET /notes/{id}/versions`, `POST /notes`, `GET /consistency`, `POST /ask`, `POST /ingest/drain` (admin), `GET /ingest/trace`, `GET /ingest/status` (staff). Bearer JWT of the caller; errors `{"detail": {"code", "message"}}`. | Web → service | Implemented (pytest, 66 tests) |
| MongoDB driver | MongoDB wire protocol (TLS on Atlas); application user with `readWrite` on `elp` only. | Service ↔ MongoDB | Implemented locally; Atlas to be verified |
| GitHub | Repository `push` webhook: HMAC-SHA256-signed JSON (`X-Hub-Signature-256`, verified in constant time), delivery id in `X-GitHub-Delivery`; answered 202 after the inbox commit. GitHub OAuth for identity. | GitHub → Edge Function | Webhook: Implemented (`05_ingest.sql`, e2e spec 10, live replay); OAuth: Planned |
| Supabase Realtime | WebSocket, private broadcast channels `team:<id>`, `project:<id>`; payload: ids, author USN, source, time. | Database → web | Implemented (`05_ingest.sql` §G; e2e spec 10) |
| Voyage AI, Anthropic | HTTPS JSON APIs; embeddings of 1024 dimensions; answers with citations checked by the server. | Service → provider | Built, unit-tested with stubs; not configured (no keys) |

Error contract of the RPCs (migration 0004):

| SQLSTATE | Name | Raised when |
|:--|:--|:----------|
| 42501 | insufficient_privilege | Wrong role, not your team, not your claim; RLS rejects a row. |
| P0002 | no_data_found | Unknown or invisible team, claim, project, milestone, note. |
| 22023 | invalid_parameter_value | Bad input (mirrors the form rules). |
| 55000 | object_not_in_prerequisite_state | Component locked, claim no longer pending, stale claim revision, artifact private or already submitted. |
| 23505 / 23514 / 23503 / 23P01 | unique / check / foreign-key / exclusion violation | Declarative constraints and the cross-table trigger rules. |
| 40001 | serialization_failure | Concurrent conflict under REPEATABLE READ or SERIALIZABLE; the client retries. |

The five pipeline RPCs (`ingest_receive`, `ingest_read`, `ingest_mark_raw`, `project_push`, `ingest_fail`) return `jsonb` and are executable by the service role only; an API user calling them receives 42501.

### 3.1.3 Communication interfaces

All traffic shall use HTTPS (TLS 1.2 or later) outside the developer's machine. Requests are authorised by a bearer JWT. The publishable (anonymous) key confers no data access.

## 3.2 Functional requirements

Each requirement below gives the requirement as stated in the Synopsis, its refinement to the built system, its sub-requirements, its tier (Core / Supporting / Stretch, from `docs/PLAN.md`) and its status under the convention of §1.5.

### FR1. Academic records

*Synopsis:* Manage student, faculty, course and semester records.
*Refined:* Semesters are modelled as `academic_term`, and the teaching of a course as a `course_offering` (course × term × section, with its faculty member). Students are linked to offerings by `enrollment`. This replaces the fixed `course.faculty_id`, which would mean "one teacher forever". Tier: Core. **Status: Implemented.**

- FR1.1 The administrator shall create, update and delete students, faculty, courses, terms, offerings and enrolments. All other roles shall only read the directory.
- FR1.2 Academic terms shall not overlap in time (exclusion constraint).
- FR1.3 An offering shall be unique per (course, term, section).
- FR1.4 Each login shall map to exactly one role and exactly the identifier that role requires.
- FR1.5 A student shall see only their own enrolments; a faculty member shall see the rolls of the offerings they teach.

### FR2. Projects and rubric components

*Synopsis:* Faculty create EL projects with milestones, deadlines and rubric marks.
*Refined:* Projects and components are created by the administrator for institutional control. The teaching faculty member may only **lock** a component, and cannot unlock it. Each component declares how it enters the lab CIE: `cie_part` is `reduced`, `innovative` or `final`. Tier: Core. **Status: Implemented.**

- FR2.1 A project shall belong to a course and optionally to one offering *of that same course* (composite foreign key).
- FR2.2 A component (milestone) shall be identified by (project_id, milestone_no) as a weak entity of its project. It has a title, `max_marks` > 0 and a deadline.
- FR2.3 Components with `cie_part` `innovative` or `final` shall be out of 10. A project shall have at most one of each.
- FR2.4 A project shall list its required skills with a minimum level 1–5.
- FR2.5 Lowering `max_marks` below an already recorded mark shall be refused.
- FR2.6 Faculty may change only `locked_at` of a component they teach, and only from NULL to a time (`trg_milestone_faculty_lock_only`). This trigger restricts faculty only; the administrator may change any column, including clearing `locked_at` (FR7.4).

### FR3. Semester hub

*Synopsis:* Semester dashboard of all EL projects per student.
*Refined:* The hub is driven by **enrolment**, so a student who has no team yet still sees every project they must complete. Tier: Supporting. **Status: Implemented.**

- FR3.1 For the signed-in student, the system shall list each enrolled offering and its projects, with:
  - the student's team and role;
  - the **next upcoming component**: the component with the earliest deadline on or after the current date (ties broken by component number). The choice is by deadline alone: `v_semester_hub` does not exclude a locked component (defect D4);
  - counts of the student's pending, confirmed and contested claims.
- FR3.2 For faculty, the hub shall list the offerings and projects they teach. For the administrator, it shall list institution-wide counts.
- FR3.3 The hub shall flag whether each term is current, and shall show the student's countersign queue (claims awaiting their verdict).

### FR4. Team formation

*Synopsis:* Team formation with skill-based teammate recommendations.
*Refined:* Recommendations return **complements**, not clones. Let $ProjectSkill_P = \sigma_{project\_id = P}(ProjectSkill)$, and say a student *holds* a required skill when $level \ge min\_level$. Then:

- Missing(me, P) = the required skills of P that the caller does not hold.
- Candidates are ranked by how many of Missing they hold (a partial division).
- Classical relational division is kept as a separate function (FR4.6).

Tier: Supporting. **Status: Implemented.**

- FR4.1 A student shall join a team only as themselves.
  - The first member becomes lead; a team has at most one lead.
  - A team shall never exceed `max_size` (1–6), **under any isolation level and any number of concurrent joiners**.
- FR4.2 A student shall be in at most one team per project, and only in projects of offerings they are enrolled in.
- FR4.3 A student who has recorded any work in a team cannot leave it: claims, countersigns, contributions, versions, chunks, owned artifacts, submissions or marks.
- FR4.4 A team's `max_size` cannot be reduced below its current size. A staffed team cannot move to another project.
- FR4.5 `find_teammates(P)` shall return Missing(me, P), and candidates who meet all three conditions: not already in a team of P; eligible for P; holding at least one missing skill at the required level. Candidates are ordered by skills covered, then total level.
- FR4.6 `find_full_cover(P)` shall return the students who hold **every** required skill of P **at its minimum level**. Because of the level threshold this is not a plain division of `student_skill` by `project_skill`; it is

  $$\pi_{usn,\,skill\_id}\big(\sigma_{level \ge min\_level}(StudentSkill \bowtie ProjectSkill_P)\big) \div \pi_{skill\_id}(ProjectSkill_P)$$

  written in SQL as a double NOT EXISTS over `student`. One difference from the algebra: for a project with no required skills the SQL returns every student (vacuous truth), whereas the division of an empty relation returns no tuples.

### FR5. Capture of work as artifacts

*Synopsis:* Integrate GitHub repositories and Obsidian vaults to capture code, notes and documents as artifacts.
*Refined:* Work enters as artifacts whose `source` is one of three values, `editor`, `github` or `obsidian` (CHECK in the fixture, unchanged). Each artifact may carry an optional `external_ref` (a Google Docs revision link, a draw.io export). Work done on an artifact is recorded as a contribution, whose `source` is one of four values: the same three plus `manual`. Ingestion is idempotent and follows inbox → log → projection. Personal notes live in a private vault; team notes live in MongoDB with immutable versions. Tier: Core (artifacts, versions, notes); Supporting (GitHub and Obsidian ingestion). **Status: Implemented** (FR5.1–FR5.6; FR5.5 since revision 1.2). Embeddings of ingested text belong to FR9.5.

- FR5.1 A team member shall create artifacts for their team under a component of the team's own project (composite FK `(team_id, project_id) → team`).
- FR5.2 Each saved state shall be recorded as an immutable `artifact_version`. Required: its author `created_by` (a team member) and a declared `ai_assistance` (default `none`). Optional: a SHA-256 `content_hash` (nullable; when present it must be 64 lowercase hex digits, CHECK) and a `mongo_ref` to the full body in MongoDB (nullable).
- FR5.3 A contribution shall record `source` and, when it comes from an external event, `source_ref` (commit SHA or note version). A redelivered event with the same key shall create **no duplicate** (partial UNIQUE index `contribution_idempotency_key`).
- FR5.4 A student shall keep private notes that no other user, including faculty and teammates, can read. They are stored in schema `private`, which is not exposed through the API, and accessed only through owner-checked RPCs.
- FR5.5 Push events from a registered team repository (`team_repo`) shall be received by a webhook, stored raw in MongoDB (`github_events`, `_id` = delivery id), and projected into `artifact`, `artifact_version`, `contribution` and `artifact_chunk` rows. Obsidian notes under `shared/**` shall be ingested as note artifacts and mirrored into `notes` + `note_versions`. Specifically:
  - FR5.5.1 *Receive.* The receiver shall verify the HMAC-SHA256 signature over the raw body before any write, then call `ingest_receive()`, which inserts the `ingest_event` inbox row and sends the pgmq message **in one transaction**. A redelivery (same delivery id) or a re-sent body (same repository, ref and head SHA) is a no-op reported as `duplicate`.
  - FR5.5.2 *Log, then project.* The worker shall upsert the raw event into `github_events` (e-mail addresses replaced by their SHA-256) before `project_push()` writes the projection; every projected INSERT is `ON CONFLICT DO NOTHING` on an idempotency key (`artifact_repo_path_key`, `artifact_version_source_ref_key`, `contribution_idempotency_key`, `artifact_chunk_version_chunk_key`), so delivery may be at-least-once.
  - FR5.5.3 *Credit.* A commit shall be credited (version and contribution) only if its claimed author resolves, through a **verified** `student_identity`, to the authenticated pusher (`payload.sender`), and that student is a member of the repository's team. Every other commit is logged and reported as a warning (unknown author, unverified, not a member), never credited. The component is chosen by the server receive time, not the self-declared commit time.
  - FR5.5.4 *Failure handling.* A failed delivery shall be retried after the visibility timeout and archived as a dead letter after 5 attempts (`ingest_fail()`, migration 0006); a team's later pushes wait while an earlier one fails, so a team's pushes are projected in order.
- FR5.6 A team member shall create and update team notes through the API. Every save shall append one immutable `note_versions` document (author, time, SHA-256 of the content) and bump the note's version in one multi-document transaction; a save based on a stale version shall be refused (409 `version_conflict`). Only the note's author may save a new version.

### FR6. Attribution: contributions, claims, evidence, countersigns

*Synopsis:* Record and attribute every contribution with full version history.
*Refined:* Contribution data from commits alone is gameable: author e-mail is self-asserted, line counts reward spam, and whiteboard work leaves no trace. The **claim** is therefore the unit of attribution, and commits and versions are its *evidence*. Tier: Core. **Status: Implemented.**

- FR6.1 A student shall file a claim only for their own team and only for an open component. A claim records the statement (at least 10 characters), the contribution type and the declared `ai_assistance`.
- FR6.2 Evidence shall be one of five kinds, each with exactly its matching pointer (CHECK `claim_evidence_kind_matches`):
  - `contribution`: one of the claimant's **own** contributions;
  - `artifact_version`: any version of the team's artifacts;
  - `commit`: a hexadecimal SHA of 7–40 characters;
  - `url`: `http(s)` only;
  - `file`: a path.

  The same contribution, and the same artifact version, cannot be cited twice in one claim (partial UNIQUE indexes `claim_evidence_once_contribution` and `claim_evidence_once_version`). The same `commit`, `url` or `file` reference *can* currently be cited more than once in one claim; this is a schema gap (defect D1).
- FR6.3 A countersign shall be given only by a **teammate who is not the claimant**. A dispute requires a comment. A team of one member has no teammate to countersign: the claim stays `pending` (FR6.4), rests on its evidence and the faculty review, and the student and faculty pages say so (no schema change; demo team T00 is such a team).
- FR6.4 `claim.status` is a derived attribute recomputed by trigger: `contested` if any dispute exists; otherwise `confirmed` if any confirm exists; otherwise `pending`. It cannot be set by a client.
- FR6.5 Every change to a claim's statement or evidence increments `claim.revision`. A countersign records the revision it endorses, and is refused if the claim changed after the signer read it (OCC).
- FR6.6 Once a claim has any countersign (status `confirmed` or `contested`), its content and evidence are frozen. A claim may be withdrawn (deleted) only by its claimant and only while it is `pending`.
- FR6.7 A countersign may be revised or withdrawn by its endorser while the component is open; the claim's status is then recomputed (it returns to `pending` when no countersign remains).

The life cycle is the UML state machine of Figure 4. Its transitions are:

| Id | Source → target | Trigger | Guard (besides [in Open]) | Enforced by |
|:--|:--|:----------|:----------|:----------|
| t1 | initial → pending | `file_claim()` or INSERT | claimant is a member of the team | `claim_insert` policy, `trg_claim_member_required`, `trg_claim_guard` |
| t2 | pending → pending | edit statement; add or delete evidence | caller is the claimant | `claim_update`, `claim_evidence_*` policies; `trg_claim_guard` and `trg_claim_evidence_revision` add 1 to `revision` |
| t3 | pending → confirmed | countersign `confirm` | teammate ≠ claimant; signed revision = current revision | `trg_countersign_check`, `trg_countersign_sync_status` |
| t4 | pending → contested | countersign `dispute` | as t3; comment given | as t3; CHECK `countersign_dispute_needs_comment` |
| t5 | confirmed → contested | a teammate disputes (new countersign or revised verdict) | as t4 | as t4 |
| t6 | contested → confirmed | a dispute is revised to confirm, or withdrawn | no dispute remains and at least one confirm remains | `trg_countersign_sync_status` |
| t7 | contested → contested | a dispute is added, revised or withdrawn | at least one dispute remains | `trg_countersign_sync_status` |
| t8 | confirmed → pending | a countersign is withdrawn (`countersign_delete`) | no countersign remains | `countersign_delete` policy, `trg_countersign_sync_status` |
| t9 | contested → pending | a countersign is withdrawn | no countersign remains | as t8 |
| t10 | pending → final | the claimant withdraws the claim (`claim_delete`) | status = `pending` | `claim_delete` policy, `trg_claim_guard` |
| l1 | Open → Locked | `lock_milestone()` | caller teaches the project, or is an admin | `lock_milestone`, `milestone_update` policy |
| l2 | Locked → Open | UPDATE `locked_at := NULL` | caller is an admin | `milestone_update` policy; `trg_milestone_faculty_lock_only` refuses it for faculty |

![Figure 4. UML state machine of a claim. Region 1 is claim.status (derived); region 2 is the lock of the claim's component, which is not a value of claim.status. Every status transition t1–t10 carries the guard [in Open]. The bull's-eye is the final state (claim withdrawn).](diagrams/c2_fig4_claim.png){width=100%}

### FR7. Submission, assessment and the rubric view

*Synopsis:* Faculty live rubric-wise view of team progress and individual contributions.
*Refined:* The view is the paper marks sheet rebuilt as live tables. Submission and marking are part of the same requirement, because the sheet is meaningless without them. Tier: Core. **Status: Implemented** (data layer; the web pages for the rubric sheet, marks, contested queue and faculty preview; and, since revision 1.2, the live notices of FR7.9).

- FR7.1 `submit_milestone(team, component, artifacts)` shall, **in one transaction**: validate every artifact; allocate the next attempt number; insert the submission; freeze the latest version of each artifact; publish the artifacts (`team` → `submitted`).
- FR7.2 A submission is frozen once its transaction commits: no artifact may be added later, and `submitted_at` is set by the server only.
- FR7.3 Only the teaching faculty member of a project shall record a mark, through `record_assessment()`, which signs it with the caller's own `faculty_id`. The mark is between 0 and `max_marks` with at most one decimal, for a student who is in a team of that project. An administrator cannot use `record_assessment()` (no `faculty_id`: 42501 `faculty_required`, `03_rpc.sql` §H). The one-decimal rule holds on **every** write path, not only in the RPC: since migration 0007 `assessment.marks` is unconstrained NUMERIC with CHECK `assessment_marks_one_decimal` and `assessment_marks_precision`, so a direct INSERT or UPDATE of 4.25 is refused instead of being rounded to 4.3 (`07_strict_marks.sql`). For corrections, an administrator may INSERT, UPDATE or DELETE `assessment` rows directly (an unlocked component only); such a row is not forced to name the administrator (defect D2).
- FR7.4 `lock_milestone()` (teaching faculty or administrator) shall make a component final **for students and faculty**: while `locked_at` is set, its marks, claims, evidence, countersigns and submissions cannot change by any path open to them (55000 `milestone_locked`). Only an administrator can unlock a component, by setting `locked_at` back to NULL (`milestone_update` policy; `trg_milestone_faculty_lock_only` restricts faculty only). This is intended, so that a wrongly locked component can be corrected; it is recorded here because it bounds NFR-REL-2.
- FR7.5 The lab CIE shall be **derived, never stored**: reduced_30 = round(raw_total × 30 / raw_max, 1); total_50 = reduced_30 + C10 + C11 (assumption A3).
- FR7.6 The rubric sheet shall show, per (student, component): max marks, lock state, mark (where visible) and counts of pending, confirmed and contested claims.
- FR7.7 Faculty shall see, for the projects they teach:
  - team progress through `v_faculty_team_progress`, which is **metadata only**: member, artifact, contribution, submission and claim counts, and last activity;
  - a queue of contested claims (`v_contested_claims`), which includes each claim's statement;
  - for grading, the full rows listed in §3.4.1 (claim statements, evidence pointers, dispute comments, contribution descriptions, artifact links). This is not metadata only, and is intended.
- FR7.8 A student shall be able to list every item of theirs that falls inside the faculty projection, and none that falls outside it (`v_what_faculty_sees`: item kind, label, visibility, time; their marks). The view is an inventory, not a copy: the content columns that the faculty can read for each kind of item are listed in §3.4.1.
- FR7.9 Every new contribution shall be announced live, as **metadata only** (contribution id, team, author USN, artifact id, source, time; never a description or any text), to the private topics `team:<team_id>` (its members and the project's staff) and `project:<project_id>` (the project's staff only). A contribution to a private artifact shall not be announced. Who may join a topic is decided by an RLS policy on `realtime.messages` (`app.can_watch_topic()`); clients cannot broadcast on these topics.

### FR8. Evidence-backed skills

*Synopsis:* Build and update each student's skill graph from evidence; identify gaps.
*Refined:* Each skill carries two levels, **declared** (self-reported, `student_skill`) and **verified** (backed by `skill_evidence` from claims or contributions), shown side by side, for example "Declared 4 · Verified 2". Tier: Supporting. **Status: Partial** (FR8.1–FR8.4 Implemented; automatic derivation of verified levels from confirmed claims, and FR8.5, Planned).

- FR8.1 A student shall declare their own skills at levels 1–5.
- FR8.2 A verified level shall reference the claim or contribution that supports it. The copied `usn` is forced consistent by composite foreign keys onto the superkeys `(claim_id, usn)` and `(contribution_id, usn)`. Only the administrator writes `skill_evidence` today.
- FR8.3 `skill_gap(P, usn)` shall classify each required skill of P as `met`, `below` or `missing` **from the declared level only** (`student_skill.level` against `min_level`). The verified level is returned alongside for display and does not affect the classification.
- FR8.4 Skills form a hierarchy (`parent_skill_id`, a recursive relationship). `skill_subtree(skill)` shall return the subtree in depth-first order and terminate even if bad data forms a cycle.
- FR8.5 (Planned) The concepts each course teaches (`course_skill`) shall be intersected across a student's courses to propose cross-course projects.

### FR9. Permission-aware cited assistant

*Synopsis:* RAG assistant with cited sources, restricted by permissions.
*Refined:* Retrieval is one SQL statement that combines relational filters, keyword rank and vector similarity (reciprocal rank fusion). It runs **as the requesting user**, so RLS decides what can be retrieved. Questions that SQL already answers go to whitelisted SQL templates, not the LLM. Tier: Supporting. **Status: Partial** (FR9.1–FR9.4 Implemented: permission-safe keyword and hybrid retrieval and **extractive** cited answers; FR9.5 model-written answers and embeddings Built, not configured, because no Anthropic or Voyage key exists yet; FR9.6 query log Planned).

- FR9.1 Each text chunk shall carry, always: its author, its artifact, a `version_no`, its visibility and a generated `tsvector`. Optionally: a 1024-dimension `embedding` (nullable; when present, `embedding_model` is required by CHECK) and a SHA-256 `content_hash` (nullable). `artifact_chunk.version_no` is the fixture's own counter and has **no** foreign key to `artifact_version` (documented in migration 0002 §9: the frozen fixture chunks cite versions that exist only in the fixture), so the version of a chunk is recorded, not linked (defect D5).
- FR9.2 A chunk shall be retrievable by a team member (and, if `private`, by its author only), and by the teaching faculty and the administrator only once `submitted`.
- FR9.3 `search_chunks(query, team, author, since, limit, query_embedding)` shall be a single SECURITY INVOKER SQL function (so RLS filters every candidate) that returns chunks ranked by RRF, score = Σ 1/(60 + rank), over (a) a keyword list (chunks holding any query word, ranked by Σ idf² of the words they hold) and (b) when a query embedding is supplied, a vector list (cosine distance, HNSW with `iterative_scan = relaxed_order`). Only the newest snapshot (by commit time) of each ingested artifact shall be searched.
- FR9.4 `POST /ask` shall retrieve with `search_chunks` as the caller and answer only from the retrieved chunks: every sentence of the answer carries a citation marker that maps to a chunk id, and the cited set is a subset of the retrieved set. Without a model key the answer is **extractive** (the best-matching whole sentence of each of the top 3 chunks). A `[n]` inside quoted text is neutralised so it cannot pose as a citation.
- FR9.5 (Built, not configured) With `ANTHROPIC_API_KEY`, the answer shall be written by the model with each chunk as a citable document; every citation is checked on the server (its document is a retrieved chunk and its quote occurs in that chunk), and text without a verified citation is dropped. With `VOYAGE_API_KEY`, chunks and queries are embedded (1024 dimensions) and the vector list is fused in. Both paths are unit-tested with stubs; neither has been run against the real service.
- FR9.6 (Planned) Each query shall be logged (`ai_query_log`).

### FR10. Permanent record and portfolio

*Synopsis:* Permanent portfolio, exportable at graduation.
*Refined:* Permanence is enforced by two mechanisms, and neither alone is sufficient:

1. **RESTRICT foreign keys.** Every foreign key from a history row to the *independent* entity it is about is `ON DELETE RESTRICT`, so deleting a student, faculty member, course, term, offering, project, team or component that has recorded work fails (23503).
2. **No DELETE policy.** Several history tables are owners of existence-dependent rows that reference them with `ON DELETE CASCADE` (below). Such a cascade would remove history if the owner were deleted, so the owners themselves are protected by RLS: `artifact`, `artifact_version`, `contribution`, `submission` and `submission_artifact` have **no DELETE policy**, so no API user can delete them (default deny; the DELETE silently affects 0 rows). Example: an artifact that has versions but no contribution, citation or submission would be cascade-deleted with its versions and chunks if the database owner deleted it; through the API it cannot be deleted at all.

The portfolio is a per-student aggregate document in MongoDB. Tier: Supporting. **Status: Partial** (FR10.1 Implemented for the RESTRICT keys; the no-DELETE rule is in place but covered only by a manual check; FR10.2 Implemented; FR10.3 and FR10.4 Planned).

Foreign-key delete actions after migrations 0001–0006 (0005 adds `team_repo` → `team` and → `milestone` RESTRICT, `ingest_event.team_id` → `team` RESTRICT, and `student_identity` → `student` CASCADE, for erasure):

| Action | Foreign keys (referencing → referenced) |
|:--|:----------|
| RESTRICT (history protects its parent) | `contribution` → `student`, → `artifact`; `claim` → `student`, → `team`, → `milestone`; `countersign.endorser_usn` → `student`; `claim_evidence` → `contribution`, → `artifact_version`; `submission` → `student`, → `team`, → `milestone`; `submission_artifact` → `artifact_version`; `assessment` → `student`, → `faculty`, → `milestone`; `artifact` → `team` (both keys), `artifact.owner_usn` → `student`; `artifact_version.created_by` → `student`; `artifact_chunk.author_usn` → `student`; `team` → `project`; `project` → `course`, → `course_offering`; `course_offering` → `course`, `academic_term`, `faculty`; `enrollment` → `student`, `course_offering`; `app_user` → `student`, `faculty`; `course_skill`, `skill_evidence` → `skill` |
| CASCADE (existence-dependent rows go with their owner) | `artifact_version` → `artifact`; `artifact_chunk` → `artifact` (fixture); `claim_evidence` → `claim`; `countersign` → `claim`; `submission_artifact` → `submission`; `skill_evidence` → `student`, → `claim` (`claim_id, usn`), → `contribution` (`contribution_id, usn`); `team_member` → `team`, → `student` (fixture; a membership with recorded work is still pinned by `trg_team_member_history_guard`); `milestone` → `project` (fixture); `student_skill` → `student`, `project_skill` → `project` (fixture); `course_skill` → `course`; `private.note` → `student` (erasure); `app_user` → `auth.users` |
| SET NULL | `course.faculty_id` → `faculty` (fixture); `private.note.team_id` → `team` |
| NO ACTION (default) | `artifact (project_id, milestone_no)` → `milestone`; `skill.parent_skill_id` → `skill`; `student_skill`, `project_skill` → `skill` (fixture) |

- FR10.1 Deleting an independent parent of recorded work (student, faculty member, course, term, offering, project, team or component with claims, contributions, versions, submissions or marks) shall be refused by a RESTRICT foreign key. No API user shall be able to delete an artifact, version, contribution, submission or submission line (no DELETE policy); a claim can be deleted only by its claimant while it is pending (FR6.6); marks only by the administrator while the component is unlocked.
- FR10.2 A per-student portfolio document shall be rebuilt by an aggregation pipeline ending in `$merge`, stamped `generated_at`: `mongo/portfolio_merge.js` (`$unionWith` over `notes`, `note_versions`, `github_events` and the optional relational export of `api/app/export_pg.py`; `$group` per student; `$merge` into `portfolios` on the unique `usn`). Because `portfolios` has a strict `$jsonSchema` validator, every merged document is schema-checked as it is written. Verified by gate G11 (§4).
- FR10.3 (Planned) Erasure of a student's personal data under the DPDP Act shall be a documented procedure, not a cascade. Private notes and verified identities are the exception: they are deleted with their owner (CASCADE).
- FR10.4 (Planned) The student shall be able to export their own portfolio. No export route or screen exists yet.

### FR11. Polyglot persistence

*Synopsis:* Structured data in PostgreSQL; unstructured notes, events and history in MongoDB.
*Refined:* The two stores are linked by shared keys (`artifact_id`, `usn`, `team_id`, `artifact_version.mongo_ref`). Ingestion follows inbox → log → projection, so that a redelivery or a crash leaves the stores reconcilable, and the projection can be rebuilt from the log. Tier: Core. **Status: Implemented**, except that the immutability of `note_versions` (FR11.3) holds by API contract and a unique `_id`, not against a direct database write (defect D7).

- FR11.1 PostgreSQL shall hold all entities, relationships, marks and permissions.
- FR11.2 MongoDB shall hold `notes` (markdown and front matter), `note_versions` (one immutable receipt per save, `_id` = `<note_id>:<version>`), `github_events` (raw webhook payloads) and `portfolios` (per-student aggregates), with the indexes `{team_id: 1, created_at: -1}`, a text index on notes, unique `note_id`, unique `{note_id: 1, version: -1}` on `note_versions`, unique `event_id` and unique `portfolios.usn`.
- FR11.3 Every collection shall have a `$jsonSchema` validator (`validationLevel: strict`, `validationAction: error`) that accepts every document shape the frozen fixture writes and rejects malformed documents. Note versions shall be append-only.
- FR11.4 A consistency report shall compare, per team and author and **by full commit SHA**, the credited commits of the push events in MongoDB with the `contribution` rows (source `github`) in PostgreSQL, read as the caller, classifying each as `matched`, `only_in_mongo`, `only_in_postgres` or `not_projected` (touched only untracked paths), and shall never return commit messages.
- FR11.5 The PostgreSQL projection shall be rebuildable from the MongoDB raw log (`python -m app.worker --reproject-from-log`) with an identical result. The reverse is impossible by design: `ingest_event` stores no payload.

## 3.3 Traceability matrix: FR → database objects → tests

Test files are under `supabase/tests/` unless a path is given; section letters and numbers refer to the test file's own headings. Every file named in the last column passed in the recorded runs of §4. Rows FR5, FR7, FR9, FR10 and FR11 were extended in revision 1.2.

| FR | Tables | Views and RPCs | Constraints, triggers and policies | MongoDB and service objects | Verified by |
|:--|:--------|:--------|:----------|:--------|:--------|
| FR1 | `student`, `faculty`, `course`, `academic_term`, `course_offering`, `enrollment`, `app_user` | none (helpers `app.current_usn()`, `app.current_faculty_id()`, `app.current_app_role()`, `app.is_admin()`) | `academic_term_no_overlap` (EXCLUDE), `course_offering_natural_key`, `app_user_role_consistency`, CHECK semester 1–8; directory policies | none | `01_constraints.sql` §A; `02_rls_matrix.sql` §A (directory, `app_user`, `enrollment` per persona) |
| FR2 | `project`, `milestone`, `project_skill` | `lock_milestone()` | `project_offering_fkey` (composite), `milestone_cie_part_out_of_10`, `milestone_one_cie_part` (partial UNIQUE), `trg_milestone_max_marks_guard`, `trg_milestone_faculty_lock_only`, `milestone_update` policy | none | `03_rpc.sql` §H; `04_abuse_cases.sql` §2, §7; `01_constraints.sql` §A, §D |
| FR3 | `enrollment`, `course_offering`, `academic_term`, `team_member`, `milestone`, `claim` | `v_semester_hub`, `semester_hub()` | RLS on all inputs | none | `03_rpc.sql` §C; `02_rls_matrix.sql` §A (`v_semester_hub`); `web/e2e/02-arun-claim.spec.ts` |
| FR4 | `team`, `team_member`, `student_skill`, `project_skill` | `join_team()`, `leave_team()`, `find_teammates()`, `find_full_cover()`; helper `app.is_eligible_for_project()` | `trg_team_capacity_v2`, `trg_team_one_per_project` (incl. enrolment), `trg_team_member_history_guard`, `trg_team_shrink_guard`, `trg_team_project_guard`, `team_member_one_lead`, `trg_team_member_role` | none | `03_rpc.sql` §D, §E; `01_constraints.sql` §D; `04_abuse_cases.sql` §1; `experiments/race/` (G5); `web/e2e/04-nikhil-team.spec.ts` |
| FR5 | `artifact`, `artifact_version`, `contribution`, `artifact_chunk`, `private.note`; ingest: `team_repo`, `student_identity`, `ingest_event`; queue `pgmq.github_ingest` | `my_private_notes()`, `save_private_note()`, `delete_private_note()`; service-role pipeline RPCs `ingest_receive()`, `ingest_read()`, `ingest_mark_raw()`, `project_push()`, `ingest_fail()`; helpers `private.resolve_author()`, `private.ingest_actor()`, `private.ingest_credit()`, `private.ingest_milestone()`, `private.chunk_markdown()` | `artifact_team_project_fkey`, `artifact_private_needs_owner`, CHECK `artifact.source`, `contribution_idempotency_key`, `artifact_version_source_ref_key`, `artifact_chunk_version_chunk_key`, `artifact_repo_path_key`, `ingest_event_push_key`, `ingest_event_projected_at`, `student_identity_login_lower`, `team_repo_team_fkey`, `trg_team_repo_fill_project`, `trg_*_member_required` (×3), `trg_artifact_guard`; `student_identity_*`, `team_repo_*`, `ingest_event_select` policies | `notes`, `note_versions`, `github_events`; Edge Function `github-webhook`; `api/app/notes.py`, `worker.py`, `trace.py` | `01_constraints.sql` §C; `02_rls_matrix.sql` §C; `03_rpc.sql` §I; `04_abuse_cases.sql` §5; `05_ingest.sql` §A–§E, §H; `06_ingest_worker.sql`; `api/tests/test_api.py` (notes), `api/tests/test_worker.py`; `web/e2e/09-notes.spec.ts`, `10-ingest-live.spec.ts`; live replay (§4, G7) |
| FR6 | `claim`, `claim_evidence`, `countersign`, `contribution`, `artifact_version` | `file_claim()`, `add_claim_evidence()`, `countersign_claim()`, `v_contested_claims` | `claim_evidence_kind_matches`, `claim_evidence_ref_format`, `claim_evidence_once_contribution`, `claim_evidence_once_version`, `countersign_dispute_needs_comment`, `trg_claim_guard`, `trg_claim_evidence_check`, `trg_claim_evidence_revision`, `trg_countersign_check`, `trg_claim_status_derived`, `trg_countersign_sync_status`; `claim_*`, `countersign_*` policies | none | `03_rpc.sql` §G; `04_abuse_cases.sql` §2–§4; `01_constraints.sql` §A, §D; `experiments/race/membership_skew_check.sh` (race 3); `web/e2e/02`, `03` |
| FR7 | `submission`, `submission_artifact`, `assessment`, `milestone` | `submit_milestone()`, `record_assessment()`, `lock_milestone()`, `v_rubric_sheet`, `v_lab_cie_marks`, `v_faculty_team_progress`, `v_contested_claims`, `v_what_faculty_sees` | `submission_attempt_key`, `trg_submission_open`, `trg_submission_artifact_check`, `trg_submission_artifact_same_txn`, `trg_assessment_check`, `assessment_marks_one_decimal`, `assessment_marks_precision`, `trg_assessment_canonical_marks` (0007), `trg_artifact_chunk_visibility_sync`; `assessment_*` policies; FR7.9: `trg_contribution_broadcast`, `app.can_watch_topic()`, policy `countersign_broadcast_select` on `realtime.messages` | FR7.9: Supabase Realtime (private broadcast) | `03_rpc.sql` §F, §H; `04_abuse_cases.sql` §2, §6; `07_strict_marks.sql`; `02_rls_matrix.sql` §A (five views), §C (`v_lab_cie_marks` values); `web/e2e/05`, `06`, `07`; FR7.9: `05_ingest.sql` §G, `web/e2e/10` |
| FR8 | `skill`, `student_skill`, `skill_evidence`, `course_skill`, `project_skill` | `skill_gap()`, `skill_subtree()` | `skill_evidence_has_source`, `skill_evidence_claim_fkey`, `skill_evidence_contribution_fkey` (composite onto superkeys) | none | `03_rpc.sql` §D, §J (cycle); `04_abuse_cases.sql` §4 (composite FK) |
| FR9 | `artifact_chunk` (`embedding`, `tsv`, `visibility`, `chunk_no`), `artifact_version` (latest snapshot) | `search_chunks()` (SECURITY INVOKER) | `artifact_chunk_embedding_model_required`, GIN `artifact_chunk_tsv_idx`, HNSW `artifact_chunk_embedding_idx`, `trg_artifact_chunk_member_required`, `artifact_chunk_select` policy | `POST /ask` (`api/app/ask.py`); `api/app/embeddings.py` (unconfigured) | `02_rls_matrix.sql` §A (`artifact_chunk` per persona); `04_abuse_cases.sql` §6; `05_ingest.sql` §F (RLS per persona, latest snapshot, idf ranking, RRF with synthetic vectors, vector path under RLS); `api/tests/test_worker.py` (`test_ask_*`, extractive and stubbed generative citation checks); `web/e2e/10` (search as meera and lakshmi) |
| FR10 | `claim`, `claim_evidence`, `countersign`, `contribution`, `artifact`, `artifact_version`, `artifact_chunk`, `submission`, `submission_artifact`, `assessment`, `team_member` | none | RESTRICT foreign keys of the FR10 table; absence of DELETE policies on `artifact`, `artifact_version`, `contribution`, `submission`, `submission_artifact`; `trg_team_member_history_guard` | `portfolios`; `mongo/portfolio_merge.js` (`$merge`); `api/app/export_pg.py` | `01_constraints.sql` §B (student, course and project deletes refused); `04_abuse_cases.sql` §7; no-DELETE rule: manual check only (§4); portfolio rebuild: gate G11 (§4) |
| FR11 | `artifact_version.mongo_ref`, `artifact_version.source_ref`, `contribution.source_ref` (link keys) | none | none | `notes`, `note_versions`, `github_events`, `portfolios`; `$jsonSchema` validators and indexes (`mongo/validators.js`); `api/app/consistency.py`; `worker.py --reproject-from-log` | `scripts/check_mongo_validators.sh`; `api/tests/test_api.py` (consistency tests); `api/tests/test_worker.py` (`test_consistency_classifies_pipeline_and_outside_evidence`, `test_reproject_from_log_rebuilds_the_projection`); `scripts/test_mongo_fixture.sh` (M1–M25 still pass); `scripts/test_fixture.sh` (Q1–Q37) |

## 3.4 Data privacy: three visibility tiers

The privacy model of the Synopsis ("faculty see metadata only") contradicted grading: faculty must read what was submitted, and must follow claims to their evidence. It is therefore refined into three tiers, stored in `artifact.visibility` and `artifact_chunk.visibility` and enforced by RLS.

| Tier | Who may read the artifact row (and its versions, contributions, evidence citing it) | Who may read its text (chunks) | How an item enters the tier |
|:--|:----------|:----------|:----------|
| `private` | Its owner only (`owner_usn` required by CHECK) | Its author only | Created private by its owner, or made private by its owner while no other student has a version, contribution or chunk on it |
| `team` (default) | Team members; the teaching faculty and the administrator (full row, including `title` and `external_ref`) | Team members only | Default on creation; the owner may share a private item |
| `submitted` (final) | Team members; the teaching faculty and the administrator | Team members; the teaching faculty and the administrator | An UPDATE to `submitted` is accepted only if a `submission_artifact` row for the artifact exists (`trg_artifact_guard`); in practice through `submit_milestone`. Chunks follow by trigger. Irreversible. |

Private notes (`private.note`) are a fourth, stricter store. The schema is not exposed through the Data API at all, and notes are readable only by their owner through owner-checked RPCs.

![Figure 5. UML state machine of artifact.visibility. Arrows are the transitions that can happen, each with its trigger [guard] and guarding object; refused attempts are notes, not transitions, with the SQLSTATE of each path.](diagrams/c2_fig5_visibility.png){width=100%}

### 3.4.1 Exact faculty projection

What a **teaching faculty member** reads for a project they teach (an administrator reads the same on every project). Derived from the SELECT policies of migration 0003; row counts are checked per persona by `02_rls_matrix.sql` §A.

| Relation | Rows visible | Columns visible, including content |
|:--|:----------|:----------|
| Directory tables (`student`, `faculty`, `course`, `project`, `milestone`, `team`, `team_member`, `skill`, `student_skill`, `project_skill`, `course_skill`, `skill_evidence`, `academic_term`, `course_offering`) | All rows (every signed-in user with a profile) | All columns |
| `enrollment` | The rolls of the offerings they teach | All columns |
| `artifact` | Every non-private artifact (tiers `team` and `submitted`) | All columns: `title`, `type`, `source`, `owner_usn`, **`external_ref`** (e.g. a Google Docs or draw.io link) |
| `artifact_version` | Versions of those artifacts | `created_by`, `created_at`, `content_hash`, `mongo_ref`, `ai_assistance` (the body is in MongoDB; the API withholds note text from staff unless it is submitted) |
| `contribution` | Contributions on those artifacts | All columns, including **`description`**, `source_ref`, `ai_assisted` |
| `artifact_chunk` | **Only chunks with visibility `submitted`** | All columns, including `content` |
| `claim` | Every claim of the project's teams | All columns, including the full **`statement`**, `ai_assistance`, `status`, `revision` |
| `claim_evidence` | Evidence of those claims whose pointed-to artifact and contribution are themselves visible | All columns, including **`ref`** (URL, file path, commit SHA) and `note` |
| `countersign` | Every countersign of those claims | All columns, including `verdict` and the dispute **`comment`** |
| `submission`, `submission_artifact` | All of the project | All columns |
| `assessment` | Every mark of the project | All columns, including **`remarks`** |
| `v_faculty_team_progress` | Teams of the project | **Metadata only**: counts and timestamps |
| `v_contested_claims` | Contested claims of the project | Includes the claim `statement` |
| `app_user` | Their own row | All columns |
| `v_what_faculty_sees`, `v_semester_hub` | None (student views) | none |
| `ingest_event` | Deliveries of the teams of the projects they teach (admin: all) | All columns: status, attempts, `error` (warnings name a login or `email#<hash>`, never an e-mail address), commit counts. No payload is stored |
| `team_repo`, `student_identity` | Repositories of those teams; identities of the students in those projects | All columns (read only; only the administrator writes) |
| `realtime.messages` (broadcast) | Topic `project:<id>` of the projects they teach, and `team:<id>` of their teams | Payload: contribution id, team, author USN, artifact id, source, time (no text) |
| `private.note` | None (no privilege at all) | none |

"Metadata only" therefore holds exactly for `v_faculty_team_progress` and for chunk text that is not yet submitted; it does not hold for the base tables above, by design.

## 3.5 Non-functional requirements

Each requirement has a measurable target and a named verification. The **Result** column gives the outcome of the recorded runs of 5 Nov 2026 (§4), or of an earlier run where one is cited, or says why there is none.

### 3.5.1 Security

| ID | Requirement | Measurable target | Verification | Result |
|:-----|:----------|:--------|:--------|:--|
| NFR-SEC-1 | **Default deny.** Every table is protected by RLS; a table without a policy is unreadable. | 100% of `public` tables have RLS enabled; 100% have ≥ 1 policy; 100% of policies are scoped `TO authenticated`. | `02_rls_matrix.sql` §B | Met |
| NFR-SEC-2 | Each role sees exactly its rows. | 32 relations (26 tables + 6 views) × 8 personas = **256 cells**, plus the 3 tables of migration 0005 × 8 personas = **24 cells**, each equal to the expected row count or `denied`. | `02_rls_matrix.sql` §A; `05_ingest.sql` §H | Met (256/256; 24/24) |
| NFR-SEC-3 | Anonymous access has no data privileges. | 0 tables or views with anon SELECT or INSERT; 0 RPCs executable by anon. | `02_rls_matrix.sql` §B; `03_rpc.sql` §A, §B | Met |
| NFR-SEC-4 | Views cannot bypass RLS. | 100% of `public` views are `security_invoker`. | `02_rls_matrix.sql` §B | Met |
| NFR-SEC-5 | Functions cannot be hijacked through `search_path`; only the narrowest set runs as definer. | 100% of RPCs pin `search_path = ''`. Of the 17 RPCs that API users may call, exactly 3 (private notes) are SECURITY DEFINER; the other 14, including `search_chunks()`, are SECURITY INVOKER. The 5 pipeline RPCs are SECURITY DEFINER and executable by the service role only. | `03_rpc.sql` §A; `05_ingest.sql` §A; `06_ingest_worker.sql` | Met |
| NFR-SEC-6 | Direct table writes cannot circumvent the business rules that the RPCs check. | Every replayed attack in `04_abuse_cases.sql` is refused with the expected SQLSTATE (and rule key where one is raised), and leaves no effect. | `04_abuse_cases.sql`: of its 53 assertions, **33** assert a refusal with a specific SQLSTATE, **9** assert that an attempted attack left no effect (e.g. "Arun is still in T00"), and **11** are setup steps or happy-path controls (e.g. "cite A17@v1 once", "Arun submits A17"). | Met (53/53 pass) |
| NFR-SEC-7 | Server-owned columns cannot be supplied by clients (ids, `status`, `revision`, timestamps such as `submitted_at`, `signed_at`, `joined_at`). | Column-level GRANTs (migration 0003 §8): an INSERT or UPDATE naming such a column fails with 42501. | Tested: `submission.submitted_at` and `claim.claim_id` (`04_abuse_cases.sql` §6), `team_member.joined_at` (§1), `artifact.team_id`/`project_id` on UPDATE (§5). **Not tested:** `claim.status`, `claim.revision`, `countersign.signed_at`. | Partial: the grants cover all listed columns (inspection); 4 of 7 column groups are tested |
| NFR-SEC-8 | TRUNCATE (which bypasses RLS) is unavailable to API roles. | 0 tables with TRUNCATE for `authenticated`. | `02_rls_matrix.sql` §B | Met |
| NFR-SEC-9 | The service layer, including the assistant, never reads data for a user with the service role. | 0 user-request code paths that read data with service-role credentials. Retrieval tested as 3 personas with 3 different result sets. The only service-role path is the ingest worker, which calls the 5 service-role-only pipeline RPCs. | Code inspection (5 Nov 2026): user requests use the caller's JWT through PostgREST (`auth.py`, `consistency.py`, `ask.py`, `trace.py`); `POST /ingest/drain` checks for an admin before the worker runs. Retrieval: `05_ingest.sql` §F (meera, vikram, nikhil, f01, f02 each get their own result) and `test_ask_faculty_of_another_course_gets_no_p06_chunks`, `test_ask_teaching_faculty_sees_only_submitted_text`, `test_ask_student_answers_are_scoped_and_cited`. | Met |
| NFR-SEC-10 | Secrets never reach version control. | 0 `*.env` files tracked; push protection enabled. | `git ls-files` on 5 Nov 2026: 0 tracked `*.env` files; `.gitignore` excludes `*.env`, `*.env.*`. Push protection is a GitHub repository setting: to be verified. | Partial |

### 3.5.2 Integrity

| ID | Requirement | Measurable target | Verification | Result |
|:-----|:----------|:--------|:--------|:--|
| NFR-INT-1 | Every integrity rule is enforced by the database, whatever the client. | One violating statement per rule, each failing with its expected SQLSTATE (23514, 23503, 23505, 23P01, 55000); happy paths succeed. | `01_constraints.sql` (48 assertions) | Met (48/48) |
| NFR-INT-2 | Cross-table rules that a CHECK cannot express are triggers, not application code. | Capacity, one team per project, membership-required, marks ≤ max, lock, countersign-not-self, evidence ownership: each has a failing test. | `01_constraints.sql` §D; `04_abuse_cases.sql` | Met |
| NFR-INT-3 | Derived values are never stored by hand. | `claim.status` is trigger-derived; `milestone.counts_in_reduced` and `artifact_chunk.tsv` are GENERATED; the lab CIE totals exist only in a view. | Schema inspection; `04_abuse_cases.sql` §2–§3 | Met |

### 3.5.3 Concurrency

| ID | Requirement | Measurable target | Verification and evidence | Result |
|:-----|:----------|:--------|:--------|:--|
| NFR-CON-1 | **Capacity v2 never over-admits.** | 0 races ending above `max_size` for N = 2, 8, 32 and 100 simultaneous joiners, at RC, RR and SER, with 1,000 trials per cell. | `experiments/race/harness.py` and `capacity_v2_check.sh`. **Evidence:** strategy S7 (capacity v2) had 0 over-admissions in 12,000 races. The fixture trigger (S2) over-admitted in 100% of RR races. The full matrix covered 72,000 races and 2,556,000 attempts, with no deadlocks (`experiments/race/FINDINGS.md`; `results/results.md`, run 2026-11-04 17:15–17:28 UTC). | Met (recorded run) |
| NFR-CON-2 | No write skew between "record work" and "leave team". | Under RC the conflicting transaction is refused (55000 or 23514). Under RR and SER it fails with 40001. | `experiments/race/membership_skew_check.sh` (races 1–2). Evidence: the control (lock-only) committed a mark for a non-member at RR; the fix refuses it at all three levels. | Met (recorded run) |
| NFR-CON-3 | A countersign never endorses text the signer did not read. | A signature on a stale revision is refused (55000 `countersign_stale_revision` at RC; 40001 at RR and SER). | `membership_skew_check.sh` race 3; `04_abuse_cases.sql` §3 | Met |
| NFR-CON-4 | Concurrent submissions by teammates get distinct attempt numbers. | 0 duplicate (team, component, attempt_no). A transaction-scoped advisory lock serialises the allocation, with `submission_attempt_key` as backstop (23505). | Tested: the UNIQUE backstop (`01_constraints.sql` §C) and sequential attempt numbering (`03_rpc.sql` §F: a resubmission gets attempt 2). **Not tested:** the advisory lock under truly concurrent submissions (a two-session test is to be added to the race harness). | Partial |
| NFR-CON-5 | The client handles serialization failures. | On 40001 or 40P01 the client retries the whole request, at most 2 retries, with back-off. | Code inspection: `web/src/lib/query.ts` retries a mutation only when the error is a serialization failure, at most 2 times (TanStack Query's default exponential back-off). No automated test. | Built, not verified |

### 3.5.4 Reliability and recoverability

| ID | Requirement | Measurable target | Verification | Result |
|:-----|:----------|:--------|:--------|:--|
| NFR-REL-1 | **Atomic submission.** `submit_milestone` either commits all of its effects or none of them: the submission row, the frozen versions and the visibility changes. | After any refused call, 0 new rows in `submission` and `submission_artifact`, and 0 artifacts changed visibility. | **Construction:** `submit_milestone` is one PL/pgSQL function invoked by one SQL statement; PostgreSQL executes a statement atomically, so an exception raised anywhere in it (including by a trigger *after* the submission row was inserted) undoes all of its writes. `03_rpc.sql` §F and `04_abuse_cases.sql` §6 assert the refusals, **not** the row counts. Manual check on 4 Nov 2026 (fresh database): a call with A17 and the C4 artifact A15 was refused with 23514 after inserting its submission row, and left 4 `submission` rows, 6 `submission_artifact` rows and A17 at `team`, as before. An automated row-count assertion is to be added to `03_rpc.sql` §F. | Met by construction; automated assertion pending |
| NFR-REL-2 | Finality. After `lock_milestone`, no path open to a student or faculty member changes the component's marks, claims, evidence, countersigns or submissions. Only an administrator can unlock (FR7.4). | 100% of such attempts by students and faculty refused with 55000 `milestone_locked`. | `04_abuse_cases.sql` §2; `03_rpc.sql` §H. The administrator's unlock path is not covered by a test. | Met for students and faculty |
| NFR-REL-3 | Idempotent ingestion. | Redelivering an event, re-sending a captured body, or processing a message twice creates 0 duplicate rows in any store. | `01_constraints.sql` §C; `05_ingest.sql` §B, §D; `test_worker_projects_and_processing_twice_changes_nothing` | Met |
| NFR-REL-6 | No partial projection, no lost push. | A projection that raises leaves 0 rows of that push; a failed delivery is retried and dead-lettered after 5 attempts; a crash after the projection is repaired by the next drain; the projection rebuilt from the raw log equals the live one. | `05_ingest.sql` §E; `06_ingest_worker.sql`; `test_worker.py` (`test_projection_failure_is_retried_then_dead_lettered`, `test_mongo_failure_is_counted_and_the_message_is_retried`, `test_a_crash_after_projection_is_repaired_by_the_followup_pass`, `test_reproject_from_log_rebuilds_the_projection`) | Met |
| NFR-REL-4 | The fixture regression holds. | Q1–Q37 match Appendix H 37/37 on plain PostgreSQL 17 (C collation); M1–M25 match on MongoDB 8. | `scripts/test_fixture.sh`, `scripts/test_mongo_fixture.sh` | Met (37/37, 25/25) |
| NFR-REL-5 | Recoverability before each demo. | A `pg_dump` and a `mongodump` taken before every milestone; restore rehearsed once. | Restore drill, `docs/RUNBOOK.md` §4.3: both dumps of the live project restored into throwaway containers on 5 Nov 2026 (Postgres: 9 claims, 65 contributions, 58 chunks, 10 deliveries; Mongo: 12 events, 9 notes, 9 note versions, validator present). Expected and recorded: the `app_user → auth.users` FK is not recreated, because `auth` is not in the dump. To be repeated before C11 | Met |

### 3.5.5 Privacy

| ID | Requirement | Measurable target | Verification | Result |
|:-----|:----------|:--------|:--------|:--|
| NFR-PRI-1 | The three visibility tiers (§3.4) are enforced in the database. | Faculty and the administrator see 0 `private` artifacts and 0 non-`submitted` chunk text. Teammates see 0 of another student's private artifacts. | `02_rls_matrix.sql` §A (`artifact`, `artifact_chunk` per persona), §C | Met |
| NFR-PRI-2 | Private notes are owner-only. | Direct SELECT on `private.note` fails (42501) for every API role; RPCs return only the caller's notes; another owner's note id is reported as "not found". | `02_rls_matrix.sql` §C; `03_rpc.sql` §I | Met |
| NFR-PRI-3 | Students read only their own marks. | Student personas see only their own `assessment` rows. | `02_rls_matrix.sql` §A, §C | Met |
| NFR-PRI-4 | Transparency to the student. | `v_what_faculty_sees` lists, for the caller, every item of theirs inside the faculty projection and none outside it (a private artifact never appears). | `02_rls_matrix.sql` §A, §C; `web/e2e/07-privacy.spec.ts` | Met |
| NFR-PRI-5 | Consent for non-grading uses (portfolio sharing, analytics). | A consent record exists before any such use. | Consent ledger | Planned |
| NFR-PRI-6 | Staff never read the text of team notes that are not submitted. | Through the API, staff receive note metadata with `content: null`, `content_withheld: true`. | `api/tests/test_api.py::test_faculty_sees_metadata_only` | Met |
| NFR-PRI-7 | Live notices leak no content and cross no team. | Broadcast payloads carry ids, USN, source and time only; 0 broadcasts for a private artifact; a student cannot join another team's or a project's topic. | `05_ingest.sql` §G; `web/e2e/10` | Met |
| NFR-PRI-8 | Commit metadata is minimised. | The MongoDB raw log stores no plain e-mail address (SHA-256 instead; GitHub no-reply addresses are public pseudonyms and kept); warnings, `/ingest/trace` and `/consistency` never return commit messages or file text. | `test_scrub_emails_keeps_noreply_and_hashes_the_rest`; `05_ingest.sql` (privacy of warnings); `test_trace_is_staff_only_and_rls_scoped` | Met |

### 3.5.6 Performance and scalability

| ID | Requirement | Measurable target | Verification and evidence | Result |
|:-----|:----------|:--------|:--------|:--|
| NFR-PERF-1 | Team join under contention stays fast. | p95 latency per join attempt ≤ 25 ms with 100 concurrent joiners (local PostgreSQL 17). | `harness.py`. **Evidence:** capacity v2 (S7) at N = 100 had p95 = **5.99 ms at RR** and **12.10 ms at RC** (`experiments/race/results/results.md`, lines 196 and 192; rounded to 6.0 and 12.1 ms in `FINDINGS.md`). | Met (recorded run) |
| NFR-PERF-2 | Dashboards respond quickly. | `semester_hub()` and `v_rubric_sheet` execute in ≤ 200 ms server time at demo scale, and ≤ 500 ms on a bench of about 300,000 contribution rows. | `EXPLAIN (ANALYZE, BUFFERS)` bench (build phase P2) | Planned |
| NFR-PERF-3 | Joins and RLS checks use indexes. | 100% of foreign-key columns indexed. Non-correlated RLS helper calls written `(select app.fn())` so that they are evaluated once per statement. Supabase performance advisor: 0 unindexed foreign keys. | Migration 0002 §10 and 0005 §4; Supabase advisors on `countersign-dbms` (G7, 5 Nov 2026) | Met: 0 `unindexed_foreign_keys` (D3 closed by 0005); the only findings are 39 INFO `unused_index`, expected at demo volume |
| NFR-PERF-4 | Retrieval stays inside one SQL statement. | One statement (`search_chunks`) fuses both lists; top-k hybrid search ≤ 300 ms for k = 10 at demo scale. | One statement: by construction (migration 0005 §7). Latency: FR9 bench | One statement: Met. Latency: not yet measured |
| NFR-SCAL-1 | Multiple terms, sections, departments and years without schema change. | New terms and offerings are rows, not columns. MongoDB documents carry a shard-key-ready `{college_id, team_id}`. | Schema inspection | Met for PostgreSQL; `college_id` in MongoDB documents: Planned |

### 3.5.7 Usability, explainability and maintainability

| ID | Requirement | Measurable target | Verification | Result |
|:-----|:----------|:--------|:--------|:--|
| NFR-USE-1 | Every refusal is explainable to the user. | 100% of RPC and trigger errors carry a SQLSTATE and a stable rule key (DETAIL or constraint name) that maps to a form field or message. | `03_rpc.sql` and `04_abuse_cases.sql` assert `SQLSTATE:rule` pairs; `web/e2e/01` (friendly wrong-password message), `04` ("team full" message) | Met |
| NFR-USE-2 | The rubric sheet is recognisable to faculty. | Same rows, columns and totals as the paper sheet (Appendix F). | Faculty walkthrough (UI phase) | Planned |
| NFR-EXP-1 | Every mark is traceable. | From any rubric cell, ≤ 2 clicks reach the claims, their evidence and their countersigns. | `web/e2e/05-ramesh-sheet.spec.ts` opens the sheet; the click count is not yet asserted | Built, not verified |
| NFR-EXP-2 | Answers cite records. | 100% of answer sentences cite chunk ids; cited $\subseteq$ retrieved; a citation whose quote is not in its chunk is dropped. | `test_ask_student_answers_are_scoped_and_cited`, `test_extractive_answer_quotes_whole_sentences`, `test_generative_citations_are_checked_against_the_retrieved_chunks`, `test_generative_answer_drops_uncited_text` (stubbed model) | Met for extractive answers; generative path verified with a stub only |
| NFR-MNT-1 | Schema changes are versioned and append-only. | Migrations in timestamp order. No migration drops or renames a fixture column (C2). | Code review; NFR-REL-4 | Met |
| NFR-MNT-2 | The whole database can be rebuilt from source. | Migrations 0001–0006, the fixture seed, the demo seed and the ingest seed apply with 0 errors. | Gate G2 | Met |

## 3.6 Software requirements

| Category | Software | Version used | Purpose |
|:--|:--|:--|:----------|
| Operating system (client) | Windows 10+, macOS 13+, Linux, Android, iOS | any current | Browser access |
| Operating system (development) | Windows / Linux / macOS (as in the Synopsis) | any current | Development and verification |
| Browser | Chrome, Edge, Firefox, Safari | current and previous major | Web client |
| RDBMS | PostgreSQL (Supabase-managed) | 17.11 | Relational store, RLS, triggers, RPCs |
| PostgreSQL extensions | pgvector (`vector`); pgmq (Supabase Queues); pgTAP (tests only) | bundled with Supabase PostgreSQL 17 | Embeddings and HNSW index; ingest queue; unit tests |
| Backend platform | Supabase: PostgREST, Auth (GoTrue), Realtime, Edge Functions (Deno), Supabase CLI via `npx supabase` | cloud and CLI current | Data API, authentication, live notices, webhook receiver, migrations, local stack |
| NoSQL database | MongoDB (Atlas; local `mongo:8`); `mongosh` via `npx` | 8.0 | Notes, note versions, raw events, portfolios |
| Front end | React, TypeScript, Vite; **Tailwind CSS** with shadcn/ui; react-router, TanStack Query, react-hook-form, zod; `supabase-js`; oxlint | React 19.3, TypeScript 7.0, Vite 8.3, Tailwind CSS 4.3 | Web client, styling, form validation |
| End-to-end testing | Playwright | 1.64 | Persona walkthroughs (G8) |
| Runtime | Node.js | 24 | Tooling and build |
| Service layer | Python via `uv`; FastAPI, uvicorn, pymongo, PyJWT, httpx; pytest | Python 3.12; FastAPI ≥ 0.115 | Notes API, consistency report, `/ask`, ingest worker, portfolio export, tests |
| Experiments | Python 3.12 with asyncpg | 3.12 | Race harness and report generation |
| AI services (built, not configured) | Voyage AI embeddings; Anthropic Claude API | current at build time | Embeddings (1024-d); model-written cited answers |
| Integration | GitHub repository webhooks (built); GitHub OAuth (planned); Obsidian with the Obsidian Git plugin (built) | current | Evidence ingestion; identity binding |
| Stretch (not used now) | Tiptap with Yjs (Hocuspocus) | n/a | Real-time co-editing (§2.8) |
| Containers | Docker Desktop; images `supabase/postgres:17.11`, `postgres:17`, `mongo:8`, Supabase local stack | current | Verification environment |
| Documentation | Graphviz, pandoc (with XeLaTeX), python-docx | Graphviz 2.x (`nshine/dot`), pandoc 3.11 | Diagrams and report generation |

## 3.7 Hardware requirements

| Role | Minimum | Recommended |
|:--|:----------|:----------|
| End-user device | Dual-core CPU, 4 GB RAM, 1280 × 720 display, 2 Mbps connection | Quad-core CPU, 8 GB RAM, 1920 × 1080 display |
| Development machine (as in the Synopsis) | Intel Core i3 / AMD equivalent, 8 GB RAM, 20 GB free storage, Internet connection | 4+ cores (or Apple silicon), **16 GB RAM** to run the local Supabase stack and race harness together, 40 GB free SSD storage |
| Database server | Managed: Supabase free plan (shared CPU, 500 MB database) | Supabase Pro-class instance for multi-department use |
| Document store | Managed: MongoDB Atlas shared tier (512 MB) | Dedicated M10-class cluster with replica set |
| Demo venue | Projector (HDMI), stable Internet or a phone hotspot | A recorded fallback video of every live step |

## 3.8 Known defects and gaps register

Gaps found while verifying this revision. Fixing a schema item needs a new migration (an append-only change, C2); that is outside the scope of this document, so each is recorded with the requirement it affects.

| ID | Defect or gap | Affects | Proposed resolution |
|:--|:----------|:--|:----------|
| D1 | One claim can cite the same `commit`, `url` or `file` reference more than once: only contribution and version pointers have partial UNIQUE indexes. | FR6.2 | Partial UNIQUE index on `(claim_id, kind, ref) WHERE ref IS NOT NULL` |
| D2 | A direct INSERT or UPDATE of `assessment` by an administrator may name any faculty member in `assessed_by`. | FR7.3, NG3 | Require `assessed_by` to be NULL-able with an `entered_by` audit column, or forbid admin INSERT and keep only admin DELETE/UPDATE |
| D3 | ~~The composite foreign keys of `skill_evidence` have no covering index.~~ **Closed in revision 1.2** by migration 0005 §4; the advisor reports 0 unindexed foreign keys (5 Nov 2026). | NFR-PERF-3 | Done: indexes on `(claim_id, usn)` and `(contribution_id, usn)` |
| D4 | `v_semester_hub` picks the next component by deadline only and may show a locked component. | FR3.1 | Add `AND m.locked_at IS NULL` to the view's lateral subquery |
| D5 | `artifact_chunk.version_no` has no foreign key to `artifact_version`. | FR9.1 | Deliberate for the frozen fixture rows (migration 0002 §9); new chunks can be checked by trigger |
| D6 | Leaked-password protection is disabled in the cloud project's Auth settings (security advisor WARN). | NFR-SEC | Enable it in the Supabase dashboard |
| D7 | `note_versions` is append-only by API contract and unique `_id`; a database user with write access could still edit a document. | FR11.3 | Connect the API with an Atlas role that has only `find` and `insert` on `note_versions` |
| D8 | Missing automated tests: row counts after a refused `submit_milestone` (NFR-REL-1); concurrent attempt allocation (NFR-CON-4); `claim.status`, `claim.revision` and `countersign.signed_at` grants (NFR-SEC-7); API DELETE of `artifact` refused (FR10.1); administrator unlock (FR7.4); a pass/fail assertion script for `mongo/portfolio_merge.js` (FR10.2 is checked by the scripted run of G11, not by an assertion); pgTAP tests assume the seed state, so they run on a freshly reset database. | Several | Add to `03_rpc.sql`, the race harness and a MongoDB test; run pgTAP on a freshly reset database |
| D9 | Continuous integration is written (`.github/workflows/fixture.yml`) but not active: pushing a workflow file needs a GitHub token with the `workflow` scope. Until then the gates of §4 are run by hand. | NFR-MNT-1, NFR-REL-4 | Push the workflow with a `workflow`-scoped token |
| D10 | Real AI services never exercised: no Anthropic or Voyage key exists, so FR9.5 is tested with stubs only and no chunk has an embedding (0 of 58 on the live project). | FR9.5, NFR-PERF-4 | Issue the keys (budget C8), run `--embed-missing`, and repeat the FR9 tests against the real services |

# 4. Verification summary

Revision 1.3 cites the recorded runs of 19 November 2026 for the test suites (counts below). The live project was checked read-only through the Supabase Management API on 5 November 2026 (G7, advisors and pipeline counts) and again on 19 November 2026 (applied migrations). The pgTAP files run on a freshly reset database, because they assume the seed state (D8); each file runs in a transaction that is rolled back.

| Gate | What it verifies | Requirements covered | How | Result (19 Nov 2026) |
|:--|:----------|:--|:----------|:--|
| G1 | Fixture regression | C1, NFR-REL-4, logical data independence (§2.1) | `scripts/test_fixture.sh`, `scripts/test_mongo_fixture.sh` | Q1–Q37: 37/37. M1–M25: 25/25 |
| G2 | Migrations and seeds apply cleanly | NFR-MNT-2 | `npx supabase db reset` of migrations 0001–0007, `fixture/02_seed.sql`, `seed/demo.sql`, `seed/ingest.sql` | 0 errors |
| G3 | RLS matrix and privacy | NFR-SEC-1 to -4, -8; NFR-PRI-1 to -4; FR1, FR3, FR7 views | `supabase/tests/02_rls_matrix.sql` | 301/301 |
| G4 | Constraint gallery | NFR-INT-1 to -3; FR1, FR2, FR4, FR5, FR10.1 | `supabase/tests/01_constraints.sql` | 48/48 |
| G5 | Concurrency | NFR-CON-1 to -3; NFR-PERF-1 | `experiments/race/` (harness, capacity and skew scripts) | Full harness: recorded run 2026-11-04 17:15–17:28 UTC (72,000 races; not re-run). `membership_skew_check.sh` re-run 19 Nov 2026: races 1–3 at RC, RR and SER, no write skew and no stale countersign (race 3 now uses a team T06 claim) |
| G6 | RPC behaviour per persona | FR2 to FR8; NFR-SEC-3, -5; NFR-REL-2; NFR-USE-1 | `supabase/tests/03_rpc.sql` | 129/129 |
| G6b | Abuse cases | NFR-SEC-6, -7; FR4 to FR7 | `supabase/tests/04_abuse_cases.sql` | 53/53 |
| G6c | Ingestion, search and Realtime | FR5.5, FR7.9, FR9.1–FR9.3; NFR-REL-3, -6; NFR-SEC-2, -5; NFR-PRI-7, -8 | `supabase/tests/05_ingest.sql` (§A catalog, §B inbox idempotency, §C projection, §D replay, §E unknown authors and failure atomicity, §F `search_chunks` under RLS, §G Realtime topics and payload, §H RLS on the new tables); `06_ingest_worker.sql` (failure counting, dead letters, service-role only) | 120/120; 16/16 |
| G6d | Strict marks | FR7.3; NFR-INT-1 | `supabase/tests/07_strict_marks.sql` (migration 0007: a mark with a second decimal is refused on every write path; accepted marks are stored at scale 1) | 43/43 |
| G7 | Cloud deployment and Supabase advisors | §2.4; NFR-SEC; NFR-PERF-3 | Supabase Management API on `countersign-dbms` (read-only): project status, applied migrations, Edge Functions, row counts of the pipeline, security and performance advisors | 19 Nov 2026: migrations 0001–0007 applied. Recorded 5 Nov 2026: ACTIVE_HEALTHY; PostgreSQL 17.11; `github-webhook` ACTIVE. Pipeline after 16 replayed deliveries: `ingest_event` 9 projected + 1 ignored, 29 GitHub contributions, 58 chunks (49 projected snapshot chunks), 0 embeddings. Security: **0 ERROR**, 4 WARN (3 = the intended SECURITY DEFINER private-note RPCs; 1 = leaked-password protection off, D6), 1 INFO (`private.note` has RLS and no policy: intended, RPC-only). Performance: **0 ERROR, 0 WARN**, 39 INFO, all `unused_index` (expected at demo volume); 0 unindexed foreign keys |
| G8 | Web end-to-end per persona | UI-1 to UI-5; FR3, FR4, FR5.5, FR6, FR7, FR7.9, FR9; NFR-PRI-4, -7 | `web/e2e/*.spec.ts` (Playwright, specs 01–11; 11 is the race arena) | 44/44 |
| G9 | Service layer and worker | FR5.5, FR5.6, FR9.4, FR9.5 (stubbed), FR11.4, FR11.5; NFR-SEC-9; NFR-PRI-6, -8; NFR-REL-3, -6; NFR-EXP-2 | `cd api && SUPABASE_TARGET=local MONGO_TARGET=local uv run pytest` (`test_api.py`, `test_worker.py`, `test_race.py`; the race tests need the race lab container started by `experiments/race/setup.sh`) | 66/66 |
| G10 | MongoDB validators | FR11.3 | `scripts/check_mongo_validators.sh --local`; on Atlas, validators applied to `elp` | Recorded 5 Nov 2026: PASS: fixture writes M1–M3, M15–M17 accepted; 6 malformed writes rejected (code 121) |
| G11 | Portfolio rebuild | FR10.2 | Scripted run on a disposable `mongo:8` container: `mongo/seed.js`, `mongo/validators.js`, then `mongo/portfolio_merge.js` (also run by `scripts/mongo_local.sh` on every local reset) | Recorded 5 Nov 2026: PASS: 8 portfolios written, 8 of 8 stamped `generated_at`; every merged document accepted by the strict `$jsonSchema` validator |

The seven pgTAP files declare 710 assertions in total (48 + 301 + 129 + 53 + 120 + 16 + 43); all 710 passed. The 16 replayed webhook deliveries of `ingest/fixtures/` gave the expected result for all 16 on the local stack.

# Appendix A. Mapping to the Component 2 rubric

| Rubric criterion (marks) | Where it is addressed |
|:--|:--|
| Software and hardware requirements: correct, complete, logical sequence (2) | §2.4 operating environment with status; §3.6 software requirements (with versions and purpose); §3.7 hardware requirements (minimum and recommended, per role) |
| Functional and non-functional requirements: all listed correctly and completely (2) | §3.2 FR1–FR11 with sub-requirements and status; §3.3 traceability to database objects and tests; §3.4 privacy tiers and the exact faculty projection; §3.5 NFRs with measurable targets, verification and result; §3.8 known defects |
| File maintenance and updation (1) | Revision history (document control); §2.8 disposition of every Synopsis requirement not built as stated; Appendix B review log; diagram sources kept as `docs/lab/diagrams/c2_*.dot`; this document and its DOCX/PDF generated from `docs/lab/C2_SRS.md` by `docs/lab/build_c2.sh`; Appendix C change log for revision 1.2; Appendix D change log for revision 1.3 |

# Appendix B. Review log for revision 1.1

Each examiner item, the action taken, and whether it was accepted in full.

| # | Item | Action in revision 1.1 | Accepted |
|:--|:----------|:----------|:--|
| 1 | Data independence and three-schema table | §2.1 rewritten with the Elmasri & Navathe definitions and worked examples (Q1–Q37 unchanged after 0002; 0002 §10 indexes). MongoDB removed from the internal level; RPCs moved to a separate "external interfaces" row. | Yes |
| 2 | FR10 "every FK is RESTRICT" | FR10 refinement rewritten: full FK delete-action table; the RLS no-DELETE rule named for `artifact`, `artifact_version`, `contribution`, `submission` (and `submission_artifact`); traceability row lists the tables. The cascade example was confirmed by a manual check. | Yes |
| 3 | Stale statuses | All statuses re-derived and frozen at 4 Nov 2026 23:55 IST (§1.5); FR5, FR8, FR10, FR11, NFR-SEC-9 and §2.4 updated; Figures 1 and 3 redrawn. Nothing upgraded to Implemented without a test run on that date. `portfolio_merge.js` stays "Built, not verified". | Yes |
| 4 | Performance figures | NFR-PERF-1 now quotes 5.99 ms (RR) and 12.10 ms (RC), citing `results.md` lines 196 and 192. | Yes |
| 5 | Faculty "metadata only" | U2, C6, §3.4 tier table and FR7.7 corrected; exact per-table faculty projection added (§3.4.1). | Yes |
| 6 | Administrator statements | FR7.3, FR7.4, NFR-REL-2 and U3 corrected; admin-only privileges listed; Administrator removed from "Record marks" (Figure 2b); D2 recorded. | Yes |
| 7 | Artifact sources | FR5 refinement: artifact `source` has three values; `manual` exists only for contributions. | Yes |
| 8 | Duplicate evidence | FR6.2 restricted to the two indexed pointer kinds; both index names added to the FR6 row; the gap recorded as D1 (no schema change in this revision). | Yes |
| 9 | Figures 4 and 5 illegible | Both redrawn top to bottom; every figure is checked by `c2_check_figures.py` to print at ≥ 8 pt (Figures 4 and 5 print at about 9 pt). | Yes |
| 10 | Claim life cycle | Figure 4 redrawn as a UML state machine with the missing transitions (t8–t10), the guard on t6, the lock as an orthogonal region, a final state, and "content frozen" on contested. The return to pending carries the guard [no countersign remains], since withdrawing one countersign while others remain does not return the claim to pending. | Yes, with that precision |
| 11 | Visibility tiers | Figure 5 redrawn: refused attempts are notes with path-specific SQLSTATEs; the guard is "a `submission_artifact` row exists"; admin added as reader; no double border, no false final state. | Yes |
| 12 | Use-case notation | Figures 2a and 2b: stick-figure actors, GitHub and Obsidian as secondary actors of ingestion, Voyage AI and Anthropic as secondary actors of FR9, "View lab CIE marks", Administrator removed from "Record marks". | Yes |
| 13 | Figures 1 and 3 | Client OS includes Android and iOS; FastAPI shown running locally, Vercel dashed as planned; cluster titles no longer clipped; Figure 1 says "26 public tables + private.note". | Yes |
| 14 | Over-claimed verification | NFR-REL-1 cites construction (plus a manual check) and records the missing assertion; NFR-CON-4 and NFR-SEC-6/-7 restated; NFR-SEC-5 credited to `03_rpc.sql` §A only; G6 no longer claims FR1; G7 **verified** through the Management API instead of left "to be verified". | Yes |
| 15 | Dropped Synopsis requirements | §2.8 records Tiptap + Yjs (Stretch), Realtime and Queues (Planned), "simultaneous edits" (Refined), and more; Tailwind CSS and shadcn added to §3.6. | Yes |
| 16 | "shall carry" on nullable columns | FR5.2 and FR9.1 now say what is required, what is optional, and that `artifact_chunk.version_no` is not linked (D5). | Yes |
| 17 | FR4.6 and FR8.3 | FR4.6 states the thresholded division exactly (and the empty-divisor difference); FR8.3 says the classification uses the declared level only. | Yes |
| 18 | FR3.1 "next open component" | Reworded to "next upcoming component"; the view is not changed in this revision (schema changes are out of this document's scope) and the gap is D4. | Yes (rewording option) |
| 19 | Format, authors, standard | RVCE header block on the cover, team table by USN, Times New Roman, header and page numbers in both outputs; authors named in the revision history; ISO/IEC/IEEE 29148:2018 cited as the governing standard. The official RVCE template file is not available in the repository, so body styles approximate the Synopsis. | Partly: template file outstanding |
| 20 | Competitor table | §2.1.1 softened ("by default", "typically", "not built in"), corrected for GitHub Classroom group assignments and Moodle individual grade overrides, and given vendor-documentation sources (reference 8). | Yes |
| 21 | Matrix cells | A "MongoDB and service objects" column added; `mongo/04_mongo.js` M1–M25 moved to the verification column; FR10 lists its tables. | Yes |

No item was rejected.


# Appendix C. Change log for revision 1.2

| # | Change | Sections |
|:--|:----------|:--|
| 1 | FR5.5 GitHub and Obsidian ingestion: Planned → **Implemented**, with sub-requirements FR5.5.1–FR5.5.4 (receive, log then project, credit, failure handling). FR5: Partial → Implemented. | §3.2 FR5; §2.8; §3.1.2; §3.3 |
| 2 | FR7.9 live notices through Supabase Realtime added and **Implemented** (metadata-only private broadcast); UI-5 added. | §3.2 FR7; §2.8; §3.1; §3.4.1 |
| 3 | FR9 split into FR9.1–FR9.6: retrieval (`search_chunks`) and extractive cited answers (`POST /ask`) **Implemented**; model-written answers and embeddings **Built, not configured** (no keys); query log Planned. | §3.2 FR9; §3.3 |
| 4 | FR10.2 portfolio rebuild: Built, not verified → **Implemented** (gate G11); the student-facing export separated out as FR10.4 (Planned). | §3.2 FR10; §4 |
| 5 | FR11.4 consistency report restated at commit level; FR11.5 rebuild of the projection from the raw log added (**Implemented**). | §3.2 FR11 |
| 6 | Traceability extended with `team_repo`, `student_identity`, `ingest_event`, the pgmq queue, the five pipeline RPCs, `search_chunks()`, the broadcast trigger and policy, and the tests `05_ingest.sql`, `06_ingest_worker.sql`, `test_worker.py` and e2e spec 10. | §3.3 |
| 7 | NFRs updated: SEC-2, SEC-5, SEC-9, REL-3, PERF-3 (D3 closed), PERF-4, EXP-2; new REL-6, PRI-7, PRI-8. | §3.5 |
| 8 | Operating environment and verification re-derived for 5 Nov 2026 (migrations 0001–0006, Edge Function, live replay counts, advisors, 657 pgTAP assertions, 47 API tests, 38 e2e tests, new gates G6c and G11). New defects D9 (CI not active) and D10 (AI services never exercised). | §2.4; §4; §3.8 |
| 9 | Figures 1, 2a, 2b and 3 redrawn: ingestion, search, Realtime and the Edge Function are solid; only the AI model services (and the portfolio export, Vercel hosting) remain dashed. | §2.1, §2.2, §2.4 |
| 10 | NFR-REL-5 Planned → **Met** for the C9 demo: the backup and restore drill of `docs/RUNBOOK.md` §4.3 was run on 5 Nov 2026 (later the same day as revision 1.2, after the lab panel's review of C7–C11). | §3.5 |

# Appendix D. Change log for revision 1.3

| # | Change | Sections |
|:--|:----------|:--|
| 1 | Countersign is now a solo project: the cover, document control and revision history name one author. In the demo data, team T00 'Countersign' has one member (1RV24CY047, lead); his claims stay `pending`, because no teammate exists to countersign them, and rest on their evidence and the faculty review. No schema change was made for solo teams; the web pages explain the case. The teammate countersign flow is demonstrated on team T06. | Cover; document control; §4 |
| 2 | Migration 0007 (strict marks): `assessment.marks` is unconstrained NUMERIC with a one-decimal CHECK, so the rounding gap of NUMERIC(4,1) is closed on every write path. FR7.3 and the FR7 traceability row updated; new gate G6d. | §3.2 FR7; §3.3; §4 |
| 3 | Operating environment: the race arena page and `POST /race/run` (only the request that owns the race lab resets it), the resilient `worker --loop`, the rubric sheet refetch on window focus, 66 API tests. | §2.4 |
| 4 | Test gates re-run on 19 Nov 2026: pgTAP 710/710 in 7 files, SQL fixture 37/37, MongoDB fixture 25/25, API 66/66, e2e 44/44, webhook replay 16/16, membership skew check passed (G7 advisors, G10 and G11 keep their 5 Nov 2026 results). Migrations 0001–0007 verified as applied on the cloud project. NFR-INT-1, NFR-SEC-6 and NFR-SEC-9 updated to the new test texts and counts. | §1.5; §3.5; §4 |
