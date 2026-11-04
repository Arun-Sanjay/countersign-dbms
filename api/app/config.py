"""Settings, resolved once at startup.

Order of precedence for every value: real environment > api/.env > the defaults below.

Supabase (SUPABASE_TARGET = local | remote, default local):
  SUPABASE_URL / SUPABASE_ANON_KEY, if set, win. Otherwise
    local  -> `npx -y supabase@latest status -o env` (API_URL, ANON_KEY of the local stack)
    remote -> web/.env.remote (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY; publishable values)
  Only the anon (publishable) key is ever used. The API never holds a service key: every
  Postgres read runs through PostgREST with the CALLER's JWT, so RLS decides.

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


def _local_supabase() -> tuple[str, str]:
    proc = subprocess.run(
        ["npx", "-y", "supabase@latest", "status", "-o", "env"],
        cwd=ROOT, capture_output=True, text=True, timeout=120,
    )
    if proc.returncode != 0:
        raise ConfigError("local Supabase stack is not running (`npx supabase start`)")
    found: dict[str, str] = {}
    for line in proc.stdout.splitlines():
        key, sep, value = line.partition("=")
        if sep and key in ("API_URL", "ANON_KEY"):
            found[key] = value.strip().strip('"')
    if len(found) != 2:
        raise ConfigError("could not read API_URL / ANON_KEY from `supabase status`")
    return found["API_URL"], found["ANON_KEY"]


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

    @property
    def issuer(self) -> str:
        return f"{self.supabase_url}/auth/v1"


@lru_cache
def get_settings() -> Settings:
    env = _env()
    sb_target = env.get("SUPABASE_TARGET", "local").lower()
    if env.get("SUPABASE_URL") and env.get("SUPABASE_ANON_KEY"):
        url, key = env["SUPABASE_URL"], env["SUPABASE_ANON_KEY"]
    elif sb_target == "remote":
        url, key = _remote_supabase()
    elif sb_target == "local":
        url, key = _local_supabase()
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
    )
