# Component 10: Innovative Experiment, "the last team slot"

**Declarative vs procedural integrity under concurrency.**
Team Beta (T02) has `max_size = 4` and 3 members, so it has exactly one free seat. N students
try to take that seat at the same moment. We measure, for six ways of enforcing the capacity
rule at each of PostgreSQL's three isolation levels, whether the team ever ends up above 4/4.

Measured results are in [`results/results.md`](results/results.md); the narrative is in
[`FINDINGS.md`](FINDINGS.md).

## Files

| File | What it is |
|---|---|
| `setup.sh` | Starts the throwaway container `elp-race-pg` (postgres:17, port 55433, `max_connections=300`) and loads database `race`. It reads fixture `01_schema.sql` + `02_seed.sql` + the Q35 block of `03_queries.sql` and pipes them unchanged into psql, then loads `schema.sql`. The fixture files are only read; nothing is copied or edited. |
| `schema.sql` | Schema `exp`: result tables (`experiment_run`, `experiment_attempt`, `schedule_log`), strategy objects (S3 counter, S6 seat tables, S7 trigger), `exp.use_strategy()` and `exp.reset_t02()`, plus 100 synthetic racers `1RV99XX001..100`. |
| `harness.py` | asyncpg load generator for the strategy × isolation × N × trials matrix. |
| `analysis.sql` | (a) over-admission / aborts / refusals / p50-p95 latency per cell; (b) precedence graph from `exp.schedule_log`, `WITH RECURSIVE` cycle detection, and a serial order for each N = 2 run. |
| `analysis_selftest.sql` | Feeds six hand-solved textbook schedules (non-trivial acyclic graph, 3-cycle, lost update, write skew, serial schedule, cycle broken by an abort) through the same views and prints PASS/FAIL. Runs in a rolled-back transaction. |
| `report.py` | Exports the views to CSV, draws the charts (SVG + PNG), writes `results/results.md`. |
| `live_locks.sql` | Live wait-for graph: `pg_stat_activity` ⋈ `pg_blocking_pids()` ⋈ `pg_locks`. |
| `demo_locks.sh` | Starts a blocking race (A holds the last seat, B and C wait) and prints `live_locks.sql`. |
| `rr_trigger_check.sh`, `capacity_v2_check.sh` | Day-1 psql checks (kept as they were). |

## How to run

```bash
experiments/race/setup.sh                                   # container + database "race" (about 5 s; DROPS old results)
uv run --python 3.12 --with asyncpg experiments/race/harness.py --fresh            # 30 trials/cell (about 30 s)
uv run --python 3.12 --with asyncpg experiments/race/harness.py --fresh --trials 1000   # the reported run (14 min)
docker exec -i elp-race-pg psql -U postgres -d race -X < experiments/race/analysis.sql \
  > experiments/race/results/analysis_output.txt
docker exec -i elp-race-pg psql -U postgres -d race -X < experiments/race/analysis_selftest.sql   # all PASS
uv run --python 3.12 --with asyncpg --with matplotlib experiments/race/report.py
experiments/race/demo_locks.sh S2 RC                         # live lock graph (S1|S2|S3|S7 x RC|RR|SER)
```

Harness flags: `--trials`, `--strategies S1,S2,...`, `--isolations RC,RR,SER`, `--ns 2,8,32,100`,
`--fresh` (empties the `exp` result tables first). Overrides: `RACE_DSN` (harness, report),
`RACE_DB` / `RACE_CONTAINER` / `RACE_PORT` (setup.sh).
To reproduce without touching the reported data, load a second database and point the
harness at it: `RACE_DB=race_verify experiments/race/setup.sh`, then
`RACE_DSN=postgresql://postgres:localdev@localhost:55433/race_verify uv run ... harness.py --fresh --trials 5`
and `psql -d race_verify` for the analysis.
Remove everything with `docker rm -f elp-race-pg`.

### One race (one trial)

1. `exp.reset_t02()` puts T02 back to 3/4 (and resets the S3 counter and S6 seats).
2. N persistent connections each run `BEGIN ISOLATION LEVEL <iso>`. `BEGIN` does not take a
   snapshot, so this does not change the semantics. Then they wait on an `asyncio.Barrier`.
3. When the barrier releases, every client runs the strategy's join logic and then `COMMIT`.
4. Each attempt is classified as `admitted`, `refused` ("team is full"), `serialization_failure`
   (SQLSTATE 40001), `deadlock` (40P01) or `error`. The final size of T02 is counted, and the run
   row is written with `over_admitted = final_size > max_size`.

Only one capacity mechanism is active at a time (`exp.use_strategy` enables or disables the
triggers and adds or drops the S6 foreign key).

## The strategies

| | Strategy | Where the rule lives | What it demonstrates |
|---|---|---|---|
| S1 | Naive check-then-insert: `SELECT count(*)`, `pg_sleep(0.01)`, `INSERT` | application, no lock | **Write skew through a phantom.** Each client reads the predicate "members of T02" (3 rows) and inserts a *new* row. No row is written by two transactions, so there is nothing for row locks or first-updater-wins to catch. Only SSI notices the rw-antidependencies. |
| S2 | Fixture trigger `check_team_capacity()` (Q35): `SELECT … FROM team … FOR UPDATE`, then `COUNT(*)` | procedural, in the database | **Lock a surrogate row.** You cannot lock rows that do not exist yet (the phantom), so the trigger locks the parent `team` row instead. That serializes the joins, but only if the `COUNT` after the lock sees the other transaction's insert. Under RC each statement takes a fresh snapshot, so it does. Under RR the snapshot was taken when the `INSERT` started, *before* the lock wait, so the `COUNT` still sees 3. The team row was only locked and never modified, so no 40001 is raised either. |
| S3 | Conditional counter: `UPDATE exp.team_counter SET member_count = member_count+1 WHERE team_id=$1 AND member_count < max_size RETURNING` and insert only if a row came back | procedural, but the check and the write are one statement | **Turn the predicate into a single row that is written.** RC: the waiting UPDATE re-checks its `WHERE` on the newest row version (EvalPlanQual) and matches nothing, so the client refuses. (It keeps the row lock it took for that re-check until it rolls back, so losers leave the queue one at a time.) RR/SER: the row changed after the snapshot, so 40001 (first-updater-wins). |
| S4 | S1 + retry on 40001/40P01 (up to 5 retries, exponential jitter) | application | **SERIALIZABLE + retry is the textbook contract.** At SER the losers abort and the retry, with a new snapshot, sees 4/4 and refuses. At RC/RR nothing aborts, so a retry loop alone fixes nothing. |
| S6 | Declarative seats: `exp.team_seat_slot` holds seats 1..max_size per team; `exp.team_seat(team_id, seat_no)` has a PK, `UNIQUE(team_id, usn)` and an FK to the slots; while S6 is active `team_member(team_id, usn)` has a **deferred FK** to `team_seat`. A join claims the lowest free seat with `INSERT … ON CONFLICT DO NOTHING` | **declarative**: keys and foreign keys | **Capacity becomes data and the rule becomes a key.** Two joins collide on the same primary key, and a unique index cannot be fooled by a snapshot. RC: the loser waits for the winner, then `DO NOTHING`, re-reads and finds no free seat. RR/SER: the conflicting row is invisible to the loser's snapshot, so 40001. Even a buggy client cannot add a member without a seat. |
| S7 | Write-the-parent (product capacity v2, migration 0002, re-created in `exp`): the trigger runs `UPDATE team SET max_size = max_size … RETURNING`, then `COUNT(*)` | procedural, in the database | **Make the conflict a write-write conflict.** The no-op UPDATE takes the row lock *and* creates a new row version. RC waiters re-read and then count with a fresh snapshot; RR/SER waiters get 40001. |

(There is no S5. The numbering follows the strategy list in `docs/PLAN.md`, which skips it; S7 was added for the product's capacity v2 trigger.)

## Unit IV concepts, with the correct terms

- **Write skew** (not a "lost update"). Two transactions read overlapping data, the members of
  T02, and then write *different* rows based on what they read. Each write is valid alone, but
  together they break an invariant that spans rows (`COUNT ≤ max_size`). A lost update would
  need both transactions to overwrite the *same* row. Here nobody overwrites anything.
- **Phantom.** `COUNT(*) … WHERE team_id = 'T02'` reads a *predicate*. A concurrent INSERT
  creates a new row that satisfies the predicate. Row-level locks only cover existing rows, so
  they cannot stop it. The remedies are a lock on a surrogate row (S2, which is enough only
  at RC; S7, which also writes that row), a materialized conflict (S3 counter, S6 seat keys),
  or predicate-level tracking (SSI's SIREAD locks at SER, which detect rather than block).
- **Row locks and 2PL.** Every PostgreSQL row lock (`FOR UPDATE`, `FOR SHARE`, and the lock an
  `UPDATE`/`DELETE` takes) is held until commit or abort and never released early, so *for the
  rows a transaction locks* the behaviour matches strict (in fact rigorous) two-phase locking.
  A transaction that locks only the team row is **not** a 2PL transaction, and the 2PL
  serializability theorem does not apply to it: its plain `SELECT`s (the `COUNT`) take no
  locks and read an MVCC snapshot, and there are no predicate/range locks outside SSI, so the
  phantom row is never locked. S2 and S7 use the team-row lock as a *mutex on a surrogate
  row* that puts writers into a queue. Whether the queue is *enough* depends on which snapshot
  the waiter reads after it gets the lock. (So "`FOR UPDATE` = strict 2PL", as PROJECT_MASTER
  §8 puts it, is imprecise: it is one strict-2PL-style lock, not a 2PL schedule.)
- **MVCC snapshots.** READ COMMITTED takes a new snapshot for every statement, including
  every statement inside a (volatile, the default) plpgsql trigger function. REPEATABLE READ is snapshot isolation: one
  snapshot per transaction, taken by its **first statement** (not by `BEGIN`). Under RR, a
  transaction that tries to update or lock a row *modified* by a concurrent committed
  transaction gets 40001 (first-updater-wins). If the row was only *locked*, it does not.
  That gap is why S2 fails at RR and S7 does not.
- **SSI.** PostgreSQL's SERIALIZABLE is Serializable Snapshot Isolation. It is snapshot
  isolation plus SIREAD (predicate) locks that record what each transaction read. SIREAD
  locks never block anyone; they only record reads. When SSI finds a "dangerous structure"
  (two consecutive rw-antidependencies T1 →rw T2 →rw T3 between concurrent transactions,
  T2 being the pivot, where T1 and T3 may be the same transaction, as in this experiment's
  T1 → T2 → T1), it aborts one transaction with 40001. In PostgreSQL the structure only forces an
  abort if T3 commits first (the commit-ordering refinement of Ports & Grittner, VLDB 2012). It does not
  block; it aborts, and the client must retry (S4). It is conservative: it can abort
  transactions that would have been serializable (false positives), never the opposite.
- **Conflict serializability and precedence graphs.** Two operations conflict if they belong
  to different transactions, touch the same item, and at least one of them is a write. Each
  conflicting pair gives an edge Ti → Tj when Ti's operation comes first. A schedule is
  conflict-serializable iff this graph is acyclic, and a topological order of the graph is an
  equivalent serial schedule. `analysis.sql` builds the graph in SQL, finds cycles with
  `WITH RECURSIVE`, and prints a serial order for acyclic runs.

## Logical schedule (read this before quoting the precedence-graph results)

`exp.schedule_log` is a **logical, client-recorded schedule**. It is *not* PostgreSQL's
internal schedule, because PostgreSQL never runs one r/w interleaving over single-version
items: it keeps row versions, locks individual rows, and (at SER) tracks rw-antidependencies.
The harness writes the log for N = 2 races only, using one global counter in the client's
single event loop:

- `w(x)`, `c` and `a` are placed when the client sees the statement (or COMMIT/ROLLBACK)
  complete;
- `r(x)` is placed at the **snapshot it used**. At READ COMMITTED that is when the statement
  ran. For a statement that waited on a row lock and then re-read the newest version, that
  is right after the lock was granted: the trigger's `COUNT` (S2, S7) is a new statement with
  a new snapshot, and S3's `UPDATE … WHERE` re-checks via EvalPlanQual. The exception is S6's
  `INSERT … SELECT … ON CONFLICT DO NOTHING`: it picks the free seat with its statement-start
  snapshot and does not re-read after waiting, so that read is placed at the statement's
  issue time. At REPEATABLE READ and SERIALIZABLE every read is placed at the transaction's
  first statement, when its single snapshot was taken.
- `members:T02` is modelled as **one item** (the predicate). Two INSERTs of different rows
  into it therefore also count as a w–w conflict. That is conservative (it can only add edges)
  and none of the verdicts depends on it: every cycle found in the data also exists using
  r–w / w–r conflicts alone (checked over all 18,000 N = 2 runs).
- Ops of a statement that raised an error are not logged (the client cannot tell how far the
  statement got), so the aborted transaction's reads are missing from the
  `cycle_incl_aborted` graph. For example, an S2 loser at SER really did read the member set
  before SSI killed its INSERT. That column is therefore a lower bound.
- Items: `team:T02` (the team row), `members:T02` (the predicate "members of T02"),
  `counter:T02` (S3), `seats:T02` (S6, the seat set).
- Retries are separate transactions (`T2.1`, `T2.2`, …). The verdict uses the **committed
  projection**: aborted and refused transactions left no effects. The column
  `cycle_incl_aborted` also checks the graph that includes aborted transactions. Each abort
  is logged with its reason (`a1[40001]` = killed by the DBMS, `a1[refused]` = the client
  rolled back after "team is full"). A cycle that appears only in that graph and runs through
  a DBMS-aborted transaction is one the DBMS broke (`cycle_broken_by_dbms`, SSI at work at
  SER). The other kind is the S6 loser at READ COMMITTED: it reads the seat set once before
  and once after the winner's commit (a non-repeatable read, allowed at RC), so it sits on a
  cycle. It wrote nothing and rolled itself back, so nothing had to be broken.

Because a correct race commits exactly one transaction, the committed projection of a correct
race has a single node, and its "serial order" is that one transaction. The interesting graphs
are the over-admitting races (two committed transactions with a cycle) and the
`cycle_incl_aborted` column at SERIALIZABLE.

With this placement rule, every N = 2 race that over-admitted has a cycle `T1 → T2 → T1` in
its precedence graph, and every race that stayed at 4/4 is conflict-serializable (see
`results/results.md` §3). **Read this as a consistency check of the model, not as independent
evidence.** A race that stayed at 4/4 has one committed node, so it is acyclic by
construction. In a race that over-admitted, both transactions read the member set before
the other's insert, so it has a cycle by construction. The graph does not detect anything the
final team size does not already show. What it adds is the textbook explanation (which
conflicts form the cycle) and, through `cycle_incl_aborted`, a view of the cycles SSI broke.
Because the real data never produces a non-trivial acyclic graph or a cycle longer than 2,
`analysis_selftest.sql` checks the SQL on hand-solved schedules that do.

## Caveats

- One machine, Docker Desktop, client and server share the CPU. The latencies are relative
  costs, not production numbers. The asyncio barrier releases all clients within about
  0.1 ms at N = 8 and about 1–1.5 ms at N = 100 (one event loop sends the statements one
  after another, about 10–15 µs apart; measured), which is a harsher race than real users
  would produce. That makes the failures happen almost every time, which is useful for a
  demonstration. On the server, 100 backends share a few cores, so some racers take their
  snapshot after the winner has already committed: these are the "late" racers that are
  refused instead of aborted.
- Latency is measured per client from *its own* resume after the barrier, so a racer that
  resumed late can show a smaller latency than the winner.
- S1 and S4 sleep 10 ms between check and insert to widen the race window, so their absolute
  latency includes 10 ms of think time.
- The S6 slot table is generated from `team.max_size` at load time. A production version would
  need a trigger, or a rule that `max_size` changes go through a function that adds or removes
  slots.
- The schedule log models the *client's view*. The internal truth is visible with
  `live_locks.sql` (locks and waits) and `pg_locks` `SIReadLock` rows (SSI).
