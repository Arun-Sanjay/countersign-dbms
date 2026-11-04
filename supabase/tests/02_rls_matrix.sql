-- RLS matrix (gate G3): persona x relation -> number of visible rows, plus targeted
-- privacy and write-permission checks. Runs on the fixture + demo seed inside a
-- transaction that is rolled back (test users vanish with it).
--
-- Personas (app_user rows created below; auth.uid() comes from request.jwt.claims.sub):
--   arun   1RV24CY047  student, teams T00 (P06), T01, T03, T05
--   sanvid 1RV24CY051  student, team T00 only; owns the PRIVATE artifact A18
--   meera  1RV24CY033  student, teams T01, T03, T06 (the other P06 team)
--   nikhil 1RV24CY077  student with no team
--   f01    F01         teaches CD252IA -> P01, P05, P06
--   f02    F02         teaches CD253IA -> P02 only
--   admin              no usn / faculty_id
--   anon               not signed in: has no table privileges at all ('denied')
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(298);

-- ---------------------------------------------------------------------
-- Fixtures: test auth users + app_user rows (personas made by scripts/ are set aside)
-- ---------------------------------------------------------------------
DELETE FROM app_user;

CREATE TEMP TABLE persona (name TEXT PRIMARY KEY, uid UUID, role TEXT, usn TEXT, faculty_id TEXT);
INSERT INTO persona VALUES
    ('arun',   '00000000-0000-4000-a000-000000000047', 'student', '1RV24CY047', NULL),
    ('sanvid', '00000000-0000-4000-a000-000000000051', 'student', '1RV24CY051', NULL),
    ('meera',  '00000000-0000-4000-a000-000000000033', 'student', '1RV24CY033', NULL),
    ('nikhil', '00000000-0000-4000-a000-000000000077', 'student', '1RV24CY077', NULL),
    ('f01',    '00000000-0000-4000-a000-0000000000f1', 'faculty', NULL, 'F01'),
    ('f02',    '00000000-0000-4000-a000-0000000000f2', 'faculty', NULL, 'F02'),
    ('admin',  '00000000-0000-4000-a000-0000000000ad', 'admin',   NULL, NULL);

INSERT INTO auth.users (id, aud, role, email)
SELECT uid, 'authenticated', 'authenticated', name || '@rls-test.invalid' FROM persona;
INSERT INTO app_user (user_id, role, usn, faculty_id)
SELECT uid, role, usn, faculty_id FROM persona;

GRANT SELECT ON persona TO authenticated, anon;

-- Become a persona for the rest of the transaction (call RESET ROLE first to switch again).
CREATE FUNCTION pg_temp.become(p_name TEXT) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_name = 'anon' THEN
        PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
        PERFORM set_config('role', 'anon', true);
    ELSE
        PERFORM set_config('request.jwt.claims',
            json_build_object('sub', uid, 'role', 'authenticated')::text, true)
        FROM persona WHERE name = p_name;
        PERFORM set_config('role', 'authenticated', true);
    END IF;
END $$;

-- ---------------------------------------------------------------------
-- A. The matrix. Expected visible rows; 'denied' = permission denied (SQLSTATE 42501).
-- ---------------------------------------------------------------------
CREATE TEMP TABLE rls_expect (rel TEXT, arun TEXT, sanvid TEXT, meera TEXT, nikhil TEXT,
                              f01 TEXT, f02 TEXT, admin TEXT, anon TEXT);
INSERT INTO rls_expect VALUES
--   relation                  arun  sanvid meera nikhil f01   f02   admin anon
    -- directory: everyone signed in sees every row
    ('student',                '13', '13', '13', '13', '13', '13', '13', 'denied'),
    ('faculty',                '4',  '4',  '4',  '4',  '4',  '4',  '4',  'denied'),
    ('course',                 '4',  '4',  '4',  '4',  '4',  '4',  '4',  'denied'),
    ('project',                '6',  '6',  '6',  '6',  '6',  '6',  '6',  'denied'),
    ('milestone',              '24', '24', '24', '24', '24', '24', '24', 'denied'),
    ('skill',                  '14', '14', '14', '14', '14', '14', '14', 'denied'),
    ('project_skill',          '17', '17', '17', '17', '17', '17', '17', 'denied'),
    ('team',                   '7',  '7',  '7',  '7',  '7',  '7',  '7',  'denied'),
    ('team_member',            '24', '24', '24', '24', '24', '24', '24', 'denied'),
    ('student_skill',          '51', '51', '51', '51', '51', '51', '51', 'denied'),
    ('course_skill',           '12', '12', '12', '12', '12', '12', '12', 'denied'),
    ('academic_term',          '2',  '2',  '2',  '2',  '2',  '2',  '2',  'denied'),
    ('course_offering',        '8',  '8',  '8',  '8',  '8',  '8',  '8',  'denied'),
    ('skill_evidence',         '3',  '3',  '3',  '3',  '3',  '3',  '3',  'denied'),
    -- identity: own row; admin all. enrollment: own; faculty the rolls they teach
    ('app_user',               '1',  '1',  '1',  '1',  '1',  '1',  '7',  'denied'),
    ('enrollment',             '4',  '4',  '4',  '4',  '13', '13', '52', 'denied'),
    -- team content (A18 is Sanvid's private artifact; chunks 8–9 are the only 'submitted' ones)
    ('artifact',               '14', '6',  '9',  '0',  '14', '2',  '19', 'denied'),
    ('artifact_version',       '7',  '8',  '4',  '0',  '11', '0',  '11', 'denied'),
    ('contribution',           '28', '6',  '21', '0',  '24', '6',  '38', 'denied'),
    ('artifact_chunk',         '9',  '2',  '7',  '0',  '2',  '0',  '2',  'denied'),
    ('claim',                  '5',  '5',  '4',  '0',  '9',  '0',  '9',  'denied'),
    ('claim_evidence',         '8',  '8',  '4',  '0',  '12', '0',  '12', 'denied'),
    ('countersign',            '4',  '4',  '4',  '0',  '8',  '0',  '8',  'denied'),
    ('submission',             '2',  '2',  '2',  '0',  '4',  '0',  '4',  'denied'),
    ('submission_artifact',    '4',  '4',  '2',  '0',  '6',  '0',  '6',  'denied'),
    -- marks: own only; the teaching faculty all of their projects
    ('assessment',             '2',  '2',  '2',  '0',  '10', '0',  '10', 'denied'),
    -- security_invoker views
    ('v_lab_cie_marks',        '1',  '1',  '1',  '0',  '5',  '0',  '5',  'denied'),
    ('v_rubric_sheet',         '65', '22', '68', '0',  '90', '15', '119','denied'),
    ('v_contested_claims',     '0',  '0',  '1',  '0',  '1',  '0',  '1',  'denied'),
    ('v_faculty_team_progress','4',  '1',  '3',  '0',  '4',  '1',  '7',  'denied'),
    ('v_semester_hub',         '6',  '6',  '6',  '5',  '0',  '0',  '0',  'denied'),
    ('v_what_faculty_sees',    '32', '19', '12', '0',  '0',  '0',  '0',  'denied');

-- unpivot to (persona, rel, expected)
CREATE TEMP VIEW rls_expect_long AS
SELECT x.persona, e.rel, x.expected
FROM rls_expect e
CROSS JOIN LATERAL (VALUES ('arun', e.arun), ('sanvid', e.sanvid), ('meera', e.meera),
                           ('nikhil', e.nikhil), ('f01', e.f01), ('f02', e.f02),
                           ('admin', e.admin), ('anon', e.anon)) AS x(persona, expected);

CREATE TEMP TABLE rls_actual (persona TEXT, rel TEXT, actual TEXT);
GRANT SELECT ON rls_expect TO authenticated, anon;
GRANT INSERT ON rls_actual TO authenticated, anon;

-- Count every relation as the CURRENT role (invoker), recording 'denied' on 42501.
CREATE FUNCTION pg_temp.snapshot(p_persona TEXT) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r TEXT; n BIGINT;
BEGIN
    FOR r IN SELECT rel FROM rls_expect LOOP
        BEGIN
            EXECUTE format('SELECT count(*) FROM public.%I', r) INTO n;
            INSERT INTO rls_actual VALUES (p_persona, r, n::text);
        EXCEPTION WHEN insufficient_privilege THEN
            INSERT INTO rls_actual VALUES (p_persona, r, 'denied');
        END;
    END LOOP;
END $$;

SELECT pg_temp.become('arun');   SELECT pg_temp.snapshot('arun');   RESET ROLE;
SELECT pg_temp.become('sanvid'); SELECT pg_temp.snapshot('sanvid'); RESET ROLE;
SELECT pg_temp.become('meera');  SELECT pg_temp.snapshot('meera');  RESET ROLE;
SELECT pg_temp.become('nikhil'); SELECT pg_temp.snapshot('nikhil'); RESET ROLE;
SELECT pg_temp.become('f01');    SELECT pg_temp.snapshot('f01');    RESET ROLE;
SELECT pg_temp.become('f02');    SELECT pg_temp.snapshot('f02');    RESET ROLE;
SELECT pg_temp.become('admin');  SELECT pg_temp.snapshot('admin');  RESET ROLE;
SELECT pg_temp.become('anon');   SELECT pg_temp.snapshot('anon');   RESET ROLE;

-- 32 relations x 8 personas = 256 cells
SELECT is(a.actual, e.expected, format('matrix: %-7s sees %s rows of %s', e.persona, e.expected, e.rel))
FROM rls_expect_long e
LEFT JOIN rls_actual a ON a.persona = e.persona AND a.rel = e.rel
ORDER BY e.rel, e.persona;

-- ---------------------------------------------------------------------
-- B. Catalog guarantees
-- ---------------------------------------------------------------------
SELECT is((SELECT count(*)::int FROM pg_class c
           WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
             AND NOT c.relrowsecurity),
          0, 'every public table has RLS enabled');

SELECT is((SELECT count(*)::int FROM pg_class c
           WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
             AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)),
          0, 'every public table has at least one policy');

SELECT is((SELECT count(*)::int FROM pg_class c
           WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'v'
             AND NOT ('security_invoker=true' = ANY (COALESCE(c.reloptions, '{}')))),
          0, 'every public view is security_invoker');

SELECT is((SELECT count(*)::int FROM pg_class c
           WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'v')
             AND (has_table_privilege('anon', c.oid, 'SELECT')
                  OR has_table_privilege('anon', c.oid, 'INSERT'))),
          0, 'anon holds no SELECT/INSERT privilege on any public table or view');

SELECT is((SELECT count(*)::int FROM pg_class c
           WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
             AND has_table_privilege('authenticated', c.oid, 'TRUNCATE')),
          0, 'authenticated cannot TRUNCATE (TRUNCATE bypasses RLS)');

SELECT is((SELECT count(*)::int FROM pg_policy p
           WHERE p.polrelid IN (SELECT oid FROM pg_class WHERE relnamespace = 'public'::regnamespace)
             AND p.polroles <> ARRAY['authenticated'::regrole::oid]),
          0, 'every policy is scoped TO authenticated');

-- ---------------------------------------------------------------------
-- C. Privacy: private artifact, private notes, other students' marks
-- ---------------------------------------------------------------------
SELECT pg_temp.become('arun');
SELECT is((SELECT count(*)::int FROM artifact WHERE artifact_id = 'A18'), 0,
          'private artifact A18 is invisible to its owner''s teammate (Arun)');
SELECT is((SELECT count(*)::int FROM artifact_version WHERE artifact_id = 'A18'), 0,
          'versions of a private artifact are invisible to a teammate');
SELECT is((SELECT count(*)::int FROM assessment WHERE usn = '1RV24CY051'), 0,
          'a student cannot read a teammate''s marks');
SELECT is((SELECT count(*)::int FROM v_rubric_sheet WHERE usn = '1RV24CY051' AND marks IS NOT NULL), 0,
          'rubric sheet shows a teammate''s cells but not their marks');
SELECT throws_ok($$SELECT count(*) FROM private.note$$, '42501', NULL,
                 'private notes are not readable directly (schema private has no grants)');
SELECT is((SELECT count(*)::int FROM v_what_faculty_sees WHERE item_ref LIKE 'A18%'), 0,
          '"what faculty sees" never lists a private artifact');
RESET ROLE;

SELECT pg_temp.become('sanvid');
SELECT is((SELECT count(*)::int FROM artifact WHERE artifact_id = 'A18'), 1,
          'the owner sees their own private artifact A18');
SELECT is((SELECT count(*)::int FROM v_what_faculty_sees WHERE item_ref LIKE 'A18%'), 0,
          '...but it is absent from the owner''s "what faculty sees" view');
RESET ROLE;

SELECT pg_temp.become('f01');
SELECT is((SELECT count(*)::int FROM artifact WHERE artifact_id = 'A18'), 0,
          'faculty never see a private artifact, even in a project they teach');
SELECT is((SELECT count(*)::int FROM artifact_chunk WHERE visibility <> 'submitted'), 0,
          'faculty read chunk text only once it is submitted');
SELECT results_eq(
    $$SELECT usn, reduced_30, total_50 FROM v_lab_cie_marks WHERE team_id = 'T00' ORDER BY usn$$,
    $$VALUES ('1RV24CY047'::varchar, 6.0::numeric, 6.0::numeric),
             ('1RV24CY051'::varchar, 5.6::numeric, 5.6::numeric)$$,
    'lab CIE: (5+19)*30/120 = 6.0 and (4.5+18)*30/120 = 5.625 -> 5.6');
RESET ROLE;

SELECT pg_temp.become('f02');
SELECT is((SELECT count(*)::int FROM claim WHERE project_id = 'P06'), 0,
          'F02 (does not teach CD252IA) sees no P06 claims');
SELECT is((SELECT count(*)::int FROM assessment WHERE project_id = 'P06'), 0,
          'F02 sees no P06 marks');
RESET ROLE;

-- ---------------------------------------------------------------------
-- D. Write permissions (42501 = "new row violates row-level security policy")
-- ---------------------------------------------------------------------
SELECT pg_temp.become('arun');
SELECT throws_ok(
    $$INSERT INTO assessment (usn, project_id, milestone_no, marks, assessed_by)
      VALUES ('1RV24CY047', 'P06', 5, 10, 'F01')$$,
    '42501', NULL, 'a student cannot write marks (not even their own)');
SELECT throws_ok(
    $$INSERT INTO claim (usn, team_id, project_id, milestone_no, statement)
      VALUES ('1RV24CY051', 'T00', 'P06', 5, 'Drew the level-1 DFD for submissions.')$$,
    '42501', NULL, 'a student cannot file a claim in a teammate''s name');
SELECT throws_ok(
    $$INSERT INTO claim (usn, team_id, project_id, milestone_no, statement)
      VALUES ('1RV24CY047', 'T06', 'P06', 5, 'Drew the level-1 DFD for submissions.')$$,
    '23514', NULL, 'a student cannot file a claim for another team');
-- (Order of checks: BEFORE ROW triggers run before RLS WITH CHECK, so the 0002 membership
--  trigger rejects this row first with 23514; the policy would reject it with 42501.)
SELECT lives_ok(
    $$INSERT INTO claim (usn, team_id, project_id, milestone_no, statement)
      VALUES ('1RV24CY047', 'T00', 'P06', 5, 'Drew the level-0 and level-1 DFDs.')$$,
    'a student files their own claim for their own team');
SELECT lives_ok(
    $$INSERT INTO countersign (claim_id, endorser_usn, verdict)
      SELECT claim_id, '1RV24CY047', 'confirm' FROM claim
      WHERE usn = '1RV24CY051' AND project_id = 'P06' AND milestone_no = 3$$,
    'a teammate countersigns a pending claim');
SELECT is((SELECT status::text FROM claim WHERE usn = '1RV24CY051' AND project_id = 'P06' AND milestone_no = 3),
          'confirmed', '...and the derived claim status becomes confirmed');
SELECT throws_ok(
    $$INSERT INTO countersign (claim_id, endorser_usn, verdict)
      SELECT claim_id, '1RV24CY051', 'confirm' FROM claim
      WHERE usn = '1RV24CY047' AND project_id = 'P06' AND milestone_no = 5$$,
    '42501', NULL, 'a student cannot countersign in someone else''s name');
SELECT is_empty(
    $$UPDATE claim SET statement = 'Rewrote it after it was confirmed.'
      WHERE usn = '1RV24CY047' AND project_id = 'P06' AND milestone_no = 1 RETURNING 1$$,
    'a confirmed claim cannot be edited (only pending claims are)');
-- An UPDATE whose USING clause matches no row is not an error: it silently updates 0 rows.
SELECT is_empty(
    $$UPDATE milestone SET locked_at = now() WHERE project_id = 'P06' AND milestone_no = 4 RETURNING 1$$,
    'a student cannot lock a milestone (no row is updatable)');
SELECT throws_ok(
    $$INSERT INTO artifact (artifact_id, team_id, project_id, milestone_no, title, type, source, visibility, owner_usn)
      VALUES ('A90', 'T00', 'P06', 5, 'Hidden DFD', 'diagram', 'editor', 'private', '1RV24CY051')$$,
    '42501', NULL, 'a student cannot create a private artifact owned by someone else');
SELECT throws_ok($$TRUNCATE claim CASCADE$$, '42501', NULL, 'a student cannot TRUNCATE');
RESET ROLE;

SELECT pg_temp.become('nikhil');
SELECT lives_ok($$INSERT INTO team_member (team_id, usn, role) VALUES ('T02', '1RV24CY077', 'member')$$,
                'a teamless student joins a team as themself');
SELECT throws_ok($$INSERT INTO team_member (team_id, usn, role) VALUES ('T04', '1RV24CY082', 'member')$$,
                 '42501', NULL, 'a student cannot add someone else to a team');
RESET ROLE;

SELECT pg_temp.become('f01');
SELECT throws_ok(
    $$INSERT INTO claim (usn, team_id, project_id, milestone_no, statement)
      VALUES ('1RV24CY047', 'T00', 'P06', 6, 'Normalized every table up to BCNF.')$$,
    '42501', NULL, 'faculty cannot file claims');
SELECT lives_ok(
    $$INSERT INTO assessment (usn, project_id, milestone_no, marks, assessed_by)
      VALUES ('1RV24CY047', 'P06', 3, 9, 'F01')$$,
    'the teaching faculty enters a mark in their own name');
SELECT throws_ok(
    $$INSERT INTO assessment (usn, project_id, milestone_no, marks, assessed_by)
      VALUES ('1RV24CY051', 'P06', 3, 9, 'F02')$$,
    '42501', NULL, 'faculty cannot sign a mark in another faculty''s name');
SELECT lives_ok(
    $$UPDATE milestone SET locked_at = now() WHERE project_id = 'P06' AND milestone_no = 4$$,
    'the teaching faculty locks a milestone');
SELECT throws_ok(
    $$UPDATE milestone SET max_marks = 25 WHERE project_id = 'P06' AND milestone_no = 4$$,
    '42501', NULL, 'faculty may change nothing on a milestone except locked_at');
SELECT throws_ok(
    $$UPDATE milestone SET locked_at = NULL WHERE project_id = 'P06' AND milestone_no = 1$$,
    '55000', NULL, 'faculty cannot unlock a locked milestone');
RESET ROLE;

SELECT pg_temp.become('f02');
SELECT throws_ok(
    $$INSERT INTO assessment (usn, project_id, milestone_no, marks, assessed_by)
      VALUES ('1RV24CY051', 'P06', 3, 9, 'F02')$$,
    '42501', NULL, 'faculty cannot mark a project they do not teach');
SELECT is_empty(
    $$UPDATE milestone SET locked_at = now() WHERE project_id = 'P06' AND milestone_no = 5 RETURNING 1$$,
    'faculty cannot lock a milestone of a project they do not teach');
RESET ROLE;

SELECT pg_temp.become('admin');
SELECT lives_ok($$UPDATE milestone SET locked_at = NULL WHERE project_id = 'P06' AND milestone_no = 1$$,
                'an admin can unlock a milestone');
SELECT is((SELECT count(*)::int FROM artifact WHERE visibility = 'private'), 0,
          'even an admin does not see private artifacts');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
