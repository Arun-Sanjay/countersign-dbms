# Viva preparation: Countersign (CD252IA, RVCE)

**Unified Experiential Learning and Project Intelligence Platform**, product name **Countersign**.
Team: S Arun Sanjay (1RV24CY047), Sanvid Razdan (1RV24CY051). State described: 5 November 2026
(migrations 0001–0006 live on `countersign-dbms`, ap-south-1).

How to use this file: read the answer aloud once, then answer from memory. Every answer is short
on purpose; the "where" pointer tells you which file to open if the examiner asks for proof.
Part A follows the syllabus units, Part B the lab components, Part C is the hand-writing drill,
Part D lists the numbers worth memorising.

**The one-sentence pitch.** "Every mark has a receipt: the rubric is the schema, a student files a
claim for a component, backs it with evidence rows, a teammate countersigns it, and the faculty
reads the marks sheet with the receipts behind every cell, all enforced by PostgreSQL row-level
security."

---

## Part A. By syllabus unit

### Unit I: database approach, three-schema architecture, ER model

**A1. Why a database and not files/WhatsApp/Drive?** Files give no shared schema, no integrity
constraints, no concurrent-access control and no fine-grained access control. Our problem
(who did what, for which mark) needs keys, foreign keys, transactions and per-row permissions,
which is exactly the database approach (Elmasri & Navathe ch. 1).

**A2. Map Countersign onto the three-schema architecture.** External level: six `security_invoker`
role views (`v_semester_hub`, `v_what_faculty_sees`, `v_rubric_sheet`, `v_faculty_team_progress`,
`v_contested_claims`, `v_lab_cie_marks`), further filtered per user by RLS. Conceptual level: one
relational schema, 29 public tables plus `private.note`. Internal level: PostgreSQL heap files,
B-tree indexes on every FK, GIN on `artifact_chunk.tsv`, HNSW on `artifact_chunk.embedding`, pgmq
queue tables. MongoDB is a second store, not a level. (C2 §2.1)

**A3. Logical data independence, with your own example.** Migration 0002 appended columns to the
13 fixture tables and added 14 tables (13 in `public` plus `private.note`); migration 0005 appended `artifact_version.source_ref` and
`artifact_chunk.chunk_no` and added 3 tables. The 37 Test queries Q1–Q37 were not touched and still
produce the Appendix H outputs (37/37).

**A4. Physical data independence, with your own example.** Migration 0005 replaced two
single-column indexes on `skill_evidence` by composite ones `(claim_id, usn)` and
`(contribution_id, usn)`. No table, view, RPC or query changed; only the optimizer's access paths.

**A5. Why is MILESTONE a weak entity and TEAM not?** "Component 3" means nothing without its
project, so its key borrows `project_id`: PK `(project_id, milestone_no)`, partial key
`milestone_no`, identifying relationship HAS_MILESTONE with total participation. A team has its own
globally unique `team_id`.

**A6. Name all weak entities.** MILESTONE (owner PROJECT, partial key `milestone_no`),
ARTIFACT_VERSION (owner ARTIFACT, `version_no`), CLAIM_EVIDENCE (owner CLAIM, `evidence_no`). Each
owner FK is ON DELETE CASCADE because the weak entity is existence-dependent; history is still safe
because RESTRICT FKs stop the owner from being deleted once work exists.

**A7. Your ternary relationship and its cardinality.** ASSESSES, with
STUDENT : MILESTONE : FACULTY = M : N : 1 (say it in this order, as C3 does, so the "1" lands on
FACULTY): for one (student, component) pair there is exactly one mark and one signing faculty
member. Mapping step 7 leaves the "1" participant out of the key, so the PK is
`(usn, project_id, milestone_no)` and `assessed_by` is a NOT NULL FK outside the key.

**A8. Why not three binaries instead of ASSESSES?** GRADED_IN, GRADES and SETS cannot say which
faculty member gave which student the mark for which component, and `marks` belongs to the triple.
Joining the binaries can pair a student-component with the wrong faculty member (spurious tuples).

**A9. Why is CONTRIBUTION an entity, not an M:N relationship STUDENT–ARTIFACT?** The same student can
record several contributions to the same artifact (no UNIQUE (usn, artifact_id)), and contributions
are referenced by CLAIM_EVIDENCE and `skill_evidence`. A relationship set cannot hold two instances
with the same participants.

**A10. Why is CLAIM an entity and not a ternary STUDENT–TEAM–MILESTONE?** A student may file several
claims per component, a claim owns a weak entity (evidence) and takes part in COUNTERSIGNS; a
relationship cannot take part in another relationship without aggregation.

**A11. Read me three (min,max) pairs and justify them.** MEMBER_OF: TEAM (0,6), because a team may
exist before anyone joins and `max_size` is CHECKed 1–6 (the per-team bound is a trigger).
SUBSKILL_OF: SKILL as sub-skill (0,1), because `parent_skill_id` is one nullable column; as parent
(0,N). FILED_UNDER: ARTIFACT (1,1), because `(project_id, milestone_no)` is NOT NULL.

**A12. Recursive relationship and how it maps.** SUBSKILL_OF on SKILL becomes the self-referencing
FK `skill.parent_skill_id → skill.skill_id`; `skill_subtree()` walks it with `WITH RECURSIVE` and
stops on cycles.

**A13. Derived attributes in your design?** `claim.status` (stored but derived, maintained only by
triggers, kept for queue speed), `milestone.counts_in_reduced` and `artifact_chunk.tsv` (GENERATED
columns), and the lab CIE totals (never stored, computed in `v_lab_cie_marks`).

### Unit II: relational model, constraints, update anomalies, relational algebra

**A14. Which constraint types do you use?** Domain (CHECKs: semester 1–8, `max_size` 1–6, level
1–5, enumerations), key (PK, UNIQUE, partial UNIQUE), entity integrity (PK NOT NULL), referential
integrity (58 FKs with chosen actions: 54 after 0004, as counted in C3, plus 4 added by 0005), plus semantic constraints as triggers (capacity, one team
per project, membership required, marks ≤ max, lock).

**A15. CASCADE, RESTRICT or SET NULL: give the rule.** CASCADE for existence-dependent rows (weak
entities, private notes, verified identities at erasure); RESTRICT for history (contribution,
claim, assessment, submission → student, team, milestone); SET NULL for an optional association
(`course.faculty_id`). Deleting a student with recorded work fails with 23503, by design.

**A16. What can go wrong with an update, and how do you show it?** Inserting a member into a full
team (23514 `team_capacity`), a mark above max (23514), a mark on a locked component (55000
`milestone_locked`), a dangling FK (23503), a second team in the same project (trigger). The
constraint gallery `supabase/tests/01_constraints.sql` has one failing statement per rule.

**A17. Skill gap in relational algebra.** For Karthik (1RV24CY024) on P01:
π_skill_id(σ_project_id='P01'(PROJECT_SKILL)) − π_skill_id(σ_usn='1RV24CY024'(STUDENT_SKILL)).
Result {S04, S06}. In the app, `skill_gap()` also compares `level` with `min_level` and classifies
each skill as met / below / missing.

**A18. Teammate finder in relational algebra (the fixture version).** Classical division:
π_usn,skill_id(STUDENT_SKILL) ÷ π_skill_id(σ_project_id='P01'(PROJECT_SKILL)) = students holding
every P01 skill (Arun, Aditi, Rahul, Nikhil in the fixture).

**A19. Why did you change the finder for the product?** Division returns clones of you. The product
returns complements: Missing = Required(P) − Mine, then rank other students by how many Missing
skills they hold:
Missing = π_skill_id(σ_project_id=P(PROJECT_SKILL)) − π_skill_id(σ_usn=me ∧ project_id=P ∧ level≥min_level(STUDENT_SKILL ⋈ PROJECT_SKILL)).
The `project_id = P` selection in the second term matters: without it another project's
`min_level` for the same skill could make a skill count as "mine". Then

Candidates = γ_usn; count(*)→covered(STUDENT_SKILL ⋈_{level ≥ min_level} Missing), ordered by
covered DESC. That is a partial division. (`find_teammates()`, migration 0004)

**A20. Write the thresholded full-cover division.**
π_usn,skill_id(σ_level≥min_level(STUDENT_SKILL ⋈ PROJECT_SKILL_P)) ÷ π_skill_id(PROJECT_SKILL_P).
In SQL it is a double NOT EXISTS. Edge case, a project with no required skills (empty divisor):
by definition R ÷ ∅ = π_usn(R): the algebra returns only the students that **appear in the
dividend**. With the plain dividend π_usn,skill_id(STUDENT_SKILL) that is every student holding at
least one skill; with the thresholded dividend above, which is joined with PROJECT_SKILL_P, the
dividend is itself empty, so the algebra returns no student at all. The SQL double NOT EXISTS
ranges over STUDENT, so it returns **every** student (vacuous truth), including those with no
skills. We state that in C2 FR4.6.

**A21. Intersection example.** Cross-course synthesis (planned):
π_skill_id(σ_course=A(COURSE_SKILL)) ∩ π_skill_id(σ_course=B(COURSE_SKILL)).

**A22. "Who built what" as a join.** STUDENT ⋈ CONTRIBUTION ⋈ ARTIFACT, the basis of Q2-style and
consistency queries.

### Unit III: SQL, functional dependencies, normalization

**A23. SQL features the project uses.** Multi-way joins, LEFT JOIN + IS NULL (anti-join),
correlated NOT EXISTS, EXCEPT, GROUP BY/HAVING with a nested aggregate, `FILTER` aggregates,
`WITH` CTEs and `WITH RECURSIVE`, window functions (`row_number()` in `search_chunks`),
`DISTINCT ON`, `INSERT … ON CONFLICT DO NOTHING`, GENERATED columns, partial and composite
UNIQUE indexes, an EXCLUDE constraint (non-overlapping terms), views with `security_invoker`,
PL/pgSQL triggers and functions, column-level GRANTs, RLS policies.

**A24. DDL vs DML vs DCL vs TCL, with your examples.** DDL `CREATE TABLE claim`, `ALTER TABLE
artifact_chunk ADD COLUMN chunk_no`; DML `INSERT/UPDATE/DELETE`; DQL `SELECT`; DCL `GRANT EXECUTE
ON FUNCTION search_chunks TO authenticated`, `REVOKE ALL … FROM anon`; TCL `BEGIN`, `COMMIT`,
`ROLLBACK`, `SAVEPOINT` (every pgTAP file runs in a transaction that is rolled back).

**A25. DELETE vs TRUNCATE vs DROP.** DELETE removes rows, row by row, fires triggers and obeys RLS;
TRUNCATE empties the table at once and **bypasses RLS** (so `authenticated` has no TRUNCATE
privilege, checked in `02_rls_matrix.sql` §B); DROP removes the table definition.

**A26. Your unnormalized relation.** The RVCE paper marks sheet: header (USN, name, section,
project title) plus a repeating group (No, Submission(Max), Marks, Signature) and derived totals.

**A27. Candidate keys of the 1NF sheet relation.** K1 = {USN, Proj, No} (primary) and
K2 = {USN, Team, No}. USN and No appear on no right-hand side, so they are in every key; adding Proj
or Team completes a key; adding Fac never gives a minimal key.

**A28. The minimal cover.** 12 FDs: USN→Name, USN→Sec, Proj→Course, Team→Proj, Team→Title,
USN,Proj→Team, Proj,No→Comp, Proj,No→Max, Proj,No→Part, USN,Proj,No→Marks, USN,Proj,No→Fac,
Fac→FName. Removed: USN,Team→Title and USN,Proj,No→Max (extraneous USN), USN,Team,No→Marks
(redundant). Minimal covers are not unique.

**A29. 2NF violations, 3NF violation, BCNF violation.** 2NF: partial dependencies USN→Name,Sec;
Proj→Course; Proj,No→Comp,Max,Part; Team→Title. 3NF: the transitive USN,Proj,No→Fac→FName.
BCNF: in MEMBERSHIP(USN, Proj, Team), Team→Proj has a non-superkey LHS.

**A30. Why is MEMBERSHIP in 3NF but not BCNF?** Its keys are {USN, Proj} and {USN, Team}. Team→Proj:
Team is not a superkey, but Proj is prime, so 3NF condition (b) holds; BCNF has no such exception.

**A31. Prove the decomposition is lossless.** Chase tableau: one row per relation, apply the FDs,
and one row becomes all-a (the ASSESSMENT row). Cross-check pairwise with the binary test NJB:
R1 ∩ R2 → R1 − R2 or → R2 − R1 at every split. (C6 A.12)

**A32. Is it dependency-preserving?** The 3NF synthesis result is. The BCNF result loses
USN,Proj→Team; we enforce it with the trigger `trg_team_one_per_project`. That is the classic
3NF-vs-BCNF trade-off.

**A33. Which implemented tables are below 3NF, and why is that acceptable?** `artifact`, `claim`,
`project`, `skill_evidence` (2NF) and `submission` (1NF under the general definition): each copies
`project_id` (or `usn`) so that a composite FK can force consistency, e.g.
`artifact(team_id, project_id) → team(team_id, project_id)` and
`artifact(project_id, milestone_no) → milestone`. The copy cannot disagree because the FK pins it.

**A34. Why are the totals not stored?** Total120/Reduced30/LabCIE50 are functions of sets of
tuples; storing them recreates an update anomaly. `v_lab_cie_marks` computes
reduced_30 = round(raw_total × 30 / raw_max, 1) and total_50 = reduced_30 + C10 + C11.

**A35. Correlated vs non-correlated subquery, in your code.** Q6 (ghost members) is correlated: the
inner query refers to `tm.usn` and `tm.team_id` of the outer row. Q5's average is non-correlated:
computed once.

### Unit IV: transactions, concurrency control, recovery

**A36. Give one ACID example from your system.** `submit_milestone()`: one PL/pgSQL function called
by one statement. It inserts the submission, freezes the latest version of every artifact and moves
the artifacts to `submitted`. Any exception (even from a trigger after the insert) undoes all of it:
atomicity. Consistency: the triggers and FKs. Isolation: advisory lock on (team, component).
Durability: commit is WAL-logged.

**A37. What is your Innovative Experiment finding?** A correct-looking "lock the team row, then
COUNT" trigger (the fixture's Q35) over-admits under REPEATABLE READ. In 72,000 races (6 strategies
× RC/RR/SER × N = 2, 8, 32, 100 × 1000 trials) it over-admitted in 100% of RR races, worst 103/4 at
N = 100. The trigger is correct **by itself** only at READ COMMITTED. At SERIALIZABLE it also never
over-admitted, but there it is SSI, not the trigger, that aborts the second joiner (40001) (C10 §0, §9.1).

**A38. Why does it fail at REPEATABLE READ?** The RR snapshot is taken at the first statement,
before B waits for the lock. A only locked the row (never updated it), so when B gets the lock
there is no write conflict (no 40001), and B's COUNT still reads its old snapshot (3 members).
At RC every statement takes a new snapshot after the lock wait.

**A39. How did you fix it?** Capacity v2: the trigger writes the parent row first
(`UPDATE team SET max_size = max_size … RETURNING`) and then counts. The no-op update creates a new
row version, so at RR/SER the loser gets 40001 (first-updater-wins), and at RC it re-reads and
gets "Team T02 is full". 0 over-admissions in 12,000 races; p95 6.0 ms at RR with 100 joiners.

**A40. Name the anomaly correctly.** Write skew / predicate phantom, not "lost update": each
transaction reads an overlapping set (the members of T02) and writes a disjoint row (its own
`team_member` row); jointly they break the invariant count ≤ max_size.

**A41. Draw the precedence graph for the over-admission.** T1: r1(members of T02) … w1(insert).
T2: r2(members of T02) … w2(insert). r1 before w2 on the same predicate gives T1→T2; r2 before w1
gives T2→T1. Cycle ⇒ not conflict-serializable. Our `analysis.sql` builds these graphs with a
recursive CTE: the cycle appears in exactly the 5,000 N = 2 races that over-admitted.

**A42. Does PostgreSQL use 2PL?** For writes it holds row locks until commit (strict 2PL for
write locks), but reads are MVCC snapshot reads that take no locks. SERIALIZABLE is SSI
(serializable snapshot isolation): it tracks read-write dependencies with SIRead locks and aborts a
"pivot" with 40001, which is what we saw for the naive strategy at SER.

**A43. Other concurrency mechanisms in the product.** OCC on countersigns: a countersign records
`claim_revision` and is refused if the claim changed (55000 `countersign_stale_revision` at RC,
40001 at RR/SER). Advisory transaction lock serialising submission attempt numbers, with UNIQUE as
backstop. `FOR SHARE` on the milestone row in the marks trigger, so a concurrent lock waits.
Conditional `UPDATE … WHERE locked_at IS NULL` so two locks cannot both succeed. Ingest: row locks
plus idempotency keys.

**A44. What does the client do on 40001?** Retry the whole transaction (the web client retries a
mutation at most twice with back-off); the retry then gets the clean business error.

**A45. Recovery and idempotency in ingestion.** Delivery is at-least-once: a message is archived
only after a successful projection. A crash anywhere means it is read again after the visibility
timeout (60 s); every step is idempotent (Mongo `_id` = delivery id, `ON CONFLICT DO NOTHING`
keys), so processing twice changes nothing. After 5 failed attempts the message becomes a dead
letter. (`06_ingest_worker.sql`, `api/tests/test_worker.py`)

### Unit V: NoSQL, distribution, big data

**A46. What is in MongoDB and why?** `github_events` (raw push payloads, variable shape, immutable,
`_id` = delivery id), `notes` (markdown + front matter), `note_versions` (one immutable receipt per
save, `_id` = `<note_id>:<version>`), `portfolios` (one aggregate document per student). These are
semi-structured, read as whole documents, and not joined relationally.

**A47. Explain the aggregate data model with your example.** An aggregate is a unit of data
read and written together. A portfolio document embeds the student's projects (with role and
skills) and evidence counts, so one read returns the whole portfolio; that is also the natural
unit for sharding and replication.

**A48. Key-value vs document vs column-family vs graph; where would each fit?** Key-value: session
or presence with a TTL (planned). Document: notes, portfolios (built). Column-family: event
analytics at scale (not needed). Graph: skill prerequisite graph (we use a recursive CTE instead).

**A49. How do you validate documents if MongoDB is schemaless?** `$jsonSchema` validators on every
collection, `validationLevel: strict`, `validationAction: error`. A malformed write fails with code
121; `scripts/check_mongo_validators.sh` proves that every shape the frozen fixture writes is
accepted and 6 malformed writes are rejected.

**A50. How is a note save atomic across two collections?** A multi-document transaction: insert
`note_versions {_id: "<note_id>:<n>"}`, then bump `notes.version` from n−1 to n. The unique `_id`
makes each version number single-use, so a stale or concurrent save gets 409 `version_conflict`.
Transactions need a replica set, which is why the local Mongo runs as a single-node replica set.

**A51. Sharding: what key would you use?** `{college_id, team_id}`: college gives tenant isolation
and locality, team keeps a team's notes and events on one shard; avoid a monotonically increasing
key like `created_at` (hot shard). Today we run one Atlas shared-tier cluster; the shard key is
designed, not deployed.

**A52. Master-slave vs peer-to-peer replication.** Atlas runs a replica set: one primary takes
writes, secondaries replicate the oplog and can serve reads; on failure an election picks a new
primary (master-slave with automatic failover). Peer-to-peer (Cassandra-style) lets any node take
writes and reconciles conflicts. Our Git/Obsidian sync is a peer-to-peer analogy.

**A53. MapReduce vs the aggregation pipeline.** MapReduce = map (emit key, value) + reduce
(combine values per key). M4/M18 does the same with `$unwind` (map: one row per commit),
`$group` with `$sum` (reduce) and `$sort`. MongoDB deprecated `mapReduce` in 5.0 in favour of the
pipeline, which is optimised and runs on Atlas shared tiers. Equivalent MapReduce is in drill D12.

**A54. Big-data "V"s and data types here.** Structured (relational tables), semi-structured (JSON
push payloads, front matter), unstructured (markdown text, chunked for search). Volume is small;
variety is the point.

**A55. CAP / consistency in your Mongo use.** A replica set prefers consistency: writes go to the
primary with majority write concern. Across Postgres and Mongo we have no distributed transaction,
so we use eventual consistency with a checked contract (next question).

### Cross-cutting questions

**A56. How do you keep PostgreSQL and MongoDB consistent without a distributed transaction?**
Inbox → log → projection. (1) `ingest_receive()` inserts the `ingest_event` row and sends the pgmq
message in one PostgreSQL transaction. (2) The worker upserts the raw event into Mongo
(`_id` = delivery id). (3) `project_push()` writes the projection with idempotent inserts.
A dual write (write Mongo, then Postgres) could crash between the two; here every step can be
retried. `GET /consistency` checks "every credited commit in the log is in the projection, and
nothing in the projection lacks a raw event" by full commit SHA, and
`--reproject-from-log` rebuilds Postgres from Mongo with an identical result.

**A57. Why PostgreSQL and MongoDB, not one of them?** PostgreSQL holds everything that needs
integrity and permissions: entities, marks, claims, RLS, triggers, transactions. MongoDB holds
raw variable-shape payloads, note bodies with immutable history, and read-whole aggregates.
Honest answer: JSONB in PostgreSQL could hold the documents too; the split also satisfies Unit V
and the NoSQL part of the Test, and it makes the cross-store consistency problem real and visible.

**A58. Why no vector database?** Permissions must apply to retrieval. In pgvector the chunk rows
are under the same RLS policy as everything else, and one SQL statement (`search_chunks`) fuses
keyword rank and vector rank with relational filters, run as the user. A separate vector DB would
need its own copy of the permission model and a sync pipeline. One subtlety: RLS filters after the
HNSW index returns candidates, so we set `hnsw.iterative_scan = relaxed_order` to keep the list full.

**A59. How does search work exactly?** `search_chunks()` is SECURITY INVOKER. Keyword list: chunks
holding any query word, ranked by Σ idf² of the words they hold, with the BM25 idf formula
ln(1 + (N − df + 0.5)/(df + 0.5)); but N and df are counted over the **matching candidates** that
the caller may see, not over the whole corpus (migration 0005), so it is a BM25-style weight, not
corpus BM25. A rare word still beats several common ones. Vector list (only when a query embedding is supplied): cosine distance, HNSW.
Fusion: reciprocal rank fusion, score = Σ 1/(60 + rank). Only the newest snapshot of each ingested
artifact is searched.

**A60. Is the assistant "AI"? What exactly runs today?** No Anthropic or Voyage key exists yet, so
`POST /ask` is extractive: it quotes the best sentence of each of the top 3 retrieved chunks, each
with a citation marker mapped to a chunk id; cited ⊆ retrieved. The model-written path (citations
checked on the server, uncited text dropped) and embeddings are built and unit-tested with stubs.

**A61. Who gets credit for a git push?** GitHub authenticates only the pusher. A commit is
credited only if its claimed author resolves, through an admin-verified `student_identity`, to the
same student as the pusher, and that student is on the repository's team. Everything else is
logged and warned about, never credited. The component is chosen by server receive time, so a
backdated commit cannot land under an already-assessed component.

---

## Part B. By lab component

### C1 Synopsis and C2 Requirement Specification

**B1. Which standard does your SRS follow?** ISO/IEC/IEEE 29148:2018 (which superseded IEEE 830);
we keep the familiar 1–2–3 section layout.

**B2. Give one FR with its traceability.** FR4.1 capacity: table `team_member`, trigger
`trg_team_capacity_v2`, tests `01_constraints.sql` §D and the race harness. Every FR in C2 §3.3 is
traced to tables, RPCs/views, constraints and tests.

**B3. Give one measurable NFR.** NFR-CON-1: 0 races above `max_size` for N = 2–100 at RC/RR/SER, 1000
trials per cell; met (0 in 12,000 races for capacity v2). NFR-SEC-2: 256 persona × relation cells
equal to the expected row counts.

**B4. What are your non-goals?** No AI-text detection (unreliable, biased; we record a declared
`ai_assistance` instead), no replacing WhatsApp/Docs, no automatic grading, no leaderboards, no
surveillance.

**B5. What changed between SRS v1.1 and v1.2?** Ingestion (FR5.5), live notices (FR7.9), search with
extractive cited answers (FR9.3–9.4), the portfolio rebuild (FR10.2) and the consistency contract
(FR11.4–11.5) became Implemented; model answers and embeddings are "Built, not configured".

### C3 ER diagram

**B6. Which notation?** Elmasri & Navathe (Chen-style): double rectangle/diamond for weak entities,
double line for total participation, (min,max) on every edge, ratio shown for the ternary.

**B7. Which 1:1 relationship exists and where does the FK go?** `app_user` ↔ `student`; the FK goes on
the new side (`app_user`) with UNIQUE, so the frozen fixture table is unchanged.

**B8. Is there a multivalued attribute?** Not in the final schema; {skills} was refined into SKILL
plus the M:N HAS_SKILL so that `level` and the hierarchy could be stored.

### C4 Test (SQL + NoSQL)

**B9. What did you execute in the Test?** SQL items 2, 8, 5, 3, 6 (join, EXCEPT, nested aggregate,
anti-join, correlated NOT EXISTS) and Mongo M1–M5 (insertOne, find with projection and sort,
updateOne with `$set/$inc/$push`, aggregate with `$unwind/$group`, `$lookup`). Hand-write them in
Part C.

**B10. Why does M5 return fewer notes than you might expect?** `$unwind` drops notes whose
`$lookup` found no portfolio (Rahul has no portfolio), unless `preserveNullAndEmptyArrays: true`.

### C5 DFD

**B11. Which notation and why?** Gane-Sarson: rounded process boxes with a number and a mechanism
band, open-ended stores with an id. Same model as Yourdon-DeMarco, more room for labels.

**B12. What is balancing?** A child diagram has exactly the parent's net inputs and outputs. Each
context flow (C01–C33) is a composite of Level 1 flows; the generator checks this and the 4.0 and
5.0 Level 2 splits on every build.

**B13. Why is a view not a data store?** It stores nothing; it is part of the process that reads the
base tables, so it appears as a process mechanism.

**B14. What is still dashed in the DFD?** Only the AI model services (F16, F17, F41, F42), the
student-facing portfolio export (F43, F44) and the derivation of verified skills (S43, S44).

### C6 Normalization

**B15. Walk me from UNF to BCNF in one breath.** Flatten the repeating group (1NF, key {USN, Proj, No});
split off STUDENT, PROJECT, COMPONENT, TEAM on the partial dependencies (2NF); split FACULTY on
Fac→FName (3NF); split MEMBERSHIP on Team→Proj into TEAM and TEAM_MEMBER (BCNF); lossless by chase;
USN,Proj→Team lost and enforced by trigger.

**B16. Show me a relation that is in 3NF but not BCNF in your schema.** MEMBERSHIP(USN, Proj, Team)
with keys {USN, Proj} and {USN, Team} and Team→Proj (C6 Part C).

### C7 Midterm, C8 Forms, security and validation

**B17. What is RLS and how is yours structured?** Row-level security: per-row predicates PostgreSQL
adds to every query. Default deny (RLS enabled on every table, no policy = no rows), policies
`TO authenticated` only, helpers `app.current_usn()`, `app.is_team_member()`, `app.teaches_project()`,
`app.oversees_project()`, `app.is_admin()`.

**B18. USING vs WITH CHECK.** USING filters which existing rows you can see/update/delete; WITH CHECK
validates the new row of an INSERT/UPDATE. Example: `assessment_insert` WITH CHECK requires
`teaches_project(project_id) AND assessed_by = current_faculty_id()` (or admin).

**B19. Why `security_invoker` views?** A default view runs as its owner and bypasses the base
tables' RLS; `security_invoker = true` runs it as the caller, so RLS applies.

**B20. When do you use SECURITY DEFINER, and how do you make it safe?** Only for RLS helper
functions, integrity triggers, the three private-note RPCs and the five service-role-only pipeline
RPCs. Every one pins `SET search_path = ''` (no search-path hijack) and has EXECUTE revoked from
PUBLIC/anon.

**B21. What exactly can faculty see?** For projects they teach: claims with statements, evidence
pointers, countersign comments, contributions, non-private artifacts and versions, marks, and chunk
text only once `submitted`. Never private items or private notes. The dashboard view
`v_faculty_team_progress` is metadata only. (C2 §3.4.1)

**B22. Three validation layers.** zod in the form, the API/RPC checks (`22023` with a rule key), and
the database CHECK/trigger as the last word. The database error's rule key is mapped back to the
form field.

**B23. What does anonymous access get?** Nothing: no table, view or function privilege for `anon`;
`/health` proves it by expecting 42501.

**B24. How is the live dashboard private?** A trigger on `contribution` sends a broadcast with ids
and time only, to private topics `team:<id>` and `project:<id>`; an RLS policy on
`realtime.messages` lets only members/staff join. We avoided `postgres_changes`, which would ship
whole rows.

### C9 Demo, C10 Innovative Experiment, C11 Final

**B25. What will you demo live?** The C9 run-of-show (C9 §3, the authoritative script): the paper
sheet; Ramesh's rubric sheet and its SQL drawer (normalization); Arun files a C3 claim with
evidence; Arun countersigns Sanvid's claim #5 and Ramesh reloads the sheet; Aditi's contested C1
cell; a fresh signed push to the cloud Edge Function → toast within about a second → trace sheet
(Mongo raw event beside the Postgres rows) → search and a cited answer; "try to break it" in the
terminal and Lakshmi's empty sheet; the race (`demo_locks.sh S2 RR`, then `S7 RR`). The admin
consistency panel is a backup, not in the main run.

**B26. What if the live push fails?** C9 §5: a wrong secret → rerun the ping check; no toast →
run the worker once by hand; no network → plan B is the local stack, where the same signed push
goes to the Edge Function served by `npx supabase functions serve` (not the deployed one) and the
local worker; the replay fixtures (`scripts/replay_webhooks.py`) rebuild the history.

**B27. Why is your experiment "innovative" and not a textbook exercise?** It found a real defect in
our own earlier trigger, measured it at scale (2,556,000 attempts), verified schedules with
precedence graphs in SQL, and shipped the fix with a client retry contract.

**B28. The consistency row for T00 / 1RV24CY047 reads "6 · 6 · matched 5" and still says
"consistent". Why?** The two counts are different things. Mongo: 6 commits in the raw log that
the pipeline credits to Arun; one of them (13a1b9c…) touched only untracked paths, so it
produced no contribution row by design (`not_projected`). Postgres: 5 distinct full SHAs from
the pipeline plus 1 GitHub `contribution` row whose `source_ref` is not a full 40-hex SHA (a
seeded demo row), which `/consistency` counts as `outside_pipeline` (`api/app/consistency.py`).
5 commits match by SHA on both sides, and neither remainder is a pipeline loss
(`only_in_mongo` / `only_in_postgres` are empty), which is the only thing the status flags. The table does not show
the two remainders; that is a known UI gap (`docs/KNOWN_ISSUES.md`).

**B29. Break-it attempt 7 (anonymous read) shows the hint "GRANT SELECT ON public.assessment TO
anon". Is that a hole?** No. 42501 is "insufficient privilege": `anon` has no privilege on any
table, by design (C8 B.5). The hint is PostgREST's generic advice for that error, telling an
administrator how they *could* grant access. We deliberately did not; the hint describes the
fix we refused.

---

## Part C. Hand-write this query

Write each from memory first, then compare. Fixture tables: Appendix A of `PROJECT_MASTER.md`;
expected outputs: Appendix H.

**D1 (Test item 2, JOIN). Members of every DBMS (P01) team.** Expected 7 rows (Alpha 4, Beta 3).

```sql
SELECT t.team_name, s.name, tm.role
FROM team_member tm
JOIN team t    ON tm.team_id = t.team_id
JOIN student s ON tm.usn = s.usn
WHERE t.project_id = 'P01'
ORDER BY t.team_name, s.name;
```

**D2 (Test item 8, EXCEPT). Skills P01 needs that Karthik lacks.** Expected S04, S06.

```sql
SELECT skill_id FROM project_skill WHERE project_id = 'P01'
EXCEPT
SELECT skill_id FROM student_skill WHERE usn = '1RV24CY024';
```

**D3 (Test item 5, nested aggregate). Students with more contributions than the average student.**
Expected 5 rows: 047 (8), 011 (5), three with 3.

```sql
SELECT usn, COUNT(*) AS contributions
FROM contribution
GROUP BY usn
HAVING COUNT(*) > (SELECT AVG(cnt)
                   FROM (SELECT COUNT(*) AS cnt FROM contribution GROUP BY usn) x)
ORDER BY contributions DESC;
```

Viva follow-up: why not `AVG(COUNT(*))`? Aggregates cannot nest in PostgreSQL; the derived table does
the inner count.

**D4 (Test item 3, anti-join). Students in no team.** Expected Nikhil Bhat, Ananya Gowda.

```sql
SELECT s.usn, s.name
FROM student s
LEFT JOIN team_member tm ON s.usn = tm.usn
WHERE tm.usn IS NULL;
```

Equivalent: `WHERE NOT EXISTS (SELECT 1 FROM team_member tm WHERE tm.usn = s.usn)`. Avoid
`NOT IN (SELECT usn …)` if the subquery could return NULL (NOT IN with a NULL yields no rows).

**D5 (Test item 6, correlated NOT EXISTS). Members with no contribution to their own team.**
Expected T01 Meera Iyer, T02 Vikram Shetty.

```sql
SELECT tm.team_id, s.name
FROM team_member tm
JOIN student s ON tm.usn = s.usn
WHERE NOT EXISTS (
    SELECT 1
    FROM contribution c
    JOIN artifact a ON c.artifact_id = a.artifact_id
    WHERE c.usn = tm.usn AND a.team_id = tm.team_id);
```

**D6 (Test item 7, division). Students holding every P01 skill.** Expected Arun, Aditi, Rahul, Nikhil.

```sql
SELECT s.usn, s.name
FROM student s
WHERE NOT EXISTS (
    SELECT 1 FROM project_skill ps
    WHERE ps.project_id = 'P01'
      AND NOT EXISTS (SELECT 1 FROM student_skill ss
                      WHERE ss.usn = s.usn AND ss.skill_id = ps.skill_id));
```

Read it as: "there is no required skill that this student does not have".

**D7 (app schema, thresholded division). Students who meet every P06 skill at its minimum level.**

```sql
SELECT s.usn, s.name
FROM student s
WHERE NOT EXISTS (
    SELECT 1 FROM project_skill ps
    WHERE ps.project_id = 'P06'
      AND NOT EXISTS (SELECT 1 FROM student_skill ss
                      WHERE ss.usn = s.usn AND ss.skill_id = ps.skill_id
                        AND ss.level >= ps.min_level));
```

**D8 (app schema, complement finder, simplified `find_teammates`). Who covers the P06 skills I lack?**

```sql
WITH missing AS (
    SELECT ps.skill_id, ps.min_level
    FROM project_skill ps
    WHERE ps.project_id = 'P06'
      AND NOT EXISTS (SELECT 1 FROM student_skill me
                      WHERE me.usn = '1RV24CY047' AND me.skill_id = ps.skill_id
                        AND me.level >= ps.min_level))
SELECT ss.usn, COUNT(*) AS covered, SUM(ss.level) AS strength
FROM student_skill ss
JOIN missing m ON m.skill_id = ss.skill_id AND ss.level >= m.min_level
WHERE ss.usn <> '1RV24CY047'
GROUP BY ss.usn
ORDER BY covered DESC, strength DESC;
```

**D9 (app schema, conditional aggregation). Derive each claim's status from its countersigns.**

```sql
SELECT c.claim_id,
       CASE WHEN COUNT(*) FILTER (WHERE cs.verdict = 'dispute') > 0 THEN 'contested'
            WHEN COUNT(*) FILTER (WHERE cs.verdict = 'confirm') > 0 THEN 'confirmed'
            ELSE 'pending' END AS derived_status
FROM claim c
LEFT JOIN countersign cs ON cs.claim_id = c.claim_id
GROUP BY c.claim_id;
```

Follow-up: why LEFT JOIN? A claim with no countersign must still appear (as pending).

**D10 (app schema, the faculty queue). Contested claims of P06 with the number of disputes.**

```sql
SELECT c.claim_id, c.team_id, c.milestone_no, s.name AS claimant, c.statement,
       COUNT(*) AS disputes, MAX(cs.signed_at) AS last_disputed_at
FROM claim c
JOIN student s      ON s.usn = c.usn
JOIN countersign cs ON cs.claim_id = c.claim_id AND cs.verdict = 'dispute'
WHERE c.project_id = 'P06'
GROUP BY c.claim_id, c.team_id, c.milestone_no, s.name, c.statement
ORDER BY last_disputed_at DESC;
```

**D11 (app schema, "no recorded evidence yet"). P06 team members with no claim for component 4.**

```sql
SELECT tm.team_id, s.usn, s.name
FROM team_member tm
JOIN team t    ON t.team_id = tm.team_id AND t.project_id = 'P06'
JOIN student s ON s.usn = tm.usn
WHERE NOT EXISTS (SELECT 1 FROM claim c
                  WHERE c.usn = tm.usn AND c.project_id = 'P06' AND c.milestone_no = 4);
```

**D12 (app schema, derived totals). Lab CIE out of 50 per student (the core of `v_lab_cie_marks`).**

```sql
SELECT a.usn,
       round(SUM(a.marks) FILTER (WHERE m.cie_part = 'reduced') * 30.0
             / (SELECT SUM(max_marks) FROM milestone
                WHERE project_id = 'P06' AND cie_part = 'reduced'), 1)       AS reduced_30,
       MAX(a.marks) FILTER (WHERE m.cie_part = 'innovative')                AS innovative_10,
       MAX(a.marks) FILTER (WHERE m.cie_part = 'final')                     AS final_10
FROM assessment a
JOIN milestone m ON m.project_id = a.project_id AND m.milestone_no = a.milestone_no
WHERE a.project_id = 'P06'
GROUP BY a.usn;
```

Total = reduced_30 + COALESCE(innovative_10, 0) + COALESCE(final_10, 0). Never stored.

**D13 (recursion). The subtree under skill "Databases".**

```sql
WITH RECURSIVE sub AS (
    SELECT skill_id, name, parent_skill_id, 1 AS depth
    FROM skill WHERE name = 'Databases'
    UNION ALL
    SELECT k.skill_id, k.name, k.parent_skill_id, sub.depth + 1
    FROM skill k JOIN sub ON k.parent_skill_id = sub.skill_id
)
SELECT * FROM sub ORDER BY depth, name;
```

Follow-up: how do you stop a cycle? Add `CYCLE skill_id SET is_cycle USING cycle_path` after the
CTE (PostgreSQL 14+), as `skill_subtree()` does, or carry a path array and filter
`WHERE NOT k.skill_id = ANY(path)`.

**D14 (idempotent ingest). Record a commit only once, whatever the redeliveries.**

```sql
INSERT INTO contribution (usn, artifact_id, contribution_type, description, source, source_ref)
VALUES ('1RV24CY047', 'G0001', 'documentation', 'ER notes', 'github',
        '3f9c2ab0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6')
ON CONFLICT (source, source_ref, usn, artifact_id) WHERE source_ref IS NOT NULL
DO NOTHING;
```

Follow-up: why the WHERE in ON CONFLICT? The key is a **partial** unique index
(`contribution_idempotency_key … WHERE source_ref IS NOT NULL`); the inference clause must name its
predicate.

**D15 (security). Write the policy "a student reads only their own marks; staff read the marks of
projects they oversee".**

```sql
ALTER TABLE assessment ENABLE ROW LEVEL SECURITY;
CREATE POLICY assessment_select ON assessment FOR SELECT TO authenticated
    USING (usn = (SELECT app.current_usn()) OR app.oversees_project(project_id));
```

Follow-up: why `(SELECT app.current_usn())`? Wrapped in a scalar subquery it is evaluated once per
statement (an InitPlan), not once per row.

**D16 (concurrency). The race-safe join, by hand.**

```sql
BEGIN ISOLATION LEVEL REPEATABLE READ;
UPDATE team SET max_size = max_size WHERE team_id = 'T02' RETURNING max_size;  -- write the parent
SELECT COUNT(*) FROM team_member WHERE team_id = 'T02';                        -- then count
INSERT INTO team_member (team_id, usn, role)          -- Nikhil (no team); joined_at is server-set
VALUES ('T02', '1RV24CY077', 'member');
COMMIT;   -- the loser gets 40001 at the UPDATE and retries; the retry sees 4/4 and is refused
```

**D17 (full-text search). Chunks mentioning "provenance", best first.**

```sql
SELECT chunk_id, artifact_id, ts_rank_cd(tsv, q) AS rank
FROM artifact_chunk, websearch_to_tsquery('english', 'provenance') AS q
WHERE tsv @@ q
ORDER BY rank DESC
LIMIT 10;
```

Run it as a student and as Lakshmi to show RLS changing the result.

**D18 (Mongo, Test M2). Team Alpha's notes after 1 Oct 2026, title and status, newest first.**

```javascript
db.notes.find(
  { team_id: "T01", created_at: { $gt: ISODate("2026-10-01") } },
  { _id: 0, title: 1, status: 1 }
).sort({ created_at: -1 })
```

**D19 (Mongo, Test M3). Finalise note N03.**

```javascript
db.notes.updateOne(
  { note_id: "N03" },
  { $set: { status: "final" }, $inc: { version: 1 }, $push: { tags: "reviewed" } })
```

**D20 (Mongo, Test M4 and its MapReduce twin). Commits and lines added per author.**
Expected first row `{ _id: '1RV24CY047', commits: 2, lines_added: 370 }`.

```javascript
db.github_events.aggregate([
  { $unwind: "$commits" },
  { $group: { _id: "$commits.author_usn",
              commits: { $sum: 1 }, lines_added: { $sum: "$commits.additions" } } },
  { $sort: { lines_added: -1 } }
])

// The same as MapReduce (deprecated since MongoDB 5.0; shown for Unit V)
db.github_events.mapReduce(
  function () { this.commits.forEach(c => emit(c.author_usn, { commits: 1, lines: c.additions })); },
  function (key, vals) {
    return vals.reduce((a, v) => ({ commits: a.commits + v.commits, lines: a.lines + v.lines }),
                       { commits: 0, lines: 0 });
  },
  { out: { inline: 1 } })
```

**D21 (Mongo, Test M5, `$lookup`). Final notes with author names.**

```javascript
db.notes.aggregate([
  { $match: { status: "final" } },
  { $lookup: { from: "portfolios", localField: "author_usn", foreignField: "usn", as: "author" } },
  { $unwind: "$author" },
  { $project: { _id: 0, title: 1, author: "$author.name" } }
])
```

**D22 (Mongo, the portfolio rebuild in miniature). Notes authored per student, upserted into
`portfolios`.**

```javascript
db.notes.aggregate([
  { $group: { _id: "$author_usn", notes_authored: { $sum: 1 } } },
  { $project: { _id: 0, usn: "$_id", "evidence.notes.authored": "$notes_authored",
                generated_at: "$$NOW" } },
  { $merge: { into: "portfolios", on: "usn", whenMatched: "merge", whenNotMatched: "insert" } }
])
```

Follow-up: `$merge … on: "usn"` needs a unique index on `portfolios.usn` (we create `usn_unique`).

---

## Part D. Numbers worth knowing

| Fact | Value |
|:--|:--|
| Fixture | 13 tables; 12 students, 5 teams, 28 contributions; 37 SQL (Q1–Q37) and 25 Mongo (M1–M25) queries, frozen |
| Schema now | 29 public tables + `private.note`; 6 `security_invoker` views; 16 RPCs + `search_chunks()`; 5 service-role-only pipeline RPCs; 58 FKs (54 as of 0004, counted in C3; 0005 adds 4) |
| Tests | pgTAP 657 assertions (45 + 298 + 126 + 53 + 119 + 16); fixture 37/37 and 25/25; API pytest 47; web e2e 38 |
| Race experiment | 6 strategies × 3 levels × 4 N × 1000 = 72,000 races, 2,556,000 attempts, 0 deadlocks; fixture trigger at RR: 100% over-admission, worst 103/4; capacity v2: 0% |
| Latency (N = 100) | capacity v2 p95 6.0 ms at RR, 12.1 ms at RC |
| Live replay | 16 deliveries → 9 projected, 1 ignored (feature branch), 1 ping, 1 `issues` event, 2 signature failures (401), 2 duplicates → 29 GitHub contributions, 58 chunks, 0 embeddings |
| Marks | 120 raw → 30 (round(raw × 30 / 120, 1)) + Innovative 10 + Final 10 = 50 |
| Advisors (5 Nov) | security 0 ERROR (4 WARN: 3 intended private-note definer RPCs, 1 leaked-password protection off); performance 0 unindexed FKs |

**Honest gaps to admit if asked.** No AI keys yet (answers are extractive; embeddings unused);
CI workflow written but not pushed (needs a `workflow`-scoped token); identity verification is
administrative (GitHub OAuth planned); the student-facing portfolio export and verified-skill
derivation are not built; leaked-password protection is off in the cloud Auth settings; migration
0007 (C2 defects D1, D2, D4) was scheduled for C8 and is deferred; the open UI issues are in
`docs/KNOWN_ISSUES.md`.
