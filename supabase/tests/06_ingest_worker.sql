-- Worker failure bookkeeping (migration 0006): ingest_fail counts an attempt that failed
-- outside project_push (e.g. MongoDB down), keeps the message for a retry, dead-letters it
-- after the limit, never reopens a finished delivery, and is service_role only.
-- Everything is rolled back at the end.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(16);

CREATE FUNCTION pg_temp.err(p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v_state TEXT; v_detail TEXT;
BEGIN
    EXECUTE p_sql;
    RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_detail = PG_EXCEPTION_DETAIL;
    RETURN v_state || ':' || coalesce(v_detail, '');
END $$;

-- isolate from anything already queued
DELETE FROM pgmq.q_github_ingest;

CREATE TEMP TABLE pl (body JSONB);
INSERT INTO pl VALUES ($json${
  "ref": "refs/heads/main",
  "repository": {"full_name": "rvce-el/team-alpha", "default_branch": "main"},
  "commits": [{"id": "abababababababababababababababababababab", "timestamp": "2026-11-03T18:00:00+05:30",
               "message": "Add worker probe", "author": {"username": "karthik-m"}, "added": ["db/probe.sql"]}]}$json$);
GRANT SELECT ON pl TO service_role;

-- ---- privileges ----
SELECT is(has_function_privilege('authenticated', 'public.ingest_fail(text,text,integer)', 'EXECUTE'),
          false, 'authenticated cannot EXECUTE ingest_fail');
SELECT is(has_function_privilege('anon', 'public.ingest_fail(text,text,integer)', 'EXECUTE'),
          false, 'anon cannot EXECUTE ingest_fail');
SELECT is(has_function_privilege('service_role', 'public.ingest_fail(text,text,integer)', 'EXECUTE'),
          true, 'service_role can EXECUTE ingest_fail');
SELECT is((SELECT prosecdef FROM pg_proc WHERE oid = 'public.ingest_fail'::regproc), true,
          'ingest_fail is SECURITY DEFINER');

SET LOCAL ROLE service_role;
SELECT is(pg_temp.err($$SELECT ingest_fail('no-such-delivery', 'x')$$), 'P0002:delivery_not_found',
          'unknown delivery is rejected');

SELECT ingest_receive('wk-1', 'push', (SELECT body FROM pl));
RESET ROLE;   -- the queue tables are not visible to API roles; inspect them as the owner
SELECT is((SELECT count(*)::int FROM pgmq.q_github_ingest), 1, 'one message queued');
SET LOCAL ROLE service_role;

-- ---- attempt 1: the raw log write failed ----
SELECT is(ingest_fail('wk-1', 'mongo: ServerSelectionTimeoutError') - 'delivery_id',
          '{"status": "failed", "attempts": 1, "dead_letter": false, "changed": true}'::jsonb,
          'ingest_fail: failed, attempt 1, no dead letter');
SELECT is((SELECT error FROM ingest_event WHERE delivery_id = 'wk-1'),
          'worker: mongo: ServerSelectionTimeoutError', 'the error is recorded with its origin');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM pgmq.q_github_ingest), 1, 'the message stays queued for a retry');
SET LOCAL ROLE service_role;

-- ---- retry succeeds: raw_stored -> projected, attempts keeps counting ----
SELECT is(ingest_mark_raw('wk-1', 'wk-1') ->> 'status', 'raw_stored', 'retry: failed -> raw_stored');
SELECT is(project_push('wk-1', (SELECT body FROM pl), 'wk-1') ->> 'status', 'projected', 'retry: projected');
SELECT is((SELECT attempts FROM ingest_event WHERE delivery_id = 'wk-1'), 2,
          'attempts counts the failed try and the projection');
SELECT is(ingest_fail('wk-1', 'late report') ->> 'changed', 'false',
          'a late failure report does not reopen a projected delivery');

-- ---- dead letter after the limit ----
SELECT ingest_receive('wk-2', 'push', jsonb_set((SELECT body FROM pl), '{commits,0,id}',
                                                '"cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd"'));
SELECT ingest_fail('wk-2', 'boom', 3);
SELECT ingest_fail('wk-2', 'boom', 3);
SELECT is(ingest_fail('wk-2', 'boom', 3) ->> 'dead_letter', 'true', 'third failure with limit 3 is a dead letter');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM pgmq.q_github_ingest
           WHERE message ->> 'delivery_id' = 'wk-2'), 0, 'dead letter left the queue');
SELECT is((SELECT count(*)::int FROM pgmq.a_github_ingest
           WHERE message ->> 'delivery_id' = 'wk-2'), 1, 'dead letter is kept in the archive');

SELECT * FROM finish();
ROLLBACK;
