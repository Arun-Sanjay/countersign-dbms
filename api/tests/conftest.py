"""Test fixtures: real local Supabase (personas) + real MongoDB (Atlas by default).

Mongo isolation: tests never write to the demo database. A scratch database
(ELP_TEST_MONGO_DB, default elp_api_test) is seeded with the fixture's M1/M2 documents,
then mongo/validators.js is applied to it (collMod + note_versions backfill), exactly as on
'elp'. It is dropped at the end of the session.
Set MONGO_TARGET=local to use the docker container elp-mongo-local instead of Atlas.
"""

from __future__ import annotations

import os
import subprocess
from datetime import datetime

import httpx
import pytest

TEST_DB = os.environ.get("ELP_TEST_MONGO_DB", "elp_api_test")
assert TEST_DB != "elp", "tests must not run against the demo database"
os.environ["MONGO_DB"] = TEST_DB
os.environ.setdefault("SUPABASE_TARGET", "local")

from app.config import ROOT, get_settings  # noqa: E402  (env must be set first)

PASSWORD = "Countersign@2026"


def _d(s: str) -> datetime:
    return datetime.fromisoformat(s)


# Same documents as mongo/04_mongo.js M1 and M2 (the frozen fixture), as Python.
NOTES = [
    {"note_id": "N01", "team_id": "T01", "author_usn": "1RV24CY047", "title": "Synopsis outline",
     "tags": ["synopsis", "planning"], "links": ["Literature survey"], "status": "final", "version": 3,
     "content": "Problem statement and proposed system for the unified EL platform.", "created_at": _d("2026-10-09")},
    {"note_id": "N02", "team_id": "T01", "author_usn": "1RV24CY011", "title": "Literature survey",
     "tags": ["research", "provenance"], "links": ["Synopsis outline"], "status": "final", "version": 2,
     "content": "Data provenance research tracks who changed each record and when.", "created_at": _d("2026-10-07")},
    {"note_id": "N03", "team_id": "T01", "author_usn": "1RV24CY024", "title": "ER diagram decisions",
     "tags": ["er-diagram", "design", "todo"], "links": ["Normalization plan"], "status": "draft", "version": 1,
     "content": "MILESTONE is a weak entity of PROJECT. TEAM_MEMBER resolves M:N.", "created_at": _d("2026-10-29")},
    {"note_id": "N04", "team_id": "T01", "author_usn": "1RV24CY047", "title": "Normalization plan",
     "tags": ["normalization", "design"], "status": "draft", "version": 1,
     "content": "Start from the paper marks sheet and normalize up to BCNF.", "created_at": _d("2026-11-02")},
    {"note_id": "N05", "team_id": "T02", "author_usn": "1RV24CY041", "title": "Requirements notes",
     "tags": ["requirements", "todo"], "links": [], "status": "final", "version": 2,
     "content": "Functional and non functional requirements gathered from faculty.", "created_at": _d("2026-10-24")},
    {"note_id": "N06", "team_id": "T02", "author_usn": "1RV24CY052", "title": "Synopsis review",
     "tags": ["synopsis", "review"], "status": "draft", "version": 1,
     "content": "Comments on the synopsis draft.", "created_at": _d("2026-10-15")},
    {"note_id": "N07", "team_id": "T03", "author_usn": "1RV24CY063", "title": "Model baseline",
     "tags": ["ml", "research"], "links": ["Dataset survey"], "status": "final", "version": 4,
     "content": "Baseline model and evaluation metrics.", "created_at": _d("2026-10-20")},
]

EVENTS = [
    {"event_id": "E01", "team_id": "T01", "repo": "rvce-el/team-alpha", "type": "push", "pushed_at": _d("2026-10-31"),
     "commits": [{"sha": "a1f3", "author_usn": "1RV24CY047", "message": "Add CREATE TABLE scripts", "files_changed": 4, "additions": 210},
                 {"sha": "b7c2", "author_usn": "1RV24CY024", "message": "Add foreign keys", "files_changed": 2, "additions": 45}]},
    {"event_id": "E02", "team_id": "T01", "repo": "rvce-el/team-alpha", "type": "push", "pushed_at": _d("2026-11-01"),
     "commits": [{"sha": "c9d1", "author_usn": "1RV24CY024", "message": "Add CHECK constraints", "files_changed": 1, "additions": 30},
                 {"sha": "d4e8", "author_usn": "1RV24CY047", "message": "Seed sample data", "files_changed": 2, "additions": 160},
                 {"sha": "e2a9", "author_usn": "1RV24CY011", "message": "Update ER diagram notes", "files_changed": 1, "additions": 25}]},
    {"event_id": "E03", "team_id": "T03", "repo": "rvce-el/team-gamma", "type": "push", "pushed_at": _d("2026-11-02"),
     "commits": [{"sha": "f1b4", "author_usn": "1RV24CY063", "message": "Data loader", "files_changed": 3, "additions": 120},
                 {"sha": "a8c3", "author_usn": "1RV24CY066", "message": "Training loop", "files_changed": 2, "additions": 95}]},
]


@pytest.fixture(scope="session")
def settings():
    get_settings.cache_clear()
    return get_settings()


@pytest.fixture(scope="session")
def mongo_db(settings):
    from pymongo import MongoClient

    client = MongoClient(settings.mongodb_uri, tz_aware=True, serverSelectionTimeoutMS=15_000)
    client.drop_database(TEST_DB)
    db = client[TEST_DB]
    db.notes.insert_many([dict(n) for n in NOTES])
    db.github_events.insert_many([dict(e) for e in EVENTS])
    # Apply the real validators + indexes + backfill to the scratch database.
    script = f"var ELP_DB = {TEST_DB!r};\n" + (ROOT / "mongo" / "validators.js").read_text()
    proc = subprocess.run(["npx", "-y", "mongosh@latest", settings.mongodb_uri, "--quiet"],
                          input=script, capture_output=True, text=True, timeout=240)
    assert '"invalid":0' in proc.stdout and "Error" not in proc.stdout, "validators.js failed on the test db"
    yield db
    client.drop_database(TEST_DB)
    client.close()


@pytest.fixture(scope="session")
def client(settings, mongo_db):
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="session")
def tokens(settings) -> dict[str, str]:
    out = {}
    with httpx.Client(timeout=15) as http:
        for who in ("arun", "sanvid", "nikhil", "meera", "ramesh", "lakshmi", "admin"):
            r = http.post(f"{settings.supabase_url}/auth/v1/token", params={"grant_type": "password"},
                          headers={"apikey": settings.supabase_anon_key},
                          json={"email": f"{who}@example.edu", "password": PASSWORD})
            assert r.status_code == 200, f"persona {who} cannot sign in; run scripts/create_personas.py --target local"
            out[who] = r.json()["access_token"]
    return out


@pytest.fixture
def auth(tokens):
    return lambda who: {"Authorization": f"Bearer {tokens[who]}"}


@pytest.fixture
def teamless(settings, tokens):
    """Make a student persona teamless before a test that needs one, whatever ran before.

    The e2e suite (web/e2e/04) makes nikhil join T02, and nothing resets the database
    afterwards; so a test that relies on "nikhil has no team" sets that up itself, as nikhil,
    through the same leave_team RPC the app uses (it refuses to drop recorded history).
    """
    usns = {"nikhil": "1RV24CY077"}

    def ensure(who: str) -> str:
        headers = {"apikey": settings.supabase_anon_key, "Authorization": f"Bearer {tokens[who]}"}
        with httpx.Client(base_url=f"{settings.supabase_url}/rest/v1", headers=headers, timeout=15) as http:
            r = http.get("/team_member", params={"select": "team_id", "usn": f"eq.{usns[who]}"})
            assert r.status_code == 200, r.text
            for row in r.json():
                left = http.post("/rpc/leave_team", json={"p_team_id": row["team_id"]})
                assert left.status_code == 200, f"{who} cannot leave {row['team_id']}: {left.text}"
            r = http.get("/team_member", params={"select": "team_id", "usn": f"eq.{usns[who]}"})
            assert r.json() == [], f"{who} still has a team: {r.text}"
        return who

    return ensure
