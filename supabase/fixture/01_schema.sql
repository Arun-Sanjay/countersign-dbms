-- =====================================================================
--  Unified Experiential Learning Platform : RELATIONAL SCHEMA
--  DBMS Lab (CD252IA) | S Arun Sanjay | 1RV24CY047
--  Target: PostgreSQL 16+ (Supabase). Run in order: 01_schema -> 02_seed -> 03_queries
-- =====================================================================

DROP TABLE IF EXISTS artifact_chunk, contribution, artifact, milestone,
                     project_skill, student_skill, skill, team_member,
                     team, project, course, faculty, student CASCADE;

-- ---------- Strong entities ----------
CREATE TABLE student (
    usn         VARCHAR(10)  PRIMARY KEY,
    name        VARCHAR(60)  NOT NULL,
    email       VARCHAR(80)  NOT NULL UNIQUE,
    department  VARCHAR(10)  NOT NULL,
    section     CHAR(1)      NOT NULL,
    semester    INT          NOT NULL CHECK (semester BETWEEN 1 AND 8),
    joined_at   DATE         NOT NULL
);

CREATE TABLE faculty (
    faculty_id  VARCHAR(6)   PRIMARY KEY,
    name        VARCHAR(60)  NOT NULL,
    email       VARCHAR(80)  NOT NULL UNIQUE,
    department  VARCHAR(10)  NOT NULL,
    designation VARCHAR(30)  NOT NULL
);

CREATE TABLE course (
    course_code VARCHAR(10)  PRIMARY KEY,
    title       VARCHAR(80)  NOT NULL,
    semester    INT          NOT NULL CHECK (semester BETWEEN 1 AND 8),
    credits     INT          NOT NULL CHECK (credits > 0),
    faculty_id  VARCHAR(6)   REFERENCES faculty(faculty_id) ON DELETE SET NULL
);

CREATE TABLE project (
    project_id  VARCHAR(5)   PRIMARY KEY,
    course_code VARCHAR(10)  NOT NULL REFERENCES course(course_code) ON DELETE CASCADE,
    title       VARCHAR(80)  NOT NULL,
    description TEXT,
    start_date  DATE         NOT NULL,
    end_date    DATE         NOT NULL,
    status      VARCHAR(10)  NOT NULL DEFAULT 'active'
                CHECK (status IN ('planned', 'active', 'completed')),
    CHECK (end_date > start_date)
);

CREATE TABLE team (
    team_id     VARCHAR(5)   PRIMARY KEY,
    project_id  VARCHAR(5)   NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
    team_name   VARCHAR(40)  NOT NULL,
    max_size    INT          NOT NULL CHECK (max_size BETWEEN 1 AND 6),
    created_at  DATE         NOT NULL
);

CREATE TABLE skill (
    skill_id        VARCHAR(5)  PRIMARY KEY,
    name            VARCHAR(40) NOT NULL UNIQUE,
    category        VARCHAR(20) NOT NULL,
    parent_skill_id VARCHAR(5)  REFERENCES skill(skill_id)       -- recursive relationship
);

-- ---------- Weak entity: MILESTONE (identified by owner PROJECT) ----------
CREATE TABLE milestone (
    project_id   VARCHAR(5)  REFERENCES project(project_id) ON DELETE CASCADE,
    milestone_no INT         CHECK (milestone_no > 0),
    title        VARCHAR(60) NOT NULL,
    max_marks    INT         NOT NULL CHECK (max_marks > 0),
    deadline     DATE        NOT NULL,
    PRIMARY KEY (project_id, milestone_no)
);

CREATE TABLE artifact (
    artifact_id  VARCHAR(5)  PRIMARY KEY,
    team_id      VARCHAR(5)  NOT NULL REFERENCES team(team_id) ON DELETE CASCADE,
    project_id   VARCHAR(5)  NOT NULL,
    milestone_no INT         NOT NULL,
    title        VARCHAR(60) NOT NULL,
    type         VARCHAR(10) NOT NULL CHECK (type IN ('code', 'note', 'report', 'diagram', 'slides')),
    source       VARCHAR(10) NOT NULL CHECK (source IN ('github', 'obsidian', 'editor')),
    created_at   DATE        NOT NULL,
    FOREIGN KEY (project_id, milestone_no) REFERENCES milestone(project_id, milestone_no)
);

-- ---------- M:N relationships ----------
CREATE TABLE team_member (                       -- STUDENT <-> TEAM
    team_id   VARCHAR(5)  REFERENCES team(team_id) ON DELETE CASCADE,
    usn       VARCHAR(10) REFERENCES student(usn)  ON DELETE CASCADE,
    role      VARCHAR(20) NOT NULL DEFAULT 'member',
    joined_at DATE        NOT NULL,
    PRIMARY KEY (team_id, usn)
);

CREATE TABLE student_skill (                     -- STUDENT <-> SKILL
    usn      VARCHAR(10) REFERENCES student(usn) ON DELETE CASCADE,
    skill_id VARCHAR(5)  REFERENCES skill(skill_id),
    level    INT         NOT NULL CHECK (level BETWEEN 1 AND 5),
    PRIMARY KEY (usn, skill_id)
);

CREATE TABLE project_skill (                     -- PROJECT <-> SKILL (required)
    project_id VARCHAR(5) REFERENCES project(project_id) ON DELETE CASCADE,
    skill_id   VARCHAR(5) REFERENCES skill(skill_id),
    PRIMARY KEY (project_id, skill_id)
);

CREATE TABLE contribution (                      -- STUDENT <-> ARTIFACT
    contribution_id   INT          PRIMARY KEY,
    usn               VARCHAR(10)  NOT NULL REFERENCES student(usn) ON DELETE CASCADE,
    artifact_id       VARCHAR(5)   NOT NULL REFERENCES artifact(artifact_id) ON DELETE CASCADE,
    contribution_type VARCHAR(15)  NOT NULL
        CHECK (contribution_type IN ('research', 'design', 'code', 'documentation', 'review')),
    description       VARCHAR(120),
    created_at        DATE         NOT NULL
);

-- In Supabase this table also has:  embedding VECTOR(1024)  (pgvector) for RAG search.
CREATE TABLE artifact_chunk (
    chunk_id    INT          PRIMARY KEY,
    artifact_id VARCHAR(5)   NOT NULL REFERENCES artifact(artifact_id) ON DELETE CASCADE,
    version_no  INT          NOT NULL CHECK (version_no > 0),
    author_usn  VARCHAR(10)  NOT NULL REFERENCES student(usn),
    content     TEXT         NOT NULL,
    created_at  DATE         NOT NULL
);
