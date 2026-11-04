"""Settings, resolved once at startup.

Order of precedence for every value: real environment > api/.env > the defaults below.

Supabase (SUPABASE_TARGET = local | remote, default local):
  SUPABASE_URL / SUPABASE_ANON_KEY, if set, win. Otherwise
    local  -> `npx -y supabase@latest status -o env` (API_URL, ANON_KEY of the local stack)
    remote -> web/.env.remote (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY; publishable values)
  Every USER-facing Postgres read runs through PostgREST with the CALLER's JWT, so RLS
  decides. The anon (publishable) key is the only key those requests carry.

Ingestion worker only (app/worker.py; POST /ingest/drain):
  The pipeline RPCs (ingest_read, ingest_mark_raw, project_push, ingest_fail) are
  service_role-only by design (migration 0005 §9), so the worker needs ONE of:
    INGEST_DB_URL              a Postgres URL; the worker runs the RPCs over psycopg
    SUPABASE_SERVICE_ROLE_KEY  the worker calls them through PostgREST /rest/v1/rpc
  For the local stack both are read from `supabase status` (DB_URL, SERVICE_ROLE_KEY) when
  unset; for remote they must come from the environment. Neither is ever used for a user
  request, and neither is ever printed.

Optional AI providers (absent = the feature is skipped, everything else keeps working):
  VOYAGE_API_KEY, VOYAGE_MODEL (default voyage-4, 1024 dims)   chunk + query embeddings
  ANTHROPIC_API_KEY, ANTHROPIC_MODEL (default claude-haiku-4-5) generative /ask answers;
  without it /ask returns an extractive answer built from the retrieved chunks.

GitHub file contents for the worker (real pushes list paths, not file bodies):
  GITHUB_FETCH_CONTENTS=1   fetch added/modified .md files at their commit from the contents API
  GITHUB_TOKEN              sent as the bearer token (needed for private repositories)
  GITHUB_API_URL            default https://api.github.com
  Off by default (an ambient GITHUB_TOKEN alone does not turn it on): the replay fixtures
  carry the text inline.

MongoDB (MONGO_TARGET = atlas | local, default atlas):
  atlas -> MONGODB_URI from the environment / api/.env, else read from ../atlas-credentials.env
  local -> mongodb://127.0.0.1:57018/?directConnection=true (docker container elp-mongo-local)
  MONGO_DB defaults to 'elp'. The URI is never logged or returned.
"""

from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from dotenv import dotenv_values

API_DIR = Path(__file__).resolve().parent.parent
ROOT = API_DIR.parent
LOCAL_MONGO_URI = "mongodb://127.0.0.1:57018/?directConnection=true"


class ConfigError(RuntimeError):
    pass


def _env() -> dict[str, str]:
    """api/.env values overlaid by the real environment."""
    values = {k: v for k, v in dotenv_values(API_DIR / ".env").items() if v is not None}
    values.update(os.environ)
    return values


def _local_supabase() -> dict[str, str]:
    proc = subprocess.run(
        ["npx", "-y", "supabase@latest", "status", "-o", "env"],
        cwd=ROOT, capture_output=True, text=True, timeout=120,
    )
    if proc.returncode != 0:
        raise ConfigError("local Supabase stack is not running (`npx supabase start`)")
    found: dict[str, str] = {}
    for line in proc.stdout.splitlines():
        key, sep, value = line.partition("=")
        if sep and key in ("API_URL", "ANON_KEY", "SERVICE_ROLE_KEY", "DB_URL"):
            found[key] = value.strip().strip('"')
    if "API_URL" not in found or "ANON_KEY" not in found:
        raise ConfigError("could not read API_URL / ANON_KEY from `supabase status`")
    return found


def _remote_supabase() -> tuple[str, str]:
    values = dotenv_values(ROOT / "web" / ".env.remote")
    url, key = values.get("VITE_SUPABASE_URL"), values.get("VITE_SUPABASE_ANON_KEY")
    if not url or not key:
        raise ConfigError("web/.env.remote lacks VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY")
    return url, key


def _atlas_uri(env: dict[str, str]) -> str:
    if env.get("MONGODB_URI"):
        return env["MONGODB_URI"]
    uri = dotenv_values(ROOT / "atlas-credentials.env").get("MONGODB_URI")
    if not uri:
        raise ConfigError("MONGODB_URI not set and not found in atlas-credentials.env")
    return uri


@dataclass(frozen=True)
class Settings:
    supabase_target: str
    supabase_url: str
    supabase_anon_key: str = field(repr=False)
    mongo_target: str
    mongodb_uri: str = field(repr=False)          # never printed
    mongo_db: str
    cors_origins: tuple[str, ...]
    # ingestion worker only (never used for a user request; never printed)
    service_role_key: str | None = field(default=None, repr=False)
    ingest_db_url: str | None = field(default=None, repr=False)
    # optional AI providers
    voyage_api_key: str | None = field(default=None, repr=False)
    voyage_model: str = "voyage-4"
    anthropic_api_key: str | None = field(default=None, repr=False)
    anthropic_model: str = "claude-haiku-4-5"
    # optional GitHub contents fetch (worker step 0)
    github_token: str | None = field(default=None, repr=False)
    github_fetch_contents: bool = False
    github_api_url: str = "https://api.github.com"

    @property
    def issuer(self) -> str:
        return f"{self.supabase_url}/auth/v1"


@lru_cache
def get_settings() -> Settings:
    env = _env()
    sb_target = env.get("SUPABASE_TARGET", "local").lower()
    service_key, db_url = env.get("SUPABASE_SERVICE_ROLE_KEY"), env.get("INGEST_DB_URL")
    if env.get("SUPABASE_URL") and env.get("SUPABASE_ANON_KEY"):
        url, key = env["SUPABASE_URL"], env["SUPABASE_ANON_KEY"]
    elif sb_target == "remote":
        url, key = _remote_supabase()
    elif sb_target == "local":
        local = _local_supabase()
        url, key = local["API_URL"], local["ANON_KEY"]
        service_key = service_key or local.get("SERVICE_ROLE_KEY")
        db_url = db_url or local.get("DB_URL")
    else:
        raise ConfigError("SUPABASE_TARGET must be 'local' or 'remote'")

    mongo_target = env.get("MONGO_TARGET", "atlas").lower()
    if mongo_target == "local":
        uri = env.get("MONGODB_URI_LOCAL", LOCAL_MONGO_URI)
    elif mongo_target == "atlas":
        uri = _atlas_uri(env)
    else:
        raise ConfigError("MONGO_TARGET must be 'atlas' or 'local'")

    origins = tuple(o.strip() for o in env.get(
        "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if o.strip())
    return Settings(
        supabase_target=sb_target, supabase_url=url.rstrip("/"), supabase_anon_key=key,
        mongo_target=mongo_target, mongodb_uri=uri, mongo_db=env.get("MONGO_DB", "elp"),
        cors_origins=origins,
        service_role_key=service_key or None, ingest_db_url=db_url or None,
        voyage_api_key=env.get("VOYAGE_API_KEY") or None,
        voyage_model=env.get("VOYAGE_MODEL") or "voyage-4",
        anthropic_api_key=env.get("ANTHROPIC_API_KEY") or None,
        anthropic_model=env.get("ANTHROPIC_MODEL") or "claude-haiku-4-5",
        github_token=env.get("GITHUB_TOKEN") or None,
        github_fetch_contents=env.get("GITHUB_FETCH_CONTENTS", "").lower() in ("1", "true", "yes"),
        github_api_url=(env.get("GITHUB_API_URL") or "https://api.github.com").rstrip("/"),
    )
