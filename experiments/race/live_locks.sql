-- =====================================================================
--  Live lock graph during a race: pg_locks ⋈ pg_stat_activity ⋈ pg_blocking_pids()
--  Run while a race is in progress (see demo_locks.sh), in the race database:
--    docker exec -i elp-race-pg psql -U postgres -d race -X < experiments/race/live_locks.sql
--  This is the real, internal lock state of PostgreSQL (unlike the logical schedule in
--  analysis.sql). Row locks are not kept in pg_locks while merely held: they live in the
--  row header (xmax). A waiter shows up as an ungranted ShareLock on the HOLDER's
--  transaction id ("wait until that transaction ends"), plus a tuple lock that orders the
--  queue when several sessions wait for the same row.
-- =====================================================================
\pset footer off
\pset null ''

\echo '== 1. Wait-for graph: who waits on whom (one row per edge) =='
SELECT w.application_name                              AS waiter,
       w.pid                                           AS waiter_pid,
       '--waits for-->'                                AS " ",
       b.application_name                              AS blocker,
       b.pid                                           AS blocker_pid,
       b.state                                         AS blocker_state,
       w.wait_event_type || ':' || w.wait_event        AS waiter_wait_event,
       wl.locktype || ' ' || wl.mode ||
         coalesce(' on ' || wl.relation::regclass::text, '') ||
         coalesce(' xid ' || wl.transactionid::text, '') ||
         coalesce(' (page ' || wl.page || ', tuple ' || wl.tuple || ')', '')
                                                       AS waiter_wants,
       round(extract(epoch FROM now() - w.query_start)::numeric, 2) AS waiting_s,
       left(regexp_replace(w.query, '\s+', ' ', 'g'), 70) AS waiter_query
FROM pg_stat_activity w
CROSS JOIN LATERAL unnest(pg_blocking_pids(w.pid)) AS bp(pid)
JOIN pg_stat_activity b ON b.pid = bp.pid
LEFT JOIN pg_locks wl ON wl.pid = w.pid AND NOT wl.granted
WHERE w.datname = current_database()
ORDER BY w.query_start, w.pid, b.pid;

\echo '== 2. Lock table of the racing sessions (relation, tuple and transactionid locks) =='
SELECT a.application_name                           AS session,
       l.pid,
       l.locktype,
       coalesce(l.relation::regclass::text, '')     AS relation,
       coalesce(l.page || '/' || l.tuple, '')        AS page_tuple,
       coalesce(l.transactionid::text, '')          AS xid,
       l.mode,
       l.granted,
       cardinality(pg_blocking_pids(l.pid)) > 0     AS session_is_waiting,
       a.backend_xid                                AS own_xid,
       a.state
FROM pg_locks l
JOIN pg_stat_activity a ON a.pid = l.pid
WHERE a.datname = current_database()
  AND l.pid <> pg_backend_pid()
  AND l.locktype IN ('relation', 'tuple', 'transactionid')
  AND (l.relation IS NULL
       OR l.relation::regclass::text IN ('team', 'team_member', 'exp.team_counter',
                                         'exp.team_seat', 'exp.team_seat_slot'))
ORDER BY a.application_name, l.granted DESC, l.locktype, relation;

\echo '== 3. Predicate (SIREAD) locks held by SERIALIZABLE transactions, if any =='
SELECT a.application_name AS session, l.pid,
       l.relation::regclass AS relation, l.page, l.tuple, l.mode
FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
WHERE l.mode = 'SIReadLock' AND a.datname = current_database()
ORDER BY session, relation, l.page, l.tuple;
