-- 0003 · Security: privileges, row-level security policies and security_invoker views.
--
-- Model (defence in depth, three layers):
--   1. Privileges  – anon has NO table privileges at all; authenticated has DML only
--                    (no TRUNCATE/TRIGGER/REFERENCES: TRUNCATE is not subject to RLS).
--   2. RLS         – every public table already has RLS enabled (0001/0002, default-deny);
--                    this file adds the policies, all `TO authenticated`.
--   3. Triggers    – integrity rules (0002) are SECURITY DEFINER, so they hold even when
--                    the writer cannot see the rows they check.
-- Identity: auth.uid() (JWT `sub`) -> app_user -> role + usn | faculty_id.
-- Performance: non-correlated helper calls are written `(select app.fn())` so the planner
-- evaluates them once per statement (an InitPlan), not once per row.
-- Policy shape: at most ONE permissive policy per (table, command), so "who may INSERT a
-- claim?" has a single answer and the Supabase multiple-permissive-policies lint stays quiet.

-- =====================================================================
-- 1. Privileges
-- =====================================================================
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON ALL TABLES IN SCHEMA public FROM authenticated;
-- Same for objects created later (0004 RPCs, views): Supabase's defaults grant them to anon.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES    FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon;
-- authenticated gets NOTHING by default on tables/views created later: every new relation
-- must be granted explicitly (as this file does for its views). Otherwise a view someone
-- creates later in public (e.g. running fixture Q27/Q28 here) would be readable by every
-- signed-in user, and a default (non security_invoker) view bypasses RLS.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated;

-- private.note is reachable only through owner-checking RPCs (0004): no grants, no policies.
REVOKE ALL ON ALL TABLES    IN SCHEMA private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA private FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA private REVOKE ALL ON TABLES    FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA private REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;


-- =====================================================================
-- 2. Helper functions (schema `app`, NOT exposed through the Data API)
--    SECURITY DEFINER: they read app_user/team_member as the owner, so a policy on
--    team_member can call is_team_member() without recursing into its own RLS.
--    search_path = '' : every name is schema-qualified, nothing can be hijacked.
--    STABLE           : same answer within one statement (lets the planner cache it).
-- =====================================================================
CREATE SCHEMA IF NOT EXISTS app;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO authenticated, service_role;

-- The caller's app_user row, as scalars. NULL for anon / service_role / unknown users.
CREATE FUNCTION app.current_usn() RETURNS VARCHAR
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT usn FROM public.app_user WHERE user_id = auth.uid();
$$;

CREATE FUNCTION app.current_faculty_id() RETURNS VARCHAR
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT faculty_id FROM public.app_user WHERE user_id = auth.uid();
$$;

CREATE FUNCTION app.current_app_role() RETURNS VARCHAR
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT role FROM public.app_user WHERE user_id = auth.uid();
$$;

CREATE FUNCTION app.is_admin() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT EXISTS (SELECT 1 FROM public.app_user WHERE user_id = auth.uid() AND role = 'admin');
$$;

-- Is the caller a member of this team?
CREATE FUNCTION app.is_team_member(p_team_id VARCHAR) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT EXISTS (SELECT 1
                   FROM public.team_member tm
                   JOIN public.app_user u ON u.usn = tm.usn
                   WHERE u.user_id = auth.uid() AND tm.team_id = p_team_id);
$$;

-- Is the caller in any team of this project?
CREATE FUNCTION app.is_project_member(p_project_id VARCHAR) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT EXISTS (SELECT 1
                   FROM public.team_member tm
                   JOIN public.team t     ON t.team_id = tm.team_id
                   JOIN public.app_user u ON u.usn = tm.usn
                   WHERE u.user_id = auth.uid() AND t.project_id = p_project_id);
$$;

-- Does the caller (faculty) teach this project? The project's offering decides; projects
-- without an offering (the fixture's P01–P05) fall back to course.faculty_id.
CREATE FUNCTION app.teaches_project(p_project_id VARCHAR) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT EXISTS (SELECT 1
                   FROM public.project p
                   JOIN public.app_user u ON u.user_id = auth.uid() AND u.role = 'faculty'
                   LEFT JOIN public.course_offering o ON o.offering_id = p.offering_id
                   JOIN public.course c ON c.course_code = p.course_code
                   WHERE p.project_id = p_project_id
                     AND u.faculty_id = COALESCE(o.faculty_id, c.faculty_id));
$$;

-- Staff oversight: the project's teacher, or an admin (sees what faculty sees, everywhere).
CREATE FUNCTION app.oversees_project(p_project_id VARCHAR) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT app.is_admin() OR app.teaches_project(p_project_id);
$$;

-- May this student join a team of this project? (enrolled in the project's offering; a
-- project without an offering has no such rule). Mirrors the 0002 trigger rule, for the
-- teammate finder: students cannot read each other's enrollment rows under RLS.
CREATE FUNCTION app.is_eligible_for_project(p_usn VARCHAR, p_project_id VARCHAR) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT EXISTS (SELECT 1 FROM public.project p
                   WHERE p.project_id = p_project_id
                     AND (p.offering_id IS NULL
                          OR EXISTS (SELECT 1 FROM public.enrollment e
                                     WHERE e.usn = p_usn AND e.offering_id = p.offering_id)));
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC, anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO authenticated, service_role;


-- Is the caller an END USER of the API (student/faculty signed in through PostgREST),
-- rather than an admin, the service role, or a migration/seed running as postgres?
-- Inside a SECURITY DEFINER function current_user is the owner, but the 'role' setting
-- (set by PostgREST, and by the tests) still names the role the request runs as.
CREATE FUNCTION private.is_restricted_caller() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT current_setting('role') IN ('authenticated', 'anon') AND NOT app.is_admin();
$$;
REVOKE ALL ON FUNCTION private.is_restricted_caller() FROM PUBLIC, anon, authenticated;


-- =====================================================================
-- 3. Directory tables: every user WITH A PROFILE may read; only admins write.
--    (A self-registered login with no app_user row reads nothing: signing up is not
--     enough to browse the student directory.)
--    (Uniform rule, so it is generated; tables with extra writers are in §4.)
-- =====================================================================
DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['student', 'faculty', 'course', 'project', 'skill', 'project_skill',
                             'team', 'course_skill', 'academic_term', 'course_offering',
                             'skill_evidence', 'milestone', 'team_member', 'student_skill']
    LOOP
        EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated '
                       'USING ((select app.current_app_role()) IS NOT NULL)', t || '_select', t);
    END LOOP;

    FOREACH t IN ARRAY ARRAY['student', 'faculty', 'course', 'project', 'skill', 'project_skill',
                             'team', 'course_skill', 'academic_term', 'course_offering',
                             'skill_evidence']
    LOOP
        EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated '
                       'WITH CHECK ((select app.is_admin()))', t || '_insert', t);
        EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated '
                       'USING ((select app.is_admin())) WITH CHECK ((select app.is_admin()))', t || '_update', t);
        EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated '
                       'USING ((select app.is_admin()))', t || '_delete', t);
    END LOOP;
END $$;

-- skill_evidence is readable like student_skill: a verified level is a profile fact the
-- teammate finder ranks on (it carries ids and levels, no claim text).


-- =====================================================================
-- 4. Directory tables with extra writers
-- =====================================================================

-- ---- milestone: admin manages; the project's faculty may only LOCK it (trigger below) ----
CREATE POLICY milestone_insert ON milestone FOR INSERT TO authenticated
    WITH CHECK ((select app.is_admin()));
CREATE POLICY milestone_update ON milestone FOR UPDATE TO authenticated
    USING      ((select app.is_admin()) OR app.teaches_project(project_id))
    WITH CHECK ((select app.is_admin()) OR app.teaches_project(project_id));
CREATE POLICY milestone_delete ON milestone FOR DELETE TO authenticated
    USING ((select app.is_admin()));

-- RLS is row-level, not column-level: this trigger narrows a faculty UPDATE to locked_at,
-- and makes locking one-way (finality: only an admin can unlock).
CREATE FUNCTION private.guard_milestone_faculty_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF app.current_app_role() = 'faculty' THEN
        -- (counts_in_reduced is a generated column: not yet computed in a BEFORE trigger's NEW)
        IF (to_jsonb(NEW) - 'locked_at' - 'counts_in_reduced')
           <> (to_jsonb(OLD) - 'locked_at' - 'counts_in_reduced') THEN
            RAISE EXCEPTION 'Faculty may only lock milestone %/%', OLD.project_id, OLD.milestone_no
                USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'milestone_faculty_lock_only';
        END IF;
        IF OLD.locked_at IS NOT NULL AND NEW.locked_at IS DISTINCT FROM OLD.locked_at THEN
            RAISE EXCEPTION 'Milestone %/% is already locked', OLD.project_id, OLD.milestone_no
                USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'milestone_locked';
        END IF;
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.guard_milestone_faculty_update() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_milestone_faculty_lock_only
BEFORE UPDATE ON milestone
FOR EACH ROW EXECUTE FUNCTION private.guard_milestone_faculty_update();

-- ---- team_member: a student joins/leaves as themself ----
-- The 0002 triggers still decide: capacity, one team per project, enrollment, and
-- "history pins membership" (so a plain DELETE cannot skip leave_team's rule).
CREATE POLICY team_member_insert ON team_member FOR INSERT TO authenticated
    WITH CHECK (usn = (select app.current_usn()) OR (select app.is_admin()));
CREATE POLICY team_member_update ON team_member FOR UPDATE TO authenticated
    USING ((select app.is_admin())) WITH CHECK ((select app.is_admin()));
CREATE POLICY team_member_delete ON team_member FOR DELETE TO authenticated
    USING (usn = (select app.current_usn()) OR (select app.is_admin()));

-- ---- student_skill: each student declares their own skills ----
CREATE POLICY student_skill_insert ON student_skill FOR INSERT TO authenticated
    WITH CHECK (usn = (select app.current_usn()) OR (select app.is_admin()));
CREATE POLICY student_skill_update ON student_skill FOR UPDATE TO authenticated
    USING      (usn = (select app.current_usn()) OR (select app.is_admin()))
    WITH CHECK (usn = (select app.current_usn()) OR (select app.is_admin()));
CREATE POLICY student_skill_delete ON student_skill FOR DELETE TO authenticated
    USING (usn = (select app.current_usn()) OR (select app.is_admin()));


-- =====================================================================
-- 5. Identity and enrollment
-- =====================================================================
CREATE POLICY app_user_select ON app_user FOR SELECT TO authenticated
    USING (user_id = (select auth.uid()) OR (select app.is_admin()));
CREATE POLICY app_user_insert ON app_user FOR INSERT TO authenticated
    WITH CHECK ((select app.is_admin()));
CREATE POLICY app_user_update ON app_user FOR UPDATE TO authenticated
    USING ((select app.is_admin())) WITH CHECK ((select app.is_admin()));
CREATE POLICY app_user_delete ON app_user FOR DELETE TO authenticated
    USING ((select app.is_admin()));

-- A student sees their own enrollments; faculty see the rolls of offerings they teach.
CREATE POLICY enrollment_select ON enrollment FOR SELECT TO authenticated
    USING (usn = (select app.current_usn())
           OR (select app.is_admin())
           OR EXISTS (SELECT 1 FROM course_offering o
                      WHERE o.offering_id = enrollment.offering_id
                        AND o.faculty_id = (select app.current_faculty_id())));
CREATE POLICY enrollment_insert ON enrollment FOR INSERT TO authenticated
    WITH CHECK ((select app.is_admin()));
CREATE POLICY enrollment_update ON enrollment FOR UPDATE TO authenticated
    USING ((select app.is_admin())) WITH CHECK ((select app.is_admin()));
CREATE POLICY enrollment_delete ON enrollment FOR DELETE TO authenticated
    USING ((select app.is_admin()));


-- =====================================================================
-- 6. Team content
--    Students: their own teams' rows; a 'private' artifact only by its owner.
--    Staff (teaching faculty / admin): metadata of the projects they oversee, never
--    'private' items, and chunk TEXT only once it is 'submitted'.
--    Child tables reuse the parent's policy by writing EXISTS (SELECT … FROM parent):
--    that subquery is itself filtered by the parent's RLS, so visibility composes.
-- =====================================================================

-- ---- artifact ----
CREATE POLICY artifact_select ON artifact FOR SELECT TO authenticated
    USING (CASE WHEN visibility = 'private'
                THEN owner_usn = (select app.current_usn())          -- owner only
                ELSE app.is_team_member(team_id) OR app.oversees_project(project_id) END);
CREATE POLICY artifact_insert ON artifact FOR INSERT TO authenticated
    WITH CHECK (app.is_team_member(team_id)
                AND (owner_usn IS NULL OR owner_usn = (select app.current_usn())));
-- A teammate may edit shared artifacts; making one private means owning it.
CREATE POLICY artifact_update ON artifact FOR UPDATE TO authenticated
    USING      (app.is_team_member(team_id)
                AND (visibility <> 'private' OR owner_usn = (select app.current_usn())))
    WITH CHECK (app.is_team_member(team_id)
                AND (visibility <> 'private' OR owner_usn = (select app.current_usn())));
-- No DELETE policy: artifacts are history (versions, claims and evidence point at them).

-- ---- artifact_version: immutable (no UPDATE/DELETE policy) ----
CREATE POLICY artifact_version_select ON artifact_version FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM artifact a WHERE a.artifact_id = artifact_version.artifact_id));
CREATE POLICY artifact_version_insert ON artifact_version FOR INSERT TO authenticated
    WITH CHECK (created_by = (select app.current_usn())
                AND EXISTS (SELECT 1 FROM artifact a
                            WHERE a.artifact_id = artifact_version.artifact_id
                              AND app.is_team_member(a.team_id)));

-- ---- contribution: append-only log ----
CREATE POLICY contribution_select ON contribution FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM artifact a WHERE a.artifact_id = contribution.artifact_id));
CREATE POLICY contribution_insert ON contribution FOR INSERT TO authenticated
    WITH CHECK (usn = (select app.current_usn())
                AND EXISTS (SELECT 1 FROM artifact a
                            WHERE a.artifact_id = contribution.artifact_id
                              AND app.is_team_member(a.team_id)));

-- ---- artifact_chunk: the actual text (RAG source); its own visibility is the gate ----
CREATE POLICY artifact_chunk_select ON artifact_chunk FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM artifact a
                   WHERE a.artifact_id = artifact_chunk.artifact_id
                     AND (   (app.is_team_member(a.team_id)
                              AND (artifact_chunk.visibility <> 'private'
                                   OR artifact_chunk.author_usn = (select app.current_usn())))
                          OR (artifact_chunk.visibility = 'submitted'
                              AND app.oversees_project(a.project_id)))));
CREATE POLICY artifact_chunk_insert ON artifact_chunk FOR INSERT TO authenticated
    WITH CHECK (author_usn = (select app.current_usn())
                AND EXISTS (SELECT 1 FROM artifact a
                            WHERE a.artifact_id = artifact_chunk.artifact_id
                              AND app.is_team_member(a.team_id)));

-- ---- claim: filed by the claimant; editable/withdrawable only while still pending ----
CREATE POLICY claim_select ON claim FOR SELECT TO authenticated
    USING (app.is_team_member(team_id) OR app.oversees_project(project_id));
CREATE POLICY claim_insert ON claim FOR INSERT TO authenticated
    WITH CHECK (usn = (select app.current_usn()) AND app.is_team_member(team_id));
CREATE POLICY claim_update ON claim FOR UPDATE TO authenticated
    USING      (usn = (select app.current_usn()) AND status = 'pending')
    WITH CHECK (usn = (select app.current_usn()) AND app.is_team_member(team_id));
CREATE POLICY claim_delete ON claim FOR DELETE TO authenticated
    USING (usn = (select app.current_usn()) AND status = 'pending');

-- ---- claim_evidence: visible with its claim, and only if what it points at is visible ----
CREATE POLICY claim_evidence_select ON claim_evidence FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM claim c WHERE c.claim_id = claim_evidence.claim_id)
           AND (artifact_id IS NULL
                OR EXISTS (SELECT 1 FROM artifact a WHERE a.artifact_id = claim_evidence.artifact_id))
           AND (contribution_id IS NULL
                OR EXISTS (SELECT 1 FROM contribution k WHERE k.contribution_id = claim_evidence.contribution_id)));
CREATE POLICY claim_evidence_insert ON claim_evidence FOR INSERT TO authenticated
    WITH CHECK (EXISTS (SELECT 1 FROM claim c
                        WHERE c.claim_id = claim_evidence.claim_id
                          AND c.usn = (select app.current_usn()) AND c.status = 'pending'));
CREATE POLICY claim_evidence_delete ON claim_evidence FOR DELETE TO authenticated
    USING (EXISTS (SELECT 1 FROM claim c
                   WHERE c.claim_id = claim_evidence.claim_id
                     AND c.usn = (select app.current_usn()) AND c.status = 'pending'));

-- ---- countersign: signed by the endorser themself (teammate/not-self rules: trigger) ----
CREATE POLICY countersign_select ON countersign FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM claim c WHERE c.claim_id = countersign.claim_id));
CREATE POLICY countersign_insert ON countersign FOR INSERT TO authenticated
    WITH CHECK (endorser_usn = (select app.current_usn())
                AND EXISTS (SELECT 1 FROM claim c WHERE c.claim_id = countersign.claim_id));
CREATE POLICY countersign_update ON countersign FOR UPDATE TO authenticated
    USING      (endorser_usn = (select app.current_usn()))
    WITH CHECK (endorser_usn = (select app.current_usn()));
CREATE POLICY countersign_delete ON countersign FOR DELETE TO authenticated
    USING (endorser_usn = (select app.current_usn()));

-- ---- submission: frozen once made (no UPDATE/DELETE policy) ----
CREATE POLICY submission_select ON submission FOR SELECT TO authenticated
    USING (app.is_team_member(team_id) OR app.oversees_project(project_id));
CREATE POLICY submission_insert ON submission FOR INSERT TO authenticated
    WITH CHECK (submitted_by = (select app.current_usn()) AND app.is_team_member(team_id));

CREATE POLICY submission_artifact_select ON submission_artifact FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM submission s WHERE s.submission_id = submission_artifact.submission_id)
           AND EXISTS (SELECT 1 FROM artifact a WHERE a.artifact_id = submission_artifact.artifact_id));
CREATE POLICY submission_artifact_insert ON submission_artifact FOR INSERT TO authenticated
    WITH CHECK (EXISTS (SELECT 1 FROM submission s
                        WHERE s.submission_id = submission_artifact.submission_id
                          AND app.is_team_member(s.team_id)));


-- =====================================================================
-- 7. Marks: written by the project's faculty only; a student reads only their own
-- =====================================================================
CREATE POLICY assessment_select ON assessment FOR SELECT TO authenticated
    USING (usn = (select app.current_usn()) OR app.oversees_project(project_id));
-- Faculty sign marks in their own name (assessed_by); bounds and locking: 0002 trigger.
CREATE POLICY assessment_insert ON assessment FOR INSERT TO authenticated
    WITH CHECK ((select app.is_admin())
                OR (app.teaches_project(project_id)
                    AND assessed_by = (select app.current_faculty_id())));
CREATE POLICY assessment_update ON assessment FOR UPDATE TO authenticated
    USING      ((select app.is_admin()) OR app.teaches_project(project_id))
    WITH CHECK ((select app.is_admin())
                OR (app.teaches_project(project_id)
                    AND assessed_by = (select app.current_faculty_id())));
CREATE POLICY assessment_delete ON assessment FOR DELETE TO authenticated
    USING ((select app.is_admin()));


-- =====================================================================
-- 8. Column privileges: server-owned columns.
--    RLS decides WHICH ROWS a user may write; column GRANTs decide WHICH COLUMNS.
--    Identity ids, timestamps and derived columns are left out, so a client can neither
--    pick an id (squatting the next sequence value, so later inserts hit 23505) nor
--    backdate a record (submitted_at, signed_at, created_at ...): the column DEFAULT
--    (identity / now()) is the only way those columns get a value.
--    Tables with no UPDATE grant are append-only for API users at the privilege level too.
-- =====================================================================
REVOKE INSERT, UPDATE ON claim, claim_evidence, countersign, submission, submission_artifact,
    contribution, artifact_chunk, artifact, artifact_version, team_member FROM authenticated;

GRANT INSERT (usn, team_id, project_id, milestone_no, statement, ai_assistance, contribution_type)
    ON claim TO authenticated;
GRANT UPDATE (statement, ai_assistance, contribution_type, milestone_no) ON claim TO authenticated;
GRANT INSERT (claim_id, evidence_no, kind, contribution_id, artifact_id, version_no, ref, note)
    ON claim_evidence TO authenticated;
GRANT INSERT (claim_id, endorser_usn, verdict, comment, claim_revision) ON countersign TO authenticated;
GRANT UPDATE (verdict, comment, claim_revision) ON countersign TO authenticated;
GRANT INSERT (team_id, project_id, milestone_no, submitted_by, attempt_no) ON submission TO authenticated;
GRANT INSERT (submission_id, artifact_id, version_no) ON submission_artifact TO authenticated;
GRANT INSERT (usn, artifact_id, contribution_type, description, source, source_ref, occurred_at, ai_assisted)
    ON contribution TO authenticated;
-- chunk visibility is server-owned too: it becomes 'submitted' only with its artifact (0002)
GRANT INSERT (artifact_id, version_no, author_usn, content, embedding, embedding_model, content_hash)
    ON artifact_chunk TO authenticated;
GRANT INSERT (artifact_id, team_id, project_id, milestone_no, title, type, source,
              visibility, owner_usn, external_ref) ON artifact TO authenticated;
-- team_id / project_id are not updatable: an artifact never moves to another team
GRANT UPDATE (title, external_ref, visibility, owner_usn, milestone_no) ON artifact TO authenticated;
GRANT INSERT (artifact_id, version_no, created_by, content_hash, mongo_ref, ai_assistance)
    ON artifact_version TO authenticated;
GRANT INSERT (team_id, usn, role) ON team_member TO authenticated;      -- joined_at: CURRENT_DATE
GRANT UPDATE (team_id, role) ON team_member TO authenticated;          -- admin only (policy)


-- =====================================================================
-- 9. Rules that depend on WHO is writing (end user vs admin / seed). Universal integrity
--    rules are in 0002; these narrow what an end user may do on top of RLS.
-- =====================================================================

-- ---- team_member: an end user cannot pick their role (the first member leads) ----
-- Fires after trg_team_capacity_v2 (triggers run in name order), which has already
-- write-locked the team row, so two first joiners cannot both become lead.
CREATE FUNCTION private.member_role_for_caller()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF private.is_restricted_caller() THEN
        NEW.role := CASE WHEN EXISTS (SELECT 1 FROM public.team_member WHERE team_id = NEW.team_id)
                         THEN 'member' ELSE 'lead' END;
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_team_member_role
BEFORE INSERT ON team_member
FOR EACH ROW EXECUTE FUNCTION private.member_role_for_caller();

-- ---- artifact: what an UPDATE may change ----
-- RLS cannot see OLD, so transitions are checked here.
--   everyone : team_id / project_id never change; 'submitted' is final (no un-submitting,
--              no moving to another component, no change of owner); an artifact becomes
--              'submitted' only when a submission actually contains it (submit_milestone).
--   end users: may not create an artifact as 'submitted'; ownership passes only through
--              its owner; an artifact can be made private (hidden from the team and
--              faculty) only by its owner and only if nobody else has worked on it.
CREATE FUNCTION private.guard_artifact_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_restricted BOOLEAN := private.is_restricted_caller();
    v_me         VARCHAR(10) := app.current_usn();
    v_others     BOOLEAN;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF v_restricted AND NEW.visibility = 'submitted' THEN
            RAISE EXCEPTION 'An artifact becomes submitted only by submitting it'
                USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'artifact_not_submitted',
                      DETAIL = 'artifact_not_submitted';
        END IF;
        RETURN NEW;
    END IF;

    IF (NEW.team_id, NEW.project_id) IS DISTINCT FROM (OLD.team_id, OLD.project_id) THEN
        RAISE EXCEPTION 'Artifact % cannot move to another team or project', OLD.artifact_id
            USING ERRCODE = 'check_violation', CONSTRAINT = 'artifact_team_immutable',
                  DETAIL = 'artifact_team_immutable';
    END IF;
    IF OLD.visibility = 'submitted'
       AND (NEW.visibility <> 'submitted' OR NEW.milestone_no <> OLD.milestone_no
            OR NEW.owner_usn IS DISTINCT FROM OLD.owner_usn) THEN
        RAISE EXCEPTION 'Artifact % is submitted; its visibility, component and owner are final', OLD.artifact_id
            USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'artifact_submitted_final',
                  DETAIL = 'artifact_submitted_final';
    END IF;
    IF NEW.visibility = 'submitted' AND OLD.visibility <> 'submitted'
       AND NOT EXISTS (SELECT 1 FROM public.submission_artifact WHERE artifact_id = NEW.artifact_id) THEN
        RAISE EXCEPTION 'An artifact becomes submitted only by submitting it'
            USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'artifact_not_submitted',
                  DETAIL = 'artifact_not_submitted';
    END IF;

    IF NOT v_restricted THEN
        RETURN NEW;
    END IF;
    -- has anyone other than the caller recorded work on this artifact?
    v_others := EXISTS (SELECT 1 FROM public.artifact_version
                        WHERE artifact_id = OLD.artifact_id AND created_by IS DISTINCT FROM v_me)
             OR EXISTS (SELECT 1 FROM public.contribution
                        WHERE artifact_id = OLD.artifact_id AND usn IS DISTINCT FROM v_me)
             OR EXISTS (SELECT 1 FROM public.artifact_chunk
                        WHERE artifact_id = OLD.artifact_id AND author_usn IS DISTINCT FROM v_me);
    IF NEW.owner_usn IS DISTINCT FROM OLD.owner_usn
       AND (OLD.owner_usn IS DISTINCT FROM v_me                      -- not yours to hand on ...
            AND NOT (OLD.owner_usn IS NULL AND NEW.owner_usn = v_me AND NOT v_others)) THEN
        RAISE EXCEPTION 'Only the owner of artifact % can change its owner', OLD.artifact_id
            USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'artifact_owner_only',
                  DETAIL = 'artifact_owner_only';
    END IF;
    IF NEW.visibility = 'private' AND OLD.visibility <> 'private'
       AND (NEW.owner_usn IS DISTINCT FROM v_me OR v_others) THEN
        RAISE EXCEPTION 'Artifact % has teammates'' work in it; it cannot be made private', OLD.artifact_id
            USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'artifact_private_owner_only',
                  DETAIL = 'artifact_private_owner_only';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_artifact_guard
BEFORE INSERT OR UPDATE ON artifact
FOR EACH ROW EXECUTE FUNCTION private.guard_artifact_write();

-- ---- submission_artifact: a submission is frozen once its transaction commits ----
-- An end user may add artifacts only to a submission made in the SAME transaction (that
-- is what submit_milestone does). submitted_at cannot be supplied by the client (column
-- grant), so it is now() = this transaction's start time exactly when it was made here.
CREATE FUNCTION private.submission_artifact_same_txn()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF private.is_restricted_caller() AND NOT EXISTS (
        SELECT 1 FROM public.submission
        WHERE submission_id = NEW.submission_id
          AND submitted_at = now() AND submitted_by = app.current_usn()) THEN
        RAISE EXCEPTION 'Submission % is frozen; submit again to include more artifacts', NEW.submission_id
            USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'submission_frozen',
                  DETAIL = 'submission_frozen';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_submission_artifact_same_txn
BEFORE INSERT OR UPDATE ON submission_artifact
FOR EACH ROW EXECUTE FUNCTION private.submission_artifact_same_txn();

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon, authenticated;


-- =====================================================================
-- 10. Views. security_invoker = true: the view runs with the CALLER's privileges, so the
--    RLS policies above filter every base table it reads. (A default view runs as its
--    owner and would bypass RLS: the classic Supabase data leak.)
--    A few WHERE clauses repeat a policy predicate on the *driving* directory table so
--    that, e.g., a student does not get a zero-mark row for every other student.
-- =====================================================================

-- ---- Lab CIE marks: C1..C9 (120 raw) -> 30, + C10 (10) + C11 (10) = 50 ----
-- Data-driven by milestone.cie_part (never by milestone_no):
--   reduced    = raw * 30 / (sum of max_marks of the 'reduced' components), so a project
--                whose reduced components total 100 still maps onto 30;
--   innovative / final = the mark of that one component (CHECK: out of 10; at most one
--                of each per project: partial UNIQUE index).
-- Rounding ASSUMPTION (to confirm with the course faculty): the reduced mark is rounded
-- once, to 1 decimal, half away from zero (NUMERIC round), and the total adds the
-- rounded value. Unassessed components count as 0 (components_assessed shows progress).
-- Only "lab-structured" projects appear: those with at least one non-reduced component.
CREATE VIEW v_lab_cie_marks WITH (security_invoker = true) AS
WITH lab AS (
    SELECT project_id,
           sum(max_marks) FILTER (WHERE cie_part = 'reduced') AS raw_max
    FROM milestone
    GROUP BY project_id
    HAVING bool_or(cie_part <> 'reduced')
), per_student AS (
    SELECT tm.usn, t.team_id, t.project_id, lab.raw_max,
           COALESCE(sum(a.marks) FILTER (WHERE m.cie_part = 'reduced'), 0) AS raw_total,
           count(a.marks) FILTER (WHERE m.cie_part = 'reduced')             AS components_assessed,
           max(a.marks)   FILTER (WHERE m.cie_part = 'innovative')          AS innovative,
           max(a.marks)   FILTER (WHERE m.cie_part = 'final')               AS final
    FROM team_member tm
    JOIN team t   ON t.team_id = tm.team_id
    JOIN lab      ON lab.project_id = t.project_id
    LEFT JOIN assessment a ON a.usn = tm.usn AND a.project_id = t.project_id
    LEFT JOIN milestone  m ON m.project_id = a.project_id AND m.milestone_no = a.milestone_no
    WHERE tm.usn = (select app.current_usn()) OR app.oversees_project(t.project_id)
    GROUP BY tm.usn, t.team_id, t.project_id, lab.raw_max
)
SELECT ps.usn, s.name, ps.team_id, ps.project_id,
       ps.raw_total,
       ps.raw_max,
       ps.components_assessed,
       round(ps.raw_total * 30.0 / ps.raw_max, 1)                    AS reduced_30,
       ps.innovative                                                 AS innovative_10,
       ps.final                                                      AS final_10,
       round(ps.raw_total * 30.0 / ps.raw_max, 1)
           + COALESCE(ps.innovative, 0) + COALESCE(ps.final, 0)      AS total_50
FROM per_student ps
JOIN student s ON s.usn = ps.usn;

-- ---- Rubric sheet: one cell per (student, component), like the paper marks sheet ----
CREATE VIEW v_rubric_sheet WITH (security_invoker = true) AS
SELECT t.project_id, t.team_id, t.team_name, tm.usn, s.name,
       m.milestone_no, m.title AS component, m.max_marks, m.counts_in_reduced, m.deadline,
       (m.locked_at IS NOT NULL) AS locked,
       a.marks, a.assessed_by,                                 -- NULL unless RLS lets you see it
       COALESCE(cl.claims_pending,   0) AS claims_pending,
       COALESCE(cl.claims_confirmed, 0) AS claims_confirmed,
       COALESCE(cl.claims_contested, 0) AS claims_contested
FROM team_member tm
JOIN team t      ON t.team_id = tm.team_id
JOIN student s   ON s.usn = tm.usn
JOIN milestone m ON m.project_id = t.project_id
LEFT JOIN assessment a
       ON a.usn = tm.usn AND a.project_id = m.project_id AND a.milestone_no = m.milestone_no
LEFT JOIN LATERAL (
    SELECT count(*) FILTER (WHERE c.status = 'pending')   AS claims_pending,
           count(*) FILTER (WHERE c.status = 'confirmed') AS claims_confirmed,
           count(*) FILTER (WHERE c.status = 'contested') AS claims_contested
    FROM claim c
    WHERE c.usn = tm.usn AND c.team_id = tm.team_id
      AND c.project_id = m.project_id AND c.milestone_no = m.milestone_no
) cl ON true
WHERE app.is_team_member(t.team_id) OR app.oversees_project(t.project_id);

-- ---- Contested queue: claims a teammate disputed ----
CREATE VIEW v_contested_claims WITH (security_invoker = true) AS
SELECT c.claim_id, c.project_id, c.team_id, t.team_name,
       c.milestone_no, m.title AS component,
       c.usn, s.name AS claimant, c.statement, c.ai_assistance, c.created_at,
       count(*) FILTER (WHERE cs.verdict = 'dispute') AS disputes,
       count(*) FILTER (WHERE cs.verdict = 'confirm') AS confirms,
       max(cs.signed_at) FILTER (WHERE cs.verdict = 'dispute') AS last_disputed_at
FROM claim c
JOIN team t      ON t.team_id = c.team_id
JOIN student s   ON s.usn = c.usn
JOIN milestone m ON m.project_id = c.project_id AND m.milestone_no = c.milestone_no
LEFT JOIN countersign cs ON cs.claim_id = c.claim_id
WHERE c.status = 'contested'
GROUP BY c.claim_id, t.team_name, m.title, s.name;      -- c.claim_id is the PK: c.* is functionally dependent

-- ---- Faculty team progress: METADATA ONLY (counts and timestamps, no content columns) ----
CREATE VIEW v_faculty_team_progress WITH (security_invoker = true) AS
SELECT p.project_id, p.title AS project_title, t.team_id, t.team_name, t.max_size,
       (SELECT count(*) FROM team_member tm WHERE tm.team_id = t.team_id)          AS members,
       (SELECT count(*) FROM artifact a     WHERE a.team_id = t.team_id)           AS artifacts,
       (SELECT count(*) FROM contribution k JOIN artifact a ON a.artifact_id = k.artifact_id
         WHERE a.team_id = t.team_id)                                              AS contributions,
       (SELECT count(*) FROM submission sb  WHERE sb.team_id = t.team_id)          AS submissions,
       (SELECT count(*) FROM claim c WHERE c.team_id = t.team_id AND c.status = 'pending')   AS claims_pending,
       (SELECT count(*) FROM claim c WHERE c.team_id = t.team_id AND c.status = 'confirmed') AS claims_confirmed,
       (SELECT count(*) FROM claim c WHERE c.team_id = t.team_id AND c.status = 'contested') AS claims_contested,
       GREATEST(
           (SELECT max(COALESCE(k.occurred_at, k.created_at::timestamptz))
              FROM contribution k JOIN artifact a ON a.artifact_id = k.artifact_id
             WHERE a.team_id = t.team_id),
           (SELECT max(v.created_at)
              FROM artifact_version v JOIN artifact a ON a.artifact_id = v.artifact_id
             WHERE a.team_id = t.team_id),
           (SELECT max(sb.submitted_at) FROM submission sb WHERE sb.team_id = t.team_id),
           (SELECT max(c.created_at)    FROM claim c       WHERE c.team_id = t.team_id)
       ) AS last_activity                                    -- GREATEST ignores NULLs
FROM team t
JOIN project p ON p.project_id = t.project_id
WHERE app.oversees_project(t.project_id) OR app.is_team_member(t.team_id);

-- ---- Semester hub for the signed-in student ----
-- One row per (enrolled offering, project of that offering). Fixture projects have no
-- offering_id, so they attach to their course's offerings.
CREATE VIEW v_semester_hub WITH (security_invoker = true) AS
SELECT e.usn, o.term_id, (CURRENT_DATE BETWEEN at.start_date AND at.end_date) AS is_current_term,
       o.offering_id, o.course_code, c.title AS course_title, o.section, f.name AS faculty_name,
       p.project_id, p.title AS project_title, p.status AS project_status,
       my.team_id, my.team_name, my.role AS team_role,
       nx.milestone_no AS next_milestone_no, nx.title AS next_component, nx.deadline AS next_deadline,
       COALESCE(cl.pending,   0) AS my_claims_pending,
       COALESCE(cl.confirmed, 0) AS my_claims_confirmed,
       COALESCE(cl.contested, 0) AS my_claims_contested
FROM enrollment e
JOIN course_offering o ON o.offering_id = e.offering_id
JOIN academic_term at  ON at.term_id = o.term_id
JOIN course c          ON c.course_code = o.course_code
JOIN faculty f         ON f.faculty_id = o.faculty_id
LEFT JOIN project p    ON p.offering_id = o.offering_id
                       OR (p.offering_id IS NULL AND p.course_code = o.course_code)
LEFT JOIN LATERAL (
    SELECT t.team_id, t.team_name, tm.role
    FROM team_member tm JOIN team t ON t.team_id = tm.team_id
    WHERE tm.usn = e.usn AND t.project_id = p.project_id
) my ON true                                       -- at most one: one team per project (trigger)
LEFT JOIN LATERAL (
    SELECT m.milestone_no, m.title, m.deadline
    FROM milestone m
    WHERE m.project_id = p.project_id AND m.deadline >= CURRENT_DATE
    ORDER BY m.deadline, m.milestone_no
    LIMIT 1
) nx ON true
LEFT JOIN LATERAL (
    SELECT count(*) FILTER (WHERE status = 'pending')   AS pending,
           count(*) FILTER (WHERE status = 'confirmed') AS confirmed,
           count(*) FILTER (WHERE status = 'contested') AS contested
    FROM claim
    WHERE claim.usn = e.usn AND claim.project_id = p.project_id
) cl ON true
WHERE e.usn = (select app.current_usn());

-- ---- "What my faculty sees": the caller's own rows, filtered by the FACULTY branch of the
--      policies (never 'private', chunks only when 'submitted') and reduced to metadata.
--      Lets a student verify the privacy promise without becoming faculty.
CREATE VIEW v_what_faculty_sees WITH (security_invoker = true) AS
WITH me AS (SELECT (select app.current_usn()) AS usn)
SELECT 'artifact'::text AS item_kind, a.artifact_id AS item_ref, a.team_id, a.project_id,
       a.milestone_no, a.title AS label, a.visibility, NULL::varchar AS ai_assistance,
       a.created_at::timestamptz AS at
FROM artifact a JOIN team_member tm ON tm.team_id = a.team_id JOIN me ON tm.usn = me.usn
WHERE a.visibility <> 'private'
UNION ALL
SELECT 'artifact_version', v.artifact_id || '@v' || v.version_no, a.team_id, a.project_id,
       a.milestone_no, a.title, a.visibility, v.ai_assistance, v.created_at
FROM artifact_version v JOIN artifact a ON a.artifact_id = v.artifact_id JOIN me ON v.created_by = me.usn
WHERE a.visibility <> 'private'
UNION ALL
SELECT 'contribution', k.contribution_id::text, a.team_id, a.project_id,
       a.milestone_no, k.contribution_type || ' on ' || a.title, a.visibility,
       CASE WHEN k.ai_assisted THEN 'assisted' ELSE 'none' END,
       COALESCE(k.occurred_at, k.created_at::timestamptz)
FROM contribution k JOIN artifact a ON a.artifact_id = k.artifact_id JOIN me ON k.usn = me.usn
WHERE a.visibility <> 'private'
UNION ALL
SELECT 'chunk', ch.chunk_id::text, a.team_id, a.project_id,
       a.milestone_no, 'text chunk of ' || a.title, ch.visibility, NULL, ch.created_at::timestamptz
FROM artifact_chunk ch JOIN artifact a ON a.artifact_id = ch.artifact_id JOIN me ON ch.author_usn = me.usn
WHERE ch.visibility = 'submitted' AND a.visibility <> 'private'
UNION ALL
SELECT 'claim', c.claim_id::text, c.team_id, c.project_id,
       c.milestone_no, 'claim (' || c.status || ')', NULL, c.ai_assistance, c.created_at
FROM claim c JOIN me ON c.usn = me.usn
UNION ALL
SELECT 'assessment', a.project_id || '/C' || a.milestone_no, NULL, a.project_id,
       a.milestone_no, 'marks ' || a.marks || ' / ' || m.max_marks, NULL, NULL, a.assessed_at
FROM assessment a
JOIN milestone m ON m.project_id = a.project_id AND m.milestone_no = a.milestone_no
JOIN me ON a.usn = me.usn;

-- Views: signed-in users only (defaults above already keep anon out; be explicit).
REVOKE ALL ON v_lab_cie_marks, v_rubric_sheet, v_contested_claims, v_faculty_team_progress,
              v_semester_hub, v_what_faculty_sees FROM PUBLIC, anon, authenticated;
GRANT SELECT ON v_lab_cie_marks, v_rubric_sheet, v_contested_claims, v_faculty_team_progress,
                v_semester_hub, v_what_faculty_sees TO authenticated;
