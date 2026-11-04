#!/usr/bin/env python3
"""
Single source of truth for the Component 5 DFDs (Level 0, Level 1, Level 2 of 4.0 and 5.0).

Notation: Gane-Sarson (Gane and Sarson, 1979).
  * process         -> rounded rectangle: top band = process number, middle = name (verb phrase),
                       bottom band = mechanism (RPC / trigger / view / script that realises it)
  * data store      -> open-ended rectangle, left compartment = store id (D1 ...);
                       a repeated store carries an extra vertical bar at its left end
  * external entity -> shaded rectangle; a repeated entity carries a diagonal stroke in its
                       lower-right corner
  * data flow       -> labelled arrow. A two-headed arrow between a process and a store stands
                       for TWO flows (one read, one write) that share one label.
  * planned element -> dashed outline / dashed arrow, label marked [planned]

Running this script:
  1. writes the Graphviz sources  ../dot/*.dot
  2. writes the generated Markdown tables  ../generated/*.md
  3. runs the DFD construction-rule, naming and balancing checks, and exits non-zero on any
     violation.

Everything (diagrams, flow tables, balancing tables, access matrix) is generated from the lists
below, so a diagram and its tables cannot disagree.

Sources of every element: supabase/migrations/2026110400000{2,3,4}_*.sql (tables, RLS policies,
column grants, triggers, RPCs, views), mongo/validators.js, mongo/portfolio_merge.js,
api/app/{main,notes,consistency,export_pg}.py.
"""
import math
import os
import re
import sys
import textwrap
from collections import OrderedDict, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
DOT_DIR = os.path.join(HERE, "..", "dot")
GEN_DIR = os.path.join(HERE, "..", "generated")

# ---------------------------------------------------------------------------------------
# Typography (points). Edge labels >= 14 pt and node text >= 16 pt, as required for print.
# ---------------------------------------------------------------------------------------
EDGE_FONT = 14
NODE_FONT = 16
TITLE_FONT = 20
LINE = 18          # height of one 14-pt label line
GAP = 14           # vertical gap between neighbouring node groups

BLUE, GREEN, VIOLET = "#1f3b73", "#2f6f3e", "#7a2fb0"

# ---------------------------------------------------------------------------------------
# External entities (sources / sinks)
# ---------------------------------------------------------------------------------------
EXT = OrderedDict([
    ("STU", "Student"),
    ("FAC", "Faculty"),
    ("ADM", "College Admin"),
    ("GH",  "GitHub\n(team repository)"),
    ("OBS", "Obsidian vault\n(in team\nrepository)"),
    ("AI",  "AI model\nservices (Claude\nAPI, Voyage AI)"),
])
ENT_ORDER = {c: i for i, c in enumerate(["ADM", "GH", "OBS", "STU", "FAC", "AI"])}

# ---------------------------------------------------------------------------------------
# Data stores: id -> (name, engine, [actual tables / collections])
# ---------------------------------------------------------------------------------------
STORES = OrderedDict([
    ("D1",  ("Directory and enrollment", "PostgreSQL",
             ["student", "faculty", "course", "academic_term", "course_offering", "enrollment",
              "app_user"])),
    ("D2",  ("Projects and components", "PostgreSQL", ["project", "milestone"])),
    ("D3",  ("Teams", "PostgreSQL", ["team", "team_member"])),
    ("D4",  ("Work record", "PostgreSQL", ["artifact", "artifact_version", "contribution"])),
    ("D5",  ("Text chunks", "PostgreSQL", ["artifact_chunk"])),
    ("D6",  ("Claims", "PostgreSQL", ["claim", "claim_evidence", "countersign"])),
    ("D7",  ("Submissions", "PostgreSQL", ["submission", "submission_artifact"])),
    ("D8",  ("Assessments", "PostgreSQL", ["assessment"])),
    ("D9",  ("Skill graph", "PostgreSQL",
             ["skill", "student_skill", "project_skill", "course_skill", "skill_evidence"])),
    ("D10", ("Private vault", "PostgreSQL", ["private.note"])),
    ("D11", ("Raw GitHub events", "MongoDB", ["github_events"])),
    ("D12", ("Notes", "MongoDB", ["notes"])),
    ("D13", ("Note versions", "MongoDB", ["note_versions"])),
    ("D14", ("Portfolios", "MongoDB", ["portfolios"])),
])

# ---------------------------------------------------------------------------------------
# Level 1 processes: id -> (name, mechanism, FRs (C2_SRS numbering), status)
#   status: implemented | partial | planned
# ---------------------------------------------------------------------------------------
P1 = OrderedDict([
    ("1.0", ("Manage directory\nand enrollment",
             "admin writes under RLS;\nsemester_hub(), v_semester_hub", ["FR1", "FR2", "FR3"], "implemented")),
    ("2.0", ("Form teams", "join_team(), leave_team();\ntrg_team_member_history_guard", ["FR4"], "implemented")),
    ("3.0", ("Capture work\nand evidence",
             "editor saves under RLS; private-note RPCs;\nAPI /notes, /consistency;\nwebhook worker [planned]",
             ["FR5", "FR11"], "partial")),
    ("4.0", ("File and countersign\nclaims", "file_claim(), add_claim_evidence(),\ncountersign_claim(); claim policies",
             ["FR6", "FR7"], "implemented")),
    ("5.0", ("Submit and assess\ncomponents", "submit_milestone(), record_assessment(),\nlock_milestone(); rubric views",
             ["FR7", "FR2"], "implemented")),
    ("6.0", ("Maintain skills and\nrecommend teammates", "find_teammates(), find_full_cover(),\nskill_gap(), skill_subtree()",
             ["FR8", "FR4"], "partial")),
    ("7.0", ("Answer questions\nwith citations", "search_chunks(), /rag/ask\n[planned]", ["FR9"], "planned")),
    ("8.0", ("Build portfolio", "export_pg.py + portfolio_merge.js\n(admin-run batch); v_what_faculty_sees",
             ["FR10", "FR7", "FR11"], "partial")),
])

# Controlled verb list for the naming rule "a process is named by a verb phrase".
VERBS = {"manage", "form", "capture", "file", "submit", "maintain", "answer", "build", "attach",
         "record", "derive", "compile", "compute", "lock", "amend", "withdraw", "remove"}

# ---------------------------------------------------------------------------------------
# Level 0 (context) flows: id -> (src, dst, label). src/dst = entity code or "SYS".
# Each is a COMPOSITE flow; its components are the Level 1 flows that name it as parent.
# A composite is planned exactly when all its components are planned (checked).
# ---------------------------------------------------------------------------------------
L0 = OrderedDict([
    ("C01", ("STU", "SYS", "team join / leave requests")),
    ("C02", ("STU", "SYS", "authored work, team notes\nand private notes")),
    ("C03", ("STU", "SYS", "claims, evidence and verdicts\n(incl. amendments, withdrawals)")),
    ("C04", ("STU", "SYS", "component submissions")),
    ("C05", ("STU", "SYS", "declared skills, matching queries\nand preview requests")),
    ("C06", ("STU", "SYS", "questions and portfolio\nexport requests")),
    ("C07", ("SYS", "STU", "semester hub and\nmembership results")),
    ("C08", ("SYS", "STU", "version history, team notes,\nown private notes, consistency report")),
    ("C09", ("SYS", "STU", "claim receipts, status\nand countersign queue")),
    ("C10", ("SYS", "STU", "submission receipts,\nown marks and lab CIE")),
    ("C11", ("SYS", "STU", "teammate suggestions, skill gap\nand faculty-view preview")),
    ("C12", ("SYS", "STU", "cited answers and\nportfolio export")),
    ("C13", ("FAC", "SYS", "marks entries and\ncomponent locks")),
    ("C14", ("FAC", "SYS", "questions")),
    ("C15", ("SYS", "FAC", "rubric sheet, progress, lab CIE,\nreceipts and lock summaries")),
    ("C16", ("SYS", "FAC", "submitted work")),
    ("C17", ("SYS", "FAC", "contested claims\nand claim trail")),
    ("C18", ("SYS", "FAC", "taught offerings and\nproject summaries")),
    ("C19", ("SYS", "FAC", "cited answers")),
    ("C20", ("ADM", "SYS", "directory, term and\nenrollment records")),
    ("C21", ("ADM", "SYS", "project, component\nand team definitions")),
    ("C22", ("ADM", "SYS", "skill taxonomy, required skills,\ncourse concepts, verified levels")),
    ("C23", ("SYS", "ADM", "directory listings\nand institution totals")),
    ("C24", ("GH",  "SYS", "push events\n(commits, authors, files)")),
    ("C25", ("OBS", "SYS", "vault notes\n(markdown + frontmatter)")),
    ("C26", ("SYS", "AI",  "text to embed and\npermission-filtered prompts")),
    ("C27", ("AI",  "SYS", "embeddings and\ndrafted cited answers")),
    ("C28", ("SYS", "FAC", "note metadata, version receipts\nand consistency report")),
    ("C29", ("ADM", "SYS", "component locks / unlocks\nand mark corrections")),
    ("C30", ("SYS", "ADM", "oversight reports\nand lock summaries")),
    ("C31", ("SYS", "ADM", "portfolio rebuild report")),
])

# ---------------------------------------------------------------------------------------
# Level 1 external flows: id -> (src, dst, label, parent L0 flow, planned)
# ---------------------------------------------------------------------------------------
F1 = OrderedDict([
    ("F01", ("ADM", "1.0", "directory records\n(student, faculty, course)", "C20", False)),
    ("F02", ("ADM", "1.0", "term, offering and\nenrollment records", "C20", False)),
    ("F03", ("ADM", "1.0", "user-role mappings", "C20", False)),
    ("F04", ("ADM", "1.0", "project and component\ndefinitions", "C21", False)),
    ("F05", ("1.0", "ADM", "directory listings\nand totals", "C23", False)),
    ("F06", ("1.0", "STU", "semester hub", "C07", False)),
    ("F07", ("1.0", "FAC", "taught offerings and\nproject summaries", "C18", False)),
    ("F08", ("ADM", "2.0", "team definitions\nand placements", "C21", False)),
    ("F09", ("STU", "2.0", "join / leave request", "C01", False)),
    ("F10", ("2.0", "STU", "membership result", "C07", False)),
    ("F11", ("GH",  "3.0", "push event", "C24", True)),
    ("F12", ("OBS", "3.0", "vault note commit", "C25", True)),
    ("F13", ("STU", "3.0", "artifact, version or link\n(+ AI-assistance)", "C02", False)),
    ("F47", ("STU", "3.0", "team note\n(title, content, status)", "C02", False)),
    ("F14", ("STU", "3.0", "private note", "C02", False)),
    ("F15", ("3.0", "STU", "version history and\nown private notes", "C08", False)),
    ("F48", ("3.0", "STU", "team notes and\nconsistency report", "C08", False)),
    ("F49", ("3.0", "FAC", "final-note metadata, version\nreceipts, consistency report", "C28", False)),
    ("F16", ("3.0", "AI",  "chunk text", "C26", True)),
    ("F17", ("AI",  "3.0", "chunk embeddings", "C27", True)),
    ("F18", ("STU", "4.0", "claim, amendment\nor withdrawal", "C03", False)),
    ("F19", ("STU", "4.0", "evidence reference\nor removal", "C03", False)),
    ("F20", ("STU", "4.0", "verdict or\nverdict withdrawal", "C03", False)),
    ("F21", ("4.0", "STU", "claim receipts\nand status", "C09", False)),
    ("F22", ("4.0", "STU", "countersign queue", "C09", False)),
    ("F23", ("4.0", "FAC", "contested claims\nand claim trail", "C17", False)),
    ("F50", ("4.0", "ADM", "contested claims\nand claim trail", "C30", False)),
    ("F24", ("STU", "5.0", "submission request", "C04", False)),
    ("F25", ("5.0", "STU", "submission receipt", "C10", False)),
    ("F26", ("5.0", "STU", "own marks and lab CIE", "C10", False)),
    ("F27", ("FAC", "5.0", "marks entry", "C13", False)),
    ("F28", ("FAC", "5.0", "component lock", "C13", False)),
    ("F29", ("5.0", "FAC", "assessment receipt\nand lock summary", "C15", False)),
    ("F30", ("5.0", "FAC", "rubric sheet and\nteam progress", "C15", False)),
    ("F31", ("5.0", "FAC", "submitted work", "C16", False)),
    ("F32", ("5.0", "FAC", "class lab CIE marks", "C15", False)),
    ("F51", ("ADM", "5.0", "component lock / unlock", "C29", False)),
    ("F52", ("ADM", "5.0", "mark correction\n(insert, update, delete)", "C29", False)),
    ("F53", ("5.0", "ADM", "component-lock summary", "C30", False)),
    ("F54", ("5.0", "ADM", "rubric sheet, progress,\nsubmitted work, lab CIE", "C30", False)),
    ("F33", ("ADM", "6.0", "skill taxonomy, required skills,\ncourse concepts, verified levels", "C22", False)),
    ("F34", ("STU", "6.0", "declared skill levels", "C05", False)),
    ("F35", ("STU", "6.0", "teammate /\nskill-gap query", "C05", False)),
    ("F36", ("6.0", "STU", "teammate suggestions\nand skill gap", "C11", False)),
    ("F37", ("STU", "7.0", "question", "C06", True)),
    ("F38", ("FAC", "7.0", "question", "C14", True)),
    ("F39", ("7.0", "STU", "cited answer", "C12", True)),
    ("F40", ("7.0", "FAC", "cited answer", "C19", True)),
    ("F41", ("7.0", "AI",  "question and permitted\nchunks (prompt)", "C26", True)),
    ("F42", ("AI",  "7.0", "query embedding and\ncited draft answer", "C27", True)),
    ("F43", ("STU", "8.0", "portfolio export request", "C06", True)),
    ("F44", ("8.0", "STU", "portfolio export", "C12", True)),
    ("F46", ("STU", "8.0", "faculty-view\npreview request", "C05", False)),
    ("F45", ("8.0", "STU", "faculty-view preview", "C11", False)),
    ("F55", ("8.0", "ADM", "portfolio rebuild report\n(students exported, stamped)", "C31", False)),
])

# ---------------------------------------------------------------------------------------
# Level 1 store flows: (id, process, store, mode, label, planned)
#   R  : store -> process (read)
#   W  : process -> store (insert / update / delete)
#   A  : process -> store, append only (insert; rows are never updated or deleted)
#   RW : two flows, read + write          (two-headed arrow)
#   RA : two flows, read + write (append) (two-headed arrow)
# app_user is read by EVERY process through the RLS helpers (app.current_usn() ...);
# that implicit read is stated once in the text and not repeated on every diagram.
# ---------------------------------------------------------------------------------------
S1 = [
    # 1.0 Manage directory and enrollment
    ("S01", "1.0", "D1", "RW", "student, faculty, course, academic_term,\ncourse_offering, enrollment, app_user", False),
    ("S02", "1.0", "D2", "RW", "project, milestone\n(definitions, next deadline)", False),
    ("S03", "1.0", "D3", "R",  "team, team_member", False),
    ("S04", "1.0", "D4", "R",  "artifact, artifact_version, contribution\n(counts for the faculty hub)", False),
    ("S05", "1.0", "D6", "R",  "claim (status counts)", False),
    ("S06", "1.0", "D7", "R",  "submission (counts\nfor the faculty hub)", False),
    # 2.0 Form teams
    ("S07", "2.0", "D1", "R",  "enrollment", False),
    ("S08", "2.0", "D2", "R",  "project (offering_id)", False),
    ("S09", "2.0", "D3", "RW", "team, team_member", False),
    ("S10", "2.0", "D4", "R",  "artifact.owner_usn, contribution.usn,\nartifact_version.created_by", False),
    ("S11", "2.0", "D5", "R",  "artifact_chunk.author_usn", False),
    ("S12", "2.0", "D6", "R",  "claim.usn,\ncountersign.endorser_usn", False),
    ("S13", "2.0", "D7", "R",  "submission.submitted_by", False),
    ("S14", "2.0", "D8", "R",  "assessment.usn", False),
    # 3.0 Capture work and evidence
    ("S15", "3.0", "D2", "R",  "milestone\n(component of an artifact)", False),
    ("S16", "3.0", "D3", "R",  "team, team_member\n(membership, visible teams)", False),
    ("S17", "3.0", "D4", "RW", "artifact (title, visibility, owner)", False),
    ("S18", "3.0", "D4", "RA", "artifact_version, contribution", False),
    ("S19", "3.0", "D5", "A",  "artifact_chunk (content;\nembedding [planned])", False),
    ("S20", "3.0", "D10", "RW", "private.note (owner only)", False),
    ("S21", "3.0", "D11", "R",  "github_events\n(commit SHAs per author)", False),
    ("S22", "3.0", "D11", "A",  "github_events (raw push)", True),
    ("S23", "3.0", "D12", "RW", "notes", False),
    ("S24", "3.0", "D13", "RA", "note_versions", False),
    # 4.0 File and countersign claims
    ("S25", "4.0", "D1", "R",  "student (names)", False),
    ("S26", "4.0", "D2", "R",  "milestone (locked_at, title)", False),
    ("S27", "4.0", "D3", "R",  "team, team_member", False),
    ("S28", "4.0", "D4", "R",  "artifact, artifact_version,\ncontribution", False),
    ("S29", "4.0", "D6", "RW", "claim, claim_evidence,\ncountersign", False),
    # 5.0 Submit and assess components
    ("S30", "5.0", "D1", "R",  "student, course,\ncourse_offering (teacher)", False),
    ("S31", "5.0", "D2", "RW", "milestone (max_marks,\ncie_part, locked_at)", False),
    ("S32", "5.0", "D3", "R",  "team, team_member", False),
    ("S33", "5.0", "D4", "RW", "artifact.visibility,\nartifact_version.version_no", False),
    ("S34", "5.0", "D5", "RW", "artifact_chunk\n(visibility, submitted text)", False),
    ("S35", "5.0", "D6", "R",  "claim (status counts)", False),
    ("S36", "5.0", "D7", "RA", "submission,\nsubmission_artifact", False),
    ("S37", "5.0", "D8", "RW", "assessment", False),
    # 6.0 Maintain skills and recommend teammates
    ("S38", "6.0", "D1", "R",  "student, enrollment\n(is_eligible_for_project)", False),
    ("S39", "6.0", "D2", "R",  "project", False),
    ("S40", "6.0", "D3", "R",  "team, team_member", False),
    ("S41", "6.0", "D9", "R",  "skill (recursive), student_skill,\nproject_skill, skill_evidence", False),
    ("S42", "6.0", "D9", "W",  "student_skill (own); skill, project_skill,\ncourse_skill, skill_evidence (admin, F33)", False),
    ("S43", "6.0", "D4", "R",  "contribution (to derive\nskill_evidence)", True),
    ("S44", "6.0", "D6", "R",  "claim, confirmed (to derive\nskill_evidence)", True),
    # 7.0 Answer questions with citations (planned)
    ("S45", "7.0", "D4", "R",  "artifact (citation metadata)", True),
    ("S46", "7.0", "D5", "R",  "artifact_chunk (tsv, embedding),\nRLS-filtered", True),
    ("S47", "7.0", "D6", "R",  "claim (confirmed)", True),
    # 8.0 Build portfolio
    ("S48", "8.0", "D1", "R",  "student (name, semester)", False),
    ("S49", "8.0", "D2", "R",  "project (title, status);\nmilestone (preview)", False),
    ("S50", "8.0", "D3", "R",  "team_member (role), team", False),
    ("S51", "8.0", "D4", "R",  "artifact, artifact_version,\ncontribution (preview F45 only)", False),
    ("S52", "8.0", "D5", "R",  "artifact_chunk, submitted\n(preview F45 only)", False),
    ("S53", "8.0", "D6", "R",  "claim (status counts;\nown claims for the preview)", False),
    ("S54", "8.0", "D8", "R",  "assessment\n(preview F45 only)", False),
    ("S55", "8.0", "D9", "R",  "project_skill, skill.name", False),
    ("S56", "8.0", "D11", "R", "github_events\n(commits, additions per author)", False),
    ("S57", "8.0", "D12", "R", "notes (authored, final, teams)", False),
    ("S58", "8.0", "D13", "R", "note_versions (versions authored)", False),
    ("S59", "8.0", "D14", "RW", "portfolios ($merge on usn)", False),
]

# Store local to one process: written and read only inside 8.0, so it belongs to the
# decomposition of 8.0 and is not drawn at Level 1 (documented in the catalogue).
LOCAL_STORES = [("pg_portfolio_export", "MongoDB", "8.0",
                 "written by app/export_pg.py, read by portfolio_merge.js ($unionWith)")]

# ---------------------------------------------------------------------------------------
# Level 2 of 4.0 File and countersign claims
#   P2: id -> (name, mechanism)
#   F2: id -> (src, dst, label, parent L1 flow, planned)
#   I2: id -> (src, dst, label)            internal flows between sub-processes
#   S2: (process, store, mode, label, planned)
# ---------------------------------------------------------------------------------------
P2_4 = OrderedDict([
    ("4.1", ("File, amend and\nwithdraw claims",
             "file_claim(); claim UPDATE / DELETE policies\n(pending only); trg_claim_guard")),
    ("4.2", ("Attach and\nremove evidence",
             "add_claim_evidence(); claim_evidence_delete;\ntrg_claim_evidence_check, _revision")),
    ("4.3", ("Record and\nwithdraw verdicts",
             "countersign_claim(); countersign_delete;\ntrg_countersign_check")),
    ("4.4", ("Derive claim status",
             "trg_countersign_sync_status,\ntrg_claim_status_derived")),
    ("4.5", ("Build claim queues\nand trails",
             "semester_hub() count; v_contested_claims\n(counts only); claim, claim_evidence,\ncountersign rows read under RLS")),
])
F2_4 = OrderedDict([
    ("F18.1", ("STU", "4.1", "claim (component, type,\nstatement, AI-assistance)", "F18", False)),
    ("F18.2", ("STU", "4.1", "claim amendment\n(statement, type, component)", "F18", False)),
    ("F18.3", ("STU", "4.1", "claim withdrawal (claim_id)", "F18", False)),
    ("F21.1", ("4.1", "STU", "claim receipt\n(claim_id, status)", "F21", False)),
    ("F19.1", ("STU", "4.2", "evidence reference\n(kind, ref, note)", "F19", False)),
    ("F19.2", ("STU", "4.2", "evidence removal\n(claim_id, evidence_no)", "F19", False)),
    ("F21.2", ("4.2", "STU", "evidence receipt\n(evidence_no)", "F21", False)),
    ("F20.1", ("STU", "4.3", "countersign verdict\n(verdict, comment, revision read)", "F20", False)),
    ("F20.2", ("STU", "4.3", "verdict withdrawal (claim_id)", "F20", False)),
    ("F21.4", ("4.3", "STU", "verdict receipt\n(verdict, claim status)", "F21", False)),
    ("F21.3", ("4.4", "STU", "claim status\n(pending / confirmed / contested)", "F21", False)),
    ("F22",   ("4.5", "STU", "countersign queue\n(count + claims to sign)", "F22", False)),
    ("F23.1", ("4.5", "FAC", "contested-claim queue\n(statement, counts)", "F23", False)),
    ("F23.2", ("4.5", "FAC", "claim trail (evidence,\nverdicts, comments)", "F23", False)),
    ("F50.1", ("4.5", "ADM", "contested-claim queue\n(statement, counts)", "F50", False)),
    ("F50.2", ("4.5", "ADM", "claim trail (evidence,\nverdicts, comments)", "F50", False)),
])
I2_4 = OrderedDict([
    ("I4.1", ("4.3", "4.4", "verdict change (claim_id)")),
])
S2_4 = [
    ("4.1", "D2", "R",  "milestone.locked_at", False),
    ("4.1", "D3", "R",  "team_member (derive team)", False),
    ("4.1", "D4", "R",  "artifact, artifact_version\n(latest version_no)", False),
    ("4.1", "D6", "RW", "claim (insert, update, delete);\nclaim_evidence #1", False),
    ("4.2", "D2", "R",  "milestone.locked_at", False),
    ("4.2", "D4", "R",  "contribution (own),\nartifact_version (same team)", False),
    ("4.2", "D6", "RW", "claim (row lock, revision + 1);\nclaim_evidence (insert, delete)", False),
    ("4.3", "D2", "R",  "milestone.locked_at", False),
    ("4.3", "D3", "R",  "team_member (teammate check)", False),
    ("4.3", "D6", "RW", "claim (revision, claimant);\ncountersign (upsert, delete)", False),
    ("4.4", "D6", "RW", "countersign.verdict;\nclaim.status", False),
    ("4.5", "D1", "R",  "student (names)", False),
    ("4.5", "D2", "R",  "milestone (title)", False),
    ("4.5", "D3", "R",  "team (team_name)", False),
    ("4.5", "D6", "R",  "claim, claim_evidence,\ncountersign", False),
]

# ---------------------------------------------------------------------------------------
# Level 2 of 5.0 Submit and assess components
# ---------------------------------------------------------------------------------------
P2_5 = OrderedDict([
    ("5.1", ("Submit component", "submit_milestone();\ntrg_submission_open,\ntrg_artifact_chunk_visibility_sync")),
    ("5.2", ("Record marks", "record_assessment() (faculty);\nassessment policies (admin);\ntrg_assessment_check")),
    ("5.3", ("Lock and unlock\ncomponents", "lock_milestone(); milestone_update\n(admin unlock);\ntrg_milestone_faculty_lock_only")),
    ("5.4", ("Compile rubric sheet\nand team progress", "v_rubric_sheet,\nv_faculty_team_progress;\nartifact_chunk under RLS")),
    ("5.5", ("Compute lab CIE marks", "v_lab_cie_marks\n(120 -> 30) + 10 + 10")),
])
F2_5 = OrderedDict([
    ("F24",   ("STU", "5.1", "submission request\n(team, component, artifact ids)", "F24", False)),
    ("F25",   ("5.1", "STU", "submission receipt\n(attempt_no, frozen versions)", "F25", False)),
    ("F27",   ("FAC", "5.2", "marks entry\n(usn, component, marks, remarks)", "F27", False)),
    ("F29.1", ("5.2", "FAC", "assessment receipt", "F29", False)),
    ("F52",   ("ADM", "5.2", "mark correction\n(insert, update, delete)", "F52", False)),
    ("F28",   ("FAC", "5.3", "component lock\n(project, component)", "F28", False)),
    ("F51",   ("ADM", "5.3", "component lock / unlock\n(project, component)", "F51", False)),
    ("F29.2", ("5.3", "FAC", "component-lock summary\n(marked / unmarked)", "F29", False)),
    ("F53",   ("5.3", "ADM", "component-lock summary\n(marked / unmarked)", "F53", False)),
    ("F30",   ("5.4", "FAC", "rubric sheet and\nteam progress (metadata)", "F30", False)),
    ("F31",   ("5.4", "FAC", "submitted work\n(submitted tier only)", "F31", False)),
    ("F54.1", ("5.4", "ADM", "rubric sheet, progress\nand submitted work", "F54", False)),
    ("F26",   ("5.5", "STU", "own marks and\nlab CIE (/50)", "F26", False)),
    ("F32",   ("5.5", "FAC", "class lab CIE marks", "F32", False)),
    ("F54.2", ("5.5", "ADM", "lab CIE marks\n(all projects)", "F54", False)),
])
I2_5 = OrderedDict()
S2_5 = [
    ("5.1", "D2", "R",  "milestone.locked_at", False),
    ("5.1", "D3", "R",  "team_member (submitter)", False),
    ("5.1", "D4", "RW", "artifact.visibility -> submitted;\nmax(artifact_version.version_no)", False),
    ("5.1", "D5", "W",  "artifact_chunk.visibility\n-> submitted", False),
    ("5.1", "D7", "RA", "submission (attempt_no),\nsubmission_artifact", False),
    ("5.2", "D1", "R",  "course_offering, course\n(teaching faculty)", False),
    ("5.2", "D2", "R",  "milestone (max_marks,\nlocked_at)", False),
    ("5.2", "D3", "R",  "team_member (assessed student)", False),
    ("5.2", "D8", "RW", "assessment (upsert;\nadmin delete)", False),
    ("5.3", "D1", "R",  "course_offering\n(teaching faculty)", False),
    ("5.3", "D2", "RW", "milestone.locked_at", False),
    ("5.3", "D3", "R",  "team_member (count)", False),
    ("5.3", "D8", "R",  "assessment (count)", False),
    ("5.4", "D1", "R",  "student", False),
    ("5.4", "D2", "R",  "milestone", False),
    ("5.4", "D3", "R",  "team, team_member", False),
    ("5.4", "D4", "R",  "artifact, artifact_version,\ncontribution (counts)", False),
    ("5.4", "D5", "R",  "artifact_chunk\n(submitted only)", False),
    ("5.4", "D6", "R",  "claim (status counts)", False),
    ("5.4", "D7", "R",  "submission", False),
    ("5.4", "D8", "R",  "assessment", False),
    ("5.5", "D1", "R",  "student", False),
    ("5.5", "D2", "R",  "milestone\n(cie_part, max_marks)", False),
    ("5.5", "D3", "R",  "team, team_member", False),
    ("5.5", "D8", "R",  "assessment", False),
]


# =======================================================================================
# Graphviz helpers (Gane-Sarson shapes as HTML-like labels, with one port per flow so that
# every arrow has its own attachment point and its own label row)
# =======================================================================================
def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def html_lines(s):
    return "<br/>".join(esc(x) for x in s.split("\n"))


WRAP = 27
L0_WRAP = 44
MECH_WRAP = 30


def flow_text(fid, label, planned, wrap=None):
    """Diagram text of a flow: id + name, re-wrapped to WRAP characters per line so that the
    label column stays narrow; [planned] / [append] markers are merged into one bracket."""
    text = " ".join(label.split("\n"))
    marks = []
    if text.endswith(" [append]"):
        text, marks = text[:-9], ["append"]
    if planned:
        marks.append("planned")
    if marks:
        text += f" [{', '.join(marks)}]"
    lines = textwrap.wrap(text, wrap or WRAP, break_on_hyphens=False, break_long_words=False)
    if fid:
        lines[0] = f"{fid}  {lines[0]}"
    return lines


def label_h(fid, label, planned, wrap=None):
    return len(flow_text(fid, label, planned, wrap)) * LINE + 8


def port_column(ports, side_total=None):
    """ports: [(port, height)]. Returns rows for a nested borderless table."""
    rows = "".join(f'<tr><td port="{p}" height="{int(h)}" width="2" fixedsize="false"></td></tr>'
                   for p, h in ports)
    return f'<table border="0" cellborder="0" cellspacing="0" cellpadding="0">{rows}</table>'


def process_node(pid, name, mech, left=(), right=(), planned=False, width=260, node_id=None):
    left, right = list(left), list(right)
    hl = sum(h for _, h in left)
    hr = sum(h for _, h in right)
    num_h = 30
    if mech:
        mech = "\n".join(l for part in mech.split("\n") for l in textwrap.wrap(part, MECH_WRAP, break_long_words=False, break_on_hyphens=False))
    mech_lines = mech.count("\n") + 1 if mech else 0
    mech_h = mech_lines * 20 + 14 if mech else 0
    name_min = (name.count("\n") + 1) * 26 + 20
    total = max(hl, hr, num_h + name_min + mech_h)
    name_h = total - num_h - mech_h

    def side(ports, h):
        if not ports:
            return f'<td rowspan="{3 if mech else 2}" width="2"></td>'
        pad = total - h
        top = [("", pad // 2)] if pad // 2 > 0 else []
        bot = [("", pad - pad // 2)] if pad - pad // 2 > 0 else []
        rows = "".join(
            (f'<tr><td port="{p}" height="{int(hh)}" width="2"></td></tr>' if p else
             f'<tr><td height="{int(hh)}" width="2"></td></tr>')
            for p, hh in top + list(ports) + bot)
        return (f'<td rowspan="{3 if mech else 2}" cellpadding="0">'
                f'<table border="0" cellborder="0" cellspacing="0" cellpadding="0">{rows}</table></td>')

    style = "rounded,dashed" if planned else "rounded"
    fill = "#f7f7f7" if planned else "#f3f6fb"
    pname = name + ("\n[planned]" if planned else "")
    rows = (f'<tr>{side(left, hl)}<td sides="b" border="1" height="{num_h}" width="{width}">'
            f'<font point-size="{NODE_FONT}"><b>{esc(pid)}</b></font></td>{side(right, hr)}</tr>'
            f'<tr><td height="{int(name_h)}"><font point-size="20"><b>{html_lines(pname)}</b></font></td></tr>')
    if mech:
        rows += (f'<tr><td sides="t" border="1" height="{mech_h}">'
                 f'<font point-size="{NODE_FONT}" color="#333333">{html_lines(mech)}</font></td></tr>')
    return (f'"{node_id or pid}" [shape=plain, label=<'
            f'<table border="1" cellborder="0" cellspacing="0" cellpadding="4" style="{style}" '
            f'bgcolor="{fill}">{rows}</table>>];')


ENT_NAME_H = 64


def ext_node(code, node_id, ports=(), side="e", duplicate=False, planned=False):
    """Shaded rectangle. ports on the east (entity left of the process) or west side.
    Duplicate: diagonal stroke in the LOWER-RIGHT corner (Gane-Sarson)."""
    ports = list(ports)
    label = EXT[code] + ("\n[planned]" if planned else "")
    lines = "<br/>".join(f"<b>{esc(x)}</b>" for x in label.split("\n"))
    name_cell = (f'<td rowspan="{max(1, len(ports)) + 1}" cellpadding="10">'
                 f'<font point-size="20">{lines}</font></td>')
    corner = (f'<td height="22" width="22" align="right" valign="bottom" cellpadding="0">'
              f'<font point-size="20">&#x2571;</font></td>') if duplicate else \
             '<td height="2" width="2"></td>'
    if not ports:
        ports = [("p0", ENT_NAME_H)]
    total = sum(h for _, h in ports)
    if total < ENT_NAME_H:
        ports = [(p, h + (ENT_NAME_H - total) / len(ports)) for p, h in ports]
    prow = [f'<td port="{p}" height="{int(h)}" width="2"></td>' for p, h in ports]
    if side == "e":
        rows = [f"<tr>{name_cell}{prow[0]}</tr>"] + [f"<tr>{c}</tr>" for c in prow[1:]] + [f"<tr>{corner}</tr>"]
    else:
        # ports west, corner column at the far right
        n = len(prow)
        rows = [f'<tr>{prow[0]}{name_cell}<td rowspan="{n}" width="2"></td></tr>'] + \
               [f"<tr>{c}</tr>" for c in prow[1:]] + [f'<tr><td height="2" width="2"></td>{corner}</tr>']
    style = ' style="dashed"' if planned else ""
    return (f'"{node_id}" [shape=plain, label=<<table border="2" cellborder="0" cellspacing="0" '
            f'cellpadding="0" bgcolor="#e3e3e3"{style}>{"".join(rows)}</table>>];')


def store_lines(sid, compact=False):
    name, engine, tables = STORES[sid]
    return name, textwrap.wrap(", ".join(tables), 30), engine


def store_h(sid):
    _n, tl, _e = store_lines(sid)
    return 24 + len(tl) * 20 + 14


def store_node(sid, node_id, ports=(), duplicate=False, compact=False, side="w"):
    name, tl, engine = store_lines(sid)
    fill = "#fff4dc" if engine == "MongoDB" else "#e9f5ea"
    if compact:
        body = f'<font point-size="20"><b>{esc(name)}</b></font>'
    else:
        body = (f'<font point-size="18"><b>{esc(name)}</b></font><br/>'
                f'<font point-size="{NODE_FONT}">{"<br/>".join(esc(x) for x in tl)}</font>')
    ports = list(ports) or [("p0", 10)]
    n = len(ports)
    dup = (f'<td rowspan="{n}" sides="ltb" border="1" width="5" bgcolor="{fill}"></td>') if duplicate else ""
    first = (f'<td port="{ports[0][0]}" height="{int(ports[0][1])}" width="2"></td>{dup}'
             f'<td rowspan="{n}" sides="ltbr" border="1" bgcolor="{fill}" cellpadding="6">'
             f'<font point-size="18"><b>{esc(sid)}</b></font></td>'
             f'<td rowspan="{n}" sides="tb" border="1" align="left" balign="left" bgcolor="{fill}" cellpadding="6">{body}</td>')
    if side == "e":
        first = (f'{dup}<td rowspan="{n}" sides="ltbr" border="1" bgcolor="{fill}" cellpadding="6">'
                 f'<font point-size="18"><b>{esc(sid)}</b></font></td>'
                 f'<td rowspan="{n}" sides="tb" border="1" align="left" balign="left" bgcolor="{fill}" cellpadding="6">{body}</td>'
                 f'<td port="{ports[0][0]}" height="{int(ports[0][1])}" width="2"></td>')
    rows = [f"<tr>{first}</tr>"] + [f'<tr><td port="{p}" height="{int(h)}" width="2"></td></tr>' for p, h in ports[1:]]
    return (f'"{node_id}" [shape=plain, label=<<table border="0" cellborder="0" cellspacing="0" '
            f'cellpadding="0">{"".join(rows)}</table>>];')


def edge(tail, head, fid, label, planned, color, direction=None, extra="", wrap=None):
    lab = "\\n".join(x.replace('"', '\\"') for x in flow_text(fid, label, planned, wrap))
    attrs = [f'label="{lab}"', f'color="{color}"', f'fontcolor="{color}"', "penwidth=1.6"]
    if direction == "back":
        attrs.append("dir=back")
    elif direction == "both":
        attrs.append("dir=both")
    if planned:
        attrs.append("style=dashed")
    if extra:
        attrs.append(extra)
    return f"  {tail} -> {head} [{', '.join(attrs)}];"


def header(name, title, subtitle, rankdir="LR", nodesep=GAP / 72, ranksep=0.35, splines="true"):
    return f"""digraph {name} {{
  graph [fontname="Helvetica", fontsize={TITLE_FONT}, labelloc=t, labeljust=l, pad=0.15,
         nodesep={nodesep:.2f}, ranksep={ranksep}, rankdir={rankdir}, splines={splines}, newrank=true,
         label=<<b>{esc(title)}</b>>];
  node  [fontname="Helvetica", fontsize={NODE_FONT}];
  edge  [fontname="Helvetica", fontsize={EDGE_FONT}, arrowsize=1.0];"""


def q(node, port=None, compass=None):
    s = f'"{node}"'
    if port:
        s += f":{port}"
    if compass:
        s += f":{compass}"
    return s


def ent_of(flow_src, flow_dst):
    return flow_src if flow_src in EXT else flow_dst


def all_planned_entity(code, flows):
    fl = [v for v in flows if code in (v[0], v[1])]
    return bool(fl) and all(v[-1] for v in fl)


# =======================================================================================
# Level 0: entities left (Student, GitHub, Obsidian) and right (Faculty, Admin, AI) of
# process 0; one port per composite flow on both ends.
# =======================================================================================
def l0_planned(cid):
    comps = [v[4] for v in F1.values() if v[3] == cid]
    return bool(comps) and all(comps)


def level0():
    left_ents, right_ents = ["STU", "AI"], ["FAC", "ADM", "GH", "OBS"]
    out = [header("L0", "DFD Level 0 (context diagram): Countersign",
                  "Unified Experiential Learning and Project Intelligence Platform | Gane-Sarson notation | "
                  "dashed = planned", ranksep=0.5)]
    groups = {e: [] for e in left_ents + right_ents}
    for cid, (s, d, lab) in L0.items():
        groups[ent_of(s, d)].append(cid)
    sys_left, sys_right, edges = [], [], []
    for side_ents, sys_ports, side in ((left_ents, sys_left, "L"), (right_ents, sys_right, "R")):
        for e in side_ents:
            ports = []
            for i, cid in enumerate(groups[e]):
                s, d, lab = L0[cid]
                h = label_h(cid, lab, l0_planned(cid), L0_WRAP)
                ports.append((f"p{i}", h))
                sys_ports.append((f"{side}{cid}", h + (GAP if i == len(groups[e]) - 1 else 0)))
                pl = l0_planned(cid)
                if side == "L":
                    t, hd = q(e, f"p{i}", "e"), q("SYS", f"L{cid}", "w")
                    edges.append(edge(t, hd, cid, lab, pl, BLUE, None if s == e else "back", wrap=L0_WRAP))
                else:
                    t, hd = q("SYS", f"R{cid}", "e"), q(e, f"p{i}", "w")
                    edges.append(edge(t, hd, cid, lab, pl, BLUE, None if s == "SYS" else "back", wrap=L0_WRAP))
            out.append("  " + ext_node(e, e, ports, side="e" if side == "L" else "w",
                                       planned=all(l0_planned(c) for c in groups[e])))
    out.append("  " + process_node("0", "Countersign\n(the whole system)", None, sys_left, sys_right,
                                   width=220, node_id="SYS"))
    out.append("  { rank=same; " + " ".join(f'"{e}";' for e in left_ents) + " }")
    out.append("  { rank=same; " + " ".join(f'"{e}";' for e in right_ents) + " }")
    out.append("  " + " -> ".join(f'"{e}"' for e in left_ents) + " [style=invis];")
    out.append("  " + " -> ".join(f'"{e}"' for e in right_ents) + " [style=invis];")
    out.extend(edges)
    out.append("}")
    return "\n".join(out)


# =======================================================================================
# Strip sheets (Level 1 and Level 2): one horizontal strip per process,
#   external entities | process | data stores
# Entities and stores are drawn next to every process that uses them (Gane-Sarson duplicate
# symbols). Each flow has its own port on both ends, so arrows run parallel and every label
# sits on its own arrow.
# =======================================================================================
def strips(name, title, subtitle, procs, ext_flows, internal, sflows, dup_ents, dup_stores,
           planned_procs=(), pwidth=230):
    out = [header(name, title, subtitle)]
    left_ids, right_ids, edges = [], [], []
    for pid, (pname, mech) in procs.items():
        # ---- external entities (always left of the process)
        fl = [(f, v) for f, v in ext_flows.items() if pid in (v[0], v[1])]
        fl.sort(key=lambda x: ENT_ORDER[ent_of(x[1][0], x[1][1])])
        by_ent = OrderedDict()
        for f, v in fl:
            by_ent.setdefault(ent_of(v[0], v[1]), []).append((f, v))
        # ---- data stores, grouped per store
        sf = sorted([x for x in sflows if x[1] == pid], key=lambda x: int(x[2][1:]))
        by_store = OrderedDict()
        for x in sf:
            by_store.setdefault(x[2], []).append(x)

        def ent_heights(items):
            k = len(items)
            return [max(label_h(f, v[2], v[4]), math.ceil(ENT_NAME_H / k)) for f, v in items]

        def store_heights(sid, items):
            k = len(items)
            return [max(label_h(x[0], x[4] + (" [append]" if "A" in x[3] else ""), x[5]),
                        math.ceil(store_h(sid) / k)) for x in items]
        lh = sum(sum(ent_heights(v)) + GAP for v in by_ent.values())
        sgroups = [(sid, items, sum(store_heights(sid, items)) + GAP) for sid, items in by_store.items()]
        # put the last store groups on the LEFT (below the entities) while that shortens the strip
        right_groups, left_groups = list(sgroups), []
        while right_groups:
            cand = right_groups[-1]
            r_now = sum(g[2] for g in right_groups)
            l_now = lh + sum(g[2] for g in left_groups)
            if max(l_now + cand[2], r_now - cand[2]) < max(l_now, r_now):
                left_groups.insert(0, right_groups.pop())
            else:
                break
        left, right = [], []
        for e, items in by_ent.items():
            nid = f"{e}@{pid}"
            ports = []
            hs = ent_heights(items)
            for i, ((f, (s, d, lab, _par, pl)), h) in enumerate(zip(items, hs)):
                pn = f"L{f.replace('.', '_')}"
                ports.append((f"p{i}", h))
                left.append((pn, h + (GAP if i == len(items) - 1 else 0)))
                edges.append(edge(q(nid, f"p{i}", "e"), q(pid, pn, "w"), f, lab, pl, BLUE,
                                  None if s == e else "back"))
            left_ids.append(nid)
            all_pl = all(v[4] for f, v in ext_flows.items() if e in (v[0], v[1]))
            out.append("  " + ext_node(e, nid, ports, "e", duplicate=e in dup_ents, planned=all_pl))
        for side, groups in (("L", left_groups), ("R", right_groups)):
            for sid, items, _h in groups:
                nid = f"{sid}@{pid}"
                ports = []
                hs = store_heights(sid, items)
                for i, ((fid, _p, _s, mode, lab, pl), h) in enumerate(zip(items, hs)):
                    pn = f"{side}{(fid or sid + '_' + str(i)).replace('.', '_')}"
                    ports.append((f"p{i}", h))
                    (left if side == "L" else right).append((pn, h + (GAP if i == len(items) - 1 else 0)))
                    shown = lab + (" [append]" if "A" in mode else "")
                    if side == "R":
                        d = {"R": "back", "W": None, "A": None, "RW": "both", "RA": "both"}[mode]
                        edges.append(edge(q(pid, pn, "e"), q(nid, f"p{i}", "w"), fid, shown, pl, GREEN, d))
                    else:
                        d = {"R": None, "W": "back", "A": "back", "RW": "both", "RA": "both"}[mode]
                        edges.append(edge(q(nid, f"p{i}", "e"), q(pid, pn, "w"), fid, shown, pl, GREEN, d))
                (left_ids if side == "L" else right_ids).append(nid)
                out.append("  " + store_node(sid, nid, ports, duplicate=sid in dup_stores,
                                             side="e" if side == "L" else "w"))
        out.append("  " + process_node(pid, pname, mech, left, right, planned=pid in planned_procs,
                                       width=pwidth))
    for layer in (left_ids, list(procs), right_ids):
        if layer:
            out.append("  { rank=same; " + " ".join(f'"{x}";' for x in layer) + " }")
        if len(layer) > 1:
            out.append("  " + " -> ".join(f'"{x}"' for x in layer) + " [style=invis];")
    out.extend(edges)
    for fid, (s, d, lab) in internal.items():
        out.append(edge(q(s, None, "s"), q(d, None, "n"), fid, lab, False, VIOLET, None,
                        extra="constraint=false"))
    out.append("}")
    return "\n".join(out)


def l1_dups():
    ent_pairs = defaultdict(set)
    for s, d, _l, _p, _pl in F1.values():
        e, p = (s, d) if s in EXT else (d, s)
        ent_pairs[e].add(p)
    st = defaultdict(set)
    for _f, p, sid, _m, _l, _pl in S1:
        st[sid].add(p)
    return ({e for e, v in ent_pairs.items() if len(v) > 1}, {s for s, v in st.items() if len(v) > 1})


L1_SUB = "Gane-Sarson | blue = flows with entities | green = flows with stores (actual tables) | dashed = planned"


def level1_sheet(pid, n, total):
    dup_e, dup_s = l1_dups()
    procs = OrderedDict([(pid, (P1[pid][0], P1[pid][1]))])
    flows = OrderedDict((f, v) for f, v in F1.items() if pid in (v[0], v[1]))
    sfl = [x for x in S1 if x[1] == pid]
    planned = {p for p, v in P1.items() if v[3] == "planned"}
    title = f"DFD Level 1, sheet {n} of {total}: process {pid} {P1[pid][0].replace(chr(10), ' ')}"
    return strips("L1", title, L1_SUB, procs, flows, OrderedDict(), sfl, dup_e, dup_s, planned)


def level2_sheet(name, parent, title, procs, flows, internal, sflows, subset):
    ps = OrderedDict((k, procs[k]) for k in subset)
    fl = OrderedDict((f, v) for f, v in flows.items() if v[0] in subset or v[1] in subset)
    inter = OrderedDict((f, v) for f, v in internal.items() if v[0] in subset and v[1] in subset)
    sfl = [(None, p, s, m, l, pl) for p, s, m, l, pl in sflows if p in subset]
    ent_p = defaultdict(set)
    for s, d, *_ in flows.values():
        e, p = (s, d) if s in EXT else (d, s)
        ent_p[e].add(p)
    st_p = defaultdict(set)
    for p, s, *_ in sflows:
        st_p[s].add(p)
    dup_e = {e for e, v in ent_p.items() if len(v) > 1}
    dup_s = {s for s, v in st_p.items() if len(v) > 1}
    return strips(name, title, "Gane-Sarson | bottom band = the RPC / trigger / view that realises the "
                  "sub-process | green labels = actual tables and columns", ps, fl, inter, sfl, dup_e, dup_s,
                  pwidth=250)


# =======================================================================================
# Checks: construction rules, naming rules, balancing
# =======================================================================================
def mode_set(m):
    return set(m)


def run_checks():
    errors, report = [], []

    mark = [0]

    def ok(msg):
        # PASS only if no FAIL was recorded since the previous PASS
        n = len(errors)
        report.append(("PASS" if n == mark[0] else "FAIL", msg))
        mark[0] = n

    def note(msg):
        report.append(("NOTE", msg))

    def bad(msg):
        errors.append(msg)
        report.append(("FAIL", msg))

    procs = set(P1)
    # ---- identifiers unique
    ids = list(L0) + list(F1) + [x[0] for x in S1] + list(F2_4) + list(F2_5) + list(I2_4)
    l2_reused = set(F2_4) | set(F2_5)
    dupl = {i for i in ids if ids.count(i) > 1 and i not in l2_reused}
    if dupl:
        bad(f"duplicate flow ids {sorted(dupl)}")
    ok(f"Identifiers: {len(L0)} context flows, {len(F1)} Level 1 external flows and {len(S1)} Level 1 "
       "store flows, all with unique ids")

    # ---- Level 0
    for fid, (s, d, lab) in L0.items():
        if not lab.strip() or "SYS" not in (s, d):
            bad(f"L0 {fid} unlabelled or not touching process 0")
    ok("Level 0: every flow is labelled and connects an external entity with process 0")
    for code in EXT:
        if not any(code in (s, d) for s, d, _ in L0.values()):
            bad(f"external {code} has no flow at Level 0")
    ok("Level 0: every external entity exchanges at least one flow with the system")

    # ---- Level 1 construction rules
    for fid, (s, d, lab, par, pl) in F1.items():
        if not lab.strip():
            bad(f"L1 {fid} unlabelled")
        if not ((s in EXT and d in procs) or (s in procs and d in EXT)):
            bad(f"L1 {fid}: not entity<->process")
    ok("Level 1: every external flow joins an external entity and a process (no entity-to-entity "
       "or entity-to-store flows)")
    for fid, p, sid, m, lab, pl in S1:
        if p not in procs or sid not in STORES or m not in ("R", "W", "A", "RW", "RA") or not lab.strip():
            bad(f"L1 store flow {fid} malformed")
    ok("Level 1: every store flow joins a process and a data store and is labelled (no store-to-store flows)")

    def io(p, include_planned):
        ins = [f for f, v in F1.items() if v[1] == p and (include_planned or not v[4])] + \
              [x[0] for x in S1 if x[1] == p and "R" in x[3] and (include_planned or not x[5])]
        outs = [f for f, v in F1.items() if v[0] == p and (include_planned or not v[4])] + \
               [x[0] for x in S1 if x[1] == p and mode_set(x[3]) & {"W", "A"} and (include_planned or not x[5])]
        return ins, outs
    for p in procs:
        ins, outs = io(p, True)
        if not ins:
            bad(f"{p} is a miracle (no input)")
        if not outs:
            bad(f"{p} is a black hole (no output)")
    ok("Level 1: no black-hole (input-only) or miracle (output-only) processes")
    impl_only = [p for p in procs if P1[p][3] != "planned" and not all(io(p, False))]
    if impl_only:
        bad(f"implemented processes lose an input or output without planned flows: {impl_only}")
    ok("Level 1: every implemented or partial process keeps an input and an output when the planned "
       "flows are removed (7.0 is planned as a whole)")

    for sid in STORES:
        r = any(x[2] == sid and "R" in x[3] for x in S1)
        w = any(x[2] == sid and mode_set(x[3]) & {"W", "A"} for x in S1)
        if not (r and w):
            bad(f"store {sid} is never {'read' if not r else 'written'}")
        ri = any(x[2] == sid and "R" in x[3] and not x[5] for x in S1)
        wi = any(x[2] == sid and mode_set(x[3]) & {"W", "A"} and not x[5] for x in S1)
        if not (ri and wi):
            note(f"{sid} {STORES[sid][2][0]}: with planned flows removed it is "
                 f"{'never written' if not wi else 'never read'} by a process; today it is loaded by "
                 "mongo/seed.js (initial data load, outside the DFD). The write S22 arrives with the webhook worker.")
    ok("Level 1: every data store is both written and read (no write-only or read-only stores)")

    # ---- naming rules
    def verb_ok(name):
        return re.split(r"[\s,]+", name.strip())[0].lower() in VERBS
    allp = [(p, v[0]) for p, v in P1.items()] + [(p, v[0]) for p, v in P2_4.items()] + \
           [(p, v[0]) for p, v in P2_5.items()]
    for p, n in allp:
        if not verb_ok(n):
            bad(f"process {p} '{n}' does not start with a verb of the controlled list")
    ok(f"Naming: all {len(allp)} process names (Level 1 and Level 2) begin with an imperative verb "
       f"from the controlled list ({', '.join(sorted(VERBS))})")
    labels = [(f, v[2]) for f, v in L0.items()] + [(f, v[2]) for f, v in F1.items()] + \
             [(x[0], x[4]) for x in S1] + [(f, v[2]) for f, v in F2_4.items()] + \
             [(f, v[2]) for f, v in F2_5.items()] + [(f, v[2]) for f, v in I2_4.items()] + \
             [(f"{x[0]}/{x[1]}", x[3]) for x in S2_4 + S2_5]
    for f, lab in labels:
        w = re.split(r"[\s(,./]+", lab.strip())[0].lower()
        if w in VERBS:
            bad(f"flow {f} label '{lab}' starts with a process verb")
    ok(f"Naming: none of the {len(labels)} flow labels begins with a process verb (lexical check; that "
       "every label is a noun phrase naming data was also reviewed by hand)")

    # ---- Balancing L0 <-> L1
    comp = defaultdict(list)
    for fid, (s, d, lab, par, pl) in F1.items():
        if par not in L0:
            bad(f"L1 {fid} parent {par} missing at L0")
            continue
        ps, pd, _ = L0[par]
        es = s if s in EXT else "SYS"
        ed = d if d in EXT else "SYS"
        if (es, ed) != (ps, pd):
            bad(f"L1 {fid} direction/entity differs from parent {par}")
        comp[par].append(fid)
    for c in L0:
        if not comp[c]:
            bad(f"L0 {c} has no Level 1 component (unbalanced)")
        pls = {F1[f][4] for f in comp[c]}
        if len(pls) > 1:
            bad(f"L0 {c} mixes planned and implemented components")
    ok("Balancing Level 0 / Level 1: every context flow decomposes into >= 1 Level 1 flow with the same "
       "entity and direction, every Level 1 external flow belongs to one context flow, and no context "
       "flow mixes planned and implemented components")

    # ---- Balancing L1 <-> L2
    def bal(parent, flows, internal, sflows, procs2):
        for p in procs2:
            if not p.startswith(parent[0] + "."):
                bad(f"{p} is not numbered under {parent}")
        l1_ext = {f for f, v in F1.items() if parent in (v[0], v[1])}
        l2_par = defaultdict(list)
        for f, (s, d, lab, par, pl) in flows.items():
            if not lab.strip():
                bad(f"{parent} L2 {f} unlabelled")
            l2_par[par].append(f)
            ps, pd, _l, _par, ppl = F1[par]
            es = s if s in EXT else parent
            ed = d if d in EXT else parent
            if (es, ed) != (ps, pd):
                bad(f"{parent} L2 {f}: entity/direction differs from {par}")
            if pl != ppl:
                bad(f"{parent} L2 {f}: planned status differs from {par}")
        if set(l2_par) != l1_ext:
            bad(f"{parent}: L1 external flows {sorted(l1_ext)} vs L2 parents {sorted(l2_par)}")
        else:
            ok(f"Balancing {parent}: the Level 2 external flows are exactly the {len(l1_ext)} Level 1 flows "
               f"of {parent} (split: "
               f"{'; '.join(p + ' = ' + ' + '.join(v) for p, v in l2_par.items() if len(v) > 1) or 'none'})")
        l1_modes = defaultdict(set)
        for _f, p, sid, m, _l, _pl in S1:
            if p == parent:
                l1_modes[sid] |= mode_set(m)
        l2_modes = defaultdict(set)
        for p, sid, m, _l, _pl in sflows:
            l2_modes[sid] |= mode_set(m)
        fmt = lambda d: ", ".join(f"{s} {''.join(sorted(v, key='RWA'.index))}"
                                  for s, v in sorted(d.items(), key=lambda x: int(x[0][1:])))
        if dict(l1_modes) != dict(l2_modes):
            bad(f"{parent}: store access differs. L1={fmt(l1_modes)} L2={fmt(l2_modes)}")
        else:
            ok(f"Balancing {parent}: Level 2 touches exactly the stores of {parent} at Level 1 with the same "
               f"access modes ({fmt(l1_modes)})")
        for p in procs2:
            ins = [1 for v in flows.values() if v[1] == p] + [1 for v in internal.values() if v[1] == p] + \
                  [1 for x in sflows if x[0] == p and "R" in x[2]]
            outs = [1 for v in flows.values() if v[0] == p] + [1 for v in internal.values() if v[0] == p] + \
                   [1 for x in sflows if x[0] == p and mode_set(x[2]) & {"W", "A"}]
            if not ins or not outs:
                bad(f"{p}: black hole or miracle")
        ok(f"Level 2 of {parent}: every sub-process has at least one input and one output, and is numbered "
           f"{parent[0]}.1 to {parent[0]}.{len(procs2)}")

    bal("4.0", F2_4, I2_4, S2_4, P2_4)
    bal("5.0", F2_5, I2_5, S2_5, P2_5)
    return errors, report, comp


# =======================================================================================
# Markdown tables
# =======================================================================================
def md(s):
    return s.replace("\n", " ").replace("|", "\\|")


MODE_TEXT = {"R": "read", "W": "write", "A": "write (append)", "RW": "read + write",
             "RA": "read + write (append)"}


def gen_tables(comp, report):
    t = {}
    rows = ["| ID | Store | Engine | Actual tables / collections | Written by | Read by |",
            "|--|------|---|--------|---|-----|"]
    for sid, (name, eng, tabs) in STORES.items():
        def who(pred):
            ps = sorted({(x[1], x[5]) for x in S1 if x[2] == sid and pred(x[3])})
            names = sorted({p for p, _ in ps})
            return ", ".join(p + ("" if any(not pl for q_, pl in ps if q_ == p) else " *(planned)*")
                             for p in names) or "-"
        rows.append(f"| {sid} | {name} | {eng} | {', '.join('`' + x + '`' for x in tabs)} | "
                    f"{who(lambda m: bool(mode_set(m) & {'W', 'A'}))} | {who(lambda m: 'R' in m)} |")
    t["stores"] = "\n".join(rows)

    nm = lambda x: "Countersign (0)" if x == "SYS" else EXT[x].replace("\n", " ")
    rows = ["| Context flow | From | To | Data flow name | Level 1 components | Status |",
            "|--|----|----|------|---|--|"]
    for c, (s, d, lab) in L0.items():
        rows.append(f"| {c} | {nm(s)} | {nm(d)} | {md(lab)} | {' + '.join(comp[c])} | "
                    f"{'planned' if l0_planned(c) else 'implemented'} |")
    t["l0"] = "\n".join(rows)

    nm1 = lambda x: EXT[x].replace("\n", " ") if x in EXT else x
    rows = ["| Flow | From | To | Data flow name | Parent (L0) | Status |", "|--|-----|-----|------|--|--|"]
    for f, (s, d, lab, par, pl) in sorted(F1.items(), key=lambda x: int(x[0][1:])):
        rows.append(f"| {f} | {nm1(s)} | {nm1(d)} | {md(lab)} | {par} | {'planned' if pl else 'implemented'} |")
    t["l1"] = "\n".join(rows)

    head = "| Process | " + " | ".join(STORES) + " |"
    rows = [head, "|------------|" + "--|" * len(STORES)]
    for p, (name, *_r) in P1.items():
        cells = []
        for sid in STORES:
            ms = [x for x in S1 if x[1] == p and x[2] == sid]
            impl, plan = set(), set()
            for x in ms:
                (plan if x[5] else impl).update(mode_set(x[3]))
            plan -= impl
            c = "".join(sorted(impl, key="RWA".index))
            if plan:
                c += (" " if c else "") + "".join(sorted(plan, key="RWA".index)) + "\\*"
            cells.append(c)
        rows.append(f"| {p} {md(name)} | " + " | ".join(cells) + " |")
    t["matrix"] = "\n".join(rows)

    rows = ["| Id | Process | Store | Access | Data (actual tables / columns) | Status |",
            "|--|--|-----|---|--------|--|"]
    for fid, p, sid, m, lab, pl in S1:
        rows.append(f"| {fid} | {p} | {sid} {STORES[sid][0]} | {MODE_TEXT[m]} | {md(lab)} | "
                    f"{'planned' if pl else 'implemented'} |")
    t["s1"] = "\n".join(rows)

    def l2_tables(key, flows, internal, sflows):
        rows = ["| Flow | From | To | Data flow name | Level 1 parent |", "|--|----|----|-------|--|"]
        for f, (s, d, lab, par, _pl) in flows.items():
            rows.append(f"| {f} | {nm1(s)} | {nm1(d)} | {md(lab)} | {par} |")
        for f, (s, d, lab) in internal.items():
            rows.append(f"| {f} | {s} | {d} | {md(lab)} | internal to {key}.0 |")
        t[f"l2_{key}_flows"] = "\n".join(rows)
        rows = ["| Sub-process | Store | Access | Data (actual tables / columns) |", "|--|-----|---|--------|"]
        for p, sid, m, lab, _pl in sflows:
            rows.append(f"| {p} | {sid} {STORES[sid][0]} | {MODE_TEXT[m]} | {md(lab)} |")
        t[f"l2_{key}_stores"] = "\n".join(rows)

    l2_tables("4", F2_4, I2_4, S2_4)
    l2_tables("5", F2_5, I2_5, S2_5)

    rows = ["| Result | Check |", "|-|---------|"]
    for res, msg in report:
        rows.append(f"| {res} | {md(msg)} |")
    t["checks"] = "\n".join(rows)
    return t


SHEETS_L2 = {
    "dfd_level2_p4_sheet1": ("4.0", ["4.1", "4.2"]),
    "dfd_level2_p4_sheet2": ("4.0", ["4.3", "4.4", "4.5"]),
    "dfd_level2_p5_sheet1": ("5.0", ["5.1", "5.2"]),
    "dfd_level2_p5_sheet2": ("5.0", ["5.3", "5.5"]),
    "dfd_level2_p5_sheet3": ("5.0", ["5.4"]),
}


def main():
    os.makedirs(DOT_DIR, exist_ok=True)
    os.makedirs(GEN_DIR, exist_ok=True)
    for f in os.listdir(DOT_DIR):
        if f.endswith(".dot"):
            os.remove(os.path.join(DOT_DIR, f))
    errors, report, comp = run_checks()
    files = {"dfd_level0_context.dot": level0()}
    for i, pid in enumerate(P1, 1):
        files[f"dfd_level1_sheet{i}.dot"] = level1_sheet(pid, i, len(P1))
    n4 = sum(1 for k in SHEETS_L2 if "_p4_" in k)
    n5 = sum(1 for k in SHEETS_L2 if "_p5_" in k)
    for key, (parent, subset) in SHEETS_L2.items():
        if parent == "4.0":
            procs, fl, it, sf, nm_, tot = P2_4, F2_4, I2_4, S2_4, "File and countersign claims", n4
        else:
            procs, fl, it, sf, nm_, tot = P2_5, F2_5, I2_5, S2_5, "Submit and assess components", n5
        sheet = int(key[-1])
        title = (f"DFD Level 2 of process {parent} {nm_}, sheet {sheet} of {tot} "
                 f"(sub-process{'es' if len(subset) > 1 else ''} {', '.join(subset)})")
        files[key + ".dot"] = level2_sheet(key.replace("dfd_", ""), parent, title, procs, fl, it, sf, subset)
    for fn, txt in files.items():
        with open(os.path.join(DOT_DIR, fn), "w") as fh:
            fh.write(txt + "\n")
    tables = gen_tables(comp, report)
    for k, v in tables.items():
        with open(os.path.join(GEN_DIR, f"{k}.md"), "w") as fh:
            fh.write(v + "\n")
    for res, msg in report:
        print(f"[{res}] {msg}")
    if errors:
        print("\nVIOLATIONS:", *errors, sep="\n  ")
        sys.exit(1)


if __name__ == "__main__":
    main()
