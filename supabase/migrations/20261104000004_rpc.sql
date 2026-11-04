-- 0004 · RPCs: the app's write paths and skill queries as Postgres functions ("fat DB, thin API").
--
-- Conventions
--   * Schema public (exposed through PostgREST as /rest/v1/rpc/<name>), every one returns jsonb.
--   * SECURITY INVOKER (the default, written out): the function runs as the CALLER, so the
--     0003 RLS policies and the 0002 integrity triggers still apply to every statement inside.
--     The RPC adds a friendlier pre-check; the database rules remain the real guarantee.
--     Exception: the private-note RPCs are SECURITY DEFINER (schema private has no grants),
--     and each one filters on owner_usn = app.current_usn() explicitly.
--   * SET search_path = '' and fully qualified names: nothing can be hijacked via search_path.
--   * Each function body is one transaction: if any step fails, nothing it did is kept.
--   * Errors carry a real SQLSTATE; DETAIL holds a stable rule key the web maps to a field
--     (PostgREST returns them as `code` and `details`):
--       42501 insufficient_privilege            wrong role / not your team / not your claim
--       P0002 no_data_found                     unknown or invisible team, claim, note ...
--       22023 invalid_parameter_value           bad input (mirrors the zod form rules)
--       55000 object_not_in_prerequisite_state  locked milestone, claim no longer pending ...
--       23505 / 23514                           UNIQUE / CHECK-style rules (also from triggers)

-- (The schema these RPCs rely on, e.g. submission.attempt_no, claim.contribution_type,
--  claim.revision and the lock/history triggers, lives in 0002; privileges in 0003.)

-- =====================================================================
-- 2. Team membership
-- =====================================================================

-- join_team: the caller joins a team. Capacity (v2, race-safe), one team per project and
-- enrollment are 0002 trigger rules; the role (first member leads) is set by a 0003 trigger.
CREATE FUNCTION public.join_team(p_team_id VARCHAR)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
    v_usn  VARCHAR(10) := app.current_usn();
    v_team public.team%ROWTYPE;
    v_role VARCHAR(20);
    v_size INT;
BEGIN
    IF v_usn IS NULL THEN
        RAISE EXCEPTION 'Only a signed-in student can join a team'
            USING ERRCODE = 'insufficient_privilege', DETAIL = 'student_required';
    END IF;
    SELECT * INTO v_team FROM public.team WHERE team_id = p_team_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Team % does not exist', p_team_id
            USING ERRCODE = 'no_data_found', DETAIL = 'team_not_found';
    END IF;
    IF EXISTS (SELECT 1 FROM public.team_member WHERE team_id = p_team_id AND usn = v_usn) THEN
        RAISE EXCEPTION 'You are already a member of team %', p_team_id
            USING ERRCODE = 'unique_violation', DETAIL = 'already_member';
    END IF;

    INSERT INTO public.team_member (team_id, usn) VALUES (p_team_id, v_usn)
    RETURNING role INTO v_role;

    SELECT count(*) INTO v_size FROM public.team_member WHERE team_id = p_team_id;
    RETURN jsonb_build_object('team_id', p_team_id, 'project_id', v_team.project_id, 'usn', v_usn,
                              'role', v_role, 'members', v_size, 'max_size', v_team.max_size);
END $$;

-- leave_team: the caller leaves a team. The rule "you cannot leave a team you have recorded
-- work in" (claims, countersigns, contributions, versions, submissions, marks) is the 0002
-- trigger trg_team_member_history_guard, so it holds for a direct DELETE too; it raises
-- 55000 with DETAIL leave_team_has_history.
CREATE FUNCTION public.leave_team(p_team_id VARCHAR)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
    v_usn  VARCHAR(10) := app.current_usn();
    v_left INT;
BEGIN
    IF v_usn IS NULL THEN
        RAISE EXCEPTION 'Only a signed-in student can leave a team'
            USING ERRCODE = 'insufficient_privilege', DETAIL = 'student_required';
    END IF;
    DELETE FROM public.team_member WHERE team_id = p_team_id AND usn = v_usn;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'You are not a member of team %', p_team_id
            USING ERRCODE = 'no_data_found', DETAIL = 'not_a_member';
    END IF;
    SELECT count(*) INTO v_left FROM public.team_member WHERE team_id = p_team_id;
    RETURN jsonb_build_object('team_id', p_team_id, 'usn', v_usn, 'left', true, 'members', v_left);
END $$;


-- =====================================================================
-- 3. Submission: freeze the latest version of each artifact, atomically
-- =====================================================================
CREATE FUNCTION public.submit_milestone(p_team_id VARCHAR, p_milestone_no INT, p_artifact_ids TEXT[])
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
    v_usn        VARCHAR(10) := app.current_usn();
    v_project    VARCHAR(5);
    v_locked     TIMESTAMPTZ;
    v_bad        RECORD;
    v_attempt    INT;
    v_submission INT;
BEGIN
    IF v_usn IS NULL OR NOT app.is_team_member(p_team_id) THEN
        RAISE EXCEPTION 'Only a member of team % can submit for it', p_team_id
            USING ERRCODE = 'insufficient_privilege', DETAIL = 'team_member_required';
    END IF;
    SELECT project_id INTO v_project FROM public.team WHERE team_id = p_team_id;

    SELECT locked_at INTO v_locked FROM public.milestone
    WHERE project_id = v_project AND milestone_no = p_milestone_no;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Project % has no milestone %', v_project, p_milestone_no
            USING ERRCODE = 'no_data_found', DETAIL = 'milestone_not_found';
    END IF;
    IF v_locked IS NOT NULL THEN                      -- the trigger re-checks under a row lock
        RAISE EXCEPTION 'Milestone %/% is locked; it accepts no new submissions', v_project, p_milestone_no
            USING ERRCODE = 'object_not_in_prerequisite_state', DETAIL = 'milestone_locked';
    END IF;
    IF coalesce(cardinality(p_artifact_ids), 0) = 0 THEN
        RAISE EXCEPTION 'Choose at least one artifact to submit'
            USING ERRCODE = 'invalid_parameter_value', DETAIL = 'artifacts_required';
    END IF;

    -- Validate every requested artifact in one query: the first offender (if any) is reported.
    -- The artifact lookup goes through RLS, so an artifact the caller cannot see is "not found".
    SELECT r.artifact_id, a.team_id, a.visibility, lv.latest INTO v_bad
    FROM (SELECT DISTINCT unnest(p_artifact_ids) AS artifact_id) r
    LEFT JOIN public.artifact a ON a.artifact_id = r.artifact_id
    LEFT JOIN LATERAL (SELECT max(v.version_no) AS latest
                       FROM public.artifact_version v WHERE v.artifact_id = r.artifact_id) lv ON true
    WHERE a.artifact_id IS NULL OR a.team_id <> p_team_id
       OR a.visibility = 'private' OR lv.latest IS NULL
    ORDER BY r.artifact_id
    LIMIT 1;
    IF FOUND THEN
        IF v_bad.team_id IS NULL OR v_bad.team_id <> p_team_id THEN
            RAISE EXCEPTION 'Artifact % is not an artifact of team %', v_bad.artifact_id, p_team_id
                USING ERRCODE = 'no_data_found', DETAIL = 'artifact_not_found';
        ELSIF v_bad.visibility = 'private' THEN
            RAISE EXCEPTION 'Artifact % is private; share it with the team before submitting', v_bad.artifact_id
                USING ERRCODE = 'object_not_in_prerequisite_state', DETAIL = 'artifact_private';
        ELSE
            RAISE EXCEPTION 'Artifact % has no saved version to submit', v_bad.artifact_id
                USING ERRCODE = 'object_not_in_prerequisite_state', DETAIL = 'artifact_no_version';
        END IF;
    END IF;

    -- Next attempt number. Two teammates submitting at once would both compute max+1, so we
    -- serialize on a transaction-scoped advisory lock keyed by (team, component); the UNIQUE
    -- (team_id, project_id, milestone_no, attempt_no) constraint is the backstop (23505).
    PERFORM pg_advisory_xact_lock(hashtextextended('submission:' || p_team_id || ':' || p_milestone_no, 0));
    SELECT coalesce(max(attempt_no), 0) + 1 INTO v_attempt
    FROM public.submission WHERE team_id = p_team_id AND milestone_no = p_milestone_no;

    INSERT INTO public.submission (team_id, project_id, milestone_no, submitted_by, attempt_no)
    VALUES (p_team_id, v_project, p_milestone_no, v_usn, v_attempt)
    RETURNING submission_id INTO v_submission;

    -- Snapshot: the latest version_no of each artifact (GROUP BY + max) is what gets frozen.
    INSERT INTO public.submission_artifact (submission_id, artifact_id, version_no)
    SELECT v_submission, v.artifact_id, max(v.version_no)
    FROM public.artifact_version v
    WHERE v.artifact_id = ANY (p_artifact_ids)
    GROUP BY v.artifact_id;

    -- Submitting publishes the artifact to the teaching faculty (team -> submitted).
    UPDATE public.artifact SET visibility = 'submitted'
    WHERE artifact_id = ANY (p_artifact_ids) AND visibility = 'team';

    RETURN jsonb_build_object(
        'submission_id', v_submission, 'team_id', p_team_id, 'project_id', v_project,
        'milestone_no', p_milestone_no, 'attempt_no', v_attempt, 'submitted_by', v_usn,
        'artifacts', (SELECT jsonb_agg(jsonb_build_object('artifact_id', sa.artifact_id,
                                                          'version_no', sa.version_no)
                                       ORDER BY sa.artifact_id)
                      FROM public.submission_artifact sa WHERE sa.submission_id = v_submission));
END $$;


-- =====================================================================
-- 4. Claims: file, add evidence, countersign
-- =====================================================================

-- file_claim: "I did X for component C". The team is derived (one team per project), the
-- status starts 'pending' (derived by trigger). If an artifact is named, its latest version
-- is attached as evidence #1.
CREATE FUNCTION public.file_claim(p_project_id        VARCHAR,
                                  p_milestone_no      INT,
                                  p_contribution_type VARCHAR,
                                  p_description       TEXT,
                                  p_ai_assistance     VARCHAR DEFAULT 'none',
                                  p_artifact_id       VARCHAR DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
    v_usn     VARCHAR(10) := app.current_usn();
    v_team    VARCHAR(5);
    v_locked  TIMESTAMPTZ;
    v_claim   INT;
    v_status  VARCHAR(10);
    v_version INT;
BEGIN
    IF v_usn IS NULL THEN
        RAISE EXCEPTION 'Only a signed-in student can file a claim'
            USING ERRCODE = 'insufficient_privilege', DETAIL = 'student_required';
    END IF;
    SELECT tm.team_id INTO v_team
    FROM public.team_member tm JOIN public.team t ON t.team_id = tm.team_id
    WHERE tm.usn = v_usn AND t.project_id = p_project_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'You are not in a team for project %', p_project_id
            USING ERRCODE = 'insufficient_privilege', DETAIL = 'project_member_required';
    END IF;

    SELECT locked_at INTO v_locked FROM public.milestone
    WHERE project_id = p_project_id AND milestone_no = p_milestone_no;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Project % has no milestone %', p_project_id, p_milestone_no
            USING ERRCODE = 'no_data_found', DETAIL = 'milestone_not_found';
    END IF;
    IF v_locked IS NOT NULL THEN
        RAISE EXCEPTION 'Milestone %/% is locked; its marks are final', p_project_id, p_milestone_no
            USING ERRCODE = 'object_not_in_prerequisite_state', DETAIL = 'milestone_locked';
    END IF;

    -- input rules (the same domains as the CHECK constraints, with readable messages)
    IF p_contribution_type IS NULL
       OR p_contribution_type NOT IN ('research', 'design', 'code', 'documentation', 'review') THEN
        RAISE EXCEPTION 'Contribution type must be research, design, code, documentation or review'
            USING ERRCODE = 'invalid_parameter_value', DETAIL = 'contribution_type';
    END IF;
    IF length(btrim(coalesce(p_description, ''))) < 10 THEN
        RAISE EXCEPTION 'Describe the work in at least 10 characters'
            USING ERRCODE = 'invalid_parameter_value', DETAIL = 'statement';
    END IF;
    IF coalesce(p_ai_assistance, 'none') NOT IN ('none', 'assisted', 'generated') THEN
        RAISE EXCEPTION 'AI assistance must be none, assisted or generated'
            USING ERRCODE = 'invalid_parameter_value', DETAIL = 'ai_assistance';
    END IF;

    INSERT INTO public.claim (usn, team_id, project_id, milestone_no, statement,
                              ai_assistance, contribution_type)
    VALUES (v_usn, v_team, p_project_id, p_milestone_no, btrim(p_description),
            coalesce(p_ai_assistance, 'none'), p_contribution_type)
    RETURNING claim_id, status INTO v_claim, v_status;

    IF p_artifact_id IS NOT NULL THEN
        -- RLS applies: a teammate's private artifact is "not found" too
        IF NOT EXISTS (SELECT 1 FROM public.artifact
                       WHERE artifact_id = p_artifact_id AND team_id = v_team) THEN
            RAISE EXCEPTION 'Artifact % is not an artifact of team %', p_artifact_id, v_team
                USING ERRCODE = 'no_data_found', DETAIL = 'artifact_not_found';
        END IF;
        SELECT max(version_no) INTO v_version
        FROM public.artifact_version WHERE artifact_id = p_artifact_id;
        IF v_version IS NULL THEN
            RAISE EXCEPTION 'Artifact % has no saved version to cite', p_artifact_id
                USING ERRCODE = 'object_not_in_prerequisite_state', DETAIL = 'artifact_no_version';
        END IF;
        INSERT INTO public.claim_evidence (claim_id, evidence_no, kind, artifact_id, version_no, note)
        VALUES (v_claim, 1, 'artifact_version', p_artifact_id, v_version, 'cited when the claim was filed');
    END IF;

    RETURN jsonb_build_object('claim_id', v_claim, 'usn', v_usn, 'team_id', v_team,
                              'project_id', p_project_id, 'milestone_no', p_milestone_no,
                              'status', v_status,
                              'evidence', CASE WHEN p_artifact_id IS NULL THEN '[]'::jsonb
                                               ELSE jsonb_build_array(jsonb_build_object(
                                                    'evidence_no', 1, 'artifact_id', p_artifact_id,
                                                    'version_no', v_version)) END);
END $$;

-- add_claim_evidence: attach a pointer to the caller's own pending claim.
-- p_ref by kind:  contribution -> '42' (contribution_id)   artifact_version -> 'A13@v2' or 'A13' (latest)
--                 commit -> hex SHA   url -> http(s) URL   file -> repository path
CREATE FUNCTION public.add_claim_evidence(p_claim_id INT, p_kind VARCHAR, p_ref TEXT,
                                          p_note VARCHAR DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
    v_usn          VARCHAR(10) := app.current_usn();
    v_claim        RECORD;
    v_ref          TEXT := nullif(btrim(p_ref), '');
    v_contribution INT;
    v_artifact     VARCHAR(5);
    v_version      INT;
    v_no           INT;
BEGIN
    SELECT usn, status INTO v_claim FROM public.claim WHERE claim_id = p_claim_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Claim % not found', p_claim_id
            USING ERRCODE = 'no_data_found', DETAIL = 'claim_not_found';
    END IF;
    IF v_usn IS NULL OR v_claim.usn <> v_usn THEN
        RAISE EXCEPTION 'Only the claimant can add evidence to claim %', p_claim_id
            USING ERRCODE = 'insufficient_privilege', DETAIL = 'claim_owner_required';
    END IF;
    IF v_claim.status <> 'pending' THEN
        RAISE EXCEPTION 'Claim % is already %; its evidence is frozen', p_claim_id, v_claim.status
            USING ERRCODE = 'object_not_in_prerequisite_state', DETAIL = 'claim_not_pending';
    END IF;
    IF v_ref IS NULL THEN
        RAISE EXCEPTION 'Evidence needs a reference'
            USING ERRCODE = 'invalid_parameter_value', DETAIL = 'ref';
    END IF;

    CASE p_kind
    WHEN 'contribution' THEN
        IF v_ref !~ '^[0-9]{1,9}$' THEN
            RAISE EXCEPTION 'A contribution reference is its numeric id'
                USING ERRCODE = 'invalid_parameter_value', DETAIL = 'ref';
        END IF;
        SELECT contribution_id INTO v_contribution FROM public.contribution
        WHERE contribution_id = v_ref::int;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Contribution % not found', v_ref
                USING ERRCODE = 'no_data_found', DETAIL = 'ref';
        END IF;
        v_ref := NULL;
    WHEN 'artifact_version' THEN
        IF v_ref !~ '^[A-Za-z0-9]{1,5}(@v[0-9]{1,6})?$' THEN
            RAISE EXCEPTION 'An artifact version reference looks like A13@v2 (or A13 for the latest)'
                USING ERRCODE = 'invalid_parameter_value', DETAIL = 'ref';
        END IF;
        v_artifact := split_part(v_ref, '@v', 1);
        -- visible versions only (RLS): another member's private artifact is "not found"
        SELECT v.version_no INTO v_version
        FROM public.artifact_version v
        WHERE v.artifact_id = v_artifact
          AND (strpos(v_ref, '@v') = 0 OR v.version_no = split_part(v_ref, '@v', 2)::int)
        ORDER BY v.version_no DESC
        LIMIT 1;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Artifact version % not found', v_ref
                USING ERRCODE = 'no_data_found', DETAIL = 'ref';
        END IF;
        v_ref := NULL;
    WHEN 'commit' THEN
        IF v_ref !~ '^[0-9a-f]{7,40}$' THEN
            RAISE EXCEPTION 'A commit reference is a 7-40 character hex SHA'
                USING ERRCODE = 'invalid_parameter_value', DETAIL = 'ref';
        END IF;
    WHEN 'url' THEN
        IF v_ref !~* '^https?://\S+$' THEN
            RAISE EXCEPTION 'A URL must start with http:// or https://'
                USING ERRCODE = 'invalid_parameter_value', DETAIL = 'ref';
        END IF;
    WHEN 'file' THEN
        NULL;                                         -- any repository path
    ELSE
        RAISE EXCEPTION 'Evidence kind must be contribution, artifact_version, commit, url or file'
            USING ERRCODE = 'invalid_parameter_value', DETAIL = 'kind';
    END CASE;

    -- Lock the claim row (allowed: the caller passes the claim UPDATE policy as owner of a
    -- pending claim) so two concurrent adds get evidence_no n and n+1, not a PK clash.
    -- If a teammate confirmed it meanwhile, the UPDATE policy (pending only) hides the row.
    PERFORM 1 FROM public.claim WHERE claim_id = p_claim_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Claim % is no longer pending; its evidence is frozen', p_claim_id
            USING ERRCODE = 'object_not_in_prerequisite_state', DETAIL = 'claim_not_pending';
    END IF;
    SELECT coalesce(max(evidence_no), 0) + 1 INTO v_no
    FROM public.claim_evidence WHERE claim_id = p_claim_id;

    -- Same-team rule for the evidence: 0002 trigger trg_claim_evidence_same_team.
    INSERT INTO public.claim_evidence (claim_id, evidence_no, kind, contribution_id,
                                       artifact_id, version_no, ref, note)
    VALUES (p_claim_id, v_no, p_kind, v_contribution, v_artifact, v_version, v_ref,
            nullif(btrim(p_note), ''));

    RETURN jsonb_build_object('claim_id', p_claim_id, 'evidence_no', v_no, 'kind', p_kind,
                              'contribution_id', v_contribution, 'artifact_id', v_artifact,
                              'version_no', v_version, 'ref', v_ref);
END $$;

-- countersign_claim: a teammate confirms or disputes a claim (re-signing changes the verdict).
-- Not-self, teammate-only, the lock and the revision check are 0002 trigger rules;
-- claim.status is re-derived by trigger. p_claim_revision is the claim.revision the UI
-- showed: if the claimant edited the claim or its evidence since, the signature is refused
-- (55000 countersign_stale_revision) instead of endorsing text the signer never saw.
CREATE FUNCTION public.countersign_claim(p_claim_id INT, p_verdict VARCHAR, p_comment VARCHAR DEFAULT NULL,
                                         p_claim_revision INT DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
    v_usn      VARCHAR(10) := app.current_usn();
    v_comment  VARCHAR(300) := nullif(btrim(p_comment), '');
    v_claimant VARCHAR(10);
    v_inserted BOOLEAN;
    v_status   VARCHAR(10);
BEGIN
    IF v_usn IS NULL THEN
        RAISE EXCEPTION 'Only a signed-in student can countersign'
            USING ERRCODE = 'insufficient_privilege', DETAIL = 'student_required';
    END IF;
    IF p_verdict IS NULL OR p_verdict NOT IN ('confirm', 'dispute') THEN
        RAISE EXCEPTION 'Verdict must be confirm or dispute'
            USING ERRCODE = 'invalid_parameter_value', DETAIL = 'verdict';
    END IF;
    IF p_verdict = 'dispute' AND v_comment IS NULL THEN
        RAISE EXCEPTION 'A dispute needs a comment saying what is wrong'
            USING ERRCODE = 'invalid_parameter_value', DETAIL = 'comment';
    END IF;

    SELECT usn INTO v_claimant FROM public.claim WHERE claim_id = p_claim_id;  -- RLS: own teams only
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Claim % not found', p_claim_id
            USING ERRCODE = 'no_data_found', DETAIL = 'claim_not_found';
    END IF;
    IF v_claimant = v_usn THEN
        RAISE EXCEPTION 'You cannot countersign your own claim'
            USING ERRCODE = 'check_violation', DETAIL = 'countersign_not_self';
    END IF;

    -- Upsert. (xmax = 0) is true only for a freshly inserted row version: a cheap way to tell
    -- a first signature from a revised one.
    -- (signed_at is stamped by the server: column default on INSERT, trigger on UPDATE)
    INSERT INTO public.countersign (claim_id, endorser_usn, verdict, comment, claim_revision)
    VALUES (p_claim_id, v_usn, p_verdict, v_comment, p_claim_revision)
    ON CONFLICT (claim_id, endorser_usn) DO UPDATE
        SET verdict = EXCLUDED.verdict, comment = EXCLUDED.comment,
            claim_revision = EXCLUDED.claim_revision
    RETURNING (xmax = 0) INTO v_inserted;

    SELECT status INTO v_status FROM public.claim WHERE claim_id = p_claim_id;
    RETURN jsonb_build_object('claim_id', p_claim_id, 'endorser_usn', v_usn, 'verdict', p_verdict,
                              'revised', NOT v_inserted, 'claim_status', v_status);
END $$;


-- =====================================================================
-- 5. Marks (faculty)
-- =====================================================================

-- record_assessment: upsert one rubric cell, signed by the calling faculty member.
-- Bounds (<= max_marks), lock and membership: 0002 trigger trg_assessment_check.
CREATE FUNCTION public.record_assessment(p_usn VARCHAR, p_project_id VARCHAR, p_milestone_no INT,
                                         p_marks NUMERIC, p_remarks VARCHAR DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
    v_faculty  VARCHAR(6) := app.current_faculty_id();
    v_at       TIMESTAMPTZ;
    v_inserted BOOLEAN;
BEGIN
    IF v_faculty IS NULL THEN
        RAISE EXCEPTION 'Only faculty can record marks'
            USING ERRCODE = 'insufficient_privilege', DETAIL = 'faculty_required';
    END IF;
    IF NOT app.teaches_project(p_project_id) THEN
        RAISE EXCEPTION 'You do not teach project %', p_project_id
            USING ERRCODE = 'insufficient_privilege', DETAIL = 'teaches_project_required';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.milestone
                   WHERE project_id = p_project_id AND milestone_no = p_milestone_no) THEN
        RAISE EXCEPTION 'Project % has no milestone %', p_project_id, p_milestone_no
            USING ERRCODE = 'no_data_found', DETAIL = 'milestone_not_found';
    END IF;
    IF p_marks IS NULL OR p_marks < 0 OR p_marks <> round(p_marks, 1) THEN
        RAISE EXCEPTION 'Marks must be a non-negative number with at most one decimal'
            USING ERRCODE = 'invalid_parameter_value', DETAIL = 'marks';
    END IF;

    INSERT INTO public.assessment (usn, project_id, milestone_no, marks, assessed_by, remarks)
    VALUES (p_usn, p_project_id, p_milestone_no, p_marks, v_faculty, nullif(btrim(p_remarks), ''))
    ON CONFLICT (usn, project_id, milestone_no) DO UPDATE
        SET marks = EXCLUDED.marks, remarks = EXCLUDED.remarks,
            assessed_by = EXCLUDED.assessed_by, assessed_at = now()
    RETURNING assessed_at, (xmax = 0) INTO v_at, v_inserted;   -- xmax = 0: freshly inserted

    RETURN jsonb_build_object('usn', p_usn, 'project_id', p_project_id, 'milestone_no', p_milestone_no,
                              'marks', p_marks, 'assessed_by', v_faculty, 'assessed_at', v_at,
                              'inserted', v_inserted);
END $$;

-- lock_milestone: marks of this component become final (one-way for faculty, 0003 trigger).
CREATE FUNCTION public.lock_milestone(p_project_id VARCHAR, p_milestone_no INT)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
    v_locked   TIMESTAMPTZ;
    v_marked   INT;
    v_students INT;
BEGIN
    IF NOT app.oversees_project(p_project_id) THEN
        RAISE EXCEPTION 'Only the teaching faculty or an admin can lock milestones of project %', p_project_id
            USING ERRCODE = 'insufficient_privilege', DETAIL = 'teaches_project_required';
    END IF;
    SELECT locked_at INTO v_locked FROM public.milestone
    WHERE project_id = p_project_id AND milestone_no = p_milestone_no;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Project % has no milestone %', p_project_id, p_milestone_no
            USING ERRCODE = 'no_data_found', DETAIL = 'milestone_not_found';
    END IF;
    IF v_locked IS NOT NULL THEN
        RAISE EXCEPTION 'Milestone %/% is already locked (since %)', p_project_id, p_milestone_no, v_locked
            USING ERRCODE = 'object_not_in_prerequisite_state', DETAIL = 'milestone_locked';
    END IF;

    -- "AND locked_at IS NULL": if someone locked it meanwhile, we update nothing.
    UPDATE public.milestone SET locked_at = now()
    WHERE project_id = p_project_id AND milestone_no = p_milestone_no AND locked_at IS NULL
    RETURNING locked_at INTO v_locked;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Milestone %/% was locked concurrently', p_project_id, p_milestone_no
            USING ERRCODE = 'object_not_in_prerequisite_state', DETAIL = 'milestone_locked';
    END IF;

    SELECT count(*) INTO v_marked FROM public.assessment
    WHERE project_id = p_project_id AND milestone_no = p_milestone_no;
    SELECT count(DISTINCT tm.usn) INTO v_students
    FROM public.team_member tm JOIN public.team t ON t.team_id = tm.team_id
    WHERE t.project_id = p_project_id;

    RETURN jsonb_build_object('project_id', p_project_id, 'milestone_no', p_milestone_no,
                              'locked_at', v_locked, 'marks_recorded', v_marked,
                              'students', v_students, 'unmarked', v_students - v_marked);
END $$;


-- =====================================================================
-- 6. Skills: complementary finder, relational division, gap, recursive tree
-- =====================================================================

-- find_teammates: COMPLEMENTS, not clones.
--   Missing(me, P) = Required(P) − Mine            (a skill counts as "mine" at >= min_level)
--   candidates     = students not yet in a team of P, allowed to join it (enrolled in P's
--                    offering), who hold >= 1 skill of Missing,
--                    ranked by how many missing skills they cover (partial division),
--                    then by total level on those skills.
-- Plain division StudentSkill ÷ Required(P) would return students who already have
-- everything, i.e. people just like a strong student: see find_full_cover() below.
CREATE FUNCTION public.find_teammates(p_project_id VARCHAR)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
    v_usn    VARCHAR(10) := app.current_usn();
    v_result jsonb;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.project WHERE project_id = p_project_id) THEN
        RAISE EXCEPTION 'Project % does not exist', p_project_id
            USING ERRCODE = 'no_data_found', DETAIL = 'project_not_found';
    END IF;

    WITH missing AS (                                 -- Required(P) − Mine
        SELECT ps.skill_id, ps.min_level
        FROM public.project_skill ps
        WHERE ps.project_id = p_project_id
          AND NOT EXISTS (SELECT 1 FROM public.student_skill mine
                          WHERE mine.usn = v_usn AND mine.skill_id = ps.skill_id
                            AND mine.level >= ps.min_level)
    ), candidate AS (                                 -- StudentSkill ⋈ Missing, grouped per student
        SELECT ss.usn,
               count(*)      AS covered,
               sum(ss.level) AS strength,
               jsonb_agg(jsonb_build_object('skill_id', ss.skill_id, 'name', sk.name,
                                            'level', ss.level, 'required_level', m.min_level)
                         ORDER BY ss.skill_id) AS skills
        FROM public.student_skill ss
        JOIN missing m      ON m.skill_id = ss.skill_id AND ss.level >= m.min_level
        JOIN public.skill sk ON sk.skill_id = ss.skill_id
        WHERE ss.usn IS DISTINCT FROM v_usn
          AND NOT EXISTS (SELECT 1                    -- not already in a team of P
                          FROM public.team_member tm JOIN public.team t ON t.team_id = tm.team_id
                          WHERE tm.usn = ss.usn AND t.project_id = p_project_id)
          AND app.is_eligible_for_project(ss.usn, p_project_id)   -- enrolled in P's offering
        GROUP BY ss.usn
    )
    SELECT jsonb_build_object(
        'project_id', p_project_id,
        'usn', v_usn,
        'missing', coalesce((SELECT jsonb_agg(jsonb_build_object('skill_id', m.skill_id, 'name', sk.name,
                                                                 'required_level', m.min_level)
                                              ORDER BY m.skill_id)
                             FROM missing m JOIN public.skill sk ON sk.skill_id = m.skill_id), '[]'::jsonb),
        'candidates', coalesce((SELECT jsonb_agg(jsonb_build_object(
                                           'usn', c.usn, 'name', s.name, 'section', s.section,
                                           'covered', c.covered,
                                           'covers_all', c.covered = (SELECT count(*) FROM missing),
                                           'skills', c.skills)
                                       ORDER BY c.covered DESC, c.strength DESC, c.usn)
                                FROM candidate c JOIN public.student s ON s.usn = c.usn), '[]'::jsonb))
    INTO v_result;
    RETURN v_result;
END $$;

-- find_full_cover: textbook RELATIONAL DIVISION, StudentSkill ÷ Required(P), written as a
-- double NOT EXISTS: "students for whom there is no required skill they lack".
-- (A project with no required skills is covered by everyone: vacuous truth.)
CREATE FUNCTION public.find_full_cover(p_project_id VARCHAR)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_result jsonb;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.project WHERE project_id = p_project_id) THEN
        RAISE EXCEPTION 'Project % does not exist', p_project_id
            USING ERRCODE = 'no_data_found', DETAIL = 'project_not_found';
    END IF;

    SELECT coalesce(jsonb_agg(jsonb_build_object('usn', s.usn, 'name', s.name, 'section', s.section,
                                                 'team_id', tp.team_id)
                              ORDER BY s.usn), '[]'::jsonb)
    INTO v_result
    FROM public.student s
    LEFT JOIN LATERAL (SELECT tm.team_id                -- their team in P, if any
                       FROM public.team_member tm JOIN public.team t ON t.team_id = tm.team_id
                       WHERE tm.usn = s.usn AND t.project_id = p_project_id) tp ON true
    WHERE NOT EXISTS (                                  -- no required skill ...
        SELECT 1 FROM public.project_skill ps
        WHERE ps.project_id = p_project_id
          AND NOT EXISTS (                              -- ... that this student lacks
              SELECT 1 FROM public.student_skill ss
              WHERE ss.usn = s.usn AND ss.skill_id = ps.skill_id AND ss.level >= ps.min_level));
    RETURN v_result;
END $$;

-- skill_gap: required skills of P vs one student's declared and verified levels.
-- Declared = student_skill.level (self-reported); verified = best level backed by
-- skill_evidence (from confirmed claims / contributions).
CREATE FUNCTION public.skill_gap(p_project_id VARCHAR, p_usn VARCHAR DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
    v_usn    VARCHAR(10) := coalesce(p_usn, app.current_usn());
    v_name   VARCHAR(60);
    v_result jsonb;
BEGIN
    IF v_usn IS NULL THEN
        RAISE EXCEPTION 'Say which student (p_usn); you are not signed in as a student'
            USING ERRCODE = 'invalid_parameter_value', DETAIL = 'usn';
    END IF;
    SELECT name INTO v_name FROM public.student WHERE usn = v_usn;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Student % does not exist', v_usn
            USING ERRCODE = 'no_data_found', DETAIL = 'student_not_found';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.project WHERE project_id = p_project_id) THEN
        RAISE EXCEPTION 'Project % does not exist', p_project_id
            USING ERRCODE = 'no_data_found', DETAIL = 'project_not_found';
    END IF;

    WITH gap AS (
        SELECT ps.skill_id, sk.name, ps.min_level AS required_level,
               ss.level AS declared_level,
               ev.verified_level,
               CASE WHEN ss.level IS NULL         THEN 'missing'
                    WHEN ss.level < ps.min_level  THEN 'below'
                    ELSE 'met' END AS status
        FROM public.project_skill ps
        JOIN public.skill sk ON sk.skill_id = ps.skill_id
        LEFT JOIN public.student_skill ss ON ss.usn = v_usn AND ss.skill_id = ps.skill_id
        LEFT JOIN LATERAL (SELECT max(e.level) AS verified_level
                           FROM public.skill_evidence e
                           WHERE e.usn = v_usn AND e.skill_id = ps.skill_id) ev ON true
        WHERE ps.project_id = p_project_id
    )
    SELECT jsonb_build_object(
        'project_id', p_project_id, 'usn', v_usn, 'name', v_name,
        'met',   count(*) FILTER (WHERE status = 'met'),
        'total', count(*),
        'skills', coalesce(jsonb_agg(to_jsonb(gap) ORDER BY skill_id), '[]'::jsonb))
    INTO v_result
    FROM gap;
    RETURN v_result;
END $$;

-- skill_subtree: the skill and all its descendants (recursive relationship skill -> parent).
-- WITH RECURSIVE: anchor = the root; recursive step = children of rows found so far.
-- SEARCH DEPTH FIRST gives tree order; CYCLE stops if bad data ever forms a loop.
CREATE FUNCTION public.skill_subtree(p_skill_id VARCHAR)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_result jsonb;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.skill WHERE skill_id = p_skill_id) THEN
        RAISE EXCEPTION 'Skill % does not exist', p_skill_id
            USING ERRCODE = 'no_data_found', DETAIL = 'skill_not_found';
    END IF;

    WITH RECURSIVE subtree (skill_id, name, category, parent_skill_id, depth, path) AS (
        SELECT s.skill_id, s.name, s.category, s.parent_skill_id, 0, s.name::text
        FROM public.skill s
        WHERE s.skill_id = p_skill_id
      UNION ALL
        SELECT c.skill_id, c.name, c.category, c.parent_skill_id, st.depth + 1,
               st.path || ' > ' || c.name
        FROM public.skill c
        JOIN subtree st ON c.parent_skill_id = st.skill_id
    ) SEARCH DEPTH FIRST BY skill_id SET tree_order
      CYCLE skill_id SET is_cycle USING cycle_path
    SELECT jsonb_agg(jsonb_build_object('skill_id', skill_id, 'name', name, 'category', category,
                                        'parent_skill_id', parent_skill_id, 'depth', depth,
                                        'path', path)
                     ORDER BY tree_order)
    INTO v_result
    FROM subtree
    WHERE NOT is_cycle;
    RETURN v_result;
END $$;


-- =====================================================================
-- 7. Semester hub: one call that builds the landing page for the signed-in user
-- =====================================================================
CREATE FUNCTION public.semester_hub()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
    v_role    VARCHAR(10) := app.current_app_role();
    v_usn     VARCHAR(10) := app.current_usn();
    v_faculty VARCHAR(6)  := app.current_faculty_id();
    v_term    jsonb;
BEGIN
    IF v_role IS NULL THEN
        RAISE EXCEPTION 'No app profile for this login'
            USING ERRCODE = 'insufficient_privilege', DETAIL = 'profile_required',
                  HINT = 'An admin must link your account to a student or faculty record.';
    END IF;

    SELECT to_jsonb(t) INTO v_term FROM public.academic_term t
    WHERE CURRENT_DATE BETWEEN t.start_date AND t.end_date;

    IF v_role = 'student' THEN
        RETURN jsonb_build_object(
            'role', v_role,
            'me', (SELECT jsonb_build_object('usn', s.usn, 'name', s.name, 'section', s.section,
                                             'semester', s.semester)
                   FROM public.student s WHERE s.usn = v_usn),
            'current_term', v_term,
            -- one row per (enrolled offering, project); security_invoker view, so RLS applies
            'courses', coalesce((SELECT jsonb_agg(to_jsonb(h) - 'usn'
                                                  ORDER BY h.is_current_term DESC, h.course_code, h.project_id)
                                 FROM public.v_semester_hub h), '[]'::jsonb),
            -- teammates' pending claims I have not signed yet
            'countersign_queue', (SELECT count(*)
                                  FROM public.claim c
                                  WHERE c.status = 'pending' AND c.usn <> v_usn
                                    AND app.is_team_member(c.team_id)
                                    AND NOT EXISTS (SELECT 1 FROM public.countersign cs
                                                    WHERE cs.claim_id = c.claim_id
                                                      AND cs.endorser_usn = v_usn)));
    ELSIF v_role = 'faculty' THEN
        RETURN jsonb_build_object(
            'role', v_role,
            'me', (SELECT jsonb_build_object('faculty_id', f.faculty_id, 'name', f.name,
                                             'designation', f.designation)
                   FROM public.faculty f WHERE f.faculty_id = v_faculty),
            'current_term', v_term,
            'offerings', coalesce((SELECT jsonb_agg(jsonb_build_object(
                                              'offering_id', o.offering_id, 'course_code', o.course_code,
                                              'course_title', c.title, 'term_id', o.term_id,
                                              'section', o.section)
                                          ORDER BY o.term_id DESC, o.course_code, o.section)
                                   FROM public.course_offering o
                                   JOIN public.course c ON c.course_code = o.course_code
                                   WHERE o.faculty_id = v_faculty), '[]'::jsonb),
            -- per project: rolled up from the metadata-only progress view
            'projects', coalesce((SELECT jsonb_agg(p ORDER BY p ->> 'project_id')
                                  FROM (SELECT jsonb_build_object(
                                                   'project_id', v.project_id,
                                                   'title', v.project_title,
                                                   'teams', count(*),
                                                   'students', sum(v.members),
                                                   'claims_pending', sum(v.claims_pending),
                                                   'claims_contested', sum(v.claims_contested),
                                                   'last_activity', max(v.last_activity)) AS p
                                        FROM public.v_faculty_team_progress v
                                        WHERE app.teaches_project(v.project_id)
                                        GROUP BY v.project_id, v.project_title) x), '[]'::jsonb));
    ELSE
        RETURN jsonb_build_object(
            'role', v_role,
            'current_term', v_term,
            'counts', jsonb_build_object(
                'students', (SELECT count(*) FROM public.student),
                'faculty',  (SELECT count(*) FROM public.faculty),
                'projects', (SELECT count(*) FROM public.project),
                'teams',    (SELECT count(*) FROM public.team),
                'claims_contested', (SELECT count(*) FROM public.claim WHERE status = 'contested')));
    END IF;
END $$;


-- =====================================================================
-- 8. Private notes (owner-only). SECURITY DEFINER because schema private has no grants for
--    API roles; the owner filter below is therefore the access rule, written explicitly
--    in every statement. A note that is not yours is reported exactly like a missing note,
--    so the RPC does not reveal that someone else's note id exists.
-- =====================================================================
CREATE FUNCTION public.my_private_notes()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_usn VARCHAR(10) := app.current_usn();
BEGIN
    IF v_usn IS NULL THEN
        RAISE EXCEPTION 'Only students have private notes'
            USING ERRCODE = 'insufficient_privilege', DETAIL = 'student_required';
    END IF;
    RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('note_id', n.note_id, 'team_id', n.team_id,
                                                         'title', n.title, 'body', n.body,
                                                         'created_at', n.created_at,
                                                         'updated_at', n.updated_at)
                                      ORDER BY n.updated_at DESC, n.note_id DESC)
                     FROM private.note n
                     WHERE n.owner_usn = v_usn), '[]'::jsonb);
END $$;

-- save_private_note: insert (p_note_id NULL) or update one of the caller's own notes.
-- (Parameters with defaults must come last in PostgreSQL, so p_note_id follows the
--  required ones; PostgREST passes arguments by name anyway.)
CREATE FUNCTION public.save_private_note(p_title VARCHAR, p_body TEXT,
                                         p_note_id INT DEFAULT NULL, p_team_id VARCHAR DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_usn  VARCHAR(10) := app.current_usn();
    v_note private.note%ROWTYPE;
BEGIN
    IF v_usn IS NULL THEN
        RAISE EXCEPTION 'Only students have private notes'
            USING ERRCODE = 'insufficient_privilege', DETAIL = 'student_required';
    END IF;
    IF length(btrim(coalesce(p_title, ''))) = 0 OR length(p_title) > 120 THEN
        RAISE EXCEPTION 'A note needs a title of 1-120 characters'
            USING ERRCODE = 'invalid_parameter_value', DETAIL = 'title';
    END IF;
    IF p_team_id IS NOT NULL AND NOT app.is_team_member(p_team_id) THEN
        RAISE EXCEPTION 'You are not a member of team %', p_team_id
            USING ERRCODE = 'insufficient_privilege', DETAIL = 'team_member_required';
    END IF;

    IF p_note_id IS NULL THEN
        INSERT INTO private.note (owner_usn, team_id, title, body)
        VALUES (v_usn, p_team_id, btrim(p_title), coalesce(p_body, ''))
        RETURNING * INTO v_note;
    ELSE
        UPDATE private.note
        SET title = btrim(p_title), body = coalesce(p_body, ''), team_id = p_team_id, updated_at = now()
        WHERE note_id = p_note_id AND owner_usn = v_usn        -- owner check
        RETURNING * INTO v_note;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Note % not found', p_note_id
                USING ERRCODE = 'no_data_found', DETAIL = 'note_not_found';
        END IF;
    END IF;
    RETURN to_jsonb(v_note) - 'owner_usn';
END $$;

CREATE FUNCTION public.delete_private_note(p_note_id INT)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_usn VARCHAR(10) := app.current_usn();
BEGIN
    IF v_usn IS NULL THEN
        RAISE EXCEPTION 'Only students have private notes'
            USING ERRCODE = 'insufficient_privilege', DETAIL = 'student_required';
    END IF;
    DELETE FROM private.note WHERE note_id = p_note_id AND owner_usn = v_usn;   -- owner check
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Note % not found', p_note_id
            USING ERRCODE = 'no_data_found', DETAIL = 'note_not_found';
    END IF;
    RETURN jsonb_build_object('note_id', p_note_id, 'deleted', true);
END $$;


-- =====================================================================
-- 9. Privileges: signed-in users only. New functions get EXECUTE for PUBLIC by default,
--    so revoke that first; anon never gets EXECUTE (it would also have no table access).
-- =====================================================================
REVOKE ALL ON FUNCTION
    public.join_team(VARCHAR), public.leave_team(VARCHAR),
    public.submit_milestone(VARCHAR, INT, TEXT[]),
    public.file_claim(VARCHAR, INT, VARCHAR, TEXT, VARCHAR, VARCHAR),
    public.add_claim_evidence(INT, VARCHAR, TEXT, VARCHAR),
    public.countersign_claim(INT, VARCHAR, VARCHAR, INT),
    public.record_assessment(VARCHAR, VARCHAR, INT, NUMERIC, VARCHAR),
    public.lock_milestone(VARCHAR, INT),
    public.find_teammates(VARCHAR), public.find_full_cover(VARCHAR),
    public.skill_gap(VARCHAR, VARCHAR), public.skill_subtree(VARCHAR),
    public.semester_hub(),
    public.my_private_notes(), public.save_private_note(VARCHAR, TEXT, INT, VARCHAR),
    public.delete_private_note(INT)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
    public.join_team(VARCHAR), public.leave_team(VARCHAR),
    public.submit_milestone(VARCHAR, INT, TEXT[]),
    public.file_claim(VARCHAR, INT, VARCHAR, TEXT, VARCHAR, VARCHAR),
    public.add_claim_evidence(INT, VARCHAR, TEXT, VARCHAR),
    public.countersign_claim(INT, VARCHAR, VARCHAR, INT),
    public.record_assessment(VARCHAR, VARCHAR, INT, NUMERIC, VARCHAR),
    public.lock_milestone(VARCHAR, INT),
    public.find_teammates(VARCHAR), public.find_full_cover(VARCHAR),
    public.skill_gap(VARCHAR, VARCHAR), public.skill_subtree(VARCHAR),
    public.semester_hub(),
    public.my_private_notes(), public.save_private_note(VARCHAR, TEXT, INT, VARCHAR),
    public.delete_private_note(INT)
TO authenticated;
