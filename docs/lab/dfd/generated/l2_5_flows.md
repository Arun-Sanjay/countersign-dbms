| Flow | From | To | Data flow name | Level 1 parent |
|--|----|----|-------|--|
| F24 | Student | 5.1 | submission request (team, component, artifact ids) | F24 |
| F25 | 5.1 | Student | submission receipt (attempt_no, frozen versions) | F25 |
| F27 | Faculty | 5.2 | marks entry (usn, component, marks, remarks) | F27 |
| F29.1 | 5.2 | Faculty | assessment receipt | F29 |
| F52 | College Admin | 5.2 | mark correction (insert, update, delete) | F52 |
| F28 | Faculty | 5.3 | component lock (project, component) | F28 |
| F51 | College Admin | 5.3 | component lock / unlock (project, component) | F51 |
| F29.2 | 5.3 | Faculty | component-lock summary (marked / unmarked) | F29 |
| F53 | 5.3 | College Admin | component-lock summary (marked / unmarked) | F53 |
| F30 | 5.4 | Faculty | rubric sheet and team progress (metadata) | F30 |
| F31 | 5.4 | Faculty | submitted work (submitted tier only) | F31 |
| F54.1 | 5.4 | College Admin | rubric sheet, progress and submitted work | F54 |
| F26 | 5.5 | Student | own marks and lab CIE (/50) | F26 |
| F32 | 5.5 | Faculty | class lab CIE marks | F32 |
| F54.2 | 5.5 | College Admin | lab CIE marks (all projects) | F54 |
