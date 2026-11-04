"""Generate the evidence tables of Component 8 (C8_Forms_Security_Validation.md) from the
LOCAL Supabase stack. Read-only: every test file runs inside its own BEGIN ... ROLLBACK, the
constraint-gallery harness is a rolled-back copy of supabase/tests/01_constraints.sql, and the
worked-example REST calls are all requests the database refuses (nothing is written).

    uv run --python 3.12 --no-project --with httpx python docs/lab/diagrams/c8/gen_c8.py

Needs: the local stack (container supabase_db_countersign-dbms), the demo personas
(scripts/create_personas.py --target local), web/.env.local pointing at 127.0.0.1, and node
(to map each error through web/src/lib/errors.ts, exactly as the web app does).
Writes docs/lab/diagrams/c8/generated/*.md and docs/lab/diagrams/c8/c8_rls_matrix.dot.
No key or token is ever printed.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
GEN = HERE / "generated"
GEN.mkdir(exist_ok=True)
CONTAINER = "supabase_db_countersign-dbms"
TESTS = ROOT / "supabase" / "tests"


# --------------------------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------------------------
def psql(sql: str) -> str:
    r = subprocess.run(
        ["docker", "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-t", "-A"],
        input=sql, capture_output=True, text=True, check=True)
    return r.stdout


def psql_json(sql: str):
    out = psql(f"SELECT coalesce(json_agg(x), '[]'::json) FROM ({sql}) x;").strip()
    return json.loads(out)


def tap(test_file: str) -> list[tuple[bool, int, str]]:
    out = psql((TESTS / test_file).read_text())
    rows = []
    for line in out.splitlines():
        m = re.match(r"^(ok|not ok) (\d+) - (.*)$", line)
        if m:
            rows.append((m.group(1) == "ok", int(m.group(2)), m.group(3)))
    plan = re.search(r"^1\.\.(\d+)$", out, re.M)
    assert plan and int(plan.group(1)) == len(rows), f"{test_file}: plan/test count mismatch"
    return rows


def esc(s: str | None) -> str:
    """Escape for a pipe-table cell (plain text)."""
    if s is None:
        return ""
    return str(s).replace("|", "\\|").replace("\n", " ")


def code(s: str | None) -> str:
    if s is None or s == "":
        return ""
    s = re.sub(r"\s+", " ", str(s)).strip().replace("|", "\\|")
    return f"`{s}`"


def write(name: str, text: str) -> None:
    (GEN / name).write_text(text.rstrip("\n") + "\n")
    print("wrote", GEN.relative_to(ROOT) / name)


def simplify(expr: str | None) -> str | None:
    """pg_policies prints the InitPlan wrappers and casts; drop them for reading."""
    if expr is None:
        return None
    e = re.sub(r"\( SELECT ((?:app|auth)\.\w+\(\)) AS \w+\)", r"\1", expr)
    e = re.sub(r"::(text|character varying|bpchar)(\[\])?", "", e)
    e = re.sub(r"\s+", " ", e).strip()
    for _ in range(3):   # (usn) -> usn, (app.current_usn()) -> app.current_usn()
        e = re.sub(r"(?<![\w.])\(([\w.]+(?:\(\))?)\)", r"\1", e)
    # outermost redundant parentheses
    while e.startswith("(") and e.endswith(")"):
        depth, ok = 0, True
        for i, ch in enumerate(e):
            depth += ch == "("
            depth -= ch == ")"
            if depth == 0 and i < len(e) - 1:
                ok = False
                break
        if not ok:
            break
        e = e[1:-1].strip()
    return e


# --------------------------------------------------------------------------------------------
# 1. pg_policies -> grouped policy table
# --------------------------------------------------------------------------------------------
def gen_policies() -> None:
    pol = psql_json("""SELECT schemaname, tablename, policyname, cmd, roles::text AS roles, permissive,
                              qual, with_check FROM pg_policies ORDER BY schemaname, tablename,
                              array_position(ARRAY['SELECT','INSERT','UPDATE','DELETE','ALL'], cmd)""")
    by_table: dict[str, list[dict]] = {}
    for p in pol:
        by_table.setdefault(f"{p['schemaname']}.{p['tablename']}", []).append(p)
    # group tables whose policies are identical up to the table name
    groups: dict[tuple, list[str]] = {}
    for t, ps in by_table.items():
        key = tuple((p["cmd"], simplify(p["qual"]), simplify(p["with_check"])) for p in ps)
        groups.setdefault(key, []).append(t)
    roles = {p["roles"] for p in pol}
    perm = {p["permissive"] for p in pol}
    lines = [
        f"Generated from `pg_policies` on the local database: **{len(pol)} policies on {len(by_table)} tables**, "
        f"roles {', '.join(sorted(roles))}, kind {', '.join(sorted(perm))}. "
        "Tables whose policies are identical are listed together. For reading, the InitPlan wrapper "
        "`( SELECT app.f() AS f)` is printed as `app.f()`, and casts such as `::text` are dropped.",
        "",
        "| Table(s) | Cmd | USING (which existing rows) | WITH CHECK (which new rows) |",
        "|:----------|:-----|:------------------------|:------------------------|",
    ]
    for key, tables in sorted(groups.items(), key=lambda kv: (-len(kv[1]), kv[1][0])):
        names = ", ".join(f"`{t.removeprefix('public.')}`" for t in tables)
        first = True
        for cmd, q, c in key:
            lines.append(f"| {names if first else ''} | {cmd} | {code(q) or '-'} | {code(c) or '-'} |")
            first = False
    write("rls_policies.md", "\n".join(lines))


# --------------------------------------------------------------------------------------------
# 2. SECURITY DEFINER inventory
# --------------------------------------------------------------------------------------------
JUSTIFY = {
    "helper": "Identity/membership helper called inside RLS policies. Reads `app_user` / `team_member` as the owner, "
              "so a policy on `team_member` can call it without recursing into its own RLS. Returns only a "
              "boolean or the caller's own id; STABLE.",
    "topic": "Realtime join check for `team:<id>` / `project:<id>` topics: the same rule as artifact/contribution RLS.",
    "trigger": "Integrity trigger. Must see rows the writer cannot (e.g. the full member count, the claimant's "
               "team) so the rule holds for every caller. Not executable by any API role; fires automatically.",
    "internal": "Internal helper of a definer trigger or pipeline RPC. No EXECUTE grant to any API role.",
    "note": "Private-note RPC. Schema `private` has no grants, so the function is the only door; every statement "
            "filters `owner_usn = app.current_usn()`, and a foreign note is reported as \"not found\".",
    "pipeline": "Ingestion pipeline RPC. EXECUTE for `service_role` only (Edge Function / worker); writes tables "
                "and the pgmq queue that API users cannot. All 0002 integrity triggers still fire.",
}


def category(schema: str, name: str, trig: bool) -> str:
    if schema == "app":
        return "topic" if name == "can_watch_topic" else "helper"
    if schema == "public":
        return "note" if "private_note" in name else "pipeline"
    return "trigger" if trig else "internal"


def gen_secdef() -> None:
    rows = psql_json("""
        SELECT n.nspname AS schema, p.proname AS name, pg_get_userbyid(p.proowner) AS owner,
               array_to_string(p.proconfig, ',') AS cfg, p.prorettype = 'trigger'::regtype AS trig,
               has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_x,
               has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_x,
               has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc_x,
               (SELECT string_agg(DISTINCT c.relname, ', ' ORDER BY c.relname)
                  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
                 WHERE t.tgfoid = p.oid AND NOT t.tgisinternal) AS fires_on
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.prosecdef AND n.nspname IN ('public', 'app', 'private')
        ORDER BY n.nspname, p.proname""")
    total = len(rows)
    empty_path = sum(r["cfg"] == 'search_path=""' for r in rows)
    anon = sum(r["anon_x"] for r in rows)
    lines = [
        f"Generated from `pg_proc` (`prosecdef = true`) on the local database: **{total} SECURITY DEFINER functions**, "
        f"all owned by `postgres`; **{empty_path} of {total}** pin `search_path = ''`; **{anon}** are executable by `anon`.",
        "",
        "| Category | Functions | EXECUTE granted to | Why it must be SECURITY DEFINER |",
        "|:--------|:--------------------------|:------|:------------------------|",
    ]
    order = ["helper", "topic", "note", "pipeline", "trigger", "internal"]
    cats: dict[str, list[dict]] = {}
    for r in rows:
        cats.setdefault(category(r["schema"], r["name"], r["trig"]), []).append(r)
    label = {"helper": "Policy helpers", "topic": "Realtime topic check", "note": "Private-note RPCs",
             "pipeline": "Pipeline RPCs", "trigger": "Integrity triggers", "internal": "Internal helpers"}
    for c in order:
        rs = cats.get(c, [])
        if not rs:
            continue
        if c == "trigger":
            fn = "; ".join(f"`{r['name']}` ({r['fires_on'] or '-'})" for r in rs)
        else:
            fn = ", ".join(f"`{r['schema']}.{r['name']}`" for r in rs)
        who = set()
        for r in rs:
            g = [x for x, ok in (("authenticated", r["auth_x"]), ("service_role", r["svc_x"]), ("anon", r["anon_x"])) if ok]
            who.add(", ".join(g) if g else "none (owner only)")
        lines.append(f"| {label[c]} ({len(rs)}) | {fn} | {'; '.join(sorted(who))} | {JUSTIFY[c]} |")
    write("secdef.md", "\n".join(lines))


# --------------------------------------------------------------------------------------------
# 3. column grants, views, anon/authenticated privilege facts
# --------------------------------------------------------------------------------------------
def gen_privileges() -> None:
    cols = psql_json("""
        WITH c AS (SELECT cl.oid, cl.relname, a.attname, a.attnum
                     FROM pg_class cl JOIN pg_attribute a ON a.attrelid = cl.oid AND a.attnum > 0 AND NOT a.attisdropped
                    WHERE cl.relnamespace = 'public'::regnamespace AND cl.relkind = 'r')
        SELECT relname,
               string_agg(attname, ', ' ORDER BY attnum) FILTER (WHERE has_column_privilege('authenticated', oid, attname, 'INSERT')) AS ins,
               string_agg(attname, ', ' ORDER BY attnum) FILTER (WHERE NOT has_column_privilege('authenticated', oid, attname, 'INSERT')) AS server_owned,
               string_agg(attname, ', ' ORDER BY attnum) FILTER (WHERE has_column_privilege('authenticated', oid, attname, 'UPDATE')) AS upd
          FROM c GROUP BY relname, oid
        HAVING NOT has_table_privilege('authenticated', oid, 'INSERT')
        ORDER BY relname""")
    lines = [
        "Generated from `has_column_privilege('authenticated', ...)`: the tables on which `authenticated` holds "
        "**no table-level INSERT**, only column-level grants.",
        "",
        "| Table | INSERT allowed on | Never client-supplied (server-owned) | UPDATE allowed on |",
        "|:------|:------------------|:-----------------|:------------|",
    ]
    for r in cols:
        lines.append(f"| `{r['relname']}` | {esc(r['ins']) or '(none)'} | {esc(r['server_owned']) or '(none)'} | {esc(r['upd']) or '(none: append-only)'} |")
    write("column_grants.md", "\n".join(lines))

    facts = psql_json("""
        SELECT 'Public tables with RLS enabled' AS fact,
               (SELECT count(*) FILTER (WHERE relrowsecurity) || ' of ' || count(*) FROM pg_class
                 WHERE relnamespace = 'public'::regnamespace AND relkind = 'r') AS value
        UNION ALL SELECT 'Public tables/views on which anon has SELECT, INSERT, UPDATE or DELETE',
               (SELECT count(*)::text FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','v','m')
                  AND (has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('anon', c.oid, 'INSERT')
                    OR has_table_privilege('anon', c.oid, 'UPDATE') OR has_table_privilege('anon', c.oid, 'DELETE')))
        UNION ALL SELECT 'Public functions anon may EXECUTE',
               (SELECT count(*)::text FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
                  AND has_function_privilege('anon', p.oid, 'EXECUTE'))
        UNION ALL SELECT 'Public tables authenticated may TRUNCATE (TRUNCATE bypasses RLS)',
               (SELECT count(*)::text FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
                  AND has_table_privilege('authenticated', c.oid, 'TRUNCATE'))
        UNION ALL SELECT 'USAGE on schema app (anon / authenticated)',
               has_schema_privilege('anon', 'app', 'USAGE') || ' / ' || has_schema_privilege('authenticated', 'app', 'USAGE')
        UNION ALL SELECT 'USAGE on schema private (anon / authenticated)',
               has_schema_privilege('anon', 'private', 'USAGE') || ' / ' || has_schema_privilege('authenticated', 'private', 'USAGE')
        UNION ALL SELECT 'USAGE on schema pgmq (anon / authenticated)',
               has_schema_privilege('anon', 'pgmq', 'USAGE') || ' / ' || has_schema_privilege('authenticated', 'pgmq', 'USAGE')
        UNION ALL SELECT 'Tables in schema private (RLS enabled; policies)',
               (SELECT string_agg(relname || ' (' || relrowsecurity || '; ' ||
                       (SELECT count(*) FROM pg_policy WHERE polrelid = c.oid) || ')', ', ')
                  FROM pg_class c WHERE relnamespace = 'private'::regnamespace AND relkind = 'r')
        UNION ALL SELECT 'Public views, and how many are security_invoker',
               (SELECT count(*) || ', ' || count(*) FILTER (WHERE 'security_invoker=true' = ANY (coalesce(reloptions, '{}')))
                  FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'v')
        UNION ALL SELECT 'Policies not scoped TO authenticated',
               (SELECT count(*)::text FROM pg_policies WHERE roles <> '{authenticated}')
        UNION ALL SELECT 'SECURITY INVOKER RPCs callable by authenticated',
               (SELECT count(*) || ': ' || string_agg(proname, ', ' ORDER BY proname) FROM pg_proc p
                 WHERE p.pronamespace = 'public'::regnamespace AND NOT p.prosecdef
                   AND p.prorettype <> 'trigger'::regtype AND has_function_privilege('authenticated', p.oid, 'EXECUTE'))
    """)
    views = psql_json("""SELECT relname, array_to_string(reloptions, ',') AS opts FROM pg_class
                          WHERE relnamespace = 'public'::regnamespace AND relkind = 'v' ORDER BY relname""")
    lines = ["| Catalog check (local database) | Result |", "|:--------------------------|:------------|"]
    for f in facts:
        lines.append(f"| {esc(f['fact'])} | {esc(f['value'])} |")
    lines += ["", "| View | `reloptions` |", "|:------|:------|"]
    for v in views:
        lines.append(f"| `{v['relname']}` | `{v['opts']}` |")
    write("privileges.md", "\n".join(lines))


# --------------------------------------------------------------------------------------------
# 4. RLS matrix (02) -> green/red grid (Graphviz) + the other 02 checks
# --------------------------------------------------------------------------------------------
PERSONAS = ["arun", "sanvid", "meera", "nikhil", "f01", "f02", "admin", "anon"]
SUB = {"arun": "student", "sanvid": "student", "meera": "student", "nikhil": "no team",
       "f01": "faculty", "f02": "faculty", "admin": "admin", "anon": "signed out"}


def gen_rls_matrix() -> None:
    rows = tap("02_rls_matrix.sql")
    cells: dict[tuple[str, str], tuple[bool, str]] = {}
    rels: list[str] = []
    other = []
    for ok, n, d in rows:
        m = re.match(r"matrix: (\w+)\s+sees (\S+) rows of (\w+)$", d)
        if m:
            who, val, rel = m.groups()
            cells[(rel, who)] = (ok, val)
            if rel not in rels:
                rels.append(rel)
        else:
            other.append((ok, n, d))
    # table order as in the test's expectation table
    src = (TESTS / "02_rls_matrix.sql").read_text()
    order = re.findall(r"^\s+\('(\w+)',\s+'", src, re.M)
    rels = [r for r in order if r in rels] + [r for r in rels if r not in order]
    green, red, grey = "#d6f0d6", "#f6c9c9", "#e9e9e9"
    head = "".join(f'<td bgcolor="#30475e"><font color="white"><b>{p}</b><br/><font point-size="10">{SUB[p]}</font></font></td>' for p in PERSONAS)
    body = []
    for rel in rels:
        tds = []
        for p in PERSONAS:
            ok, val = cells[(rel, p)]
            bg = (grey if val == "denied" else green) if ok else red
            txt = "42501" if val == "denied" else val
            tds.append(f'<td bgcolor="{bg}">{txt}</td>')
        kind = "view" if rel.startswith("v_") else "table"
        body.append(f'<tr><td align="left" bgcolor="#f7f7f7"><font face="DejaVu Sans Mono">{rel}</font>'
                    f'{" <i>(view)</i>" if kind == "view" else ""}</td>{"".join(tds)}</tr>')
    n_ok = sum(ok for ok, _ in cells.values())
    dot = f"""// Generated by gen_c8.py from the TAP output of supabase/tests/02_rls_matrix.sql (local stack).
digraph rls_matrix {{
  graph [pad=0.15, bgcolor=white];
  node [shape=plaintext, fontname="DejaVu Sans", fontsize=12];
  m [label=<<table border="0" cellborder="1" cellspacing="0" cellpadding="4">
  <tr><td bgcolor="#30475e" align="left"><font color="white"><b>relation \\ persona</b></font></td>{head}</tr>
  {"".join(body)}
  <tr><td colspan="9" align="left" bgcolor="white"><font point-size="11">Cell = rows the persona sees (count(*) run as that persona). Green: equals the expected value (pass).<br align="left"/>Grey 42501: permission denied, as expected for anon. Red: mismatch (fail). Result: {n_ok} / {len(cells)} pass.<br align="left"/></font></td></tr>
  </table>>];
}}
"""
    (HERE / "c8_rls_matrix.dot").write_text(dot)
    print("wrote docs/lab/diagrams/c8/c8_rls_matrix.dot", n_ok, "/", len(cells))
    lines = [f"Run of `supabase/tests/02_rls_matrix.sql` on the local stack: **{sum(o for o, _, _ in rows)} / {len(rows)} pass** "
             f"({len(cells)} matrix cells + {len(other)} targeted checks).", "",
             "| # | Targeted check (test description) | Result |", "|--:|:--------------------------------|:--|"]
    for ok, n, d in other:
        lines.append(f"| {n} | {esc(d)} | {'pass' if ok else '**FAIL**'} |")
    write("rls_other.md", "\n".join(lines))


# --------------------------------------------------------------------------------------------
# 5. Abuse cases (04)
# --------------------------------------------------------------------------------------------
def gen_abuse() -> None:
    rows = tap("04_abuse_cases.sql")
    src = (TESTS / "04_abuse_cases.sql").read_text()
    sections = [(m.start(), m.group(1)) for m in re.finditer(r"^-- (\d\. .+)$", src, re.M)]
    # map each test to its section by the position of its description in the file
    def section_of(desc: str) -> str:
        key = desc.replace("'", "''")
        pos = src.find(key)
        if pos < 0:
            pos = src.find(desc.split(" ...")[0][:40].replace("'", "''"))
        sec = ""
        for start, name in sections:
            if start <= pos:
                sec = name
        return sec
    lines = [f"Run of `supabase/tests/04_abuse_cases.sql` on the local stack: **{sum(o for o, _, _ in rows)} / {len(rows)} pass**. "
             "Each attack is made the way an attacker would make it (a direct table write with the API role, "
             "not the friendly RPC); the expected result is the SQLSTATE and rule key the database must return.", "",
             "| # | Attack or rule (test description) | Result |", "|--:|:--------------------------------|:--|"]
    last = None
    for ok, n, d in rows:
        sec = section_of(d)
        if sec != last:
            lines.append(f"| | **{esc(sec)}** | |")
            last = sec
        lines.append(f"| {n} | {esc(d)} | {'pass' if ok else '**FAIL**'} |")
    write("abuse.md", "\n".join(lines))


# --------------------------------------------------------------------------------------------
# 6. Constraint gallery (01): rule -> statement -> SQLSTATE -> DB message -> web message
# --------------------------------------------------------------------------------------------
CAPTURE = r"""
CREATE TEMP TABLE gallery (n serial, sql text, exp_state text, exp_msg text, descr text,
                           got_state text, message text, detail text, hint text, cons text);
CREATE FUNCTION pg_temp.capture(p_sql text, p_state text, p_msg text, p_descr text) RETURNS text
LANGUAGE plpgsql AS $f$
DECLARE s text; m text; d text; h text; c text;
BEGIN
  BEGIN
    EXECUTE p_sql;
    s := 'NO ERROR';
    RAISE EXCEPTION 'undo' USING ERRCODE = 'P0099';
  EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS s = RETURNED_SQLSTATE, m = MESSAGE_TEXT, d = PG_EXCEPTION_DETAIL,
                            h = PG_EXCEPTION_HINT, c = CONSTRAINT_NAME;
  END;
  INSERT INTO gallery (sql, exp_state, exp_msg, descr, got_state, message, detail, hint, cons)
  VALUES (p_sql, p_state, p_msg, p_descr, s, m, d, h, c);
  RETURN s;
END $f$;
"""


def map_errors(errs: list[dict]) -> list[dict]:
    """Run each {code, message, details, hint} through web/src/lib/errors.ts (toAppError)."""
    r = subprocess.run(["node", str(HERE / "c8_map_errors.mjs")], input=json.dumps(errs),
                       capture_output=True, text=True, check=True, cwd=ROOT / "web")
    return json.loads(r.stdout)


# The test descriptions of rows 14-16 name the history rule; the error names the FIRST RESTRICT key
# PostgreSQL checked, which is a different FK. The gallery shows a description that says both
# (examiner review, 5 Nov 2026). The test file itself is not changed.
SHOWN_AS = {
    "RESTRICT: a student with recorded contributions cannot be deleted":
        "RESTRICT: a student with a login and recorded work cannot be deleted (the first RESTRICT key checked is the login, `app_user_usn_fkey`; `contribution_usn_fkey` is RESTRICT too)",
    "RESTRICT: deleting a course does not wipe its projects":
        "RESTRICT: a course with offerings and projects cannot be deleted (the first key checked is `course_offering_course_code_fkey`; `project_course_code_fkey` is RESTRICT too)",
    "RESTRICT: a project with submissions, claims and marks cannot be deleted":
        "RESTRICT: a project with teams, submissions, claims and marks cannot be deleted (the first key checked is `team_project_id_fkey`)",
}


def gen_gallery() -> None:
    src = (TESTS / "01_constraints.sql").read_text()
    src = src.replace("SELECT plan(45);", "SELECT plan(45);\n" + CAPTURE, 1)
    src = src.replace("SELECT throws_ok(", "SELECT pg_temp.capture(")
    src = src.replace("SELECT * FROM finish();",
                      "SELECT '@@GALLERY@@' || json_agg(g ORDER BY n)::text FROM gallery g;")
    out = psql(src)
    payload = out[out.index("@@GALLERY@@") + len("@@GALLERY@@"):]
    rows = json.loads(payload[: payload.rindex("]") + 1])
    mapped = map_errors([{"code": g["got_state"], "message": g["message"], "details": g["detail"],
                          "hint": g["hint"]} for g in rows])
    run = tap("01_constraints.sql")
    tapno = {d: n for _, n, d in run}
    for g in rows:                       # number each row as the test file's TAP output does
        g["n"] = tapno[g["descr"]]
    thrown = {g["descr"] for g in rows}
    happy = [(ok, n, d) for ok, n, d in run if d not in thrown]
    lines = [f"Generated by re-running every `throws_ok` statement of `supabase/tests/01_constraints.sql` in a rolled-back "
             f"transaction and capturing the error (`GET STACKED DIAGNOSTICS`), then passing the error, as PostgREST "
             f"would return it, through `toAppError()` in `web/src/lib/errors.ts`. **{sum(g['got_state'] == g['exp_state'] for g in rows)} "
             f"of {len(rows)}** statements fail with the SQLSTATE the test expects. Rows are numbered as in the test's TAP output.", "",
             "| # | Rule and the violating statement | SQLSTATE · constraint / rule key | Database message | Message the web shows (title: text) |",
             "|--:|:----------------------------|:----------|:--------------|:--------------|"]
    for g, w in zip(rows, mapped):
        stmt = re.sub(r"\s+", " ", g["sql"]).strip()
        ok = "" if g["got_state"] == g["exp_state"] else " **(UNEXPECTED)**"
        lines.append(f"| {g['n']} | {esc(SHOWN_AS.get(g['descr'], g['descr']))}: {code(stmt)} | {g['got_state']}{ok} · `{g['cons'] or '-'}` | "
                     f"{esc(g['message'])} | **{esc(w['title'])}:** {esc(w['message'])}"
                     f"{' (field `' + w['field'] + '`)' if w.get('field') else ''} |")
    lines += ["", f"The other {len(happy)} assertions of the file are happy paths and derived-value checks "
              f"(run of the unmodified file: **{sum(o for o, _, _ in run)} / {len(run)} pass**):", "",
              "| # | Happy path / derived value (test description) | Result |", "|--:|:--------------------------|:--|"]
    for ok, n, d in happy:
        lines.append(f"| {n} | {esc(d)} | {'pass' if ok else '**FAIL**'} |")
    write("gallery.md", "\n".join(lines))


# --------------------------------------------------------------------------------------------
# 7. Worked example: the same bad input sent to each layer (all refused; nothing written)
# --------------------------------------------------------------------------------------------
def gen_trace() -> None:
    import httpx
    env = (ROOT / "web" / ".env.local").read_text()
    url = re.search(r"^VITE_SUPABASE_URL=(.*)$", env, re.M).group(1).strip()
    key = re.search(r"^VITE_SUPABASE_ANON_KEY=(.*)$", env, re.M).group(1).strip()
    if not re.match(r"^http://(127\.0\.0\.1|localhost):\d+$", url):
        sys.exit("refusing: web/.env.local does not point at the local stack")

    def token(who: str) -> str:
        r = httpx.post(f"{url}/auth/v1/token?grant_type=password", headers={"apikey": key},
                       json={"email": f"{who}@example.edu", "password": "Countersign@2026"})
        r.raise_for_status()
        return r.json()["access_token"]

    tok = {w: token(w) for w in ("ramesh", "lakshmi", "arun")}

    def call(who, path, body, label, layer):
        h = {"apikey": key, "Authorization": f"Bearer {tok[who]}", "Content-Type": "application/json",
             "Prefer": "return=minimal"}
        r = httpx.post(f"{url}/rest/v1/{path}", headers=h, json=body)
        b = r.json() if r.content else {}
        return {"who": who, "path": path, "body": body, "status": r.status_code, "resp": b, "label": label, "layer": layer}

    meera = "1RV24CY033"
    calls = [
        call("ramesh", "rpc/record_assessment", {"p_usn": meera, "p_project_id": "P06", "p_milestone_no": 2, "p_marks": 4.25},
             "two decimals, through the RPC", "2 RPC pre-check"),
        call("ramesh", "rpc/record_assessment", {"p_usn": meera, "p_project_id": "P06", "p_milestone_no": 2, "p_marks": 7},
             "above the maximum (5), through the RPC", "3 trigger (reached via RPC)"),
        call("ramesh", "assessment", {"usn": meera, "project_id": "P06", "milestone_no": 2, "marks": 7, "assessed_by": "F01"},
             "above the maximum, direct INSERT (RPC bypassed)", "3 trigger"),
        call("ramesh", "assessment", {"usn": meera, "project_id": "P06", "milestone_no": 2, "marks": -1, "assessed_by": "F01"},
             "negative, direct INSERT", "3 CHECK"),
        call("lakshmi", "rpc/record_assessment", {"p_usn": meera, "p_project_id": "P06", "p_milestone_no": 2, "p_marks": 4},
             "valid mark by a faculty member who does not teach P06 (RPC)", "2 RPC pre-check"),
        call("lakshmi", "assessment", {"usn": meera, "project_id": "P06", "milestone_no": 2, "marks": 4, "assessed_by": "F02"},
             "the same, direct INSERT", "3 RLS WITH CHECK"),
        call("arun", "rpc/record_assessment", {"p_usn": "1RV24CY047", "p_project_id": "P06", "p_milestone_no": 2, "p_marks": 5},
             "a student marking himself (RPC)", "2 RPC pre-check"),
        call("arun", "rpc/file_claim", {"p_project_id": "P06", "p_milestone_no": 5, "p_contribution_type": "design",
                                        "p_description": "DFD"}, "claim statement of 3 characters (RPC)", "2 RPC pre-check"),
        call("arun", "claim", {"usn": "1RV24CY047", "team_id": "T00", "project_id": "P06", "milestone_no": 5, "statement": "DFD"},
             "the same, direct INSERT", "3 CHECK"),
    ]
    mapped = map_errors([{"code": c["resp"].get("code"), "message": c["resp"].get("message"),
                          "details": c["resp"].get("details"), "hint": c["resp"].get("hint")} for c in calls])
    after = httpx.get(f"{url}/rest/v1/assessment?select=marks&usn=eq.{meera}&project_id=eq.P06&milestone_no=eq.2",
                      headers={"apikey": key, "Authorization": f"Bearer {tok['ramesh']}"}).json()
    lines = ["| # | Caller, attempt and request (PostgREST) | Layer that refused | HTTP · SQLSTATE · DETAIL | Database message | Web message (title: text) |",
             "|--:|:--------------------|:-------|:---------|:--------------|:-----------|"]
    for i, (c, w) in enumerate(zip(calls, mapped), 1):
        req = f"POST /rest/v1/{c['path']} " + json.dumps(c["body"], separators=(",", ":"))
        r = c["resp"]
        lines.append(f"| {i} | **{c['who']}**: {esc(c['label'])}. {code(req)} | {c['layer']} | {c['status']} · {r.get('code')} · "
                     f"`{r.get('details') or '-'}` | {esc(r.get('message'))} | **{esc(w['title'])}:** {esc(w['message'])} |")
    lines += ["", f"Afterwards, ramesh reads Meera's P06/C2 row: `{json.dumps(after)}`: every attempt was refused and nothing was written."]
    write("trace.md", "\n".join(lines))


if __name__ == "__main__":
    gen_policies()
    gen_secdef()
    gen_privileges()
    gen_rls_matrix()
    gen_abuse()
    gen_gallery()
    gen_trace()
