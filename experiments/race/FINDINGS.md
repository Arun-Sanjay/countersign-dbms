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
