"""Notes in MongoDB (elp.notes) with an immutable history (elp.note_versions).

Visibility follows the three privacy tiers of docs/PLAN.md §1:
  member (student in the team): every 'final' non-private note of the team + their own notes;
  staff  (teaching faculty / admin): 'final' non-private notes as METADATA ONLY; the text is
         returned only when the note is 'submitted'.
Writes: a student may create a note in their team and edit only notes they authored.
Every save appends one note_versions document (_id = "<note_id>:<version>") and bumps
notes.version in the same transaction, so the version on the note always has its receipt.
"""

from __future__ import annotations

import hashlib
import uuid
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field
from pymongo import MongoClient
from pymongo.database import Database
from pymongo.errors import DuplicateKeyError, OperationFailure

from .auth import Caller, TeamAccess, problem

NOTE_FIELDS = ("note_id", "team_id", "author_usn", "title", "tags", "links", "status", "version",
               "content", "visibility", "ai_assistance", "artifact_id", "created_at", "updated_at",
               "updated_by")


class NoteIn(BaseModel):
    note_id: str | None = Field(default=None, pattern=r"^N[0-9A-Za-z-]{1,39}$",
                                description="omit to create a new note")
    team_id: str = Field(pattern=r"^T[0-9]{2,3}$")
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(default="", max_length=100_000)
    tags: list[str] = Field(default_factory=list, max_length=30)
    links: list[str] | None = None
    status: Literal["draft", "final"] = "draft"
    ai_assistance: Literal["none", "assisted", "generated"] = "none"
    base_version: int | None = Field(default=None, ge=1,
                                     description="version the edit was based on (409 if stale)")


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def read_filter(team: TeamAccess, caller: Caller) -> dict[str, Any]:
    if team.access == "member":
        return {"team_id": team.team_id,
                "$or": [{"author_usn": caller.usn},
                        {"status": "final", "visibility": {"$ne": "private"}}]}
    return {"team_id": team.team_id, "status": "final", "visibility": {"$ne": "private"}}


def shape_note(doc: dict[str, Any], team: TeamAccess, versions: int) -> dict[str, Any]:
    out = {k: doc.get(k) for k in NOTE_FIELDS if k in doc}
    out.setdefault("visibility", "team")
    withheld = team.access == "staff" and out["visibility"] != "submitted"
    if withheld:
        out["content"] = None
    out["content_withheld"] = withheld
    out["history"] = {"versions": versions}
    return out


def version_counts(db: Database, note_ids: list[str]) -> dict[str, int]:
    rows = db.note_versions.aggregate([
        {"$match": {"note_id": {"$in": note_ids}}},
        {"$group": {"_id": "$note_id", "n": {"$sum": 1}}},
    ])
    return {r["_id"]: r["n"] for r in rows}


def list_notes(db: Database, team: TeamAccess, caller: Caller) -> list[dict[str, Any]]:
    docs = list(db.notes.find(read_filter(team, caller), {"_id": 0}).sort(
        [("created_at", -1), ("note_id", 1)]))
    counts = version_counts(db, [d["note_id"] for d in docs])
    return [shape_note(d, team, counts.get(d["note_id"], 0)) for d in docs]


def find_visible_note(db: Database, note_id: str, team: TeamAccess, caller: Caller) -> dict[str, Any] | None:
    return db.notes.find_one({"note_id": note_id, **read_filter(team, caller)}, {"_id": 0})


def list_versions(db: Database, note: dict[str, Any], team: TeamAccess) -> list[dict[str, Any]]:
    """Newest first. Staff get the receipts (who, when, hash) but the text only if submitted."""
    withheld = team.access == "staff" and note.get("visibility", "team") != "submitted"
    out = []
    for v in db.note_versions.find({"note_id": note["note_id"]}).sort("version", -1):
        v["version_id"] = v.pop("_id")
        v["content_withheld"] = withheld
        if withheld:
            v["content"] = None
        out.append(v)
    return out


def _run_atomic(client: MongoClient, fn) -> Any:
    """Run fn(session) in a multi-document transaction when the server supports one
    (Atlas, or the local replica-set container); plain sequential writes otherwise."""
    if client.admin.command("hello").get("setName"):
        with client.start_session() as session:
            return session.with_transaction(fn)
    return fn(None)


def save_note(client: MongoClient, db: Database, body: NoteIn, team: TeamAccess,
              caller: Caller) -> tuple[dict[str, Any], bool]:
    """Create or update a note as the caller. Returns (note, created)."""
    if team.access != "member" or caller.role != "student" or not caller.usn:
        raise problem(403, "student_required", "Only a student member of the team writes its notes")
    now = datetime.now(UTC)
    note_id = body.note_id or f"N-{uuid.uuid4().hex[:10]}"
    current = db.notes.find_one({"note_id": note_id}, {"_id": 0})

    if current is None:
        if body.base_version not in (None, 0):
            raise problem(409, "version_conflict", f"Note {note_id} does not exist yet")
        new_version = 1
        note = {"note_id": note_id, "team_id": team.team_id, "author_usn": caller.usn,
                "title": body.title, "tags": body.tags, "status": body.status, "version": 1,
                "content": body.content, "visibility": "team", "ai_assistance": body.ai_assistance,
                "created_at": now, "updated_at": now, "updated_by": caller.usn}
        if body.links is not None:
            note["links"] = body.links
    else:
        if current["team_id"] != team.team_id:
            raise problem(409, "note_team_mismatch", f"Note {note_id} belongs to team {current['team_id']}")
        if current["author_usn"] != caller.usn:
            raise problem(403, "note_author_required", "Only the author of a note can save a new version")
        old_version = int(current.get("version") or 1)
        if body.base_version is not None and body.base_version != old_version:
            raise problem(409, "version_conflict",
                          f"Note {note_id} is at version {old_version}, not {body.base_version}; reload and retry")
        new_version = old_version + 1
        note = None

    version_doc = {"_id": f"{note_id}:{new_version}", "note_id": note_id, "version": new_version,
                   "team_id": team.team_id, "author_usn": caller.usn, "title": body.title,
                   "content": body.content, "content_hash": sha256(body.content),
                   "status": body.status, "tags": body.tags, "ai_assistance": body.ai_assistance,
                   "created_at": now}

    def write(session):
        # The version insert comes first: its _id makes the version number single-use,
        # so two concurrent saves of the same base cannot both succeed.
        db.note_versions.insert_one(version_doc, session=session)
        if note is not None:
            db.notes.insert_one(dict(note), session=session)
        else:
            changes = {"title": body.title, "content": body.content, "tags": body.tags,
                       "status": body.status, "ai_assistance": body.ai_assistance,
                       "version": new_version, "updated_at": now, "updated_by": caller.usn}
            if body.links is not None:
                changes["links"] = body.links
            r = db.notes.update_one({"note_id": note_id, "version": new_version - 1},
                                    {"$set": changes}, session=session)
            if r.matched_count != 1:
                raise problem(409, "version_conflict", f"Note {note_id} changed while saving; reload and retry")

    try:
        _run_atomic(client, write)
    except DuplicateKeyError:
        raise problem(409, "version_conflict", f"Version {new_version} of {note_id} already exists; reload and retry")
    except OperationFailure as exc:
        if exc.code == 121:
            raise problem(422, "document_validation", "MongoDB schema validation rejected the note")
        raise

    saved = db.notes.find_one({"note_id": note_id}, {"_id": 0})
    count = db.note_versions.count_documents({"note_id": note_id})
    return shape_note(saved, team, count), note is not None
