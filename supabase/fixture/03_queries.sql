-- =====================================================================
--  Unified Experiential Learning Platform : SQL TEST QUERIES (Unit III)
--  Run after 01_schema.sql and 02_seed.sql. Each query starts with "-- Q".
-- =====================================================================

-- ===================== A. BASIC RETRIEVAL =====================

-- Q1. List all Section A students of Semester 5 in alphabetical order.
SELECT usn, name, email
FROM student
WHERE section = 'A' AND semester = 5
ORDER BY name;

-- Q2. Find all projects whose title contains the word 'DBMS'.
SELECT project_id, title, status
FROM project
WHERE title LIKE '%DBMS%';

-- Q3. List milestones due between 1 Nov 2026 and 30 Nov 2026, earliest first.
SELECT project_id, milestone_no, title, deadline
FROM milestone
WHERE deadline BETWEEN '2026-11-01' AND '2026-11-30'
ORDER BY deadline;

-- Q4. List the distinct types of artifacts submitted from GitHub or Obsidian.
SELECT DISTINCT type, source
FROM artifact
WHERE source IN ('github', 'obsidian');

-- ===================== B. JOINS =====================

-- Q5. Show every team with its project title and the course it belongs to.
SELECT t.team_id, t.team_name, p.title AS project, c.title AS course
FROM team t
JOIN project p ON t.project_id = p.project_id
JOIN course  c ON p.course_code = c.course_code
ORDER BY t.team_id;

-- Q6. List the members of every DBMS (CD252IA) project team with their role.
SELECT t.team_name, s.usn, s.name, tm.role
FROM team_member tm
JOIN team    t ON tm.team_id = t.team_id
JOIN project p ON t.project_id = p.project_id
JOIN student s ON tm.usn = s.usn
WHERE p.course_code = 'CD252IA'
ORDER BY t.team_name, tm.role, s.name;

-- Q7. (Outer join) Find students who are not part of any team.
SELECT s.usn, s.name
FROM student s
LEFT JOIN team_member tm ON s.usn = tm.usn
WHERE tm.usn IS NULL;

-- Q8. (Self join) Show every skill with the name of its parent skill.
SELECT child.name AS skill, parent.name AS parent_skill
FROM skill child
LEFT JOIN skill parent ON child.parent_skill_id = parent.skill_id
ORDER BY parent.name NULLS FIRST, child.name;

-- Q9. Show which faculty member handles each active project.
SELECT p.title AS project, f.name AS faculty, f.designation
FROM project p
JOIN course  c ON p.course_code = c.course_code
JOIN faculty f ON c.faculty_id = f.faculty_id
WHERE p.status = 'active';

-- ===================== C. AGGREGATES, GROUP BY, HAVING =====================

-- Q10. Count the contributions made by each student, highest first.
SELECT s.name, COUNT(c.contribution_id) AS contributions
FROM student s
LEFT JOIN contribution c ON s.usn = c.usn
GROUP BY s.usn, s.name
ORDER BY contributions DESC, s.name;

-- Q11. Show contributions per student within Team Alpha (T01) only.
SELECT s.name, COUNT(*) AS contributions
FROM contribution c
JOIN artifact a ON c.artifact_id = a.artifact_id
JOIN student  s ON c.usn = s.usn
WHERE a.team_id = 'T01'
GROUP BY s.name
ORDER BY contributions DESC;

-- Q12. Find teams that have more than 4 contributions in total.
SELECT a.team_id, COUNT(*) AS total_contributions
FROM contribution c
JOIN artifact a ON c.artifact_id = a.artifact_id
GROUP BY a.team_id
HAVING COUNT(*) > 4
ORDER BY total_contributions DESC;

-- Q13. Show the total marks available in each project (sum of milestone marks).
SELECT p.title, COUNT(m.milestone_no) AS milestones, SUM(m.max_marks) AS total_marks
FROM project p
JOIN milestone m ON p.project_id = m.project_id
GROUP BY p.project_id, p.title
ORDER BY total_marks DESC;

-- Q14. Show the number of members and free slots in each team.
SELECT t.team_name, t.max_size, COUNT(tm.usn) AS members,
       t.max_size - COUNT(tm.usn) AS free_slots
FROM team t
LEFT JOIN team_member tm ON t.team_id = tm.team_id
GROUP BY t.team_id, t.team_name, t.max_size
ORDER BY t.team_id;

-- Q15. Count contributions of each type (research, design, code, ...).
SELECT contribution_type, COUNT(*) AS total
FROM contribution
GROUP BY contribution_type
ORDER BY total DESC;

-- ===================== D. NESTED AND CORRELATED QUERIES =====================

-- Q16. Find students whose contribution count is above the average.
SELECT s.name, COUNT(*) AS contributions
FROM contribution c
JOIN student s ON c.usn = s.usn
GROUP BY s.usn, s.name
HAVING COUNT(*) > (
    SELECT AVG(cnt) FROM (SELECT COUNT(*) AS cnt FROM contribution GROUP BY usn) AS x
)
ORDER BY contributions DESC;

-- Q17. (Ghost members) Find team members who have made NO contribution to their own team's work.
SELECT t.team_name, s.name
FROM team_member tm
JOIN team    t ON tm.team_id = t.team_id
JOIN student s ON tm.usn = s.usn
WHERE NOT EXISTS (
    SELECT 1
    FROM contribution c
    JOIN artifact a ON c.artifact_id = a.artifact_id
    WHERE c.usn = tm.usn AND a.team_id = tm.team_id
);

-- Q18. (Correlated) Find the top contributor in each team.
SELECT a.team_id, c.usn, COUNT(*) AS contributions
FROM contribution c
JOIN artifact a ON c.artifact_id = a.artifact_id
GROUP BY a.team_id, c.usn
HAVING COUNT(*) >= ALL (
    SELECT COUNT(*)
    FROM contribution c2
    JOIN artifact a2 ON c2.artifact_id = a2.artifact_id
    WHERE a2.team_id = a.team_id
    GROUP BY c2.usn
)
ORDER BY a.team_id;

-- Q19. Find projects that have no team registered yet.
SELECT project_id, title
FROM project
WHERE project_id NOT IN (SELECT project_id FROM team);

-- Q20. Find milestones of the DBMS project (P01) for which Team Alpha has not submitted any artifact.
SELECT m.milestone_no, m.title, m.deadline
FROM milestone m
WHERE m.project_id = 'P01'
  AND NOT EXISTS (
      SELECT 1 FROM artifact a
      WHERE a.team_id = 'T01'
        AND a.project_id = m.project_id
        AND a.milestone_no = m.milestone_no
  );

-- ===================== E. DIVISION (the "ALL" queries) =====================

-- Q21. (Teammate finder) Find students who have ALL the skills required by the DBMS project P01.
SELECT s.usn, s.name
FROM student s
WHERE NOT EXISTS (
    SELECT ps.skill_id
    FROM project_skill ps
    WHERE ps.project_id = 'P01'
      AND NOT EXISTS (
          SELECT 1 FROM student_skill ss
          WHERE ss.usn = s.usn AND ss.skill_id = ps.skill_id
      )
);

-- Q22. Same as Q21, but only students who are NOT yet in any P01 team (available teammates).
SELECT s.usn, s.name
FROM student s
WHERE NOT EXISTS (
    SELECT ps.skill_id FROM project_skill ps
    WHERE ps.project_id = 'P01'
      AND NOT EXISTS (SELECT 1 FROM student_skill ss
                      WHERE ss.usn = s.usn AND ss.skill_id = ps.skill_id)
)
AND s.usn NOT IN (
    SELECT tm.usn FROM team_member tm JOIN team t ON tm.team_id = t.team_id
    WHERE t.project_id = 'P01'
);

-- Q23. Find Team Alpha members who contributed to EVERY artifact of Team Alpha.
SELECT s.usn, s.name
FROM team_member tm
JOIN student s ON tm.usn = s.usn
WHERE tm.team_id = 'T01'
  AND NOT EXISTS (
      SELECT a.artifact_id FROM artifact a
      WHERE a.team_id = 'T01'
        AND NOT EXISTS (SELECT 1 FROM contribution c
                        WHERE c.artifact_id = a.artifact_id AND c.usn = tm.usn)
  );

-- ===================== F. SET OPERATIONS =====================

-- Q24. (UNION) List the email addresses of everyone on the platform, students and faculty.
SELECT name, email, 'student' AS role FROM student
UNION
SELECT name, email, 'faculty' AS role FROM faculty
ORDER BY role, name;

-- Q25. (INTERSECT) Find skills shared by S Arun Sanjay and Karthik M.
SELECT sk.name FROM student_skill ss JOIN skill sk ON ss.skill_id = sk.skill_id
WHERE ss.usn = '1RV24CY047'
INTERSECT
SELECT sk.name FROM student_skill ss JOIN skill sk ON ss.skill_id = sk.skill_id
WHERE ss.usn = '1RV24CY024';

-- Q26. (EXCEPT, skill gap) Which skills required by P01 does Karthik M not have yet?
SELECT sk.name FROM project_skill ps JOIN skill sk ON ps.skill_id = sk.skill_id
WHERE ps.project_id = 'P01'
EXCEPT
SELECT sk.name FROM student_skill ss JOIN skill sk ON ss.skill_id = sk.skill_id
WHERE ss.usn = '1RV24CY024';

-- ===================== G. VIEWS =====================

-- Q27. Create a faculty view of team progress (metadata only, no artifact content).
CREATE OR REPLACE VIEW faculty_team_progress AS
SELECT t.team_id, t.team_name, p.title AS project,
       COUNT(DISTINCT a.milestone_no) AS milestones_started,
       COUNT(DISTINCT a.artifact_id)  AS artifacts,
       COUNT(c.contribution_id)       AS contributions
FROM team t
JOIN project p ON t.project_id = p.project_id
LEFT JOIN artifact a     ON a.team_id = t.team_id
LEFT JOIN contribution c ON c.artifact_id = a.artifact_id
GROUP BY t.team_id, t.team_name, p.title;

SELECT * FROM faculty_team_progress ORDER BY team_id;

-- Q28. Create a portfolio view listing every project a student has worked on, across semesters.
CREATE OR REPLACE VIEW student_portfolio AS
SELECT s.usn, s.name, c.course_code, p.title AS project, t.team_name, tm.role, p.status
FROM student s
JOIN team_member tm ON s.usn = tm.usn
JOIN team t         ON tm.team_id = t.team_id
JOIN project p      ON t.project_id = p.project_id
JOIN course c       ON p.course_code = c.course_code;

SELECT course_code, project, team_name, role, status
FROM student_portfolio
WHERE usn = '1RV24CY047';

-- ===================== H. RECURSIVE QUERY (skill graph) =====================

-- Q29. List every skill that falls under 'Databases', at any depth.
WITH RECURSIVE sub_skills AS (
    SELECT skill_id, name, 0 AS depth FROM skill WHERE name = 'Databases'
    UNION ALL
    SELECT s.skill_id, s.name, ss.depth + 1
    FROM skill s
    JOIN sub_skills ss ON s.parent_skill_id = ss.skill_id
)
SELECT name, depth FROM sub_skills ORDER BY depth, name;

-- ===================== I. DDL AND DML =====================

-- Q30. Add a column to store each team's GitHub repository (must be unique).
ALTER TABLE team ADD COLUMN github_repo VARCHAR(100) UNIQUE;
UPDATE team SET github_repo = 'github.com/rvce-el/team-alpha' WHERE team_id = 'T01';
SELECT team_id, team_name, github_repo FROM team WHERE github_repo IS NOT NULL;

-- Q31. Register a new student and give them a skill.
INSERT INTO student VALUES ('1RV24CY090', 'Tanvi Joshi', 'tanvi.cy24@rvce.edu.in', 'CSE', 'A', 5, '2024-09-01');
INSERT INTO student_skill VALUES ('1RV24CY090', 'S02', 3);
SELECT s.name, sk.name AS skill, ss.level
FROM student_skill ss JOIN student s ON ss.usn = s.usn JOIN skill sk ON ss.skill_id = sk.skill_id
WHERE s.usn = '1RV24CY090';

-- Q32. Activate every planned project whose start date has arrived (as of 1 Nov 2026).
UPDATE project SET status = 'active'
WHERE status = 'planned' AND start_date <= '2026-11-01';
SELECT project_id, title, end_date, status FROM project ORDER BY project_id;

-- Q33. Remove the planned project P05 (its milestones are deleted automatically by ON DELETE CASCADE).
DELETE FROM project WHERE project_id = 'P05';
SELECT COUNT(*) AS p05_milestones_left FROM milestone WHERE project_id = 'P05';

-- Q34. Try to violate a CHECK constraint: a team with max_size 10 must be rejected.
-- Expected: ERROR  new row for relation "team" violates check constraint "team_max_size_check"
INSERT INTO team VALUES ('T99', 'P01', 'Team Overflow', 10, '2026-10-15', NULL);

-- ===================== J. TRIGGER AND TRANSACTION (Unit IV link) =====================

-- Q35. Create a trigger that stops a student from joining a team that is already full.
CREATE OR REPLACE FUNCTION check_team_capacity() RETURNS TRIGGER AS $$
DECLARE
    current_size INT;
    capacity     INT;
BEGIN
    SELECT max_size INTO capacity FROM team WHERE team_id = NEW.team_id FOR UPDATE;
    SELECT COUNT(*) INTO current_size FROM team_member WHERE team_id = NEW.team_id;
    IF current_size >= capacity THEN
        RAISE EXCEPTION 'Team % is full (% / %)', NEW.team_id, current_size, capacity;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_team_capacity
BEFORE INSERT ON team_member
FOR EACH ROW EXECUTE FUNCTION check_team_capacity();

-- Q36. Test the trigger: Team Alpha (T01) is full (4/4), so this insert must fail.
-- Expected: ERROR  Team T01 is full (4 / 4)
INSERT INTO team_member VALUES ('T01', '1RV24CY077', 'member', '2026-10-15');

-- Q37. Join the last free slot of Team Beta (T02) safely inside a transaction.
--      FOR UPDATE locks the team row, so two students cannot take the same last slot.
BEGIN;
SELECT team_id, max_size FROM team WHERE team_id = 'T02' FOR UPDATE;
INSERT INTO team_member VALUES ('T02', '1RV24CY077', 'member', '2026-10-15');
COMMIT;
SELECT t.team_name, COUNT(*) AS members, t.max_size
FROM team t JOIN team_member tm ON t.team_id = tm.team_id
WHERE t.team_id = 'T02' GROUP BY t.team_name, t.max_size;
