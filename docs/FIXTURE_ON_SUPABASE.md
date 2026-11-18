# Running the graded fixture (Q1–Q37) against the Supabase schema

The graded comparison against Appendix H is made on **plain PostgreSQL 17 with C collation**:
`scripts/test_fixture.sh` gives 37/37 there. Run the fixture on Supabase only to show that it
still runs on the migrated schema.

## Never run `03_queries.sql` against the cloud project
- Q30–Q37 write data:
  - Q30 adds `team.github_repo`, a column that no migration knows about;
  - Q31 inserts a student, Q32 updates a project and Q33 deletes P05;
  - Q35 adds a second capacity trigger;
  - Q37 puts Nikhil into T02, so the "nikhil has no team" persona stops working.
- Q37 has its own `BEGIN … COMMIT`, so wrapping the file in `BEGIN; … ROLLBACK;` does
  **not** undo it. The inner COMMIT ends the outer transaction.
- Q27/Q28 create ordinary (non `security_invoker`) views. Such views run as their owner and
  bypass RLS. Since 0003, `authenticated` receives no default privileges on new
  relations, so these views stay unreadable until they are granted. Still, do not create
  them on the cloud project. If they were created, either run
  `ALTER VIEW faculty_team_progress, student_portfolio SET (security_invoker = on)` or drop them.

To demo the fixture on Supabase, use the local stack: run `npx -y supabase@latest db reset`,
then the queries. Afterwards, run `db reset` again and then `scripts/create_personas.py --target local`.
Q1–Q29 are read-only and are safe anywhere.

## Expected differences from Appendix H on the migrated and seeded local DB
| Query | Difference | Why |
|---|---|---|
| Q1, 3, 5, 6, 9, 10, 12–18, 24, 27, 28, 32 | different rows or counts | the demo seed adds P06, the teams T00 (solo) and T06, their enrollments, artifacts, claims and marks, … |
| Q8, Q29 | 'NoSQL' and 'Normalization' swap places | database collation is en_US.UTF-8; Appendix H used byte order (C) |
| Q21 | same rows in a different order | the query has no ORDER BY |
| Q34 | the DETAIL row shows two extra `null`s | team gained `topic_title` and `abstract` (0002) |
| Q36 run alone | CONTEXT names `private.enforce_team_capacity_v2()` | Q35's trigger is only added when Q35 runs first |

## Remote settings that live outside the migrations
- Auth: sign-ups must be off (Dashboard → Authentication → Providers / Sign-ups), the same as
  `enable_signup = false` in `supabase/config.toml`. Personas are created by
  `scripts/create_personas.py` through the Admin API.
