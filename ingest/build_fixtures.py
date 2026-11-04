"""Build the GitHub webhook replay fixtures in ingest/fixtures/ (stdlib only, deterministic).

    uv run --python 3.12 python ingest/build_fixtures.py [--until <rev>]

Writes, next to a manifest.json that scripts/replay_webhooks.py replays in order:

  (a) t00_push_NN.json  push payloads to Arun-Sanjay/countersign-dbms built from THIS repo's
                        real `git log` on main up to --until (default HEAD): real SHAs, tree ids,
                        messages, author/committer, timestamps and the files each commit touched.
                        Commits less than 10 minutes apart form one push. Markdown files up to
                        40 kB carry their text at that commit in commits[i].x_contents (see
                        below); larger ones (PROJECT_MASTER.md) only their path.
  (b) t01_*.json, t03_*.json  synthetic pushes to the fixture teams' repositories
                        (rvce-el/team-alpha = T01, rvce-el/team-gamma = T03; fictional students,
                        as in the graded fixture), including Obsidian vault notes under shared/
                        with real content, a declared "AI-Assisted: yes" trailer, a Co-Authored-By
                        line WITHOUT the trailer, an unknown author, an e-mail-only author, a
                        teammate's commit pushed by someone else (logged, NOT credited: only
                        the authenticated pusher's own commits count) and a push to a feature
                        branch.
  (c) ping.json / issues.json, plus manifest rows for a redelivery (same X-GitHub-Delivery
                        twice), a captured body re-sent under a NEW delivery id (same push ->
                        duplicate), a wrong-secret signature and a tampered body.

x_contents: GitHub push payloads list paths, not file bodies. The ingestion worker may enrich
a payload with commits[i].x_contents = {path: text} (fetched from the contents API at that
commit) before projection; the fixtures carry it inline so a replay needs no GitHub access.

Delivery ids are UUIDv5 of a stable name, so rebuilding gives the same ids.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import uuid
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "ingest" / "fixtures"
NS = uuid.UUID("6f1c2a52-6d0e-4c1f-9a0e-9b7f6c2d1e01")  # namespace for delivery ids
MAX_INLINE_MD = 40_000
PUSH_GAP = timedelta(minutes=10)
ZERO = "0" * 40

# Real repository metadata (public facts of the repo, from `gh api repos/Arun-Sanjay/countersign-dbms`).
T00_REPO = {
    "id": 1445781068,
    "node_id": "R_kgDOVizeTA",
    "name": "countersign-dbms",
    "full_name": "Arun-Sanjay/countersign-dbms",
    "private": True,
    "owner": {
        "name": "Arun-Sanjay",
        "email": "228202223+Arun-Sanjay@users.noreply.github.com",
        "login": "Arun-Sanjay",
        "id": 228202223,
        "node_id": "U_kgDODZoW7w",
        "type": "User",
        "html_url": "https://github.com/Arun-Sanjay",
        "site_admin": False,
    },
    "html_url": "https://github.com/Arun-Sanjay/countersign-dbms",
    "url": "https://github.com/Arun-Sanjay/countersign-dbms",
    "created_at": 1762267061,
    "default_branch": "main",
    "master_branch": "main",
    "visibility": "private",
}
ARUN_SENDER = {"login": "Arun-Sanjay", "id": 228202223, "node_id": "U_kgDODZoW7w",
               "type": "User", "site_admin": False}


def delivery(name: str) -> str:
    return str(uuid.uuid5(NS, name))


def git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=ROOT, check=True, capture_output=True, text=True).stdout


def epoch(iso: str) -> int:
    return int(datetime.fromisoformat(iso).timestamp())


def noreply_login(email: str) -> str | None:
    m = re.fullmatch(r"\d+\+([^@]+)@users\.noreply\.github\.com", email)
    return m.group(1) if m else None


# ------------------------------------------------------------------------------------------
# (a) real history
# ------------------------------------------------------------------------------------------
def real_commit(sha: str) -> dict:
    fmt = "%H%x00%T%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%B"
    h, tree, an, ae, ad, cn, ce, cd, body = git("show", "-s", f"--format={fmt}", sha).split("\x00", 8)
    added, removed, modified = [], [], []
    for line in git("show", "--no-renames", "--name-status", "--format=", sha).splitlines():
        if not line.strip():
            continue
        status, path = line.split("\t", 1)
        {"A": added, "D": removed}.get(status[0], modified).append(path)
    contents = {}
    for path in added + modified:
        if path.lower().endswith(".md"):
            blob = git("show", f"{sha}:{path}")
            if len(blob.encode()) <= MAX_INLINE_MD:
                contents[path] = blob
    commit = {
        "id": h,
        "tree_id": tree,
        "distinct": True,
        "message": body.rstrip("\n"),
        "timestamp": ad,
        "url": f"{T00_REPO['html_url']}/commit/{h}",
        "author": {"name": an, "email": ae, "username": noreply_login(ae)},
        "committer": {"name": cn, "email": ce, "username": noreply_login(ce)},
        "added": sorted(added),
        "removed": sorted(removed),
        "modified": sorted(modified),
    }
    if contents:
        commit["x_contents"] = contents
    return commit


def real_pushes(until: str) -> list[list[dict]]:
    shas = git("rev-list", "--reverse", "--first-parent", until).split()
    commits = [real_commit(s) for s in shas]
    groups: list[list[dict]] = []
    for c in commits:
        t = datetime.fromisoformat(c["timestamp"])
        if groups and t - datetime.fromisoformat(groups[-1][-1]["timestamp"]) < PUSH_GAP:
            groups[-1].append(c)
        else:
            groups.append([c])
    return groups


def push_payload(repo: dict, sender: dict, pusher: dict, ref: str, before: str,
                 commits: list[dict], pushed_at: str) -> dict:
    after = commits[-1]["id"]
    created = before == ZERO
    repo = dict(repo, pushed_at=epoch(pushed_at))
    return {
        "ref": ref,
        "before": before,
        "after": after,
        "repository": repo,
        "pusher": pusher,
        "sender": sender,
        "created": created,
        "deleted": False,
        "forced": False,
        "base_ref": None,
        "compare": (f"{repo['html_url']}/commit/{after[:12]}" if created
                    else f"{repo['html_url']}/compare/{before[:12]}...{after[:12]}"),
        "commits": commits,
        "head_commit": commits[-1],
    }


# ------------------------------------------------------------------------------------------
# (b) synthetic fixture-team pushes
# ------------------------------------------------------------------------------------------
def org_repo(name: str, repo_id: int) -> dict:
    full = f"rvce-el/{name}"
    return {
        "id": repo_id,
        "node_id": "R_fixture_" + name.replace("-", "_"),
        "name": name,
        "full_name": full,
        "private": True,
        "owner": {"name": "rvce-el", "login": "rvce-el", "id": 990001, "type": "Organization",
                  "html_url": "https://github.com/rvce-el", "site_admin": False},
        "html_url": f"https://github.com/{full}",
        "url": f"https://github.com/{full}",
        "created_at": 1758000000,
        "default_branch": "main",
        "master_branch": "main",
        "visibility": "private",
        "organization": "rvce-el",
    }


def user(login: str, uid: int) -> dict:
    return {"login": login, "id": uid, "node_id": f"U_fixture_{uid}", "type": "User", "site_admin": False}


def fake_sha(label: str) -> str:
    return hashlib.sha1(f"countersign-fixture:{label}".encode()).hexdigest()


def synth_commit(repo: dict, label: str, author: dict, ts: str, message: str,
                 added=(), modified=(), removed=(), contents: dict | None = None) -> dict:
    sha = fake_sha(label)
    c = {
        "id": sha,
        "tree_id": fake_sha("tree:" + label),
        "distinct": True,
        "message": message,
        "timestamp": ts,
        "url": f"{repo['html_url']}/commit/{sha}",
        "author": author,
        "committer": author,
        "added": list(added),
        "removed": list(removed),
        "modified": list(modified),
    }
    if contents:
        c["x_contents"] = contents
    return c


LIT_SURVEY = """---
tags: [research, provenance, peer-assessment]
---
# Literature survey

## Data provenance
Data provenance research tracks who changed each record and when. W7-style provenance models
record the *agent*, the *activity* and the *entity*; for our platform the agent is a student,
the activity is a commit or a note save, and the entity is an artifact version. Storing the
content hash of every version lets anyone check later that a submitted version was not edited.

## Peer assessment tools
CATME and WebPA ask teammates to rate each other at the end of a project. Both rely on ratings,
not on traceable evidence, so a confident student can inflate a weak contribution and a quiet
student who did the schema work can be under-rated. GitHub Classroom shows commits but cannot
see design work done on paper or in a shared document.

## What we take from this
1. Every contribution row should point at evidence (a commit SHA or a note version).
2. Teammates should confirm or dispute a claim, not score each other.
3. AI assistance should be declared per contribution, never guessed by a detector.

Links: [[ER diagram decisions]], [[Synopsis outline]]
"""

ER_DECISIONS = """---
tags: [er-diagram, design]
---
# ER diagram decisions

## Weak entities
MILESTONE is a weak entity of PROJECT: a milestone number only means something inside its
project, so the primary key is (project_id, milestone_no) and milestone_no is the partial key.
Deleting a project would delete its milestones (existence dependency), which is why the
relationship is drawn with a double diamond.

## Many-to-many relationships
TEAM_MEMBER resolves the M:N between STUDENT and TEAM. It carries its own attributes (role,
joined_at), so it becomes a table with the composite key (team_id, usn). CONTRIBUTION links
STUDENT and ARTIFACT and is also M:N: one artifact has many contributors and one student
contributes to many artifacts.

## Open questions for the review
- Should ARTIFACT reference MILESTONE with a composite foreign key (project_id, milestone_no)?
  Yes: it stops an artifact of one project being filed under another project's milestone.
- Team capacity (max_size) cannot be a CHECK constraint because it counts rows of another
  table; it needs a trigger.

Next: [[Normalization plan]]
"""

NORMALIZATION_PLAN = """# Normalization plan

Start from the paper marks sheet (one row per student, one column per component) and normalize
it step by step to BCNF. The repeating component columns violate 1NF; the student name depends
only on the USN, a partial dependency on the composite key (usn, component), which violates 2NF.
"""


def synthetic_pushes() -> list[tuple[str, dict]]:
    alpha = org_repo("team-alpha", 880101)
    gamma = org_repo("team-gamma", 880103)
    karthik = {"name": "Karthik M", "email": "karthik.cy24@rvce.edu.in", "username": "karthik-m"}
    aditi_email_only = {"name": "Aditi Rao", "email": "aditi.cy24@rvce.edu.in"}  # e-mail not linked to GitHub
    meera = {"name": "Meera Iyer", "email": "meera.cy24@rvce.edu.in", "username": "meera-iyer"}
    arun = {"name": "Arun Sanjay", "email": "228202223+Arun-Sanjay@users.noreply.github.com",
            "username": "Arun-Sanjay"}
    stranger = {"name": "Ext Contributor", "email": "ext.contributor@example.com", "username": "ext-contributor"}
    priya = {"name": "Priya Menon", "email": "priya.cy24@rvce.edu.in", "username": "priya-menon"}
    rohan = {"name": "Rohan Kulkarni", "email": "rohan.cy24@rvce.edu.in", "username": "rohan-kulkarni"}

    # Every push is sent by a verified identity (payload.sender); a commit is credited only
    # when its author is that same student (supabase/migrations/..._ingest.sql, trust model).

    # T01 push 1: Karthik's schema work, declared AI-assisted
    c1 = synth_commit(alpha, "t01-c1", karthik, "2026-11-03T18:12:00+05:30",
                      "Add foreign keys and CHECK constraints to the schema\n\n"
                      "Composite FK artifact(project_id, milestone_no) -> milestone.\n\n"
                      "AI-Assisted: yes",
                      added=["db/constraints.sql"], modified=["db/schema.sql"])
    p1 = push_payload(alpha, user("karthik-m", 770024),
                      {"name": "karthik-m", "email": "karthik.cy24@rvce.edu.in"},
                      "refs/heads/main", fake_sha("t01-base"), [c1], "2026-11-03T18:13:00+05:30")

    # T01 push 1b: Aditi pushes her vault note; the commit carries only her college e-mail
    # (not linked to GitHub), so the author is matched by e-mail, the pusher by GitHub id
    c2 = synth_commit(alpha, "t01-c2", aditi_email_only, "2026-11-03T18:40:00+05:30",
                      "Vault: literature survey on provenance and peer assessment",
                      modified=["shared/Literature survey.md"],
                      contents={"shared/Literature survey.md": LIT_SURVEY})
    p1b = push_payload(alpha, user("aditi-rao", 770011),
                       {"name": "aditi-rao", "email": "aditi.cy24@rvce.edu.in"},
                       "refs/heads/main", c1["id"], [c2], "2026-11-03T18:41:00+05:30")

    # T01 push 2: Meera's ER note + diagram, an unknown author's commit she merged, and her
    # seed script with a Co-Authored-By line but no AI-Assisted trailer
    c3 = synth_commit(alpha, "t01-c3", meera, "2026-11-04T10:05:00+05:30",
                      "Vault: ER diagram decisions (weak entities, M:N)",
                      added=["shared/ER diagram decisions.md", "docs/er-diagram.drawio"],
                      contents={"shared/ER diagram decisions.md": ER_DECISIONS})
    c4 = synth_commit(alpha, "t01-c4", stranger, "2026-11-04T10:20:00+05:30",
                      "Fix typo in README", modified=["README.md"])
    c5 = synth_commit(alpha, "t01-c5", meera, "2026-11-04T11:02:00+05:30",
                      "Seed sample data for the schema\n\n"
                      "Co-Authored-By: Claude <noreply@anthropic.com>",
                      added=["db/seed.sql"])
    p2 = push_payload(alpha, user("meera-iyer", 770033),
                      {"name": "meera-iyer", "email": "meera.cy24@rvce.edu.in"},
                      "refs/heads/main", c2["id"], [c3, c4, c5], "2026-11-04T11:03:00+05:30")

    # T01 feature-branch push: logged, never projected (only the default branch counts)
    c6 = synth_commit(alpha, "t01-c6", karthik, "2026-11-04T12:30:00+05:30",
                      "Draft normalization plan", added=["shared/Normalization plan.md"],
                      contents={"shared/Normalization plan.md": NORMALIZATION_PLAN})
    p3 = push_payload(alpha, user("karthik-m", 770024),
                      {"name": "karthik-m", "email": "karthik.cy24@rvce.edu.in"},
                      "refs/heads/feature/normalization", ZERO, [c6], "2026-11-04T12:31:00+05:30")

    # T03 push: AIML project code. Priya also pushes Rohan's commit: its author claim cannot
    # be checked (anyone can write `git commit --author`), so it is logged but NOT credited
    c7 = synth_commit(gamma, "t03-c1", priya, "2026-11-02T16:00:00+05:30",
                      "Data loader for the image dataset", added=["src/data_loader.py"])
    c8 = synth_commit(gamma, "t03-c2", rohan, "2026-11-02T17:45:00+05:30",
                      "Training loop with early stopping\n\nAI-Assisted: yes",
                      added=["src/train.py"], modified=["src/data_loader.py"])
    p4 = push_payload(gamma, user("priya-menon", 770063),
                      {"name": "priya-menon", "email": "priya.cy24@rvce.edu.in"},
                      "refs/heads/main", fake_sha("t03-base"), [c7, c8], "2026-11-02T17:46:00+05:30")

    return [("t01_push_01.json", p1), ("t01_push_01b.json", p1b), ("t01_push_02.json", p2),
            ("t01_push_feature_branch.json", p3), ("t03_push_01.json", p4)]


def ping_payload() -> dict:
    return {
        "zen": "Design for failure.",
        "hook_id": 512000001,
        "hook": {"type": "Repository", "id": 512000001, "name": "web", "active": True,
                 "events": ["push"], "config": {"content_type": "json", "insecure_ssl": "0",
                                                "url": "https://<project-ref>.supabase.co/functions/v1/github-webhook"}},
        "repository": dict(T00_REPO),
        "sender": ARUN_SENDER,
    }


def issues_payload() -> dict:
    return {"action": "opened",
            "issue": {"number": 1, "title": "Ingest pipeline: replay fixtures", "state": "open"},
            "repository": dict(T00_REPO), "sender": ARUN_SENDER}


def write(name: str, data: dict) -> None:
    (OUT / name).write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--until", default="HEAD", help="last commit of the real history (default HEAD)")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.json"):
        old.unlink()

    manifest: list[dict] = []

    write("ping.json", ping_payload())
    manifest.append({"name": "ping", "file": "ping.json", "event": "ping",
                     "delivery": delivery("ping"), "sign": "valid",
                     "description": "webhook created: GitHub sends a ping first",
                     "expect": {"http": 200}})

    before = ZERO
    for n, commits in enumerate(real_pushes(args.until), start=1):
        name = f"t00_push_{n:02d}.json"
        pushed_at = commits[-1]["timestamp"]
        write(name, push_payload(T00_REPO, ARUN_SENDER,
                                 {"name": "Arun-Sanjay", "email": T00_REPO["owner"]["email"]},
                                 "refs/heads/main", before, commits, pushed_at))
        before = commits[-1]["id"]
        manifest.append({"name": f"t00-push-{n:02d}", "file": name, "event": "push",
                         "delivery": delivery("t00:" + commits[-1]["id"]), "sign": "valid",
                         "description": "real history: " + ", ".join(c["id"][:7] for c in commits),
                         "expect": {"http": 202, "status": "queued", "duplicate": False}})

    synth = synthetic_pushes()
    for name, payload in synth:
        write(name, payload)
    d1, d1b, d2, d3, d4 = (delivery("synthetic:" + n) for n, _ in synth)
    manifest += [
        {"name": "t01-push-01", "file": "t01_push_01.json", "event": "push", "delivery": d1, "sign": "valid",
         "description": "T01: Karthik's FK/CHECK schema work (AI-Assisted: yes)",
         "expect": {"http": 202, "status": "queued", "duplicate": False}},
        {"name": "t01-push-01-redelivery", "file": "t01_push_01.json", "event": "push", "delivery": d1,
         "sign": "valid", "description": "GitHub 'Redeliver': same X-GitHub-Delivery -> no new row, no new message",
         "expect": {"http": 202, "status": "queued", "duplicate": True}},
        {"name": "t01-push-01-replayed", "file": "t01_push_01.json", "event": "push",
         "delivery": delivery("synthetic:t01_push_01.json:replayed"), "sign": "valid",
         "description": "the same signed body re-sent under a NEW delivery id: same (repo, ref, after) -> duplicate",
         "expect": {"http": 202, "status": "queued", "duplicate": True}},
        {"name": "t01-push-01b", "file": "t01_push_01b.json", "event": "push", "delivery": d1b, "sign": "valid",
         "description": "T01: Aditi pushes her vault note; author matched by e-mail, pusher by GitHub id",
         "expect": {"http": 202, "status": "queued", "duplicate": False}},
        {"name": "t01-push-02-wrong-secret", "file": "t01_push_02.json", "event": "push",
         "delivery": delivery("synthetic:t01_push_02.json:forged"), "sign": "wrong_secret",
         "description": "signed with the wrong secret -> 401, nothing stored",
         "expect": {"http": 401}},
        {"name": "t01-push-02-tampered", "file": "t01_push_02.json", "event": "push",
         "delivery": delivery("synthetic:t01_push_02.json:tampered"), "sign": "tampered",
         "description": "valid signature of the original body, but the body was changed in transit -> 401",
         "expect": {"http": 401}},
        {"name": "t01-push-02", "file": "t01_push_02.json", "event": "push", "delivery": d2, "sign": "valid",
         "description": "T01: Meera's ER note + drawio, an unknown author (skipped, warning), Co-Authored-By without the trailer",
         "expect": {"http": 202, "status": "queued", "duplicate": False}},
        {"name": "t01-feature-branch", "file": "t01_push_feature_branch.json", "event": "push", "delivery": d3,
         "sign": "valid", "description": "push to a feature branch: logged as ignored, never queued",
         "expect": {"http": 202, "status": "ignored", "duplicate": False}},
        {"name": "t03-push-01", "file": "t03_push_01.json", "event": "push", "delivery": d4, "sign": "valid",
         "description": "T03: Priya's loader; Rohan's commit pushed by Priya is logged but not credited (unverified)",
         "expect": {"http": 202, "status": "queued", "duplicate": False}},
    ]

    write("issues.json", issues_payload())
    manifest.append({"name": "issues-event", "file": "issues.json", "event": "issues",
                     "delivery": delivery("issues"), "sign": "valid",
                     "description": "not a push: acknowledged, not stored",
                     "expect": {"http": 202, "status": "ignored"}})

    write("manifest.json", {"description": "Replay order for scripts/replay_webhooks.py. sign: valid | "
                                           "wrong_secret | tampered.", "deliveries": manifest})
    print(f"wrote {len(list(OUT.glob('*.json')))} files to {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
