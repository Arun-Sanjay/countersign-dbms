"""Countersign API (FastAPI). Every mark has a receipt.

Thin by design (docs/PLAN.md §5, fat DB / thin API): CRUD on relational data goes through
supabase-js under RLS. This service only does what Postgres cannot: MongoDB notes with
immutable versions, and a cross-database consistency check. Authorisation is always asked
of Postgres AS THE CALLER (PostgREST + the caller's JWT), never with a service key.

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

from . import notes as notes_mod
from .auth import Authenticator, Caller, Postgrest, problem, require_team, visible_teams
from .config import get_settings
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
              description="Every mark has a receipt. Unified Experiential Learning Platform — RVCE CD252IA.")

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

