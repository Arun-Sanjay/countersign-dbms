---
title: "Component 5: Data Flow Diagrams (Level 0, Level 1, Level 2)"
subtitle: "Unified Experiential Learning and Project Intelligence Platform (product name: Countersign)"
author:
  - "S Arun Sanjay (1RV24CY047)"
  - "Sanvid Razdan (1RV24CY051)"
date: "Database Management Systems (CD252IA), Semester V, Department of CSE, RV College of Engineering, Bengaluru. Revision 2, 4 November 2026"
---

# 1. Purpose and scope

This document presents the data flow diagrams (DFDs) of the platform at three levels of abstraction, as required by lab Component 5 (DFD Level 0/1/2, 10 marks):

* **Level 0 (context diagram):** the whole system as one process (process 0), its six external entities and every data flow that crosses the system boundary.
* **Level 1:** the explosion of process 0 into eight numbered processes (1.0 to 8.0) and the fourteen data stores they share. Every data store is named after the **actual** PostgreSQL tables or MongoDB collections that hold its data (`supabase/fixture/01_schema.sql`, `supabase/migrations/*.sql`, `mongo/validators.js`).
* **Level 2:** the explosion of the two core processes of the design thesis ("every mark has a receipt"): **4.0 File and countersign claims** and **5.0 Submit and assess components**.

A DFD models *what data moves where and what transforms it*. It is a logical model. It shows neither control flow (loops, decisions, the order in which processes run) nor the physical mechanism (HTTP, queues, threads). To help the evaluator connect a process to the implemented database, the bottom band of each process box names the stored procedure (RPC), trigger, view or script that realises it. This annotation is the Gane-Sarson "mechanism" compartment. It is not part of the logical model.

**Implemented versus planned.** The diagrams show the system as it is built today (migrations 0001 to 0004, `mongo/validators.js`, `mongo/portfolio_merge.js` and the FastAPI service in `api/app`), together with the parts that are designed but not yet built. Every planned element is drawn **dashed** and labelled **[planned]**, and every table marks it in a *Status* column. The planned parts are: process 7.0 (the cited assistant) as a whole; the webhook ingestion of GitHub and Obsidian (F11, F12, S22); embeddings (F16, F17); the student-facing portfolio export (F43, F44); and the derivation of verified skill levels from claims (S43, S44). The API routes that exist today are `/health`, `GET /notes`, `GET /notes/{id}/versions`, `POST /notes` and `/consistency` (`api/app/main.py`). There is no retrieval function, no `/rag/ask` route and no embedding code.

All diagrams are generated from one machine-readable model (`docs/lab/dfd/src/dfd_model.py`). The same model produces every table in this document and runs the balancing, construction-rule and naming checks of Section 10, so a diagram and its tables cannot disagree.

# 2. Notation

The diagrams use **Gane-Sarson notation** (C. Gane and T. Sarson, *Structured Systems Analysis: Tools and Techniques*, 1979). Elmasri and Navathe do not prescribe a DFD notation. The two common notations are Gane-Sarson (rounded rectangles for processes) and Yourdon-DeMarco (circles for processes); they express the same model. We chose Gane-Sarson for two practical reasons. The rectangular process symbol has room for a process number and a mechanism note, and the store symbol has a separate compartment for the store identifier.

| Symbol | Gane-Sarson shape (as drawn) | Meaning |
|------|------------|------------|
| Process | Rounded rectangle. Top band = process number; middle = name (a verb phrase); bottom band = mechanism (RPC / trigger / view / script) | Transforms incoming data into outgoing data |
| Data store | Open-ended rectangle. Left compartment = store id (D1 to D14); right = store name and the actual tables or collections. Green fill = PostgreSQL, cream fill = MongoDB | Data at rest |
| External entity | Shaded rectangle with a heavy border | A source or sink of data outside the system boundary |
| Data flow | Labelled arrow | Data in motion. Every flow carries an identifier and a name |
| Repeated external entity | Entity with a **diagonal stroke across its lower-right corner** | The same entity drawn again on the same diagram, to avoid crossing lines |
| Repeated data store | Store with an **extra vertical bar at its left end** | The same store drawn again on the same diagram |
| Two-headed arrow (process and store) | One arrow with arrowheads at both ends | **Two flows under one label**: a read (store to process) and a write (process to store) of the data named in the label |
| Planned element | Dashed outline or dashed arrow, label marked **[planned]** | Designed, not yet implemented |

Access modes used on store flows and in the tables:

| Mode | Drawn as | Meaning |
|--|--|--|
| read (R) | arrow store to process | The process reads rows of the store |
| write (W) | arrow process to store | The process inserts, updates or deletes rows |
| write (append) (A) | arrow process to store, label marked [append] | The process only inserts. The rows are never updated or deleted afterwards: there is no UPDATE or DELETE policy or column grant (`artifact_version`, `contribution`, `submission`, `submission_artifact`), the collection is append-only by design (`note_versions`, whose `_id` makes each version single-use), or the events are immutable raw records (`github_events`, unique `event_id`) |
| read + write (RW) | two-headed arrow | Two flows: a read and a write |
| read + write (append) (RA) | two-headed arrow, label marked [append] | Two flows: a read and an append-only write |

Conventions specific to these diagrams:

1. **Colour.** Blue arrows are flows with external entities, green arrows are flows with data stores, and the violet arrow on the Level 2 diagram of 4.0 is a flow between two sub-processes. Colour repeats what the shapes already say, so the diagrams remain correct in monochrome print.
2. **Flow identifiers.** Context flows are C01 to C31. Level 1 external flows are F01 to F55, and Level 1 store flows are S01 to S59. A Level 2 flow keeps the id of its Level 1 parent. When one Level 1 flow is split into several Level 2 flows, the parts are numbered F21.1, F21.2, and so on. Internal flows between sub-processes are numbered I4.1. Level 2 store flows are identified by their (sub-process, store) pair.
3. **Store flows are labelled with the data they carry:** the actual table(s) and, where useful, the column(s) read or written, for example `milestone.locked_at`.
4. **Implicit identity read.** Every process runs as the signed-in user. Row-Level Security (RLS) resolves that user through `app_user` (D1) using `app.current_usn()`, `app.current_faculty_id()` and `app.is_admin()`. This identity read happens in every process. It is stated here once and not drawn on every diagram; D1 is drawn only where a process uses directory data as data.
5. **Views are not data stores.** The `security_invoker` views (`v_rubric_sheet`, `v_lab_cie_marks`, `v_faculty_team_progress`, `v_contested_claims`, `v_semester_hub`, `v_what_faculty_sees`) store nothing. In a DFD a view is part of a process that reads base tables. Each view therefore appears as the mechanism of a process, and its base tables appear as the stores that process reads.
6. **Control signals are not data flows.** Starting a batch job (the portfolio rebuild of 8.0), acknowledging a webhook, or a database trigger firing are control, not data, and are not drawn.

# 3. System boundary and external entities

| Entity | Kind | Data it supplies | Data it receives |
|----|----|------|------|
| Student | Person (role `student` in `app_user`) | team join / leave requests; artifacts, versions and links with the AI-assistance declaration; team notes; private notes; claims, claim amendments and withdrawals; evidence references and removals; countersign verdicts and their withdrawal; submissions; declared skills; matching queries; faculty-view preview requests; *questions and portfolio export requests (planned)* | semester hub; membership results; version history; team notes; own private notes; consistency report; claim receipts, claim status and countersign queue; submission receipts; own marks and lab CIE; teammate suggestions and skill gap; "what my faculty sees" preview; *cited answers and portfolio export (planned)* |
| Faculty | Person (role `faculty`) | marks entries; component locks; *questions (planned)* | for the projects they teach: rubric sheet and team progress; submitted work; contested-claim queue and claim trail; class lab CIE marks; assessment receipts and lock summaries; final-note metadata, version receipts and consistency report; taught offerings and project summaries; *cited answers (planned)* |
| College Admin | Person (role `admin`) | directory, term and enrollment records; user-role mappings; project, component and team definitions and placements; skill taxonomy, required skills, course concepts and verified skill levels; component locks **and unlocks**; mark corrections (insert, update, delete) | directory listings and institution totals; **oversight reports for every project** (rubric sheet, team progress, submitted work, lab CIE, contested claims and claim trail), because `app.oversees_project()` is `is_admin() OR teaches_project()`; lock summaries; the portfolio rebuild report |
| GitHub (team repository) | External system | *push events: delivery id, repository, commits (SHA, author, message, files changed) (planned ingestion)* | nothing (the webhook acknowledgement is control, not data) |
| Obsidian vault (in team repository) | External system | *Markdown notes with frontmatter, committed by the Obsidian Git plugin (planned ingestion)* | nothing |
| AI model services (Claude API, Voyage AI) | External system, **planned** | *chunk embeddings, query embeddings, drafted answers with chunk citations* | *chunk text to embed; a question with the chunks the asking user may read* |

Boundary decisions:

* **The College Admin is modelled with its full role.** Besides maintaining the directory, the admin passes every "teaching faculty" oversight check (`app.oversees_project()`), may lock and unlock components (`lock_milestone()` and the `milestone_update` policy; the one-way rule in `trg_milestone_faculty_lock_only` applies only to faculty), may insert, update and delete marks (`assessment_insert`, `assessment_update`, `assessment_delete`), and is the persona that runs the portfolio export (`api/app/export_pg.py` signs in as the admin persona). These flows are drawn: F50 to F55.
* **Obsidian is a separate logical source although it arrives through GitHub.** Physically a vault commit would reach the system as a GitHub push event. Logically its content is a different kind of data (Markdown notes, not code commits) and it is stored differently (`notes` and `note_versions` rather than `github_events`). It is therefore modelled as its own source, as the course brief asks. Both ingestion paths are planned. Today notes are written by students through `POST /notes` (F47).
* **The AI services are outside the boundary, and every flow to them is planned.** Drawing them records a design commitment: only rows that RLS lets the asking user read would be sent (F41), never a raw store.

What each audience can read, as enforced today:

* **The private tier never leaves its owner.** D10 `private.note` is in the non-exposed `private` schema and is reached only through owner-checking RPCs. Its only outgoing flow is F15 to the owning student. Private artifacts, their versions, contributions and chunks, and notes with `visibility = 'private'` are filtered out for everyone else.
* **Faculty and the admin receive more than metadata, and the document says exactly what.** For the projects they oversee, RLS lets them read: claim text (`claim.statement` and `claim.ai_assistance`, in the contested-claim queue F23.1 and in any claim row); the claim trail (`claim_evidence` rows with their `note`, and `countersign` rows with their `comment`, F23.2); artifact, version and contribution rows of non-private artifacts (including `contribution.description`); counts and timestamps (team progress, rubric cells); marks; and chunk **text** only when `artifact_chunk.visibility = 'submitted'` (F31). Team-tier chunk text is never returned to them.
* **MongoDB notes are filtered by the application, not by RLS.** `GET /notes` and `GET /notes/{id}/versions` first ask PostgreSQL, as the caller, which teams the caller may see (`require_team()` reads `v_faculty_team_progress` under RLS). The note filter itself is application code in `api/app/notes.py`. `read_filter()` gives a student member their own notes plus the team's final non-private notes. Staff get only final non-private notes, and `shape_note()` and `list_versions()` blank the `content` unless the note is `submitted` (`content_withheld = true`). Staff therefore receive note **metadata** (title, tags, author, status, version, timestamps, version receipts with `content_hash`) through F49. This is drawn as a flow from 3.0 to Faculty, and the mechanism band of 3.0 names the API.

# 4. Data store catalogue

Fourteen logical data stores group the 27 relations of the PostgreSQL schema (26 tables in `public` plus `private.note`) and 4 of the MongoDB collections by the business object they hold.

<!--GEN:stores-->

Notes on the catalogue:

* **How the relations are grouped.** The grouping follows the entity clusters of the ER design (Component 3). Most stores hold one strong entity type together with what depends on it. D1 is the exception: it is the directory, holding the five strong entity types STUDENT, FACULTY, COURSE, ACADEMIC_TERM and COURSE_OFFERING, the M:N relationship relation `enrollment` (ENROLLS), and the identity table `app_user` (physical schema only). D4 holds two strong entity types, ARTIFACT and CONTRIBUTION (C3 §2 explains why CONTRIBUTION is an entity, not a relationship), and the weak entity ARTIFACT_VERSION. D9 holds the strong entity type SKILL with its recursive relationship, the M:N relationship relations `student_skill`, `project_skill` and `course_skill`, and `skill_evidence` (physical schema).
* **Weak entity types (three, in three stores).** `milestone` in D2 (owner PROJECT, partial key `milestone_no`); `artifact_version` in D4 (owner ARTIFACT, partial key `version_no`); `claim_evidence` in D6 (owner CLAIM, partial key `evidence_no`).
* **Append-only data.** `artifact_version`, `contribution`, `submission` and `submission_artifact` have INSERT policies and column grants but no UPDATE or DELETE policy for API users. `note_versions` is append-only by design: `_id = "<note_id>:<version>"`, a unique index `note_version_desc`, and the API only inserts. `github_events` holds raw push events keyed by a unique `event_id`. Flows into these tables are labelled [append] (Section 2).
* **D13 `note_versions` is implemented.** `mongo/validators.js` creates it with a `$jsonSchema` validator, indexes it (`note_version_desc`) and backfills one snapshot per existing note. `POST /notes` appends a version in the same transaction that updates the note (`api/app/notes.py`), `GET /notes/{id}/versions` reads it, and `portfolio_merge.js` counts it.
* **D11 `github_events` is read today and written by a planned flow.** The `/consistency` report (3.0) and the portfolio rebuild (8.0) read it. Its only writer in the DFD is the planned webhook worker (S22). Until that worker exists, the collection is loaded by `mongo/seed.js`, an initial data load outside the DFD.
* **D10 is in the non-exposed `private` schema.** It has no grants for API roles and is reached only through the owner-checking RPCs `my_private_notes()`, `save_private_note()` and `delete_private_note()`.
* **A store local to 8.0 is not drawn at Level 1.** `pg_portfolio_export` (MongoDB) is written by `api/app/export_pg.py` and read only by `mongo/portfolio_merge.js` (`$unionWith`), both inside process 8.0. A data store used by only one process is internal to that process, so by the levelling rule it belongs on the decomposition of 8.0 (not drawn in this component) and not on Level 1. It holds, per student: `usn`, `name`, `semester`, `projects` (course, title, role, status, skills) and `claims` (pending, confirmed and contested counts). Marks are deliberately left out.
* **Derived data is not a separate store.** Lab CIE marks (`v_lab_cie_marks`), rubric cells and claim queues are computed on read. The one stored derived attribute, `claim.status`, lives in D6 and is maintained only by triggers (sub-process 4.4).

# 5. Level 0: context diagram

```{=latex}
\begin{landscape}
```

![DFD Level 0 (context diagram) of Countersign](dfd/png/dfd_level0_context.png){width=100%}

```{=latex}
\end{landscape}
```

Each context flow is a **composite flow**: a named group of the Level 1 flows listed in the *components* column. This decomposition, a data-dictionary entry such as C03 = F18 + F19 + F20, is what makes Level 0 and Level 1 balance (Section 10). A composite is drawn dashed only when all its components are planned. No composite mixes planned and implemented components (this is checked).

<!--GEN:l0-->

# 6. Level 1: explosion of process 0

The Level 1 diagram has 8 processes, 14 stores, 55 external flows and 59 store flows. It is **one diagram printed on eight sheets, one per process**. On each sheet the external entities and some stores are on the left, the process is in the middle, and the remaining stores are on the right. Entities and stores that serve more than one process appear on several sheets, marked with the Gane-Sarson duplicate symbols. No single-sheet rendering of all 113 labelled flows is provided, because at print size it would not be legible. The whole-level view is given in tabular form instead: the external flows (Section 6.2), the store flows (Section 6.3) and the process / data-store matrix (Section 6.4).

```{=latex}
\begin{landscape}
```

![DFD Level 1, sheet 1 of 8: process 1.0 Manage directory and enrollment](dfd/png/dfd_level1_sheet1.png){width=100%}

![DFD Level 1, sheet 2 of 8: process 2.0 Form teams](dfd/png/dfd_level1_sheet2.png){width=100%}

![DFD Level 1, sheet 3 of 8: process 3.0 Capture work and evidence](dfd/png/dfd_level1_sheet3.png){width=100%}

![DFD Level 1, sheet 4 of 8: process 4.0 File and countersign claims](dfd/png/dfd_level1_sheet4.png){width=100%}

![DFD Level 1, sheet 5 of 8: process 5.0 Submit and assess components](dfd/png/dfd_level1_sheet5.png){width=100%}

![DFD Level 1, sheet 6 of 8: process 6.0 Maintain skills and recommend teammates](dfd/png/dfd_level1_sheet6.png){width=100%}

![DFD Level 1, sheet 7 of 8: process 7.0 Answer questions with citations (planned)](dfd/png/dfd_level1_sheet7.png){width=100%}

![DFD Level 1, sheet 8 of 8: process 8.0 Build portfolio](dfd/png/dfd_level1_sheet8.png){width=100%}

```{=latex}
\end{landscape}
```

## 6.1 Process specifications

FR numbers and titles are those of the submitted SRS (Component 2, `C2_SRS.md` §3.2).

```{=latex}
\begin{landscape}
```

| No. | Process | What it does (logical) | Realised by (implemented) | Planned parts | FRs (C2) |
|---|-------|--------------------------------|-------------------|-----------|---------|
| 1.0 | Manage directory and enrollment | Maintains the directory: students, faculty, courses, academic terms, course offerings (course x term x section, with its teaching faculty), enrollments, the login-to-role mapping, and project and component (milestone) definitions with `max_marks`, `deadline` and `cie_part`. Produces each student's semester hub (enrolled offerings, projects, own team, next deadline, own claim counts), each faculty member's taught offerings and per-project summaries (rolled up from `v_faculty_team_progress`, which counts artifacts, contributions, submissions and claims: hence S04, S05, S06), and the admin's institution totals. | Admin writes under the directory RLS policies; `semester_hub()`, `v_semester_hub`, `v_faculty_team_progress` | none | FR1 Academic records; FR2 Projects and rubric components; FR3 Semester hub |
| 2.0 | Form teams | Admits a student to a team or removes them. Rules: enrolled in the project's offering; at most one team per project (`trg_team_one_per_project`); capacity `max_size` enforced race-safely (`trg_team_capacity_v2`); the first member becomes lead. A member who has recorded work cannot leave (`private.guard_member_history`, trigger `trg_team_member_history_guard`). The guard reads `claim.usn`, `countersign.endorser_usn`, `artifact.owner_usn`, `contribution.usn`, `artifact_version.created_by`, `artifact_chunk.author_usn`, `submission.submitted_by` and `assessment.usn`, which is why 2.0 reads D4 to D8. | `join_team()`, `leave_team()`; admin writes to `team`, `team_member` | none | FR4 Team formation |
| 3.0 | Capture work and evidence | Turns work into attributed, versioned records. In-platform edits and external links become `artifact` / `artifact_version` / `contribution` rows carrying the declared `ai_assistance`; chunk text becomes `artifact_chunk` rows (`tsv` is generated). Team notes are saved in `notes` with an immutable version in `note_versions` per save (optimistic `base_version` check). Private notes are kept in `private.note`. The `/consistency` report compares commits in `github_events` with `contribution` rows (source `github`) per team and author, returning counts and SHAs only. | Editor saves under RLS; `my_private_notes()`, `save_private_note()`, `delete_private_note()`; FastAPI `POST /notes`, `GET /notes`, `GET /notes/{id}/versions` (filter: `api/app/notes.py`), `GET /consistency` | Webhook worker (pgmq-driven): raw push events into `github_events` and their projection into `contribution` (idempotency key `contribution_idempotency_key`) (F11, F12, S22); embeddings (F16, F17) | FR5 Capture of work as artifacts (FR5.5 planned); FR11 Polyglot persistence |
| 4.0 | File and countersign claims | Records "I did X for component C" claims and lets the claimant amend or withdraw them while pending. Attaches and removes evidence pointers. Collects teammates' confirm / dispute verdicts (which a teammate may withdraw while the component is open), derives the claim status, and builds the claim queues. Exploded at Level 2 (Section 7). | `file_claim()`, `add_claim_evidence()`, `countersign_claim()`; `claim_update`, `claim_delete`, `claim_evidence_delete`, `countersign_delete` policies; triggers | none | FR6 Attribution: contributions, claims, evidence, countersigns; FR7.7 (contested-claim queue) |
| 5.0 | Submit and assess components | Freezes the submitted versions of a component atomically, records marks per (student, component), locks components (the admin may also unlock), and computes the rubric sheet, team progress and the lab CIE (120 -> 30, + 10 + 10 = 50). Exploded at Level 2 (Section 8). | `submit_milestone()`, `record_assessment()`, `lock_milestone()`; `assessment` and `milestone_update` policies (admin); `v_rubric_sheet`, `v_faculty_team_progress`, `v_lab_cie_marks` | none | FR7 Submission, assessment and the rubric view; FR2.6 (lock) |
| 6.0 | Maintain skills and recommend teammates | Records each student's declared skill levels (`student_skill`). The taxonomy (`skill`, recursive `parent_skill_id`), required levels (`project_skill.min_level`), course concepts (`course_skill`) and verified levels (`skill_evidence`) are admin-only writes under RLS and arrive through F33. Answers the complementary teammate finder (Required(P) - Mine, ranked by partial division, eligibility through `app.is_eligible_for_project()`, which reads `enrollment`), the full-cover finder (relational division), the declared-versus-verified skill gap and the skill subtree (`WITH RECURSIVE`). | `find_teammates()`, `find_full_cover()`, `skill_gap()`, `skill_subtree()`; `student_skill` policies | Deriving `skill_evidence` from confirmed claims and contributions (materialized view, PLAN.md P4): S43, S44 | FR8 Evidence-backed skills (verified-level derivation planned); FR4.5, FR4.6 |
| 7.0 | Answer questions with citations | Will answer a question using only the rows the asking user may read: one SQL statement fusing full-text rank on `artifact_chunk.tsv` with vector similarity on `artifact_chunk.embedding`, run as the user under RLS. The AI service drafts an answer that must cite retrieved chunk ids. | Storage and indexes only: `artifact_chunk` (`tsv`, `embedding`), GIN and HNSW indexes, chunk RLS policy | Whole process: `search_chunks()`, `/rag/ask`, flows F37 to F42 and S45 to S47 | FR9 Permission-aware cited assistant (planned) |
| 8.0 | Build portfolio | (a) Rebuilds one portfolio document per student in `portfolios`. `export_pg.py`, signed in as the admin persona, exports the relational half (student, team membership and project, `project_skill` names, claim status counts; never marks) into the local collection `pg_portfolio_export`. `portfolio_merge.js` then streams `notes`, `note_versions`, `github_events`, `pg_portfolio_export` and `portfolios` through `$unionWith`, groups by `usn` and upserts with `$merge`, stamping `generated_at`. (b) Renders the "what my faculty sees" preview (`v_what_faculty_sees`), which reads the student's own artifacts, versions, contributions, submitted chunks, claims and marks under the faculty branch of the policies: the D4, D5 and D8 reads serve only this preview (F45). | (a) `api/app/export_pg.py` + `mongo/portfolio_merge.js`, a batch run by the admin (F55); (b) `v_what_faculty_sees` | Student-requested portfolio export (F43, F44) | FR10 Permanent record and portfolio (FR10.2 export planned); FR7.8 (preview); FR11 |

```{=latex}
\end{landscape}
```


## 6.2 Level 1 external flows

<!--GEN:l1-->

## 6.3 Level 1 store flows

<!--GEN:s1-->

## 6.4 Process / data-store access matrix

R = read, W = write (insert, update or delete), A = write (append). A mode followed by \* is planned. The matrix is the tabular form of the green flows. Every store is written by at least one process and read by at least one process. The only store whose write is planned is D11 (Section 4).

<!--GEN:matrix-->

# 7. Level 2: process 4.0 File and countersign claims

```{=latex}
\begin{landscape}
```

![DFD Level 2 of process 4.0, sheet 1 of 2: sub-processes 4.1 and 4.2](dfd/png/dfd_level2_p4_sheet1.png){width=100%}

![DFD Level 2 of process 4.0, sheet 2 of 2: sub-processes 4.3, 4.4 and 4.5](dfd/png/dfd_level2_p4_sheet2.png){width=100%}

```{=latex}
\end{landscape}
```

## 7.1 Sub-process specifications

**4.1 File, amend and withdraw claims** (`file_claim()`; policies `claim_update`, `claim_delete`; triggers `trg_claim_guard`, `trg_claim_member_required`, `trg_claim_status_derived`).

* *Filing* (F18.1): project, component, contribution type, statement and AI-assistance declaration, optionally an artifact. The process derives the claimant's team from `team_member` (one team per project, so the team is a function of `(usn, project_id)`). It rejects the claim if the component is locked (`milestone.locked_at` set; SQLSTATE 55000), if the contribution type is outside {research, design, code, documentation, review}, if the statement has fewer than 10 characters, or if the AI-assistance value is outside {none, assisted, generated}. It writes one `claim` row, whose status the trigger derives as `pending`. If an artifact is named, it also writes evidence #1 pointing at the artifact's latest `artifact_version`. Output F21.1: the claim receipt.
* *Amending* (F18.2): while the claim is pending and its component open, the claimant may update `statement`, `ai_assistance`, `contribution_type` and `milestone_no`, the only columns granted for UPDATE. `trg_claim_guard` refuses the change once any countersign exists (`claim_not_pending`) and increments `claim.revision`, so earlier reads become stale for signing.
* *Withdrawing* (F18.3): the claimant may delete a pending claim on an open component (`claim_delete`). Its evidence rows go with it (ON DELETE CASCADE of the weak entity).

**4.2 Attach and remove evidence** (`add_claim_evidence()`; policy `claim_evidence_delete`; triggers `trg_claim_evidence_check`, `trg_claim_evidence_revision`). Input F19.1: an evidence kind (contribution, artifact_version, commit, url, file), a reference and a note. Only the claimant may add evidence, and only while the claim is pending and its component is open. The CHECK `claim_evidence_kind_matches` forces exactly the pointer that matches the kind. `claim_evidence_ref_format` forces a commit to be a hex SHA and a URL to be http(s). The trigger enforces that the evidence belongs to the claimant's team and that a cited contribution is the claimant's own. The process locks the claim row so that concurrent additions get consecutive `evidence_no` values. Input F19.2: the claimant may remove an evidence row under the same conditions. Each insert **or delete** bumps `claim.revision`, because the evidence list is part of what a teammate endorses. Output F21.2: the evidence receipt.

**4.3 Record and withdraw verdicts** (`countersign_claim()`; policy `countersign_delete`; trigger `trg_countersign_check`). Input F20.1: verdict (confirm or dispute), comment, and the claim revision the signer read. Rules: a dispute needs a comment (CHECK `countersign_dispute_needs_comment`); a student cannot countersign their own claim (`countersign_not_self`); the endorser must be a member of the claimant's team (`countersign_teammate_required`); the component must be open; and the revision read must equal the current `claim.revision`, otherwise the signature is refused (`countersign_stale_revision`). The last rule is optimistic concurrency control: nobody can endorse text they did not see. The verdict is upserted on `(claim_id, endorser_usn)`, so re-signing replaces the earlier verdict. Input F20.2: an endorser may withdraw their own verdict while the component is open. Outputs: F21.4, the verdict receipt (verdict, whether it revised an earlier one, and the resulting claim status); I4.1, the verdict change passed to 4.4.

**4.4 Derive claim status** (triggers `trg_countersign_sync_status`, `trg_claim_status_derived`; function `private.claim_status`). On every insert, update or delete of a countersign it recomputes `claim.status`: contested if any verdict is a dispute, confirmed if at least one confirm and no dispute, pending otherwise. Withdrawing the only verdict therefore returns a claim to `pending`, which reopens it for amendment. `status` is a stored derived attribute that no user can write: any write to `claim` recomputes it. 4.4 is implemented as triggers, which do not answer anybody directly. **F21.3 reaches the student when the claim is next read:** the recomputed `claim.status` is returned with the claim row (and in the semester hub's claim counts).

**4.5 Build claim queues and trails** (`semester_hub()` student branch; `v_contested_claims`; claim rows read under RLS). For a student (F22) it produces the countersign queue. `semester_hub()` returns only its **count** (teammates' pending claims the student has not signed); the claims themselves, with their evidence and current revision, are read directly from `claim` and `claim_evidence` under RLS. For faculty (F23) and the admin (F50) it produces two flows. F23.1 is the contested-claim queue from `v_contested_claims`: claim id, project, team, component, claimant, `statement`, `ai_assistance` and creation time, plus **only counts** (disputes, confirms) and `last_disputed_at`. F23.2 is the claim trail: the `claim_evidence` and `countersign` rows (including evidence notes and countersign comments), read by **separate RLS-governed queries**, not by the view. No flow combines the AI-assistance declaration with any score (Section 11).

## 7.2 Level 2 flows of 4.0

<!--GEN:l2_4_flows-->

<!--GEN:l2_4_stores-->

# 8. Level 2: process 5.0 Submit and assess components

```{=latex}
\begin{landscape}
```

![DFD Level 2 of process 5.0, sheet 1 of 3: sub-processes 5.1 and 5.2](dfd/png/dfd_level2_p5_sheet1.png){width=100%}

![DFD Level 2 of process 5.0, sheet 2 of 3: sub-processes 5.3 and 5.5](dfd/png/dfd_level2_p5_sheet2.png){width=100%}

![DFD Level 2 of process 5.0, sheet 3 of 3: sub-process 5.4](dfd/png/dfd_level2_p5_sheet3.png){width=100%}

```{=latex}
\end{landscape}
```

## 8.1 Sub-process specifications

**5.1 Submit component** (`submit_milestone()`; triggers `trg_submission_open`, `trg_submission_artifact_check`, `trg_submission_artifact_same_txn`, `trg_artifact_chunk_visibility_sync`). Input F24: team, component and artifact ids. The process checks that the caller is a team member, that the component exists and is not locked, and that every artifact belongs to the team, is not private and has at least one saved version. A transaction-scoped advisory lock on (team, component) serialises concurrent submitters, and the process computes `attempt_no = max + 1`; `UNIQUE (team_id, project_id, milestone_no, attempt_no)` is the backstop. It writes the `submission` row and one `submission_artifact` row per artifact with the **latest `version_no` frozen**, and moves each artifact's visibility from `team` to `submitted`. A trigger propagates the change to its `artifact_chunk` rows. All of this is one transaction: either the whole submission is recorded or none of it is. Output F25: the receipt (submission id, attempt number, frozen versions).

**5.2 Record marks** (`record_assessment()`; policies `assessment_insert`, `assessment_update`, `assessment_delete`; trigger `trg_assessment_check`). Input F27: USN, component, marks, remarks. `record_assessment()` accepts only faculty, and only the faculty member teaching the project's offering (`app.teaches_project()`, read from `course_offering` and `course`). Input F52: the admin corrects marks directly under the `assessment` policies (insert, update and, for the admin only, delete). For both inputs, marks must be non-negative (CHECK) and are stored with one decimal (`NUMERIC(4,1)`; the RPC also rejects a second decimal), and the trigger enforces `marks <= milestone.max_marks`, that the component is not locked (it takes a FOR SHARE lock on the milestone row, so a concurrent lock waits), and that the student is in a team of the project. The mark is keyed by `(usn, project_id, milestone_no)`, the component grain of the paper marks sheet. Output F29.1: the assessment receipt.

**5.3 Lock and unlock components** (`lock_milestone()`; policy `milestone_update`; trigger `trg_milestone_faculty_lock_only`). Inputs F28 (faculty) and F51 (admin): project and component. `lock_milestone()` admits the teaching faculty or the admin (`app.oversees_project()`). The update is conditional (`... WHERE locked_at IS NULL`), so two concurrent locks cannot both succeed. For faculty the lock is one-way, and faculty may change no other column of `milestone`. The admin may also unlock, by setting `locked_at` back to NULL through `milestone_update`. Locking is the system-wide "freeze" signal: once `milestone.locked_at` is set, 4.1 to 4.3, 5.1 and 5.2 read it and refuse further changes to that component's claims, evidence, countersigns, submissions and marks. Outputs F29.2 and F53: the lock summary (marks recorded, students not yet marked).

**5.4 Compile rubric sheet and team progress** (`v_rubric_sheet`, `v_faculty_team_progress`; `artifact_chunk` read under RLS). Builds the digital equivalent of the paper sheet. There is one cell per (student, component), holding the mark and the pending / confirmed / contested claim counts, and one row per team with counts and the last activity time (members, artifacts, contributions, submissions, claims). Submitted work (F31) is the chunk text whose visibility is `submitted`. The views are `security_invoker`, so RLS on every base table decides which rows a faculty member or the admin (F54.1) sees.

**5.5 Compute lab CIE marks** (`v_lab_cie_marks`). Derives, never stores: `reduced_30 = round(raw_total x 30 / raw_max, 1)` over the components with `cie_part = 'reduced'` (C1 to C9, 120 raw marks), and `total_50 = reduced_30 + innovative_10 + final_10`. A student receives only their own row (F26). Faculty receive the rows of the projects they teach (F32), and the admin the rows of every project (F54.2).

## 8.2 Level 2 flows of 5.0

<!--GEN:l2_5_flows-->

<!--GEN:l2_5_stores-->

# 9. Data dictionary

The entries use DeMarco's notation:

| Symbol | Meaning |
|--|--|
| `=` | is composed of |
| `+` | and |
| `[ a | b ]` | exactly one of the alternatives |
| `{ x }` | iteration: zero or more x; `m{ x }n` = between m and n |
| `( x )` | optional |
| `@x` | x is (part of) the key |
| `* text *` | comment |

## 9.1 Data elements

```
usn               = 10{character}10       * e.g. 1RV24CY047 *
faculty_id        = 1{character}6
team_id           = "T" + 2{digit}3       * e.g. T01 *
project_id        = 1{character}5
artifact_id       = 1{character}5
milestone_no      = positive integer      * component C1..C11 of the project *
claim_id          = positive integer      * identity; server-assigned *
evidence_no       = positive integer      * per claim; consecutive *
submission_id     = positive integer      * identity; server-assigned *
version_no        = positive integer
revision          = positive integer      * bumped on every content change *
contribution_type = [ "research" | "design" | "code" | "documentation" | "review" ]
ai_assistance     = [ "none" | "assisted" | "generated" ]   * declared by the student *
claim_status      = [ "pending" | "confirmed" | "contested" ] * derived (4.4) *
evidence_kind     = [ "contribution" | "artifact_version" | "commit" | "url" | "file" ]
verdict           = [ "confirm" | "dispute" ]
statement         = 10{character}500
comment           = 1{character}300       * required when verdict = "dispute" *
evidence_note     = 1{character}200
ref               = [ commit_sha | url | file_path ]
commit_sha        = 7{hex_digit}40
url               = "http" + ("s") + "://" + {character}
marks             = decimal(4,1)          * 0 <= marks <= milestone.max_marks *
remarks           = 1{character}200
timestamp         = date + time + time_zone
```

## 9.2 Data stores of the Level 2 diagrams

```
D6 Claims           = {claim} + {claim_evidence} + {countersign}
claim               = @claim_id + usn + team_id + project_id + milestone_no
                      + statement + (contribution_type) + ai_assistance
                      + claim_status + revision + created_at
claim_evidence      = @claim_id + @evidence_no + evidence_kind
                      + [ contribution_id | artifact_id + version_no | ref ]
                      + (evidence_note) + added_at
                      * exactly the pointer matching evidence_kind *
countersign         = @claim_id + @endorser_usn + verdict + (comment)
                      + claim_revision + signed_at
                      * claim_revision = the claim.revision the endorser read *

D7 Submissions      = {submission} + {submission_artifact}
submission          = @submission_id + team_id + project_id + milestone_no
                      + submitted_by + submitted_at + attempt_no
                      * unique (team_id, project_id, milestone_no, attempt_no) *
submission_artifact = @submission_id + @artifact_id + version_no
                      * version_no = the frozen (latest) version at submission *

D8 Assessments      = {assessment}
assessment          = @usn + @project_id + @milestone_no + marks
                      + assessed_by + assessed_at + (remarks)
                      * assessed_by = faculty_id of the signing faculty member *
```

## 9.3 Data flows of the Level 2 diagram of 4.0

```
F18   = [ F18.1 | F18.2 | F18.3 ]
F18.1 claim               = project_id + milestone_no + contribution_type + statement
                            + ai_assistance + (artifact_id)      * file_claim() *
F18.2 claim amendment     = claim_id + 1{ [ statement | ai_assistance
                            | contribution_type | milestone_no ] }4
                            * the four columns granted for UPDATE *
F18.3 claim withdrawal    = claim_id
F19   = [ F19.1 | F19.2 ]
F19.1 evidence reference  = claim_id + evidence_kind + ref + (evidence_note)
                            * ref names a contribution_id, "A13@v2", a SHA, URL or file *
F19.2 evidence removal    = claim_id + evidence_no
F20   = [ F20.1 | F20.2 ]
F20.1 countersign verdict = claim_id + verdict + (comment) + claim_revision
F20.2 verdict withdrawal  = claim_id                  * endorser = signed-in student *
F21   = [ F21.1 | F21.2 | F21.3 | F21.4 ]
F21.1 claim receipt       = claim_id + usn + team_id + project_id + milestone_no
                            + claim_status + 0{ evidence_no + artifact_id + version_no }1
F21.2 evidence receipt    = claim_id + evidence_no + evidence_kind
                            + ( contribution_id | artifact_id + version_no | ref )
F21.3 claim status        = claim_id + claim_status + revision
                            * returned with the claim row when the claimant reads it *
F21.4 verdict receipt     = claim_id + endorser_usn + verdict + revised + claim_status
F22   countersign queue   = queue_count + { claim + { claim_evidence } }
                            * count from semester_hub(); rows read under RLS *
F23   = F23.1 + F23.2                 F50 = F50.1 + F50.2   * same data, admin *
F23.1 contested-claim queue = { claim_id + project_id + team_id + team_name
                            + milestone_no + component + usn + claimant + statement
                            + ai_assistance + created_at + disputes + confirms
                            + last_disputed_at }               * v_contested_claims *
F23.2 claim trail         = { claim_evidence } + { countersign }
                            * separate reads under RLS; includes note and comment *
I4.1  verdict change      = claim_id
```

## 9.4 Data flows of the Level 2 diagram of 5.0

```
F24   submission request  = team_id + milestone_no + 1{ artifact_id }
F25   submission receipt  = submission_id + team_id + project_id + milestone_no
                            + attempt_no + submitted_by + 1{ artifact_id + version_no }
F27   marks entry         = usn + project_id + milestone_no + marks + (remarks)
F52   mark correction     = [ assessment | @usn + @project_id + @milestone_no ]
                            * insert or update a whole row; delete by key (admin) *
F29   = F29.1 + F29.2
F29.1 assessment receipt  = usn + project_id + milestone_no + marks + assessed_by
                            + assessed_at + inserted
F28   component lock      = project_id + milestone_no
F51   component lock / unlock = project_id + milestone_no + [ "lock" | "unlock" ]
F29.2 component-lock summary = project_id + milestone_no + locked_at
                            + marks_recorded + students + unmarked
F53   = F29.2                                          * same data, admin *
F30   rubric sheet and team progress = { rubric_cell } + { team_progress_row }
rubric_cell               = project_id + team_id + team_name + usn + name
                            + milestone_no + component + max_marks + counts_in_reduced
                            + deadline + locked + (marks) + (assessed_by)
                            + claims_pending + claims_confirmed + claims_contested
team_progress_row         = project_id + project_title + team_id + team_name + max_size
                            + members + artifacts + contributions + submissions
                            + claims_pending + claims_confirmed + claims_contested
                            + last_activity
F31   submitted work      = { chunk_id + artifact_id + version_no + author_usn + content }
                            * only rows with visibility = "submitted" *
F54   = F54.1 + F54.2;  F54.1 = F30 + F31 (all projects);  F54.2 = F32 (all projects)
F26   own marks and lab CIE = lab_cie_row + { assessment }       * own rows only *
F32   class lab CIE marks = { lab_cie_row }
lab_cie_row               = usn + name + team_id + project_id + raw_total + raw_max
                            + components_assessed + reduced_30 + (innovative_10)
                            + (final_10) + total_50                * derived *
```

The context-level composites are defined by the *components* column of the table in Section 5 (for example C03 = F18 + F19 + F20), and the Level 1 composites split at Level 2 are defined in Sections 9.3 and 9.4.

# 10. Balancing and construction-rule verification

**Balancing** (conservation of data flows between levels) requires that a child diagram have exactly the same net inputs and outputs as its parent process.

* **Level 0 to Level 1.** Every context flow Cnn is the union of the Level 1 flows listed against it in Section 5. Each component has the same external entity and direction as its parent, and every Level 1 flow that crosses the boundary belongs to exactly one context flow. Data stores do not appear at Level 0, because they are internal to process 0.
* **Level 1 to Level 2.** The Level 2 diagram of 4.0 receives and sends exactly the seven Level 1 flows of 4.0 (F18 to F23 and F50, with the splits listed below), and it uses exactly the stores of 4.0 with the same access modes. The same holds for 5.0 with its thirteen Level 1 flows.

The generator checks these properties, the standard DFD construction rules and the naming rules every time the diagrams are rebuilt. The result of the last run:

<!--GEN:checks-->

The construction and naming rules checked are:

1. Every process has at least one input and at least one output: no **black holes** (inputs only) and no **miracles** (outputs only). This is checked twice, with and without the planned flows.
2. No data flow joins two external entities, an external entity to a data store, or two data stores. Every such movement passes through a process.
3. **Naming.** Every process is named by a verb phrase: the generator checks that each of the 18 process names begins with an imperative verb from a controlled list, so a noun phrase such as "Team formation" fails the build. Every data flow is named by a noun phrase: the generator checks that no flow label begins with one of those verbs. Whether each label actually names data was reviewed by hand.
4. Every data store is both written and read.
5. Process numbers are hierarchical (4.0 explodes into 4.1 to 4.5), and stores keep the same identifier at every level.

**Legibility in print.** Every diagram is drawn with edge labels at 14 pt and node text at 16 pt or larger. The table below is measured on this PDF: each PNG is rendered at 200 dpi, and `pdfimages -list` reports the resolution at which it was placed on the page, so the printed size of a 14-pt label is 14 x 200 / ppi. The build fails if any edge label prints below 7 pt.

<!--GEN:legibility-->

# 11. How the diagrams express the design thesis and the privacy tiers

* **"Every mark has a receipt."** Trace a mark backwards on the diagrams. An `assessment` row (D8, written by 5.2) is shown to faculty next to the claim counts of the same rubric cell (5.4 reads D6). Each claim (D6, written by 4.1) points through `claim_evidence` (4.2) to `contribution` and `artifact_version` rows (D4, written by 3.0). Those rows link to MongoDB through `contribution.source_ref` (a commit SHA in D11 `github_events`) and `artifact_version.mongo_ref` (a document in D13 `note_versions`). A teammate's countersign (4.3) is bound to the exact revision of the claim that was read.
* **Three visibility tiers: `private | team | submitted`** (`artifact.visibility`, `artifact_chunk.visibility`, `notes.visibility`). Private items (D10, and artifacts, chunks and notes marked `private`) flow only to their owner. Team items flow to teammates through 3.0, 4.0 and 5.0. Only 5.1 can move an artifact to `submitted`. Chunk **text** reaches faculty and the admin only when `submitted` (F31, F54.1), and note text only when the note is `submitted` (F49). Faculty and the admin do receive more than counts: claim statements and AI-assistance declarations (F23.1, F50.1), evidence notes and countersign comments (F23.2, F50.2), and note metadata (F49), as listed in Section 3. For PostgreSQL rows these limits are enforced by RLS. For MongoDB notes they are enforced by the application filter in `api/app/notes.py`, after a team check that PostgreSQL answers under RLS.
* **Non-goal: AI-work detection.** No process computes or emits an "AI-generated" verdict. The only AI-related data is the student's own declaration (`claim.ai_assistance`, `artifact_version.ai_assistance`, `contribution.ai_assisted`, `notes.ai_assistance`). It flows into the record as declared, and faculty see it as declared (F23.1). No flow combines it with any score.
* **The planned assistant would inherit permissions.** Process 7.0 is designed to read D5 as the asking user, under RLS, and to send only those rows to the AI service (F41). Its answers (F39, F40) could cite only chunks retrieved for that user. MongoDB notes are deliberately **not** an input of 7.0: a direct MongoDB read would bypass RLS. Notes would reach the assistant only after ingestion as note artifacts and chunks (FR5.5), whose RLS policy then applies.

# 12. Requirements traceability (FR -> process -> data store -> implementation)

Numbers, titles and status follow the submitted SRS (C2_SRS.md §3.2). Where the code has moved ahead of C2's status column, the last column says so.

```{=latex}
\begin{landscape}
```

| Requirement (C2) and C2 status | Process(es) | Data stores (actual tables / collections) | Implemented by | Note |
|-------------|-------|------------------|----------------------|------------|
| FR1 Academic records *(C2: Implemented)* | 1.0 | D1 `student`, `faculty`, `course`, `academic_term`, `course_offering`, `enrollment`, `app_user` | Directory RLS policies (admin write, profile read) |  |
| FR2 Projects and rubric components *(C2: Implemented)* | 1.0, 5.3 | D2 `project`, `milestone` (`max_marks`, `deadline`, `cie_part`, `locked_at`); D9 `project_skill` | `milestone` policies, `lock_milestone()`, `trg_milestone_faculty_lock_only`, `trg_milestone_max_marks_guard` |  |
| FR3 Semester hub *(C2: Implemented)* | 1.0 | D1, D2, D3, D6 (and D4, D7 for the faculty hub) | `semester_hub()`, `v_semester_hub`, `v_faculty_team_progress` |  |
| FR4 Team formation *(C2: Implemented)* | 2.0, 6.0 | D3 `team`, `team_member`; D1 `enrollment`; D9 `student_skill`, `project_skill` | `join_team()`, `leave_team()`, `trg_team_capacity_v2`, `trg_team_one_per_project`, `trg_team_member_history_guard`, `find_teammates()`, `find_full_cover()` |  |
| FR5 Capture of work as artifacts *(C2: Partial (webhook ingestion planned))* | 3.0 | D4 `artifact`, `artifact_version`, `contribution`; D5 `artifact_chunk`; D10 `private.note`; D12 `notes`, D13 `note_versions`; D11 `github_events` (FR5.5, planned write) | Editor writes under RLS, `contribution_idempotency_key`, private-note RPCs, `POST /notes` | FR5.5 planned: F11, F12, S22 |
| FR6 Attribution: contributions, claims, evidence, countersigns *(C2: Implemented)* | 4.1 to 4.4 | D6 `claim`, `claim_evidence`, `countersign`; D4 `contribution`, `artifact_version` | `file_claim()`, `add_claim_evidence()`, `countersign_claim()`, claim / evidence / countersign policies, `trg_claim_guard`, `trg_claim_evidence_check`, `trg_claim_evidence_revision`, `trg_countersign_check`, `trg_claim_status_derived`, `trg_countersign_sync_status` |  |
| FR7 Submission, assessment and the rubric view *(C2: Implemented (data layer))* | 5.1 to 5.5; 4.5 (FR7.7 queue); 8.0 (FR7.8 preview) | D7 `submission`, `submission_artifact`; D8 `assessment`; D2 `milestone`; D4, D5, D6 | `submit_milestone()`, `record_assessment()`, `lock_milestone()`, `v_rubric_sheet`, `v_lab_cie_marks`, `v_faculty_team_progress`, `v_contested_claims`, `v_what_faculty_sees` |  |
| FR8 Evidence-backed skills *(C2: Partial (derivation of verified levels planned))* | 6.0 | D9 `skill` (recursive), `student_skill`, `project_skill`, `course_skill`, `skill_evidence` | `skill_gap()`, `skill_subtree()`; `skill_evidence` written by the admin (F33) | Derivation from claims planned: S43, S44 |
| FR9 Permission-aware cited assistant *(C2: Partial (`search_chunks` and the answer service planned))* | 7.0 (planned) | D5 `artifact_chunk` (`tsv`, `embedding`, `visibility`) | Storage, GIN and HNSW indexes, chunk RLS policy | Whole process planned |
| FR10 Permanent record and portfolio *(C2: Partial (aggregation and export planned))* | 8.0; all history stores (FR10.1) | D14 `portfolios`; reads D1, D2, D3, D6, D9, D11, D12, D13 | `ON DELETE RESTRICT` on history FKs; `export_pg.py` + `portfolio_merge.js` | The `$merge` rebuild now exists as an admin-run batch; the student export (F43, F44) remains planned |
| FR11 Polyglot persistence *(C2: Partial (validators, immutable `note_versions`, consistency report planned))* | 3.0, 8.0 | D1 to D10 (PostgreSQL); D11 to D14 (MongoDB) | `artifact_version.mongo_ref`, `contribution.source_ref`; `mongo/validators.js`; `GET /consistency` | Validators, `note_versions` and the consistency report now exist |
| NFR-SEC (security and privacy) | all; 3.0 (D10, notes filter), 8.0 (preview) | D10 `private.note`; `visibility` columns | RLS default-deny, `security_invoker` views, column grants, `api/app/notes.py` filter, `v_what_faculty_sees` |  |
| NFR-REL (atomic milestone submission) | 5.1 | D7, D4, D5 | `submit_milestone()` as one transaction |  |
| NFR-CON (concurrency) | 2.0, 4.2, 4.3, 5.1, 5.2, 5.3; 3.0 (notes) | D3, D6, D7, D8, D2, D13 | Capacity v2 trigger; claim row locks and `revision`; advisory lock; FOR SHARE on milestone; conditional lock UPDATE; `note_versions` `_id` single-use |  |

```{=latex}
\end{landscape}
```


# 13. Assumptions and open points

1. **Who defines projects and components (FR2).** The Synopsis says faculty create EL projects and milestones. In the implemented RLS policies, `project` and `milestone` rows are inserted by the College Admin, and faculty may only lock a component (`trg_milestone_faculty_lock_only`). The DFD follows the implementation (F04 from College Admin), as C2 FR2 does.
2. **Ingest internals are summarised.** The planned physical ingest path is: Edge Function -> `ingest_receive()` -> `ingest_event` inbox and pgmq queue -> worker -> MongoDB -> PostgreSQL projection. That inbox is not yet in the migrations. Process 3.0 is therefore modelled logically and not exploded. When it is built, `ingest_event` becomes a store internal to a Level 2 diagram of 3.0.
3. **Planned tables not drawn.** `ai_query_log`, `audit_log`, `consent_record` and the viva-practice tables are not yet in the schema and are not drawn. Identity binding through GitHub OAuth is also planned and not drawn.
4. **Lab CIE rounding.** 5.5 rounds the reduced mark once, to one decimal, half away from zero. This assumption is still to be confirmed with the course faculty (C2 assumption A3).
5. **Level 2 scope.** Level 2 is given for the two core processes, 4.0 and 5.0, as the component brief asks. The other processes can be exploded with the same generator. A Level 2 of 8.0 would show its local store `pg_portfolio_export`.
6. **Schema-level paths without a screen yet.** Claim amendment and withdrawal (F18.2, F18.3), evidence removal (F19.2), verdict withdrawal (F20.2) and the admin's direct table writes (F52, unlock in F51) are allowed and guarded by the database (policies, column grants, triggers) and are reachable through the API, but the web client has no form for them yet. They are drawn because a DFD of the database models every data path it accepts.
7. **C2 status column.** C2 lists the portfolio `$merge`, `$jsonSchema` validators, immutable `note_versions` and the consistency report as planned (FR10.2, FR11.3). Since C2 was submitted, `mongo/portfolio_merge.js`, `mongo/validators.js` and `GET /consistency` have been built, so this DFD shows them as implemented and flags the difference in Section 12. C2 should be updated to match.

# 14. Revision record

Revision 2 applies the examiner's corrections to revision 1:

| # | Correction | Action in revision 2 |
|--|--|--|
| 1 | Process 8.0 read the wrong stores | Accepted. 8.0 now reads D11, D12 and D13 (S56 to S58), D9 as `project_skill` (S55), D1, D2, D3 and D6 for the export, and D4, D5 and D8 for the preview F45 only (S51, S52, S54). `pg_portfolio_export` is documented as a store local to 8.0 (Section 4). Sections 4, 6.1, 6.3, 6.4, sheet 8 and Section 12 updated. |
| 2 | D13 is not planned | Accepted. "Planned" removed from D13 everywhere, and D13's implementation is described in Section 4. |
| 3 | Unbuilt parts shown as implemented | Accepted. 7.0, F16, F17, F37 to F44, S22, S43 to S47 and the webhook worker are drawn dashed and marked [planned]. The *Realised by* and *Planned parts* columns of 6.1 and the status column of Section 12 match the code. The portfolio is described as an admin-run batch. |
| 4 | Process names were noun phrases | Accepted. All processes renamed to verb phrases, and the naming rule is now a real check that fails the build (Section 10). |
| 5 | Diagrams illegible in print | Accepted. Edge labels 14 pt, node text 16 pt or larger. One port per flow, so every arrow has its own label. Level 1 is split into eight sheets and Level 2 into five. Printed sizes are measured on the PDF (Section 10): every edge label prints at 7 pt or more. |
| 6 | 6.0 claimed to derive `skill_evidence` | Accepted. `skill_evidence` and `course_skill` arrive through the admin flow F33. The reads of D4 and D6 for derivation are marked planned (S43, S44). The reads of the skill RPCs are listed in S38 to S41. |
| 7 | Privacy statements overstated | Accepted. D12 -> 7.0 removed. The notes filter of `api/app/notes.py` is described, and the flow 3.0 -> Faculty for note metadata (F49) is added. Sections 3 and 11 list exactly what faculty and the admin can read. |
| 8 | Missing amend / withdraw flows of 4.0 | Accepted. F18.2, F18.3, F19.2 and F20.2 added, and Levels 1 and 2 re-balanced. |
| 9 | Missing or mislabelled store flows | Accepted. 2.0 <- D5 (S11), 1.0 <- D4 and D7 (S04, S06) added, and the 2.0 labels name actual columns (S10 to S14). |
| 10 | College Admin role incomplete | Accepted. F50 to F55 added: oversight reports, lock / unlock, mark corrections, portfolio rebuild report. |
| 11 | FR traceability did not match C2 | Accepted for numbers and titles. For status, partly: the code has since built three items that C2 still lists as planned; Section 12 shows C2's status and notes the difference instead of repeating an out-of-date status (Section 13, item 7). |
| 12 | Catalogue terminology errors | Accepted. Weak entities, store grouping and the "read + write (append)" mode corrected and defined (Sections 2 and 4). |
| 13 | Notation errors | Accepted. Duplicate-entity stroke moved to the lower-right corner. The unsupported Elmasri and Navathe claim removed. The stacked-strip "single sheet" claim removed; no single-sheet Level 1 is provided, for the reason given in Section 6. The physical band removed from process 0. The two-headed arrow is defined as two flows. |
| 14 | No element-level data dictionary | Accepted. Section 9 gives DeMarco-notation entries for the data elements, stores D6, D7 and D8, and every Level 2 flow. |
| 15 | Minor accuracy fixes | Accepted. 4.5 and F23 describe what `v_contested_claims` returns (counts only) and the separate RLS reads (F23.2). Team notes have their own flow F47. Section 7.1 explains how F21.3 reaches the student. Also corrected: F22 (`semester_hub()` returns only a count). |

# 15. Regenerating the diagrams

```
python3 docs/lab/dfd/src/dfd_model.py   # writes dot/*.dot and generated/*.md, runs the checks
bash    docs/lab/dfd/src/render.sh      # renders svg/*.svg and png/*.png (Graphviz in Docker)
bash    docs/lab/dfd/src/build_docs.sh  # assembles C5_DFD.md, builds DOCX and PDF,
                                        # measures printed font sizes (legibility.py)
```

Files: Graphviz sources `docs/lab/dfd/dot/`, vector diagrams `docs/lab/dfd/svg/`, 200-dpi raster diagrams `docs/lab/dfd/png/`.
