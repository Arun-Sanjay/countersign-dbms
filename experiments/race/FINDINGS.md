# Innovative Experiment — day-1 finding (2026-11-04, local PostgreSQL 17.11 in Docker)

Script: `experiments/race/rr_trigger_check.sh`. Fixture: Appendix A + B + trigger from Q35.
Two sessions race for Team Beta (T02, 3/4) last seat. Session A inserts and holds; session B's
insert blocks on the trigger's `SELECT ... FOR UPDATE`; A commits; B resumes.

| Isolation level | Trigger only (Q35) | Q37 pattern (explicit FOR UPDATE, then INSERT) |
|---|---|---|
| READ COMMITTED  | 4/4 — B refused "Team T02 is full" | 4/4 — B refused |
| REPEATABLE READ | **5/4 — B over-admitted, no error** | **5/4 — B over-admitted, no error** |
| SERIALIZABLE    | 4/4 — B aborted, SQLSTATE 40001 (SSI pivot) | (not run) |

Why: under REPEATABLE READ the transaction snapshot is fixed at the first statement, i.e. *before*
B waits for the row lock. A only locked the team row (never updated it), so when B gets the lock
there is no update conflict (no 40001), and the COUNT(*) still reads B's old snapshot (3 members).
Under READ COMMITTED each statement in the plpgsql function takes a fresh snapshot after the lock.

Takeaway (headline of Component 10): "a correct-looking lock-then-check trigger is only correct at
READ COMMITTED." Fixes to compare: conditional `UPDATE team SET member_count = member_count+1
WHERE member_count < max_size` (writes the row → 40001 under RR), SERIALIZABLE + retry, and a
declarative `team_seat(team_id, seat_no)` UNIQUE table.
Terminology: this is write skew / a predicate phantom, not a "lost update".

## Capacity v2 on the local Supabase stack (2026-11-04, PostgreSQL 17, `supabase start`)

Script: `experiments/race/capacity_v2_check.sh` (container `supabase_db_countersign-dbms`, DB after
`db reset` = migrations 0001+0002 + fixture seed + demo seed). Trigger under test:
`trg_team_capacity_v2` → `private.enforce_team_capacity_v2()` (migration 0002), which *writes* the
parent row (`UPDATE team SET max_size = max_size … RETURNING max_size`) and only then counts.
Race 1 = pair race for T02's last seat (3/4), as above. Race 2 = 8 sessions start together for
T06's last seat (3/4, project P06).

| Isolation level | Race 1 (pair) | Race 2 (burst of 8) |
|---|---|---|
| READ COMMITTED  | 4/4 — B refused, 23514 "Team T02 is full (4 / 4)" | 4/4 — 1 admitted, 7 refused (23514) |
| REPEATABLE READ | 4/4 — B aborted, **40001** "could not serialize access due to concurrent update" | 4/4 — 1 admitted, 7 × 40001 |
| SERIALIZABLE    | 4/4 — B aborted, 40001 (concurrent update) | 4/4 — 1 admitted, 7 × 40001 |

**Result: PASS, never above max_size at any level.**

Control run (same script and stack, v2 disabled, fixture Q35 trigger created instead):
RC 4/4 (P0001 "full"); **RR pair 5/4, RR burst 11/4 with all 8 admitted**; SER 4/4 (40001 from SSI,
"read/write dependencies"). This shows the harness detects over-admission and that the fix is what
makes the difference.

Why v2 works: the no-op UPDATE takes the row lock *and* creates a new row version. Under RR/SER a
transaction whose snapshot predates that committed version cannot update the row → 40001 (first
updater wins), instead of silently counting a stale snapshot. Under RC the waiting UPDATE re-reads
the latest row version, and the following COUNT runs as a new statement with a fresh snapshot, so it
sees the winner. The same trick on the `student` row serializes one-team-per-project.
Client contract: on 40001, retry the transaction; the retry then gets the clean "Team … is full" error.

## Component 10 harness, full matrix (2026-11-04, PostgreSQL 17.11, throwaway container `elp-race-pg`)

Harness: `harness.py` (asyncpg, N clients released together by an `asyncio.Barrier`), schema
`schema.sql` loaded by `setup.sh` on top of fixture 01 + 02 + the verbatim Q35 block. Analysis:
`analysis.sql`, report: `report.py`. Full tables, charts and CSVs: `results/results.md`.
Matrix: 6 strategies × RC/RR/SER × N = 2/8/32/100 × **1000 trials** = 72,000 races and
2,556,000 attempts, in 14 min. The numbers below are from the verification re-run (after
the schedule-log fixes listed at the end of this section). The first full run gave the
same over-admission rate and worst size in all 72 cells.

Over-admission (share of races that ended above 4/4; identical for every N):

| Strategy | RC | RR | SER |
|---|---|---|---|
| S1 naive check-then-insert (app, no lock, 10 ms think time) | 100% (worst 103/4) | 100% (103/4) | 0%, losers get 40001 |
| S2 fixture trigger Q35 (lock team row, then COUNT) | 0% | **100% (103/4)** | 0% |
| S3 conditional counter `UPDATE … WHERE member_count < max_size` | 0% | 0% | 0% |
| S4 = S1 + retry on 40001 (≤ 5, jitter) | 100% | 100% | 0%, losers refused after 1 retry (238 needed 2) |
| S6 declarative seats (PK + FK to seat slots + deferred FK from team_member) | 0% | 0% | 0% |
| S7 write-the-parent (product capacity v2) | 0% | 0% | 0% |

- Day-1 result confirmed at scale: S2 at RR over-admits in every race. With N = 100, the
  snapshot-before-lock-wait lets almost all of the racers in (141,989 of 142,000; 141,976 in
  the first run). The 11 refused took their snapshot after a winner had committed.
- Every 0% cell admitted exactly one racer per race. There were no deadlocks or other
  errors in 2.56 M attempts. SSI never aborted every participant (no zero-winner race).
- A retry loop only matters with SERIALIZABLE (S4 at RC/RR = S1).
- Precedence graphs (`analysis.sql` §b, LOGICAL client-recorded schedule, N = 2): cycle
  `T1 → T2 → T1` in exactly the 5,000 races that over-admitted, and none in the 13,000 that did
  not. This is a consistency check of the model, not independent evidence: a correct race has
  one committed transaction, so its graph is trivially acyclic (see README "Logical
  schedule"). For S1/S4 at SER, the graph including aborted transactions had the cycle in
  753 / 805 of 1000 runs, always through a transaction killed with 40001, so SSI broke it.
  In the other runs SSI raised 40001 on the loser's INSERT, before its write took effect.
  The graph SQL itself is checked on hand-solved non-trivial schedules by
  `analysis_selftest.sql` (all PASS).
- Cost, p95 per attempt at N = 100: S7 RR 6.0 ms, S3 SER 6.0, S6 SER 6.9, S6 RC 8.2, S2 RC 12.1,
  S7 RC 12.1, S3 RC 17.1, S1 SER 25.6, S4 SER 31.9 (S1/S4 include 10 ms of think time). These
  are within about 15% of the first run.
  Abort-based paths are cheapest under contention: the losers fail as soon as the winner commits.
  At RC the losers leave the row-lock queue one at a time. Each one holds the lock until its
  own ROLLBACK, and that includes the S3 loser whose EvalPlanQual re-check matched nothing
  (verified with `FOR UPDATE NOWAIT`).
- Live locks (`demo_locks.sh`, outputs in `results/demo_locks_*.txt`): the first waiter waits
  for `ShareLock` on the holder's **transactionid**, and the second waiter queues behind the
  first on a **tuple** lock of the team row. At SER, the naive COUNT holds a relation-level
  `SIReadLock` on `team_member`, and the holder later fails with "Canceled on identification as
  a pivot, during commit attempt".
- Verification review (independent re-run, 5 trials per cell and then the full 1000):
  - Results were reproduced.
  - Three corrections were made to the logical schedule log. (1) S6 at RC: the read that
    picks the seat was being placed after the lock wait. It now goes at statement start,
    because `INSERT … SELECT … ON CONFLICT` keeps its statement snapshot. (2) Each abort is
    now logged with its reason (`a[40001]` vs `a[refused]`). (3) "Cycle broken by abort" now
    counts only DBMS aborts. The S6/RC loser's cycle comes from an RC non-repeatable read
    and is not one of them.
  - The README now states the 2PL and SSI facts precisely.
  - The barrier skew was measured: about 1–1.5 ms at N = 100, not "microseconds".

Verdict for the product: keep S7 (capacity v2) as the enforced rule. Use S6 seat keys as the
"declarative" comparison in the report and viva. Treat SERIALIZABLE + retry (S4) as the
general fix for rules that cannot be turned into a single-row write. Never rely on a
lock-only trigger (S2) unless the isolation level is pinned to READ COMMITTED.

## Membership write skew and the countersign revision (2026-11-04, review round 1)

Harness: `membership_skew_check.sh` (local Supabase stack, two sessions, A holds 3 s).

| Race | Fix in place | RC | RR | SER |
|---|---|---|---|---|
| 1. mark, then leave | membership check WRITES the row | B: 55000 has-history | B: 40001 | B: 40001 |
| 2. leave, then mark | same | A: 23514 not in a team | A: 40001 | A: 40001 |
| 3. edit, then countersign (old revision) | claim row locked + `claim_revision` | B: 55000 stale revision | B: 40001 | B: 40001 |
| 1. mark, then leave (control) | membership check only LOCKS the row (`FOR KEY SHARE`) | refused | **committed: 1 mark for a non-member** | 40001 (SSI) |

- The control repeats the capacity lesson for a different invariant ("everyone with recorded
  work is a member"): a lock is not a write. Under RR, B waits for A's KEY SHARE lock, but
  its snapshot is from before A's commit, so the history check doesn't see the new mark.
  A row that was only locked, not changed, raises no serialization error, so the DELETE
  commits. Writing the membership row (`UPDATE team_member SET role = role`) turns the skew
  into a write-write conflict: RC re-reads and refuses, RR/SER get 40001.
- Race 3 is optimistic concurrency control: the countersign carries the claim revision the
  signer read. Locking the claim row only serializes the two transactions. The revision
  check is what refuses a confirm of text the signer never saw.
