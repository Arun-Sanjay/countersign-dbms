"""Cross-database consistency: the Mongo raw log vs the Postgres projection, per team and author.

The projection contract (docs/PLAN.md §2 item 8) says every push in the raw log
(elp.github_events, _id = delivery id) is projected into Postgres `contribution` rows with
source = 'github' and source_ref = the full commit SHA. This check verifies exactly that:

  Mongo     commits of the pipeline's events (documents that carry a delivery_id), per author:
            db.github_events.find({team_id: {$in: teams}}, {delivery_id, commits.sha,
            commits.author_usn, commits.added/modified/removed}); the grouping below is Python.
            Only CREDITED commits are in commits[] (author = the verified pusher, on the team);
            the others sit in unattributed_commits and are not expected in Postgres.
            A commit is EXPECTED in Postgres when it touched at least one tracked path
            (app.ingest_rules.artifact_type + path_allowed: mirrors of the SQL rules
            project_push uses, including the repo's team_repo.track_paths allow-list).
            A commit that touched only untracked files (package.json, images, ...) produces no
            row by design and is listed as `not_projected`, not as a discrepancy.
  Postgres  github contributions read through PostgREST AS THE CALLER (RLS applies), page by
            page (max_rows is 1000), grouped by the SHA in source_ref. The unit compared is
            the COMMIT: one contribution row exists per (commit, author, artifact), so
            postgres_commits (distinct SHAs) is the column to read against mongo_commits;
            postgres_github_contributions (rows, one per file) is kept for reference.

Per author:  matched           SHAs in both
             only_in_mongo     expected in Postgres but missing (projection pending or lost)
             only_in_postgres  a full SHA in Postgres with no raw event in the log
Evidence that never went through the pipeline is reported separately as `outside_pipeline`
and is not a discrepancy: Mongo events without a delivery_id (the fixture's M2 pushes) and
Postgres rows whose source_ref is not a full 40-hex SHA (hand-entered or seeded demo rows;
the pipeline always writes full SHAs).

Only counts and SHAs are returned (metadata), never commit messages, so staff see the same.
"""

from __future__ import annotations

import re
from collections import Counter, defaultdict
from typing import Any

from pymongo.database import Database

from .auth import Postgrest, TeamAccess
from .ingest_rules import artifact_type, path_allowed

FULL_SHA = re.compile(r"^[0-9a-f]{40}$")


def _tracked(commit: dict[str, Any], known_paths: set[str], prefixes: list[str] | None = None) -> bool:
    def ok(p: str) -> bool:
        return bool(artifact_type(p)) and path_allowed(p, prefixes)
    if any(ok(p) for p in (commit.get("added") or []) + (commit.get("modified") or [])):
        return True
    # a removed path counts only when its artifact exists, i.e. the log saw the path before
    return any(ok(p) and p in known_paths for p in commit.get("removed") or [])


def _allow_lists(pg: Postgrest, ids: list[str]) -> dict[str, list[str] | None]:
    """team -> the union of its repositories' track_paths (None = no allow-list), read as the
    caller (team_repo RLS: members and the project's staff)."""
    try:
        rows = pg.get("team_repo", {"select": "team_id,track_paths", "team_id": f"in.({','.join(ids)})"})
    except Exception:  # noqa: BLE001 - an older schema without team_repo: no allow-lists
        return {}
    out: dict[str, list[str] | None] = {}
    for r in rows:
        t, paths = r["team_id"], r.get("track_paths")
        if paths is None or out.get(t, []) is None:
            out[t] = None
        else:
            out[t] = [*(out.get(t) or []), *paths]
    return out


def _author_status(pipeline: bool, only_m: list[str], only_p: list[str]) -> str:
    if not pipeline:
        return "outside_pipeline"
    if only_m and only_p:
        return "mismatch"
    if only_m:
        return "only_in_mongo"
    if only_p:
        return "only_in_postgres"
    return "consistent"


def consistency(db: Database, pg: Postgrest, teams: list[TeamAccess]) -> list[dict[str, Any]]:
    if not teams:
        return []
    ids = [t.team_id for t in teams]

    # ---- Mongo: the raw log ----
    allow = _allow_lists(pg, ids)
    events = list(db.github_events.find(
        {"team_id": {"$in": ids}},
        {"_id": 0, "team_id": 1, "delivery_id": 1, "commits.sha": 1, "commits.author_usn": 1,
         "commits.added": 1, "commits.modified": 1, "commits.removed": 1}))
    known_paths: dict[str, set[str]] = defaultdict(set)
    for ev in events:
        if ev.get("delivery_id"):
            for c in ev.get("commits") or []:
                known_paths[ev["team_id"]].update((c.get("added") or []) + (c.get("modified") or []))
    expected: dict[tuple[str, str], set[str]] = defaultdict(set)      # pipeline, tracked paths
    untracked: dict[tuple[str, str], set[str]] = defaultdict(set)     # pipeline, nothing to project
    legacy_m: dict[tuple[str, str], set[str]] = defaultdict(set)      # not from the pipeline
    for ev in events:
        team = ev["team_id"]
        for c in ev.get("commits") or []:
            key, sha = (team, c.get("author_usn")), str(c.get("sha") or "").lower()
            if not ev.get("delivery_id"):
                legacy_m[key].add(sha)
            elif _tracked(c, known_paths[team], allow.get(team)):
                expected[key].add(sha)
            else:
                untracked[key].add(sha)

    # ---- Postgres, as the caller ----
    rows = pg.get_all("contribution", {
        "select": "usn,source_ref,artifact!inner(team_id)",
        "source": "eq.github",
        "artifact.team_id": f"in.({','.join(ids)})",
        "order": "contribution_id",
    })
    pg_rows: Counter[tuple[str, str]] = Counter()
    pg_full: dict[tuple[str, str], set[str]] = defaultdict(set)
    legacy_p: Counter[tuple[str, str]] = Counter()
    for r in rows:
        key, ref = (r["artifact"]["team_id"], r["usn"]), (r.get("source_ref") or "").lower()
        pg_rows[key] += 1
        if FULL_SHA.match(ref):
            pg_full[key].add(ref)
        else:
            legacy_p[key] += 1

    # pipeline health, where RLS lets the caller see it (admins, teaching faculty)
    health: dict[str, Counter[str]] = defaultdict(Counter)
    for e in pg.get_all("ingest_event", {"select": "team_id,status", "team_id": f"in.({','.join(ids)})",
                                         "order": "delivery_id"}):
        health[e["team_id"]][e["status"]] += 1

    out = []
    for team in teams:
        t = team.team_id
        authors = sorted({usn for (tt, usn) in (*expected, *untracked, *legacy_m, *pg_rows) if tt == t and usn})
        per_author = []
        for usn in authors:
            k = (t, usn)
            logged = expected[k] | untracked[k]
            only_m = sorted(expected[k] - pg_full[k])
            only_p = sorted(pg_full[k] - logged)
            pipeline = bool(logged or pg_full[k])
            per_author.append({
                "usn": usn,
                "mongo_commits": len(logged | legacy_m[k]),
                "postgres_github_contributions": pg_rows[k],
                "postgres_commits": len(pg_full[k]) + legacy_p[k],
                "matched": len(expected[k] & pg_full[k]) + len(untracked[k] & pg_full[k]),
                "only_in_mongo": only_m,
                "only_in_postgres": only_p,
                "not_projected": sorted(untracked[k] - pg_full[k]),
                "outside_pipeline": {"mongo_commits": len(legacy_m[k]), "postgres_contributions": legacy_p[k]},
                "status": _author_status(pipeline, only_m, only_p),
            })
        statuses = {a["status"] for a in per_author}
        discrepancy = bool(statuses - {"consistent", "outside_pipeline"})
        out.append({
            "team_id": t,
            "team_name": team.team_name,
            "project_id": team.project_id,
            "access": team.access,
            "mongo_commits": sum(a["mongo_commits"] for a in per_author),
            "postgres_commits": sum(a["postgres_commits"] for a in per_author),
            "postgres_github_contributions": sum(a["postgres_github_contributions"] for a in per_author),
            "matched_commits": sum(a["matched"] for a in per_author),
            "consistent": not discrepancy,
            "status": ("inconsistent" if discrepancy else "consistent" if "consistent" in statuses
                       else "outside_pipeline_only" if per_author else "no_evidence"),
            "pipeline_events": dict(health.get(t, {})),
            # wording rule: an empty record is a fact about the record, not about the people
            "note": "no recorded evidence yet" if not per_author else None,
            "authors": per_author,
        })
    return out
