"""Emit relations_listing.md: every relation of the applied schema in Elmasri text notation
(PK underlined, FK italic), with each FOREIGN KEY and its ON DELETE action. Source:
schema_introspection.json (read-only catalog query, see introspect_schema.sql)."""
import json
d = json.load(open("schema_introspection.json"))
fk = {}
for f in d["fks"]:
    fk.setdefault((f["schema"], f["name"]), []).append(f)
order = ["academic_term", "course", "faculty", "course_offering", "student", "enrollment", "project",
         "milestone", "team", "team_member", "skill", "student_skill", "project_skill", "artifact",
         "artifact_version", "contribution", "artifact_chunk", "submission", "submission_artifact",
         "assessment", "claim", "claim_evidence", "countersign",
         "app_user", "course_skill", "skill_evidence", "note"]
T = {t["name"]: t for t in d["tables"]}
lines = []
for n in order:
    t = T[n]
    nm = (t["schema"] + "." if t["schema"] != "public" else "") + n
    cols = []
    for c in t["columns"]:
        s = c["name"]
        if c["pk"]:
            s = "[" + s + "]{.underline}"
        if c["fk"]:
            s = "*" + s + "*"
        cols.append(s)
    lines.append("- **" + nm.upper() + "** (" + ", ".join(cols) + ")")
    for f in fk.get((t["schema"], n), []):
        lines.append("    - FK (" + ", ".join(f["cols"]) + ") → " + f["ref_schema"] + "." + f["ref_table"]
                     + "(" + ", ".join(f["ref_cols"]) + ") ON DELETE " + f["on_delete"])
open("relations_listing.md", "w").write("\n".join(lines) + "\n")
print(len(lines), "lines")
