"""Replay the GitHub webhook fixtures against the github-webhook Edge Function (stdlib only).

    uv run --python 3.12 python scripts/replay_webhooks.py                # local function
    uv run --python 3.12 python scripts/replay_webhooks.py --url https://<ref>.supabase.co/functions/v1/github-webhook
    uv run --python 3.12 python scripts/replay_webhooks.py --only t01 --fresh

For every row of ingest/fixtures/manifest.json, in order, it POSTs the fixture file's exact
bytes with the headers GitHub sends (X-GitHub-Event, X-GitHub-Delivery, X-Hub-Signature-256,
User-Agent GitHub-Hookshot/...), then checks the HTTP status and, where the manifest says so,
the JSON fields status / duplicate. Exit status 1 if any delivery did not match.

Signing (the "sign" field):
  valid         HMAC-SHA256 of the body with the webhook secret
  wrong_secret  HMAC with a different secret                       -> expect 401
  tampered      HMAC of the original body, but one byte is appended -> expect 401

Secret: $GITHUB_WEBHOOK_SECRET, else GITHUB_WEBHOOK_SECRET in supabase/functions/.env
(or --secret-file). It is only used to sign and is never printed.
--fresh appends a per-run suffix to every delivery id (a redelivery pair keeps sharing one).
The inbox also deduplicates by the PUSH (repository, ref, after), so on a database that already
has the original deliveries a fresh replay of a push is answered duplicate=true (the captured-
body replay defence); --fresh accepts that answer for push rows.
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_URL = "http://127.0.0.1:54321/functions/v1/github-webhook"
DEFAULT_MANIFEST = ROOT / "ingest" / "fixtures" / "manifest.json"
DEFAULT_SECRET_FILE = ROOT / "supabase" / "functions" / ".env"


def read_secret(path: Path) -> str:
    env = os.environ.get("GITHUB_WEBHOOK_SECRET")
    if env:
        return env
    if path.is_file():
        for line in path.read_text().splitlines():
            line = line.strip()
            if line.startswith("GITHUB_WEBHOOK_SECRET="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit(f"error: GITHUB_WEBHOOK_SECRET not set and not found in {path}")


def sign(secret: str, body: bytes) -> str:
    return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def post(url: str, body: bytes, headers: dict[str, str], timeout: float) -> tuple[int, dict | str]:
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            status, raw = resp.status, resp.read()
    except urllib.error.HTTPError as e:
        status, raw = e.code, e.read()
    try:
        return status, json.loads(raw)
    except ValueError:
        return status, raw.decode(errors="replace")[:200]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", default=os.environ.get("WEBHOOK_URL", DEFAULT_URL))
    ap.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    ap.add_argument("--secret-file", type=Path, default=DEFAULT_SECRET_FILE)
    ap.add_argument("--only", help="replay only rows whose name contains this text")
    ap.add_argument("--fresh", action="store_true", help="suffix delivery ids with a per-run tag")
    ap.add_argument("--timeout", type=float, default=30.0)
    ap.add_argument("--dry-run", action="store_true", help="print what would be sent, send nothing")
    args = ap.parse_args()

    manifest = json.loads(args.manifest.read_text())
    secret = read_secret(args.secret_file)
    suffix = f"-r{int(time.time())}" if args.fresh else ""
    fixtures = args.manifest.parent

    rows = [r for r in manifest["deliveries"] if not args.only or args.only in r["name"]]
    print(f"replaying {len(rows)} deliveries to {args.url}\n")
    print(f"{'delivery':<28} {'http':>4}  {'result':<6} detail")
    print(f"{'-' * 28} {'-' * 4}  {'-' * 6} {'-' * 40}")
    failures = 0
    for r in rows:
        body = (fixtures / r["file"]).read_bytes()
        mode = r.get("sign", "valid")
        if mode == "valid":
            signature = sign(secret, body)
        elif mode == "wrong_secret":
            signature = sign(secret + "-not-the-secret", body)
        elif mode == "tampered":
            signature = sign(secret, body)
            body = body + b" "
        else:
            sys.exit(f"error: unknown sign mode {mode!r} in {r['name']}")
        delivery = r["delivery"] + suffix
        headers = {
            "Content-Type": "application/json",
            "User-Agent": "GitHub-Hookshot/replay",
            "X-GitHub-Event": r["event"],
            "X-GitHub-Delivery": delivery,
            "X-GitHub-Hook-ID": "512000001",
            "X-Hub-Signature-256": signature,
        }
        if args.dry_run:
            print(f"{r['name']:<28} {'-':>4}  {'dry':<6} {r['event']} {delivery} {len(body)} bytes, sign={mode}")
            continue

        status, data = post(args.url, body, headers, args.timeout)
        expect = r.get("expect", {})
        if (args.fresh and r["event"] == "push" and isinstance(data, dict) and data.get("duplicate") is True
                and expect.get("duplicate") is False):
            expect = {"http": expect.get("http", status)}      # same push already in the inbox
        problems = []
        if status != expect.get("http", status):
            problems.append(f"http {status} != {expect['http']}")
        if isinstance(data, dict):
            for key in ("status", "duplicate"):
                if key in expect and data.get(key) != expect[key]:
                    problems.append(f"{key}={data.get(key)!r} != {expect[key]!r}")
        elif any(k in expect for k in ("status", "duplicate")):
            problems.append("response is not JSON")
        ok = not problems
        failures += 0 if ok else 1
        if isinstance(data, dict):
            detail = ", ".join(f"{k}={data[k]}" for k in ("status", "duplicate", "error", "note")
                               if data.get(k) not in (None, ""))
        else:
            detail = str(data)
        if problems:
            detail += "   <-- " + "; ".join(problems)
        print(f"{r['name']:<28} {status:>4}  {'ok' if ok else 'FAIL':<6} {detail}")

    if not args.dry_run:
        print(f"\n{len(rows) - failures} of {len(rows)} deliveries behaved as expected")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
