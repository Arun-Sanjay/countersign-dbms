| Sub-process | Store | Access | Data (actual tables / columns) |
|--|-----|---|--------|
| 4.1 | D2 Projects and components | read | milestone.locked_at |
| 4.1 | D3 Teams | read | team_member (derive team) |
| 4.1 | D4 Work record | read | artifact, artifact_version (latest version_no) |
| 4.1 | D6 Claims | read + write | claim (insert, update, delete); claim_evidence #1 |
| 4.2 | D2 Projects and components | read | milestone.locked_at |
| 4.2 | D4 Work record | read | contribution (own), artifact_version (same team) |
| 4.2 | D6 Claims | read + write | claim (row lock, revision + 1); claim_evidence (insert, delete) |
| 4.3 | D2 Projects and components | read | milestone.locked_at |
| 4.3 | D3 Teams | read | team_member (teammate check) |
| 4.3 | D6 Claims | read + write | claim (revision, claimant); countersign (upsert, delete) |
| 4.4 | D6 Claims | read + write | countersign.verdict; claim.status |
| 4.5 | D1 Directory and enrollment | read | student (names) |
| 4.5 | D2 Projects and components | read | milestone (title) |
| 4.5 | D3 Teams | read | team (team_name) |
| 4.5 | D6 Claims | read | claim, claim_evidence, countersign |
