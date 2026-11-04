| ID | Store | Engine | Actual tables / collections | Written by | Read by |
|--|------|---|--------|---|-----|
| D1 | Directory and enrollment | PostgreSQL | `student`, `faculty`, `course`, `academic_term`, `course_offering`, `enrollment`, `app_user` | 1.0 | 1.0, 2.0, 4.0, 5.0, 6.0, 8.0 |
| D2 | Projects and components | PostgreSQL | `project`, `milestone` | 1.0, 5.0 | 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 8.0 |
| D3 | Teams | PostgreSQL | `team`, `team_member` | 2.0 | 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 8.0 |
| D4 | Work record | PostgreSQL | `artifact`, `artifact_version`, `contribution` | 3.0, 5.0 | 1.0, 2.0, 3.0, 4.0, 5.0, 6.0 *(planned)*, 7.0 *(planned)*, 8.0 |
| D5 | Text chunks | PostgreSQL | `artifact_chunk` | 3.0, 5.0 | 2.0, 5.0, 7.0 *(planned)*, 8.0 |
| D6 | Claims | PostgreSQL | `claim`, `claim_evidence`, `countersign` | 4.0 | 1.0, 2.0, 4.0, 5.0, 6.0 *(planned)*, 7.0 *(planned)*, 8.0 |
| D7 | Submissions | PostgreSQL | `submission`, `submission_artifact` | 5.0 | 1.0, 2.0, 5.0 |
| D8 | Assessments | PostgreSQL | `assessment` | 5.0 | 2.0, 5.0, 8.0 |
| D9 | Skill graph | PostgreSQL | `skill`, `student_skill`, `project_skill`, `course_skill`, `skill_evidence` | 6.0 | 6.0, 8.0 |
| D10 | Private vault | PostgreSQL | `private.note` | 3.0 | 3.0 |
| D11 | Raw GitHub events | MongoDB | `github_events` | 3.0 *(planned)* | 3.0, 8.0 |
| D12 | Notes | MongoDB | `notes` | 3.0 | 3.0, 8.0 |
| D13 | Note versions | MongoDB | `note_versions` | 3.0 | 3.0, 8.0 |
| D14 | Portfolios | MongoDB | `portfolios` | 8.0 | 8.0 |
