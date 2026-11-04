-- =====================================================================
--  Demo seed (runs AFTER ./fixture/02_seed.sql). Never modifies a fixture row:
--  it only INSERTs new rows, some of which reference fixture rows.
--  Real: Sanvid Razdan, project P06 = the CD252IA lab components C1–C11, team T00.
--  Illustrative: T06's work, claim wording and all marks (sample values, not real grades).
--  App users (personas) are NOT created here; scripts/create_personas.py does that.
-- =====================================================================

-- Fixture rows were inserted with explicit ids, which do not advance identity sequences.
SELECT setval(pg_get_serial_sequence('public.contribution', 'contribution_id'),
              (SELECT max(contribution_id) FROM contribution));
SELECT setval(pg_get_serial_sequence('public.artifact_chunk', 'chunk_id'),
              (SELECT max(chunk_id) FROM artifact_chunk));

-- ---------- Student ----------
INSERT INTO student (usn, name, email, department, section, semester, joined_at) VALUES
('1RV24CY051', 'Sanvid Razdan', 'sanvid.cy24@rvce.edu.in', 'CSE', 'A', 5, '2024-09-01');

INSERT INTO student_skill (usn, skill_id, level) VALUES
('1RV24CY051', 'S02', 3), ('1RV24CY051', 'S04', 4), ('1RV24CY051', 'S06', 3),
('1RV24CY051', 'S09', 3), ('1RV24CY051', 'S14', 3);

-- ---------- Terms, offerings, enrollments ----------
-- All 13 students are in semester 5 now (2026-ODD) and took CD243AI (a semester-4
-- course, project P04) in the previous even term.
INSERT INTO academic_term (term_id, name, start_date, end_date) VALUES
('2026-EVEN', 'Even semester 2025-26', '2026-01-19', '2026-05-31'),
('2026-ODD',  'Odd semester 2026-27',  '2026-08-24', '2026-12-31');

-- One offering per (course, term, section), taught by the course's fixture faculty.
INSERT INTO course_offering (course_code, term_id, section, faculty_id)
SELECT c.course_code,
       CASE WHEN c.semester % 2 = 1 THEN '2026-ODD' ELSE '2026-EVEN' END,
       s.section,
       c.faculty_id
FROM course c
CROSS JOIN (VALUES ('A'), ('B')) AS s(section)
ORDER BY c.course_code, s.section;

-- Each student is enrolled in their own section's offering of every course.
INSERT INTO enrollment (usn, offering_id, enrolled_on)
SELECT st.usn, o.offering_id, t.start_date
FROM student st
JOIN course_offering o ON o.section = st.section
JOIN academic_term  t ON t.term_id = o.term_id;

-- Concepts each course teaches (for the cross-course INTERSECT).
INSERT INTO course_skill (course_code, skill_id) VALUES
('CD252IA', 'S01'), ('CD252IA', 'S02'), ('CD252IA', 'S03'), ('CD252IA', 'S04'),
('CD252IA', 'S05'), ('CD252IA', 'S06'),
('CD253IA', 'S08'), ('CD253IA', 'S10'), ('CD253IA', 'S11'),
('CD254TA', 'S05'), ('CD254TA', 'S12'),              -- concurrency is shared with DBMS
('CD243AI', 'S13');

-- ---------- Project P06: the lab itself, one milestone per lab component ----------
INSERT INTO project (project_id, course_code, title, description, start_date, end_date, status, offering_id)
SELECT 'P06', 'CD252IA', 'CD252IA Lab 2026-27',
       'DBMS lab CIE: components C1-C11 (120 raw -> 30, plus C10 and C11 out of 10 each)',
       '2026-09-01', '2026-12-20', 'active', offering_id
FROM course_offering
WHERE course_code = 'CD252IA' AND term_id = '2026-ODD' AND section = 'A';

-- cie_part: C1-C9 are 'reduced' (120 raw -> 30); counts_in_reduced is derived from it.
INSERT INTO milestone (project_id, milestone_no, title, max_marks, deadline, cie_part) VALUES
('P06',  1, 'Synopsis',                    5, '2026-09-15', 'reduced'),
('P06',  2, 'Requirement Specification',   5, '2026-09-29', 'reduced'),
('P06',  3, 'ER Diagram',                 10, '2026-10-13', 'reduced'),
('P06',  4, 'Test',                       20, '2026-10-27', 'reduced'),
('P06',  5, 'DFD',                        10, '2026-11-10', 'reduced'),
('P06',  6, 'Normalized Tables',          10, '2026-11-17', 'reduced'),
('P06',  7, 'Midterm Report',             20, '2026-11-24', 'reduced'),
('P06',  8, 'Forms Security Validation',  10, '2026-12-01', 'reduced'),
('P06',  9, 'Demo and Draft Report',      30, '2026-12-08', 'reduced'),
('P06', 10, 'Innovative Experiment',      10, '2026-12-12', 'innovative'),
('P06', 11, 'Final Demo and Report',      10, '2026-12-18', 'final');

INSERT INTO project_skill (project_id, skill_id, min_level) VALUES
('P06', 'S02', 3), ('P06', 'S04', 3), ('P06', 'S05', 2), ('P06', 'S06', 2), ('P06', 'S08', 2);

-- ---------- Teams ----------
INSERT INTO team (team_id, project_id, team_name, max_size, created_at, topic_title, abstract) VALUES
('T00', 'P06', 'Countersign', 2, '2026-09-05',
 'Countersign: every mark has a receipt',
 'A database-driven EL platform where each rubric cell links to student claims, evidence and teammate countersigns.'),
('T06', 'P06', 'Team Sigma',  4, '2026-09-06',
 'Lab inventory tracker',
 'Tracks lab equipment issue and return with fines and reservations.');

INSERT INTO team_member (team_id, usn, role, joined_at) VALUES
('T00', '1RV24CY047', 'lead',   '2026-09-05'),
('T00', '1RV24CY051', 'member', '2026-09-05'),
('T06', '1RV24CY011', 'lead',   '2026-09-06'),
('T06', '1RV24CY024', 'member', '2026-09-06'),
('T06', '1RV24CY033', 'member', '2026-09-07');      -- Meera: no evidence yet

-- ---------- Artifacts and their versions ----------
INSERT INTO artifact (artifact_id, team_id, project_id, milestone_no, title, type, source, created_at,
                      visibility, owner_usn, external_ref) VALUES
('A13', 'T00', 'P06', 1, 'Synopsis',                      'report',  'editor',   '2026-09-08', 'submitted', NULL, NULL),
('A14', 'T00', 'P06', 1, 'Existing systems survey notes', 'note',    'obsidian', '2026-09-10', 'submitted', NULL, NULL),
('A15', 'T00', 'P06', 4, 'Test: SQL queries Q1-Q37',      'code',    'github',   '2026-10-25', 'submitted', NULL, 'supabase/fixture/03_queries.sql'),
('A16', 'T00', 'P06', 4, 'Test: MongoDB queries M1-M25',  'code',    'github',   '2026-10-25', 'submitted', NULL, 'mongo/04_mongo.js'),
('A17', 'T00', 'P06', 3, 'ER diagram v2 (draft)',         'diagram', 'editor',   '2026-11-02', 'team',      NULL, NULL),
('A18', 'T00', 'P06', 3, 'Cardinality doubts',            'note',    'obsidian', '2026-11-03', 'private',   '1RV24CY051', NULL),
('A19', 'T06', 'P06', 1, 'Synopsis',                      'report',  'editor',   '2026-09-13', 'submitted', NULL, NULL),
('A20', 'T06', 'P06', 4, 'Test answer sheet',             'report',  'editor',   '2026-10-26', 'submitted', NULL, NULL);

-- content_hash = sha256 of a placeholder body (real bodies will live in Mongo note_versions)
INSERT INTO artifact_version (artifact_id, version_no, created_by, created_at, content_hash, ai_assistance)
SELECT v.artifact_id, v.version_no, v.created_by, v.created_at::timestamptz,
       encode(sha256(convert_to(v.artifact_id || '/v' || v.version_no, 'UTF8')), 'hex'),
       v.ai_assistance
FROM (VALUES
    ('A13', 1, '1RV24CY047', '2026-09-08 21:10+05:30', 'none'),
    ('A13', 2, '1RV24CY051', '2026-09-11 19:40+05:30', 'none'),
    ('A13', 3, '1RV24CY047', '2026-09-12 16:05+05:30', 'assisted'),
    ('A14', 1, '1RV24CY051', '2026-09-10 22:15+05:30', 'none'),
    ('A15', 1, '1RV24CY047', '2026-10-25 20:30+05:30', 'assisted'),
    ('A16', 1, '1RV24CY051', '2026-10-25 21:00+05:30', 'none'),
    ('A17', 1, '1RV24CY051', '2026-11-02 18:20+05:30', 'none'),
    ('A18', 1, '1RV24CY051', '2026-11-03 23:05+05:30', 'none'),
    ('A19', 1, '1RV24CY011', '2026-09-13 17:00+05:30', 'none'),
    ('A19', 2, '1RV24CY024', '2026-09-14 12:30+05:30', 'none'),
    ('A20', 1, '1RV24CY024', '2026-10-26 15:45+05:30', 'none'),
    ('A20', 2, '1RV24CY011', '2026-10-26 15:55+05:30', 'none')      -- Aditi adds the NoSQL part
) AS v(artifact_id, version_no, created_by, created_at, ai_assistance);

-- ---------- Contributions (ids from the identity sequence) ----------
INSERT INTO contribution (usn, artifact_id, contribution_type, description, created_at,
                          source, source_ref, occurred_at, ai_assisted) VALUES
('1RV24CY047', 'A13', 'documentation', 'Introduction, proposed system and DB structure', '2026-09-08', 'editor',   'A13@v1', '2026-09-08 21:10+05:30', false),
('1RV24CY051', 'A13', 'documentation', 'Existing system and societal concern sections',  '2026-09-11', 'editor',   'A13@v2', '2026-09-11 19:40+05:30', false),
('1RV24CY051', 'A14', 'research',      'Surveyed GitHub Classroom, CATME and WebPA',     '2026-09-10', 'obsidian', 'A14@v1', '2026-09-10 22:15+05:30', false),
('1RV24CY047', 'A15', 'code',          'Wrote and ran the Test SQL queries',             '2026-10-25', 'github',   '3f9c2ab', '2026-10-25 20:30+05:30', true),
('1RV24CY051', 'A16', 'code',          'Ran and verified the MongoDB Test queries',      '2026-10-25', 'github',   '8d41e07', '2026-10-25 21:00+05:30', false),
('1RV24CY051', 'A17', 'design',        'ER diagram v2 in Chen notation',                 '2026-11-02', 'editor',   'A17@v1', '2026-11-02 18:20+05:30', false),
('1RV24CY011', 'A19', 'documentation', 'Synopsis introduction and problem statement',    '2026-09-13', 'editor',   'A19@v1', '2026-09-13 17:00+05:30', false),
('1RV24CY024', 'A19', 'research',      'Literature survey section',                      '2026-09-14', 'editor',   'A19@v2', '2026-09-14 12:30+05:30', false),
('1RV24CY024', 'A20', 'code',          'SQL answers',                                    '2026-10-26', 'editor',   'A20@v1', '2026-10-26 15:45+05:30', false),
('1RV24CY011', 'A20', 'code',          'NoSQL answers',                                  '2026-10-26', 'editor',   'A20@v2', '2026-10-26 15:55+05:30', false);

INSERT INTO artifact_chunk (artifact_id, version_no, author_usn, content, created_at, visibility) VALUES
('A13', 1, '1RV24CY047', 'Countersign links every rubric cell to student claims backed by evidence and teammate countersigns.', '2026-09-08', 'submitted'),
('A13', 2, '1RV24CY051', 'Existing EL tools such as CATME and WebPA rely on peer ratings, not on traceable evidence.',         '2026-09-11', 'submitted');

-- ---------- Submissions (frozen versions) ----------
INSERT INTO submission (team_id, project_id, milestone_no, submitted_by, submitted_at) VALUES
('T00', 'P06', 1, '1RV24CY047', '2026-09-12 18:00+05:30'),
('T00', 'P06', 4, '1RV24CY047', '2026-10-26 10:00+05:30'),
('T06', 'P06', 1, '1RV24CY011', '2026-09-14 18:30+05:30'),
('T06', 'P06', 4, '1RV24CY024', '2026-10-26 16:00+05:30');

INSERT INTO submission_artifact (submission_id, artifact_id, version_no)
SELECT s.submission_id, x.artifact_id, x.version_no
FROM (VALUES ('T00', 1, 'A13', 3), ('T00', 1, 'A14', 1),
             ('T00', 4, 'A15', 1), ('T00', 4, 'A16', 1),
             ('T06', 1, 'A19', 2), ('T06', 4, 'A20', 2)
     ) AS x(team_id, milestone_no, artifact_id, version_no)
JOIN submission s ON s.team_id = x.team_id AND s.project_id = 'P06' AND s.milestone_no = x.milestone_no;

-- ---------- Claims ----------
INSERT INTO claim (usn, team_id, project_id, milestone_no, statement, contribution_type, ai_assistance, created_at) VALUES
('1RV24CY047', 'T00', 'P06', 1, 'Wrote the Introduction, Proposed System and Relational Database Structure sections of the synopsis.', 'documentation', 'assisted', '2026-09-12 18:10+05:30'),
('1RV24CY051', 'T00', 'P06', 1, 'Wrote the Existing System survey (GitHub Classroom, CATME, WebPA) and the Societal Concern section.', 'research',      'none',     '2026-09-12 18:20+05:30'),
('1RV24CY047', 'T00', 'P06', 4, 'Wrote and executed the SQL Test queries (2, 8, 5, 3, 6) on our own schema in Supabase.',            'code',          'assisted', '2026-10-26 10:10+05:30'),
('1RV24CY051', 'T00', 'P06', 4, 'Executed the MongoDB Test queries M1-M5 and checked every output against the expected results.',     'code',          'none',     '2026-10-26 10:20+05:30'),
('1RV24CY051', 'T00', 'P06', 3, 'Drew ER diagram v2 in Chen notation with MILESTONE and ARTIFACT_VERSION as weak entities.',         'design',        'none',     '2026-11-02 18:30+05:30'),
('1RV24CY011', 'T06', 'P06', 1, 'Wrote the entire synopsis, including the literature survey.',                                       'documentation', 'none',     '2026-09-14 18:40+05:30'),
('1RV24CY024', 'T06', 'P06', 1, 'Wrote the literature survey section of the synopsis.',                                              'research',      'none',     '2026-09-14 18:45+05:30'),
('1RV24CY024', 'T06', 'P06', 4, 'Answered the SQL part of the Test.',                                                                'code',          'none',     '2026-10-26 16:10+05:30'),
('1RV24CY011', 'T06', 'P06', 4, 'Answered the NoSQL part of the Test.',                                                              'code',          'none',     '2026-10-26 16:15+05:30');

-- Evidence: one row per (claim, evidence_no). Claims are found by (usn, team, milestone).
INSERT INTO claim_evidence (claim_id, evidence_no, kind, contribution_id, artifact_id, version_no, ref, note)
SELECT c.claim_id, e.evidence_no, e.kind,
       (SELECT contribution_id FROM contribution k
        WHERE k.usn = e.usn AND k.source_ref = e.contribution_ref AND e.kind = 'contribution'),
       e.artifact_id, e.version_no, e.ref, e.note
FROM (VALUES
    ('1RV24CY047', 'T00', 1, 1, 'contribution',     'A13@v1', NULL,  NULL, NULL, NULL),
    ('1RV24CY047', 'T00', 1, 2, 'artifact_version', NULL,     'A13', 1,    NULL, 'first full draft'),
    ('1RV24CY051', 'T00', 1, 1, 'contribution',     'A13@v2', NULL,  NULL, NULL, NULL),
    ('1RV24CY051', 'T00', 1, 2, 'contribution',     'A14@v1', NULL,  NULL, NULL, 'survey notes'),
    ('1RV24CY047', 'T00', 4, 1, 'contribution',     '3f9c2ab', NULL, NULL, NULL, NULL),
    ('1RV24CY047', 'T00', 4, 2, 'file',             NULL,     NULL,  NULL, 'supabase/fixture/03_queries.sql', NULL),
    ('1RV24CY051', 'T00', 4, 1, 'contribution',     '8d41e07', NULL, NULL, NULL, NULL),
    ('1RV24CY051', 'T00', 3, 1, 'artifact_version', NULL,     'A17', 1,    NULL, NULL),
    ('1RV24CY011', 'T06', 1, 1, 'artifact_version', NULL,     'A19', 1,    NULL, NULL),
    ('1RV24CY024', 'T06', 1, 1, 'artifact_version', NULL,     'A19', 2,    NULL, 'added the survey'),
    ('1RV24CY024', 'T06', 4, 1, 'contribution',     'A20@v1', NULL,  NULL, NULL, NULL),
    ('1RV24CY011', 'T06', 4, 1, 'contribution',     'A20@v2', NULL,  NULL, NULL, NULL)
) AS e(usn, team_id, milestone_no, evidence_no, kind, contribution_ref, artifact_id, version_no, ref, note)
JOIN claim c ON c.usn = e.usn AND c.team_id = e.team_id AND c.project_id = 'P06' AND c.milestone_no = e.milestone_no;

-- Countersigns (claim_revision is filled in by trigger with the claim's current revision;
-- claim.status is derived by trigger: T06's synopsis claim becomes contested;
-- Sanvid's C3 claim has none yet, so it stays pending in Arun's queue).
INSERT INTO countersign (claim_id, endorser_usn, verdict, comment, signed_at)
SELECT c.claim_id, s.endorser, s.verdict, s.comment, s.signed_at::timestamptz
FROM (VALUES
    ('1RV24CY047', 'T00', 1, '1RV24CY051', 'confirm', NULL, '2026-09-12 20:00+05:30'),
    ('1RV24CY051', 'T00', 1, '1RV24CY047', 'confirm', NULL, '2026-09-12 20:05+05:30'),
    ('1RV24CY047', 'T00', 4, '1RV24CY051', 'confirm', NULL, '2026-10-26 12:00+05:30'),
    ('1RV24CY051', 'T00', 4, '1RV24CY047', 'confirm', NULL, '2026-10-26 12:05+05:30'),
    ('1RV24CY011', 'T06', 1, '1RV24CY024', 'dispute', 'I wrote the literature survey (see version 2).', '2026-09-15 09:30+05:30'),
    ('1RV24CY024', 'T06', 1, '1RV24CY011', 'confirm', NULL, '2026-09-15 10:00+05:30'),
    ('1RV24CY024', 'T06', 4, '1RV24CY011', 'confirm', NULL, '2026-10-26 18:00+05:30'),
    ('1RV24CY011', 'T06', 4, '1RV24CY024', 'confirm', NULL, '2026-10-26 18:05+05:30')
) AS s(usn, team_id, milestone_no, endorser, verdict, comment, signed_at)
JOIN claim c ON c.usn = s.usn AND c.team_id = s.team_id AND c.project_id = 'P06' AND c.milestone_no = s.milestone_no;

-- Verified skill evidence from confirmed claims.
INSERT INTO skill_evidence (usn, skill_id, claim_id, level)
SELECT c.usn, x.skill_id, c.claim_id, x.level
FROM (VALUES ('1RV24CY047', 4, 'S02', 4), ('1RV24CY051', 4, 'S06', 3), ('1RV24CY024', 4, 'S02', 2))
     AS x(usn, milestone_no, skill_id, level)
JOIN claim c ON c.usn = x.usn AND c.project_id = 'P06' AND c.milestone_no = x.milestone_no;

-- ---------- Sample marks (illustrative) for C1 and C4, by F01 ----------
INSERT INTO assessment (usn, project_id, milestone_no, marks, assessed_by, assessed_at) VALUES
('1RV24CY047', 'P06', 1,  5.0, 'F01', '2026-09-18 11:00+05:30'),
('1RV24CY051', 'P06', 1,  4.5, 'F01', '2026-09-18 11:00+05:30'),
('1RV24CY011', 'P06', 1,  4.0, 'F01', '2026-09-18 11:05+05:30'),
('1RV24CY024', 'P06', 1,  4.5, 'F01', '2026-09-18 11:05+05:30'),
('1RV24CY033', 'P06', 1,  3.0, 'F01', '2026-09-18 11:05+05:30'),
('1RV24CY047', 'P06', 4, 19.0, 'F01', '2026-10-30 14:00+05:30'),
('1RV24CY051', 'P06', 4, 18.0, 'F01', '2026-10-30 14:00+05:30'),
('1RV24CY011', 'P06', 4, 16.0, 'F01', '2026-10-30 14:10+05:30'),
('1RV24CY024', 'P06', 4, 17.0, 'F01', '2026-10-30 14:10+05:30'),
('1RV24CY033', 'P06', 4, 12.0, 'F01', '2026-10-30 14:10+05:30');

-- C1 marks are final: from now on the trigger rejects any change to them.
UPDATE milestone SET locked_at = '2026-09-20 17:00+05:30'
WHERE project_id = 'P06' AND milestone_no = 1;

-- ---------- Private notes (owner-only) ----------
INSERT INTO private.note (owner_usn, team_id, title, body) VALUES
('1RV24CY051', 'T00', 'Viva prep: weak entities', 'MILESTONE is identified by (project_id, milestone_no); partial key milestone_no.'),
('1RV24CY047', 'T00', 'Race finding to explain', 'RR snapshot is taken before the lock wait; a lock is not a write.');
