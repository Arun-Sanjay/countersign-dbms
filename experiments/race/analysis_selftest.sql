-- =====================================================================
--  Self-test of the precedence-graph SQL in analysis.sql (run analysis.sql first: it creates
--  the exp.v_* views). Every N = 2 race in the harness commits at most two transactions, and
--  a correct race commits exactly one, so the real data never exercises a non-trivial
--  ACYCLIC graph or a cycle longer than 2. This file feeds hand-written textbook schedules
--  through the same views and compares the results with the answers worked out by hand.
--  Everything runs inside one transaction that is ROLLED BACK: no rows are left behind.
--
--  Run:  docker exec -i elp-race-pg psql -U postgres -d race -X < experiments/race/analysis_selftest.sql
-- =====================================================================
\pset footer off
\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE selftest_case (
    name           TEXT PRIMARY KEY,
    schedule       TEXT NOT NULL,        -- textbook notation, ops separated by spaces
    expect_edges   TEXT,                 -- committed projection, sorted 'Ti->Tj, ...' (NULL = none)
    expect_cycle   TEXT,                 -- NULL = acyclic
    expect_order   TEXT,                 -- equivalent serial order when acyclic
    expect_cycle_all TEXT,               -- cycle when aborted transactions are included
    expect_dbms_break BOOLEAN            -- cycle only with aborted txns AND one of them was a DBMS abort
) ON COMMIT DROP;

INSERT INTO selftest_case VALUES
 -- A: acyclic, three committed transactions, plus an aborted T4 whose write must be ignored
 --    by the committed projection. Hand-derived edges: w3(x)<r1(x) => T3->T1; w1(y)<r2(y) => T1->T2.
 --    Serial order T3 -> T1 -> T2. Including T4: w4(x) precedes every access to x => T4->T1, T4->T3,
 --    still acyclic.
 ('A acyclic 3 txns', 'w4(x) r3(x) r1(y) w3(x) r1(x) w1(y) r2(y) w2(z) a4 c3 c1 c2',
  'T1->T2, T3->T1', NULL, 'T3 -> T1 -> T2', NULL, false),
 -- B: a 3-cycle. r1(x)<w2(x) => T1->T2; r2(y)<w3(y) => T2->T3; r3(z)<w1(z) => T3->T1.
 ('B 3-cycle', 'r1(x) w2(x) r2(y) w3(y) r3(z) w1(z) c1 c2 c3',
  'T1->T2, T2->T3, T3->T1', 'T1 -> T2 -> T3 -> T1', NULL, 'T1 -> T2 -> T3 -> T1', false),
 -- C: textbook lost update on ONE item x: r1(x) r2(x) w1(x) w2(x).
 --    r1(x)<w2(x), w1(x)<w2(x) => T1->T2; r2(x)<w1(x) => T2->T1.
 ('C lost update', 'r1(x) r2(x) w1(x) w2(x) c1 c2',
  'T1->T2, T2->T1', 'T1 -> T2 -> T1', NULL, 'T1 -> T2 -> T1', false),
 -- D: write skew on a predicate (the S1 / S2-at-RR shape): both read P, each inserts a new row.
 ('D write skew', 'r1(P) r2(P) w1(P) w2(P) c1 c2',
  'T1->T2, T2->T1', 'T1 -> T2 -> T1', NULL, 'T1 -> T2 -> T1', false),
 -- E: serial schedule T2 then T1 (reads never conflict with reads).
 ('E serial T2;T1', 'r2(x) w2(x) c2 r1(x) r1(y) w1(x) c1',
  'T2->T1', NULL, 'T2 -> T1', NULL, false),
 -- F: the cycle exists only through an aborted transaction (what SSI does at SER):
 --    committed projection = {T1}; including T2: r1(P)<w2(P) => T1->T2, r2(P)<w1(P) => T2->T1.
 ('F broken by abort', 'r1(P) r2(P) w1(P) w2(P) a2(40001) c1',
  NULL, NULL, 'T1', 'T1 -> T2 -> T1', true),
 -- G: RC non-repeatable read by a loser that then rolls back on its own (the S6/RC shape):
 --    r1(S)<w2(S) => T1->T2; w2(S)<r1(S) (second read) => T2->T1. Cycle only with T1 included,
 --    but T1 was the client's own rollback ('refused'), so it is NOT counted as a DBMS break.
 ('G RC re-read, refused', 'r2(S) r1(S) w2(S) w2(M) c2 r1(S) a1(refused)',
  NULL, NULL, 'T2', 'T1 -> T2 -> T1', false);

-- Parse the notation into exp.experiment_run / exp.schedule_log rows (one fake run per case).
CREATE TEMP TABLE selftest_run (name TEXT, run_id BIGINT) ON COMMIT DROP;
WITH ins AS (
    INSERT INTO exp.experiment_run (strategy, isolation, n_clients, trial_no, started_at, admitted,
                                    max_size, final_size, over_admitted, aborts_40001, refused, duration_ms)
    -- n_clients = 2 so that exp.v_run_serializability includes these fake runs
    SELECT 'S1', 'SERIALIZABLE', 2, 900000 + row_number() OVER (ORDER BY name), now(), 0, 4, 4, false, 0, 0, 0
    FROM selftest_case
    RETURNING run_id, trial_no
)
INSERT INTO selftest_run
SELECT c.name, i.run_id
FROM ins i
JOIN (SELECT name, 900000 + row_number() OVER (ORDER BY name) AS trial_no FROM selftest_case) c USING (trial_no);

INSERT INTO exp.schedule_log (run_id, seq, txn, op, item, logged_at)
SELECT r.run_id, o.ord * 100,
       'T' || (regexp_match(o.tok, '^[rwca](\d+)'))[1],
       substr(o.tok, 1, 1),
       (regexp_match(o.tok, '\((.*)\)'))[1],      -- r/w: the item; a: the abort reason
       now()
FROM selftest_case c
JOIN selftest_run r USING (name)
CROSS JOIN LATERAL regexp_split_to_table(c.schedule, '\s+') WITH ORDINALITY AS o(tok, ord);

\echo '== Precedence-graph self-test (hand-derived answers vs exp.v_* views) =='
WITH got AS (
    SELECT c.name,
           (SELECT string_agg(e.from_txn || '->' || e.to_txn, ', ' ORDER BY e.from_txn, e.to_txn)
            FROM exp.v_precedence_edge e WHERE e.run_id = r.run_id)                       AS edges,
           (SELECT cycle FROM exp.v_precedence_cycle y
            WHERE y.run_id = r.run_id AND y.scope = 'committed')                         AS cycle,
           (SELECT serial_order FROM exp.v_serial_order s WHERE s.run_id = r.run_id)     AS serial_order,
           (SELECT cycle FROM exp.v_precedence_cycle y
            WHERE y.run_id = r.run_id AND y.scope = 'all')                               AS cycle_all,
           (SELECT v.cycle_broken_by_dbms FROM exp.v_run_serializability v
            WHERE v.run_id = r.run_id)                                                    AS dbms_break,
           c.expect_edges, c.expect_cycle, c.expect_order, c.expect_cycle_all, c.expect_dbms_break
    FROM selftest_case c JOIN selftest_run r USING (name)
)
SELECT name, coalesce(edges, '(none)') AS edges, coalesce(cycle, '-') AS cycle,
       CASE WHEN cycle IS NULL THEN serial_order ELSE '-' END AS serial_order,
       coalesce(cycle_all, '-') AS cycle_incl_aborted, dbms_break,
       CASE WHEN edges IS NOT DISTINCT FROM expect_edges
             AND cycle IS NOT DISTINCT FROM expect_cycle
             AND (expect_cycle IS NOT NULL OR serial_order IS NOT DISTINCT FROM expect_order)
             AND cycle_all IS NOT DISTINCT FROM expect_cycle_all
             AND dbms_break = expect_dbms_break
            THEN 'PASS' ELSE 'FAIL' END AS result
FROM got ORDER BY name;

ROLLBACK;
