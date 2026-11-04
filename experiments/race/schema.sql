-- =====================================================================
--  Component 10 — Innovative Experiment: "the last team slot"
--  Declarative vs procedural integrity under concurrency.
--
--  Load order (done by experiments/race/setup.sh, nothing is copied or edited):
--    1. supabase/fixture/01_schema.sql      (Appendix A, verbatim)
--    2. supabase/fixture/02_seed.sql        (Appendix B, verbatim)
--    3. Q35 block cut out of supabase/fixture/03_queries.sql (verbatim):
--         check_team_capacity() + trg_team_capacity          -> strategy S2
--    4. this file: schema "exp" (results tables + strategy objects S3, S6, S7)
--
--  Target team: T02 "Team Beta", max_size 4, 3 seeded members -> 1 free seat.
--  Racers: a pool of synthetic students 1RV99XX001 .. 1RV99XX100.
--  Throwaway database only (container elp-race-pg, port 55433).
-- =====================================================================

DROP SCHEMA IF EXISTS exp CASCADE;
CREATE SCHEMA exp;

-- ---------------------------------------------------------------------
-- 0. Synthetic racers (not part of the graded seed; only used here)
-- ---------------------------------------------------------------------
INSERT INTO student (usn, name, email, department, section, semester, joined_at)
SELECT format('1RV99XX%s', lpad(g::text, 3, '0')),
       format('Racer %s', g),
       format('racer%s@race.invalid', g),
       'CSE', 'Z', 5, DATE '2024-09-01'
FROM generate_series(1, 100) AS g;

-- ---------------------------------------------------------------------
-- 1. Results tables
-- ---------------------------------------------------------------------
CREATE TABLE exp.experiment_run (
    run_id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    strategy      TEXT        NOT NULL CHECK (strategy IN ('S1','S2','S3','S4','S6','S7')),
    isolation     TEXT        NOT NULL CHECK (isolation IN ('READ COMMITTED','REPEATABLE READ','SERIALIZABLE')),
    n_clients     INT         NOT NULL CHECK (n_clients > 0),
    trial_no      INT         NOT NULL CHECK (trial_no > 0),
    started_at    TIMESTAMPTZ NOT NULL,
    admitted      INT         NOT NULL,           -- attempts whose transaction committed a join
    max_size      INT         NOT NULL,           -- T02.max_size (4)
    final_size    INT         NOT NULL,           -- COUNT(team_member) for T02 after the race
    over_admitted BOOLEAN     NOT NULL,           -- final_size > max_size
    aborts_40001  INT         NOT NULL,           -- every 40001 seen, including retried ones (S4)
    refused       INT         NOT NULL,           -- attempts told "team is full"
    duration_ms   NUMERIC(10,3) NOT NULL          -- barrier release -> last client finished
);

CREATE TABLE exp.experiment_attempt (
    run_id     BIGINT  NOT NULL REFERENCES exp.experiment_run(run_id) ON DELETE CASCADE,
    client_no  INT     NOT NULL,
    outcome    TEXT    NOT NULL
               CHECK (outcome IN ('admitted','refused','serialization_failure','deadlock','error')),
    sqlstate   TEXT,                              -- last SQLSTATE seen (NULL when admitted)
    latency_ms NUMERIC(10,3) NOT NULL,            -- barrier release -> final outcome
    retries    INT     NOT NULL DEFAULT 0,
    PRIMARY KEY (run_id, client_no)
);

-- LOGICAL, client-recorded schedule (N = 2 runs only). Not PostgreSQL's internal MVCC
-- schedule: see README "Logical schedule" for the placement rule used for reads.
CREATE TABLE exp.schedule_log (
    run_id    BIGINT NOT NULL REFERENCES exp.experiment_run(run_id) ON DELETE CASCADE,
    seq       BIGINT NOT NULL,                    -- global order of the logical schedule
    txn       TEXT   NOT NULL,                    -- 'T1', 'T2', retries: 'T2.1', 'T2.2', ...
    op        CHAR(1) NOT NULL CHECK (op IN ('r','w','c','a')),
    item      TEXT,                               -- NULL for c; for a: 'refused' (client rolled back
                                                  -- after "team is full") or the SQLSTATE (40001 ...)
    logged_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (run_id, seq)
);
CREATE INDEX ON exp.schedule_log (run_id, item);

-- ---------------------------------------------------------------------
-- 2. Strategy objects
--    S1 naive / S4 SERIALIZABLE+retry : no database objects (client logic only)
--    S2 fixture trigger               : check_team_capacity() + trg_team_capacity (Q35, verbatim)
-- ---------------------------------------------------------------------

-- S3 — conditional counter. The capacity test and the increment are ONE statement:
--   UPDATE exp.team_counter SET member_count = member_count + 1
--   WHERE team_id = $1 AND member_count < max_size RETURNING member_count;
-- Under READ COMMITTED a waiting UPDATE re-checks its WHERE on the newest row version
-- (EvalPlanQual), under RR/SER it fails with 40001 if the row changed after its snapshot.
CREATE TABLE exp.team_counter (
    team_id      VARCHAR(5) PRIMARY KEY REFERENCES team(team_id) ON DELETE CASCADE,
    member_count INT NOT NULL CHECK (member_count >= 0),
    max_size     INT NOT NULL,
    CHECK (member_count <= max_size)              -- belt and braces: the counter itself can never overflow
);
INSERT INTO exp.team_counter
SELECT t.team_id, (SELECT count(*) FROM team_member m WHERE m.team_id = t.team_id), t.max_size
FROM team t;

-- S6 — declarative seats. Capacity becomes DATA (a finite set of seat keys) and the
-- rule becomes KEYS: a seat can be held once (PK), a seat must exist (FK to the slot
-- table, seat_no 1..max_size), a member must hold a seat (deferred FK from team_member,
-- added only while S6 is the active strategy, see exp.use_strategy()).
CREATE TABLE exp.team_seat_slot (
    team_id VARCHAR(5) REFERENCES team(team_id) ON DELETE CASCADE,
    seat_no INT CHECK (seat_no BETWEEN 1 AND 6),
    PRIMARY KEY (team_id, seat_no)
);
INSERT INTO exp.team_seat_slot
SELECT t.team_id, s FROM team t CROSS JOIN LATERAL generate_series(1, t.max_size) AS s;

CREATE TABLE exp.team_seat (
    team_id VARCHAR(5)  NOT NULL,
    seat_no INT         NOT NULL,
    usn     VARCHAR(10) NOT NULL REFERENCES student(usn) ON DELETE CASCADE,
    PRIMARY KEY (team_id, seat_no),                                   -- one holder per seat
    UNIQUE (team_id, usn),                                            -- one seat per student per team
    FOREIGN KEY (team_id, seat_no) REFERENCES exp.team_seat_slot ON DELETE CASCADE  -- seat_no in 1..max_size
);
INSERT INTO exp.team_seat (team_id, seat_no, usn)
SELECT team_id, row_number() OVER (PARTITION BY team_id ORDER BY joined_at, usn), usn
FROM team_member;

-- S6 join: claim the lowest free seat; ON CONFLICT DO NOTHING when someone beat us to it.
-- Returns the seat number, or NULL if this attempt lost the seat (caller loops / refuses).
CREATE FUNCTION exp.claim_seat(p_team VARCHAR, p_usn VARCHAR) RETURNS INT
LANGUAGE sql AS $$
    INSERT INTO exp.team_seat (team_id, seat_no, usn)
    SELECT s.team_id, s.seat_no, p_usn
    FROM exp.team_seat_slot s
    WHERE s.team_id = p_team
      AND NOT EXISTS (SELECT 1 FROM exp.team_seat x
                      WHERE x.team_id = s.team_id AND x.seat_no = s.seat_no)
    ORDER BY s.seat_no
    LIMIT 1
    ON CONFLICT (team_id, seat_no) DO NOTHING
    RETURNING seat_no
$$;

-- S7 — "write the parent" (the product's capacity v2, migration 0002, re-created here in
-- schema exp so the migration files are untouched). The no-op UPDATE takes the team row
-- lock AND creates a new row version: RR/SER waiters get 40001, RC waiters re-read.
CREATE FUNCTION exp.enforce_team_capacity_v2()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
    cap          INT;
    current_size INT;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.team_id = OLD.team_id THEN
        RETURN NEW;
    END IF;
    UPDATE public.team SET max_size = max_size
    WHERE team_id = NEW.team_id
    RETURNING max_size INTO cap;
    IF NOT FOUND THEN
        RETURN NEW;
    END IF;
    SELECT count(*) INTO current_size FROM public.team_member WHERE team_id = NEW.team_id;
    IF current_size >= cap THEN
        RAISE EXCEPTION 'Team % is full (% / %)', NEW.team_id, current_size, cap
            USING ERRCODE = 'check_violation', CONSTRAINT = 'team_capacity';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_team_capacity_v2
BEFORE INSERT OR UPDATE OF team_id ON team_member
FOR EACH ROW EXECUTE FUNCTION exp.enforce_team_capacity_v2();

-- ---------------------------------------------------------------------
-- 3. Strategy switch + reset (run by the harness between blocks / trials)
-- ---------------------------------------------------------------------
-- Only one capacity mechanism is active at a time.
CREATE FUNCTION exp.use_strategy(p TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    IF p IS NULL OR p NOT IN ('S1','S2','S3','S4','S6','S7') THEN
        RAISE EXCEPTION 'unknown strategy %', p;
    END IF;
    IF to_regproc('public.check_team_capacity') IS NULL THEN
        RAISE EXCEPTION 'Q35 trigger function missing: load the Q35 block first';
    END IF;
    ALTER TABLE public.team_member DISABLE TRIGGER trg_team_capacity;
    ALTER TABLE public.team_member DISABLE TRIGGER trg_team_capacity_v2;
    ALTER TABLE public.team_member DROP CONSTRAINT IF EXISTS team_member_needs_seat;
    IF p = 'S2' THEN
        ALTER TABLE public.team_member ENABLE TRIGGER trg_team_capacity;
    ELSIF p = 'S7' THEN
        ALTER TABLE public.team_member ENABLE TRIGGER trg_team_capacity_v2;
    ELSIF p = 'S6' THEN
        ALTER TABLE public.team_member ADD CONSTRAINT team_member_needs_seat
            FOREIGN KEY (team_id, usn) REFERENCES exp.team_seat (team_id, usn)
            DEFERRABLE INITIALLY DEFERRED;
    END IF;
END $$;

-- Put T02 back to 3/4 for every mechanism.
CREATE FUNCTION exp.reset_t02() RETURNS VOID LANGUAGE sql AS $$
    DELETE FROM public.team_member WHERE team_id = 'T02' AND usn LIKE '1RV99%';
    DELETE FROM exp.team_seat      WHERE team_id = 'T02' AND usn LIKE '1RV99%';
    UPDATE exp.team_counter c
    SET member_count = (SELECT count(*) FROM public.team_member m WHERE m.team_id = c.team_id)
    WHERE c.team_id = 'T02';
$$;

DO $$ BEGIN PERFORM exp.use_strategy('S1'); PERFORM exp.reset_t02(); END $$;
