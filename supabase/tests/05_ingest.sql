-- Ingestion tests (migration 0005): inbox idempotency (delivery id AND push), requeue of
-- recoverable deliveries, projection correctness, the trust model (only the verified pusher's
-- own commits are credited; server time picks milestones), unknown / non-member / spoofed
-- authors, privacy of warnings, the path allow-list, failure atomicity, search_chunks under
-- RLS (latest version only, rarity-weighted keyword ranking, hybrid RRF), the realtime topics
-- and their policy, and RLS on the new tables.
-- Same persona mechanism as 02/03; everything is rolled back at the end.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(120);

-- ---------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------
DELETE FROM app_user;

CREATE TEMP TABLE persona (name TEXT PRIMARY KEY, uid UUID, role TEXT, usn TEXT, faculty_id TEXT);
INSERT INTO persona VALUES
    ('arun',   '00000000-0000-4000-a000-000000000047', 'student', '1RV24CY047', NULL),  -- T00 (solo) T01 T03 T05
    ('vikram', '00000000-0000-4000-a000-000000000058', 'student', '1RV24CY058', NULL),  -- T02 T04 (not T01)
    ('meera',  '00000000-0000-4000-a000-000000000033', 'student', '1RV24CY033', NULL),  -- T01 T03 T06
    ('aditi',  '00000000-0000-4000-a000-000000000011', 'student', '1RV24CY011', NULL),  -- T01 T05 T06
    ('nikhil', '00000000-0000-4000-a000-000000000077', 'student', '1RV24CY077', NULL),  -- no team
    ('f01',    '00000000-0000-4000-a000-0000000000f1', 'faculty', NULL, 'F01'),         -- P01 P05 P06
    ('f02',    '00000000-0000-4000-a000-0000000000f2', 'faculty', NULL, 'F02'),         -- P02
    ('admin',  '00000000-0000-4000-a000-0000000000ad', 'admin',   NULL, NULL);

INSERT INTO auth.users (id, aud, role, email)
SELECT uid, 'authenticated', 'authenticated', name || '@ingest-test.invalid' FROM persona;
INSERT INTO app_user (user_id, role, usn, faculty_id)
SELECT uid, role, usn, faculty_id FROM persona;
GRANT SELECT ON persona TO authenticated, anon, service_role;

CREATE FUNCTION pg_temp.become(p_name TEXT) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_name = 'anon' THEN
        PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
        PERFORM set_config('role', 'anon', true);
    ELSIF p_name = 'service' THEN
        PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
        PERFORM set_config('role', 'service_role', true);
    ELSE
        PERFORM set_config('request.jwt.claims',
            json_build_object('sub', uid, 'role', 'authenticated')::text, true)
        FROM persona WHERE name = p_name;
        PERFORM set_config('role', 'authenticated', true);
    END IF;
END $$;

CREATE FUNCTION pg_temp.err(p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v_state TEXT; v_detail TEXT; v_constraint TEXT;
BEGIN
    EXECUTE p_sql;
    RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_detail = PG_EXCEPTION_DETAIL,
                            v_constraint = CONSTRAINT_NAME;
    RETURN v_state || ':' || coalesce(nullif(v_detail, ''), nullif(v_constraint, ''), '');
END $$;

-- Sample GitHub push payloads for rvce-el/team-alpha (T01, project P01).
-- 'main' is PUSHED by karthik-m (sender: login + GitHub id 770024, a verified identity):
--   c1 karthik-m (login)                AI-Assisted: yes   adds db/x.sql + shared/Test note.md
--   c2 ghost-dev                        unknown author     -> skipped, warning
--   c3 karthik-m (e-mail + login)       Co-Authored-By     modifies db/x.sql -> version 2
--   c4 Arun via no-reply e-mail         not the pusher     -> unverified, skipped, warning
CREATE TEMP TABLE pl (name TEXT PRIMARY KEY, body JSONB);
INSERT INTO pl VALUES
('main', $json${
  "ref": "refs/heads/main", "before": "0000000000000000000000000000000000000000",
  "after": "4444444444444444444444444444444444444444",
  "repository": {"full_name": "rvce-el/team-alpha", "default_branch": "main"},
  "sender": {"login": "karthik-m", "id": 770024},
  "commits": [
    {"id": "1111111111111111111111111111111111111111", "timestamp": "2026-11-03T18:00:00+05:30",
     "message": "Add schema and BCNF note\n\nAI-Assisted: yes",
     "author": {"name": "Karthik M", "email": "karthik.cy24@rvce.edu.in", "username": "karthik-m"},
     "added": ["db/x.sql", "shared/Test note.md", "assets/logo.png"], "modified": [], "removed": [],
     "x_contents": {"shared/Test note.md": "# Test note\n\nBCNF decomposition removes every non-trivial functional dependency whose left side is not a superkey."}},
    {"id": "2222222222222222222222222222222222222222", "timestamp": "2026-11-03T18:05:00+05:30",
     "message": "Drive-by change",
     "author": {"name": "Ghost", "email": "ghost@example.com", "username": "ghost-dev"},
     "added": ["db/ghost.sql"], "modified": [], "removed": []},
    {"id": "3333333333333333333333333333333333333333", "timestamp": "2026-11-03T18:10:00+05:30",
     "message": "Tidy schema\n\nCo-Authored-By: Claude <noreply@anthropic.com>",
     "author": {"name": "Karthik M", "email": "karthik.cy24@rvce.edu.in", "username": "karthik-m"},
     "added": [], "modified": ["db/x.sql"], "removed": []},
    {"id": "4444444444444444444444444444444444444444", "timestamp": "2026-11-03T18:20:00+05:30",
     "message": "Seed data",
     "author": {"name": "Arun Sanjay", "email": "228202223+Arun-Sanjay@users.noreply.github.com"},
     "added": ["db/arun.sql"], "modified": [], "removed": []}
  ]}$json$),
-- pushed by Arun (verified, a T01 member): his commit carries only his no-reply e-mail and a
-- BACKDATED author date (2026-08-01); a second commit claims to be Meera's (spoofed author)
('arun', $json${"ref": "refs/heads/main", "after": "abababababababababababababababababababab",
  "repository": {"full_name": "rvce-el/team-alpha", "default_branch": "main"},
  "sender": {"login": "Arun-Sanjay", "id": 228202223},
  "commits": [
    {"id": "aaaa000000000000000000000000000000000001", "timestamp": "2026-08-01T10:00:00+05:30",
     "message": "Backdated work", "author": {"name": "Arun", "email": "228202223+Arun-Sanjay@users.noreply.github.com"},
     "added": ["db/backdated.sql"]},
    {"id": "aaaa000000000000000000000000000000000002", "timestamp": "2026-11-03T18:30:00+05:30",
     "message": "Meera did this, honest", "author": {"name": "Meera", "email": "meera@x.org", "username": "meera-iyer"},
     "added": ["db/spoofed.sql"]}]}$json$),
-- pushed by nikhil-bhat: verified, but on no team -> not a member of T01
('nonmember', $json${"ref": "refs/heads/main", "after": "abababababababababababababababababababa1",
  "repository": {"full_name": "rvce-el/team-alpha", "default_branch": "main"},
  "sender": {"login": "nikhil-bhat", "id": 770077},
  "commits": [{"id": "bbbb000000000000000000000000000000000001", "timestamp": "2026-11-03T18:40:00+05:30",
               "message": "Not my team", "author": {"username": "nikhil-bhat"}, "added": ["db/nikhil.sql"]}]}$json$),
-- login of a verified identity but the WRONG numeric id (a renamed / reused login): no actor
('wrong_id', $json${"ref": "refs/heads/main", "after": "abababababababababababababababababababa2",
  "repository": {"full_name": "rvce-el/team-alpha", "default_branch": "main"},
  "sender": {"login": "karthik-m", "id": 999999},
  "commits": [{"id": "cccc000000000000000000000000000000000001", "timestamp": "2026-11-03T18:50:00+05:30",
               "message": "x", "author": {"username": "karthik-m"}, "added": ["db/wrongid.sql"]}]}$json$),
-- an outsider's e-mail must not leak into ingest_event.error (faculty can read it)
('outsider', $json${"ref": "refs/heads/main", "after": "abababababababababababababababababababa3",
  "repository": {"full_name": "rvce-el/team-alpha", "default_branch": "main"},
  "sender": {"login": "karthik-m", "id": 770024},
  "commits": [{"id": "dddd000000000000000000000000000000000001", "timestamp": "2026-11-03T18:55:00+05:30",
               "message": "x", "author": {"name": "Out Sider", "email": "outsider.private@gmail.com"},
               "added": ["db/outsider.sql"]}]}$json$),
-- T00 (this repository) has a path allow-list: docs/ is tracked, web/ is not
('t00_paths', $json${"ref": "refs/heads/main", "after": "abababababababababababababababababababa4",
  "repository": {"full_name": "Arun-Sanjay/countersign-dbms", "default_branch": "main"},
  "sender": {"login": "Arun-Sanjay", "id": 228202223},
  "commits": [{"id": "eeee000000000000000000000000000000000001", "timestamp": "2026-11-03T19:00:00+05:30",
               "message": "docs and ui", "author": {"username": "Arun-Sanjay"},
               "added": ["docs/allow-list probe.md", "web/src/Probe.tsx"]}]}$json$),
-- two pushes of one note; the NEWER commit is projected first, the older one arrives late
('zeta_new', $json${"ref": "refs/heads/main", "after": "f000000000000000000000000000000000000002",
  "repository": {"full_name": "rvce-el/team-alpha", "default_branch": "main"},
  "sender": {"login": "karthik-m", "id": 770024},
  "commits": [{"id": "f000000000000000000000000000000000000002", "timestamp": "2026-11-05T10:00:00+05:30",
               "message": "zeta: final", "author": {"username": "karthik-m"}, "modified": ["shared/Zeta note.md"],
               "x_contents": {"shared/Zeta note.md": "# Zeta\n\nThe wombatword decision is final."}}]}$json$),
('zeta_old', $json${"ref": "refs/heads/main", "after": "f000000000000000000000000000000000000001",
  "repository": {"full_name": "rvce-el/team-alpha", "default_branch": "main"},
  "sender": {"login": "karthik-m", "id": 770024},
  "commits": [{"id": "f000000000000000000000000000000000000001", "timestamp": "2026-11-04T10:00:00+05:30",
               "message": "zeta: draft", "author": {"username": "karthik-m"}, "added": ["shared/Zeta note.md"],
               "x_contents": {"shared/Zeta note.md": "# Zeta\n\nThe quokkaword draft was OLD text, later removed."}}]}$json$),
-- a repository that is registered only AFTER its first delivery
('late_repo', $json${"ref": "refs/heads/main", "after": "abababababababababababababababababababa5",
  "repository": {"full_name": "rvce-el/team-late", "default_branch": "main"},
  "sender": {"login": "rahul-nair", "id": 770041},
  "commits": [{"id": "1a1a000000000000000000000000000000000001", "timestamp": "2026-11-03T19:10:00+05:30",
               "message": "x", "author": {"username": "rahul-nair"}, "added": ["db/late.sql"]}]}$json$),
('branch', $json${"ref": "refs/heads/feature/x", "repository": {"full_name": "rvce-el/team-alpha", "default_branch": "main"},
  "commits": [{"id": "5555555555555555555555555555555555555555", "message": "wip",
               "author": {"username": "karthik-m"}, "added": ["db/wip.sql"]}]}$json$),
('unknown_repo', $json${"ref": "refs/heads/main", "repository": {"full_name": "someone/elsewhere", "default_branch": "main"},
  "commits": [{"id": "6666666666666666666666666666666666666666", "message": "x",
               "author": {"username": "karthik-m"}, "added": ["a.sql"]}]}$json$),
('only_ghost', $json${"ref": "refs/heads/main", "repository": {"full_name": "rvce-el/team-alpha", "default_branch": "main"},
  "sender": {"login": "karthik-m", "id": 770024},
  "commits": [{"id": "7777777777777777777777777777777777777777", "timestamp": "2026-11-03T19:00:00+05:30",
               "message": "x", "author": {"username": "ghost-dev"}, "added": ["db/g2.sql"]}]}$json$),
('broken', $json${"ref": "refs/heads/main", "repository": {"full_name": "rvce-el/team-alpha", "default_branch": "main"},
  "sender": {"login": "karthik-m", "id": 770024},
  "commits": [{"id": "8888888888888888888888888888888888888888", "timestamp": "2026-11-03T19:00:00+05:30",
               "message": "ok commit", "author": {"username": "karthik-m"}, "added": ["db/ok.sql"]},
              {"id": "9999999999999999999999999999999999999999", "timestamp": "not-a-date",
               "message": "bad timestamp", "author": {"username": "karthik-m"}, "added": ["db/bad.sql"]}]}$json$);
GRANT SELECT ON pl TO service_role, authenticated;

CREATE TEMP TABLE res (name TEXT PRIMARY KEY, r JSONB);
GRANT ALL ON res TO service_role, authenticated;

-- ---------------------------------------------------------------------
-- A. Catalog
-- ---------------------------------------------------------------------
SELECT has_table('public', 'student_identity', 'table student_identity exists');
SELECT has_table('public', 'team_repo',        'table team_repo exists');
SELECT has_table('public', 'ingest_event',     'table ingest_event exists');
SELECT isnt(to_regclass('pgmq.q_github_ingest'), NULL, 'pgmq queue github_ingest exists');
SELECT is(has_function_privilege('authenticated', 'public.ingest_receive(text,text,jsonb)', 'EXECUTE'),
          false, 'authenticated cannot EXECUTE ingest_receive');
SELECT is(has_function_privilege('authenticated', 'public.project_push(text,jsonb,text)', 'EXECUTE'),
          false, 'authenticated cannot EXECUTE project_push');
SELECT is(has_function_privilege('service_role', 'public.project_push(text,jsonb,text)', 'EXECUTE'),
          true, 'service_role can EXECUTE project_push');
SELECT is((SELECT prosecdef FROM pg_proc WHERE oid = 'public.search_chunks'::regproc),
          false, 'search_chunks is SECURITY INVOKER (RLS applies)');
-- every FK in public/private has an index whose leading columns are the FK columns
SELECT is((SELECT count(*)::int FROM pg_constraint c
           WHERE c.contype = 'f'
             AND c.connamespace IN ('public'::regnamespace, 'private'::regnamespace)
             AND NOT EXISTS (
                 SELECT 1 FROM pg_index i
                 WHERE i.indrelid = c.conrelid
                   AND (i.indkey::int2[])[0:cardinality(c.conkey) - 1] @> c.conkey
                   AND (i.indkey::int2[])[0:cardinality(c.conkey) - 1] <@ c.conkey)),
          0, 'no foreign key without a covering index (advisor: unindexed_foreign_keys)');
SELECT ok(EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'realtime' AND tablename = 'messages'
                    AND policyname = 'countersign_broadcast_select' AND cmd = 'SELECT'),
          'realtime.messages has the team/project-topic SELECT policy');
SELECT ok(position($q$set_config('hnsw.iterative_scan', 'relaxed_order', true)$q$
                   IN pg_get_functiondef('public.search_chunks'::regproc)) > 0,
          'search_chunks scans the HNSW index iteratively (RLS filters after the index)');

-- ---------------------------------------------------------------------
-- B. Inbox: ingest_receive is idempotent per delivery id
-- ---------------------------------------------------------------------
SELECT pg_temp.become('arun');
SELECT is(pg_temp.err($$SELECT ingest_receive('test-x', 'push', '{}')$$), '42501:',
          'a signed-in student cannot call ingest_receive');
RESET ROLE;

SELECT pg_temp.become('service');
INSERT INTO res SELECT 'recv1', ingest_receive('test-d1', 'push', body) FROM pl WHERE name = 'main';
INSERT INTO res SELECT 'recv2', ingest_receive('test-d1', 'push', body) FROM pl WHERE name = 'main';
INSERT INTO res SELECT 'branch', ingest_receive('test-branch', 'push', body) FROM pl WHERE name = 'branch';
INSERT INTO res SELECT 'unknown_repo', ingest_receive('test-unknown-repo', 'push', body) FROM pl WHERE name = 'unknown_repo';
INSERT INTO res SELECT 'issues', ingest_receive('test-issues', 'issues', '{"action":"opened"}');
-- the same signed push re-sent under a NEW delivery id (headers are not signed)
INSERT INTO res SELECT 'recv_d2', ingest_receive('test-d2', 'push', body) FROM pl WHERE name = 'main';
-- a repository registered after its first delivery: ignored, then recovered by a redelivery
INSERT INTO res SELECT 'late1', ingest_receive('tx-late', 'push', body) FROM pl WHERE name = 'late_repo';
SELECT is(pg_temp.err($$SELECT ingest_receive('bad id!', 'push', '{}')$$), '22023:invalid_delivery_id',
          'a malformed delivery id is refused (22023)');
RESET ROLE;

SELECT is((SELECT r ->> 'status' FROM res WHERE name = 'recv1'), 'queued', 'first delivery: queued');
SELECT is((SELECT (r ->> 'duplicate')::boolean FROM res WHERE name = 'recv1'), false, 'first delivery: not a duplicate');
SELECT is((SELECT (r ->> 'duplicate')::boolean FROM res WHERE name = 'recv2'), true, 'redelivery: reported as duplicate');
SELECT is((SELECT count(*)::int FROM ingest_event WHERE delivery_id = 'test-d1'), 1,
          'redelivery: still exactly one ingest_event row');
SELECT is((SELECT count(*)::int FROM pgmq.q_github_ingest WHERE message ->> 'delivery_id' = 'test-d1'), 1,
          'redelivery: still exactly one queue message');
SELECT is((SELECT msg_id FROM ingest_event WHERE delivery_id = 'test-d1'),
          (SELECT msg_id FROM pgmq.q_github_ingest WHERE message ->> 'delivery_id' = 'test-d1'),
          'ingest_event.msg_id points at the queue message (same transaction)');
SELECT is((SELECT status || '/' || coalesce(msg_id::text, 'no msg') FROM ingest_event WHERE delivery_id = 'test-branch'),
          'ignored/no msg', 'push to a non-default branch: ignored, never queued');
SELECT is((SELECT status || '/' || coalesce(team_id, 'no team') FROM ingest_event WHERE delivery_id = 'test-unknown-repo'),
          'ignored/no team', 'push to an unregistered repository: ignored');
SELECT is((SELECT status FROM ingest_event WHERE delivery_id = 'test-issues'), 'ignored', 'non-push event: ignored');
SELECT is((SELECT (r ->> 'duplicate') || '/' || (r ->> 'duplicate_of') FROM res WHERE name = 'recv_d2'), 'true/test-d1',
          'same push under a new delivery id: duplicate of the first delivery');
SELECT is((SELECT count(*)::int FROM ingest_event WHERE delivery_id = 'test-d2')
          + (SELECT count(*)::int FROM pgmq.q_github_ingest WHERE message ->> 'delivery_id' = 'test-d2'), 0,
          'the replayed push stored no inbox row and no queue message');
SELECT is((SELECT sender_login || '/' || push_after FROM ingest_event WHERE delivery_id = 'test-d1'),
          'karthik-m/4444444444444444444444444444444444444444', 'the inbox records the pusher and the push head');

INSERT INTO team_repo (repo_full_name, team_id) VALUES ('rvce-el/team-late', 'T02');
SELECT pg_temp.become('service');
INSERT INTO res SELECT 'late2', ingest_receive('tx-late', 'push', body) FROM pl WHERE name = 'late_repo';
RESET ROLE;
SELECT is((SELECT r ->> 'status' FROM res WHERE name = 'late1'), 'ignored', 'unregistered repository: ignored');
SELECT is((SELECT (r ->> 'requeued') || '/' || (r ->> 'duplicate') || '/' || (r ->> 'status') FROM res WHERE name = 'late2'),
          'true/false/queued', 'redelivered after the repo was registered: requeued in the same transaction');
SELECT is((SELECT status || '/' || team_id || '/' || (msg_id IS NOT NULL) FROM ingest_event WHERE delivery_id = 'tx-late')
          || '/' || (SELECT count(*) FROM pgmq.q_github_ingest WHERE message ->> 'delivery_id' = 'tx-late'),
          'queued/T02/true/1', 'requeued delivery: team set, one queue message');

-- ---------------------------------------------------------------------
-- C. Projection of the sample push
-- ---------------------------------------------------------------------
-- server receive time drives milestones; pin it so the test does not depend on today's date
UPDATE ingest_event SET received_at = '2026-11-03 18:30+05:30' WHERE delivery_id = 'test-d1';
SELECT pg_temp.become('service');
INSERT INTO res SELECT 'raw', ingest_mark_raw('test-d1', 'test-d1');
INSERT INTO res SELECT 'p1', project_push('test-d1', body, 'test-d1') FROM pl WHERE name = 'main';
RESET ROLE;

SELECT is((SELECT r ->> 'status' FROM res WHERE name = 'raw'), 'raw_stored', 'ingest_mark_raw: raw_stored');
SELECT is((SELECT r ->> 'status' FROM res WHERE name = 'p1'), 'projected', 'project_push: projected');
SELECT is((SELECT (r ->> 'artifacts_created')::int FROM res WHERE name = 'p1'), 2,
          'two artifacts created (db/x.sql, shared/Test note.md; the .png is not tracked)');
SELECT is((SELECT (r ->> 'versions')::int FROM res WHERE name = 'p1'), 3, 'three versions (x.sql v1, v2; note v1)');
SELECT is((SELECT (r ->> 'contributions')::int FROM res WHERE name = 'p1'), 3, 'three contributions');
SELECT is((SELECT (r ->> 'chunks')::int FROM res WHERE name = 'p1'), 1, 'one chunk from the markdown note');
SELECT is((SELECT (r ->> 'skipped_commits')::int || '/' || (r ->> 'unverified_commits') || '/' || (r ->> 'actor_usn')
           FROM res WHERE name = 'p1'), '2/1/1RV24CY024',
          'two commits skipped (unknown author; Arun''s commit pushed by Karthik is unverified); actor = Karthik');

CREATE TEMP VIEW x_art AS SELECT * FROM artifact WHERE team_id = 'T01' AND external_ref = 'db/x.sql';
CREATE TEMP VIEW note_art AS SELECT * FROM artifact WHERE team_id = 'T01' AND external_ref = 'shared/Test note.md';
GRANT SELECT ON note_art TO authenticated;

SELECT is((SELECT type || '/' || source || '/' || visibility FROM x_art), 'code/github/team',
          'db/x.sql -> code artifact from github, team visibility');
SELECT is((SELECT type || '/' || source || '/' || title FROM note_art), 'note/obsidian/Test note',
          'shared/*.md -> Obsidian note titled like its file');
SELECT is((SELECT milestone_no FROM x_art), 3,
          'milestone rule: next open P01 milestone by deadline on 2026-11-03 is 3 (ER Diagram, due 11-05)');
SELECT is((SELECT project_id FROM x_art), 'P01', 'artifact belongs to the team''s project');
SELECT is((SELECT string_agg(version_no || ':' || created_by || ':' || ai_assistance || ':' || left(source_ref, 4), ' ' ORDER BY version_no)
           FROM artifact_version WHERE artifact_id = (SELECT artifact_id FROM x_art)),
          '1:1RV24CY024:assisted:1111 2:1RV24CY024:none:3333',
          'one version per commit, authored by the mapped USN, numbered in commit order');
SELECT is((SELECT ai_assisted FROM contribution WHERE source = 'github'
             AND source_ref = '1111111111111111111111111111111111111111'
             AND artifact_id = (SELECT artifact_id FROM x_art)),
          true, 'AI-Assisted: yes trailer -> ai_assisted');
SELECT is((SELECT ai_assisted FROM contribution WHERE source = 'github'
             AND source_ref = '3333333333333333333333333333333333333333'),
          false, 'Co-Authored-By alone does NOT set ai_assisted');
SELECT is((SELECT count(*)::int FROM contribution WHERE source_ref = '4444444444444444444444444444444444444444'), 0,
          'a teammate''s commit pushed by someone else is NOT credited (author claims are unauthenticated)');
SELECT is((SELECT occurred_at FROM contribution WHERE source_ref = '1111111111111111111111111111111111111111'
             AND artifact_id = (SELECT artifact_id FROM x_art)),
          '2026-11-03 18:00:00+05:30'::timestamptz, 'occurred_at = commit timestamp');
SELECT is((SELECT contribution_type || '/' || description FROM contribution
           WHERE source_ref = '1111111111111111111111111111111111111111'
             AND artifact_id = (SELECT artifact_id FROM note_art)),
          'research/Add schema and BCNF note', 'note contribution: research, first line of the message');
SELECT is((SELECT count(*)::int FROM contribution
           WHERE source_ref IN ('2222222222222222222222222222222222222222', '4444444444444444444444444444444444444444')),
          0, 'unknown author and unverified commit: no contributions');
SELECT is((SELECT count(*)::int FROM artifact WHERE team_id = 'T01' AND external_ref IN ('db/ghost.sql', 'db/arun.sql')),
          0, 'unknown author and unverified commit: no artifacts either');
SELECT is((SELECT chunk_no || '/' || version_no || '/' || author_usn || '/' || visibility
           FROM artifact_chunk WHERE artifact_id = (SELECT artifact_id FROM note_art)),
          '1/1/1RV24CY024/team', 'note chunk: chunk_no 1 of version 1, by the author, team visibility');
SELECT is((SELECT content_hash::text FROM artifact_chunk WHERE artifact_id = (SELECT artifact_id FROM note_art)),
          encode(sha256(convert_to('# Test note' || E'\n\n' || 'BCNF decomposition removes every non-trivial functional dependency whose left side is not a superkey.', 'UTF8')), 'hex'),
          'chunk content_hash = sha256 of its text');
SELECT is((SELECT status || '/' || attempts || '/' || mongo_id || '/' || (projected_at IS NOT NULL) || '/' || contribution_count
           FROM ingest_event WHERE delivery_id = 'test-d1'),
          'projected/1/test-d1/true/3', 'ingest_event: projected, 1 attempt, mongo id, projected_at, count');
SELECT ok((SELECT error FROM ingest_event WHERE delivery_id = 'test-d1') LIKE '%unknown author ghost-dev%',
          'warning recorded: unknown author ghost-dev');
SELECT ok((SELECT error FROM ingest_event WHERE delivery_id = 'test-d1')
          LIKE '%commit 4444444: authored as Arun-Sanjay (1RV24CY047) but pushed by karthik-m; unverified, not credited%',
          'warning recorded: Arun''s commit pushed by Karthik is unverified');
SELECT is((SELECT count(*)::int FROM pgmq.q_github_ingest WHERE message ->> 'delivery_id' = 'test-d1')
          || '/' || (SELECT count(*)::int FROM pgmq.a_github_ingest WHERE message ->> 'delivery_id' = 'test-d1'),
          '0/1', 'on success the queue message is archived');

-- ---------------------------------------------------------------------
-- D. Projection idempotency
-- ---------------------------------------------------------------------
CREATE TEMP TABLE before_counts AS
SELECT (SELECT count(*) FROM contribution) AS k, (SELECT count(*) FROM artifact_version) AS v,
       (SELECT count(*) FROM artifact) AS a, (SELECT count(*) FROM artifact_chunk) AS c;

SELECT pg_temp.become('service');
INSERT INTO res SELECT 'p1_again', project_push('test-d1', body, 'test-d1') FROM pl WHERE name = 'main';
RESET ROLE;
SELECT is((SELECT (r ->> 'duplicate')::boolean FROM res WHERE name = 'p1_again'), true,
          'project_push on a projected delivery is a no-op');

-- a worker that crashed after projecting but before the status update: the rows are there
UPDATE ingest_event SET status = 'raw_stored', projected_at = NULL WHERE delivery_id = 'test-d1';
SELECT pg_temp.become('service');
INSERT INTO res SELECT 'p1_crash', project_push('test-d1', body, 'test-d1') FROM pl WHERE name = 'main';
-- the same commits again under a NEW delivery and a different push head (e.g. a re-push)
INSERT INTO res SELECT 'recv_d3', ingest_receive('test-d3', 'push', jsonb_set(body, '{after}', '"3333333333333333333333333333333333333333"'))
FROM pl WHERE name = 'main';
INSERT INTO res SELECT 'p3', project_push('test-d3', jsonb_set(body, '{after}', '"3333333333333333333333333333333333333333"'), 'test-d3')
FROM pl WHERE name = 'main';
RESET ROLE;
SELECT is((SELECT (r ->> 'contributions')::int || '/' || (r ->> 'versions') || '/' || (r ->> 'chunks') || '/' || (r ->> 'artifacts_created')
           FROM res WHERE name = 'p1_crash'),
          '0/0/0/0', 're-projecting the same delivery adds nothing (ON CONFLICT on every key)');
SELECT is((SELECT (r ->> 'contributions')::int || '/' || (r ->> 'versions') FROM res WHERE name = 'p3'),
          '0/0', 'the same commits under another delivery add nothing');
SELECT is(ARRAY[(SELECT count(*) FROM contribution), (SELECT count(*) FROM artifact_version),
                (SELECT count(*) FROM artifact), (SELECT count(*) FROM artifact_chunk)],
          (SELECT ARRAY[k, v, a, c] FROM before_counts),
          'contribution / version / artifact / chunk counts unchanged after three replays');

-- ---------------------------------------------------------------------
-- D2. Trust model: the verified pusher, server time, privacy of warnings, path allow-list
-- ---------------------------------------------------------------------
SELECT pg_temp.become('service');
INSERT INTO res SELECT name, ingest_receive('tx-' || name, 'push', body) FROM pl WHERE name IN ('arun', 'nonmember', 'wrong_id', 'outsider', 't00_paths');
RESET ROLE;
UPDATE ingest_event SET received_at = '2026-11-03 19:00+05:30' WHERE delivery_id LIKE 'tx-%';
SELECT pg_temp.become('service');
INSERT INTO res SELECT 'p_' || name, project_push('tx-' || name, body, NULL) FROM pl WHERE name IN ('arun', 'nonmember', 'wrong_id', 'outsider', 't00_paths');
RESET ROLE;

SELECT is((SELECT usn FROM contribution WHERE source_ref = 'aaaa000000000000000000000000000000000001'), '1RV24CY047',
          'the pusher''s own commit (no-reply e-mail -> login) is credited');
SELECT is((SELECT milestone_no || '/' || created_at FROM artifact WHERE team_id = 'T01' AND external_ref = 'db/backdated.sql'),
          '3/2026-11-03', 'a backdated commit date does not pick an earlier milestone: server receive time does');
SELECT is((SELECT occurred_at FROM contribution WHERE source_ref = 'aaaa000000000000000000000000000000000001'),
          '2026-08-01 10:00+05:30'::timestamptz, 'occurred_at keeps the (self-declared) commit time');
SELECT is((SELECT count(*)::int FROM contribution WHERE source_ref = 'aaaa000000000000000000000000000000000002'), 0,
          'a commit whose author claims to be Meera, pushed by Arun, credits nobody');
SELECT ok((SELECT error FROM ingest_event WHERE delivery_id = 'tx-arun') LIKE '%authored as meera-iyer (1RV24CY033) but pushed by Arun-Sanjay; unverified%',
          'spoofed author: unverified warning');
SELECT ok((SELECT error FROM ingest_event WHERE delivery_id = 'tx-nonmember') LIKE '%nikhil-bhat (1RV24CY077) is not a member of team T01%',
          'a verified pusher outside the team: not a member, skipped');
SELECT is((SELECT (r ->> 'contributions')::int || '/' || coalesce(r ->> 'actor_usn', 'none') FROM res WHERE name = 'p_wrong_id'), '0/none',
          'a known login with the wrong GitHub id is no verified actor: nothing credited');
SELECT ok((SELECT error FROM ingest_event WHERE delivery_id = 'tx-wrong_id') LIKE '%(no verified identity)%',
          'wrong id: the warning says the pusher is not verified');
SELECT ok((SELECT error NOT LIKE '%outsider.private%' AND error LIKE '%unknown author email#' ||
                  left(encode(sha256(convert_to('outsider.private@gmail.com', 'UTF8')), 'hex'), 8) || '%'
           FROM ingest_event WHERE delivery_id = 'tx-outsider'),
          'warnings name an e-mail hash, never the address (faculty can read ingest_event.error)');
SELECT is((SELECT string_agg(external_ref, ',' ORDER BY external_ref) FROM artifact
           WHERE team_id = 'T00' AND external_ref IN ('docs/allow-list probe.md', 'web/src/Probe.tsx')),
          'docs/allow-list probe.md', 'team_repo.track_paths: docs/ becomes an artifact, web/ does not');

-- the queue hands out the oldest message first, with each commit mapped to its CREDITED USN
SELECT pg_temp.become('service');
CREATE TEMP TABLE rd AS SELECT * FROM ingest_read(100, 1);
RESET ROLE;
SELECT ok((SELECT bool_and(msg_id > lag) FROM (SELECT msg_id, lag(msg_id, 1, 0::bigint) OVER (ORDER BY ord) AS lag
           FROM (SELECT msg_id, row_number() OVER () AS ord FROM rd) x) y), 'ingest_read returns messages oldest first');

-- ---------------------------------------------------------------------
-- E. Unknown-author-only push, and failure atomicity
-- ---------------------------------------------------------------------
SELECT pg_temp.become('service');
INSERT INTO res SELECT 'recv_g', ingest_receive('test-ghost', 'push', body) FROM pl WHERE name = 'only_ghost';
INSERT INTO res SELECT 'pg', project_push('test-ghost', body, NULL) FROM pl WHERE name = 'only_ghost';
INSERT INTO res SELECT 'recv_b', ingest_receive('test-broken', 'push', body) FROM pl WHERE name = 'broken';
INSERT INTO res SELECT 'pb', project_push('test-broken', body, NULL) FROM pl WHERE name = 'broken';
RESET ROLE;
SELECT is((SELECT r ->> 'status' || '/' || (r ->> 'contributions') FROM res WHERE name = 'pg'), 'projected/0',
          'push with only an unknown author: projected with 0 contributions');
SELECT ok((SELECT error FROM ingest_event WHERE delivery_id = 'test-ghost') LIKE 'commit 7777777: unknown author ghost-dev%',
          'unknown-author warning names the commit and the login');
SELECT is((SELECT r ->> 'status' FROM res WHERE name = 'pb'), 'failed', 'a bad commit timestamp fails the projection');
SELECT ok((SELECT status = 'failed' AND attempts = 1 AND error LIKE '22007:%' FROM ingest_event WHERE delivery_id = 'test-broken'),
          'failure recorded: status failed, attempts 1, SQLSTATE in error');
SELECT is((SELECT count(*)::int FROM artifact WHERE team_id = 'T01' AND external_ref = 'db/ok.sql'), 0,
          'failure is atomic: the good commit before the bad one left no rows');
SELECT is((SELECT count(*)::int FROM pgmq.q_github_ingest WHERE message ->> 'delivery_id' = 'test-broken'), 1,
          'a failed delivery stays in the queue for a retry');

-- a dead-lettered delivery is recovered by a GitHub redelivery (same X-GitHub-Delivery)
SELECT pg_temp.become('service');
INSERT INTO res SELECT 'dead1', ingest_receive('test-dead', 'push', jsonb_set(body, '{after}', '"7777777777777777777777777777777777777770"'))
FROM pl WHERE name = 'only_ghost';
SELECT ingest_fail('test-dead', 'boom', 1);
INSERT INTO res SELECT 'dead2', ingest_receive('test-dead', 'push', jsonb_set(body, '{after}', '"7777777777777777777777777777777777777770"'))
FROM pl WHERE name = 'only_ghost';
RESET ROLE;
SELECT is((SELECT (r ->> 'requeued') || '/' || (SELECT status || '/' || attempts FROM ingest_event WHERE delivery_id = 'test-dead')
           FROM res WHERE name = 'dead2'), 'true/queued/0',
          'redelivery of a dead letter: queued again, attempts reset');
SELECT is((SELECT count(*)::int FROM pgmq.q_github_ingest WHERE message ->> 'delivery_id' = 'test-dead'), 1,
          'the recovered delivery has exactly one live queue message');

-- ---------------------------------------------------------------------
-- F. search_chunks: permission-safe retrieval
-- ---------------------------------------------------------------------
-- Aditi's PRIVATE chunk on the same note: invisible to her teammates
INSERT INTO artifact_chunk (artifact_id, version_no, author_usn, content, visibility, chunk_no)
SELECT artifact_id, 1, '1RV24CY011', 'My private BCNF worry: is the decomposition dependency preserving?', 'private', 2
FROM note_art;

SELECT pg_temp.become('meera');
SELECT is((SELECT count(*)::int FROM search_chunks('BCNF decomposition') WHERE team_id = 'T01'), 1,
          'meera (T01) finds her team''s note chunk, not Aditi''s private one');
SELECT is((SELECT count(*)::int FROM search_chunks('BCNF decomposition') WHERE visibility = 'private'), 0,
          'meera never sees a private chunk');
SELECT is((SELECT rank_fts::text || '/' || coalesce(rank_vec::text, 'null') || '/' || round(score::numeric, 6)
           FROM search_chunks('BCNF decomposition') ORDER BY score DESC LIMIT 1),
          '1/null/' || round(1 / 61.0, 6), 'keyword-only RRF: top score = 1/(60+1), rank_vec null');
SELECT is((SELECT count(*)::int FROM search_chunks('BCNF', p_author_usn => '1RV24CY047')), 0,
          'p_author_usn filters by author');
SELECT is((SELECT count(*)::int FROM search_chunks('')), 0, 'empty query and no embedding: no results');
RESET ROLE;

SELECT pg_temp.become('aditi');
SELECT is((SELECT count(*)::int FROM search_chunks('BCNF decomposition') WHERE visibility = 'private'), 1,
          'aditi finds her own private chunk');
RESET ROLE;

SELECT pg_temp.become('arun');
SELECT is((SELECT count(*)::int FROM search_chunks('BCNF', p_team_id => 'T01')), 1, 'arun (T01) with p_team_id T01: 1');
SELECT is((SELECT count(*)::int FROM search_chunks('BCNF', p_team_id => 'T00')
           WHERE team_id <> 'T00' OR artifact_id = (SELECT artifact_id FROM note_art)), 0,
          'p_team_id T00 filters the T01 chunk out (whatever T00 itself holds)');
RESET ROLE;

SELECT pg_temp.become('vikram');
SELECT is((SELECT count(*)::int FROM search_chunks('BCNF decomposition superkey') WHERE team_id = 'T01'), 0,
          'vikram (T02, T04; not T01) cannot retrieve T01''s chunks');
RESET ROLE;

SELECT pg_temp.become('nikhil');
SELECT is((SELECT count(*)::int FROM search_chunks('countersign rubric claims evidence BCNF')), 0,
          'nikhil (no team) retrieves nothing');
RESET ROLE;

SELECT pg_temp.become('f01');
SELECT is((SELECT count(*)::int FROM search_chunks('BCNF decomposition')), 0,
          'f01 teaches P01 but sees no TEAM-visibility chunk text');
SELECT ok((SELECT count(*) FROM search_chunks('countersign rubric claims', p_team_id => 'T00')) >= 1,
          'f01 retrieves P06''s SUBMITTED chunks');
RESET ROLE;

SELECT pg_temp.become('f02');
SELECT is((SELECT count(*)::int FROM search_chunks('countersign rubric claims', p_team_id => 'T00')), 0,
          'f02 does not teach P06: sees nothing for P06');
SELECT is((SELECT count(*)::int FROM search_chunks('countersign rubric claims evidence BCNF')), 0,
          'f02 sees nothing at all here (no submitted chunks in P02)');
RESET ROLE;

-- Latest version only: the newer commit was projected FIRST (version 1), the older one late
-- (version 2). The current text is the newer commit's, whatever the arrival order.
SELECT pg_temp.become('service');
INSERT INTO res SELECT 'rz1', ingest_receive('tx-zeta-new', 'push', body) FROM pl WHERE name = 'zeta_new';
INSERT INTO res SELECT 'pz1', project_push('tx-zeta-new', body, NULL) FROM pl WHERE name = 'zeta_new';
INSERT INTO res SELECT 'rz2', ingest_receive('tx-zeta-old', 'push', body) FROM pl WHERE name = 'zeta_old';
INSERT INTO res SELECT 'pz2', project_push('tx-zeta-old', body, NULL) FROM pl WHERE name = 'zeta_old';
RESET ROLE;
SELECT is((SELECT string_agg(version_no || ':' || left(source_ref, 4), ' ' ORDER BY version_no) FROM artifact_version
           WHERE artifact_id = (SELECT artifact_id FROM artifact WHERE team_id = 'T01' AND external_ref = 'shared/Zeta note.md')),
          '1:f000 2:f000', 'arrival order numbers the versions (newer commit = v1, late older commit = v2)');
SELECT pg_temp.become('meera');
SELECT is((SELECT count(*)::int FROM search_chunks('quokkaword')), 0,
          'text that only the OLDER commit had is not found (latest version by commit time)');
SELECT is((SELECT version_no FROM search_chunks('wombatword')), 1,
          'the newer commit''s text is found, even though it is version 1');
RESET ROLE;

-- Natural questions: rare terms outweigh common ones. Six chunks full of common words and
-- one that holds the rare word the question is about.
INSERT INTO artifact_chunk (artifact_id, version_no, author_usn, content, visibility, chunk_no)
SELECT artifact_id, 1, '1RV24CY024', x.t, 'team', x.n
FROM note_art, (VALUES
    (11, 'The team project uses the team database for project data.'),
    (12, 'Our team uses the project database; the project data is shared by the team.'),
    (13, 'Project database setup: the team uses data from the project.'),
    (14, 'Team roles in the project: database owner, data owner, project lead.'),
    (15, 'The database project team uses a data dictionary for the project.'),
    (16, 'Data used by the project team lives in the team database.'),
    (17, 'Data provenance records who changed each record and when.')) AS x(n, t);
SELECT pg_temp.become('meera');
SELECT ok((SELECT snippet LIKE '%**provenance**%' FROM search_chunks('how does the team use data provenance in the database project', p_limit => 3)
           ORDER BY rank_fts LIMIT 1),
          'a natural question ranks the chunk with the rare term (provenance) first');
RESET ROLE;

-- Hybrid: give the note chunk an embedding; a query embedding equal to it ranks it 1st in
-- BOTH lists, so its fused score is 1/61 + 1/61.
UPDATE artifact_chunk
SET embedding = ('[1' || repeat(',0', 1023) || ']')::extensions.vector, embedding_model = 'test-unit-vector'
WHERE artifact_id = (SELECT artifact_id FROM note_art) AND chunk_no = 1;

SELECT pg_temp.become('meera');
SELECT is((SELECT rank_fts::text || '/' || rank_vec::text || '/' || round(score::numeric, 6)
           FROM search_chunks('BCNF decomposition',
                              p_query_embedding => ('[1' || repeat(',0', 1023) || ']')::extensions.vector)
           ORDER BY score DESC LIMIT 1),
          '1/1/' || round(2 / 61.0, 6), 'hybrid RRF: rank 1 in both lists -> 2/(60+1)');
SELECT is((SELECT count(*)::int FROM search_chunks('zzzunmatchedterm',
                              p_query_embedding => ('[1' || repeat(',0', 1023) || ']')::extensions.vector)
           WHERE rank_fts IS NULL AND rank_vec = 1), 1,
          'vector-only match is still returned (rank_fts null)');
RESET ROLE;

SELECT pg_temp.become('vikram');
SELECT is((SELECT count(*)::int FROM search_chunks('zzzunmatchedterm',
                              p_query_embedding => ('[1' || repeat(',0', 1023) || ']')::extensions.vector)), 0,
          'the vector path is RLS-filtered too (vikram gets nothing from T01)');
RESET ROLE;

-- ---------------------------------------------------------------------
-- G. Realtime: metadata-only broadcast on team:<id> (members) and project:<id> (staff)
-- ---------------------------------------------------------------------
SELECT is((SELECT string_agg(topic || '=' || n, ' ' ORDER BY topic) FROM (
             SELECT topic, count(*) AS n FROM realtime.messages
             WHERE payload ->> 'contribution_id' IN
                   (SELECT contribution_id::text FROM contribution WHERE source_ref = '1111111111111111111111111111111111111111')
             GROUP BY topic) x),
          'project:P01=2 team:T01=2', 'each projected contribution was broadcast to team:T01 and project:P01');
SELECT is((SELECT array_agg(DISTINCT k ORDER BY k) FROM realtime.messages m, jsonb_object_keys(m.payload) k
           WHERE m.topic IN ('project:P01', 'team:T01') AND m.payload ->> 'source' = 'github'),
          ARRAY['artifact_id', 'contribution_id', 'id', 'occurred_at', 'source', 'team_id', 'usn'],
          'broadcast payload is metadata only (no description or text)');
SELECT is((SELECT bool_and(private) FROM realtime.messages WHERE topic IN ('project:P01', 'team:T01')), true,
          'broadcasts go to a private channel');
-- a contribution to a PRIVATE artifact is never broadcast (only its owner may know it exists)
CREATE TEMP TABLE rt_before AS SELECT count(*) AS n FROM realtime.messages;
INSERT INTO contribution (usn, artifact_id, contribution_type, description, created_at)
VALUES ('1RV24CY047', 'A18', 'research', 'private doubt', '2026-11-04');
SELECT is((SELECT count(*) FROM realtime.messages) - (SELECT n FROM rt_before), 0::bigint,
          'no broadcast for a contribution to a private artifact');
SELECT realtime.send('{"probe": true}'::jsonb, 'contribution', 'project:P06', true);
SELECT realtime.send('{"probe": true}'::jsonb, 'contribution', 'team:T00', true);
SELECT realtime.send('{"probe": true}'::jsonb, 'contribution', 'team:T02', true);

SELECT pg_temp.become('meera');
SELECT ok((SELECT count(*) FROM realtime.messages WHERE topic = 'team:T01') > 0, 'meera (T01 member) may receive team:T01');
SELECT is((SELECT count(*)::int FROM realtime.messages WHERE topic IN ('project:P01', 'team:T02')), 0,
          'meera receives neither project:P01 (staff only) nor another team''s topic (T02)');
RESET ROLE;
SELECT pg_temp.become('f01');
SELECT ok((SELECT count(*) FROM realtime.messages WHERE topic = 'project:P01') > 0, 'f01 (teaches P01) may receive project:P01');
SELECT ok((SELECT count(*) FROM realtime.messages WHERE topic = 'team:T02') > 0, 'f01 may receive a team topic of P01 (T02)');
RESET ROLE;
SELECT pg_temp.become('f02');
SELECT is((SELECT count(*)::int FROM realtime.messages WHERE topic IN ('project:P01', 'project:P06', 'team:T01', 'team:T00')), 0,
          'f02 receives neither P01 nor P06 topics');
RESET ROLE;
SELECT pg_temp.become('vikram');
SELECT is((SELECT count(*)::int FROM realtime.messages WHERE topic IN ('project:P01', 'team:T01', 'project:P06', 'team:T00')), 0,
          'vikram: neither project:P01 / project:P06 (staff only) nor another team''s topic (T01, T00)');
SELECT ok((SELECT count(*) FROM realtime.messages WHERE topic = 'team:T02') > 0, 'vikram (T02) may receive team:T02');
RESET ROLE;
SELECT pg_temp.become('arun');
SELECT ok((SELECT count(*) FROM realtime.messages WHERE topic = 'team:T00') > 0, 'arun (solo team T00) may receive team:T00');
RESET ROLE;
SELECT pg_temp.become('nikhil');
SELECT is((SELECT count(*)::int FROM realtime.messages), 0, 'nikhil (no team) receives nothing');
RESET ROLE;
SELECT pg_temp.become('admin');
SELECT ok((SELECT count(*) FROM realtime.messages WHERE topic IN ('project:P01', 'project:P06')) > 0, 'admin may receive any project topic');
RESET ROLE;

-- ---------------------------------------------------------------------
-- H. RLS on the new tables
-- ---------------------------------------------------------------------
CREATE TEMP TABLE vis (persona TEXT, rel TEXT, n TEXT);
GRANT ALL ON vis TO authenticated, anon;
CREATE FUNCTION pg_temp.snap(p TEXT) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r TEXT; c BIGINT;
BEGIN
    FOREACH r IN ARRAY ARRAY['student_identity', 'team_repo', 'ingest_event'] LOOP
        BEGIN
            EXECUTE format('SELECT count(*) FROM public.%I %s', r,
                           CASE WHEN r = 'ingest_event' THEN 'WHERE delivery_id LIKE ''test-%''' ELSE '' END) INTO c;
            INSERT INTO vis VALUES (p, r, c::text);
        EXCEPTION WHEN insufficient_privilege THEN
            INSERT INTO vis VALUES (p, r, 'denied');
        END;
    END LOOP;
END $$;
SELECT pg_temp.become('arun');   SELECT pg_temp.snap('arun');   RESET ROLE;
SELECT pg_temp.become('vikram'); SELECT pg_temp.snap('vikram'); RESET ROLE;
SELECT pg_temp.become('meera');  SELECT pg_temp.snap('meera');  RESET ROLE;
SELECT pg_temp.become('nikhil'); SELECT pg_temp.snap('nikhil'); RESET ROLE;
SELECT pg_temp.become('f01');    SELECT pg_temp.snap('f01');    RESET ROLE;
SELECT pg_temp.become('f02');    SELECT pg_temp.snap('f02');    RESET ROLE;
SELECT pg_temp.become('admin');  SELECT pg_temp.snap('admin');  RESET ROLE;
SELECT pg_temp.become('anon');   SELECT pg_temp.snap('anon');   RESET ROLE;

-- student_identity: own rows; faculty: students of projects they teach (F01: P01+P06 students,
--   8 rows incl. Aditi's e-mail identity; F02: P02 = T03's 5 students); admin: all 13.
-- team_repo: repos of the caller's teams / overseen projects.
-- ingest_event (test-% rows only): admin all 8 (d1, branch, unknown-repo, issues, d3, ghost,
--   broken, dead); F01 the 6 with team T01 (not the unregistered repo nor the issues event);
--   nobody else. (test-d2 was a duplicate push: no row.)
SELECT is(string_agg(persona || '=' || n, ' ' ORDER BY persona), e.expected, 'RLS: ' || rel)
FROM vis
JOIN (VALUES
    ('student_identity', 'admin=13 anon=denied arun=1 f01=8 f02=5 meera=1 nikhil=1 vikram=1'),
    ('team_repo',        'admin=4 anon=denied arun=3 f01=3 f02=1 meera=2 nikhil=0 vikram=1'),
    ('ingest_event',     'admin=8 anon=denied arun=0 f01=6 f02=0 meera=0 nikhil=0 vikram=0')
) AS e(rel_name, expected) ON e.rel_name = vis.rel
GROUP BY rel, e.expected
ORDER BY rel;

SELECT pg_temp.become('arun');
SELECT is(pg_temp.err($$INSERT INTO team_repo (repo_full_name, team_id) VALUES ('arun/mine', 'T01')$$),
          '42501:', 'a student cannot register a repository');
SELECT is(pg_temp.err($$INSERT INTO student_identity (provider, provider_login, usn) VALUES ('github', 'someone', '1RV24CY047')$$),
          '42501:', 'a student cannot claim a GitHub login');
SELECT is(pg_temp.err($$UPDATE ingest_event SET status = 'projected'$$), '42501:',
          'nobody but the pipeline writes ingest_event');
RESET ROLE;
SELECT pg_temp.become('admin');
SELECT is(pg_temp.err($$INSERT INTO team_repo (repo_full_name, team_id, default_milestone_no) VALUES ('Rvce-El/Team-Beta', 'T02', 2)$$),
          'ok', 'an admin registers a repository (project filled in, name lower-cased)');
SELECT is((SELECT project_id FROM team_repo WHERE repo_full_name = 'rvce-el/team-beta'), 'P01',
          'team_repo.project_id is derived from the team');
SELECT is(pg_temp.err($$INSERT INTO team_repo (repo_full_name, team_id, project_id, default_milestone_no) VALUES ('rvce-el/x', 'T02', 'P02', 1)$$),
          '23503:Key is not present in table "team".',
          'team_repo: (team, project) must match (composite FK)');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
