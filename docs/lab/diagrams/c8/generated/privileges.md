| Catalog check (local database) | Result |
|:--------------------------|:------------|
| Public tables with RLS enabled | 29 of 29 |
| Public tables/views on which anon has SELECT, INSERT, UPDATE or DELETE | 0 |
| Public functions anon may EXECUTE | 0 |
| Public tables authenticated may TRUNCATE (TRUNCATE bypasses RLS) | 0 |
| USAGE on schema app (anon / authenticated) | false / true |
| USAGE on schema private (anon / authenticated) | false / false |
| USAGE on schema pgmq (anon / authenticated) | false / false |
| Tables in schema private (RLS enabled; policies) | note (true; 0) |
| Public views, and how many are security_invoker | 6, 6 |
| Policies not scoped TO authenticated | 0 |
| SECURITY INVOKER RPCs callable by authenticated | 14: add_claim_evidence, countersign_claim, file_claim, find_full_cover, find_teammates, join_team, leave_team, lock_milestone, record_assessment, search_chunks, semester_hub, skill_gap, skill_subtree, submit_milestone |

| View | `reloptions` |
|:------|:------|
| `v_contested_claims` | `security_invoker=true` |
| `v_faculty_team_progress` | `security_invoker=true` |
| `v_lab_cie_marks` | `security_invoker=true` |
| `v_rubric_sheet` | `security_invoker=true` |
| `v_semester_hub` | `security_invoker=true` |
| `v_what_faculty_sees` | `security_invoker=true` |
