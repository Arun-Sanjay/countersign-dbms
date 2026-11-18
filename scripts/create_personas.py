"""Create or update the demo login personas (idempotent).

For each persona this script:
  1. creates the Supabase Auth user, or updates its password if it already exists
     (Auth Admin API, email_confirm=true, so no confirmation mail is needed);
  2. upserts the matching public.app_user row (role + usn | faculty_id) through the
     REST API with the service key. Service-role requests bypass RLS; nothing else can write app_user.

Usage:
    uv run --with httpx --with python-dotenv python scripts/create_personas.py --target local
    uv run --with httpx --with python-dotenv python scripts/create_personas.py --target remote

  local : API URL and service key come from `npx supabase status -o env`.
  remote: https://<ref>.supabase.co; the service_role key is fetched with
          `supabase projects api-keys` using SUPABASE_ACCESS_TOKEN from supabase/.env.
The service key is held in memory only and is never printed or written anywhere.
The persona password (PERSONA_PASSWORD, default below) is a demo password, not a secret.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

import httpx
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parent.parent
SUPABASE_CLI = ["npx", "-y", "supabase@latest"]
DEFAULT_PASSWORD = "Countersign@2026"

# email -> (role, usn, faculty_id)
PERSONAS: list[tuple[str, str, str | None, str | None]] = [
    ("arun@example.edu",    "student", "1RV24CY047", None),
    ("nikhil@example.edu",  "student", "1RV24CY077", None),
    ("meera@example.edu",   "student", "1RV24CY033", None),
    ("ramesh@example.edu",  "faculty", None, "F01"),
    ("lakshmi@example.edu", "faculty", None, "F02"),
    ("admin@example.edu",   "admin",   None, None),
]


def die(msg: str) -> None:
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(1)


def run_cli(args: list[str], env: dict[str, str] | None = None) -> str:
    """Run the Supabase CLI and return stdout. stderr is shown only on failure (it holds no keys)."""
    proc = subprocess.run(SUPABASE_CLI + args, cwd=ROOT, env=env, capture_output=True, text=True)
    if proc.returncode != 0:
        die(f"`supabase {' '.join(args[:2])}` failed:\n{proc.stderr.strip()}")
    return proc.stdout


def local_target() -> tuple[str, str]:
    """API URL + service-role key of the local stack (`supabase status -o env`)."""
    values: dict[str, str] = {}
    for line in run_cli(["status", "-o", "env"]).splitlines():
        if "=" in line and line.split("=", 1)[0].isupper():
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip('"')
    url, key = values.get("API_URL"), values.get("SERVICE_ROLE_KEY")
    if not url or not key:
        die("could not read API_URL / SERVICE_ROLE_KEY from `supabase status` (is the stack running?)")
    return url, key


def remote_target() -> tuple[str, str]:
    """API URL + service-role key of the linked cloud project (key fetched, never printed)."""
    env_file = ROOT / "supabase" / ".env"
    secrets = dotenv_values(env_file)
    token, ref = secrets.get("SUPABASE_ACCESS_TOKEN"), secrets.get("SUPABASE_PROJECT_REF")
    if not token or not ref:
        die(f"SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF must be set in {env_file}")
    out = run_cli(["projects", "api-keys", "--project-ref", ref, "-o", "json"],
                  env={**os.environ, "SUPABASE_ACCESS_TOKEN": token})
    try:
        keys = json.loads(out[out.index("["):])          # skip any banner line before the JSON
    except ValueError:
        die("could not parse `supabase projects api-keys` output")
    service = next((k for k in keys if k.get("name") == "service_role"), None) \
        or next((k for k in keys if k.get("type") == "secret"), None)
    if not service or not service.get("api_key"):
        die("no service_role / secret key returned for the project")
    return f"https://{ref}.supabase.co", service["api_key"]


def headers_for(key: str) -> dict[str, str]:
    # Legacy keys are JWTs and also go in Authorization; new sb_secret_ keys go in apikey only.
    h = {"apikey": key, "Content-Type": "application/json"}
    if not key.startswith("sb_"):
        h["Authorization"] = f"Bearer {key}"
    return h


def check(resp: httpx.Response, what: str) -> httpx.Response:
    if resp.status_code >= 400:
        die(f"{what}: HTTP {resp.status_code} {resp.text[:300]}")
    return resp


def existing_users(client: httpx.Client) -> dict[str, str]:
    """email -> auth user id, across all pages of the admin list."""
    users: dict[str, str] = {}
    page = 1
    while True:
        resp = check(client.get("/auth/v1/admin/users", params={"page": page, "per_page": 200}),
                     "list auth users")
        batch = resp.json().get("users", [])
        users.update({u["email"].lower(): u["id"] for u in batch if u.get("email")})
        if len(batch) < 200:
            return users
        page += 1


def upsert_auth_user(client: httpx.Client, known: dict[str, str], email: str, password: str,
                     role: str) -> tuple[str, str]:
    body = {"email": email, "password": password, "email_confirm": True,
            "user_metadata": {"persona": email.split("@")[0], "app_role": role}}
    if email in known:
        uid = known[email]
        check(client.put(f"/auth/v1/admin/users/{uid}", json=body), f"update auth user {email}")
        return uid, "updated"
    resp = check(client.post("/auth/v1/admin/users", json=body), f"create auth user {email}")
    return resp.json()["id"], "created"


def upsert_app_user(client: httpx.Client, uid: str, role: str, usn: str | None,
                    faculty_id: str | None) -> None:
    # usn / faculty_id are UNIQUE: drop a stale row that links them to an older auth user.
    for col, val in (("usn", usn), ("faculty_id", faculty_id)):
        if val:
            check(client.delete("/rest/v1/app_user", params={col: f"eq.{val}", "user_id": f"neq.{uid}"}),
                  f"clear stale app_user for {col}={val}")
    check(client.post("/rest/v1/app_user", params={"on_conflict": "user_id"},
                      headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
                      json={"user_id": uid, "role": role, "usn": usn, "faculty_id": faculty_id}),
          f"upsert app_user for {uid}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--target", choices=["local", "remote"], required=True)
    args = parser.parse_args()

    password = os.environ.get("PERSONA_PASSWORD", DEFAULT_PASSWORD)
    url, key = local_target() if args.target == "local" else remote_target()
    print(f"target: {args.target} ({url})")

    with httpx.Client(base_url=url, headers=headers_for(key), timeout=30) as client:
        known = existing_users(client)
        for email, role, usn, faculty_id in PERSONAS:
            uid, action = upsert_auth_user(client, known, email, password, role)
            upsert_app_user(client, uid, role, usn, faculty_id)
            print(f"  {action:8} {email:22} {role:8} {usn or faculty_id or '-'}")

        rows = check(client.get("/rest/v1/app_user", params={"select": "role"}), "count app_user").json()
        counts = {r: sum(1 for x in rows if x["role"] == r) for r in ("student", "faculty", "admin")}
        print(f"app_user rows: {len(rows)} {counts}")

    print(f"persona password (demo only): {password}")


if __name__ == "__main__":
    main()
