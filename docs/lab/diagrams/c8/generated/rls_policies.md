Generated from `pg_policies` on the local database: **102 policies on 30 tables**, roles {authenticated}, kind PERMISSIVE. Tables whose policies are identical are listed together. For reading, the InitPlan wrapper `( SELECT app.f() AS f)` is printed as `app.f()`, and casts such as `::text` are dropped.

| Table(s) | Cmd | USING (which existing rows) | WITH CHECK (which new rows) |
|:----------|:-----|:------------------------|:------------------------|
| `academic_term`, `course`, `course_offering`, `course_skill`, `faculty`, `project`, `project_skill`, `skill`, `skill_evidence`, `student`, `team` | SELECT | `app.current_app_role() IS NOT NULL` | - |
|  | INSERT | - | `app.is_admin()` |
|  | UPDATE | `app.is_admin()` | `app.is_admin()` |
|  | DELETE | `app.is_admin()` | - |
| `app_user` | SELECT | `(user_id = auth.uid()) OR app.is_admin()` | - |
|  | INSERT | - | `app.is_admin()` |
|  | UPDATE | `app.is_admin()` | `app.is_admin()` |
|  | DELETE | `app.is_admin()` | - |
| `artifact` | SELECT | `CASE WHEN (visibility = 'private') THEN (owner_usn = app.current_usn()) ELSE (app.is_team_member(team_id) OR app.oversees_project(project_id)) END` | - |
|  | INSERT | - | `app.is_team_member(team_id) AND ((owner_usn IS NULL) OR (owner_usn = app.current_usn()))` |
|  | UPDATE | `app.is_team_member(team_id) AND ((visibility <> 'private') OR (owner_usn = app.current_usn()))` | `app.is_team_member(team_id) AND ((visibility <> 'private') OR (owner_usn = app.current_usn()))` |
| `artifact_chunk` | SELECT | `EXISTS ( SELECT 1 FROM artifact a WHERE ((a.artifact_id = artifact_chunk.artifact_id) AND ((app.is_team_member(a.team_id) AND ((artifact_chunk.visibility <> 'private') OR (artifact_chunk.author_usn = app.current_usn()))) OR ((artifact_chunk.visibility = 'submitted') AND app.oversees_project(a.project_id)))))` | - |
|  | INSERT | - | `(author_usn = app.current_usn()) AND (EXISTS ( SELECT 1 FROM artifact a WHERE ((a.artifact_id = artifact_chunk.artifact_id) AND app.is_team_member(a.team_id))))` |
| `artifact_version` | SELECT | `EXISTS ( SELECT 1 FROM artifact a WHERE (a.artifact_id = artifact_version.artifact_id))` | - |
|  | INSERT | - | `(created_by = app.current_usn()) AND (EXISTS ( SELECT 1 FROM artifact a WHERE ((a.artifact_id = artifact_version.artifact_id) AND app.is_team_member(a.team_id))))` |
| `assessment` | SELECT | `(usn = app.current_usn()) OR app.oversees_project(project_id)` | - |
|  | INSERT | - | `app.is_admin() OR (app.teaches_project(project_id) AND (assessed_by = app.current_faculty_id()))` |
|  | UPDATE | `app.is_admin() OR app.teaches_project(project_id)` | `app.is_admin() OR (app.teaches_project(project_id) AND (assessed_by = app.current_faculty_id()))` |
|  | DELETE | `app.is_admin()` | - |
| `claim` | SELECT | `app.is_team_member(team_id) OR app.oversees_project(project_id)` | - |
|  | INSERT | - | `(usn = app.current_usn()) AND app.is_team_member(team_id)` |
|  | UPDATE | `(usn = app.current_usn()) AND (status = 'pending')` | `(usn = app.current_usn()) AND app.is_team_member(team_id)` |
|  | DELETE | `(usn = app.current_usn()) AND (status = 'pending')` | - |
| `claim_evidence` | SELECT | `(EXISTS ( SELECT 1 FROM claim c WHERE (c.claim_id = claim_evidence.claim_id))) AND ((artifact_id IS NULL) OR (EXISTS ( SELECT 1 FROM artifact a WHERE (a.artifact_id = claim_evidence.artifact_id)))) AND ((contribution_id IS NULL) OR (EXISTS ( SELECT 1 FROM contribution k WHERE (k.contribution_id = claim_evidence.contribution_id))))` | - |
|  | INSERT | - | `EXISTS ( SELECT 1 FROM claim c WHERE ((c.claim_id = claim_evidence.claim_id) AND (c.usn = app.current_usn()) AND (c.status = 'pending')))` |
|  | DELETE | `EXISTS ( SELECT 1 FROM claim c WHERE ((c.claim_id = claim_evidence.claim_id) AND (c.usn = app.current_usn()) AND (c.status = 'pending')))` | - |
| `contribution` | SELECT | `EXISTS ( SELECT 1 FROM artifact a WHERE (a.artifact_id = contribution.artifact_id))` | - |
|  | INSERT | - | `(usn = app.current_usn()) AND (EXISTS ( SELECT 1 FROM artifact a WHERE ((a.artifact_id = contribution.artifact_id) AND app.is_team_member(a.team_id))))` |
| `countersign` | SELECT | `EXISTS ( SELECT 1 FROM claim c WHERE (c.claim_id = countersign.claim_id))` | - |
|  | INSERT | - | `(endorser_usn = app.current_usn()) AND (EXISTS ( SELECT 1 FROM claim c WHERE (c.claim_id = countersign.claim_id)))` |
|  | UPDATE | `endorser_usn = app.current_usn()` | `endorser_usn = app.current_usn()` |
|  | DELETE | `endorser_usn = app.current_usn()` | - |
| `enrollment` | SELECT | `(usn = app.current_usn()) OR app.is_admin() OR (EXISTS ( SELECT 1 FROM course_offering o WHERE ((o.offering_id = enrollment.offering_id) AND (o.faculty_id = app.current_faculty_id()))))` | - |
|  | INSERT | - | `app.is_admin()` |
|  | UPDATE | `app.is_admin()` | `app.is_admin()` |
|  | DELETE | `app.is_admin()` | - |
| `ingest_event` | SELECT | `app.is_admin() OR (EXISTS ( SELECT 1 FROM team t WHERE ((t.team_id = ingest_event.team_id) AND app.teaches_project(t.project_id))))` | - |
| `milestone` | SELECT | `app.current_app_role() IS NOT NULL` | - |
|  | INSERT | - | `app.is_admin()` |
|  | UPDATE | `app.is_admin() OR app.teaches_project(project_id)` | `app.is_admin() OR app.teaches_project(project_id)` |
|  | DELETE | `app.is_admin()` | - |
| `student_identity` | SELECT | `(usn = app.current_usn()) OR app.is_admin() OR (EXISTS ( SELECT 1 FROM (team_member tm JOIN team t ON ((t.team_id = tm.team_id))) WHERE ((tm.usn = student_identity.usn) AND app.teaches_project(t.project_id))))` | - |
|  | INSERT | - | `app.is_admin()` |
|  | UPDATE | `app.is_admin()` | `app.is_admin()` |
|  | DELETE | `app.is_admin()` | - |
| `student_skill` | SELECT | `app.current_app_role() IS NOT NULL` | - |
|  | INSERT | - | `(usn = app.current_usn()) OR app.is_admin()` |
|  | UPDATE | `(usn = app.current_usn()) OR app.is_admin()` | `(usn = app.current_usn()) OR app.is_admin()` |
|  | DELETE | `(usn = app.current_usn()) OR app.is_admin()` | - |
| `submission` | SELECT | `app.is_team_member(team_id) OR app.oversees_project(project_id)` | - |
|  | INSERT | - | `(submitted_by = app.current_usn()) AND app.is_team_member(team_id)` |
| `submission_artifact` | SELECT | `(EXISTS ( SELECT 1 FROM submission s WHERE (s.submission_id = submission_artifact.submission_id))) AND (EXISTS ( SELECT 1 FROM artifact a WHERE (a.artifact_id = submission_artifact.artifact_id)))` | - |
|  | INSERT | - | `EXISTS ( SELECT 1 FROM submission s WHERE ((s.submission_id = submission_artifact.submission_id) AND app.is_team_member(s.team_id)))` |
| `team_member` | SELECT | `app.current_app_role() IS NOT NULL` | - |
|  | INSERT | - | `(usn = app.current_usn()) OR app.is_admin()` |
|  | UPDATE | `app.is_admin()` | `app.is_admin()` |
|  | DELETE | `(usn = app.current_usn()) OR app.is_admin()` | - |
| `team_repo` | SELECT | `app.is_team_member(team_id) OR app.oversees_project(project_id)` | - |
|  | INSERT | - | `app.is_admin()` |
|  | UPDATE | `app.is_admin()` | `app.is_admin()` |
|  | DELETE | `app.is_admin()` | - |
| `realtime.messages` | SELECT | `(extension = 'broadcast') AND ((topic ~~ 'project:%') OR (topic ~~ 'team:%')) AND app.can_watch_topic(topic)` | - |
