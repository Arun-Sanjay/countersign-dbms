-- Strict marks (migration 0007, docs/KNOWN_ISSUES.md #7): a mark with more than one decimal
-- is REFUSED on every write path, never rounded. Before 0007, assessment.marks was
-- NUMERIC(4,1) and a direct INSERT of 4.25 was stored as 4.3.
-- Paths: the table owner (no RLS), a teaching faculty member and the admin under the
-- assessment policies, PostgREST's upsert shape (INSERT ... ON CONFLICT DO UPDATE), the
-- record_assessment() RPC, and the CHECK alone with the triggers switched off.
-- Same persona mechanism as 03_rpc.sql; everything is rolled back at the end.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(43);

-- ---------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------
DELETE FROM app_user;

CREATE TEMP TABLE persona (name TEXT PRIMARY KEY, uid UUID, role TEXT, usn TEXT, faculty_id TEXT);
INSERT INTO persona VALUES
    ('arun',   '00000000-0000-4000-a000-000000000047', 'student', '1RV24CY047', NULL),
    ('f01',    '00000000-0000-4000-a000-0000000000f1', 'faculty', NULL, 'F01'),
    ('admin',  '00000000-0000-4000-a000-0000000000ad', 'admin',   NULL, NULL);
INSERT INTO auth.users (id, aud, role, email)
SELECT uid, 'authenticated', 'authenticated', name || '@marks-test.invalid' FROM persona;
INSERT INTO app_user (user_id, role, usn, faculty_id)
SELECT uid, role, usn, faculty_id FROM persona;
GRANT SELECT ON persona TO authenticated, anon;

CREATE FUNCTION pg_temp.become(p_name TEXT) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub', uid, 'role', 'authenticated')::text, true)
    FROM persona WHERE name = p_name;
    PERFORM set_config('role', 'authenticated', true);
END $$;

-- 'ok', or 'SQLSTATE:rule'. Unlike 03_rpc.sql the constraint name comes first: a plain CHECK
-- violation's DETAIL is "Failing row contains (...)". The 0002 triggers set both to the same
-- key; record_assessment() sets only DETAIL ('marks').
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

-- the stored mark as text, so that the scale is checked too ('8.0', not '8')
CREATE FUNCTION pg_temp.mark(p_usn TEXT, p_no INT) RETURNS TEXT LANGUAGE sql AS $$
    SELECT marks::text FROM public.assessment WHERE usn = p_usn AND project_id = 'P06' AND milestone_no = p_no
$$;

-- ---------------------------------------------------------------------
-- A. Schema
-- ---------------------------------------------------------------------
SELECT col_type_is('public', 'assessment', 'marks', 'numeric',
                   'assessment.marks is unconstrained NUMERIC: no typmod rounds the value before the checks');
SELECT is((SELECT pg_get_constraintdef(oid) FROM pg_constraint
           WHERE conrelid = 'public.assessment'::regclass AND conname = 'assessment_marks_one_decimal'),
          'CHECK ((marks = round(marks, 1)))', 'CHECK assessment_marks_one_decimal');
SELECT is((SELECT pg_get_constraintdef(oid) FROM pg_constraint
           WHERE conrelid = 'public.assessment'::regclass AND conname = 'assessment_marks_precision'),
          'CHECK ((marks < (1000)::numeric))', 'CHECK assessment_marks_precision (the range NUMERIC(4,1) implied)');
SELECT is((SELECT pg_get_constraintdef(oid) FROM pg_constraint
           WHERE conrelid = 'public.assessment'::regclass AND conname = 'assessment_marks_check'),
          'CHECK ((marks >= (0)::numeric))', 'the 0002 CHECK (marks >= 0) survived the type change');
SELECT has_trigger('public', 'assessment', 'trg_assessment_canonical_marks', 'canonical-scale trigger exists');
SELECT ok('trg_assessment_canonical_marks' < 'trg_assessment_check',
          'it fires before trg_assessment_check (same event: name order)');

-- ---------------------------------------------------------------------
-- B. The table owner (no RLS): the path the issue reproduced
-- ---------------------------------------------------------------------
SELECT is(pg_temp.err($$INSERT INTO assessment (usn, project_id, milestone_no, marks, assessed_by)
                        VALUES ('1RV24CY047', 'P06', 3, 4.25, 'F01')$$),
          '23514:assessment_marks_one_decimal', 'owner INSERT 4.25 is refused (was stored as 4.3)');
SELECT is(pg_temp.mark('1RV24CY047', 3), NULL, '...and nothing was stored');
SELECT is(pg_temp.err($$INSERT INTO assessment (usn, project_id, milestone_no, marks, assessed_by)
                        VALUES ('1RV24CY047', 'P06', 3, 4.001, 'F01')$$),
          '23514:assessment_marks_one_decimal', 'owner INSERT 4.001 is refused (NUMERIC(5,2) would have kept 4.00)');
SELECT is(pg_temp.err($$INSERT INTO assessment (usn, project_id, milestone_no, marks, assessed_by)
                        VALUES ('1RV24CY047', 'P06', 3, 0.05, 'F01')$$),
          '23514:assessment_marks_one_decimal', 'owner INSERT 0.05 is refused');
SELECT is(pg_temp.err($$INSERT INTO assessment (usn, project_id, milestone_no, marks, assessed_by)
                        VALUES ('1RV24CY047', 'P06', 3, '8.25'::text::numeric, 'F01')$$),
          '23514:assessment_marks_one_decimal', 'owner INSERT from text (PostgREST sends JSON numbers as text) is refused');
SELECT is(pg_temp.err($$UPDATE assessment SET marks = 18.75
                        WHERE usn = '1RV24CY047' AND project_id = 'P06' AND milestone_no = 4$$),
          '23514:assessment_marks_one_decimal', 'owner UPDATE 19.0 -> 18.75 is refused');
SELECT is(pg_temp.mark('1RV24CY047', 4), '19.0', '...and the stored mark is unchanged');

SELECT lives_ok($$INSERT INTO assessment (usn, project_id, milestone_no, marks, assessed_by)
                  VALUES ('1RV24CY047', 'P06', 3, 8, 'F01')$$, 'owner INSERT 8 is accepted');
SELECT is(pg_temp.mark('1RV24CY047', 3), '8.0', '...and stored at scale 1, as NUMERIC(4,1) did');
SELECT lives_ok($$UPDATE assessment SET marks = 8.50
                  WHERE usn = '1RV24CY047' AND project_id = 'P06' AND milestone_no = 3$$,
                'owner UPDATE 8.50 (one significant decimal) is accepted');
SELECT is(pg_temp.mark('1RV24CY047', 3), '8.5', '...and stored as 8.5');
SELECT throws_ok($$INSERT INTO assessment (usn, project_id, milestone_no, marks, assessed_by)
                   VALUES ('1RV24CY024', 'P06', 3, 11, 'F01')$$,
                 '23514', 'Marks 11.0 exceed the maximum 10 for milestone P06/3',
                 'the bound check still reports the canonical value (11.0)');
SELECT is(pg_temp.err($$INSERT INTO assessment (usn, project_id, milestone_no, marks, assessed_by)
                        VALUES ('1RV24CY024', 'P06', 3, 10.05, 'F01')$$),
          '23514:assessment_marks_le_max', 'over the max AND two decimals: refused (the bound trigger speaks first)');
SELECT is(pg_temp.err($$INSERT INTO assessment (usn, project_id, milestone_no, marks, assessed_by)
                        VALUES ('1RV24CY024', 'P06', 3, 'NaN', 'F01')$$),
          '23514:assessment_marks_le_max', 'NaN is refused');

-- ---------------------------------------------------------------------
-- C. The declarative layer alone (triggers off): the CHECKs refuse by themselves
-- ---------------------------------------------------------------------
ALTER TABLE assessment DISABLE TRIGGER trg_assessment_check;
ALTER TABLE assessment DISABLE TRIGGER trg_assessment_canonical_marks;
SELECT is(pg_temp.err($$INSERT INTO assessment (usn, project_id, milestone_no, marks, assessed_by)
                        VALUES ('1RV24CY024', 'P06', 3, 4.25, 'F01')$$),
          '23514:assessment_marks_one_decimal', 'CHECK alone: 4.25 is refused');
SELECT is(pg_temp.err($$INSERT INTO assessment (usn, project_id, milestone_no, marks, assessed_by)
                        VALUES ('1RV24CY024', 'P06', 3, 1000, 'F01')$$),
          '23514:assessment_marks_precision', 'CHECK alone: 1000 is out of range');
SELECT is(pg_temp.err($$INSERT INTO assessment (usn, project_id, milestone_no, marks, assessed_by)
                        VALUES ('1RV24CY024', 'P06', 3, 'NaN', 'F01')$$),
          '23514:assessment_marks_precision', 'CHECK alone: NaN is refused');
SELECT is(pg_temp.err($$INSERT INTO assessment (usn, project_id, milestone_no, marks, assessed_by)
                        VALUES ('1RV24CY024', 'P06', 3, 'Infinity', 'F01')$$),
          '23514:assessment_marks_precision', 'CHECK alone: Infinity is refused');
SELECT is(pg_temp.err($$INSERT INTO assessment (usn, project_id, milestone_no, marks, assessed_by)
                        VALUES ('1RV24CY024', 'P06', 3, -0.5, 'F01')$$),
          '23514:assessment_marks_check', 'CHECK alone: a negative mark is still refused');
ALTER TABLE assessment ENABLE TRIGGER trg_assessment_check;
ALTER TABLE assessment ENABLE TRIGGER trg_assessment_canonical_marks;

-- ---------------------------------------------------------------------
-- D. Teaching faculty (F01, P06) under RLS: direct table, upsert, RPC
-- ---------------------------------------------------------------------
SELECT pg_temp.become('f01');
SELECT is(pg_temp.err($$INSERT INTO assessment (usn, project_id, milestone_no, marks, assessed_by)
                        VALUES ('1RV24CY024', 'P06', 5, 4.25, 'F01')$$),
          '23514:assessment_marks_one_decimal', 'f01 direct INSERT 4.25 is refused');
SELECT is(pg_temp.err($$INSERT INTO assessment (usn, project_id, milestone_no, marks, assessed_by)
                        VALUES ('1RV24CY024', 'P06', 4, 17.25, 'F01')
                        ON CONFLICT (usn, project_id, milestone_no) DO UPDATE SET marks = EXCLUDED.marks$$),
          '23514:assessment_marks_one_decimal', 'f01 upsert (PostgREST Prefer: resolution=merge-duplicates) 17.25 is refused');
SELECT is(pg_temp.err($$UPDATE assessment SET marks = 17.75
                        WHERE usn = '1RV24CY024' AND project_id = 'P06' AND milestone_no = 4$$),
          '23514:assessment_marks_one_decimal', 'f01 direct UPDATE 17.75 is refused');
SELECT is(pg_temp.err($$SELECT record_assessment('1RV24CY024', 'P06', 5, 4.25)$$),
          '22023:marks', 'f01 record_assessment 4.25: refused by the RPC''s own pre-check, as before');
SELECT is(pg_temp.err($$SELECT record_assessment('1RV24CY024', 'P06', 5, 4.001)$$),
          '22023:marks', 'f01 record_assessment 4.001 is refused');
SELECT is(pg_temp.err($$INSERT INTO assessment (usn, project_id, milestone_no, marks, assessed_by)
                        VALUES ('1RV24CY024', 'P06', 5, 4.2, 'F01')$$),
          'ok', 'f01 direct INSERT 4.2 is accepted');
SELECT is(record_assessment('1RV24CY024', 'P06', 6, 7) ->> 'inserted', 'true', 'f01 record_assessment 7 is accepted');
RESET ROLE;
SELECT is(pg_temp.mark('1RV24CY024', 6), '7.0', '...and stored as 7.0');
SELECT is(pg_temp.mark('1RV24CY024', 4), '17.0', 'the refused upsert and update left 17.0 alone');

-- ---------------------------------------------------------------------
-- E. The admin (direct corrections under the assessment policies)
-- ---------------------------------------------------------------------
SELECT pg_temp.become('admin');
SELECT is(pg_temp.err($$UPDATE assessment SET marks = 4.05
                        WHERE usn = '1RV24CY024' AND project_id = 'P06' AND milestone_no = 5$$),
          '23514:assessment_marks_one_decimal', 'admin UPDATE 4.05 is refused');
SELECT is(pg_temp.err($$UPDATE assessment SET marks = 4.1
                        WHERE usn = '1RV24CY024' AND project_id = 'P06' AND milestone_no = 5$$),
          'ok', 'admin UPDATE 4.1 is accepted');
RESET ROLE;

-- ---------------------------------------------------------------------
-- F. The re-created views: same options, same grants, same output
-- ---------------------------------------------------------------------
SELECT is((SELECT array_agg(c.relname::text || ':' || array_to_string(c.reloptions, ',') ORDER BY c.relname)
           FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
             AND c.relname IN ('v_lab_cie_marks', 'v_rubric_sheet', 'v_what_faculty_sees')),
          ARRAY['v_lab_cie_marks:security_invoker=true', 'v_rubric_sheet:security_invoker=true',
                'v_what_faculty_sees:security_invoker=true'],
          'the three views are back, each with security_invoker = true');
SELECT is((SELECT count(*)::int FROM unnest(ARRAY['v_lab_cie_marks', 'v_rubric_sheet', 'v_what_faculty_sees']) v
           WHERE has_table_privilege('authenticated', 'public.' || v, 'SELECT')
             AND NOT has_table_privilege('authenticated', 'public.' || v, 'INSERT')
             AND NOT has_table_privilege('anon', 'public.' || v, 'SELECT')),
          3, 'grants as in 0003: authenticated may SELECT (only), anon nothing');

SELECT pg_temp.become('f01');
SELECT is((SELECT marks::text FROM v_rubric_sheet WHERE usn = '1RV24CY024' AND milestone_no = 6), '7.0',
          'v_rubric_sheet shows the new mark to the teaching faculty');
SELECT is((SELECT raw_total::text FROM v_lab_cie_marks WHERE usn = '1RV24CY024'), '32.6',
          'v_lab_cie_marks adds up C1 4.5 + C4 17.0 + C5 4.1 + C6 7.0 = 32.6');
RESET ROLE;

SELECT pg_temp.become('arun');
SELECT is((SELECT label FROM v_what_faculty_sees WHERE item_kind = 'assessment' AND item_ref = 'P06/C3'),
          'marks 8.5 / 10', 'v_what_faculty_sees: arun''s own mark, labelled as before');
SELECT is((SELECT count(*)::int FROM v_rubric_sheet WHERE usn <> '1RV24CY047' AND marks IS NOT NULL), 0,
          'v_rubric_sheet: a student still sees no one else''s marks (RLS through security_invoker)');
SELECT is(pg_temp.err($$INSERT INTO assessment (usn, project_id, milestone_no, marks, assessed_by)
                        VALUES ('1RV24CY047', 'P06', 5, 4, 'F01')$$),
          '42501:', 'a student still cannot write marks at all (RLS)');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
