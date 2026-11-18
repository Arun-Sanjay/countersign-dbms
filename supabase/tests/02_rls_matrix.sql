-- RLS matrix (gate G3): persona x relation -> number of visible rows, plus targeted
-- privacy and write-permission checks. Runs on the fixture + demo seed inside a
-- transaction that is rolled back (test users vanish with it).
--
-- Personas (app_user rows created below; auth.uid() comes from request.jwt.claims.sub):
--   arun   1RV24CY047  student, teams T00 (P06, solo), T01, T03, T05; owns the PRIVATE artifact A18
--   aditi  1RV24CY011  student, teams T01, T05, T06 (lead); owns the PRIVATE artifact A92 made below
--   meera  1RV24CY033  student, teams T01, T03, T06 (Aditi's teammate in P06)
--   nikhil 1RV24CY077  student with no team
--   f01    F01         teaches CD252IA -> P01, P05, P06
--   f02    F02         teaches CD253IA -> P02 only
--   admin              no usn / faculty_id
--   anon               not signed in: has no table privileges at all ('denied')
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(301);

-- ---------------------------------------------------------------------
-- Fixtures: test auth users + app_user rows (personas made by scripts/ are set aside)
-- ---------------------------------------------------------------------
DELETE FROM app_user;

CREATE TEMP TABLE persona (name TEXT PRIMARY KEY, uid UUID, role TEXT, usn TEXT, faculty_id TEXT);
INSERT INTO persona VALUES
    ('arun',   '00000000-0000-4000-a000-000000000047', 'student', '1RV24CY047', NULL),
    ('aditi',  '00000000-0000-4000-a000-000000000011', 'student', '1RV24CY011', NULL),
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
CREATE TEMP TABLE rls_expect (rel TEXT, arun TEXT, aditi TEXT, meera TEXT, nikhil TEXT,
                              f01 TEXT, f02 TEXT, admin TEXT, anon TEXT);
INSERT INTO rls_expect VALUES
--   relation                  arun  aditi  meera nikhil f01   f02   admin anon
    -- directory: everyone signed in sees every row
    ('student',                '12', '12', '12', '12', '12', '12', '12', 'denied'),
    ('faculty',                '4',  '4',  '4',  '4',  '4',  '4',  '4',  'denied'),
    ('course',                 '4',  '4',  '4',  '4',  '4',  '4',  '4',  'denied'),
    ('project',                '6',  '6',  '6',  '6',  '6',  '6',  '6',  'denied'),
    ('milestone',              '24', '24', '24', '24', '24', '24', '24', 'denied'),
    ('skill',                  '14', '14', '14', '14', '14', '14', '14', 'denied'),
    ('project_skill',          '17', '17', '17', '17', '17', '17', '17', 'denied'),
    ('team',                   '7',  '7',  '7',  '7',  '7',  '7',  '7',  'denied'),
    ('team_member',            '23', '23', '23', '23', '23', '23', '23', 'denied'),
    ('student_skill',          '46', '46', '46', '46', '46', '46', '46', 'denied'),
    ('course_skill',           '12', '12', '12', '12', '12', '12', '12', 'denied'),
    ('academic_term',          '2',  '2',  '2',  '2',  '2',  '2',  '2',  'denied'),
    ('course_offering',        '8',  '8',  '8',  '8',  '8',  '8',  '8',  'denied'),
    ('skill_evidence',         '3',  '3',  '3',  '3',  '3',  '3',  '3',  'denied'),
    -- identity: own row; admin all. enrollment: own; faculty the rolls they teach
    ('app_user',               '1',  '1',  '1',  '1',  '1',  '1',  '7',  'denied'),
    ('enrollment',             '4',  '4',  '4',  '4',  '12', '12', '48', 'denied'),
    -- team content (A18 is Arun's private artifact; chunks 8–9 are the only 'submitted' ones)
    ('artifact',               '15', '9',  '9',  '0',  '14', '2',  '19', 'denied'),
    ('artifact_version',       '8',  '4',  '4',  '0',  '11', '0',  '11', 'denied'),
    ('contribution',           '28', '21', '22', '0',  '25', '6',  '39', 'denied'),
    ('artifact_chunk',         '9',  '6',  '7',  '0',  '2',  '0',  '2',  'denied'),
    ('claim',                  '3',  '5',  '5',  '0',  '8',  '0',  '8',  'denied'),
    ('claim_evidence',         '9',  '6',  '6',  '0',  '15', '0',  '15', 'denied'),
    ('countersign',            '0',  '4',  '4',  '0',  '4',  '0',  '4',  'denied'),
    ('submission',             '2',  '2',  '2',  '0',  '4',  '0',  '4',  'denied'),
    ('submission_artifact',    '4',  '2',  '2',  '0',  '6',  '0',  '6',  'denied'),
    -- marks: own only; the teaching faculty all of their projects
    ('assessment',             '2',  '2',  '2',  '0',  '8',  '0',  '8',  'denied'),
    -- security_invoker views
    ('v_lab_cie_marks',        '1',  '1',  '1',  '0',  '4',  '0',  '4',  'denied'),
    ('v_rubric_sheet',         '54', '61', '68', '0',  '79', '15', '108','denied'),
    ('v_contested_claims',     '0',  '1',  '1',  '0',  '1',  '0',  '1',  'denied'),
    ('v_faculty_team_progress','4',  '3',  '3',  '0',  '4',  '1',  '7',  'denied'),
    ('v_semester_hub',         '6',  '6',  '6',  '5',  '0',  '0',  '0',  'denied'),
    ('v_what_faculty_sees',    '42', '24', '12', '0',  '0',  '0',  '0',  'denied');

-- unpivot to (persona, rel, expected)
CREATE TEMP VIEW rls_expect_long AS
SELECT x.persona, e.rel, x.expected
FROM rls_expect e
CROSS JOIN LATERAL (VALUES ('arun', e.arun), ('aditi', e.aditi), ('meera', e.meera),
                           ('nikhil', e.nikhil), ('f01', e.f01), ('f02', e.f02),
                           ('admin', e.admin), ('anon', e.anon)) AS x(persona, expected);

CREATE TEMP TABLE rls_actual (persona TEXT, rel TEXT, actual TEXT);
GRANT SELECT ON rls_expect TO authenticated, anon;
GRANT INSERT ON rls_actual TO authenticated, anon;

-- Count every relation as the CURRENT role (invoker), recording 'denied' on 42501.
-- The expected numbers are the SEED's. Rows the GitHub ingestion pipeline adds (a webhook
-- replay, the e2e ingestion spec) are left out, so the matrix holds on a database that has
-- seen pipeline traffic: G-prefixed artifacts, versions with a source_ref (commit SHA),
-- github contributions with a full 40-hex SHA, and numbered chunks (chunk_no).
CREATE FUNCTION pg_temp.seed_only(p_rel TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE p_rel
        WHEN 'artifact'         THEN $w$WHERE artifact_id !~ '^G'$w$
        WHEN 'artifact_version' THEN $w$WHERE source_ref IS NULL$w$
        WHEN 'contribution'     THEN $w$WHERE NOT (source = 'github' AND coalesce(source_ref, '') ~ '^[0-9a-f]{40}$')$w$
        WHEN 'artifact_chunk'   THEN $w$WHERE chunk_no IS NULL$w$
        WHEN 'v_what_faculty_sees' THEN $w$WHERE NOT (
                (item_kind = 'artifact' AND item_ref ~ '^G')
             OR (item_kind = 'artifact_version' AND EXISTS (
                    SELECT 1 FROM public.artifact_version v
                    WHERE v.artifact_id || '@v' || v.version_no = item_ref AND v.source_ref IS NOT NULL))
             OR (item_kind = 'contribution' AND EXISTS (
                    SELECT 1 FROM public.contribution k
                    WHERE k.contribution_id::text = item_ref AND k.source = 'github'
                      AND coalesce(k.source_ref, '') ~ '^[0-9a-f]{40}$')))$w$
        ELSE '' END;
$$;

CREATE FUNCTION pg_temp.snapshot(p_persona TEXT) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r TEXT; n BIGINT;
BEGIN
    FOR r IN SELECT rel FROM rls_expect LOOP
        BEGIN
            EXECUTE format('SELECT count(*) FROM public.%I %s', r, pg_temp.seed_only(r)) INTO n;
            INSERT INTO rls_actual VALUES (p_persona, r, n::text);
        EXCEPTION WHEN insufficient_privilege THEN
            INSERT INTO rls_actual VALUES (p_persona, r, 'denied');
        END;
    END LOOP;
END $$;

SELECT pg_temp.become('arun');   SELECT pg_temp.snapshot('arun');   RESET ROLE;
SELECT pg_temp.become('aditi');  SELECT pg_temp.snapshot('aditi');  RESET ROLE;
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
-- A private artifact in a team that HAS teammates (T00 is solo): Aditi's T06 draft A92.
-- Made here, after the matrix, as the test superuser; rolled back with the test.
INSERT INTO artifact (artifact_id, team_id, project_id, milestone_no, title, type, source, visibility, owner_usn)
VALUES ('A92', 'T06', 'P06', 3, 'ER doubts (private)', 'note', 'obsidian', 'private', '1RV24CY011');
INSERT INTO artifact_version (artifact_id, version_no, created_by, content_hash)
VALUES ('A92', 1, '1RV24CY011', encode(sha256('A92/v1'::bytea), 'hex'));

SELECT pg_temp.become('meera');
SELECT is((SELECT count(*)::int FROM artifact WHERE artifact_id = 'A92'), 0,
          'private artifact A92 is invisible to its owner''s teammate (Meera)');
SELECT is((SELECT count(*)::int FROM artifact_version WHERE artifact_id = 'A92'), 0,
          'versions of a private artifact are invisible to a teammate');
SELECT is((SELECT count(*)::int FROM artifact WHERE artifact_id = 'A18'), 0,
          'Arun''s private artifact A18 is invisible to other students');
SELECT is((SELECT count(*)::int FROM assessment WHERE usn = '1RV24CY011'), 0,
          'a student cannot read a teammate''s marks');
SELECT ok((SELECT count(*) FROM v_rubric_sheet WHERE usn = '1RV24CY011') > 0
          AND (SELECT count(*) FROM v_rubric_sheet WHERE usn = '1RV24CY011' AND marks IS NOT NULL) = 0,
          'rubric sheet shows a teammate''s cells but not their marks');
SELECT throws_ok($$SELECT count(*) FROM private.note$$, '42501', NULL,
                 'private notes are not readable directly (schema private has no grants)');
SELECT is((SELECT count(*)::int FROM v_what_faculty_sees WHERE item_ref LIKE 'A92%'), 0,
          '"what faculty sees" never lists a private artifact');
RESET ROLE;

SELECT pg_temp.become('aditi');
SELECT is((SELECT count(*)::int FROM artifact WHERE artifact_id = 'A92'), 1,
          'the owner sees their own private artifact A92');
SELECT is((SELECT count(*)::int FROM v_what_faculty_sees WHERE item_ref LIKE 'A92%'), 0,
          '...but it is absent from the owner''s "what faculty sees" view');
RESET ROLE;

SELECT pg_temp.become('arun');
SELECT is((SELECT count(*)::int FROM artifact WHERE artifact_id = 'A18'), 1,
          'Arun (solo team T00) sees his own private artifact A18');
SELECT is((SELECT count(*)::int FROM v_what_faculty_sees WHERE item_ref LIKE 'A18%'), 0,
          '...and A18 is absent from his "what faculty sees" view');
RESET ROLE;

SELECT pg_temp.become('f01');
SELECT is((SELECT count(*)::int FROM artifact WHERE artifact_id IN ('A18', 'A92')), 0,
          'faculty never see a private artifact, even in a project they teach');
SELECT is((SELECT count(*)::int FROM artifact_chunk WHERE visibility <> 'submitted'), 0,
          'faculty read chunk text only once it is submitted');
SELECT results_eq(
    $$SELECT usn, reduced_30, total_50 FROM v_lab_cie_marks WHERE team_id IN ('T00', 'T06') ORDER BY usn$$,
    $$VALUES ('1RV24CY011'::varchar, 5.0::numeric, 5.0::numeric),
             ('1RV24CY024'::varchar, 5.4::numeric, 5.4::numeric),
             ('1RV24CY033'::varchar, 3.8::numeric, 3.8::numeric),
             ('1RV24CY047'::varchar, 6.0::numeric, 6.0::numeric)$$,
    'lab CIE: (4+16)*30/120 = 5.0, (4.5+17) -> 5.375 -> 5.4, (3+12) -> 3.75 -> 3.8, (5+19) -> 6.0');
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
      VALUES ('1RV24CY047', 'T06', 'P06', 5, 'Drew the level-1 DFD for submissions.')$$,
    '23514', NULL, 'a student cannot file a claim for another team');
-- (Order of checks: BEFORE ROW triggers run before RLS WITH CHECK, so the 0002 membership
--  trigger rejects this row first with 23514; the policy would reject it with 42501.)
SELECT lives_ok(
    $$INSERT INTO claim (usn, team_id, project_id, milestone_no, statement)
      VALUES ('1RV24CY047', 'T00', 'P06', 5, 'Drew the level-0 and level-1 DFDs.')$$,
    'a student files their own claim for their own team');
SELECT is_empty(
    $$UPDATE milestone SET locked_at = now() WHERE project_id = 'P06' AND milestone_no = 4 RETURNING 1$$,
    'a student cannot lock a milestone (no row is updatable)');
SELECT throws_ok($$TRUNCATE claim CASCADE$$, '42501', NULL, 'a student cannot TRUNCATE');
RESET ROLE;

-- Teammate writes, on T06 (T00 is solo, so Arun has no teammate to countersign)
SELECT pg_temp.become('meera');
SELECT throws_ok(
    $$INSERT INTO claim (usn, team_id, project_id, milestone_no, statement)
      VALUES ('1RV24CY011', 'T06', 'P06', 5, 'Drew the level-1 DFD for submissions.')$$,
    '42501', NULL, 'a student cannot file a claim in a teammate''s name');
SELECT lives_ok(
    $$INSERT INTO countersign (claim_id, endorser_usn, verdict)
      SELECT claim_id, '1RV24CY033', 'confirm' FROM claim
      WHERE usn = '1RV24CY011' AND project_id = 'P06' AND milestone_no = 4 AND contribution_type = 'review'$$,
    'a teammate (Meera) countersigns a pending claim');
SELECT is((SELECT status::text FROM claim
           WHERE usn = '1RV24CY011' AND project_id = 'P06' AND milestone_no = 4 AND contribution_type = 'review'),
          'confirmed', '...and the derived claim status becomes confirmed');
SELECT throws_ok(
    $$INSERT INTO countersign (claim_id, endorser_usn, verdict)
      SELECT claim_id, '1RV24CY024', 'confirm' FROM claim
      WHERE usn = '1RV24CY011' AND project_id = 'P06' AND milestone_no = 4 AND contribution_type = 'review'$$,
    '42501', NULL, 'a student cannot countersign in someone else''s name');
SELECT throws_ok(
    $$INSERT INTO artifact (artifact_id, team_id, project_id, milestone_no, title, type, source, visibility, owner_usn)
      VALUES ('A90', 'T06', 'P06', 5, 'Hidden DFD', 'diagram', 'editor', 'private', '1RV24CY011')$$,
    '42501', NULL, 'a student cannot create a private artifact owned by someone else');
RESET ROLE;

SELECT pg_temp.become('aditi');
SELECT is_empty(
    $$UPDATE claim SET statement = 'Rewrote it after it was confirmed.'
      WHERE usn = '1RV24CY011' AND project_id = 'P06' AND milestone_no = 4 RETURNING 1$$,
    'a confirmed claim cannot be edited (only pending claims are)');
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
      VALUES ('1RV24CY033', 'P06', 3, 9, 'F02')$$,
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
      VALUES ('1RV24CY033', 'P06', 3, 9, 'F02')$$,
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
