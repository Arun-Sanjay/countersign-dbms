"""GET /ingest/trace: one push, both halves side by side (the demo's drill-down).

    ?delivery_id=<X-GitHub-Delivery>   from the admin inbox row
    ?contribution_id=<n>               from a live-feed item (its commit SHA -> the version's
                                       mongo_ref = the delivery id)

Who: admins and the teaching faculty of the push's team, decided by Postgres AS THE CALLER:
the ingest_event row is read with the caller's token, and its RLS policy (ingest_event_select:
admin, or teaches the team's project) answers. Invisible = 404, never a hint that it exists.

What: METADATA ONLY, the same tier faculty see elsewhere. From Mongo elp.github_events
(_id = delivery id): ref, before/after, sender, logged_at and per commit the SHA, credited
author USN, file paths, commit time and the AI flag; unattributed commits with a login only.
Never commit messages, file contents or e-mail addresses. From Postgres (as the caller, RLS):
the ingest_event row, the contribution rows whose source_ref is one of the push's SHAs, and
the artifact_version rows whose mongo_ref is the delivery id. `queries` shows exactly what ran.
"""

from __future__ import annotations

import re
from typing import Any

from pymongo.database import Database

from .auth import Caller, Postgrest, problem

DELIVERY_RE = re.compile(r"^[A-Za-z0-9._:-]{1,100}$")
FULL_SHA = re.compile(r"^[0-9a-f]{40}$")


def _delivery_for_contribution(pg: Postgrest, contribution_id: int) -> tuple[str | None, dict[str, Any]]:
    rows = pg.get("contribution", {
        "select": "contribution_id,usn,artifact_id,source,source_ref,occurred_at",
        "contribution_id": f"eq.{contribution_id}"})
    if not rows:
        raise problem(404, "not_found", f"No contribution {contribution_id} visible to you")
    k = rows[0]
    ref = (k.get("source_ref") or "").lower()
    if k.get("source") != "github" or not FULL_SHA.match(ref):
        return None, k
    versions = pg.get("artifact_version", {
        "select": "mongo_ref", "artifact_id": f"eq.{k['artifact_id']}", "source_ref": f"eq.{ref}"})
    return (versions[0].get("mongo_ref") if versions else None), k


def trace(db: Database, pg: Postgrest, who: Caller, delivery_id: str | None,
          contribution_id: int | None) -> dict[str, Any]:
    if who.role not in ("admin", "faculty"):
        raise problem(403, "staff_only", "Only admins and teaching faculty can trace a push")
    if bool(delivery_id) == bool(contribution_id):
        raise problem(422, "trace_target", "Give exactly one of delivery_id or contribution_id")
    origin: dict[str, Any] | None = None
    if contribution_id:
        delivery_id, origin = _delivery_for_contribution(pg, contribution_id)
        if not delivery_id:
            return {"delivery_id": None, "from_contribution": origin, "pipeline": False,
                    "note": "This contribution did not come through the webhook pipeline "
                            "(hand-entered or seeded): there is no raw event to show."}
    if not DELIVERY_RE.match(delivery_id or ""):
        raise problem(422, "delivery_id", "Malformed delivery id")

    events = pg.get("ingest_event", {
        "select": "delivery_id,event_type,repo_full_name,team_id,received_at,status,attempts,error,"
                  "mongo_id,commit_count,contribution_count,projected_at,followups_at,sender_login",
        "delivery_id": f"eq.{delivery_id}"})
    if not events:                                   # RLS: not an admin / not this team's faculty
        raise problem(404, "not_found", f"No delivery {delivery_id} visible to you")
    event = events[0]

    doc = db.github_events.find_one({"_id": delivery_id}, {
        "_id": 1, "team_id": 1, "repo": 1, "ref": 1, "before": 1, "after": 1, "sender": 1,
        "pushed_at": 1, "logged_at": 1,
        "commits.sha": 1, "commits.author_usn": 1, "commits.committed_at": 1, "commits.ai_assisted": 1,
        "commits.added": 1, "commits.modified": 1, "commits.removed": 1,
        "unattributed_commits.sha": 1, "unattributed_commits.author.username": 1,
        "unattributed_commits.added": 1, "unattributed_commits.modified": 1})
    mongo = None
    shas: list[str] = []
    if doc and doc.get("team_id") == event.get("team_id"):
        mongo = {k: doc.get(k) for k in ("_id", "repo", "ref", "before", "after", "sender", "pushed_at", "logged_at")}
        mongo["commits"] = doc.get("commits") or []
        mongo["unattributed_commits"] = doc.get("unattributed_commits") or []
        shas = [c["sha"] for c in mongo["commits"] if FULL_SHA.match(str(c.get("sha") or ""))]

    contributions: list[dict[str, Any]] = []
    if shas:
        contributions = pg.get_all("contribution", {
            "select": "contribution_id,usn,artifact_id,contribution_type,source_ref,occurred_at,created_at,"
                      "ai_assisted,artifact!inner(title,external_ref,team_id)",
            "source": "eq.github", "source_ref": f"in.({','.join(shas)})",
            "artifact.team_id": f"eq.{event['team_id']}", "order": "contribution_id"})
    versions = pg.get_all("artifact_version", {
        "select": "artifact_id,version_no,source_ref,created_by,created_at,content_hash,ai_assistance",
        "mongo_ref": f"eq.{delivery_id}", "order": "artifact_id,version_no"})

    by_sha: dict[str, list[dict[str, Any]]] = {}
    for k in contributions:
        by_sha.setdefault(k["source_ref"], []).append(k)
    commits = [{
        "sha": c["sha"], "author_usn": c.get("author_usn"), "committed_at": c.get("committed_at"),
        "ai_assisted": c.get("ai_assisted"),
        "files": sorted(set((c.get("added") or []) + (c.get("modified") or []) + (c.get("removed") or []))),
        "postgres_contributions": by_sha.get(c["sha"], []),
        "status": "matched" if by_sha.get(c["sha"]) else "no_rows",
    } for c in (mongo or {}).get("commits", [])]

    return {
        "delivery_id": delivery_id,
        "pipeline": True,
        "from_contribution": origin,
        "postgres": {"ingest_event": event, "artifact_versions": versions},
        "mongo": mongo,
        "commits": commits,
        "queries": {
            "postgres": [
                "SELECT * FROM ingest_event WHERE delivery_id = :delivery;          -- RLS: admin / teaching faculty",
                "SELECT contribution_id, usn, artifact_id, source_ref, occurred_at, ai_assisted\n"
                "FROM contribution JOIN artifact USING (artifact_id)\n"
                "WHERE source = 'github' AND source_ref = ANY(:shas) AND team_id = :team;",
                "SELECT artifact_id, version_no, source_ref, content_hash FROM artifact_version\n"
                "WHERE mongo_ref = :delivery;",
            ],
            "mongo": "db.github_events.findOne({ _id: delivery }, { 'commits.sha': 1, 'commits.author_usn': 1, "
                     "'commits.added': 1, 'commits.modified': 1, ... })   // no messages, no e-mail",
        },
    }
