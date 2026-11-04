"""POST /race/run: auth (JWT + role), validation, the offline path, and (when the race lab
container elp-race-pg is up) one real race.

The offline test points RACE_DSN at a closed port, so it passes whether or not the container
runs. The live test is skipped when the lab does not answer; it never writes to the reported
results (exp.* tables) and leaves T02 at 3/4.
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
