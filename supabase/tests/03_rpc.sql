-- RPC tests (gate G6): for every 0004 function, the happy path and the refusal paths,
-- per persona. Same persona mechanism as 02_rls_matrix.sql; rolled back at the end.
--
-- pg_temp.err(sql) runs a statement and returns 'ok' or 'SQLSTATE:rule', where rule is the
-- error DETAIL (the RPCs' stable rule key) or, for trigger/constraint errors, the
-- constraint name. One assertion therefore checks both the code and the reason.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(126);

-- ---------------------------------------------------------------------
-- Fixtures
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
    ('admin',  '00000000-0000-4000-a000-0000000000ad', 'admin',   NULL, NULL),
    ('ghost',  '00000000-0000-4000-a000-0000000000ff', NULL,      NULL, NULL);  -- auth user, no profile

INSERT INTO auth.users (id, aud, role, email)
SELECT uid, 'authenticated', 'authenticated', name || '@rpc-test.invalid' FROM persona;
INSERT INTO app_user (user_id, role, usn, faculty_id)
SELECT uid, role, usn, faculty_id FROM persona WHERE role IS NOT NULL;
GRANT SELECT ON persona TO authenticated, anon;

-- ids the personas cannot look up themselves (other people's notes, a claim made mid-test)
CREATE TEMP TABLE ref (name TEXT PRIMARY KEY, id INT);
INSERT INTO ref SELECT 'note_' || owner_usn, note_id FROM private.note;
GRANT SELECT ON ref TO authenticated, anon;

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

CREATE FUNCTION pg_temp.err(p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v_state TEXT; v_detail TEXT; v_constraint TEXT;
BEGIN
    EXECUTE p_sql;
    RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_detail = PG_EXCEPTION_DETAIL,
                            v_constraint = CONSTRAINT_NAME;
    RETURN v_state || ':' || coalesce(nullif(v_detail, ''), nullif(v_constraint, ''), '');
END $$;

-- ---------------------------------------------------------------------
-- A. Catalog: who may call what
-- ---------------------------------------------------------------------
-- caller: who may EXECUTE it. 'authenticated' = signed-in users (runs under their RLS);
-- 'service_role' = the ingestion pipeline only (0005/0006: Edge Function and worker).
CREATE TEMP TABLE rpc (name TEXT PRIMARY KEY, definer BOOLEAN, caller TEXT NOT NULL DEFAULT 'authenticated');
INSERT INTO rpc VALUES
    ('join_team', false), ('leave_team', false), ('submit_milestone', false), ('file_claim', false),
    ('add_claim_evidence', false), ('countersign_claim', false), ('record_assessment', false),
    ('lock_milestone', false), ('find_teammates', false), ('find_full_cover', false),
    ('skill_gap', false), ('skill_subtree', false), ('semester_hub', false),
    ('my_private_notes', true), ('save_private_note', true), ('delete_private_note', true),
    ('search_chunks', false);
INSERT INTO rpc VALUES
    ('ingest_receive', true, 'service_role'), ('ingest_read', true, 'service_role'),
    ('ingest_mark_raw', true, 'service_role'), ('project_push', true, 'service_role'),
    ('ingest_fail', true, 'service_role');                       -- 0006: worker failure outside project_push

SELECT set_eq($$SELECT proname::text FROM pg_proc WHERE pronamespace = 'public'::regnamespace$$,
              $$SELECT name FROM rpc$$, 'public schema holds exactly the 22 RPCs');
SELECT is((SELECT count(*)::int FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
             AND (has_function_privilege('anon', p.oid, 'EXECUTE')
                  OR has_function_privilege('public', p.oid, 'EXECUTE'))),
          0, 'anon / PUBLIC cannot EXECUTE any RPC');
SELECT set_eq($$SELECT proname::text FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
                 AND has_function_privilege('authenticated', p.oid, 'EXECUTE')$$,
              $$SELECT name FROM rpc WHERE caller = 'authenticated'$$,
              'authenticated can EXECUTE exactly the 17 user RPCs (not the 5 pipeline RPCs)');
SELECT set_eq($$SELECT proname::text FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND prosecdef$$,
              $$SELECT name FROM rpc WHERE definer$$,
              'only the private-note and service-only pipeline RPCs are SECURITY DEFINER (everything else runs under RLS)');
SELECT is((SELECT count(*)::int FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
             AND NOT ('search_path=""' = ANY (coalesce(p.proconfig, '{}')))),
          0, 'every RPC pins search_path to empty');

-- ---------------------------------------------------------------------
-- B. Not signed in
-- ---------------------------------------------------------------------
SELECT pg_temp.become('anon');
SELECT is(pg_temp.err($$SELECT semester_hub()$$),        '42501:', 'anon: semester_hub denied');
SELECT is(pg_temp.err($$SELECT join_team('T02')$$),      '42501:', 'anon: join_team denied');
SELECT is(pg_temp.err($$SELECT my_private_notes()$$),    '42501:', 'anon: my_private_notes denied');
SELECT is(pg_temp.err($$SELECT find_teammates('P06')$$), '42501:', 'anon: find_teammates denied');
RESET ROLE;

-- ---------------------------------------------------------------------
-- C. semester_hub (before any test changes the data)
-- ---------------------------------------------------------------------
SELECT pg_temp.become('arun');
SELECT is(semester_hub() ->> 'role', 'student', 'hub/arun: role student');
SELECT is(jsonb_array_length(semester_hub() -> 'courses'), 6, 'hub/arun: 6 (offering, project) rows');
SELECT is((SELECT c ->> 'team_id' FROM jsonb_array_elements(semester_hub() -> 'courses') c
           WHERE c ->> 'project_id' = 'P06'), 'T00', 'hub/arun: P06 row shows team T00');
SELECT is((semester_hub() ->> 'countersign_queue')::int, 1,
          'hub/arun: one teammate claim (Sanvid C3) waits for his countersign');
SELECT is(semester_hub() #>> '{current_term,term_id}', '2026-ODD', 'hub/arun: current term');
RESET ROLE;

SELECT pg_temp.become('nikhil');
SELECT is(jsonb_array_length(semester_hub() -> 'courses'), 5, 'hub/nikhil: 5 rows (section B, no P06)');
RESET ROLE;

SELECT pg_temp.become('f01');
SELECT is(semester_hub() ->> 'role', 'faculty', 'hub/f01: role faculty');
SELECT set_eq($$SELECT p ->> 'project_id' FROM jsonb_array_elements(semester_hub() -> 'projects') p$$,
              ARRAY['P01', 'P06'], 'hub/f01: the projects with teams he teaches');
SELECT is(jsonb_array_length(semester_hub() -> 'offerings'), 2, 'hub/f01: CD252IA sections A and B');
RESET ROLE;

SELECT pg_temp.become('admin');
SELECT is((semester_hub() #>> '{counts,students}')::int, 13, 'hub/admin: institution counts');
RESET ROLE;

SELECT pg_temp.become('ghost');
SELECT is(pg_temp.err($$SELECT semester_hub()$$), '42501:profile_required',
          'hub/ghost: a login without an app_user profile is refused');
RESET ROLE;

-- ---------------------------------------------------------------------
-- D. Skills (read-only RPCs)
-- ---------------------------------------------------------------------
SELECT pg_temp.become('sanvid');
SELECT is(find_teammates('P06') -> 'missing',
          '[{"name": "Transactions", "skill_id": "S05", "required_level": 2},
            {"name": "Python", "skill_id": "S08", "required_level": 2}]'::jsonb,
          'find_teammates/sanvid: Missing = Required(P06) - Mine = {S05, S08}');
SELECT results_eq(
    $$SELECT c ->> 'usn' FROM jsonb_array_elements(find_teammates('P06') -> 'candidates') WITH ORDINALITY AS x(c, i) ORDER BY i$$,
    ARRAY['1RV24CY041'],
    'find_teammates/sanvid: only Python holders enrolled in P06''s offering (section A) are suggested');
SELECT is((SELECT count(*)::int FROM jsonb_array_elements(find_teammates('P06') -> 'candidates') c
           WHERE c ->> 'usn' IN ('1RV24CY047', '1RV24CY011', '1RV24CY024', '1RV24CY033', '1RV24CY051')),
          0, 'find_teammates: never suggests yourself or students already in a P06 team');
SELECT is(skill_gap('P06') -> 'met', '3', 'skill_gap/sanvid: 3 of 5 P06 skills met');
SELECT is((SELECT s ->> 'status' FROM jsonb_array_elements(skill_gap('P06') -> 'skills') s
           WHERE s ->> 'skill_id' = 'S05'), 'missing', 'skill_gap/sanvid: Transactions missing');
SELECT is((SELECT s ->> 'verified_level' FROM jsonb_array_elements(skill_gap('P06') -> 'skills') s
           WHERE s ->> 'skill_id' = 'S06'), '3', 'skill_gap/sanvid: MongoDB verified at 3 by skill_evidence');
RESET ROLE;

-- Enroll two section-B students in P06's offering (rolled back below) to show the ranking.
INSERT INTO enrollment (usn, offering_id)
SELECT u, offering_id FROM project, unnest(ARRAY['1RV24CY077', '1RV24CY052']) AS u WHERE project_id = 'P06';
SELECT pg_temp.become('meera');
SELECT results_eq(
    $$SELECT c ->> 'usn', (c ->> 'covered')::int
      FROM jsonb_array_elements(find_teammates('P06') -> 'candidates') WITH ORDINALITY AS x(c, i) ORDER BY i$$,
    $$VALUES ('1RV24CY077', 3), ('1RV24CY041', 3), ('1RV24CY052', 1)$$,
    'find_teammates/meera: ranked by missing skills covered, then total level (11 > 10)');
RESET ROLE;
DELETE FROM enrollment WHERE usn IN ('1RV24CY077', '1RV24CY052')
  AND offering_id = (SELECT offering_id FROM project WHERE project_id = 'P06');
SELECT pg_temp.become('meera');
SELECT is(skill_gap('P06', '1RV24CY033') #>> '{skills,1,status}', 'below',
          'skill_gap/meera: Normalization declared 2 < required 3 -> below');
RESET ROLE;

SELECT pg_temp.become('arun');
SELECT is(find_teammates('P06') -> 'candidates', '[]'::jsonb,
          'find_teammates/arun: covers every P06 skill, so no complements are needed');
SELECT is(pg_temp.err($$SELECT find_teammates('P99')$$), 'P0002:project_not_found',
          'find_teammates: unknown project');
SELECT results_eq(
    $$SELECT f ->> 'usn' FROM jsonb_array_elements(find_full_cover('P01')) f$$,
    ARRAY['1RV24CY011', '1RV24CY041', '1RV24CY047', '1RV24CY077'],
    'find_full_cover: StudentSkill ÷ Required(P01) (double NOT EXISTS)');
SELECT is(find_full_cover('P01') -> 3 -> 'team_id', 'null'::jsonb,
          'find_full_cover: Nikhil covers P01 and has no P01 team');
SELECT results_eq($$SELECT f ->> 'usn' FROM jsonb_array_elements(find_full_cover('P06')) f$$,
                  ARRAY['1RV24CY047'], 'find_full_cover: only Arun meets every P06 min_level');
SELECT is(pg_temp.err($$SELECT find_full_cover('P99')$$), 'P0002:project_not_found',
          'find_full_cover: unknown project');
SELECT results_eq(
    $$SELECT s ->> 'skill_id' FROM jsonb_array_elements(skill_subtree('S01')) WITH ORDINALITY AS x(s, i) ORDER BY i$$,
    ARRAY['S01', 'S02', 'S05', 'S03', 'S06', 'S04'],
    'skill_subtree(S01): recursive CTE in depth-first order');
SELECT is(skill_subtree('S01') -> 2 ->> 'path', 'Databases > SQL > Transactions',
          'skill_subtree: path built level by level');
SELECT is(pg_temp.err($$SELECT skill_subtree('S99')$$), 'P0002:skill_not_found', 'skill_subtree: unknown skill');
SELECT is(pg_temp.err($$SELECT skill_gap('P06', '1RV24CY999')$$), 'P0002:student_not_found',
          'skill_gap: unknown student');
RESET ROLE;

SELECT pg_temp.become('f01');
SELECT is(jsonb_array_length(find_teammates('P06') -> 'missing'), 5,
          'find_teammates/f01: no skills of his own, so all 5 required skills are missing');
SELECT is(pg_temp.err($$SELECT skill_gap('P06')$$), '22023:usn',
          'skill_gap/f01: must say which student (no usn of his own)');
RESET ROLE;

-- ---------------------------------------------------------------------
-- E. join_team / leave_team
-- ---------------------------------------------------------------------
SELECT pg_temp.become('arun');
SELECT is(pg_temp.err($$SELECT join_team('T02')$$), '23505:one_team_per_project',
          'join_team/arun: already in T01 for P01 (trigger rule)');
RESET ROLE;

SELECT pg_temp.become('nikhil');
SELECT is(join_team('T02') ->> 'members', '4', 'join_team/nikhil: joins T02 (now 4/4)');
SELECT is(pg_temp.err($$SELECT join_team('T02')$$), '23505:already_member', 'join_team: already a member');
SELECT is(pg_temp.err($$SELECT join_team('T01')$$), '23514:team_capacity', 'join_team: T01 is full (capacity v2)');
SELECT is(pg_temp.err($$SELECT join_team('T99')$$), 'P0002:team_not_found', 'join_team: unknown team');
SELECT is(leave_team('T02') ->> 'members', '3', 'leave_team/nikhil: leaves T02 again');
SELECT is(pg_temp.err($$SELECT leave_team('T02')$$), 'P0002:not_a_member', 'leave_team: not a member');
RESET ROLE;

SELECT pg_temp.become('arun');
SELECT is(pg_temp.err($$SELECT leave_team('T00')$$), '55000:leave_team_has_history',
          'leave_team/arun: has claims and contributions in T00, so cannot leave');
RESET ROLE;

SELECT pg_temp.become('f01');
SELECT is(pg_temp.err($$SELECT join_team('T02')$$),  '42501:student_required', 'join_team/f01: faculty cannot join');
SELECT is(pg_temp.err($$SELECT leave_team('T02')$$), '42501:student_required', 'leave_team/f01: refused');
RESET ROLE;

-- ---------------------------------------------------------------------
-- F. submit_milestone
-- ---------------------------------------------------------------------
SELECT pg_temp.become('arun');
SELECT lives_ok($$INSERT INTO artifact (artifact_id, team_id, project_id, milestone_no, title, type, source)
                  VALUES ('A21', 'T00', 'P06', 5, 'DFD level 0', 'diagram', 'editor')$$,
                'setup: an artifact with no saved version yet');
RESET ROLE;

SELECT pg_temp.become('sanvid');
SELECT is(submit_milestone('T00', 3, ARRAY['A17']) -> 'artifacts',
          '[{"artifact_id": "A17", "version_no": 1}]'::jsonb,
          'submit/sanvid: freezes the latest version of A17');
SELECT is((SELECT visibility::text FROM artifact WHERE artifact_id = 'A17'), 'submitted',
          'submit: the artifact is now visible to the teaching faculty');
SELECT is(submit_milestone('T00', 3, ARRAY['A17', 'A17']) ->> 'attempt_no', '2',
          'submit: resubmission gets attempt_no 2 (duplicates in the list ignored)');
SELECT is(pg_temp.err($$SELECT submit_milestone('T00', 1, ARRAY['A13'])$$), '55000:milestone_locked',
          'submit: C1 is locked');
SELECT is(pg_temp.err($$SELECT submit_milestone('T00', 3, ARRAY['A18'])$$), '55000:artifact_private',
          'submit: a private artifact must be shared first');
SELECT is(pg_temp.err($$SELECT submit_milestone('T00', 5, ARRAY['A21'])$$), '55000:artifact_no_version',
          'submit: an artifact with no version cannot be frozen');
SELECT is(pg_temp.err($$SELECT submit_milestone('T00', 3, ARRAY['A19'])$$), 'P0002:artifact_not_found',
          'submit: another team''s artifact is not found');
SELECT is(pg_temp.err($$SELECT submit_milestone('T00', 3, ARRAY[]::text[])$$), '22023:artifacts_required',
          'submit: at least one artifact');
SELECT is(pg_temp.err($$SELECT submit_milestone('T00', 99, ARRAY['A17'])$$), 'P0002:milestone_not_found',
          'submit: unknown component');
SELECT is(pg_temp.err($$INSERT INTO submission (team_id, project_id, milestone_no, submitted_by, attempt_no)
                        VALUES ('T00', 'P06', 1, '1RV24CY051', 2)$$), '55000:milestone_locked',
          'submit: a direct INSERT on a locked component is refused by the trigger too');
RESET ROLE;

SELECT pg_temp.become('meera');
SELECT is(pg_temp.err($$SELECT submit_milestone('T00', 3, ARRAY['A17'])$$), '42501:team_member_required',
          'submit/meera: not a member of T00');
RESET ROLE;
SELECT pg_temp.become('f01');
SELECT is(pg_temp.err($$SELECT submit_milestone('T00', 3, ARRAY['A17'])$$), '42501:team_member_required',
          'submit/f01: faculty cannot submit');
RESET ROLE;

-- ---------------------------------------------------------------------
-- G. Claims: file_claim, add_claim_evidence, countersign_claim
-- ---------------------------------------------------------------------
SELECT pg_temp.become('sanvid');
SELECT is(file_claim('P06', 5, 'design', 'Drew the level-0 and level-1 DFDs for claims.', 'none', 'A17')
              - 'claim_id',
          '{"usn": "1RV24CY051", "team_id": "T00", "project_id": "P06", "milestone_no": 5,
            "status": "pending",
            "evidence": [{"evidence_no": 1, "artifact_id": "A17", "version_no": 1}]}'::jsonb,
          'file_claim/sanvid: team derived, pending, latest A17 version cited as evidence #1');
RESET ROLE;
INSERT INTO ref SELECT 'sanvid_c5', claim_id FROM claim WHERE usn = '1RV24CY051' AND milestone_no = 5;
INSERT INTO ref SELECT 'arun_c1',   claim_id FROM claim WHERE usn = '1RV24CY047' AND project_id = 'P06' AND milestone_no = 1;

SELECT pg_temp.become('sanvid');
SELECT is((SELECT contribution_type::text FROM claim WHERE claim_id = (SELECT id FROM ref WHERE name = 'sanvid_c5')),
          'design', 'file_claim: contribution_type stored on the claim');
SELECT is(pg_temp.err($$SELECT file_claim('P06', 1, 'documentation', 'Rewrote the synopsis.')$$),
          '55000:milestone_locked', 'file_claim: locked component');
SELECT is(pg_temp.err($$SELECT file_claim('P06', 5, 'coding', 'Drew the level-1 DFD.')$$),
          '22023:contribution_type', 'file_claim: unknown contribution type');
SELECT is(pg_temp.err($$SELECT file_claim('P06', 5, 'design', '   DFD    ')$$),
          '22023:statement', 'file_claim: statement under 10 characters');
SELECT is(pg_temp.err($$SELECT file_claim('P06', 5, 'design', 'Drew the level-1 DFD.', 'maybe')$$),
          '22023:ai_assistance', 'file_claim: bad ai_assistance');
SELECT is(pg_temp.err($$SELECT file_claim('P06', 5, 'design', 'Drew the level-1 DFD.', 'none', 'A19')$$),
          'P0002:artifact_not_found', 'file_claim: cannot cite another team''s artifact');
SELECT is(pg_temp.err($$SELECT file_claim('P06', 5, 'design', 'Drew the level-1 DFD.', 'none', 'A21')$$),
          '55000:artifact_no_version', 'file_claim: cited artifact has no version');

-- evidence on her pending C5 claim
SELECT is(add_claim_evidence((SELECT id FROM ref WHERE name = 'sanvid_c5'), 'url',
                             'https://app.diagrams.net/dfd', 'draw.io board') ->> 'evidence_no',
          '2', 'add_claim_evidence: url -> evidence #2');
SELECT is(add_claim_evidence((SELECT id FROM ref WHERE name = 'sanvid_c5'), 'artifact_version', 'A13@v2')
              -> 'version_no', '2', 'add_claim_evidence: an explicit artifact version (A13@v2)');
SELECT is(add_claim_evidence((SELECT id FROM ref WHERE name = 'sanvid_c5'), 'contribution',
                             (SELECT contribution_id::text FROM contribution WHERE source_ref = 'A17@v1'))
              ->> 'evidence_no', '4', 'add_claim_evidence: a contribution by id -> evidence #4');
SELECT is(pg_temp.err(format($$SELECT add_claim_evidence(%s, 'commit', 'not-a-sha')$$,
                             (SELECT id FROM ref WHERE name = 'sanvid_c5'))),
          '22023:ref', 'add_claim_evidence: commit must be a hex SHA');
SELECT is(pg_temp.err(format($$SELECT add_claim_evidence(%s, 'fax', 'x')$$,
                             (SELECT id FROM ref WHERE name = 'sanvid_c5'))),
          '22023:kind', 'add_claim_evidence: unknown kind');
SELECT is(pg_temp.err(format($$SELECT add_claim_evidence(%s, 'artifact_version', 'A19@v1')$$,
                             (SELECT id FROM ref WHERE name = 'sanvid_c5'))),
          'P0002:ref', 'add_claim_evidence: another team''s version is not found');
SELECT is(pg_temp.err($$SELECT add_claim_evidence(999999, 'url', 'https://x.org')$$),
          'P0002:claim_not_found', 'add_claim_evidence: unknown claim');
RESET ROLE;

SELECT pg_temp.become('arun');
SELECT is(pg_temp.err(format($$SELECT add_claim_evidence(%s, 'url', 'https://x.org')$$,
                             (SELECT id FROM ref WHERE name = 'sanvid_c5'))),
          '42501:claim_owner_required', 'add_claim_evidence/arun: not his claim');
SELECT is(pg_temp.err(format($$SELECT add_claim_evidence(%s, 'url', 'https://x.org')$$,
                             (SELECT id FROM ref WHERE name = 'arun_c1'))),
          '55000:claim_not_pending', 'add_claim_evidence/arun: his C1 claim is confirmed, evidence frozen');
SELECT is(pg_temp.err($$SELECT file_claim('P06', 5, 'design', 'Cited Sanvid''s private notes.', 'none', 'A18')$$),
          'P0002:artifact_not_found', 'file_claim/arun: a teammate''s private artifact is invisible');
RESET ROLE;

SELECT pg_temp.become('meera');
SELECT is(pg_temp.err(format($$SELECT add_claim_evidence(%s, 'url', 'https://x.org')$$,
                             (SELECT id FROM ref WHERE name = 'sanvid_c5'))),
          'P0002:claim_not_found', 'add_claim_evidence/meera: other team''s claim is invisible');
SELECT is(pg_temp.err(format($$SELECT countersign_claim(%s, 'confirm')$$,
                             (SELECT id FROM ref WHERE name = 'sanvid_c5'))),
          'P0002:claim_not_found', 'countersign/meera: cannot see (so cannot sign) another team''s claim');
SELECT is(pg_temp.err($$SELECT file_claim('P01', 6, 'design', 'Normalized every table to BCNF.')$$),
          'P0002:milestone_not_found', 'file_claim/meera: P01 has no component 6');
RESET ROLE;

SELECT pg_temp.become('nikhil');
SELECT is(pg_temp.err($$SELECT file_claim('P06', 5, 'design', 'Drew the level-1 DFD.')$$),
          '42501:project_member_required', 'file_claim/nikhil: not in a P06 team');
RESET ROLE;
SELECT pg_temp.become('f01');
SELECT is(pg_temp.err($$SELECT file_claim('P06', 5, 'design', 'Drew the level-1 DFD.')$$),
          '42501:student_required', 'file_claim/f01: faculty cannot file claims');
SELECT is(pg_temp.err(format($$SELECT countersign_claim(%s, 'confirm')$$,
                             (SELECT id FROM ref WHERE name = 'sanvid_c5'))),
          '42501:student_required', 'countersign/f01: faculty cannot countersign');
RESET ROLE;

SELECT pg_temp.become('sanvid');
SELECT is(pg_temp.err(format($$SELECT countersign_claim(%s, 'confirm')$$,
                             (SELECT id FROM ref WHERE name = 'sanvid_c5'))),
          '23514:countersign_not_self', 'countersign/sanvid: not his own claim');
RESET ROLE;

SELECT pg_temp.become('arun');
SELECT is(pg_temp.err(format($$SELECT countersign_claim(%s, 'dispute')$$,
                             (SELECT id FROM ref WHERE name = 'sanvid_c5'))),
          '22023:comment', 'countersign: a dispute needs a comment');
SELECT is(pg_temp.err(format($$SELECT countersign_claim(%s, 'maybe')$$,
                             (SELECT id FROM ref WHERE name = 'sanvid_c5'))),
          '22023:verdict', 'countersign: verdict is confirm or dispute');
SELECT is(countersign_claim((SELECT id FROM ref WHERE name = 'sanvid_c5'), 'confirm')
              - 'endorser_usn' - 'claim_id',
          '{"verdict": "confirm", "revised": false, "claim_status": "confirmed"}'::jsonb,
          'countersign/arun: confirm -> claim confirmed (derived by trigger)');
SELECT is(countersign_claim((SELECT id FROM ref WHERE name = 'sanvid_c5'), 'dispute', 'The level-1 DFD was mine.')
              - 'endorser_usn' - 'claim_id',
          '{"verdict": "dispute", "revised": true, "claim_status": "contested"}'::jsonb,
          'countersign/arun: revising to dispute -> claim contested');
RESET ROLE;

SELECT pg_temp.become('sanvid');
SELECT is(pg_temp.err(format($$SELECT add_claim_evidence(%s, 'url', 'https://x.org')$$,
                             (SELECT id FROM ref WHERE name = 'sanvid_c5'))),
          '55000:claim_not_pending', 'add_claim_evidence: a contested claim''s evidence is frozen');
RESET ROLE;

-- ---------------------------------------------------------------------
-- H. Marks: record_assessment, lock_milestone
-- ---------------------------------------------------------------------
SELECT pg_temp.become('f01');
SELECT is(record_assessment('1RV24CY051', 'P06', 3, 8.5, 'Clear weak entities') - 'assessed_at',
          '{"usn": "1RV24CY051", "project_id": "P06", "milestone_no": 3, "marks": 8.5,
            "assessed_by": "F01", "inserted": true}'::jsonb,
          'record_assessment/f01: first mark is an INSERT');
SELECT is(record_assessment('1RV24CY051', 'P06', 3, 9) ->> 'inserted', 'false',
          'record_assessment/f01: second call is an UPDATE (upsert)');
SELECT is((SELECT marks FROM assessment WHERE usn = '1RV24CY051' AND project_id = 'P06' AND milestone_no = 3),
          9.0, '...and the stored mark is the new one');
SELECT is(pg_temp.err($$SELECT record_assessment('1RV24CY051', 'P06', 3, 11)$$),
          '23514:assessment_marks_le_max', 'record_assessment: 11 > max 10 (trigger)');
SELECT is(pg_temp.err($$SELECT record_assessment('1RV24CY051', 'P06', 1, 3)$$),
          '55000:milestone_locked', 'record_assessment: C1 is locked (trigger)');
SELECT is(pg_temp.err($$SELECT record_assessment('1RV24CY077', 'P06', 3, 5)$$),
          '23514:assessment_member_required', 'record_assessment: Nikhil is in no P06 team');
SELECT is(pg_temp.err($$SELECT record_assessment('1RV24CY051', 'P06', 3, 8.25)$$),
          '22023:marks', 'record_assessment: at most one decimal');
SELECT is(pg_temp.err($$SELECT record_assessment('1RV24CY051', 'P06', 42, 1)$$),
          'P0002:milestone_not_found', 'record_assessment: unknown component');
SELECT is(pg_temp.err($$SELECT lock_milestone('P06', 99)$$), 'P0002:milestone_not_found',
          'lock_milestone: unknown component');
SELECT is(lock_milestone('P06', 3) - 'locked_at',
          '{"project_id": "P06", "milestone_no": 3, "marks_recorded": 1, "students": 5, "unmarked": 4}'::jsonb,
          'lock_milestone/f01: locks C3 and reports 4 students still unmarked');
SELECT is(pg_temp.err($$SELECT lock_milestone('P06', 3)$$), '55000:milestone_locked',
          'lock_milestone: already locked');
SELECT is(pg_temp.err($$SELECT record_assessment('1RV24CY047', 'P06', 3, 7)$$), '55000:milestone_locked',
          'record_assessment: no mark after the lock');
RESET ROLE;

SELECT pg_temp.become('sanvid');
SELECT is(pg_temp.err($$SELECT submit_milestone('T00', 3, ARRAY['A17'])$$), '55000:milestone_locked',
          'submit: C3 is now locked, so no further attempt');
SELECT is(pg_temp.err($$SELECT record_assessment('1RV24CY051', 'P06', 5, 10)$$), '42501:faculty_required',
          'record_assessment/sanvid: students cannot mark');
SELECT is(pg_temp.err($$SELECT lock_milestone('P06', 5)$$), '42501:teaches_project_required',
          'lock_milestone/sanvid: students cannot lock');
RESET ROLE;

SELECT pg_temp.become('f02');
SELECT is(pg_temp.err($$SELECT record_assessment('1RV24CY051', 'P06', 5, 9)$$),
          '42501:teaches_project_required', 'record_assessment/f02: does not teach P06');
SELECT is(pg_temp.err($$SELECT lock_milestone('P06', 5)$$), '42501:teaches_project_required',
          'lock_milestone/f02: does not teach P06');
RESET ROLE;

SELECT pg_temp.become('admin');
SELECT is(pg_temp.err($$SELECT record_assessment('1RV24CY051', 'P06', 5, 9)$$), '42501:faculty_required',
          'record_assessment/admin: marks are signed by a faculty member');
SELECT is(lock_milestone('P06', 6) ->> 'milestone_no', '6', 'lock_milestone/admin: may lock any project');
RESET ROLE;

-- ---------------------------------------------------------------------
-- I. Private notes (SECURITY DEFINER + explicit owner check)
-- ---------------------------------------------------------------------
SELECT pg_temp.become('sanvid');
SELECT results_eq($$SELECT n ->> 'title' FROM jsonb_array_elements(my_private_notes()) n$$,
                  ARRAY['Viva prep: weak entities'], 'notes/sanvid: sees only his own note');
SELECT is(save_private_note('Normalization doubts', 'Is team_member in BCNF?', NULL, 'T00') ->> 'title',
          'Normalization doubts', 'save_private_note/sanvid: creates a note');
SELECT is(jsonb_array_length(my_private_notes()), 2, 'notes/sanvid: now two notes');
SELECT is(save_private_note('Viva prep: weak entities (v2)', 'Partial key = milestone_no.',
                            (SELECT id FROM ref WHERE name = 'note_1RV24CY051')) ->> 'title',
          'Viva prep: weak entities (v2)', 'save_private_note/sanvid: updates his own note');
SELECT is(pg_temp.err($$SELECT save_private_note('', 'empty title')$$), '22023:title',
          'save_private_note: a title is required');
SELECT is(pg_temp.err($$SELECT save_private_note('Spy', 'x', NULL, 'T06')$$), '42501:team_member_required',
          'save_private_note: cannot file a note under someone else''s team');
RESET ROLE;

SELECT pg_temp.become('arun');
SELECT results_eq($$SELECT n ->> 'title' FROM jsonb_array_elements(my_private_notes()) n$$,
                  ARRAY['Race finding to explain'], 'notes/arun: his own note, never his teammate''s');
SELECT is(pg_temp.err(format($$SELECT save_private_note('Hijack', 'x', %s)$$,
                             (SELECT id FROM ref WHERE name = 'note_1RV24CY051'))),
          'P0002:note_not_found', 'save_private_note/arun: a teammate''s note looks like a missing note');
SELECT is(pg_temp.err(format($$SELECT delete_private_note(%s)$$,
                             (SELECT id FROM ref WHERE name = 'note_1RV24CY051'))),
          'P0002:note_not_found', 'delete_private_note/arun: cannot delete a teammate''s note');
RESET ROLE;

SELECT pg_temp.become('f01');
SELECT is(pg_temp.err($$SELECT my_private_notes()$$), '42501:student_required',
          'notes/f01: faculty have no notes and see none');
RESET ROLE;
SELECT pg_temp.become('admin');
SELECT is(pg_temp.err($$SELECT my_private_notes()$$), '42501:student_required',
          'notes/admin: not even an admin reads private notes');
RESET ROLE;

SELECT pg_temp.become('sanvid');
SELECT is(delete_private_note((SELECT id FROM ref WHERE name = 'note_1RV24CY051')) ->> 'deleted', 'true',
          'delete_private_note/sanvid: deletes his own note');
SELECT is(jsonb_array_length(my_private_notes()), 1, 'notes/sanvid: one note left');
RESET ROLE;

-- ---------------------------------------------------------------------
-- J. skill_subtree survives a cycle in bad data (CYCLE clause)
-- ---------------------------------------------------------------------
SELECT pg_temp.become('admin');
UPDATE skill SET parent_skill_id = 'S05' WHERE skill_id = 'S01';   -- S01 -> S02 -> S05 -> S01
SELECT is(jsonb_array_length(skill_subtree('S01')), 6,
          'skill_subtree: a parent cycle S01->S02->S05->S01 terminates (CYCLE ... SET is_cycle)');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
