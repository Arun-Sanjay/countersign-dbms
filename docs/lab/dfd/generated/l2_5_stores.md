| Sub-process | Store | Access | Data (actual tables / columns) |
|--|-----|---|--------|
| 5.1 | D2 Projects and components | read | milestone.locked_at |
| 5.1 | D3 Teams | read | team_member (submitter) |
| 5.1 | D4 Work record | read + write | artifact.visibility -> submitted; max(artifact_version.version_no) |
| 5.1 | D5 Text chunks | write | artifact_chunk.visibility -> submitted |
| 5.1 | D7 Submissions | read + write (append) | submission (attempt_no), submission_artifact |
| 5.2 | D1 Directory and enrollment | read | course_offering, course (teaching faculty) |
| 5.2 | D2 Projects and components | read | milestone (max_marks, locked_at) |
| 5.2 | D3 Teams | read | team_member (assessed student) |
| 5.2 | D8 Assessments | read + write | assessment (upsert; admin delete) |
| 5.3 | D1 Directory and enrollment | read | course_offering (teaching faculty) |
| 5.3 | D2 Projects and components | read + write | milestone.locked_at |
| 5.3 | D3 Teams | read | team_member (count) |
| 5.3 | D8 Assessments | read | assessment (count) |
| 5.4 | D1 Directory and enrollment | read | student |
| 5.4 | D2 Projects and components | read | milestone |
| 5.4 | D3 Teams | read | team, team_member |
| 5.4 | D4 Work record | read | artifact, artifact_version, contribution (counts) |
| 5.4 | D5 Text chunks | read | artifact_chunk (submitted only) |
| 5.4 | D6 Claims | read | claim (status counts) |
| 5.4 | D7 Submissions | read | submission |
| 5.4 | D8 Assessments | read | assessment |
| 5.5 | D1 Directory and enrollment | read | student |
| 5.5 | D2 Projects and components | read | milestone (cie_part, max_marks) |
| 5.5 | D3 Teams | read | team, team_member |
| 5.5 | D8 Assessments | read | assessment |
