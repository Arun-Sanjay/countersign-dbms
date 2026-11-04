"""Component 10 race harness: N clients race for Team Beta (T02)'s last seat (3/4).

For each strategy x isolation level x N x trial:
  * reset T02 to 3/4 (exp.reset_t02),
  * N asyncpg connections each BEGIN at the chosen isolation level, wait on an
    asyncio.Barrier, then all try to take the last seat at once,
  * every attempt, the run summary and (for N = 2) a LOGICAL client-recorded
    schedule of r/w/c/a operations are stored in exp.*.

Run:  uv run --python 3.12 --with asyncpg experiments/race/harness.py [--trials 30]
DB:   RACE_DSN (default postgresql://postgres:localdev@localhost:55433/race), see setup.sh.
"""
from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import os
import random
import sys
import time

import asyncpg

DSN = os.environ.get("RACE_DSN", "postgresql://postgres:localdev@localhost:55433/race")
TEAM = "T02"
STRATEGIES = ["S1", "S2", "S3", "S4", "S6", "S7"]
ISOLATIONS = ["READ COMMITTED", "REPEATABLE READ", "SERIALIZABLE"]
NS = [2, 8, 32, 100]
S4_MAX_RETRIES = 5

INS_MEMBER = "INSERT INTO team_member (team_id, usn, role, joined_at) VALUES ($1, $2, 'member', current_date)"


def racer_usn(i: int) -> str:
    return f"1RV99XX{i:03d}"


class Refused(Exception):
    """The strategy decided the team is full (application-level refusal)."""


# --------------------------------------------------------------------------------------
# Logical schedule recorder (N = 2 only)
#
# This is a LOGICAL, client-recorded schedule, not PostgreSQL's internal MVCC schedule.
# One global counter (single asyncio event loop => a total order of client-observed
# events). Placement rule:
#   * w(x), c, a  -> the moment the client sees the statement complete;
#   * r(x)        -> the moment of the SNAPSHOT the read used:
#       READ COMMITTED : each statement takes a fresh snapshot when it runs. A read that
#                        re-checks the newest row version after a row-lock wait (S2/S7
#                        trigger COUNT = a new statement, S3 UPDATE via EvalPlanQual) is
#                        placed when its statement completes, i.e. after the lock was
#                        granted. A read that keeps its statement-start snapshot across
#                        the wait (S6: the INSERT ... SELECT that picks the free seat, then
#                        waits in ON CONFLICT) is placed at the statement's issue time
#                        (done(..., read_at_issue=True));
#       REPEATABLE READ / SERIALIZABLE : one snapshot per transaction, taken by its first
#                        statement, so every read is placed at that statement's issue time.
# Items: team:T02 (the team row), members:T02 (the predicate "members of T02", i.e. the
# set a COUNT reads and an INSERT changes -> phantom), counter:T02 (S3), seats:T02 (S6).
# --------------------------------------------------------------------------------------
class Schedule:
    def __init__(self) -> None:
        self.ctr = 0
        self.events: list[tuple[int, str, str, str | None, dt.datetime]] = []

    def tick(self) -> int:
        self.ctr += 100          # gaps leave room for sub-steps (+1, +2, ...) of one event
        return self.ctr


class Txn:
    """Per-transaction recorder; a no-op when the schedule is not being logged."""

    def __init__(self, sched: Schedule | None, name: str, iso: str) -> None:
        self.s, self.name, self.iso = sched, name, iso
        self.snap: int | None = None   # seq of first statement issue (RR/SER snapshot point)
        self.last_issue: int | None = None  # seq of the current statement's issue
        self.sub = 0

    def issue(self) -> int | None:
        """Call right before sending a statement; returns its issue seq."""
        if self.s is None:
            return None
        seq = self.s.tick()
        if self.snap is None:
            self.snap = seq
        self.last_issue = seq
        return seq

    def _log(self, seq: int, op: str, item: str | None) -> None:
        self.sub += 1
        self.s.events.append((seq + self.sub, self.name, op, item, dt.datetime.now(dt.timezone.utc)))

    def done(self, reads: list[str] = (), writes: list[str] = (), ops: list[tuple[str, str]] | None = None,
             read_at_issue: bool = False) -> None:
        """Call right after a statement completed successfully.
        ops = ordered [(op, item)] when a statement mixes writes and reads (S7 trigger);
        otherwise reads are logged before writes.
        read_at_issue = the statement's reads use its statement-start snapshot even if it
        waited on a lock (RC only; under RR/SER every read is at the transaction snapshot)."""
        if self.s is None:
            return
        comp = self.s.tick()
        if self.iso != "READ COMMITTED":
            read_at = self.snap
        else:
            read_at = self.last_issue if read_at_issue else comp
        if ops is None:
            ops = [("r", it) for it in reads] + [("w", it) for it in writes]
        for op, it in ops:
            self._log(read_at if op == "r" else comp, op, it)

    def end(self, op: str, reason: str | None = None) -> None:
        """c = commit; a = abort. For 'a', reason goes into the item column:
        'refused' = the client rolled back after a "team is full" answer (its own choice),
        otherwise the SQLSTATE that killed the transaction (e.g. 40001 = DBMS abort)."""
        if self.s is not None:
            self._log(self.s.tick(), op, reason)


# --------------------------------------------------------------------------------------
# Strategies: each body runs inside an already-open transaction and either returns
# (caller commits) or raises Refused / an asyncpg error.
# --------------------------------------------------------------------------------------
async def body_naive(conn, usn, tx: Txn):
    """S1 / S4: application check-then-insert, no lock, sleep widens the race window."""
    tx.issue()
    row = await conn.fetchrow(
        "SELECT (SELECT count(*) FROM team_member WHERE team_id = $1)::int AS n,"
        "       (SELECT max_size FROM team WHERE team_id = $1) AS cap", TEAM)
    tx.done(reads=["team:T02", "members:T02"])
    if row["n"] >= row["cap"]:
        raise Refused
    await conn.execute("SELECT pg_sleep(0.01)")
    tx.issue()
    await conn.execute(INS_MEMBER, TEAM, usn)
    tx.done(writes=["members:T02"])


async def body_trigger_q35(conn, usn, tx: Txn):
    """S2: plain INSERT; the fixture trigger locks the team row FOR UPDATE then COUNTs."""
    tx.issue()
    try:
        await conn.execute(INS_MEMBER, TEAM, usn)
    except asyncpg.RaiseError as e:            # P0001 'Team T02 is full'
        if "is full" in str(e):
            tx.done(reads=["team:T02", "members:T02"])
            raise Refused from e
        raise
    tx.done(reads=["team:T02", "members:T02"], writes=["members:T02"])


async def body_counter(conn, usn, tx: Txn):
    """S3: conditional counter UPDATE ... WHERE member_count < max_size RETURNING."""
    tx.issue()
    got = await conn.fetchval(
        "UPDATE exp.team_counter SET member_count = member_count + 1 "
        "WHERE team_id = $1 AND member_count < max_size RETURNING member_count", TEAM)
    if got is None:
        tx.done(reads=["counter:T02"])
        raise Refused
    tx.done(reads=["counter:T02"], writes=["counter:T02"])
    tx.issue()
    await conn.execute(INS_MEMBER, TEAM, usn)
    tx.done(writes=["members:T02"])


async def body_seats(conn, usn, tx: Txn):
    """S6: claim the lowest free seat (PK + FK make capacity declarative)."""
    for _ in range(8):
        tx.issue()
        seat = await conn.fetchval("SELECT exp.claim_seat($1, $2)", TEAM, usn)
        # The seat was picked by the INSERT ... SELECT with the statement-start snapshot;
        # under RC an ON CONFLICT wait does not refresh that read (no EvalPlanQual here).
        if seat is not None:
            tx.done(reads=["seats:T02"], writes=["seats:T02"], read_at_issue=True)
            tx.issue()
            await conn.execute(INS_MEMBER, TEAM, usn)
            tx.done(writes=["members:T02"])
            return
        tx.done(reads=["seats:T02"], read_at_issue=True)
        tx.issue()
        free = await conn.fetchval(
            "SELECT count(*) FROM exp.team_seat_slot s WHERE s.team_id = $1 AND NOT EXISTS "
            "(SELECT 1 FROM exp.team_seat x WHERE x.team_id = s.team_id AND x.seat_no = s.seat_no)", TEAM)
        tx.done(reads=["seats:T02"])
        if free == 0:
            raise Refused
    raise RuntimeError("S6: seat claim did not converge")


async def body_trigger_v2(conn, usn, tx: Txn):
    """S7: plain INSERT; the v2 trigger WRITES the team row (no-op UPDATE) then COUNTs."""
    tx.issue()
    try:
        await conn.execute(INS_MEMBER, TEAM, usn)
    except asyncpg.CheckViolationError as e:   # 23514 'Team T02 is full'
        if "is full" in str(e):
            tx.done(ops=[("w", "team:T02"), ("r", "members:T02")])
            raise Refused from e
        raise
    tx.done(ops=[("w", "team:T02"), ("r", "members:T02"), ("w", "members:T02")])


BODIES = {"S1": body_naive, "S2": body_trigger_q35, "S3": body_counter,
          "S4": body_naive, "S6": body_seats, "S7": body_trigger_v2}


# --------------------------------------------------------------------------------------
async def one_client(conn, strategy, iso, client_no, barrier, sched):
    usn = racer_usn(client_no)
    body = BODIES[strategy]
    max_retries = S4_MAX_RETRIES if strategy == "S4" else 0
    retries = n40001 = 0
    sqlstate = None
    await conn.execute(f"BEGIN ISOLATION LEVEL {iso}")   # BEGIN takes no snapshot yet
    await barrier.wait()
    t0 = time.perf_counter()
    attempt = 0
    while True:
        name = f"T{client_no}" + (f".{attempt}" if attempt else "")
        tx = Txn(sched, name, iso)
        try:
            await body(conn, usn, tx)
            tx.issue()
            await conn.execute("COMMIT")
            tx.end("c")
            outcome, sqlstate = "admitted", None
            break
        except Refused as r:
            await conn.execute("ROLLBACK")
            tx.end("a", "refused")
            outcome = "refused"
            sqlstate = getattr(r.__cause__, "sqlstate", None)
            break
        except asyncpg.PostgresError as e:
            refused_by_trigger = e.sqlstate in ("P0001", "23514") and "is full" in str(e)
            tx.end("a", "refused" if refused_by_trigger else e.sqlstate)
            sqlstate = e.sqlstate
            try:
                await conn.execute("ROLLBACK")
            except asyncpg.PostgresError:
                pass
            if e.sqlstate == "40001":
                n40001 += 1
            if e.sqlstate in ("40001", "40P01") and retries < max_retries:
                retries += 1
                attempt += 1
                await asyncio.sleep(random.uniform(0.001, 0.005) * (2 ** (retries - 1)))
                await conn.execute(f"BEGIN ISOLATION LEVEL {iso}")
                continue
            outcome = {"40001": "serialization_failure", "40P01": "deadlock"}.get(e.sqlstate, "error")
            if refused_by_trigger:
                outcome = "refused"
            break
    if outcome == "refused" and sqlstate is None:
        sqlstate = "APP"            # refused by the client's own check / no row / no seat
    return dict(client_no=client_no, outcome=outcome, sqlstate=sqlstate,
                latency_ms=(time.perf_counter() - t0) * 1000.0, retries=retries,
                n40001=n40001, t0=t0, t1=time.perf_counter())


async def run_trial(admin, logger, conns, strategy, iso, n, trial_no, log_schedule):
    await admin.execute("SELECT exp.reset_t02()")
    started_at = dt.datetime.now(dt.timezone.utc)
    sched = Schedule() if log_schedule else None
    barrier = asyncio.Barrier(n)
    res = await asyncio.wait_for(
        asyncio.gather(*(one_client(conns[i], strategy, iso, i + 1, barrier, sched) for i in range(n))),
        timeout=120)
    final_size, max_size = await admin.fetchrow(
        "SELECT (SELECT count(*) FROM team_member WHERE team_id = $1)::int,"
        "       (SELECT max_size FROM team WHERE team_id = $1)", TEAM)
    admitted = sum(r["outcome"] == "admitted" for r in res)
    refused = sum(r["outcome"] == "refused" for r in res)
    aborts = sum(r["n40001"] for r in res)
    duration = (max(r["t1"] for r in res) - min(r["t0"] for r in res)) * 1000.0
    async with logger.transaction():
        run_id = await logger.fetchval(
            "INSERT INTO exp.experiment_run (strategy, isolation, n_clients, trial_no, started_at,"
            " admitted, max_size, final_size, over_admitted, aborts_40001, refused, duration_ms)"
            " VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING run_id",
            strategy, iso, n, trial_no, started_at, admitted, max_size, final_size,
            final_size > max_size, aborts, refused, round(duration, 3))
        await logger.copy_records_to_table(
            "experiment_attempt", schema_name="exp",
            columns=["run_id", "client_no", "outcome", "sqlstate", "latency_ms", "retries"],
            records=[(run_id, r["client_no"], r["outcome"], r["sqlstate"],
                      round(r["latency_ms"], 3), r["retries"]) for r in res])
        if sched is not None:
            await logger.copy_records_to_table(
                "schedule_log", schema_name="exp",
                columns=["run_id", "seq", "txn", "op", "item", "logged_at"],
                records=[(run_id, *ev) for ev in sched.events])
    return admitted, final_size, max_size, refused, aborts


async def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--trials", type=int, default=30)
    ap.add_argument("--strategies", default=",".join(STRATEGIES))
    ap.add_argument("--isolations", default="RC,RR,SER")
    ap.add_argument("--ns", default=",".join(map(str, NS)))
    ap.add_argument("--fresh", action="store_true", help="truncate exp.* result tables first")
    a = ap.parse_args()
    iso_map = {"RC": "READ COMMITTED", "RR": "REPEATABLE READ", "SER": "SERIALIZABLE"}
    strategies = a.strategies.split(",")
    isolations = [iso_map[x] for x in a.isolations.split(",")]
    ns = [int(x) for x in a.ns.split(",")]

    admin = await asyncpg.connect(DSN, server_settings={"application_name": "race-admin"})
    logger = await asyncpg.connect(DSN, server_settings={"application_name": "race-logger"})
    if a.fresh:
        await admin.execute("TRUNCATE exp.experiment_run, exp.experiment_attempt, exp.schedule_log")
    conns = await asyncio.gather(*(asyncpg.connect(
        DSN, server_settings={"application_name": f"race-c{i + 1:03d}", "statement_timeout": "60s"})
        for i in range(max(ns))))
    t_all = time.perf_counter()
    try:
        for strategy in strategies:
            await admin.execute("SELECT exp.reset_t02()")
            await admin.execute("SELECT exp.use_strategy($1)", strategy)
            for iso in isolations:
                for n in ns:
                    t_cell = time.perf_counter()
                    over = 0
                    sizes: dict[int, int] = {}
                    for trial in range(1, a.trials + 1):
                        adm, fs, mx, ref, ab = await run_trial(
                            admin, logger, conns, strategy, iso, n, trial, log_schedule=(n == 2))
                        over += fs > mx
                        sizes[fs] = sizes.get(fs, 0) + 1
                        if adm != fs - 3:
                            print(f"  !! {strategy} {iso} N={n} t{trial}: admitted={adm} but size={fs}", flush=True)
                    print(f"{strategy} {iso:<15} N={n:<3} over-admitted {over:>3}/{a.trials}"
                          f"  final sizes {dict(sorted(sizes.items()))}  ({time.perf_counter() - t_cell:.1f}s)",
                          flush=True)
                    await admin.execute("VACUUM team, exp.team_counter, team_member")
    finally:
        await admin.execute("SELECT exp.reset_t02()")
        await admin.execute("SELECT exp.use_strategy('S1')")
        for c in conns:
            await c.close()
        await admin.close()
        await logger.close()
    print(f"total {time.perf_counter() - t_all:.1f}s", flush=True)


if __name__ == "__main__":
    if sys.version_info < (3, 11):
        sys.exit("needs Python 3.11+ (asyncio.Barrier)")
    asyncio.run(main())
