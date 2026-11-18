-- Abuse cases (review round 1): each security / integrity finding is replayed as the
-- attacker would do it (direct table writes through the API role, not the friendly RPCs)
-- and must now be refused BY THE DATABASE. Rolled back at the end.
--   err() returns 'SQLSTATE:rule_key' (constraint name, else DETAIL) or 'ok'.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(53);

DELETE FROM app_user;
CREATE TEMP TABLE persona (name TEXT PRIMARY KEY, uid UUID, role TEXT, usn TEXT, faculty_id TEXT);
INSERT INTO persona VALUES
    ('arun',    '00000000-0000-4000-a000-000000000047', 'student', '1RV24CY047', NULL),
    ('aditi',   '00000000-0000-4000-a000-000000000011', 'student', '1RV24CY011', NULL),   -- T06 lead
    ('karthik', '00000000-0000-4000-a000-000000000024', 'student', '1RV24CY024', NULL),   -- T06
    ('meera',   '00000000-0000-4000-a000-000000000033', 'student', '1RV24CY033', NULL),
    ('nikhil',  '00000000-0000-4000-a000-000000000077', 'student', '1RV24CY077', NULL),
    ('ananya',  '00000000-0000-4000-a000-000000000082', 'student', '1RV24CY082', NULL),
    ('f01',     '00000000-0000-4000-a000-0000000000f1', 'faculty', NULL, 'F01'),
    ('ghost',   '00000000-0000-4000-a000-00000000dead', NULL,      NULL, NULL);   -- signed up, no profile
INSERT INTO auth.users (id, aud, role, email)
SELECT uid, 'authenticated', 'authenticated', name || '@abuse-test.invalid' FROM persona;
INSERT INTO app_user (user_id, role, usn, faculty_id)
SELECT uid, role, usn, faculty_id FROM persona WHERE role IS NOT NULL;
GRANT SELECT ON persona TO authenticated;

CREATE TEMP TABLE ref (name TEXT PRIMARY KEY, id INT);
INSERT INTO ref
-- karthik_c1: confirmed by Aditi, on the locked C1. aditi_rev: her pending C4 review claim.
SELECT 'karthik_c1', claim_id FROM claim WHERE usn = '1RV24CY024' AND project_id = 'P06' AND milestone_no = 1 UNION ALL
SELECT 'aditi_rev',  claim_id FROM claim WHERE usn = '1RV24CY011' AND project_id = 'P06' AND milestone_no = 4
                                         AND contribution_type = 'review' UNION ALL
SELECT 'sub_t00_c4', submission_id FROM submission WHERE team_id = 'T00' AND milestone_no = 4 UNION ALL
SELECT 'karthik_sql', contribution_id FROM contribution WHERE usn = '1RV24CY024' AND source_ref = 'A20@v1';
GRANT SELECT, INSERT ON ref TO authenticated;

CREATE FUNCTION pg_temp.become(p_name TEXT) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub', uid, 'role', 'authenticated')::text, true)
    FROM persona WHERE name = p_name;
    PERFORM set_config('role', 'authenticated', true);
END $$;

CREATE FUNCTION pg_temp.err(p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v_state TEXT; v_detail TEXT; v_constraint TEXT;
BEGIN
    EXECUTE p_sql;
    RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_detail = PG_EXCEPTION_DETAIL,
                            v_constraint = CONSTRAINT_NAME;
    RETURN v_state || ':' || coalesce(nullif(v_constraint, ''), nullif(v_detail, ''), '');
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.err(TEXT) TO authenticated;

-- ---------------------------------------------------------------------
-- 1. Team membership: enrollment, history, role
-- ---------------------------------------------------------------------
SELECT pg_temp.become('nikhil');   -- section B: not enrolled in P06's offering (section A)
SELECT is(pg_temp.err($$INSERT INTO team_member (team_id, usn, role) VALUES ('T06', '1RV24CY077', 'member')$$),
          '23514:team_member_enrolled_required', 'enrollment: an outsider cannot join a P06 team directly');
SELECT is(pg_temp.err($$SELECT join_team('T06')$$), '23514:team_member_enrolled_required',
          'enrollment: ... nor through join_team');
SELECT is((SELECT count(*)::int FROM claim WHERE team_id = 'T06'), 0,
          'enrollment: so T06''s claims stay invisible to him');
-- role is server-chosen for end users: asking for 'lead' in a team that has one gives 'member'
SELECT is(pg_temp.err($$INSERT INTO team_member (team_id, usn, role) VALUES ('T02', '1RV24CY077', 'lead')$$),
          'ok', 'role: a student joins T02 asking to be lead ...');
SELECT is((SELECT role::text FROM team_member WHERE team_id = 'T02' AND usn = '1RV24CY077'), 'member',
          'role: ... and is made a member (T02 already has a lead)');
SELECT is(pg_temp.err($$INSERT INTO team_member (team_id, usn, joined_at) VALUES ('T04', '1RV24CY077', '2020-01-01')$$),
          '42501:', 'joined_at is server-owned (no column privilege): no backdated membership');
SELECT is(pg_temp.err($$DELETE FROM team_member WHERE team_id = 'T02' AND usn = '1RV24CY077'$$),
          'ok', 'history: a member with no recorded work may leave with a plain DELETE');
RESET ROLE;

SELECT pg_temp.become('arun');
SELECT is(pg_temp.err($$DELETE FROM team_member WHERE team_id = 'T00' AND usn = '1RV24CY047'$$),
          '55000:leave_team_has_history', 'history: a direct DELETE cannot skip leave_team''s rule');
SELECT is((SELECT count(*)::int FROM team_member WHERE team_id = 'T00' AND usn = '1RV24CY047'), 1,
          'history: ... Arun is still in T00');
RESET ROLE;

-- Countersign laundering: join, confirm, leave. The confirm is history, so leaving fails.
SELECT pg_temp.become('meera');
INSERT INTO ref SELECT 'meera_c5', (file_claim('P06', 5, 'design', 'Drew the level-1 DFD for issue/return.') ->> 'claim_id')::int;
RESET ROLE;
SELECT pg_temp.become('ananya');   -- section A, enrolled, not in a P06 team: may join T06
SELECT is(join_team('T06') ->> 'members', '4', 'laundering: Ananya joins T06 (4/4)');
SELECT is(countersign_claim((SELECT id FROM ref WHERE name = 'meera_c5'), 'confirm') ->> 'claim_status',
          'confirmed', 'laundering: ... confirms Meera''s claim');
SELECT is(pg_temp.err($$SELECT leave_team('T06')$$), '55000:leave_team_has_history',
          'laundering: ... and can no longer leave, so the confirm is always a teammate''s');
RESET ROLE;

SELECT is(pg_temp.err($$UPDATE team SET project_id = 'P03' WHERE team_id = 'T03'$$),
          '23514:team_project_immutable', 'one team per project: a staffed team cannot move project');
SELECT is(pg_temp.err($$UPDATE team_member SET role = 'lead' WHERE team_id = 'T06' AND usn = '1RV24CY024'$$),
          '23505:team_member_one_lead', 'role: at most one lead per team (partial UNIQUE index)');
SELECT is(pg_temp.err($$UPDATE team_member SET role = 'captain' WHERE team_id = 'T06' AND usn = '1RV24CY024'$$),
          '23514:team_member_role_check', 'role: lead or member only (CHECK)');

-- ---------------------------------------------------------------------
-- 2. Locked components: nothing about a locked claim changes, on any path
-- ---------------------------------------------------------------------
SELECT pg_temp.become('arun');
SELECT is(pg_temp.err($$INSERT INTO claim (usn, team_id, project_id, milestone_no, statement)
                        VALUES ('1RV24CY047', 'T00', 'P06', 1, 'A late claim on the locked synopsis.')$$),
          '55000:milestone_locked', 'lock: a direct claim INSERT on locked C1 is refused');
RESET ROLE;
SELECT pg_temp.become('karthik');
SELECT is(pg_temp.err(format($$INSERT INTO claim_evidence (claim_id, evidence_no, kind, ref)
                               VALUES (%s, 99, 'url', 'https://evil.example/after-confirm')$$,
                             (SELECT id FROM ref WHERE name = 'karthik_c1'))),
          '55000:claim_not_pending', 'evidence: none can be added to a confirmed claim (direct INSERT)');
RESET ROLE;

SELECT pg_temp.become('aditi');    -- she confirmed Karthik's C1 claim
SELECT is(pg_temp.err(format($$DELETE FROM countersign WHERE claim_id = %s$$, (SELECT id FROM ref WHERE name = 'karthik_c1'))),
          '55000:milestone_locked', 'lock: a countersign on a locked claim cannot be withdrawn');
SELECT is(pg_temp.err(format($$UPDATE countersign SET verdict = 'dispute', comment = 'changed my mind'
                               WHERE claim_id = %s$$, (SELECT id FROM ref WHERE name = 'karthik_c1'))),
          '55000:milestone_locked', 'lock: ... nor flipped to a dispute');
SELECT is(pg_temp.err(format($$UPDATE claim SET milestone_no = 1 WHERE claim_id = %s$$, (SELECT id FROM ref WHERE name = 'aditi_rev'))),
          '55000:milestone_locked', 'lock: a pending claim cannot be moved onto a locked component');
RESET ROLE;
SELECT is((SELECT status::text FROM claim WHERE claim_id = (SELECT id FROM ref WHERE name = 'karthik_c1')),
          'confirmed', 'lock: Karthik''s C1 receipt is unchanged');

-- ---------------------------------------------------------------------
-- 3. Countersign is bound to the revision the signer read
-- ---------------------------------------------------------------------
INSERT INTO ref SELECT 'rev_before', revision FROM claim WHERE claim_id = (SELECT id FROM ref WHERE name = 'aditi_rev');
SELECT pg_temp.become('aditi');
UPDATE claim SET statement = 'I answered the WHOLE Test and wrote every query myself.'
WHERE claim_id = (SELECT id FROM ref WHERE name = 'aditi_rev');
RESET ROLE;
SELECT is((SELECT revision FROM claim WHERE claim_id = (SELECT id FROM ref WHERE name = 'aditi_rev')),
          (SELECT id + 1 FROM ref WHERE name = 'rev_before'), 'revision: editing the statement bumps claim.revision');
SELECT pg_temp.become('meera');     -- Meera's screen still shows the old revision
SELECT is(pg_temp.err(format($$SELECT countersign_claim(%s, 'confirm', NULL, %s)$$,
                             (SELECT id FROM ref WHERE name = 'aditi_rev'), (SELECT id FROM ref WHERE name = 'rev_before'))),
          '55000:countersign_stale_revision', 'revision: a confirm of the text she read is refused after the edit');
SELECT is(countersign_claim((SELECT id FROM ref WHERE name = 'aditi_rev'), 'confirm', NULL,
                            (SELECT revision FROM claim WHERE claim_id = (SELECT id FROM ref WHERE name = 'aditi_rev')))
              ->> 'claim_status', 'confirmed', 'revision: re-reading and signing the current revision works');
RESET ROLE;
SELECT pg_temp.become('aditi');
SELECT is(pg_temp.err(format($$UPDATE claim SET statement = 'Rewritten after the confirm, sneakily.' WHERE claim_id = %s RETURNING 1$$,
                             (SELECT id FROM ref WHERE name = 'aditi_rev'))),
          'ok', 'finality: an UPDATE of a confirmed claim matches no row (RLS: pending only) ...');
SELECT is((SELECT statement::text FROM claim WHERE claim_id = (SELECT id FROM ref WHERE name = 'aditi_rev')),
          'I answered the WHOLE Test and wrote every query myself.', '... so the confirmed text is unchanged');
RESET ROLE;
SELECT is(pg_temp.err(format($$UPDATE claim SET statement = 'Rewritten by a superuser.' WHERE claim_id = %s$$,
                             (SELECT id FROM ref WHERE name = 'aditi_rev'))),
          '55000:claim_not_pending', 'finality: even outside RLS a countersigned claim''s content cannot change');

-- ---------------------------------------------------------------------
-- 4. Evidence: own contributions only, typed refs, no duplicates
-- ---------------------------------------------------------------------
SELECT pg_temp.become('aditi');
INSERT INTO ref SELECT 'aditi_c5', (file_claim('P06', 5, 'design', 'Drew the level-0 DFD for the issue flow.') ->> 'claim_id')::int;
SELECT is(pg_temp.err(format($$SELECT add_claim_evidence(%s, 'contribution', '%s')$$,
                             (SELECT id FROM ref WHERE name = 'aditi_c5'), (SELECT id FROM ref WHERE name = 'karthik_sql'))),
          '23514:claim_evidence_own_contribution', 'evidence: cannot cite a teammate''s contribution as your own');
SELECT is(pg_temp.err(format($$INSERT INTO claim_evidence (claim_id, evidence_no, kind, ref)
                               VALUES (%s, 5, 'url', 'javascript:alert(document.cookie)')$$, (SELECT id FROM ref WHERE name = 'aditi_c5'))),
          '23514:claim_evidence_ref_format', 'evidence: a url must be http(s) (no javascript: links)');
SELECT is(pg_temp.err(format($$INSERT INTO claim_evidence (claim_id, evidence_no, kind, ref)
                               VALUES (%s, 6, 'commit', 'zzz')$$, (SELECT id FROM ref WHERE name = 'aditi_c5'))),
          '23514:claim_evidence_ref_format', 'evidence: a commit must be a hex SHA');
SELECT is(add_claim_evidence((SELECT id FROM ref WHERE name = 'aditi_c5'), 'artifact_version', 'A20@v2') ->> 'evidence_no',
          '1', 'evidence: cite A20@v2 once ...');
SELECT is(pg_temp.err(format($$INSERT INTO claim_evidence (claim_id, evidence_no, kind, artifact_id, version_no)
                               VALUES (%s, 7, 'artifact_version', 'A20', 2)$$, (SELECT id FROM ref WHERE name = 'aditi_c5'))),
          '23505:claim_evidence_once_version', '... but not twice');
RESET ROLE;
SELECT is(pg_temp.err($$INSERT INTO skill_evidence (usn, skill_id, claim_id, level)
                        SELECT '1RV24CY077', 'S02', claim_id, 5 FROM claim WHERE usn = '1RV24CY047' AND milestone_no = 4 AND project_id = 'P06'$$),
          '23503:skill_evidence_claim_fkey', 'skill_evidence: usn must be the claim''s claimant (composite FK on a superkey)');

-- ---------------------------------------------------------------------
-- 5. Artifacts: no hijacking, hiding, moving or un-submitting
-- ---------------------------------------------------------------------
SELECT pg_temp.become('arun');
SELECT is(pg_temp.err($$UPDATE artifact SET visibility = 'private', owner_usn = '1RV24CY047' WHERE artifact_id = 'A13'$$),
          '55000:artifact_submitted_final', 'artifact: a submitted artifact cannot be made private');
SELECT is(pg_temp.err($$UPDATE artifact SET visibility = 'team', milestone_no = 2 WHERE artifact_id = 'A13'$$),
          '55000:artifact_submitted_final', 'artifact: ... nor un-submitted or moved to another component');
SELECT is(pg_temp.err($$UPDATE artifact SET team_id = 'T01', project_id = 'P01', milestone_no = 1 WHERE artifact_id = 'A14'$$),
          '42501:', 'artifact: team_id / project_id are not updatable (no column privilege)');
SELECT is(pg_temp.err($$INSERT INTO artifact (artifact_id, team_id, project_id, milestone_no, title, type, source, visibility)
                        VALUES ('A90', 'T00', 'P06', 5, 'Looks submitted', 'diagram', 'editor', 'submitted')$$),
          '55000:artifact_not_submitted', 'artifact: cannot be created as submitted (only submitting does that)');
-- his own fresh draft, with only his own work in it, may be made private
INSERT INTO artifact (artifact_id, team_id, project_id, milestone_no, title, type, source)
VALUES ('A91', 'T00', 'P06', 4, 'Test errata', 'note', 'editor');
INSERT INTO artifact_version (artifact_id, version_no, created_by) VALUES ('A91', 1, '1RV24CY047');
SELECT is(pg_temp.err($$UPDATE artifact SET visibility = 'private', owner_usn = '1RV24CY047' WHERE artifact_id = 'A91'$$),
          'ok', 'artifact: making your OWN solo draft private is allowed');
SELECT is(pg_temp.err($$UPDATE artifact SET visibility = 'team' WHERE artifact_id = 'A91'$$),
          'ok', '... and sharing it again');
RESET ROLE;
SELECT is(pg_temp.err($$UPDATE artifact SET team_id = 'T01', project_id = 'P01', milestone_no = 1 WHERE artifact_id = 'A14'$$),
          '23514:artifact_team_immutable', 'artifact: no path moves an artifact to another team');

-- a T06 shared draft holding Karthik's work (made as the test superuser)
INSERT INTO artifact (artifact_id, team_id, project_id, milestone_no, title, type, source)
VALUES ('A93', 'T06', 'P06', 5, 'DFD level 1 (draft)', 'diagram', 'editor');
INSERT INTO artifact_version (artifact_id, version_no, created_by) VALUES ('A93', 1, '1RV24CY024');
SELECT pg_temp.become('aditi');
SELECT is(pg_temp.err($$UPDATE artifact SET visibility = 'private', owner_usn = '1RV24CY011' WHERE artifact_id = 'A93'$$),
          '42501:artifact_owner_only', 'artifact: a teammate''s shared draft cannot be taken over and hidden');
RESET ROLE;

SELECT pg_temp.become('f01');
SELECT is((SELECT count(*)::int FROM artifact WHERE artifact_id = 'A13'), 1, 'artifact: faculty still see submitted A13');
RESET ROLE;

-- ---------------------------------------------------------------------
-- 6. Submissions: frozen, never backdated, same component, chunks follow
-- ---------------------------------------------------------------------
SELECT pg_temp.become('arun');
SELECT is(pg_temp.err(format($$INSERT INTO submission_artifact VALUES (%s, 'A91', 1)$$, (SELECT id FROM ref WHERE name = 'sub_t00_c4'))),
          '55000:submission_frozen', 'submission: an earlier submission cannot gain artifacts later');
SELECT is(pg_temp.err($$INSERT INTO submission (team_id, project_id, milestone_no, submitted_by, attempt_no, submitted_at)
                        VALUES ('T00', 'P06', 4, '1RV24CY047', 7, '2026-10-20 09:00+05:30')$$),
          '42501:', 'submission: submitted_at is server-owned (no backdating)');
SELECT is(pg_temp.err($$INSERT INTO claim (claim_id, usn, team_id, project_id, milestone_no, statement)
                        VALUES (100000, '1RV24CY047', 'T00', 'P06', 5, 'Squatting a future claim id.')$$),
          '42501:', 'ids are server-owned: a client cannot pick claim_id');
SELECT is(pg_temp.err($$SELECT submit_milestone('T00', 3, ARRAY['A15'])$$),
          '23514:submission_artifact_same_component', 'submission: a C4 artifact cannot be frozen into C3');
RESET ROLE;

INSERT INTO artifact_chunk (artifact_id, version_no, author_usn, content)
VALUES ('A17', 1, '1RV24CY047', 'ER v2: CLAIM_EVIDENCE is a weak entity of CLAIM.');
SELECT pg_temp.become('arun');
SELECT is(submit_milestone('T00', 3, ARRAY['A17']) ->> 'attempt_no', '1', 'chunks: Arun submits A17 for C3');
RESET ROLE;
SELECT pg_temp.become('f01');
SELECT is((SELECT count(*)::int FROM artifact_chunk WHERE artifact_id = 'A17'), 1,
          'chunks: ... and its text becomes visible to the teaching faculty with it');
RESET ROLE;

-- ---------------------------------------------------------------------
-- 7. Directory, default privileges, CIE layout, history FKs
-- ---------------------------------------------------------------------
SELECT pg_temp.become('ghost');
SELECT is((SELECT count(*)::int FROM student) + (SELECT count(*)::int FROM team_member)
          + (SELECT count(*)::int FROM student_skill), 0,
          'directory: a login with no profile reads no students, rosters or skills');
RESET ROLE;

CREATE VIEW public.zz_unreviewed AS SELECT usn, name FROM student;     -- like fixture Q27/Q28
SELECT is(has_table_privilege('authenticated', 'public.zz_unreviewed', 'SELECT'), false,
          'default privileges: a view created later is not readable until granted');

SELECT is(pg_temp.err($$INSERT INTO milestone (project_id, milestone_no, title, max_marks, deadline, cie_part)
                        VALUES ('P06', 12, 'Second final', 10, '2026-12-19', 'final')$$),
          '23505:milestone_one_cie_part', 'CIE: one final component per project');
SELECT is(pg_temp.err($$UPDATE milestone SET max_marks = 12 WHERE project_id = 'P06' AND milestone_no = 10$$),
          '23514:milestone_cie_part_out_of_10', 'CIE: innovative/final components are out of 10');
SELECT matches(pg_temp.err($$DELETE FROM project WHERE project_id = 'P01'$$), '^23503:',
          'history: deleting a project no longer cascades through its teams'' work (RESTRICT, was CASCADE)');

SELECT * FROM finish();
ROLLBACK;
