"""POST /race/run: auth (JWT + role), validation, the offline path, and (when the race lab
container elp-race-pg is up) one real race.

The offline test points RACE_DSN at a closed port, so it passes whether or not the container
runs. The live test is skipped when the lab does not answer; it never writes to the reported
results (exp.* tables) and leaves T02 at 3/4. The lab-ownership tests run run_race against
a fake harness and a fake admin connection (no network): a request refused with 409 must
never reset T02 or the strategy under someone else's race.
"""

from __future__ import annotations

import socket

import pytest

from app import race as race_mod

BODY = {"strategy": "S2", "isolation": "RR", "n": 2}


def _lab_up() -> bool:
    try:
        with socket.create_connection(("127.0.0.1", 55433), timeout=1):
            return True
    except OSError:
        return False


def test_race_requires_a_token(client):
    r = client.post("/race/run", json=BODY)
    assert r.status_code == 401
    assert r.json()["detail"]["code"] == "auth_required"
    r = client.post("/race/run", json=BODY, headers={"Authorization": "Bearer not-a-jwt"})
    assert r.status_code == 401
    assert r.json()["detail"]["code"] == "invalid_token"


@pytest.mark.parametrize("who", ["arun", "meera"])
def test_race_is_staff_only(client, auth, who):
    r = client.post("/race/run", json=BODY, headers=auth(who))
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "staff_only"


@pytest.mark.parametrize("bad", [
    {"strategy": "S5", "isolation": "RR", "n": 2},      # there is no S5
    {"strategy": "S2", "isolation": "SNAPSHOT", "n": 2},
    {"strategy": "S2", "isolation": "RR", "n": 1},
    {"strategy": "S2", "isolation": "RR", "n": 101},
])
def test_race_validates_the_body(client, auth, bad):
    assert client.post("/race/run", json=bad, headers=auth("ramesh")).status_code == 422


@pytest.mark.parametrize("who", ["ramesh", "admin"])
def test_race_lab_offline_is_503_with_how_to_start_it(client, auth, monkeypatch, who):
    # a port nothing listens on: the same answer as a stopped container
    monkeypatch.setenv("RACE_DSN", "postgresql://postgres:unused@127.0.0.1:1/race")
    r = client.post("/race/run", json=BODY, headers=auth(who))
    assert r.status_code == 503
    detail = r.json()["detail"]
    assert detail["code"] == "race_lab_offline"
    assert "experiments/race/setup.sh" in detail["message"]
    assert "unused" not in detail["message"], "the DSN password must never be echoed"


def test_dsn_target_never_shows_credentials():
    assert race_mod.dsn_target("postgresql://postgres:secret@db.example:6543/race") == "db.example:6543/race"


@pytest.mark.skipif(not _lab_up(), reason="race lab (elp-race-pg, port 55433) is not running")
def test_live_race_counts_add_up(client, auth, monkeypatch):
    monkeypatch.delenv("RACE_DSN", raising=False)
    r = client.post("/race/run", json={"strategy": "S7", "isolation": "RC", "n": 8}, headers=auth("ramesh"))
    if r.status_code == 409:
        pytest.skip("the race harness is using the lab")
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["n"] == 8 and len(out["clients"]) == 8
    assert out["admitted"] + out["refused"] + out["aborted"] + out["errors"] == 8
    assert out["final_size"] == 3 + out["admitted"]
    # S7 (write the parent row) never over-admitted in 72,000 reported races
    assert out["admitted"] == 1 and not out["over_admitted"]
    assert out["schedule"] is None                      # schedules are recorded for N = 2 only

    r = client.post("/race/run", json={"strategy": "S1", "isolation": "RC", "n": 2}, headers=auth("admin"))
    assert r.status_code == 200, r.text
    two = r.json()
    ops = {(e["txn"], e["op"]) for e in two["schedule"]}
    assert ("T1", "r") in ops and ("T2", "r") in ops


# ---------------------------------------------------------------- lab ownership (no network)

class _FakeAdmin:
    """The admin connection of run_race: answers the readiness and busy checks, records
    every statement it is asked to execute."""

    def __init__(self, busy: int):
        self.busy = busy
        self.executed: list[str] = []
        self.closed = False

    async def fetchval(self, sql: str, *args):
        return self.busy if "pg_stat_activity" in sql else True

    async def execute(self, sql: str, *args):
        self.executed.append(sql if not args else f"{sql} {args}")

    async def fetchrow(self, sql: str, *args):
        return (4, 4)

    def is_closed(self) -> bool:
        return self.closed

    async def close(self, timeout: float | None = None) -> None:
        self.closed = True


class _FakeClient:
    async def close(self, timeout: float | None = None) -> None:
        pass

    def terminate(self) -> None:
        pass


def _fake_lab(monkeypatch, busy: int) -> _FakeAdmin:
    import types

    admin = _FakeAdmin(busy)

    async def connect(_asyncpg, _dsn, app_name, **_settings):
        return admin if app_name == race_mod.LIVE_ADMIN_APP else _FakeClient()

    async def one_client(_conn, _strategy, _iso, client_no, _barrier, _sched):
        return {"client_no": client_no, "outcome": "admitted" if client_no == 1 else "refused",
                "sqlstate": None, "latency_ms": 1.0, "retries": 0, "n40001": 0}

    class Schedule:
        def __init__(self):
            self.events: list = []

    fake = types.SimpleNamespace(TEAM="T02", Schedule=Schedule, one_client=one_client)
    monkeypatch.setattr(race_mod, "harness", lambda: fake)
    monkeypatch.setattr(race_mod, "_connect", connect)
    monkeypatch.setenv("RACE_DSN", "postgresql://postgres:unused@127.0.0.1:1/race")
    return admin


def test_a_busy_request_never_resets_the_lab(monkeypatch):
    """409 race_busy: the lab belongs to someone else (the harness or another API), so this
    request must not run exp.reset_t02() / use_strategy('S1') under their race."""
    import asyncio

    from fastapi import HTTPException

    admin = _fake_lab(monkeypatch, busy=1)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(race_mod.run_race(race_mod.RaceIn(**BODY)))
    assert exc.value.status_code == 409 and exc.value.detail["code"] == "race_busy"
    assert admin.executed == []
    assert admin.closed


def test_the_owner_resets_the_lab_before_and_after(monkeypatch):
    import asyncio

    admin = _fake_lab(monkeypatch, busy=0)
    out = asyncio.run(race_mod.run_race(race_mod.RaceIn(**BODY)))
    assert out["admitted"] == 1 and out["refused"] == 1 and out["final_size"] == 4
    assert admin.executed == ["SELECT exp.reset_t02()", "SELECT exp.use_strategy($1) ('S2',)",
                              "SELECT exp.reset_t02()", "SELECT exp.use_strategy('S1')"]
    assert admin.closed
