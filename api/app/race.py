"""POST /race/run: one live race of the Innovative Experiment (Component 10), on demand.

N clients race for Team Beta (T02)'s last seat (3/4) in the throwaway container
`elp-race-pg` (port 55433, database `race`, loaded by experiments/race/setup.sh). This is
NOT the product database: the race lab is a separate PostgreSQL that holds a copy of the
graded fixture plus schema `exp` (the strategy objects).

The race logic is not copied here. experiments/race/harness.py is imported as a module, so
the live panel runs exactly the code that produced the reported 72,000 races: the strategy
bodies (BODIES), the per-client transaction with BEGIN ISOLATION LEVEL + asyncio.Barrier +
classification (one_client) and, for N = 2, the logical schedule recorder (Schedule).

Differences from the harness's own run_trial, on purpose:
  * nothing is written to exp.experiment_run / experiment_attempt / schedule_log, so a live
    race never changes the reported results;
  * T02 is put back to 3/4 and the default strategy (S1, as the harness leaves it) is
    restored afterwards, whatever happened;
  * one race at a time: a second request, or a harness run in progress, gets 409.

Configuration: RACE_DSN (default postgresql://postgres:localdev@localhost:55433/race, the
throwaway container's documented local password). The DSN is never returned or logged; errors
name only host:port/database.
"""

from __future__ import annotations

import asyncio
import importlib.util
import time
from functools import lru_cache
from types import ModuleType
from typing import Any, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, Field

from .auth import Caller, problem
from .config import ROOT, _env

DEFAULT_DSN = "postgresql://postgres:localdev@localhost:55433/race"
HARNESS = ROOT / "experiments" / "race" / "harness.py"
START_HINT = "experiments/race/setup.sh"
ISOLATIONS = {"RC": "READ COMMITTED", "RR": "REPEATABLE READ", "SER": "SERIALIZABLE"}
CONNECT_TIMEOUT = 3.0
RACE_TIMEOUT = 60.0
# application_name of the harness's own connections (a harness run must not be disturbed)
HARNESS_APPS = ("race-admin", "race-logger")
LIVE_ADMIN_APP = "race-live-admin"

_lock = asyncio.Lock()


class RaceIn(BaseModel):
    strategy: Literal["S1", "S2", "S3", "S4", "S6", "S7"]
    isolation: Literal["RC", "RR", "SER"]
    n: int = Field(ge=2, le=100, description="number of racing clients (the harness matrix uses 2, 8, 32, 100)")


class RaceLabOffline(Exception):
    """The race container is down or not loaded."""


def race_dsn() -> str:
    return _env().get("RACE_DSN") or DEFAULT_DSN


def dsn_target(dsn: str) -> str:
    """host:port/database, never the user or password."""
    u = urlsplit(dsn)
    return f"{u.hostname or 'localhost'}:{u.port or 5432}/{(u.path or '/').lstrip('/') or 'postgres'}"


@lru_cache(maxsize=1)
def harness() -> ModuleType:
    """experiments/race/harness.py, imported once (its main() only runs as a script)."""
    spec = importlib.util.spec_from_file_location("race_harness", HARNESS)
    if spec is None or spec.loader is None:
        raise FileNotFoundError(str(HARNESS))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def offline_problem(target: str, why: str):
    return problem(503, "race_lab_offline",
                   f"Race lab offline: {why} at {target}. Start it with {START_HINT} "
                   f"(container elp-race-pg, port 55433, about 5 s), then try again.")


async def _connect(asyncpg: Any, dsn: str, app_name: str, **settings: str):
    return await asyncpg.connect(dsn, timeout=CONNECT_TIMEOUT,
                                 server_settings={"application_name": app_name, **settings})


async def run_race(body: RaceIn) -> dict[str, Any]:
    """One race. Raises HTTPException (503 offline, 409 busy, 502 race error)."""
    try:
        h = harness()
    except (FileNotFoundError, ImportError) as exc:
        raise problem(503, "race_lab_offline",
                      f"Race lab offline: experiments/race/harness.py could not be loaded ({type(exc).__name__}).")
    import asyncpg  # the harness imported it already; this is the same module

    dsn = race_dsn()
    target = dsn_target(dsn)
    if _lock.locked():
        raise problem(409, "race_busy", "Another live race is running. Try again in a moment.")
    async with _lock:
        try:
            admin = await _connect(asyncpg, dsn, LIVE_ADMIN_APP)
        except (OSError, asyncio.TimeoutError, asyncpg.CannotConnectNowError) as exc:
            raise offline_problem(target, f"no PostgreSQL answered ({type(exc).__name__})")
        except asyncpg.InvalidCatalogNameError:
            raise offline_problem(target, "the database does not exist")
        except asyncpg.PostgresError as exc:
            raise offline_problem(target, f"the server refused the connection ({exc.sqlstate})")
        conns: list[Any] = []
        try:
            ready = await admin.fetchval("SELECT to_regproc('exp.use_strategy') IS NOT NULL "
                                         "AND to_regproc('exp.reset_t02') IS NOT NULL")
            if not ready:
                raise offline_problem(target, "schema exp is not loaded")
            busy = await admin.fetchval(
                "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() "
                "AND (application_name = ANY ($1::text[]) OR (application_name = $2 AND pid <> pg_backend_pid()))",
                list(HARNESS_APPS), LIVE_ADMIN_APP)
            if busy:
                raise problem(409, "race_busy",
                              "The race harness (or another API) is using the race lab right now. Try again when it finishes.")

            iso = ISOLATIONS[body.isolation]
            await admin.execute("SELECT exp.reset_t02()")
            await admin.execute("SELECT exp.use_strategy($1)", body.strategy)
            conns = list(await asyncio.gather(*(
                _connect(asyncpg, dsn, f"race-live-c{i + 1:03d}", statement_timeout="30s")
                for i in range(body.n))))
            sched = h.Schedule() if body.n == 2 else None
            barrier = asyncio.Barrier(body.n)
            t0 = time.perf_counter()
            res = await asyncio.wait_for(
                asyncio.gather(*(h.one_client(conns[i], body.strategy, iso, i + 1, barrier, sched)
                                 for i in range(body.n))),
                timeout=RACE_TIMEOUT)
            wall_ms = (time.perf_counter() - t0) * 1000.0
            final_size, max_size = await admin.fetchrow(
                "SELECT (SELECT count(*) FROM team_member WHERE team_id = $1)::int,"
                "       (SELECT max_size FROM team WHERE team_id = $1)", h.TEAM)
        except (OSError, asyncpg.ConnectionDoesNotExistError, asyncpg.InterfaceError) as exc:
            raise offline_problem(target, f"the connection was lost during the race ({type(exc).__name__})")
        except asyncio.TimeoutError:
            raise problem(502, "race_error", f"The race did not finish within {RACE_TIMEOUT:.0f} s.")
        except asyncpg.PostgresError as exc:
            raise problem(502, "race_error", f"The race lab answered {exc.sqlstate}: {type(exc).__name__}")
        finally:
            for c in conns:
                try:
                    await c.close(timeout=5)
                except Exception:  # noqa: BLE001 - best effort; terminate below
                    c.terminate()
            try:
                if not admin.is_closed():
                    await admin.execute("SELECT exp.reset_t02()")
                    await admin.execute("SELECT exp.use_strategy('S1')")
            except Exception:  # noqa: BLE001 - the next race resets T02 first anyway
                pass
            await admin.close()

    clients = sorted(({"client_no": r["client_no"], "outcome": r["outcome"], "sqlstate": r["sqlstate"],
                       "latency_ms": round(r["latency_ms"], 3), "retries": r["retries"]} for r in res),
                     key=lambda c: c["client_no"])
    count = {o: sum(c["outcome"] == o for c in clients)
             for o in ("admitted", "refused", "serialization_failure", "deadlock", "error")}
    schedule = None
    if sched is not None:
        schedule = [{"seq": seq, "txn": txn, "op": op, "item": item}
                    for seq, txn, op, item, _ in sorted(sched.events, key=lambda e: e[0])]
    return {
        "strategy": body.strategy,
        "isolation": body.isolation,
        "isolation_name": iso,
        "n": body.n,
        "admitted": count["admitted"],
        "refused": count["refused"],
        # aborted = the DBMS killed the transaction for good (40001 / 40P01); retried aborts that
        # later succeeded or were refused are counted in aborts_40001 instead
        "aborted": count["serialization_failure"] + count["deadlock"],
        "errors": count["error"],
        "aborts_40001": sum(r["n40001"] for r in res),
        "retries": sum(c["retries"] for c in clients),
        "final_size": final_size,
        "max_size": max_size,
        "over_admitted": final_size > max_size,
        "duration_ms": round(wall_ms, 3),
        "clients": clients,
        "schedule": schedule,
        "lab": target,
    }


def require_staff(who: Caller) -> None:
    if who.role not in ("admin", "faculty"):
        raise problem(403, "staff_only", "Only faculty and admins can run a live race")
