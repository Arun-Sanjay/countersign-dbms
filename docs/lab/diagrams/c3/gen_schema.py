"""
Relational schema diagrams generated from the ACTUAL applied DDL.

Input : schema_introspection.json (written by introspect_schema.sql, a read-only pg_catalog
        query run against the local Supabase database with migrations 0001-0004 applied)
Output: schema_part1.dot, schema_part2.dot   (render: dot -Tpng -Gdpi=200 ...)
        fk_key.md                            (the numbered key of all 54 FOREIGN KEYs)

Legibility rules (examiner's corrections 1 and 2):
  * The 27 relations are split over two figures.  Every relation is drawn in full in exactly
    one figure.  A FOREIGN KEY whose target is drawn in the other figure ends at a small grey
    "off-page" tag naming the target (for example "-> student (usn)  see Fig. C3-9"), so no
    arrow crosses from one figure to the other and no hub table collects a dozen arrowheads.
  * Every FOREIGN KEY constraint has a number #1..#54.  The number and the ON DELETE action
    are printed in the row of the referencing column itself, and the number is printed again
    on the arrow.  fk_key.md lists all 54 with constraint name, columns, target and action.
  * The ON DELETE action is also encoded in the arrow: CASCADE dashed red, RESTRICT solid
    blue, SET NULL dotted green, NO ACTION solid grey.
"""
import json
import re

d = json.load(open("schema_introspection.json"))
T = {t["name"]: t for t in d["tables"]}

ORDER = ["academic_term", "course", "faculty", "course_offering", "student", "enrollment", "project",
         "milestone", "team", "team_member", "skill", "student_skill", "project_skill", "course_skill",
         "app_user", "note",
         "artifact", "artifact_version", "contribution", "artifact_chunk", "submission", "submission_artifact",
         "assessment", "claim", "claim_evidence", "countersign", "skill_evidence"]
PART1 = ORDER[:16]
PART2 = ORDER[16:]
INFRA = {"app_user", "course_skill", "skill_evidence", "note"}
FIGNO = {1: "C3-9", 2: "C3-10"}
PART = {**{n: 1 for n in PART1}, **{n: 2 for n in PART2}}
STYLE = {"CASCADE": ('#b03030', 'dashed'), "RESTRICT": ('#1a3d8f', 'solid'),
         "SET NULL": ('#2e7d32', 'dotted'), "NO ACTION": ('#555555', 'solid')}

# ---- number the foreign keys in listing order (referencing relation, then constraint name)
fks = []
for n in ORDER:
    t = T[n]
    for f in sorted((f for f in d["fks"] if f["name"] == n and f["schema"] == t["schema"]), key=lambda f: f["conname"]):
        fks.append(f)
assert len(fks) == 54, len(fks)
for i, f in enumerate(fks, 1):
    f["no"] = i
bycol = {}
for f in fks:
    for c in f["cols"]:
        bycol.setdefault((f["name"], c), []).append(f)


def short(t):
    t = t.replace("character varying", "varchar").replace("timestamp with time zone", "timestamptz")
    t = t.replace("character", "char").replace("integer", "int").replace("extensions.", "")
    return re.sub(r"\s+", " ", t)


def qual(n):
    return ("private." if T[n]["schema"] == "private" else "") + n


def table(n, part):
    t = T[n]
    head = "#7a808c" if n in INFRA else "#1a3d8f"
    rows = [f'<TR><TD COLSPAN="3" BGCOLOR="{head}" ALIGN="CENTER"><FONT COLOR="white" POINT-SIZE="15"><B>{qual(n)}</B></FONT></TD></TR>']
    for c in t["columns"]:
        name = c["name"]
        if c["pk"]:
            name = f"<B><U>{name}</U></B>"
        elif c["fk"]:
            name = f"<I>{name}</I>"
        flags = [x for x, on in (("PK", c["pk"]), ("FK", c["fk"]), ("UQ", c["unique"]), ("GEN", c["generated"]),
                                 ("NN", c["not_null"] and not c["pk"])) if on]
        refs = bycol.get((n, c["name"]), [])
        def cell(f):
            same = PART.get(f["ref_table"]) == PART.get(n)
            tgt = "" if same else (f' &#8594; {"auth." if f["ref_schema"] == "auth" else ""}{f["ref_table"]}')
            return f'<FONT COLOR="{STYLE[f["on_delete"]][0]}"><B>#{f["no"]}</B>{tgt} {f["on_delete"]}</FONT>'
        fkcell = "<BR/>".join(cell(f) for f in refs) or "&#160;"
        bg = "#eef3fb" if c["pk"] else ("#fdf3e1" if c["fk"] else "white")
        rows.append(f'<TR><TD PORT="{c["name"]}_in" ALIGN="LEFT" BGCOLOR="{bg}">{name}</TD>'
                    f'<TD ALIGN="LEFT"><FONT COLOR="#555555">{" ".join(flags) or "&#160;"}</FONT></TD>'
                    f'<TD PORT="{c["name"]}_out" ALIGN="LEFT">{fkcell}</TD></TR>')
    return (f'  "{n}" [label=<<TABLE BORDER="1" CELLBORDER="1" CELLSPACING="0" CELLPADDING="4">'
            + "".join(rows) + "</TABLE>>];")


GRID = {   # columns of tables, left to right; foreign keys mostly point to the right
    1: [["note", "app_user", "team_member", "enrollment"],
        ["team", "student", "student_skill", "project_skill", "course_skill"],
        ["milestone", "project", "skill"],
        ["course_offering", "academic_term", "course", "faculty"]],
    2: [["countersign", "claim_evidence", "skill_evidence"],
        ["claim", "contribution", "submission_artifact"],
        ["artifact_version", "submission", "assessment"],
        ["artifact", "artifact_chunk"]],
}
COLGAP, ROWGAP = 1.25, 0.6


def legend():
    rows = [
        '<B>Key</B>',
        '<B><U>pk</U></B> primary key column &#160; <I>fk</I> foreign key column',
        'PK, FK, UQ, NN, GEN: primary key, foreign key,',
        '&#160;&#160;&#160;unique, not null, generated column',
        '<B>#n</B>: FOREIGN KEY n of the key table, Section 8.2,',
        '&#160;&#160;&#160;printed in its column row and on its arrow',
        f'<FONT COLOR="{STYLE["CASCADE"][0]}">- - - - ON DELETE CASCADE</FONT>',
        f'<FONT COLOR="{STYLE["RESTRICT"][0]}">&#8212;&#8212;&#8212; ON DELETE RESTRICT</FONT>',
        f'<FONT COLOR="{STYLE["SET NULL"][0]}">&#183;&#183;&#183;&#183;&#183;&#183; ON DELETE SET NULL</FONT>',
        f'<FONT COLOR="{STYLE["NO ACTION"][0]}">&#8212;&#8212;&#8212; NO ACTION (no ON DELETE clause)</FONT>',
        'Grey header: infrastructure relation (Appendix A)',
        '&#8594; relation: the referenced relation is drawn',
        '&#160;&#160;&#160;in the other figure (no arrow here)',
    ]
    return ('<TABLE BORDER="1" CELLBORDER="0" CELLSPACING="0" CELLPADDING="2">'
            + "".join(f'<TR><TD ALIGN="LEFT">{r}</TD></TR>' for r in rows) + '</TABLE>')


def measure():
    out = ['digraph m {', '  node [shape=plaintext, fontname="DejaVu Sans", fontsize=13];']
    for n in ORDER:
        out.append(table(n, 0))
    out.append(f'  "legend" [label=<{legend()}>];')
    out.append("}")
    open("schema_measure.dot", "w").write("\n".join(out))


def sizes():
    js = json.load(open("schema_sizes.json"))
    return {o["name"]: (float(o["width"]), float(o["height"])) for o in js["objects"]}


def figure(part, title, sz):
    cols = GRID[part]
    members = [n for c in cols for n in c]
    P = 72.0
    pos = {}
    x = 0.0
    for col in cols:
        w = max(sz[n][0] for n in col)
        y = 0.0
        for n in col:
            pos[n] = (x + sz[n][0] / 2, y + sz[n][1] / 2)
            y += sz[n][1] + ROWGAP
        x += w + COLGAP
    # legend under the shortest column
    hs = [sum(sz[n][1] + ROWGAP for n in c) for c in cols]
    k = hs.index(min(hs))
    lx = sum(max(sz[n][0] for n in c) + COLGAP for c in cols[:k])
    pos["legend"] = (lx + sz["legend"][0] / 2, hs[k] + 0.3 + sz["legend"][1] / 2)
    out = ['digraph schema {',
           '  graph [splines=true, pad=0.3, fontname="DejaVu Sans", outputorder=edgesfirst,',
           f'         label=<<B>{title}</B>>, labelloc=t, fontsize=24];',
           '  node [shape=plaintext, fontname="DejaVu Sans", fontsize=13];',
           '  edge [fontname="DejaVu Sans", fontsize=14, arrowsize=1.0, penwidth=1.8];']
    for n in members:
        out.append(table(n, part).replace(f'"{n}" [label=', f'"{n}" [pos="{pos[n][0]*P:.1f},{-pos[n][1]*P:.1f}!", label=', 1))
    out.append(f'  "legend" [pos="{pos["legend"][0]*P:.1f},{-pos["legend"][1]*P:.1f}!", label=<{legend()}>];')
    for f in fks:
        if f["name"] not in members or f["ref_table"] not in members:
            continue
        color, style = STYLE[f["on_delete"]]
        tgt = f["ref_table"]
        if pos[tgt][0] > pos[f["name"]][0] + 0.5:      # target in a column to the right
            head = f'"{tgt}":"{f["ref_cols"][0]}_in":w'
        else:                                         # same column: loop round the right-hand side
            head = f'"{tgt}":"{f["ref_cols"][0]}_out":e'
        out.append(f'  "{f["name"]}":"{f["cols"][0]}_out":e -> {head} '
                   f'[color="{color}", style={style}, fontcolor="{color}", label=<<B>#{f["no"]}</B>>];')
    out.append("}")
    return "\n".join(out)


if __name__ == "__main__":
    import sys
    if sys.argv[1:] == ["measure"]:
        measure()
        sys.exit(0)
    sz = sizes()
    open("schema_part1.dot", "w").write(figure(1, "Relational schema, part 1: academic structure, projects, teams, skills, identity, private notes", sz))
    open("schema_part2.dot", "w").write(figure(2, "Relational schema, part 2: artifacts, contributions, submissions, assessment, claims, skill evidence", sz))
    lines = ["| # | Constraint | Referencing relation (columns) | Referenced relation (columns) | ON DELETE | Fig. |",
             "|--:|---|---|---|---|---|"]
    for f in fks:
        fig = FIGNO[1] if f["name"] in PART1 else FIGNO[2]
        ref = ("auth." if f["ref_schema"] == "auth" else "") + f["ref_table"]
        lines.append(f'| {f["no"]} | `{f["conname"]}` | {qual(f["name"])} ({", ".join(f["cols"])}) | '
                     f'{ref} ({", ".join(f["ref_cols"])}) | {f["on_delete"]} | {fig} |')
    open("fk_key.md", "w").write("\n".join(lines) + "\n")
    from collections import Counter
    print("tables", len(d["tables"]), "fks", len(fks), Counter(f["on_delete"] for f in fks))
