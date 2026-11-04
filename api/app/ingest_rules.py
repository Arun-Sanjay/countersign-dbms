"""Rules shared by the worker and the consistency check, mirrored from migration 0005.

`artifact_type(path)` is a line-for-line copy of `private.ingest_artifact_type` (the SQL rule
project_push uses to decide which repository paths become artifacts). The consistency check
needs it to tell a commit that SHOULD have produced Postgres rows (it touched a tracked path)
from one that legitimately produced none (it only touched, say, package.json).
tests/test_worker.py runs both on the same paths, so the copy cannot drift silently.
"""

from __future__ import annotations

import re

_EXT = re.compile(r"\.([^./]+)$")
_VAULT = re.compile(r"(^|/)(shared|vault)/")
MAX_PATH = 500                      # project_push skips longer paths

DIAGRAM = {"dot", "svg", "drawio", "mmd", "puml"}
REPORT_DOCS = {"md", "pdf", "docx", "txt", "tex"}
SLIDES = {"pptx", "odp", "key"}
CODE = {"sql", "py", "ts", "tsx", "js", "jsx", "mjs", "cjs", "sh", "css", "html"}


def artifact_type(path: str) -> str | None:
    """Artifact type of a repository path, or None when the path is not tracked."""
    if not path or len(path) > MAX_PATH:
        return None
    p = path.lower()
    m = _EXT.search(path)
    ext = m.group(1).lower() if m else None
    if ext in DIAGRAM:
        return "diagram"
    if ext == "md" and _VAULT.search(p):
        return "note"
    if p.startswith("docs/") and ext in REPORT_DOCS:
        return "report"
    if ext in SLIDES:
        return "slides"
    if ext in CODE:
        return "code"
    if ext == "md":
        return "report"
    return None


def path_allowed(path: str, prefixes: list[str] | None) -> bool:
    """Mirror of private.ingest_path_allowed: team_repo.track_paths (NULL = everything)."""
    return prefixes is None or any(path.startswith(p) for p in prefixes)


def is_vault_note(path: str) -> bool:
    return artifact_type(path) == "note"


def note_title(path: str) -> str:
    """An Obsidian note is titled like its file (private.ingest_title for notes)."""
    name = path.rsplit("/", 1)[-1]
    title = re.sub(r"\.md$", "", name, flags=re.IGNORECASE)
    return title if len(title) <= 60 else "…" + title[-59:]


_AI = re.compile(r"(^|\n)[ \t]*AI-Assisted:[ \t]*(yes|true)[ \t]*(\r?\n|$)", re.IGNORECASE)


def ai_declared(message: str | None) -> bool:
    """Mirror of private.ingest_ai_declared: only an `AI-Assisted: yes` trailer counts."""
    return bool(_AI.search(message or ""))


_WIKILINK = re.compile(r"\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]")
_FRONT = re.compile(r"\A---\s*\n(.*?)\n---\s*\n", re.DOTALL)
_HASHTAG = re.compile(r"(?:^|\s)#([A-Za-z][\w/-]{0,39})")


def note_links(text: str) -> list[str]:
    """Obsidian [[wiki-links]] (target titles), in first-seen order."""
    seen: dict[str, None] = {}
    for m in _WIKILINK.finditer(text or ""):
        seen.setdefault(m.group(1).strip(), None)
    return [k for k in seen if k][:50]


def note_tags(text: str) -> list[str]:
    """Tags from YAML front matter (`tags: [a, b]` or a `- a` list) and inline #tags."""
    tags: dict[str, None] = {}
    m = _FRONT.match(text or "")
    body = text or ""
    if m:
        body = text[m.end():]
        lines = m.group(1).splitlines()
        for i, line in enumerate(lines):
            if line.strip().lower().startswith("tags:"):
                rest = line.split(":", 1)[1].strip()
                if rest.startswith("["):
                    for t in rest.strip("[]").split(","):
                        tags.setdefault(t.strip().strip("'\"").lstrip("#"), None)
                elif rest:
                    tags.setdefault(rest.strip("'\"").lstrip("#"), None)
                else:
                    for nxt in lines[i + 1:]:
                        if not nxt.strip().startswith("-"):
                            break
                        tags.setdefault(nxt.strip()[1:].strip().strip("'\"").lstrip("#"), None)
    for line in body.splitlines():
        if line.lstrip().startswith("#") and re.match(r"\s*#{1,6}\s", line):
            continue                                   # a markdown heading, not a tag
        for t in _HASHTAG.finditer(line):
            tags.setdefault(t.group(1), None)
    return [t for t in tags if t][:30]
