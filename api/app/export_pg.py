"""Export the relational half of each portfolio from Postgres into Mongo (pg_portfolio_export),
for mongo/portfolio_merge.js to $unionWith.

Reads through PostgREST signed in as the ADMIN PERSONA (an ordinary login whose RLS policies
grant the oversight view), never with a service key. Writes one document per student:
  { usn, name, semester, projects: [{course, title, role, status, skills}],
    claims: {pending, confirmed, contested}, exported_at }
Marks are deliberately left out: a portfolio is the student's evidence, not their grades.

Usage:  cd api && uv run python -m app.export_pg            # then run mongo/portfolio_merge.js
Env:    EXPORT_EMAIL (default admin@example.edu), PERSONA_PASSWORD (the demo persona password).
"""

from __future__ import annotations

import os
import sys
from collections import defaultdict
from datetime import UTC, datetime

import httpx
from pymongo import MongoClient

from .config import get_settings

DEFAULT_PASSWORD = "Countersign@2026"     # demo persona password (scripts/create_personas.py)


def main() -> int:
    s = get_settings()
    email = os.environ.get("EXPORT_EMAIL", "admin@example.edu")
    with httpx.Client(timeout=20) as http:
        r = http.post(f"{s.supabase_url}/auth/v1/token", params={"grant_type": "password"},
                      headers={"apikey": s.supabase_anon_key},
                      json={"email": email, "password": os.environ.get("PERSONA_PASSWORD", DEFAULT_PASSWORD)})
        if r.status_code != 200:
            print(f"error: cannot sign in as {email}", file=sys.stderr)
            return 1
        headers = {"apikey": s.supabase_anon_key, "Authorization": f"Bearer {r.json()['access_token']}"}

        def get(path: str, **params: str) -> list[dict]:
            resp = http.get(f"{s.supabase_url}/rest/v1/{path}", params=params, headers=headers)
            resp.raise_for_status()
            return resp.json()

        students = get("student", select="usn,name,semester", order="usn")
        members = get("team_member",
                      select="usn,role,team:team_id(project:project_id(project_id,title,status,course_code))")
        skills = get("project_skill", select="project_id,skill:skill_id(name)")
        claims = get("claim", select="usn,status")

    skills_by_project: dict[str, list[str]] = defaultdict(list)
    for row in skills:
        skills_by_project[row["project_id"]].append(row["skill"]["name"])
    projects: dict[str, list[dict]] = defaultdict(list)
    for m in members:
        p = m["team"]["project"]
        projects[m["usn"]].append({"course": p["course_code"], "title": p["title"], "role": m["role"],
                                   "status": p["status"],
                                   "skills": sorted(skills_by_project.get(p["project_id"], []))})
    claim_counts: dict[str, dict[str, int]] = defaultdict(lambda: {"pending": 0, "confirmed": 0, "contested": 0})
    for c in claims:
        claim_counts[c["usn"]][c["status"]] += 1

    now = datetime.now(UTC)
    docs = [{"usn": st["usn"], "name": st["name"], "semester": st["semester"],
             "projects": sorted(projects.get(st["usn"], []), key=lambda p: (p["course"], p["title"])),
             "claims": claim_counts[st["usn"]], "exported_at": now} for st in students]

    client = MongoClient(s.mongodb_uri, tz_aware=True)
    coll = client[s.mongo_db].pg_portfolio_export
    coll.delete_many({})
    if docs:
        coll.insert_many(docs)
    client.close()
    print(f"exported {len(docs)} students from Postgres ({s.supabase_target}) "
          f"into {s.mongo_db}.pg_portfolio_export ({s.mongo_target})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
