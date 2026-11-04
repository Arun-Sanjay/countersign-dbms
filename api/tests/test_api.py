"""API tests against the local Supabase stack (personas, RLS) and MongoDB (Atlas by default).

Personas (scripts/create_personas.py): arun 1RV24CY047 (T00, T01, T03, T05), sanvid 1RV24CY051
(T00), meera 1RV24CY033 (T01, T03, T06), nikhil 1RV24CY077 (no team), ramesh = faculty F01
(teaches CD252IA: T00, T01, T02, T06), lakshmi = faculty F02 (CD253IA: T03), admin.
"""

from __future__ import annotations

import hashlib
import uuid

import jwt


def ids(body):
    return sorted(n["note_id"] for n in body["notes"])


# ---------------------------------------------------------------- health

def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200, r.text
    assert r.json()["postgres"] == "ok" and r.json()["mongo"] == "ok"


def test_cors_allows_the_web_app(client):
    r = client.options("/notes", headers={"Origin": "http://localhost:5173",
                                          "Access-Control-Request-Method": "GET",
                                          "Access-Control-Request-Headers": "authorization"})
    assert r.headers.get("access-control-allow-origin") == "http://localhost:5173"


# ---------------------------------------------------------------- auth required

def test_notes_require_a_token(client):
    r = client.get("/notes", params={"team_id": "T01"})
    assert r.status_code == 401
    assert r.json()["detail"]["code"] == "auth_required"
    assert r.headers["www-authenticate"] == "Bearer"


def test_garbage_and_tampered_tokens_are_rejected(client, tokens):
    assert client.get("/notes", params={"team_id": "T01"},
                      headers={"Authorization": "Bearer not-a-jwt"}).status_code == 401
    # flip the payload (claim another user) but keep arun's signature
    head, payload, sig = tokens["arun"].split(".")
    forged = ".".join([head, payload[:-4] + ("AAAA" if payload[-4:] != "AAAA" else "BBBB"), sig])
    r = client.get("/notes", params={"team_id": "T01"}, headers={"Authorization": f"Bearer {forged}"})
    assert r.status_code == 401 and r.json()["detail"]["code"] == "invalid_token"


def test_hs256_token_with_wrong_secret_is_rejected(client):
    fake = jwt.encode({"sub": str(uuid.uuid4()), "role": "authenticated", "aud": "authenticated",
                       "exp": 4102444800}, "not-the-project-secret-at-all-0123456789", algorithm="HS256")
    r = client.get("/notes", params={"team_id": "T01"}, headers={"Authorization": f"Bearer {fake}"})
    assert r.status_code == 401


def test_every_endpoint_needs_auth(client):
    assert client.get("/consistency").status_code == 401
    assert client.get("/notes/N01/versions").status_code == 401
    assert client.post("/notes", json={"team_id": "T00", "title": "x"}).status_code == 401


# ---------------------------------------------------------------- forbidden team

def test_student_without_team_is_forbidden(client, auth):
    r = client.get("/notes", params={"team_id": "T01"}, headers=auth("nikhil"))
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "team_access_denied"


def test_student_of_another_team_is_forbidden(client, auth):
    r = client.get("/notes", params={"team_id": "T02"}, headers=auth("arun"))
    assert r.status_code == 403


def test_faculty_of_another_course_is_forbidden(client, auth):
    assert client.get("/notes", params={"team_id": "T01"}, headers=auth("lakshmi")).status_code == 403


def test_unknown_and_malformed_team(client, auth):
    assert client.get("/notes", params={"team_id": "T99"}, headers=auth("arun")).status_code == 404
    assert client.get("/notes", params={"team_id": "x; drop"}, headers=auth("arun")).status_code == 422


def test_versions_of_an_invisible_note_look_missing(client, auth):
    r = client.get("/notes/N01/versions", headers=auth("nikhil"))
    assert r.status_code == 404 and r.json()["detail"]["code"] == "note_not_found"
    # N03 is Karthik's draft: arun is in T01 but drafts of other authors are not shown
    assert client.get("/notes/N03/versions", headers=auth("arun")).status_code == 404


# ---------------------------------------------------------------- happy path (read)

def test_member_sees_final_notes_and_own_drafts(client, auth):
    r = client.get("/notes", params={"team_id": "T01"}, headers=auth("arun"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["access"] == "member" and body["team_id"] == "T01"
    assert ids(body) == ["N01", "N02", "N04"]          # N03 = someone else's draft
    n01 = next(n for n in body["notes"] if n["note_id"] == "N01")
    assert n01["content"].startswith("Problem statement")
    assert n01["history"] == {"versions": 1}           # backfilled snapshot N01:3
    assert n01["content_withheld"] is False


def test_teammate_does_not_see_others_drafts(client, auth):
    r = client.get("/notes", params={"team_id": "T01"}, headers=auth("meera"))
    assert r.status_code == 200
    assert ids(r.json()) == ["N01", "N02"]


def test_faculty_sees_metadata_only(client, auth):
    r = client.get("/notes", params={"team_id": "T01"}, headers=auth("ramesh"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["access"] == "staff"
    assert ids(body) == ["N01", "N02"]                 # final notes only
    assert all(n["content"] is None and n["content_withheld"] for n in body["notes"])
    v = client.get("/notes/N01/versions", headers=auth("ramesh")).json()
    assert v["count"] == 1 and v["versions"][0]["content"] is None
    assert len(v["versions"][0]["content_hash"]) == 64  # the receipt is still visible


def test_other_faculty_sees_their_own_course(client, auth):
    r = client.get("/notes", params={"team_id": "T03"}, headers=auth("lakshmi"))
    assert r.status_code == 200 and ids(r.json()) == ["N07"]


def test_versions_endpoint(client, auth):
    r = client.get("/notes/N01/versions", headers=auth("arun"))
    assert r.status_code == 200, r.text
    v = r.json()
    assert v["current_version"] == 3 and v["count"] == 1
    first = v["versions"][0]
    assert first["version_id"] == "N01:3" and first["backfilled"] is True
    assert first["content_hash"] == hashlib.sha256(first["content"].encode()).hexdigest()


# ---------------------------------------------------------------- happy path (write)

def test_create_update_and_history(client, auth, mongo_db):
    note_id = f"NTEST-{uuid.uuid4().hex[:8]}"
    r = client.post("/notes", headers=auth("arun"), json={
        "note_id": note_id, "team_id": "T00", "title": "Viva prep", "content": "v1 text",
        "tags": ["viva"], "status": "draft"})
    assert r.status_code == 201, r.text
    note = r.json()["note"]
    assert r.json()["created"] is True
    assert note["author_usn"] == "1RV24CY047" and note["version"] == 1 and note["history"]["versions"] == 1

    r = client.post("/notes", headers=auth("arun"), json={
        "note_id": note_id, "team_id": "T00", "title": "Viva prep", "content": "v2 text",
        "status": "final", "base_version": 1, "ai_assistance": "assisted"})
    assert r.status_code == 200, r.text
    assert r.json()["note"]["version"] == 2 and r.json()["note"]["history"]["versions"] == 2

    # stale base version -> 409, nothing written
    r = client.post("/notes", headers=auth("arun"), json={
        "note_id": note_id, "team_id": "T00", "title": "Viva prep", "content": "lost update",
        "base_version": 1})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "version_conflict"

    v = client.get(f"/notes/{note_id}/versions", headers=auth("arun")).json()
    assert [x["version"] for x in v["versions"]] == [2, 1]
    assert [x["content"] for x in v["versions"]] == ["v2 text", "v1 text"]
    assert v["versions"][0]["content_hash"] == hashlib.sha256(b"v2 text").hexdigest()
    assert v["versions"][0]["ai_assistance"] == "assisted"
    assert {x["author_usn"] for x in v["versions"]} == {"1RV24CY047"}

    # the teammate sees the final note, but cannot write a version of arun's note
    listed = client.get("/notes", params={"team_id": "T00"}, headers=auth("sanvid")).json()
    assert note_id in ids(listed)
    r = client.post("/notes", headers=auth("sanvid"), json={
        "note_id": note_id, "team_id": "T00", "title": "hijack", "content": "x"})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "note_author_required"

    # the stored documents passed the $jsonSchema validators
    assert mongo_db.note_versions.count_documents({"note_id": note_id}) == 2
    assert mongo_db.notes.find_one({"note_id": note_id})["version"] == 2


def test_new_note_without_id_gets_one(client, auth):
    r = client.post("/notes", headers=auth("sanvid"), json={"team_id": "T00", "title": "Cardinality", "content": "1:N"})
    assert r.status_code == 201
    assert r.json()["note"]["note_id"].startswith("N-")
    assert r.json()["note"]["author_usn"] == "1RV24CY051"


def test_write_is_forbidden_outside_the_team_and_for_faculty(client, auth):
    body = {"team_id": "T00", "title": "x", "content": "y"}
    assert client.post("/notes", headers=auth("nikhil"), json=body).status_code == 403
    r = client.post("/notes", headers=auth("ramesh"), json=body)
    assert r.status_code == 403 and r.json()["detail"]["code"] == "student_required"
    # note id of another team cannot be reused from T00
    r = client.post("/notes", headers=auth("arun"), json={**body, "note_id": "N01"})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "note_team_mismatch"


def test_payload_validation(client, auth):
    r = client.post("/notes", headers=auth("arun"), json={"team_id": "T00", "title": ""})
    assert r.status_code == 422


# ---------------------------------------------------------------- consistency

def _team(body, team_id):
    return next(t for t in body["teams"] if t["team_id"] == team_id)


def test_consistency_for_a_student(client, auth):
    """The scratch Mongo db holds only the fixture's M2 pushes (no delivery id: they never went
    through the pipeline) and Postgres holds the demo's hand-entered github rows (short SHAs).
    Both are reported as outside_pipeline evidence, never as a discrepancy. The pipeline half
    (delivery ids, full SHAs) is covered in test_worker.py."""
    r = client.get("/consistency", headers=auth("arun"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert {t["team_id"] for t in body["teams"]} == {"T00", "T01", "T03", "T05"}
    t01 = _team(body, "T01")       # M2 pushes E01, E02
    assert {a["usn"]: a["outside_pipeline"]["mongo_commits"] for a in t01["authors"]
            if a["outside_pipeline"]["mongo_commits"]} == {"1RV24CY011": 1, "1RV24CY024": 2, "1RV24CY047": 2}
    t00 = _team(body, "T00")       # demo rows 3f9c2ab (arun) and 8d41e07 (sanvid)
    sanvid = next(a for a in t00["authors"] if a["usn"] == "1RV24CY051")
    assert sanvid["outside_pipeline"] == {"mongo_commits": 0, "postgres_contributions": 1}
    assert sanvid["status"] == "outside_pipeline" and sanvid["only_in_postgres"] == []
    for team in body["teams"]:
        for a in team["authors"]:
            if not (a["matched"] or a["only_in_mongo"] or a["only_in_postgres"] or a["not_projected"]):
                assert a["status"] == "outside_pipeline", a
    t05 = _team(body, "T05")
    assert t05["authors"] == [] and t05["note"] == "no recorded evidence yet" and t05["status"] == "no_evidence"
    assert t05["pipeline_events"] == {}         # ingest_event is staff-only metadata


def test_consistency_for_faculty_and_teamless(client, auth, teamless):
    r = client.get("/consistency", headers=auth("ramesh"))
    assert {t["team_id"] for t in r.json()["teams"]} == {"T00", "T01", "T02", "T06"}
    assert all(t["access"] == "staff" for t in r.json()["teams"])
    assert client.get("/consistency", headers=auth(teamless("nikhil"))).json()["teams"] == []
    assert client.get("/consistency", params={"team_id": "T03"}, headers=auth("ramesh")).status_code == 403


def test_consistency_never_returns_commit_messages(client, auth):
    text = client.get("/consistency", headers=auth("admin")).text
    assert "Add CREATE TABLE scripts" not in text


def test_concurrent_saves_from_one_base_have_one_winner(client, auth):
    import threading

    note_id = f"NRACE-{uuid.uuid4().hex[:8]}"
    assert client.post("/notes", headers=auth("arun"), json={
        "note_id": note_id, "team_id": "T00", "title": "race", "content": "v1"}).status_code == 201
    results: list[int] = []

    def save(i: int) -> None:
        r = client.post("/notes", headers=auth("arun"), json={
            "note_id": note_id, "team_id": "T00", "title": "race", "content": f"writer {i}", "base_version": 1})
        results.append(r.status_code)

    threads = [threading.Thread(target=save, args=(i,)) for i in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(results) == [200, 409, 409, 409]
    v = client.get(f"/notes/{note_id}/versions", headers=auth("arun")).json()
    assert v["current_version"] == 2 and [x["version"] for x in v["versions"]] == [2, 1]
