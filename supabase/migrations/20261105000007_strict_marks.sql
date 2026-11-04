-- =====================================================================
-- 0007 strict marks: a mark with more than one decimal is REFUSED on every path, never
-- rounded (docs/KNOWN_ISSUES.md #7, C8 B.10).
--
-- Why 0002 could not catch it: assessment.marks was NUMERIC(4,1). PostgreSQL coerces a value
-- to the column's type modifier (rounding 4.25 to 4.3) BEFORE any BEFORE trigger or CHECK
-- sees the row, so neither could tell 4.3 from a rounded 4.25. Only record_assessment()
-- refused it (it checks its NUMERIC argument); a direct INSERT / UPDATE under the assessment
-- policies (faculty, admin) or a PostgREST write stored the rounded value.
--
-- The fix:
--   * marks becomes unconstrained NUMERIC, so the value reaches the checks exactly as sent.
--     (Not NUMERIC(5,2): that would still round 4.001 to 4.00 and accept it.)
--   * CHECK assessment_marks_one_decimal (marks = round(marks, 1)): the declarative rule.
--   * CHECK assessment_marks_precision (marks < 1000): the range NUMERIC(4,1) used to imply
--     (also refuses NaN and Infinity, which an unconstrained NUMERIC would otherwise accept).
--   * trg_assessment_canonical_marks: an accepted mark is stored at scale 1 (4 -> 4.0,
--     4.50 -> 4.5), as NUMERIC(4,1) did, so stored values, error texts ("Marks 11.0 exceed
--     ...") and v_what_faculty_sees labels ("marks 8.0 / 10") read exactly as before. It never
--     changes a value: a mark with a second decimal is left alone for the CHECK to refuse.
--   * The column feeds three views; PostgreSQL refuses to change the type of a column a view
--     reads, so they are dropped and re-created here, unchanged (same text as 0003,
--     security_invoker = true, the same grants).
-- The frozen graded fixture does not have this table (it was added in 0002): Q1-Q37 unchanged.
-- =====================================================================

DROP VIEW v_what_faculty_sees;
DROP VIEW v_rubric_sheet;
DROP VIEW v_lab_cie_marks;

ALTER TABLE assessment ALTER COLUMN marks TYPE NUMERIC;

ALTER TABLE assessment
    ADD CONSTRAINT assessment_marks_one_decimal CHECK (marks = round(marks, 1)),
    ADD CONSTRAINT assessment_marks_precision   CHECK (marks < 1000);

-- Fires before trg_assessment_check (triggers of one event fire in name order: "canonical"
-- < "check"), so the bound check and its message see the canonical value.
CREATE FUNCTION private.canonical_marks()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
    -- equal to its 1-decimal rounding: only the display scale changes (4 -> 4.0)
    IF NEW.marks = round(NEW.marks, 1) THEN
        NEW.marks := round(NEW.marks, 1);
    END IF;
    RETURN NEW;                                      -- otherwise assessment_marks_one_decimal refuses it
END $$;

CREATE TRIGGER trg_assessment_canonical_marks
BEFORE INSERT OR UPDATE OF marks ON assessment
FOR EACH ROW EXECUTE FUNCTION private.canonical_marks();

-- ---- the three dependent views, re-created unchanged (text as in 0003 §10) ----

-- ---- Lab CIE marks: C1..C9 (120 raw) -> 30, + C10 (10) + C11 (10) = 50 ----
-- Data-driven by milestone.cie_part (never by milestone_no):
--   reduced    = raw * 30 / (sum of max_marks of the 'reduced' components), so a project
--                whose reduced components total 100 still maps onto 30;
--   innovative / final = the mark of that one component (CHECK: out of 10; at most one
--                of each per project: partial UNIQUE index).
-- Rounding ASSUMPTION (to confirm with the course faculty): the reduced mark is rounded
-- once, to 1 decimal, half away from zero (NUMERIC round), and the total adds the
-- rounded value. Unassessed components count as 0 (components_assessed shows progress).
-- Only "lab-structured" projects appear: those with at least one non-reduced component.
-- (Re-created unchanged by 0007, which made assessment.marks strict.)
CREATE VIEW v_lab_cie_marks WITH (security_invoker = true) AS
WITH lab AS (
    SELECT project_id,
           sum(max_marks) FILTER (WHERE cie_part = 'reduced') AS raw_max
    FROM milestone
    GROUP BY project_id
    HAVING bool_or(cie_part <> 'reduced')
), per_student AS (
    SELECT tm.usn, t.team_id, t.project_id, lab.raw_max,
           COALESCE(sum(a.marks) FILTER (WHERE m.cie_part = 'reduced'), 0) AS raw_total,
           count(a.marks) FILTER (WHERE m.cie_part = 'reduced')             AS components_assessed,
           max(a.marks)   FILTER (WHERE m.cie_part = 'innovative')          AS innovative,
           max(a.marks)   FILTER (WHERE m.cie_part = 'final')               AS final
    FROM team_member tm
    JOIN team t   ON t.team_id = tm.team_id
    JOIN lab      ON lab.project_id = t.project_id
    LEFT JOIN assessment a ON a.usn = tm.usn AND a.project_id = t.project_id
    LEFT JOIN milestone  m ON m.project_id = a.project_id AND m.milestone_no = a.milestone_no
    WHERE tm.usn = (select app.current_usn()) OR app.oversees_project(t.project_id)
    GROUP BY tm.usn, t.team_id, t.project_id, lab.raw_max
)
SELECT ps.usn, s.name, ps.team_id, ps.project_id,
       ps.raw_total,
       ps.raw_max,
       ps.components_assessed,
       round(ps.raw_total * 30.0 / ps.raw_max, 1)                    AS reduced_30,
       ps.innovative                                                 AS innovative_10,
       ps.final                                                      AS final_10,
       round(ps.raw_total * 30.0 / ps.raw_max, 1)
           + COALESCE(ps.innovative, 0) + COALESCE(ps.final, 0)      AS total_50
FROM per_student ps
JOIN student s ON s.usn = ps.usn;

-- ---- Rubric sheet: one cell per (student, component), like the paper marks sheet ----
-- (Re-created unchanged by 0007, which made assessment.marks strict.)
CREATE VIEW v_rubric_sheet WITH (security_invoker = true) AS
SELECT t.project_id, t.team_id, t.team_name, tm.usn, s.name,
       m.milestone_no, m.title AS component, m.max_marks, m.counts_in_reduced, m.deadline,
       (m.locked_at IS NOT NULL) AS locked,
       a.marks, a.assessed_by,                                 -- NULL unless RLS lets you see it
       COALESCE(cl.claims_pending,   0) AS claims_pending,
       COALESCE(cl.claims_confirmed, 0) AS claims_confirmed,
       COALESCE(cl.claims_contested, 0) AS claims_contested
FROM team_member tm
JOIN team t      ON t.team_id = tm.team_id
JOIN student s   ON s.usn = tm.usn
JOIN milestone m ON m.project_id = t.project_id
LEFT JOIN assessment a
       ON a.usn = tm.usn AND a.project_id = m.project_id AND a.milestone_no = m.milestone_no
LEFT JOIN LATERAL (
    SELECT count(*) FILTER (WHERE c.status = 'pending')   AS claims_pending,
           count(*) FILTER (WHERE c.status = 'confirmed') AS claims_confirmed,
           count(*) FILTER (WHERE c.status = 'contested') AS claims_contested
    FROM claim c
    WHERE c.usn = tm.usn AND c.team_id = tm.team_id
      AND c.project_id = m.project_id AND c.milestone_no = m.milestone_no
) cl ON true
WHERE app.is_team_member(t.team_id) OR app.oversees_project(t.project_id);

-- ---- "What my faculty sees": the caller's own rows, filtered by the FACULTY branch of the
--      policies (never 'private', chunks only when 'submitted') and reduced to metadata.
--      Lets a student verify the privacy promise without becoming faculty.
-- (Re-created unchanged by 0007, which made assessment.marks strict.)
CREATE VIEW v_what_faculty_sees WITH (security_invoker = true) AS
WITH me AS (SELECT (select app.current_usn()) AS usn)
SELECT 'artifact'::text AS item_kind, a.artifact_id AS item_ref, a.team_id, a.project_id,
       a.milestone_no, a.title AS label, a.visibility, NULL::varchar AS ai_assistance,
       a.created_at::timestamptz AS at
FROM artifact a JOIN team_member tm ON tm.team_id = a.team_id JOIN me ON tm.usn = me.usn
WHERE a.visibility <> 'private'
UNION ALL
SELECT 'artifact_version', v.artifact_id || '@v' || v.version_no, a.team_id, a.project_id,
       a.milestone_no, a.title, a.visibility, v.ai_assistance, v.created_at
FROM artifact_version v JOIN artifact a ON a.artifact_id = v.artifact_id JOIN me ON v.created_by = me.usn
WHERE a.visibility <> 'private'
UNION ALL
SELECT 'contribution', k.contribution_id::text, a.team_id, a.project_id,
       a.milestone_no, k.contribution_type || ' on ' || a.title, a.visibility,
       CASE WHEN k.ai_assisted THEN 'assisted' ELSE 'none' END,
       COALESCE(k.occurred_at, k.created_at::timestamptz)
FROM contribution k JOIN artifact a ON a.artifact_id = k.artifact_id JOIN me ON k.usn = me.usn
WHERE a.visibility <> 'private'
UNION ALL
SELECT 'chunk', ch.chunk_id::text, a.team_id, a.project_id,
       a.milestone_no, 'text chunk of ' || a.title, ch.visibility, NULL, ch.created_at::timestamptz
FROM artifact_chunk ch JOIN artifact a ON a.artifact_id = ch.artifact_id JOIN me ON ch.author_usn = me.usn
WHERE ch.visibility = 'submitted' AND a.visibility <> 'private'
UNION ALL
SELECT 'claim', c.claim_id::text, c.team_id, c.project_id,
       c.milestone_no, 'claim (' || c.status || ')', NULL, c.ai_assistance, c.created_at
FROM claim c JOIN me ON c.usn = me.usn
UNION ALL
SELECT 'assessment', a.project_id || '/C' || a.milestone_no, NULL, a.project_id,
       a.milestone_no, 'marks ' || a.marks || ' / ' || m.max_marks, NULL, NULL, a.assessed_at
FROM assessment a
JOIN milestone m ON m.project_id = a.project_id AND m.milestone_no = a.milestone_no
JOIN me ON a.usn = me.usn;

-- Same grants as 0003: signed-in users only. (The schema's default privileges give
-- service_role and the owner the same rights as before; anon gets nothing.)
REVOKE ALL ON v_lab_cie_marks, v_rubric_sheet, v_what_faculty_sees FROM PUBLIC, anon, authenticated;
GRANT SELECT ON v_lab_cie_marks, v_rubric_sheet, v_what_faculty_sees TO authenticated;
