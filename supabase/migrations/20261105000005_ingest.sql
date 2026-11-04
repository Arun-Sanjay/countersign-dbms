-- 0005 · Ingestion: GitHub webhook inbox -> raw log (MongoDB) -> projection (Postgres),
-- permission-safe hybrid retrieval, a realtime broadcast of new contributions, and the two
-- FK indexes the performance advisor reported.
--
-- The consistency contract (docs/PLAN.md §2 item 8, "inbox -> log -> projection"):
--
--   GitHub ──POST──> Edge Function github-webhook (verifies X-Hub-Signature-256)
--                      │  supabase-js, service_role
--                      ▼
--   1. INBOX       ingest_receive()  ONE transaction: INSERT ingest_event (delivery_id PK,
--                                    ON CONFLICT DO NOTHING) + pgmq.send('github_ingest').
--                                    A redelivery is a no-op: no second row, no second message.
--   2. LOG         worker: ingest_read() -> upsert the raw event into Mongo elp.github_events
--                  with _id = delivery_id (idempotent) -> ingest_mark_raw(delivery, mongo_id).
--   3. PROJECTION  worker: project_push(delivery, payload, mongo_id): artifact / artifact_version
--                  / contribution / artifact_chunk rows, every INSERT ON CONFLICT DO NOTHING on
--                  an idempotency key, so replaying a delivery changes nothing. On success the
--                  queue message is archived (pgmq.a_github_ingest keeps it as history).
--   4. FOLLOW-UPS  worker: vault notes -> Mongo notes / note_versions, optional embeddings;
--                  ingest_event.followups_at marks them done, so a crash between 3 and 4 is
--                  repaired by the next drain (it re-runs follow-ups for projected events
--                  whose followups_at is still NULL).
--
-- The projection can be REPLAYED from the raw log: Mongo keeps every payload (_id = delivery
-- id), and `python -m app.worker --reproject-from-log` feeds the log back through
-- ingest_receive + project_push (idempotent: every key is a commit SHA). The reverse does not
-- hold: ingest_event deliberately stores no payload. The consistency page diffs the two
-- stores by commit SHA. docs/INGESTION.md has the whole contract.
--
-- Trust model (who gets credit):
--   GitHub authenticates only the PUSHER (payload.sender, a login + numeric id). Commit author
--   name / e-mail / date and the "AI-Assisted: yes" trailer are written by whoever made the
--   commit (`git commit --author`, GIT_AUTHOR_DATE). So a commit is CREDITED (contribution,
--   artifact version) only when its author resolves to the same student as the verified
--   sender; any other commit is logged in Mongo and listed as an "unverified" warning, never
--   counted as evidence. Server time (ingest_event.received_at) drives the milestone choice;
--   the commit time is kept as occurred_at but is self-declared, and so is the AI trailer.
--
-- Append-only like 0002–0004: new tables, new columns, new indexes, new functions.
-- Fixture columns are never changed, so Q1–Q37 still run against the fixture data.

-- =====================================================================
-- 1. Queue (Supabase Queues = the pgmq extension, in its own schema `pgmq`)
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS pgmq;
SELECT pgmq.create('github_ingest');

-- The queue is reached only through the service_role RPCs below, never directly by API users.
REVOKE ALL ON SCHEMA pgmq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA pgmq FROM PUBLIC, anon, authenticated;


-- =====================================================================
-- 2. Tables (physical-schema appendix: kept out of the C3 ER diagram)
-- =====================================================================

-- ---- STUDENT_IDENTITY: who is behind a GitHub login / commit e-mail ----
-- Git author e-mails are self-asserted, so only an admin writes this table (later: GitHub
-- OAuth via Supabase Auth fills it and stamps verified_at). Logins and e-mails are
-- case-insensitive on GitHub, so they are stored lower-case (CHECK) and looked up lower-cased.
CREATE TABLE student_identity (
    provider         VARCHAR(12)  NOT NULL CHECK (provider IN ('github', 'email')),
    provider_login   VARCHAR(254) NOT NULL,          -- GitHub login, or a commit author e-mail
    provider_user_id BIGINT,                         -- GitHub numeric user id (stable across renames)
    usn              VARCHAR(10)  NOT NULL REFERENCES student(usn) ON DELETE CASCADE,  -- erasure
    verified_at      TIMESTAMPTZ,                    -- set when proven via GitHub OAuth
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, provider_login),
    CONSTRAINT student_identity_login_lower CHECK (provider_login = lower(provider_login)),
    CONSTRAINT student_identity_login_format CHECK (CASE provider
        WHEN 'github' THEN provider_login ~ '^[a-z0-9][a-z0-9-]{0,38}$'
        ELSE provider_login ~ '^[^@\s]+@[^@\s]+$' END),
    CONSTRAINT student_identity_user_id_github CHECK (provider = 'github' OR provider_user_id IS NULL)
);
CREATE UNIQUE INDEX student_identity_user_id_key ON student_identity (provider, provider_user_id)
    WHERE provider_user_id IS NOT NULL;
CREATE INDEX student_identity_usn_idx ON student_identity (usn);

-- ---- TEAM_REPO: which repository feeds which team ----
-- (team_id, project_id) is the same documented denormalization as artifact: the composite
-- FK onto team's superkey keeps the copy correct, and lets default_milestone_no reference
-- milestone(project_id, milestone_no), i.e. a milestone of THIS team's project only.
CREATE TABLE team_repo (
    repo_full_name       VARCHAR(140) PRIMARY KEY,   -- 'owner/name', lower-case
    team_id              VARCHAR(5)   NOT NULL,
    project_id           VARCHAR(5)   NOT NULL,      -- filled from team by trigger when omitted
    purpose              VARCHAR(120),
    default_milestone_no INT,                        -- NULL: next open milestone by deadline
    -- Path allow-list: only paths starting with one of these prefixes become artifacts
    -- (NULL = every tracked file type). Keeps e.g. a web/ source tree out of the artifact list.
    track_paths          TEXT[]       CHECK (track_paths IS NULL OR cardinality(track_paths) BETWEEN 1 AND 50),
    added_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT team_repo_name_format CHECK (repo_full_name = lower(repo_full_name)
        AND repo_full_name ~ '^[a-z0-9][a-z0-9-]*/[a-z0-9._-]+$'),
    CONSTRAINT team_repo_team_fkey FOREIGN KEY (team_id, project_id)
        REFERENCES team(team_id, project_id) ON DELETE RESTRICT,
    CONSTRAINT team_repo_milestone_fkey FOREIGN KEY (project_id, default_milestone_no)
        REFERENCES milestone(project_id, milestone_no) ON DELETE RESTRICT
);
CREATE INDEX team_repo_team_project_idx ON team_repo (team_id, project_id);
CREATE INDEX team_repo_milestone_idx    ON team_repo (project_id, default_milestone_no);

-- ---- INGEST_EVENT: the inbox. One row per webhook delivery (X-GitHub-Delivery) ----
-- No payload here: the raw payload travels in the queue message and is logged in Mongo.
CREATE TABLE ingest_event (
    delivery_id        VARCHAR(100) PRIMARY KEY CHECK (delivery_id ~ '^[A-Za-z0-9._:-]{1,100}$'),
    source             VARCHAR(10)  NOT NULL DEFAULT 'github' CHECK (source IN ('github')),
    event_type         VARCHAR(40)  NOT NULL,
    repo_full_name     VARCHAR(140),                 -- as received; no FK (unknown repos are logged)
    team_id            VARCHAR(5)   REFERENCES team(team_id) ON DELETE RESTRICT,
    received_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    status             VARCHAR(12)  NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'raw_stored', 'projected', 'failed', 'ignored')),
    attempts           INT          NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    error              TEXT,                         -- failure, ignore reason, or projection warnings
    mongo_id           TEXT,                         -- elp.github_events _id (= delivery_id)
    msg_id             BIGINT,                       -- pgmq message id (NULL when ignored)
    commit_count       INT          CHECK (commit_count >= 0),
    contribution_count INT          CHECK (contribution_count >= 0),
    projected_at       TIMESTAMPTZ,
    -- the push itself (queued pushes only): a captured body re-sent under a NEW delivery id
    -- (the signature covers the body, not the X-GitHub-Delivery header) is the same push
    push_ref           VARCHAR(255),
    push_after         VARCHAR(40)  CHECK (push_after ~ '^[0-9a-f]{40}$'),
    sender_login       VARCHAR(39),                  -- payload.sender.login: who GitHub says pushed
    followups_at       TIMESTAMPTZ,                  -- worker step 4 done (vault notes, embeddings)
    CONSTRAINT ingest_event_projected_at CHECK ((status = 'projected') = (projected_at IS NOT NULL)),
    CONSTRAINT ingest_event_raw_has_mongo CHECK (status <> 'raw_stored' OR mongo_id IS NOT NULL)
);
CREATE INDEX ingest_event_team_id_idx ON ingest_event (team_id);
CREATE INDEX ingest_event_pending_idx ON ingest_event (received_at)
    WHERE status IN ('queued', 'raw_stored', 'failed');
CREATE UNIQUE INDEX ingest_event_push_key ON ingest_event (repo_full_name, push_ref, push_after)
    WHERE push_after IS NOT NULL;
CREATE INDEX ingest_event_followups_idx ON ingest_event (projected_at)
    WHERE status = 'projected' AND followups_at IS NULL;


-- =====================================================================
-- 3. Idempotency keys on the projection targets (append-only columns + partial UNIQUEs)
-- =====================================================================
-- contribution already has contribution_idempotency_key (source, source_ref, usn, artifact_id).

-- One version per (artifact, commit): source_ref = the commit SHA that produced it.
ALTER TABLE artifact_version ADD COLUMN source_ref TEXT
    CHECK (source_ref IS NULL OR source_ref ~ '^[0-9a-f]{40}$');
CREATE UNIQUE INDEX artifact_version_source_ref_key ON artifact_version (artifact_id, source_ref)
    WHERE source_ref IS NOT NULL;

-- Chunks are numbered within a version; fixture/demo chunks keep chunk_no NULL.
ALTER TABLE artifact_chunk ADD COLUMN chunk_no INT CHECK (chunk_no > 0);
CREATE UNIQUE INDEX artifact_chunk_version_chunk_key ON artifact_chunk (artifact_id, version_no, chunk_no)
    WHERE chunk_no IS NOT NULL;

-- One artifact per repository path within a team (external_ref = path from the repo root).
-- Repo-sourced artifacts that a team created by hand with the same path (e.g. demo A15/A16)
-- are adopted by the projection instead of duplicated.
CREATE UNIQUE INDEX artifact_repo_path_key ON artifact (team_id, external_ref)
    WHERE source IN ('github', 'obsidian') AND external_ref IS NOT NULL;

-- Ingested artifacts get server ids G0001..GFFFF (artifact_id is VARCHAR(5), hand-typed in the
-- fixture). The sequence lives in schema private: API users cannot advance it.
CREATE SEQUENCE private.artifact_github_seq AS INT MINVALUE 1 MAXVALUE 65535 NO CYCLE;


-- =====================================================================
-- 4. Performance advisor: the two unindexed foreign keys
--    skill_evidence's composite FKs (claim_id, usn) and (contribution_id, usn) were covered
--    only by single-column indexes; an FK needs an index whose LEADING columns are the FK
--    columns. The composite indexes also serve every lookup the single-column ones did.
-- =====================================================================
DROP INDEX skill_evidence_claim_id_idx;
DROP INDEX skill_evidence_contribution_idx;
CREATE INDEX skill_evidence_claim_usn_idx        ON skill_evidence (claim_id, usn);
CREATE INDEX skill_evidence_contribution_usn_idx ON skill_evidence (contribution_id, usn);


-- =====================================================================
-- 5. Internal helpers (schema private: not callable by API roles)
-- =====================================================================

-- team_repo.project_id follows from team_id; fill it in so callers need not repeat it.
CREATE FUNCTION private.fill_team_repo_project()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NEW.project_id IS NULL THEN
        SELECT project_id INTO NEW.project_id FROM public.team WHERE team_id = NEW.team_id;
    END IF;
    NEW.repo_full_name := lower(NEW.repo_full_name);
    RETURN NEW;
END $$;

CREATE TRIGGER trg_team_repo_fill_project
BEFORE INSERT OR UPDATE OF team_id, project_id, repo_full_name ON team_repo
FOR EACH ROW EXECUTE FUNCTION private.fill_team_repo_project();

-- Artifact type of a repository path (NULL = not tracked as an artifact):
--   .dot .svg .drawio .mmd .puml                  -> diagram
--   .md under shared/ or vault/ (Obsidian vault)   -> note
--   docs/ (.md .pdf .docx .txt .tex)               -> report
--   .pptx .odp .key                                -> slides
--   .sql .py .ts .tsx .js .jsx .mjs .cjs .sh .css .html -> code
--   any other .md (README, findings ...)           -> report
CREATE FUNCTION private.ingest_artifact_type(p_path TEXT)
RETURNS VARCHAR LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
    SELECT CASE
        WHEN ext IN ('dot', 'svg', 'drawio', 'mmd', 'puml')                     THEN 'diagram'
        WHEN ext = 'md' AND p ~ '(^|/)(shared|vault)/'                         THEN 'note'
        WHEN p ~ '^docs/' AND ext IN ('md', 'pdf', 'docx', 'txt', 'tex')        THEN 'report'
        WHEN ext IN ('pptx', 'odp', 'key')                                      THEN 'slides'
        WHEN ext IN ('sql', 'py', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'sh', 'css', 'html') THEN 'code'
        WHEN ext = 'md'                                                         THEN 'report'
    END
    FROM (SELECT lower(p_path) AS p, lower(substring(p_path FROM '\.([^./]+)$')) AS ext) x;
$$;

-- Kind of work recorded for a commit on an artifact of this type.
CREATE FUNCTION private.ingest_contribution_type(p_artifact_type VARCHAR)
RETURNS VARCHAR LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
    SELECT CASE p_artifact_type
        WHEN 'code'    THEN 'code'
        WHEN 'diagram' THEN 'design'
        WHEN 'note'    THEN 'research'
        ELSE 'documentation' END;
$$;

-- Artifact title (VARCHAR(60)): a note is titled like its Obsidian file; other paths keep
-- their tail when too long.
CREATE FUNCTION private.ingest_title(p_path TEXT, p_type VARCHAR)
RETURNS VARCHAR LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
    SELECT CASE
        WHEN length(t) <= 60 THEN t
        ELSE '…' || right(t, 59) END
    FROM (SELECT CASE WHEN p_type = 'note'
                      THEN regexp_replace(regexp_replace(p_path, '^.*/', ''), '\.md$', '', 'i')
                      ELSE p_path END AS t) x;
$$;

-- AI assistance is DECLARED by a git trailer line "AI-Assisted: yes" (or "true"),
-- never inferred from Co-Authored-By (a co-author line names a person or tool, it is not
-- a declaration, and the platform does not try to detect AI use).
CREATE FUNCTION private.ingest_ai_declared(p_message TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
    SELECT coalesce(p_message, '') ~* '(^|\n)[ \t]*AI-Assisted:[ \t]*(yes|true)[ \t]*(\r?\n|$)';
$$;

-- Commit author -> USN, through student_identity (who the commit CLAIMS to be by):
--   1. author.username (GitHub login)            provider 'github'
--   2. author.email                               provider 'email'
--   2b. author.email_sha256 (hex sha256 of the lower-cased e-mail): the form the Mongo raw log
--       keeps after the worker scrubs e-mail addresses, so a replay from the log still resolves
--   3. a GitHub no-reply e-mail <id>+<login>@users.noreply.github.com -> that login
-- NULL = unknown author (the projection skips the commit and records a warning).
-- This is a CLAIM: see private.ingest_actor for the identity GitHub actually authenticated.
CREATE FUNCTION private.resolve_author(p_author JSONB)
RETURNS VARCHAR LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT coalesce(
        (SELECT usn FROM public.student_identity
         WHERE provider = 'github' AND provider_login = lower(p_author ->> 'username')),
        (SELECT usn FROM public.student_identity
         WHERE provider = 'email' AND provider_login = lower(p_author ->> 'email')),
        (SELECT usn FROM public.student_identity
         WHERE provider = 'email' AND p_author ? 'email_sha256'
           AND encode(sha256(convert_to(provider_login, 'UTF8')), 'hex') = lower(p_author ->> 'email_sha256')
         LIMIT 1),
        (SELECT usn FROM public.student_identity
         WHERE provider = 'github'
           AND provider_login = lower(substring(p_author ->> 'email'
                                                FROM '^[0-9]+\+([^@]+)@users\.noreply\.github\.com$'))));
$$;

-- The PUSHER -> USN: payload.sender is the only identity GitHub authenticates. Matched on
-- the numeric GitHub user id when the identity records one (stable across login renames),
-- else on the login; the identity must be VERIFIED (verified_at set by an admin or, later,
-- by GitHub OAuth). NULL = an unknown or unverified account: nothing in the push is credited.
CREATE FUNCTION private.ingest_actor(p_payload JSONB)
RETURNS VARCHAR LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT si.usn
    FROM public.student_identity si
    WHERE si.provider = 'github' AND si.verified_at IS NOT NULL
      AND CASE WHEN si.provider_user_id IS NOT NULL
               THEN (p_payload #>> '{sender,id}') ~ '^[0-9]{1,18}$'
                    AND si.provider_user_id = (p_payload #>> '{sender,id}')::bigint
               ELSE si.provider_login = lower(p_payload #>> '{sender,login}') END
    ORDER BY (si.provider_user_id IS NOT NULL) DESC
    LIMIT 1;
$$;

-- Is this commit credited? Its claimed author must be the verified pusher AND a member of the
-- repository's team. Returns that USN, else NULL. ingest_read uses it for the Mongo raw log's
-- commits[].author_usn, so the log's "attributed" commits are exactly the ones Postgres credits.
CREATE FUNCTION private.ingest_credit(p_author JSONB, p_actor VARCHAR, p_team_id VARCHAR)
RETURNS VARCHAR LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT a.usn
    FROM (SELECT private.resolve_author(p_author) AS usn) a
    WHERE a.usn IS NOT NULL AND a.usn = p_actor
      AND EXISTS (SELECT 1 FROM public.team_member tm WHERE tm.team_id = p_team_id AND tm.usn = a.usn);
$$;

-- How a commit author is NAMED in warnings (ingest_event.error is readable by faculty): the
-- GitHub login, else a short hash of the e-mail, never the address itself.
CREATE FUNCTION private.ingest_who(p_author JSONB)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
    SELECT coalesce(
        nullif(p_author ->> 'username', ''),
        substring(p_author ->> 'email' FROM '^[0-9]+\+([^@]+)@users\.noreply\.github\.com$'),
        'email#' || left(coalesce(p_author ->> 'email_sha256',
                                  encode(sha256(convert_to(lower(p_author ->> 'email'), 'UTF8')), 'hex')), 8),
        '?');
$$;

-- Is a repository path inside the repo's allow-list (team_repo.track_paths; NULL = all)?
CREATE FUNCTION private.ingest_path_allowed(p_path TEXT, p_prefixes TEXT[])
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
    SELECT p_prefixes IS NULL OR EXISTS (SELECT 1 FROM unnest(p_prefixes) AS x(prefix)
                                         WHERE starts_with(p_path, x.prefix));
$$;

-- Milestone for a NEW artifact first seen in a commit made on day p_day (Asia/Kolkata):
--   1. team_repo.default_milestone_no, if set and not locked;
--   2. else the project's next open milestone by deadline: the unlocked milestone with the
--      earliest deadline >= p_day (ties: lowest milestone_no);
--   3. else (every deadline has passed) the unlocked milestone with the latest deadline;
--   4. else NULL: every milestone is locked, so nothing new can be filed (warning, skipped).
-- An existing artifact keeps its milestone; claims/submissions can still cite it anywhere
-- its team chooses (the student moves it with an artifact UPDATE).
CREATE FUNCTION private.ingest_milestone(p_project_id VARCHAR, p_default INT, p_day DATE)
RETURNS INT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT milestone_no FROM (
        SELECT m.milestone_no, 1 AS pref
        FROM public.milestone m
        WHERE m.project_id = p_project_id AND m.milestone_no = p_default AND m.locked_at IS NULL
        UNION ALL
        (SELECT m.milestone_no, 2
         FROM public.milestone m
         WHERE m.project_id = p_project_id AND m.locked_at IS NULL AND m.deadline >= p_day
         ORDER BY m.deadline, m.milestone_no LIMIT 1)
        UNION ALL
        (SELECT m.milestone_no, 3
         FROM public.milestone m
         WHERE m.project_id = p_project_id AND m.locked_at IS NULL
         ORDER BY m.deadline DESC, m.milestone_no DESC LIMIT 1)
    ) c
    ORDER BY pref
    LIMIT 1;
$$;

-- Next free server artifact id (skips ids someone typed by hand).
CREATE FUNCTION private.next_github_artifact_id()
RETURNS VARCHAR LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id VARCHAR(5);
BEGIN
    LOOP
        v_id := 'G' || lpad(upper(to_hex(nextval('private.artifact_github_seq'))), 4, '0');
        EXIT WHEN NOT EXISTS (SELECT 1 FROM public.artifact WHERE artifact_id = v_id);
    END LOOP;
    RETURN v_id;
END $$;

-- Markdown -> retrieval chunks of at most p_max characters. Paragraphs (blank-line
-- separated) are packed greedily; a heading starts a new chunk once the current one is a
-- quarter full, so a chunk is usually one section; an over-long paragraph is cut.
CREATE FUNCTION private.chunk_markdown(p_text TEXT, p_max INT DEFAULT 1200)
RETURNS TABLE (chunk_no INT, content TEXT)
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
    v_para TEXT;
    v_cur  TEXT := '';
    v_n    INT  := 0;
BEGIN
    FOR v_para IN
        SELECT btrim(x, E' \t\r\n')
        FROM regexp_split_to_table(replace(coalesce(p_text, ''), E'\r\n', E'\n'), E'\n[ \t]*\n')
             WITH ORDINALITY AS s(x, i)
        ORDER BY i
    LOOP
        CONTINUE WHEN v_para = '';
        IF v_cur <> '' AND (length(v_cur) + 2 + length(v_para) > p_max
                            OR (v_para ~ '^#{1,6}\s' AND length(v_cur) >= p_max / 4)) THEN
            v_n := v_n + 1; chunk_no := v_n; content := v_cur; RETURN NEXT;
            v_cur := '';
        END IF;
        WHILE length(v_para) > p_max LOOP              -- v_cur is '' here
            v_n := v_n + 1; chunk_no := v_n; content := left(v_para, p_max); RETURN NEXT;
            v_para := btrim(substr(v_para, p_max + 1), E' \t\r\n');
        END LOOP;
        IF v_para <> '' THEN
            v_cur := CASE WHEN v_cur = '' THEN v_para ELSE v_cur || E'\n\n' || v_para END;
        END IF;
    END LOOP;
    IF v_cur <> '' THEN
        v_n := v_n + 1; chunk_no := v_n; content := v_cur; RETURN NEXT;
    END IF;
END $$;

-- Archive a queue message (kept in pgmq.a_github_ingest as history). NULL-safe.
CREATE FUNCTION private.ingest_archive(p_msg_id BIGINT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF p_msg_id IS NOT NULL THEN
        PERFORM pgmq.archive('github_ingest', p_msg_id);
    END IF;
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon, authenticated;


-- =====================================================================
-- 6. RPCs for the pipeline: service_role only (Edge Function and worker)
--    SECURITY DEFINER, search_path = '': they write tables API users cannot, so every name
--    is schema-qualified; EXECUTE is granted to service_role alone (§9).
--    All 0002 integrity triggers still fire on every row they write (membership required,
--    artifact team/project composite FK, history pins membership ...).
-- =====================================================================

-- ---- 1. INBOX ----
-- Returns {delivery_id, status, duplicate, msg_id, team_id, note[, requeued, duplicate_of]}.
-- Only pushes to the default branch of a registered repository are queued; everything
-- else is logged as 'ignored' with the reason in error (and never queued).
-- Duplicates (nothing new is stored, duplicate = true):
--   * the same X-GitHub-Delivery again (GitHub "Redeliver", or a retry after a timeout);
--   * the same PUSH under a new delivery id: (repository, ref, after) already queued. The
--     webhook signature covers the body only, so a captured body can be re-sent with any
--     delivery header; this key makes that a no-op.
-- Recovery (requeued = true, duplicate = false): a redelivery of a push that was ignored
-- because its repository was not registered yet (and now is), or that was dead-lettered
-- after too many failures, is queued again in this same transaction.
CREATE FUNCTION public.ingest_receive(p_delivery_id TEXT, p_event_type TEXT, p_payload JSONB)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_repo    TEXT := lower(p_payload #>> '{repository,full_name}');
    v_branch  TEXT := coalesce(p_payload #>> '{repository,default_branch}',
                               p_payload #>> '{repository,master_branch}', 'main');
    v_ref     TEXT := left(p_payload ->> 'ref', 255);
    v_after   TEXT := lower(p_payload ->> 'after');
    v_sender  TEXT := left(p_payload #>> '{sender,login}', 39);
    v_commits INT;
    v_team    VARCHAR(5);
    v_status  TEXT := 'queued';
    v_note    TEXT;
    v_msg     BIGINT;
    v_prev    public.ingest_event%ROWTYPE;
    v_found   BOOLEAN := false;
    v_dead    BOOLEAN;
BEGIN
    IF p_delivery_id IS NULL OR p_delivery_id !~ '^[A-Za-z0-9._:-]{1,100}$' THEN
        RAISE EXCEPTION 'Invalid delivery id'
            USING ERRCODE = 'invalid_parameter_value', DETAIL = 'invalid_delivery_id';
    END IF;
    IF p_event_type IS NULL OR p_event_type !~ '^[a-z_]{1,40}$'
       OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
        RAISE EXCEPTION 'Invalid event type or payload'
            USING ERRCODE = 'invalid_parameter_value', DETAIL = 'invalid_payload';
    END IF;
    IF v_after !~ '^[0-9a-f]{40}$' OR v_after = repeat('0', 40) THEN
        v_after := NULL;
    END IF;

    v_commits := CASE WHEN jsonb_typeof(p_payload -> 'commits') = 'array'
                      THEN jsonb_array_length(p_payload -> 'commits') END;
    SELECT team_id INTO v_team FROM public.team_repo WHERE repo_full_name = v_repo;

    IF p_event_type <> 'push' THEN
        v_status := 'ignored'; v_note := format('event %s is not projected', p_event_type);
    ELSIF v_team IS NULL THEN
        v_status := 'ignored'; v_note := format('repository %s is not registered in team_repo', v_repo);
    ELSIF coalesce(p_payload ->> 'deleted', 'false') = 'true' THEN
        v_status := 'ignored'; v_note := 'branch deletion';
    ELSIF v_ref IS DISTINCT FROM 'refs/heads/' || v_branch THEN
        v_status := 'ignored';
        v_note := format('push to %s; only the default branch %s is projected', v_ref, v_branch);
    ELSIF coalesce(v_commits, 0) = 0 THEN
        v_status := 'ignored'; v_note := 'push without commits';
    END IF;

    -- already in the inbox? (by delivery id; for a queueable push also by the push itself)
    SELECT * INTO v_prev FROM public.ingest_event WHERE delivery_id = p_delivery_id FOR UPDATE;
    v_found := FOUND;
    IF NOT v_found AND v_status = 'queued' AND v_after IS NOT NULL THEN
        SELECT * INTO v_prev FROM public.ingest_event
        WHERE repo_full_name = v_repo AND push_ref = v_ref AND push_after = v_after
        FOR UPDATE;
        v_found := FOUND;
    END IF;

    IF v_found THEN
        v_dead := v_prev.status = 'failed'
                  AND NOT EXISTS (SELECT 1 FROM pgmq.q_github_ingest q WHERE q.msg_id = v_prev.msg_id);
        IF v_status = 'queued' AND v_prev.event_type = 'push'
           AND (v_dead
                OR (v_prev.status = 'ignored'
                    AND (v_prev.team_id IS NULL OR v_prev.error LIKE 'repository % is no longer registered')))
           AND NOT EXISTS (SELECT 1 FROM public.ingest_event o
                           WHERE o.delivery_id <> v_prev.delivery_id AND o.repo_full_name = v_repo
                             AND o.push_ref = v_ref AND o.push_after = v_after) THEN
            SELECT s INTO v_msg
            FROM pgmq.send('github_ingest',
                           jsonb_build_object('delivery_id', v_prev.delivery_id,
                                              'event_type',  p_event_type,
                                              'payload',     p_payload)) AS s;
            UPDATE public.ingest_event
            SET status = 'queued', team_id = v_team, msg_id = v_msg, attempts = 0,
                commit_count = v_commits, push_ref = v_ref, push_after = v_after,
                sender_login = v_sender, projected_at = NULL,
                error = format('requeued by delivery %s (was %s)', p_delivery_id,
                               CASE WHEN v_dead THEN 'dead-lettered' ELSE 'ignored' END)
            WHERE delivery_id = v_prev.delivery_id;
            RETURN jsonb_build_object('delivery_id', v_prev.delivery_id, 'status', 'queued',
                                      'duplicate', false, 'requeued', true, 'msg_id', v_msg,
                                      'team_id', v_team);
        END IF;
        RETURN jsonb_build_object('delivery_id', p_delivery_id, 'status', v_prev.status,
                                  'duplicate', true, 'msg_id', v_prev.msg_id, 'team_id', v_prev.team_id)
               || CASE WHEN v_prev.delivery_id <> p_delivery_id
                       THEN jsonb_build_object('duplicate_of', v_prev.delivery_id) ELSE '{}' END;
    END IF;

    INSERT INTO public.ingest_event (delivery_id, event_type, repo_full_name, team_id, status, error,
                                     commit_count, push_ref, push_after, sender_login)
    VALUES (p_delivery_id, p_event_type, left(v_repo, 140), v_team, v_status, v_note, v_commits,
            CASE WHEN v_status = 'queued' THEN v_ref END,
            CASE WHEN v_status = 'queued' THEN v_after END, v_sender)
    ON CONFLICT DO NOTHING;                           -- a concurrent copy won the race

    IF NOT FOUND THEN
        SELECT * INTO v_prev FROM public.ingest_event
        WHERE delivery_id = p_delivery_id
           OR (repo_full_name = v_repo AND push_ref = v_ref AND push_after = v_after)
        LIMIT 1;
        RETURN jsonb_build_object('delivery_id', p_delivery_id, 'status', v_prev.status,
                                  'duplicate', true, 'msg_id', v_prev.msg_id, 'team_id', v_prev.team_id);
    END IF;

    IF v_status = 'queued' THEN                       -- same transaction as the INSERT above
        SELECT s INTO v_msg
        FROM pgmq.send('github_ingest',
                       jsonb_build_object('delivery_id', p_delivery_id,
                                          'event_type',  p_event_type,
                                          'payload',     p_payload)) AS s;
        UPDATE public.ingest_event SET msg_id = v_msg WHERE delivery_id = p_delivery_id;
    END IF;

    RETURN jsonb_build_object('delivery_id', p_delivery_id, 'status', v_status, 'duplicate', false,
                              'msg_id', v_msg, 'team_id', v_team, 'note', v_note);
END $$;

-- ---- 2a. Worker: claim up to p_qty messages for p_vt seconds (pgmq visibility timeout) ----
-- Oldest first (ORDER BY msg_id), so pushes are projected in the order they were received.
-- commit_authors maps each commit SHA to the USN it is CREDITED to (private.ingest_credit:
-- the verified pusher's own commits, if the pusher is on the team), NULL otherwise, so the
-- worker's Mongo github_events.commits[] holds exactly the commits Postgres credits and the
-- rest go to unattributed_commits.
CREATE FUNCTION public.ingest_read(p_qty INT DEFAULT 10, p_vt INT DEFAULT 60)
RETURNS TABLE (msg_id BIGINT, read_ct INT, delivery_id TEXT, event_type TEXT, team_id VARCHAR,
               payload JSONB, commit_authors JSONB)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
    SELECT m.msg_id, m.read_ct,
           m.message ->> 'delivery_id', m.message ->> 'event_type', e.team_id,
           m.message -> 'payload',
           (SELECT jsonb_object_agg(c ->> 'id', private.ingest_credit(c -> 'author', act.usn, e.team_id))
            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(m.message #> '{payload,commits}') = 'array'
                                           THEN m.message #> '{payload,commits}' ELSE '[]' END) AS c
            WHERE c ->> 'id' IS NOT NULL)
    FROM pgmq.read('github_ingest', greatest(coalesce(p_vt, 60), 1),
                   least(greatest(coalesce(p_qty, 10), 1), 100)) AS m
    LEFT JOIN public.ingest_event e ON e.delivery_id = m.message ->> 'delivery_id'
    CROSS JOIN LATERAL (SELECT private.ingest_actor(m.message -> 'payload') AS usn) act
    ORDER BY m.msg_id;
$$;

-- ---- 2b. Worker: the raw event is now in Mongo (step 2 of the contract) ----
CREATE FUNCTION public.ingest_mark_raw(p_delivery_id TEXT, p_mongo_id TEXT)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_status TEXT;
BEGIN
    IF p_mongo_id IS NULL OR btrim(p_mongo_id) = '' THEN
        RAISE EXCEPTION 'mongo_id is required'
            USING ERRCODE = 'invalid_parameter_value', DETAIL = 'mongo_id_required';
    END IF;
    UPDATE public.ingest_event
    SET mongo_id = p_mongo_id,
        status   = CASE WHEN status IN ('queued', 'failed') THEN 'raw_stored' ELSE status END
    WHERE delivery_id = p_delivery_id
    RETURNING status INTO v_status;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown delivery %', p_delivery_id
            USING ERRCODE = 'no_data_found', DETAIL = 'delivery_not_found';
    END IF;
    RETURN jsonb_build_object('delivery_id', p_delivery_id, 'status', v_status, 'mongo_id', p_mongo_id);
END $$;

-- ---- 3. PROJECTION: a GitHub push payload -> relational rows ----
-- Per commit (in payload order) that is CREDITED: its claimed author (private.resolve_author)
-- is the verified pusher (private.ingest_actor, payload.sender) and a member of the repo's team.
--   for every added / modified path with a tracked artifact type inside the repo's
--   track_paths allow-list (removed paths only when the artifact already exists):
--     artifact          found by (team_id, external_ref = path), else created (G-id, type by
--                       extension, source 'obsidian' for vault notes else 'github', visibility
--                       'team', milestone by private.ingest_milestone on the day the SERVER
--                       received the push: the commit date is self-declared and could be
--                       backdated into an earlier milestone)
--     artifact_version  one per (artifact, commit SHA)        key artifact_version_source_ref_key
--                       version_no counts receipts in projection order; created_at = commit
--                       time. "Latest" text is the version with the newest created_at
--                       (search_chunks, the worker's note sync), so a push that arrives late
--                       can never make older text current.
--     contribution      one per (commit, author USN, artifact) key contribution_idempotency_key
--                       source 'github', source_ref = SHA, created_at = server receive day,
--                       occurred_at = commit timestamp (self-declared), ai_assisted = declared
--                       "AI-Assisted: yes" trailer (self-declared)
--     artifact_chunk    markdown body (when the payload carries it, see below) split by
--                       private.chunk_markdown; team visibility; key (artifact, version, chunk_no)
-- A commit by an unknown author, by someone other than the verified pusher ("unverified"), or
-- by someone outside the team is skipped whole and listed as a warning in ingest_event.error
-- (the event is still 'projected'). Warnings name a login or an e-mail hash, never an address.
-- File bodies: GitHub push payloads carry paths, not contents. The worker (or a replay
-- fixture) may add commits[i].x_contents = {"<path>": "<file text at that commit>"}; only
-- markdown bodies are chunked. Without it, versions get content_hash NULL and no chunks.
-- Atomic: the projection runs in a sub-transaction. On any error nothing of it is kept,
-- ingest_event becomes 'failed' with the SQLSTATE and message, and the message stays in the
-- queue for a retry (after 5 attempts it is archived: a dead letter kept for inspection).
CREATE FUNCTION public.project_push(p_delivery_id TEXT, p_payload JSONB, p_mongo_id TEXT DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    ev          public.ingest_event%ROWTYPE;
    rp          public.team_repo%ROWTYPE;
    v_art       public.artifact%ROWTYPE;
    v_repo      TEXT := lower(p_payload #>> '{repository,full_name}');
    c           JSONB;
    v_sha       TEXT;
    v_usn       VARCHAR(10);
    v_who       TEXT;
    v_actor     VARCHAR(10);
    v_sender    TEXT;
    v_ts        TIMESTAMPTZ;
    v_day       DATE;
    v_message   TEXT;
    v_ai        BOOLEAN;
    v_path      TEXT;
    v_removed   BOOLEAN;
    v_type      VARCHAR(10);
    v_milestone INT;
    v_version   INT;
    v_content   TEXT;
    v_rows      INT;
    v_warn      TEXT[] := ARRAY[]::TEXT[];
    v_state     TEXT;
    v_err       TEXT;
    n_commits   INT := 0;
    n_skipped   INT := 0;
    n_unverified INT := 0;
    n_artifacts INT := 0;
    n_versions  INT := 0;
    n_contrib   INT := 0;
    n_chunks    INT := 0;
BEGIN
    -- the row lock serializes concurrent workers on one delivery
    SELECT * INTO ev FROM public.ingest_event WHERE delivery_id = p_delivery_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown delivery %', p_delivery_id
            USING ERRCODE = 'no_data_found', DETAIL = 'delivery_not_found';
    END IF;
    IF ev.status IN ('projected', 'ignored') THEN     -- replay of a finished delivery: no-op
        PERFORM private.ingest_archive(ev.msg_id);
        RETURN jsonb_build_object('delivery_id', p_delivery_id, 'status', ev.status, 'duplicate', true);
    END IF;
    IF p_payload IS NULL OR v_repo IS DISTINCT FROM ev.repo_full_name THEN
        RAISE EXCEPTION 'Payload does not belong to delivery % (repository %)', p_delivery_id, v_repo
            USING ERRCODE = 'invalid_parameter_value', DETAIL = 'payload_mismatch';
    END IF;

    UPDATE public.ingest_event
    SET attempts = attempts + 1, mongo_id = coalesce(p_mongo_id, mongo_id)
    WHERE delivery_id = p_delivery_id
    RETURNING * INTO ev;

    BEGIN                                             -- sub-transaction (savepoint)
        SELECT * INTO rp FROM public.team_repo WHERE repo_full_name = v_repo;
        IF NOT FOUND THEN
            UPDATE public.ingest_event
            SET status = 'ignored', error = format('repository %s is no longer registered', v_repo)
            WHERE delivery_id = p_delivery_id;
            PERFORM private.ingest_archive(ev.msg_id);
            RETURN jsonb_build_object('delivery_id', p_delivery_id, 'status', 'ignored');
        END IF;

        v_actor  := private.ingest_actor(p_payload);
        v_sender := coalesce(p_payload #>> '{sender,login}', '?');
        -- server time decides milestones; the commit time is the author's claim
        v_day    := (ev.received_at AT TIME ZONE 'Asia/Kolkata')::date;

        FOR c IN
            SELECT x FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_payload -> 'commits') = 'array'
                                                    THEN p_payload -> 'commits' ELSE '[]' END)
                          WITH ORDINALITY AS t(x, i)
            ORDER BY i
        LOOP
            v_sha := lower(c ->> 'id');
            IF v_sha IS NULL OR v_sha !~ '^[0-9a-f]{40}$' THEN
                v_warn := v_warn || format('commit %s: not a 40-hex SHA; skipped', coalesce(c ->> 'id', '?'));
                n_skipped := n_skipped + 1;
                CONTINUE;
            END IF;
            n_commits := n_commits + 1;

            v_usn := private.resolve_author(c -> 'author');
            v_who := private.ingest_who(c -> 'author');
            IF v_usn IS NULL THEN
                v_warn := v_warn || format('commit %s: unknown author %s; its contributions were skipped',
                                           left(v_sha, 7), v_who);
                n_skipped := n_skipped + 1;
                CONTINUE;
            END IF;
            IF v_actor IS DISTINCT FROM v_usn THEN
                v_warn := v_warn || format('commit %s: authored as %s (%s) but pushed by %s%s; unverified, not credited',
                                           left(v_sha, 7), v_who, v_usn, v_sender,
                                           CASE WHEN v_actor IS NULL THEN ' (no verified identity)' ELSE '' END);
                n_skipped := n_skipped + 1;
                n_unverified := n_unverified + 1;
                CONTINUE;
            END IF;
            IF NOT EXISTS (SELECT 1 FROM public.team_member WHERE team_id = rp.team_id AND usn = v_usn) THEN
                v_warn := v_warn || format('commit %s: author %s (%s) is not a member of team %s; skipped',
                                           left(v_sha, 7), v_who, v_usn, rp.team_id);
                n_skipped := n_skipped + 1;
                CONTINUE;
            END IF;

            v_ts      := coalesce((c ->> 'timestamp')::timestamptz, ev.received_at);
            v_message := coalesce(c ->> 'message', '');
            v_ai      := private.ingest_ai_declared(v_message);

            FOR v_path, v_removed IN
                SELECT DISTINCT ON (p) p, r
                FROM (SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(c -> 'added') = 'array'
                                                            THEN c -> 'added' ELSE '[]' END), false
                      UNION ALL
                      SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(c -> 'modified') = 'array'
                                                            THEN c -> 'modified' ELSE '[]' END), false
                      UNION ALL
                      SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(c -> 'removed') = 'array'
                                                            THEN c -> 'removed' ELSE '[]' END), true
                     ) AS f(p, r)
                ORDER BY p, r
            LOOP
                v_type := private.ingest_artifact_type(v_path);
                CONTINUE WHEN v_type IS NULL OR length(v_path) > 500
                              OR NOT private.ingest_path_allowed(v_path, rp.track_paths);

                -- find or create the artifact; FOR UPDATE serializes version numbering
                SELECT * INTO v_art FROM public.artifact
                WHERE team_id = rp.team_id AND source IN ('github', 'obsidian') AND external_ref = v_path
                FOR UPDATE;
                IF NOT FOUND THEN
                    CONTINUE WHEN v_removed;
                    v_milestone := private.ingest_milestone(rp.project_id, rp.default_milestone_no, v_day);
                    IF v_milestone IS NULL THEN
                        v_warn := v_warn || format('commit %s: %s: every milestone of %s is locked; not filed',
                                                   left(v_sha, 7), v_path, rp.project_id);
                        CONTINUE;
                    END IF;
                    INSERT INTO public.artifact (artifact_id, team_id, project_id, milestone_no, title, type,
                                                 source, created_at, visibility, external_ref)
                    VALUES (private.next_github_artifact_id(), rp.team_id, rp.project_id, v_milestone,
                            private.ingest_title(v_path, v_type), v_type,
                            CASE WHEN v_type = 'note' THEN 'obsidian' ELSE 'github' END,
                            v_day, 'team', v_path)
                    ON CONFLICT (team_id, external_ref)
                        WHERE source IN ('github', 'obsidian') AND external_ref IS NOT NULL
                    DO NOTHING
                    RETURNING * INTO v_art;
                    IF FOUND THEN
                        n_artifacts := n_artifacts + 1;
                    ELSE                                  -- a concurrent projection created it
                        SELECT * INTO v_art FROM public.artifact
                        WHERE team_id = rp.team_id AND source IN ('github', 'obsidian') AND external_ref = v_path
                        FOR UPDATE;
                    END IF;
                END IF;

                v_content := CASE WHEN NOT v_removed THEN c -> 'x_contents' ->> v_path END;

                -- version: one per (artifact, commit)
                SELECT version_no INTO v_version FROM public.artifact_version
                WHERE artifact_id = v_art.artifact_id AND source_ref = v_sha;
                IF NOT FOUND THEN
                    SELECT coalesce(max(version_no), 0) + 1 INTO v_version
                    FROM public.artifact_version WHERE artifact_id = v_art.artifact_id;
                    INSERT INTO public.artifact_version (artifact_id, version_no, created_by, created_at,
                                                         content_hash, mongo_ref, ai_assistance, source_ref)
                    VALUES (v_art.artifact_id, v_version, v_usn, v_ts,
                            CASE WHEN v_content IS NOT NULL
                                 THEN encode(sha256(convert_to(v_content, 'UTF8')), 'hex') END,
                            ev.mongo_id, CASE WHEN v_ai THEN 'assisted' ELSE 'none' END, v_sha);
                    n_versions := n_versions + 1;
                END IF;

                -- contribution: one per (commit, author, artifact)
                INSERT INTO public.contribution (usn, artifact_id, contribution_type, description, created_at,
                                                 source, source_ref, occurred_at, ai_assisted)
                VALUES (v_usn, v_art.artifact_id, private.ingest_contribution_type(v_art.type),
                        nullif(left(btrim(split_part(v_message, E'\n', 1)), 120), ''),
                        v_day, 'github', v_sha, v_ts, v_ai)
                ON CONFLICT (source, source_ref, usn, artifact_id) WHERE source_ref IS NOT NULL
                DO NOTHING;
                GET DIAGNOSTICS v_rows = ROW_COUNT;
                n_contrib := n_contrib + v_rows;

                -- markdown body -> retrieval chunks of this version
                IF v_content IS NOT NULL AND v_path ~* '\.md$' THEN
                    INSERT INTO public.artifact_chunk (artifact_id, version_no, chunk_no, author_usn, content,
                                                       created_at, content_hash, visibility)
                    SELECT v_art.artifact_id, v_version, k.chunk_no, v_usn, k.content, v_day,
                           encode(sha256(convert_to(k.content, 'UTF8')), 'hex'),
                           CASE WHEN v_art.visibility = 'private' THEN 'private' ELSE 'team' END
                    FROM private.chunk_markdown(v_content) AS k
                    ON CONFLICT (artifact_id, version_no, chunk_no) WHERE chunk_no IS NOT NULL
                    DO NOTHING;
                    GET DIAGNOSTICS v_rows = ROW_COUNT;
                    n_chunks := n_chunks + v_rows;
                END IF;
            END LOOP;
        END LOOP;

        UPDATE public.ingest_event
        SET status = 'projected', projected_at = now(),
            error = nullif(array_to_string(v_warn, E'\n'), ''),
            contribution_count = n_contrib           -- rows this delivery added
        WHERE delivery_id = p_delivery_id;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_err = MESSAGE_TEXT;
        UPDATE public.ingest_event
        SET status = 'failed', error = v_state || ': ' || v_err
        WHERE delivery_id = p_delivery_id;
        IF ev.attempts >= 5 THEN
            PERFORM private.ingest_archive(ev.msg_id);   -- dead letter
        END IF;
        RETURN jsonb_build_object('delivery_id', p_delivery_id, 'status', 'failed',
                                  'attempts', ev.attempts, 'error', v_state || ': ' || v_err);
    END;

    PERFORM private.ingest_archive(ev.msg_id);
    RETURN jsonb_build_object(
        'delivery_id', p_delivery_id, 'status', 'projected', 'duplicate', false,
        'team_id', rp.team_id, 'actor_usn', v_actor, 'commits', n_commits, 'skipped_commits', n_skipped,
        'unverified_commits', n_unverified,
        'artifacts_created', n_artifacts, 'versions', n_versions,
        'contributions', n_contrib, 'chunks', n_chunks, 'warnings', to_jsonb(v_warn));
END $$;


-- =====================================================================
-- 7. search_chunks: permission-safe hybrid retrieval in ONE SQL statement
--    SECURITY INVOKER: the caller's RLS on artifact_chunk and artifact filters every
--    candidate, so the assistant can only ever cite text the asking user may read
--    (a faculty member sees chunk text only once it is 'submitted'; a teammate never sees
--    another student's 'private' chunk). The API calls it with the user's own token.
--
--    Scope: projected chunks (chunk_no set) are whole-file snapshots, one set per commit, so
--    only the LATEST snapshot of each artifact is searched (the version with the newest
--    artifact_version.created_at, i.e. commit time, then the highest version_no): text a later
--    commit removed is not found, and a paragraph kept across versions is not returned once
--    per version. Hand-entered chunks (chunk_no NULL: fixture / demo / app) are fragments, not
--    snapshots, and are all searched.
--
--    Reciprocal Rank Fusion (Cormack, Clarke & Büttcher, SIGIR 2009):
--        score(d) = Σ_{r ∈ {fts, vec}}  1 / (k + rank_r(d)),   k = 60
--    rank_vec = position by cosine distance embedding <=> p_query_embedding (HNSW index),
--    used only when the caller supplies a query embedding and chunks have embeddings.
--    hnsw.iterative_scan = relaxed_order: RLS filters rows AFTER the index picks candidates,
--    so without it a user who may see few chunks could get an empty vector list.
--    rank_fts = position by keyword relevance among chunks matching ANY query term (a natural
--    question rarely has all its words in one passage). Relevance = Σ over the query terms
--    the chunk contains of idf(term)², with the BM25 idf = ln(1 + (N - df + 0.5) / (df + 0.5))
--    and N, df counted over the matching candidates (a tf-idf dot product of query and
--    chunk, term frequency 1). A word most candidates share weighs almost nothing, so one rare
--    word ("provenance") outweighs several common ones ("team", "project", "data");
--    ties: ts_rank_cd, then the newer version. A query with a negation (-word) or a
--    "phrase" keeps websearch semantics as the filter.
--    A list a chunk is missing from contributes 0. Ranks, not raw scores, are fused, so the
--    two incomparable scales never need normalising. Each list is cut to 4·limit candidates.
-- =====================================================================
CREATE FUNCTION public.search_chunks(
    p_query           TEXT,
    p_team_id         TEXT              DEFAULT NULL,
    p_author_usn      TEXT              DEFAULT NULL,
    p_since           TIMESTAMPTZ       DEFAULT NULL,
    p_limit           INT               DEFAULT 10,
    p_query_embedding extensions.vector DEFAULT NULL)
RETURNS TABLE (chunk_id INT, artifact_id VARCHAR, artifact_title VARCHAR, artifact_type VARCHAR,
               version_no INT, chunk_no INT, author_usn VARCHAR, author_name VARCHAR,
               team_id VARCHAR, project_id VARCHAR, visibility VARCHAR, created_at DATE,
               snippet TEXT, score DOUBLE PRECISION, rank_fts INT, rank_vec INT)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
    -- pgvector's hnsw.* settings are applied at run time, transaction-local. (Supabase does not
    -- allow them as a function SET clause.) The cast loads the pgvector library first, so the
    -- settings are real parameters and not placeholders.
    PERFORM '[1]'::extensions.vector;
    PERFORM set_config('hnsw.iterative_scan', 'relaxed_order', true);
    PERFORM set_config('hnsw.ef_search', '200', true);
    RETURN QUERY
WITH params AS (
    SELECT least(greatest(coalesce(p_limit, 10), 1), 50) AS lim,
           60                                              AS rrf_k,
           CASE WHEN numnode(w) = 0                                         THEN NULL
                WHEN strpos(w::text, '!') > 0 OR strpos(w::text, '<') > 0  THEN w
                ELSE replace(w::text, ' & ', ' | ')::tsquery END AS tsq,
           ARRAY(SELECT DISTINCT unnest(tsvector_to_array(to_tsvector('english', coalesce(p_query, '')))))
                                                           AS terms
    FROM (SELECT websearch_to_tsquery('english', coalesce(p_query, '')) AS w) q
),
latest AS (                                -- one snapshot per artifact: the newest commit's
    SELECT DISTINCT ON (c.artifact_id) c.artifact_id, c.version_no
    FROM (SELECT DISTINCT ch.artifact_id, ch.version_no FROM public.artifact_chunk ch
          WHERE ch.chunk_no IS NOT NULL) c
    LEFT JOIN public.artifact_version v ON v.artifact_id = c.artifact_id AND v.version_no = c.version_no
    ORDER BY c.artifact_id, v.created_at DESC NULLS LAST, c.version_no DESC
),
cand AS (                                  -- keyword candidates in scope, with the terms they hold
    SELECT ch.chunk_id, ch.version_no,
           ts_rank_cd(ch.tsv, p.tsq) AS cd,
           ARRAY(SELECT l FROM unnest(tsvector_to_array(ch.tsv)) AS l WHERE l = ANY (p.terms)) AS hit
    FROM public.artifact_chunk ch
    LEFT JOIN latest lv     ON lv.artifact_id = ch.artifact_id
    JOIN public.artifact a  ON a.artifact_id = ch.artifact_id
    CROSS JOIN params p
    WHERE p.tsq IS NOT NULL AND ch.tsv @@ p.tsq
      AND (ch.chunk_no IS NULL OR ch.version_no = lv.version_no)
      AND (p_team_id    IS NULL OR a.team_id = p_team_id)
      AND (p_author_usn IS NULL OR ch.author_usn = p_author_usn)
      AND (p_since      IS NULL OR ch.created_at >= p_since::date)
),
idf AS (                                   -- rarity of each query term among the candidates
    SELECT t.l, power(ln(1.0 + ((SELECT count(*) FROM cand) - count(*) + 0.5) / (count(*) + 0.5)), 2) AS w
    FROM cand, unnest(cand.hit) AS t(l)
    GROUP BY t.l
),
fts AS (                                   -- keyword list, best first
    SELECT f.chunk_id, row_number() OVER (ORDER BY f.rel DESC, f.cd DESC, f.version_no DESC, f.chunk_id)::int AS rnk
    FROM (SELECT c.chunk_id, c.version_no, c.cd,
                 coalesce((SELECT sum(i.w) FROM idf i WHERE i.l = ANY (c.hit)), 0) AS rel
          FROM cand c
          ORDER BY rel DESC, c.cd DESC, c.version_no DESC, c.chunk_id
          LIMIT (SELECT 4 * lim FROM params)) f
),
vec AS (                                   -- semantic list, nearest first
    SELECT v.chunk_id, row_number() OVER (ORDER BY v.d, v.chunk_id)::int AS rnk
    FROM (SELECT ch.chunk_id, ch.embedding OPERATOR(extensions.<=>) p_query_embedding AS d
          FROM public.artifact_chunk ch
          LEFT JOIN latest lv     ON lv.artifact_id = ch.artifact_id
          JOIN public.artifact a  ON a.artifact_id = ch.artifact_id
          WHERE p_query_embedding IS NOT NULL AND ch.embedding IS NOT NULL
            AND (ch.chunk_no IS NULL OR ch.version_no = lv.version_no)
            AND (p_team_id    IS NULL OR a.team_id = p_team_id)
            AND (p_author_usn IS NULL OR ch.author_usn = p_author_usn)
            AND (p_since      IS NULL OR ch.created_at >= p_since::date)
          ORDER BY ch.embedding OPERATOR(extensions.<=>) p_query_embedding
          LIMIT (SELECT 4 * lim FROM params)) v
),
fused AS (                                 -- RRF: Σ 1/(k + rank)
    SELECT u.chunk_id,
           sum(1.0 / ((SELECT rrf_k FROM params) + u.rnk))::double precision AS score,
           min(u.rnk) FILTER (WHERE u.src = 'fts') AS rank_fts,
           min(u.rnk) FILTER (WHERE u.src = 'vec') AS rank_vec
    FROM (SELECT fts.chunk_id, fts.rnk, 'fts' AS src FROM fts
          UNION ALL
          SELECT vec.chunk_id, vec.rnk, 'vec' FROM vec) u
    GROUP BY u.chunk_id
)
SELECT ch.chunk_id, a.artifact_id, a.title, a.type, ch.version_no, ch.chunk_no,
       ch.author_usn, s.name, a.team_id, a.project_id, ch.visibility, ch.created_at,
       coalesce(ts_headline('english', ch.content, p.tsq,
                            'StartSel=**, StopSel=**, MaxWords=35, MinWords=12, MaxFragments=2, FragmentDelimiter=" … "'),
                left(ch.content, 240)) AS snippet,
       f.score, f.rank_fts, f.rank_vec
FROM fused f
JOIN public.artifact_chunk ch ON ch.chunk_id = f.chunk_id
JOIN public.artifact a        ON a.artifact_id = ch.artifact_id
JOIN public.student s         ON s.usn = ch.author_usn
CROSS JOIN params p
ORDER BY f.score DESC, f.rank_fts NULLS LAST, f.rank_vec NULLS LAST, ch.version_no DESC, ch.chunk_id
LIMIT (SELECT lim FROM params);
END;
$$;


-- =====================================================================
-- 8. Realtime: a new contribution is broadcast to two private topics,
--      'team:<team_id>'     the team's members (and the project's staff),
--      'project:<id>'       the project's teaching faculty and admins only,
--    so a student never hears about another team's work (RLS hides those rows from them
--    too). METADATA ONLY (ids, time, source; never the description or any text), sent with
--    realtime.send (Broadcast from the database), not postgres_changes, which would ship
--    whole rows. Contributions to a PRIVATE artifact are not broadcast at all (only the
--    owner may know it exists). Who may listen: RLS on realtime.messages (below), checked
--    by Realtime when a client joins the private channel.
-- =====================================================================
CREATE FUNCTION private.broadcast_contribution()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_team VARCHAR(5); v_project VARCHAR(5); v_visibility VARCHAR(10); v_payload JSONB;
BEGIN
    SELECT team_id, project_id, visibility INTO v_team, v_project, v_visibility
    FROM public.artifact WHERE artifact_id = NEW.artifact_id;
    IF v_project IS NULL OR v_visibility = 'private' THEN
        RETURN NULL;
    END IF;
    v_payload := jsonb_build_object('contribution_id', NEW.contribution_id,
                                    'team_id',         v_team,
                                    'usn',             NEW.usn,
                                    'artifact_id',     NEW.artifact_id,
                                    'occurred_at',     coalesce(NEW.occurred_at, NEW.created_at::timestamptz),
                                    'source',          NEW.source);
    -- event, topic, private channel (RLS decides who receives it)
    PERFORM realtime.send(v_payload, 'contribution', 'team:' || v_team, true);
    PERFORM realtime.send(v_payload, 'contribution', 'project:' || v_project, true);
    RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.broadcast_contribution() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_contribution_broadcast
AFTER INSERT ON contribution
FOR EACH ROW EXECUTE FUNCTION private.broadcast_contribution();

-- May the caller listen on this topic?
--   team:<id>     a member of the team, or staff overseeing its project
--   project:<id>  staff overseeing the project (teaching faculty, admins)
-- The same people artifact / contribution RLS shows these rows to (private artifacts are
-- never broadcast).
CREATE FUNCTION app.can_watch_topic(p_topic TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT CASE split_part(p_topic, ':', 1)
        WHEN 'team' THEN
            app.is_team_member(split_part(p_topic, ':', 2))
            OR EXISTS (SELECT 1 FROM public.team t
                       WHERE t.team_id = split_part(p_topic, ':', 2) AND app.oversees_project(t.project_id))
        WHEN 'project' THEN app.oversees_project(split_part(p_topic, ':', 2))
        ELSE false END;
$$;
REVOKE ALL ON FUNCTION app.can_watch_topic(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app.can_watch_topic(TEXT) TO authenticated, service_role;

-- The row's own topic is checked (not only realtime.topic()), so the policy is also correct
-- for a plain SELECT on realtime.messages; Realtime's join check reads a row whose topic is
-- the channel being joined. There is no INSERT policy: clients cannot broadcast on these
-- topics, only the database trigger can.
CREATE POLICY countersign_broadcast_select ON realtime.messages
    FOR SELECT TO authenticated
    USING (realtime.messages.extension = 'broadcast'
           AND (realtime.messages.topic LIKE 'project:%' OR realtime.messages.topic LIKE 'team:%')
           AND app.can_watch_topic(realtime.messages.topic));


-- =====================================================================
-- 9. Security: RLS, policies and privileges for the new tables and functions
-- =====================================================================
ALTER TABLE student_identity ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_repo        ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingest_event     ENABLE ROW LEVEL SECURITY;

-- ---- student_identity: the student themself, admins, and the faculty teaching a project
--      the student is in. Only admins write (an identity decides whose work a commit is).
CREATE POLICY student_identity_select ON student_identity FOR SELECT TO authenticated
    USING (usn = (select app.current_usn())
           OR (select app.is_admin())
           OR EXISTS (SELECT 1 FROM team_member tm JOIN team t ON t.team_id = tm.team_id
                      WHERE tm.usn = student_identity.usn AND app.teaches_project(t.project_id)));
CREATE POLICY student_identity_insert ON student_identity FOR INSERT TO authenticated
    WITH CHECK ((select app.is_admin()));
CREATE POLICY student_identity_update ON student_identity FOR UPDATE TO authenticated
    USING ((select app.is_admin())) WITH CHECK ((select app.is_admin()));
CREATE POLICY student_identity_delete ON student_identity FOR DELETE TO authenticated
    USING ((select app.is_admin()));

-- ---- team_repo: the team's members and the project's staff; admins write ----
CREATE POLICY team_repo_select ON team_repo FOR SELECT TO authenticated
    USING (app.is_team_member(team_id) OR app.oversees_project(project_id));
CREATE POLICY team_repo_insert ON team_repo FOR INSERT TO authenticated
    WITH CHECK ((select app.is_admin()));
CREATE POLICY team_repo_update ON team_repo FOR UPDATE TO authenticated
    USING ((select app.is_admin())) WITH CHECK ((select app.is_admin()));
CREATE POLICY team_repo_delete ON team_repo FOR DELETE TO authenticated
    USING ((select app.is_admin()));

-- ---- ingest_event: pipeline metadata for admins and the faculty of the team's project.
--      Written only by the service_role RPCs (no write policy, no write grant).
CREATE POLICY ingest_event_select ON ingest_event FOR SELECT TO authenticated
    USING ((select app.is_admin())
           OR EXISTS (SELECT 1 FROM team t
                      WHERE t.team_id = ingest_event.team_id AND app.teaches_project(t.project_id)));

GRANT SELECT, INSERT, UPDATE, DELETE ON student_identity, team_repo TO authenticated;
GRANT SELECT ON ingest_event TO authenticated;
GRANT ALL ON student_identity, team_repo, ingest_event TO service_role;
REVOKE ALL ON student_identity, team_repo, ingest_event FROM anon;

-- Pipeline RPCs: service_role only. New functions are executable by PUBLIC by default.
REVOKE ALL ON FUNCTION
    public.ingest_receive(TEXT, TEXT, JSONB),
    public.ingest_read(INT, INT),
    public.ingest_mark_raw(TEXT, TEXT),
    public.project_push(TEXT, JSONB, TEXT)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
    public.ingest_receive(TEXT, TEXT, JSONB),
    public.ingest_read(INT, INT),
    public.ingest_mark_raw(TEXT, TEXT),
    public.project_push(TEXT, JSONB, TEXT)
TO service_role;

-- Retrieval: signed-in users (runs under their RLS) and the service role.
REVOKE ALL ON FUNCTION public.search_chunks(TEXT, TEXT, TEXT, TIMESTAMPTZ, INT, extensions.vector)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_chunks(TEXT, TEXT, TEXT, TIMESTAMPTZ, INT, extensions.vector)
TO authenticated, service_role;
