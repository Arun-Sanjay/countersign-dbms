| Flow | From | To | Data flow name | Level 1 parent |
|--|----|----|-------|--|
| F18.1 | Student | 4.1 | claim (component, type, statement, AI-assistance) | F18 |
| F18.2 | Student | 4.1 | claim amendment (statement, type, component) | F18 |
| F18.3 | Student | 4.1 | claim withdrawal (claim_id) | F18 |
| F21.1 | 4.1 | Student | claim receipt (claim_id, status) | F21 |
| F19.1 | Student | 4.2 | evidence reference (kind, ref, note) | F19 |
| F19.2 | Student | 4.2 | evidence removal (claim_id, evidence_no) | F19 |
| F21.2 | 4.2 | Student | evidence receipt (evidence_no) | F21 |
| F20.1 | Student | 4.3 | countersign verdict (verdict, comment, revision read) | F20 |
| F20.2 | Student | 4.3 | verdict withdrawal (claim_id) | F20 |
| F21.4 | 4.3 | Student | verdict receipt (verdict, claim status) | F21 |
| F21.3 | 4.4 | Student | claim status (pending / confirmed / contested) | F21 |
| F22 | 4.5 | Student | countersign queue (count + claims to sign) | F22 |
| F23.1 | 4.5 | Faculty | contested-claim queue (statement, counts) | F23 |
| F23.2 | 4.5 | Faculty | claim trail (evidence, verdicts, comments) | F23 |
| F50.1 | 4.5 | College Admin | contested-claim queue (statement, counts) | F50 |
| F50.2 | 4.5 | College Admin | claim trail (evidence, verdicts, comments) | F50 |
| I4.1 | 4.3 | 4.4 | verdict change (claim_id) | internal to 4.0 |
