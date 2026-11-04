## Headline

**"A correct-looking lock-then-check trigger is only correct at READ COMMITTED."**
The fixture trigger (S2, Q35) over-admitted in **1000 of 1000** races at REPEATABLE READ for
every N. 141,989 of 142,000 racers were admitted, and the worst race ended at **103/4**. At RC
and SER the same trigger never went above 4/4.

| | RC | RR | SER |
|---|---|---|---|
| Procedural, application-level (S1 naive, S4 naive + retry) | **over-admits 100%** | **over-admits 100%** | 0% |
| Procedural, lock a parent row it never writes (S2, fixture Q35) | 0% | **over-admits 100%** | 0% |
| Procedural, write the parent row (S7, product v2) | 0% | 0% | 0% |
| Single-statement conditional counter (S3) | 0% | 0% | 0% |
| Declarative seat keys (S6) | 0% | 0% | 0% |

72,000 races, 2,556,000 attempts. Every cell marked 0% admitted **exactly one** racer in
every race. There were no deadlocks and no other errors. An independent re-run of the whole
matrix (verification pass, same machine) gave the same over-admission rate and worst size in
all 72 cells; only timing-dependent counts (late refusals, retries, latencies) moved.

## Conclusions

1. **SERIALIZABLE (SSI) alone fixes all six strategies, including the naive one**: 0 of 24,000
   races over-admitted. In S1, 99 of 100 racers got 40001 and exactly one committed in every
   race. SSI never aborted the whole group. It is not free, though. Without a retry loop
   (S1) the losers see 40001 rather than "team full". With one (S4), every loser needed at
   least one retry (238 of 138,000 needed two) and then got a clean refusal. That costs
   about +5 ms p95 at N = 2 and +6 ms at N = 100 compared with S1 at SER.
2. **A retry loop does nothing below SERIALIZABLE.** S4 at RC/RR is identical to S1: 100%
   over-admission and 0 retries, because nothing ever raises 40001. Retries are only useful
   together with SSI.
3. **What makes a procedural rule safe at every level is turning the conflict into a write on
   one row.** S3 (counter row) and S7 (no-op UPDATE of the team row) make the losers either
   re-check the newest row version (RC, EvalPlanQual) or fail with 40001 (RR/SER,
   first-updater-wins). S6 gets the same effect from a unique key. S2 only *locks* the row. Under RR the waiter's snapshot is older than
   the winner's insert, and a lock-only conflict raises no error, so the waiter counts 3
   members again.
4. **The declarative design (S6) is correct at every level, and nobody can bypass it.** Two
   joins collide on a primary key, and a unique index ignores snapshots. While S6 is active, a
   deferred FK from `team_member` to `team_seat` means no client, buggy or not, can add a
   member without holding one of the `max_size` seat keys (checked: a seatless INSERT fails
   at COMMIT with the FK violation). Only someone with DDL rights can switch it off.
5. **Precedence graphs are consistent with the outcomes. This is a check of the model, not
   independent evidence.** For all 18,000 N = 2 races, the LOGICAL client-recorded schedule
   has a cycle `T1 → T2 → T1` **iff** the race over-admitted (5,000 runs that are not
   conflict-serializable, all over-admitted; 13,000 conflict-serializable runs, none
   over-admitted). This is close to true by construction: a correct race commits one
   transaction, so its committed graph has a single node, and two committed joiners both read
   the member set before the other's insert. The cycles also exist with r–w conflicts alone,
   so modelling the member set as one item (which adds w–w edges between two inserts) changes
   no verdict. The informative part is the graph *including aborted transactions*. For S1/S4
   at SER it had the cycle in 753 and 805 of 1000 runs, and in every one of them a transaction
   on the cycle was killed with 40001: SSI broke it. In the other runs SSI raised 40001 on the
   loser's INSERT, so the write never happened and no cycle formed. The S6/RC losers are on a
   cycle too (1000 of 1000), but only through their own two reads of the seat set, one before
   and one after the winner's commit (an RC non-repeatable read). They wrote nothing and rolled
   back on their own, so no DBMS abort was involved. `analysis_selftest.sql` checks the graph
   SQL on hand-solved schedules (a non-trivial acyclic one, a 3-cycle, lost update, write skew):
   all PASS.
6. **Cost (p95 per attempt, N = 100):** the abort-based paths are fastest (S7 RR 6.0 ms, S3 SER
   6.0 ms, S7 SER 6.3 ms, S3 RR 6.9 ms, S6 SER 6.9 ms) because losers fail as soon as the
   winner commits. The RC lock queues are slower (S6 RC 8.2, S2 RC 12.1, S7 RC 12.1,
   S3 RC 17.1 ms) because the waiters leave the row-lock queue one at a time: each one holds
   the row lock until its own ROLLBACK.
   For scale, S1 and S4 include 10 ms of deliberate think time.

## Surprises

- **SSI never produced a zero-winner race.** All 4,000 S1/SER races had exactly one commit,
  even with 100 simultaneous writers. In PostgreSQL a dangerous structure only forces an
  abort if the transaction at its end commits first, so a winner is expected. But "exactly one winner,
  never zero" is an observation, not a guarantee.
- **S2 at RR depends on timing, not on N.** 11 of 142,000 RR racers *were* refused correctly
  (24 in the first full run). Their snapshot was taken late enough to include a winner's
  commit, so a few N = 100 races ended at 97, 100 or 102 instead of 103. Below SERIALIZABLE,
  whether the rule holds depends on when each snapshot was taken.
- **At RR and SER, a few losers were *refused* instead of aborted** (SER: S7 659, S2 134,
  S3 83, S6 39; RR: S6 246, S3 24, S7 18; all of 138,000). These racers took their snapshot
  after the winner's commit, so they saw 4/4 and wrote nothing. There was no rw-antidependency
  to act on and no write-write conflict. At N = 100 the barrier releases the clients over
  about 1–1.5 ms, and the server runs 100 backends on a few cores, so "late" is common.
- **S3 at RC has the worst p95 of the correct strategies at N = 100 (17 ms, 19 ms in the first
  run). The cause is not established.** One fact is verified: an RC loser whose
  `UPDATE … WHERE member_count < max_size` re-check fails (0 rows) *still holds the row lock*
  it took for the EvalPlanQual re-check until it rolls back. A third session's
  `FOR UPDATE NOWAIT` fails while that loser is open. So, as with S2 and S7, S3's losers leave
  the queue one at a time. The winner holding the lock for one extra round trip (UPDATE,
  INSERT, COMMIT instead of INSERT, COMMIT) adds that cost only once per race, so it cannot
  explain a ~5 ms gap with 99 waiters. Profiling would be needed.
- **The live lock graph shows a queue, not a crowd.** The second waiter does not wait for the
  lock holder. It waits for the *first waiter* on a `tuple` lock, and only the first waiter
  waits on the holder's `transactionid` (`results/demo_locks_S2_RC.txt`). Row locks are not
  listed in `pg_locks` while they are merely held: they live in the row header.
- **At SER the predicate lock on `team_member` is relation-level** (`demo_locks_S1_SER.txt`).
  The table is tiny, so the COUNT is a sequential scan, and SSI locks the whole relation. That
  is how the phantom insert is caught. The commit failure names the reason: *"Canceled on
  identification as a pivot, during commit attempt."*
