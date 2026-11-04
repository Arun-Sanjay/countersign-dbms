| # | Constraint | Referencing relation (columns) | Referenced relation (columns) | ON DELETE | Fig. |
|--:|---|---|---|---|---|
| 1 | `course_faculty_id_fkey` | course (faculty_id) | faculty (faculty_id) | SET NULL | C3-9 |
| 2 | `course_offering_course_code_fkey` | course_offering (course_code) | course (course_code) | RESTRICT | C3-9 |
| 3 | `course_offering_faculty_id_fkey` | course_offering (faculty_id) | faculty (faculty_id) | RESTRICT | C3-9 |
| 4 | `course_offering_term_id_fkey` | course_offering (term_id) | academic_term (term_id) | RESTRICT | C3-9 |
| 5 | `enrollment_offering_id_fkey` | enrollment (offering_id) | course_offering (offering_id) | RESTRICT | C3-9 |
| 6 | `enrollment_usn_fkey` | enrollment (usn) | student (usn) | RESTRICT | C3-9 |
| 7 | `project_course_code_fkey` | project (course_code) | course (course_code) | RESTRICT | C3-9 |
| 8 | `project_offering_fkey` | project (offering_id, course_code) | course_offering (offering_id, course_code) | RESTRICT | C3-9 |
| 9 | `milestone_project_id_fkey` | milestone (project_id) | project (project_id) | CASCADE | C3-9 |
| 10 | `team_project_id_fkey` | team (project_id) | project (project_id) | RESTRICT | C3-9 |
| 11 | `team_member_team_id_fkey` | team_member (team_id) | team (team_id) | CASCADE | C3-9 |
| 12 | `team_member_usn_fkey` | team_member (usn) | student (usn) | CASCADE | C3-9 |
| 13 | `skill_parent_skill_id_fkey` | skill (parent_skill_id) | skill (skill_id) | NO ACTION | C3-9 |
| 14 | `student_skill_skill_id_fkey` | student_skill (skill_id) | skill (skill_id) | NO ACTION | C3-9 |
| 15 | `student_skill_usn_fkey` | student_skill (usn) | student (usn) | CASCADE | C3-9 |
| 16 | `project_skill_project_id_fkey` | project_skill (project_id) | project (project_id) | CASCADE | C3-9 |
| 17 | `project_skill_skill_id_fkey` | project_skill (skill_id) | skill (skill_id) | NO ACTION | C3-9 |
| 18 | `course_skill_course_code_fkey` | course_skill (course_code) | course (course_code) | CASCADE | C3-9 |
| 19 | `course_skill_skill_id_fkey` | course_skill (skill_id) | skill (skill_id) | RESTRICT | C3-9 |
| 20 | `app_user_faculty_id_fkey` | app_user (faculty_id) | faculty (faculty_id) | RESTRICT | C3-9 |
| 21 | `app_user_user_id_fkey` | app_user (user_id) | auth.users (id) | CASCADE | C3-9 |
| 22 | `app_user_usn_fkey` | app_user (usn) | student (usn) | RESTRICT | C3-9 |
| 23 | `note_owner_usn_fkey` | private.note (owner_usn) | student (usn) | CASCADE | C3-9 |
| 24 | `note_team_id_fkey` | private.note (team_id) | team (team_id) | SET NULL | C3-9 |
| 25 | `artifact_owner_usn_fkey` | artifact (owner_usn) | student (usn) | RESTRICT | C3-10 |
| 26 | `artifact_project_id_milestone_no_fkey` | artifact (project_id, milestone_no) | milestone (project_id, milestone_no) | NO ACTION | C3-10 |
| 27 | `artifact_team_id_fkey` | artifact (team_id) | team (team_id) | RESTRICT | C3-10 |
| 28 | `artifact_team_project_fkey` | artifact (team_id, project_id) | team (team_id, project_id) | RESTRICT | C3-10 |
| 29 | `artifact_version_artifact_id_fkey` | artifact_version (artifact_id) | artifact (artifact_id) | CASCADE | C3-10 |
| 30 | `artifact_version_created_by_fkey` | artifact_version (created_by) | student (usn) | RESTRICT | C3-10 |
| 31 | `contribution_artifact_id_fkey` | contribution (artifact_id) | artifact (artifact_id) | RESTRICT | C3-10 |
| 32 | `contribution_usn_fkey` | contribution (usn) | student (usn) | RESTRICT | C3-10 |
| 33 | `artifact_chunk_artifact_id_fkey` | artifact_chunk (artifact_id) | artifact (artifact_id) | CASCADE | C3-10 |
| 34 | `artifact_chunk_author_usn_fkey` | artifact_chunk (author_usn) | student (usn) | RESTRICT | C3-10 |
| 35 | `submission_project_id_milestone_no_fkey` | submission (project_id, milestone_no) | milestone (project_id, milestone_no) | RESTRICT | C3-10 |
| 36 | `submission_submitted_by_fkey` | submission (submitted_by) | student (usn) | RESTRICT | C3-10 |
| 37 | `submission_team_id_project_id_fkey` | submission (team_id, project_id) | team (team_id, project_id) | RESTRICT | C3-10 |
| 38 | `submission_artifact_artifact_id_version_no_fkey` | submission_artifact (artifact_id, version_no) | artifact_version (artifact_id, version_no) | RESTRICT | C3-10 |
| 39 | `submission_artifact_submission_id_fkey` | submission_artifact (submission_id) | submission (submission_id) | CASCADE | C3-10 |
| 40 | `assessment_assessed_by_fkey` | assessment (assessed_by) | faculty (faculty_id) | RESTRICT | C3-10 |
| 41 | `assessment_project_id_milestone_no_fkey` | assessment (project_id, milestone_no) | milestone (project_id, milestone_no) | RESTRICT | C3-10 |
| 42 | `assessment_usn_fkey` | assessment (usn) | student (usn) | RESTRICT | C3-10 |
| 43 | `claim_project_id_milestone_no_fkey` | claim (project_id, milestone_no) | milestone (project_id, milestone_no) | RESTRICT | C3-10 |
| 44 | `claim_team_id_project_id_fkey` | claim (team_id, project_id) | team (team_id, project_id) | RESTRICT | C3-10 |
| 45 | `claim_usn_fkey` | claim (usn) | student (usn) | RESTRICT | C3-10 |
| 46 | `claim_evidence_artifact_id_version_no_fkey` | claim_evidence (artifact_id, version_no) | artifact_version (artifact_id, version_no) | RESTRICT | C3-10 |
| 47 | `claim_evidence_claim_id_fkey` | claim_evidence (claim_id) | claim (claim_id) | CASCADE | C3-10 |
| 48 | `claim_evidence_contribution_id_fkey` | claim_evidence (contribution_id) | contribution (contribution_id) | RESTRICT | C3-10 |
| 49 | `countersign_claim_id_fkey` | countersign (claim_id) | claim (claim_id) | CASCADE | C3-10 |
| 50 | `countersign_endorser_usn_fkey` | countersign (endorser_usn) | student (usn) | RESTRICT | C3-10 |
| 51 | `skill_evidence_claim_fkey` | skill_evidence (claim_id, usn) | claim (claim_id, usn) | CASCADE | C3-10 |
| 52 | `skill_evidence_contribution_fkey` | skill_evidence (contribution_id, usn) | contribution (contribution_id, usn) | CASCADE | C3-10 |
| 53 | `skill_evidence_skill_id_fkey` | skill_evidence (skill_id) | skill (skill_id) | RESTRICT | C3-10 |
| 54 | `skill_evidence_usn_fkey` | skill_evidence (usn) | student (usn) | CASCADE | C3-10 |
