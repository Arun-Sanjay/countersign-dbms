"""
Hand-designed positions (inches, y grows downward) for every Component 3 ER figure.
gen_er.py reads this file; er_model.py says WHAT is drawn, this file says WHERE.

Per figure:
  ents     entity type -> centre            relpos   relationship type -> diamond centre
  home     entity types drawn with all their attributes (others are plain "stub" rectangles)
  rels     relationship types drawn (each view draws a relationship type exactly once)
  mode     "all" attributes, or "keys" (key / partial-key attributes only)
  anchors  "REL.i" -> (side, fraction): fixes where line i of REL meets the entity
  dvertex  "REL.i" -> n|s|e|w: the line leaves the diamond at that vertex (recursive SUBSKILL_OF)
  attr_dir owner -> preferred direction (degrees, 0 = right, 90 = down) for its attribute ovals
  ent_w    wider rectangles for hub entity types, so their lines leave at separate points
"""
import sys

sys.path.insert(0, ".")
from er_model import VIEWS, RELS, ENTITIES  # noqa: E402

VIEW_FONTS = dict(ent=19, rel=15, att=16, lbl=18)


def view(key, ents, relpos, **kw):
    v = VIEWS[key]
    d = dict(title=v["title"], home=v["home"], rels=v["rels"], mode="all", ents=ents, relpos=relpos,
             fonts=VIEW_FONTS, title_size=24)
    d.update(kw)
    return d


FIGS = {}

# ---------------------------------------------------------------- View A: academic structure
FIGS["er_va_academic"] = view(
    "va_academic",
    ents={"ACADEMIC_TERM": (2.6, 1.6), "FACULTY": (10.4, 1.6),
          "COURSE_OFFERING": (2.6, 6.6), "COURSE": (10.4, 6.6),
          "PROJECT": (6.5, 11.2), "STUDENT": (1.3, 15.2), "TEAM": (6.5, 15.2)},
    relpos={"SCHEDULED_IN": (2.6, 4.1), "TEACHES": (6.5, 4.1), "COORDINATES": (10.4, 4.1),
            "OFFERED_AS": (6.5, 6.6), "RUNS_IN": (4.2, 9.0), "HAS_PROJECT": (8.8, 9.0),
            "ENROLLS": (1.3, 11.2), "HAS_TEAM": (6.5, 13.3)},
    attr_dir={"ACADEMIC_TERM": 270, "FACULTY": 270, "COURSE": 30, "COURSE_OFFERING": 200,
              "PROJECT": 20, "ENROLLS": 0},
)

# ---------------------------------------------------------------- View B: students, teams, skills, contributions
FIGS["er_vb_students"] = view(
    "vb_students",
    ents={"SKILL": (4.4, 2.4), "PROJECT": (11.4, 2.4), "STUDENT": (4.4, 10.0), "TEAM": (10.4, 7.2),
          "CONTRIBUTION": (4.0, 15.6), "ARTIFACT": (10.8, 17.6)},
    relpos={"REQUIRES": (8.0, 2.4), "SUBSKILL_OF": (4.4, 5.0), "HAS_SKILL": (0.8, 3.9),
            "MEMBER_OF": (7.7, 8.8), "MAKES": (4.2, 12.8), "CONTRIBUTES_TO": (7.6, 16.6)},
    ent_w={"SKILL": 3.0},
    anchors={"SUBSKILL_OF.0": ("s", 0.10), "SUBSKILL_OF.1": ("s", 0.90), "HAS_SKILL.1": ("w", 0.5)},
    dvertex={"SUBSKILL_OF.0": "w", "SUBSKILL_OF.1": "e"},
    attr_dir={"SKILL": 270, "STUDENT": 180, "TEAM": 0, "HAS_SKILL": 180, "MEMBER_OF": 90,
              "CONTRIBUTION": 150, "REQUIRES": 90},
)

# ---------------------------------------------------------------- View C: artifacts, versions, chunks
FIGS["er_vc_work"] = view(
    "vc_work",
    ents={"TEAM": (2.4, 0.9), "MILESTONE": (9.6, 0.9), "ARTIFACT": (6.0, 5.4),
          "ARTIFACT_CHUNK": (2.6, 10.4), "ARTIFACT_VERSION": (9.4, 10.4), "STUDENT": (6.0, 15.8)},
    relpos={"PRODUCES": (3.4, 3.0), "FILED_UNDER": (8.6, 3.0), "CHUNKED_INTO": (2.6, 7.6),
            "HAS_VERSION": (9.4, 7.6), "OWNS": (6.0, 10.6), "AUTHORS": (2.6, 13.6), "CREATES": (9.4, 13.6)},
    ent_w={"STUDENT": 9.0},
    attr_dir={"ARTIFACT_CHUNK": 180, "ARTIFACT_VERSION": 0},
    attr_pos={"ARTIFACT_CHUNK.tsv": (-1.7, 1.35)},
)

# ---------------------------------------------------------------- View D: submissions and assessment
FIGS["er_vd_assessment"] = view(
    "vd_assessment",
    ents={"PROJECT": (3.0, 0.9), "TEAM": (10.6, 0.9), "MILESTONE": (3.0, 5.6), "SUBMISSION": (10.6, 5.6),
          "ARTIFACT_VERSION": (10.8, 13.6), "STUDENT": (6.6, 13.6), "FACULTY": (1.4, 13.6)},
    relpos={"HAS_MILESTONE": (3.0, 3.1), "SUBMITS": (10.6, 3.1), "SUBMITTED_FOR": (6.8, 5.6),
            "SUBMITTED_BY": (8.1, 9.4), "FREEZES": (11.6, 9.4), "ASSESSES": (3.6, 10.4)},
    attr_dir={"MILESTONE": 150, "SUBMISSION": 300, "ASSESSES": 180},
)

# ---------------------------------------------------------------- View E: claims
FIGS["er_ve_claims"] = view(
    "ve_claims",
    ents={"TEAM": (3.4, 1.0), "MILESTONE": (11.6, 1.0), "STUDENT": (1.4, 6.6), "CLAIM": (7.8, 6.6),
          "CLAIM_EVIDENCE": (7.8, 11.8), "CONTRIBUTION": (3.0, 15.6), "ARTIFACT_VERSION": (11.8, 15.6)},
    relpos={"CLAIMED_IN": (5.0, 3.4), "CLAIM_FOR": (10.4, 3.4), "FILES": (4.4, 6.6),
            "COUNTERSIGNS": (4.4, 9.0), "BACKED_BY": (7.8, 9.3), "CITES_CONTRIB": (4.4, 13.6),
            "CITES_VERSION": (10.8, 13.6)},
    attr_dir={"CLAIM": 0, "CLAIM_EVIDENCE": 0, "COUNTERSIGNS": 225},
)


# ---------------------------------------------------------------- Overview: every entity and relationship type
OV_FONTS = dict(ent=19, rel=15, att=16, lbl=18)
FIGS["er_core_overview"] = dict(
    title="Countersign: core conceptual ER schema - 16 entity types, 34 relationship types (key attributes only)",
    home=list(ENTITIES), rels=list(RELS), mode="keys", fonts=OV_FONTS, title_size=22,
    ents={
        "ACADEMIC_TERM": (2.1, 2.1),
        "COURSE_OFFERING": (10.7, 2.1),
        "COURSE": (18.6, 2.1),
        "FACULTY": (27.4, 2.1),
        "SKILL": (6.0, 6.5),
        "PROJECT": (15.9, 4.1),
        "ARTIFACT": (8.9, 9.0),
        "TEAM": (16.2, 9.7),
        "SUBMISSION": (21.7, 10.1),
        "MILESTONE": (26.7, 7.0),
        "ARTIFACT_CHUNK": (6.0, 13.9),
        "CONTRIBUTION": (8.0, 15.9),
        "ARTIFACT_VERSION": (15.4, 12.8),
        "CLAIM": (26.2, 11.6),
        "CLAIM_EVIDENCE": (14.3, 18.2),
        "STUDENT": (14.9, 19.7)},
    relpos={
        "SCHEDULED_IN": (6.2, 2.1),
        "OFFERED_AS": (15.1, 2.1),
        "COORDINATES": (22.9, 2.1),
        "TEACHES": (18.8, 0.4),
        "RUNS_IN": (12.6, 3.5),
        "HAS_PROJECT": (19.4, 3.7),
        "REQUIRES": (12.1, 6.4),
        "SUBSKILL_OF": (6.0, 9.0),
        "ENROLLS": (0.7, 4.6),
        "HAS_SKILL": (2.6, 7.7),
        "HAS_TEAM": (14.8, 6.7),
        "HAS_MILESTONE": (22.4, 6.0),
        "FILED_UNDER": (19.9, 7.5),
        "PRODUCES": (13.1, 10.1),
        "SUBMITS": (18.9, 9.0),
        "SUBMITTED_FOR": (24.2, 8.5),
        "CLAIMED_IN": (23.0, 12.2),
        "CLAIM_FOR": (26.7, 9.5),
        "CHUNKED_INTO": (6.7, 10.9),
        "CONTRIBUTES_TO": (8.1, 12.3),
        "HAS_VERSION": (12.0, 11.2),
        "OWNS": (11.5, 16.7),
        "AUTHORS": (4.0, 11.6),
        "MAKES": (4.7, 16.8),
        "CREATES": (16.7, 15.6),
        "MEMBER_OF": (18.8, 13.8),
        "SUBMITTED_BY": (20.9, 16.5),
        "FREEZES": (20.2, 11.8),
        "BACKED_BY": (24.4, 14.0),
        "CITES_VERSION": (13.6, 15.0),
        "CITES_CONTRIB": (9.5, 18.4),
        "FILES": (25.0, 16.8),
        "COUNTERSIGNS": (27.2, 16.4),
        "ASSESSES": (30.2, 14.6)},
    ent_w={"STUDENT": 27.0, "SKILL": 2.8},
    fixed=["ACADEMIC_TERM", "COURSE_OFFERING", "COURSE", "FACULTY", "SCHEDULED_IN", "OFFERED_AS", "COORDINATES",
           "TEACHES", "STUDENT", "SKILL", "SUBSKILL_OF", "ENROLLS"],
    anchors={"SUBSKILL_OF.0": ("s", 0.10), "SUBSKILL_OF.1": ("s", 0.90), "HAS_SKILL.1": ("w", 0.5),
             "ENROLLS.0": ("n", 0.006), "ASSESSES.1": ("e", 0.5)},
    dvertex={"SUBSKILL_OF.0": "w", "SUBSKILL_OF.1": "e"},
)
