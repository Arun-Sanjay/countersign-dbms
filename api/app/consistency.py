"""Cross-database consistency: Mongo push events vs Postgres contribution rows.

For every team the caller may see (RLS decides), compare per author:
  mongo    - commits inside elp.github_events pushes ($unwind commits, $group team+author)
  postgres - contribution rows with source = 'github' (read through PostgREST as the caller,
             so the contribution/artifact policies apply; private artifacts stay hidden)
Commits are matched by SHA (prefix match: the fixture stores short SHAs). Only counts and
SHAs are returned (metadata), never commit messages, so the faculty tier sees the same.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from pymongo.database import Database

from .auth import Postgrest, TeamAccess


def _same_commit(a: str, b: str) -> bool:
    a, b = a.lower(), b.lower()
    return min(len(a), len(b)) >= 4 and (a.startswith(b) or b.startswith(a))


def _status(mongo: list[str], pg: list[str], unmatched_m: list[str], unmatched_p: list[str]) -> str:
    if not mongo:
        return "only_in_postgres"
    if not pg:
        return "only_in_mongo"
    if unmatched_m or unmatched_p:
        return "mismatch"
    return "consistent"


def consistency(db: Database, pg: Postgrest, teams: list[TeamAccess]) -> list[dict[str, Any]]:
    if not teams:
        return []
    ids = [t.team_id for t in teams]

    # Mongo: commit SHAs per (team, author)
    mongo: dict[tuple[str, str], list[str]] = defaultdict(list)
    for row in db.github_events.aggregate([
        {"$match": {"team_id": {"$in": ids}}},
        {"$unwind": "$commits"},
        {"$group": {"_id": {"team": "$team_id", "usn": "$commits.author_usn"},
                    "shas": {"$push": "$commits.sha"}}},
    ]):
        mongo[(row["_id"]["team"], row["_id"]["usn"])] = sorted(row["shas"])

    # Postgres, as the caller: github contributions with the team of their artifact
    rows = pg.get("contribution", {
        "select": "usn,source_ref,artifact!inner(team_id)",
        "source": "eq.github",
        "artifact.team_id": f"in.({','.join(ids)})",
    })
    postgres: dict[tuple[str, str], list[str]] = defaultdict(list)
    for r in rows:
        postgres[(r["artifact"]["team_id"], r["usn"])].append(r.get("source_ref") or "")

    out = []
    for team in teams:
        authors = sorted({usn for (t, usn) in (*mongo, *postgres) if t == team.team_id})
        per_author = []
        for usn in authors:
            m, p = mongo.get((team.team_id, usn), []), sorted(postgres.get((team.team_id, usn), []))
            unmatched_m = [s for s in m if not any(_same_commit(s, x) for x in p)]
            unmatched_p = [s for s in p if not any(_same_commit(s, x) for x in m)]
            per_author.append({
                "usn": usn,
                "mongo_commits": len(m),
                "postgres_github_contributions": len(p),
                "only_in_mongo": unmatched_m,
                "only_in_postgres": unmatched_p,
                "status": _status(m, p, unmatched_m, unmatched_p),
            })
        mongo_total = sum(a["mongo_commits"] for a in per_author)
        pg_total = sum(a["postgres_github_contributions"] for a in per_author)
        out.append({
            "team_id": team.team_id,
            "team_name": team.team_name,
            "project_id": team.project_id,
            "access": team.access,
            "mongo_commits": mongo_total,
            "postgres_github_contributions": pg_total,
            "consistent": all(a["status"] == "consistent" for a in per_author),
            # wording rule: an empty record is a fact about the record, not about the people
            "note": "no recorded evidence yet" if not per_author else None,
            "authors": per_author,
        })
    return out
