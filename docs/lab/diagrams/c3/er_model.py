"""
Component 3 - conceptual ER model of Countersign (Chen / Elmasri & Navathe notation).

Single source of truth for every ER figure. gen_er.py turns this model into Graphviz
.dot files (neato -n2, pinned positions) and renders SVG/PNG.

Honesty rule: every entity, attribute, relationship and (min,max) pair below is read off
the applied DDL (supabase/migrations/0001-0004). Foreign-key columns are NOT attributes
in a conceptual ER schema (Elmasri & Navathe, Ch. 3): they appear as relationships.
(min,max) = structural constraint ENFORCED by the database (NOT NULL / PK / UNIQUE / FK /
trigger). Where a business rule is stronger but not enforced, the enforced value is drawn
and the gap is noted in C3_ER.md.
"""

# ---------------------------------------------------------------- attribute helpers
def A(name, **kw):
    """Attribute. kw: key, partial, derived, multi, comp=[...children names]."""
    d = dict(name=name, key=False, partial=False, derived=False, multi=False, comp=None)
    d.update(kw)
    return d


K = lambda n: A(n, key=True)          # key attribute (underlined)
PK = lambda n: A(n, partial=True)     # partial key of a weak entity (dashed underline)
D = lambda n: A(n, derived=True)      # derived attribute (dashed oval)

# ---------------------------------------------------------------- entity types
# pos = (x, y) in inches on the poster canvas, y grows DOWNWARD (flipped at render time)
ENTITIES = {
    "ACADEMIC_TERM": dict(weak=False, pos=(0, 0), attrs=[
        K("term_id"), A("name"), A("period", comp=["start_date", "end_date"])]),
    "COURSE_OFFERING": dict(weak=False, pos=(0, 12), attrs=[
        K("offering_id"), A("section")]),
    "COURSE": dict(weak=False, pos=(14, 0), attrs=[
        K("course_code"), A("title"), A("semester"), A("credits")]),
    "FACULTY": dict(weak=False, pos=(28, 0), attrs=[
        K("faculty_id"), A("name"), K("email"), A("department"), A("designation")]),

    "SKILL": dict(weak=False, pos=(0, 24), attrs=[
        K("skill_id"), K("name"), A("category")]),
    "PROJECT": dict(weak=False, pos=(14, 12), attrs=[
        K("project_id"), A("title"), A("description"), A("status"),
        A("duration", comp=["start_date", "end_date"])]),
    "MILESTONE": dict(weak=True, pos=(42, 12), attrs=[
        PK("milestone_no"), A("title"), A("max_marks"), A("deadline"),
        A("cie_part"), D("counts_in_reduced"), A("locked_at")]),

    "STUDENT": dict(weak=False, pos=(14, 24), attrs=[
        K("usn"), A("name"), K("email"), A("department"), A("section"),
        A("semester"), A("joined_at")]),
    "TEAM": dict(weak=False, pos=(42, 0), attrs=[
        K("team_id"), A("team_name"), A("max_size"), A("created_at"),
        A("topic_title"), A("abstract"), D("current_size")]),

    "SUBMISSION": dict(weak=False, pos=(56, 0), attrs=[
        K("submission_id"), A("attempt_no"), A("submitted_at")]),
    "CLAIM": dict(weak=False, pos=(28, 24), attrs=[
        K("claim_id"), A("statement"), A("contribution_type"), A("ai_assistance"),
        A("revision"), A("created_at"), D("status")]),
    "CLAIM_EVIDENCE": dict(weak=True, pos=(42, 36), attrs=[
        PK("evidence_no"), A("kind"), A("ref"), A("note"), A("added_at")]),

    "ARTIFACT": dict(weak=False, pos=(56, 12), attrs=[
        K("artifact_id"), A("title"), A("type"), A("source"), A("visibility"),
        A("external_ref"), A("created_at")]),
    "ARTIFACT_VERSION": dict(weak=True, pos=(56, 36), attrs=[
        PK("version_no"), A("created_at"), A("content_hash"), A("mongo_ref"),
        A("ai_assistance")]),
    "CONTRIBUTION": dict(weak=False, pos=(28, 36), attrs=[
        K("contribution_id"), A("contribution_type"), A("description"), A("source"),
        A("source_ref"), A("occurred_at"), A("ai_assisted"), A("created_at")]),
    "ARTIFACT_CHUNK": dict(weak=False, pos=(14, 48), attrs=[
        K("chunk_id"), A("version_no"), A("content"), A("embedding"),
        A("embedding_model"), A("content_hash"), A("visibility"), A("created_at"),
        D("tsv")]),
}


# ---------------------------------------------------------------- relationship types
# ends: (entity, (min,max), role or None). total participation <=> min >= 1.
# kind: 'normal' | 'identifying'. pos optional (else midpoint / centroid).
def R(ends, kind="normal", attrs=(), pos=None, ratio=None, ports=None):
    return dict(ends=ends, kind=kind, attrs=list(attrs), pos=pos, ratio=ratio, ports=ports)


RELS = {
    # --- academic structure
    "SCHEDULED_IN": R([("ACADEMIC_TERM", "(0,N)"), ("COURSE_OFFERING", "(1,1)")]),
    "OFFERED_AS":   R([("COURSE", "(0,N)"), ("COURSE_OFFERING", "(1,1)")]),
    "COORDINATES":  R([("FACULTY", "(0,N)"), ("COURSE", "(0,1)")]),
    "TEACHES":      R([("FACULTY", "(0,N)"), ("COURSE_OFFERING", "(1,1)")]),
    "ENROLLS":      R([("STUDENT", "(0,N)"), ("COURSE_OFFERING", "(0,N)")],
                      attrs=[A("enrolled_on")]),
    "HAS_PROJECT":  R([("COURSE", "(0,N)"), ("PROJECT", "(1,1)")]),
    "RUNS_IN":      R([("COURSE_OFFERING", "(0,N)"), ("PROJECT", "(0,1)")]),
    "HAS_MILESTONE": R([("PROJECT", "(0,N)"), ("MILESTONE", "(1,1)")], kind="identifying"),
    "HAS_TEAM":     R([("PROJECT", "(0,N)"), ("TEAM", "(1,1)")]),
    # --- skills
    "HAS_SKILL":    R([("STUDENT", "(0,N)"), ("SKILL", "(0,N)")],
                      attrs=[A("level"), D("verified_level")]),
    "REQUIRES":     R([("PROJECT", "(0,N)"), ("SKILL", "(0,N)")],
                      attrs=[A("min_level")]),
    "SUBSKILL_OF":  R([("SKILL", "(0,N)", "parent"), ("SKILL", "(0,1)", "sub-skill")], pos=(-6, 24), ports=("n", "s")),
    # --- teams
    "MEMBER_OF":    R([("STUDENT", "(0,N)"), ("TEAM", "(0,6)")],
                      attrs=[A("role"), A("joined_at"), D("lab_cie_total")]),
    # --- artifacts and work
    "PRODUCES":     R([("TEAM", "(0,N)"), ("ARTIFACT", "(1,1)")]),
    "FILED_UNDER":  R([("MILESTONE", "(0,N)"), ("ARTIFACT", "(1,1)")]),
    "OWNS":         R([("STUDENT", "(0,N)"), ("ARTIFACT", "(0,1)")]),
    "HAS_VERSION":  R([("ARTIFACT", "(0,N)"), ("ARTIFACT_VERSION", "(1,1)")],
                      kind="identifying"),
    "CREATES":      R([("STUDENT", "(0,N)"), ("ARTIFACT_VERSION", "(1,1)")]),
    "MAKES":        R([("STUDENT", "(0,N)"), ("CONTRIBUTION", "(1,1)")]),
    "CONTRIBUTES_TO": R([("CONTRIBUTION", "(1,1)"), ("ARTIFACT", "(0,N)")]),
    "CHUNKED_INTO": R([("ARTIFACT", "(0,N)"), ("ARTIFACT_CHUNK", "(1,1)")]),
    "AUTHORS":      R([("STUDENT", "(0,N)"), ("ARTIFACT_CHUNK", "(1,1)")]),
    # --- assessment layer
    "SUBMITS":      R([("TEAM", "(0,N)"), ("SUBMISSION", "(1,1)")]),
    "SUBMITTED_FOR": R([("MILESTONE", "(0,N)"), ("SUBMISSION", "(1,1)")]),
    "SUBMITTED_BY": R([("STUDENT", "(0,N)"), ("SUBMISSION", "(1,1)")]),
    "FREEZES":      R([("SUBMISSION", "(0,N)"), ("ARTIFACT_VERSION", "(0,N)")]),
    "ASSESSES":     R([("FACULTY", "(0,N)"), ("STUDENT", "(0,N)"), ("MILESTONE", "(0,N)")],
                      attrs=[A("marks"), A("assessed_at"), A("remarks")],
                      ratio={"FACULTY": "1", "STUDENT": "M", "MILESTONE": "N"}),
    # --- claims ("every mark has a receipt")
    "FILES":        R([("STUDENT", "(0,N)"), ("CLAIM", "(1,1)")]),
    "CLAIMED_IN":   R([("TEAM", "(0,N)"), ("CLAIM", "(1,1)")]),
    "CLAIM_FOR":    R([("MILESTONE", "(0,N)"), ("CLAIM", "(1,1)")]),
    "BACKED_BY":    R([("CLAIM", "(0,N)"), ("CLAIM_EVIDENCE", "(1,1)")], kind="identifying"),
    "CITES_CONTRIB": R([("CLAIM_EVIDENCE", "(0,1)"), ("CONTRIBUTION", "(0,N)")]),
    "CITES_VERSION": R([("CLAIM_EVIDENCE", "(0,1)"), ("ARTIFACT_VERSION", "(0,N)")]),
    "COUNTERSIGNS": R([("STUDENT", "(0,N)"), ("CLAIM", "(0,N)")],
                      attrs=[A("verdict"), A("comment"), A("claim_revision"), A("signed_at")]),
}

# Subject-area views. Membership rule (stated in C3_ER.md, section 3):
#   * every relationship type is drawn, with its attributes and (min,max), in EXACTLY ONE view;
#   * every entity type is drawn with all its attributes in exactly one view (its home view)
#     and as a plain rectangle (a "stub", no attributes) in any other view where one of
#     that view's relationship types needs it;
#   * an identifying relationship is drawn in the home view of its weak entity type.
# The union of the five views is therefore exactly the core schema (checked in gen_er.py).
VIEWS = {
    "va_academic": dict(
        title="View A - Academic structure: terms, courses, offerings, faculty, projects",
        home=["ACADEMIC_TERM", "COURSE", "FACULTY", "COURSE_OFFERING", "PROJECT"],
        rels=["SCHEDULED_IN", "OFFERED_AS", "COORDINATES", "TEACHES", "ENROLLS",
              "HAS_PROJECT", "RUNS_IN", "HAS_TEAM"]),
    "vb_students": dict(
        title="View B - Students, teams, skills (recursive SUBSKILL_OF) and contributions",
        home=["STUDENT", "TEAM", "SKILL", "CONTRIBUTION"],
        rels=["MEMBER_OF", "HAS_SKILL", "REQUIRES", "SUBSKILL_OF", "MAKES", "CONTRIBUTES_TO"]),
    "vc_work": dict(
        title="View C - Artifacts, immutable versions and text chunks",
        home=["ARTIFACT", "ARTIFACT_VERSION", "ARTIFACT_CHUNK"],
        rels=["PRODUCES", "FILED_UNDER", "OWNS", "HAS_VERSION", "CREATES", "CHUNKED_INTO", "AUTHORS"]),
    "vd_assessment": dict(
        title="View D - Components, submissions and the ternary ASSESSES",
        home=["MILESTONE", "SUBMISSION"],
        rels=["HAS_MILESTONE", "SUBMITS", "SUBMITTED_FOR", "SUBMITTED_BY", "FREEZES", "ASSESSES"]),
    "ve_claims": dict(
        title="View E - Claims, evidence and countersigns",
        home=["CLAIM", "CLAIM_EVIDENCE"],
        rels=["FILES", "CLAIMED_IN", "CLAIM_FOR", "BACKED_BY", "CITES_CONTRIB", "CITES_VERSION",
              "COUNTERSIGNS"]),
}
