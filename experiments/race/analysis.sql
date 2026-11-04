-- =====================================================================
--  Component 10 — analysis of the race matrix (exp.experiment_run / _attempt / schedule_log)
--  Run:  docker exec -i elp-race-pg psql -U postgres -d race -X < experiments/race/analysis.sql
--  Creates views in schema exp (re-runnable) and prints the reports.
-- =====================================================================
\pset footer off
\pset null '-'
SET client_min_messages = warning;
DROP VIEW IF EXISTS exp.v_cell_summary, exp.v_run_serializability, exp.v_serial_order,
    exp.v_precedence_cycle, exp.v_precedence_edge, exp.v_precedence_edge_scoped,
    exp.v_committed_txn CASCADE;

-- ---------------------------------------------------------------------
-- (a) Per strategy x isolation x N: over-admission rate, aborts, refusals, latency
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW exp.v_cell_summary AS
WITH run_stats AS (
    SELECT strategy, isolation, n_clients,
           count(*)                                         AS trials,
           avg(over_admitted::int)                          AS over_rate,
           max(final_size)                                  AS worst_final_size,
           max(max_size)                                    AS max_size,
           avg(admitted)                                    AS mean_admitted,
           avg(aborts_40001)                                AS mean_aborts_40001,
           avg(refused)                                     AS mean_refused,
           avg(duration_ms)                                 AS mean_duration_ms
    FROM exp.experiment_run
    GROUP BY strategy, isolation, n_clients
), att_stats AS (
    SELECT r.strategy, r.isolation, r.n_clients,
           percentile_cont(0.50) WITHIN GROUP (ORDER BY a.latency_ms) AS p50_ms,
           percentile_cont(0.95) WITHIN GROUP (ORDER BY a.latency_ms) AS p95_ms,
           avg(a.retries)                                              AS mean_retries,
           count(*) FILTER (WHERE a.outcome = 'deadlock')              AS deadlocks,
           count(*) FILTER (WHERE a.outcome = 'error')                 AS errors
    FROM exp.experiment_run r JOIN exp.experiment_attempt a USING (run_id)
    GROUP BY r.strategy, r.isolation, r.n_clients
)
SELECT s.strategy, s.isolation, s.n_clients, s.trials,
       round(100 * s.over_rate, 1)          AS over_admission_pct,
       s.worst_final_size || '/' || s.max_size AS worst_size,
       round(s.mean_admitted, 2)            AS mean_admitted,
       round(s.mean_aborts_40001, 2)        AS mean_aborts_40001,
       round(s.mean_refused, 2)             AS mean_refused,
       round(a.mean_retries, 2)             AS mean_retries,
       a.deadlocks, a.errors,
       round(a.p50_ms::numeric, 2)          AS p50_ms,
       round(a.p95_ms::numeric, 2)          AS p95_ms,
       -- window function: latency rank of each strategy among its peers (same isolation, same N)
       rank() OVER (PARTITION BY s.isolation, s.n_clients ORDER BY a.p95_ms) AS p95_rank
FROM run_stats s JOIN att_stats a USING (strategy, isolation, n_clients);

\echo '== (a) Over-admission, aborts, refusals and latency per strategy x isolation x N =='
SELECT strategy, isolation AS iso, n_clients AS n, trials,
       over_admission_pct AS "over%", worst_size, mean_admitted AS admitted,
       mean_aborts_40001 AS "40001", mean_refused AS refused, mean_retries AS retries,
       p50_ms, p95_ms, p95_rank AS rk
FROM exp.v_cell_summary
ORDER BY strategy,
         array_position(ARRAY['READ COMMITTED','REPEATABLE READ','SERIALIZABLE'], isolation),
         n_clients;

\echo '== (a2) Over-admission % matrix (strategy x isolation, all N pooled) =='
SELECT strategy,
       round(100 * avg(over_admitted::int) FILTER (WHERE isolation = 'READ COMMITTED'), 1)  AS rc_pct,
       round(100 * avg(over_admitted::int) FILTER (WHERE isolation = 'REPEATABLE READ'), 1) AS rr_pct,
       round(100 * avg(over_admitted::int) FILTER (WHERE isolation = 'SERIALIZABLE'), 1)    AS ser_pct,
       max(final_size) || '/' || max(max_size)                                               AS worst
FROM exp.experiment_run
GROUP BY strategy ORDER BY strategy;

\echo '== (a3) How each attempt ended (counts) =='
SELECT r.strategy, r.isolation AS iso,
       count(*) FILTER (WHERE a.outcome = 'admitted')              AS admitted,
       count(*) FILTER (WHERE a.outcome = 'refused')               AS refused,
       count(*) FILTER (WHERE a.outcome = 'serialization_failure') AS ser_fail,
       count(*) FILTER (WHERE a.outcome = 'deadlock')              AS deadlock,
       count(*) FILTER (WHERE a.outcome = 'error')                 AS error,
       string_agg(DISTINCT a.sqlstate, ',')                        AS sqlstates
FROM exp.experiment_run r JOIN exp.experiment_attempt a USING (run_id)
GROUP BY r.strategy, r.isolation
ORDER BY r.strategy, array_position(ARRAY['READ COMMITTED','REPEATABLE READ','SERIALIZABLE'], r.isolation);

-- ---------------------------------------------------------------------
-- (b) Precedence graph from the LOGICAL, client-recorded schedule (N = 2 runs)
--
--   This is NOT PostgreSQL's internal schedule. PostgreSQL never runs a single r/w
--   interleaving: MVCC keeps row versions, locks are per row, SSI tracks rw-antidependencies.
--   The log is the textbook model of what the clients did; reads are placed at the
--   snapshot they used (RC: when the statement ran; RR/SER: the transaction's first
--   statement). See README "Logical schedule".
--
--   Committed projection: only transactions that committed are nodes (aborted or refused
--   transactions left no effects, as in the textbook definition).
--   Edge Ti -> Tj  iff  some op of Ti precedes a CONFLICTING op of Tj:
--   different transactions, same item, at least one is a write.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW exp.v_committed_txn AS
SELECT run_id, txn FROM exp.schedule_log WHERE op = 'c';

-- scope = 'committed' : committed projection (the textbook test, used for the verdict)
-- scope = 'all'       : every attempted transaction, aborted ones included. A cycle here that is
--                       absent from the committed projection runs through an aborted transaction:
--                       either the DBMS broke it (40001, see cycle_broken_by_dbms) or the client
--                       rolled that transaction back itself after "team is full".
CREATE OR REPLACE VIEW exp.v_precedence_edge_scoped AS
WITH ops AS (
    SELECT s.run_id, s.seq, s.txn, s.op, s.item,
           EXISTS (SELECT 1 FROM exp.v_committed_txn c
                   WHERE c.run_id = s.run_id AND c.txn = s.txn) AS committed
    FROM exp.schedule_log s
    WHERE s.op IN ('r', 'w')
), scopes(scope) AS (VALUES ('committed'), ('all'))
SELECT sc.scope, a.run_id, a.txn AS from_txn, b.txn AS to_txn,
       string_agg(DISTINCT format('%s%s(%s) < %s%s(%s)',
                                  a.op, substr(a.txn, 2), a.item, b.op, substr(b.txn, 2), b.item), '; ') AS because
FROM scopes sc
JOIN ops a ON sc.scope = 'all' OR a.committed
JOIN ops b ON  b.run_id = a.run_id
           AND b.item   = a.item
           AND b.txn   <> a.txn              -- different transactions
           AND b.seq    > a.seq              -- a precedes b in the schedule
           AND (a.op = 'w' OR b.op = 'w')    -- at least one write
           AND (sc.scope = 'all' OR b.committed)
GROUP BY sc.scope, a.run_id, a.txn, b.txn;

CREATE OR REPLACE VIEW exp.v_precedence_edge AS
SELECT run_id, from_txn, to_txn, because FROM exp.v_precedence_edge_scoped WHERE scope = 'committed';

-- Cycle detection: walk every edge path; a path that returns to its start is a cycle.
CREATE OR REPLACE VIEW exp.v_precedence_cycle AS
WITH RECURSIVE walk (scope, run_id, start_txn, cur_txn, path, closed) AS (
    SELECT scope, run_id, from_txn, to_txn, ARRAY[from_txn, to_txn], from_txn = to_txn
    FROM exp.v_precedence_edge_scoped
  UNION ALL
    SELECT w.scope, w.run_id, w.start_txn, e.to_txn, w.path || e.to_txn, e.to_txn = w.start_txn
    FROM walk w
    JOIN exp.v_precedence_edge_scoped e
      ON e.scope = w.scope AND e.run_id = w.run_id AND e.from_txn = w.cur_txn
    WHERE NOT w.closed
      AND (e.to_txn = w.start_txn OR e.to_txn <> ALL (w.path))   -- no revisits except closing
)
SELECT DISTINCT ON (scope, run_id) scope, run_id, array_to_string(path, ' -> ') AS cycle
FROM walk WHERE closed
ORDER BY scope, run_id, cardinality(path), path;

-- Serial order for acyclic graphs: topological levels (longest path from a source).
CREATE OR REPLACE VIEW exp.v_serial_order AS
WITH RECURSIVE lvl (run_id, txn, depth) AS (
    SELECT c.run_id, c.txn, 0
    FROM exp.v_committed_txn c
    WHERE NOT EXISTS (SELECT 1 FROM exp.v_precedence_edge e
                      WHERE e.run_id = c.run_id AND e.to_txn = c.txn)
  UNION ALL
    SELECT l.run_id, e.to_txn, l.depth + 1
    FROM lvl l JOIN exp.v_precedence_edge e ON e.run_id = l.run_id AND e.from_txn = l.txn
    WHERE l.depth < 16                                       -- guard (graphs here have <= 7 nodes)
), node AS (
    SELECT run_id, txn, max(depth) AS depth FROM lvl GROUP BY run_id, txn
)
SELECT run_id, string_agg(txn, ' -> ' ORDER BY depth, txn) AS serial_order
FROM node GROUP BY run_id;

CREATE OR REPLACE VIEW exp.v_run_serializability AS
SELECT r.run_id, r.strategy, r.isolation, r.trial_no, r.final_size, r.max_size, r.over_admitted,
       (SELECT string_agg(s.op || substr(s.txn, 2) ||
                          CASE WHEN s.op IN ('r', 'w') THEN '(' || s.item || ')'
                               ELSE coalesce('[' || s.item || ']', '') END, ' ' ORDER BY s.seq)
        FROM exp.schedule_log s WHERE s.run_id = r.run_id)                         AS logical_schedule,
       (SELECT string_agg(e.from_txn || '->' || e.to_txn, ', ' ORDER BY e.from_txn, e.to_txn)
        FROM exp.v_precedence_edge e WHERE e.run_id = r.run_id)                    AS edges,
       cy.cycle,
       CASE WHEN cy.cycle IS NULL THEN 'conflict-serializable'
            ELSE 'NOT conflict-serializable' END                                   AS verdict,
       CASE WHEN cy.cycle IS NULL THEN so.serial_order END                         AS equivalent_serial_order,
       ca.cycle                                                                    AS cycle_incl_aborted,
       -- a cycle that exists only when aborted transactions are included, AND one of the
       -- transactions on it was killed by the DBMS (40001 ...), not rolled back by the client
       -- after a "team is full" answer (e.g. an RC loser that read the seat set twice and saw
       -- two different states is on a cycle too, but nobody had to break it)
       (cy.cycle IS NULL AND ca.cycle IS NOT NULL AND EXISTS (
            SELECT 1 FROM exp.schedule_log s
            WHERE s.run_id = r.run_id AND s.op = 'a' AND s.item IS DISTINCT FROM 'refused'
              AND s.txn = ANY (string_to_array(ca.cycle, ' -> '))))                AS cycle_broken_by_dbms
FROM exp.experiment_run r
LEFT JOIN exp.v_precedence_cycle cy ON cy.run_id = r.run_id AND cy.scope = 'committed'
LEFT JOIN exp.v_precedence_cycle ca ON ca.run_id = r.run_id AND ca.scope = 'all'
LEFT JOIN exp.v_serial_order     so ON so.run_id = r.run_id
WHERE r.n_clients = 2
  AND EXISTS (SELECT 1 FROM exp.schedule_log s WHERE s.run_id = r.run_id);

\echo '== (b1) N = 2 runs: conflict-serializability of the LOGICAL client-recorded schedule =='
SELECT strategy, isolation AS iso, count(*) AS runs,
       count(*) FILTER (WHERE verdict = 'conflict-serializable')     AS cs,
       count(*) FILTER (WHERE verdict = 'NOT conflict-serializable') AS not_cs,
       count(*) FILTER (WHERE over_admitted)                          AS over_admitted,
       count(*) FILTER (WHERE (cycle IS NOT NULL) = over_admitted)    AS verdict_matches_outcome,
       count(*) FILTER (WHERE cycle IS NULL AND cycle_incl_aborted IS NOT NULL) AS cycle_only_with_aborted,
       count(*) FILTER (WHERE cycle_broken_by_dbms)                    AS broken_by_dbms_abort
FROM exp.v_run_serializability
GROUP BY strategy, isolation
ORDER BY strategy, array_position(ARRAY['READ COMMITTED','REPEATABLE READ','SERIALIZABLE'], isolation);

\echo '== (b2) One example run per strategy x isolation (first trial): schedule, edges, verdict =='
SELECT DISTINCT ON (strategy, isolation)
       strategy, isolation AS iso, final_size || '/' || max_size AS size,
       logical_schedule, coalesce(edges, '(none)') AS edges,
       coalesce(cycle, equivalent_serial_order) AS cycle_or_serial_order, verdict,
       coalesce(cycle_incl_aborted, '-') AS cycle_incl_aborted
FROM exp.v_run_serializability
ORDER BY strategy, isolation, trial_no;

\echo '== (b3) The edges of the S2 / REPEATABLE READ example (why it is not serializable) =='
SELECT e.run_id, e.from_txn || ' -> ' || e.to_txn AS edge, e.because
FROM exp.v_precedence_edge e
WHERE e.run_id = (SELECT min(run_id) FROM exp.v_run_serializability
                  WHERE strategy = 'S2' AND isolation = 'REPEATABLE READ')
ORDER BY edge;

\echo '== (b4) The same idea for S1 / SERIALIZABLE: the cycle existed, SSI aborted one participant =='
SELECT e.run_id, e.from_txn || ' -> ' || e.to_txn AS edge, e.because
FROM exp.v_precedence_edge_scoped e
WHERE e.scope = 'all'
  AND e.run_id = (SELECT min(run_id) FROM exp.v_run_serializability
                  WHERE strategy = 'S1' AND isolation = 'SERIALIZABLE' AND cycle_broken_by_dbms)
ORDER BY edge;

\echo '== (b5) S6 / READ COMMITTED: the loser is on a cycle too, but only through its own two reads =='
\echo '   (RC non-repeatable read: it read the seat set before and after the winner committed;'
\echo '    it wrote nothing and rolled back itself after "no free seat", so no DBMS abort was needed)'
SELECT e.run_id, e.from_txn || ' -> ' || e.to_txn AS edge, e.because
FROM exp.v_precedence_edge_scoped e
WHERE e.scope = 'all'
  AND e.run_id = (SELECT min(run_id) FROM exp.v_run_serializability
                  WHERE strategy = 'S6' AND isolation = 'READ COMMITTED' AND cycle_incl_aborted IS NOT NULL)
ORDER BY edge;
