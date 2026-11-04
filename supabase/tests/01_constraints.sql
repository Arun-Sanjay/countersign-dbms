-- Constraint gallery (gate G4): one violating statement per integrity rule, each must
-- fail with the expected SQLSTATE; plus happy paths that must succeed.
-- Runs on the fixture + demo seed, inside a transaction that is rolled back.
--   23514 check_violation   23503 foreign_key_violation   23505 unique_violation
--   23P01 exclusion_violation   55000 object_not_in_prerequisite_state
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(46);

-- ===================== A. Declarative CHECK constraints =====================
SELECT throws_ok(
    $$INSERT INTO team (team_id, project_id, team_name, max_size, created_at)
      VALUES ('T99', 'P01', 'Team Overflow', 10, '2026-10-15')$$,
    '23514', NULL, 'CHECK: team.max_size must be 1..6 (fixture Q34)');

SELECT throws_ok(
    $$INSERT INTO student (usn, name, email, department, section, semester, joined_at)
      VALUES ('1RV24CY099', 'X', 'x@rvce.edu.in', 'CSE', 'A', 9, '2024-09-01')$$,
    '23514', NULL, 'CHECK: student.semester must be 1..8');

SELECT throws_ok(
    $$INSERT INTO artifact (artifact_id, team_id, project_id, milestone_no, title, type, source)
      VALUES ('A99', 'T01', 'P01', 1, 'Clip', 'video', 'editor')$$,
    '23514', NULL, 'CHECK: artifact.type is an enumerated domain');

SELECT throws_ok(
    $$INSERT INTO artifact (artifact_id, team_id, project_id, milestone_no, title, type, source, visibility)
      VALUES ('A99', 'T01', 'P01', 1, 'Secret', 'note', 'editor', 'private')$$,
    '23514', NULL, 'CHECK: a private artifact needs an owner');

SELECT throws_ok(
    $$INSERT INTO app_user (user_id, role, usn) VALUES (gen_random_uuid(), 'faculty', '1RV24CY047')$$,
    '23514', NULL, 'CHECK: app_user role must match its identifier (faculty with a USN)');

SELECT throws_ok(
    $$INSERT INTO claim_evidence (claim_id, evidence_no, kind, ref)
      SELECT claim_id, 9, 'contribution', 'abc' FROM claim WHERE usn = '1RV24CY051' AND milestone_no = 3 AND project_id = 'P06'$$,
    '23514', NULL, 'CHECK: evidence kind must match the pointer that is filled');

SELECT throws_ok(
    $$INSERT INTO countersign (claim_id, endorser_usn, verdict)
      SELECT claim_id, '1RV24CY047', 'dispute' FROM claim WHERE usn = '1RV24CY051' AND milestone_no = 3 AND project_id = 'P06'$$,
    '23514', NULL, 'CHECK: a dispute needs a comment');

SELECT throws_ok(
    $$INSERT INTO claim (usn, team_id, project_id, milestone_no, statement)
      VALUES ('1RV24CY047', 'T00', 'P06', 5, 'did it')$$,
    '23514', NULL, 'CHECK: a claim statement needs at least 10 characters');

SELECT throws_ok(
    $$INSERT INTO assessment (usn, project_id, milestone_no, marks, assessed_by)
      VALUES ('1RV24CY047', 'P06', 5, -1, 'F01')$$,
    '23514', NULL, 'CHECK: marks cannot be negative');

SELECT throws_ok(
    $$INSERT INTO assessment (usn, project_id, milestone_no, marks, assessed_by)
      VALUES ('1RV24CY047', 'P06', 5, 4.25, 'F01')$$,
    '23514', NULL, 'CHECK: marks have at most one decimal; 4.25 is refused, not rounded (0007)');

SELECT throws_ok(
    $$INSERT INTO academic_term (term_id, name, start_date, end_date)
      VALUES ('2026-X', 'Overlapping term', '2026-12-01', '2027-01-31')$$,
    '23P01', NULL, 'EXCLUDE: academic terms cannot overlap');

-- ===================== B. Foreign keys and delete actions =====================
SELECT throws_ok(
    $$INSERT INTO team_member (team_id, usn, role) VALUES ('T02', '1RV24CY999', 'member')$$,
    '23503', NULL, 'FK: team_member.usn must be an existing student');

SELECT throws_ok(
    $$INSERT INTO artifact (artifact_id, team_id, project_id, milestone_no, title, type, source)
      VALUES ('A99', 'T03', 'P01', 1, 'Misfiled', 'report', 'editor')$$,
    '23503', NULL, 'Composite FK: a T03 (P02) artifact cannot be filed under a P01 milestone');

SELECT throws_ok(
    $$INSERT INTO project (project_id, course_code, title, start_date, end_date, offering_id)
      SELECT 'P99', 'CD253IA', 'Wrong offering', '2026-09-01', '2026-12-01', offering_id
      FROM course_offering WHERE course_code = 'CD252IA' AND term_id = '2026-ODD' AND section = 'A'$$,
    '23503', NULL, 'Composite FK: a project''s offering must be of the same course');

SELECT throws_ok(
    $$DELETE FROM student WHERE usn = '1RV24CY047'$$,
    '23503', NULL, 'RESTRICT: a student with recorded contributions cannot be deleted');

SELECT throws_ok(
    $$DELETE FROM course WHERE course_code = 'CD254TA'$$,
    '23503', NULL, 'RESTRICT: deleting a course does not wipe its projects');

SELECT throws_ok(
    $$DELETE FROM project WHERE project_id = 'P06'$$,
    '23503', NULL, 'RESTRICT: a project with submissions, claims and marks cannot be deleted');

-- ===================== C. Uniqueness / idempotency =====================
SELECT throws_ok(
    $$INSERT INTO contribution (usn, artifact_id, contribution_type, source, source_ref)
      VALUES ('1RV24CY047', 'A15', 'code', 'github', '3f9c2ab')$$,
    '23505', NULL, 'UNIQUE: a redelivered commit cannot create a duplicate contribution');

SELECT throws_ok(
    $$INSERT INTO submission (team_id, project_id, milestone_no, submitted_by)
      VALUES ('T00', 'P06', 4, '1RV24CY051')$$,
    '23505', NULL, 'UNIQUE: one submission per (team, component, attempt_no)');

-- ===================== D. Trigger rules (cross-row / cross-table) =====================
-- Team capacity v2
SELECT throws_ok(
    $$INSERT INTO team_member (team_id, usn, role) VALUES ('T01', '1RV24CY077', 'member')$$,
    '23514', 'Team T01 is full (4 / 4)', 'Capacity: Team Alpha T01 is full (fixture Q36)');

SELECT throws_ok(
    $$UPDATE team_member SET team_id = 'T01' WHERE team_id = 'T02' AND usn = '1RV24CY041'$$,
    '23514', 'Team T01 is full (4 / 4)', 'Capacity: moving into a full team via UPDATE is also refused');

SELECT throws_ok(
    $$UPDATE team SET max_size = 2 WHERE team_id = 'T01'$$,
    '23514', 'Team T01 already has 4 members; max_size 2 is too small',
    'Capacity: max_size cannot shrink below the member count');

-- One team per project
SELECT throws_ok(
    $$INSERT INTO team_member (team_id, usn, role) VALUES ('T02', '1RV24CY047', 'member')$$,
    '23505', 'Student 1RV24CY047 is already in team T01 for project P01',
    'One team per project: Arun (T01) cannot also join T02 (both P01)');

-- Membership required
SELECT throws_ok(
    $$INSERT INTO contribution (usn, artifact_id, contribution_type) VALUES ('1RV24CY077', 'A01', 'code')$$,
    '23514', 'Student 1RV24CY077 is not a member of team T01',
    'Membership: a non-member cannot record a contribution');

SELECT throws_ok(
    $$INSERT INTO artifact_chunk (artifact_id, version_no, author_usn, content) VALUES ('A01', 3, '1RV24CY077', 'x')$$,
    '23514', 'Student 1RV24CY077 is not a member of team T01',
    'Membership: a non-member cannot author a chunk');

SELECT throws_ok(
    $$INSERT INTO claim (usn, team_id, project_id, milestone_no, statement)
      VALUES ('1RV24CY077', 'T00', 'P06', 3, 'I drew the whole ER diagram.')$$,
    '23514', 'Student 1RV24CY077 is not a member of team T00',
    'Membership: a non-member cannot file a claim');

SELECT throws_ok(
    $$INSERT INTO assessment (usn, project_id, milestone_no, marks, assessed_by)
      VALUES ('1RV24CY077', 'P06', 4, 10, 'F01')$$,
    '23514', 'Student 1RV24CY077 is not in any team of project P06',
    'Membership: only a student in a team of the project can be assessed');

-- Countersign
SELECT throws_ok(
    $$INSERT INTO countersign (claim_id, endorser_usn, verdict)
      SELECT claim_id, '1RV24CY051', 'confirm' FROM claim WHERE usn = '1RV24CY051' AND milestone_no = 3 AND project_id = 'P06'$$,
    '23514', NULL, 'Countersign: a student cannot countersign their own claim');

SELECT throws_ok(
    $$INSERT INTO countersign (claim_id, endorser_usn, verdict)
      SELECT claim_id, '1RV24CY011', 'confirm' FROM claim WHERE usn = '1RV24CY051' AND milestone_no = 3 AND project_id = 'P06'$$,
    '23514', 'Student 1RV24CY011 is not a member of team T00',
    'Countersign: only a teammate of the claimant may countersign');

-- Evidence and submissions stay inside the team
SELECT throws_ok(
    $$INSERT INTO claim_evidence (claim_id, evidence_no, kind, artifact_id, version_no)
      SELECT claim_id, 9, 'artifact_version', 'A19', 1 FROM claim WHERE usn = '1RV24CY051' AND milestone_no = 3 AND project_id = 'P06'$$,
    '23514', NULL, 'Evidence: a claim cannot cite another team''s work');

SELECT throws_ok(
    $$INSERT INTO submission_artifact (submission_id, artifact_id, version_no)
      SELECT submission_id, 'A19', 1 FROM submission WHERE team_id = 'T00' AND milestone_no = 1$$,
    '23514', NULL, 'Submission: cannot submit another team''s artifact');

-- Marks
SELECT throws_ok(
    $$INSERT INTO assessment (usn, project_id, milestone_no, marks, assessed_by)
      VALUES ('1RV24CY047', 'P06', 3, 11, 'F01')$$,
    '23514', 'Marks 11.0 exceed the maximum 10 for milestone P06/3',
    'Marks: cannot exceed milestone.max_marks (ER Diagram = 10)');

SELECT throws_ok(
    $$UPDATE milestone SET max_marks = 15 WHERE project_id = 'P06' AND milestone_no = 4$$,
    '23514', NULL, 'Marks: max_marks cannot drop below an existing mark (Arun has 19/20)');

SELECT throws_ok(
    $$UPDATE assessment SET marks = 4 WHERE usn = '1RV24CY047' AND project_id = 'P06' AND milestone_no = 1$$,
    '55000', NULL, 'Locked milestone: C1 marks cannot be edited');

SELECT throws_ok(
    $$DELETE FROM assessment WHERE usn = '1RV24CY047' AND project_id = 'P06' AND milestone_no = 1$$,
    '55000', NULL, 'Locked milestone: C1 marks cannot be deleted');

-- ===================== E. Happy paths =====================
SELECT lives_ok(
    $$INSERT INTO team_member (team_id, usn, role) VALUES ('T02', '1RV24CY077', 'member')$$,
    'Capacity: Nikhil takes the last free seat of T02 (3/4 -> 4/4)');

SELECT throws_ok(
    $$INSERT INTO team_member (team_id, usn, role) VALUES ('T02', '1RV24CY082', 'member')$$,
    '23514', 'Team T02 is full (4 / 4)', 'Capacity: ... and the next joiner is refused');

SELECT lives_ok(
    $$UPDATE team_member SET role = 'member' WHERE team_id = 'T01' AND usn = '1RV24CY011'$$,
    'Capacity: updating a non-team column of a full team is allowed');

SELECT lives_ok(
    $$INSERT INTO contribution (usn, artifact_id, contribution_type, description, source, source_ref)
      VALUES ('1RV24CY051', 'A17', 'design', 'Added cardinalities', 'editor', 'A17@v2')$$,
    'Contribution: a member records work; the id comes from the identity column');

SELECT is(
    (SELECT contribution_id FROM contribution WHERE source_ref = 'A17@v2') > 38, true,
    'Identity sequence continues after the fixture and demo ids');

INSERT INTO contribution (usn, artifact_id, contribution_type, source, source_ref)
VALUES ('1RV24CY047', 'A15', 'code', 'github', '3f9c2ab')
ON CONFLICT (source, source_ref, usn, artifact_id) WHERE source_ref IS NOT NULL DO NOTHING;
SELECT is(
    (SELECT count(*)::int FROM contribution WHERE source = 'github' AND source_ref = '3f9c2ab'), 1,
    'Idempotency: ON CONFLICT DO NOTHING turns a redelivery into a no-op');

SELECT lives_ok(
    $$INSERT INTO assessment (usn, project_id, milestone_no, marks, assessed_by)
      VALUES ('1RV24CY047', 'P06', 3, 8.5, 'F01')$$,
    'Marks: a mark within max_marks on an unlocked milestone is accepted');

-- claim.status is derived from countersigns and cannot be set by hand
UPDATE claim SET status = 'confirmed' WHERE usn = '1RV24CY051' AND project_id = 'P06' AND milestone_no = 3;
SELECT is(
    (SELECT status FROM claim WHERE usn = '1RV24CY051' AND project_id = 'P06' AND milestone_no = 3)::text,
    'pending', 'Claim status: a hand-written status is overwritten by the derived value');

INSERT INTO countersign (claim_id, endorser_usn, verdict)
SELECT claim_id, '1RV24CY047', 'confirm' FROM claim WHERE usn = '1RV24CY051' AND project_id = 'P06' AND milestone_no = 3;
SELECT is(
    (SELECT status FROM claim WHERE usn = '1RV24CY051' AND project_id = 'P06' AND milestone_no = 3)::text,
    'confirmed', 'Claim status: a teammate''s confirm makes the claim confirmed');

UPDATE countersign SET verdict = 'dispute', comment = 'Cardinalities were mine.'
WHERE endorser_usn = '1RV24CY047'
  AND claim_id = (SELECT claim_id FROM claim WHERE usn = '1RV24CY051' AND project_id = 'P06' AND milestone_no = 3);
SELECT is(
    (SELECT status FROM claim WHERE usn = '1RV24CY051' AND project_id = 'P06' AND milestone_no = 3)::text,
    'contested', 'Claim status: any dispute makes the claim contested');

SELECT is(
    (SELECT status FROM claim WHERE usn = '1RV24CY011' AND project_id = 'P06' AND milestone_no = 1)::text,
    'contested', 'Demo seed: T06''s synopsis claim is contested');

SELECT * FROM finish();
ROLLBACK;
