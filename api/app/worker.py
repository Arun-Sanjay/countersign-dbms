"""Ingestion worker: drains the pgmq queue `github_ingest` (inbox -> log -> projection).

The contract (docs/PLAN.md §2 item 8, ingest/README.md):

    1 INBOX       Edge Function -> ingest_receive(): ingest_event row + pgmq message, one transaction
    2 LOG         worker: upsert the raw push into Mongo elp.github_events {_id: delivery_id}
                  -> ingest_mark_raw(delivery_id, mongo_id)
    0 CONTENTS    optional (GITHUB_FETCH_CONTENTS=1 / GITHUB_TOKEN): real GitHub pushes list paths,
                  not file bodies; the worker fetches each added/modified markdown file at its
                  commit from the contents API into commits[i].x_contents (replay fixtures
                  already carry it), so notes become chunks and Mongo note versions
    2 LOG         worker: upsert the raw push into Mongo elp.github_events {_id: delivery_id}
                  (author e-mail addresses replaced by their sha256) -> ingest_mark_raw
    3 PROJECTION  worker: project_push(delivery_id, payload, mongo_id) -> artifact / version /
                  contribution / chunk rows (ON CONFLICT), then the message is archived
    4 FOLLOW-UPS  vault notes (shared/**.md) -> Mongo notes + immutable note_versions;
                  optional chunk embeddings (VOYAGE_API_KEY); then ingest_event.followups_at.
                  Every drain first re-runs follow-ups of projected events whose followups_at
                  is still NULL (a crash, or a lost project_push response, between 3 and 4).

Delivery semantics: AT-LEAST-ONCE. ingest_read() hides a message for `vt` seconds (pgmq
visibility timeout) and returns the oldest first; it is archived only by a successful
project_push (or as a dead letter). If the worker crashes, or Mongo or Postgres fails at any
step, the message becomes visible again after `vt` and is processed again. A message read
more than MAX_READS times without finishing (a worker killed mid-message, again and again)
is dead-lettered before any work. Within one drain, once a team's message fails, that team's
later messages wait (per-team FIFO), so pushes are projected in the order they arrived. That
is safe because every step is idempotent:

    raw log        Mongo _id = delivery_id (replace_one upsert of the same document)
    status         ingest_mark_raw only moves queued/failed -> raw_stored
    projection     project_push: a finished delivery is a no-op; every INSERT has an
                   ON CONFLICT idempotency key (artifact path, version SHA, contribution key)
    notes          a note version is keyed by (note_id, source_ref = commit SHA)
    embeddings     only chunks whose embedding IS NULL are embedded

Failures: project_push counts its own attempts. A failure before it (e.g. Mongo down) is
recorded by ingest_fail (migration 0006): attempts + 1, status 'failed', the error text. After
5 attempts the message is archived as a dead letter (pgmq.a_github_ingest).

Postgres access: the pipeline RPCs are service_role-only, so the worker uses either
  SqlStore   psycopg on INGEST_DB_URL (each call in its own transaction, as service_role), or
  RestStore  PostgREST /rest/v1/rpc with SUPABASE_SERVICE_ROLE_KEY.
User requests never go through either (they run as the caller, see app/auth.py).

CLI (in api/):
    uv run python -m app.worker --once              drain until the queue is empty, then exit
    uv run python -m app.worker --loop              keep draining (Ctrl-C to stop)
    uv run python -m app.worker --resync-notes      rebuild vault notes from the raw log
    uv run python -m app.worker --reproject-from-log  replay the Mongo raw log into Postgres
                                                    (ingest_receive + drain; idempotent)
    uv run python -m app.worker --embed-missing     embed chunks without a vector (needs VOYAGE_API_KEY)
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
from collections.abc import Callable, Iterable
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol
from urllib.parse import quote

import httpx
from pymongo import MongoClient
from pymongo.database import Database

from . import embeddings
from .config import ConfigError, Settings, get_settings
from .ingest_rules import ai_declared, is_vault_note, note_links, note_tags, note_title
from .notes import _run_atomic, sha256

SHA_RE = re.compile(r"^[0-9a-f]{40}$")
DEFAULT_VT = 60          # seconds a read message stays invisible to other workers
DEFAULT_BATCH = 5
MAX_ATTEMPTS = 5         # same limit as project_push's dead letter
MAX_READS = 3 * MAX_ATTEMPTS   # read this often without finishing: dead letter before any work
SECONDS_PER_MESSAGE = 12       # worst case (Mongo server selection 10 s): batch * this < vt
FOLLOWUP_GRACE = 30            # s: leave a just-projected event to the worker that projected it


class StoreError(RuntimeError):
    """Postgres refused or could not be reached. The message text never contains secrets."""


# =====================================================================================
# Postgres side: the five service_role RPCs + two small reads/writes for the follow-ups
# =====================================================================================

class Store(Protocol):
    def receive(self, delivery_id: str, event_type: str, payload: dict[str, Any]) -> dict[str, Any]: ...
    def read(self, qty: int, vt: int) -> list[dict[str, Any]]: ...
    def mark_raw(self, delivery_id: str, mongo_id: str) -> dict[str, Any]: ...
    def project(self, delivery_id: str, payload: dict[str, Any], mongo_id: str) -> dict[str, Any]: ...
    def fail(self, delivery_id: str, error: str, max_attempts: int = MAX_ATTEMPTS) -> dict[str, Any]: ...
    def event(self, delivery_id: str) -> dict[str, Any] | None: ...
    def set_received_at(self, delivery_id: str, at: datetime) -> None: ...
    def pending_followups(self, limit: int, older_than: datetime) -> list[dict[str, Any]]: ...
    def mark_followups(self, delivery_id: str) -> None: ...
    def note_artifacts(self, team_id: str, paths: list[str]) -> dict[str, dict[str, Any]]: ...
    def chunks_without_embedding(self, team_id: str | None, limit: int) -> list[dict[str, Any]]: ...
    def set_embedding(self, chunk_id: int, vector: list[float], model: str) -> None: ...


def _vector_literal(vector: list[float]) -> str:
    return "[" + ",".join(f"{x:.7g}" for x in vector) + "]"


def _versions_by_sha(rows: Iterable[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for r in rows:
        out[r["external_ref"]] = {
            "artifact_id": r["artifact_id"],
            "versions": {v["source_ref"]: v["version_no"] for v in (r.get("versions") or [])
                         if v.get("source_ref")},
        }
    return out


class RestStore:
    """PostgREST with the service-role key (bypasses RLS; reaches the service_role RPCs)."""

    def __init__(self, settings: Settings, http: httpx.Client):
        if not settings.service_role_key:
            raise ConfigError("SUPABASE_SERVICE_ROLE_KEY is not configured")
        self.base = f"{settings.supabase_url}/rest/v1"
        self.http = http
        self.headers = {"apikey": settings.service_role_key,
                        "Authorization": f"Bearer {settings.service_role_key}",
                        "Content-Type": "application/json", "Accept": "application/json"}

    def _send(self, method: str, path: str, **kw: Any) -> Any:
        try:
            r = self.http.request(method, f"{self.base}/{path}", headers={**self.headers, **kw.pop("headers", {})}, **kw)
        except httpx.HTTPError as exc:
            raise StoreError(f"PostgREST unreachable ({type(exc).__name__})") from None
        if r.status_code >= 400:
            try:
                body = r.json()
            except ValueError:
                body = {}
            raise StoreError(f"PostgREST {r.status_code} {body.get('code', '')}: "
                             f"{body.get('message', '')} {body.get('details') or ''}".strip())
        return r.json() if r.content else None

    def _rpc(self, name: str, body: dict[str, Any]) -> Any:
        return self._send("POST", f"rpc/{name}", json=body)

    def receive(self, delivery_id: str, event_type: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self._rpc("ingest_receive", {"p_delivery_id": delivery_id, "p_event_type": event_type,
                                            "p_payload": payload})

    def read(self, qty: int, vt: int) -> list[dict[str, Any]]:
        return self._rpc("ingest_read", {"p_qty": qty, "p_vt": vt}) or []

    def mark_raw(self, delivery_id: str, mongo_id: str) -> dict[str, Any]:
        return self._rpc("ingest_mark_raw", {"p_delivery_id": delivery_id, "p_mongo_id": mongo_id})

    def project(self, delivery_id: str, payload: dict[str, Any], mongo_id: str) -> dict[str, Any]:
        return self._rpc("project_push", {"p_delivery_id": delivery_id, "p_payload": payload,
                                          "p_mongo_id": mongo_id})

    def fail(self, delivery_id: str, error: str, max_attempts: int = MAX_ATTEMPTS) -> dict[str, Any]:
        return self._rpc("ingest_fail", {"p_delivery_id": delivery_id, "p_error": error,
                                         "p_max_attempts": max_attempts})

    # service_role has table privileges on ingest_event (bypasses RLS): plain REST reads/writes
    def event(self, delivery_id: str) -> dict[str, Any] | None:
        rows = self._send("GET", "ingest_event", params={
            "select": "delivery_id,status,team_id,mongo_id,followups_at", "delivery_id": f"eq.{delivery_id}"})
        return rows[0] if rows else None

    def set_received_at(self, delivery_id: str, at: datetime) -> None:
        self._send("PATCH", "ingest_event", params={"delivery_id": f"eq.{delivery_id}"},
                   json={"received_at": at.isoformat()}, headers={"Prefer": "return=minimal"})

    def pending_followups(self, limit: int, older_than: datetime) -> list[dict[str, Any]]:
        return self._send("GET", "ingest_event", params={
            "select": "delivery_id,team_id,projected_at", "status": "eq.projected",
            "followups_at": "is.null", "projected_at": f"lt.{older_than.isoformat()}",
            "order": "projected_at", "limit": str(limit)}) or []

    def mark_followups(self, delivery_id: str) -> None:
        self._send("PATCH", "ingest_event", params={"delivery_id": f"eq.{delivery_id}"},
                   json={"followups_at": datetime.now(UTC).isoformat()}, headers={"Prefer": "return=minimal"})

    def note_artifacts(self, team_id: str, paths: list[str]) -> dict[str, dict[str, Any]]:
        if not paths:
            return {}
        quoted = ",".join('"' + p.replace("\\", "\\\\").replace('"', '\\"') + '"' for p in paths)
        rows = self._send("GET", "artifact", params={
            "select": "artifact_id,external_ref,versions:artifact_version(version_no,source_ref,created_at)",
            "team_id": f"eq.{team_id}", "source": "in.(github,obsidian)",
            "external_ref": f"in.({quoted})"})
        return _versions_by_sha(rows or [])

    def chunks_without_embedding(self, team_id: str | None, limit: int) -> list[dict[str, Any]]:
        params = {"select": "chunk_id,content" + (",artifact!inner(team_id)" if team_id else ""),
                  "embedding": "is.null", "order": "chunk_id", "limit": str(limit)}
        if team_id:
            params["artifact.team_id"] = f"eq.{team_id}"
        return [{"chunk_id": r["chunk_id"], "content": r["content"]}
                for r in self._send("GET", "artifact_chunk", params=params) or []]

    def set_embedding(self, chunk_id: int, vector: list[float], model: str) -> None:
        self._send("PATCH", "artifact_chunk", params={"chunk_id": f"eq.{chunk_id}", "embedding": "is.null"},
                   json={"embedding": _vector_literal(vector), "embedding_model": model},
                   headers={"Prefer": "return=minimal"})


class SqlStore:
    """psycopg on a Postgres URL. Every call runs in its own transaction AS service_role, so
    it has exactly the privileges the REST path has. Inside an outer transaction (tests) each
    call becomes a savepoint, and an error rolls back only that call."""

    def __init__(self, conn: Any):
        self.conn = conn

    @classmethod
    def connect(cls, url: str) -> SqlStore:
        import psycopg
        from psycopg.rows import dict_row

        try:
            conn = psycopg.connect(url, autocommit=True, row_factory=dict_row, connect_timeout=10,
                                   application_name="countersign-worker")
        except psycopg.Error as exc:
            raise StoreError(f"Postgres unreachable ({type(exc).__name__})") from None
        return cls(conn)

    def _q(self, sql: str, params: tuple = ()) -> list[dict[str, Any]]:
        import psycopg

        try:
            with self.conn.transaction(), self.conn.cursor() as cur:
                cur.execute("SET LOCAL ROLE service_role")
                cur.execute(sql, params)
                return cur.fetchall() if cur.description else []
        except psycopg.Error as exc:
            diag = getattr(exc, "diag", None)
            detail = getattr(diag, "message_detail", None) or ""
            raise StoreError(f"Postgres {getattr(exc, 'sqlstate', '')} {detail}: "
                             f"{str(exc).splitlines()[0][:300]}") from None

    def _one(self, sql: str, params: tuple) -> dict[str, Any]:
        return self._q(sql, params)[0]["r"]

    def receive(self, delivery_id: str, event_type: str, payload: dict[str, Any]) -> dict[str, Any]:
        from psycopg.types.json import Jsonb

        return self._one("SELECT public.ingest_receive(%s, %s, %s) AS r", (delivery_id, event_type, Jsonb(payload)))

    def read(self, qty: int, vt: int) -> list[dict[str, Any]]:
        return self._q("SELECT * FROM public.ingest_read(%s, %s)", (qty, vt))

    def mark_raw(self, delivery_id: str, mongo_id: str) -> dict[str, Any]:
        return self._one("SELECT public.ingest_mark_raw(%s, %s) AS r", (delivery_id, mongo_id))

    def project(self, delivery_id: str, payload: dict[str, Any], mongo_id: str) -> dict[str, Any]:
        from psycopg.types.json import Jsonb

        return self._one("SELECT public.project_push(%s, %s, %s) AS r", (delivery_id, Jsonb(payload), mongo_id))

    def fail(self, delivery_id: str, error: str, max_attempts: int = MAX_ATTEMPTS) -> dict[str, Any]:
        return self._one("SELECT public.ingest_fail(%s, %s, %s) AS r", (delivery_id, error, max_attempts))

    def event(self, delivery_id: str) -> dict[str, Any] | None:
        rows = self._q("SELECT delivery_id, status, team_id, mongo_id, followups_at FROM public.ingest_event "
                       "WHERE delivery_id = %s", (delivery_id,))
        return rows[0] if rows else None

    def set_received_at(self, delivery_id: str, at: datetime) -> None:
        self._q("UPDATE public.ingest_event SET received_at = %s WHERE delivery_id = %s", (at, delivery_id))

    def pending_followups(self, limit: int, older_than: datetime) -> list[dict[str, Any]]:
        return self._q("""
            SELECT delivery_id, team_id, projected_at FROM public.ingest_event
            WHERE status = 'projected' AND followups_at IS NULL AND projected_at < %s
            ORDER BY projected_at LIMIT %s""", (older_than, limit))

    def mark_followups(self, delivery_id: str) -> None:
        self._q("UPDATE public.ingest_event SET followups_at = now() WHERE delivery_id = %s", (delivery_id,))

    def note_artifacts(self, team_id: str, paths: list[str]) -> dict[str, dict[str, Any]]:
        if not paths:
            return {}
        rows = self._q("""
            SELECT a.artifact_id, a.external_ref,
                   coalesce(jsonb_agg(jsonb_build_object('version_no', v.version_no, 'source_ref', v.source_ref,
                                                         'created_at', v.created_at))
                            FILTER (WHERE v.source_ref IS NOT NULL), '[]') AS versions
            FROM public.artifact a
            LEFT JOIN public.artifact_version v ON v.artifact_id = a.artifact_id
            WHERE a.team_id = %s AND a.source IN ('github', 'obsidian') AND a.external_ref = ANY(%s)
            GROUP BY a.artifact_id, a.external_ref""", (team_id, paths))
        return _versions_by_sha(rows)

    def chunks_without_embedding(self, team_id: str | None, limit: int) -> list[dict[str, Any]]:
        return self._q("""
            SELECT ch.chunk_id, ch.content FROM public.artifact_chunk ch
            JOIN public.artifact a ON a.artifact_id = ch.artifact_id
            WHERE ch.embedding IS NULL AND (%s::text IS NULL OR a.team_id = %s)
            ORDER BY ch.chunk_id LIMIT %s""", (team_id, team_id, limit))

    def set_embedding(self, chunk_id: int, vector: list[float], model: str) -> None:
        self._q("UPDATE public.artifact_chunk SET embedding = %s::extensions.vector, embedding_model = %s "
                "WHERE chunk_id = %s AND embedding IS NULL", (_vector_literal(vector), model, chunk_id))

    def close(self) -> None:
        self.conn.close()


def make_store(settings: Settings, http: httpx.Client, backend: str | None = None) -> Store:
    """backend: 'rest' (service key) or 'sql' (INGEST_DB_URL); default: rest when a service
    key is configured, else sql."""
    import os

    backend = (backend or os.environ.get("INGEST_BACKEND") or "").lower() or (
        "rest" if settings.service_role_key else "sql")
    if backend == "rest":
        return RestStore(settings, http)
    if backend == "sql":
        if not settings.ingest_db_url:
            raise ConfigError("INGEST_DB_URL is not configured")
        return SqlStore.connect(settings.ingest_db_url)
    raise ConfigError("INGEST_BACKEND must be 'rest' or 'sql'")


# =====================================================================================
# Mongo side
# =====================================================================================

def _ts(value: Any) -> datetime | None:
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value, UTC)
    return None


def _files(c: dict[str, Any], key: str) -> list[str]:
    v = c.get(key)
    return [p for p in v if isinstance(p, str)] if isinstance(v, list) else []


_NOREPLY = re.compile(r"^[0-9]+\+[^@]+@users\.noreply\.github\.com$", re.IGNORECASE)


def email_hash(email: str) -> str:
    """sha256 of the lower-cased address: what the raw log keeps instead of the address.
    private.resolve_author matches it (author.email_sha256), so a replay from the log still
    resolves e-mail-only identities."""
    return hashlib.sha256(email.strip().lower().encode()).hexdigest()


def scrub_emails(payload: dict[str, Any]) -> dict[str, Any]:
    """A copy of the payload without personal e-mail addresses (commit author / committer,
    head_commit, pusher, repository owner ...): every "email" key is replaced by
    "email_sha256". GitHub no-reply addresses (<id>+<login>@users.noreply.github.com) are
    public pseudonyms of a login and are kept, so the login can still be derived."""
    def walk(v: Any) -> Any:
        if isinstance(v, dict):
            out = {}
            for k, x in v.items():
                if k == "email" and isinstance(x, str) and x and not _NOREPLY.match(x):
                    out["email_sha256"] = email_hash(x)
                elif k == "x_contents":
                    out[k] = x                              # file bodies: kept as they are
                else:
                    out[k] = walk(x)
            return out
        if isinstance(v, list):
            return [walk(x) for x in v]
        return v
    return walk(payload)


def raw_event_document(delivery_id: str, team_id: str, payload: dict[str, Any],
                       commit_authors: dict[str, str | None]) -> dict[str, Any]:
    """The Mongo raw-log document. `payload` is the push as received minus e-mail addresses
    (scrub_emails); `commits` is the enriched view the $jsonSchema validator and the
    consistency check use: a commit carries author_usn only when Postgres CREDITS it
    (ingest_read: the verified pusher's own commit, pusher on the team). Every other commit
    (unknown author, someone else's commit, non-member) goes to `unattributed_commits` with
    the author's name / login only, so the log keeps it without counting it as anyone's."""
    commits, unattributed = [], []
    for c in payload.get("commits") or []:
        if not isinstance(c, dict):
            continue
        raw_id = str(c.get("id") or "")
        sha = raw_id.lower()
        added, modified, removed = _files(c, "added"), _files(c, "modified"), _files(c, "removed")
        entry: dict[str, Any] = {
            "sha": sha, "message": str(c.get("message") or ""),
            "files_changed": len(set(added) | set(modified) | set(removed)),
            "added": added, "modified": modified, "removed": removed,
            "ai_assisted": ai_declared(c.get("message")),
        }
        if (ts := _ts(c.get("timestamp"))) is not None:
            entry["committed_at"] = ts
        usn = commit_authors.get(raw_id) or commit_authors.get(sha)
        if usn and SHA_RE.match(sha):
            commits.append({**entry, "author_usn": usn})
        else:
            author = c.get("author") if isinstance(c.get("author"), dict) else {}
            unattributed.append({**entry, "author": {k: author[k] for k in ("name", "username") if k in author}})
    repo = payload.get("repository") or {}
    pushed = (_ts((payload.get("head_commit") or {}).get("timestamp"))
              or _ts(repo.get("pushed_at")) or datetime.now(UTC))
    return {
        "_id": delivery_id, "event_id": delivery_id, "delivery_id": delivery_id,
        "team_id": team_id, "repo": str(repo.get("full_name") or "").lower(), "type": "push",
        "ref": payload.get("ref"), "before": payload.get("before"), "after": payload.get("after"),
        "pushed_at": pushed, "commits": commits, "unattributed_commits": unattributed,
        "sender": (payload.get("sender") or {}).get("login"),
        "payload": scrub_emails(payload), "source": "github-webhook",
    }


def log_raw_event(db: Database, doc: dict[str, Any]) -> str:
    """Upsert by _id = delivery id. Replaying the same delivery rewrites the same document."""
    prev = db.github_events.find_one({"_id": doc["_id"]}, {"logged_at": 1})
    doc = {**doc, "logged_at": (prev or {}).get("logged_at") or datetime.now(UTC)}
    db.github_events.replace_one({"_id": doc["_id"]}, doc, upsert=True)
    return doc["_id"]


def fetch_contents(http: httpx.Client, settings: Settings, payload: dict[str, Any],
                   max_files: int = 50, max_bytes: int = 200_000) -> dict[str, int]:
    """Step 0 (optional): fill commits[i].x_contents for added / modified markdown files from
    the GitHub contents API at that commit (GET /repos/{repo}/contents/{path}?ref={sha}),
    in place. Real push payloads carry paths only; without the text, a note produces a
    version and a contribution but no chunks and no Mongo note. Enabled by
    GITHUB_FETCH_CONTENTS=1 (GITHUB_TOKEN authenticates it; needed for private repositories).
    Returns {"fetched": n, "errors": n}; a failure leaves that file without text (no chunk)."""
    stats = {"fetched": 0, "errors": 0}
    if not settings.github_fetch_contents:
        return stats
    repo = str((payload.get("repository") or {}).get("full_name") or "")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9._-]+", repo):
        return stats
    headers = {"Accept": "application/vnd.github.raw+json", "X-GitHub-Api-Version": "2022-11-28",
               "User-Agent": "countersign-worker"}
    if settings.github_token:
        headers["Authorization"] = f"Bearer {settings.github_token}"
    budget = max_files
    for c in payload.get("commits") or []:
        if not isinstance(c, dict) or not SHA_RE.match(str(c.get("id") or "").lower()):
            continue
        have = c.get("x_contents") if isinstance(c.get("x_contents"), dict) else {}
        wanted = [p for p in dict.fromkeys(_files(c, "added") + _files(c, "modified"))
                  if p.lower().endswith(".md") and p not in have]
        for path in wanted:
            if budget <= 0:
                return stats
            budget -= 1
            try:
                r = http.get(f"{settings.github_api_url}/repos/{repo}/contents/{quote(path)}",
                             params={"ref": c["id"]}, headers=headers, timeout=20)
            except httpx.HTTPError:
                stats["errors"] += 1
                continue
            if r.status_code != 200 or len(r.content) > max_bytes:
                stats["errors"] += 1
                continue
            have = {**have, path: r.text}
            stats["fetched"] += 1
        if have:
            c["x_contents"] = have
    return stats


def note_id_for(team_id: str, path: str) -> str:
    """Stable note id of a vault file: NG- + 12 hex of sha1(team:path). Matches the notes
    API's id pattern ^N[0-9A-Za-z-]{1,39}$, so the author can keep editing it in the app."""
    return "NG-" + hashlib.sha1(f"{team_id}:{path}".encode()).hexdigest()[:12]


def sync_note_version(client: MongoClient, db: Database, *, team_id: str, path: str, artifact_id: str,
                      artifact_version_no: int, sha: str, usn: str, text: str, committed_at: datetime,
                      message: str) -> bool:
    """Append one immutable note_versions receipt for (vault file, commit) and, if this commit
    is NEWER than what the note shows, move the note to it, in one Mongo transaction, the same
    way POST /notes saves (version insert first, its _id makes the number single-use).
    Version numbers count receipts in arrival order; "current" follows commit time, so a push
    that arrives late never puts older text back. Returns False when already recorded."""
    note_id = note_id_for(team_id, path)
    title = note_title(path)
    ai = "assisted" if ai_declared(message) else "none"
    tags, links = note_tags(text), note_links(text)

    def write(session: Any) -> bool:
        if db.note_versions.find_one({"note_id": note_id, "source_ref": sha}, {"_id": 1}, session=session):
            return False
        current = db.notes.find_one({"note_id": note_id}, session=session)
        last = db.note_versions.find_one({"note_id": note_id}, {"version": 1}, sort=[("version", -1)],
                                         session=session)
        n = max(int((last or {}).get("version") or 0), int((current or {}).get("version") or 0)) + 1
        db.note_versions.insert_one({
            "_id": f"{note_id}:{n}", "note_id": note_id, "version": n, "team_id": team_id,
            "author_usn": usn, "title": title, "content": text, "content_hash": sha256(text),
            "status": "final", "tags": tags, "ai_assistance": ai, "created_at": committed_at,
            "source": "github", "source_ref": sha, "source_path": path,
            "artifact_id": artifact_id, "artifact_version_no": artifact_version_no,
        }, session=session)
        fields = {"title": title, "content": text, "tags": tags, "links": links, "status": "final",
                  "version": n, "ai_assistance": ai, "artifact_id": artifact_id, "updated_at": committed_at,
                  "updated_by": usn, "source": "github", "source_path": path, "source_ref": sha}
        shown = _aware((current or {}).get("updated_at"))
        if current is None:
            # pushed to the shared vault on the default branch = shared with the team
            db.notes.insert_one({"note_id": note_id, "team_id": team_id, "author_usn": usn,
                                 "visibility": "team", "created_at": committed_at, **fields}, session=session)
        elif shown is not None and _aware(committed_at) < shown:
            pass                          # an older commit arrived late: kept as history only
        else:
            r = db.notes.update_one({"note_id": note_id, "version": current.get("version")},
                                    {"$set": fields}, session=session)
            if r.matched_count != 1:
                raise RuntimeError(f"note {note_id} changed while syncing")
        return True

    return bool(_run_atomic(client, write))


def _aware(value: Any) -> datetime | None:
    if not isinstance(value, datetime):
        return None
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def sync_vault_notes(store: Store, client: MongoClient, db: Database, team_id: str,
                     payload: dict[str, Any], authors: dict[str, str | None]) -> int:
    """Vault markdown (shared/**.md, vault/**.md) carried in the payload -> Mongo notes.
    Only commits that Postgres actually projected (an artifact_version exists for the commit
    SHA) are mirrored, so a note version always matches a relational version receipt."""
    wanted: list[tuple[dict[str, Any], str, str]] = []
    for c in payload.get("commits") or []:
        contents = c.get("x_contents") if isinstance(c, dict) else None
        if not isinstance(contents, dict):
            continue
        touched = set(_files(c, "added")) | set(_files(c, "modified"))
        for path, text in contents.items():
            if isinstance(text, str) and path in touched and is_vault_note(path):
                wanted.append((c, path, text))
    if not wanted:
        return 0
    arts = store.note_artifacts(team_id, sorted({p for _, p, _ in wanted}))
    written = 0
    for c, path, text in wanted:
        sha = str(c.get("id") or "").lower()
        art = arts.get(path)
        usn = authors.get(str(c.get("id"))) or authors.get(sha)
        if not art or sha not in art["versions"] or not usn:
            continue                      # skipped by the projection (unknown author, non-member, ...)
        written += sync_note_version(
            client, db, team_id=team_id, path=path, artifact_id=art["artifact_id"],
            artifact_version_no=art["versions"][sha], sha=sha, usn=usn, text=text,
            committed_at=_ts(c.get("timestamp")) or datetime.now(UTC), message=str(c.get("message") or ""))
    return written


# =====================================================================================
# The worker
# =====================================================================================

def _short(exc: BaseException) -> str:
    """An error text for ingest_event.error: the type and the first line, never a URI."""
    text = str(exc).splitlines()[0] if str(exc) else ""
    text = re.sub(r"mongodb(\+srv)?://\S+", "mongodb://…", text)
    return f"{type(exc).__name__}: {text}"[:300]


class Worker:
    def __init__(self, store: Store, mongo: MongoClient, db: Database, settings: Settings,
                 http: httpx.Client | None = None, log: Callable[[dict[str, Any]], None] | None = None):
        self.store, self.mongo, self.db, self.settings = store, mongo, db, settings
        self.http = http or httpx.Client(timeout=30)
        self.log = log or (lambda _e: None)

    # ---- one message ----
    def process(self, row: dict[str, Any]) -> dict[str, Any]:
        delivery_id = row["delivery_id"]
        payload = row.get("payload") or {}
        team_id = row.get("team_id")
        authors = row.get("commit_authors") or {}
        out: dict[str, Any] = {"delivery_id": delivery_id, "msg_id": row.get("msg_id"),
                               "read_ct": row.get("read_ct"), "team_id": team_id}
        # a message that keeps coming back without ever finishing (the worker was killed while
        # holding it, again and again) is dead-lettered before it can take the worker down again
        if int(row.get("read_ct") or 0) > MAX_READS:
            return {**out, **self._failed(delivery_id, f"read {row.get('read_ct')} times without completing; "
                                                        "dead-lettered", max_attempts=1)}
        # 0. CONTENTS (optional)
        try:
            fetched = fetch_contents(self.http, self.settings, payload)
            if fetched["fetched"] or fetched["errors"]:
                out["contents"] = fetched
        except Exception as exc:  # noqa: BLE001 - texts are optional; never block the projection
            out["contents_error"] = _short(exc)
        # 2. LOG
        try:
            if not team_id:
                raise ValueError("delivery has no team (not in ingest_event)")
            mongo_id = log_raw_event(self.db, raw_event_document(delivery_id, team_id, payload, authors))
        except Exception as exc:  # noqa: BLE001 - recorded, retried
            return {**out, **self._failed(delivery_id, f"raw log: {_short(exc)}")}
        try:
            self.store.mark_raw(delivery_id, mongo_id)
            # 3. PROJECTION
            res = self.store.project(delivery_id, payload, mongo_id)
        except StoreError as exc:
            # (if project_push DID commit and only its response was lost, ingest_fail leaves the
            # projected event alone and the follow-up pass of a later drain finishes step 4)
            return {**out, **self._failed(delivery_id, f"projection: {exc}")}
        out.update(status=res.get("status"), duplicate=bool(res.get("duplicate")),
                   attempts=res.get("attempts"), error=res.get("error"))
        for k in ("commits", "skipped_commits", "unverified_commits", "artifacts_created", "versions",
                  "contributions", "chunks"):
            if k in res:
                out[k] = res[k]
        if res.get("warnings"):
            out["warnings"] = len(res["warnings"])
        if res.get("status") != "projected":
            return out
        # 4. FOLLOW-UPS (the message is already archived; a failure here is retried by the
        #    follow-up pass of the next drain, or by the CLI)
        out.update(self.followups(delivery_id, team_id, payload, authors, embed=bool(out.get("chunks"))))
        return out

    def followups(self, delivery_id: str, team_id: str, payload: dict[str, Any],
                  authors: dict[str, str | None], embed: bool = True) -> dict[str, Any]:
        out: dict[str, Any] = {}
        try:
            out["note_versions"] = sync_vault_notes(self.store, self.mongo, self.db, team_id, payload, authors)
        except Exception as exc:  # noqa: BLE001
            out["notes_error"] = _short(exc)
        if self.settings.voyage_api_key and embed:
            try:
                out["embedded"] = self.embed_missing(team_id)
            except Exception as exc:  # noqa: BLE001
                out["embed_error"] = _short(exc)
        if "notes_error" not in out and "embed_error" not in out:
            try:
                self.store.mark_followups(delivery_id)
            except StoreError as exc:
                out["followups_mark_error"] = str(exc)
        return out

    def recover_followups(self, min_age: float = FOLLOWUP_GRACE, limit: int = 50) -> dict[str, int]:
        """Finish step 4 for projected events whose follow-ups never completed (worker crash
        after project_push committed, or its response was lost). The payload comes from the
        Mongo raw log (_id = delivery id); the commit -> USN map from its commits[]."""
        stats = {"recovered": 0, "note_versions": 0, "missing_raw": 0, "errors": 0}
        older_than = datetime.now(UTC) - timedelta(seconds=min_age)
        for ev in self.store.pending_followups(limit, older_than):
            doc = self.db.github_events.find_one({"_id": ev["delivery_id"]})
            if not doc or not isinstance(doc.get("payload"), dict):
                stats["missing_raw"] += 1
                continue
            authors = {c["sha"]: c["author_usn"] for c in doc.get("commits") or [] if c.get("author_usn")}
            res = self.followups(ev["delivery_id"], doc["team_id"], doc["payload"], authors)
            if any(k.endswith("_error") for k in res):
                stats["errors"] += 1
                continue
            stats["recovered"] += 1
            stats["note_versions"] += int(res.get("note_versions") or 0)
        return stats

    def _failed(self, delivery_id: str, error: str, max_attempts: int = MAX_ATTEMPTS) -> dict[str, Any]:
        try:
            res = self.store.fail(delivery_id, error, max_attempts)
        except StoreError as exc:      # Postgres itself is down: the message simply reappears
            return {"status": "failed", "error": error, "fail_record_error": str(exc)}
        return {"status": "failed", "error": error, "attempts": res.get("attempts"),
                "dead_letter": bool(res.get("dead_letter"))}

    # ---- the queue ----
    def drain(self, max_messages: int = 100, batch: int = DEFAULT_BATCH, vt: int = DEFAULT_VT,
              recover_min_age: float = FOLLOWUP_GRACE) -> dict[str, Any]:
        """Read and process messages until the queue has no visible message or max_messages
        were handled. A message that failed stays hidden for `vt` seconds, so it is retried by
        a later drain, not hammered inside this one. Per-team FIFO: after a team's message
        fails, its later messages in this drain are left for the next one (they reappear after
        `vt`, behind the failed one, because ingest_read returns the oldest first)."""
        outcomes: list[dict[str, Any]] = []
        started = time.monotonic()
        recovered = self.recover_followups(recover_min_age)
        batch = max(1, min(batch, vt // SECONDS_PER_MESSAGE or 1))
        blocked: set[str] = set()
        queue_empty = False
        while len(outcomes) < max_messages:
            rows = self.store.read(min(batch, max_messages - len(outcomes)), vt)
            if not rows:
                queue_empty = True
                break
            progressed = False
            for row in rows:
                if row.get("team_id") in blocked:
                    o = {"delivery_id": row["delivery_id"], "team_id": row.get("team_id"), "status": "deferred",
                         "read_ct": row.get("read_ct")}
                else:
                    o = self.process(row)
                    progressed = True
                    if o.get("status") == "failed" and row.get("team_id"):
                        blocked.add(row["team_id"])
                self.log({"event": "processed", **o})
                outcomes.append(o)
            if not progressed:
                break
        count = lambda pred: sum(1 for o in outcomes if pred(o))  # noqa: E731
        return {
            "processed": count(lambda o: o.get("status") != "deferred"),
            "projected": count(lambda o: o.get("status") == "projected" and not o.get("duplicate")),
            "duplicates": count(lambda o: bool(o.get("duplicate"))),
            "ignored": count(lambda o: o.get("status") == "ignored"),
            "failed": count(lambda o: o.get("status") == "failed"),
            "deferred": count(lambda o: o.get("status") == "deferred"),
            "dead_letters": count(lambda o: bool(o.get("dead_letter"))),
            "contributions": sum(int(o.get("contributions") or 0) for o in outcomes),
            "note_versions": sum(int(o.get("note_versions") or 0) for o in outcomes) + recovered["note_versions"],
            "followups_recovered": recovered["recovered"],
            "queue_empty": queue_empty,
            "seconds": round(time.monotonic() - started, 3),
            "outcomes": outcomes,
        }

    # ---- re-runnable follow-ups ----
    def resync_notes(self) -> int:
        """Rebuild vault notes from the Mongo raw log (idempotent)."""
        written = 0
        for doc in self.db.github_events.find({"delivery_id": {"$exists": True}, "payload": {"$exists": True}}):
            authors = {c["sha"]: c["author_usn"] for c in doc.get("commits") or []}
            written += sync_vault_notes(self.store, self.mongo, self.db, doc["team_id"], doc["payload"], authors)
        return written

    def reproject_from_log(self, drain: bool = True) -> dict[str, Any]:
        """Replay the Mongo raw log into Postgres: every pipeline event (a document with a
        delivery_id and its payload) whose delivery is not projected in Postgres goes back
        through ingest_receive (same delivery id; received_at restored from logged_at), then
        the queue is drained. Idempotent: every projection key is a commit SHA, and a delivery
        that is already projected is skipped. This is "the projection can be rebuilt from the
        raw log"; the reverse is impossible by design (ingest_event stores no payload)."""
        stats: dict[str, Any] = {"log_events": 0, "already_projected": 0, "queued": 0, "requeued": 0,
                                 "ignored": 0, "duplicates": 0}
        cursor = self.db.github_events.find({"delivery_id": {"$exists": True}, "payload": {"$exists": True}},
                                            {"_id": 1, "payload": 1, "logged_at": 1}).sort("logged_at", 1)
        for doc in cursor:
            stats["log_events"] += 1
            ev = self.store.event(doc["_id"])
            if ev and ev["status"] == "projected":
                stats["already_projected"] += 1
                continue
            res = self.store.receive(doc["_id"], "push", doc["payload"])
            if res.get("requeued"):
                stats["requeued"] += 1
            elif res.get("duplicate"):
                stats["duplicates"] += 1
            elif res.get("status") == "queued":
                stats["queued"] += 1
                if isinstance(doc.get("logged_at"), datetime):
                    self.store.set_received_at(doc["_id"], _aware(doc["logged_at"]))
            else:
                stats["ignored"] += 1
        if drain:
            summary = self.drain(max_messages=10_000)
            stats["drain"] = {k: v for k, v in summary.items() if k != "outcomes"}
        return stats

    def embed_missing(self, team_id: str | None = None, limit: int = 256) -> int:
        """Embed chunks that have no vector yet (VOYAGE_API_KEY). Returns the count stored."""
        if not self.settings.voyage_api_key:
            return 0
        chunks = self.store.chunks_without_embedding(team_id, limit)
        done = 0
        for i in range(0, len(chunks), embeddings.BATCH):
            part = chunks[i:i + embeddings.BATCH]
            vectors = embeddings.embed(self.http, self.settings, [c["content"] for c in part], "document")
            for c, v in zip(part, vectors, strict=True):
                self.store.set_embedding(c["chunk_id"], v, self.settings.voyage_model)
                done += 1
        return done


# =====================================================================================
# CLI
# =====================================================================================

def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m app.worker", description=__doc__.split("\n\n")[0])
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--once", action="store_true", help="drain until the queue is empty, then exit (default)")
    mode.add_argument("--loop", action="store_true", help="keep draining; sleep --interval between empty polls")
    mode.add_argument("--resync-notes", action="store_true", help="rebuild vault notes from the raw log")
    mode.add_argument("--reproject-from-log", action="store_true",
                      help="replay the Mongo raw log into Postgres (ingest_receive + drain)")
    mode.add_argument("--embed-missing", action="store_true", help="embed chunks without a vector")
    ap.add_argument("--interval", type=float, default=5.0)
    ap.add_argument("--max", type=int, default=500, help="messages per drain")
    ap.add_argument("--batch", type=int, default=DEFAULT_BATCH)
    ap.add_argument("--vt", type=int, default=DEFAULT_VT, help="visibility timeout, seconds")
    ap.add_argument("--backend", choices=["rest", "sql"], help="Postgres access (default: rest if a service key is set)")
    ap.add_argument("--verbose", "-v", action="store_true", help="print one JSON line per message")
    args = ap.parse_args(argv)

    settings = get_settings()
    http = httpx.Client(timeout=60)
    try:
        store = make_store(settings, http, args.backend)
    except (ConfigError, StoreError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    mongo = MongoClient(settings.mongodb_uri, tz_aware=True, appname="countersign-worker",
                        serverSelectionTimeoutMS=10_000)
    db = mongo[settings.mongo_db]
    emit = (lambda e: print(json.dumps(e, default=str), flush=True)) if args.verbose else None
    worker = Worker(store, mongo, db, settings, http, emit)
    target = {"supabase": settings.supabase_target, "mongo": f"{settings.mongo_target}/{settings.mongo_db}",
              "backend": type(store).__name__, "embeddings": bool(settings.voyage_api_key),
              "github_contents": settings.github_fetch_contents}
    try:
        if args.resync_notes:
            print(json.dumps({**target, "note_versions_written": worker.resync_notes()}))
        elif args.reproject_from_log:
            print(json.dumps({**target, **worker.reproject_from_log()}, default=str, indent=1))
        elif args.embed_missing:
            print(json.dumps({**target, "embedded": worker.embed_missing()}))
        elif args.loop:
            print(json.dumps({**target, "mode": "loop"}), flush=True)
            while True:
                summary = worker.drain(args.max, args.batch, args.vt)
                if summary["processed"]:
                    print(json.dumps({k: v for k, v in summary.items() if k != "outcomes"}), flush=True)
                if summary["queue_empty"]:
                    time.sleep(args.interval)
        else:
            summary = worker.drain(args.max, args.batch, args.vt)
            if not args.verbose:
                summary["outcomes"] = [{k: o.get(k) for k in ("delivery_id", "status", "duplicate", "contributions",
                                                              "chunks", "note_versions", "attempts", "error")
                                        if o.get(k) is not None} for o in summary["outcomes"]]
            print(json.dumps({**target, **summary}, default=str, indent=1))
            return 1 if summary["failed"] else 0
    except KeyboardInterrupt:
        return 0
    except StoreError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    finally:
        mongo.close()
        http.close()
        if isinstance(store, SqlStore):
            store.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
