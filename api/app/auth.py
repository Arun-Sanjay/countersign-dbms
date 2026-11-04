"""Who is calling, and what may they see — decided by Postgres, as the caller.

1. Verify the Supabase access token (Authorization: Bearer <jwt>).
   - Asymmetric signing keys (ES256 / RS256 / EdDSA; the local CLI stack and new projects):
     verified offline against the project's JWKS (/auth/v1/.well-known/jwks.json), with
     audience 'authenticated' and the project's issuer.
   - Legacy HS256 shared-secret tokens: the API does not hold the JWT secret, so it asks
     Auth itself (GET /auth/v1/user with the token).
2. Every Postgres read goes through PostgREST WITH THE CALLER'S TOKEN (never a service key),
   so the row-level-security policies of migration 0003 decide what comes back.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Literal

import httpx
import jwt
from fastapi import HTTPException, Request

from .config import Settings

ASYMMETRIC = {"ES256", "RS256", "EdDSA"}
TEAM_RE = re.compile(r"^T[0-9]{2,3}$")


def problem(status: int, code: str, message: str) -> HTTPException:
    """Errors carry a stable rule key (`code`), like the DB's DETAIL keys."""
    headers = {"WWW-Authenticate": "Bearer"} if status == 401 else None
    return HTTPException(status_code=status, detail={"code": code, "message": message}, headers=headers)


@dataclass(frozen=True)
class Caller:
    token: str
    user_id: str
    role: str                       # student | faculty | admin  (from app_user, via RLS)
    usn: str | None
    faculty_id: str | None


@dataclass(frozen=True)
class TeamAccess:
    team_id: str
    team_name: str
    project_id: str
    # member: the caller is in the team. staff: teaching faculty / admin (metadata tier)
    access: Literal["member", "staff"]


class Postgrest:
    """PostgREST as the calling user."""

    def __init__(self, settings: Settings, http: httpx.Client, token: str):
        self.base = f"{settings.supabase_url}/rest/v1"
        self.http = http
        self.headers = {"apikey": settings.supabase_anon_key, "Authorization": f"Bearer {token}",
                        "Accept": "application/json"}

    def get(self, path: str, params: dict[str, str]) -> list[dict[str, Any]]:
        try:
            r = self.http.get(f"{self.base}/{path}", params=params, headers=self.headers)
        except httpx.HTTPError as exc:
            raise problem(502, "postgres_unavailable", f"PostgREST unreachable ({type(exc).__name__})")
        if r.status_code in (401, 403):
            raise problem(401, "invalid_token", "Postgres rejected the token")
        if r.status_code >= 400:
            body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
            raise problem(502, "postgres_error", f"PostgREST {r.status_code}: {body.get('message', '')}")
        return r.json()

    def get_all(self, path: str, params: dict[str, str], page: int = 1000) -> list[dict[str, Any]]:
        """Every row, page by page (PostgREST caps a response at max_rows = 1000). `params`
        must carry a deterministic `order`; pages are fetched with limit/offset until one
        comes back short."""
        assert "order" in params, "get_all needs a deterministic order"
        out: list[dict[str, Any]] = []
        while True:
            rows = self.get(path, {**params, "limit": str(page), "offset": str(len(out))})
            out.extend(rows)
            if len(rows) < page:
                return out

    def rpc(self, name: str, body: dict[str, Any]) -> Any:
        """Call a database function AS THE CALLER (its EXECUTE grant and RLS apply)."""
        try:
            r = self.http.post(f"{self.base}/rpc/{name}", json=body,
                               headers={**self.headers, "Content-Type": "application/json"})
        except httpx.HTTPError as exc:
            raise problem(502, "postgres_unavailable", f"PostgREST unreachable ({type(exc).__name__})")
        if r.status_code == 401:
            raise problem(401, "invalid_token", "Postgres rejected the token")
        if r.status_code >= 400:
            body_ = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
            if body_.get("code") == "42501":
                raise problem(403, "permission_denied", f"Not allowed to call {name}")
            raise problem(502, "postgres_error", f"PostgREST {r.status_code}: {body_.get('message', '')}")
        return r.json()


class Authenticator:
    def __init__(self, settings: Settings, http: httpx.Client):
        self.settings = settings
        self.http = http
        self.jwks = jwt.PyJWKClient(f"{settings.issuer}/.well-known/jwks.json",
                                    cache_keys=True, lifespan=600, timeout=10)

    def _verify(self, token: str) -> str:
        """Return the user id (sub) of a valid token, else raise 401."""
        try:
            header = jwt.get_unverified_header(token)
        except jwt.PyJWTError:
            raise problem(401, "invalid_token", "Malformed bearer token")
        alg = header.get("alg")
        if alg in ASYMMETRIC:
            try:
                key = self.jwks.get_signing_key_from_jwt(token)
                claims = jwt.decode(token, key.key, algorithms=[alg], audience="authenticated",
                                    issuer=self.settings.issuer,
                                    options={"require": ["exp", "sub", "aud", "iss"]})
            except (jwt.PyJWTError, jwt.PyJWKClientError):
                raise problem(401, "invalid_token", "Token signature, audience, issuer or expiry is invalid")
            if claims.get("role") != "authenticated":
                raise problem(401, "invalid_token", "Not a signed-in user token")
            return str(claims["sub"])
        if alg == "HS256":
            r = self.http.get(f"{self.settings.issuer}/user",
                              headers={"apikey": self.settings.supabase_anon_key,
                                       "Authorization": f"Bearer {token}"})
            if r.status_code != 200 or not r.json().get("id"):
                raise problem(401, "invalid_token", "Supabase Auth rejected the token")
            return str(r.json()["id"])
        raise problem(401, "invalid_token", f"Unsupported token algorithm {alg!r}")

    def caller(self, request: Request) -> Caller:
        auth = request.headers.get("authorization", "")
        scheme, _, token = auth.partition(" ")
        if scheme.lower() != "bearer" or not token.strip():
            raise problem(401, "auth_required", "Sign in: send Authorization: Bearer <supabase access token>")
        token = token.strip()
        user_id = self._verify(token)
        # app_user_select policy: a user reads only their own profile row
        rows = Postgrest(self.settings, self.http, token).get(
            "app_user", {"select": "role,usn,faculty_id", "user_id": f"eq.{user_id}"})
        if not rows:
            raise problem(403, "profile_required", "This login has no Countersign profile yet")
        p = rows[0]
        return Caller(token=token, user_id=user_id, role=p["role"], usn=p.get("usn"),
                      faculty_id=p.get("faculty_id"))


def visible_teams(pg: Postgrest, caller: Caller, team_id: str | None = None) -> list[TeamAccess]:
    """Teams the caller may see, as RLS answers it.

    v_faculty_team_progress is a security_invoker view whose WHERE clause is
    `app.oversees_project(project) OR app.is_team_member(team)`, so asking it AS THE CALLER
    returns exactly the teams the caller belongs to or teaches (admins: all).
    """
    params = {"select": "team_id,team_name,project_id", "order": "team_id"}
    if team_id:
        params["team_id"] = f"eq.{team_id}"
    rows = pg.get("v_faculty_team_progress", params)
    access: Literal["member", "staff"] = "member" if caller.role == "student" else "staff"
    return [TeamAccess(r["team_id"], r["team_name"], r["project_id"], access) for r in rows]


def require_team(pg: Postgrest, caller: Caller, team_id: str) -> TeamAccess:
    if not TEAM_RE.match(team_id):
        raise problem(422, "team_id", "team_id looks like T01")
    teams = visible_teams(pg, caller, team_id)
    if teams:
        return teams[0]
    # The team directory is readable by every profile, so existence is not a secret.
    if pg.get("team", {"select": "team_id", "team_id": f"eq.{team_id}"}):
        raise problem(403, "team_access_denied", f"You are not a member or the teaching faculty of team {team_id}")
    raise problem(404, "team_not_found", f"No team {team_id}")
