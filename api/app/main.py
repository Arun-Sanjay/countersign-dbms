"""Countersign API (FastAPI). Every mark has a receipt.

Thin by design (docs/PLAN.md §5, fat DB / thin API): CRUD on relational data goes through
supabase-js under RLS. This service only does what Postgres cannot: MongoDB notes with
immutable versions, the ingestion worker (pgmq -> Mongo raw log -> Postgres projection), a
cross-database consistency check, and the permission-aware /ask. Authorisation is always
asked of Postgres AS THE CALLER (PostgREST + the caller's JWT). The one exception is
POST /ingest/drain: after checking that the caller is an admin, it runs the worker, whose
pipeline RPCs are service_role-only (app/worker.py). POST /race/run (faculty and admins) runs
one race of the Innovative Experiment in the separate race-lab container, never in the
product database (app/race.py).

Run:  cd api && uv run uvicorn app.main:app --reload --port 8000
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Annotated, Any

import httpx
from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pymongo import MongoClient

from pydantic import BaseModel, Field

from . import ask as ask_mod
from . import notes as notes_mod
from . import race as race_mod
from . import trace as trace_mod
from . import worker as worker_mod
from .auth import Authenticator, Caller, Postgrest, problem, require_team, visible_teams
from .config import ConfigError, get_settings
from .consistency import consistency as consistency_report


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    app.state.settings = settings
    app.state.http = httpx.Client(timeout=15)
    app.state.mongo = MongoClient(settings.mongodb_uri, tz_aware=True, appname="countersign-api",
                                  serverSelectionTimeoutMS=10_000)
    app.state.db = app.state.mongo[settings.mongo_db]
    app.state.auth = Authenticator(settings, app.state.http)
    try:
        yield
    finally:
        app.state.mongo.close()
        app.state.http.close()


app = FastAPI(title="Countersign API", version="0.1.0", lifespan=lifespan,
              description="Every mark has a receipt. Unified Experiential Learning and Project Intelligence Platform — RVCE CD252IA.")

# CORS is configured from settings at import time (origins only; no secrets involved).
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(get_settings().cors_origins),
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
    allow_credentials=False,
)


def caller(request: Request) -> Caller:
    return request.app.state.auth.caller(request)


def postgrest(request: Request, who: Annotated[Caller, Depends(caller)]) -> Postgrest:
    return Postgrest(request.app.state.settings, request.app.state.http, who.token)


CallerDep = Annotated[Caller, Depends(caller)]
PgDep = Annotated[Postgrest, Depends(postgrest)]


@app.get("/health")
def health(request: Request, response: Response) -> dict[str, Any]:
    s = request.app.state.settings
    out: dict[str, Any] = {"supabase_target": s.supabase_target, "mongo_target": s.mongo_target,
                           "mongo_db": s.mongo_db}
    try:
        # A real round trip without any user: ask for a table as anon. Postgres itself must
        # answer "permission denied" (42501): the DB is reachable AND anon is locked out.
        r = request.app.state.http.get(f"{s.supabase_url}/rest/v1/team",
                                       params={"select": "team_id", "limit": "1"},
                                       headers={"apikey": s.supabase_anon_key})
        code = r.json().get("code") if r.headers.get("content-type", "").startswith("application/json") \
            and isinstance(r.json(), dict) else None
        if code == "42501":
            out["postgres"] = "ok"
        elif r.status_code == 200:
            out["postgres"] = "error: anon can read team (RLS/grants missing)"
        else:
            out["postgres"] = f"error: PostgREST {r.status_code}"
    except httpx.HTTPError as exc:
        out["postgres"] = f"error: {type(exc).__name__}"
    try:
        request.app.state.mongo.admin.command("ping")
        out["mongo"] = "ok"
    except Exception as exc:  # noqa: BLE001 - report, never echo the URI
        out["mongo"] = f"error: {type(exc).__name__}"
    if out["postgres"] != "ok" or out["mongo"] != "ok":
        response.status_code = 503
    return out


@app.get("/notes")
def get_notes(request: Request, who: CallerDep, pg: PgDep,
              team_id: Annotated[str, Query(description="e.g. T01")]) -> dict[str, Any]:
    team = require_team(pg, who, team_id)
    items = notes_mod.list_notes(request.app.state.db, team, who)
    return {"team_id": team.team_id, "team_name": team.team_name, "access": team.access,
            "count": len(items), "notes": items}


@app.get("/notes/{note_id}/versions")
def get_note_versions(request: Request, note_id: str, who: CallerDep, pg: PgDep) -> dict[str, Any]:
    db = request.app.state.db
    stored = db.notes.find_one({"note_id": note_id}, {"_id": 0, "team_id": 1})
    if stored is None:
        raise problem(404, "note_not_found", f"No note {note_id}")
    try:
        team = require_team(pg, who, stored["team_id"])
    except HTTPException as exc:
        # do not reveal which team an invisible note belongs to
        if exc.status_code in (403, 404):
            raise problem(404, "note_not_found", f"No note {note_id}")
        raise
    note = notes_mod.find_visible_note(db, note_id, team, who)
    if note is None:
        raise problem(404, "note_not_found", f"No note {note_id}")
    versions = notes_mod.list_versions(db, note, team)
    return {"note_id": note_id, "team_id": team.team_id, "current_version": note.get("version"),
            "count": len(versions), "versions": versions}


@app.post("/notes", status_code=201)
def post_note(request: Request, body: notes_mod.NoteIn, who: CallerDep, pg: PgDep) -> JSONResponse:
    team = require_team(pg, who, body.team_id)
    note, created = notes_mod.save_note(request.app.state.mongo, request.app.state.db, body, team, who)
    return JSONResponse(status_code=201 if created else 200,
                        content=jsonable_encoder({"created": created, "note": note}))


@app.get("/consistency")
def get_consistency(request: Request, who: CallerDep, pg: PgDep,
                    team_id: Annotated[str | None, Query()] = None) -> dict[str, Any]:
    teams = [require_team(pg, who, team_id)] if team_id else visible_teams(pg, who)
    report = consistency_report(request.app.state.db, pg, teams)
    return {"role": who.role, "teams": report,
            "all_consistent": all(t["consistent"] for t in report)}



# ---------------------------------------------------------------- ingestion ("sync now")

class DrainIn(BaseModel):
    max_messages: int = Field(default=100, ge=1, le=500)
    vt: int = Field(default=worker_mod.DEFAULT_VT, ge=5, le=3600,
                    description="visibility timeout (s): how long a failed message stays hidden before a retry")


@app.post("/ingest/drain")
def ingest_drain(request: Request, who: CallerDep, body: DrainIn | None = None) -> dict[str, Any]:
    """Admin only: drain the github_ingest queue now (the demo's "sync now" button).
    The role comes from app_user, read as the caller under RLS (see auth.py)."""
    if who.role != "admin":
        raise problem(403, "admin_required", "Only an admin can run the ingestion worker")
    body = body or DrainIn()
    s = request.app.state.settings
    try:
        store = worker_mod.make_store(s, request.app.state.http)
    except ConfigError as exc:
        raise problem(503, "worker_unconfigured", str(exc))
    except worker_mod.StoreError as exc:
        raise problem(502, "postgres_unavailable", str(exc))
    try:
        w = worker_mod.Worker(store, request.app.state.mongo, request.app.state.db, s, request.app.state.http)
        summary = w.drain(max_messages=body.max_messages, vt=body.vt)
    except worker_mod.StoreError as exc:
        raise problem(502, "postgres_error", str(exc))
    finally:
        if isinstance(store, worker_mod.SqlStore):
            store.close()
    return jsonable_encoder(summary)


@app.get("/ingest/trace")
def ingest_trace(request: Request, who: CallerDep, pg: PgDep,
                 delivery_id: Annotated[str | None, Query(max_length=100)] = None,
                 contribution_id: Annotated[int | None, Query(ge=1)] = None) -> dict[str, Any]:
    """Admins / teaching faculty: one push in the Mongo raw log next to its Postgres rows
    (metadata only; RLS on ingest_event decides, see app/trace.py)."""
    return jsonable_encoder(trace_mod.trace(request.app.state.db, pg, who, delivery_id, contribution_id))


@app.get("/ingest/status")
def ingest_status(who: CallerDep, pg: PgDep) -> dict[str, Any]:
    """Pipeline health for staff: deliveries by status (as the caller: RLS shows admins every
    team, faculty the teams they teach), and how many are still waiting for the worker. A
    non-zero `waiting` with nothing moving means no worker is running (see docs/INGESTION.md)."""
    if who.role not in ("admin", "faculty"):
        raise problem(403, "staff_only", "Only admins and teaching faculty can see pipeline health")
    rows = pg.get_all("ingest_event", {"select": "status,received_at", "order": "delivery_id"})
    by: dict[str, int] = {}
    for r in rows:
        by[r["status"]] = by.get(r["status"], 0) + 1
    waiting = [r["received_at"] for r in rows if r["status"] in ("queued", "raw_stored", "failed")]
    return {"by_status": by, "waiting": len(waiting), "oldest_waiting": min(waiting) if waiting else None}


# ---------------------------------------------------------------- permission-aware answers

@app.post("/ask")
def post_ask(request: Request, body: ask_mod.AskIn, who: CallerDep, pg: PgDep) -> dict[str, Any]:
    st = request.app.state
    return jsonable_encoder(ask_mod.ask(st.settings, st.http, pg, who, body, st))


# ---------------------------------------------------------------- race arena (Component 10)

@app.post("/race/run")
async def race_run(body: race_mod.RaceIn, who: CallerDep) -> dict[str, Any]:
    """Faculty and admins: run ONE race of the Innovative Experiment (N clients, one free seat
    in T02) against the throwaway race lab elp-race-pg (port 55433), with the harness's own code.
    503 race_lab_offline when the container is down (start it with experiments/race/setup.sh);
    409 race_busy while another race or the harness is running. Nothing is written to the
    reported results; T02 is reset to 3/4 afterwards."""
    race_mod.require_staff(who)
    return await race_mod.run_race(body)
