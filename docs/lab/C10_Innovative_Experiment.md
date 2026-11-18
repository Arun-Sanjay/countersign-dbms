---
title-meta: "Innovative Experiment: Unified Experiential Learning and Project Intelligence Platform (Countersign)"
author-meta: "S Arun Sanjay (1RV24CY047)"
subject: "CD252IA Database Management Systems, Lab Component 10"
lang: en-GB
---

::: cover
**RV College of Engineering®, Bengaluru – 59**

**Department of Computer Science and Engineering**

**DATABASE MANAGEMENT SYSTEMS (CD252IA)**

**Lab Component 10: Innovative Experiment**

&nbsp;

**THE LAST TEAM SLOT: DECLARATIVE VERSUS PROCEDURAL INTEGRITY UNDER CONCURRENCY**

**Unified Experiential Learning and Project Intelligence Platform**

(product name: Countersign)

&nbsp;

| USN | Name |
|:--|:--|
| 1RV24CY047 | S Arun Sanjay |

&nbsp;

Semester V, 2026-27

Revision 1.2, 19 November 2026
:::

::: toc
:::

# 0. Summary and sources

**One-line result.** *A correct-looking lock-then-check trigger is only correct at READ COMMITTED.* The capacity trigger that the project's own graded fixture uses (query Q35) let a team of maximum size 4 grow to **103/4** under REPEATABLE READ. It over-admitted in **1000 of 1000** races at every client count we tried. The same trigger never went above 4/4 under READ COMMITTED or SERIALIZABLE; at SERIALIZABLE, however, it is not the trigger but SSI that stops the second joiner. So, of the two snapshot levels without predicate tracking, the trigger is correct only at READ COMMITTED. Three other designs never went above 4/4 at any isolation level in 36,000 races: a conditional counter, a **declarative** design in which capacity becomes primary-key and foreign-key constraints, and the trigger the product actually ships ("capacity v2"), which *writes* the parent row instead of only locking it.

**What was measured.** Six ways of enforcing one business rule ("a team has at most `max_size` members") were each run at PostgreSQL's three isolation levels, with N = 2, 8, 32 and 100 clients released together by a barrier, for 1000 trials per cell. That is 72 cells, 72,000 races and 2,556,000 join attempts. For every two-client race the harness also recorded a schedule, built its precedence graph **in SQL** and tested it for conflict serializability with a recursive CTE. A separate script prints PostgreSQL's real lock table and wait-for graph while a race is in progress.

**Sources.** Everything in this document is taken from files in the repository. Nothing was re-measured for the report.

| What | File |
|---|---|
| Harness, strategy objects, analysis SQL | `experiments/race/harness.py`, `schema.sql`, `analysis.sql`, `analysis_selftest.sql`, `live_locks.sql`, `demo_locks.sh`, `setup.sh`, `report.py` |
| Measured results (tables, CSVs, charts) | `experiments/race/results/results.md`, `analysis_output.txt`, `analysis_selftest_output.txt`, `demo_locks_*.txt`, `*.csv`, `*.png` |
| Narrative and day-1 finding | `experiments/race/README.md`, `experiments/race/FINDINGS.md` |
| The Race arena page in the product (Section 12.4) | `web/src/pages/race/` (route `/race`), `web/scripts/race-results.mjs` (copies the measured results into `web/src/data/race-results.json`), `api/app/race.py` (`POST /race/run`), e2e spec `web/e2e/11-race.spec.ts` |
| The graded fixture (read, never edited) | `supabase/fixture/01_schema.sql`, `02_seed.sql`, `03_queries.sql` (Q35 to Q37) |
| The product's rules | `supabase/migrations/20261104000002_app_core.sql` (capacity v2, one team per project, membership write-lock, claim revision) |

**Terminology** follows Elmasri and Navathe, *Fundamentals of Database Systems*, 7th edition, Chapter 20 ("Introduction to Transaction Processing Concepts and Theory") and Chapter 21 ("Concurrency Control Techniques"), and the PostgreSQL 17 documentation, Chapter 13 ("Concurrency Control"). Section 2 defines every term before it is used, because three common phrasings are wrong for this race: it is **not** a "lost update", `FOR UPDATE` on one row is **not** "strict 2PL" for the transaction, and REPEATABLE READ in PostgreSQL is **snapshot isolation**, not the lock-based level of the SQL standard.

**How this document covers the component.**

| Expected part of an innovative experiment | Where |
|---|---|
| Aim and why it is non-trivial | Section 1 |
| Syllabus link (Unit IV: transactions, schedules, serializability, 2PL, lock types and lock tables) | Section 2 |
| Hypotheses stated before the results | Section 3 |
| Method: hardware, software, harness, controls, sample size | Section 4 |
| The designs compared, with their SQL | Section 5 |
| Results: tables and three charts | Section 6 |
| Precedence graphs and conflict-serializability testing in SQL, with worked examples | Section 7 |
| Live lock table and wait-for graph | Section 8 |
| Analysis and discussion | Section 9 |
| Threats to validity | Section 10 |
| Conclusion | Section 11 |
| How the product applies the result, and the Race arena page (`/race`) | Section 12 |
| Reproduction steps | Section 13 |

# 1. Aim

Team Beta (`T02`) of project P01 has `max_size = 4` and three members, so it has exactly **one free seat**. N students press "Join" at the same moment. The aim is to answer three questions with measurements rather than opinion:

1. **Which ways of writing the capacity rule keep the team at 4/4, at which isolation level?** The candidates range from an application check (read the count, then insert) through procedural triggers to a purely declarative design made of keys.
2. **Can the textbook test for conflict serializability (a precedence graph with no cycle) be run inside the database, over the schedules the race produced?**
3. **What does correctness cost**, in latency, in aborted transactions and in the retry logic that clients must then carry?

**Why it is non-trivial.** The rule spans *rows*: "the number of rows of `team_member` with `team_id = 'T02'` is at most 4". No `CHECK` constraint can express it, because a `CHECK` sees one row. Every implementation therefore reads a set of rows and then inserts a *new* row that the read could not have locked. This is the phantom problem of Unit IV, in a form that appears in every real system with quotas, seats or stock.

**Why it matters to this project.** The fixture's own answer to the problem (Q35, a trigger that locks the team row `FOR UPDATE` and then counts; Q37, the same lock taken explicitly) is presented in the graded fixture as the safe way to join ("two students cannot take the same last slot"). Section 6 shows that it is unsafe at REPEATABLE READ, and that at SERIALIZABLE it is SSI, not the lock, that keeps it safe. The product's design was changed because of this experiment (Section 12).

# 2. Background (Unit IV)

## 2.1 Transactions and their properties

A **transaction** is a logical unit of database work: a sequence of read and write operations that ends in **commit** or **abort**. Its states are *active*, *partially committed*, *committed*, *failed* and *terminated*. The DBMS guarantees the **ACID** properties: **atomicity** (all or nothing), **consistency preservation** (a transaction that runs alone takes the database from one consistent state to another), **isolation** (the effect of concurrent execution is as if the transactions ran one after another) and **durability** (committed effects survive failures).

In this experiment one *join* is one transaction. Its consistency rule is the capacity invariant. Each join, run **alone**, preserves the invariant in all six designs, including the naive one. The failures in Section 6 are therefore failures of **isolation**, not of the join logic.

## 2.2 Schedules, conflicts and conflict serializability

A **schedule** $S$ of transactions $T_1, \dots, T_n$ is an ordering of their operations that keeps the order of operations within each transaction. Notation: $r_i(x)$ and $w_i(x)$ are a read and a write of item $x$ by $T_i$; $c_i$ and $a_i$ are its commit and abort.

Two operations **conflict** if (1) they belong to different transactions, (2) they access the same item and (3) at least one of them is a write. So $r$–$w$, $w$–$r$ and $w$–$w$ pairs conflict; $r$–$r$ pairs do not. Two schedules are **conflict equivalent** if they order every conflicting pair the same way. A schedule is **conflict serializable** if it is conflict equivalent to some *serial* schedule.

**The test (precedence graph).** Build a directed graph with one node per committed transaction. For every conflicting pair in which $T_i$'s operation comes before $T_j$'s, add the edge $T_i \to T_j$. Then

$$S \text{ is conflict serializable} \iff \text{its precedence graph has no cycle},$$

and any **topological order** of an acyclic graph is an equivalent serial schedule. Section 7 implements exactly this test in SQL.

## 2.3 Lost update, write skew and the phantom: the precise terms

| Anomaly | Definition | Does it happen here? |
|---|---|---|
| **Lost update** | Two transactions read the *same* item and both write *that* item; one write overwrites the other. Schedule $r_1(x)\,r_2(x)\,w_1(x)\,w_2(x)$. | **No.** Nobody overwrites anything; every racer inserts its own new row. |
| **Write skew** | Two transactions read overlapping data and then write *different* items, each write justified by what it read. Each write is valid alone, but together they break an invariant that spans the items. | **Yes.** Both racers read "3 members", each inserts a *different* row, and `COUNT ≤ 4` is broken. |
| **Phantom** | A transaction reads the set of rows that satisfy a *predicate* (`WHERE team_id = 'T02'`); a concurrent transaction inserts a *new* row that satisfies the predicate. Row locks cover only rows that already exist, so they cannot stop it. | **Yes.** The inserted member row is the phantom. |

PROJECT_MASTER §8 calls this race a "lost update / phantom"; the design review in `docs/PLAN.md` (item 4) flagged the term. The correct description is **write skew through a phantom**.

A second terminology trap: the SQL standard also uses "phantom read" for *one* transaction that runs the same query twice and sees a new row the second time. PostgreSQL's REPEATABLE READ prevents that (it re-reads its own snapshot), yet the write skew above still happens at REPEATABLE READ. The phantom that matters in this report is the **phantom problem for locking**: a lock-based scheme cannot lock a row that does not yet exist.

## 2.4 Locking: lock types, 2PL and why one row lock is not 2PL

**Lock types.** A *shared* (S, read) lock allows other S locks; an *exclusive* (X, write) lock conflicts with every other lock on the item. PostgreSQL has four **row-level** lock modes (`FOR KEY SHARE`, `FOR SHARE`, `FOR NO KEY UPDATE`, `FOR UPDATE`; an `UPDATE` takes `FOR NO KEY UPDATE` unless it changes a key) and eight **table-level** modes (for example `AccessShareLock` for `SELECT`, `RowShareLock` for `SELECT … FOR UPDATE`, `RowExclusiveLock` for `INSERT`/`UPDATE`). Plain `SELECT` takes **no row lock** at all: it reads an MVCC snapshot (Section 2.5).

**Two-phase locking (2PL).** A transaction follows 2PL if all its lock acquisitions come before its first release (a *growing* phase, then a *shrinking* phase). **Theorem:** if every transaction follows 2PL, every schedule is conflict serializable. *Strict* 2PL holds exclusive locks until commit or abort; *rigorous* 2PL holds all locks until then. To stop phantoms, a lock-based scheduler must also lock **predicates or index ranges**, not only rows.

**What PostgreSQL actually does.** Every PostgreSQL row lock is held until the transaction ends, so *for the rows a transaction locks* the behaviour is rigorous 2PL. But a transaction that locks only the `team` row is **not** a 2PL transaction in the sense of the theorem: its `COUNT(*)` reads the members **without any lock**, from a snapshot, and PostgreSQL has no predicate locks outside SERIALIZABLE. The theorem therefore does not apply to it. The team-row lock in designs S2 and S7 is a **mutex on a surrogate row**: it puts the joiners in a queue. Whether the queue is *enough* depends on which snapshot the waiter reads after it gets the lock (Section 9.1). PROJECT_MASTER §8 describes `FOR UPDATE` as "strict 2PL"; the precise statement is that it is one strict-2PL-style lock, not a 2PL schedule.

## 2.5 MVCC and snapshot isolation (READ COMMITTED, REPEATABLE READ)

PostgreSQL uses **multiversion concurrency control (MVCC)**. An `UPDATE` writes a new row version; a reader sees the versions that were committed in its **snapshot**. Readers never block writers and writers never block readers. Only two writers of the same row wait for each other.

* **READ COMMITTED (RC)** takes a **new snapshot for every statement**. This includes every statement inside a (volatile, the default) PL/pgSQL trigger function. If an `UPDATE` or `SELECT … FOR UPDATE` has to wait for a row lock, after the wait it re-evaluates its `WHERE` clause on the **newest** row version (*EvalPlanQual*).
* **REPEATABLE READ (RR)** is **snapshot isolation**: one snapshot for the whole transaction, taken by its **first statement** (not by `BEGIN`). If the transaction tries to update or lock a row that a concurrent transaction **modified** and committed after the snapshot, it fails with SQLSTATE **40001** ("could not serialize access due to concurrent update"): *first-updater-wins*. If the row was only **locked** by the other transaction, not modified, there is no error. That gap is the whole of the headline result.

## 2.6 Serializable Snapshot Isolation (SERIALIZABLE)

PostgreSQL's SERIALIZABLE is **Serializable Snapshot Isolation (SSI)**: snapshot isolation plus **SIREAD locks**, which record what each transaction read (rows, pages or whole relations). SIREAD locks **never block**; they only record reads. From them SSI finds **rw-antidependencies** ($T_i \xrightarrow{rw} T_j$: $T_i$ read a version that $T_j$ later replaced or, for a predicate, $T_j$ inserted a row $T_i$'s read would have matched). When it finds a *dangerous structure*, two consecutive rw-antidependencies $T_1 \xrightarrow{rw} T_2 \xrightarrow{rw} T_3$ between concurrent transactions ($T_2$ is the *pivot*; $T_1$ and $T_3$ may be the same transaction, as in this experiment), it aborts one transaction with 40001. In PostgreSQL the structure forces an abort only if $T_3$ commits first (Ports and Grittner, VLDB 2012). SSI **detects and aborts**; it does not block. It is conservative: it may abort a transaction that would have been serializable (a false positive), never the reverse. The client must retry.

## 2.7 Comparison: 2PL, MVCC/SI and SSI for this race

The table compares how each mechanism treats the second of two concurrent joiners.

| Mechanism | How the second joiner is stopped | Blocks or aborts? | Stops write skew via a phantom? |
|---|---|---|---|
| 2PL with predicate (range) locks (textbook, lock-based SERIALIZABLE) | Its `COUNT` needs an S lock on the predicate `team_id = 'T02'`, which conflicts with the first joiner's insert | blocks (deadlocks possible) | yes |
| RC (MVCC, statement snapshots) | Only if the rule makes it re-read after a row-lock wait | blocks on row locks only | only with a surrogate-row lock or a key |
| RR (snapshot isolation) | Only by a **write-write** conflict on one row (40001) or a unique key | aborts on w–w conflicts | **no**, unless the rule writes a shared row |
| SSI (PostgreSQL SERIALIZABLE) | rw-antidependency cycle detected through SIREAD locks | aborts (retry needed) | yes |

The PostgreSQL documentation's anomaly table (Chapter 13.2) states the same: a *serialization anomaly* is possible at RC and RR and impossible only at SERIALIZABLE.

# 3. Hypotheses

The hypotheses were written down from the theory in Section 2 before the full matrix was run. H2 came from a design review (`docs/PLAN.md`, item 4) and was first confirmed with two psql sessions on day 1 (`experiments/race/FINDINGS.md`, first table).

| | Hypothesis | Reason |
|---|---|---|
| H1 | S1 (naive check-then-insert, no lock) over-admits at RC and RR, and never at SERIALIZABLE. | Write skew is allowed by SI and by RC; SSI detects the rw-antidependency cycle. |
| H2 | S2 (the fixture trigger: lock the team row, then count) is correct at RC and **over-admits at RR**. | At RR the waiter's snapshot predates the lock wait, and a lock-only conflict raises no 40001. |
| H3 | S3 (conditional counter), S6 (declarative seat keys) and S7 (write the parent row) are correct at every level. | Each turns the conflict into a write on **one** row or one key, which RC re-checks and RR/SER reject with 40001. |
| H4 | A retry loop (S4) changes nothing below SERIALIZABLE. | Retries react to 40001, and nothing raises 40001 at RC/RR in S1. |
| H5 | For every two-client race, the precedence graph of the recorded schedule has a cycle **if and only if** the race over-admitted. | Two committed joiners that both read the member set before the other's insert form $T_1 \to T_2 \to T_1$. |
| H6 | Abort-based designs (RR/SER) have lower tail latency under contention than lock queues at RC. | Losers abort as soon as the winner commits instead of passing through a queue one by one. |

# 4. Experimental setup

## 4.1 Hardware and software

| Item | Value |
|---|---|
| Machine | Apple M5 Pro, 15 cores, 24 GB RAM, macOS 27.2 |
| Container runtime | Docker Desktop (engine 29.4.0); Linux VM with 15 vCPUs and about 7.7 GiB of memory |
| DBMS | PostgreSQL **17.11** (Debian 17.11-1.pgdg13+2, aarch64), image `postgres:17`, container `elp-race-pg`, port 55433 |
| Server settings | defaults except `max_connections = 300`; `default_transaction_isolation = read committed` |
| Client | Python 3.12 (`uv`), asyncpg; one process, one asyncio event loop; client and server on the same machine |
| Run | 2026-11-04, 17:15 to 17:28 UTC (832.6 s for the whole matrix) |

The live Supabase project runs the same major and minor version (PostgreSQL 17.11, region ap-south-1). The experiment was deliberately **not** run there: it creates and deletes thousands of rows per second and needs up to 102 simultaneous connections. Section 10 discusses what this means for validity.

## 4.2 Database and target

`setup.sh` creates a throwaway database `race` and pipes in, unchanged, the fixture's `01_schema.sql`, `02_seed.sql` and the Q35 block of `03_queries.sql`. The fixture files are only read; nothing is copied or edited. It then loads `schema.sql`, which adds a schema `exp` with the result tables, the objects of strategies S3, S6 and S7, and 100 synthetic racers `1RV99XX001` to `1RV99XX100` (not part of the graded seed). The target is always `T02`: `max_size = 4`, three seeded members.

Only one capacity mechanism is active at a time. `exp.use_strategy(S)` enables or disables the triggers and adds or drops the S6 foreign key. `exp.reset_t02()` puts T02 back to 3/4 before every trial.

## 4.3 Harness design and the barrier

![**Figure 1.** One trial of the harness (`experiments/race/harness.py`). Steps 1 to 6 repeat 1000 times per cell. Only the strategy body differs between strategies.](diagrams/c10/c10_fig1_harness.png){width=100%}

One **race** (one trial) runs as follows.

1. `exp.reset_t02()` restores T02 to 3/4 (and resets the S3 counter and the S6 seats).
2. N persistent connections each run `BEGIN ISOLATION LEVEL <L>`. `BEGIN` does **not** take a snapshot, so opening the transaction before the barrier does not change its semantics: at RR and SER the snapshot is taken by the first statement *after* the barrier.
3. The clients wait on an `asyncio.Barrier(N)`. When it releases, every client runs the strategy's join logic and then `COMMIT`. The release skew was measured: about 0.1 ms at N = 8 and about 1 to 1.5 ms at N = 100, because one event loop sends the statements one after another about 10 to 15 µs apart.
4. Each attempt is classified as `admitted`, `refused` ("team is full"), `serialization_failure` (SQLSTATE 40001), `deadlock` (40P01) or `error`.
5. The admin connection counts T02. The run is stored with `over_admitted = final_size > max_size`.
6. The logger connection writes the run, its N attempts and (for N = 2 only) the logical schedule with `COPY`.

**Controls.** (a) Same team, same starting state and same client code path for every cell; only the strategy body and the isolation level change. (b) A built-in consistency check: after every trial the harness compares the number of admitted attempts with `final_size − 3` and prints a warning on any mismatch (none occurred). (c) A negative control is part of the design: S1 and S2-at-RR *must* over-admit if the harness can detect the anomaly at all, and they do. (d) The whole matrix was re-run independently in a verification pass; it gave the same over-admission rate and worst size in all 72 cells.

## 4.4 Matrix and sample size

| Factor | Levels |
|---|---|
| Strategy | S1, S2, S3, S4, S6, S7 (six; there is no S5, see Section 5) |
| Isolation level | READ COMMITTED (RC), REPEATABLE READ (RR), SERIALIZABLE (SER) |
| Concurrent clients N | 2, 8, 32, 100 |
| Trials per cell | 1000 |
| Total | 72 cells, **72,000 races, 2,556,000 attempts**, 120,558 logged schedule operations |

1000 trials per cell are enough for the question asked. For a cell with 0 over-admissions in 1000 races, the "rule of three" gives a 95% upper confidence bound of $3/1000 = 0.3\%$ per race. Pooled over the four values of N (4000 races) the bound is 0.075%.

## 4.5 What the harness records for a schedule

For N = 2 races the harness writes a **logical, client-recorded schedule** into `exp.schedule_log` (one row per operation: run, sequence number, transaction, `r`/`w`/`c`/`a`, item). It is the textbook model of what the clients did, not PostgreSQL's internal execution, which never runs a single interleaving of reads and writes over single-version items. The placement rule is:

* `w(x)`, `c` and `a` are placed when the client sees the statement (or COMMIT/ROLLBACK) complete.
* `r(x)` is placed at the **snapshot the read used**. At RC that is when the statement ran; for a statement that waited for a row lock and then re-read the newest version (the trigger's `COUNT` in S2 and S7, S3's `UPDATE … WHERE`), it is right after the lock was granted. At RR and SER every read is placed at the transaction's first statement.
* Items: `team:T02` (the team row), `members:T02` (the predicate "members of T02", read by `COUNT` and changed by `INSERT`), `counter:T02` (S3) and `seats:T02` (S6).
* An abort records its reason: `a1[40001]` means the DBMS killed $T_1$; `a1[refused]` means the client rolled back after "team is full".

Section 10 explains why this model makes H5 partly true by construction.

# 5. The six strategies

The numbering follows the strategy list in `docs/PLAN.md`, which has no S5; S7 was added later for the product's capacity v2 trigger.

| | Strategy | Where the rule lives | Idea |
|---|---|---|---|
| S1 | Naive check-then-insert | application, no lock | read the count, think 10 ms, insert |
| S2 | Fixture trigger Q35 | procedural, in the database | lock the parent row, then count |
| S3 | Conditional counter | procedural, one statement | test and increment one counter row in one `UPDATE` |
| S4 | S1 + retry on 40001/40P01 | application | the textbook SERIALIZABLE contract |
| S6 | Declarative seats | **declarative**: PK + FK | capacity becomes a finite set of keys |
| S7 | Write the parent (product capacity v2) | procedural, in the database | a no-op `UPDATE` of the parent row, then count |

## 5.1 S1: naive check-then-insert

```sql
-- client, inside BEGIN ISOLATION LEVEL <L>
SELECT (SELECT count(*) FROM team_member WHERE team_id = 'T02')::int AS n,
       (SELECT max_size FROM team WHERE team_id = 'T02')            AS cap;
-- if n >= cap: ROLLBACK ("team is full")
SELECT pg_sleep(0.01);                         -- 10 ms think time widens the window
INSERT INTO team_member (team_id, usn, role, joined_at)
VALUES ('T02', $usn, 'member', current_date);
COMMIT;
```

No row is written by two transactions, so neither row locks nor first-updater-wins have anything to catch. Only SSI sees the rw-antidependencies.

## 5.2 S2: the fixture trigger (Q35, verbatim)

```sql
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
```

The client only runs `INSERT INTO team_member … ; COMMIT;`. The trigger locks the **parent** row because the phantom row cannot be locked. Query Q37 (lock the team row explicitly, then insert) has the same structure and the same flaw (FINDINGS, day 1).

## 5.3 S3: conditional counter

```sql
CREATE TABLE exp.team_counter (
    team_id      VARCHAR(5) PRIMARY KEY REFERENCES team(team_id) ON DELETE CASCADE,
    member_count INT NOT NULL CHECK (member_count >= 0),
    max_size     INT NOT NULL,
    CHECK (member_count <= max_size)
);
-- client: the test and the write are ONE statement
UPDATE exp.team_counter SET member_count = member_count + 1
WHERE team_id = 'T02' AND member_count < max_size
RETURNING member_count;                        -- no row back: "team is full"
INSERT INTO team_member (team_id, usn, role, joined_at)
VALUES ('T02', $usn, 'member', current_date);
COMMIT;
```

The predicate is replaced by a single row that every joiner **writes**. At RC a waiting `UPDATE` re-checks its `WHERE` on the newest version (EvalPlanQual), matches nothing and the client refuses. At RR/SER the row changed after the snapshot, so 40001.

## 5.4 S4: S1 with retry

The body is S1. On SQLSTATE 40001 or 40P01 the client rolls back, waits a random 1 to 5 ms times $2^{k-1}$ (exponential back-off with jitter) and starts a **new transaction**, up to 5 retries:

```python
except asyncpg.PostgresError as e:
    await conn.execute("ROLLBACK")
    if e.sqlstate in ("40001", "40P01") and retries < 5:
        retries += 1
        await asyncio.sleep(random.uniform(0.001, 0.005) * 2 ** (retries - 1))
        await conn.execute(f"BEGIN ISOLATION LEVEL {iso}")
        continue                               # run the S1 body again, new snapshot
```

## 5.5 S6: declarative seats

Capacity becomes **data** (a finite set of seat keys) and the rule becomes **keys** (Figure 2).

```sql
CREATE TABLE exp.team_seat_slot (              -- seats 1..max_size for each team
    team_id VARCHAR(5) REFERENCES team(team_id) ON DELETE CASCADE,
    seat_no INT CHECK (seat_no BETWEEN 1 AND 6),
    PRIMARY KEY (team_id, seat_no)
);
CREATE TABLE exp.team_seat (
    team_id VARCHAR(5)  NOT NULL,
    seat_no INT         NOT NULL,
    usn     VARCHAR(10) NOT NULL REFERENCES student(usn) ON DELETE CASCADE,
    PRIMARY KEY (team_id, seat_no),                          -- one holder per seat
    UNIQUE (team_id, usn),                                   -- one seat per student
    FOREIGN KEY (team_id, seat_no) REFERENCES exp.team_seat_slot ON DELETE CASCADE
);
-- while S6 is active: no member without a seat (checked at COMMIT)
ALTER TABLE team_member ADD CONSTRAINT team_member_needs_seat
    FOREIGN KEY (team_id, usn) REFERENCES exp.team_seat (team_id, usn)
    DEFERRABLE INITIALLY DEFERRED;

-- join: claim the lowest free seat; lose quietly if someone else got it
CREATE FUNCTION exp.claim_seat(p_team VARCHAR, p_usn VARCHAR) RETURNS INT
LANGUAGE sql AS $$
    INSERT INTO exp.team_seat (team_id, seat_no, usn)
    SELECT s.team_id, s.seat_no, p_usn
    FROM exp.team_seat_slot s
    WHERE s.team_id = p_team
      AND NOT EXISTS (SELECT 1 FROM exp.team_seat x
                      WHERE x.team_id = s.team_id AND x.seat_no = s.seat_no)
    ORDER BY s.seat_no
    LIMIT 1
    ON CONFLICT (team_id, seat_no) DO NOTHING
    RETURNING seat_no
$$;
```

The client calls `exp.claim_seat`; on a seat number it inserts the member and commits. On `NULL` it counts the free seats and refuses if there are none.

![**Figure 2.** S6, the declarative design. The primary key of `exp.team_seat` *is* the capacity rule; the foreign key to the slot table limits seat numbers to 1..`max_size`; the deferred foreign key from `team_member` means no client, however buggy, can add a member without holding one of the four seats.](diagrams/c10/c10_fig2_seats.png){width=100%}

## 5.6 S7: write the parent row (the product's capacity v2)

Re-created in schema `exp` from migration 0002 so that the migration files stay untouched:

```sql
CREATE FUNCTION exp.enforce_team_capacity_v2()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
    cap          INT;
    current_size INT;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.team_id = OLD.team_id THEN
        RETURN NEW;
    END IF;
    UPDATE public.team SET max_size = max_size          -- no-op WRITE of the parent row
    WHERE team_id = NEW.team_id
    RETURNING max_size INTO cap;
    IF NOT FOUND THEN
        RETURN NEW;
    END IF;
    SELECT count(*) INTO current_size FROM public.team_member WHERE team_id = NEW.team_id;
    IF current_size >= cap THEN
        RAISE EXCEPTION 'Team % is full (% / %)', NEW.team_id, current_size, cap
            USING ERRCODE = 'check_violation', CONSTRAINT = 'team_capacity';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_team_capacity_v2
BEFORE INSERT OR UPDATE OF team_id ON team_member
FOR EACH ROW EXECUTE FUNCTION exp.enforce_team_capacity_v2();
```

The only difference from S2 is the first statement: `UPDATE … SET max_size = max_size` instead of `SELECT … FOR UPDATE`. The no-op `UPDATE` takes the same kind of row lock **and creates a new row version**. That one change turns a lock-only conflict into a write-write conflict.

# 6. Results

## 6.1 Over-admission

**Table 1.** Share of races that ended above 4/4 (all N pooled, 4000 races per cell); worst final size in brackets.

| Strategy | READ COMMITTED | REPEATABLE READ | SERIALIZABLE |
|---|---|---|---|
| S1 naive check-then-insert | **100%** (103/4) | **100%** (103/4) | 0% (4/4) |
| S2 fixture trigger (Q35) | 0% (4/4) | **100%** (103/4) | 0% (4/4) |
| S3 conditional counter | 0% (4/4) | 0% (4/4) | 0% (4/4) |
| S4 S1 + retry on 40001 | **100%** (103/4) | **100%** (103/4) | 0% (4/4) |
| S6 declarative seats | 0% (4/4) | 0% (4/4) | 0% (4/4) |
| S7 write-the-parent (v2) | 0% (4/4) | 0% (4/4) | 0% (4/4) |

Every cell marked 0% admitted **exactly one** racer in **every** race. There were no deadlocks and no other errors in 2.56 million attempts. In S2 at RR, 141,989 of 142,000 racers were admitted.

![**Figure 3.** Mean number of members above `max_size` per race, by strategy, isolation level and N. The over-admitting cells admit every racer: +1 at N = 2, +99 at N = 100. (`experiments/race/results/over_admission_heatmap.png`.)](../../experiments/race/results/over_admission_heatmap.png){width=100%}

## 6.2 How each attempt ended

**Table 2.** Outcome of all attempts per strategy and isolation level (N pooled: 142,000 attempts per row). `APP` = refused by the client's own check, `P0001` = refused by the Q35 trigger, `23514` = refused by the v2 trigger.

| Strategy | Isolation | Admitted | Refused | 40001 | Deadlock | Error | SQLSTATEs seen |
|---|---|---|---|---|---|---|---|
| S1 | RC | 142,000 | 0 | 0 | 0 | 0 | - |
| S1 | RR | 142,000 | 0 | 0 | 0 | 0 | - |
| S1 | SER | 4,000 | 0 | 138,000 | 0 | 0 | 40001 |
| S2 | RC | 4,000 | 138,000 | 0 | 0 | 0 | P0001 |
| S2 | RR | **141,989** | 11 | 0 | 0 | 0 | P0001 |
| S2 | SER | 4,000 | 134 | 137,866 | 0 | 0 | 40001, P0001 |
| S3 | RC | 4,000 | 138,000 | 0 | 0 | 0 | APP |
| S3 | RR | 4,000 | 24 | 137,976 | 0 | 0 | 40001, APP |
| S3 | SER | 4,000 | 83 | 137,917 | 0 | 0 | 40001, APP |
| S4 | RC | 142,000 | 0 | 0 | 0 | 0 | - |
| S4 | RR | 142,000 | 0 | 0 | 0 | 0 | - |
| S4 | SER | 4,000 | 138,000 | 0 (final) | 0 | 0 | APP (after retry) |
| S6 | RC | 4,000 | 138,000 | 0 | 0 | 0 | APP |
| S6 | RR | 4,000 | 246 | 137,754 | 0 | 0 | 40001, APP |
| S6 | SER | 4,000 | 39 | 137,961 | 0 | 0 | 40001, APP |
| S7 | RC | 4,000 | 138,000 | 0 | 0 | 0 | 23514 |
| S7 | RR | 4,000 | 18 | 137,982 | 0 | 0 | 23514, 40001 |
| S7 | SER | 4,000 | 659 | 137,341 | 0 | 0 | 23514, 40001 |

For S4 at SER the final outcome of every loser is "refused", because its retry saw 4/4. Every one of those 138,000 losers first received a 40001, and 238 of them needed a second retry.

![**Figure 4.** How the 32 racers of a race ended (N = 32). The correct designs show the same split at every level (one admitted, 31 losers), but *how* the losers lose depends on the level: refused at RC (they re-read after a lock wait), aborted with 40001 at RR and SER. S4 at SER turns the aborts back into clean refusals.](../../experiments/race/results/outcome_mix_n32.png){width=100%}

## 6.3 Cost: latency

Latency is measured per attempt, from that client's release at the barrier to its final outcome, including retries. S1 and S4 contain 10 ms of deliberate think time.

**Table 3.** p95 latency per attempt in milliseconds (full matrix with p50 in Appendix A).

| Strategy | RC, N = 2 | RR, N = 2 | SER, N = 2 | RC, N = 100 | RR, N = 100 | SER, N = 100 |
|---|---|---|---|---|---|---|
| S1 naive | 17.42 | 17.61 | 17.40 | 20.43 | 20.44 | 25.61 |
| S2 Q35 trigger | 0.71 | 0.71 | 0.75 | 12.08 | *28.98* | 12.21 |
| S3 counter | 0.84 | 0.91 | 0.96 | 17.07 | 6.92 | **6.02** |
| S4 S1 + retry | 17.28 | 17.17 | 22.83 | 20.30 | 20.21 | 31.87 |
| S6 seats | 1.69 | 1.43 | 1.13 | 8.23 | 7.34 | 6.94 |
| S7 v2 | 0.81 | 0.83 | 0.71 | 12.10 | **5.99** | 6.29 |

Italic: an incorrect cell (it admits 99 extra members; it is slow because 100 transactions insert and commit). Bold: the lowest p95 among the correct designs at N = 100 under RR and under SER. At N = 2 the correct designs without think time are close but not all below 1 ms: S2 (RC 0.71, SER 0.75), S3 (0.84 to 0.96) and S7 (0.71 to 0.83) are below 1 ms at every level where they are correct, while S6 takes 1.13 to 1.69 ms at every level (RC 1.69, RR 1.43, SER 1.13). The two correct cells that contain the 10 ms think time are far above: S1 at SER 17.40 ms and S4 at SER 22.83 ms.

![**Figure 5.** p95 attempt latency against N (log scale). Among the correct designs, the abort-based paths (RR and SER) stay lowest as N grows; the RC lock queues (S2, S3, S7 at RC) grow fastest.](../../experiments/race/results/latency_p95.png){width=100%}

## 6.4 Hypotheses: verdict

Each hypothesis of Section 3 against the measurements above.

| | Verdict | Evidence |
|---|---|---|
| H1 | **Confirmed.** | S1: 100% at RC and RR, 0% at SER (Table 1). |
| H2 | **Confirmed**, at every N. | S2: 0% at RC, 100% at RR, 0% at SER; worst 103/4. |
| H3 | **Confirmed.** | S3, S6, S7: 0 of 36,000 races over-admitted; exactly one admitted per race. |
| H4 | **Confirmed.** | S4 at RC/RR is identical to S1 (100%, 0 retries). |
| H5 | **Confirmed**, but partly by construction (Section 7.5 and 10.1). | 5,000 cycles in exactly the 5,000 over-admitting N = 2 races. |
| H6 | **Confirmed** at N = 100. **Not discriminating** at N = 2: with two clients there is almost no queue, the correct designs without think time lie between 0.71 and 1.69 ms (S6 is the slowest, 1.13 to 1.69 ms at every level), and the correct cells with think time (S1 and S4 at SER, 17.40 and 22.83 ms) are dominated by the 10 ms sleep, not by the concurrency control. | Table 3: at N = 100, S7 RR 5.99 ms vs S7 RC 12.10 ms; S3 SER 6.02 vs S3 RC 17.07. At N = 2, the values above. |

# 7. Conflict serializability in SQL: precedence graphs

## 7.1 The SQL

The edges are computed by a self-join of the schedule on *same run, same item, different transaction, earlier sequence number, at least one write*. The view below is the core of `analysis.sql` (lightly abridged). The scope `committed` is the textbook test (committed projection); the scope `all` also keeps aborted transactions, to show cycles that the DBMS broke.

```sql
CREATE VIEW exp.v_committed_txn AS
SELECT run_id, txn FROM exp.schedule_log WHERE op = 'c';

CREATE VIEW exp.v_precedence_edge_scoped AS
WITH ops AS (
    SELECT s.run_id, s.seq, s.txn, s.op, s.item,
           EXISTS (SELECT 1 FROM exp.v_committed_txn c
                   WHERE c.run_id = s.run_id AND c.txn = s.txn) AS committed
    FROM exp.schedule_log s
    WHERE s.op IN ('r', 'w')
), scopes(scope) AS (VALUES ('committed'), ('all'))
SELECT sc.scope, a.run_id, a.txn AS from_txn, b.txn AS to_txn,
       string_agg(DISTINCT format('%s%s(%s) < %s%s(%s)', a.op, substr(a.txn, 2),
                  a.item, b.op, substr(b.txn, 2), b.item), '; ') AS because
FROM scopes sc
JOIN ops a ON sc.scope = 'all' OR a.committed
JOIN ops b ON  b.run_id = a.run_id
           AND b.item   = a.item             -- same item
           AND b.txn   <> a.txn              -- different transactions
           AND b.seq    > a.seq              -- a precedes b
           AND (a.op = 'w' OR b.op = 'w')    -- at least one write
           AND (sc.scope = 'all' OR b.committed)
GROUP BY sc.scope, a.run_id, a.txn, b.txn;
```

**Cycle detection** walks every path with `WITH RECURSIVE`; a path that returns to its start is a cycle. A path may not revisit a node except to close the cycle, so the recursion terminates.

```sql
CREATE VIEW exp.v_precedence_cycle AS
WITH RECURSIVE walk (scope, run_id, start_txn, cur_txn, path, closed) AS (
    SELECT scope, run_id, from_txn, to_txn, ARRAY[from_txn, to_txn], from_txn = to_txn
    FROM exp.v_precedence_edge_scoped
  UNION ALL
    SELECT w.scope, w.run_id, w.start_txn, e.to_txn, w.path || e.to_txn,
           e.to_txn = w.start_txn
    FROM walk w
    JOIN exp.v_precedence_edge_scoped e
      ON e.scope = w.scope AND e.run_id = w.run_id AND e.from_txn = w.cur_txn
    WHERE NOT w.closed
      AND (e.to_txn = w.start_txn OR e.to_txn <> ALL (w.path))
)
SELECT DISTINCT ON (scope, run_id) scope, run_id, array_to_string(path, ' -> ') AS cycle
FROM walk WHERE closed
ORDER BY scope, run_id, cardinality(path), path;
```

**Serial order** for an acyclic graph: each committed transaction gets the length of the longest path that reaches it from a source (a node with no incoming edge); sorting by that level is a topological order.

```sql
CREATE VIEW exp.v_serial_order AS
WITH RECURSIVE lvl (run_id, txn, depth) AS (
    SELECT c.run_id, c.txn, 0
    FROM exp.v_committed_txn c
    WHERE NOT EXISTS (SELECT 1 FROM exp.v_precedence_edge e
                      WHERE e.run_id = c.run_id AND e.to_txn = c.txn)
  UNION ALL
    SELECT l.run_id, e.to_txn, l.depth + 1
    FROM lvl l JOIN exp.v_precedence_edge e
         ON e.run_id = l.run_id AND e.from_txn = l.txn
    WHERE l.depth < 16
), node AS (
    SELECT run_id, txn, max(depth) AS depth FROM lvl GROUP BY run_id, txn
)
SELECT run_id, string_agg(txn, ' -> ' ORDER BY depth, txn) AS serial_order
FROM node GROUP BY run_id;
```

The view `v_precedence_edge` used here is the `committed` scope of `v_precedence_edge_scoped`. A further view `exp.v_run_serializability` joins the three and prints, for every N = 2 run, the schedule, the edges, the verdict, the serial order or cycle, and whether a cycle existed only through a transaction the DBMS aborted.

## 7.2 Worked example 1: a cyclic schedule (S2 at REPEATABLE READ)

Run 88721 is the first trial of S2 at RR with N = 2. It ended at **5/4**. Its logical schedule, as stored, is (writing $M$ for `members:T02` and $t$ for `team:T02`):

$$r_2(t)\; r_2(M)\; r_1(t)\; r_1(M)\; w_2(M)\; c_2\; w_1(M)\; c_1$$

Both transactions committed, so both are nodes. All conflicting pairs, by hand:

| Item | Operations in order | Conflicting pairs (different txn, at least one write) | Edge |
|---|---|---|---|
| $t$ | $r_2(t)$, $r_1(t)$ | none (read-read) | - |
| $M$ | $r_2(M)$, $r_1(M)$, $w_2(M)$, $w_1(M)$ | $r_1(M) < w_2(M)$ | $T_1 \to T_2$ |
| | | $r_2(M) < w_1(M)$ | $T_2 \to T_1$ |
| | | $w_2(M) < w_1(M)$ | $T_2 \to T_1$ |

The graph has the cycle $T_1 \to T_2 \to T_1$, so the schedule is **not conflict serializable**. The SQL agrees (`analysis_output.txt`, section b3):

```
 run_id |   edge   |                               because
--------+----------+---------------------------------------------------------------------
  88721 | T1 -> T2 | r1(members:T02) < w2(members:T02)
  88721 | T2 -> T1 | r2(members:T02) < w1(members:T02); w2(members:T02) < w1(members:T02)
```

The verdict also has a plain meaning. In the serial order $T_1; T_2$, $T_2$ would have counted 4 members and been refused; in $T_2; T_1$, $T_1$ would have been refused. Both serial orders end at 4/4. The interleaved schedule ends at 5/4, which no serial order can produce. The cycle is the textbook shape of **write skew** (self-test case D below has the same edges).

## 7.3 Worked example 2: an acyclic schedule with a serial order

Every correct race commits exactly one transaction, so its graph is trivially acyclic. To show a non-trivial acyclic case, `analysis_selftest.sql` feeds hand-solved schedules through the same views. Case A has three committed transactions and one aborted one:

$$w_4(x)\; r_3(x)\; r_1(y)\; w_3(x)\; r_1(x)\; w_1(y)\; r_2(y)\; w_2(z)\; a_4\; c_3\; c_1\; c_2$$

**Committed projection.** $T_4$ aborted, so its operation $w_4(x)$ is removed:

$$r_3(x)\; r_1(y)\; w_3(x)\; r_1(x)\; w_1(y)\; r_2(y)\; w_2(z)$$

| Item | Operations in order | Conflicting pairs | Edge |
|---|---|---|---|
| $x$ | $r_3(x)$, $w_3(x)$, $r_1(x)$ | $w_3(x) < r_1(x)$ ($r_3$/$r_1$ is read-read) | $T_3 \to T_1$ |
| $y$ | $r_1(y)$, $w_1(y)$, $r_2(y)$ | $w_1(y) < r_2(y)$ ($r_1$/$r_2$ is read-read) | $T_1 \to T_2$ |
| $z$ | $w_2(z)$ | none | - |

The graph $T_3 \to T_1 \to T_2$ is acyclic, so the schedule **is conflict serializable**, and its only topological order gives the equivalent serial schedule

$$T_3;\ T_1;\ T_2 \;=\; r_3(x)\, w_3(x)\;\; r_1(y)\, r_1(x)\, w_1(y)\;\; r_2(y)\, w_2(z).$$

Check: every conflicting pair keeps its order ($w_3(x)$ before $r_1(x)$, $w_1(y)$ before $r_2(y)$). Including the aborted $T_4$ would add only $T_4 \to T_3$ and $T_4 \to T_1$, which is still acyclic.

**Self-test result** (`analysis_selftest_output.txt`; the whole test runs in a transaction that is rolled back):

| Case | Edges | Cycle (committed) | Serial order | Cycle incl. aborted | DBMS broke it | Result |
|---|---|---|---|---|---|---|
| A acyclic, 3 txns | T1→T2, T3→T1 | - | T3 → T1 → T2 | - | no | PASS |
| B 3-cycle | T1→T2, T2→T3, T3→T1 | T1 → T2 → T3 → T1 | - | same | no | PASS |
| C lost update | T1→T2, T2→T1 | T1 → T2 → T1 | - | same | no | PASS |
| D write skew | T1→T2, T2→T1 | T1 → T2 → T1 | - | same | no | PASS |
| E serial T2; T1 | T2→T1 | - | T2 → T1 | - | no | PASS |
| F broken by abort | (none) | - | T1 | T1 → T2 → T1 | **yes** | PASS |
| G RC re-read, refused | (none) | - | T2 | T1 → T2 → T1 | no | PASS |

![**Figure 6.** Three precedence graphs. (a) S2 at RR: both joiners committed and the graph has a cycle, so the schedule is not conflict serializable (5/4). (b) S1 at SER: the same cycle exists if the aborted transaction is kept, but SSI aborted $T_1$ with 40001, so the committed projection has one node (4/4). (c) Self-test case A: acyclic, serial order $T_3, T_1, T_2$. $M$ = `members:T02`.](diagrams/c10/c10_fig6_precedence.png){width=82%}

## 7.4 The cycle that SSI broke (S1 at SERIALIZABLE)

Run 80723 (S1, SER, trial 3) logged

$$r_1(t)\; r_1(M)\; r_2(t)\; r_2(M)\; w_1(M)\; w_2(M)\; a_1[40001]\; c_2$$

Both inserts executed, and the graph **including** the aborted transaction has the write-skew cycle ($T_1 \to T_2$ by $r_1(M) < w_2(M)$ and $w_1(M) < w_2(M)$; $T_2 \to T_1$ by $r_2(M) < w_1(M)$). SSI saw the two rw-antidependencies through its SIREAD lock on `team_member` and aborted $T_1$ when it tried to commit. The committed projection is the single node $T_2$: conflict serializable, final size 4/4. This is what Figure 6(b) draws.

## 7.5 Results over all 18,000 two-client races

**Table 4.** Conflict serializability of the N = 2 runs (logical, client-recorded schedule). CS = conflict serializable. "Broken by DBMS abort" = the cycle exists only with aborted transactions, and one of them was killed with 40001.

| Strategy | Isolation | Runs | CS | Not CS | Over-admitted | Verdict = outcome | Cycle only with aborted | Broken by DBMS abort |
|---|---|---|---|---|---|---|---|---|
| S1 | RC | 1000 | 0 | 1000 | 1000 | 1000 | 0 | 0 |
| S1 | RR | 1000 | 0 | 1000 | 1000 | 1000 | 0 | 0 |
| S1 | SER | 1000 | 1000 | 0 | 0 | 1000 | 753 | 753 |
| S2 | RC | 1000 | 1000 | 0 | 0 | 1000 | 0 | 0 |
| S2 | RR | 1000 | 0 | 1000 | 1000 | 1000 | 0 | 0 |
| S2 | SER | 1000 | 1000 | 0 | 0 | 1000 | 0 | 0 |
| S3 | RC, RR, SER | 3 × 1000 | 3000 | 0 | 0 | 3000 | 0 | 0 |
| S4 | RC | 1000 | 0 | 1000 | 1000 | 1000 | 0 | 0 |
| S4 | RR | 1000 | 0 | 1000 | 1000 | 1000 | 0 | 0 |
| S4 | SER | 1000 | 1000 | 0 | 0 | 1000 | 805 | 805 |
| S6 | RC | 1000 | 1000 | 0 | 0 | 1000 | 1000 | 0 |
| S6 | RR, SER | 2 × 1000 | 2000 | 0 | 0 | 2000 | 0 | 0 |
| S7 | RC, RR, SER | 3 × 1000 | 3000 | 0 | 0 | 3000 | 0 | 0 |

So a cycle appears in exactly the 5,000 races that over-admitted, and in none of the 13,000 that did not. **This is a consistency check of the model, not independent evidence** (Section 10.1): a correct race commits one transaction, so its graph cannot have a cycle, and two committed joiners both read the member set before the other's insert, so their graph must have one. The informative columns are the last two:

* For S1 and S4 at SER, the cycle existed in 753 and 805 of 1000 runs when aborted transactions are kept, and every time a transaction on the cycle had been killed with 40001: SSI broke it. In the other runs SSI raised 40001 on the loser's `INSERT`, before its write took effect, so no cycle formed.
* For S6 at RC, the loser is on a cycle in all 1000 runs, but no DBMS abort was involved. It read the seat set once before and once after the winner's commit (a non-repeatable read, which RC allows), wrote nothing, and rolled back on its own after "no free seat". Self-test case G is this shape.

Modelling the member set as one item adds $w$–$w$ edges between two inserts of different rows. That is conservative and changes no verdict: every cycle in the data also exists with $r$–$w$ and $w$–$r$ edges alone (checked over all 18,000 runs).

# 8. Live lock-graph demo

The precedence graph is a model. PostgreSQL's real state is visible in `pg_locks`. `demo_locks.sh S RC|RR|SER` starts three psql sessions: `race-A` joins T02 and holds its transaction open for 4 s; `race-B` and `race-C` try to join 0.7 s and 1.0 s later. While they wait, `live_locks.sql` prints the wait-for graph, the lock table and any SIREAD locks.

## 8.1 The query

```sql
-- 1. Wait-for graph: one row per edge "waiter waits for blocker"
SELECT w.application_name AS waiter, w.pid AS waiter_pid,
       b.application_name AS blocker, b.pid AS blocker_pid,
       w.wait_event_type || ':' || w.wait_event AS waiter_wait_event,
       wl.locktype || ' ' || wl.mode
         || coalesce(' on ' || wl.relation::regclass::text, '')
         || coalesce(' xid ' || wl.transactionid::text, '')
         || coalesce(' (page ' || wl.page || ', tuple ' || wl.tuple || ')', '')
         AS waiter_wants
FROM pg_stat_activity w
CROSS JOIN LATERAL unnest(pg_blocking_pids(w.pid)) AS bp(pid)
JOIN pg_stat_activity b ON b.pid = bp.pid
LEFT JOIN pg_locks wl ON wl.pid = w.pid AND NOT wl.granted
WHERE w.datname = current_database()
ORDER BY w.query_start, w.pid, b.pid;

-- 2. Lock table of the racing sessions: pg_locks JOIN pg_stat_activity, filtered to
--    relation, tuple and transactionid locks on team, team_member and the exp tables.
-- 3. Predicate locks: rows of pg_locks with mode = 'SIReadLock'.
```

## 8.2 S2 at READ COMMITTED: a queue, not a crowd

Output of `demo_locks.sh S2 RC` (`results/demo_locks_S2_RC.txt`; columns shortened):

```
 waiter | blocker | waiter_wait_event  | waiter_wants
--------+---------+--------------------+-------------------------------------------------
 race-B | race-A  | Lock:transactionid | transactionid ShareLock xid 2314849
 race-C | race-B  | Lock:tuple         | tuple AccessExclusiveLock on team (page 29, tuple 107)

 session |   locktype    |  relation   | page_tuple |   xid   |        mode         | granted
---------+---------------+-------------+------------+---------+---------------------+--------
 race-A  | relation      | team        |            |         | RowShareLock        | t
 race-A  | relation      | team_member |            |         | RowExclusiveLock    | t
 race-A  | transactionid |             |            | 2314849 | ExclusiveLock       | t
 race-B  | tuple         | team        | 29/107     |         | AccessExclusiveLock | t
 race-B  | transactionid |             |            | 2314849 | ShareLock           | f
 race-C  | tuple         | team        | 29/107     |         | AccessExclusiveLock | f
...
  [race-B] ERROR:  Team T02 is full (4 / 4)
  [race-C] ERROR:  Team T02 is full (4 / 4)
T02 after the race: 4/4  (1RV99XX001 admitted)
```

![**Figure 7.** The wait-for graph of Section 8.2, drawn. Only the first waiter waits on the lock holder; the others queue behind it on a tuple lock.](diagrams/c10/c10_fig7_waitfor.png){width=80%}

How to read it, in Unit IV terms:

* **Row locks are not rows of the lock table.** `race-A`'s `FOR UPDATE` lock on the team row is stored in the row header (`xmax`), so it does not appear in `pg_locks`. What appears is `race-A`'s `ExclusiveLock` on its own transaction id.
* **The first waiter waits for the transaction, not the row.** `race-B` requests a `ShareLock` on `race-A`'s transaction id, which means "wait until A commits or aborts". This is how PostgreSQL implements "a row lock is held until the end of the transaction".
* **Later waiters queue on a tuple lock.** `race-B` holds the heavyweight `tuple` lock on (29,107), so `race-C` waits for `race-B`, not for `race-A`. The tuple lock mode shows the row-lock strength requested: `AccessExclusiveLock` for `SELECT … FOR UPDATE` (S2) and `ExclusiveLock` for the `FOR NO KEY UPDATE` lock that a non-key `UPDATE` takes (S7, S3).
* **The wait-for graph has no cycle**, so there is no deadlock; PostgreSQL's deadlock detector looks for a cycle in this wait-for graph.

## 8.3 The same lock picture, three different endings

| Demo (output file) | Lock picture | Ending |
|---|---|---|
| S2, RC (`demo_locks_S2_RC.txt`) | B waits on A's xid, C on B's tuple lock | B and C refused "Team T02 is full (4 / 4)": the `COUNT` after the lock is a new statement with a new snapshot. **4/4** |
| S2, RR (`demo_locks_S2_RR.txt`) | **identical** to RC | B and C finish without error. Their snapshot predates A's commit and A only locked the row. **6/4** |
| S7, RR (`demo_locks_S7_RR.txt`) | same shape (tuple lock mode `ExclusiveLock`) | B and C: `could not serialize access due to concurrent update`, in the v2 trigger's `UPDATE`. **4/4** |
| S3, RC (`demo_locks_S3_RC.txt`) | queue on the counter row | B and C: their `UPDATE … WHERE member_count < max_size` re-checks the new version and matches nothing. **4/4** |

The S2 rows show that the lock table alone cannot tell a correct run from an incorrect one: the locks are the same; the snapshot rule is what differs.

## 8.4 S1 at SERIALIZABLE: predicate locks that do not block

In `demo_locks_S1_SER.txt` nobody waits (the wait-for graph is empty), but section 3 of the output shows `race-A`'s **SIREAD** locks: a tuple lock on the team row, a page lock on `team_pkey`, and a **relation-level** SIREAD lock on `team_member`. The table is tiny, so the `COUNT` is a sequential scan and SSI records the whole relation as read; this is how it notices the "phantom" insert of the other session. `race-B` inserted and committed first; `race-A`'s commit then failed:

```
ERROR:  could not serialize access due to read/write dependencies among transactions
DETAIL:  Reason code: Canceled on identification as a pivot, during commit attempt.
HINT:  The transaction might succeed if retried.
T02 after the race: 4/4  (1RV99XX002 admitted)
```

# 9. Discussion

## 9.1 Why S2 fails only at REPEATABLE READ

The same two transactions, step by step (as in the day-1 check `rr_trigger_check.sh` and the demo):

| Step | $T_A$ | $T_B$ at READ COMMITTED | $T_B$ at REPEATABLE READ |
|---|---|---|---|
| 1 | `INSERT`: trigger locks team T02 `FOR UPDATE`, counts 3, inserts | | |
| 2 | (open) | `INSERT` starts: statement snapshot (sees 3) | `INSERT` starts: **transaction snapshot** taken now (sees 3) |
| 3 | | trigger: `SELECT … FOR UPDATE` **waits** for $T_A$ | trigger: `SELECT … FOR UPDATE` **waits** for $T_A$ |
| 4 | `COMMIT` (4/4) | | |
| 5 | | lock granted. The row was only locked, never changed. | lock granted. The row was only locked, never changed: **no 40001** |
| 6 | | `COUNT(*)` is a new statement: **new snapshot**, sees 4: refused | `COUNT(*)` uses the snapshot of step 2: **sees 3**, inserts |
| 7 | | rolled back. **4/4** | commits. **5/4** |

* At **RC** step 6 takes a fresh snapshot, which includes $T_A$'s commit. The surrogate-row lock forced the order, and the fresh read made it count.
* At **SER** SSI has recorded that $T_B$ read the member set (SIREAD lock) and that $T_A$ inserted into it, and the other way round. It aborts $T_B$ with 40001 (Table 2: 137,866 such aborts).
* At **RR** neither rescue applies. The snapshot is from step 2, and first-updater-wins only fires on a row that was *modified*. The lock serialized the transactions in time but not in what they *saw*.

Replacing `SELECT … FOR UPDATE` by `UPDATE team SET max_size = max_size` (S7) changes step 5 at RR into "the row was modified after my snapshot: 40001". At RC it changes nothing, because the `COUNT` still runs afterwards with a new snapshot. That is the entire difference between the fixture trigger and the product trigger.

S2 at RR is also **timing dependent**. 11 of 142,000 RR racers were refused correctly, because their first statement ran late enough that the winner had already committed, so their snapshot included it. Below SERIALIZABLE, whether a rule holds can depend on when each snapshot happened to be taken.

## 9.2 Why the declarative design wins

S3, S6 and S7 are all correct at every level, but S6 is correct for a different and stronger reason.

* **It does not depend on snapshots.** Two joiners that pick the same free seat collide on the primary key `(team_id, seat_no)`. A unique index checks the *physical* index, including uncommitted entries of other transactions, not a snapshot: the second inserter waits for the first and then either sees the conflict (RC: `DO NOTHING`, re-read, no free seat) or, at RR/SER, gets 40001 because the conflicting row is invisible to its snapshot.
* **It cannot be bypassed.** S2, S3 and S7 are correct only if every writer goes through the trigger or the conditional `UPDATE`. A trigger can be disabled, and the S3 counter can drift if someone inserts a member without touching it. In S6, while the deferred foreign key `team_member_needs_seat` exists, **no** client can commit a member without holding one of the `max_size` seat keys (checked: a seatless `INSERT` fails at `COMMIT` with the FK violation). Only someone with DDL rights can remove the constraint.
* **It turns a cross-row invariant into single-row constraints.** "COUNT ≤ 4" is a property of a set; "seat $k$ has at most one holder" and "a seat number is in 1..4" are properties of single keys. This is the same move as normalization (Component 6): put each fact where a key can guard it.
* **Its cost is competitive.** At N = 100, S6's p95 is 8.2 ms at RC (the best of the RC designs), 7.3 ms at RR and 6.9 ms at SER (Table 3).

The price is schema: a slot table that must follow `team.max_size` (here generated once at load time; a production version needs a trigger or a rule that `max_size` changes go through a function), and a seat number with no business meaning. Section 12 explains why the product nevertheless uses S7.

## 9.3 The cost of SERIALIZABLE

SERIALIZABLE alone fixed all six strategies, including the naive one: 0 of 24,000 SER races over-admitted, and exactly one racer was admitted in every race. Its costs are of three kinds.

1. **Aborts instead of answers.** Without a retry loop (S1 at SER) the 99 losers of a 100-way race receive 40001 "could not serialize access", not "team is full". The application must turn that into a retry. With a retry loop (S4) every loser needed at least one retry (238 of 138,000 needed two) and then received the clean refusal.
2. **Latency of the retry.** S4 at SER costs about +5.4 ms p95 at N = 2 and +6.3 ms at N = 100 compared with S1 at SER (Table 3), the price of one abort, a back-off and a second transaction.
3. **Bookkeeping, which here was small.** For the designs that are already correct, SER was not slower than RR: at N = 100, S7 6.29 vs 5.99 ms, S3 6.02 vs 6.92 ms, S6 6.94 vs 7.34 ms. On this workload the SIREAD tracking is lost in the noise. SSI can also abort transactions that were in fact serializable (false positives), and it never produced a race in which *every* racer was aborted, although that is an observation, not a guarantee.

The general lesson: **a retry loop is only useful together with SSI.** S4 at RC and RR is indistinguishable from S1 (100% over-admission, 0 retries), because nothing ever raises 40001 there.

## 9.4 Lock queues versus aborts

At RC every correct design forms a queue on one row. Each loser holds the row lock until its own `ROLLBACK`, so 99 losers leave the queue one at a time; the p95 grows with N (12.1 ms for S2 and S7, 17.1 ms for S3 at N = 100). At RR and SER the losers fail as soon as the winner commits, and the p95 stays near 6 ms. One observation is **not explained**: S3 at RC has the worst p95 of the correct designs (17 ms; 19 ms in the first full run). It was verified that an RC loser whose EvalPlanQual re-check matched nothing still holds the row lock until it rolls back (a third session's `FOR UPDATE NOWAIT` fails meanwhile), but that holds for S2 and S7 too and cannot account for a 5 ms gap. Finding the cause would need profiling.

# 10. Threats to validity

## 10.1 The logical schedule is a model, not PostgreSQL's execution

PostgreSQL never executes a single interleaving of reads and writes over single-version items. It keeps row versions, locks individual rows, and at SER tracks rw-antidependencies. `exp.schedule_log` is a **client-recorded** model with an explicit placement rule for reads (Section 4.5). Consequences:

* **H5 is close to true by construction.** A correct race commits one transaction, so its committed graph has one node; two committed joiners both read the member set before the other's insert, so their graph has a cycle. The graph does not detect anything that the final team size does not already show. What it adds is the textbook explanation of *which* conflicts form the cycle, and (through the "including aborted" scope) a view of the cycles SSI broke. The SQL itself is validated separately on hand-solved schedules (Section 7.3), because the real data never produces a non-trivial acyclic graph or a cycle longer than two.
* **The placement of reads is a modelling choice.** It follows the documented snapshot rules (RC per statement, RR/SER per transaction, EvalPlanQual re-reads, and the exception that S6's `INSERT … SELECT … ON CONFLICT` keeps its statement snapshot). A different rule could change individual edges.
* **Aborted statements are not logged.** The client cannot tell how far a failed statement got, so the reads of a transaction killed during its `INSERT` are missing. The "cycle including aborted" counts are therefore lower bounds.
* **The member set is one item.** This adds $w$–$w$ edges between inserts of different rows; Section 7.5 shows no verdict depends on it.
* The internal truth is checked separately, through `pg_locks` and the SIREAD locks (Section 8).

## 10.2 One machine, local Docker

* Client and server share one machine and Docker Desktop's Linux VM. Latencies are **relative** costs between designs, not production numbers.
* The live product runs on Supabase (PostgreSQL 17.11, ap-south-1) behind a connection pooler and a network round trip. That changes timing, not semantics: the correctness results depend only on PostgreSQL's snapshot and locking rules, which are the same in 17.11 everywhere. The product's capacity v2 rule was also checked on the local Supabase stack (the same Supabase PostgreSQL 17 image as the cloud project) with a pair race and a burst of 8 (Section 12.1).
* The barrier is **harsher than real users**: all racers start within about 0.1 to 1.5 ms. That is why the incorrect designs fail in 100% of races. Real users would collide less often, so the *rate* of over-admission in production would be lower; the *possibility* is what the experiment establishes, and a rule that can fail once in a semester is still wrong.
* At N = 100, 100 backends share 15 cores. Some racers therefore take their snapshot after the winner has committed and are refused rather than aborted (Table 2: S7 at SER refused 659 losers). This explains the small "refused" counts at RR and SER.
* S1 and S4 sleep 10 ms between check and insert to widen the window; their latencies include it.
* Server settings are defaults (except `max_connections`); the target is a single hot row, the worst case for lock queues.

## 10.3 Other limits

* **One team, one rule.** The experiment does not measure throughput across many teams, where the queues would not form.
* **S6 slot table is static.** It is generated from `max_size` at load time.
* **Error classification** relies on SQLSTATE and, for the two trigger refusals (P0001, 23514), on the text "is full". A different error would be counted as `error`, of which there were none.
* **Repeatability.** The full matrix was run twice (the reported run is the verification re-run, after three corrections to the schedule logger). Over-admission rates and worst sizes were identical in all 72 cells; timing-dependent counts (late refusals, retries, latencies, within about 15%) moved.

# 11. Conclusion

1. The fixture's lock-then-check trigger (Q35) is **correct by itself only at READ COMMITTED**; at SERIALIZABLE it is SSI that aborts the second joiner. At REPEATABLE READ it over-admitted in 1000 of 1000 races at every N, up to 103/4, because a waiter's snapshot predates the lock wait and a lock-only conflict raises no serialization error.
2. **A lock is not a write.** Rules that are safe at every isolation level turn the conflict into a write on one row (S3 counter, S7 no-op `UPDATE` of the parent) or into a key collision (S6 seats). Then RC waiters re-check the newest version and RR/SER waiters get 40001.
3. **Declarative beats procedural** for safety: S6's primary and foreign keys are independent of snapshots and cannot be bypassed by a client, at a latency comparable to the best procedural design.
4. **SERIALIZABLE (SSI) fixes even the naive design**, but it moves work to the client: every loser gets 40001 and needs a retry loop, which costs about 5 to 6 ms p95 here. A retry loop below SERIALIZABLE does nothing.
5. The **precedence-graph test runs inside PostgreSQL** with a self-join and a recursive CTE, gives the textbook verdict for every two-client race, and agrees with hand-solved schedules. On the race data it is a consistency check of the model, not independent evidence.
6. `pg_locks` and `pg_blocking_pids()` show PostgreSQL's real mechanism: a queue on a transaction id and a tuple lock at RC, and non-blocking SIREAD predicate locks at SER.

# 12. How the product applies the result

## 12.1 Capacity v2 (migration 0002)

The product does not use the fixture trigger. `private.enforce_team_capacity_v2()` in `supabase/migrations/20261104000002_app_core.sql` is S7: it **writes** the team row (`UPDATE public.team SET max_size = max_size … RETURNING max_size`) and only then counts, and it fires on `INSERT OR UPDATE OF team_id`, so moving between teams cannot bypass it. It raises SQLSTATE 23514 with `CONSTRAINT = 'team_capacity'` and `DETAIL = 'team_capacity'`, which the web app maps to a field message.

It was checked on the local Supabase stack with `capacity_v2_check.sh` (FINDINGS, second section):

| Isolation level | Pair race for T02 | Burst of 8 for T06 |
|---|---|---|
| READ COMMITTED | 4/4: B refused, 23514 | 4/4: 1 admitted, 7 refused |
| REPEATABLE READ | 4/4: B aborted, 40001 | 4/4: 1 admitted, 7 × 40001 |
| SERIALIZABLE | 4/4: B aborted, 40001 | 4/4: 1 admitted, 7 × 40001 |

The control run on the same stack, with v2 disabled and the Q35 trigger created instead, over-admitted at RR (pair 5/4, burst **11/4**), which shows that the check can detect the failure and that v2 is what prevents it. The pgTAP suite asserts the rule (Team Alpha full, moving into a full team via `UPDATE` refused, `join_team('T01')` returns `23514:team_capacity`).

A read-only check of the live project (`countersign-dbms`, PostgreSQL 17.11) confirms that `trg_team_capacity_v2` and `trg_team_one_per_project` are installed, that the Q35 trigger is not, and that the database default is `read committed` with no role-level override. The product therefore runs at the level where even Q35 would have been correct, but v2 stays correct if a session, a future RPC or a reporting job raises the level to REPEATABLE READ.

Why S7 rather than S6 in the product: S7 needs no extra table and keeps the graded fixture's `team_member` unchanged; it does not need a slot table that follows `max_size`; and it is correct at every level with the best measured p95 at RR. S6 is kept in the report as the declarative comparison.

## 12.2 The same idea for other cross-row rules

| Rule (migration 0002) | Write skew it prevents | "Serialize by writing" |
|---|---|---|
| One team per project per student (`enforce_one_team_per_project`) | Two concurrent joins by one student into two teams of the same project | `UPDATE public.student SET usn = usn WHERE usn = NEW.usn` |
| Membership required for recorded work (`assert_team_member`) | One transaction records a mark for X while another removes X's membership because X "has no work" | `UPDATE public.team_member SET role = role WHERE …` |
| First member becomes team lead (`member_role_for_caller`, 0003) | Two first joiners both become lead | Runs after the v2 trigger, which already write-locked the team row |
| Countersign of a claim (`countersign.claim_revision`) | A teammate confirms text that was edited after they read it | Optimistic concurrency control: the countersign carries the revision the signer read; a stale revision is refused |

The membership rule was tested the same way (`membership_skew_check.sh`, FINDINGS, last section). With the write-lock, every interleaving is refused at RC and aborted with 40001 at RR/SER. In the control, where the check only took `FOR KEY SHARE`, REPEATABLE READ **committed a mark for a non-member**: the same lesson for a different invariant.

## 12.3 The client side of 40001

Because REPEATABLE READ and SERIALIZABLE answer with 40001 instead of blocking, the web client treats 40001 and 40P01 as a separate error kind, `serialization` ("Someone else changed this at the same moment. Please try again."). `web/src/lib/query.ts` retries a mutation automatically up to two times on that kind only; permission and rule errors are never retried. This is the S4 contract, applied where it is useful.

## 12.4 The Race arena page, and deviations from the midterm plan

The midterm report (C7 §11 and the week-3 row of C7 §12) listed three things as remaining for Component 10. Their state on 19 November 2026:

| Promised in C7 | State | Notes |
|---|---|---|
| The C10 experiment report | Done | This document. |
| A "Race Arena" page in the web client that runs a small race live | **Built** | The page `/race` (sidebar **Race arena**, open to every signed-in user) replays the recorded results: the 72-cell over-admission matrix of the 72,000 races, the p95 latency per strategy, one card per strategy with its SQL, and the two worked precedence graphs of Section 7. Its **Run a live race** panel calls `POST /race/run` (faculty and admins only; a student sees the page but not the button), which runs **one** race (strategy, isolation level, N from 2 to 100) in the throwaway container `elp-race-pg` with the harness's own code (`api/app/race.py` imports `harness.py`), never in the product database. A live race writes nothing to `exp.experiment_run`, `exp.experiment_attempt` or `exp.schedule_log`, so it cannot change the reported results; for N = 2 the panel draws that race's precedence graph. One race runs at a time: a second request, or a harness run in progress, gets 409 `race_busy`, and only the request that owns the lab puts T02 back to 3/4 and restores strategy S1 afterwards, so a refused request never resets someone else's race. If the container is down the panel answers 503 `race_lab_offline` with the command that starts it. The page shows the precedence graph, not PostgreSQL's wait-for graph: the live lock table of Section 8 is still printed in the terminal by `experiments/race/demo_locks.sh`. Tests: e2e spec 11 (5 tests) and the API tests of `api/tests/test_race.py`. |
| An EXPLAIN before/after comparison for an index on the bench data | **Not done** | Dropped to finish the 72-cell matrix and the precedence-graph analysis, which answer the experiment's question (correctness under concurrency); an index does not change whether a capacity rule over-admits. It remains future work (C11 §8.4). |

The experiment is run from the scripts in Section 13.

# 13. Reproduction

Requirements: Docker, `uv` (Python 3.12). All commands run from the repository root and touch only the throwaway container `elp-race-pg` (port 55433). No Supabase or Atlas credentials are used.

```bash
# 1. container + database "race": fixture 01 + 02 + Q35 (read, not copied) + schema.sql
experiments/race/setup.sh                        # ~5 s; DROPS old results in database "race"

# 2. the matrix (30 trials per cell ~30 s; the reported run used 1000, ~14 min)
uv run --python 3.12 --with asyncpg experiments/race/harness.py --fresh
uv run --python 3.12 --with asyncpg experiments/race/harness.py --fresh --trials 1000

# 3. analysis: per-cell summary, precedence graphs, cycles, serial orders
docker exec -i elp-race-pg psql -U postgres -d race -X < experiments/race/analysis.sql \
  > experiments/race/results/analysis_output.txt
# 4. self-test of the graph SQL on hand-solved schedules (all PASS; rolled back)
docker exec -i elp-race-pg psql -U postgres -d race -X < experiments/race/analysis_selftest.sql

# 5. CSVs, the three charts and results/results.md
uv run --python 3.12 --with asyncpg --with matplotlib experiments/race/report.py

# 6. live lock graph (strategy S1|S2|S3|S7, level RC|RR|SER)
experiments/race/demo_locks.sh S2 RC
experiments/race/demo_locks.sh S2 RR
experiments/race/demo_locks.sh S7 RR
experiments/race/demo_locks.sh S1 SER

# clean up
docker rm -f elp-race-pg
```

Useful harness flags: `--trials`, `--strategies S1,S2,…`, `--isolations RC,RR,SER`, `--ns 2,8,32,100`, `--fresh`. To reproduce without touching the reported data, load a second database (`RACE_DB=race_verify experiments/race/setup.sh`) and point the harness at it with `RACE_DSN=postgresql://postgres:localdev@localhost:55433/race_verify`. This document is rebuilt with `docs/lab/build_c10.sh`.

# Appendix A. Full matrix (72 cells, 1000 trials each)

`over` = share of races above 4/4; `adm` = mean admitted per race (1 is correct); `40001` = mean serialization failures per race (S4 counts every retried one); `ref` = mean refused; `retr` = mean retries per attempt; latency per attempt in ms.

```{=latex}
\smalltablestrue
```

| Strategy | Iso | N | over | worst | adm | 40001 | ref | retr | p50 | p95 |
|---|---|---|---|---|---|---|---|---|---|---|
| S1 | RC | 2 | 100% | 5/4 | 2.00 | 0.00 | 0.00 | 0.00 | 13.34 | 17.42 |
| S1 | RC | 8 | 100% | 11/4 | 8.00 | 0.00 | 0.00 | 0.00 | 13.50 | 17.09 |
| S1 | RC | 32 | 100% | 35/4 | 32.00 | 0.00 | 0.00 | 0.00 | 14.60 | 17.01 |
| S1 | RC | 100 | 100% | 103/4 | 100.00 | 0.00 | 0.00 | 0.00 | 18.13 | 20.43 |
| S1 | RR | 2 | 100% | 5/4 | 2.00 | 0.00 | 0.00 | 0.00 | 13.43 | 17.61 |
| S1 | RR | 8 | 100% | 11/4 | 8.00 | 0.00 | 0.00 | 0.00 | 13.43 | 17.29 |
| S1 | RR | 32 | 100% | 35/4 | 32.00 | 0.00 | 0.00 | 0.00 | 14.47 | 17.02 |
| S1 | RR | 100 | 100% | 103/4 | 100.00 | 0.00 | 0.00 | 0.00 | 18.15 | 20.44 |
| S1 | SER | 2 | 0% | 4/4 | 1.00 | 1.00 | 0.00 | 0.00 | 13.11 | 17.40 |
| S1 | SER | 8 | 0% | 4/4 | 1.00 | 7.00 | 0.00 | 0.00 | 13.40 | 17.07 |
| S1 | SER | 32 | 0% | 4/4 | 1.00 | 31.00 | 0.00 | 0.00 | 15.07 | 16.55 |
| S1 | SER | 100 | 0% | 4/4 | 1.00 | 99.00 | 0.00 | 0.00 | 21.78 | 25.61 |
| S2 | RC | 2 | 0% | 4/4 | 1.00 | 0.00 | 1.00 | 0.00 | 0.52 | 0.71 |
| S2 | RC | 8 | 0% | 4/4 | 1.00 | 0.00 | 7.00 | 0.00 | 1.03 | 1.47 |
| S2 | RC | 32 | 0% | 4/4 | 1.00 | 0.00 | 31.00 | 0.00 | 2.36 | 3.70 |
| S2 | RC | 100 | 0% | 4/4 | 1.00 | 0.00 | 99.00 | 0.00 | 7.12 | 12.08 |
| S2 | RR | 2 | 100% | 5/4 | 2.00 | 0.00 | 0.00 | 0.00 | 0.48 | 0.71 |
| S2 | RR | 8 | 100% | 11/4 | 8.00 | 0.00 | 0.00 | 0.00 | 1.16 | 2.08 |
| S2 | RR | 32 | 100% | 35/4 | 32.00 | 0.00 | 0.00 | 0.00 | 4.37 | 8.09 |
| S2 | RR | 100 | 100% | 103/4 | 99.99 | 0.00 | 0.01 | 0.00 | 14.55 | 28.98 |
| S2 | SER | 2 | 0% | 4/4 | 1.00 | 1.00 | 0.00 | 0.00 | 0.52 | 0.75 |
| S2 | SER | 8 | 0% | 4/4 | 1.00 | 7.00 | 0.00 | 0.00 | 1.11 | 1.74 |
| S2 | SER | 32 | 0% | 4/4 | 1.00 | 30.96 | 0.04 | 0.00 | 2.57 | 4.14 |
| S2 | SER | 100 | 0% | 4/4 | 1.00 | 98.91 | 0.09 | 0.00 | 7.28 | 12.21 |
| S3 | RC | 2 | 0% | 4/4 | 1.00 | 0.00 | 1.00 | 0.00 | 0.59 | 0.84 |
| S3 | RC | 8 | 0% | 4/4 | 1.00 | 0.00 | 7.00 | 0.00 | 1.12 | 1.91 |
| S3 | RC | 32 | 0% | 4/4 | 1.00 | 0.00 | 31.00 | 0.00 | 3.47 | 6.45 |
| S3 | RC | 100 | 0% | 4/4 | 1.00 | 0.00 | 99.00 | 0.00 | 9.72 | 17.07 |
| S3 | RR | 2 | 0% | 4/4 | 1.00 | 1.00 | 0.00 | 0.00 | 0.63 | 0.91 |
| S3 | RR | 8 | 0% | 4/4 | 1.00 | 7.00 | 0.00 | 0.00 | 1.02 | 1.37 |
| S3 | RR | 32 | 0% | 4/4 | 1.00 | 31.00 | 0.00 | 0.00 | 2.06 | 2.64 |
| S3 | RR | 100 | 0% | 4/4 | 1.00 | 98.98 | 0.02 | 0.00 | 4.88 | 6.92 |
| S3 | SER | 2 | 0% | 4/4 | 1.00 | 1.00 | 0.00 | 0.00 | 0.64 | 0.96 |
| S3 | SER | 8 | 0% | 4/4 | 1.00 | 7.00 | 0.00 | 0.00 | 1.06 | 1.59 |
| S3 | SER | 32 | 0% | 4/4 | 1.00 | 31.00 | 0.00 | 0.00 | 2.01 | 2.62 |
| S3 | SER | 100 | 0% | 4/4 | 1.00 | 98.92 | 0.08 | 0.00 | 4.57 | 6.02 |
| S4 | RC | 2 | 100% | 5/4 | 2.00 | 0.00 | 0.00 | 0.00 | 13.18 | 17.28 |
| S4 | RC | 8 | 100% | 11/4 | 8.00 | 0.00 | 0.00 | 0.00 | 13.31 | 16.75 |
| S4 | RC | 32 | 100% | 35/4 | 32.00 | 0.00 | 0.00 | 0.00 | 14.36 | 16.60 |
| S4 | RC | 100 | 100% | 103/4 | 100.00 | 0.00 | 0.00 | 0.00 | 17.93 | 20.30 |
| S4 | RR | 2 | 100% | 5/4 | 2.00 | 0.00 | 0.00 | 0.00 | 12.89 | 17.17 |
| S4 | RR | 8 | 100% | 11/4 | 8.00 | 0.00 | 0.00 | 0.00 | 13.31 | 16.54 |
| S4 | RR | 32 | 100% | 35/4 | 32.00 | 0.00 | 0.00 | 0.00 | 14.32 | 16.53 |
| S4 | RR | 100 | 100% | 103/4 | 100.00 | 0.00 | 0.00 | 0.00 | 17.92 | 20.21 |
| S4 | SER | 2 | 0% | 4/4 | 1.00 | 1.00 | 1.00 | 0.50 | 16.75 | 22.83 |
| S4 | SER | 8 | 0% | 4/4 | 1.00 | 7.00 | 7.00 | 0.88 | 16.94 | 20.44 |
| S4 | SER | 32 | 0% | 4/4 | 1.00 | 31.02 | 31.00 | 0.97 | 18.58 | 21.10 |
| S4 | SER | 100 | 0% | 4/4 | 1.00 | 99.22 | 99.00 | 0.99 | 27.29 | 31.87 |
| S6 | RC | 2 | 0% | 4/4 | 1.00 | 0.00 | 1.00 | 0.00 | 0.82 | 1.69 |
| S6 | RC | 8 | 0% | 4/4 | 1.00 | 0.00 | 7.00 | 0.00 | 1.34 | 1.93 |
| S6 | RC | 32 | 0% | 4/4 | 1.00 | 0.00 | 31.00 | 0.00 | 2.57 | 3.38 |
| S6 | RC | 100 | 0% | 4/4 | 1.00 | 0.00 | 99.00 | 0.00 | 6.47 | 8.23 |
| S6 | RR | 2 | 0% | 4/4 | 1.00 | 1.00 | 0.00 | 0.00 | 0.88 | 1.43 |
| S6 | RR | 8 | 0% | 4/4 | 1.00 | 7.00 | 0.00 | 0.00 | 1.22 | 1.68 |
| S6 | RR | 32 | 0% | 4/4 | 1.00 | 30.88 | 0.12 | 0.00 | 2.50 | 4.00 |
| S6 | RR | 100 | 0% | 4/4 | 1.00 | 98.88 | 0.12 | 0.00 | 5.50 | 7.34 |
| S6 | SER | 2 | 0% | 4/4 | 1.00 | 1.00 | 0.00 | 0.00 | 0.70 | 1.13 |
| S6 | SER | 8 | 0% | 4/4 | 1.00 | 7.00 | 0.00 | 0.00 | 1.12 | 1.96 |
| S6 | SER | 32 | 0% | 4/4 | 1.00 | 30.97 | 0.03 | 0.00 | 2.32 | 3.20 |
| S6 | SER | 100 | 0% | 4/4 | 1.00 | 98.99 | 0.01 | 0.00 | 5.36 | 6.94 |
| S7 | RC | 2 | 0% | 4/4 | 1.00 | 0.00 | 1.00 | 0.00 | 0.53 | 0.81 |
| S7 | RC | 8 | 0% | 4/4 | 1.00 | 0.00 | 7.00 | 0.00 | 1.06 | 1.46 |
| S7 | RC | 32 | 0% | 4/4 | 1.00 | 0.00 | 31.00 | 0.00 | 2.62 | 4.30 |
| S7 | RC | 100 | 0% | 4/4 | 1.00 | 0.00 | 99.00 | 0.00 | 6.71 | 12.10 |
| S7 | RR | 2 | 0% | 4/4 | 1.00 | 1.00 | 0.00 | 0.00 | 0.53 | 0.83 |
| S7 | RR | 8 | 0% | 4/4 | 1.00 | 7.00 | 0.00 | 0.00 | 0.91 | 1.18 |
| S7 | RR | 32 | 0% | 4/4 | 1.00 | 31.00 | 0.01 | 0.00 | 1.89 | 2.40 |
| S7 | RR | 100 | 0% | 4/4 | 1.00 | 98.99 | 0.01 | 0.00 | 4.62 | 5.99 |
| S7 | SER | 2 | 0% | 4/4 | 1.00 | 1.00 | 0.00 | 0.00 | 0.53 | 0.71 |
| S7 | SER | 8 | 0% | 4/4 | 1.00 | 7.00 | 0.00 | 0.00 | 0.92 | 1.22 |
| S7 | SER | 32 | 0% | 4/4 | 1.00 | 30.96 | 0.04 | 0.00 | 1.95 | 2.64 |
| S7 | SER | 100 | 0% | 4/4 | 1.00 | 98.38 | 0.62 | 0.00 | 4.61 | 6.29 |

```{=latex}
\smalltablesfalse
```

# Appendix B. Example logical schedules (first trial of each N = 2 cell)

`a1[40001]` = $T_1$ aborted by the DBMS; `a1[refused]` = $T_1$ rolled back after "team is full". Items: `team` = `team:T02`, `M` = `members:T02`, `ctr` = `counter:T02`, `seats` = `seats:T02`.

| Strategy | Iso | Size | Logical schedule | Verdict (committed projection) |
|------|-----|-----|----------------------------------------------|----------------------|
| S1 | RC | 5/4 | r2(team) r2(M) r1(team) r1(M) w1(M) c1 w2(M) c2 | cycle T1 → T2 → T1 |
| S1 | RR | 5/4 | r2(team) r2(M) r1(team) r1(M) w2(M) c2 w1(M) c1 | cycle T1 → T2 → T1 |
| S1 | SER | 4/4 | r1(team) r1(M) r2(team) r2(M) w1(M) c1 a2[40001] | serial: T1 |
| S2 | RC | 4/4 | r2(team) r2(M) w2(M) c2 r1(team) r1(M) a1[refused] | serial: T2 |
| S2 | RR | 5/4 | r2(team) r2(M) r1(team) r1(M) w2(M) c2 w1(M) c1 | cycle T1 → T2 → T1 |
| S2 | SER | 4/4 | r2(team) r2(M) w2(M) c2 a1[40001] | serial: T2 |
| S3 | RC | 4/4 | r1(ctr) w1(ctr) w1(M) c1 r2(ctr) a2[refused] | serial: T1 |
| S3 | RR | 4/4 | r2(ctr) w2(ctr) w2(M) c2 a1[40001] | serial: T2 |
| S4 | SER | 4/4 | r2(team) r2(M) r1(team) r1(M) w2(M) w1(M) a1[40001] c2 r1.1(team) r1.1(M) a1.1[refused] | serial: T2 (cycle only with the aborted T1) |
| S6 | RC | 4/4 | r2(seats) r1(seats) w2(seats) w2(M) c2 r1(seats) a1[refused] | serial: T2 (RC re-read cycle, no DBMS abort) |
| S6 | RR | 4/4 | r2(seats) w2(seats) w2(M) c2 a1[40001] | serial: T2 |
| S7 | RC | 4/4 | w2(team) r2(M) w2(M) c2 w1(team) r1(M) a1[refused] | serial: T2 |
| S7 | RR | 4/4 | r2(M) w2(team) w2(M) c2 a1[40001] | serial: T2 |

The remaining cells (S3 SER, S4 RC/RR, S6 SER, S7 SER) have the same shape as a row above; all 18 are in `experiments/race/results/results.md`, Section 3.
